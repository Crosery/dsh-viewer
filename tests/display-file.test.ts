/**
 * The `display_file` execution path against a context double: what a nested
 * call does with model context.
 *
 * The double is deliberately thin — `tools.register` hands back the definition
 * so `execute` can be driven directly, and `fs` serves one real file from disk —
 * so each case pins one decision the tool makes rather than the harness around it.
 */

import { deepEqual, equal, ok } from 'node:assert/strict'
import { mkdtemp, readFile, stat, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'
import { applyDisplayTool } from '../src/display-file.ts'
import type { DisplayValue } from '../src/contract.ts'
import { ASSET_ROUTE } from '../src/contract.ts'

/** A minimal PNG: the 8-byte signature is all `display_file` itself reads. */
const PNG = Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0])

/** What `execute` sees of one registered tool. */
interface RegisteredTool {
  execute(args: { file_path: string }, exec: unknown): Promise<DisplayValue>
  output: { render(args: unknown, value: DisplayValue): { type: string }[] }
}

/**
 * A context double with one file on "disk", an attachment store that accepts
 * PNGs, and a vision-capable model route.
 */
async function harness(file: { name: string; bytes: Uint8Array }, services: Record<string, unknown> = {}) {
  const dir = await mkdtemp(join(tmpdir(), 'dsh-viewer-display-'))
  const path = join(dir, file.name)
  await writeFile(path, file.bytes)
  const info = await stat(path)
  let registered: RegisteredTool | undefined
  const emitted: string[] = []
  const saved: unknown[] = []
  const all: Record<string, unknown> = {
    attachments: {
      imageLimits: { mediaTypes: ['image/png'], maxImageBytes: 1 << 20, maxMessageImageBytes: 1 << 20 },
      saveImage: async (input: { mediaType: string; name: string }) => {
        saved.push(input)
        return { attachmentId: 'att-1', mediaType: input.mediaType, bytes: 12, width: 4, height: 3, name: input.name }
      },
    },
    llm: { resolveModelInfo: async () => ({ inputModalities: ['text', 'image'] }) },
    ...services,
  }
  const target = { displayPath: path }
  const ctx = {
    tools: { register: (definition: RegisteredTool) => { registered = definition; return () => {} } },
    fs: {
      resolve: async () => target,
      stat: async () => ({ type: 'file', size: info.size, version: `v-${info.mtimeMs}` }),
      processPath: () => path,
      readBytes: async (_target: unknown, _signal: unknown, max: number) => {
        const bytes = await readFile(path)
        if (bytes.byteLength > max) throw Object.assign(new Error('too large'), { code: 'FS_TOO_LARGE' })
        return new Uint8Array(bytes)
      },
    },
    get: (name: string) => all[name],
    emit: (event: string) => { emitted.push(event) },
  }
  return { ctx, dir, path, emitted, saved, tool: () => registered! }
}

/** An execution on a vision route; `nested` gives it a parent, as run_code does. */
function execution(nested: boolean) {
  const deferred: unknown[] = []
  const exec = {
    agent: { session: { requestHeader: () => undefined, header: {} }, options: { provider: 'p', model: 'm' } },
    signal: new AbortController().signal,
    ...nested ? { parent: { token: 'parent' } } : {},
    deferContext: (context: unknown) => { deferred.push(context) },
  }
  return { exec, deferred }
}

const SECRET = Buffer.alloc(32, 7)

test('a nested call no longer defers its image into context itself', async () => {
  const h = await harness({ name: 'shot.png', bytes: PNG })
  applyDisplayTool(h.ctx as never, { feedModel: () => true, secret: () => SECRET, cacheDir: join(h.dir, 'cache') })
  const { exec, deferred } = execution(true)
  const value = await h.tool().execute({ file_path: h.path }, exec)

  equal(value.inContext, true, 'the image still belongs in context on a vision route')
  deepEqual(deferred, [], 'but the code-mode transport defers it — a second copy from here was the duplicate')
  // The transport's auto-deferral keys on an image block in the rendered
  // content, so the image must still be there for it to find.
  const blocks = h.tool().output.render({}, value)
  ok(blocks.some(block => block.type === 'image'), 'render still carries the image block the transport defers')
})

test('a top-level call behaves exactly as before and defers nothing either', async () => {
  const h = await harness({ name: 'shot.png', bytes: PNG })
  applyDisplayTool(h.ctx as never, { feedModel: () => true, secret: () => SECRET, cacheDir: join(h.dir, 'cache') })
  const { exec, deferred } = execution(false)
  const value = await h.tool().execute({ file_path: h.path }, exec)
  equal(value.inContext, true)
  deepEqual(deferred, [])
  ok(value.assetUrl?.startsWith(`${ASSET_ROUTE}?`))
})
