import test from 'node:test'
import assert from 'node:assert/strict'
import { Context, Service } from '@deepseek-ai/cordis'
import { LocalFileSystem } from '@deepseek-ai/dsh-fs-local'
import { agentEvents } from '@deepseek-ai/dsh-agent'
import { createUserMessage } from '@deepseek-ai/dsh-llm'
import { SessionReferenceResolver } from '@deepseek-ai/dsh-session-reference'
import { mkdtemp, mkdir, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import WorkspaceReferenceService from '../index.js'

async function setup(t) {
  const dir = await mkdtemp(join(tmpdir(), 'dsh-workspace-service-'))
  const root = join(dir, 'registered'); await mkdir(root)
  const ctx = new Context()
  const contributions = new Set()
  let prompted = 0
  class Registry extends Service { constructor(scope) { super(scope, 'workspaceRegistry') } list() { return [{ id: 'full-id', title: 'Research', path: root, sessionIds: ['session-one'] }] } }
  class Agents extends Service { constructor(scope) { super(scope, 'agents') } list() { return [] } get() { return undefined } }
  const reads = []
  class Query extends Service {
    constructor(scope) { super(scope, 'sessionQuery') }
    async readTitleSnapshot(id) { return { session: { id, cwd: dir }, title: { title: id } } }
    async readTitleSnapshots(ids) { return ids.map(id => ({ sessionId: id, status: 'fulfilled', value: { session: { id }, title: { title: 'Talk' } } })) }
    async readSurface(id) {
      reads.push(id)
      return {
        session: { id, cwd: root, version: 4 }, capturedThroughSeq: 2,
        events: [
          { type: 'user/message', data: createUserMessage({ source: { kind: 'user' }, content: [{ type: 'text', text: 'Source question' }] }) },
          { type: 'assistant/message', data: { message: { content: [{ type: 'thinking', thinking: 'Hidden reasoning' }, { type: 'text', text: 'Source answer' }] } } },
        ],
      }
    }
  }
  class Controller extends Service { constructor(scope) { super(scope, 'sessionController') } async create() { prompted++; return { sessionId: 'new' } } async resolveAgent() { throw new Error('No actual admission in lifecycle test') } }
  class Typert extends Service { constructor(scope) { super(scope, 'typert') } register(value) { contributions.add(value); return this.ctx.effect(() => () => contributions.delete(value)) } }
  for (const plugin of [Registry, Agents, Query, Controller, Typert]) await ctx.plugin(plugin)
  await ctx.plugin(LocalFileSystem, { cwd: dir })
  const provider = ctx.fs
  const providerMethod = Object.getOwnPropertyDescriptor(provider, 'resolve')
  const fiber = await ctx.plugin(WorkspaceReferenceService)
  t.after(async () => { await ctx.fiber.dispose(); await rm(dir, { recursive: true, force: true }) })
  return { ctx, dir, root, fiber, contributions, providerMethod, reads, prompted: () => prompted }
}

test('Cordis service uses public registrar without mutating provider method; unload removes alias and descriptor', async t => {
  const f = await setup(t)
  assert.ok(f.ctx.workspaceReferences)
  assert.deepEqual(Object.getOwnPropertyDescriptor(f.ctx.fs, 'resolve'), f.providerMethod)
  assert.equal(Object.hasOwn(f.ctx.fs, 'resolve'), false)
  assert.equal((await f.ctx.fs.resolve('@ws:Research{full-id}/a')).displayPath, join(f.root, 'a'))
  assert.equal(f.contributions.size, 1)
  await f.fiber.dispose()
  assert.equal(f.ctx.get('workspaceReferences'), undefined)
  assert.equal(f.contributions.size, 0)
  assert.equal((await f.ctx.fs.normalizePathAlias('@ws:Research/a')).path, '@ws:Research/a')
})
test('cold candidates and plan never create or resume; namespace rejects undeclared JSON', async t => {
  const f = await setup(t)
  const result = await f.ctx.workspaceReferences.execute({ action: 'candidates', sessionId: 'current', query: 'ws:' }, new AbortController().signal)
  assert.equal(result.ok, true); assert.equal(result.value[0].kind, 'workspace')
  const plan = await f.ctx.workspaceReferences.execute({ action: 'plan', sessionId: 'current', requestId: 'plan-id', text: '@ws:Research:\nbody' }, new AbortController().signal)
  assert.equal(plan.value.delivered, false); assert.equal(f.prompted(), 0)
  await assert.rejects(f.ctx.workspaceReferences.execute({ action: 'candidates', sessionId: 'current', query: '', undeclared: true }), /undeclared/u)
})

test('owner workspace session mention attaches the official snapshot without resuming the source', async t => {
  const f = await setup(t)
  await f.ctx.plugin(SessionReferenceResolver, { maxReferenceBytes: 2048 })
  const agent = { id: 'current', ctx: f.ctx, session: { id: 'current', header: { cwd: f.dir } } }
  const events = agentEvents(f.ctx, agent)
  const input = (text, source = { kind: 'user' }) => createUserMessage({ source, content: [{ type: 'text', text }] })
  const enter = (...messages) => events.waterfall('agent/pre-step', {
    turn: 1, step: 1, messages, signal: new AbortController().signal,
    modelSelection: { provider: 'mock', model: 'mock' },
  }, async () => ({ kind: 'enter', messages }))
  const direct = input('Read @ws:Research/s:Talk and @ws:Research{full-id}/s:Talk{session-one}')
  const decision = await enter(direct)
  assert.equal(decision.messages[0], direct)
  assert.deepEqual(f.reads, ['session-one'])
  const snapshot = decision.messages[1]
  assert.equal(snapshot.source.kind, 'session-reference')
  assert.equal(snapshot.source.references[0].sessionId, 'session-one')
  assert.match(snapshot.content[0].text, /Source question.*Source answer/su)
  assert.doesNotMatch(snapshot.content[0].text, /Hidden reasoning/u)
  const guest = input('@ws:Research/s:Talk', { kind: 'user', rpcId: 'foreign', principal: { kind: 'guest' } })
  const literal = input('~~~\n@ws:Research/s:Talk\n~~~')
  assert.equal((await enter(guest)).messages.length, 1)
  assert.equal((await enter(guest, direct)).messages.length, 2)
  assert.equal((await enter(literal)).messages.length, 1)
  assert.deepEqual(f.reads, ['session-one'])
  const routeSource = { kind: 'workspace-reference', originSessionId: 'owner-session', requestId: 'confirmed-route', blockIndex: 0 }
  const routed = input('Summarize @ws:Research/s:Talk', routeSource)
  const routedDecision = await enter(routed)
  assert.equal(routedDecision.messages[0], routed)
  assert.equal(routedDecision.messages[1].source.references[0].sessionId, 'session-one')
  const invalidRouteSource = input('@ws:Research/s:Talk', { ...routeSource, blockIndex: -1 })
  assert.equal((await enter(invalidRouteSource)).messages.length, 1)
  assert.deepEqual(f.reads, ['session-one', 'session-one'])
  assert.equal(f.prompted(), 0)
})
