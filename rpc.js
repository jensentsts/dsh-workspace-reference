/** Strict Typert descriptors for the owner-only workspace reference service. */
export const PACKAGE_NAME = 'dsh-workspace-reference'
const object = value => { if (value === null || typeof value !== 'object' || Array.isArray(value)) throw new TypeError('request must be an object') }
const string = (value, name, max) => { if (typeof value !== 'string' || value.length === 0 || value.length > max || value.includes('\0')) throw new TypeError(`${name} must contain 1–${max} characters`); return value }

/** Admit only declared actions and fields before any registry lookup or side effect. */
export function parseRequest(value) {
  object(value)
  const fields = {
    candidates: ['action', 'sessionId', 'query'],
    resolve: ['action', 'sessionId', 'query'],
    plan: ['action', 'sessionId', 'requestId', 'text'],
    send: ['action', 'sessionId', 'requestId', 'text', 'mode', 'explicit'],
  }[value.action]
  if (fields === undefined || Object.keys(value).some(key => !fields.includes(key))) throw new TypeError('Unknown action or undeclared request field')
  const result = { action: value.action, sessionId: string(value.sessionId, 'sessionId', 256) }
  if (value.action === 'candidates' || value.action === 'resolve') {
    if (typeof value.query !== 'string' || value.query.length > 8192 || /[\0\r\n]/u.test(value.query)) throw new TypeError('query must be a single line of at most 8192 characters')
    result.query = value.query
  } else {
    result.requestId = string(value.requestId, 'requestId', 256)
    result.text = string(value.text, 'text', 1048576)
  }
  if (value.action === 'send') {
    if (value.explicit !== true || !['queue', 'steer'].includes(value.mode)) throw new TypeError('Explicit send and queue/steer mode are required')
    result.explicit = true
    result.mode = value.mode
  }
  return result
}

/** Validate the complete public outcome is JSON and bounded, never a provider object. */
export function parseOutcome(value) {
  object(value)
  if (typeof value.ok !== 'boolean' || Object.keys(value).some(key => !['ok', 'value', 'error'].includes(key))) throw new TypeError('Invalid workspace reference outcome')
  const serialized = JSON.stringify(value)
  if (serialized.length > 2097152) throw new TypeError('Workspace reference outcome exceeds the wire budget')
  return JSON.parse(serialized)
}
const requestCodec = { mode: 'strict', typeSymbol: 'WorkspaceReferenceRequest', create: () => ({ parse: parseRequest }) }
const resultCodec = { mode: 'strict', typeSymbol: 'WorkspaceReferenceOutcome', create: () => ({ parse: parseOutcome }) }

/** Same public descriptor is mounted on both Host and Client. */
export function remoteDescriptor() {
  return {
    id: `${PACKAGE_NAME}#workspaceReferences/execute`, service: 'workspaceReferences', namespace: 'workspaceReferences', method: 'execute',
    invocation: { kind: 'direct' },
    parameters: [{ name: 'request', wire: 'request', source: 'json', codec: requestCodec }],
    cancellation: { parameter: 'signal' }, result: resultCodec,
    description: 'Owner-only workspace references and explicit human route admission; ordinary lookup never sends.',
  }
}
export function hostContribution() {
  return { package: PACKAGE_NAME, face: 'host', schemas: [], invocations: [remoteDescriptor()], model: { services: [{ key: 'workspaceReferences', exportName: 'WorkspaceReferenceService', tags: [], members: [{ kind: 'method', name: 'execute', signature: 'execute(request: WorkspaceReferenceRequest, signal: AbortSignal): Promise<WorkspaceReferenceOutcome>' }], types: [] }], events: [], objects: [] } }
}
export function clientContribution() { return { package: PACKAGE_NAME, descriptors: [remoteDescriptor()] } }
