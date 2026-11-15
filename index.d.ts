import { Service } from '@deepseek-ai/cordis'
import type { Agent } from '@deepseek-ai/dsh-agent'
import type { SessionId } from '@deepseek-ai/dsh-session/types'
import type { WorkspaceReferenceOptions, WorkspaceReferenceResolution, WorkspaceReferenceResolveOptions, FileReferenceCandidate, WorkspaceReferencesContract } from './references.js'
export * from './references.js'
export const WORKSPACE_REFERENCE_PROMPT: string;
export const Config: unknown;
export type WorkspaceReferenceRequest =
  | { action: 'candidates' | 'resolve'; sessionId: SessionId; query: string }
  | { action: 'plan'; sessionId: SessionId; requestId: string; text: string }
  | { action: 'send'; sessionId: SessionId; requestId: string; text: string; mode: 'queue' | 'steer'; explicit: true };
/** Public metadata and explicit human route service. Lookup never starts Agents. */
export class WorkspaceReferenceService extends Service implements WorkspaceReferencesContract {
  static inject: string[];
  static Config: unknown;
  constructor(ctx: import('@deepseek-ai/cordis').Context, config?: WorkspaceReferenceOptions);
  match(query: string): 'hint' | 'path' | undefined;
  list(agent: Agent | undefined, query: string, signal?: AbortSignal, options?: { cwd?: string }): Promise<FileReferenceCandidate[] | undefined>;
  resolve(query: string, options?: WorkspaceReferenceResolveOptions): Promise<WorkspaceReferenceResolution | undefined>;
  execute(request: WorkspaceReferenceRequest, signal?: AbortSignal): Promise<{ ok: true; value: object } | { ok: false; error: { code: string; message: string } }>;
}
declare module '@deepseek-ai/cordis' { interface Context { workspaceReferences: WorkspaceReferenceService } }
declare module '@deepseek-ai/dsh-llm' {
  interface MessageSourceMap {
    /** Human-confirmed routed block; message.id is the admission receipt anchor. */
    'workspace-reference': { kind: 'workspace-reference'; originSessionId: SessionId; requestId: string; blockIndex: number };
  }
}
export default WorkspaceReferenceService;
