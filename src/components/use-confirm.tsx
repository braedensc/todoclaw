import { createContext, useCallback, useContext, useRef, useState, type ReactNode } from 'react'
import { ConfirmDialog, type ConfirmOptions } from './ConfirmDialog'

// A promise-returning confirm. Mount <ConfirmProvider> once near the app root; anywhere beneath
// it, `const confirm = useConfirm()` gives an async gate that replaces bare window.confirm() with
// the app-themed ConfirmDialog while keeping the same "await a yes/no" ergonomics:
//
//   const confirm = useConfirm()
//   const remove = async () => {
//     if (await confirm({ title: `Delete "${task.text}"?` })) softDelete.mutate(task.id)
//   }
//
// One dialog is shared for the whole tree. Confirms are modal (one at a time): requesting a new
// one while a dialog is open replaces it.

type ConfirmFn = (options: ConfirmOptions) => Promise<boolean>

const ConfirmContext = createContext<ConfirmFn | null>(null)

export function ConfirmProvider({ children }: { children: ReactNode }) {
  const [options, setOptions] = useState<ConfirmOptions | null>(null)
  // The pending promise's resolver lives in a ref, not state — settle() calls it from an event
  // handler, never inside a state updater (React double-invokes updaters under StrictMode, which
  // would resolve the promise twice).
  const resolverRef = useRef<((ok: boolean) => void) | null>(null)

  const confirm = useCallback<ConfirmFn>(
    (opts) =>
      new Promise<boolean>((resolve) => {
        resolverRef.current = resolve
        setOptions(opts)
      }),
    [],
  )

  const settle = useCallback((ok: boolean) => {
    resolverRef.current?.(ok)
    resolverRef.current = null
    setOptions(null)
  }, [])

  return (
    <ConfirmContext.Provider value={confirm}>
      {children}
      {options && (
        <ConfirmDialog {...options} onConfirm={() => settle(true)} onCancel={() => settle(false)} />
      )}
    </ConfirmContext.Provider>
  )
}

export function useConfirm(): ConfirmFn {
  const ctx = useContext(ConfirmContext)
  if (!ctx) throw new Error('useConfirm must be used within a <ConfirmProvider>')
  return ctx
}
