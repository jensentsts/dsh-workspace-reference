import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile, lstat } from 'node:fs/promises'

const root = new URL('../', import.meta.url)
const read = file => readFile(new URL(file, root), 'utf8')

test('independent package exports complete payload and one Client factory, without install scripts', async () => {
  const pkg = JSON.parse(await read('package.json'))
  assert.equal(pkg.name, 'dsh-workspace-reference'); assert.equal(pkg.version, '0.2.0')
  assert.equal(pkg.engines.dsh, '>=0.2.2-rc.1 <0.3.0')
  assert.equal(pkg.scripts.install, undefined); assert.equal(pkg.dependencies, undefined)
  for (const file of ['index.js', 'references.js', 'integration.js', 'mentions.js', 'syntax.js', 'routes.js', 'delivery.js', 'review.js', 'rpc.js', 'client.js', 'index.d.ts', 'references.d.ts', 'mentions.d.ts', 'cordis.patch.yml', 'icon.svg', 'README.md', 'LICENSE']) {
    assert.ok(pkg.files.includes(file), file); assert.ok((await lstat(new URL(file, root))).isFile(), file)
  }
  const client = await read('client.js')
  assert.equal(client.match(/window.__ModuleLoader__.load\(/gu).length, 1)
  assert.match(client, /id: 'dsh-workspace-reference'/u)
  assert.equal(pkg.dsh.client.platform, 'web')
  for (const locale of ['en', 'zh']) {
    const data = JSON.parse(await read(`locale/${locale}.json`))
    assert.ok(data.meta.title); assert.ok(data.meta.description); assert.ok(data.confirmSend); assert.ok(data.rawDraftRequired)
  }
  const icon = await read('icon.svg')
  assert.ok(Buffer.byteLength(icon) < 256 * 1024)
  assert.match(icon, /^<svg xmlns="http:\/\/www.w3.org\/2000\/svg"/u)
  assert.ok(!/<(?:script|image|foreignObject)|href\s*=/iu.test(icon))
  assert.equal(pkg.exports['./icon'], './icon.svg')
})
