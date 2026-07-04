import { useAiChat } from './use-ai-chat'
import { useAiStatus } from './use-ai-status'

// One chat conversation, shared across the shell (B8). The signed-in app now surfaces BabyClaw in
// two places that MUST share a single conversation: the inline one-line reply under the input
// widget (BabyClaw mode) and the full-history popup (ChatPanel). Composing the existing chat hook
// + AI status once here and threading the result to both keeps them in lockstep — sending inline
// and then opening the popup shows the same history. This is just the existing chat backend
// (use-ai-chat) hoisted a level; no new model integration.
export function useChatController() {
  const chat = useAiChat()
  const status = useAiStatus()
  return { ...chat, paused: status.data?.paused ?? false }
}

export type ChatController = ReturnType<typeof useChatController>
