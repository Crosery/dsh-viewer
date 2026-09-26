/**
 * Bounds on the converted-document cache.
 *
 * Every conversion leaves one PDF in a directory beside the asset key, shared
 * by every profile on the machine. Without a bound that directory only grows:
 * a user who previews a few documents a day accumulates gigabytes nobody asked
 * to keep. So the cache is least-recently-used with three caps — age, entry
 * count and total bytes — and "used" means either converted-or-hit by
 * `display_file` or served to a card by the asset route, which is what keeps
 * the artifact behind a card someone is looking at from aging out.
 *
 * Pruning is lazy: once when the plugin activates and after each write, never
 * on a timer. It only ever considers regular files in the cache directory
 * itself whose names this plugin writes, so a stray file, a symlink or a
 * subdirectory placed there is never touched, and nothing outside the
 * directory is reachable at all.
 * @module @crosery/dsh-viewer/cache
 */
/** The three caps one prune enforces. */
export interface CacheLimits {
    /** An artifact unused for longer than this is removed. */
    maxAgeMs: number;
    /** At most this many artifacts are kept, most recently used first. */
    maxEntries: number;
    /** Kept artifacts total at most this many bytes. */
    maxBytes: number;
}
/**
 * The shipped caps: a month unused, 256 documents, 512 MiB. Generous enough
 * that a card in an active conversation never loses its artifact; small enough
 * that the directory stays an unremarkable size on a laptop.
 */
export declare const CACHE_LIMITS: CacheLimits;
/**
 * Whether a file name is one of this cache's artifacts.
 * @param name - a bare file name.
 * @returns true for a name a converter writes.
 */
export declare function isArtifactName(name: string): boolean;
/**
 * Write an artifact into place.
 *
 * The bytes land under a unique partial name beside the artifact — in the cache
 * directory itself, never in the system temp directory — and are renamed into
 * place last. Beside it because `rename` only works within one filesystem: a
 * temp directory on another mount (a Linux `tmpfs` `/tmp`) fails it with
 * `EXDEV`. Renamed last so a reader either finds no artifact or a complete
 * one, never a half-written file served to a PDF viewer. The partial name is
 * one {@link pruneCache} recognizes, so even a process killed mid-write leaves
 * nothing behind for long; any failure here removes it at once.
 * @param artifact - the artifact's absolute path.
 * @param write - writes the complete bytes to the path it is given.
 */
export declare function placeArtifact(artifact: string, write: (partial: string) => Promise<void>): Promise<void>;
/**
 * Stamp an artifact as used now, if it exists.
 *
 * Doubles as the cache-hit test: a successful stamp is a hit, and the stamp is
 * what moves the artifact to the front of the eviction order.
 * @param path - the artifact's absolute path.
 * @returns true when the artifact exists.
 */
export declare function useArtifact(path: string): Promise<boolean>;
/**
 * Refresh a served file's last-use stamp when it is one of this cache's
 * artifacts. Any other file the asset route serves — the user's own images and
 * videos — is left exactly as it is.
 * @param cacheDir - the cache directory.
 * @param path - the absolute path the route is serving.
 * @param mtimeMs - its modification time, as the route's `stat` saw it.
 * @param now - the current time.
 */
export declare function useServedArtifact(cacheDir: string, path: string, mtimeMs: number, now?: number): Promise<void>;
/**
 * Enforce the caps once.
 *
 * The most recently used artifact always survives, whatever the caps say: it
 * is the one a card was most likely just handed.
 * @param cacheDir - the cache directory; a missing directory is an empty cache.
 * @param limits - the caps to enforce.
 * @param now - the current time.
 * @returns the absolute paths removed.
 */
export declare function pruneCache(cacheDir: string, limits?: CacheLimits, now?: number): Promise<string[]>;
/**
 * Prune in the background.
 *
 * Calls that arrive while a prune of the same directory runs fold into one
 * more pass after it, so a burst of conversions costs two directory scans, not
 * one per conversion. A failure is logged, never thrown: a cache that could not
 * be trimmed still serves every card.
 * @param cacheDir - the cache directory.
 * @param limits - the caps to enforce.
 * @returns settles when the directory has been pruned; never rejects.
 */
export declare function schedulePrune(cacheDir: string, limits?: CacheLimits): Promise<void>;
