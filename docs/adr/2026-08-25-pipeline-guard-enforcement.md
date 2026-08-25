# Turning the pipeline guard layer on

**Status:** Accepted
**Date:** 2026-08-25

## Context

`delivery.json` landed in #392. By the delivery contract's single discriminator
(`docs/PIPELINE-CONTRACT.md` §2 — *the pipeline is configured for a project if and
only if `delivery.json` exists at the repo root*), that made TodoClaw a
**pipeline-configured** project.

The hook contained **none** of the six pipeline guards the contract defines. The
config asserted an enforcement that did not exist.

This was not merely theoretical. The first real pipeline run (TOD-90, PR #395)
refused an out-of-scope action correctly — but only because the `/work` skill
checks the pin as part of its own protocol. That is a well-behaved skill, not a
binding guard. Any session that skipped `/work`, and every dispatched session, was
unbound while the config claimed otherwise. A skill is a prompt; a prompt is not a
security boundary.

## Decision

Port the six pipeline-scoped guards into `.claude/hooks/pre-tool-use.py` —
`pin-binding`, `ticket-branch`, `scope-fence`, `lifecycle-label`, `self-approval`,
`telemetry-required` — and turn enforcement on.

The guards are ported into **this repo's structure**, not copied from the kit. The
kit's hook (~1690 lines) is a divergent superset, not a newer version of the same
file: different helpers, naming and layout. Replacing our ~607-line hook wholesale
would have swapped a working, project-tuned suite — with a 150-case battery behind
it — for one never tuned here. Only the guard mechanics were taken.

### Four properties that had to survive the port

1. **Optionality.** Every pipeline guard is gated on the one discriminator, and
   absence is a clean no-op — `_pipeline_guards` returns before parsing anything,
   before touching git or the filesystem. *Off* must never be conflated with
   *broken*: a fail-closed guard whose precondition is missing would block every
   `Edit`/`Write` in a project that never opted in, and because this file is
   self-protected the agent could not repair it. Recovery would need a human at a
   terminal. Six battery cases pin this.

2. **Anchoring.** Config *values* come from the **committed copy on the default
   branch**, never the working tree — the working-tree copy lives inside the
   agent's own worktree, so trusting it would let a session raise its own budgets
   or blank the state ID a guard matches on. The pin is read from **outside** the
   worktree. Not the branch name, not a PR body, not an environment variable: a
   config a session can rewrite is a pin a session can plant. A `dispatch.pinsRoot`
   that resolves *inside* the repo is treated as a broken config for exactly this
   reason.

3. **Fail direction.** Write-blocking guards fail **closed**, including on an
   *expired* pin in ticket mode: a lapsed binding is broken, unlike one never
   claimed, and reading an expiry as "unpinned" would make simply **waiting** an
   escape. Checks that merely *withhold* autonomy from an unpinned session fail
   **open**, so a human's ad-hoc session in a configured repo is never bricked.

4. **Battery coverage.** Block *and* allow cases for each guard, plus error paths
   (malformed config, malformed pin, unknown version, blank label-ID map,
   wrong-type `pinsRoot`). 245 cases total, 95 new. 51 of the new cases fail
   against the pre-change hook, which is what makes them evidence rather than
   decoration.

### `telemetry-required` is deliberately half-enforced

Its counting half — "a terminal run posts exactly one valid telemetry block" —
belongs to the §8 safe-outputs validator, which runs **out of session**. That
validator is not ported here: TodoClaw has the schemas but no requests-file
emitter. The kit's hook does not implement this guard either, and its battery has
no cases for it.

A PreToolUse hook structurally cannot observe "the turn ended without telemetry" —
that is Stop-time. We considered adding a Stop-hook check and rejected it: a
fail-closed telemetry guard in a repo with no way to *emit* telemetry would brick
every session, in a repo that ships daily. Inventing a hook mechanic the contract
assigns elsewhere would also be the "second shape for the same structure" failure
the contract warns about.

What the hook **does** hold is the half it can: the reporting **channel** stays
open (a comment on the pinned ticket, including one whose target it cannot
resolve, is never blocked) and cannot be redirected at another ticket. Five
battery cases pin it. The counting half is tracked as unported.

### Three false-positive fixes, batched in

Each apply of a self-protected file is a human interrupt, so three known bugs ride
along rather than costing three more:

1. **`sed` read matched as a rewrite.** `sed`/`perl` now require an in-place flag,
   and the Bash arm is **scoped to this checkout** — reading another repo's
   `.claude/hooks/**` in a scratch clone is not self-edit. A *relative* path stays
   protected wherever it resolves, so `../../.claude/hooks/x` is not an escape.
   The interpreter arm (`python`/`node`/`ruby` naming a protected file) was briefly
   removed and then **restored**: an interpreter can rewrite a file whatever flags
   it was launched with, and the scoping fix already addresses the reported false
   positives without weakening it.
2. **Prose scanned as operations.** `_strip_prose` moved to module scope and now
   runs at **four** sites instead of one. A PR body quoting `.env.local` no longer
   trips the secret-file guard. Heredoc bodies are still *not* stripped — doing so
   would blind the guard to a destructive command passed through `bash` on stdin —
   so long text goes via `--body-file`. (This ADR could not itself be written with
   a shell heredoc, for exactly that reason.)
3. **Local dispatch was self-invocable.** `scripts/pipeline_dispatch_local.py`
   refuses to run in an agent environment, but its own docstring calls that
   tamper-*evident*, not tamper-proof: a session runs as the same user and can
   scrub an environment variable. Invoking it is now blocked in the hook, where the
   model cannot reach. `--selftest` and reads stay allowed.

## Consequences

**For a human working here by hand: nothing changes.** Verified against this
repo's real `delivery.json` with no pin — ordinary edits, `npm test`, `git commit`,
`gh pr create`, even editing a CI workflow, all still pass.

**Two things change for everyone:** moving a ticket to `ready` is blocked
unconditionally, and `delivery.json` must stay valid or mutating calls fail closed
(editing `delivery.json` itself always stays allowed, so the repo cannot be taken
hostage by its own config).

**For a dispatched session:** the branch must carry the ticket ID; `riskPaths` are
refused; it cannot set its own `agent:*` labels, rewrite its own acceptance
criteria, or write to another ticket.

### Costs accepted

- **`PROJECT_ROOT` is now realpath'd**, because the pin key is
  `sha256(PROJECT_ROOT)` and the dispatcher keys on `sha256(realpath(root))`. If
  the two spellings disagreed, every pin would read as absent — which in ticket
  mode fails closed. The path-comparison helpers realpath both sides so a symlinked
  checkout cannot make an in-project path look foreign (a fail-*open* regression).
- **This repo protects the entire `.claude/hooks/` directory**, where the kit
  protects only three named scripts. So `test_hooks.py` and the hooks `README.md`
  are human-apply too, and this change needed a three-file batch. Narrowing to the
  kit's named-file list would make battery edits frictionless, but the kit
  compensates with a protected-label guard (blocking a session from applying its
  own `hooks-change` label) that TodoClaw does not have. Loosening without that
  guard would be a net weakening, so the strict posture stays — as a separate
  decision, not a side effect of this one.
- **`scripts/pipeline_dispatch_local.py --selftest` still fails 4 assertions**,
  all about `templates/workflows/pipeline-dispatch.yml`, which this repo does not
  have (tier-1 GitHub Actions dispatch is unported). The two assertions about *this
  hook* — the pin-key derivation and the `_CONFIG_REFS` order — now pass. The
  selftest therefore still cannot be CI-wired; that waits on the tier-1 port.

## Alternatives rejected

- **Copy the kit's hook wholesale.** Rejected: it is a divergent superset, and the
  swap would discard project-tuned guards and their battery.
- **Ship the guards without the false-positive fixes.** Rejected: each
  self-protected apply is a human interrupt; batching costs one instead of four.
- **Enforce `telemetry-required` at Stop time.** Rejected: no emitter exists here,
  so it would brick every session — the exact bootstrap-order failure the
  fail-closed doctrine already learned once.
