/**
 * Goal-driven checkout.
 *
 * The test states *what* should happen, not *how*. Jev picks the next element at each
 * screen, Playwright executes it, and the deterministic assertions below decide
 * pass/fail — the model never gets a vote on whether the test passed.
 *
 * With `TYPESAFE_API_KEY` set, the real Jev model drives the browser. Without it, the
 * run falls back to a scripted provider so the suite stays green offline and in CI.
 */

import { test, expect } from "@playwright/test";
import type { Page } from "@playwright/test";
import {
  ScriptedProvider,
  createProviderFromEnv,
  runToGoal,
  type DecisionProvider,
  type RunResult,
} from "../src/index.js";

const GOAL =
  "Sign in to the shop, select the Aurora Desk Lamp product, add it to the cart, and check out until the order is confirmed.";

const GOAL_VALUES = {
  username: "demo_user",
  password: "demo_pass",
};

/**
 * The fallback decision path used when no API key is configured.
 *
 * It names the elements a competent decision model would pick, in order. The loop
 * mechanics around it are identical to the live path.
 */
const SCRIPTED_STEPS = [
  { element: "Username" },
  { element: "Password" },
  { element: "Sign in" },
  { element: "Select Aurora Desk Lamp" },
  { element: "Add to cart" },
  { element: "Checkout" },
];

function providerFor(): DecisionProvider {
  if (process.env.TYPESAFE_API_KEY) {
    return createProviderFromEnv();
  }
  return new ScriptedProvider(SCRIPTED_STEPS);
}

async function runGoal(page: Page, provider: DecisionProvider): Promise<RunResult> {
  return runToGoal(
    page,
    { objective: GOAL, values: GOAL_VALUES },
    { provider },
  );
}

test.describe("Jev goal-driven checkout", () => {
  test("completes a checkout from a high-level goal", async ({ page }) => {
    await page.goto("/shop.html");

    const result: RunResult = await runGoal(page, providerFor());

    await expect(page.getByText("Order confirmed")).toBeVisible();
    await expect(page.locator("#order-id")).toContainText("Order ID: ORD-");
    await expect(page.locator("#cart-list li")).toHaveCount(1);
    await expect(page.locator("#cart-list li")).toContainText("Aurora Desk Lamp");
    await expect(page.locator("#cart-total")).toContainText("Total: $");

    expect(result.completed, result.stopReason ?? "").toBe(true);
    expect(result.steps).toBeGreaterThan(0);
  });

  test("records a readable trace of every decided step", async ({ page }) => {
    await page.goto("/shop.html");

    const result = await runGoal(page, providerFor());

    expect(result.trace.length).toBeGreaterThan(0);
    for (const step of result.trace) {
      expect(step.element.name.length).toBeGreaterThan(0);
      expect(["click", "fill"]).toContain(step.action);
      expect(step.confidence).toBeGreaterThanOrEqual(0);
      expect(step.confidence).toBeLessThanOrEqual(1);
    }
  });
});
