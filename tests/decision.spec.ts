/**
 * Decision gate behaviour.
 *
 * These tests exercise the confidence, stuck, and completion gates with controlled
 * providers. They do not depend on a live model.
 */

import { test, expect } from "@playwright/test";
import {
  MockProvider,
  ScriptedProvider,
  runToGoal,
} from "../src/index.js";

test.describe("decision gates", () => {
  test("a low-confidence choice stops the run instead of clicking", async ({ page }) => {
    await page.goto("/shop.html");

    const provider = new MockProvider({
      nextElement: {
        type: "choice",
        choice: "el_0",
        confidence: 0.1,
        probabilities: { el_0: 0.1, el_1: 0.1 },
      },
      goalComplete: { type: "noul", noul: 0.02 },
      stuck: { type: "noul", noul: 0.02 },
    });

    await expect(
      runToGoal(page, { objective: "Sign in" }, { provider, thresholds: { minConfidence: 0.6 } }),
    ).rejects.toThrow(/confidence/i);

    await expect(page.locator("#step-login")).toBeVisible();
  });

  test("a stuck signal ends the run with a reason", async ({ page }) => {
    await page.goto("/shop.html");

    const provider = new MockProvider({
      goalComplete: { type: "noul", noul: 0.01 },
      stuck: { type: "noul", noul: 0.95 },
    });

    const result = await runToGoal(page, { objective: "Sign in" }, { provider });

    expect(result.completed).toBe(false);
    expect(result.stopReason).toMatch(/stuck/i);
    expect(result.steps).toBe(0);
  });

  test("a high completion probability ends the run immediately", async ({ page }) => {
    await page.goto("/shop.html");

    const provider = new MockProvider({
      goalComplete: { type: "noul", noul: 0.99 },
      stuck: { type: "noul", noul: 0.01 },
    });

    const result = await runToGoal(page, { objective: "Anything" }, { provider });

    expect(result.completed).toBe(true);
    expect(result.steps).toBe(0);
  });

  test("the run stops at the step limit rather than looping forever", async ({ page }) => {
    await page.goto("/shop.html");

    const provider = new ScriptedProvider([
      { element: "Sign in", keepsGoing: true },
      { element: "Sign in", keepsGoing: true },
      { element: "Sign in", keepsGoing: true },
      { element: "Sign in", keepsGoing: true },
      { element: "Sign in", keepsGoing: true },
    ]);

    const result = await runToGoal(
      page,
      { objective: "Never completes" },
      { provider, thresholds: { maxSteps: 3 } },
    );

    expect(result.completed).toBe(false);
    expect(result.stopReason).toMatch(/step limit/i);
    expect(result.steps).toBeLessThanOrEqual(3);
  });
});
