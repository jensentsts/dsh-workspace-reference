import test from 'node:test'
import assert from 'node:assert/strict'
import { Session, SessionId } from '@deepseek-ai/dsh-session'
import { createUserMessage } from '@deepseek-ai/dsh-llm'

test('routed producer source and real message ID survive official Session event JSON replay', () => {
  const source = { kind: 'workspace-reference', originSessionId: 'origin-full-id', requestId: 'route-id', blockIndex: 2 }
  const message = createUserMessage({ content: [{ type: 'text', text: 'confirmed routed text' }], source })
  const session = Session.create(SessionId('route-target'))
  session.append('user/message', message, { surfaceOp: 'append' })
  const snapshot = JSON.parse(JSON.stringify(session.snapshotEvents()))
  const replay = Session.create(SessionId('route-target-replay'), snapshot)
  const [derived] = replay.deriveMessages()
  assert.equal(derived.id, message.id)
  assert.deepEqual(derived.source, source)
  assert.deepEqual(derived.content, [{ type: 'text', text: 'confirmed routed text' }])
})
