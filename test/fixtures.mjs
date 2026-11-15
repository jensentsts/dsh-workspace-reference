import { posix } from 'node:path'
import { WorkspaceReferences } from '../references.js'

export function fixture(options = {}, backend) {
  const workspaces = [
    { id: 'ws-alpha', title: '研究 项目', path: '/projects/alpha', sessionIds: ['session-one', 'session-two'] },
    { id: 'ws-beta', title: 'Other', path: '/projects/beta', sessionIds: ['session-three'] },
  ]
  const nodes = new Map([
    ['/projects/alpha', 'directory'], ['/projects/beta', 'directory'],
    ['/projects/alpha/docs', 'directory'], ['/projects/alpha/docs/design.md', 'file'],
    ['/projects/alpha/readme.md', 'file'], ['/projects/alpha/.hidden', 'file'],
    ['/projects/alpha/子目录', 'directory'], ['/projects/alpha/a b.md', 'file'],
    ['/projects/beta/notes.md', 'file'], ['/outside/private.md', 'file'],
  ])
  const aliases = new Map([['/projects/alpha/escape', '/outside'], ['/projects/alpha/leak.md', '/outside/private.md']])
  const calls = []
  const canonical = value => {
    const normalized = posix.resolve('/', value)
    for (const [source, destination] of aliases) if (normalized === source || normalized.startsWith(`${source}/`)) return normalized.replace(source, destination)
    return normalized
  }
  const fs = backend ?? {
    async resolve(value, { signal, cwd = '/current' } = {}) { signal?.throwIfAborted(); calls.push(['resolve', value]); const path = canonical(posix.resolve(cwd, value)); return { targetKey: path, displayPath: path } },
    contains(parent, child) { return child.targetKey === parent.targetKey || child.targetKey.startsWith(`${parent.targetKey}/`) },
    async stat(target, signal) { signal?.throwIfAborted(); calls.push(['stat', target.targetKey]); const type = nodes.get(target.targetKey); return type ? { type } : undefined },
    async lstat(path, { cwd = '/current' } = {}, signal) { signal?.throwIfAborted(); calls.push(['lstat', path]); const type = nodes.get(posix.resolve(cwd, path)); return type ? { type } : undefined },
    async listDir(target, signal) {
      signal?.throwIfAborted(); calls.push(['listDir', target.targetKey])
      const entries = []
      for (const [path, type] of nodes) if (posix.dirname(path) === target.targetKey) entries.push({ name: posix.basename(path), type, target: { targetKey: canonical(path), displayPath: canonical(path) } })
      if (target.targetKey === '/projects/alpha') entries.push({ name: 'leak.md', type: 'file', target: { targetKey: '/outside/private.md', displayPath: '/outside/private.md' } })
      return entries.sort((a, b) => a.name.localeCompare(b.name))
    },
    readText() { throw new Error('file contents must never be read') },
  }
  const titles = new Map([['session-one', '方案讨论'], ['session-two', 'Notes'], ['session-three', 'Elsewhere']])
  const query = { async readTitleSnapshots(ids, signal) { signal?.throwIfAborted(); calls.push(['titles', ids]); return ids.map(id => ({ sessionId: id, status: 'fulfilled', value: { session: { id, cwd: id === 'session-three' ? '/projects/beta' : '/projects/alpha' }, title: { title: titles.get(id) } } })) } }
  const refs = new WorkspaceReferences({ registry: () => ({ list: () => workspaces }), filesystem: agent => agent?.fs ?? fs, sessionQuery: () => query }, options)
  return { refs, workspaces, fs, calls, nodes, aliases, titles, query }
}
export const signal = () => new AbortController().signal
