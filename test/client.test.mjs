import test from 'node:test'
import assert from 'node:assert/strict'
import vm from 'node:vm'
import { readFile } from 'node:fs/promises'

// Exercise the actual lazy Client artifact through documented public services.
test('built Client mounts reference chips and route review, preserving stable copy while displaying names', async () => {
  const text = await readFile(new URL('../client.js', import.meta.url), 'utf8')
  let plugin
  const React = { createElement(type, props, ...children) { return { type, props, children } }, Fragment: Symbol('fragment') }
  function ReferenceChip() {}
  vm.runInNewContext(text, {
    window: { __ModuleLoader__: { load(definition) {
      assert.equal(definition.id, 'dsh-workspace-reference')
      plugin = definition.factory(specifier => specifier === 'react' ? React : specifier === '@deepseek-ai/dsh-client-ui-primitives' ? { Modal() {}, ReferenceChip } : assert.fail(`unexpected import ${specifier}`))
    } } },
    console, AbortController, Promise, crypto: { randomUUID: () => 'test-request' }, structuredClone,
  })
  const stops = []
  const sources = new Set()
  const slots = new Map()
  const rules = new Map()
  const calls = []
  let dictionaries = 0
  const scope = {
    effect(effect) { const stop = effect(); if (stop) stops.push(stop); return stop },
    locale: { register() { dictionaries++; return () => dictionaries-- }, bind() { return key => key } },
    inputTriggers: { registerSource(source) { sources.add(source); return () => sources.delete(source) } },
    uiConversation: { userText: { register(rule) { rules.set(rule.id, rule); stops.push(() => rules.delete(rule.id)) } } },
    slots: {
      inject(name, install) { assert.ok(['shell.overlay', 'conversation.user.text.node'].includes(name)); for (const stop of install()) { if (stop) stops.push(stop) } },
      register(options, component) { const id = options.id ?? options.key; slots.set(id, component); assert.equal(typeof component, 'function'); return () => slots.delete(id) },
    },
    'remote.workspaceReferences': { async execute(request) { calls.push(request); return { ok: true, value: { ok: true, value: [
      { kind: 'workspace', label: 'Research', id: 'full-id', mention: '@ws:Research{full-id}', drill: true },
      { kind: 'session', label: '问候', id: 'full-session-id', workspaceTitle: 'QQ', mention: '@ws:QQ{full-ws-id}/s:问候{full-session-id}' },
    ] } } } },
  }
  const ctx = { ...scope, remote: { async $mount(contribution) { assert.equal(contribution.package, 'dsh-workspace-reference') } }, inject(names, apply) { assert.equal(names[0], 'remote.workspaceReferences'); apply(scope) } }
  await plugin.apply(ctx)
  assert.equal(sources.size, 1); assert.equal(slots.size, 2); assert.equal(dictionaries, 1)
  const source = [...sources][0]
  const candidates = await source.candidates({ sessionId: 'current' }, { query: '', signal: new AbortController().signal })
  assert.equal(candidates[0].badge, 'workspace')
  assert.equal(source.onPick({ candidate: candidates[0], action: 'pick' }).insert.clipboardText, '@ws:Research{full-id}')
  assert.equal(candidates[1].name, '问候')
  assert.equal(candidates[1].description, 'QQ')
  const picked = source.onPick({ candidate: candidates[1], action: 'pick' }).insert
  assert.equal(picked.label, '问候')
  assert.equal(picked.ref, '@ws:QQ{full-ws-id}/s:问候{full-session-id}')
  const textWithReference = `读取 ${picked.ref}。`
  const node = rules.get('workspace-session-reference').match(textWithReference, 0)
  assert.equal(textWithReference.slice(node.start, node.end), picked.ref)
  const chip = slots.get(node.id)({ node, t: key => key })
  assert.equal(chip.type, ReferenceChip)
  assert.equal(chip.props.label, '问候')
  assert.equal(chip.props.title, '问候')
  const Review = slots.get('local.workspace-route-review')
  const state = { phase: 'review', plan: { status: 'planned', blocks: [{ index: 0, mode: 'existing', workspaceTitle: 'QQ', sessionTitle: '问候', sessionId: 'full-session-id', text: '正文' }] } }
  const rendered = JSON.stringify(Review({ useRouteReview: read => read(state), t: key => key }))
  assert.match(rendered, /QQ \/ 问候/u)
  assert.doesNotMatch(rendered, /full-session-id/u)
  assert.equal(calls[0].action, 'candidates')
  for (const stop of stops.reverse()) await stop()
  assert.equal(sources.size, 0); assert.equal(slots.size, 0); assert.equal(rules.size, 0); assert.equal(dictionaries, 0)
})
