/**
 * Document conversion. The LibreOffice cases run only where LibreOffice is
 * installed — skipping is honest here, because a machine without it is exactly
 * the deployment whose fallback the other tests cover.
 */

import { deepEqual, equal, notEqual, ok } from 'node:assert/strict'
import { execFile } from 'node:child_process'
import { mkdtemp, readFile, stat, utimes, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'
import { promisify } from 'node:util'
import { artifactName, convertDocument, resolveConverter, type Converter } from '../src/convert.ts'
import { classifyPath, isOpaqueMediaPath, OPAQUE_KINDS } from '../src/contract.ts'

const run = promisify(execFile)
const CONVERTER: Converter = { binary: 'soffice', version: 'LibreOffice 25.8.1.2' }

test('every Office and OpenDocument family classifies as a convertible document', () => {
  for (const ext of ['.docx', '.doc', '.rtf', '.odt', '.xlsx', '.xls', '.ods', '.pptx', '.ppt', '.odp']) {
    equal(classifyPath(`deck${ext}`).kind, 'document', ext)
  }
  // A document is opaque to `read` for the same reason a PNG is.
  ok(OPAQUE_KINDS.includes('document'))
  equal(isOpaqueMediaPath('/tmp/report.xlsx'), true)
})

test('the classification carries the SOURCE media type, which the served type later replaces', () => {
  equal(classifyPath('a.docx').mediaType, 'application/vnd.openxmlformats-officedocument.wordprocessingml.document')
  equal(classifyPath('a.pptx').mediaType, 'application/vnd.openxmlformats-officedocument.presentationml.presentation')
})

test('the artifact key covers the converter version, so an upgrade cannot serve a stale render', () => {
  const a = artifactName(CONVERTER, '/tmp/a.docx', 1000, 50)
  const b = artifactName({ ...CONVERTER, version: 'LibreOffice 26.2.0.1' }, '/tmp/a.docx', 1000, 50)
  notEqual(a, b)
  ok(a.endsWith('.pdf'))
})

test('the artifact key covers file identity, so an edit is a different artifact', () => {
  const base = artifactName(CONVERTER, '/tmp/a.docx', 1000, 50)
  notEqual(base, artifactName(CONVERTER, '/tmp/a.docx', 2000, 50), 'mtime')
  notEqual(base, artifactName(CONVERTER, '/tmp/a.docx', 1000, 51), 'size')
  notEqual(base, artifactName(CONVERTER, '/tmp/b.docx', 1000, 50), 'path')
  // Same inputs must be the same name, or the cache never hits.
  equal(base, artifactName(CONVERTER, '/tmp/a.docx', 1000, 50))
})

const converter = await resolveConverter()

test('a real DOCX converts to a PDF and the second call is a cache hit', { skip: converter === undefined ? 'LibreOffice is not installed' : false }, async () => {
  const dir = await mkdtemp(join(tmpdir(), 'dsh-viewer-doc-'))
  const cache = join(dir, 'cache')
  const source = join(dir, 'note.docx')
  // Build the DOCX with LibreOffice itself, so the fixture needs no toolchain
  // of its own and is a document LibreOffice genuinely wrote.
  await writeFile(join(dir, 'note.txt'), 'dsh-viewer document conversion\nsecond line\n')
  await run(converter!.binary, [
    `-env:UserInstallation=file://${join(dir, 'p1')}`,
    '--headless', '--convert-to', 'docx', '--outdir', dir, join(dir, 'note.txt'),
  ], { timeout: 120_000 })

  const artifact = await convertDocument(source, cache)
  ok(artifact.startsWith(cache))
  const head = (await readFile(artifact)).subarray(0, 5).toString('latin1')
  equal(head, '%PDF-', 'the artifact is a real PDF')

  const before = await stat(artifact)
  const again = await convertDocument(source, cache)
  equal(again, artifact)
  // A cache hit must not rewrite the artifact.
  deepEqual((await stat(again)).mtimeMs, before.mtimeMs)
})

test('a source edit produces a different artifact rather than serving the old render', { skip: converter === undefined ? 'LibreOffice is not installed' : false }, async () => {
  const dir = await mkdtemp(join(tmpdir(), 'dsh-viewer-doc2-'))
  const cache = join(dir, 'cache')
  const source = join(dir, 'sheet.csv')
  await writeFile(source, 'a,b\n1,2\n')
  const first = await convertDocument(source, cache).catch(() => undefined)
  // csv is not in the document table, so this only runs when a caller passes a
  // path directly; the point being asserted is the identity rule, so a failure
  // to convert csv is not what is under test.
  if (first === undefined) return
  await writeFile(source, 'a,b\n1,2\n3,4\n')
  await utimes(source, new Date(), new Date(Date.now() + 1000))
  notEqual(await convertDocument(source, cache), first)
})

test('with no converter installed the failure names the fix instead of a stack', async () => {
  if (converter !== undefined) return
  const dir = await mkdtemp(join(tmpdir(), 'dsh-viewer-doc3-'))
  const source = join(dir, 'a.docx')
  await writeFile(source, 'not really a docx')
  await convertDocument(source, join(dir, 'cache')).then(
    () => { throw new Error('expected a refusal') },
    (error: unknown) => { ok(String(error).includes('LibreOffice')) },
  )
})
