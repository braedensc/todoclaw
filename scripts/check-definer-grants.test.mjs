// Fixture tests for the DEFINER-scope guard (scripts/check-definer-grants.mjs). A SECURITY DEFINER
// function net-granted to a user role must carry a reviewed allowlist entry; a new one must fail.

import { describe, it, expect, afterEach } from 'vitest'
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  definerFunctionsGrantedToUsers,
  findDefinerGrantOffenders,
} from './check-definer-grants.mjs'

const dirs = []
function migrations(files) {
  const dir = mkdtempSync(join(tmpdir(), 'definer-'))
  dirs.push(dir)
  for (const [name, sql] of Object.entries(files)) writeFileSync(join(dir, name), sql)
  return dir
}
afterEach(() => {
  while (dirs.length) rmSync(dirs.pop(), { recursive: true, force: true })
})

// A function definition with a chosen security property + optional grant target.
function fn(name, { security = 'invoker', grantTo = null } = {}) {
  return `
    create or replace function public.${name}(p_x uuid)
    returns void language plpgsql ${security === 'definer' ? 'security definer' : ''}
    set search_path = public as $$
    begin
      insert into public.thing (user_id, val) values (auth.uid(), p_x);
    end; $$;
    ${grantTo ? `grant execute on function public.${name}(uuid) to ${grantTo};` : ''}`
}

describe('DEFINER-scope guard', () => {
  it('FLAGS a SECURITY DEFINER function granted to authenticated with no allowlist entry', () => {
    const dir = migrations({
      '20260101000000_f.sql': fn('do_thing', { security: 'definer', grantTo: 'authenticated' }),
    })
    expect(definerFunctionsGrantedToUsers(dir)).toEqual(['do_thing'])
    expect(findDefinerGrantOffenders(dir, {}).offenders).toEqual(['do_thing'])
  })

  it('PASSES the same function once it is in the allowlist', () => {
    const dir = migrations({
      '20260101000000_f.sql': fn('do_thing', { security: 'definer', grantTo: 'authenticated' }),
    })
    const allow = { do_thing: { writesScopedToAuthUid: 'yes', note: 'reviewed' } }
    expect(findDefinerGrantOffenders(dir, allow).offenders).toEqual([])
  })

  it('IGNORES a SECURITY INVOKER function granted to authenticated', () => {
    const dir = migrations({
      '20260101000000_f.sql': fn('inv_thing', { security: 'invoker', grantTo: 'authenticated' }),
    })
    expect(definerFunctionsGrantedToUsers(dir)).toEqual([])
    expect(findDefinerGrantOffenders(dir, {}).offenders).toEqual([])
  })

  it('IGNORES a DEFINER function granted only to service_role', () => {
    const dir = migrations({
      '20260101000000_f.sql': fn('svc_thing', { security: 'definer', grantTo: 'service_role' }),
    })
    expect(definerFunctionsGrantedToUsers(dir)).toEqual([])
  })

  it('treats a later REVOKE from authenticated as removing the grant (the #310 shape)', () => {
    const dir = migrations({
      '20260101000000_f.sql': fn('cache_put', { security: 'definer', grantTo: 'authenticated' }),
      '20260102000000_fix.sql': `
        revoke execute on function public.cache_put(uuid) from public, authenticated;
        grant execute on function public.cache_put(uuid) to service_role;`,
    })
    expect(definerFunctionsGrantedToUsers(dir)).toEqual([])
    expect(findDefinerGrantOffenders(dir, {}).offenders).toEqual([])
  })

  it('does not confuse a table INSERT grant with a function EXECUTE grant', () => {
    // A DEFINER function AND a same-named-ish table both granted to authenticated: only the function
    // execute grant should put the function in scope; the table grant must not.
    const dir = migrations({
      '20260101000000_f.sql': `
        create table public.thing (user_id uuid, val uuid);
        grant insert on public.thing to authenticated;
        ${fn('reader', { security: 'definer', grantTo: 'authenticated' })}`,
    })
    expect(definerFunctionsGrantedToUsers(dir)).toEqual(['reader'])
  })

  it('reports a stale allowlist entry when the function is no longer in scope', () => {
    const dir = migrations({
      '20260101000000_f.sql': fn('inv_thing', { security: 'invoker', grantTo: 'authenticated' }),
    })
    const { staleAllowlist } = findDefinerGrantOffenders(dir, {
      inv_thing: { writesScopedToAuthUid: 'yes', note: 'x' },
    })
    expect(staleAllowlist).toContain('inv_thing')
  })
})
