# Engineering Playbook — Jev + Playwright

Shared design principles and acceptance criteria for specialist Grok Bots working on this repository.

## Domain Ownership
- **jev-bot**: Owns TypeSafe Jev integration, semantic assertions (noul), element choice, goal-driven flows, and failure classification (flake vs genuine).
- Proof must include: Jev decision log (question, answer, probability), Playwright trace or screenshot when UI is involved, and CI green.

## Standing Rules
1. Jev does not invent selectors or generate free-form text. It answers typed questions against a code-built snapshot.
2. Playwright owns navigation, waiting, screenshots, and hard assertions.
3. Confidence thresholds live in code, not inside the model call.
4. Failure classification must return calibrated probabilities and a recommended action (retry / update_test / file_ticket / investigate).
5. One cloud agent per PR stream. Re-use the existing agent for follow-ups.
6. Board-first: write the row in `docs/fleet-board.md` before launching.
7. Human owns merge. Auto-merge only when explicitly enabled for high-confidence, low-blast-radius changes.

## Daily Alignment (ops bot)
Review this playbook, surface any blockers from the fleet board, and reinforce the rules above.

## Postmortem Trigger
If a bot fails to push back on missing proof or accepts a change without Jev probability, route to the operations bot for root-cause analysis and update this playbook.
