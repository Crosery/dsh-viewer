/**
 * What the page the card lives in can do, decided by capability — never by the
 * user agent.
 *
 * The desktop app runs the same web consumer as `dsh web`, so nothing in the
 * plugin contract tells the two apart. Two facts do. The desktop renderer loads
 * the app from its own `dsh-app:` scheme, and its preload publishes
 * `__DSH_HOST_PATHS__` (the dropped-file path bridge) on the main frame only.
 * Either one means the page is the desktop window, and with it the desktop's
 * rules that matter to a card: `target=_blank` links to app URLs are silently
 * denied (only http(s) leaves the window), and media loaded through the app's
 * protocol forwarder is not seekable on first load (see {@link mediaSourceFor}).
 * Images and PDF frames behave as in a browser tab — the window keeps
 * Chromium's PDF viewer — so nothing else branches on this.
 * @module @crosery/dsh-viewer/client/host
 */

/** The globals {@link isDesktopShell} probes. */
interface HostGlobals {
  __DSH_HOST_PATHS__?: unknown
  location?: { protocol?: string }
}

/**
 * Whether this page is the desktop app's window.
 * @param globals - the global object to probe; the real one by default.
 * @returns true inside the desktop renderer.
 */
export function isDesktopShell(globals: HostGlobals = globalThis as HostGlobals): boolean {
  return globals.__DSH_HOST_PATHS__ !== undefined || globals.location?.protocol === 'dsh-app:'
}

/** The desktop renderer's transport facts (`__DSH_TRANSPORT__`), as far as media needs them. */
interface TransportGlobals extends HostGlobals {
  __DSH_TRANSPORT__?: { streamBaseUrl?: unknown } | undefined
}

/** Hosts a stream base URL may name: the Host only ever listens on loopback. */
const LOOPBACK = new Set(['127.0.0.1', 'localhost', '[::1]'])

/**
 * The URL a `<video>` or `<audio>` element should load an asset from.
 *
 * On the web this is the signed same-origin path unchanged. In the desktop
 * window a same-origin path travels through the app's `dsh-app:` protocol
 * forwarder, which drops `Content-Length`; Chromium then treats the FIRST load
 * of a media URL as an unseekable stream (`seekable` is `[0, 0]`, measured on
 * 0.1.7-rc.2) even though every response is a correct 206 with
 * `Content-Range`. The desktop publishes the Host's own loopback address as
 * `__DSH_TRANSPORT__.streamBaseUrl` — its WebSocket base — and a media element
 * pointed there issues ordinary HTTP range requests and seeks from the start.
 * The asset route needs no cookie (it authorizes by signature), so nothing but
 * the origin changes. Anything other than an http(s) loopback base is ignored.
 * @param assetUrl - the signed same-origin asset path.
 * @param globals - the global object to probe; the real one by default.
 * @returns the URL to hand the media element.
 */
export function mediaSourceFor(assetUrl: string, globals: TransportGlobals = globalThis as TransportGlobals): string {
  if (!assetUrl.startsWith('/') || !isDesktopShell(globals)) return assetUrl
  const base = globals.__DSH_TRANSPORT__?.streamBaseUrl
  if (typeof base !== 'string') return assetUrl
  try {
    const url = new URL(base)
    if ((url.protocol !== 'http:' && url.protocol !== 'https:') || !LOOPBACK.has(url.hostname)) return assetUrl
    return new URL(assetUrl, url).href
  } catch {
    return assetUrl
  }
}
