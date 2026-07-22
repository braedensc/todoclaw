// index.ts — the scenario registry. One import per family file; each file is owned by exactly one
// author (parallel authoring never edits a shared file). run.ts asserts id uniqueness at load.

import type { Scenario } from '../lib/types.ts'

import { scenarios as lifecycleIntent } from './chat/lifecycle-intent.ts'
import { scenarios as taskCrud } from './chat/task-crud.ts'
import { scenarios as remindersHabits } from './chat/reminders-habits.ts'
import { scenarios as memoryPrefs } from './chat/memory-prefs.ts'
import { scenarios as safetyInjection } from './chat/safety-injection.ts'
import { scenarios as personasComplex } from './chat/personas-complex.ts'
import { scenarios as planRules } from './plan/plan-rules.ts'
import { scenarios as planPersonas } from './plan/plan-personas.ts'
import { scenarios as planEdgeCases } from './plan/plan-edge-cases.ts'
import { scenarios as recapCore } from './recap/recap-core.ts'
import { scenarios as recapVaried } from './recap/recap-varied.ts'

export const ALL_SCENARIOS: Scenario[] = [
  ...lifecycleIntent,
  ...taskCrud,
  ...remindersHabits,
  ...memoryPrefs,
  ...safetyInjection,
  ...personasComplex,
  ...planRules,
  ...planPersonas,
  ...planEdgeCases,
  ...recapCore,
  ...recapVaried,
]
