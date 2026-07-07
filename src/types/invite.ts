import { z } from 'zod'

// Invite redemption input (ADR-0030). Mirrors the redeem-invite Edge Function's server-side Zod
// schema so the client rejects obviously-bad input before the round-trip; the function re-validates
// (defense-in-depth). The code is a high-entropy token, not secret-formatted, so we only bound its
// length — the real check is the atomic DB claim.
export const RedeemInviteSchema = z.object({
  code: z.string().trim().min(1, 'Enter your invite code').max(64),
  email: z.string().trim().email('Enter a valid email address'),
  password: z.string().min(8, 'Password must be at least 8 characters').max(128),
})

export type RedeemInvite = z.infer<typeof RedeemInviteSchema>
