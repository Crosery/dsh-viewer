/**
 * The pure parts of `smoke-boot.mjs`, kept free of dependencies: the smoke
 * also runs under the desktop app's own Electron binary against a checkout
 * with no `node_modules`.
 */

/** A `dsh web` URL carries a one-time session token; nothing this repo prints may. */
export function maskTokens(text) {
  return String(text).replace(/token=[\w.~%-]+/g, 'token=***')
}

/**
 * Split a harness's stderr into what is this plugin's problem and what is not.
 *
 * - `skipping profile bundle "<name>"` (dsh ≥0.1.7 boot), `installation
 *   rejected` / `incompatible with dsh` (dsh ≥0.1.7 `plugin add`): in a home
 *   that holds only this plugin these can only be about it.
 * - the startup audit, `N entries did not activate` followed by one line per
 *   entry — `<name>: …` up to 0.1.1, `<id> (<name>): …` from 0.1.7: a line
 *   naming this package is ours; any other is the train's own entry, reported
 *   but not held against the plugin.
 */
export function classifyDiagnostics(stderr, packageName) {
  const ours = []
  const others = []
  let inAudit = false
  for (const raw of String(stderr).split('\n')) {
    const line = maskTokens(raw).slice(0, 600)
    if (/skipping profile bundle|installation rejected|incompatible with dsh/.test(line)) { ours.push(line); continue }
    if (/did not activate/.test(line)) {
      inAudit = true
      if (line.includes(packageName)) ours.push(line)
      continue
    }
    if (!inAudit) continue
    if (line.trim() === '') { inAudit = false; continue }
    ;(line.includes(packageName) ? ours : others).push(line)
  }
  // `dsh plugin add` repeats its rejection without the prefix; keep one of each.
  const distinct = (lines) => lines.filter((line, i) => !lines.some((other, j) => j !== i && other.length > line.length && other.includes(line.slice(0, 120))))
  return { ours: distinct(ours), others: distinct(others) }
}

/**
 * Specifiers a Web shell answers without a graph row, read from the shell's
 * own bundle: the loader's static module table is an object literal whose keys
 * are the specifiers (`{react:…,"react/jsx-runtime":…,…}` — `Jd()` in 0.1.1,
 * `WS()` in 0.1.7). `undefined` when no such literal is found.
 */
export function moduleTableOf(source) {
  const literal = /\{((?:react|"react"):[^{}]*?"react\/jsx-runtime":[^{}]*)\}/.exec(source)
  if (literal === null) return undefined
  return [...literal[1].matchAll(/(?:^|,)\s*(?:"([^"]+)"|([A-Za-z_$][\w$]*))\s*:/g)].map((m) => m[1] ?? m[2])
}

/** Named members a CommonJS bundle reads off one required module (`import_<binding>N.Member`). */
export function membersRead(source, binding) {
  return new Set([...source.matchAll(new RegExp(`\\bimport_${binding}\\d*\\.([A-Za-z_$][\\w$]*)`, 'g'))].map((m) => m[1]))
}

/** Names an ES module's `export { … }` clauses publish; `undefined` when it re-exports `*`. */
export function exportedNames(text) {
  if (/export\s*\*/.test(text)) return undefined
  return new Set([...text.matchAll(/export\s*\{([^}]*)\}/g)]
    .flatMap((m) => m[1].split(',').map((s) => s.trim().split(/\s+as\s+/).pop()).filter(Boolean)))
}

/**
 * The package and version an `npm install --before` could not find, when a
 * release depends on a package of its own train published after the cutoff.
 * `undefined` for any other failure.
 */
export function publishedTooLate(npmOutput) {
  const match = /No matching version found for (@?[^@\s]+)@\S*?(\d+\.\d+\.\d+[\w.-]*) with a date before/.exec(npmOutput)
  return match === null ? undefined : { name: match[1], version: match[2] }
}

/**
 * The boot graph an index page carries: `globalThis["__DSH_BOOT__"] = …` from
 * 0.1.1 (dsh-host-webserver's global row), `window.__DSH_BOOT__ = …` on
 * 0.1.0 (dsh-client-modules wrote the script itself). `undefined` without one.
 */
export function bootGraphOf(html) {
  const wire = /<script>(?:globalThis\["__DSH_BOOT__"\]|window\.__DSH_BOOT__) = (.*?)<\/script>/s.exec(html)
  return wire === null ? undefined : JSON.parse(wire[1])
}
