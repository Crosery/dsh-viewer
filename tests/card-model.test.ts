/**
 * Card derivation, including the replay paths.
 *
 * The blocks here are plain objects rather than fixtures from the runtime: the
 * point of these cases is precisely what the card does with a shape it did not
 * write — an older log, a truncated window, a foreign tool's result.
 */

import { equal, ok } from 'node:assert/strict'
import { test } from 'node:test'
import type { ToolCallBlock } from '@deepseek-ai/dsh-client-runtime/client'
import { argumentPathOf, cardModel, contentImageOf, envelopeValueOf } from '../src/client/card-model.ts'
import { formatDisplayOutput } from '../src/display-file.ts'
import { ASSET_ROUTE, DISPLAY_TOOL, READ_IMAGE_TOOL } from '../src/contract.ts'

const IMAGE = { attachmentId: 'att-1', mediaType: 'image/png', bytes: 100, width: 20, height: 10 }

/** A running call, as the tree hands it over before the result lands. */
function running(args: string): ToolCallBlock {
  return { callId: 'c1', name: DISPLAY_TOOL, argsRaw: args, turn: 1, step: 1, time: 0, callView: null, subCalls: [] } as unknown as ToolCallBlock
}

/** A settled call. */
function settled(fields: Partial<Record<string, unknown>>): ToolCallBlock {
  return {
    kind: 'tool-result',
    seq: 2,
    time: 0,
    callId: 'c1',
    call: { name: DISPLAY_TOOL, argsRaw: '{"file_path":"/tmp/a.png"}' },
    callTime: 0,
    content: [],
    isError: false,
    callView: null,
    resultView: null,
    subCalls: [],
    ...fields,
  } as unknown as ToolCallBlock
}

test('a dispatched call renders the path it named before any result exists', () => {
  const state = cardModel(running('{"file_path":"/tmp/clip.mp4"}'), DISPLAY_TOOL)
  equal(state.phase, 'running')
  equal(state.phase === 'running' ? state.path : undefined, '/tmp/clip.mp4')
})

test('arguments that are not the expected object yield no path instead of throwing', () => {
  equal(argumentPathOf(running('not json')), undefined)
  equal(argumentPathOf(running('[1,2]')), undefined)
  equal(argumentPathOf(running('{"file_path":42}')), undefined)
  equal(argumentPathOf(running('{}')), undefined)
})

test('a failed call surfaces the tool text, and falls back to the code when there is none', () => {
  const withText = cardModel(settled({ isError: true, content: [{ type: 'text', text: 'not found' }] }), DISPLAY_TOOL)
  equal(withText.phase === 'failed' ? withText.message : '', 'not found')
  const bare = cardModel(settled({ isError: true, content: [], error: { name: 'FsError', code: 'FS_NOT_FOUND' } }), DISPLAY_TOOL)
  equal(bare.phase === 'failed' ? bare.message : '', 'FS_NOT_FOUND')
})

test('a display result is rebuilt from its persisted metadata', () => {
  const meta = {
    path: '/tmp/clip.mp4', kind: 'video', mediaType: 'video/mp4', bytes: 900,
    inContext: false, assetUrl: `${ASSET_ROUTE}?p=abc&s=def`,
  }
  const state = cardModel(settled({ meta }), DISPLAY_TOOL)
  equal(state.phase, 'ready')
  equal(state.phase === 'ready' ? state.value.kind : '', 'video')
  equal(state.phase === 'ready' ? state.value.assetUrl : '', meta.assetUrl)
})

test('the shipped read_image, which persists no metadata, is rebuilt from its image content block', () => {
  const state = cardModel(settled({
    call: { name: READ_IMAGE_TOOL, argsRaw: '{"file_path":"/tmp/logo.png"}' },
    content: [
      { type: 'text', text: '<path>/tmp/logo.png</path>\n<type>image</type>' },
      { type: 'image', attachment: IMAGE },
    ],
  }), READ_IMAGE_TOOL)
  equal(state.phase, 'ready')
  ok(state.phase === 'ready')
  equal(state.value.kind, 'image')
  equal(state.value.path, '/tmp/logo.png')
  equal(state.value.image?.attachmentId, 'att-1')
  // Nothing to stream: those bytes only exist in the attachment store.
  equal(state.value.assetUrl, undefined)
  // read_image only ever runs on an image-capable route.
  equal(state.value.inContext, true)
})

test('a window cut that dropped the call head still yields a card, using the envelope path', () => {
  const state = cardModel(settled({
    call: null,
    content: [
      { type: 'text', text: '<path>/tmp/from-envelope.png</path>' },
      { type: 'image', attachment: IMAGE },
    ],
  }), READ_IMAGE_TOOL)
  equal(state.phase === 'ready' ? state.value.path : '', '/tmp/from-envelope.png')
})

test('metadata this build cannot read falls through to the content block rather than failing', () => {
  const state = cardModel(settled({
    meta: { path: '/tmp/a.png', kind: 'quantum-hologram' },
    content: [{ type: 'image', attachment: IMAGE }],
  }), DISPLAY_TOOL)
  equal(state.phase, 'ready')
})

test('a settled call with nothing recoverable still renders a row instead of throwing', () => {
  const state = cardModel(settled({ meta: undefined, content: [{ type: 'text', text: 'ok' }] }), DISPLAY_TOOL)
  equal(state.phase, 'bare')
  equal(state.phase === 'bare' ? state.path : '', '/tmp/a.png')
})

test('a malformed attachment in a content block is skipped, not rendered', () => {
  equal(contentImageOf([{ type: 'image', attachment: { attachmentId: 'x' } }]), undefined)
  equal(contentImageOf([null, 'text', { type: 'text', text: 'x' }]), undefined)
  equal(contentImageOf([{ type: 'image', attachment: IMAGE }])?.attachmentId, 'att-1')
})

// --- nested (run_code) dispatch recovery ---------------------------------
// The registry projects `presentationMeta` only for top-level calls, so a
// display_file called from inside run_code arrives with no metadata at all.
// Without envelope recovery the card is a bare header, which is exactly the
// "shows only a title, no render block" symptom this covers.

test('a nested display_file rebuilds its card from the envelope alone', () => {
  const envelope = formatDisplayOutput({
    path: '/tmp/site/index.html',
    kind: 'html',
    mediaType: 'text/html',
    bytes: 2048,
    inContext: false,
    assetUrl: `${ASSET_ROUTE}?p=abc&s=def`,
  })
  const state = cardModel(settled({
    meta: undefined,
    call: { name: DISPLAY_TOOL, argsRaw: '{"file_path":"/tmp/site/index.html"}' },
    content: [{ type: 'text', text: envelope }],
  }), DISPLAY_TOOL)
  equal(state.phase, 'ready')
  ok(state.phase === 'ready')
  equal(state.value.kind, 'html')
  equal(state.value.mediaType, 'text/html')
  equal(state.value.bytes, 2048)
  equal(state.value.assetUrl, `${ASSET_ROUTE}?p=abc&s=def`)
})

test('every kind round-trips through the envelope, so no medium loses its player when nested', () => {
  for (const [kind, mediaType] of [['image', 'image/png'], ['video', 'video/mp4'], ['audio', 'audio/mpeg'], ['pdf', 'application/pdf'], ['document', 'application/pdf'], ['file', 'application/octet-stream']] as const) {
    const envelope = formatDisplayOutput({
      path: `/tmp/a.${kind}`, kind, mediaType, bytes: 10, inContext: false, assetUrl: `${ASSET_ROUTE}?p=a&s=b`,
    })
    equal(envelopeValueOf([{ type: 'text', text: envelope }], false)?.kind, kind, kind)
  }
})

test('an envelope with no asset still rebuilds, so the card explains instead of vanishing', () => {
  const envelope = formatDisplayOutput({
    path: '/tmp/a.docx', kind: 'document', mediaType: 'application/vnd.x', bytes: 99, inContext: false,
  })
  const value = envelopeValueOf([{ type: 'text', text: envelope }], false)
  equal(value?.assetUrl, undefined)
  equal(value?.kind, 'document')
})

test('a foreign envelope, or one naming an off-route asset, is refused', () => {
  equal(envelopeValueOf([{ type: 'text', text: 'just some prose' }], false), undefined)
  equal(envelopeValueOf([{ type: 'text', text: '<path>/a</path>\n<type>html</type>' }], false), undefined)
  const forged = '<path>/a</path>\n<type>html</type>\n<media>text/html</media>\n<bytes>1</bytes>\n<asset>https://evil.example/x</asset>'
  equal(envelopeValueOf([{ type: 'text', text: forged }], false), undefined)
})
