/**
 * Keeping displayed files on screen after their turn completes.
 *
 * From 0.1.6 the chat folds a completed turn's work — every tool row, this
 * card included — behind one "used N s" disclosure, and from 0.1.7 that is the
 * default (`transcriptView: standard`). A viewer whose purpose is putting a
 * file in front of the user then hides it the moment the answer lands. The
 * harness's own deliverables solve the same problem through two public
 * surfaces, and this module uses the same two:
 *
 * - a Conversation Definition (`uiConversation.events.register`) that folds a
 *   turn's events into Turn-scoped data — here, the turn's successful
 *   `display_file` results; and
 * - an entry in the chat's `conversation.chat.turnTail` list, which renders
 *   between a completed turn's closing reply and its action row, outside the
 *   fold. The component lives in `ViewerTail.tsx`.
 *
 * Everything here is pure and structurally typed: the events come from a
 * session log this build may not have written, and the Definition contract is
 * declared by a package (`dsh-client-ui-conversation` 0.1.6+) that older
 * trains do not publish in this shape.
 * @module @crosery/dsh-viewer/client/turn-tail
 */

import { DISPLAY_TOOL, displayValueFrom, type DisplayValue } from '../contract.ts'
import { contentImageOf, envelopeValueOf } from './card-model.ts'

/** Definition kind, and the key the turn's data is published under. */
export const VIEWER_TURN_DATA = 'crosery-viewer'

/** One file a turn displayed. */
export interface TurnDisplay {
  /** Log sequence of the settled result. */
  seq: number
  /** The call that displayed it. */
  callId: string
  /** What the card shows. */
  value: DisplayValue
}

/** Turn-scoped data this Definition publishes. */
export interface ViewerTurnData {
  displayed: readonly TurnDisplay[]
}

/** The Definition's per-turn accumulator. */
export interface ViewerTurnState {
  turn: number
  /** `display_file` calls of this turn, by call id. */
  calls: ReadonlySet<string>
  displayed: readonly TurnDisplay[]
}

/** The slice of a session event this module reads. */
export interface EventLike {
  type?: unknown
  seq?: unknown
  data?: unknown
  /** How a surface event entered the log; replacement copies are model-only. */
  surfaceOp?: unknown
}

/** A Definition match, as far as this module reads one. */
export interface MatchLike {
  event: EventLike
}

/** Read one property of an unknown record. */
function field(value: unknown, key: string): unknown {
  return typeof value === 'object' && value !== null ? (value as Record<string, unknown>)[key] : undefined
}

/** The turn number an event belongs to, when it names one. */
function turnOf(event: EventLike): number | undefined {
  const turn = field(event.data, 'turn')
  return typeof turn === 'number' && Number.isFinite(turn) ? turn : undefined
}

/**
 * Whether a result event is transcript material. A surface event that is a
 * replacement copy re-states history for the model; counting it would show one
 * file twice.
 */
function isTranscriptResult(event: EventLike): boolean {
  return event.surfaceOp === undefined || event.surfaceOp === 'append'
}

/** The call id a `tool/result` answers. */
function resultCallId(event: EventLike): string | undefined {
  const id = field(field(field(event.data, 'message'), 'source'), 'callId')
  return typeof id === 'string' || typeof id === 'number' ? String(id) : undefined
}

/**
 * The card payload a settled `display_file` result carries.
 *
 * The same recovery the tool row performs: the presentation metadata first,
 * then the plugin's own envelope for a result written without it.
 * @param data - the `tool/result` event's data.
 * @returns the payload, or `undefined` when the result is not a displayable success.
 */
export function displayedValueOf(data: unknown): DisplayValue | undefined {
  const message = field(data, 'message')
  if (field(message, 'isError') === true) return undefined
  const fromMeta = displayValueFrom(field(data, 'meta'))
  if (fromMeta !== undefined) return fromMeta
  const content = field(message, 'content')
  if (!Array.isArray(content)) return undefined
  const image = contentImageOf(content)
  const recovered = envelopeValueOf(content, image !== undefined)
  return recovered === undefined ? undefined : { ...recovered, ...image === undefined ? {} : { image } }
}

/**
 * The Conversation Definition that collects each turn's displayed files.
 *
 * Shaped after the harness's own deliverables Definition: `turn/start` opens a
 * turn's context, `display_file` calls are remembered by id, and their
 * successful results are appended in log order. Nothing is published as a view
 * node — only Turn data, which the tail entry reads.
 */
export const viewerTurnDefinition = {
  kind: VIEWER_TURN_DATA,
  match(event: EventLike): { id: string; role: 'start' | 'update' } | null {
    const turn = turnOf(event)
    if (turn === undefined) return null
    if (event.type === 'turn/start') return { id: String(turn), role: 'start' }
    if (event.type === 'tool/call') return field(event.data, 'name') === DISPLAY_TOOL ? { id: String(turn), role: 'update' } : null
    if (event.type === 'tool/result') return isTranscriptResult(event) ? { id: String(turn), role: 'update' } : null
    return null
  },
  start(_context: unknown, match: MatchLike): ViewerTurnState {
    const turn = turnOf(match.event)
    if (match.event.type !== 'turn/start' || turn === undefined) throw new Error('dsh-viewer: a turn context starts at turn/start')
    return { turn, calls: new Set(), displayed: [] }
  },
  update(context: { state: ViewerTurnState }, match: MatchLike): ViewerTurnState {
    const { event } = match
    const state = context.state
    if (event.type === 'tool/call') {
      const id = field(event.data, 'callId')
      if (typeof id !== 'string' && typeof id !== 'number') return state
      const calls = new Set(state.calls)
      calls.add(String(id))
      return { ...state, calls }
    }
    if (event.type !== 'tool/result') return state
    const callId = resultCallId(event)
    if (callId === undefined || !state.calls.has(callId)) return state
    const value = displayedValueOf(event.data)
    if (value === undefined || typeof event.seq !== 'number') return state
    return { ...state, displayed: [...state.displayed, { seq: event.seq, callId, value }] }
  },
  buildLocationData(
    context: { state?: ViewerTurnState | undefined },
    scope: string,
    previous?: { kind?: string; turn?: number; key?: string; value?: ViewerTurnData } | null,
  ): { kind: 'turn'; turn: number; key: string; value: ViewerTurnData } | null {
    const state = context.state
    if (scope !== 'turn' || state === undefined || state.displayed.length === 0) return null
    if (
      previous?.kind === 'turn' && previous.turn === state.turn && previous.key === VIEWER_TURN_DATA
      && previous.value?.displayed === state.displayed
    ) {
      return previous as { kind: 'turn'; turn: number; key: string; value: ViewerTurnData }
    }
    return { kind: 'turn', turn: state.turn, key: VIEWER_TURN_DATA, value: { displayed: state.displayed } }
  },
}

/** The slice of the tail owner's `turn` this module reads. */
export interface TurnLike {
  status?: unknown
  end?: unknown
  data?: { get?: (key: string) => unknown } | undefined
}

/**
 * Whether the chat keeps this turn's work open, in which case the tool rows
 * are already on screen and a tail would only repeat them: a turn still
 * running, and one that ended aborted or in error.
 * @param turn - the tail owner's turn.
 * @returns true when the turn's process is not foldable.
 */
export function turnStaysOpen(turn: TurnLike): boolean {
  if (turn.status === 'open') return true
  const reason = field(field(field(turn.end, 'data'), 'reason'), 'kind')
  return reason === 'aborted' || reason === 'error'
}

/**
 * The files a completed turn's tail shows.
 *
 * Only results logged before the closing reply belong to it, and a file
 * displayed several times appears once, where it was last displayed.
 * @param turn - the tail owner's turn.
 * @param closingSeq - the closing reply's log sequence.
 * @returns the displays to render, oldest first; empty when there are none.
 */
export function tailDisplays(turn: TurnLike, closingSeq: number): readonly TurnDisplay[] {
  if (turnStaysOpen(turn)) return []
  const data = turn.data?.get?.(VIEWER_TURN_DATA) as ViewerTurnData | undefined
  const displayed = Array.isArray(data?.displayed) ? data.displayed : []
  const byPath = new Map<string, TurnDisplay>()
  for (const entry of displayed) {
    if (entry.seq >= closingSeq) continue
    byPath.delete(entry.value.path)
    byPath.set(entry.value.path, entry)
  }
  return [...byPath.values()]
}

/** A form value this module reads the transcript preference from. */
interface ChatFormLike {
  getSnapshot(): { value?: { transcriptView?: unknown } | undefined } | undefined
  subscribe(listener: () => void): () => void
}

/** An observable boolean the tail reads with `useSyncExternalStore`. */
export interface FoldSource {
  getSnapshot(): boolean
  subscribe(listener: () => void): () => void
}

/**
 * Whether a transcript mode folds completed turns.
 *
 * `verbose` (0.1.7) never folds; every other mode does on the trains that have
 * the turn tail, including the unset value, whose default is `standard` on
 * 0.1.7 and `compact` on 0.1.6.
 * @param mode - the persisted `transcriptView`, verbatim.
 * @returns whether the tail should carry the turn's displays.
 */
export function foldsCompletedTurns(mode: unknown): boolean {
  return mode !== 'verbose'
}

/**
 * Follow the chat's transcript preference, read from the chat's own settings
 * form (`configForms.get('ui-chat')`).
 *
 * Looked up on every read rather than once: the form service arrives with the
 * settings plugin, which need not have activated before this one. A train with
 * no such form is treated as folding — its default.
 * @param forms - reads the optional `configForms` service.
 * @returns the fold preference as an observable.
 */
export function foldSourceOf(forms: () => unknown): FoldSource {
  const form = (): ChatFormLike | undefined => {
    const service = forms() as { get?: (id: string) => unknown } | undefined
    if (typeof service?.get !== 'function') return undefined
    try {
      const found = service.get('ui-chat') as ChatFormLike | undefined
      return typeof found?.getSnapshot === 'function' && typeof found.subscribe === 'function' ? found : undefined
    } catch {
      return undefined
    }
  }
  return {
    getSnapshot: () => foldsCompletedTurns(form()?.getSnapshot()?.value?.transcriptView),
    subscribe: (listener) => form()?.subscribe(listener) ?? (() => {}),
  }
}
