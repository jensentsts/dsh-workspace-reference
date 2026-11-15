import test from 'node:test'
import assert from 'node:assert/strict'
import { extractWorkspaceMentions } from '../mentions.js'

const queries = text => extractWorkspaceMentions(text).mentions.map(item => item.query)

test('original offsets, plain and quoted grammar, Chinese and whitespace', () => {
  const text = '检查 @Research/src/a.ts 和 @"研究 项目/docs/设计.md"\n@ws-id/'
  const { mentions, truncated } = extractWorkspaceMentions(text)
  assert.deepEqual(mentions.map(item => item.query), ['Research/src/a.ts', '研究 项目/docs/设计.md', 'ws-id/'])
  for (const item of mentions) assert.equal(text.slice(item.start, item.end), item.raw)
  assert.equal(mentions[1].quoted, true)
  assert.equal(truncated, false)
})

test('email, escaped and embedded markers never become references', () => {
  assert.deepEqual(queries('mail user@Research no(foo@Research) \\@Research @Research'), ['Research'])
})

test('fenced and inline code ignored, surrounding prose preserved', () => {
  assert.deepEqual(queries('before @one\n```js\n@hidden\n```\nafter @two `@hidden`\n~~~\n@hidden\n~~~\n@three'), ['one', 'two', 'three'])
  assert.deepEqual(queries('``inside ` @hidden`` @outside'), ['outside'])
  assert.deepEqual(queries('`multi\n@hidden` @outside'), ['outside'])
  assert.deepEqual(queries('@fake`code` @real'), ['real'])
  assert.deepEqual(queries('@"fake `code`" @real'), ['real'])
  assert.deepEqual(queries('    @indented\n\t@tabbed\n@outside'), ['outside'])
  const emoji = '```\n😀 @hidden\n```\n😀 @outside'
  const mention = extractWorkspaceMentions(emoji).mentions[0]
  assert.equal(emoji.slice(mention.start, mention.end), '@outside')
})

test('closed quotes require token boundary and empty/malformed tokens are rejected', () => {
  assert.deepEqual(queries('@"one two"x @"" @"missing quote\n@ @"ok path"'), ['ok path'])
  assert.deepEqual(queries('@unquoted"broken @plain'), ['plain'])
})

test('open quoted directory follows the Host formatter, not an open file', () => {
  assert.deepEqual(queries('@"Research docs/'), ['Research docs/'])
  assert.deepEqual(queries('@"Research docs'), [])
})

test('punctuation remains part of the token rather than guessing another target', () => {
  assert.deepEqual(queries('@file.ts, @workspace/。'), ['file.ts,', 'workspace/。'])
})

test('mention and character budgets report truncation and do not parse partial tokens', () => {
  const limited = extractWorkspaceMentions('@one @two @three', { maxMentions: 1 })
  assert.equal(limited.mentions.length, 1)
  assert.equal(limited.truncated, true)
  assert.deepEqual(extractWorkspaceMentions('@oneLong', { maxChars: 4 }), { mentions: [], truncated: true })
  assert.equal(extractWorkspaceMentions('@one rest', { maxChars: 5 }).mentions[0].query, 'one')
  assert.throws(() => extractWorkspaceMentions('@a', { maxChars: 0 }))
})
