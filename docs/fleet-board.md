# Fleet Board — playwright-jev-testing-refactored

Externalized state for long-running Grok Bot specialist agents (adapted from the Grok Bot for Engineering playbook).

**Stages**: Working → Watching 1/3 → Watching 2/3 → Watching 3/3 → Ready for review → Done (merged) | Holding | Blocked | Cancelled

**Rules**:
- Board-first: create the row (Stage=Working) before launching a cloud agent.
- One cloud agent per PR stream.
- Human owns every merge unless high-confidence + low-blast-radius is explicitly allowed.
- Last Checked is UTC timestamp of the last 30-minute sweep.
- Proof (screenshots, CI, Jev decision logs) lives in the PR; this board stores links and stage only.

| Task | Owner | Stage | PR | Cloud Agent | Last Checked (UTC) | Notes |
|------|-------|-------|----|-------------|--------------------|-------|
| Bootstrap Jev semantic assertion example | jev-bot | Working | — | — | — | Initial placeholder — replace with real task |

---

## Watcher Instructions (for the 30-minute routine)

1. Read this file.
2. For each row in Working or Watching* stages:
   - Inspect the linked PR (if any) for failing CI, Bugbot/security findings, merge conflicts.
   - If issues: follow up with the cloud agent and reset Stage to Working.
   - If clean for the required consecutive ticks: advance the stage.
3. Update Last Checked and commit the change.
4. Do not auto-merge unless the human has explicitly enabled it for low-blast-radius items.

## Related Files
- Playbook / design principles: `docs/engineering-playbook.md` (create if needed)
- Domain: TypeSafe Jev as intelligence layer for Playwright (semantic assertions, element choice, goal-driven flows, failure classification).
