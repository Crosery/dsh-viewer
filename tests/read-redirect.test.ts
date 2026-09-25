/**
 * The `read`-on-media correction.
 *
 * The behaviour under test is specifically that it is NOT an error: a red
 * failure row for a file that exists and is perfectly readable is the thing this
 * module was rewritten to stop producing.
 */

import { deepEqual, equal, match, ok } from 'node:assert/strict'
import { test } from 'node:test'
import {
  applyReadRedirect, displaySectionOrder, displaySectionText, isMisdirectedRead, mediaReadValue, readPathOf,
} from '../src/read-redirect.ts'
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
  const on: Record<string, ((payload?: never) => unknown)[]> = {}
  const ctx = { on: (event: string, fn: (payload?: never) => unknown) => { (on[event] ??= []).push(fn) } } as never
  return {
    ctx,
    /** Publish one agent; returns what each listener returned. */
    created: (agent: unknown) => (on['agent/created'] ?? []).map(fn => fn({ agent } as never)),
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

test('the agent/created listener returns undefined, as the 0.1.6+ serial event requires', () => {
  // 0.1.6 made `agent/created` a serial event awaited by agent creation, typed
  // `undefined | Promise<undefined>` (issue #10). A listener returning anything
  // else would be a type error there and a stray value at runtime.
  const h = fakeCtx()
  applySupersedeReadImage(h.ctx, () => true)
  deepEqual(h.created(fakeAgent({ now: true }, [])), [undefined])
  deepEqual(h.created(fakeAgent({ now: false }, [])), [undefined], 'also on the swallowed-failure path')
})

// --- the prompt section ---------------------------------------------------

test('the section sits right after the read guidance on every train', () => {
  // 0.1.7 allocates orders centrally: TOOL_READ is 1100.
  equal(displaySectionOrder({ getSectionOrder: (name: string) => (name === 'TOOL_READ' ? 1100 : 0) }), 1101)
  // Earlier trains have no lookup, and the read guidance sat at 100.
  equal(displaySectionOrder({}), 101)
  equal(displaySectionOrder(undefined), 101)
  // A lookup that does not know the name must not take the plugin down.
  equal(displaySectionOrder({ getSectionOrder: () => { throw new Error('unknown section') } }), 101)
  equal(displaySectionOrder({ getSectionOrder: () => Number.NaN }), 101)
})

test('the section is empty wherever display_file is not callable', () => {
  equal(displaySectionText(() => false), '')
  equal(displaySectionText(tool => tool === 'present'), '', 'present alone is not a reason to talk about display_file')
})

test('the section defers deliverables to present only where present exists', () => {
  const alone = displaySectionText(tool => tool === 'display_file')
  match(alone, /display_file/)
  ok(!/present/.test(alone), 'no mention of a tool the model does not have')

  const both = displaySectionText(tool => tool === 'display_file' || tool === 'present')
  match(both, /inline preview and playback/)
  match(both, /present tool/)
  match(both, /markdown image/)
  match(both, /never display, embed, and present the same file/)
})

test('the registered section reads tool visibility per assembly scope', () => {
  const sections: { name: string; order: number; text: unknown }[] = []
  const visible = new Map<unknown, Set<string>>([
    ['agent-with', new Set(['display_file', 'present'])],
    ['agent-without', new Set()],
  ])
  const ctx = {
    systemPrompt: {
      getSectionOrder: () => 1100,
      section: (section: { name: string; order: number; text: unknown }) => { sections.push(section); return () => {} },
    },
    tools: { get: (name: string, scope?: unknown) => (visible.get(scope)?.has(name) ? { name } : undefined) },
    on: () => {},
  }
  applyReadRedirect(ctx as never, () => true)
  equal(sections.length, 1)
  const section = sections[0]!
  equal(section.name, 'tool:display-file')
  equal(section.order, 1101)
  equal(typeof section.text, 'function', 'text is evaluated per assembly, not frozen at registration')
  const text = section.text as (context: { scope?: unknown }) => string
  match(text({ scope: 'agent-with' }), /present tool/)
  equal(text({ scope: 'agent-without' }), '', 'a restricted-away or switched-off tool is not advertised')
})
