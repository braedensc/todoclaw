// mock.ts — a canned Anthropic stand-in for pipeline verification (`--mock`). Zero network, zero
// spend: generatePlan/generateRecap/judge accept any structurally-compatible client, so this lets
// the whole plan/recap pipeline (fixture → buildPlanRequest → generate → checks → report) run
// end-to-end without a key. Mock output is generic, so scenario checks are SKIPPED in mock mode —
// this proves the plumbing, not the model.

interface MockMessageParams {
  tool_choice?: { name?: string }
  messages?: Array<{ content: unknown }>
}

export function mockAnthropic() {
  return {
    messages: {
      // deno-lint-ignore require-await
      create: async (params: MockMessageParams) => {
        const tool = params.tool_choice?.name ?? 'none'
        let input: unknown
        if (tool === 'emit_plan') {
          input = {
            headline: 'Mock plan — pipeline check only',
            availableTime: '~2h',
            bigRock: null,
            smallRocks: [],
            habitNote: '',
          }
        } else if (tool === 'emit_recap') {
          input = { body: 'A quiet mock evening — nothing real was judged.\n— BabyClaw 🐾' }
        } else if (tool === 'emit_judgment') {
          input = {
            verdict: 'pass',
            scores: { correctness: 3, faithfulness: 3, tone: 3, brevity: 3 },
            reasoning: 'mock judgment (pipeline check)',
          }
        } else {
          input = {}
        }
        return {
          content: [{ type: 'tool_use', id: 'mock', name: tool, input }],
          usage: { input_tokens: 0, output_tokens: 0 },
        }
      },
    },
  }
}
