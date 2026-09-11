/**
 * Path resolution shared by the display tool and the read-redirect policy.
 *
 * `dsh-tool-fs` keeps its own `read-target`/`session-cwd` modules private (its
 * package entry exports only `apply`/`Config`), so the session-cwd rule is
 * restated here rather than imported. Keeping it byte-for-byte compatible
 * matters: a path this plugin resolved differently from `read` would display a
 * different file than the one the model believes it named.
 * @module @crosery/dsh-viewer/read-target
 */
import type { Context } from '@deepseek-ai/cordis';
import type { FsInfo, FsTarget } from '@deepseek-ai/dsh-fs';
import type { ToolExecution } from '@deepseek-ai/dsh-tools';
/**
 * The session workspace cwd for this call, or `undefined` when none applies.
 *
 * Non-agent callers get `undefined` on purpose: the fallback belongs to the
 * filesystem provider, not to a tool reading `process.cwd()` at its boundary.
 * @param exec - the tool execution; only its optional `agent` is read.
 * @param requestedPath - the path about to be resolved; parent traversal makes a
 *   symlinked cwd's filesystem identity observable, so the cwd is canonicalized
 *   in exactly that case.
 * @returns the calling agent's session cwd, or `undefined`.
 */
export declare function sessionCwd(exec: ToolExecution, requestedPath: string): string | undefined;
/**
 * Resolve a model-supplied path, observe absence, and require a regular file.
 * @param ctx - the plugin context supplying `fs` and the observation event.
 * @param exec - the current execution, for session cwd and cancellation.
 * @param requestedPath - the raw path the model supplied.
 * @returns the resolved target and its single stat result.
 * @throws {FsError} when the path is absent or is not a regular file.
 */
export declare function resolveDisplayTarget(ctx: Context, exec: ToolExecution, requestedPath: string): Promise<{
    target: FsTarget;
    info: FsInfo;
}>;
