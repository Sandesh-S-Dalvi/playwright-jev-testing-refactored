/**
 * The decision loop.
 *
 * Each round:
 *   1. Observe the page (deterministic).
 *   2. Ask Jev three typed questions in one request (noul + choice + noul).
 *   3. Gate on confidence (deterministic).
 *   4. Execute the chosen action with Playwright (deterministic).
 *
 * Jev may only answer "which element" and "is the goal done / are we stuck".
 * It never writes a selector, never invents a URL, and never decides pass/fail.
 */

import type { Page } from "@playwright/test";
import { choice, noul, type ChoiceCriteria } from "@typesafe-ai/sdk";
import {
  DEFAULT_THRESHOLDS,
  type DecisionProvider,
  type DecisionThresholds,
} from "./provider.js";
import {
  locatorFor,
  renderState,
  snapshotPage,
  type PageElement,
  type PageSnapshot,
} from "./observer.js";

/** The actions Jev is allowed to choose from. */
export type ActionKind = "click" | "fill";

/** One executed step in the trace. */
export interface Step {
  /** 1-based step number. */
  index: number;
  /** The element Jev chose, with its handle and name. */
  element: PageElement;
  /** What was done to it. */
  action: ActionKind;
  /** The value filled, when the action was a fill. */
  value?: string;
  /** Jev's confidence in the choice. */
  confidence: number;
  /** Probability that the goal was already complete. */
  completionProbability: number;
  /** Probability that the run was stuck. */
  stuckProbability: number;
  /** URL after the action ran. */
  url: string;
  /** Text visible on the page after the action. */
  resultText: string;
}

/** The outcome of a goal-driven run. */
export interface RunResult {
  /** Whether Jev judged the goal achieved. */
  completed: boolean;
  /** Number of steps executed. */
  steps: number;
  /** The full step trace. */
  trace: Step[];
  /** The final page snapshot. */
  finalSnapshot: PageSnapshot;
  /** Why the run stopped, when it did not complete. */
  stopReason?: string;
}

/** A goal plus the values to type when a fill is required. */
export interface Goal {
  /** What the user wants to achieve, in plain language. */
  objective: string;
  /**
   * Values for text inputs, keyed by a hint about which field they belong to.
   *
   * Jev cannot generate text, so string values come from here — deterministic inputs
   * supplied by the test, not by the model.
   */
  values?: Record<string, string>;
}

/** Thrown when the run stops before the goal is met. */
export class GoalNotReachedError extends Error {
  constructor(
    message: string,
    public readonly result: RunResult,
  ) {
    super(message);
    this.name = "GoalNotReachedError";
  }
}

/** Thrown when a chosen action fails the confidence gate. */
export class LowConfidenceError extends Error {
  constructor(
    message: string,
    public readonly confidence: number,
    public readonly threshold: number,
  ) {
    super(message);
    this.name = "LowConfidenceError";
  }
}

/** Options for a goal-driven run. */
export interface RunOptions {
  /** The decision provider. */
  provider: DecisionProvider;
  /** Confidence and step thresholds. */
  thresholds?: Partial<DecisionThresholds>;
  /** Called after each executed step. */
  onStep?: (step: Step) => void;
  /** Called before each decision round. */
  onDecision?: (state: string, snapshot: PageSnapshot) => void;
}

/**
 * Drive the browser toward a goal, letting Jev pick each next action.
 */
export async function runToGoal(page: Page, goal: Goal, options: RunOptions): Promise<RunResult> {
  const thresholds: DecisionThresholds = { ...DEFAULT_THRESHOLDS, ...options.thresholds };
  const trace: Step[] = [];

  for (let index = 1; index <= thresholds.maxSteps; index++) {
    const snapshot = await snapshotPage(page);
    const state = renderState(snapshot, goal.objective);

    options.onDecision?.(state, snapshot);

    const criteria = buildCriteria(snapshot.elements);
    const { answers } = await options.provider.ask(state, {
      nextElement: choice(
        "Which single element advances the goal most directly? " +
          "Choose the element to interact with next. If no element advances the goal, choose 'none'.",
        criteria,
      ),
      goalComplete: noul(
        "Has the goal been fully achieved by the current state of the page?",
        {
          true: "The page shows the requested outcome is complete.",
          false: "The goal is not yet complete.",
        },
      ),
      stuck: noul("Is the page stuck — no useful action available, or an error is shown?", {
        true: "The page shows an error, or no element can move the goal forward.",
        false: "Some element can still advance the goal.",
      }),
    });

    const completion = answers.goalComplete.noul;
    const stuckProbability = answers.stuck.noul;
    const chosen = answers.nextElement.choice;
    const confidence = answers.nextElement.confidence;

    if (completion >= thresholds.minCompletion) {
      return {
        completed: true,
        steps: trace.length,
        trace,
        finalSnapshot: snapshot,
      };
    }

    if (stuckProbability >= thresholds.minStuckConfidence) {
      return {
        completed: false,
        steps: trace.length,
        trace,
        finalSnapshot: snapshot,
        stopReason:
          `Jev judged the run stuck (probability ${stuckProbability.toFixed(2)}). ` +
          "The page is likely showing an error or requires input the test did not supply.",
      };
    }

    if (snapshot.elements.length === 0) {
      return {
        completed: false,
        steps: trace.length,
        trace,
        finalSnapshot: snapshot,
        stopReason: "No interactive elements found on the page.",
      };
    }

    if (confidence < thresholds.minConfidence) {
      throw new LowConfidenceError(
        `Jev confidence ${confidence.toFixed(2)} is below the threshold ${thresholds.minConfidence}. ` +
          "Refusing to click an uncertain element — the page probably changed or the goal is ambiguous.",
        confidence,
        thresholds.minConfidence,
      );
    }

    const element = snapshot.elements.find((candidate) => candidate.id === chosen);
    if (!element) {
      return {
        completed: false,
        steps: trace.length,
        trace,
        finalSnapshot: snapshot,
        stopReason: `Jev chose unknown element handle "${chosen}".`,
      };
    }

    const action = chooseAction(element, goal);
    const value = action === "fill" ? resolveValue(element, goal) : undefined;

    if (action === "fill" && value === undefined) {
      return {
        completed: false,
        steps: trace.length,
        trace,
        finalSnapshot: snapshot,
        stopReason:
          `Jev chose the input "${element.name}" but no matching value was supplied in goal.values. ` +
          "Jev cannot invent text; add it to the task.",
      };
    }

    const locator = locatorFor(page, snapshot.elements, element.id);
    if (!locator) {
      return {
        completed: false,
        steps: trace.length,
        trace,
        finalSnapshot: snapshot,
        stopReason: `Could not resolve a locator for element "${element.name}".`,
      };
    }

    if (element.disabled) {
      return {
        completed: false,
        steps: trace.length,
        trace,
        finalSnapshot: snapshot,
        stopReason: `Jev chose "${element.name}", but that control is disabled.`,
      };
    }

    try {
      if (action === "fill") {
        await locator.fill(value as string, { timeout: 10_000 });
      } else {
        await locator.click({ timeout: 10_000 });
      }
    } catch (error) {
      const detail = error instanceof Error ? error.message.split("\n")[0] : String(error);
      return {
        completed: false,
        steps: trace.length,
        trace,
        finalSnapshot: snapshot,
        stopReason: `Action on "${element.name}" failed: ${detail}`,
      };
    }

    await page.waitForLoadState("domcontentloaded").catch(() => {});
    await page.waitForTimeout(250);

    const resultText = (await page
      .locator("body")
      .innerText({ timeout: 3_000 })
      .catch(() => ""))
      .replace(/\s+/g, " ")
      .slice(0, 500);

    const step: Step = {
      index,
      element,
      action,
      ...(value !== undefined ? { value } : {}),
      confidence,
      completionProbability: completion,
      stuckProbability,
      url: page.url(),
      resultText,
    };
    trace.push(step);
    options.onStep?.(step);
  }

  const finalSnapshot = await snapshotPage(page);
  return {
    completed: false,
    steps: trace.length,
    trace,
    finalSnapshot,
    stopReason: `Reached the step limit of ${thresholds.maxSteps} without completing the goal.`,
  };
}

function buildCriteria(elements: PageElement[]): Record<string, string | null> {
  const criteria: Record<string, string | null> = {};
  for (const element of elements) {
    criteria[element.id] = `${element.role} "${element.name}"`;
  }
  criteria.none = "No element advances the goal; the goal cannot be progressed from this state.";
  return criteria;
}

function chooseAction(element: PageElement, goal: Goal): ActionKind {
  const textRoles = new Set(["textbox", "searchbox", "combobox"]);
  const textTags = new Set(["password", "email", "number", "tel", "url", "text"]);
  if (textRoles.has(element.role) || textTags.has(element.role)) {
    return "fill";
  }
  return "click";
}

function resolveValue(element: PageElement, goal: Goal): string | undefined {
  const values = goal.values ?? {};
  const name = element.name.toLowerCase();

  const direct = Object.entries(values).find(([key]) => name.includes(key.toLowerCase()));
  if (direct) return direct[1];

  const all = Object.values(values);
  if (all.length === 1) return all[0];

  return undefined;
}
