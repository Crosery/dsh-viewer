/**
 * Everything `scripts/follow-upstream.mjs` writes when upstream publishes a
 * harness version this repository has not recorded yet: the admitted-train
 * lists, the peer comparator sets, the support table, the acceptance record,
 * the README numbers and the version bump.
 *
 * Pure transforms over strings and JSON — no network, no filesystem — so
 * `tests/follow-upstream.test.ts` pins them without installing anything.
 *
 * The formatting is not cosmetic. `scripts/check-invariants.mjs` reads
 * `ADMITTED_TRAINS`, requires both compatibility docs to name every entry, and
 * checks each entry against every peer range under both semver rules;
 * `tests/harness-ci.test.ts` feeds its `PUBLISHED` list to the same decisions
 * CI's matrix makes. A version recorded in one place and missing from another
 * is the drift this repository exists to refuse.
 */

import semver from 'semver'
import { FLOOR, isHarnessPeer, tupleHeads } from './harness-lib.mjs'

/** `0.2.1-alpha.3` → `0.2.1`. */
export function tupleOf(version) {
  if (!semver.valid(version)) throw new Error(`not a version: ${version}`)
  return version.split(/[-+]/)[0]
}

/** Numeric tuple order; `0.2.1` sorts before `0.10.0`. */
export function compareTuples(a, b) {
  const left = a.split('.').map(Number)
  const right = b.split('.').map(Number)
  return left[0] - right[0] || left[1] - right[1] || left[2] - right[2]
}

/** The tuples a version list covers, ascending and deduplicated. */
export function tuplesOf(versions) {
  return [...new Set(versions.map(tupleOf))].sort(compareTuples)
}

/**
 * One comparator set for one tuple: every prerelease of `M.m.p` and nothing
 * from `M.m.(p+1)`. A set spanning two tuples admits no prerelease of the
 * second under npm's rule, and a set without a prerelease floor admits none of
 * its own — `scripts/check-invariants.mjs` refuses both.
 */
export function comparatorSet(tuple) {
  const [major, minor, patch] = tuple.split('.').map(Number)
  return `>=${major}.${minor}.${patch}-alpha.0 <${major}.${minor}.${patch + 1}-0`
}

/** The tuples one peer range already covers, in the order it lists them. */
export function coveredTuples(range) {
  return range.split('||').map((set) => {
    const match = /^\s*>=(\d+\.\d+\.\d+)-[0-9A-Za-z.]+ <(\d+\.\d+\.\d+)-0\s*$/.exec(set)
    return match === null ? undefined : match[1]
  }).filter((tuple) => tuple !== undefined)
}

/** Append a comparator set for each tuple the range does not cover yet. */
export function addTuples(range, tuples) {
  const covered = coveredTuples(range)
  const missing = [...tuples].filter((tuple) => !covered.includes(tuple)).sort(compareTuples)
  return missing.length === 0 ? range : [range, ...missing.map(comparatorSet)].join(' || ')
}

/** A manifest whose every harness peer admits `tuples` as well. */
export function widenPeers(manifest, tuples) {
  if (tuples.length === 0) return manifest
  const peerDependencies = {}
  for (const [name, range] of Object.entries(manifest.peerDependencies)) {
    peerDependencies[name] = isHarnessPeer(name) ? addTuples(range, tuples) : range
  }
  return { ...manifest, peerDependencies }
}

/** `0.2.1` → `0.2.2`, or `0.3.0` for a train that widened the support surface. */
export function bumpVersion(version, { minor = false } = {}) {
  const [major, minorVersion, patch] = version.split('.').map(Number)
  return minor ? `${major}.${minorVersion + 1}.0` : `${major}.${minorVersion}.${patch + 1}`
}

/**
 * A version array body in this repository's style: one tuple per line where it
 * fits, `wrap` columns otherwise, a trailing comma on every line.
 */
export function formatList(versions, { indent = '  ', wrap = 100 } = {}) {
  const sorted = [...new Set(versions)].sort(semver.compare)
  const lines = []
  let line = ''
  let tuple = ''
  for (const version of sorted) {
    const token = `'${version}'`
    const at = tupleOf(version)
    if (line !== '' && (at !== tuple || `${line}, ${token}`.length > wrap)) {
      lines.push(`${line},`)
      line = `${indent}${token}`
    } else line = line === '' ? `${indent}${token}` : `${line}, ${token}`
    tuple = at
  }
  if (line !== '') lines.push(`${line},`)
  return lines.join('\n')
}

/** The versions inside `const NAME = [ … ]`, in source order. */
export function readList(source, name) {
  const block = new RegExp(`const ${name} = \\[([\\s\\S]*?)\\n\\]`).exec(source)
  if (block === null) throw new Error(`no \`const ${name} = [ … ]\` in this source`)
  return [...block[1].matchAll(/'([^']+)'/g)].map((match) => match[1])
}

/** The same source with `const NAME = [ … ]` rewritten to list `versions`. */
export function writeList(source, name, versions) {
  const pattern = new RegExp(`(const ${name} = \\[)[\\s\\S]*?(\\n\\])`)
  if (!pattern.test(source)) throw new Error(`no \`const ${name} = [ … ]\` in this source`)
  return source.replace(pattern, (_, open, close) => `${open}\n${formatList(versions)}${close}`)
}

/**
 * The versions the default smoke policy runs a boot smoke on: the floor, every
 * tuple head and whatever a dist-tag or the desktop feed resolves to.
 */
export function smokePlan(published, { floor = FLOOR, notable = [] } = {}) {
  const heads = tupleHeads(published)
  const extra = new Set([floor, ...notable])
  return [...published].sort(semver.compare).filter((version) => heads.has(version) || extra.has(version))
}

/** The `assert.deepEqual(smoked, […])` literal, with `FLOOR` kept symbolic. */
export function smokePlanLiteral(published, { floor = FLOOR, notable = [] } = {}) {
  return smokePlan(published, { floor, notable }).map((version) => (version === floor ? 'FLOOR' : `'${version}'`)).join(', ')
}

/** The next tuple no range admits — the build the refusal test names. */
export function nextRefusedHead(published) {
  const [major, minor, patch] = tuplesOf(published).at(-1).split('.').map(Number)
  return `${major}.${minor}.${patch + 1}-alpha.1`
}

/**
 * Rewrite the refusal test's version list: the tuple nobody published stays,
 * and the "next, unverified one" moves to whatever now follows the newest
 * admitted tuple.
 */
export function writeRefusedHeads(source, published) {
  const last = tuplesOf(published).at(-1)
  const block = /(it\('refuses the tuples nobody published, and the next, unverified one', \(\) => \{\n\s*for \(const version of \[)([^\]]*)(\]\))/.exec(source)
  if (block === null) throw new Error('no refusal test to rewrite')
  const kept = [...block[2].matchAll(/'([^']+)'/g)].map((match) => match[1])
    .filter((version) => semver.valid(version) === null || compareTuples(tupleOf(version), last) < 0)
  const versions = [...kept, nextRefusedHead(published)]
  return source.replace(block[0], `${block[1]}${versions.map((version) => `'${version}'`).join(', ')}${block[3]}`)
}

/** The README sentence that names the version range. */
export function patchReadmeRange(text, end) {
  const en = /(`0\.0\.1-rc\.1` through )`[^`]+`/
  const zh = /(从 `0\.0\.1-rc\.1` 到 )`[^`]+`/
  if (en.test(text)) return text.replace(en, (_, prefix) => `${prefix}\`${end}\``)
  if (zh.test(text)) return text.replace(zh, (_, prefix) => `${prefix}\`${end}\``)
  throw new Error('no supported-version range in this README')
}

/** The README sentence that names npm's three dist-tags. */
export function patchReadmeDistTags(text, tags) {
  const values = ['latest', 'next', 'alpha'].map((name) => tags[name]).filter(Boolean)
  if (values.length !== 3) throw new Error(`dist-tags are incomplete: ${JSON.stringify(tags)}`)
  const en = /`latest` \(`[^`]+`\), `next` \(`[^`]+`\) and `alpha` \(`[^`]+`\)/
  const zh = /`latest`（`[^`]+`）、`next`（`[^`]+`）和 `alpha`（`[^`]+`）/
  const [latest, next, alpha] = values
  if (en.test(text)) return text.replace(en, `\`latest\` (\`${latest}\`), \`next\` (\`${next}\`) and \`alpha\` (\`${alpha}\`)`)
  if (zh.test(text)) return text.replace(zh, `\`latest\`（\`${latest}\`）、\`next\`（\`${next}\`）和 \`alpha\`（\`${alpha}\`）`)
  throw new Error('no dist-tag sentence in this README')
}

/** The number of published versions that install, wherever a README states it. */
export function patchReadmeInstallable(text, count) {
  if (/cover all \d+ installable versions/.test(text)) return text.replace(/cover all \d+ installable versions/, `cover all ${count} installable versions`)
  if (/覆盖全部 \d+ 个可安装版本/.test(text)) return text.replace(/覆盖全部 \d+ 个可安装版本/, `覆盖全部 ${count} 个可安装版本`)
  if (/— \d+ of them/.test(text)) return text.replace(/— \d+ of them/, `— ${count} of them`)
  if (/扫这 \d+ 个/.test(text)) return text.replace(/扫这 \d+ 个/, `扫这 ${count} 个`)
  throw new Error('no installable-version count in this README')
}

/** The support sentence and the manifest's exact peer range, in either language. */
export function patchCompatibilityRange(text, end, range) {
  const en = /(\*\*Web:\*\* every published harness version, `0\.0\.1-rc\.1` through )`[^`]+`/
  const zh = /(\*\*Web 端\*\*：每一个已发布的 harness 版本，从 `0\.0\.1-rc\.1` 到 )`[^`]+`/
  const sentence = en.test(text) ? en : zh.test(text) ? zh : undefined
  if (sentence === undefined) throw new Error('no support-range sentence in this compatibility doc')
  const updated = text.replace(sentence, (_, prefix) => `${prefix}\`${end}\``)
  if (range === undefined) return updated
  const block = /(```text\r?\n)>=[^\n]+(\r?\n```)/
  if (!block.test(updated)) throw new Error('no peer-range code block in this compatibility doc')
  return updated.replace(block, (_, open, close) => `${open}${range}${close}`)
}

const cells = (row) => row.split('|').map((cell) => cell.trim())

/**
 * Rewrite one tuple's support-table row, or add the row for a tuple that has
 * none yet. Column 2 is the published version list, column 3 is types+tests,
 * column 4 the versions the boot smoke ran on, column 5 the live-browser
 * evidence — the last two are only touched when the caller names them.
 */
export function writeTableRow(doc, tuple, { versions, separator, yes, smoke }) {
  const rows = doc.split('\n')
  const index = rows.findIndex((row) => cells(row)[0] === `| ${tuple}` || cells(row)[1] === tuple)
  const wanted = (row) => {
    const parts = cells(row)
    if (parts.length !== 7) throw new Error(`support-table row for ${tuple} does not have 5 columns: ${row}`)
    parts[2] = versions.map((version) => `\`${version}\``).join(separator)
    if (yes !== undefined) parts[3] = yes
    if (smoke !== undefined) parts[4] = smoke
    return `| ${parts.slice(1, 6).join(' | ')} |`
  }
  if (index !== -1) {
    const row = rows[index]
    // A row whose leading cell is the tuple in the header position belongs to the table body.
    if (row.startsWith(`| ${tuple} |`)) {
      rows[index] = wanted(row)
      return rows.join('\n')
    }
  }
  const missing = `| ${tuple} | ${versions.map((version) => `\`${version}\``).join(separator)} | ${yes} | ${smoke ?? '—'} | — |`
  // Insert after the table row of the previous tuple, keeping tuples in order.
  const previous = rows.findLastIndex((row) => /^\| \d+\.\d+\.\d+ \|/.test(row))
  if (previous === -1) throw new Error('no support table to extend')
  rows.splice(previous + 1, 0, missing)
  return rows.join('\n')
}

/** A dated acceptance section, in the shape the earlier ones use. */
export function acceptanceSection({ lang, version, date, node, npm, rows, smoke, tuples }) {
  const zh = lang === 'zh'
  const failed = rows.filter((row) => row.outcome !== 'pass')
  const kept = [...new Set(rows.flatMap((row) => row.kept ?? []))]
  const keptNote = kept.length === 0
    ? (zh ? '扫描未报告任何保留旧钉的依赖。' : 'The sweep reported no dependency kept at an older pin.')
    : (zh ? `扫描保留了这些依赖的旧钉：${kept.map((entry) => `\`${entry}\``).join('、')}。`
      : `The sweep kept these dependencies at an older pin: ${kept.map((entry) => `\`${entry}\``).join(', ')}.`)
  const listed = rows.map((row) => `| \`${row.version}\` | ${
    row.outcome === 'pass' ? (zh ? '通过' : 'pass')
      : row.outcome === 'incomplete upstream' ? (zh ? '上游发布不完整' : 'incomplete upstream')
        : (zh ? '失败' : 'fail')
  }: ${zh ? 'host tsc' : 'host tsc'} ${row.host || '—'}、${zh ? 'client tsc' : 'client tsc'} ${row.client || '—'}、${row.tests || '—'} ${zh ? '测试' : 'tests'}${row.detail ? `；${row.detail}` : ''} |`).join('\n')
  const commands = [
    `\`node scripts/sweep-trains.mjs --versions ${rows.map((row) => row.version).join(',')}\``,
    smoke === undefined ? '' : `\`node scripts/smoke-boot.mjs --dsh ${smoke.version}\``,
  ].filter(Boolean).join(zh ? ' 与 ' : ' and ')
  const smokeLine = smoke === undefined ? '' : zh
    ? `\n\n${commands}，${zh ? '严格模式（不给豁免）' : ''}：${smoke.ok ? '九个阶段全部通过' : '未通过'}${smoke.entries ? `，客户端图 ${smoke.entries} 个 entry` : ''}。`
    : `\n\n${commands}, strict (no exemption): ${smoke.ok ? 'all nine stages passed' : 'failed'}${smoke.entries ? `, client graph of ${smoke.entries} entries` : ''}.`
  if (zh) {
    return [
      `## ${version}：自动追上 ${date} 发布的上游版本`,
      '',
      `\`node scripts/follow-upstream.mjs\` 在 ${date}（Node ${node}、npm ${npm}）发现 ${rows.length} 个未记录的 \`@deepseek-ai/dsh\` 版本${tuples.length > 0 ? `，并给每个 harness peer 加上 ${tuples.map((tuple) => `\`${tuple}\``).join('、')} 元组` : ''}。${commands}：`,
      '',
      '| 版本 | 结果 |',
      '| --- | --- |',
      listed,
      '',
      `${failed.length === 0 ? '没有改源码。' : `其中 ${failed.length} 个没有通过，范围没有放宽。`}${keptNote}这些版本没有人工浏览器实测。${smokeLine}`,
      '',
    ].join('\n')
  }
  return [
    `## ${version}: following the trains published ${date}`,
    '',
    `\`node scripts/follow-upstream.mjs\` found ${rows.length} unrecorded \`@deepseek-ai/dsh\` version(s) on ${date} (Node ${node}, npm ${npm})${tuples.length > 0 ? `, and added the ${tuples.map((tuple) => `\`${tuple}\``).join(', ')} tuple to every harness peer` : ''}. ${commands}:`,
    '',
    '| Version | Outcome |',
    '| --- | --- |',
    listed,
    '',
    `${failed.length === 0 ? 'No source change was needed.' : `${failed.length} of them did not pass, so no range was widened.`} ${keptNote} These trains were not rendered in a browser by hand.${smokeLine}`,
    '',
  ].join('\n')
}

/** Insert a section after the document's intro, before its first `## `. */
export function insertSection(doc, section) {
  const index = doc.indexOf('\n## ')
  if (index === -1) throw new Error('document has no section to insert before')
  return `${doc.slice(0, index + 1)}${section}${doc.slice(index + 1)}`
}

/** `package.json` and `package-lock.json`, both carrying the new version. */
export function writeVersion(manifest, lock, version) {
  const next = { ...manifest, version }
  const nextLock = { ...lock, version, packages: { ...lock.packages, '': { ...lock.packages[''], version } } }
  return { manifest: next, lock: nextLock }
}
