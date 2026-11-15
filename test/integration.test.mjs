import test from 'node:test'
import assert from 'node:assert/strict'
import { createInputSource } from '../integration.js'
import { RouteReview } from '../review.js'

function sourceFixture() {
  const calls = []
  const source = createInputSource({
    execute: async (request) => { calls.push(request); return [{ kind: 'workspace', label: 'Research', id: 'full-id', mention: '@ws:Research{full-id}', drill: true }] },
    translate: key => key, requestId: () => 'request-id',
    review: async request => { calls.push({ review: request }); return { status: 'accepted', blocks: [] } },
  })
  return { source, calls }
}
test('independent source inserts stable literal clipboard and does not replace local/remote sources', async () => {
  const { source, calls } = sourceFixture()
  assert.equal(source.name, 'workspace-reference')
  const candidates = await source.candidates({ sessionId: 'current' }, { query: 'ws:', signal: new AbortController().signal })
  assert.equal(candidates[0].badge, 'workspace'); assert.equal(candidates[0].icon, 'workspace')
  const outcome = source.onPick({ candidate: candidates[0], action: 'pick' })
  assert.equal(outcome.insert.clipboardText, '@ws:Research{full-id}')
  assert.equal(outcome.insert.ref, outcome.insert.clipboardText)
  assert.equal(await source.codec.serialize(outcome.insert.ref), outcome.insert.ref)
  assert.equal(calls[0].action, 'candidates')
})
for (const text of ['    @Research:\n    code', '\t@Research:\n\tcode', '```\n@Research:\n```', '````\n```\n@Research:\n````', '> @Research:\n> quoted', '`@Research:`', '@Research\\:', 'ordinary @Research/file']) test(`UI submit does not route Markdown ${JSON.stringify(text)}`, async () => {
  const { source, calls } = sourceFixture()
  assert.equal(await source.matchEnter({ sessionId: 'current' }, text.trim(), new AbortController().signal, { attachments: 0, rawText: text }), undefined)
  assert.deepEqual(calls, [])
})
test('missing raw draft fails closed and attachments refuse before planning', async () => {
  const { source, calls } = sourceFixture()
  await assert.rejects(source.matchEnter({ sessionId: 'current' }, '@Research:\nbody', new AbortController().signal, { attachments: 0 }), /rawDraftRequired/u)
  await assert.rejects(source.matchEnter({ sessionId: 'current' }, '@Research:\nbody', new AbortController().signal, { attachments: 1, rawText: '@Research:\nbody' }), /routeAttachments/u)
  assert.deepEqual(calls, [])
})
test('human enter only opens review with complete untrimmed text; never direct send', async () => {
  const { source, calls } = sourceFixture()
  const rawText = '\n@Research:\nbody\n'
  const outcome = await source.matchEnter({ sessionId: 'current' }, rawText.trim(), new AbortController().signal, { attachments: 0, rawText })
  assert.equal(outcome.claim.name, 'workspace-route')
  assert.deepEqual(await outcome.claim.submit(), { kind: 'success' })
  assert.equal(calls.length, 1); assert.equal(calls[0].review.text, rawText); assert.equal(calls[0].review.requestId, 'request-id')
})
test('review plans first, confirms once, returns receipts only after close', async () => {
  const calls = []
  const review = new RouteReview(async request => { calls.push(request); return request.action === 'plan' ? { status: 'planned', blocks: [{ mode: 'new', text: 'body' }] } : { status: 'accepted', blocks: [{ accepted: true }] } })
  review.setAvailable(true)
  const pending = review.open({ sessionId: 'current', requestId: 'id', text: '@Research:\nbody' })
  await Promise.resolve()
  assert.equal(calls.length, 1); assert.equal(calls[0].action, 'plan'); assert.equal(review.getSnapshot().phase, 'review')
  let settled = false; pending.then(() => { settled = true })
  await review.confirm(); await review.confirm()
  assert.equal(calls.length, 2); assert.equal(calls[1].action, 'send'); assert.equal(calls[1].explicit, true)
  assert.equal(settled, false); assert.equal(review.getSnapshot().phase, 'receipt')
  review.close(); assert.equal((await pending).status, 'accepted'); assert.equal(review.getSnapshot(), null)
})
test('closing partial receipts retains the same request ID for an unchanged draft instead of a blind resend', async () => {
  const calls = []
  const review = new RouteReview(async request => {
    calls.push(request)
    return request.action === 'plan' ? { status: 'planned', blocks: [] } : { status: 'partial', blocks: [{ accepted: true }] }
  })
  review.setAvailable(true)
  const request = { sessionId: 'current', requestId: 'original-id', text: '@ws:Work:\nbody' }
  const first = review.open(request)
  await Promise.resolve(); await review.confirm(); review.close()
  await assert.rejects(first, /route-not-complete/u)
  const second = review.open({ ...request, requestId: 'new-id' })
  await Promise.resolve()
  assert.equal(calls.at(-1).requestId, 'original-id')
  review.cancel(); await assert.rejects(second)
})
test('review fails closed without a declared overlay and declaration loss cancels review', async () => {
  const review = new RouteReview(async () => ({ status: 'planned', blocks: [] }))
  await assert.rejects(review.open({ sessionId: 's', requestId: 'id', text: 'text' }), /unavailable/u)
  review.setAvailable(true)
  const pending = review.open({ sessionId: 's', requestId: 'id', text: 'text' })
  await Promise.resolve(); review.setAvailable(false)
  await assert.rejects(pending, /cancelled/u)
})
test('review cancel and dispose never send', async () => {
  for (const action of ['cancel', 'dispose']) {
    const calls = []
    const review = new RouteReview(async request => { calls.push(request); return { status: 'planned', blocks: [] } })
    review.setAvailable(true)
  const pending = review.open({ sessionId: 'current', requestId: action, text: '@Research:\nbody' })
    await Promise.resolve(); review[action]()
    await assert.rejects(pending)
    assert.equal(calls.length, 1)
  }
})
