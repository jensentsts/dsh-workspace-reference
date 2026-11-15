/** Explicit human route admission; ordinary reference lookup never calls this owner. */
export class RouteDelivery {
  constructor(planner, controller, { maxPlans }, createMessage) {
    this.planner = planner
    this.controller = controller
    this.maxPlans = maxPlans
    this.createMessage = createMessage
    this.requests = new Map()
    this.closed = false
  }

  /**
   * Admit a fully resolved route plan through official sessionController APIs.
   * Receipts describe inbox admission, not model completion. No automatic retry
   * follows unknown outcomes; the same request joins its existing operation.
   * @param {object} request - explicit:true, human requestId/text/sessionId and queue/steer mode.
   * @param {object} [options] - resolution context and cancellation.
   * @returns {Promise<object>} per-block created/accepted/failed/cancelled receipts.
   */
  async send(request, options = {}) {
    if (request.explicit !== true || request.source !== 'human') return { status: 'rejected', reason: 'explicit-human-send-required', delivered: false, blocks: [] }
    if (!['queue', 'steer'].includes(request.mode)) throw new TypeError('mode must be queue or steer')
    if (this.closed) return { status: 'rejected', reason: 'router-disposed', blocks: [] }
    const key = `${request.sessionId}\u0000${request.requestId}`
    const fingerprint = JSON.stringify([request.text, request.mode])
    const prior = this.requests.get(key)
    if (prior !== undefined) return prior.fingerprint === fingerprint ? structuredClone(await prior.result) : { status: 'conflict', reason: 'request-id-reused-with-different-content', blocks: [] }
    // Do not evict accepted/uncertain side effects and make a repeated ID new.
    if (this.requests.size >= this.maxPlans) return { status: 'rejected', reason: 'idempotency-capacity-reached', blocks: [] }
    const result = this.perform(request, options)
    this.requests.set(key, { fingerprint, result })
    return structuredClone(await result)
  }

  async perform(request, options) {
    const prepared = await this.planner.plan(request, options)
    if (prepared.status !== 'planned') return { ...prepared, delivered: false }
    const plan = await this.planner.revalidate(prepared, options)
    if (plan.status !== 'planned') return { ...plan, delivered: false }
    const blocks = []
    let stopped = false
    for (const block of plan.blocks) {
      const receipt = {
        index: block.index, mode: block.mode, workspaceTitle: block.workspaceTitle, sessionTitle: block.sessionTitle,
        ...(block.workspaceId ? { workspaceId: block.workspaceId } : {}),
      }
      if (stopped || options.signal?.aborted || this.closed) {
        blocks.push({ ...receipt, status: 'cancelled', created: false, accepted: false })
        continue
      }
      if (block.text.trim() === '') {
        blocks.push({ ...receipt, status: 'empty', created: false, accepted: false })
        continue
      }
      let sessionId = block.sessionId
      let created = false
      let phase = 'resolve'
      try {
        options.signal?.throwIfAborted()
        if (block.mode === 'new') {
          phase = 'create'
          const value = await this.controller.create({ workspaceId: block.workspaceId })
          sessionId = value.sessionId
          created = true
        }
        options.signal?.throwIfAborted()
        if (this.closed) throw new Error('router-disposed')
        phase = 'resolve'
        const resolved = await this.controller.resolveAgent(sessionId)
        if (resolved.error !== undefined) throw resolved.error
        options.signal?.throwIfAborted()
        if (this.closed) throw new Error('router-disposed')
        phase = 'admit'
        const message = this.createMessage({
          content: [{ type: 'text', text: block.text }],
          source: { kind: 'workspace-reference', originSessionId: request.sessionId, requestId: request.requestId, blockIndex: block.index },
        })
        if (request.mode === 'steer') resolved.agent.steer(message)
        else resolved.agent.followup(message)
        blocks.push({ ...receipt, sessionId, messageId: message.id, status: 'accepted', created, accepted: true })
      } catch (error) {
        const cancelled = options.signal?.aborted === true || this.closed
        blocks.push({ ...receipt, ...(sessionId ? { sessionId } : {}), status: cancelled ? 'cancelled' : phase === 'admit' ? 'unknown' : 'failed', created, accepted: false, phase, error: { code: typeof error?.code === 'string' ? error.code : 'route-failed', message: typeof error?.message === 'string' ? error.message.slice(0, 1000) : 'Route failed' } })
        // Once a failure occurs later blocks are not sent to a different recipient.
        stopped = true
      }
    }
    return { status: blocks.every(block => block.status === 'accepted' || block.status === 'empty') ? 'accepted' : 'partial', requestId: request.requestId, completed: false, blocks }
  }

  /** Stop admission and await any already admitted operation before releasing dependencies. */
  async dispose() { this.closed = true; await Promise.allSettled([...this.requests.values()].map(item => item.result)) }
}
