import test from 'node:test'
import assert from 'node:assert/strict'
import { SubmitMachine } from '@deepseek-ai/dsh-client-ui-conversation/src/client/input/machine.ts'
import { createInputSource } from '../integration.js'

test('confirmed route uses native command settlement to commit the draft without a local fallback', async () => {
  const source = createInputSource({ execute: async () => [], translate: key => key, requestId: () => 'id', review: async () => ({ status: 'accepted' }) })
  const rawText = '@ws:Work:\nbody'
  const machine = new SubmitMachine()
  const [{ attempt }] = machine.dispatch({ type: 'enter', draft: rawText, mode: 'queue', occurrences: [], quotes: [], attachmentIds: [] })
  const outcome = await source.matchEnter({ sessionId: 'current' }, rawText.trim(), attempt.signal, { attachments: 0, rawText })
  const [effect] = machine.dispatch({ type: 'adjudicated', attempt, outcome })
  assert.equal(effect.type, 'begin-submit')
  const result = await effect.claim.submit()
  const settlement = machine.dispatch({ type: 'submit-settled', attempt, ok: true, outcome: result, command: effect.claim })
  assert.equal(settlement.some(item => item.type === 'commit-draft'), true)
  assert.equal(settlement.some(item => item.type === 'default-sink'), false)
})
