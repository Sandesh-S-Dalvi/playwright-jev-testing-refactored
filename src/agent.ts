/**
 * A small convenience wrapper that binds a provider and thresholds to a page.
 *
 * `createJevAgent(page)` gives you a `run(goal)` method without threading
 * provider and threshold configuration through every call site.
 */

import type { Page } from "@playwright/test";
import {
  DEFAULT_THRESHOLDS,
  createProviderFromEnv,
  type DecisionProvider,
  type DecisionThresholds,
} from "./jev/provider.js";
import {
  runToGoal,
  type Goal,
  type RunOptions,
  type RunResult,
  type Step,
} from "./jev/runner.js";
import type { PageSnapshot } from "./jev/observer.js";

export interface JevAgentOptions {
  /** The decision provider. Defaults to the environment-selected provider. */
  provider?: DecisionProvider;
  /** Confidence and step thresholds. */
  thresholds?: Partial<DecisionThresholds>;
  /** Called after each executed step. */
  onStep?: (step: Step) => void;
  /**
   * Called before each decision round.
   * Receives the rendered state string and the raw snapshot.
   */
  onDecision?: (state: string, snapshot: PageSnapshot) => void;
}

/** A page-bound decision agent. */
export interface JevAgent {
  run(goal: Goal): Promise<RunResult>;
  readonly providerName: string;
}

/** Bind a decision agent to a page. */
export function createJevAgent(page: Page, options: JevAgentOptions = {}): JevAgent {
  const provider = options.provider ?? createProviderFromEnv();
  return {
    providerName: provider.name,
    async run(goal: Goal): Promise<RunResult> {
      const runOptions: RunOptions = {
        provider,
        thresholds: { ...DEFAULT_THRESHOLDS, ...options.thresholds },
        ...(options.onStep ? { onStep: options.onStep } : {}),
        ...(options.onDecision
          ? { onDecision: (state, snapshot) => options.onDecision!(state, snapshot) }
          : {}),
      };
      return runToGoal(page, goal, runOptions);
    },
  };
}
