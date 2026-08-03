// db-types.ts — the seed/snapshot shapes, re-exported from types.ts. Split so db.ts (which pulls
// in npm:postgres) never has to be imported just for its types (keeps self-tests dependency-light).

export type { DbSnapshot, DbTaskRow, SeedIds, SeedSpec } from './types.ts'

export interface EvalEnvLike {
  apiUrl: string
  anonKey: string
  serviceRoleKey: string
}
