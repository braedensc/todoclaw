# ADR 2026-09-06 — Sessions are bound by Linear delegation, not by a pin file

**Date:** 2026-09-06 · **Post-launch** (security boundary) · **Status:** Accepted · narrows [ADR 2026-08-25](2026-08-25-pipeline-guard-enforcement.md) for the `local-daemon` backend

## What changed

`delivery.json` sets `dispatch.backend: "local-daemon"`. Cyrus dispatches from the
operator's machine, and it binds a session to a ticket **by a named person delegating that
ticket in Linear** — it writes no pin file at all.

The pin was never the point; *a binding the session cannot forge* was. A delegation is also
a value a session cannot write for itself, so the doctrine holds by a different route. What
it does not carry is the pin's other cargo: the budget, the mode, and the dispatch-time
snapshot of the acceptance criteria.

## Which guards still hold

`.claude/hooks/pre-tool-use.py` reads a pin from outside the worktree and, by the contract's
fail direction, guards that merely *withhold* autonomy fail **open** when no pin is present.
That branch was designed for a human working ad hoc in a configured repo, so that the repo is
never bricked. **An unpinned Cyrus session is indistinguishable from that case to the hook.**

| Guard | On the live `local-daemon` lane |
|---|---|
| `pin-binding` | Withholds nothing without a pin — **fails open** |
| `ticket-branch` | Needs a pinned ticket id — **inactive** |
| `scope-fence` | `if pin:`-gated, both the Edit/Write arm and the Bash arm — **does not hold** |
| `lifecycle-label` | Pinned-only — **does not hold** |
| `self-approval` | Unconditional on `configured` — **holds** |
| `telemetry-required` | Half-enforced here by design; the counting half is the safe-outputs validator, unported — **channel only** |

**This is documented, intended behaviour, not a bug, and the fix is not in the hook.** A
fail-closed guard keyed on pin absence would brick every ad-hoc session in the repo. The
guards that still hold on this lane are the unconditional ones plus the layers underneath:
the self-edit and config-anchor Bash arms, the protected-label guard, branch protection, and
CI — none of which read a pin.

The three standing guards that *do* read one are unaffected in their own right: the tier-0
local dispatcher (`scripts/pipeline_dispatch_local.py`) still writes a real pin, the hook
still reads it, and `dispatch.pinsRoot` is still validated on every write. **None of the pin
machinery is dead — it is unused by one backend.**

## Consequences

- Budgets and autonomy tiers are contract-defined and enforced by the `github-actions`
  backend; on this lane they are unenforced (KIT-17). `budgets.maxMinutes` is the only cap
  with teeth.
- `.github/workflows/pipeline-safe-outputs.yml` requires `pinned_ticket_id` and
  `pinned_dispatch_id`. Nothing on this lane produces either, so it is unreachable as well
  as inert.
- `dispatch.labelTrigger: "agent:queued"` describes the CI dispatcher's queue-by-label
  model. It stays because the schema requires it and `check_delivery_config.py` validates
  it — not because it describes how work is queued today.
- Re-keying the binding so a delegation carries a budget and a criteria snapshot is
  [KIT-18](https://linear.app/braedenclaw/issue/KIT-18); it is open and its options point
  three different directions.

## Alternatives rejected

**Have Cyrus write a pin.** Plausible, and it is one of KIT-18's live options — but it is an
upstream change to the daemon, not a todoclaw decision, and it would need the pin's budget
and snapshot fields populated to be worth anything.

**Make the pinned-only guards fail closed.** Bricks every human session in a configured
repo, which is the exact failure the fail-open direction exists to prevent.

## Where the rest of it is written down

`docs/PIPELINE-ACTIVATION.md` is todoclaw's operational record of what is active and why —
including why `pipeline-dispatch.yml` is held and why review was staged again (TOD-112).
`docs/PIPELINE-CONTRACT.md` and `schemas/` are vendored byte-identical from
claude-project-kit; their unconditional "the dispatcher writes the pin" phrasing is corrected
upstream in kit PR #74 and arrives here by re-sync, not by hand-editing.
