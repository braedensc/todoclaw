import { createHash } from 'node:crypto'

// Deterministic, UUID-shaped id derived from a stable seed string (NOT a spec-compliant
// UUIDv5 — no namespace registration, just a stable hash reshaped to look like a UUID).
// Used so the same old EisenClaw id (e.g. task "t7") always maps to the same new row id,
// both in the live import and across every historical backups/*.json snapshot. That
// consistency matters because `restore_backup` (supabase/migrations/20260702000000_backups.sql)
// upserts snapshot rows by `id` — reusing the same id across snapshots means restoring an
// older backup updates the SAME task/habit row instead of creating a duplicate.
export function deterministicId(seed: string): string {
  const hash = createHash('sha256').update(seed).digest('hex')
  const versionNibble = '4' + hash.slice(13, 16)
  const variantNibble = ((parseInt(hash[16], 16) & 0x3) | 0x8).toString(16) + hash.slice(17, 20)
  return [
    hash.slice(0, 8),
    hash.slice(8, 12),
    versionNibble,
    variantNibble,
    hash.slice(20, 32),
  ].join('-')
}
