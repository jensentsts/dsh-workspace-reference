/** Workspace/session reference grammar. No registry, filesystem, or delivery access. */
const controls = /[\u0000-\u001f\u007f-\u009f]/u
const idPattern = /^[A-Za-z0-9][A-Za-z0-9._-]*$/u
const invalid = reason => ({ kind: 'invalid', reason })

function unescapeText(text) {
  let value = ''
  for (let i = 0; i < text.length; i++) {
    if (text[i] !== '\\') { value += text[i]; continue }
    if (++i === text.length || !/[\\{}":]/u.test(text[i])) return undefined
    value += text[i]
  }
  return value
}

function selector(text) {
  if (text === '') return undefined
  let open = -1
  for (let i = 0; i < text.length; i++) {
    if (text[i] === '\\') { i++; continue }
    if (text[i] === '{') { if (open >= 0) return undefined; open = i }
    if (text[i] === '}' && (open < 0 || i !== text.length - 1)) return undefined
  }
  const label = unescapeText(open < 0 ? text : text.slice(0, open))
  if (label === undefined || label !== label.trim() || /[\/\u0000-\u001f]/u.test(label)) return undefined
  if (open < 0) return label === '' || label === '.' || label === '..' ? undefined : { name: label }
  if (!text.endsWith('}')) return undefined
  const id = text.slice(open + 1, -1)
  return idPattern.test(id) ? { ...(label === '' ? {} : { name: label }), id } : undefined
}

/**
 * Parse a complete @ reference or a marker-free completion query. Names are
 * labels when an ID is present; backslash escapes braces, quotes, colon and
 * backslash. Paths use forward slashes, never traversal or drive segments.
 * @param {string} input - complete token, or raw query without @.
 * @returns {object|undefined} parsed reference, typed invalid result, or undefined for non-reference paths.
 */
export function parseReference(input) {
  if (typeof input !== 'string') throw new TypeError('reference must be a string')
  let text = input.startsWith('@') ? input.slice(1) : input
  if (text === '' || controls.test(text)) return invalid('empty-or-control-character')
  if (text.startsWith('"')) {
    if (!text.endsWith('"') || text.length < 3) return invalid('unclosed-quote')
    text = text.slice(1, -1)
    for (let i = 0; i < text.length; i++) {
      if (text[i] === '\\') { i++; continue }
      if (text[i] === '"') return invalid('unescaped-quote')
    }
  } else if (text.includes('"') || /\s/u.test(text)) return invalid('quote-spaces')
  if (text.startsWith('./')) {
    const path = unescapeText(text)
    return path === undefined ? invalid('invalid-escape') : { kind: 'local', path }
  }
  if (/^(?:\/rmt(?:\/|$)|rmt:|\/|[A-Za-z]:[\\/]|\\\\)/iu.test(text)) return undefined
  const explicit = /^(ws|workspace):/u.exec(text)
  if (explicit) text = text.slice(explicit[0].length)
  else if (/^[^/\\{}]+:/u.test(text)) return undefined // host: / other registered namespace
  const segments = text.split('/')
  const workspace = selector(segments.shift())
  if (workspace === undefined) return invalid('invalid-workspace-selector')
  const sessionPrefix = /^(s|session):/u.exec(segments[0] ?? '')
  if (sessionPrefix) {
    if (segments.length !== 1) return invalid('session-is-not-a-directory')
    const session = selector(segments[0].slice(sessionPrefix[0].length))
    return session === undefined ? invalid('invalid-session-selector') : { kind: 'session', explicit: Boolean(explicit), workspace, session }
  }
  if (segments.at(-1) === '') segments.pop()
  const parts = []
  for (const segment of segments) {
    const part = unescapeText(segment)
    if (part === undefined || part === '' || part === '.' || part === '..' || /[:\\]/u.test(part) || controls.test(part)) return invalid('invalid-subpath')
    // Braces are reserved for IDs in selectors, literal in filenames only when escaped.
    if (/(?<!\\)[{}]/u.test(segment)) return invalid('escape-reserved-braces')
    parts.push(part)
  }
  return { kind: 'workspace', explicit: Boolean(explicit), workspace, relativePath: parts.join('/'), directory: /\/$/u.test(text) }
}

const escape = text => String(text).replace(/[\\{}":]/gu, '\\$&')
const formatSelector = (object, stable) => `${escape(object.title ?? object.name ?? '')}${stable ? `{${object.id}}` : ''}`

/**
 * Format stable, literal clipboard text; IDs remain complete, never truncated.
 * Names with slashes or controls use the ID-only fallback.
 * @param {object} workspace - id and friendly title.
 * @param {object} [options] - optional session, relativePath, stable (default true), longAliases.
 * @returns {string} one complete, quoted when needed @ reference.
 */
export function formatReference(workspace, { session, relativePath = '', stable = true, longAliases = false, directory = false } = {}) {
  const represent = object => {
    if (stable && !idPattern.test(object.id ?? '')) throw new TypeError('A full reference ID is required')
    const title = object.title ?? object.name ?? ''
    if (/[\/\u0000-\u001f\u007f-\u009f]/u.test(title) || title !== title.trim() || title === '') {
      if (!stable) throw new TypeError('This name requires an ID-only reference')
      return `{${object.id}}`
    }
    return formatSelector(object, stable)
  }
  let text = `${longAliases ? 'workspace' : 'ws'}:${represent(workspace)}`
  if (session !== undefined) text += `/${longAliases ? 'session' : 's'}:${represent(session)}`
  else if (relativePath !== '') text += `/${relativePath.split('/').map(escape).join('/')}`
  if (directory && session === undefined) text += '/'
  const result = /\s|"/u.test(text) ? `@"${text}"` : `@${text}`
  if (parseReference(result)?.kind === 'invalid') throw new TypeError('Reference cannot be represented')
  return result
}

/** Mask Markdown examples, preserving UTF-16 offsets and line endings. */
export function proseMask(text) {
  const mask = value => value.replace(/[^\r\n]/g, '\u0000')
  let output = ''
  let fence
  let quote = false
  for (const line of text.split(/(?<=\n)/u)) {
    const body = line.replace(/\r?\n$/u, '')
    const marker = /^ {0,3}(`{3,}|~{3,})(.*)$/u.exec(body)
    if (fence === undefined && /^ {0,3}>/u.test(body)) { quote = true; output += mask(line); continue }
    if (fence === undefined && quote) {
      if (body.trim() === '') quote = false
      else { output += mask(line); continue }
    }
    if (fence !== undefined) {
      output += mask(line)
      if (marker && marker[1][0] === fence.character && marker[1].length >= fence.length && marker[2].trim() === '') fence = undefined
    } else if (marker && (marker[1][0] !== '`' || !marker[2].includes('`'))) {
      fence = { character: marker[1][0], length: marker[1].length }
      output += mask(line)
    } else output += /^(?: {4}|\t| {0,3}>)/u.test(body) ? mask(line) : line
  }
  let masked = ''
  for (let index = 0; index < output.length;) {
    if (output[index] !== '`') { masked += output[index++]; continue }
    let runEnd = index
    while (output[runEnd] === '`') runEnd++
    const delimiter = output.slice(index, runEnd)
    let close = output.indexOf(delimiter, runEnd)
    while (close >= 0 && (output[close - 1] === '`' || output[close + delimiter.length] === '`')) close = output.indexOf(delimiter, close + delimiter.length)
    const newline = output.indexOf('\n', runEnd)
    const end = close < 0 ? newline < 0 ? output.length : newline : close + delimiter.length
    masked += mask(output.slice(index, end))
    index = end
  }
  return masked
}

/** Find session tokens in original text, or in an offset-preserving prose mask. */
export function* sessionReferenceMentions(text, from = 0) {
  const tokens = /(?<!\S)@(?:"(?:\\[^\r\n\u0000]|[^"\\\r\n\u0000])*"(?=$|\s|[.,;:!?，。；：！？])|[^"\s\u0000]+)/gu
  tokens.lastIndex = from
  for (const match of text.matchAll(tokens)) {
    const raw = match[0].replace(/(?<=\})[.,;:!?，。；：！？]+$/u, '')
    const parsed = parseReference(raw)
    if (parsed?.kind === 'session') yield { raw, parsed, start: match.index, end: match.index + raw.length }
  }
}

/**
 * Split a human submission into local and explicitly addressed blocks. Parsing
 * never resolves, creates, sends, or parses assistant output. Invalid route-like
 * headers are errors, not a fallback into the previous recipient.
 * @param {string} text - complete human submission.
 * @param {object} [limits] - maxChars and maxRoutes.
 * @returns {object} immutable-by-convention parse AST or explicit bounded failure.
 */
export function parseRouting(text, { maxChars = 65536, maxRoutes = 32 } = {}) {
  if (typeof text !== 'string') throw new TypeError('text must be a string')
  if (text.length > maxChars) return { status: 'invalid', reason: 'message-too-long', blocks: [] }
  const masked = proseMask(text)
  let offset = 0
  let target = null
  let body = ''
  let start = 0
  const blocks = []
  const flush = () => { if (body !== '') blocks.push({ index: blocks.length, target, text: body, start }); body = '' }
  let routes = 0
  for (const line of text.split(/(?<=\n)/u)) {
    const visible = masked.slice(offset, offset + line.length).replace(/\r?\n$/u, '')
    const header = /^ {0,3}(@[^\r\n]*):[ \t]*$/u.exec(visible)
    const escaped = header !== null && /(?<!\\)(?:\\\\)*\\:$/u.test(header[1] + ':')
    if (header !== null && !escaped && !header[1].includes('\u0000')) {
      // The native composer leaves a separator after an inserted reference chip.
      const raw = header[1].replace(/[ \t]+$/u, '')
      const parsed = raw === '@' ? null : parseReference(raw)
      if (parsed?.kind === 'workspace' && parsed.relativePath !== '' || parsed?.kind === 'local') {
        // A file-looking standalone mention is not a route.
        body += line
      } else if (parsed === null || parsed?.kind === 'workspace' || parsed?.kind === 'session') {
        if (++routes > maxRoutes) return { status: 'invalid', reason: 'too-many-routes', blocks: [] }
        flush()
        target = parsed === null ? null : { ...parsed, raw }
        start = offset + line.length
      } else if (parsed?.kind === 'invalid') return { status: 'invalid', reason: parsed.reason, line: offset, blocks: [] }
      else body += line
    } else body += line
    offset += line.length
  }
  flush()
  return { status: 'parsed', routed: routes > 0, blocks }
}
