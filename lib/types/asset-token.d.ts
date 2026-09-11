/**
 * Signed asset references: how a card names a file to the asset route without
 * the route ever trusting a path the browser supplied.
 *
 * The design constraint is that a card must survive a harness restart. A card
 * rebuilt from a replayed session log holds only the URL that was minted months
 * ago, so an in-process token table would leave every reopened video dead. The
 * reference is therefore self-contained — the path travels in the URL and a
 * keyed MAC travels beside it — and the route accepts a path only when the MAC
 * proves this harness minted it.
 *
 * The MAC key is the whole security boundary: without it the route would be an
 * arbitrary-file-read endpoint on a port the user's browser can reach. It is
 * generated once per harness home, stored 0600, and never leaves the Host.
 * @module @crosery/dsh-viewer/asset-token
 */
/** Query parameter carrying the base64url-encoded absolute path. */
export declare const PATH_PARAM = "p";
/** Query parameter carrying the hex MAC over that path. */
export declare const SIGNATURE_PARAM = "s";
/**
 * Load the harness-local MAC key, generating it on first use.
 *
 * Written with the exclusive flag so two harness processes racing on a fresh
 * home cannot end up with different keys — the loser reads the winner's file
 * instead of overwriting it, which would have invalidated every URL the winner
 * had already minted.
 * @param keyPath - absolute path of the key file inside the harness home.
 * @returns the raw key bytes.
 */
export declare function loadAssetSecret(keyPath: string): Promise<Buffer>;
/**
 * Mint the same-origin URL a card loads for one file.
 * @param secret - the harness MAC key.
 * @param processPath - the canonical absolute path in the backend's execution
 *   world, as `ctx.fs.processPath` reports it.
 * @returns the signed, root-relative asset URL.
 */
export declare function assetUrlFor(secret: Buffer, processPath: string): string;
/**
 * Recover the path one asset request names, after proving this harness minted
 * the reference.
 *
 * Comparison is constant-time over equal-length buffers; a length mismatch is
 * rejected before the compare, because `timingSafeEqual` throws on unequal
 * lengths and a length difference leaks nothing an attacker did not already
 * choose.
 * @param secret - the harness MAC key.
 * @param search - the request URL's query string, leading `?` optional.
 * @returns the verified absolute path, or `undefined` for a missing, malformed,
 *   or unsigned reference.
 */
export declare function verifyAssetRequest(secret: Buffer, search: string): string | undefined;
