# Playwright + Jev Decision Model

Goal-driven end-to-end testing where **Jev** (TypeSafe's `System One` decision model) chooses
the next action, **Playwright** executes it, and your test code makes the pass/fail call.

```
┌──────────────────────────────────────────────────────────────────────┐
│  loop (max N steps)                                             │
│                                                                  │
│  Playwright ──observe──▶ element table + goal + visible text    │
│        │                                                      │
│        ▼                                                      │
│  Jev  ── one request ──▶ Choice: which element?                │
│                          Noul:  is the goal done?               │
│                          Noul:  are we stuck?                   │
│        │                                                      │
│        ▼  (only if confidence clears the gate)                 │
│  Playwright ──click / fill──▶ record step ──▶ next round       │
└────────────────────────────────────────────────────────────────────────┘
        │
        ▼
   Your assertions decide pass/fail. The model never votes.
```

## Why a decision model?

Jev is not a text generator. It cannot write selectors, invent URLs, or produce
pass/fail verdicts. It answers typed questions about a given state and returns
probability distributions:

| Primitive | Question type | Answer |
|---|---|---|
| `choice` | Which of these options? | selected label + `confidence` + per-label probabilities |
| `noul` | Yes or no? | probability of yes (0–1) |
| `score` | Which rubric level? | score + `confidence` + per-level probabilities |

That constraint is the point. The model only ever answers *"which element"* and
*"is it done / are we stuck"*. Everything else — observation, execution, assertions —
stays deterministic, so the tests stay reproducible.

## Quick start

```bash
npm install
npx playwright install chromium
cp .env.example .env      # add TYPESAFE_API_KEY for live Jev runs
npm test
```

The suite runs against a local fixture site, so it needs no network access and
passes with or without an API key.

## Usage

```ts
import { test, expect } from "@playwright/test";
import { createProviderFromEnv, runToGoal } from "../src/index.js";

test("buys the most expensive item", async ({ page }) => {
  await page.goto("/shop.html");

  const result = await runToGoal(
    page,
    {
      objective: "Sign in, select the most expensive product, add it to the cart, and check out.",
      values: { username: "demo_user", password: "demo_pass" },
    },
    { provider: createProviderFromEnv() },
  );

  await expect(page.getByText("Order confirmed")).toBeVisible();
  expect(result.completed).toBe(true);
});
```

See `tests/checkout.spec.ts` for the full pattern, including the scripted fallback
used when no API key is configured.

## How the loop stays deterministic

- Element handles (`el_0`, `el_1`, …) map to exact DOM nodes, so the action the
  model chose is the action that runs.
- Text inputs are filled from `goal.values`, matched by the field's accessible name.
  Jev never invents strings.
- Confidence, completion, and stuck gates are applied in code. A low-confidence
  choice aborts the run instead of clicking.

## Providers

| Provider | When | Behaviour |
|---|---|---|
| `JevProvider` | `TYPESAFE_API_KEY` is set | Live System One decision model |
| `ScriptedProvider` | No key (default in CI) | Follows a named step list; exercises the full loop |
| `MockProvider` | `JEV_PROVIDER=mock` | Fixed answers for unit-style gate tests |

## CI

The workflow runs the scripted path by default. If the `TYPESAFE_API_KEY` secret
is present it also runs against the live model.
