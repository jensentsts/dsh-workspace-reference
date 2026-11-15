import { DEFAULTS } from './references.js'
import { proseMask as maskMarkdown } from './syntax.js'

/**
 * Extract whitespace-delimited @path and @\"path with spaces\" from original
 * prose. Email addresses, inline/fenced code, and malformed tokens are ignored.
 * A final unclosed quoted directory (ending /) matches the Host formatter.
 */
export function extractWorkspaceMentions(text, { maxMentions = DEFAULTS.maxMentions, maxChars = DEFAULTS.maxMessageChars } = {}) {
  if (typeof text !== 'string') throw new TypeError('text must be a string')
  if (!Number.isSafeInteger(maxMentions) || maxMentions < 1 || !Number.isSafeInteger(maxChars) || maxChars < 1) throw new TypeError('mention bounds must be positive safe integers')
  const bounded = text.slice(0, maxChars)
  const masked = maskMarkdown(bounded)
  const mentions = []
  let truncated = text.length > maxChars
  for (let index = 0; index < masked.length; index++) {
    if (masked[index] !== '@' || index > 0 && !/\s/u.test(masked[index - 1])) continue
    const start = index
    const quoted = masked[index + 1] === '"'
    let end = index + (quoted ? 2 : 1)
    const queryStart = end
    if (quoted) {
      while (end < masked.length && masked[end] !== '"' && masked[end] !== '\r' && masked[end] !== '\n') end++
      const closed = masked[end] === '"'
      if (!closed && (text.length > maxChars && end === masked.length || text[end - 1] !== '/')) { index = end; continue }
      const query = text.slice(queryStart, end)
      if (masked.slice(queryStart, end).includes('\u0000')) { index = end; continue }
      if (closed) end++
      if (end < masked.length && !/\s/u.test(masked[end])) { index = end; continue }
      if (query === '' || /[\u0000-\u001f\u007f-\u009f]/u.test(query)) { index = end; continue }
      if (mentions.length >= maxMentions) { truncated = true; break }
      mentions.push({ query, raw: text.slice(start, end), start, end, quoted })
    } else {
      while (end < masked.length && !/\s/u.test(masked[end])) end++
      if (end === masked.length && text.length > maxChars && !/\s/u.test(text[end])) { index = end; continue }
      const query = text.slice(queryStart, end)
      if (query === '' || masked.slice(queryStart, end).includes('\u0000') || /["\u0000-\u001f\u007f-\u009f]/u.test(query)) { index = end; continue }
      if (mentions.length >= maxMentions) { truncated = true; break }
      mentions.push({ query, raw: text.slice(start, end), start, end, quoted })
    }
    index = end - 1
  }
  return { mentions, truncated }
}
