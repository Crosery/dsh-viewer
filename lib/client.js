window.__ModuleLoader__.load({ id: "@crosery/dsh-viewer", factory: (require) => {
var module = { exports: {} }; var exports = module.exports;
"use strict";
var __defProp = Object.defineProperty;
var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
var __getOwnPropNames = Object.getOwnPropertyNames;
var __hasOwnProp = Object.prototype.hasOwnProperty;
var __export = (target, all) => {
  for (var name2 in all)
    __defProp(target, name2, { get: all[name2], enumerable: true });
};
var __copyProps = (to, from, except, desc) => {
  if (from && typeof from === "object" || typeof from === "function") {
    for (let key of __getOwnPropNames(from))
      if (!__hasOwnProp.call(to, key) && key !== except)
        __defProp(to, key, { get: () => from[key], enumerable: !(desc = __getOwnPropDesc(from, key)) || desc.enumerable });
  }
  return to;
};
var __toCommonJS = (mod) => __copyProps(__defProp({}, "__esModule", { value: true }), mod);

// src/client/index.ts
var index_exports = {};
__export(index_exports, {
  VIEWER_NS: () => VIEWER_NS,
  apply: () => apply,
  argumentPathOf: () => argumentPathOf,
  cardModel: () => cardModel,
  contentImageOf: () => contentImageOf,
  inject: () => inject,
  name: () => name
});
module.exports = __toCommonJS(index_exports);

// src/contract.ts
var DISPLAY_TOOL = "display_file";
var READ_IMAGE_TOOL = "read_image";
var ASSET_ROUTE = "/crosery/dsh-viewer/asset";
var MODEL_IMAGE_MEDIA_TYPES = [
  "image/png",
  "image/jpeg",
  "image/webp",
  "image/gif"
];
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
function modelImageFrom(value) {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return void 0;
  const { attachmentId, mediaType, bytes, width, height, name: name2 } = value;
  if (typeof attachmentId !== "string" || attachmentId.length === 0) return void 0;
  if (typeof mediaType !== "string" || !MODEL_IMAGE_MEDIA_TYPES.includes(mediaType)) return void 0;
  if (!isPositiveInteger(bytes) || !isPositiveInteger(width) || !isPositiveInteger(height)) return void 0;
  if (name2 !== void 0 && typeof name2 !== "string") return void 0;
  return {
    attachmentId,
    mediaType,
    bytes,
    width,
    height,
    ...name2 === void 0 ? {} : { name: name2 }
  };
}
var VIEWER_KINDS = ["image", "video", "audio", "pdf", "document", "html", "file"];
function displayValueFrom(meta) {
  if (typeof meta !== "object" || meta === null || Array.isArray(meta)) return void 0;
  const { path, kind, mediaType, bytes, assetUrl, image, inContext, unavailable } = meta;
  if (typeof path !== "string" || path.length === 0) return void 0;
  if (typeof kind !== "string" || !VIEWER_KINDS.includes(kind)) return void 0;
  if (typeof mediaType !== "string" || mediaType.length === 0) return void 0;
  if (typeof bytes !== "number" || !Number.isInteger(bytes) || bytes < 0) return void 0;
  if (typeof inContext !== "boolean") return void 0;
  if (assetUrl !== void 0 && (typeof assetUrl !== "string" || !assetUrl.startsWith(`${ASSET_ROUTE}?`))) return void 0;
  if (unavailable !== void 0 && typeof unavailable !== "string") return void 0;
  const narrowedImage = image === void 0 ? void 0 : modelImageFrom(image);
  if (image !== void 0 && narrowedImage === void 0) return void 0;
  return {
    path,
    kind,
    mediaType,
    bytes,
    inContext,
    ...assetUrl === void 0 ? {} : { assetUrl },
    ...narrowedImage === void 0 ? {} : { image: narrowedImage },
    ...unavailable === void 0 ? {} : { unavailable }
  };
}
function isPositiveInteger(value) {
  return typeof value === "number" && Number.isInteger(value) && value > 0;
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

// src/client/ViewerCard.tsx
var import_react = require("react");

// src/client/card-model.ts
function isSettled(block) {
  return "kind" in block && block.kind === "tool-result";
}
function argumentPathOf(block) {
  const raw = isSettled(block) ? block.call?.argsRaw : block.argsRaw;
  if (typeof raw !== "string" || raw.length === 0) return void 0;
  try {
    const parsed = JSON.parse(raw);
    if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) return void 0;
    const { file_path: filePath } = parsed;
    return typeof filePath === "string" && filePath.length > 0 ? filePath : void 0;
  } catch {
    return void 0;
  }
}
function textOf(content) {
  const parts = [];
  for (const block of content) {
    if (typeof block !== "object" || block === null) continue;
    const { type, text } = block;
    if (type === "text" && typeof text === "string") parts.push(text);
  }
  return parts.join("\n").trim();
}
function contentImageOf(content) {
  for (const block of content) {
    if (typeof block !== "object" || block === null) continue;
    const { type, attachment } = block;
    if (type !== "image") continue;
    const image = modelImageFrom(attachment);
    if (image !== void 0) return image;
  }
  return void 0;
}
function element(text, tag) {
  const match = new RegExp(`<${tag}>([\\s\\S]*?)</${tag}>`).exec(text);
  const value = match?.[1]?.trim();
  return value !== void 0 && value.length > 0 ? value : void 0;
}
function envelopePathOf(content) {
  return element(textOf(content), "path");
}
function envelopeValueOf(content, inContext) {
  const text = textOf(content);
  const path = element(text, "path");
  const kind = element(text, "type");
  const mediaType = element(text, "media");
  const bytes = Number(element(text, "bytes") ?? Number.NaN);
  if (path === void 0 || kind === void 0 || mediaType === void 0 || !Number.isInteger(bytes)) return void 0;
  const assetUrl = element(text, "asset");
  return displayValueFrom({
    path,
    kind,
    mediaType,
    bytes,
    inContext,
    ...assetUrl === void 0 ? {} : { assetUrl }
  });
}
function cardModel(block, toolName) {
  const path = argumentPathOf(block);
  if (!isSettled(block)) return { phase: "running", path };
  if (block.isError) {
    const message = textOf(block.content);
    return { phase: "failed", path, message: message.length > 0 ? message : block.error?.code ?? "failed" };
  }
  const image = contentImageOf(block.content);
  if (toolName === DISPLAY_TOOL) {
    const value = displayValueFrom(block.meta);
    if (value !== void 0) return { phase: "ready", value };
    const recovered = envelopeValueOf(block.content, image !== void 0);
    if (recovered !== void 0) {
      return { phase: "ready", value: { ...recovered, ...image === void 0 ? {} : { image } } };
    }
  }
  if (image !== void 0) {
    const displayPath = path ?? envelopePathOf(block.content) ?? image.name ?? "";
    return {
      phase: "ready",
      value: {
        path: displayPath,
        kind: "image",
        mediaType: image.mediaType,
        bytes: image.bytes,
        // No asset URL: this result was not minted by this plugin, so the bytes
        // come over the session attachment channel instead.
        image,
        inContext: true
      }
    };
  }
  return {
    phase: "bare",
    path,
    message: path === void 0 ? "" : classifyPath(path).mediaType
  };
}

// src/client/ViewerCard.tsx
var import_jsx_runtime = require("react/jsx-runtime");
var CSS = "dshview";
var KIND_TITLE = {
  image: "title.image",
  video: "title.video",
  audio: "title.audio",
  pdf: "title.pdf",
  document: "title.document",
  html: "title.html",
  file: "title.file"
};
function PathLabel({ path }) {
  return /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("span", { className: `${CSS}-path`, title: path, children: [
    "\u2068",
    path,
    "\u2069"
  ] });
}
function KindIcon({ kind }) {
  const paths = {
    image: "M3 4.5h10v7H3zM3 10l2.5-2.5 2 2L10.5 6l2.5 3v2.5H3z",
    video: "M2.5 4h7.5v8H2.5zM10.5 6.8l3-1.8v6l-3-1.8z",
    audio: "M6 3.5v6.2a2 2 0 1 0 1.2 1.8V6h4V3.5z",
    pdf: "M4 2h5l3 3v9H4zM9 2v3h3",
    document: "M4 2h5l3 3v9H4zM9 2v3h3M5.5 8h5M5.5 10.5h5",
    html: "M2.5 8 6 4.6l.9.9L4.3 8l2.6 2.5-.9.9zM13.5 8 10 11.4l-.9-.9L11.7 8 9.1 5.5l.9-.9z",
    file: "M4 2h5l3 3v9H4zM9 2v3h3"
  };
  return /* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", { className: `${CSS}-icon`, "aria-hidden": "true", children: /* @__PURE__ */ (0, import_jsx_runtime.jsx)("svg", { width: "14", height: "14", viewBox: "0 0 16 16", fill: "currentColor", children: /* @__PURE__ */ (0, import_jsx_runtime.jsx)("path", { d: paths[kind] }) }) });
}
function useMediaSource(value, load) {
  const [resolved, setResolved] = (0, import_react.useState)(void 0);
  const [failed, setFailed] = (0, import_react.useState)(false);
  const [attempt, setAttempt] = (0, import_react.useState)(0);
  const retry = (0, import_react.useCallback)(() => {
    setAttempt((a) => a + 1);
  }, []);
  const attachmentId = value.image?.attachmentId;
  const direct = value.assetUrl;
  (0, import_react.useEffect)(() => {
    if (direct !== void 0 || attachmentId === void 0) {
      setResolved(void 0);
      setFailed(false);
      return;
    }
    let live = true;
    setResolved(void 0);
    setFailed(false);
    void load(attachmentId).then(
      (url) => {
        if (live) setResolved(url);
      },
      () => {
        if (live) setFailed(true);
      }
    );
    return () => {
      live = false;
    };
  }, [direct, attachmentId, load, attempt]);
  if (direct !== void 0) return { src: direct, failed: false, pending: false, retry };
  if (attachmentId === void 0) return { src: void 0, failed: false, pending: false, retry };
  return { src: resolved, failed, pending: resolved === void 0 && !failed, retry };
}
function Lightbox({ src, alt, onClose }) {
  (0, import_react.useEffect)(() => {
    const onKey = (event) => {
      if (event.key === "Escape") onClose();
    };
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("keydown", onKey);
    };
  }, [onClose]);
  return (
    // eslint-disable-next-line -- the overlay is a click target by design; Escape covers the keyboard path.
    /* @__PURE__ */ (0, import_jsx_runtime.jsx)("div", { className: `${CSS}-lightbox`, role: "presentation", onClick: onClose, children: /* @__PURE__ */ (0, import_jsx_runtime.jsx)("img", { className: `${CSS}-lightboxImage`, src, alt }) })
  );
}
function Viewer({ value, injected, t }) {
  const { src, failed, pending, retry } = useMediaSource(value, injected.loadAttachment);
  const [zoomed, setZoomed] = (0, import_react.useState)(false);
  const closeZoom = (0, import_react.useCallback)(() => {
    setZoomed(false);
  }, []);
  const label = value.image?.name ?? value.path;
  if (failed) {
    return /* @__PURE__ */ (0, import_jsx_runtime.jsx)("button", { type: "button", className: `${CSS}-retry`, onClick: retry, children: t("state.loadFailed") });
  }
  if (pending) return /* @__PURE__ */ (0, import_jsx_runtime.jsx)("div", { className: `${CSS}-note`, children: t("state.loading") });
  if (src === void 0) {
    if (value.unavailable !== void 0) return /* @__PURE__ */ (0, import_jsx_runtime.jsx)("div", { className: `${CSS}-note`, children: value.unavailable });
    return /* @__PURE__ */ (0, import_jsx_runtime.jsx)("div", { className: `${CSS}-note`, children: t(value.kind === "image" ? "state.unsupported" : "state.unavailable") });
  }
  switch (value.kind) {
    case "image":
      return /* @__PURE__ */ (0, import_jsx_runtime.jsxs)(import_jsx_runtime.Fragment, { children: [
        /* @__PURE__ */ (0, import_jsx_runtime.jsx)("button", { type: "button", className: `${CSS}-imageButton`, title: t("action.open"), onClick: () => {
          setZoomed(true);
        }, children: /* @__PURE__ */ (0, import_jsx_runtime.jsx)("img", { className: `${CSS}-image`, src, alt: label, loading: "lazy" }) }),
        zoomed && /* @__PURE__ */ (0, import_jsx_runtime.jsx)(Lightbox, { src, alt: label, onClose: closeZoom })
      ] });
    case "video":
      return /* @__PURE__ */ (0, import_jsx_runtime.jsx)("video", { className: `${CSS}-video`, src, controls: true, preload: "metadata", children: t("media.noVideo") });
    case "audio":
      return /* @__PURE__ */ (0, import_jsx_runtime.jsx)("audio", { className: `${CSS}-audio`, src, controls: true, preload: "metadata", children: t("media.noAudio") });
    case "pdf":
    case "document":
    case "html":
      return /* @__PURE__ */ (0, import_jsx_runtime.jsxs)(import_jsx_runtime.Fragment, { children: [
        /* @__PURE__ */ (0, import_jsx_runtime.jsx)(
          "iframe",
          {
            className: `${CSS}-frame`,
            src,
            title: label,
            ...value.kind === "html" ? { sandbox: "allow-scripts allow-forms allow-popups" } : {}
          }
        ),
        /* @__PURE__ */ (0, import_jsx_runtime.jsx)("a", { className: `${CSS}-link`, href: src, target: "_blank", rel: "noreferrer", children: t("action.openNew") })
      ] });
    default:
      return /* @__PURE__ */ (0, import_jsx_runtime.jsx)("a", { className: `${CSS}-link`, href: src, target: "_blank", rel: "noreferrer", children: t("action.openNew") });
  }
}
function Head({ kind, label, path, detail, badge, onToggle, expanded, t }) {
  return /* @__PURE__ */ (0, import_jsx_runtime.jsxs)(
    "button",
    {
      type: "button",
      className: `${CSS}-head`,
      onClick: onToggle,
      "aria-expanded": onToggle === void 0 ? void 0 : expanded,
      title: onToggle === void 0 ? void 0 : t(expanded ? "action.collapse" : "action.expand"),
      children: [
        /* @__PURE__ */ (0, import_jsx_runtime.jsx)(KindIcon, { kind }),
        /* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", { className: `${CSS}-kind`, children: t(label) }),
        path.length > 0 && /* @__PURE__ */ (0, import_jsx_runtime.jsx)(PathLabel, { path }),
        detail.length > 0 && /* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", { className: `${CSS}-meta`, children: detail }),
        badge !== void 0 && /* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", { className: `${CSS}-badge`, children: badge })
      ]
    }
  );
}
function detailOf(value) {
  const size = formatBytes(value.bytes);
  const dimensions = value.image === void 0 ? "" : `${value.image.width}\xD7${value.image.height}`;
  return [dimensions, size].filter((part) => part.length > 0).join(" \xB7 ");
}
function ViewerCard({ toolName, block, t, ...injected }) {
  const state = cardModel(block, toolName);
  const [open, setOpen] = (0, import_react.useState)(true);
  const toggle = (0, import_react.useCallback)(() => {
    setOpen((previous) => !previous);
  }, []);
  if (state.phase === "running") {
    return /* @__PURE__ */ (0, import_jsx_runtime.jsx)("div", { className: `${CSS}-card`, children: /* @__PURE__ */ (0, import_jsx_runtime.jsx)(Head, { kind: classifyKind(state.path), label: headLabel(toolName, classifyKind(state.path)), path: state.path ?? "", detail: t("state.running"), expanded: false, t }) });
  }
  if (state.phase === "failed") {
    return /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", { className: `${CSS}-card`, children: [
      /* @__PURE__ */ (0, import_jsx_runtime.jsx)(Head, { kind: classifyKind(state.path), label: headLabel(toolName, classifyKind(state.path)), path: state.path ?? "", detail: "", expanded: open, onToggle: toggle, t }),
      open && /* @__PURE__ */ (0, import_jsx_runtime.jsx)("div", { className: `${CSS}-body`, children: /* @__PURE__ */ (0, import_jsx_runtime.jsx)("div", { className: `${CSS}-note ${CSS}-error`, children: state.message }) })
    ] });
  }
  if (state.phase === "bare") {
    return /* @__PURE__ */ (0, import_jsx_runtime.jsx)("div", { className: `${CSS}-card`, children: /* @__PURE__ */ (0, import_jsx_runtime.jsx)(Head, { kind: classifyKind(state.path), label: headLabel(toolName, classifyKind(state.path)), path: state.path ?? "", detail: state.message, expanded: false, t }) });
  }
  const { value } = state;
  return /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", { className: `${CSS}-card`, children: [
    /* @__PURE__ */ (0, import_jsx_runtime.jsx)(
      Head,
      {
        kind: value.kind,
        label: headLabel(toolName, value.kind),
        path: value.path,
        detail: detailOf(value),
        badge: t(value.inContext ? "badge.inContext" : "badge.screenOnly"),
        expanded: open,
        onToggle: toggle,
        t
      }
    ),
    open && /* @__PURE__ */ (0, import_jsx_runtime.jsx)("div", { className: `${CSS}-body`, children: /* @__PURE__ */ (0, import_jsx_runtime.jsx)(Viewer, { value, injected, t }) })
  ] });
}
function headLabel(toolName, kind) {
  return toolName === READ_IMAGE_TOOL ? "title.readImage" : KIND_TITLE[kind];
}
function classifyKind(path) {
  return path === void 0 ? "file" : classifyPath(path).kind;
}

// src/client/locales.ts
var zh = {
  "title.image": "\u56FE\u7247",
  "title.video": "\u89C6\u9891",
  "title.audio": "\u97F3\u9891",
  "title.pdf": "PDF",
  "title.document": "\u6587\u6863",
  "title.html": "\u7F51\u9875",
  "title.file": "\u6587\u4EF6",
  "title.readImage": "\u8BFB\u5165\u56FE\u7247",
  "state.running": "\u8BFB\u53D6\u4E2D",
  "state.loading": "\u52A0\u8F7D\u4E2D",
  "state.loadFailed": "\u52A0\u8F7D\u5931\u8D25\uFF0C\u70B9\u51FB\u91CD\u8BD5",
  "state.retry": "\u91CD\u8BD5",
  "state.unavailable": "\u6B64\u6587\u4EF6\u7CFB\u7EDF\u540E\u7AEF\u4E0D\u63D0\u4F9B\u53EF\u9884\u89C8\u7684\u672C\u5730\u8DEF\u5F84",
  "state.unsupported": "\u6CA1\u6709\u53EF\u7528\u7684\u9884\u89C8\u5185\u5BB9",
  "badge.inContext": "\u5DF2\u8FDB\u5165\u6A21\u578B\u4E0A\u4E0B\u6587",
  "badge.screenOnly": "\u4EC5\u5728\u9875\u9762\u663E\u793A",
  "action.open": "\u67E5\u770B\u539F\u56FE",
  "action.openNew": "\u5728\u65B0\u6807\u7B7E\u6253\u5F00",
  "action.close": "\u5173\u95ED",
  "action.expand": "\u5C55\u5F00",
  "action.collapse": "\u6536\u8D77",
  "media.noVideo": "\u5F53\u524D\u6D4F\u89C8\u5668\u65E0\u6CD5\u64AD\u653E\u8BE5\u89C6\u9891\u683C\u5F0F",
  "media.noAudio": "\u5F53\u524D\u6D4F\u89C8\u5668\u65E0\u6CD5\u64AD\u653E\u8BE5\u97F3\u9891\u683C\u5F0F"
};
var en = {
  "title.image": "Image",
  "title.video": "Video",
  "title.audio": "Audio",
  "title.pdf": "PDF",
  "title.document": "Document",
  "title.html": "Page",
  "title.file": "File",
  "title.readImage": "Image read",
  "state.running": "Reading",
  "state.loading": "Loading",
  "state.loadFailed": "Failed to load \u2014 click to retry",
  "state.retry": "Retry",
  "state.unavailable": "This filesystem backend exposes no previewable local path",
  "state.unsupported": "Nothing to preview",
  "badge.inContext": "in model context",
  "badge.screenOnly": "shown to you only",
  "action.open": "View full size",
  "action.openNew": "Open in a new tab",
  "action.close": "Close",
  "action.expand": "Expand",
  "action.collapse": "Collapse",
  "media.noVideo": "This browser cannot play that video format",
  "media.noAudio": "This browser cannot play that audio format"
};

// src/client/styles.ts
var PLUGIN_ID = "@crosery/dsh-viewer";
var SHEET = `
.dshview-card { display: flex; flex-direction: column; gap: 6px; margin: 2px 0; min-width: 0; }

.dshview-head {
  display: flex; align-items: center; gap: 6px; min-width: 0;
  padding: 2px 0; border: 0; background: transparent; text-align: left;
  color: var(--dsw-alias-label-secondary); font: inherit; font-size: 12px; line-height: 20px;
  cursor: pointer;
}
.dshview-head:hover { color: var(--dsw-alias-label-primary); }
.dshview-icon { flex: none; display: inline-flex; color: var(--dsw-alias-label-secondary); }
.dshview-kind { flex: none; color: var(--dsw-alias-label-primary); font-weight: 500; }
.dshview-path {
  min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
  direction: rtl; text-align: left;
}
.dshview-meta { flex: none; color: var(--dsw-alias-label-tertiary, var(--dsw-alias-label-secondary)); }
.dshview-badge {
  flex: none; padding: 0 6px; border-radius: 999px; font-size: 11px; line-height: 16px;
  background: var(--dsw-alias-bg-layer-2); color: var(--dsw-alias-label-secondary);
}

.dshview-body {
  display: flex; flex-direction: column; gap: 6px;
  padding: 8px; border-radius: 10px;
  border: 1px solid var(--dsw-alias-border-l1);
  background: var(--dsw-alias-bg-layer-1);
  min-width: 0; overflow: hidden;
}

.dshview-imageButton {
  display: block; padding: 0; border: 0; background: transparent; cursor: zoom-in;
  line-height: 0; max-width: 100%;
}
.dshview-image {
  display: block; max-width: 100%; max-height: 420px; width: auto; height: auto;
  border-radius: 6px; object-fit: contain;
  /* A transparent PNG on a themed panel is unreadable without a backdrop; the
     checkerboard is the conventional one and reads in both palettes. */
  background-color: var(--dsw-alias-bg-layer-2);
  background-image:
    linear-gradient(45deg, rgb(128 128 128 / .16) 25%, transparent 25%),
    linear-gradient(-45deg, rgb(128 128 128 / .16) 25%, transparent 25%),
    linear-gradient(45deg, transparent 75%, rgb(128 128 128 / .16) 75%),
    linear-gradient(-45deg, transparent 75%, rgb(128 128 128 / .16) 75%);
  background-size: 16px 16px;
  background-position: 0 0, 0 8px, 8px -8px, -8px 0;
}
.dshview-video { display: block; max-width: 100%; max-height: 420px; border-radius: 6px; background: #000; }
.dshview-audio { display: block; width: 100%; }
.dshview-frame {
  display: block; width: 100%; height: 460px; border: 0; border-radius: 6px;
  background: var(--dsw-alias-bg-layer-2);
}

.dshview-note { font-size: 12px; line-height: 18px; color: var(--dsw-alias-label-secondary); }
.dshview-error { color: var(--dsw-alias-state-error-primary); }
.dshview-retry {
  align-self: flex-start; padding: 4px 10px; cursor: pointer; font: inherit; font-size: 12px;
  border: 1px solid var(--dsw-alias-border-l1); border-radius: 8px;
  background: transparent; color: var(--dsw-alias-state-error-primary);
}
.dshview-link {
  align-self: flex-start; font-size: 12px; color: var(--dsw-alias-brand-primary);
  text-decoration: none;
}
.dshview-link:hover { text-decoration: underline; }

.dshview-lightbox {
  position: fixed; inset: 0; z-index: 2000; display: flex;
  align-items: center; justify-content: center;
  padding: 32px; background: rgb(0 0 0 / .72); cursor: zoom-out;
}
.dshview-lightboxImage {
  max-width: 100%; max-height: 100%; object-fit: contain; border-radius: 4px;
}
`;
function installViewerStyles(ctx) {
  if (typeof document === "undefined") return;
  ctx.effect(() => {
    const tag = document.createElement("style");
    tag.dataset.plugin = PLUGIN_ID;
    tag.dataset.pluginCss = `${PLUGIN_ID}/viewer-card.css`;
    tag.textContent = SHEET;
    document.head.appendChild(tag);
    return () => {
      tag.remove();
    };
  }, "@crosery/dsh-viewer: card stylesheet");
}

// src/client/index.ts
var VIEWER_NS = "tool.viewer";
var AttachmentUrls = class {
  /** @param ctx - client context used to reach the sessions service. */
  constructor(ctx) {
    this.ctx = ctx;
  }
  ctx;
  pending = /* @__PURE__ */ new Map();
  created = /* @__PURE__ */ new Set();
  disposed = false;
  /**
   * Resolve one attachment to a URL this page can load.
   * @param sessionId - the session authorizing the read.
   * @param attachmentId - the opaque durable id.
   * @returns a URL valid until this plugin unloads.
   */
  resolve(sessionId, attachmentId) {
    if (this.disposed) return Promise.reject(new Error("dsh-viewer: the plugin was unloaded"));
    const key = `${sessionId}:${attachmentId}`;
    const cached = this.pending.get(key);
    if (cached !== void 0) return cached;
    const sessions = this.ctx.get("sessions");
    const session = sessions?.binding(sessionId)?.session;
    if (session === void 0) return Promise.reject(new Error(`dsh-viewer: unknown session "${sessionId}"`));
    const request = session.readAttachment(attachmentId).then((result) => {
      if (!result.ok) throw new Error(`${result.error.code}: ${result.error.message}`);
      if (this.disposed) throw new Error("dsh-viewer: the plugin unloaded before the image arrived");
      const { data, attachment } = result.value;
      if (typeof URL.createObjectURL !== "function") {
        return `data:${attachment.mediaType};base64,${base64Of(data)}`;
      }
      const bytes = Uint8Array.from(data);
      const url = URL.createObjectURL(new Blob([bytes.buffer], { type: attachment.mediaType }));
      this.created.add(url);
      return url;
    }).catch((error) => {
      this.pending.delete(key);
      throw error;
    });
    this.pending.set(key, request);
    return request;
  }
  /** Revoke every URL this cache minted. */
  dispose() {
    this.disposed = true;
    this.pending.clear();
    for (const url of this.created) URL.revokeObjectURL(url);
    this.created.clear();
  }
};
function base64Of(data) {
  let binary = "";
  const chunk = 32768;
  for (let offset = 0; offset < data.length; offset += chunk) {
    binary += String.fromCharCode(...data.subarray(offset, offset + chunk));
  }
  return btoa(binary);
}
var inject = ["slots", "locale", "sessions"];
var name = "@crosery/dsh-viewer";
function apply(ctx) {
  installViewerStyles(ctx);
  const urls = new AttachmentUrls(ctx);
  ctx.effect(() => () => {
    urls.dispose();
  }, "@crosery/dsh-viewer: attachment URLs");
  ctx.effect(() => ctx.locale.register(VIEWER_NS, { zh, en }), "@crosery/dsh-viewer: card dictionaries");
  const injected = (sessionId) => ({
    loadAttachment: (attachmentId) => urls.resolve(sessionId, attachmentId)
  });
  for (const key of [DISPLAY_TOOL, READ_IMAGE_TOOL]) {
    ctx.slots.inject("tool.call.toolview", () => ctx.slots.register({
      name: "tool.call.toolview",
      key,
      locale: VIEWER_NS,
      inject: injected
    }, ViewerCard));
  }
}
return module.exports; } });
