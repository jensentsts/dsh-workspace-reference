/** One user-owned route review at a time; subscriptions are consumed by Slot hooks. */
export class RouteReview {
  constructor(execute) {
    this.execute = execute
    this.state = null
    this.listeners = new Set()
    this.pending = null
    this.controller = null
    this.disposed = false
    this.lastUnsettled = null
    this.available = false
  }
  getSnapshot = () => this.state
  subscribe = listener => { this.listeners.add(listener); return () => this.listeners.delete(listener) }
  publish(value) { this.state = value; for (const listener of this.listeners) listener() }

  /** Follow the public overlay declaration lifetime; loss cancels unconfirmed work. */
  setAvailable(value) { this.available = value; if (!value) this.cancel() }

  /** Open a complete plan for explicit confirmation; no create or send occurs. */
  async open(request, signal) {
    if (this.disposed) throw new Error('review-disposed')
    if (!this.available) throw new Error('route-review-unavailable')
    if (this.state !== null || this.controller !== null) throw new Error('route-review-already-open')
    signal?.throwIfAborted()
    if (this.lastUnsettled?.text === request.text && this.lastUnsettled.sessionId === request.sessionId) request = { ...request, requestId: this.lastUnsettled.requestId }
    const controller = new AbortController()
    this.controller = controller
    const abort = () => { controller.abort(); this.cancel() }
    signal?.addEventListener('abort', abort, { once: true })
    try {
      const plan = await this.execute({ action: 'plan', sessionId: request.sessionId, requestId: request.requestId, text: request.text }, controller.signal)
      if (controller.signal.aborted) throw new Error('route-review-cancelled')
      const result = new Promise((resolve, reject) => { this.pending = { resolve, reject } })
      this.publish({ request, plan, phase: 'review' })
      return await result
    } finally {
      signal?.removeEventListener('abort', abort)
      this.controller = null
    }
  }

  /** Confirm the displayed plan once. Failures retain receipts; no blind retry. */
  async confirm() {
    if (this.state?.phase !== 'review' || this.state.plan.status !== 'planned') return
    const current = this.state
    this.publish({ ...current, phase: 'sending' })
    try {
      const result = await this.execute({ action: 'send', ...current.request, explicit: true, mode: 'queue' }, this.controller.signal)
      this.lastUnsettled = result.status === 'accepted' ? null : current.request
      this.publish({ ...current, phase: 'receipt', result })
      // The composer settles only when the human closes the receipt. It cannot
      // submit the still-open draft while the operation has an unknown result.
    } catch (error) { this.lastUnsettled = current.request; this.publish({ ...current, phase: 'receipt', error: error.message }) }
  }

  /** Close receipts: accepted clears draft, partial leaves it intact with a visible failure. */
  close() {
    if (this.state?.phase !== 'receipt') return
    const result = this.state.result
    if (result?.status === 'accepted') this.pending?.resolve(result)
    else this.pending?.reject(new Error('route-not-complete'))
    this.pending = null
    this.publish(null)
  }

  /** Cancelling requests aborts unstarted admission; accepted blocks are not recalled. */
  cancel() {
    if (this.state?.phase === 'sending') { this.controller?.abort(); return }
    if (this.state?.phase === 'receipt') { this.close(); return }
    this.controller?.abort()
    this.pending?.reject(new Error('route-review-cancelled'))
    this.pending = null
    this.publish(null)
  }
  dispose() { this.disposed = true; this.controller?.abort(); this.pending?.reject(new Error('route-review-disposed')); this.pending = null; this.publish(null); this.listeners.clear() }
}
