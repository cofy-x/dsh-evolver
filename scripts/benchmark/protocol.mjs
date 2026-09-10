/** v2 repairs result projection and describes the tool contract; v1 tasks/grader remain unchanged. */
export const PROTOCOL_VERSION = 'recovery-protocol-v2'
/** The frugal v1 harness keeps its original schema/budgets; only its renderer is repaired. */
export const LEGACY_PROTOCOL_VERSION = 'recovery-protocol-v1-render-v2'
export const LEGACY_TOOL_SPEC = Object.freeze({
  name: 'bench_apply',
  description:
    'Inspect record rules/current state or commit a JSON payload to the isolated record.',
  parameters: {
    action: { type: 'string', required: true },
    payload: { type: 'string', required: true },
  },
})
export const TOOL_SPEC = Object.freeze({
  name: 'bench_apply',
  description:
    'Inspect record rules/current state or commit a JSON payload to the isolated record. inspect uses an empty payload string. commit uses a JSON object encoded as a string: for a revision record, {"revision":integer,"value":string}; for a format record, {"value":string}; for a queue, {"items":string[]}. Inspect reports the current constraints. A rejected commit makes no changes. Only a successful commit changes state.',
  parameters: {
    action: {
      type: 'string',
      enum: ['inspect', 'commit'],
      required: true,
      description: 'Read rules/state or write the record.',
    },
    payload: {
      type: 'string',
      required: true,
      description:
        'Empty string for inspect; JSON-encoded object for commit, following the tool description and reported rules.',
    },
  },
})

/** DSH passes arguments first and the validated body result second. */
export const renderResult = (_args, value) => [{ type: 'text', text: value }]

/** Only used to reproduce the retained v1 renderer defect without real credentials. */
export const legacyRender = (args) => [{ type: 'text', text: args }]
