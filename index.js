import { Service } from '@deepseek-ai/cordis'
import { createUserMessage } from '@deepseek-ai/dsh-llm'
import z from '@deepseek-ai/schemastery'
import { bindTypertRemote } from '@deepseek-ai/dsh-typert-protocol'
import { DEFAULTS, WorkspaceReferences, normalizeOptions } from './references.js'
import { RoutePlanner } from './routes.js'
import { RouteDelivery } from './delivery.js'
import { hostContribution, parseRequest, parseOutcome } from './rpc.js'
import { prepareSessionContext } from './session-context.js'

export const WORKSPACE_REFERENCE_PROMPT = 'Use ordinary file tools with @ws:Name{fullID}/file or @./path for local files. An owner input can cite @ws:Workspace/s:Session to include a read-only session snapshot as background. A standalone @ws:Workspace/s:Session: is a composer route header for the human sender.'

export const Config = z.object({
  maxResults: z.number().step(1).min(1).max(200).default(DEFAULTS.maxResults),
  maxEntries: z.number().step(1).min(1).max(20000).default(DEFAULTS.maxEntries),
  maxQueryLength: z.number().step(1).min(1).max(8192).default(DEFAULTS.maxQueryLength),
  maxMentions: z.number().step(1).min(1).max(100).default(DEFAULTS.maxMentions),
  maxMessageChars: z.number().step(1).min(1).max(1048576).default(DEFAULTS.maxMessageChars),
  maxMappingChars: z.number().step(1).min(1).max(65536).default(DEFAULTS.maxMappingChars),
  maxRoutes: z.number().step(1).min(1).max(100).default(DEFAULTS.maxRoutes),
  maxPlans: z.number().step(1).min(1).max(1000).default(DEFAULTS.maxPlans),
})

/** Independent, owner-only reference service over official registry/session/fs APIs. */
export class WorkspaceReferenceService extends Service {
  static inject = ['workspaceRegistry', 'fs', 'agents', 'sessionQuery', 'sessionController', 'typert']
  static Config = Config

  constructor(ctx, config = {}) {
    super(ctx, 'workspaceReferences')
    this.typertRemote = bindTypertRemote(this, 'workspaceReferences')
    this.options = normalizeOptions(config)
    this.references = new WorkspaceReferences({
      registry: () => ctx.workspaceRegistry,
      filesystem: agent => agent === undefined ? ctx.get('fs') : agent.ctx.get('fs'),
      sessionQuery: () => ctx.sessionQuery,
    }, this.options)
    this.planner = new RoutePlanner(this.references, this.options)
    this.delivery = new RouteDelivery(this.planner, ctx.sessionController, this.options, createUserMessage)
    ctx.effect(() => ctx.typert.register(hostContribution()), 'workspace-reference: strict Host RPC')
    const resolver = (path, options, fs) => this.references.translate(path, { ...options, fs })
    const register = scope => {
      if (typeof scope.fs.registerPathAlias !== 'function') throw new Error('Workspace references require the public filesystem path-alias provider. Install the matching foundation first.')
      scope.effect(() => scope.fs.registerPathAlias(resolver), 'workspace-reference: fs aliases')
    }
    register(ctx)
    const fibers = new Map()
    const disposals = new Set()
    const install = agent => {
      if (fibers.has(agent)) return fibers.get(agent)
      const fiber = agent.ctx.inject(['fs'], register)
      fibers.set(agent, fiber)
      return fiber
    }
    const remove = agent => {
      const fiber = fibers.get(agent)
      if (fiber === undefined) return
      fibers.delete(agent)
      const pending = fiber.dispose()
      disposals.add(pending)
      pending.then(() => disposals.delete(pending), error => { disposals.delete(pending); ctx.logger.warn('Workspace reference cleanup failed: %s', error.message) })
    }
    for (const agent of ctx.agents.list()) install(agent)
    ctx.on('agent/created', async ({ agent }) => { await install(agent) })
    ctx.on('agent/disposed', ({ agent }) => { remove(agent) })
    ctx.inject(['systemPrompt'], scope => {
      scope.systemPrompt.section({ name: 'context:workspace-reference', order: scope.systemPrompt.getSectionOrder('FILE_REFERENCE') + 2, text: WORKSPACE_REFERENCE_PROMPT })
    })
    ctx.inject(['sessionReferenceResolver'], scope => {
      scope.on('agent/pre-step', async (proposal, next) => prepareSessionContext(
        this.references, scope.sessionReferenceResolver, proposal, await next(),
        error => scope.logger.warn('Workspace session reference could not be loaded: %s', error.code ?? error.message),
      ))
    })
    ctx.effect(() => async () => {
      await this.delivery.dispose()
      this.planner.clear()
      const active = [...fibers.values()]
      fibers.clear()
      await Promise.all([...active.map(fiber => fiber.dispose()), ...disposals])
    }, 'workspace-reference: agent integrations')
  }

  match(query) { return this.references.match(query) }
  list(agent, query, signal, options) { return this.references.list(agent, query, signal, options) }
  resolve(query, options) { return this.references.resolve(query, options) }

  /** Strict owner UI entry; only explicit send may create or wake a Session. */
  async execute(input, signal) {
    const invocation = this.ctx.invocation
    if (invocation !== undefined && invocation.peer.principal.kind !== 'owner') return { ok: false, error: { code: 'owner-required', message: 'Workspace reference operations are owner-only.' } }
    const request = parseRequest(input)
    signal?.throwIfAborted()
    const agent = this.ctx.agents.get(request.sessionId)
    const header = await this.ctx.sessionQuery.readTitleSnapshot(request.sessionId, signal)
    const options = { agent, signal, cwd: header.session.cwd, sessionTitle: header.title?.title }
    let value
    if (request.action === 'candidates') value = await this.list(agent, request.query, signal, options) ?? []
    else if (request.action === 'resolve') value = await this.resolve(request.query, options) ?? { status: 'unmatched' }
    else if (request.action === 'plan') value = await this.planner.plan({ ...request, source: 'human' }, options)
    else value = await this.delivery.send({ ...request, source: 'human' }, options)
    return parseOutcome({ ok: true, value })
  }
}

export default WorkspaceReferenceService
