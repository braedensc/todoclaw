// capabilities/registry.ts — the single source of truth for what BabyClaw (and any future MCP
// server) can do. Assemble every capability, plus derived lookups. Nothing Anthropic/MCP-specific
// lives here; adapters (../chat-tools.ts) turn this into their wire format. See ./README.md.

import type { Capability } from './types.ts'
import { taskCapabilities } from './tasks.ts'
import { habitCapabilities } from './habits.ts'
import { planCapabilities } from './plan.ts'

export const CAPABILITIES: Capability[] = [
  ...taskCapabilities,
  ...habitCapabilities,
  ...planCapabilities,
]

export const capabilityByName: Map<string, Capability> = new Map(
  CAPABILITIES.map((c) => [c.name, c]),
)

// Server-side destructive classification — the set of capabilities that require human
// confirmation before executing. Derived from each capability's own flag; the model's belief
// about whether a call is destructive is never trusted.
export const DESTRUCTIVE: Set<string> = new Set(
  CAPABILITIES.filter((c) => c.destructive).map((c) => c.name),
)

export type { Capability, CapabilityContext, CapabilityResult, MutationDomain } from './types.ts'
