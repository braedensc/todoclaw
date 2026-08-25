# Pipeline activation — the human checklist

Everything in `templates/workflows/` is **inert**. GitHub only runs a workflow that
lives in `.github/workflows/`, so a file staged here does nothing at all until it
is moved.

## What is active right now

| Active in `.github/workflows/` | Still staged in `templates/workflows/` |
|---|---|
| `pipeline-safe-outputs.yml` (TOD-106) | `pipeline-dispatch.yml` |
| `pipeline-failure-alert.yml` (TOD-106) | `pipeline-bounce.yml` |
| `pipeline-review.yml` (TOD-109) | `pipeline-telemetry.yml` |
| | `pipeline-auto-approve.yml` |
| | `pipeline-auto-merge.yml` |

**Steps 1 and 2 did not start anything moving.** `pipeline-safe-outputs.yml` is
`workflow_call` only — it runs when another workflow calls it and never on its
own. Until a caller is activated it is a resolvable path and nothing more; that
inertness is exactly why it and the failure alert were the safe pair to turn on
first.

**`pipeline-review.yml` (TOD-109) is the first activation with visible
behaviour** — and the first that spends money. It is also the first *caller* of
safe-outputs, so step 1 stops being theoretical here.

**`pipeline-dispatch.yml` is deliberately held, not merely next in line.** It *is*
the `github-actions` dispatcher, and `dispatch.backend` is now `local-daemon` —
Cyrus dispatches from the operator's machine. Activating it would put a second
dispatcher on the same queue; it would also just fail, since the workflow asserts
the backend before loading state (step 4 below has the mechanism). Do not work
through the step order below as if step 4 were simply next. Bounce, telemetry,
auto-approve and auto-merge remain staged on their own merits.

## The activation boundary — reviewed, not forbidden

The rule here used to be *an agent may not `git mv` one of these into
`.github/workflows/`*, enforced by a CI step that failed if **any** pipeline
workflow was active. The reason was that the repository secrets did not exist
yet, and a half-wired active workflow is worse than an inert one — it fires,
fails, and buries the reason in a log nobody is reading.

The GitHub App, `PIPELINE_APP_ID`, `PIPELINE_APP_KEY` and `ANTHROPIC_API_KEY` now
exist, so that condition is gone and the rule is relaxed (TOD-106):

> **An agent may prepare an activation. A human reviews and merges it.**

The gate that always mattered — a person reading the diff and pressing merge — is
unchanged. What replaced the blanket refusal is an **allowlist**, in
`Pipeline contract validators (static)` → *Every active pipeline workflow is on the
allowlist*. Activating a workflow means two things in the same PR: the `git mv`,
**and** its filename added to that list.

Be clear about what the allowlist does. It does **not** stop an agent activating
something — nothing in CI can, since whatever runs `git mv` can also add the line.
What it guarantees is that activation cannot be *quiet*: it always surfaces as an
explicit added line in a diff, next to the move, where a reviewer sees it. The
list is also the standing record of what is intentionally live, so it is checked
both ways — naming a workflow that is not active fails too, rather than lingering
as a stale entry. `.github/workflows/**` is in `autonomy.riskPaths`, so an
activation trips the scope fence as well; that second signal is expected.

> **Where the reference text lives.** Several of these workflows print
> `see docs/AUTONOMY.md` in their warnings. That document is part of the kit and
> was **not** ported here — this file is todoclaw's equivalent. The workflows are
> kept byte-identical to upstream on purpose (so `/sync-kit` can tell a real drift
> from a reformat), so the stale pointer is left in the file rather than patched out.
>
> **Activation must not change a file's formatting ownership.** `.prettierignore`
> exempts `templates/workflows/`, so for a while activation quietly moved a
> workflow *into* Prettier's scope — and a reformatted file can no longer be
> compared byte-for-byte against upstream, which is exactly how `/sync-kit` tells
> a real drift from a cosmetic one. That every template happens to be
> Prettier-clean today is luck, not a property; the first re-sync of a workflow
> that is not clean would have had it reformatted on the way in.
>
> Fixed by extending `.prettierignore` with `.github/workflows/pipeline-*.yml`
> (TOD-108), scoped to the vendored files only — the rest of `.github/workflows/`
> is todoclaw's own and stays under Prettier. **Every future activation must leave
> the file's formatting owner unchanged across the `git mv`**, and confirm it in
> the same PR. If a vendored workflow really is misformatted, fix it upstream in
> the kit rather than reformatting on the way in.
>
> Because that entry is a **glob**, a workflow named `pipeline-*.yml` is already
> covered and needs no new line — TOD-109 activated `pipeline-review.yml` without
> touching `.prettierignore`. Check rather than assume, since a passing
> `npm run format` proves nothing on a file that was already clean:
>
> ```bash
> npx prettier --file-info .github/workflows/<file>   # want: "ignored": true
> ```
>
> A future activation of a file that does *not* match `pipeline-*` — or any
> vendored file arriving under a different name — does still need its own entry.

---

## Step 0 — the push credential, before anything else

**This is not optional and it is not a tier.** Set it up first, or the pipeline
will run sessions that produce pull requests nothing ever looks at.

GitHub deliberately **does not create workflow runs from events triggered by
`GITHUB_TOKEN`**. A session that pushes its branch and opens its PR with the
default token fires no `pull_request` event and no `push` event. So
`pipeline-review.yml` never runs, **CI never runs**, and because
`pipeline-bounce.yml` and `pipeline-auto-merge.yml` trigger on `workflow_run`,
they never fire either. The entire review → bounce → merge half of the pipeline
is silently dead, and the only symptom is that PRs appear and nothing ever
happens to them.

The dispatcher and the bounce workflow therefore push under a **different
identity**, and both refuse to start (green, with a warning) until one exists.

**Option A — a GitHub App (preferred).**

1. Settings → Developer settings → GitHub Apps → **New GitHub App**. Name it
   something like `todoclaw-pipeline`. Uncheck *Webhook → Active*.
2. Repository permissions — grant exactly these two and nothing else:
   - **Contents: Read and write** (push the ticket branch)
   - **Pull requests: Read and write** (open the PR)
3. **Install it on `braedensc/todoclaw` only.**
4. Generate a private key. It downloads as a `.pem`.
5. Repo → Settings → Secrets and variables → Actions:
   - Variable `PIPELINE_APP_ID` = the App's ID
   - Secret `PIPELINE_APP_KEY` = the entire contents of the `.pem`, newlines included

The App is its own identity: its events trigger workflows, it can be uninstalled
in one click, and its blast radius is two permissions on one repository.

**Option B — a fine-grained PAT (fallback).** Scoped to **this repository only**,
with *Contents: Read and write* and *Pull requests: Read and write*, stored as the
secret `PIPELINE_PAT`. The dispatcher logs a warning when it uses this path, and
the reason is worth repeating: a PAT carries **your** identity, so every pipeline
commit is attributed to you. A classic (non-fine-grained) PAT with `repo` scope
grants write access to every repository you can reach — do not use one here.

**What it does not buy the agent.** Nothing here lets a session merge. `gh pr merge`
is hook-blocked in every form, and the platform-side gate is branch protection.
Grant the App or PAT nothing beyond the two permissions above — in particular not
*Administration* or *Workflows* — and branch protection stays outside its reach.

---

## What each workflow needs

Secrets and variables both live under **Settings → Secrets and variables → Actions**.

todoclaw's `delivery.json` sets `auth.review` to `api-key`, so the model credential
for every workflow in the table below is **`ANTHROPIC_API_KEY`** — they all run in
GitHub Actions, where no interactive credential exists.

`auth.scheduled` is **`subscription`**, because the unattended lane is no longer a
workflow: `dispatch.backend` is `local-daemon`, and a daemon starts its sessions
under `CLAUDE_CODE_OAUTH_TOKEN` on the operator's own machine. That field only
*describes* which credential a lane uses — it configures nothing — so the secret
lives wherever the daemon runs, not in this repository.

| Workflow | Trigger | Secrets | Variables |
|---|---|---|---|
| `pipeline-safe-outputs.yml` | `workflow_call` (never standalone) | `LINEAR_API_KEY` | — |
| `pipeline-failure-alert.yml` | `workflow_run` (watches `CI`, `DB Backup`) | none | — |
| `pipeline-review.yml` | `pull_request`, manual | `ANTHROPIC_API_KEY`, `LINEAR_API_KEY` | `PIPELINE_REVIEW_MODEL` (opt) |
| `pipeline-dispatch.yml` | cron `*/15`, manual, `repository_dispatch` | `LINEAR_API_KEY`, `ANTHROPIC_API_KEY`, **push credential** | `PIPELINE_APP_ID`, `PIPELINE_MODEL` (opt), `PIPELINE_DISPATCH_ENABLED` (kill switch) |
| `pipeline-bounce.yml` | `workflow_run`, manual | `LINEAR_API_KEY`, `ANTHROPIC_API_KEY`, **push credential** | `PIPELINE_APP_ID`, `PIPELINE_MODEL` (opt) |
| `pipeline-telemetry.yml` | cron `40 */6`, manual | `LINEAR_API_KEY`, `PIPELINE_TELEMETRY_DSN` | — |
| `pipeline-auto-approve.yml` | cron `17 * * * *`, manual | `LINEAR_API_KEY` | `PIPELINE_AUTO_APPROVE_ENABLED` must be exactly `"true"` |
| `pipeline-auto-merge.yml` | `workflow_run`, `pull_request`, manual | `LINEAR_API_KEY` | `PIPELINE_AUTO_MERGE_ENABLED` must be exactly `"true"` |

Two config facts about **this** repo, both of which mean "activating the file is
not the same as switching the behaviour on":

- **`autonomy.autoMergeMaxLines` is `0`**, which `check_auto_merge.py` reads as
  *auto-merge is switched off* — no PR qualifies at any size. Activating
  `pipeline-auto-merge.yml` changes nothing until that number is raised
  deliberately.
- **`delivery.json` has no `telemetry` block**, so `pipeline-telemetry.yml` exits 0
  doing nothing even once activated and given a DSN. Add the block first, or the
  workflow is decoration.

Scheduled workflows only run from the **default branch**, so a cron takes effect
once merged to `main`, not on the activating branch. Use *Actions → Run workflow*
to exercise one before then.

---

## Recommended activation order

Activate one at a time and let it run once before moving on. Each command is the
`git mv` that turns the file on; commit it on a branch and open a PR as usual —
**and add the filename to the CI allowlist in the same PR**, or the
*Every active pipeline workflow is on the allowlist* step fails.

**1. Safe outputs — first, always.** ✅ **Active** (TOD-106)

```bash
git mv templates/workflows/pipeline-safe-outputs.yml .github/workflows/pipeline-safe-outputs.yml
```

This is the piece that actually moves tickets, and it is a **reusable**
(`workflow_call`) workflow that dispatch, review and bounce all reference as
`./.github/workflows/pipeline-safe-outputs.yml`. If it is not present at that path,
those three fail to resolve their called workflow. It also holds the Linear key so
the agent job never does: sessions emit *write-requests* to a file, and this job
validates them against the dispatcher-pinned ticket ID before executing any. That
split is what makes "the agent cannot move its own ticket" structural instead of a
prompt instruction. Needs `LINEAR_API_KEY`.

Because it is `workflow_call` only, **activating it on its own changes no
observable behaviour** — see *What is active right now* above. If `LINEAR_API_KEY`
is not set yet, nothing breaks in the meantime; the key is only read once a caller
exists. Confirm it is set before activating step 3 or 4.

**2. Failure alert — free, and it is how you find out the rest broke.** ✅ **Active** (TOD-106)

```bash
git mv templates/workflows/pipeline-failure-alert.yml .github/workflows/pipeline-failure-alert.yml
```

No secrets at all. Turn it on early so a later activation that fails is visible.

**Watch list: `'CI'` and `'DB Backup'`** — corrected in TOD-108. It *shipped*
watching `'Deploy (prod)'`, which todoclaw's own `deploy-failure-alert.yml`
already watched. Both open-or-comment on an issue keyed by an exact title match,
and their titles differ (`🚨 Production deploy is failing` vs
`🚨 Deploy (prod) is failing on main`), so they could not dedupe against each
other: one failed deploy meant two issues and two notifications.

**Prod deploys are deliberately excluded here.** `deploy-failure-alert.yml` was
purpose-built for them — its issue body names the likely causes and points at the
*Apply migrations to prod* step — so it keeps that job, and this workflow covers
what nothing else did:

| Watched | Why it needs an alert |
|---|---|
| `CI` (`ci.yml`) | Runs on push to `main`. A post-merge CI failure also stops `deploy.yml`, which triggers on CI completing — so nothing downstream fires and nothing else says so. |
| `DB Backup` (`backup.yml`) | Daily cron, no other consumer. A silently failing backup is only discovered when it is needed. |

The `head_branch == 'main'` guard keeps PR runs of `CI` out of it — a red feature
branch is the author's normal feedback loop, not an outage. Scheduled runs report
`head_branch` as the default branch, so `DB Backup` passes the same guard.

> Adding a watched workflow later means checking it against the table in
> *What is active right now* first: two alert workflows on one target is not a
> conflict GitHub reports, it is just duplicate mail.

**3. Review — the first one that spends money.** ✅ **Active** (TOD-109)

```bash
git mv templates/workflows/pipeline-review.yml .github/workflows/pipeline-review.yml
```

Runs on `pull_request`, so it exercises the safe-outputs path on real PRs without
anything having to dispatch a session first. Needs `ANTHROPIC_API_KEY` and
`LINEAR_API_KEY`.

**Trigger: `pull_request: [opened]` only — never `synchronize`.** A later push to
an open PR does *not* re-review it, by design: bounce pushes commits, so
re-reviewing on every push would multiply review spend by the number of fix
pushes. A deliberate re-read is the `workflow_dispatch` input (`pr_number`), and
costs a full review.

**Cost shape.** At most one model run per PR *opened*: `--max-turns 30` on
`claude-sonnet-5` (override with the `PIPELINE_REVIEW_MODEL` variable), a
25-minute job timeout, under a closed `--allowedTools Read,Grep,Glob,Write`
allowlist — no Bash, and no tool that reaches the network. So the ceiling is one
bounded session per opened PR, not per push.

It cannot block a merge, and it cannot approve. The model step is
`continue-on-error`, so a failed review is a warning rather than a red check. The
job that runs the model holds `pull-requests: read`; the only job with
`pull-requests: write` is the separate `publish` job, which runs `github-script`
and no model. Approval is therefore structurally unreachable rather than merely
discouraged — keep it off the required-checks list.

**It reviews far fewer PRs than "every PR opened" suggests.** The snapshot job
declines unless it finds a dispatcher-written pin artifact (`pipeline-pin-TOD-n`)
whose `branch` equals the PR head ref. A hand-written branch has no pin, so the
run is a green no-op that logs a warning — no model runs and nothing is spent.
Since `pipeline-dispatch.yml` is held (above), **nothing currently writes pins**,
so in practice every PR takes that decline path today. It also skips with a
notice when `delivery.json` is absent or no Claude credential is set, and gets no
secrets on fork PRs.

**4. Dispatch — superseded while `dispatch.backend` is `local-daemon`.**

```bash
git mv templates/workflows/pipeline-dispatch.yml .github/workflows/pipeline-dispatch.yml
```

**Do not run this step as things stand.** This file *is* the `github-actions`
dispatcher, and contract §9 binds each backend to its own state store, so the
workflow asserts `dispatch.backend == "github-actions"` before it loads state and
exits 1 otherwise. `delivery.json` now says `local-daemon` — Cyrus dispatches from
the operator's machine — so activating this buys a red run on every cron tick and
no queue movement. It stays staged until the backend says `github-actions` again.

Whichever dispatcher is driving, watch `budgets.dailyUsd` (currently `50.0`) and
`budgets.wipLimit` (`3`) — and note that a single `effort:L` run is now capped at
`maxUsd` `45.0`, which is most of that daily figure.

If the backend does go back to `github-actions`: do not activate before **Step 0**
is done, set `dispatch.statePath` back to `null` (the workflow refuses a configured
store it would silently ignore), and set `PIPELINE_DISPATCH_ENABLED` to `"false"`
first if you want it merged but paused.

Both label-reading loops import `scripts/pipeline_labels.py`, and the step exits
with an error if that import fails rather than resolving labels its own way — so
keep the two files in step with each other when you re-sync either from the kit.

**5. Bounce — closes the loop on a red PR.**

```bash
git mv templates/workflows/pipeline-bounce.yml .github/workflows/pipeline-bounce.yml
```

Triggers on `workflow_run`, so it is inert in practice until dispatch is pushing
under the Step 0 identity.

**6. Telemetry — after there is something to collect.**

```bash
git mv templates/workflows/pipeline-telemetry.yml .github/workflows/pipeline-telemetry.yml
```

Add a `telemetry` block to `delivery.json` and provision the Postgres DSN under the
name that block declares (`PIPELINE_TELEMETRY_DSN` as shipped) — otherwise this is
a no-op. Telemetry is **reporting, not authority**: nothing read out of these tables
may gate a budget, an approval or a merge.

**7. Auto-approve, then 8. auto-merge — last, and only deliberately.**

```bash
git mv templates/workflows/pipeline-auto-approve.yml .github/workflows/pipeline-auto-approve.yml
git mv templates/workflows/pipeline-auto-merge.yml .github/workflows/pipeline-auto-merge.yml
```

Both are additionally gated by a variable that must read exactly `"true"`, so
activating the file leaves them reporting-only. Leave them that way until the
earlier stages have a track record. `autonomy.autoApproveProvenance` is currently
`["epic"]`, and auto-merge is off by config as noted above.

---

## Resolved follow-up

The dispatch workflow was originally staged from the kit at `a75aa64`, before the
kit's fix for a **fail-open label read** had merged: `keys.discard(None)` silently
dropped a label whose ID no longer resolved, so a ticket a human had parked with
`agent:needs-human` or `agent:blocked` could be dispatched anyway. That was a
re-sync-before-step-4 blocker.

It is now re-synced from kit `415ac16` (#45), together with the
`scripts/pipeline_labels.py` resolver it shares with tier-0 local dispatch. Both
loops refuse to trust an unresolvable label instead of discarding it, and contain
the failure to the one ticket. **No pre-activation re-sync is outstanding.**
