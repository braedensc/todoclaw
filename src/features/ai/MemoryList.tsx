import { useState } from 'react'
import { useMemories, useUpdateMemory, useDeleteMemory, useDeleteAllMemories } from './use-memories'
import { MEMORY_CONTENT_MAX } from '../../types/assistant-memory'
import { useToast } from '../../components/use-toast'

interface Props {
  /** The kill-switch value (from the Settings draft; persists on Save, like tone/verbosity). */
  memoryEnabled: boolean
  onToggleMemory: (value: boolean) => void
}

// Settings → AI: the user-facing view/edit/delete surface for what BabyClaw remembers. The toggle
// rides the Settings draft (saved with the rest of the form); the list is LIVE (immediate mutations,
// the BackupsPanel pattern) so a "forget" takes effect at once. Every mutation surfaces an onError
// toast (the #241 rule — never a silent write failure).
export function MemoryList({ memoryEnabled, onToggleMemory }: Props) {
  const { data: memories = [], isLoading } = useMemories()
  const update = useUpdateMemory()
  const del = useDeleteMemory()
  const delAll = useDeleteAllMemories()
  const toast = useToast()
  const [editingId, setEditingId] = useState<string | null>(null)
  const [draftText, setDraftText] = useState('')
  const [confirmingForgetAll, setConfirmingForgetAll] = useState(false)

  const saveEdit = (id: string) => {
    const content = draftText.trim()
    if (!content) return
    update.mutate(
      { id, content },
      {
        onSuccess: () => setEditingId(null),
        onError: () => toast("Couldn't save that memory — try again.", 'error'),
      },
    )
  }

  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-center justify-between gap-3">
        <span className="text-sm text-ink">Let BabyClaw remember facts about you</span>
        <button
          type="button"
          role="switch"
          aria-checked={memoryEnabled}
          aria-label="Let BabyClaw remember facts about you"
          onClick={() => onToggleMemory(!memoryEnabled)}
          className={`relative h-6 w-11 shrink-0 rounded-full transition-colors ${
            memoryEnabled ? 'bg-accent' : 'bg-border-strong'
          }`}
        >
          <span
            className={`absolute top-0.5 h-5 w-5 rounded-full bg-card shadow transition-all ${
              memoryEnabled ? 'left-[1.375rem]' : 'left-0.5'
            }`}
          />
        </button>
      </div>
      <p className="text-xs text-muted">
        When on, BabyClaw saves short facts you share in chat (and uses them to personalize its
        help). Turning it off hides and stops using memory — it doesn’t delete what’s already saved.
      </p>

      {isLoading ? (
        <p className="text-sm text-muted">Loading…</p>
      ) : memories.length === 0 ? (
        <p className="text-sm text-muted">
          Nothing saved yet. BabyClaw will remember facts you share in chat.
        </p>
      ) : (
        <ul className="flex flex-col gap-2">
          {memories.map((m) => (
            <li key={m.id} className="rounded-lg border border-border p-2">
              {editingId === m.id ? (
                <div className="flex flex-col gap-2">
                  <textarea
                    value={draftText}
                    maxLength={MEMORY_CONTENT_MAX}
                    onChange={(e) => setDraftText(e.target.value)}
                    aria-label="Edit memory"
                    className="w-full resize-none rounded border border-border bg-card p-2 text-sm text-ink"
                    rows={2}
                  />
                  <div className="flex justify-end gap-2">
                    <button
                      type="button"
                      onClick={() => setEditingId(null)}
                      className="text-sm text-muted"
                    >
                      Cancel
                    </button>
                    <button
                      type="button"
                      onClick={() => saveEdit(m.id)}
                      disabled={update.isPending || !draftText.trim()}
                      className="text-sm font-medium text-accent disabled:opacity-50"
                    >
                      Save
                    </button>
                  </div>
                </div>
              ) : (
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <p className="text-sm text-ink">{m.content}</p>
                    <p className="text-xs text-muted">
                      saved {new Date(m.updated_at).toLocaleDateString()}
                    </p>
                  </div>
                  <div className="flex shrink-0 gap-2">
                    <button
                      type="button"
                      aria-label="Edit memory"
                      onClick={() => {
                        setEditingId(m.id)
                        setDraftText(m.content)
                      }}
                      className="text-muted hover:text-ink"
                    >
                      ✎
                    </button>
                    <button
                      type="button"
                      aria-label="Delete memory"
                      onClick={() =>
                        del.mutate(m.id, {
                          onError: () => toast("Couldn't delete that memory — try again.", 'error'),
                        })
                      }
                      className="text-muted hover:text-danger"
                    >
                      ✕
                    </button>
                  </div>
                </div>
              )}
            </li>
          ))}
        </ul>
      )}

      {memories.length > 0 &&
        (confirmingForgetAll ? (
          <div className="flex items-center justify-between gap-2">
            <span className="text-sm text-ink">Forget all {memories.length} memories?</span>
            <div className="flex gap-2">
              <button
                type="button"
                onClick={() => setConfirmingForgetAll(false)}
                className="text-sm text-muted"
              >
                Cancel
              </button>
              <button
                type="button"
                disabled={delAll.isPending}
                onClick={() =>
                  delAll.mutate(undefined, {
                    onSuccess: () => setConfirmingForgetAll(false),
                    onError: () => toast("Couldn't clear your memories — try again.", 'error'),
                  })
                }
                className="text-sm font-medium text-danger disabled:opacity-50"
              >
                Forget everything
              </button>
            </div>
          </div>
        ) : (
          <button
            type="button"
            onClick={() => setConfirmingForgetAll(true)}
            className="self-start text-sm text-danger"
          >
            Forget everything
          </button>
        ))}
    </div>
  )
}
