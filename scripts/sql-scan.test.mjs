// Regression tests for the shared SQL-scan primitives (scripts/sql-scan.mjs). These lock the two
// properties the guards depend on and that a naïve one-shot regex gets wrong: (1) a function's
// dollar-quoted body is consumed as a unit, so `returns trigger`/`security definer` from a LATER
// function never bleeds into an earlier one; (2) grants are parsed per-statement, distinguishing a
// table grant from an `on function …` grant and honoring a following revoke.

import { describe, it, expect } from 'vitest'
import { parseFunctions, parseGrants, parseTriggers, stripComments } from './sql-scan.mjs'

describe('parseFunctions', () => {
  it('does not let a later function’s traits bleed into an earlier one', () => {
    // f_invoker is plain; f_trigger returns trigger + security definer. A lazy `[\s\S]*?returns
    // trigger` would attach f_trigger's traits to f_invoker — the exact bug this guards against.
    const sql = `
      create function public.f_invoker(p uuid) returns void language plpgsql as $$
      begin insert into public.t values (p); end; $$;

      create function public.f_trigger() returns trigger language plpgsql security definer as $$
      begin
        if (select count(*) from public.t where user_id = new.user_id) >= 5 then raise exception 'x'; end if;
        return new;
      end; $$;`
    const fns = parseFunctions(sql)
    const inv = fns.find((f) => f.name === 'f_invoker')
    const trg = fns.find((f) => f.name === 'f_trigger')
    expect(inv.returnsTrigger).toBe(false)
    expect(inv.security).toBe('invoker')
    expect(trg.returnsTrigger).toBe(true)
    expect(trg.security).toBe('definer')
    expect(trg.body).toMatch(/count\(/)
  })

  it('captures overloads separately (same name, different args)', () => {
    const sql = `
      create function public.f(a bigint) returns void language plpgsql as $$ begin end; $$;
      create function public.f(a uuid, b bigint) returns void language plpgsql security definer as $$ begin end; $$;`
    const fs = parseFunctions(sql).filter((f) => f.name === 'f')
    expect(fs.length).toBe(2)
    expect(fs.map((f) => f.security).sort()).toEqual(['definer', 'invoker'])
  })
})

describe('parseGrants', () => {
  it('distinguishes a table grant from a function grant', () => {
    const sql = `
      grant insert on public.tasks to authenticated;
      grant execute on function public.do_thing(uuid) to authenticated;`
    const grants = parseGrants(sql)
    const table = grants.find((g) => g.name === 'tasks')
    const fn = grants.find((g) => g.name === 'do_thing')
    expect(table.kind).toBe('table')
    expect(table.privs).toMatch(/insert/)
    expect(fn.kind).toBe('function')
    expect(fn.roles).toContain('authenticated')
  })

  it('parses a revoke targeting multiple roles', () => {
    const g = parseGrants(
      `revoke execute on function public.f(uuid) from public, authenticated;`,
    )[0]
    expect(g.action).toBe('revoke')
    expect(g.roles).toEqual(['public', 'authenticated'])
  })
})

describe('parseTriggers', () => {
  it('extracts timing, events, table, and function', () => {
    const t = parseTriggers(
      `create trigger cap before insert on public.notes for each row execute function public.notes_cap();`,
    )[0]
    expect(t).toMatchObject({ timing: 'before', table: 'notes', fn: 'notes_cap' })
    expect(t.events).toMatch(/insert/)
  })
})

describe('stripComments', () => {
  it('removes -- line and /* block */ comments', () => {
    const out = stripComments(`select 1; -- drop table x\n/* create table y */ select 2;`)
    expect(out).not.toMatch(/drop table x/)
    expect(out).not.toMatch(/create table y/)
    expect(out).toMatch(/select 1/)
    expect(out).toMatch(/select 2/)
  })
})
