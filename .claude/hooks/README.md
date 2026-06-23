# Claude Code Hooks

Project-scoped hooks configured in `.claude/settings.json`. They guard Claude's real-time tool calls before execution — unlike git pre-commit hooks, **the model cannot bypass them** (no `--no-verify` equivalent).

---

## PreToolUse — `pre-tool-use.py`

Runs before every tool call. Exit 2 = block with reason. Exit 0 = allow.

| What it blocks | Tool | Pattern | Why |
|---|---|---|---|
| Edit/Write while on `main`/`master` | Edit/Write | repo branch is protected + file is inside the project | Forces the feature-branch workflow automatically (`docs/COLLABORATION.md`) — keeps `main` clean for collaborators |
| `git commit` while on `main`/`master` | Bash | `git commit` + protected branch | Same — no direct commits to `main` |
| `rm -rf` / `rm --recursive` | Bash | `rm` with recursive+force flags | Accidental mass deletion |
| `curl/wget \| bash` | Bash | pipe to shell | Supply-chain attack vector |
| `git add planning/` | Bash | staging forbidden paths | `planning/` is gitignored reference; leaking it would publish EisenClaw source |
| `git add .env*` (non-example) | Bash | staging real env files | Secrets leak via git |
| Force-push / push to main | Bash | `git push --force` or `origin main` | Bypasses PR + CI gate |
| Reading `.env*`, `*.pem`, `*.key` via shell | Bash | `cat`/`less`/`head` on secret files | Secrets entering Claude's context |
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

> **Gotcha — the destructive-DB guard matches on *mention*, not just execution.** A Bash
> command that merely contains `supabase db reset --linked`, `projects delete`, or a remote
> `postgres://…@host` + `DROP/DELETE` is blocked — including a `git commit -m "…"` or
> `gh pr create --body "…"` whose **text** describes those commands. Workaround: put the
> message in a file and use `git commit -F <file>` / `gh pr create --body-file <file>` (the
> hook scans the command string, not file contents). This false-positive is the safe default —
> we'd rather block a commit message than risk a real prod wipe.

---

## PostToolUse — `audit.py`

Runs after every `Bash`, `Edit`, and `Write` call. Appends a one-line timestamped record to `.claude/audit.log` (gitignored — local only). Format:

```
2026-06-22T14:03:11Z [Bash] npm install husky --save-dev
2026-06-22T14:03:15Z [Write] /Users/.../todoclaw/.gitignore — write
```

Use this to review what Claude did in a session, especially before a commit.

---

## Defense in depth

These hooks are **layer 1** of three:
1. **Claude Code hooks** (this) — guard Claude's actions; model cannot bypass.
2. **Git pre-commit hooks** (Husky + secretlint) — guard commit contents locally; bypassable via `--no-verify`.
3. **CI + branch protection** — the unbypassable gate on every PR; runs secretlint + audit again.
