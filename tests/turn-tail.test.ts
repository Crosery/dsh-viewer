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
  CHAT_TURN_PROCESS, VIEWER_TURN_DATA, VIEWER_TURN_END, displayedValueOf, foldSourceOf, foldsCompletedTurns,
  hasInterleavedInput, humanInputDefinition, nestedDisplayDefinition, tailDisplays, turnEndDefinition, turnStaysOpen,
  viewerTurnDefinition, viewerTurnDefinitions,
  type EventLike, type MatchLike, type ReaderLike, type TurnLike, type ViewerTurnData, type ViewerTurnState,
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

/** The Definition surface the engine double drives. */
interface DefinitionLike {
  kind: string
  match(event: EventLike): { id: string; role: 'start' | 'update' } | null
  start(context: unknown, match: MatchLike, reader?: ReaderLike): unknown
  update(context: { state: never }, match: MatchLike): unknown
  buildLocationData?(context: { state?: never }, scope: string, previous?: null): { turn: number; key: string; value: unknown } | null
}

/**
 * A small double of the Conversation engine, enough for these Definitions: it
 * places each event in the turn whose `turn/start` … `turn/end` range holds it
 * (`unplaced` seqs stay unresolved), starts and updates contexts in log order,
 * answers `reader.previous(kind)` with the latest context of that kind started
 * earlier, and collects each context's turn data. The real 0.1.6 and 0.1.7
 * engines were driven through the same Definitions over a window, a live tail
 * and a prepended older page while this was written.
 */
function assemble(events: EventLike[], unplaced: ReadonlySet<number> = new Set(), chatData: Record<number, Record<string, unknown>> = {}) {
  const contexts = new Map<string, { kind: string; state: unknown; definition: DefinitionLike }>()
  const latest = new Map<string, { state: unknown }>()
  const starts = new Map<number, EventLike>()
  let open: number | undefined
  for (const event of events) {
    if (event.type === 'turn/start') {
      open = (event.data as { turn: number }).turn
      starts.set(open, event)
    }
    const location = open === undefined || unplaced.has(event.seq as number) ? { kind: 'unresolved' } : { kind: 'step', turn: { turn: open } }
    for (const definition of viewerTurnDefinitions as unknown as DefinitionLike[]) {
      const matched = definition.match(event)
      if (matched === null) continue
      const key = `${definition.kind}:${matched.id}`
      const context = contexts.get(key)
      if (context === undefined) {
        if (matched.role !== 'start') continue
        const reader: ReaderLike = { previous: kind => latest.get(kind) }
        const created = { kind: definition.kind, definition, state: definition.start({}, { event, location }, reader) }
        contexts.set(key, created)
        latest.set(definition.kind, created)
      } else {
        context.state = definition.update({ state: context.state as never }, { event, location })
      }
    }
    if (event.type === 'turn/end') open = undefined
  }
  const data = new Map<number, Map<string, unknown>>()
  for (const { definition, state } of contexts.values()) {
    const published = definition.buildLocationData?.({ state: state as never }, 'turn', null)
    if (published == null) continue
    const turn = data.get(published.turn) ?? new Map<string, unknown>()
    turn.set(published.key, published.value)
    data.set(published.turn, turn)
  }
  return (turn: number): TurnLike => ({
    status: 'closed',
    start: starts.get(turn),
    end: { data: { reason: { kind: 'completed' } } },
    data: { get: key => data.get(turn)?.get(key) ?? chatData[turn]?.[key] },
  })
}

const turnStart = (seq: number, turn: number): EventLike => ({ type: 'turn/start', seq, data: { turn } })
const turnEnd = (seq: number, turn: number): EventLike => ({ type: 'turn/end', seq, data: { turn, reason: { kind: 'completed' } } })
/** One settled sub-dispatch inside `run_code`, as the code-mode bridge logs it: no turn, no metadata. */
const dispatched = (seq: number, subCallId: string, name: string, value?: DisplayValue, isError = false): EventLike => ({
  type: 'tool/ptc-dispatch',
  seq,
  data: {
    rootCallId: 'rc', parentCallId: 'rc', subCallId, name, arguments: {}, isError,
    content: [{ type: 'text', text: value === undefined ? 'failed' : formatDisplayOutput(value) }],
  },
})

test('a display made inside run_code reaches the tail, beside the turn’s top-level displays', () => {
  const turn = assemble([
    turnStart(1, 1),
    call(2, 'd1', 'display_file'),
    result(3, 'd1', MP4),
    call(4, 'rc', 'run_code'),
    { type: 'tool/ptc-dispatch-start', seq: 5, data: { rootCallId: 'rc', parentCallId: 'rc', subCallId: 'rc:ptc:1', name: 'display_file', arguments: {} } },
    dispatched(6, 'rc:ptc:1', 'display_file', PNG),
    dispatched(7, 'rc:ptc:2', 'read'),
    dispatched(8, 'rc:ptc:3', 'display_file', undefined, true),
    result(9, 'rc', undefined),
    turnEnd(20, 1),
  ])
  deepEqual(tailDisplays(turn(1), 15).map(entry => [entry.callId, entry.value.path]), [['d1', '/w/clip.mp4'], ['rc:ptc:1', '/w/shot.png']])
  equal(tailDisplays(turn(1), 15)[1]?.value.assetUrl, PNG.assetUrl, 'rebuilt from the envelope: a nested dispatch has no metadata')
})

test('each turn keeps only its own nested displays', () => {
  const turn = assemble([
    turnStart(1, 1), dispatched(2, 'a:ptc:1', 'display_file', PNG), turnEnd(3, 1),
    turnStart(4, 2), call(5, 'd1', 'display_file', 2), result(6, 'd1', MP4, {}, 2), turnEnd(7, 2),
    turnStart(8, 3), dispatched(9, 'b:ptc:1', 'display_file', MP4), dispatched(10, 'b:ptc:2', 'display_file', PNG), turnEnd(11, 3),
  ])
  deepEqual(tailDisplays(turn(1), 99).map(entry => entry.callId), ['a:ptc:1'])
  deepEqual(tailDisplays(turn(2), 99).map(entry => entry.callId), ['d1'], 'turn 1’s nested display does not leak forward')
  deepEqual(tailDisplays(turn(3), 99).map(entry => entry.callId), ['b:ptc:1', 'b:ptc:2'])
})

test('one file displayed at the top level and again inside run_code appears once, where it was shown last', () => {
  const turn = assemble([turnStart(1, 1), call(2, 'd1', 'display_file'), result(3, 'd1', PNG), dispatched(4, 'rc:ptc:1', 'display_file', PNG), turnEnd(9, 1)])
  deepEqual(tailDisplays(turn(1), 5).map(entry => entry.callId), ['rc:ptc:1'])
})

test('a nested display the engine could not place belongs to no turn', () => {
  const turn = assemble([turnStart(1, 1), dispatched(2, 'rc:ptc:1', 'display_file', PNG), turnEnd(3, 1)], new Set([2]))
  deepEqual(tailDisplays(turn(1), 99), [])
})

test('the nested and turn-end Definitions match only what they own', () => {
  equal(nestedDisplayDefinition.match(dispatched(1, 'rc:ptc:1', 'read')), null)
  equal(nestedDisplayDefinition.match({ type: 'tool/ptc-dispatch-start', seq: 1, data: { subCallId: 'x', name: 'display_file' } }), null)
  deepEqual(nestedDisplayDefinition.match(dispatched(1, 'rc:ptc:1', 'display_file', PNG)), { id: 'rc:ptc:1', role: 'start' })
  equal(nestedDisplayDefinition.publication(), 'none', 'it publishes nothing of its own')
  deepEqual(turnEndDefinition.match(turnEnd(9, 4)), { id: '4', role: 'start' })
  equal(turnEndDefinition.match({ type: 'turn/end', seq: 9, data: {} }), null)
  throws(() => turnEndDefinition.start({}, { event: turnStart(1, 1) }))
  // Without a reader (an engine that predates it) a turn simply finds nothing nested.
  deepEqual(turnEndDefinition.start({}, { event: turnEnd(9, 4) }).nested, [])
})

test('unchanged turn-end data is republished as the same value, and an empty turn publishes none', () => {
  const state = turnEndDefinition.start({}, { event: turnEnd(9, 1), location: { kind: 'turn', turn: { turn: 1 } } }, {
    previous: () => ({ state: nestedDisplayDefinition.start({}, { event: dispatched(2, 'rc:ptc:1', 'display_file', PNG), location: { kind: 'step', turn: { turn: 1 } } }) }),
  })
  const first = turnEndDefinition.buildLocationData({ state }, 'turn', null)
  equal(first?.key, VIEWER_TURN_END)
  equal(turnEndDefinition.buildLocationData({ state }, 'turn', first), first)
  equal(turnEndDefinition.buildLocationData({ state }, 'step', null), null)
  equal(turnEndDefinition.buildLocationData({ state: { turn: 1, nested: [] } }, 'turn', null), null)
})

/** A human message, appended to the model-visible surface. */
const said = (seq: number, id: string, source = 'user'): EventLike =>
  ({ type: 'user/message', seq, surfaceOp: 'append', data: { id, role: 'user', content: [], source: { kind: source } } })

/**
 * One turn the way 0.1.7 logs it: the opening prompt, a display, then the
 * chat's process anchor at the first tool activity (seq start + 3). A steer
 * lands in the second step, after the anchor.
 */
function turnWith(start: number, turn: number, { steer = false } = {}): EventLike[] {
  return [
    turnStart(start, turn),
    said(start + 1, `m${turn}`),
    call(start + 3, `d${turn}`, 'display_file', turn),
    result(start + 4, `d${turn}`, PNG, {}, turn),
    ...steer ? [said(start + 6, `s${turn}`)] : [],
    turnEnd(start + 9, turn),
  ]
}

const anchoredAt = (turns: Record<number, number>) =>
  Object.fromEntries(Object.entries(turns).map(([turn, anchor]) => [turn, { [CHAT_TURN_PROCESS]: { controlAnchorSeq: anchor } }]))

test('a turn the user steered keeps its cards in place on 0.1.7, as the chat keeps it open', () => {
  const turn = assemble([...turnWith(1, 1), ...turnWith(11, 2, { steer: true })], new Set(), anchoredAt({ 1: 4, 2: 14 }))
  equal(hasInterleavedInput(turn(1)), false, 'the opening prompt alone is not interleaved')
  equal(hasInterleavedInput(turn(2)), true)
  equal(tailDisplays(turn(1), 99, true).length, 1)
  deepEqual(tailDisplays(turn(2), 99, true), [], 'the chat does not fold it, so the tail would repeat its rows')
  // 0.1.6 folds a steered turn like any other, so there the tail still carries it.
  equal(tailDisplays(turn(2), 99, false).length, 1)
  equal(turnStaysOpen(turn(2), true), true)
})

test('only the user’s own messages count as input, and only within their turn', () => {
  deepEqual(humanInputDefinition.match(said(1, 'm1')), { id: 'm1', role: 'start' })
  equal(humanInputDefinition.match(said(1, 'c1', 'file-change')), null, 'injected context')
  equal(humanInputDefinition.match(said(1, 'k1', 'compact-checkpoint')), null)
  equal(humanInputDefinition.match({ ...said(1, 'm1'), surfaceOp: 'replace' }), null, 'a replacement copy')
  equal(humanInputDefinition.match({ type: 'user/message', seq: 1, surfaceOp: 'append', data: { source: { kind: 'user' } } }), null, 'no id')

  // Context injected mid-turn is not a steer.
  const events = turnWith(1, 1)
  events.splice(4, 0, said(7, 'c1', 'file-change'))
  equal(hasInterleavedInput(assemble(events, new Set(), anchoredAt({ 1: 4 }))(1)), false)
  // A turn with no input of its own does not inherit the previous turn's.
  const quiet: EventLike[] = [turnStart(11, 2), call(14, 'd2', 'display_file', 2), result(15, 'd2', PNG, {}, 2), turnEnd(20, 2)]
  const turn = assemble([...turnWith(1, 1, { steer: true }), ...quiet], new Set(), anchoredAt({ 1: 4, 2: 14 }))
  equal(turn(2).data?.get?.(VIEWER_TURN_END), undefined, 'nothing to publish for turn 2')
  equal(hasInterleavedInput(turn(2)), false)
})

test('the steer rule follows the chat’s own anchor exactly', () => {
  const turn = assemble(turnWith(1, 1, { steer: true }), new Set(), anchoredAt({ 1: 4 }))(1)
  equal(hasInterleavedInput(turn), true)
  // Anchored at the turn's own start (no activity at all): every input is opening.
  equal(hasInterleavedInput({ ...turn, data: { get: key => (key === CHAT_TURN_PROCESS ? { controlAnchorSeq: 1 } : turn.data?.get?.(key)) } }), false)
  // Anchored after the last input: nothing came after the work began.
  equal(hasInterleavedInput({ ...turn, data: { get: key => (key === CHAT_TURN_PROCESS ? { controlAnchorSeq: 8 } : turn.data?.get?.(key)) } }), false)
  // Without the chat's anchor there is nothing to compare with; the tail keeps its cards.
  equal(hasInterleavedInput({ ...turn, data: { get: key => (key === CHAT_TURN_PROCESS ? undefined : turn.data?.get?.(key)) } }), false)
})

test('the steer rule applies only where the chat has it: the 0.1.7 chat, recognized by its settings form', () => {
  const form = { getSnapshot: () => ({ value: {} }), subscribe: () => () => {} }
  equal(foldSourceOf(() => ({ get: (id: string) => (id === 'ui-chat' ? form : undefined) })).keepsSteeredTurnsOpen?.(), true)
  equal(foldSourceOf(() => undefined).keepsSteeredTurnsOpen?.(), false, '0.1.6: no configForms at all')
  equal(foldSourceOf(() => ({ get: () => undefined })).keepsSteeredTurnsOpen?.(), false)
})
