import { parseRouting, formatReference } from './syntax.js'

/** Bounded, side-effect-free routing admission. This class never holds Agents. */
export class RoutePlanner {
  constructor(references, { maxPlans, maxRoutes, maxMessageChars }) {
    this.references = references
    this.limits = { maxPlans, maxRoutes, maxMessageChars }
    this.plans = new Map()
  }

  /**
   * Resolve every block before returning a plan. Only human composer requests
   * participate. Reusing a requestId with different text is an explicit conflict;
   * retained plans are bounded, never evicted, and never indicate delivery.
   * @param {object} request - requestId, source ('human'), text and current sessionId.
   * @param {object} [options] - agent, signal and cwd for read-only resolution.
   * @returns {Promise<object>} complete planned/invalid/conflict/not-routed result.
   */
  async plan(request, options = {}) {
    if (typeof request.requestId !== 'string' || request.requestId.length === 0 || request.requestId.length > 256) throw new TypeError('requestId must contain 1–256 characters')
    if (request.source !== 'human') return { status: 'not-routed', reason: 'human-submission-only' }
    if (typeof request.text !== 'string' || typeof request.sessionId !== 'string') throw new TypeError('text and current sessionId are required')
    const key = `${request.sessionId}\u0000${request.requestId}`
    const prior = this.plans.get(key)
    if (prior !== undefined) {
      if (prior.text !== request.text) return { status: 'conflict', requestId: request.requestId, reason: 'request-id-reused-with-different-text' }
      return structuredClone(await prior.result)
    }
    // An outstanding review must never lose its pinned IDs and later resolve
    // the same name again. Refuse capacity instead of evicting reviewed plans.
    if (this.plans.size >= this.limits.maxPlans) return { status: 'rejected', reason: 'plan-capacity-reached', blocks: [] }
    const result = this.resolve(request, options)
    this.plans.set(key, { text: request.text, result })
    try { return structuredClone(await result) }
    catch (error) { this.plans.delete(key); throw error }
  }

  async resolve(request, options) {
    options.signal?.throwIfAborted()
    const ast = parseRouting(request.text, { maxChars: this.limits.maxMessageChars, maxRoutes: this.limits.maxRoutes })
    if (ast.status !== 'parsed') return ast
    if (!ast.routed) return { status: 'not-routed', reason: 'no-route-headers' }
    const blocks = []
    for (const block of ast.blocks) {
      options.signal?.throwIfAborted()
      if (block.target === null) {
        blocks.push({ index: block.index, status: 'planned', mode: 'current', sessionId: request.sessionId, sessionTitle: options.sessionTitle, text: block.text })
        continue
      }
      const mention = block.target.raw
      const target = await this.references.resolve(mention, options)
      if (target?.status !== 'resolved') {
        blocks.push({
          index: block.index, status: 'rejected', text: block.text,
          workspaceTitle: block.target.workspace.name, sessionTitle: block.target.session?.name,
          target: target ?? { status: 'missing', reason: 'unknown-reference' },
        })
      } else blocks.push({
        index: block.index, status: 'planned', mode: target.kind === 'session' ? 'existing' : 'new',
        workspaceId: target.workspace.id, workspacePath: target.workspace.path, workspaceTitle: target.workspace.title,
        reference: formatReference(target.workspace, target.kind === 'session' ? { session: target.session } : {}),
        ...(target.kind === 'session' ? { sessionId: target.session.id, sessionTitle: target.session.title } : {}), text: block.text,
      })
    }
    options.signal?.throwIfAborted()
    return { status: blocks.some(block => block.status === 'rejected') ? 'rejected' : 'planned', requestId: request.requestId, delivered: false, blocks }
  }

  /** Revalidate pinned full IDs immediately before any create/admit operation. */
  async revalidate(plan, options = {}) {
    for (const block of plan.blocks) {
      options.signal?.throwIfAborted()
      if (block.mode === 'current') continue
      const target = await this.references.resolve(block.reference, options)
      if (target?.status !== 'resolved' || target.workspace.id !== block.workspaceId || target.workspace.path !== block.workspacePath || (block.mode === 'existing' && (target.kind !== 'session' || target.session.id !== block.sessionId))) {
        return { status: 'rejected', delivered: false, reason: 'route-target-changed', index: block.index, target }
      }
    }
    return plan
  }

  /** Clear all ephemeral plans on plugin unload. */
  clear() { this.plans.clear() }
}
