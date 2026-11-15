import { posix, win32 } from 'node:path'
import { parseReference, formatReference } from './syntax.js'

export const DEFAULTS = Object.freeze({
  maxResults: 20, maxEntries: 2000, maxQueryLength: 2048,
  maxMentions: 12, maxMessageChars: 65536, maxMappingChars: 16384,
  maxRoutes: 32, maxPlans: 64,
})
const slash = value => value.replaceAll('\\', '/')
const pathApi = value => /^[A-Za-z]:[\\/]/u.test(value) || /^(?:\\\\|\/\/)[^/\\]+[/\\][^/\\]+/u.test(value) ? win32 : posix
const checkAbort = signal => signal?.throwIfAborted()
const compare = (a, b) => a < b ? -1 : a > b ? 1 : 0
const fail = (query, status, reason, extra = {}) => ({ status, query, reason, ...extra })

/** Validate all deployment bounds, including direct non-Cordis callers. */
export function normalizeOptions(options = {}) {
  const output = { ...DEFAULTS, ...options }
  const limits = { maxResults: 200, maxEntries: 20000, maxQueryLength: 8192, maxMentions: 100, maxMessageChars: 1048576, maxMappingChars: 65536, maxRoutes: 100, maxPlans: 1000 }
  for (const [key, limit] of Object.entries(limits)) {
    if (!Number.isSafeInteger(output[key]) || output[key] < 1 || output[key] > limit) throw new TypeError(`${key} must be an integer from 1 to ${limit}`)
  }
  return output
}

/** Stable bounded merge for consumers that deliberately combine independent sources. */
export function mergeCandidates(preferred, fallback, limit = DEFAULTS.maxResults) {
  const seen = new Set()
  return [...preferred, ...fallback].filter(item => {
    const key = item.mention ?? item.path
    if (seen.has(key)) return false
    seen.add(key)
    return true
  }).slice(0, limit)
}

/** Metadata resolution error. No provider-private target or exception is exposed. */
export class ReferenceError extends Error {
  constructor(result) { super(`Workspace reference ${result.status}: ${result.reason ?? 'select an exact ID'}`); this.name = 'ReferenceError'; this.result = result }
}

/** Pure identity lookup. Full IDs never fall back to a name, including after rename. */
function selectIdentity(selector, items, query, type, limit) {
  const selected = selector.id === undefined
    ? items.filter(item => item.title === selector.name || item.id === selector.name)
    : items.filter(item => item.id === selector.id)
  if (selected.length === 0) return fail(query, 'missing', `${type}-not-found`)
  if (selected.length > 1) return fail(query, 'ambiguous', `${type}-name-duplicated`, { candidates: selected.slice(0, limit).map(item => ({ id: item.id, title: item.title })), truncated: selected.length > limit })
  const item = selected[0]
  return { status: 'selected', item, ...(selector.id !== undefined && selector.name !== undefined && selector.name !== item.title ? { renamed: { supplied: selector.name, current: item.title } } : {}) }
}

/**
 * Registry-backed workspace/session references over the composed filesystem.
 * Parsing, lookup and route planning never create Agents or deliver messages.
 */
export class WorkspaceReferences {
  constructor({ registry, filesystem, sessionQuery }, options = {}) {
    this.registry = registry
    this.filesystem = filesystem
    this.sessionQuery = sessionQuery
    this.options = normalizeOptions(options)
  }

  snapshot() {
    return this.registry().list().map(({ id, title, path, sessionIds = [] }) => ({ id, title, path, sessionIds: [...sessionIds] }))
  }

  parse(query) {
    if (typeof query !== 'string') throw new TypeError('query must be a string')
    if (query.length > this.options.maxQueryLength) return { kind: 'invalid', reason: 'query-too-long' }
    // Raw completion queries omit the surrounding whole-token quotes.
    return parseReference(!query.startsWith('@') && /\s/u.test(query) ? `@"${query}"` : query)
  }

  match(query) {
    if (typeof query !== 'string') return undefined
    if (query === '' || /^(?:ws|workspace):[^/]*$/u.test(query)) return 'hint'
    const parsed = this.parse(query)
    if (parsed?.kind === 'workspace' || parsed?.kind === 'session') {
      if (parsed.explicit || parsed.workspace.id !== undefined || this.snapshot().some(item => item.id === parsed.workspace.name || item.title === parsed.workspace.name)) return 'path'
      if (!query.includes('/') && this.snapshot().some(item => item.title.toLowerCase().startsWith(query.toLowerCase()) || item.id.startsWith(query))) return 'hint'
    }
    return undefined
  }

  async workspace(parsed, { agent, signal, cwd, fs = this.filesystem(agent), collision = true } = {}) {
    checkAbort(signal)
    const picked = selectIdentity(parsed.workspace, this.snapshot(), '', 'workspace', this.options.maxResults)
    if (picked.status !== 'selected') return picked
    if (collision && !parsed.explicit && parsed.workspace.id === undefined) {
      if (fs === undefined) return fail('', 'unavailable', 'filesystem-unavailable')
      // Always inspect the literal local name, not a second alias. Errors remain
      // visible: an unavailable local backend cannot establish no collision.
      const info = await fs.lstat(`./${parsed.workspace.name}`, { cwd }, signal)
      checkAbort(signal)
      if (info?.type === 'directory' || info?.type === 'symlink') return fail('', 'ambiguous', 'workspace-or-local-directory', {
        candidates: [{ kind: 'workspace', mention: formatReference(picked.item), id: picked.item.id }, { kind: 'local', mention: `@./${parsed.workspace.name}/` }], truncated: false,
      })
    }
    return { ...picked, workspace: picked.item }
  }

  async sessions(workspace, signal) {
    checkAbort(signal)
    const service = this.sessionQuery?.()
    if (service === undefined) return { status: 'unavailable', reason: 'session-query-unavailable' }
    const ids = workspace.sessionIds
    if (ids.length > this.options.maxEntries) return { status: 'unavailable', reason: 'session-catalog-too-large' }
    const observations = await service.readTitleSnapshots(ids, signal)
    checkAbort(signal)
    const failed = observations.find(item => item.status !== 'fulfilled')
    if (failed !== undefined) return { status: 'unavailable', reason: 'session-title-unavailable', sessionId: failed.sessionId }
    return { status: 'listed', items: observations.map(({ sessionId, value }) => ({
      id: sessionId, title: value.title?.title ?? '', cwd: value.session.cwd, createdAt: value.session.createdAt,
    })) }
  }

  /** Resolve a workspace/session/file without reading file contents or starting an Agent. */
  async resolve(query, options = {}) {
    checkAbort(options.signal)
    const parsed = this.parse(query)
    if (parsed === undefined || parsed.kind === 'local') return undefined
    if (parsed.kind === 'invalid') return fail(query, 'invalid', parsed.reason)
    const picked = await this.workspace(parsed, options)
    if (picked.status !== 'selected') return { ...picked, query }
    const workspace = picked.workspace
    if (parsed.kind === 'session') {
      const catalog = await this.sessions(workspace, options.signal)
      if (catalog.status !== 'listed') return { ...catalog, query }
      const session = selectIdentity(parsed.session, catalog.items, query, 'session', this.options.maxResults)
      if (session.status !== 'selected') return session
      return { status: 'resolved', kind: 'session', workspace, session: session.item, ...(picked.renamed ? { workspaceRenamed: picked.renamed } : {}), ...(session.renamed ? { sessionRenamed: session.renamed } : {}) }
    }
    const fs = options.fs ?? this.filesystem(options.agent)
    if (fs === undefined) return fail(query, 'unavailable', 'filesystem-unavailable')
    const root = await fs.resolve(workspace.path, { signal: options.signal })
    const rootInfo = await fs.stat(root, options.signal)
    if (rootInfo?.type !== 'directory') return fail(query, 'missing', 'workspace-directory-missing')
    const path = pathApi(workspace.path).join(workspace.path, parsed.relativePath)
    const target = await fs.resolve(path, { signal: options.signal })
    if (!fs.contains(root, target)) return fail(query, 'invalid', 'outside-workspace')
    const info = await fs.stat(target, options.signal)
    checkAbort(options.signal)
    if (info?.type !== 'file' && info?.type !== 'directory') return fail(query, 'missing', 'path-missing-or-unsupported')
    return { status: 'resolved', kind: info.type, workspace, relativePath: parsed.relativePath, path: slash(target.displayPath), ...(picked.renamed ? { workspaceRenamed: picked.renamed } : {}) }
  }

  /**
   * Native ctx.fs alias resolver: only leading @ participates. No @ means an
   * ordinary local path; @./ forces local; peer-qualified references delegate.
   * Missing leaf files remain creatable, while s:/session: never become files.
   */
  async translate(path, options = {}) {
    if (!path.startsWith('@')) return undefined
    const parsed = this.parse(path)
    if (parsed === undefined) return undefined
    if (parsed.kind === 'invalid') throw new ReferenceError(fail(path, 'invalid', parsed.reason))
    if (parsed.kind === 'local') return { path: parsed.path }
    if (parsed.kind === 'session') throw new ReferenceError(fail(path, 'invalid', 'session-is-not-a-filesystem-path'))
    const picked = await this.workspace(parsed, options)
    if (picked.status !== 'selected') throw new ReferenceError({ ...picked, query: path })
    return { path: pathApi(picked.workspace.path).join(picked.workspace.path, parsed.relativePath), root: picked.workspace.path }
  }

  /** Independent typed candidates; existing local/remote sources are untouched. */
  async list(agent, query, signal, { cwd } = {}) {
    checkAbort(signal)
    if (query.length > this.options.maxQueryLength) return []
    let raw = query.startsWith('@') ? query.slice(1) : query
    if (raw.startsWith('"')) raw = raw.slice(1).replace(/"$/u, '')
    if (raw.startsWith('./') || /^(?:\/|rmt:|[^/{}]+:)/u.test(raw) && !/^(?:ws|workspace):/u.test(raw)) return undefined
    const explicit = /^(?:ws|workspace):/u.exec(raw)
    const fragment = explicit ? raw.slice(explicit[0].length) : raw
    if (!fragment.includes('/')) {
      const folded = fragment.toLowerCase()
      return this.snapshot().filter(item => item.title.toLowerCase().startsWith(folded) || item.id.startsWith(fragment))
        .slice(0, this.options.maxResults).map(item => ({ kind: 'workspace', label: item.title, path: formatReference(item), mention: formatReference(item), id: item.id, drill: true }))
    }
    const lastSlash = fragment.lastIndexOf('/')
    const tail = fragment.slice(lastSlash + 1)
    const workspacePart = raw.slice(0, raw.indexOf('/'))
    const parsed = this.parse(workspacePart)
    if (parsed?.kind !== 'workspace') return undefined
    const fs = this.filesystem(agent)
    const picked = await this.workspace(parsed, { agent, fs, cwd, signal })
    if (picked.status !== 'selected') return []
    if (/^(s|session):/u.test(tail)) {
      const catalog = await this.sessions(picked.workspace, signal)
      if (catalog.status !== 'listed') throw new ReferenceError(catalog)
      const partial = tail.replace(/^(s|session):/u, '').toLowerCase()
      return catalog.items.filter(item => item.title.toLowerCase().startsWith(partial) || item.id.startsWith(partial))
        .slice(0, this.options.maxResults).map(item => ({
          kind: 'session', label: item.title, id: item.id, workspaceTitle: picked.workspace.title, createdAt: item.createdAt,
          mention: formatReference(picked.workspace, { session: item }), path: formatReference(picked.workspace, { session: item }),
        }))
    }
    if (fs === undefined) throw new ReferenceError(fail(query, 'unavailable', 'filesystem-unavailable'))
    const relative = fragment.slice(fragment.indexOf('/') + 1)
    const parsedPath = this.parse(`${workspacePart}/${relative}`)
    if (parsedPath?.kind !== 'workspace') return []
    const decoded = parsedPath.relativePath
    const directory = relative.endsWith('/') ? decoded === '' ? '' : `${decoded}/` : decoded.slice(0, decoded.lastIndexOf('/') + 1)
    const namePrefix = relative.endsWith('/') ? '' : decoded.slice(decoded.lastIndexOf('/') + 1)
    const root = await fs.resolve(picked.workspace.path, { signal })
    const target = await fs.resolve(pathApi(picked.workspace.path).join(picked.workspace.path, directory), { signal })
    if (!fs.contains(root, target)) return []
    const entries = await fs.listDir(target, signal)
    checkAbort(signal)
    return entries.slice(0, this.options.maxEntries).filter(entry => (entry.type === 'file' || entry.type === 'directory') && entry.name.toLowerCase().startsWith(namePrefix.toLowerCase()) && !entry.name.includes('/') && fs.contains(root, entry.target))
      .sort((a, b) => Number(b.type === 'directory') - Number(a.type === 'directory') || compare(a.name, b.name))
      .slice(0, this.options.maxResults).map(entry => {
        const mention = formatReference(picked.workspace, { relativePath: `${directory}${entry.name}`, directory: entry.type === 'directory' })
        return { kind: entry.type, label: entry.name, mention, path: mention, drill: entry.type === 'directory' }
      })
  }
}
