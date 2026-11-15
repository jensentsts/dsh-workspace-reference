import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, mkdir, writeFile, readFile, rm, symlink } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Context } from '@deepseek-ai/cordis'
import { LocalFileSystem } from '@deepseek-ai/dsh-fs-local'
import { resolveSearchPath } from '@deepseek-ai/dsh-tool-fs-search/src/search-core.ts'
import { WorkspaceReferences } from '../references.js'

async function mount(t) {
  const dir = await mkdtemp(join(tmpdir(), 'dsh-ref-alias-'))
  const ctx = new Context()
  const backend = await ctx.plugin(LocalFileSystem, { cwd: dir })
  const root = join(dir, 'registered')
  await mkdir(root)
  const registry = { list: () => [{ id: 'workspace-id', title: 'Research', path: root, sessionIds: [] }] }
  const refs = new WorkspaceReferences({ registry: () => registry, filesystem: () => ctx.fs })
  const resolver = (path, options, fs) => refs.translate(path, { ...options, fs })
  const owner = ctx.plugin({ name: 'alias-owner', inject: ['fs'], apply(scope) { scope.fs.registerPathAlias(resolver) } })
  await owner
  t.after(async () => { await ctx.fiber.dispose(); await rm(dir, { recursive: true, force: true }) })
  return { dir, root, ctx, refs, owner, backend, resolver }
}

test('real Local ctx.fs uses aliases for native read/write/edit with same identity and stale guards', async t => {
  const { ctx, root } = await mount(t)
  const alias = '@ws:Research{workspace-id}/file.txt'
  const target = await ctx.fs.resolve(alias)
  const created = await ctx.fs.writeText(target, 'alpha', { kind: 'createIfAbsent' })
  const native = await ctx.fs.resolve(join(root, 'file.txt'))
  assert.equal(target.targetKey, native.targetKey)
  assert.equal(await ctx.fs.readText(native), 'alpha')
  const edited = await ctx.fs.editText(await ctx.fs.resolve(alias), { oldString: 'alpha', newString: 'beta', replaceAll: false }, { version: created.version })
  assert.equal(await ctx.fs.readText(native), 'beta')
  await assert.rejects(ctx.fs.writeText(await ctx.fs.resolve(alias), 'lost', { kind: 'replaceIfVersion', version: created.version }), error => error.code === 'FS_STALE_VERSION')
  assert.notEqual(edited.version, created.version)
  assert.equal((await ctx.fs.lstat(alias)).type, 'file')
})
test('ordinary bare paths remain local, @./ forces local and title collision refuses', async t => {
  const { ctx, dir, root } = await mount(t)
  await mkdir(join(dir, 'Research'))
  await writeFile(join(dir, 'Research', 'file.txt'), 'local')
  await writeFile(join(root, 'file.txt'), 'registered')
  assert.equal(await ctx.fs.readText(await ctx.fs.resolve('Research/file.txt')), 'local')
  assert.equal(await ctx.fs.readText(await ctx.fs.resolve('@./Research/file.txt')), 'local')
  await assert.rejects(ctx.fs.resolve('@Research/file.txt'), /workspace-or-local-directory/u)
  assert.equal(await ctx.fs.readText(await ctx.fs.resolve('@ws:Research/file.txt')), 'registered')
  await assert.rejects(ctx.fs.resolve('@ws:Research/s:Talk'), /session-is-not-a-filesystem-path/u)
})
test('alias final symlink stays lstat link, identity escape denied, intermediate link cannot escape', async t => {
  const { ctx, dir, root } = await mount(t)
  const outside = join(dir, 'outside'); await mkdir(outside); await writeFile(join(outside, 'secret.txt'), 'outside')
  await symlink(outside, join(root, 'link'), process.platform === 'win32' ? 'junction' : 'dir')
  assert.equal((await ctx.fs.lstat('@ws:Research/link')).type, 'symlink')
  await assert.rejects(ctx.fs.resolve('@ws:Research/link/secret.txt'), error => error.code === 'FS_PERMISSION_DENIED')
  await assert.rejects(ctx.fs.lstat('@ws:Research/link/secret.txt'), error => error.code === 'FS_PERMISSION_DENIED')
})
test('calling context disposes alias, same resolver reference counts and unload leaves native unchanged', async t => {
  const { ctx, root, owner, resolver } = await mount(t)
  let counter = 0
  const first = ctx.plugin({ name: 'same-resolver', inject: ['fs'], apply(scope) { scope.fs.registerPathAlias(resolver) } }); await first
  const observer = (path) => { if (path.startsWith('@')) counter++; return undefined }
  const observation = ctx.plugin({ name: 'observer', inject: ['fs'], apply(scope) { scope.fs.registerPathAlias(observer) } }); await observation
  await ctx.fs.resolve('@ws:Research/a'); assert.equal(counter, 1)
  await owner.dispose(); assert.equal((await ctx.fs.resolve('@ws:Research/a')).displayPath, join(root, 'a'))
  await first.dispose()
  assert.equal((await ctx.fs.normalizePathAlias('@ws:Research/a')).path, '@ws:Research/a')
  await observation.dispose()
  assert.equal((await ctx.fs.resolve(join(root, 'a'))).displayPath, join(root, 'a'))
})
test('multiple independent claims reject and unregister restores the remaining alias', async t => {
  const { ctx, root } = await mount(t)
  const other = ctx.plugin({ name: 'conflicting-alias', inject: ['fs'], apply(scope) { scope.fs.registerPathAlias(path => path.startsWith('@ws:') ? { path: join(root, 'other') } : undefined) } }); await other
  await assert.rejects(ctx.fs.resolve('@ws:Research/a'), /Multiple filesystem aliases/u)
  await other.dispose()
  assert.equal((await ctx.fs.resolve('@ws:Research/a')).displayPath, join(root, 'a'))
})
test('search root translation uses public processPath, unchanged nonaliases and loud remote failures', async t => {
  const { ctx, root } = await mount(t)
  const exec = { signal: new AbortController().signal }
  assert.equal(await resolveSearchPath(ctx, exec, 'local/'), 'local/')
  assert.equal(await resolveSearchPath(ctx, exec, undefined), undefined)
  assert.equal(await resolveSearchPath(ctx, exec, '@ws:Research/file.txt'), ctx.fs.processPath(await ctx.fs.resolve(join(root, 'file.txt'))))
  await assert.rejects(resolveSearchPath(ctx, exec, '@host:/C:/peer'), error => error.code === 'SEARCH_FAILED')
  await assert.rejects(resolveSearchPath(ctx, exec, '/rmt/host/C:/peer'), error => error.code === 'SEARCH_FAILED')
  await assert.rejects(resolveSearchPath(ctx, exec, '@ws:Research/s:Talk'), /session-is-not-a-filesystem-path/u)
})
