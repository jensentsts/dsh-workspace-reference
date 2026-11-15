import test from 'node:test'
import assert from 'node:assert/strict'
import { fixture, signal } from './fixtures.mjs'
import { RoutePlanner } from '../routes.js'
import { RouteDelivery } from '../delivery.js'
import { parseRequest, parseOutcome } from '../rpc.js'

function setup(options = {}) {
  const { refs, workspaces } = fixture(options)
  const planner = new RoutePlanner(refs, refs.options)
  const calls = []
  const messages = []
  const controller = {
    async create(request) { calls.push(['create', request]); return { sessionId: `new-${calls.length}` } },
    async resolveAgent(id) { calls.push(['resolveAgent', id]); return { agent: { followup(message) { messages.push([id, 'queue', message]) }, steer(message) { messages.push([id, 'steer', message]) } } } },
  }
  let n = 0
  const router = new RouteDelivery(planner, controller, refs.options, message => ({ ...message, id: `message-${++n}` }))
  const request = { source: 'human', explicit: true, mode: 'queue', requestId: 'unique', sessionId: 'current-session', text: '@ws:ws-alpha:\nnew\n@ws:ws-alpha/s:方案讨论{session-one}:\nexisting\n@:\nlocal\n' }
  return { refs, planner, router, request, calls, messages, controller, workspaces }
}

test('plan resolves entire submission without create, resume, send or current fallback', async () => {
  const f = setup()
  const result = await f.planner.plan(f.request)
  assert.equal(result.status, 'planned'); assert.equal(result.delivered, false)
  assert.deepEqual(result.blocks.map(block => block.mode), ['new', 'existing', 'current'])
  assert.deepEqual(f.calls, [])
  const bad = await f.planner.plan({ ...f.request, requestId: 'bad', text: '@ws:missing:\nfirst\n@ws:ws-alpha:\nsecond' })
  assert.equal(bad.status, 'rejected'); assert.equal(bad.blocks[0].status, 'rejected'); assert.equal(bad.blocks[1].mode, 'new')
})
test('session chip route reviews a named target and pins its exact identity', async () => {
  const f = setup()
  f.workspaces[0].title = 'QQ'
  const request = { ...f.request, text: '@ws:QQ{ws-alpha}/s:方案讨论{session-one} :\n正文' }
  const plan = await f.planner.plan(request)
  assert.equal(plan.status, 'planned')
  assert.equal(plan.blocks[0].workspaceTitle, 'QQ')
  assert.equal(plan.blocks[0].sessionTitle, '方案讨论')
  assert.equal(plan.blocks[0].sessionId, 'session-one')
  const receipt = await f.router.send(request)
  assert.equal(receipt.blocks[0].sessionTitle, '方案讨论')
  assert.equal(receipt.blocks[0].sessionId, 'session-one')
  assert.equal(f.messages[0][2].content[0].text, '正文')
})
test('ordinary mentions and assistant output never route', async () => {
  const f = setup()
  assert.equal((await f.planner.plan({ ...f.request, text: 'see @ws:ws-alpha/s:Notes' })).status, 'not-routed')
  assert.equal((await f.planner.plan({ ...f.request, source: 'assistant' })).status, 'not-routed')
  assert.equal((await f.router.send({ ...f.request, source: 'assistant' })).status, 'rejected')
  assert.equal((await f.router.send({ ...f.request, explicit: false })).status, 'rejected')
  assert.equal(f.messages.length, 0)
})
test('IDs identify plans, repeat joins exact result, different content conflicts', async () => {
  const f = setup()
  const first = await f.planner.plan(f.request)
  assert.deepEqual(await f.planner.plan(f.request), first)
  assert.equal((await f.planner.plan({ ...f.request, text: 'changed' })).status, 'conflict')
  first.blocks[0].text = 'mutated'
  assert.notEqual((await f.planner.plan(f.request)).blocks[0].text, 'mutated')
})
test('explicit sends create only new route and admit distinct real messages with producer source', async () => {
  const f = setup()
  const result = await f.router.send(f.request)
  assert.equal(result.status, 'accepted'); assert.equal(result.completed, false)
  assert.equal(f.calls.filter(([kind]) => kind === 'create').length, 1)
  assert.equal(f.messages.length, 3)
  assert.equal(result.blocks[0].created, true); assert.equal(result.blocks[1].created, false)
  assert.equal(f.messages[1][0], 'session-one'); assert.equal(f.messages[2][0], 'current-session')
  assert.equal(f.messages[0][2].source.kind, 'workspace-reference')
  assert.equal(f.messages[0][2].source.originSessionId, 'current-session')
  assert.equal(result.blocks[0].messageId, f.messages[0][2].id)
  assert.deepEqual(await f.router.send(f.request), result)
  assert.equal(f.messages.length, 3)
})
test('steer is explicit and no accepted block is replayed on content conflict', async () => {
  const f = setup()
  await f.router.send({ ...f.request, mode: 'steer' })
  assert.equal(f.messages[0][1], 'steer')
  assert.equal((await f.router.send(f.request)).status, 'conflict')
  assert.equal(f.messages.length, 3)
})
test('failed complete plan causes zero side effects', async () => {
  const f = setup()
  const value = await f.router.send({ ...f.request, text: '@ws:ws-alpha:\nfirst\n@ws:missing:\nsecond' })
  assert.equal(value.status, 'rejected'); assert.equal(f.calls.length, 0)
})
test('created blank is disclosed if resume fails; later blocks are cancelled not rerouted', async () => {
  const f = setup()
  f.controller.resolveAgent = async () => ({ error: Object.assign(new Error('writer-held'), { code: 'session/writer-held' }) })
  const result = await f.router.send(f.request)
  assert.equal(result.status, 'partial'); assert.equal(result.blocks[0].created, true); assert.equal(result.blocks[0].sessionId, 'new-1')
  assert.equal(result.blocks[0].phase, 'resolve'); assert.equal(result.blocks[1].status, 'cancelled'); assert.equal(f.messages.length, 0)
})
test('admission unknown is retained and never blindly retried', async () => {
  const f = setup()
  let count = 0
  f.controller.resolveAgent = async () => ({ agent: { followup() { count++; throw new Error('uncertain') } } })
  const result = await f.router.send(f.request)
  assert.equal(result.blocks[0].status, 'unknown')
  await f.router.send(f.request); assert.equal(count, 1)
})
test('cancel after creation reports retained new session and no admission', async () => {
  const f = setup()
  const abort = new AbortController()
  f.controller.create = async () => { abort.abort(); return { sessionId: 'retained-blank' } }
  const result = await f.router.send(f.request, { signal: abort.signal })
  assert.equal(result.blocks[0].status, 'cancelled'); assert.equal(result.blocks[0].created, true)
  assert.equal(result.blocks[0].sessionId, 'retained-blank'); assert.equal(f.messages.length, 0)
  assert.equal(f.calls.filter(call => call[0] === 'resolve').length, 0)
})
test('capacity fails closed rather than evicting admitted idempotency facts', async () => {
  const f = setup({ maxPlans: 1 })
  await f.router.send(f.request)
  assert.equal((await f.router.send({ ...f.request, requestId: 'second' })).reason, 'idempotency-capacity-reached')
  await f.router.dispose()
  assert.equal((await f.router.send(f.request)).reason, 'router-disposed')
})
test('an outstanding reviewed plan is never evicted and re-resolved by name', async () => {
  const f = setup({ maxPlans: 1 })
  const request = { ...f.request, text: '@ws:Other:\nbody' }
  await f.planner.plan(request)
  assert.equal((await f.planner.plan({ ...request, requestId: 'second' })).reason, 'plan-capacity-reached')
  f.workspaces[1].id = 'replacement-id'
  assert.equal((await f.router.send(request)).reason, 'route-target-changed')
  assert.equal(f.calls.length, 0)
})
test('send revalidates full IDs rather than following a renamed name to another workspace', async () => {
  const f = setup()
  const request = { ...f.request, text: '@ws:Other:\nbody' }
  await f.planner.plan(request)
  f.workspaces[1].id = 'replacement-id'
  const result = await f.router.send(request)
  assert.equal(result.reason, 'route-target-changed'); assert.equal(f.calls.length, 0)
})
test('session membership removal between plan and send rejects without cross-workspace delivery', async () => {
  const f = setup()
  const request = { ...f.request, text: '@ws:ws-alpha/s:Notes:\nbody' }
  await f.planner.plan(request)
  f.workspaces[0].sessionIds = f.workspaces[0].sessionIds.filter(id => id !== 'session-two')
  assert.equal((await f.router.send(request)).reason, 'route-target-changed')
  assert.equal(f.calls.length, 0)
})
test('renaming pinned IDs still targets the original session, not a new same-name item', async () => {
  const f = setup()
  const request = { ...f.request, text: '@ws:Other:\nbody' }
  await f.planner.plan(request)
  f.workspaces[1].title = 'Renamed'
  f.workspaces.push({ id: 'new-same-name', title: 'Other', path: '/projects/alpha', sessionIds: [] })
  const result = await f.router.send(request)
  assert.equal(result.status, 'accepted'); assert.equal(f.calls[0][1].workspaceId, 'ws-beta')
})
test('strict request/result codecs reject undeclared fields, bad modes and oversized input', () => {
  for (const value of [null, {}, { action: 'candidates', sessionId: 'x', query: '', extra: true }, { action: 'send', sessionId: 'x', text: 'a', requestId: 'x', explicit: false, mode: 'queue' }, { action: 'send', sessionId: 'x', text: 'a', requestId: 'x', explicit: true, mode: 'inject' }]) assert.throws(() => parseRequest(value))
  assert.equal(parseRequest({ action: 'candidates', sessionId: 'x', query: '' }).query, '')
  assert.throws(() => parseOutcome({ ok: true, value: 'x'.repeat(2097152) }))
  assert.throws(() => parseOutcome({ ok: true, private: 'leak' }))
})
