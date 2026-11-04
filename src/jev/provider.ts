/**
 * The decision layer.
 *
 * Jev is a *decision* model, not a text model: it never writes code, selectors, or URLs.
 * It answers typed questions about a given state and returns probability distributions.
 * Everything outside this file is deterministic: observation, execution, and assertions.
 *
 * This module owns the contract with the Jev provider and the confidence gate that
 * decides whether an action is safe to execute or the run should stop.
 */

import { TypeSafeClient, type ChoiceCriteria } from "@typesafe-ai/sdk";
import type { ChoiceQuestion, NoulQuestion, ScoreQuestion } from "@typesafe-ai/sdk";

/** The three primitive answer shapes Jev can return. */
export type Answer = NoulQuestion | ChoiceQuestion | ScoreQuestion;

/** A single question key used in a decision request. */
export type QuestionKey = string;

/**
 * Thresholds that gate execution.
 *
 * A low-confidence decision means "I am not sure which element advances the goal".
 * Clicking anyway produces flaky tests, so the run stops instead.
 */
export interface DecisionThresholds {
  /** Minimum confidence required to execute a chosen action. */
  minConfidence: number;
  /** Minimum probability required on the "goal is complete" yes/no answer. */
  minCompletion: number;
  /** Minimum probability required on the "we are stuck" yes/no answer. */
  minStuckConfidence: number;
  /** Maximum number of loop iterations before the run is abandoned. */
  maxSteps: number;
  /** Per-request timeout in milliseconds. */
  timeoutMs: number;
}

export const DEFAULT_THRESHOLDS: DecisionThresholds = {
  minConfidence: 0.6,
  minCompletion: 0.8,
  minStuckConfidence: 0.5,
  maxSteps: 12,
  timeoutMs: 30_000,
};

/** A provider answers questions about a state with probabilities. */
export interface DecisionProvider {
  readonly name: string;
  /** Ask every question in one round trip. */
  ask<T extends Record<QuestionKey, Answer>>(
    state: unknown,
    questions: T,
  ): Promise<DecisionResult<T>>;
}

/** The answer payload returned by a provider, plus optional metadata. */
export interface DecisionResult<T extends Record<QuestionKey, Answer>> {
  answers: Answers<T>;
  model?: string;
}

type Answers<T> = {
  [K in keyof T]: [T[K]] extends [NoulQuestion]
    ? { type: "noul"; noul: number }
    : [T[K]] extends [ScoreQuestion]
      ? { type: "score"; score: number; confidence: number; legend: unknown; probabilities: Record<string, number> }
      : [T[K]] extends [ChoiceQuestion<infer C>]
        ? {
            type: "choice";
            choice: keyof C & string;
            confidence: number;
            probabilities: Record<keyof C & string, number>;
          }
        : never;
};

/**
 * The live provider: the real Jev model via the TypeSafe API.
 *
 * The API key comes from `TYPESAFE_API_KEY` unless overridden in the constructor.
 */
export interface JevProviderOptions {
  /** API key. Falls back to `TYPESAFE_API_KEY` when omitted. */
  apiKey?: string;
  /** API root. Falls back to `TYPESAFE_BASE_URL` when omitted. */
  baseURL?: string;
  /** Model name. Falls back to `TYPESAFE_DEFAULT_MODEL`, then `jev-latest`. */
  model?: string;
  /** Per-request timeout in milliseconds. */
  timeoutMs?: number;
  /**
   * A custom fetch implementation.
   *
   * Used by the test suite to verify the request shape without reaching the API.
   */
  fetch?: typeof fetch;
}

export class JevProvider implements DecisionProvider {
  readonly name = "jev";
  private readonly client: TypeSafeClient;
  private readonly model?: string;

  constructor(options: JevProviderOptions = {}) {
    this.client = new TypeSafeClient({
      ...(options.apiKey ? { apiKey: options.apiKey } : {}),
      ...(options.baseURL ? { baseURL: options.baseURL } : {}),
      ...(options.model ? { defaultModel: options.model } : {}),
      ...(options.timeoutMs ? { timeout: options.timeoutMs } : {}),
      ...(options.fetch ? { fetch: options.fetch } : {}),
    });
    this.model = options.model;
  }

  async ask<T extends Record<QuestionKey, Answer>>(
    state: unknown,
    questions: T,
  ): Promise<DecisionResult<T>> {
    const result = await this.client.systemOne(
      { state: state as never, questions: questions as never, ...(this.model ? { model: this.model } : {}) },
      { timeout: DEFAULT_THRESHOLDS.timeoutMs },
    );
    return {
      answers: result.answers as never,
      model: result.model,
    };
  }
}

/**
 * A deterministic provider used when no API key is configured.
 *
 * It is not a model of Jev's behaviour — it is a stub that keeps the suite runnable
 * offline and in CI. It answers with fixed, high-confidence answers so the mechanics
 * of the loop (observation, execution, gating, assertions) are exercised end to end.
 */
export class MockProvider implements DecisionProvider {
  readonly name = "mock";
  private readonly answers: Record<string, unknown>;

  constructor(answers: Record<string, unknown> = {}) {
    this.answers = answers;
  }

  async ask<T extends Record<QuestionKey, Answer>>(
    _state: unknown,
    questions: T,
  ): Promise<DecisionResult<T>> {
    const answers: Record<string, unknown> = {};
    for (const [key, question] of Object.entries(questions)) {
      answers[key] = this.answers[key] ?? defaultMockAnswer(question);
    }
    return { answers: answers as never, model: "mock" };
  }
}

/**
 * A scripted provider that behaves like a competent decision model.
 *
 * Instead of asking a real model, it picks the element matching a step in a script.
 * This keeps the offline suite meaningful: the whole loop — observation, selection,
 * gating, execution, completion detection — runs for real, only the choice is
 * pre-determined.
 *
 * Each step names an element to act on. A step may also declare the action, which
 * matters for inputs: a script that targets a text field must fill it, and the runner
 * needs to know it is a fill rather than a click.
 */
export class ScriptedProvider implements DecisionProvider {
  readonly name = "scripted";
  private readonly steps: ScriptedStep[];
  private cursor = 0;

  constructor(steps: ScriptedStep[]) {
    this.steps = steps;
  }

  async ask<T extends Record<QuestionKey, Answer>>(
    state: unknown,
    questions: T,
  ): Promise<DecisionResult<T>> {
    const step = this.steps[this.cursor];
    const rendered = typeof state === "string" ? state : JSON.stringify(state);

    const choiceQuestion = questions.nextElement as ChoiceQuestion | undefined;
    const labels = choiceQuestion ? Object.keys(choiceQuestion.criteria) : [];
    const picked = step ? matchElement(rendered, labels, step) : "none";

    // The goal is reached only on the round *after* the final scripted step has
    // run. Reporting completion in the same round would make the runner stop
    // before executing that last step.
    const exhausted = this.cursor >= this.steps.length;
    const finished = exhausted && !this.steps[this.steps.length - 1]?.keepsGoing;

    if (step && picked !== "none") {
      this.cursor += 1;
    }

    const confidence = picked === "none" ? 0.2 : (step?.confidence ?? 0.9);

    return {
      answers: {
        nextElement: {
          type: "choice",
          choice: picked,
          confidence,
          probabilities: Object.fromEntries(
            labels.map((label) => [
              label,
              label === picked
                ? confidence
                : (1 - confidence) / Math.max(1, labels.length - 1),
            ]),
          ),
        },
        goalComplete: { type: "noul", noul: finished ? 0.95 : 0.05 },
        stuck: { type: "noul", noul: 0.02 },
      } as never,
      model: "scripted",
    };
  }
}

/** One step of a scripted run. */
export interface ScriptedStep {
  /** Accessible name (or a substring of it) of the element to act on. */
  element: string;
  /** Confidence to report for this choice. Defaults to 0.9. */
  confidence?: number;
  /** Keep the run going after this step instead of completing. */
  keepsGoing?: boolean;
}

/**
 * Find the element label whose rendered description contains the step's target name.
 *
 * The rendered state lists elements as `el_0 [role] "name"`, so the target name is
 * matched against the quoted accessible name.
 */
function matchElement(rendered: string, labels: string[], step: ScriptedStep): string {
  const needle = step.element.toLowerCase();
  for (const label of labels) {
    const pattern = new RegExp(`${escapeRegExp(label)} \\[^\\]*\\] \"([^\"]*)\"`, "i");
    const match = pattern.exec(rendered);
    if (match?.[1] && match[1].toLowerCase().includes(needle)) {
      return label;
    }
  }
  return "none";
}

function escapeRegExp(text: string): string {
  return text.replace(/[.*+?^${}()|[\\]\\\\]/g, "\\$&");
}

function defaultMockAnswer(question: Answer): unknown {
  if (question.type === "noul") {
    return { type: "noul", noul: 0.05 };
  }
  if (question.type === "score") {
    const criteria = question.criteria as ReadonlyArray<unknown>;
    const labels = criteria.map((_, index) => String(index));
    return {
      type: "score",
      score: 0,
      confidence: 0.9,
      legend: {},
      probabilities: Object.fromEntries(labels.map((l) => [l, 1 / labels.length])),
    };
  }
  // choice
  const criteria = question.criteria as Record<string, unknown>;
  const labels = Object.keys(criteria);
  return {
    type: "choice",
    choice: labels[0] ?? "",
    confidence: 0.9,
    probabilities: Object.fromEntries(labels.map((l) => [l, 1 / labels.length])),
  };
}

/** Build the provider selected by environment, falling back to the mock. */
export function createProviderFromEnv(): DecisionProvider {
  const explicit = process.env.JEV_PROVIDER?.toLowerCase();
  if (explicit === "mock") {
    return new MockProvider();
  }
  const apiKey = process.env.TYPESAFE_API_KEY;
  if (!apiKey) {
    if (explicit === "jev") {
      throw new Error(
        "JEV_PROVIDER=jev was requested but TYPESAFE_API_KEY is not set. " +
          "Set it in .env or use JEV_PROVIDER=mock for offline runs.",
      );
    }
    return new MockProvider();
  }
  return new JevProvider({
    apiKey,
    ...(process.env.TYPESAFE_BASE_URL ? { baseURL: process.env.TYPESAFE_BASE_URL } : {}),
    ...(process.env.TYPESAFE_DEFAULT_MODEL ? { model: process.env.TYPESAFE_DEFAULT_MODEL } : {}),
  });
}

/** Human-readable label for a question type, used in logs and error messages. */
export function describeAnswerType(answer: unknown): string {
  const type = (answer as { type?: string } | undefined)?.type;
  return type ?? "unknown";
}

/** Re-export so specs can build choice questions without importing the SDK directly. */
export { choice, noul, score } from "@typesafe-ai/sdk";
export type { ChoiceCriteria };
