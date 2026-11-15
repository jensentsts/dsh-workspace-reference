import { parseRouting, sessionReferenceMentions } from './syntax.js'

/** Render submitted session references through the native user-text pipeline. */
export const sessionReferenceTextRule = {
  id: 'workspace-session-reference',
  order: 5,
  match(text, from) {
    const { value: mention } = sessionReferenceMentions(text, from).next()
    if (mention === undefined) return undefined
    return {
      id: 'workspace-session-reference', start: mention.start, end: mention.end,
      data: { label: mention.parsed.session.name ?? null },
    }
  },
}

/** Build an independent public inputTriggers source; no DOM or provider replacement. */
export function createInputSource({ execute, translate, requestId, review }) {
  return {
    trigger: '@', name: 'workspace-reference', order: -10, showGroupTitle: false, matchEnterAnywhere: true,
    async candidates(session, { query, signal }) {
      const result = await execute({ action: 'candidates', sessionId: session.sessionId, query }, signal)
      return result.map(item => ({
        name: item.label || translate('untitledSession'),
        description: [item.workspaceTitle, Number.isFinite(item.createdAt) ? new Date(item.createdAt).toLocaleString() : undefined].filter(Boolean).join(' · ') || undefined,
        icon: item.kind === 'workspace' ? 'workspace' : item.kind === 'session' ? 'session' : item.kind === 'directory' ? 'folder' : 'file',
        badge: translate(item.kind), section: translate('section'), value: item.mention, ...(item.drill ? { drill: true } : {}),
      }))
    },
    onPick({ candidate, action }) {
      if (typeof candidate.value !== 'string') return undefined
      if (action === 'drill') {
        const path = candidate.value.endsWith('"') ? `${candidate.value.slice(0, -1).replace(/\/$/u, '')}/` : `${candidate.value.replace(/\/$/u, '')}/`
        return { text: path, continue: true }
      }
      return { insert: { source: 'workspace-reference', ref: candidate.value, label: candidate.name, appearance: candidate.icon === 'session' ? 'session' : candidate.icon === 'file' ? 'file' : 'folder', clipboardText: candidate.value } }
    },
    async matchEnter(session, line, signal, envelope) {
      if (envelope.rawText === undefined) {
        if (parseRouting(line).routed) throw new Error(translate('rawDraftRequired'))
        return undefined
      }
      if (!/^ {0,3}@[^\r\n]*:[ \t]*$/mu.test(envelope.rawText)) return undefined
      const parsed = parseRouting(envelope.rawText)
      if (parsed.status === 'invalid') throw new Error(translate('invalidRoute'))
      if (!parsed.routed) return undefined
      if (envelope.attachments !== 0) throw new Error(translate('routeAttachments'))
      const result = await review({ sessionId: session.sessionId, requestId: requestId(), text: envelope.rawText }, signal)
      if (result.status !== 'accepted') throw new Error(translate('routeFailed'))
      // A successful command settlement commits the original draft. The
      // generic 'handled' outcome deliberately retains drafts for popups.
      return { claim: { name: 'workspace-route', token: '@', submit: async () => ({ kind: 'success' }) } }
    },
    codec: { clipboardText: ref => ref, serialize: ref => Promise.resolve(ref) },
  }
}
