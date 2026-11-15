import { proseMask, sessionReferenceMentions } from './syntax.js'

const MAX_REFERENCED_SESSIONS = 3

function ownerInput({ source }) {
  if (source.kind === 'user') return source.principal === undefined
  return source.kind === 'workspace-reference'
    && typeof source.originSessionId === 'string' && source.originSessionId !== ''
    && typeof source.requestId === 'string' && source.requestId !== ''
    && Number.isSafeInteger(source.blockIndex) && source.blockIndex >= 0
}

async function resolveInputs(content, references, agent, signal) {
  const inputs = new Map()
  const seen = new Set()
  let chars = 0
  for (const block of content) {
    if (block.type !== 'text') continue
    chars += block.text.length
    if (chars > references.options.maxMessageChars) break
    for (const { raw } of sessionReferenceMentions(proseMask(block.text))) {
      if (seen.has(raw)) continue
      if (seen.size >= references.options.maxMentions) return [...inputs.values()]
      seen.add(raw)
      const target = await references.resolve(raw, { agent, cwd: agent.session.header.cwd, signal })
      if (target?.status !== 'resolved' || target.kind !== 'session' || target.session.id === agent.id) continue
      if (inputs.has(target.session.id)) continue
      inputs.set(target.session.id, { sessionId: target.session.id, label: target.session.title || 'Session' })
      if (inputs.size === MAX_REFERENCED_SESSIONS) return [...inputs.values()]
    }
  }
  return [...inputs.values()]
}

/** Attach the native bounded snapshot to references cited in the current owner input. */
export async function prepareSessionContext(references, resolver, proposal, decision, onError) {
  if (decision.kind !== 'enter' || proposal.messages.length === 0 || !proposal.messages.every(ownerInput)) return decision
  const { agent, modelSelection, signal } = proposal
  const claimed = new Map(proposal.messages.map(message => [message.id, message]))
  const messages = []
  for (const message of decision.messages) {
    messages.push(message)
    const original = claimed.get(message.id)
    if (original === undefined || !ownerInput(message)) continue
    try {
      const inputs = await resolveInputs(original.content, references, agent, signal)
      if (inputs.length === 0) continue
      const prepared = await resolver.prepare(agent, message.content, inputs, modelSelection, signal)
      signal.throwIfAborted()
      if (prepared.additionalContext !== undefined) messages.push(prepared.additionalContext)
    } catch (error) {
      signal.throwIfAborted()
      onError(error)
    }
  }
  return messages.length === decision.messages.length ? decision : { ...decision, messages }
}
