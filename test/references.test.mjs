import test from 'node:test'
import assert from 'node:assert/strict'
import { fixture, signal } from './fixtures.mjs'
import { normalizeOptions } from '../references.js'

for (const prefix of ['', 'ws:', 'workspace:']) test(`file resolution ${prefix || 'short'} metadata only`, async () => {
  const { refs, calls } = fixture()
  const result = await refs.resolve(`@${prefix}ws-alpha/docs/design.md`)
  assert.equal(result.status, 'resolved'); assert.equal(result.kind, 'file'); assert.equal(result.path, '/projects/alpha/docs/design.md')
  assert.equal(calls.some(([name]) => name === 'readText' || name === 'listDir'), false)
})
test('stable IDs remain authority after rename, unknown ID never falls back by name', async () => {
  const { refs, workspaces } = fixture()
  const token = '@ws:Old{ws-alpha}/readme.md'
  workspaces[0].title = 'New'
  const result = await refs.resolve(token)
  assert.equal(result.status, 'resolved'); assert.deepEqual(result.workspaceRenamed, { supplied: 'Old', current: 'New' })
  assert.equal((await refs.resolve('@ws:New{missing-id}/readme.md')).status, 'missing')
})
test('duplicate names and same local directory refuse guessing', async () => {
  const { refs, workspaces, nodes } = fixture()
  workspaces[0].title = 'Research'; workspaces[1].title = 'Research'
  assert.equal((await refs.resolve('@Research/readme.md')).status, 'ambiguous')
  workspaces[1].title = 'Other'; nodes.set('/current/Research', 'directory')
  const result = await refs.resolve('@Research/readme.md')
  assert.equal(result.status, 'ambiguous'); assert.equal(result.reason, 'workspace-or-local-directory')
  assert.match(result.candidates[0].mention, /^@ws:/u); assert.equal(result.candidates[1].mention, '@./Research/')
  assert.equal((await refs.resolve('@ws:Research/readme.md')).status, 'resolved')
  assert.deepEqual(await refs.translate('@./Research/file'), { path: './Research/file' })
})
for (const prefix of ['s:', 'session:']) test(`session identity ${prefix}`, async () => {
  const { refs, titles } = fixture()
  let result = await refs.resolve(`@ws:ws-alpha/${prefix}方案讨论{session-one}`)
  assert.equal(result.kind, 'session'); assert.equal(result.session.id, 'session-one')
  titles.set('session-one', 'Renamed')
  result = await refs.resolve(`@ws:ws-alpha/${prefix}方案讨论{session-one}`)
  assert.equal(result.sessionRenamed.current, 'Renamed')
  assert.equal((await refs.resolve(`@ws:ws-alpha/${prefix}Elsewhere{session-three}`)).status, 'missing')
  await assert.rejects(refs.translate(`@ws:ws-alpha/${prefix}Renamed`), /session-is-not-a-filesystem-path/u)
})
test('duplicated sessions do not choose first and title failures are not empty catalogs', async () => {
  const { refs, titles, query } = fixture()
  titles.set('session-one', 'Same'); titles.set('session-two', 'Same')
  assert.equal((await refs.resolve('@ws:ws-alpha/s:Same')).status, 'ambiguous')
  query.readTitleSnapshots = async () => [{ sessionId: 'session-one', status: 'rejected', reason: new Error('storage') }]
  assert.equal((await refs.resolve('@ws:ws-alpha/s:Same')).status, 'unavailable')
})
test('missing leaves can be created through alias; lookup still reports absent', async () => {
  const { refs } = fixture()
  assert.deepEqual(await refs.translate('@ws:ws-alpha/new.txt'), { path: '/projects/alpha/new.txt', root: '/projects/alpha' })
  assert.equal((await refs.resolve('@ws:ws-alpha/new.txt')).status, 'missing')
  assert.equal(await refs.translate('ws-alpha/new.txt'), undefined)
  assert.equal(await refs.translate('email@ws-alpha/new.txt'), undefined)
  assert.equal(await refs.translate('@host:/C:/path'), undefined)
})
test('canonical symlink escape is denied for lookup and completion', async () => {
  const { refs } = fixture()
  assert.equal((await refs.resolve('@ws:ws-alpha/leak.md')).reason, 'outside-workspace')
  const items = await refs.list(undefined, 'ws:ws-alpha/', signal())
  assert.equal(items.some(item => item.label === 'leak.md'), false)
})
test('typed completion emits stable workspace/session/file literals', async () => {
  const { refs } = fixture()
  const hint = await refs.list(undefined, 'ws:', signal())
  assert.equal(hint[0].kind, 'workspace'); assert.match(hint[0].mention, /\{ws-alpha\}/u)
  const sessions = await refs.list(undefined, 'ws:ws-alpha/s:', signal())
  assert.equal(sessions[0].kind, 'session'); assert.match(sessions[0].mention, /\{session-one\}/u)
  const files = await refs.list(undefined, 'ws:ws-alpha/docs/', signal())
  assert.equal(files[0].kind, 'file'); assert.match(files[0].mention, /ws-alpha\}\/docs\/design.md/u)
})
test('drilling escaped filename directories uses decoded native paths and preserves stable literal copy', async () => {
  const { refs, nodes } = fixture()
  nodes.set('/projects/alpha/a{b}', 'directory')
  nodes.set('/projects/alpha/a{b}/x{y}.md', 'file')
  const files = await refs.list(undefined, 'ws:ws-alpha/a\\{b\\}/', signal())
  assert.equal(files.length, 1)
  assert.equal((await refs.resolve(files[0].mention)).path, '/projects/alpha/a{b}/x{y}.md')
  const prefix = await refs.list(undefined, 'ws:ws-alpha/a\\{', signal())
  assert.equal(prefix[0].label, 'a{b}')
})
test('cancel, bounds and metadata errors remain visible', async () => {
  const { refs, fs } = fixture()
  const abort = new AbortController(); abort.abort()
  await assert.rejects(refs.resolve('@ws:ws-alpha', { signal: abort.signal }))
  assert.throws(() => normalizeOptions({ maxPlans: 0 }), /maxPlans/u)
  assert.equal((await refs.resolve('x'.repeat(2050))).status, 'invalid')
  fs.lstat = async () => { throw new Error('backend-unavailable') }
  await assert.rejects(refs.resolve('@ws-alpha'), /backend-unavailable/u)
})
