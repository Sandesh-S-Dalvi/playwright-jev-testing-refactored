/**
 * Live-provider contract tests.
 *
 * These verify the request the JevProvider sends and the way it maps the response
 * back into typed answers. A fake transport stands in for the API, so the contract
 * is checked without a key or a network call.
 */

import { test, expect } from "@playwright/test";
import { JevProvider, choice, noul } from "../src/index.js";

interface CapturedRequest {
  url: string;
  body: Record<string, unknown>;
  headers: Record<string, string>;
}

function fakeTransport(response: unknown) {
  const captured: CapturedRequest[] = [];

  const fetchImpl = async (input: string | URL | Request, init?: RequestInit) => {
    const url = typeof input === "string" ? input : input.toString();
    const headers: Record<string, string> = {};
    const rawHeaders = init?.headers;
    if (rawHeaders && typeof rawHeaders === "object" && !Array.isArray(rawHeaders)) {
      for (const [key, value] of Object.entries(rawHeaders as Record<string, string>)) {
        headers[key] = value;
      }
    }
    const body = init?.body ? JSON.parse(String(init.body)) : {};
    captured.push({ url, body: body as Record<string, unknown>, headers });
    return new Response(JSON.stringify(response), {
      status: 200,
      headers: { "content-type": "application/json" },
    });
  };

  return { captured, fetchImpl };
}

test.describe("JevProvider contract", () => {
  test("sends the state and questions to the API and maps the answers back", async () => {
    const { captured, fetchImpl } = fakeTransport({
      model: "jev-latest",
      answers: {
        nextElement: {
          type: "choice",
          choice: "el_2",
          confidence: 0.88,
          probabilities: { el_0: 0.05, el_1: 0.07, el_2: 0.88 },
        },
        goalComplete: { type: "noul", noul: 0.14 },
        stuck: { type: "noul", noul: 0.03 },
      },
      usage: { input_tokens: 120, output_tokens: 9 },
    });

    const provider = new JevProvider({
      apiKey: "test-key",
      baseURL: "https://api.example.test",
      model: "jev-latest",
      fetch: fetchImpl as unknown as typeof fetch,
    });

    const result = await provider.ask("GOAL: sign in and check out", {
      nextElement: choice("Which element advances the goal?", {
        el_0: 'textbox "Username"',
        el_1: 'textbox "Password"',
        el_2: 'button "Sign in"',
      }),
      goalComplete: noul("Is the goal complete?", {
        true: "The order is confirmed.",
        false: "Not yet.",
      }),
      stuck: noul("Are we stuck?", {
        true: "No progress possible.",
        false: "Progress is still possible.",
      }),
    });

    expect(captured).toHaveLength(1);
    const req = captured[0]!;
    expect(req.url).toContain("api.example.test");
    expect(req.body).toHaveProperty("state");
    expect(req.body).toHaveProperty("questions");

    expect(result.model).toBe("jev-latest");
    expect(result.answers.nextElement.choice).toBe("el_2");
    expect(result.answers.nextElement.confidence).toBeCloseTo(0.88);
    expect(result.answers.goalComplete.noul).toBeCloseTo(0.14);
    expect(result.answers.stuck.noul).toBeCloseTo(0.03);
  });
});
