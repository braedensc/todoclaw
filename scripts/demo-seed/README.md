# demo-seed

Dev-only convenience: load a small, fictional demo dataset into a **local** Supabase instance so
you can exercise the app (or the demo-seed golden E2E) against realistic data instead of an empty
slate. Sample content only — nothing personal, safe to commit.

```bash
npm run seed:demo -- --email you@example.com
```

Requires `supabase start` running locally and a user already created (the app is sign-in-only —
see `docs/SETUP.md` → "Create a local user in Studio"). It resolves its DB connection from
`supabase status`, so it can only ever hit the local stack — never a remote/production DB.

## Layout

- `data.ts` — the checked-in demo dataset (`DEMO_STATE`), already in the current schema's shape.
- `types.ts` — the seed shapes.
- `insert.ts` — `insertSeedState(client, userId, state)`; a clean-slate INSERT (no upsert).
- `import.ts` — the `npm run seed:demo` CLI entry.

The dataset backs `e2e/golden/demo-seed.golden.spec.ts`; the assertions there track the coverage
notes at the top of `data.ts`, so keep the two in sync when you edit the data.
