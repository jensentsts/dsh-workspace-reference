import test from 'node:test'
import assert from 'node:assert/strict'
import { parseReference, formatReference, parseRouting } from '../syntax.js'

for (const prefix of ['', 'ws:', 'workspace:']) {
  test(`workspace alias ${prefix || 'short'} parses exact file`, () => {
    const ast = parseReference(`@${prefix}Research/file.md`)
    assert.equal(ast.kind, 'workspace'); assert.equal(ast.workspace.name, 'Research'); assert.equal(ast.relativePath, 'file.md')
  })
  for (const session of ['s:', 'session:']) test(`${prefix}${session} is session, never implicit folder`, () => {
    assert.equal(parseReference(`@${prefix}Research/${session}Discussion`).kind, 'session')
    assert.equal(parseReference(`@${prefix}Research/Discussion`).kind, 'workspace')
  })
}
for (const title of ['研究 项目', 'Research', 'a{b}', 'a"b', 'a:b', 'emoji🌲', 'with\\slash']) {
  test(`stable roundtrip ${title}`, () => {
    const value = formatReference({ id: 'workspace-full-id', title }, { session: { id: 'session-full-id', title: '讨论 x' } })
    const parsed = parseReference(value)
    assert.equal(parsed.kind, 'session'); assert.equal(parsed.workspace.id, 'workspace-full-id'); assert.equal(parsed.workspace.name, title); assert.equal(parsed.session.id, 'session-full-id')
  })
}
for (const title of ['bad/name', 'bad\nname', ' trimmed ']) test(`unrepresentable title uses ID-only ${JSON.stringify(title)}`, () => {
  assert.equal(parseReference(formatReference({ id: 'full-id', title })).workspace.id, 'full-id')
  assert.equal(parseReference(formatReference({ id: 'full-id', title })).workspace.name, undefined)
})
for (const bad of ['@ws:X/../y', '@ws:X//y', '@ws:X/C:/y', '@ws:X/./y', '@ws:X/s:Discussion/child', '@ws:X{bad id}/a', '@ws:X{unclosed/a', '@"X unclosed', '@X/a{file}', '@X/a\\q', '@ws:']) test(`invalid syntax ${bad}`, () => assert.equal(parseReference(bad)?.kind, 'invalid'))
for (const remote of ['@host:/C:/path', '@/rmt/host/C:/path', '@rmt:/x', '/rmt/host/C:/path', 'C:\\local']) test(`remote/native namespace not claimed ${remote}`, () => assert.equal(parseReference(remote), undefined))
test('local explicit and raw query behavior', () => {
  assert.deepEqual(parseReference('@./Research/file'), { kind: 'local', path: './Research/file' })
  assert.equal(parseReference('ws:Research/file').kind, 'workspace')
  assert.equal(parseReference('@{full-id}/file').workspace.id, 'full-id')
})

test('multi-target headers and @: restore local segments without trimming body', () => {
  const value = parseRouting('local\n@Work:\nnew\n@Work/s:Talk:\nold\n@:\nback\n')
  assert.equal(value.status, 'parsed'); assert.equal(value.routed, true)
  assert.deepEqual(value.blocks.map(block => [block.target?.kind ?? 'local', block.text]), [['local', 'local\n'], ['workspace', 'new\n'], ['session', 'old\n'], ['local', 'back\n']])
})
for (const example of ['`@Work:`', '> @Work:\nquote', '    @Work:\n    code', '\t@Work:', 'before @Work:', '@Work: after', '@Work\\:', '```text\n@Work:\n```', '````text\n```\n@Work:\n````', '~~~\n@Work:\n~~~', '\\@Work:', 'email@Work:']) test(`Markdown example never routes ${JSON.stringify(example)}`, () => {
  const result = parseRouting(example)
  assert.equal(result.status, 'parsed'); assert.equal(result.routed, false)
})
test('sufficiently long fence only closes with same marker and no suffix', () => {
  assert.equal(parseRouting('`````\n```\n@Work:\n````\n@Work:\n````` extra\n@Work:\n`````\n').routed, false)
})
test('quoted standalone route and malformed route are explicit', () => {
  assert.equal(parseRouting('@"Work project/s:Talk one":\nbody').blocks[0].target.kind, 'session')
  assert.equal(parseRouting('@ws:Bad{ID with spaces}:\nbody').status, 'invalid')
  assert.equal(parseRouting('@Work/file.md:\nbody').routed, false)
})
test('native session chip separator before the colon admits the same standalone route', () => {
  for (const token of ['@ws:QQ/s:问候', '@ws:QQ{ws-id}/s:问候{session-id}', '@"ws:QQ/s:问 候{session-id}"']) {
    const typed = parseRouting(token + ':\r\n正文')
    const picked = parseRouting(token + ' :\r\n正文')
    assert.equal(picked.status, 'parsed')
    assert.equal(picked.blocks[0].target.raw, token)
    assert.deepEqual(picked.blocks[0].target, typed.blocks[0].target)
    assert.equal(picked.blocks[0].text, '正文')
  }
  assert.equal(parseRouting('@ws:QQ/s:问候{session-id} \\:\n正文').routed, false)
  assert.equal(parseRouting('~~~\n@ws:QQ/s:问候{session-id} :\n正文\n~~~').routed, false)
})
test('lazy block quote continuation remains an example until a blank separator', () => {
  assert.equal(parseRouting('> Example\n@Work:\nquoted continuation').routed, false)
  assert.equal(parseRouting('> Example\n\n@Work:\nreal body').routed, true)
})
test('route bounds reject complete input, never truncate into new recipient', () => {
  assert.equal(parseRouting('@Work:\nbody', { maxChars: 3 }).status, 'invalid')
  assert.equal(parseRouting('@Work:\na\n@Other:\nb', { maxRoutes: 1 }).reason, 'too-many-routes')
})
