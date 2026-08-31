# Development

> **English** · [中文](development.zh.md) · [Docs index](README.md)

The three always-on constraints live in [AGENTS.md](../AGENTS.md). This page is the recipes and invariants for changing code.

## What each half may do

| | Host (`src/`) | Browser (`src/client/`) |
| --- | --- | --- |
| Has | `ctx.fs` `ctx.tools` `ctx.attachments` `ctx.webServer` `ctx.llm`, `node:` builtins | `ctx.slots` `ctx.locale` `ctx.sessions`, the DOM |
| Owns | resolving paths, signing URLs, converting documents, committing attachments, deciding `inContext` | turning one settled tool block into a card |
| Never | imports a UI or transport type | value-imports anything but react ([purity gate](../AGENTS.md)) |

`src/contract.ts` is the only module both halves share, which is why it imports **neither `@deepseek-ai/schemastery` nor any `node:` builtin** — either would be inlined into the client bundle or break it outright. The host schema is built on top of it in `src/settings.ts`.

## Adding a format

1. Add a row to `MEDIA_TABLE` in `src/contract.ts`: extension → `{ kind, mediaType }`. **Only add what a browser genuinely plays** — a row here is a promise that the card renders something. A codec the browser refuses belongs on the `file` fallback.
2. Add a `ViewerKind` only when the format needs a new element. Reuse where you can: `svg` and `png` are both `image` because both go in an `<img>`.
3. A new kind also means touching `KIND_TITLE`, the `KindIcon` path and the `Viewer` switch in `src/client/ViewerCard.tsx`, plus **both** dictionaries in `src/client/locales.ts` — the locale service fails a namespace whose dictionaries disagree on keys.
4. Formats whose bytes are meaningless as text go in `OPAQUE_KINDS`, so a `read` aimed at one gets corrected. `html` is deliberately excluded: reading HTML source is a legitimate text read.
5. Extend `tests/contract.test.ts`, and update the format table **and the counts** in both READMEs — the market review checks the numbers in a description against the code.

## Adding a setting

The field-name constant and the interface go in `src/contract.ts`, the schema in `src/settings.ts`. Then decide whether it is a **registration-time fact** or a **run-time read**:

- Registration-time (e.g. `tool`): it changes the schema list the model sees, so it must be **re-registered** in `onChange`. Turning it off means the tool disappears from the list, not that it sits there refusing calls.
- Run-time (e.g. `feedModel`): the listener reads a thunk on each execution; nothing needs remounting.

`reconcile()` in `src/index.ts` is the template for the former: idempotent, and called once directly because a composition with no settings provider never reaches `onChange` and would otherwise never establish the entry-config state.

## Three sources a card rebuilds from

`src/client/card-model.ts` tries them in order. Each exists for a reason; removing any one turns a real scenario into a bare header:

1. **`block.meta`** — `display_file`'s `presentationMeta`. The normal path for a top-level call, and replay-safe.
2. **The result envelope** — the registry projects `presentationMeta` **only for top-level calls** (`exec.parent === undefined`). When the model calls `tools.display_file` from inside `run_code` there is no metadata at all, so the card recovers from the `<media>`, `<bytes>` and `<asset>` elements of the model-facing envelope. This is the card parsing **its own** structured envelope, and the recovered value goes through exactly the same narrowing as the replay path.
3. **An image block in `content`** — the shipped `read_image` writes no metadata; its picture exists only in the content blocks.

Any of the three can receive a shape this build never wrote (an old log, a truncated window, fields written by a newer version), so every read narrows defensively and **returns `undefined` to degrade the card rather than throwing** — a throwing entry is removed from its slot, taking every viewer card in the conversation with it.

## Two counter-intuitive rendering facts

**A PDF iframe must not carry `sandbox`.** Without `allow-same-origin` the frame gets an opaque origin, and Chrome's built-in PDF viewer refuses to run there — the frame shows "This page has been blocked by Chrome". A PDF needs no sandbox anyway: served as `application/pdf` under `nosniff`, the browser hands it to its own isolated viewer. Local HTML is the opposite case — arbitrary script an agent may have just written — so it keeps the sandbox, backed by the CSP the host sends with the response.

**`read` on binary media is not an error.** The shipped `dsh-fs-local` samples the file head and throws `FS_NOT_TEXT` on a NUL byte, so that red failure row appears with or without this plugin. A `tools/pre-execute` denial materializes its own `isError`; `tools/post-execute` cannot help either, because replacing a value is refused on a failed result and replacing content keeps `isError`. The correction therefore runs in the `tools/execute` around-dispatch waterfall and **never calls `next()`**: the doomed read performs no I/O at all, and the authored success is re-projected by `normalizeDispatchResult` through the owning tool's own `render` and `presentationMeta`, which replaces the persisted read metadata too.

## Testing

`npm test` runs `tests/*.test.ts`. The bar for new behaviour is not "is there a test" but **can this test falsify a real failure**:

- **Pure functions** (classification, narrowing, envelope parsing) are tested directly, including malformed input — they really do receive it when replaying old logs.
- **HTTP behaviour is tested against a real server.** Range correctness cannot be proven by unit-testing the parser; you have to see which bytes and headers the response actually carried (`tests/asset-route.test.ts` issues real requests over `node:http`).
- **External toolchains are tested on real artifacts.** `tests/convert.test.ts` builds a DOCX with LibreOffice, converts it back, and asserts the first four bytes are `%PDF-`. It skips where LibreOffice is absent, and separately asserts that the absent-tool error names the fix.
- **When you change rendering, take a real session screenshot.** The `sandbox` bug passed every unit test; only a screenshot showed "blocked by Chrome".
