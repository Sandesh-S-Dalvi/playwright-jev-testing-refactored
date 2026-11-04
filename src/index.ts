/**
 * Public API for the Jev-driven Playwright testing helper.
 */

export {
  DEFAULT_THRESHOLDS,
  JevProvider,
  MockProvider,
  ScriptedProvider,
  createProviderFromEnv,
  choice,
  noul,
  score,
  type Answer,
  type DecisionProvider,
  type DecisionThresholds,
  type QuestionKey,
  type ScriptedStep,
} from "./jev/provider.js";

export {
  collectElements,
  locatorFor,
  renderState,
  snapshotPage,
  type PageElement,
  type PageSnapshot,
} from "./jev/observer.js";

export {
  GoalNotReachedError,
  LowConfidenceError,
  runToGoal,
  type ActionKind,
  type Goal,
  type RunOptions,
  type RunResult,
  type Step,
} from "./jev/runner.js";

export { createJevAgent } from "./agent.js";
export type { JevAgent, JevAgentOptions } from "./agent.js";
