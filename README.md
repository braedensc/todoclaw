# Todoclaw 🐾

**An AI-powered, Eisenhower-matrix task planner.**

Todoclaw lays your tasks out on a 2-D board where **position is priority**: left-to-right is
_urgency_, bottom-to-top is _importance_. Instead of a flat list, you get a picture of what
actually matters today — the top-right corner is "do this now," the rest can wait. It's fully
usable on its own; the AI features are additive and opt-in.

> Todoclaw is a ground-up rebuild of an earlier personal planner ("EisenClaw") as a standalone,
> multi-tenant web app.

---

## Features

- **Priority grid** — a free-canvas board; drag a task anywhere to set its urgency × importance.
  Four quadrants fall out naturally: **Do Now**, **Schedule**, **Errands**, **Someday**.
- **Clustering** — cards that pile up in the same spot collapse into a bubble you can expand,
  so a busy corner stays readable.
- **List view** — the same tasks ranked by a priority score, with inline editing and sliders.
- **Recurring tasks** — chores that surface only when they're due, then step out of the way.
- **Daily reminders** — lightweight daily habits with optional steps.
- **Done history** — a permanent completion log you can restore from or clear.
- **Plan My Day** _(AI)_ — a schedule-aware daily plan: one "big rock" plus a few "small rocks."
- **BabyClaw** _(AI chat)_ — 🐾 your in-app assistant: add, move, schedule, complete, or clear
  tasks and reminders in plain English.
- **Settings** — your working hours, recurring commitments, and assistant preferences.

**Works without AI.** Every planning feature works with the AI turned off — AI is never required.

---

## Tech stack

| Layer | Tech |
|---|---|
| Frontend | Vite · React · TypeScript · Tailwind CSS |
| Data / server state | TanStack Query |
| Backend | Supabase — Postgres, Auth, Row-Level Security, Realtime, Edge Functions |
| AI | Anthropic API, called server-side from Edge Functions (never the browser) |
| Hosting | Vercel (frontend) · Supabase (backend) |

---

## Getting started (development)

**Prerequisites:** [Node 22](https://nodejs.org) (`nvm use`), Docker (for local Supabase), and the
[Supabase CLI](https://supabase.com/docs/guides/cli).

```bash
npm install
supabase start   # local Postgres + Auth (Docker)
npm run dev      # Vite dev server
```

Full setup, environment variables, and service configuration are in **[docs/SETUP.md](docs/SETUP.md)**.

Handy scripts:

```bash
npm run typecheck     # tsc, no emit
npm run lint          # ESLint
npm test              # unit + component tests (Vitest)
npm run test:e2e      # Playwright smoke tests
npm run build         # production build
```

---

## Project layout

```
src/features/   grid · list · clustering · recurring · habits (reminders) · done · ai
src/lib/        pure logic — scoring, dates, clustering math
src/components/ shared UI primitives
supabase/       versioned migrations + Edge Functions
docs/           architecture, setup, style, and collaboration guides
```

Deeper design notes live in **[docs/ARCHITECTURE.md](docs/ARCHITECTURE.md)**.

---

## Contributing

Contributions are welcome — please read **[CONTRIBUTING.md](CONTRIBUTING.md)**, and note that
merging an external contribution requires agreeing to the **[Contributor License Agreement](CLA.md)**.
Branch naming, PR conventions, and CI expectations are documented in
**[docs/COLLABORATION.md](docs/COLLABORATION.md)**.

## License

Todoclaw is licensed under the **GNU AGPL-3.0**. See [`CONTRIBUTING.md`](CONTRIBUTING.md) and
[`CLA.md`](CLA.md) for licensing and contribution terms.
