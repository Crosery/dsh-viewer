/**
 * Two-artifact build.
 *
 * The Node half is an ordinary ESM library. The browser half must be the
 * loader's lazy-CJS factory artifact — dsh publishes no preset for that format,
 * so the banner/footer/intro below reproduce it: the bundle hands the loader a
 * factory, and every module-table specifier stays a `require` the loader
 * answers. Anything not in the table must be inlined, because a `require` the
 * table cannot answer throws at plugin activation.
 */

import { build } from 'esbuild'
import { execFileSync } from 'node:child_process'
import { readFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'

const root = fileURLToPath(new URL('..', import.meta.url))
const tscBin = fileURLToPath(new URL('../node_modules/typescript/bin/tsc', import.meta.url))
const manifest = JSON.parse(await readFile(new URL('../package.json', import.meta.url), 'utf8'))
const id = manifest.name

/**
 * Specifiers the browser module table answers. The first eight are the shell
 * baseline every dynamic bundle may require; the rest of this package's imports
 * are type-only and erase before they reach the bundler.
 */
const MODULE_TABLE = [
  'react',
  'react/jsx-runtime',
  'react-dom',
  'react-dom/client',
  '@deepseek-ai/cordis',
  '@deepseek-ai/dsh-client-store',
  '@deepseek-ai/dsh-client-ui-slots',
  '@deepseek-ai/dsh-client-ui-primitives',
]

/** Node-half externals: everything a real install materializes on disk. */
const NODE_EXTERNAL = [
  ...Object.keys(manifest.dependencies ?? {}),
  ...Object.keys(manifest.peerDependencies ?? {}),
]

/**
 * Declaration emit runs from two configs, not one: both halves augment the same
 * `@deepseek-ai/cordis` Context and disagree about what `sessions` is, so one
 * program that sees both augmentations resolves the wrong one silently.
 */
const TSCONFIGS = ['tsconfig.json', 'tsconfig.client.json']

const shared = {
  absWorkingDir: root,
  bundle: true,
  target: 'es2024',
  logLevel: 'info',
  logOverride: { 'empty-import-meta': 'silent' },
}

// Declarations first: `package.json` points `types` at lib/types, so a build
// that emitted only the bundles would publish a package with no types at all.
// A type error here fails the build rather than shipping a stale .d.ts.
for (const config of TSCONFIGS) {
  execFileSync(process.execPath, [tscBin, '-p', config], { cwd: root, stdio: 'inherit' })
}

await build({
  ...shared,
  entryPoints: ['src/index.ts'],
  outfile: 'lib/index.js',
  format: 'esm',
  platform: 'node',
  external: NODE_EXTERNAL,
})

await build({
  ...shared,
  entryPoints: ['src/client/index.ts'],
  outfile: 'lib/client.js',
  format: 'cjs',
  platform: 'browser',
  external: MODULE_TABLE,
  jsx: 'automatic',
  // zustand and friends read these; a CJS bundle carries neither, and an
  // unsubstituted reference is a ReferenceError at factory execution.
  define: { 'process.env.NODE_ENV': '"production"' },
  banner: { js: `window.__ModuleLoader__.load({ id: ${JSON.stringify(id)}, factory: (require) => {\nvar module = { exports: {} }; var exports = module.exports;` },
  footer: { js: 'return module.exports; } });' },
})

console.log(`built ${id}: lib/index.js + lib/client.js`)
