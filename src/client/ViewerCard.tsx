/**
 * The tool card: one row plus whatever element actually plays the file.
 *
 * Registered for both `display_file` and the shipped `read_image`, so an image
 * the model pulled in through the shipped tool is shown as a picture rather
 * than as a bare text row.
 *
 * Two byte sources, in priority order. A signed asset URL streams straight from
 * the Host and is the only one that can carry video, audio, PDF or HTML — and
 * the only one that supports range requests, which is what makes a `<video>`
 * seekable. A durable attachment is the fallback: it is images-only, but it
 * works when the filesystem backend exposes no local path, and it is the only
 * source a shipped `read_image` result has at all.
 */

import { useCallback, useEffect, useRef, useState } from 'react'
import type { ReactNode } from 'react'
import { createPortal } from 'react-dom'
import type { TranslateNS } from '@deepseek-ai/dsh-client-ui-slots'
import { READ_IMAGE_TOOL, classifyPath, formatBytes, type DisplayValue, type ViewerKind } from '../contract.ts'
import { cardModel, type CardState } from './card-model.ts'
import type { ViewerKey } from './locales.ts'

/** Class-name prefix; see `styles.ts` for the injected sheet. */
const CSS = 'dshview'

/** Business face the plugin injects into every card occurrence. */
export interface ViewerCardInjected {
  /**
   * Resolve one durable attachment into a browser URL scoped to this session.
   * @param attachmentId - the opaque durable id.
   * @returns a URL valid until the plugin unloads.
   */
  loadAttachment: (attachmentId: string) => Promise<string>
}

/** The runtime share this card actually reads off the toolview slot. */
export interface ViewerCardOwner {
  /** Wire tool name this entry was dispatched for. */
  toolName: string
  /** Frozen running call or settled result node. */
  block: Parameters<typeof cardModel>[0]
}

/** Full card props: owner share, injected face, and the locale seat. */
export type ViewerCardProps = ViewerCardOwner & ViewerCardInjected & {
  t: TranslateNS<'tool.viewer'>
}

/** Locale key naming one viewer kind. */
const KIND_TITLE: Readonly<Record<ViewerKind, ViewerKey>> = {
  image: 'title.image',
  video: 'title.video',
  audio: 'title.audio',
  pdf: 'title.pdf',
  document: 'title.document',
  html: 'title.html',
  file: 'title.file',
}

/**
 * A path rendered right-to-left so the filename survives truncation.
 *
 * `direction: rtl` moves the ellipsis to the front but also moves any leading
 * punctuation to the end, so the string is wrapped in an isolate to keep its own
 * characters in logical order.
 */
function PathLabel({ path }: { path: string }) {
  return <span className={`${CSS}-path`} title={path}>&#8296;{path}&#8297;</span>
}

/** The card's leading glyph — inline so the bundle needs no icon dependency. */
function KindIcon({ kind }: { kind: ViewerKind }) {
  const paths: Readonly<Record<ViewerKind, string>> = {
    image: 'M3 4.5h10v7H3zM3 10l2.5-2.5 2 2L10.5 6l2.5 3v2.5H3z',
    video: 'M2.5 4h7.5v8H2.5zM10.5 6.8l3-1.8v6l-3-1.8z',
    audio: 'M6 3.5v6.2a2 2 0 1 0 1.2 1.8V6h4V3.5z',
    pdf: 'M4 2h5l3 3v9H4zM9 2v3h3',
    document: 'M4 2h5l3 3v9H4zM9 2v3h3M5.5 8h5M5.5 10.5h5',
    html: 'M2.5 8 6 4.6l.9.9L4.3 8l2.6 2.5-.9.9zM13.5 8 10 11.4l-.9-.9L11.7 8 9.1 5.5l.9-.9z',
    file: 'M4 2h5l3 3v9H4zM9 2v3h3',
  }
  return (
    <span className={`${CSS}-icon`} aria-hidden="true">
      <svg width="14" height="14" viewBox="0 0 16 16" fill="currentColor"><path d={paths[kind]} /></svg>
    </span>
  )
}

/**
 * Resolve the URL a media element loads, and keep it in sync with its source.
 *
 * A signed asset URL is usable immediately; a durable attachment has to be
 * fetched, so the hook carries the loading and failure states that fetch needs.
 * `attempt` re-arms the effect, which puts a retry through the same liveness
 * guard and the same reset as the first load.
 */
function useMediaSource(value: DisplayValue, load: ViewerCardInjected['loadAttachment']): {
  src: string | undefined
  failed: boolean
  pending: boolean
  retry: () => void
} {
  const [resolved, setResolved] = useState<string | undefined>(undefined)
  const [failed, setFailed] = useState(false)
  const [attempt, setAttempt] = useState(0)
  const retry = useCallback(() => { setAttempt(a => a + 1) }, [])
  const attachmentId = value.image?.attachmentId
  const direct = value.assetUrl

  useEffect(() => {
    if (direct !== undefined || attachmentId === undefined) {
      setResolved(undefined)
      setFailed(false)
      return
    }
    let live = true
    setResolved(undefined)
    setFailed(false)
    void load(attachmentId).then(
      (url) => { if (live) setResolved(url) },
      () => { if (live) setFailed(true) },
    )
    return () => { live = false }
  }, [direct, attachmentId, load, attempt])

  if (direct !== undefined) return { src: direct, failed: false, pending: false, retry }
  if (attachmentId === undefined) return { src: undefined, failed: false, pending: false, retry }
  return { src: resolved, failed, pending: resolved === undefined && !failed, retry }
}

/**
 * Selector for the dialog's tab stops. Mirrors what a browser makes focusable,
 * minus the disabled controls, so Tab containment keeps working if the preview
 * ever grows a second control.
 */
const FOCUSABLE = 'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])'

/**
 * Full-viewport preview of one image; click the backdrop, the close button, or
 * press Escape to close.
 *
 * Portalled to `body` because a card inside a transformed or `contain`ed scroll
 * container would otherwise clip a `position: fixed` overlay to that container.
 * The theme tokens are defined on `body`, so the portal still inherits them.
 */
function Lightbox({ src, alt, onClose, closeLabel }: {
  src: string
  alt: string
  onClose: () => void
  closeLabel: string
}) {
  const panel = useRef<HTMLDivElement>(null)
  const close = useRef<HTMLButtonElement>(null)
  // Where focus was before the dialog opened. The overlay is portalled to
  // `body`, so the card underneath is not an ancestor the browser could
  // restore to on its own — the return trip has to be made explicitly.
  const origin = useRef<HTMLElement | null>(null)

  useEffect(() => {
    origin.current = document.activeElement as HTMLElement | null
    close.current?.focus()
    return () => {
      const back = origin.current
      if (back?.isConnected) back.focus()
    }
  }, [])

  useEffect(() => {
    const onKey = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') {
        // Captured on `window` and stopped there: Escape also closes the
        // harness's own panels and cancels a running turn, and one key press
        // must close only the topmost thing on screen.
        event.preventDefault()
        event.stopPropagation()
        onClose()
        return
      }
      if (event.key !== 'Tab') return
      // `aria-modal` alone does not hold Tab: the rest of the page is still in
      // the document behind the overlay, so focus would walk out of sight.
      const items = panel.current?.querySelectorAll<HTMLElement>(FOCUSABLE)
      if (items === undefined || items.length === 0) return
      const first = items[0]
      const last = items[items.length - 1]
      if (first === undefined || last === undefined) return
      const active = document.activeElement
      const outside = active === null || panel.current?.contains(active) !== true
      const atEdge = event.shiftKey ? active === first : active === last
      if (!outside && !atEdge) return
      event.preventDefault()
      if (event.shiftKey) last.focus()
      else first.focus()
    }
    window.addEventListener('keydown', onKey, true)
    return () => { window.removeEventListener('keydown', onKey, true) }
  }, [onClose])

  if (typeof document === 'undefined') return null

  return createPortal(
    <div ref={panel} className={`${CSS}-lightbox`} role="dialog" aria-modal="true" aria-label={alt} onClick={onClose}>
      <img
        className={`${CSS}-lightboxImage`}
        src={src}
        alt={alt}
        onClick={(event) => event.stopPropagation()}
      />
      <button
        ref={close}
        type="button"
        className={`${CSS}-lightboxClose`}
        aria-label={closeLabel}
        title={closeLabel}
        onClick={(event) => {
          // The backdrop would close too; one close per click.
          event.stopPropagation()
          onClose()
        }}
      >
        <svg width="14" height="14" viewBox="0 0 16 16" fill="currentColor" aria-hidden="true">
          <path d="M3.72 3.72a.75.75 0 0 1 1.06 0L8 6.94l3.22-3.22a.75.75 0 1 1 1.06 1.06L9.06 8l3.22 3.22a.75.75 0 1 1-1.06 1.06L8 9.06l-3.22 3.22a.75.75 0 0 1-1.06-1.06L6.94 8 3.72 4.78a.75.75 0 0 1 0-1.06z" />
        </svg>
      </button>
    </div>,
    document.body,
  )
}

/** The element that plays one file, or the reason there is none. */
function Viewer({ value, injected, t }: { value: DisplayValue; injected: ViewerCardInjected; t: TranslateNS<'tool.viewer'> }) {
  const { src, failed, pending, retry } = useMediaSource(value, injected.loadAttachment)
  const [zoomed, setZoomed] = useState(false)
  const closeZoom = useCallback(() => { setZoomed(false) }, [])
  const label = value.image?.name ?? value.path

  if (failed) {
    return <button type="button" className={`${CSS}-retry`} onClick={retry}>{t('state.loadFailed')}</button>
  }
  if (pending) return <div className={`${CSS}-note`}>{t('state.loading')}</div>
  if (src === undefined) {
    // The Host explains a document it could not convert; everything else falls
    // back to the generic reason.
    if (value.unavailable !== undefined) return <div className={`${CSS}-note`}>{value.unavailable}</div>
    return <div className={`${CSS}-note`}>{t(value.kind === 'image' ? 'state.unsupported' : 'state.unavailable')}</div>
  }

  switch (value.kind) {
    case 'image':
      return (
        <>
          <button type="button" className={`${CSS}-imageButton`} title={t('action.open')} onClick={() => { setZoomed(true) }}>
            <img className={`${CSS}-image`} src={src} alt={label} loading="lazy" />
          </button>
          {zoomed && <Lightbox src={src} alt={label} onClose={closeZoom} closeLabel={t('action.close')} />}
        </>
      )
    case 'video':
      // `preload="metadata"` so the scrub bar and duration appear without
      // pulling a whole film down the moment the card scrolls into view.
      return <video className={`${CSS}-video`} src={src} controls preload="metadata">{t('media.noVideo')}</video>
    case 'audio':
      return <audio className={`${CSS}-audio`} src={src} controls preload="metadata">{t('media.noAudio')}</audio>
    case 'pdf':
    case 'document':
    case 'html':
      return (
        <>
          {/*
            The sandbox is applied to HTML only, and its absence on PDF is not
            an oversight. `sandbox` without `allow-same-origin` gives the frame
            an opaque origin, and Chrome's built-in PDF viewer refuses to run
            there — the frame renders "This page has been blocked by Chrome"
            instead of the document. A PDF needs no sandbox anyway: it is served
            as `application/pdf` under `nosniff`, so the browser hands it to its
            own isolated viewer rather than executing anything in this origin.
            Local HTML is the opposite case — it is arbitrary script the agent
            may have just written — so it keeps the opaque origin, backed by the
            `sandbox` CSP the Host sends with the response.
          */}
          <iframe
            className={`${CSS}-frame`}
            src={src}
            title={label}
            {...value.kind === 'html' ? { sandbox: 'allow-scripts allow-forms allow-popups' } : {}}
          />
          <a className={`${CSS}-link`} href={src} target="_blank" rel="noreferrer">{t('action.openNew')}</a>
        </>
      )
    default:
      return <a className={`${CSS}-link`} href={src} target="_blank" rel="noreferrer">{t('action.openNew')}</a>
  }
}

/** The header row shared by every phase. */
function Head({ kind, label, path, detail, badge, onToggle, expanded, t }: {
  kind: ViewerKind
  label: ViewerKey
  path: string
  detail: string
  badge?: string
  onToggle?: () => void
  expanded: boolean
  t: TranslateNS<'tool.viewer'>
}): ReactNode {
  return (
    <button
      type="button"
      className={`${CSS}-head`}
      onClick={onToggle}
      aria-expanded={onToggle === undefined ? undefined : expanded}
      title={onToggle === undefined ? undefined : t(expanded ? 'action.collapse' : 'action.expand')}
    >
      <KindIcon kind={kind} />
      <span className={`${CSS}-kind`}>{t(label)}</span>
      {path.length > 0 && <PathLabel path={path} />}
      {detail.length > 0 && <span className={`${CSS}-meta`}>{detail}</span>}
      {badge !== undefined && <span className={`${CSS}-badge`}>{badge}</span>}
    </button>
  )
}

/** Header detail line for a settled display. */
function detailOf(value: DisplayValue): string {
  const size = formatBytes(value.bytes)
  const dimensions = value.image === undefined ? '' : `${value.image.width}×${value.image.height}`
  return [dimensions, size].filter(part => part.length > 0).join(' · ')
}

/**
 * One `display_file` (or `read_image`) call, as a row plus its player.
 * @param props - the toolview owner share, the injected loader, and `t`.
 * @returns the card.
 */
export function ViewerCard({ toolName, block, t, ...injected }: ViewerCardProps) {
  const state: CardState = cardModel(block, toolName)
  // Every kind opens expanded. A viewer whose whole purpose is showing the file
  // must not hide it behind a disclosure the reader has to find — collapsing is
  // available on the header for a reader who wants the room back.
  const [open, setOpen] = useState(true)
  const toggle = useCallback(() => { setOpen(previous => !previous) }, [])

  if (state.phase === 'running') {
    return (
      <div className={`${CSS}-card`}>
        <Head kind={classifyKind(state.path)} label={headLabel(toolName, classifyKind(state.path))} path={state.path ?? ''} detail={t('state.running')} expanded={false} t={t} />
      </div>
    )
  }
  if (state.phase === 'failed') {
    return (
      <div className={`${CSS}-card`}>
        <Head kind={classifyKind(state.path)} label={headLabel(toolName, classifyKind(state.path))} path={state.path ?? ''} detail="" expanded={open} onToggle={toggle} t={t} />
        {open && <div className={`${CSS}-body`}><div className={`${CSS}-note ${CSS}-error`}>{state.message}</div></div>}
      </div>
    )
  }
  if (state.phase === 'bare') {
    return (
      <div className={`${CSS}-card`}>
        <Head kind={classifyKind(state.path)} label={headLabel(toolName, classifyKind(state.path))} path={state.path ?? ''} detail={state.message} expanded={false} t={t} />
      </div>
    )
  }

  const { value } = state
  return (
    <div className={`${CSS}-card`}>
      <Head
        kind={value.kind}
        label={headLabel(toolName, value.kind)}
        path={value.path}
        detail={detailOf(value)}
        badge={t(value.inContext ? 'badge.inContext' : 'badge.screenOnly')}
        expanded={open}
        onToggle={toggle}
        t={t}
      />
      {open && <div className={`${CSS}-body`}><Viewer value={value} injected={injected} t={t} /></div>}
    </div>
  )
}

/**
 * The header word.
 *
 * Naming the MEDIUM alone is ambiguous once two tools can produce an image
 * card: a `read_image` result and a `display_file` result both read "图片", and
 * a transcript containing one of each looks like the same thing rendered twice.
 * The shipped reader therefore names the action it performed instead.
 * @param toolName - the wire tool this entry was dispatched for.
 * @param kind - the medium the card is showing.
 * @returns the locale key for the header word.
 */
function headLabel(toolName: string, kind: ViewerKind): ViewerKey {
  return toolName === READ_IMAGE_TOOL ? 'title.readImage' : KIND_TITLE[kind]
}

/**
 * Best-effort kind for a phase with no settled metadata yet, so the running row
 * already shows the glyph and label the settled row will keep.
 */
function classifyKind(path: string | undefined): ViewerKind {
  return path === undefined ? 'file' : classifyPath(path).kind
}
