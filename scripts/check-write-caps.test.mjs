// Fixture tests for the volume-bound guard (scripts/check-write-caps.mjs). Each test writes a tiny
// migration set to a throwaway temp dir and asserts the guard's verdict — a violating table is
// flagged, a compliant one (row cap + size CHECK, or allowlisted) is not. This mirrors the mutation
// test #296 used to prove its RLS guard, but committed so the detection can't silently rot.

import { describe, it, expect, afterEach } from 'vitest'
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { scanWriteCaps, findWriteCapOffenders } from './check-write-caps.mjs'

const dirs = []
function migrations(files) {
  const dir = mkdtempSync(join(tmpdir(), 'writecaps-'))
  dirs.push(dir)
  for (const [name, sql] of Object.entries(files)) writeFileSync(join(dir, name), sql)
  return dir
}
afterEach(() => {
  while (dirs.length) rmSync(dirs.pop(), { recursive: true, force: true })
})

const RLS = (t) => `alter table public.${t} enable row level security;`
// A compliant table: per-user row-cap trigger (count + raise + user_id) AND a char_length size CHECK.
const capped = (t) => `
  create table public.${t} (
    id uuid primary key default gen_random_uuid(),
    user_id uuid not null default auth.uid(),
    body text not null constraint ${t}_len check (char_length(body) <= 500)
  );
  ${RLS(t)}
  grant select, insert on public.${t} to authenticated;
  create function public.${t}_cap() returns trigger language plpgsql as $$
  begin
    if (select count(*) from public.${t} where user_id = new.user_id) >= 50 then
      raise exception 'cap';
    end if;
    return new;
  end; $$;
  create trigger ${t}_cap before insert on public.${t}
    for each row execute function public.${t}_cap();`

describe('volume-bound guard', () => {
  it('FLAGS a write-granted table with no row cap and no size CHECK', () => {
    const dir = migrations({
      '20260101000000_notes.sql': `
        create table public.notes (
          id uuid primary key,
          user_id uuid not null default auth.uid(),
          text text not null
        );
        ${RLS('notes')}
        grant select, insert, update on public.notes to authenticated;`,
    })
    const { offenders } = findWriteCapOffenders(dir, {})
    expect(offenders.map((o) => o.table)).toEqual(['notes'])
    expect(offenders[0].hasRowCap).toBe(false)
    expect(offenders[0].hasSizeCheck).toBe(false)
  })

  it('PASSES a table with a per-user row cap AND a size CHECK', () => {
    const dir = migrations({ '20260101000000_c.sql': capped('c') })
    const { offenders, info } = findWriteCapOffenders(dir, {})
    expect(offenders).toEqual([])
    expect(info.get('c').bounded).toBe(true)
  })

  it('FLAGS a row-capped table whose unbounded column has NO size CHECK', () => {
    // Row cap present, but the jsonb column is unbounded and unchecked → still an offender.
    const dir = migrations({
      '20260101000000_j.sql': `
        create table public.j (
          id uuid primary key, user_id uuid not null default auth.uid(), payload jsonb not null
        );
        ${RLS('j')}
        grant select, insert on public.j to authenticated;
        create function public.j_cap() returns trigger language plpgsql as $$
        begin
          if (select count(*) from public.j where user_id = new.user_id) >= 10 then raise exception 'x'; end if;
          return new;
        end; $$;
        create trigger j_cap before insert on public.j for each row execute function public.j_cap();`,
    })
    const { offenders } = findWriteCapOffenders(dir, {})
    expect(offenders.map((o) => o.table)).toEqual(['j'])
    expect(offenders[0].hasRowCap).toBe(true)
    expect(offenders[0].unboundedColumns).toEqual(['payload'])
  })

  it('does NOT count a lower-bound length() check as a size CHECK', () => {
    const dir = migrations({
      '20260101000000_nz.sql': `
        create table public.nz (
          id uuid primary key, user_id uuid not null default auth.uid(),
          name text not null check (length(btrim(name)) > 0)
        );
        ${RLS('nz')}
        create function public.nz_cap() returns trigger language plpgsql as $$
        begin
          if (select count(*) from public.nz where user_id = new.user_id) >= 5 then raise exception 'x'; end if;
          return new;
        end; $$;
        create trigger nz_cap before insert on public.nz for each row execute function public.nz_cap();
        grant select, insert on public.nz to authenticated;`,
    })
    const { info } = findWriteCapOffenders(dir, {})
    expect(info.get('nz').hasSizeCheck).toBe(false)
    expect(info.get('nz').bounded).toBe(false)
  })

  it('honors the allowlist (no offender when the table is allowlisted)', () => {
    const dir = migrations({
      '20260101000000_notes.sql': `
        create table public.notes (id uuid primary key, user_id uuid, text text);
        ${RLS('notes')}
        grant insert on public.notes to authenticated;`,
    })
    expect(findWriteCapOffenders(dir, {}).offenders.map((o) => o.table)).toEqual(['notes'])
    expect(findWriteCapOffenders(dir, { notes: 'reviewed' }).offenders).toEqual([])
  })

  it('ignores a table with only a SELECT grant (not user-writable)', () => {
    const dir = migrations({
      '20260101000000_ro.sql': `
        create table public.ro (id uuid primary key, user_id uuid, text text);
        ${RLS('ro')}
        grant select on public.ro to authenticated;`,
    })
    const { info } = findWriteCapOffenders(dir, {})
    expect(info.get('ro').writeGranted).toBe(false)
    expect(findWriteCapOffenders(dir, {}).offenders).toEqual([])
  })

  it('treats a later REVOKE insert as removing the write grant', () => {
    const dir = migrations({
      '20260101000000_a.sql': `
        create table public.a (id uuid primary key, user_id uuid, text text);
        ${RLS('a')}
        grant insert on public.a to authenticated;`,
      '20260102000000_b.sql': `revoke insert on public.a from authenticated;`,
    })
    expect(scanWriteCaps(dir).get('a').writeGranted).toBe(false)
    expect(findWriteCapOffenders(dir, {}).offenders).toEqual([])
  })

  it('does not require a size CHECK when every column is type-bounded', () => {
    const dir = migrations({
      '20260101000000_nums.sql': `
        create table public.nums (
          id uuid primary key, user_id uuid not null default auth.uid(),
          n integer not null, tag varchar(20)
        );
        ${RLS('nums')}
        grant insert on public.nums to authenticated;
        create function public.nums_cap() returns trigger language plpgsql as $$
        begin
          if (select count(*) from public.nums where user_id = new.user_id) >= 5 then raise exception 'x'; end if;
          return new;
        end; $$;
        create trigger nums_cap before insert on public.nums for each row execute function public.nums_cap();`,
    })
    const rec = scanWriteCaps(dir).get('nums')
    expect(rec.unboundedColumns).toEqual([]) // varchar(20) is bounded
    expect(rec.bounded).toBe(true)
    expect(findWriteCapOffenders(dir, {}).offenders).toEqual([])
  })

  it('reports a stale allowlist entry for an already-bounded table', () => {
    const dir = migrations({ '20260101000000_c.sql': capped('c') })
    const { staleAllowlist } = findWriteCapOffenders(dir, { c: 'no longer needed' })
    expect(staleAllowlist).toContain('c')
  })
})
