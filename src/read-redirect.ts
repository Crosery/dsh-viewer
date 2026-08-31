/**
 * Keeping `read` off opaque media — without turning it into a failure.
 *
 * The shipped `read` is a UTF-8 decode. Pointed at a PNG or an MP4 it does not
 * fail: it returns thousands of replacement characters, which the model then
 * tries to interpret. That is worse than an error, because the model has no
 * signal that it read nothing.
 *
 * Worse still, the shipped filesystem provider does not even get that far: it
 * samples the head of the file and throws `FS_NOT_TEXT` (`cannot read "…":
 * binary file`) on a NUL byte. So a `read` aimed at a PNG paints a RED FAILURE
 * ROW into the transcript with or without this plugin — for a file that exists,
 * is perfectly readable, and is one tool call away from being on screen.
 *
 * Neither obvious correction removes that row. A `tools/pre-execute` denial
 * materializes its own `isError`. A `tools/post-execute` decision cannot help
 * either: replacing a value is explicitly refused on a failed result, and
 * replacing content leaves `isError` set.
 *
 * The correction therefore runs in `tools/execute`, the around-dispatch
 * waterfall, and does NOT delegate — `next()` is never called, so the doomed
 * read performs no filesystem I/O at all. The authored result is what makes
 * this work: the registry feeds a wrapper's returned result through
 * `normalizeDispatchResult`, which for a success re-runs the owning tool's
 * `output.render` AND its `output.presentationMeta` over the authored value.
 * Replacing the value therefore replaces the persisted read metadata too, so
 * the shipped read card — which rebuilds itself from that metadata — renders
 * this plugin's one-line pointer as an ordinary SUCCESSFUL read.
 * @module @crosery/dsh-viewer/read-redirect
 */

import type { Context } from '@deepseek-ai/cordis'
import type { ToolExecutionResult } from '@deepseek-ai/dsh-tools'
import type {} from '@deepseek-ai/dsh-system-prompt'
import { DISPLAY_TOOL, READ_TOOL, classifyPath, isOpaqueMediaPath } from './contract.ts'

/**
 * The replacement `read` value for one misdirected call.
 *
 * Shaped to the shipped `read` tool's own output schema — `path`, `offset`,
 * `lines`, `totalLines` — because the registry validates the replacement
 * against that schema before projecting it. One line of explanation reads
 * correctly in every surface the value reaches: as the model's tool output, as
 * the read card's single content line, and in a replayed session.
 * @param filePath - the path the model asked to read.
 * @returns the canonical value to substitute.
 */
export function mediaReadValue(filePath: string): {
  path: string
  offset: number
  lines: { number: number; text: string }[]
  totalLines: number
} {
  const kind = classifyPath(filePath).kind
  return {
    path: filePath,
    offset: 1,
    lines: [{
      number: 1,
      text: `[${kind}] This file is binary media, not UTF-8 text — there is nothing here to read. Call ${DISPLAY_TOOL} with file_path "${filePath}" to show it to the user.`,
    }],
    totalLines: 1,
  }
}

/**
 * Read the `file_path` argument out of one `read` call.
 *
 * The arguments arrive as losslessly parsed JSON of whatever the model emitted,
 * so nothing about their shape is guaranteed; anything that is not a non-empty
 * string path is left for the tool's own validation to reject.
 * @param args - the parsed call arguments.
 * @returns the path, or `undefined` when the call names none.
 */
export function readPathOf(args: unknown): string | undefined {
  if (typeof args !== 'object' || args === null || Array.isArray(args)) return undefined
  const { file_path: filePath } = args as Record<string, unknown>
  return typeof filePath === 'string' && filePath.trim().length > 0 ? filePath : undefined
}

/**
 * Whether one pending call is a text read aimed at opaque media.
 * @param name - the wire tool name.
 * @param args - the parsed call arguments.
 * @returns true when the dispatch should be replaced with the display pointer.
 */
export function isMisdirectedRead(name: string, args: unknown): boolean {
  if (name !== READ_TOOL) return false
  const filePath = readPathOf(args)
  return filePath !== undefined && isOpaqueMediaPath(filePath)
}

/**
 * Install the correction and the prompt section that makes it unnecessary.
 *
 * The section is the primary mechanism — a model told about `display_file` up
 * front rarely reaches the correction — and the correction is the backstop for
 * the calls that get there anyway.
 * @param ctx - the plugin context; both registrations are effects on it.
 * @param enabled - live read of the `redirectRead` setting.
 */
export function applyReadRedirect(ctx: Context, enabled: () => boolean): void {
  ctx.systemPrompt.section({
    name: 'tool:display-file',
    // Just after the shipped `tool:read` guidance (order 100), so the two read
    // as one instruction about which tool opens which kind of file.
    order: 101,
    text: `Use the ${DISPLAY_TOOL} tool to show the user an image, video, audio file, PDF, Office document (Word/Excel/PowerPoint), or HTML page — it renders inline in the web UI with a real player or viewer. The ${READ_TOOL} tool decodes UTF-8 text and cannot open any of them; calling it on one returns a pointer back to ${DISPLAY_TOOL} and nothing else. Prefer ${DISPLAY_TOOL} whenever the user asks to see, view, open, play, watch, or listen to a file.`,
  })

  ctx.on('tools/execute', async (exec, next): Promise<ToolExecutionResult> => {
    if (!enabled() || !isMisdirectedRead(exec.name, exec.arguments)) return await next()
    const filePath = readPathOf(exec.arguments)
    if (filePath === undefined) return await next()
    // Deliberately no `next()`: delegating would run a read that can only fail.
    // `content` here is a placeholder — the registry regenerates it from the
    // owning tool's own renderer over this value.
    return { isError: false, value: mediaReadValue(filePath), content: [] }
  })
}
