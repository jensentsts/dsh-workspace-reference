/** Only external workspace/session metadata and admission recipients are mocked. */
export const name = 'workspace-reference-fixture-external'
export function apply(ctx) {
  const messages = []
  const calls = { create: 0, resolve: 0, titles: 0 }
  const cwd = process.env.WORKSPACE_REFERENCE_FIXTURE_ROOT
  if (!cwd) throw new Error('WORKSPACE_REFERENCE_FIXTURE_ROOT is required')
  ctx.provide('workspaceReferenceFixture', { messages, calls })
  ctx.provide('workspaceRegistry', { list: () => [{ id: 'fixture-workspace', title: 'Research', path: cwd, sessionIds: ['fixture-session'] }] })
  ctx.provide('agents', { list: () => [], get: () => undefined })
  ctx.provide('sessionQuery', {
    async readTitleSnapshot(sessionId) { calls.titles++; return { session: { id: sessionId, cwd }, title: { title: 'Talk' } } },
    async readTitleSnapshots(ids) { calls.titles++; return ids.map(sessionId => ({ sessionId, status: 'fulfilled', value: { session: { id: sessionId, cwd }, title: { title: 'Talk' } } })) },
  })
  ctx.provide('sessionController', {
    async create() { calls.create++; return { sessionId: 'created-fixture' } },
    async resolveAgent(sessionId) { calls.resolve++; return { agent: { followup(message) { messages.push({ sessionId, message }) }, steer(message) { messages.push({ sessionId, message, mode: 'steer' }) } } } },
  })
}
