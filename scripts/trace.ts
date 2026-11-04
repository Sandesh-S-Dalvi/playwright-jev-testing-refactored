/**
 * Debug harness: print every decision round of a goal-driven run.
 *
 * Usage: npx tsx scripts/trace.ts
 */

import { chromium } from "@playwright/test";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { ScriptedProvider, renderState, runToGoal, snapshotPage } from "../src/index.js";

const here = path.dirname(fileURLToPath(import.meta.url));
const fixture = `file://${path.join(here, "../tests/fixtures/shop.html")}`;

const SCRIPT = [
  { element: "Username" },
  { element: "Password" },
  { element: "Sign in" },
  { element: "Select Aurora Desk Lamp" },
  { element: "Add to cart" },
  { element: "Checkout" },
];

async function main() {
  const browser = await chromium.launch();
  const page = await browser.newPage();
  await page.goto(fixture);

  const provider = new ScriptedProvider(SCRIPT);

  const result = await runToGoal(
    page,
    {
      objective: "Sign in, pick the Aurora Desk Lamp, add to cart, and check out.",
      values: { username: "demo_user", password: "demo_pass" },
    },
    {
      provider,
      thresholds: { minConfidence: 0.5, minCompletion: 0.75, maxSteps: 12 },
      onDecision: (state, snapshot) => {
        console.log("\n--- DECISION STATE ---");
        console.log(renderState(snapshot, "debug"));
        void state;
      },
    },
  );

  console.log("\n=== TRACE ===");
  for (const step of result.trace) {
    console.log(
      `[${step.index}] ${step.action.toUpperCase()} "${step.element.name}" ` +
        `conf=${step.confidence.toFixed(2)} done=${step.completionProbability.toFixed(2)}`,
    );
    console.log(`     -> ${step.resultText.slice(0, 120)}`);
  }
  console.log("\ncompleted:", result.completed);
  console.log("stopReason:", result.stopReason ?? "(none)");

  const snapshot = await snapshotPage(page);
  console.log("\nfinal elements:", snapshot.elements.map((e) => `${e.id}:${e.role}:${e.name}`).join("\n  "));

  await browser.close();
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
