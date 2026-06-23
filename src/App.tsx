import { AuthForm } from './features/auth/AuthForm'
import { useSession } from './features/auth/use-session'
import { TaskList } from './features/tasks/TaskList'
import { supabase } from './lib/supabase'

export default function App() {
  const { session, loading } = useSession()

  return (
    <main className="mx-auto min-h-screen max-w-xl p-6 text-slate-800">
      <header className="mb-6 flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold">Todoclaw</h1>
          <p className="text-sm text-slate-500">Stage 1 — walking skeleton</p>
        </div>
        {session && (
          <button
            onClick={() => void supabase.auth.signOut()}
            className="text-sm text-slate-500 underline"
          >
            Sign out
          </button>
        )}
      </header>

      {loading ? (
        <p className="text-slate-500">Loading…</p>
      ) : session ? (
        <TaskList />
      ) : (
        <AuthForm />
      )}
    </main>
  )
}
