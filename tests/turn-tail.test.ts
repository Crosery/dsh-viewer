/**
 * The turn tail's data and visibility rules: which files a completed turn
 * keeps on screen, and when the tail stays out of the way.
 *
 * The Definition is driven the way the Conversation engine drives it — `match`
 * on every event, `start` on the turn's start, `update` for the rest, and
 * `buildLocationData` for the turn scope — over events shaped like 0.1.7's.
 */

import { deepEqual, equal, ok, throws } from 'node:assert/strict'
import { test } from 'node:test'
import {
  VIEWER_TURN_DATA, displayedValueOf, foldSourceOf, foldsCompletedTurns, tailDisplays, turnStaysOpen,
  viewerTurnDefinition, type EventLike, type TurnLike, type ViewerTurnData, type ViewerTurnState,
} from '../src/client/turn-tail.ts'
import { formatDisplayOutput } from '../src/display-file.ts'
import { ASSET_ROUTE, type DisplayValue } from '../src/contract.ts'

const PNG: DisplayValue = { path: '/w/shot.png', kind: 'image', mediaType: 'image/png', bytes: 10, inContext: false, assetUrl: `${ASSET_ROUTE}?p=a&s=b` }
const MP4: DisplayValue = { path: '/w/clip.mp4', kind: 'video', mediaType: 'video/mp4', bytes: 99, inContext: false, assetUrl: `${ASSET_ROUTE}?p=c&s=d` }

const call = (seq: number, callId: string, name: string, turn = 1): EventLike =>
  ({ type: 'tool/call', seq, data: { turn, step: 1, callId, name, arguments: '{}' } })
const result = (seq: number, callId: string, meta: unknown, extra: Record<string, unknown> = {}, turn = 1): EventLike =>
  ({ type: 'tool/result', seq, surfaceOp: 'append', data: { turn, message: { source: { callId }, content: [], isError: false, ...extra }, meta } })

/** Run one turn's events through the Definition and publish its turn data. */
function fold(events: EventLike[]): ViewerTurnData | undefined {
  let state: ViewerTurnState | undefined
  for (const event of events) {
    const matched = viewerTurnDefinition.match(event)
    if (matched === null) continue
    if (matched.role === 'start') state = viewerTurnDefinition.start({}, { event })
    else if (state !== undefined) state = viewerTurnDefinition.update({ state }, { event })
  }
  return viewerTurnDefinition.buildLocationData({ state }, 'turn', null)?.value
}

/** A completed turn whose data store answers with the folded data. */
function closedTurn(data: ViewerTurnData | undefined, end: unknown = { data: { reason: { kind: 'completed' } } }): TurnLike {
  return { status: 'closed', end, data: { get: key => (key === VIEWER_TURN_DATA ? data : undefined) } }
}

test('the Definition collects a turn’s successful display_file results, and nothing else', () => {
  const data = fold([
    { type: 'turn/start', seq: 1, data: { turn: 1 } },
    call(2, 'c1', 'display_file'),
    call(3, 'c2', 'read'),
    result(4, 'c2', { path: '/w/a.txt' }),
    result(5, 'c1', PNG),
    call(6, 'c3', 'display_file'),
    result(7, 'c3', undefined, { isError: true }),
  ])
  deepEqual(data?.displayed.map(entry => [entry.seq, entry.callId, entry.value.path]), [[5, 'c1', '/w/shot.png']])
})

test('a replacement copy of a result is not counted twice', () => {
  const replacement: EventLike = { ...result(9, 'c1', PNG), surfaceOp: 'replace' }
  equal(viewerTurnDefinition.match(replacement), null)
})

test('a result written without presentation metadata is recovered from its envelope', () => {
  const value = displayedValueOf({
    message: { isError: false, content: [{ type: 'text', text: formatDisplayOutput(MP4) }] },
  })
  equal(value?.kind, 'video')
  equal(value?.assetUrl, MP4.assetUrl)
})

test('events outside a turn and unrelated events never match', () => {
  equal(viewerTurnDefinition.match({ type: 'tool/call', seq: 1, data: { callId: 'x', name: 'display_file' } }), null, 'no turn')
  equal(viewerTurnDefinition.match({ type: 'assistant/message', seq: 1, data: { turn: 1 } }), null)
  throws(() => viewerTurnDefinition.start({}, { event: call(1, 'c', 'display_file') }))
})

test('a turn that displayed nothing publishes nothing', () => {
  equal(fold([{ type: 'turn/start', seq: 1, data: { turn: 1 } }, call(2, 'c', 'read')]), undefined)
})

test('unchanged turn data is republished as the same value', () => {
  let state = viewerTurnDefinition.start({}, { event: { type: 'turn/start', seq: 1, data: { turn: 1 } } })
  state = viewerTurnDefinition.update({ state }, { event: call(2, 'c1', 'display_file') })
  state = viewerTurnDefinition.update({ state }, { event: result(3, 'c1', PNG) })
  const first = viewerTurnDefinition.buildLocationData({ state }, 'turn', null)
  ok(first !== null)
  equal(viewerTurnDefinition.buildLocationData({ state }, 'turn', first), first)
  equal(viewerTurnDefinition.buildLocationData({ state }, 'step', null), null, 'turn data only')
})

test('the tail shows what the turn displayed before its closing reply, once per file', () => {
  const data: ViewerTurnData = {
    displayed: [
      { seq: 5, callId: 'c1', value: PNG },
      { seq: 7, callId: 'c2', value: MP4 },
      { seq: 9, callId: 'c3', value: PNG },
      { seq: 30, callId: 'c4', value: MP4 },
    ],
  }
  const shown = tailDisplays(closedTurn(data), 20)
  deepEqual(shown.map(entry => entry.callId), ['c2', 'c3'], 'the later PNG replaces the earlier one; the result after the reply belongs elsewhere')
})

test('the tail stays empty while the turn is open, and after an abort or error', () => {
  const data: ViewerTurnData = { displayed: [{ seq: 5, callId: 'c1', value: PNG }] }
  equal(tailDisplays({ ...closedTurn(data), status: 'open' }, 20).length, 0)
  equal(turnStaysOpen(closedTurn(data, { data: { reason: { kind: 'aborted' } } })), true)
  equal(tailDisplays(closedTurn(data, { data: { reason: { kind: 'error' } } }), 20).length, 0)
  equal(tailDisplays(closedTurn(data), 20).length, 1)
  equal(tailDisplays(closedTurn(undefined), 20).length, 0, 'a turn with no data')
  equal(tailDisplays({ status: 'closed' }, 20).length, 0, 'an owner without a data store')
})

test('only the verbose transcript turns the tail off', () => {
  for (const mode of ['compact', 'standard', 'detailed', undefined]) equal(foldsCompletedTurns(mode), true, String(mode))
  equal(foldsCompletedTurns('verbose'), false)
})

test('the fold preference follows the chat’s settings form, and defaults to folding', () => {
  let mode: string | undefined = 'standard'
  const listeners = new Set<() => void>()
  const form = {
    getSnapshot: () => ({ value: { transcriptView: mode } }),
    subscribe: (listener: () => void) => { listeners.add(listener); return () => { listeners.delete(listener) } },
  }
  const source = foldSourceOf(() => ({ get: (id: string) => (id === 'ui-chat' ? form : undefined) }))
  equal(source.getSnapshot(), true)
  let notified = 0
  const stop = source.subscribe(() => { notified += 1 })
  mode = 'verbose'
  for (const listener of listeners) listener()
  equal(notified, 1)
  equal(source.getSnapshot(), false)
  stop()
  equal(listeners.size, 0)

  equal(foldSourceOf(() => undefined).getSnapshot(), true, 'no settings service yet')
  equal(foldSourceOf(() => ({ get: () => { throw new Error('unknown entry') } })).getSnapshot(), true, 'a form lookup that throws')
})
