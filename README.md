# Workspace references / 工作区引用

> 插件集导航与市场索引：https://github.com/jensentsts/dsh-independent-plugins


Independent DSH 0.2.2-rc.1 extension, version 0.2.0. Workspace/session identity comes from the official registries; ordinary file tools use the composed `ctx.fs` provider, not a metadata approximation. No dependency on bubble conversations, the resource picker, Super IO, QQ or a remote transport.

## Reference syntax

- `@Research/src/main.ts` and `@ws:Research/src/main.ts` coexist. `workspace:` is the long alias of `ws:`.
- Sessions require `@Research/s:Discussion` or `/session:Discussion`. `@Research/Discussion` is a file path, never a guessed session.
- Stable copy includes full IDs: `@ws:Research{workspace-full-id}/s:Discussion{session-full-id}`. IDs are authority; stale names report rename information and never redirect to a same-name object. Unknown IDs and wrong-parent sessions fail.
- Whole-token quotes preserve spaces: `@"ws:研究 项目{workspace-full-id}/s:方案 讨论{session-full-id}"`.
- `\{`, `\}`, `\"`, `\:`, and `\\` escape reserved characters. Names containing `/`, controls or edge whitespace use the ID-only fallback `@ws:{workspace-full-id}`. File braces must be escaped; paths use `/`, reject empty segments, `.`/`..`, drive segments and backslashes.
- Duplicate names are not first-match. A short workspace name that is also a local directory or link is ambiguous: choose explicit `ws:` for the workspace or `@./Research/file` for local. A failed local metadata probe never means no collision.
- Bare tool paths such as `Research/file` remain local. Only a leading `@` opts into filesystem alias translation. Session tokens are always rejected by file operations. Peer-qualified `@host:` and `/rmt/` paths remain owned by the existing remote provider; process-backed local search refuses remote references explicitly.

The formatter exports stable copy and `stable:false` name-only copy. The public input source inserts stable literal clipboard text with friendly labels, workspace/session/file/folder glyphs and localized type badges. The session chip in the composer and submitted message, autocomplete, and route review display titles. The saved reference and routing receipt keep the full IDs.

In the linked Desktop profile with the repaired foundation, `@ws:111_` produced the matching workspace's name, icon and localized type badge in the native composer. The draft was cleared after the observation.

## Ordinary file operations

The matching foundation adds `FileSystem.registerPathAlias(resolver)` and `normalizePathAlias(path, options)` public methods. `LocalFileSystem` owns the reversible registry and applies aliases before native `resolve`/`lstat`; multiple independent claims fail. Repeated ownership of the same resolver is reference counted and a caller Context's disposer removes its registration.

An alias yields a native path and optional registered root. The same provider still creates target identity, checks canonical containment and applies the original sandbox and version guards. Missing leaf files can be created; alias paths and physical paths share `targetKey`, observation and stale checks. `lstat` retains final-link information but rejects intermediate links escaping the alias root. This does not grant permission to read or write another workspace.

`glob` and `grep` remain subprocess-backed with unchanged schemas. Explicit alias roots translate through the composed filesystem and `processPath` before argv construction; ordinary roots and process sandbox policy remain unchanged. An unavailable alias provider or unsupported remote process path fails before spawn.

## Explicit human routing

Only human composer submission is inspected. Assistant text, tool output, relays and ordinary reference lookup never trigger forwarding. Each destination header must occupy its own line and end with an unescaped `:`:

```text
local text before routing
@ws:Research{workspace-full-id}:
new session text
@ws:Research{workspace-full-id}/s:Discussion{session-full-id}:
existing session text
@:
back to current session
```

Fenced code (including long fences), indented code, block quotes and their lazy continuation, inline code, escaped markers/colons and headers sharing a line with other text do not route. The composer passes the complete untrimmed draft in the public trigger envelope. A reference chip's separator space before the final colon is accepted as part of the standalone route syntax.

Enter opens a review showing every block and its current/new/existing destination. No session is created and no Agent resumed during review. If the public overlay declaration is unavailable, routing refuses immediately; declaration loss cancels an unconfirmed review. Confirmation revalidates full IDs and workspace/session membership before any admission; stale or removed objects reject rather than follow a name. New routes create official sessions, existing routes use `sessionController.resolveAgent`, and admission uses native `Agent.followup` or explicitly requested `steer` with `createUserMessage`.

Every routed message has `source.kind = workspace-reference` with `originSessionId`, `requestId` and `blockIndex`. Receipts include the actual `message.id`; they never infer a log seq. An accepted receipt means inbox admission, not model completion. Per-block results distinguish created, accepted, failed, unknown and cancelled. Cancellation cannot retract admitted messages or delete an already-created blank session. After a failure later blocks are not silently sent elsewhere. Attachments are refused before planning; send them directly in the target session instead.

The service exposes separate strict owner-only `candidates`, `resolve`, `plan` and explicit `send` actions through Typert. No model tool exposes `send` and no AI reply parser calls it. Host consumers must invoke it only for a genuine explicit human action; a caller-supplied `source` string is not an authorization mechanism.

## Lifecycle and limits

Config retains the 0.1 bounds `maxResults`, `maxEntries`, `maxQueryLength`, `maxMentions`, `maxMessageChars`, `maxMappingChars`; `maxRoutes` defaults to 32 and `maxPlans` to 64. Registry/title queries read current metadata, not content. Lookup exceptions remain visible and cancellation is propagated.

Plans are bounded and refuse new requests at capacity rather than evicting a still-reviewed target. Admission idempotency is **process/plugin-lifetime only**, not durable exactly-once: it refuses new requests at capacity rather than evict accepted/uncertain facts. Repeated IDs join their existing result; different content conflicts. The review reuses a failed/unknown request's ID for the same retained draft to prevent an immediate blind resend. Reload/restart clears these ephemeral records; inspect receipts before deliberately resending after reload.

Unload removes aliases, source registration, dictionaries, overlay, strict RPC descriptors and prompt. An in-flight official create/resume operation does not expose cancellation, so unload waits for that operation to settle; cancellation is rechecked before admission, and a retained blank session is reported. The plugin never disposes a borrowed Agent.

## Upgrade and mounting

0.2 replaces the 0.1 instance decorator and pre-step path-mapping text with public filesystem aliases and an independent Client source. Install matching foundations first: the local/sandboxed or composed remote provider must implement the alias registrar, and native input packages must expose badge/rawText/anywhere adjudication. An older provider fails activation loudly; the plugin does not monkeypatch methods or fall back to fake metadata support.

The same `workspace-reference` Loader row can retain compatible numeric limits. Only one version of this package/Client factory may be mounted. Use the supported bundle manager; installation, profile changes, actual routing and rollback are coordinated by the lead. Merely copying/building these files does not activate anything. Rollback restores the prior package row and matching foundations together.

## Development evidence

Pure syntax/reference/planning/review tests use Node's built-in runner. The real Cordis/native filesystem suites use the separately obtained exact 0.2.2-rc.1 source through the shared test-only loader, not installed old dependencies. `node build.mjs` emits the lazy browser module from local sources; `node --check` validates all JavaScript. No install script runs.

Verified locally: ordinary read/write/edit identity, stale guard rejection, missing-leaf create, alias lifecycle/refcount/ambiguity, directory junction containment, native search path translation, typed source/picks, full Markdown exclusions, reviewed explicit routing against fake admissions, fresh target revalidation, cancellation, partial failures, bounded idempotency and strict request parsing. Native Client input suites cover generic adjudication, raw indentation and badge presentation. Installation, rendered live UI and actual cross-session delivery remain separate verification, not claimed here.

## Model Experience

An owner can cite `@ws:Research/s:Discussion` in an ordinary DSH message. At that step the plugin resolves the cited session in the workspace registry and calls the official `sessionReferenceResolver.prepare` service. The service adds its bounded, read-only snapshot as untrusted model context. Quoted or fenced Markdown examples stay literal. External inputs do not trigger this lookup. File references still use the native file tools.

### KV Cache effect

One stable prompt section changes the prefix while mounted. Lookup and Client review add no model request prefix; confirmed delivery creates real separately identified messages in the target sessions.

## Known Limitations and Deferred Work

- Session-routing attachments and automatic AI forwarding are intentionally unavailable.
- Idempotency and receipts are bounded process-lifetime state, not crash-safe deduplication or model-result attribution.
- Exact foundations are required for the selected filesystem provider; updating one Local class does not retrofit a separately loaded legacy remote subclass.
- The native workspace badge was observed in Desktop; actual submission to multiple sessions remains separate from that completion observation.
- Broader source baselines on this Windows environment fail independently: file-symlink tests require privilege; the native subprocess child cannot resolve its `koffi` dependency through the test-only source loader even though ripgrep exists. No permission escalation, dependency installation or runtime replacement is attempted by this package.
