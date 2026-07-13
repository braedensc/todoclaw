import { createContext, useCallback, useContext, useRef, useState, type ReactNode } from 'react'
import { Snackbar, type ToastTone } from './Snackbar'

// A tiny app-wide toast: one transient pill at a time, shared by every surface. Mount
// <ToastProvider> once near the app root; anywhere beneath it, `const toast = useToast()` gives a
// fire-and-forget `toast(message, tone?)` that shows the single <Snackbar> the provider renders.
//
// Two callers today: the mobile "Added to X ✓" confirmation, and — the reason this was hoisted out
// of AppShell — the shared task mutations' onError (use-tasks.ts). Those mutations had no error
// path at all, so a failed write (e.g. a 400 on a missing column) was visually indistinguishable
// from success — the very "toggle does nothing" symptom PR #240 chased. Routing their onError
// here makes a failed write surface a visible notice instead of a silent no-op.
//
// The context default is a NO-OP, deliberately NOT a throw (contrast useConfirm): the task-mutation
// hooks call useToast() unconditionally and are rendered across many component tests without this
// provider — a missing provider must degrade to "no toast", never crash the tree.

type ShowToast = (message: string, tone?: ToastTone) => void

const ToastContext = createContext<ShowToast>(() => {})

// An error lingers a little longer than a confirmation — long enough to read "couldn't save" and
// react, without becoming sticky chrome.
const DURATION: Record<ToastTone, number> = { default: 2400, error: 4000 }

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toast, setToast] = useState<{ message: string; tone: ToastTone } | null>(null)
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null)

  const show = useCallback<ShowToast>((message, tone = 'default') => {
    if (timer.current) clearTimeout(timer.current)
    setToast({ message, tone })
    timer.current = setTimeout(() => setToast(null), DURATION[tone])
  }, [])

  return (
    <ToastContext.Provider value={show}>
      {children}
      <Snackbar message={toast?.message ?? null} tone={toast?.tone ?? 'default'} />
    </ToastContext.Provider>
  )
}

export function useToast(): ShowToast {
  return useContext(ToastContext)
}
