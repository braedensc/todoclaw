// Mock "Plan My Day" for the legacy EisenClaw UI runner.
//
// This file is NOT run on its own. scripts/legacy-ui.ts reads its source and appends it into the
// temp .cjs copy of the reference server (planning/eisenclaw-export/scripts/planner-server.js),
// then rewrites the server's no-API-key branch to call __legacyUiMockPlan(parsed) instead of
// returning a 500. That lets the Plan My Day UX render fully offline — without an Anthropic key —
// so we can see what the feature looks like while porting. When a real key IS present (e.g. on the
// original Lightsail box), the server keeps its real behavior; the mock is only the no-key path.
//
// It derives a plausible plan from the same payload the real endpoint receives (grid task lines +
// habit lines), so the card looks like real output. It is deterministic — no AI, no network. Edit
// freely; this lives in the repo, not under planning/. The returned shape matches what the client
// renders (see planner.html): { headline, availableTime?, bigRock?, smallRocks?, habitNote? } where
// a rock is { task, why, duration?, when? }.

function __legacyUiMockPlan(parsed) {
  const taskLines = String((parsed && parsed.taskLines) || '')
  const habitLines = String((parsed && parsed.habitLines) || '')
  const dayOfWeek = (parsed && parsed.dayOfWeek) || 'today'

  // Parse: - "TEXT" | importance NN/100 | urgency NN/100 | quadrant: NAME[ | due in D day(s)]
  const lineRe =
    /^- "(.+?)" \| importance (\d+)\/100 \| urgency (\d+)\/100 \| quadrant: ([^|]+?)(?: \| due in (\d+) day\(s\))?$/
  const tasks = []
  for (const line of taskLines.split('\n')) {
    const m = line.match(lineRe)
    if (!m) continue
    const importance = Number(m[2])
    const urgency = Number(m[3])
    const dueDays = m[5] === undefined ? null : Number(m[5])
    // Mirror the app's weighting: importance above urgency, plus a nudge for near-due items.
    const score = importance * 0.55 + urgency * 0.45 + (dueDays !== null && dueDays <= 2 ? 18 : 0)
    tasks.push({ text: m[1], importance, urgency, quadrant: m[4].trim(), dueDays, score })
  }
  tasks.sort((a, b) => b.score - a.score)

  const durationFor = (t) =>
    t.importance >= 66 ? '60–90 min' : t.importance >= 40 ? '30–45 min' : '15–20 min'
  const whyFor = (t) => {
    const bits = []
    if (t.dueDays !== null)
      bits.push(t.dueDays <= 0 ? 'due today' : 'due in ' + t.dueDays + ' day(s)')
    bits.push(t.quadrant.toLowerCase() + ' quadrant')
    if (t.importance >= 66) bits.push('high importance')
    return bits.join(' · ')
  }

  const habits = habitLines
    .split('\n')
    .map((l) => l.replace(/^- /, '').trim())
    .filter(Boolean)

  const big = tasks[0] || null
  const smalls = tasks.slice(1, 4)

  const plan = {
    headline: big
      ? 'Anchor your ' + dayOfWeek + ' around one big rock, then chip away at the rest.'
      : 'A light ' + dayOfWeek + ' — nothing urgent on the grid right now.',
    availableTime: 'Sample preview · local mock (the real Plan My Day needs an Anthropic key)',
  }
  if (big) {
    plan.bigRock = {
      task: big.text,
      why: whyFor(big),
      duration: durationFor(big),
      when: 'Morning, first focus block',
    }
  }
  plan.smallRocks = smalls.map((t, i) => ({
    task: t.text,
    why: whyFor(t),
    duration: durationFor(t),
    when: i === 0 ? 'Late morning' : 'Afternoon',
  }))
  if (habits.length) {
    const shown = habits.slice(0, 3).join(', ')
    const extra = habits.length > 3 ? ', +' + (habits.length - 3) + ' more' : ''
    plan.habitNote = 'Keep your streak: ' + shown + extra + '.'
  }
  return plan
}
