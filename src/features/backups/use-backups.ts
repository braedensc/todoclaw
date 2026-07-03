import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { supabase } from '../../lib/supabase'
import { BackupSchema, type Backup } from '../../types/backup'

// The Backups panel data layer. Snapshots are created/pruned and restored entirely server-side
// via the SECURITY INVOKER RPCs (create_backup / restore_backup) — the client never builds or
// reads the snapshot blob, so a snapshot always reflects the AUTHORITATIVE server state and a
// restore is atomic (see migration 20260702000000_backups.sql). RLS scopes every row to the
// owner; the client never supplies user_id.

const BACKUPS_KEY = ['backups'] as const

// List the signed-in user's snapshots, newest-first. Selects only the list columns (never the
// large `data` blob).
async function fetchBackups(): Promise<Backup[]> {
  const { data, error } = await supabase
    .from('backups')
    .select('id, label, created_at')
    .order('created_at', { ascending: false })

  if (error) throw error
  return BackupSchema.array().parse(data)
}

export function useBackups() {
  return useQuery({ queryKey: BACKUPS_KEY, queryFn: fetchBackups })
}

// Snapshot the current planner content. create_backup reads the caller's own live tasks +
// habits + schedule server-side and prunes to MAX_BACKUPS — the client sends only an optional
// label. Invalidates the list so the new snapshot appears.
export function useCreateBackup() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (label?: string) => {
      const { error } = await supabase.rpc('create_backup', { p_label: label ?? null })
      if (error) throw error
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: BACKUPS_KEY }),
  })
}

// Restore a snapshot. restore_backup upserts the snapshot's tasks/habits (un-deleting them),
// SOFT-deletes live rows not in the snapshot, and restores the schedule — it never touches
// history or daily_state (ADR-0012). Invalidate exactly what restore changes.
export function useRestoreBackup() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (backupId: string) => {
      const { error } = await supabase.rpc('restore_backup', { p_backup_id: backupId })
      if (error) throw error
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['tasks'] })
      qc.invalidateQueries({ queryKey: ['habits'] })
      qc.invalidateQueries({ queryKey: ['user_schedule'] })
    },
  })
}
