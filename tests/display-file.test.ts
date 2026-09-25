/**
 * The `display_file` execution path against a context double: what a nested
 * call does with model context, and which converter a document goes through.
 *
 * The double is deliberately thin — `tools.register` hands back the definition
 * so `execute` can be driven directly, and `fs` serves one real file from disk —
 * so each case pins one decision the tool makes rather than the harness around it.
 */

import { deepEqual, equal, match, ok } from 'node:assert/strict'
import { mkdtemp, readdir, readFile, stat, writeFile } from 'node:fs/promises'
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
 * PNGs, a vision-capable model route, and an optional `officeToPdf`.
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

test('a DOCX goes through the harness converter when one is composed, and is cached', async () => {
  const pdf = new TextEncoder().encode('%PDF-1.7\n% converted by the fake\n%%EOF\n')
  const requests: { extension: string; version: string; key: string; read: Uint8Array }[] = []
  const officeToPdf = {
    generation: 'gen-1',
    convert: async (request: {
      extension: string
      priority: string
      source: { key: string; version: string; bytes?: number; read(signal: AbortSignal, max: number): Promise<{ bytes: Uint8Array; version: string }> }
    }) => {
      const read = await request.source.read(new AbortController().signal, 1 << 20)
      requests.push({ extension: request.extension, version: request.source.version, key: request.source.key, read: read.bytes })
      return { pdf }
    },
  }
  const docx = new TextEncoder().encode('PK not really a docx')
  const h = await harness({ name: 'report.docx', bytes: docx }, { officeToPdf })
  const cacheDir = join(h.dir, 'cache')
  applyDisplayTool(h.ctx as never, { feedModel: () => true, secret: () => SECRET, cacheDir })

  const first = await h.tool().execute({ file_path: h.path }, execution(false).exec)
  equal(first.kind, 'document')
  equal(first.mediaType, 'application/pdf', 'the card is served the converted artifact')
  equal(first.unavailable, undefined)
  ok(first.assetUrl?.startsWith(`${ASSET_ROUTE}?`))
  equal(requests.length, 1)
  equal(requests[0]?.extension, 'docx')
  match(requests[0]?.key ?? '', /dsh-viewer/)
  deepEqual([...requests[0]!.read], [...docx], 'the provider read the source through the Host filesystem')

  const artifacts = (await readdir(cacheDir)).filter(name => name.endsWith('.pdf'))
  equal(artifacts.length, 1, 'exactly one artifact, and no partial file left behind')
  deepEqual([...await readFile(join(cacheDir, artifacts[0]!))], [...pdf])
  deepEqual((await readdir(cacheDir)).filter(name => name.includes('.partial')), [])

  const second = await h.tool().execute({ file_path: h.path }, execution(false).exec)
  equal(second.assetUrl, first.assetUrl, 'the same artifact is signed again')
  equal(requests.length, 1, 'and the second display is a cache hit')
})

test('a format the harness converter does not take never reaches it', async () => {
  let called = false
  const officeToPdf = { convert: async () => { called = true; return { pdf: new Uint8Array() } } }
  const h = await harness({ name: 'notes.odt', bytes: new TextEncoder().encode('odt') }, { officeToPdf })
  applyDisplayTool(h.ctx as never, { feedModel: () => true, secret: () => SECRET, cacheDir: join(h.dir, 'cache') })
  // Whatever LibreOffice makes of these bytes, the bundled converter is not asked.
  await h.tool().execute({ file_path: h.path }, execution(false).exec).catch(() => undefined)
  equal(called, false)
})

test('a failing harness converter degrades to a card that says why, not a failed call', async () => {
  const officeToPdf = { convert: async () => { throw new Error('the Office kit is unavailable') } }
  const h = await harness({ name: 'deck.pptx', bytes: new TextEncoder().encode('pptx') }, { officeToPdf })
  applyDisplayTool(h.ctx as never, { feedModel: () => true, secret: () => SECRET, cacheDir: join(h.dir, 'cache') })
  const value = await h.tool().execute({ file_path: h.path }, execution(false).exec)
  equal(value.kind, 'document')
  if (value.assetUrl === undefined) {
    // No LibreOffice to fall back to (or it could not read the bytes either):
    // the card carries the bundled converter's reason, the more useful one.
    match(value.unavailable ?? '', /harness converter failed \(the Office kit is unavailable\)/)
  } else {
    equal(value.unavailable, undefined, 'a local LibreOffice rescued the preview')
  }
})
