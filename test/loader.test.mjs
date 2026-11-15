import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, writeFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Context, FiberState } from '@deepseek-ai/cordis'
import Loader from '@deepseek-ai/cordis-plugin-loader'
import Include from '@deepseek-ai/cordis-plugin-include'
import { Peer } from '@deepseek-ai/dsh-client-connection'

// A genuine Loader/YAML composition, not an in-process manual plugin tree.
test('Loader YAML mounts production plugin, strict owner API, native fs alias and explicit fake admission', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'dsh-reference-loader-'))
  const previous = process.env.WORKSPACE_REFERENCE_FIXTURE_ROOT
  process.env.WORKSPACE_REFERENCE_FIXTURE_ROOT = dir
  const ctx = new Context()
  try {
    await writeFile(join(dir, 'fixture.txt'), 'real filesystem content')
    await ctx.plugin(Loader)
    ctx.loader.builtins.include = Include
    await ctx.loader.create({ name: 'cordis:include', config: { path: new URL('./loader-fixtures/cordis.yml', import.meta.url).href } })
    await ctx.loader.await()
    const entries = [...ctx.loader.entries()]
    for (const id of ['typert', 'remote-access', 'gateway', 'fs', 'workspace-reference']) {
      const entry = entries.find(item => item.options.id === id)
      assert.ok(entry, id); assert.equal(entry.fiber.state, FiberState.ACTIVE, id)
    }
    const owner = new Peer(ctx, { principal: { kind: 'owner' } })
    const guest = new Peer(ctx, { principal: { kind: 'workspace-reference-fixture-guest' } })
    ctx.remoteAccess.registerPolicy('workspace-reference-fixture-guest', { bindings: () => [{ resource: { kind: 'global' }, role: { name: 'allow-fixture', resource: 'global', actions: ['workspaceReferences/execute'] } }] })
    const invoke = (peer, request) => ctx.typertGateway.invoke({ peer, namespace: 'workspaceReferences', method: 'execute', args: { request } })
    const identity = { sessionId: 'fixture-session' }
    const candidates = await invoke(owner, { action: 'candidates', ...identity, query: 'ws:' })
    assert.equal(candidates.ok, true); assert.equal(candidates.value[0].mention, '@ws:Research{fixture-workspace}')
    const target = await ctx.fs.resolve('@ws:Research{fixture-workspace}/fixture.txt')
    assert.equal(await ctx.fs.readText(target), 'real filesystem content')
    assert.equal(target.targetKey, (await ctx.fs.resolve(join(dir, 'fixture.txt'))).targetKey)
    const fixture = ctx.get('workspaceReferenceFixture')
    assert.equal(fixture.calls.create, 0); assert.equal(fixture.calls.resolve, 0)
    const denied = await invoke(guest, { action: 'candidates', ...identity, query: 'ws:' })
    assert.equal(denied.ok, false); assert.equal(denied.error.code, 'owner-required')
    await assert.rejects(invoke(owner, { action: 'candidates', ...identity, query: '', extra: 'undeclared' }))
    const request = { ...identity, requestId: 'loader-admission', text: '@ws:Research{fixture-workspace}/s:Talk{fixture-session}:\nhello' }
    const plan = await invoke(owner, { action: 'plan', ...request })
    assert.equal(plan.value.delivered, false); assert.equal(fixture.calls.resolve, 0)
    const receipt = await invoke(owner, { action: 'send', ...request, explicit: true, mode: 'queue' })
    assert.equal(receipt.value.status, 'accepted'); assert.equal(fixture.calls.create, 0)
    assert.equal(fixture.messages.length, 1); assert.equal(fixture.messages[0].message.source.kind, 'workspace-reference')
    assert.equal(receipt.value.blocks[0].messageId, fixture.messages[0].message.id)
    await invoke(owner, { action: 'send', ...request, explicit: true, mode: 'queue' })
    assert.equal(fixture.messages.length, 1)
    const entry = entries.find(item => item.options.id === 'workspace-reference')
    await ctx.registry.delete(entry.fiber.runtime.callback)
    assert.equal(ctx.get('workspaceReferences'), undefined)
    assert.equal(ctx.typert.local.get('workspaceReferences/execute'), undefined)
    assert.equal((await ctx.fs.normalizePathAlias('@ws:Research/fixture.txt')).path, '@ws:Research/fixture.txt')
  } finally {
    await ctx.fiber.dispose()
    if (previous === undefined) delete process.env.WORKSPACE_REFERENCE_FIXTURE_ROOT
    else process.env.WORKSPACE_REFERENCE_FIXTURE_ROOT = previous
    await rm(dir, { recursive: true, force: true })
  }
})
