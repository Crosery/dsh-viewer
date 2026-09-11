// src/index.ts
import { dshHomePath } from "@deepseek-ai/dsh-home-paths";

// src/contract.ts
var DISPLAY_TOOL = "display_file";
var READ_IMAGE_TOOL = "read_image";
var READ_TOOL = "read";
var VIEWER_SETTINGS_NAMESPACE = "crosery-viewer";
var ASSET_ROUTE = "/crosery/dsh-viewer/asset";
var MEDIA_TABLE = {
  // Rasters and vectors an <img> renders. The first four are also the exact
  // set the durable attachment service admits, which is what lets them reach
  // model context; the rest are display-only.
  ".png": { kind: "image", mediaType: "image/png" },
  ".jpg": { kind: "image", mediaType: "image/jpeg" },
  ".jpeg": { kind: "image", mediaType: "image/jpeg" },
  ".webp": { kind: "image", mediaType: "image/webp" },
  ".gif": { kind: "image", mediaType: "image/gif" },
  ".svg": { kind: "image", mediaType: "image/svg+xml" },
  ".avif": { kind: "image", mediaType: "image/avif" },
  ".bmp": { kind: "image", mediaType: "image/bmp" },
  ".ico": { kind: "image", mediaType: "image/x-icon" },
  ".apng": { kind: "image", mediaType: "image/apng" },
  ".mp4": { kind: "video", mediaType: "video/mp4" },
  ".m4v": { kind: "video", mediaType: "video/x-m4v" },
  ".webm": { kind: "video", mediaType: "video/webm" },
  ".ogv": { kind: "video", mediaType: "video/ogg" },
  ".mov": { kind: "video", mediaType: "video/quicktime" },
  ".mp3": { kind: "audio", mediaType: "audio/mpeg" },
  ".m4a": { kind: "audio", mediaType: "audio/mp4" },
  ".aac": { kind: "audio", mediaType: "audio/aac" },
  ".wav": { kind: "audio", mediaType: "audio/wav" },
  ".flac": { kind: "audio", mediaType: "audio/flac" },
  ".ogg": { kind: "audio", mediaType: "audio/ogg" },
  ".oga": { kind: "audio", mediaType: "audio/ogg" },
  ".opus": { kind: "audio", mediaType: "audio/ogg" },
  ".pdf": { kind: "pdf", mediaType: "application/pdf" },
  // Office and OpenDocument. No browser renders any of these, so the Host
  // converts them before the card ever sees them — `mediaType` here is the
  // SOURCE type, and the served artifact's type replaces it in the outcome.
  ".docx": { kind: "document", mediaType: "application/vnd.openxmlformats-officedocument.wordprocessingml.document" },
  ".doc": { kind: "document", mediaType: "application/msword" },
  ".rtf": { kind: "document", mediaType: "application/rtf" },
  ".odt": { kind: "document", mediaType: "application/vnd.oasis.opendocument.text" },
  ".xlsx": { kind: "document", mediaType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" },
  ".xls": { kind: "document", mediaType: "application/vnd.ms-excel" },
  ".ods": { kind: "document", mediaType: "application/vnd.oasis.opendocument.spreadsheet" },
  ".pptx": { kind: "document", mediaType: "application/vnd.openxmlformats-officedocument.presentationml.presentation" },
  ".ppt": { kind: "document", mediaType: "application/vnd.ms-powerpoint" },
  ".odp": { kind: "document", mediaType: "application/vnd.oasis.opendocument.presentation" },
  ".html": { kind: "html", mediaType: "text/html" },
  ".htm": { kind: "html", mediaType: "text/html" }
};
var UNKNOWN_MEDIA = { kind: "file", mediaType: "application/octet-stream" };
var MODEL_IMAGE_EXTENSIONS = {
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".webp": "image/webp",
  ".gif": "image/gif"
};
var OPAQUE_KINDS = ["image", "video", "audio", "pdf", "document"];
function extensionOf(filePath) {
  const base = filePath.slice(Math.max(filePath.lastIndexOf("/"), filePath.lastIndexOf("\\")) + 1);
  const dot = base.lastIndexOf(".");
  if (dot <= 0) return void 0;
  return base.slice(dot).toLowerCase();
}
function classifyPath(filePath) {
  const extension = extensionOf(filePath);
  if (extension === void 0) return UNKNOWN_MEDIA;
  return Object.hasOwn(MEDIA_TABLE, extension) ? MEDIA_TABLE[extension] : UNKNOWN_MEDIA;
}
function modelImageMediaTypeForPath(filePath) {
  const extension = extensionOf(filePath);
  if (extension === void 0) return void 0;
  return Object.hasOwn(MODEL_IMAGE_EXTENSIONS, extension) ? MODEL_IMAGE_EXTENSIONS[extension] : void 0;
}
function isOpaqueMediaPath(filePath) {
  return OPAQUE_KINDS.includes(classifyPath(filePath).kind);
}
function formatBytes(bytes) {
  if (!Number.isFinite(bytes) || bytes <= 0) return "";
  const units = ["B", "KB", "MB", "GB"];
  let value = bytes;
  let unit = 0;
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024;
    unit += 1;
  }
  return `${unit === 0 ? value : value.toFixed(value < 10 ? 1 : 0)} ${units[unit]}`;
}
var TOOL_FIELD = "tool";
var REDIRECT_READ_FIELD = "redirectRead";
var FEED_MODEL_FIELD = "feedModel";
var SUPERSEDE_READ_IMAGE_FIELD = "supersedeReadImage";

// src/settings.ts
import z from "@deepseek-ai/schemastery";
var ViewerSettingsSchema = z.object({
  [TOOL_FIELD]: z.boolean().default(true),
  [REDIRECT_READ_FIELD]: z.boolean().default(true),
  [FEED_MODEL_FIELD]: z.boolean().default(true),
  [SUPERSEDE_READ_IMAGE_FIELD]: z.boolean().default(true)
});

// src/asset-route.ts
import { createReadStream } from "node:fs";
import { stat } from "node:fs/promises";
import { pipeline } from "node:stream/promises";
import { basename } from "node:path";

// src/asset-token.ts
import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
var PATH_PARAM = "p";
var SIGNATURE_PARAM = "s";
var SIGNATURE_HEX_LENGTH = 32;
var SECRET_BYTES = 32;
async function loadAssetSecret(keyPath) {
  const existing = await readIfPresent(keyPath);
  if (existing !== void 0 && existing.length >= SECRET_BYTES) return existing;
  const created = randomBytes(SECRET_BYTES);
  await mkdir(dirname(keyPath), { recursive: true });
  if (existing === void 0) {
    try {
      await writeFile(keyPath, created, { mode: 384, flag: "wx" });
      return created;
    } catch (error) {
      if (error.code !== "EEXIST") throw error;
      const raced = await readIfPresent(keyPath);
      if (raced !== void 0 && raced.length >= SECRET_BYTES) return raced;
    }
  }
  await writeFile(keyPath, created, { mode: 384 });
  return created;
}
async function readIfPresent(path) {
  try {
    return await readFile(path);
  } catch (error) {
    if (error.code === "ENOENT") return void 0;
    throw error;
  }
}
function toBase64Url(value) {
  return Buffer.from(value, "utf8").toString("base64url");
}
function fromBase64Url(encoded) {
  const decoded = Buffer.from(encoded, "base64url").toString("utf8");
  return toBase64Url(decoded) === encoded ? decoded : void 0;
}
function sign(secret, path) {
  return createHmac("sha256", secret).update(path, "utf8").digest("hex").slice(0, SIGNATURE_HEX_LENGTH);
}
function assetUrlFor(secret, processPath) {
  const params = new URLSearchParams({
    [PATH_PARAM]: toBase64Url(processPath),
    [SIGNATURE_PARAM]: sign(secret, processPath)
  });
  return `${ASSET_ROUTE}?${params.toString()}`;
}
function verifyAssetRequest(secret, search) {
  const params = new URLSearchParams(search);
  const encoded = params.get(PATH_PARAM);
  const signature = params.get(SIGNATURE_PARAM);
  if (encoded === null || signature === null) return void 0;
  if (signature.length !== SIGNATURE_HEX_LENGTH) return void 0;
  const path = fromBase64Url(encoded);
  if (path === void 0 || path.length === 0) return void 0;
  const expected = Buffer.from(sign(secret, path), "utf8");
  const supplied = Buffer.from(signature, "utf8");
  if (expected.length !== supplied.length) return void 0;
  return timingSafeEqual(expected, supplied) ? path : void 0;
}

// src/asset-route.ts
function parseRange(header, size) {
  if (header === void 0) return void 0;
  const match = /^bytes=(\d*)-(\d*)$/.exec(header.trim());
  if (match === null) return void 0;
  const [, rawStart, rawEnd] = match;
  if (rawStart === "" && rawEnd === "") return void 0;
  if (size === 0) return "invalid";
  if (rawStart === "") {
    const suffix = Number(rawEnd);
    if (!Number.isFinite(suffix) || suffix <= 0) return "invalid";
    return { start: Math.max(0, size - suffix), end: size - 1 };
  }
  const start = Number(rawStart);
  if (!Number.isFinite(start) || start >= size) return "invalid";
  const end = rawEnd === "" ? size - 1 : Math.min(Number(rawEnd), size - 1);
  if (!Number.isFinite(end) || end < start) return "invalid";
  return { start, end };
}
function guardHeaders(kind) {
  if (kind === "html") return { "content-security-policy": "sandbox allow-scripts allow-forms" };
  if (kind === "image") return { "content-security-policy": "default-src 'none'; style-src 'unsafe-inline'; img-src data:" };
  return {};
}
function assetHandler(secret) {
  return async (req, res) => {
    if (req.method !== "GET" && req.method !== "HEAD") {
      res.writeHead(405, { allow: "GET, HEAD" }).end();
      return;
    }
    const key = secret();
    if (key === void 0) {
      res.writeHead(503, { "content-type": "text/plain; charset=utf-8" }).end("viewer key not ready");
      return;
    }
    const search = (req.url ?? "").slice((req.url ?? "").indexOf("?") + 1);
    const path = verifyAssetRequest(key, search);
    if (path === void 0) {
      res.writeHead(404, { "content-type": "text/plain; charset=utf-8" }).end("not found");
      return;
    }
    let size;
    try {
      const info = await stat(path);
      if (!info.isFile()) {
        res.writeHead(404, { "content-type": "text/plain; charset=utf-8" }).end("not found");
        return;
      }
      size = info.size;
    } catch {
      res.writeHead(404, { "content-type": "text/plain; charset=utf-8" }).end("not found");
      return;
    }
    const spec = classifyPath(path);
    const range = parseRange(req.headers.range, size);
    if (range === "invalid") {
      res.writeHead(416, { "content-range": `bytes */${size}` }).end();
      return;
    }
    const headers = {
      "content-type": spec.mediaType,
      "accept-ranges": "bytes",
      // The reference is signed over a path, not over content: the file behind
      // it may be rewritten at any time, so a cached copy could be stale.
      "cache-control": "no-store",
      // Without this a browser may sniff an octet-stream into something
      // executable; with it, the declared type is the only type.
      "x-content-type-options": "nosniff",
      "content-disposition": `inline; filename*=UTF-8''${encodeURIComponent(basename(path))}`,
      ...guardHeaders(spec.kind)
    };
    if (range === void 0) {
      res.writeHead(200, { ...headers, "content-length": String(size) });
    } else {
      res.writeHead(206, {
        ...headers,
        "content-length": String(range.end - range.start + 1),
        "content-range": `bytes ${range.start}-${range.end}/${size}`
      });
    }
    if (req.method === "HEAD" || size === 0) {
      res.end();
      return;
    }
    const stream = createReadStream(path, range === void 0 ? {} : { start: range.start, end: range.end });
    try {
      await pipeline(stream, res);
    } catch {
      if (!res.writableEnded) res.destroy();
    }
  };
}

// src/display-file.ts
import { basename as basename3, extname as extname2 } from "node:path";
import { AttachmentError, AttachmentId } from "@deepseek-ai/dsh-attachment";
import { createUserMessage } from "@deepseek-ai/dsh-llm";
import { defineTool } from "@deepseek-ai/dsh-tools";

// src/convert.ts
import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import { access, mkdir as mkdir2, mkdtemp, readdir, rename, rm, stat as stat2 } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename as basename2, extname, join } from "node:path";
import { promisify } from "node:util";
var run = promisify(execFile);
var MAC_APP_BINARY = "/Applications/LibreOffice.app/Contents/MacOS/soffice";
var CANDIDATES = ["soffice", "libreoffice", MAC_APP_BINARY];
var CONVERT_TIMEOUT_MS = 12e4;
var CONVERTED_MEDIA_TYPE = "application/pdf";
var probe;
async function resolveConverter() {
  probe ??= (async () => {
    for (const binary of CANDIDATES) {
      try {
        const { stdout } = await run(binary, ["--version"], { timeout: 3e4 });
        const version = stdout.trim().split("\n")[0] ?? "unknown";
        return { binary, version };
      } catch {
      }
    }
    return void 0;
  })();
  return await probe;
}
function artifactName(converter, sourcePath, mtimeMs, size) {
  const key = createHash("sha256").update(converter.version).update("\0").update(sourcePath).update("\0").update(String(Math.trunc(mtimeMs))).update("\0").update(String(size)).digest("hex").slice(0, 32);
  return `${key}.pdf`;
}
var queue = Promise.resolve();
function enqueue(job) {
  const result = queue.then(job, job);
  queue = result.then(() => void 0, () => void 0);
  return result;
}
async function exists(path) {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}
async function convertDocument(sourcePath, cacheDir, signal) {
  const converter = await resolveConverter();
  if (converter === void 0) {
    throw new Error(
      `cannot preview "${basename2(sourcePath)}": converting ${extname(sourcePath)} needs LibreOffice, which is not installed. Install it (macOS: brew install --cask libreoffice) and the preview works with no other change.`
    );
  }
  const info = await stat2(sourcePath);
  const artifact = join(cacheDir, artifactName(converter, sourcePath, info.mtimeMs, info.size));
  if (await exists(artifact)) return artifact;
  return await enqueue(async () => {
    if (await exists(artifact)) return artifact;
    await mkdir2(cacheDir, { recursive: true });
    const work = await mkdtemp(join(tmpdir(), "dsh-viewer-convert-"));
    try {
      await run(converter.binary, [
        // A private profile per invocation. Without it, a LibreOffice already
        // open on this desktop makes the headless call exit immediately with no
        // output at all — the single most common way this silently produces
        // nothing.
        `-env:UserInstallation=file://${join(work, "profile")}`,
        "--headless",
        "--norestore",
        "--convert-to",
        "pdf",
        "--outdir",
        work,
        sourcePath
      ], { timeout: CONVERT_TIMEOUT_MS, ...signal === void 0 ? {} : { signal } });
      const produced = (await readdir(work)).find((entry) => entry.toLowerCase().endsWith(".pdf"));
      if (produced === void 0) {
        throw new Error(`cannot preview "${basename2(sourcePath)}": LibreOffice produced no PDF for it`);
      }
      await rename(join(work, produced), artifact);
      return artifact;
    } finally {
      await rm(work, { recursive: true, force: true });
    }
  });
}

// src/read-target.ts
import { FsError } from "@deepseek-ai/dsh-fs";
import { canonicalPath } from "@deepseek-ai/dsh-sandbox";
var PARENT_PATH_SEGMENT = /(?:^|[\\/])\.\.(?:[\\/]|$)/;
function sessionCwd(exec, requestedPath) {
  const cwd = exec.agent?.session.header.cwd;
  if (cwd === void 0 || !PARENT_PATH_SEGMENT.test(cwd) && !PARENT_PATH_SEGMENT.test(requestedPath)) return cwd;
  return canonicalPath(cwd);
}
async function resolveDisplayTarget(ctx, exec, requestedPath) {
  const cwd = sessionCwd(exec, requestedPath);
  const target = await ctx.fs.resolve(requestedPath, {
    ...cwd === void 0 ? {} : { cwd },
    signal: exec.signal
  });
  const info = await ctx.fs.stat(target, exec.signal);
  if (info === void 0) {
    ctx.emit("fs/observed", target, { kind: "absent" }, exec);
    throw new FsError(`cannot display "${target.displayPath}": not found`, "FS_NOT_FOUND");
  }
  if (info.type !== "file") {
    throw new FsError(`cannot display "${target.displayPath}": not a regular file`, "FS_NOT_REGULAR_FILE");
  }
  return { target, info };
}

// src/display-file.ts
var PLUGIN = "@crosery/dsh-viewer";
async function routeAcceptsImages(ctx, exec) {
  const routed = exec.agent?.session.requestHeader()?.config;
  const provider = routed?.provider ?? exec.agent?.options.provider;
  const model = routed?.model ?? exec.agent?.options.model;
  const llm = ctx.get("llm");
  if (provider === void 0 || model === void 0 || llm === void 0) return false;
  try {
    const active = await llm.resolveModelInfo(provider, model, exec.signal);
    return active.inputModalities?.includes("image") === true;
  } catch {
    return false;
  }
}
function modelImageOf(ref) {
  return {
    attachmentId: ref.attachmentId,
    mediaType: ref.mediaType,
    bytes: ref.bytes,
    width: ref.width,
    height: ref.height,
    ...ref.name === void 0 ? {} : { name: ref.name }
  };
}
function attachmentRefOf(image) {
  return {
    attachmentId: AttachmentId(image.attachmentId),
    mediaType: image.mediaType,
    bytes: image.bytes,
    width: image.width,
    height: image.height,
    ...image.name === void 0 ? {} : { name: image.name }
  };
}
function formatDisplayOutput(value) {
  const size = formatBytes(value.bytes);
  const dimensions = value.image === void 0 ? "" : `, ${value.image.width}x${value.image.height} px`;
  const facts = [value.mediaType, size].filter((part) => part.length > 0).join(", ");
  const note = value.inContext ? "The image is attached below and is also displayed in the web UI." : "It is displayed in the web UI for the user. You cannot see its content \u2014 do not describe or summarize it unless the user tells you what it shows.";
  const machine = [
    `<media>${value.mediaType}</media>`,
    `<bytes>${value.bytes}</bytes>`,
    ...value.assetUrl === void 0 ? [] : [`<asset>${value.assetUrl}</asset>`]
  ].join("\n");
  return `<path>${value.path}</path>
<type>${value.kind}</type>
${machine}
<content>
${facts}${dimensions}
${note}
</content>`;
}
function displayContent(value) {
  const blocks = [{ type: "text", text: formatDisplayOutput(value) }];
  if (value.inContext && value.image !== void 0) {
    blocks.push({ type: "image", attachment: attachmentRefOf(value.image) });
  }
  return blocks;
}
async function commitImage(ctx, exec, target, mediaType) {
  const attachments = ctx.get("attachments");
  if (attachments === void 0) throw new Error("no attachment service is mounted");
  const byteCap = Math.min(attachments.imageLimits.maxImageBytes, attachments.imageLimits.maxMessageImageBytes);
  const data = await ctx.fs.readBytes(target, exec.signal, byteCap);
  try {
    return await attachments.saveImage({ data, mediaType, name: basename3(target.displayPath) });
  } catch (error) {
    if (!(error instanceof AttachmentError) || error.code !== "IMAGE_TYPE_MISMATCH") throw error;
    const extension = extname2(target.displayPath).toLowerCase();
    throw new Error(
      `cannot display "${target.displayPath}": the ${extension} extension declares ${mediaType}, but the bytes use a different image format; rename the file to match its actual format, or convert it`,
      { cause: error }
    );
  }
}
function applyDisplayTool(ctx, options) {
  return ctx.tools.register(defineTool({
    name: DISPLAY_TOOL,
    description: "Display a file to the user in the web UI: images (PNG/JPEG/WebP/GIF/SVG/AVIF/BMP), video (MP4/WebM/MOV/OGV), audio (MP3/WAV/FLAC/OGG/M4A/Opus), PDF, and HTML all render inline with a real player. Use this whenever the user should SEE or HEAR a file \u2014 the read tool decodes UTF-8 text and cannot show any of them. On a model route that accepts image input a PNG/JPEG/WebP/GIF also enters your own context; everything else is shown to the user only.",
    parameters: {
      file_path: { type: "string", required: true, description: "Path to the file, resolved by the filesystem backend." }
    },
    output: {
      schema: {
        type: "object",
        additionalProperties: false,
        properties: {
          path: { type: "string", required: true },
          kind: { type: "string", enum: ["image", "video", "audio", "pdf", "document", "html", "file"], required: true },
          mediaType: { type: "string", required: true },
          bytes: { type: "integer", required: true },
          inContext: { type: "boolean", required: true },
          assetUrl: { type: "string" },
          unavailable: { type: "string" },
          image: {
            type: "object",
            additionalProperties: false,
            properties: {
              attachmentId: { type: "string", required: true },
              mediaType: { type: "string", enum: ["image/png", "image/jpeg", "image/webp", "image/gif"], required: true },
              bytes: { type: "integer", required: true },
              width: { type: "integer", required: true },
              height: { type: "integer", required: true },
              name: { type: "string" }
            }
          }
        }
      },
      render: (_args, value) => displayContent(value),
      // The canonical value never reaches the wire, and most media carry no
      // content block at all — so without this projection a reopened session
      // would have nothing left to rebuild the card from.
      presentationMeta: (_args, value) => ({ ...value, ...value.image === void 0 ? {} : { image: { ...value.image } } })
    },
    // Content-addressed attachment writes are idempotent and the asset route is
    // a pure read, so concurrent displays of one file cannot conflict.
    isConcurrencySafe: () => true,
    async execute(args, exec) {
      if (args.file_path.trim().length === 0) throw new Error("file_path must be a non-empty string");
      let conversionError;
      const spec = classifyPath(args.file_path);
      const { target, info } = await resolveDisplayTarget(ctx, exec, args.file_path);
      let assetUrl;
      let servedType = spec.mediaType;
      const secret = options.secret();
      if (secret !== void 0) {
        try {
          const processPath = ctx.fs.processPath(target);
          if (spec.kind === "document") {
            assetUrl = assetUrlFor(secret, await convertDocument(processPath, options.cacheDir, exec.signal));
            servedType = CONVERTED_MEDIA_TYPE;
          } else {
            assetUrl = assetUrlFor(secret, processPath);
          }
        } catch (error) {
          if (spec.kind !== "document") throw error;
          conversionError = error instanceof Error ? error.message : String(error);
          assetUrl = void 0;
        }
      }
      const imageMediaType = modelImageMediaTypeForPath(target.displayPath);
      const attachments = ctx.get("attachments");
      const admissible = imageMediaType !== void 0 && attachments !== void 0 && attachments.imageLimits.mediaTypes.includes(imageMediaType);
      const inContext = admissible && options.feedModel() && await routeAcceptsImages(ctx, exec);
      const image = admissible && (inContext || assetUrl === void 0) ? modelImageOf(await commitImage(ctx, exec, target, imageMediaType)) : void 0;
      ctx.emit("fs/observed", target, { kind: "present", version: info.version }, exec);
      const value = {
        path: target.displayPath,
        kind: spec.kind,
        mediaType: servedType,
        bytes: info.size ?? 0,
        inContext: inContext && image !== void 0,
        ...assetUrl === void 0 ? {} : { assetUrl },
        ...image === void 0 ? {} : { image },
        ...conversionError === void 0 ? {} : { unavailable: conversionError }
      };
      if (exec.parent !== void 0 && value.inContext) {
        exec.deferContext(createUserMessage({
          content: displayContent(value),
          source: { kind: "plugin", plugin: PLUGIN }
        }));
      }
      return value;
    },
    // Pure display: a generic card in the read family with a follow-along
    // location, matching how the shipped read tools present.
    presentCall(args) {
      return {
        card: "generic",
        title: `Display ${args.file_path}`,
        kind: "read",
        locations: [{ path: args.file_path }]
      };
    }
  }));
}

// src/read-redirect.ts
function mediaReadValue(filePath) {
  const kind = classifyPath(filePath).kind;
  return {
    path: filePath,
    offset: 1,
    lines: [{
      number: 1,
      text: `[${kind}] This file is binary media, not UTF-8 text \u2014 there is nothing here to read. Call ${DISPLAY_TOOL} with file_path "${filePath}" to show it to the user.`
    }],
    totalLines: 1
  };
}
function readPathOf(args) {
  if (typeof args !== "object" || args === null || Array.isArray(args)) return void 0;
  const { file_path: filePath } = args;
  return typeof filePath === "string" && filePath.trim().length > 0 ? filePath : void 0;
}
function isMisdirectedRead(name2, args) {
  if (name2 !== READ_TOOL) return false;
  const filePath = readPathOf(args);
  return filePath !== void 0 && isOpaqueMediaPath(filePath);
}
function applyReadRedirect(ctx, enabled) {
  ctx.systemPrompt.section({
    name: "tool:display-file",
    // Just after the shipped `tool:read` guidance (order 100), so the two read
    // as one instruction about which tool opens which kind of file.
    order: 101,
    text: `Use the ${DISPLAY_TOOL} tool to show the user an image, video, audio file, PDF, Office document (Word/Excel/PowerPoint), or HTML page \u2014 it renders inline in the web UI with a real player or viewer. The ${READ_TOOL} tool decodes UTF-8 text and cannot open any of them; calling it on one returns a pointer back to ${DISPLAY_TOOL} and nothing else. Prefer ${DISPLAY_TOOL} whenever the user asks to see, view, open, play, watch, or listen to a file.`
  });
  ctx.on("tools/execute", async (exec, next) => {
    if (!enabled() || !isMisdirectedRead(exec.name, exec.arguments)) return await next();
    const filePath = readPathOf(exec.arguments);
    if (filePath === void 0) return await next();
    return { isError: false, value: mediaReadValue(filePath), content: [] };
  });
}

// src/supersede-read-image.ts
function hideFrom(agent) {
  try {
    agent.ctx.tools.restrict({ deny: [READ_IMAGE_TOOL] });
    return true;
  } catch {
    return false;
  }
}
function applySupersedeReadImage(ctx, enabled) {
  const pending = /* @__PURE__ */ new WeakSet();
  const tracked = /* @__PURE__ */ new Set();
  const apply2 = (agent) => {
    if (!enabled()) return;
    if (hideFrom(agent)) {
      pending.delete(agent);
      return;
    }
    if (pending.has(agent)) return;
    pending.add(agent);
    tracked.add(new WeakRef(agent));
  };
  ctx.on("agent/created", ({ agent }) => {
    try {
      apply2(agent);
    } catch {
    }
  });
  ctx.on("tools/change", () => {
    if (!enabled()) return;
    for (const ref of tracked) {
      const agent = ref.deref();
      if (agent === void 0) {
        tracked.delete(ref);
        continue;
      }
      if (!pending.has(agent)) {
        tracked.delete(ref);
        continue;
      }
      try {
        if (hideFrom(agent)) {
          pending.delete(agent);
          tracked.delete(ref);
        }
      } catch {
      }
    }
  });
}

// src/index.ts
var VIEWER_NAMESPACE = VIEWER_SETTINGS_NAMESPACE;
var name = "@crosery/dsh-viewer";
var SECRET_FILE = ".dsh-viewer-asset-key";
var CACHE_DIR = ".dsh-viewer-cache";
var inject = ["tools", "fs", "systemPrompt"];
var Config = ViewerSettingsSchema;
function mountSettingsSection(ctx, config, hooks) {
  ctx.inject(["settings"], (scoped) => {
    const settings = scoped.settings;
    if (typeof settings.installSection === "function") {
      settings.installSection(ctx, VIEWER_NAMESPACE, ViewerSettingsSchema, config, hooks);
      return;
    }
    if (typeof settings.register !== "function") return;
    const scope = settings.register(VIEWER_NAMESPACE, ViewerSettingsSchema, { base: config });
    hooks.setSource(() => scope.get());
    scoped.effect(() => () => {
      hooks.setSource(() => config);
      hooks.onChange();
    }, "@crosery/dsh-viewer: settings detach");
    hooks.onChange();
    scope.watch(() => {
      hooks.onChange();
    });
  });
}
function apply(ctx, config) {
  let source = () => config;
  let secret;
  const secretPath = dshHomePath(SECRET_FILE);
  void loadAssetSecret(secretPath).then(
    (loaded) => {
      secret = loaded;
    },
    (error) => {
      console.warn(`[dsh-viewer] could not open the asset key at ${secretPath}; media cards will stay unavailable`, error);
    }
  );
  let serving = false;
  ctx.inject(["webServer"], (scoped) => {
    scoped.effect(() => {
      serving = true;
      const dispose = scoped.webServer.register({
        kind: "exact",
        path: ASSET_ROUTE,
        handler: assetHandler(() => secret)
      });
      return () => {
        serving = false;
        dispose();
      };
    }, "@crosery/dsh-viewer: asset route");
  });
  let disposeTool;
  const reconcile = () => {
    const wanted = source().tool;
    if (wanted && disposeTool === void 0) {
      disposeTool = applyDisplayTool(ctx, {
        feedModel: () => source().feedModel,
        secret: () => serving ? secret : void 0,
        cacheDir: dshHomePath(CACHE_DIR)
      });
    } else if (!wanted && disposeTool !== void 0) {
      disposeTool();
      disposeTool = void 0;
    }
  };
  ctx.effect(() => () => {
    disposeTool?.();
    disposeTool = void 0;
  }, "@crosery/dsh-viewer: display tool");
  mountSettingsSection(ctx, config, {
    setSource: (current) => {
      source = current;
    },
    onChange: reconcile
  });
  reconcile();
  applyReadRedirect(ctx, () => source().tool && source().redirectRead);
  applySupersedeReadImage(ctx, () => source().tool && source().supersedeReadImage);
}
export {
  ASSET_ROUTE,
  Config,
  DISPLAY_TOOL,
  VIEWER_NAMESPACE,
  VIEWER_SETTINGS_NAMESPACE,
  ViewerSettingsSchema,
  apply,
  applySupersedeReadImage,
  artifactName,
  assetUrlFor,
  classifyPath,
  convertDocument,
  extensionOf,
  formatBytes,
  guardHeaders,
  inject,
  isMisdirectedRead,
  isOpaqueMediaPath,
  mediaReadValue,
  modelImageMediaTypeForPath,
  mountSettingsSection,
  name,
  parseRange,
  readPathOf,
  resolveConverter,
  verifyAssetRequest
};
