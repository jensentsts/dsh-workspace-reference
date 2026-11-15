import type { Agent } from '@deepseek-ai/dsh-agent'
import type { FileSystem, FsPathAlias, FsPathAliasOptions } from '@deepseek-ai/dsh-fs'
import type { SessionId } from '@deepseek-ai/dsh-session/types'
import type { WorkspaceId } from '@deepseek-ai/dsh-workspace/types'

export interface WorkspaceIdentity { id: WorkspaceId; title: string; path: string; sessionIds: readonly SessionId[] }
export interface SessionIdentity { id: SessionId; title: string; cwd?: string; createdAt?: number }
export interface FileReferenceCandidate {
  path: string; mention: string; kind: 'file' | 'directory' | 'workspace' | 'session'; label: string; id?: string; drill?: boolean;
  workspaceTitle?: string; createdAt?: number;
}
export interface WorkspaceReferenceOptions {
  maxResults?: number; maxEntries?: number; maxQueryLength?: number;
  maxMentions?: number; maxMessageChars?: number; maxMappingChars?: number;
  maxRoutes?: number; maxPlans?: number;
}
export type WorkspaceReferenceResolution =
  | { status: 'resolved'; workspace: WorkspaceIdentity; relativePath: string; path: string; kind: 'file' | 'directory'; workspaceRenamed?: { supplied: string; current: string } }
  | { status: 'resolved'; workspace: WorkspaceIdentity; session: SessionIdentity; kind: 'session'; workspaceRenamed?: { supplied: string; current: string }; sessionRenamed?: { supplied: string; current: string } }
  | { status: 'ambiguous'; query: string; reason: string; candidates: readonly object[]; truncated: boolean }
  | { status: 'invalid' | 'missing' | 'unavailable'; query: string; reason: string }
export interface WorkspaceReferenceResolveOptions { agent?: Agent; signal?: AbortSignal; cwd?: string; fs?: FileSystem }
export interface WorkspaceReferencesContract {
  match(query: string): 'hint' | 'path' | undefined;
  list(agent: Agent | undefined, query: string, signal?: AbortSignal, options?: { cwd?: string }): Promise<FileReferenceCandidate[] | undefined>;
  resolve(query: string, options?: WorkspaceReferenceResolveOptions): Promise<WorkspaceReferenceResolution | undefined>;
}
export const DEFAULTS: Readonly<Required<WorkspaceReferenceOptions>>;
export function normalizeOptions(options?: WorkspaceReferenceOptions): Required<WorkspaceReferenceOptions>;
export function mergeCandidates(preferred: FileReferenceCandidate[], fallback: FileReferenceCandidate[], limit?: number): FileReferenceCandidate[];
export class ReferenceError extends Error { readonly result: WorkspaceReferenceResolution; constructor(result: WorkspaceReferenceResolution) }
export class WorkspaceReferences implements WorkspaceReferencesContract {
  constructor(dependencies: {
    registry: () => { list(): WorkspaceIdentity[] };
    filesystem: (agent?: Agent) => FileSystem | undefined;
    sessionQuery?: () => { readTitleSnapshots(ids: readonly SessionId[], signal?: AbortSignal): Promise<readonly { sessionId: SessionId; status: 'fulfilled' | 'rejected'; value?: { session: { cwd?: string; createdAt?: number }; title?: { title: string } } }[]> };
  }, options?: WorkspaceReferenceOptions);
  readonly options: Required<WorkspaceReferenceOptions>;
  match(query: string): 'hint' | 'path' | undefined;
  list(agent: Agent | undefined, query: string, signal?: AbortSignal, options?: { cwd?: string }): Promise<FileReferenceCandidate[] | undefined>;
  resolve(query: string, options?: WorkspaceReferenceResolveOptions): Promise<WorkspaceReferenceResolution | undefined>;
  translate(path: string, options?: FsPathAliasOptions & { fs?: FileSystem }): Promise<FsPathAlias | undefined>;
}
