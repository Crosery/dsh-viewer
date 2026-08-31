/**
 * The `read`-on-media correction.
 *
 * The behaviour under test is specifically that it is NOT an error: a red
 * failure row for a file that exists and is perfectly readable is the thing this
 * module was rewritten to stop producing.
 */

import { deepEqual, equal, match, ok } from 'node:assert/strict'
import { test } from 'node:test'
import { isMisdirectedRead, mediaReadValue, readPathOf } from '../src/read-redirect.ts'
import { applySupersedeReadImage } from '../src/supersede-read-image.ts'
import { ViewerSettingsSchema } from '../src/settings.ts'

test('a read aimed at opaque media is corrected; a text read is left alone', () => {
  for (const path of ['/a/logo.png', '/a/clip.mp4', '/a/song.flac', '/a/doc.pdf', '/a/report.xlsx', '/a/deck.pptx']) {
    equal(isMisdirectedRead('read', { file_path: path }), true, path)
  }
  for (const path of ['/a/index.ts', '/a/page.html', '/a/README', '/a/.gitignore', '/a/data.json']) {
    equal(isMisdirectedRead('read', { file_path: path }), false, path)
  }
})

test('only the read tool is corrected', () => {
  equal(isMisdirectedRead('display_file', { file_path: '/a/logo.png' }), false)
  equal(isMisdirectedRead('write', { file_path: '/a/logo.png' }), false)
})

test('arguments that are not the expected shape are left to the tool own validation', () => {
  equal(readPathOf(undefined), undefined)
  equal(readPathOf('a string'), undefined)
  equal(readPathOf(['/a/logo.png']), undefined)
  equal(readPathOf({ file_path: 42 }), undefined)
  equal(readPathOf({ file_path: '   ' }), undefined)
  equal(isMisdirectedRead('read', { file_path: 42 }), false)
})

test('the replacement satisfies the shipped read tool output schema', () => {
  const value = mediaReadValue('/tmp/a.png')
  // Exactly the four properties `read` declares; an extra key would fail the
  // registry's `additionalProperties: false` validation before rendering.
  ok(Object.keys(value).sort().join(',') === 'lines,offset,path,totalLines')
  equal(value.path, '/tmp/a.png')
  equal(value.offset, 1)
  equal(value.totalLines, 1)
  equal(value.lines.length, 1)
  equal(value.lines[0]?.number, 1)
})

test('the replacement line names the kind and points at the display tool with the same path', () => {
  const value = mediaReadValue('/tmp/holiday.mp4')
  const text = value.lines[0]?.text ?? ''
  match(text, /\[video]/)
  match(text, /display_file/)
  match(text, /\/tmp\/holiday\.mp4/)
  // No "Error:" prefix anywhere — this outcome is a success, and the card must
  // not read like a failure.
  ok(!text.startsWith('Error'))
})

// --- one image entry point ------------------------------------------------

test('the settings schema defaults to superseding read_image', () => {
  const resolved = ViewerSettingsSchema({})
  equal(resolved.supersedeReadImage, true)
  equal(resolved.tool, true)
  equal(resolved.redirectRead, true)
  equal(resolved.feedModel, true)
})

/** A ctx double capturing the two listeners the module registers. */
function fakeCtx() {
  const on: Record<string, ((payload?: never) => void)[]> = {}
  const ctx = { on: (event: string, fn: (payload?: never) => void) => { (on[event] ??= []).push(fn) } } as never
  return {
    ctx,
    created: (agent: unknown) => { for (const fn of on['agent/created'] ?? []) fn({ agent } as never) },
    toolsChanged: () => { for (const fn of on['tools/change'] ?? []) fn(undefined as never) },
  }
}

/** An agent double whose `restrict` can be made to fail like an absent tool. */
function fakeAgent(available: { now: boolean }, denied: string[][]) {
  return {
    ctx: {
      tools: {
        restrict: (f: { deny: string[] }) => {
          if (!available.now) throw new Error('tools.restrict() names unknown global tool "read_image"')
          denied.push(f.deny)
          return () => {}
        },
      },
    },
  }
}

test('superseding hides read_image from each agent as it is created', () => {
  const denied: string[][] = []
  const h = fakeCtx()
  applySupersedeReadImage(h.ctx, () => true)
  h.created(fakeAgent({ now: true }, denied))
  deepEqual(denied, [['read_image']])
})

test('an absent read_image never vetoes agent creation', () => {
  const denied: string[][] = []
  const h = fakeCtx()
  applySupersedeReadImage(h.ctx, () => true)
  // A throwing `agent/created` listener vetoes the agent's publication, so the
  // absent-tool case must be swallowed rather than propagated.
  h.created(fakeAgent({ now: false }, denied))
  deepEqual(denied, [])
})

test('an agent created before read_image exists is restricted once the tool set changes', () => {
  // The real race: `read_image` is registered inside dsh-tool-fs's async
  // `attachments` injection, so an agent can be published before it exists.
  const denied: string[][] = []
  const availability = { now: false }
  const h = fakeCtx()
  applySupersedeReadImage(h.ctx, () => true)
  h.created(fakeAgent(availability, denied))
  deepEqual(denied, [], 'nothing to hide yet')

  availability.now = true
  h.toolsChanged()
  deepEqual(denied, [['read_image']], 'the retry catches up')

  // Idempotent: a further change must not re-restrict an agent already covered.
  h.toolsChanged()
  deepEqual(denied, [['read_image']])
})

test('the restriction stands down when the setting is off', () => {
  const denied: string[][] = []
  const h = fakeCtx()
  applySupersedeReadImage(h.ctx, () => false)
  h.created(fakeAgent({ now: true }, denied))
  h.toolsChanged()
  deepEqual(denied, [])
})
