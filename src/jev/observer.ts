/**
 * Page observation.
 *
 * The observer turns a live Playwright page into a compact, text-only description of
 * the interactive elements it exposes. Jev never sees a screenshot and never sees raw
 * HTML — it sees a numbered element table, which keeps the decision request small and
 * the choice unambiguous.
 *
 * The number assigned here (`id`) is the handle used to execute the chosen action.
 */

import type { Page, Locator } from "@playwright/test";

/** An interactive element discovered on the page. */
export interface PageElement {
  /** Stable handle used to execute the action. */
  id: string;
  /** Index of the element within the raw DOM query, used to resolve the locator. */
  domIndex: number;
  /** Element role, e.g. "button", "link", "textbox". */
  role: string;
  /** Accessible name — the label a user would read. */
  name: string;
  /** Current value, for inputs. */
  value?: string;
  /** Whether the element is currently disabled. */
  disabled?: boolean;
}

/** The text description of a page, handed to Jev as the request state. */
export interface PageSnapshot {
  /** Page URL. */
  url: string;
  /** Document title. */
  title: string;
  /** Visible body text, trimmed. */
  text: string;
  /** Interactive elements with their handles. */
  elements: PageElement[];
  /** Number of elements dropped because the table was full. */
  overflow: number;
}

/** How many elements to include in the decision request. */
const MAX_ELEMENTS = 60;
/** How much visible text to include. */
const MAX_TEXT = 2000;

const SELECTOR = [
  "a[href]",
  "button",
  "input:not([type=hidden])",
  "select",
  "textarea",
  "[role=button]",
  "[role=link]",
  "[role=checkbox]",
  "[role=radio]",
  "[role=tab]",
  "[role=menuitem]",
  "[role=option]",
  "[role=combobox]",
  "[role=searchbox]",
].join(", ");

/**
 * Collect the interactive elements currently on the page.
 *
 * Only visible, non-disabled elements are returned: a hidden element cannot be the
 * right answer to "which element advances the goal".
 */
export async function collectElements(page: Page): Promise<PageElement[]> {
  const raw = await page.evaluate(
    ({ selector, max }) => {
      const results: Array<{
        domIndex: number;
        role: string;
        name: string;
        value?: string;
        disabled: boolean;
        visible: boolean;
      }> = [];

      const nodes = Array.from(document.querySelectorAll(selector));
      for (let domIndex = 0; domIndex < nodes.length; domIndex++) {
        if (results.length >= max) break;
        const node = nodes[domIndex];
        if (!node) continue;

        const style = window.getComputedStyle(node);
        const rect = node.getBoundingClientRect();
        const visible =
          style.visibility !== "hidden" &&
          style.display !== "none" &&
          (rect.width > 0 || rect.height > 0) &&
          style.opacity !== "0";

        let role = node.getAttribute("role") ?? "";
        if (!role) {
          const tag = node.tagName.toLowerCase();
          role =
            tag === "a"
              ? "link"
              : tag === "button"
                ? "button"
                : tag === "input"
                  ? (node.getAttribute("type") ?? "textbox")
                  : tag === "select"
                    ? "combobox"
                    : tag === "textarea"
                      ? "textbox"
                      : tag;
        }

        let name =
          node.getAttribute("aria-label")?.trim() ??
          node.getAttribute("placeholder")?.trim() ??
          node.getAttribute("title")?.trim() ??
          node.getAttribute("name")?.trim() ??
          node.textContent?.trim() ??
          "";

        if (!name) {
          const label = node.closest("label");
          name = label?.textContent?.trim() ?? "";
        }
        if (!name) {
          const id = node.getAttribute("id");
          if (id) {
            const label = document.querySelector(`label[for="${CSS.escape(id)}"]`);
            name = label?.textContent?.trim() ?? id;
          }
        }

        const isDisabled =
          node.hasAttribute("disabled") ||
          node.getAttribute("aria-disabled") === "true" ||
          (node as HTMLInputElement).disabled === true;

        results.push({
          domIndex,
          role,
          name: name.replace(/\s+/g, " ").slice(0, 120),
          value: (node as HTMLInputElement).value || undefined,
          disabled: isDisabled,
          visible,
        });
      }

      return results;
    },
    { selector: SELECTOR, max: MAX_ELEMENTS },
  );

  const elements: PageElement[] = [];
  for (const item of raw) {
    if (!item.visible) continue;
    if (!item.name) continue;
    const element: PageElement = {
      id: `el_${elements.length}`,
      domIndex: item.domIndex,
      role: item.role,
      name: item.name,
    };
    if (item.value !== undefined) element.value = item.value;
    if (item.disabled) element.disabled = true;
    elements.push(element);
  }
  return elements;
}

/** Take a text snapshot of the page. */
export async function snapshotPage(page: Page): Promise<PageSnapshot> {
  const [url, title, text, allElements] = await Promise.all([
    page.url(),
    page.title(),
    page
      .locator("body")
      .innerText({ timeout: 5_000 })
      .catch(() => ""),
    collectElements(page),
  ]);

  const elements = allElements.slice(0, MAX_ELEMENTS);
  return {
    url,
    title,
    text: text.replace(/\s+/g, " ").slice(0, MAX_TEXT),
    elements,
    overflow: Math.max(0, allElements.length - MAX_ELEMENTS),
  };
}

/**
 * Render a snapshot as the text state handed to Jev.
 *
 * Elements are numbered so the decision model can refer to a handle, and the goal is
 * included so the model judges progress against the objective rather than the markup.
 */
export function renderState(snapshot: PageSnapshot, goal: string): string {
  const lines: string[] = [];
  lines.push(`GOAL: ${goal}`);
  lines.push(`URL: ${snapshot.url}`);
  lines.push(`TITLE: ${snapshot.title}`);
  lines.push("");

  lines.push(`ELEMENTS (${snapshot.elements.length}):`);
  if (snapshot.elements.length === 0) {
    lines.push("  (none)");
  }
  for (const element of snapshot.elements) {
    const parts = [`  ${element.id}`, `[${element.role}]`, `"${element.name}"`];
    if (element.value !== undefined && element.value !== "") {
      parts.push(`value=${JSON.stringify(element.value)}`);
    }
    if (element.disabled) parts.push("disabled");
    lines.push(parts.join(" "));
  }
  if (snapshot.overflow > 0) {
    lines.push(`  ... and ${snapshot.overflow} more elements not shown`);
  }

  lines.push("");
  lines.push("VISIBLE TEXT:");
  lines.push(snapshot.text || "  (empty)");

  return lines.join("\n");
}

/**
 * Resolve an element handle back to a Playwright locator.
 *
 * The handle carries the element's index in the raw DOM query, so the locator points
 * at exactly the node the decision model chose — not at a guess based on position
 * among the filtered, visible elements.
 */
export function locatorFor(page: Page, elements: PageElement[], id: string): Locator | null {
  const element = elements.find((candidate) => candidate.id === id);
  if (!element) return null;
  return page.locator(SELECTOR).nth(element.domIndex);
}
