/**
 * The asset route: bytes for one signed reference, with range support.
 *
 * Range handling is not an optimization here — it is what makes `<video>` and
 * `<audio>` seekable at all. Chrome and Safari will not expose a scrub bar for
 * a response that does not advertise `accept-ranges`, and Safari refuses to
 * start playback of a media response that answers a range request with 200.
 *
 * Bytes are streamed from the process path rather than pulled through
 * `ctx.fs.readBytes`, which materializes a whole file in memory: a two-hour
 * video is exactly the case this plugin exists for. The tradeoff is that the
 * route is only available on a backend that exposes a local path — `index.ts`
 * degrades that case to the attachment path for admissible rasters, and to an
 * unavailable card otherwise.
 * @module @crosery/dsh-viewer/asset-route
 */
import type { IncomingMessage, ServerResponse } from 'node:http';
import { type ViewerKind } from './contract.ts';
/** One parsed, satisfiable byte range. */
interface ByteRange {
    start: number;
    end: number;
}
/**
 * Parse a single-range `Range` header against a known size.
 *
 * Only the single-range form is honored. A multipart range response is a
 * different content type with its own framing, and no browser media element
 * needs one; answering the whole entity is the specified fallback.
 * @param header - the raw header value, or undefined.
 * @param size - the entity's total byte length.
 * @returns the resolved range, `undefined` for no usable range, or `'invalid'`
 *   when the client named a range that cannot be satisfied.
 */
export declare function parseRange(header: string | undefined, size: number): ByteRange | undefined | 'invalid';
/**
 * Response headers that keep an inline-served asset from becoming an XSS
 * vector.
 *
 * The route answers on the app's own origin, so a user who opens an asset URL
 * in a tab navigates to it as a document. For `text/html` and `image/svg+xml`
 * that document would otherwise run its own script with the app's origin. The
 * CSP header removes that: `sandbox` puts a navigated HTML asset in an opaque
 * origin, and `default-src 'none'` leaves an SVG document with no script at
 * all. Both are inert when the asset is loaded as a subresource, which is the
 * normal path.
 * @param kind - the classified viewer kind.
 * @returns extra headers for this kind, possibly empty.
 */
export declare function guardHeaders(kind: ViewerKind): Record<string, string>;
/**
 * Build the asset route's handler.
 * @param secret - a thunk returning the harness MAC key, or `undefined` while
 *   key material is still loading (the route answers 503 until it resolves).
 * @returns the `webServer` route handler.
 */
export declare function assetHandler(secret: () => Buffer | undefined): (req: IncomingMessage, res: ServerResponse) => Promise<void>;
export {};
