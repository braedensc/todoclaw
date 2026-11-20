// The project's fake backend for the acceptance check (contract §15, delivery.json
// `acceptance.fakeBackend`). It answers every request the built app makes to a service, so a
// browser check of this app never touches a real one: Supabase auth, REST and Edge Functions
// are all answered here, from fixtures. Everything is a FIXTURE: a fake user, an unsigned fake
// token, rows shaped like the app's types.
//
// THE CONTRACT THE RUNNER READS (kit scripts/look_runner.mjs):
//
//   export const scenarios = [...names]                 // covers acceptance.scenarios
//   export async function install(context, { scenario, origin, viewport, mode })
//
// `context` is a Playwright BrowserContext. This module registers routes ONLY for the one
// origin it fakes (the dummy Supabase URL the app is built with, scripts/build-acceptance.mjs);
// the runner serves the app's own origin and aborts, and lists, everything else. A request this
// module does not know is answered with an empty 200 and returned in `unknown`, so the result
// names it instead of the page quietly breaking.
//
// THIS FILE IS A GRADER PATH (delivery.json `stack.graderPaths` and `autonomy.riskPaths`): a
// coding session could otherwise change what the check sees in the same pull request the check
// judges. Run `npm run test:acceptance` after a change.
//
// Scenarios:
//   signed-in   a signed-in user with a full board (tasks in every quadrant, habits, a plan,
//               chat history, backups)
//   signed-out  no session: the sign-in screen
//   empty       a signed-in user with no data at all and the first-run guide not yet dismissed

// Must equal the VITE_SUPABASE_URL scripts/build-acceptance.mjs builds with.
export const SUPA = 'http://127.0.0.1:54321'
// The zone the browser runs in, so the app's "your device clock is on another zone" banner stays
// out of every screenshot. A mode that emulates another zone brings the banner back, truthfully.
export const TZ = Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC'
const U = '00000000-0000-0000-0000-000000000001'
const EMAIL = 'acceptance-check@example.test'

// ---- dates in the user's zone ---------------------------------------------------------------
function localDate(offsetDays = 0) {
  const d = new Date(Date.now() + offsetDays * 86400000)
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: TZ,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(d)
}
const iso = (offsetDays = 0, hours = 0) =>
  new Date(Date.now() + offsetDays * 86400000 + hours * 3600000).toISOString()
export const TODAY = localDate(0)

// ---- fake session (unsigned, obviously fake) -------------------------------------------------
const b64u = (o) => Buffer.from(JSON.stringify(o)).toString('base64url')
const exp = Math.floor(Date.now() / 1000) + 7 * 86400
const ACCESS = `${b64u({ alg: 'none', typ: 'JWT' })}.${b64u({ sub: U, email: EMAIL, role: 'authenticated', aud: 'authenticated', exp, iat: exp - 7 * 86400, session_id: 'fake-session' })}.fake-unsigned-signature`
const USER = {
  id: U,
  aud: 'authenticated',
  role: 'authenticated',
  email: EMAIL,
  email_confirmed_at: iso(-30),
  phone: '',
  confirmed_at: iso(-30),
  last_sign_in_at: iso(-1),
  app_metadata: { provider: 'email', providers: ['email'] },
  user_metadata: {},
  identities: [],
  created_at: iso(-60),
  updated_at: iso(-1),
  is_anonymous: false,
}
export const SESSION = {
  access_token: ACCESS,
  token_type: 'bearer',
  expires_in: 7 * 86400,
  expires_at: exp,
  refresh_token: 'fake-refresh-token',
  user: USER,
}
export const STORAGE_KEY = 'sb-127-auth-token'

// ---- fixtures --------------------------------------------------------------------------------
const id = (n) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`
function task(n, text, x, y, extra = {}) {
  return {
    id: id(100 + n),
    user_id: U,
    text,
    x,
    y,
    due: null,
    due_time: null,
    staged: false,
    bucket: 'oneoff',
    recurring: null,
    ongoing: false,
    size: null,
    created_at: iso(-3 - n * 0.01),
    deleted_at: null,
    completed_at: null,
    start_date: null,
    worked_days: null,
    ...extra,
  }
}
export function makeFixtures({ onboarding = false, empty = false } = {}) {
  const tasks = [
    task(1, 'Finish quarterly report', 0.82, 0.86, { due: localDate(0), due_time: '17:00:00' }),
    task(2, 'Call the plumber about the leak', 0.68, 0.66, { due: localDate(-1) }),
    task(3, 'Reply to Sam', 0.9, 0.74),
    task(4, 'Reply to Alex', 0.905, 0.745),
    task(5, 'Plan the vegetable garden', 0.22, 0.82, {
      ongoing: true,
      worked_days: [localDate(-1), localDate(-2)],
    }),
    task(6, 'Book dentist appointment', 0.3, 0.6, { due: localDate(5) }),
    task(7, 'Pick up dry cleaning', 0.76, 0.32, {
      recurring: { frequencyDays: 7, lastDoneAt: iso(-9), doneCount: 4 },
    }),
    task(8, 'Buy birthday card for Mum', 0.6, 0.18, { due: localDate(1) }),
    task(9, 'Learn watercolor basics', 0.18, 0.22, { created_at: iso(-45) }),
    task(10, 'Reorganize the bookshelf', 0.38, 0.4),
    task(11, 'Water the plants', 0.55, 0.42, {
      recurring: { frequencyDays: 3, lastDoneAt: iso(-1), doneCount: 12 },
    }),
    task(12, 'New idea: try a standing desk', 0.5, 0.5, { staged: true }),
    task(13, 'Renew passport', 0.3, 0.7, { start_date: localDate(20) }),
  ]
  const habits = [
    {
      id: id(201),
      user_id: U,
      text: 'Morning stretch',
      active: true,
      subtasks: [
        { id: 's1', text: 'Neck rolls' },
        { id: 's2', text: 'Back twist' },
      ],
      created_at: iso(-20),
      deleted_at: null,
    },
    {
      id: id(202),
      user_id: U,
      text: 'Drink 8 glasses of water',
      active: true,
      subtasks: [],
      created_at: iso(-19),
      deleted_at: null,
    },
    {
      id: id(203),
      user_id: U,
      text: 'Read 20 minutes',
      active: true,
      subtasks: [],
      created_at: iso(-18),
      deleted_at: null,
    },
    {
      id: id(204),
      user_id: U,
      text: 'Evening walk (paused)',
      active: false,
      subtasks: [],
      created_at: iso(-17),
      deleted_at: null,
    },
  ]
  const plan = {
    headline: 'A focused day: report first, errands after lunch.',
    availableTime: 'about 4 hours of free time',
    anchors: [
      { task: 'Finish quarterly report', time: '5:00 PM', duration: '1h', taskId: tasks[0].id },
    ],
    chores: [{ task: 'Pick up dry cleaning', status: 'overdue 2d', taskId: tasks[6].id }],
    dueToday: [{ task: 'Finish quarterly report', status: 'due today', taskId: tasks[0].id }],
    overflow: null,
    bigRock: {
      task: 'Finish quarterly report',
      why: 'It is due at 5 and everything else can wait.',
      duration: '2h',
      when: 'morning',
      taskId: tasks[0].id,
    },
    smallRocks: [
      {
        task: 'Call the plumber about the leak',
        why: 'Overdue since yesterday.',
        duration: '15m',
        when: 'lunch',
        taskId: tasks[1].id,
      },
      {
        task: 'Reply to Sam',
        why: 'Quick win.',
        duration: '10m',
        when: 'afternoon',
        taskId: tasks[2].id,
      },
    ],
    habitNote: 'Stretch before you sit down to write.',
    nudge: {
      task: 'Plan the vegetable garden',
      why: 'You worked on it two days running.',
      duration: '30m',
      taskId: tasks[4].id,
    },
  }
  const daily_state = [
    {
      user_id: U,
      date: TODAY,
      done: {},
      done_at: {},
      habit_done: { [habits[1].id]: true },
      subtask_done: { [`${habits[0].id}:s1`]: true },
      plan,
    },
  ]
  const config = {
    location: 'Portland, Oregon',
    locationResolved: 'Portland, Oregon, United States',
    weekday: {
      wakeTime: '7:00',
      workStart: '9:00',
      workEnd: '17:00',
      lunchStart: '12:00',
      lunchEnd: '13:00',
      bedtime: '23:00',
      freeTimeEstimateHours: 3,
    },
    weekend: { saturday: { freeTimeEstimateHours: 8 }, sunday: { freeTimeEstimateHours: 6 } },
    commitments: [{ label: 'Gym', when: 'Tue/Thu 6pm' }],
    planNotes: 'Keep mornings for deep work.',
    assistant: { tone: 'warm', verbosity: 'balanced' },
    notifications: { enabled: false },
  }
  if (!onboarding) config.onboarding = { tourSeen: true, setupDismissed: true }
  const user_schedule = [
    { user_id: U, timezone: TZ, config, created_at: iso(-60), updated_at: iso(-1) },
  ]
  const history = [
    {
      id: id(301),
      user_id: U,
      task_id: id(190),
      text: 'Send the invoice to Acme',
      bucket: 'oneoff',
      completed_at: iso(0, -3),
      created_at: iso(0, -3),
    },
    {
      id: id(302),
      user_id: U,
      task_id: id(191),
      text: 'Return library books',
      bucket: 'oneoff',
      completed_at: iso(-1, -2),
      created_at: iso(-1, -2),
    },
    {
      id: id(303),
      user_id: U,
      task_id: id(192),
      text: 'Fix the bike tyre',
      bucket: 'oneoff',
      completed_at: iso(-4),
      created_at: iso(-4),
    },
  ]
  const sessionId = id(401)
  const chat_sessions = [
    {
      id: sessionId,
      title: 'Weekend planning',
      updated_at: iso(0, -1),
      origin: 'user',
      kind: null,
      local_date: null,
      pending: null,
    },
    {
      id: id(402),
      title: null,
      updated_at: iso(0, -2),
      origin: 'proactive',
      kind: 'plan',
      local_date: TODAY,
      pending: null,
    },
  ]
  const chat_messages = [
    { seq: 1, role: 'user', content: 'What should I do first this weekend?', meta: null },
    {
      seq: 2,
      role: 'assistant',
      content: [
        {
          type: 'text',
          text: 'Start with the plumber call — it is overdue — then the garden plan.',
        },
      ],
      meta: null,
    },
  ]
  const previews = [
    {
      session_id: sessionId,
      msg_count: 2,
      last_role: 'assistant',
      last_content: [{ type: 'text', text: 'Start with the plumber call — it is overdue.' }],
      last_meta: null,
    },
    {
      session_id: id(402),
      msg_count: 1,
      last_role: 'assistant',
      last_content: [{ type: 'text', text: 'Your plan for today is ready.' }],
      last_meta: null,
    },
  ]
  const messages = [
    {
      id: id(501),
      kind: 'plan',
      local_date: TODAY,
      title: 'Your plan for today',
      body: 'Report first, errands after lunch.',
      read_at: null,
      created_at: iso(0, -2),
      session_id: id(402),
    },
  ]
  if (empty) {
    // A signed-in account with nothing in it: every list is empty, the schedule keeps only the
    // bare config, and the first-run guide is still to be dismissed.
    const none = {
      tasks: [],
      habits: [],
      daily_state: [],
      history: [],
      chat_sessions: [],
      chat_messages: [],
      messages: [],
      task_reminders: [],
      backups: [],
      assistant_memories: [],
      invites: [],
      push_subscriptions: [],
    }
    return {
      tables: {
        ...none,
        user_schedule: [
          {
            user_id: U,
            timezone: TZ,
            config: { onboarding: {} },
            created_at: iso(-1),
            updated_at: iso(-1),
          },
        ],
      },
      rpc: { chat_list_previews: [] },
    }
  }
  return {
    tables: {
      tasks,
      habits,
      daily_state,
      user_schedule,
      history,
      chat_sessions,
      chat_messages,
      messages,
      task_reminders: [{ task_id: tasks[0].id, offset_minutes: 60 }],
      backups: [
        { id: id(601), label: 'Before the big reorganize', created_at: iso(-2) },
        { id: id(602), label: null, created_at: iso(-9) },
      ],
      assistant_memories: [
        {
          id: id(701),
          content: 'Prefers deep work in the morning.',
          created_at: iso(-10),
          updated_at: iso(-10),
        },
      ],
      invites: [],
      push_subscriptions: [],
    },
    rpc: { chat_list_previews: previews },
  }
}

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': '*',
  'Access-Control-Allow-Methods': 'GET, POST, PATCH, PUT, DELETE, OPTIONS, HEAD',
  'Access-Control-Expose-Headers': 'Content-Range, X-Supabase-Api-Version',
}
const AI_STATUS = {
  paused: false,
  budgetRemainingMicros: 20_000_000,
  limits: { chat: { hour: 30, day: 100 }, plan_my_day: { hour: 10, day: 10 } },
  used: { chat: { hour: 0, day: 0 }, plan_my_day: { hour: 0, day: 0 } },
}

export const scenarios = ['signed-in', 'signed-out', 'empty']

export async function install(context, { scenario }) {
  if (!scenarios.includes(scenario)) throw new Error(`fake backend: unknown scenario ${scenario}`)
  const onboarding = scenario === 'empty'
  const signedIn = scenario !== 'signed-out'
  const fx = makeFixtures({ onboarding, empty: scenario === 'empty' })
  const unknown = []
  await context.route(
    (url) => url.origin === SUPA,
    async (route) => {
      const req = route.request()
      const url = new URL(req.url())
      const method = req.method()
      if (method === 'OPTIONS') return route.fulfill({ status: 204, headers: CORS })
      const json = (status, body, extra = {}) =>
        route.fulfill({
          status,
          headers: { ...CORS, 'content-type': 'application/json', ...extra },
          body: body === undefined ? '' : JSON.stringify(body),
        })
      const p = url.pathname
      if (p === '/auth/v1/user')
        return signedIn ? json(200, USER) : json(401, { message: 'not signed in' })
      if (p === '/auth/v1/token') return json(200, SESSION)
      if (p === '/auth/v1/logout') return route.fulfill({ status: 204, headers: CORS })
      if (p.startsWith('/auth/v1/')) {
        unknown.push(`${method} ${p}`)
        return json(200, {})
      }
      if (p.startsWith('/functions/v1/')) {
        const fn = p.slice('/functions/v1/'.length)
        if (fn === 'ai-status') return json(200, AI_STATUS)
        if (fn === 'admin') return json(200, { isOwner: false })
        unknown.push(`${method} ${p}`)
        return json(200, {})
      }
      if (p.startsWith('/rest/v1/rpc/')) {
        const name = p.slice('/rest/v1/rpc/'.length)
        if (name in fx.rpc) return json(200, fx.rpc[name])
        unknown.push(`RPC ${name}`)
        return json(200, null)
      }
      if (p.startsWith('/rest/v1/')) {
        const table = p.slice('/rest/v1/'.length)
        const wantsObject = (req.headers()['accept'] || '').includes('vnd.pgrst.object')
        if (!(table in fx.tables)) unknown.push(`${method} table ${table}`)
        if (method === 'GET' || method === 'HEAD') {
          let rows = fx.tables[table] ?? []
          if (table === 'chat_messages') {
            const sid = url.searchParams.get('session_id')
            rows = sid === `eq.${fx.tables.chat_sessions[0].id}` ? rows : []
          }
          if (wantsObject)
            return rows.length
              ? json(200, rows[0])
              : json(406, { code: 'PGRST116', message: 'no rows' })
          return json(200, rows, {
            'content-range': `0-${Math.max(rows.length - 1, 0)}/${rows.length}`,
          })
        }
        let body = null
        try {
          body = req.postDataJSON()
        } catch {
          body = null
        }
        const rows = (Array.isArray(body) ? body : body ? [body] : []).map((r) => ({
          id: `00000000-0000-4000-9000-${String(Date.now() % 1e12).padStart(12, '0')}`,
          user_id: U,
          created_at: new Date().toISOString(),
          ...r,
        }))
        if (wantsObject) return json(method === 'POST' ? 201 : 200, rows[0] ?? {})
        return json(method === 'POST' ? 201 : 200, rows)
      }
      unknown.push(`${method} ${p}`)
      return json(200, {})
    },
  )
  await context.addInitScript(
    ({ key, session, signedIn, onboarding }) => {
      try {
        if (!sessionStorage.getItem('__fakeBackendSeeded')) {
          sessionStorage.setItem('__fakeBackendSeeded', '1')
          if (signedIn) localStorage.setItem(key, JSON.stringify(session))
          if (!onboarding) {
            localStorage.setItem('todoclaw.setup-guide.dismissed', '1')
            localStorage.setItem('todoclaw.setup-guide.tour-done', '1')
          }
        }
      } catch {}
    },
    { key: STORAGE_KEY, session: SESSION, signedIn, onboarding },
  )
  return { unknown }
}
