/**
 * The pure parts of `smoke-boot.mjs`, kept free of dependencies so the tests
 * reach them without a browser. The smoke itself loads `playwright-core` only
 * for its browser stage.
 */

import { existsSync, readdirSync, readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'

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
 * The `--before` that installs a harness train as released, from the `time`
 * map `npm view @deepseek-ai/dsh time --json` answers: one second after the
 * train's own `@deepseek-ai/dsh` went out, or `undefined` for the newest
 * version, which a user installs today.
 *
 * Not the next harness's publication: `@deepseek-ai/dsh` lists its packages
 * with caret ranges (`^0.1.6-alpha.1`), which accept the next prerelease of
 * the same tuple, and a train's packages go out minutes before its own
 * `@deepseek-ai/dsh`. A cutoff at the next harness therefore took the next
 * train's packages — 0.1.6-alpha.1 got 0.1.6-alpha.2's `dsh-app-boot` and
 * could not start. A package of this train published after the cutoff is
 * refused by npm and moves it later (`laterCutoff` in smoke-boot.mjs).
 */
export function releaseCutoff(times, version) {
  const own = times[version]
  if (own === undefined) throw new Error(`@deepseek-ai/dsh@${version} is not on npm`)
  if (laterHarnessVersions(times, version).size === 0) return undefined
  return new Date(Date.parse(own) + 1000).toISOString()
}

/** The `@deepseek-ai/dsh` versions published after `version`, from the same `time` map. */
export function laterHarnessVersions(times, version) {
  const own = times[version]
  return new Set(Object.entries(times).filter(([key, at]) => key !== 'created' && key !== 'modified' && at > own).map(([key]) => key))
}

/**
 * The package, and the version when npm names one, that an install with
 * `--before` refused as not yet published then: `No matching version found for
 * <name>@<range> with a date before …` (ETARGET), or `No versions available for
 * <name>` (ENOVERSIONS) when the package had no version at all by then —
 * 0.0.1-rc.5's `dsh-shell`, first published 96 s after its `@deepseek-ai/dsh`.
 * `undefined` for any other failure.
 */
export function refusedAsUnpublished(npmOutput) {
  const matching = /No matching version found for (@?[^@\s]+)@(\S+?) with a date before/.exec(npmOutput)
  if (matching !== null) return { name: matching[1], version: matching[2].replace(/^[\^~=v]+/, '') }
  const none = /No versions available for (@?[^@\s]+?)\.?(?:\s|$)/.exec(npmOutput)
  return none === null ? undefined : { name: none[1] }
}

/**
 * Installed harness packages (`[name, version]`) at a version of a later
 * harness train: what a caret range let into a graph meant to be the train as
 * released. Such a graph is not that train, and a smoke on it proves nothing
 * about it.
 */
export function strayPackages(installed, later) {
  return installed.filter(([name, version]) => (name === '@deepseek-ai/dsh' || name.startsWith('@deepseek-ai/dsh-')) && later.has(version))
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

/**
 * Where a Web shell's boot stands, from what its `#root` shows.
 *
 * Every shell from 0.0.1-rc.5 to 0.1.7 renders a boot page there: "Loading
 * plugins…" while the entries of the boot graph load, "Failed to load plugins"
 * with the ids that failed and the boot error when one does not activate. It
 * replaces that page with the application only after checking that every entry
 * is active — up to 0.1.0-rc.7 a React boot page swaps in the app shell, from
 * 0.1.0-rc.8 `uiRenderer.mount(#root)` clears a `[data-dsh-boot]` splash. From
 * 0.1.0-rc.8 a composition that never provides the renderer keeps "Loading
 * plugins…" up without any error, so only a timeout tells.
 *
 * @param {{ text: string, children: number }} root - `#root`'s visible text and element-child count.
 * @returns {'loading' | 'failed' | 'settled'}
 */
export function bootPageState({ text, children }) {
  if (/Failed to load plugins/.test(text)) return 'failed'
  if (/Loading plugins/.test(text) || children === 0) return 'loading'
  return 'settled'
}

/**
 * The plugin modules one script URL serves. 0.1.7 serves them in combos,
 * `/plugins/??<id>/client.js,<id>/client.js&rev=…` — a boot entry's own URL is
 * a combo of one, and the startup batches carry several; earlier trains serve
 * one module at `/plugins/<id>/client.js?rev=…`. Anything else serves none.
 */
export function modulesServedBy(url) {
  let parsed
  try { parsed = new URL(url) } catch { return [] }
  const search = decodeURIComponent(parsed.search)
  if (search.startsWith('??')) return search.slice(2).split('&')[0].split(',').map((file) => file.replace(/\/client\.js(?:\.map)?$/, ''))
  const one = /^\/plugins\/(.+)\/client\.js$/.exec(decodeURIComponent(parsed.pathname))
  return one === null ? [] : [one[1]]
}

/**
 * The lines, 1-based and inclusive, that one module occupies in a combo
 * script: from its own `__ModuleLoader__.load({ id: "<id>"` to the line before
 * the next module's. `undefined` when the script does not carry it.
 */
export function moduleLines(script, id) {
  const lines = String(script).split('\n')
  const start = lines.findIndex((line) => line.includes(`__ModuleLoader__.load({ id: ${JSON.stringify(id)}`))
  if (start === -1) return undefined
  const next = lines.findIndex((line, i) => i > start && /__ModuleLoader__\.load\(\{ id: "/.test(line))
  return [start + 1, next === -1 ? lines.length : next]
}

/**
 * Whether a report from the browser — an uncaught error, a console message, a
 * failed request, an HTTP error — is about this plugin.
 *
 * A URL in it counts when it serves this plugin's module alone, or — for a
 * combo that carries other modules too — when it is a stack position inside
 * this plugin's lines of that combo (`linesIn(url)`), or when the report is
 * about the request itself (`request`: the combo failing means this plugin
 * failed to load). The rest of the text counts when it names the package,
 * scoped, URL-encoded or bare (`dsh-viewer: …`). A frame of another module
 * that shares a combo with this one is not about this plugin.
 */
export function blamesPlugin({ texts, request = false }, packageName, linesIn = () => undefined) {
  const needles = [packageName, encodeURIComponent(packageName), packageName.split('/').pop()]
  return texts.some((text) => {
    if (typeof text !== 'string') return false
    for (const [found] of text.matchAll(/\bhttps?:\/\/[^\s)'"]+/g)) {
      const position = /^(.*?):(\d+):(\d+)$/.exec(found)
      const url = position === null ? found : position[1]
      const served = modulesServedBy(url)
      if (!served.includes(packageName)) continue
      if (served.length === 1 || request) return true
      const lines = linesIn(url)
      if (position !== null && lines !== undefined && Number(position[2]) >= lines[0] && Number(position[2]) <= lines[1]) return true
    }
    const rest = text.replace(/\bhttps?:\/\/[^\s)'"]+/g, ' ')
    return needles.some((needle) => rest.includes(needle))
  })
}

/** Every package installed under `modules`, nested ones included, with its manifest. */
export function installedPackages(modules) {
  const installed = []
  const walk = (dir) => {
    if (!existsSync(dir)) return
    for (const entry of readdirSync(dir)) {
      if (entry.startsWith('.')) continue
      const path = join(dir, entry)
      if (entry.startsWith('@')) { walk(path); continue }
      if (!existsSync(join(path, 'package.json'))) continue
      installed.push({ path, manifest: JSON.parse(readFileSync(join(path, 'package.json'), 'utf8')) })
      walk(join(path, 'node_modules'))
    }
  }
  walk(modules)
  return installed
}

/**
 * Required peers that no installed package under `modules` can resolve, as
 * `name → the first range declared for it`. After a `--legacy-peer-deps`
 * install — which installs no peers at all — these are what npm's peer graph
 * would have added; installing each at its declared range completes the tree.
 */
export function unmetPeers(modules) {
  const unmet = new Map()
  for (const { path, manifest } of installedPackages(modules)) {
    for (const [name, range] of Object.entries(manifest.peerDependencies ?? {})) {
      if (manifest.peerDependenciesMeta?.[name]?.optional || unmet.has(name)) continue
      // Node resolution: this package's own node_modules, then each ancestor's.
      let dir = path
      let found = false
      while (dir.startsWith(modules)) {
        if (existsSync(join(dir, 'node_modules', name, 'package.json'))) { found = true; break }
        dir = dirname(dir)
      }
      if (!found && !existsSync(join(modules, name, 'package.json'))) unmet.set(name, range)
    }
  }
  return unmet
}
