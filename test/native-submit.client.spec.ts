// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import { createScope } from '@deepseek-ai/dsh-api-session-controller/client'
import { InputTriggerController } from '@deepseek-ai/dsh-client-ui-input-trigger/client'
import type { InputTriggerSource } from '@deepseek-ai/dsh-client-ui-input-trigger/client'
import { SessionInputShell } from '@deepseek-ai/dsh-client-ui-conversation/src/client/input/facade.ts'
import type { SessionId } from '@deepseek-ai/dsh-session/types'
import { createInputSource } from '../integration.js'

function fixture(review: (request: object) => Promise<object>) {
  const ctx = new Context()
  const sessionId = 'native-submit-fixture' as SessionId
  const scope = createScope(ctx, sessionId)
  const source: InputTriggerSource = createInputSource({ execute: async () => [], translate: (key: string) => key, requestId: () => 'review-id', review })
  const sources = [source]
  const controller = new InputTriggerController({ actx: scope.ctx, sessionId, roster: { all: () => sources, sources: trigger => sources.filter(item => item.trigger === trigger) } })
  const sink = vi.fn(async () => ({ kind: 'success' as const }))
  const shell = new SessionInputShell({ actx: scope.ctx, inputTriggers: () => controller, defaultSink: sink, commandAttachments: { serialize: async () => [], release: () => {}, unsupportedNotice: () => 'unsupported' } })
  return { ctx, controller, shell, sink }
}

describe('real native route submission', () => {
  it('uses TriggerController to settle one confirmed route, clears draft, and never submits a second local copy even for steer', async () => {
    const review = vi.fn(async () => ({ status: 'accepted', blocks: [] }))
    const f = fixture(review)
    try {
      f.shell.setDraft('local prefix\n@ws:Work:\nbody\n@:\nlocal suffix')
      f.shell.submit('steer', 'enter')
      await vi.waitFor(() => { expect(review).toHaveBeenCalledOnce(); expect(f.shell.snapshot.draft).toBe('') })
      expect(f.sink).not.toHaveBeenCalled()
      f.shell.submit('steer', 'enter')
      await Promise.resolve()
      expect(review).toHaveBeenCalledOnce()
      expect(f.sink).not.toHaveBeenCalled()
    } finally { f.shell.dispose(); f.controller.dispose(); await f.ctx.fiber.dispose() }
  })

  it('retains an unaccepted route draft and does not fallback after partial admission', async () => {
    const f = fixture(async () => ({ status: 'partial', blocks: [{ accepted: true }] }))
    try {
      const text = '@ws:Work:\nbody'
      f.shell.setDraft(text); f.shell.submit('queue', 'enter')
      await vi.waitFor(() => { expect(f.shell.snapshot.phase).toBe('plain'); expect(f.shell.notices.getSnapshot()?.level).toBe('error') })
      expect(f.shell.snapshot.draft).toBe(text)
      expect(f.sink).not.toHaveBeenCalled()
    } finally { f.shell.dispose(); f.controller.dispose(); await f.ctx.fiber.dispose() }
  })

  it.each(['    @ws:Work:\n    code', '\t@ws:Work:\n\tcode', '````\n@ws:Work:\n````', '> @ws:Work:\n> quoted'])(
    'keeps Markdown on ordinary native message path without route review: %s', async text => {
      const review = vi.fn(async () => ({ status: 'accepted' }))
      const f = fixture(review)
      try {
        f.shell.setDraft(text); f.shell.submit('queue', 'enter')
        await vi.waitFor(() => { expect(f.sink).toHaveBeenCalledOnce() })
        expect(review).not.toHaveBeenCalled()
      } finally { f.shell.dispose(); f.controller.dispose(); await f.ctx.fiber.dispose() }
    },
  )
})
