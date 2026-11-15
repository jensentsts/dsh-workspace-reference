import React from 'react'
import { Modal, ReferenceChip } from '@deepseek-ai/dsh-client-ui-primitives'
import { createInputSource, sessionReferenceTextRule } from './integration.js'
import { clientContribution } from './rpc.js'
import { RouteReview } from './review.js'
import en from './locale/en.json' with { type: 'json' }
import zh from './locale/zh.json' with { type: 'json' }

const NS = 'local.workspace-reference'
const h = React.createElement

function SessionMention({ node, t }) {
  const label = node.data.label ?? t('untitledSession')
  return h(ReferenceChip, { appearance: 'session', label, title: label })
}

function routeDestination(block, t) {
  const title = block.sessionTitle || (block.mode === 'existing' ? t('untitledSession') : '')
  return [block.workspaceTitle, title].filter(Boolean).join(' / ')
}

const routeErrors = {
  'workspace-not-found': 'workspaceMissing', 'session-not-found': 'sessionMissing',
  'workspace-name-duplicated': 'workspaceAmbiguous', 'session-name-duplicated': 'sessionAmbiguous',
  'workspace-or-local-directory': 'workspaceAmbiguous', 'session-title-unavailable': 'sessionUnavailable',
}

/** Confirmation uses the native modal focus/shortcut layer; only plain data enters the view. */
function ReviewOverlay({ useRouteReview, confirm, cancel, close, t }) {
  const state = useRouteReview(value => value)
  if (state === null) return null
  const receipt = state.phase === 'receipt'
  const lock = state.phase === 'sending'
  const blocks = receipt ? state.result?.blocks ?? [] : state.plan.blocks ?? []
  const button = (text, action, disabled = false) => h('button', { type: 'button', onClick: action, disabled, style: { padding: '6px 12px', borderRadius: 6, border: '1px solid var(--dsw-alias-border-l1)', background: 'var(--dsw-alias-interactive-bg-hover)', color: 'inherit', cursor: disabled ? 'default' : 'pointer' } }, text)
  return h(Modal, {
    open: true, onClose: receipt ? close : cancel,
    title: t(receipt ? 'routeReceipts' : 'routeReview'), closeLabel: t('close'),
    description: t(receipt ? 'receiptHint' : 'reviewHint'),
    footer: h('div', { style: { display: 'flex', justifyContent: 'flex-end', gap: 8 } }, receipt ? button(t('close'), close) : h(React.Fragment, null, button(t(lock ? 'cancelRemaining' : 'cancel'), cancel), button(t(lock ? 'sending' : 'confirmSend'), confirm, lock || state.plan.status !== 'planned'))),
  },
    state.plan.status !== 'planned' && h('p', { role: 'alert' }, t(state.plan.status === 'invalid' ? 'invalidRoute' : 'routeTargetUnavailable')),
    state.error && h('p', { role: 'alert' }, state.error),
    ...blocks.map(block => h('article', { key: block.index, style: { borderTop: '1px solid var(--dsw-alias-border-l1)', padding: '10px 0' } },
      h('strong', null, `${block.index + 1}. ${t(block.mode ?? 'rejected')}`),
      h('div', { style: { overflowWrap: 'anywhere' } }, routeDestination(block, t)),
      block.target?.reason && h('p', { role: 'alert' }, t(routeErrors[block.target.reason] ?? 'routeTargetUnavailable')),
      receipt ? h('p', { role: 'status' }, `${t(block.status)}${block.created ? ` · ${t('created')}` : ''}${block.error ? ` · ${block.error.code}` : ''}`)
        : h('pre', { style: { whiteSpace: 'pre-wrap', maxHeight: 180, overflow: 'auto', fontFamily: 'inherit' } }, block.text))))
}

export const inject = ['inputTriggers', 'remote', 'locale', 'slots', 'uiConversation']

/** Public registry contribution. Selection inserts literal stable clipboard text. */
export async function apply(ctx) {
  await ctx.remote.$mount(clientContribution())
  ctx.inject(['remote.workspaceReferences'], scope => {
    scope.effect(() => scope.locale.register(NS, { en, zh }), 'workspace-reference: dictionaries')
    const t = scope.locale.bind(NS)
    const remote = scope['remote.workspaceReferences']
    const execute = async (request, signal) => {
      const result = await remote.execute(request, signal)
      if (!result.ok) throw new Error(result.error.message)
      if (!result.value.ok) throw new Error(result.value.error.message)
      return result.value.value
    }
    const review = new RouteReview(execute)
    scope.effect(() => () => review.dispose(), 'workspace-reference: route review')
    scope.slots.inject('shell.overlay', function* () {
      yield scope.effect(() => { review.setAvailable(true); return () => review.setAvailable(false) }, 'workspace-reference: review availability')
      yield scope.slots.register({
        name: 'shell.overlay', id: 'local.workspace-route-review', order: 120, locale: NS,
        inject: () => ({ hooks: { routeReview: review }, confirm: () => review.confirm(), cancel: () => review.cancel(), close: () => review.close() }),
      }, ReviewOverlay)
    })
    scope.uiConversation.userText.register(sessionReferenceTextRule)
    scope.slots.inject('conversation.user.text.node', function* () {
      yield scope.slots.register({
        name: 'conversation.user.text.node', key: sessionReferenceTextRule.id, priority: 100, locale: NS,
      }, SessionMention)
    })
    const source = createInputSource({ execute, translate: key => t(key), requestId: () => crypto.randomUUID(), review: (request, signal) => review.open(request, signal) })
    scope.effect(() => scope.inputTriggers.registerSource(source), 'workspace-reference: @ source')
  })
}
