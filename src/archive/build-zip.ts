import { strToU8, zipSync, type Zippable } from "fflate";
import {
  normalizeArchiveManifest,
  type ArchiveManifest,
  type ArchiveManifestResource,
} from "./manifest";
import { canonicalArchivePath, isCanonicalArchivePath } from "./paths";

const CORE_PATHS = [
  "assets/archive.css",
  "index.html",
  "manifest.json",
] as const;
const CORE_CANONICAL = new Set(CORE_PATHS.map(canonicalArchivePath));
const FIXED_ZIP_DATE = 0x2821;
const FIXED_ZIP_TIME = 0;
const ZIP_MTIME_SEED = "2000-01-01T12:00:00.000Z";
const MAX_TEXT_BYTES = 16 * 1024 * 1024;
const MAX_ZIP_NAME_LENGTH = 180;

export type ArchiveInput = {
  indexHtml: string;
  archiveCss: string;
  manifest: ArchiveManifest;
  entries: ReadonlyMap<string, Uint8Array>;
};

const exactInput = (value: unknown): Record<string, unknown> => {
  if (
    typeof value !== "object" ||
    value === null ||
    Array.isArray(value) ||
    (Object.getPrototypeOf(value) !== Object.prototype &&
      Object.getPrototypeOf(value) !== null)
  ) {
    throw new TypeError("Invalid archive input");
  }
  let keys: PropertyKey[];
  try {
    keys = Reflect.ownKeys(value);
  } catch {
    throw new TypeError("Invalid archive input");
  }
  const expected = ["indexHtml", "archiveCss", "manifest", "entries"];
  if (
    keys.length !== expected.length ||
    keys.some((key) => typeof key !== "string" || !expected.includes(key))
  ) {
    throw new TypeError("Invalid archive input");
  }
  for (const key of expected) {
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    if (!descriptor || !("value" in descriptor)) {
      throw new TypeError("Invalid archive input");
    }
  }
  return value as Record<string, unknown>;
};

const ownValue = (value: Record<string, unknown>, key: string): unknown => {
  const descriptor = Object.getOwnPropertyDescriptor(value, key);
  if (!descriptor || !("value" in descriptor)) {
    throw new TypeError("Invalid archive input");
  }
  return descriptor.value;
};

const archiveText = (value: unknown): string => {
  if (typeof value !== "string" || strToU8(value).byteLength > MAX_TEXT_BYTES) {
    throw new TypeError("Invalid archive text");
  }
  return value;
};

const safeExternalHref = (value: string): boolean => {
  if (/%(?:0[0-9a-f]|1[0-9a-f]|7f)/iu.test(value)) return false;
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    return false;
  }
  return (
    url.protocol === "https:" &&
    url.username === "" &&
    url.password === "" &&
    url.search === "" &&
    url.hash === ""
  );
};

const safeLocalHref = (value: string): boolean => {
  let path: string;
  try {
    path = decodeURIComponent(value);
  } catch {
    return false;
  }
  return (
    isCanonicalArchivePath(path) &&
    (path.startsWith("files/") || path.startsWith("pages/")) &&
    path.split("/").map(encodeURIComponent).join("/") === value
  );
};

const validateIndexHtml = (value: unknown): string => {
  const html = archiveText(value);
  const document = new DOMParser().parseFromString(html, "text/html");
  if (
    !/^\s*<!doctype html>/iu.test(html) ||
    document.querySelector(
      "base, script, style, iframe, frame, object, embed, form, input, button, select, textarea, audio, video, source, track, canvas, svg, math, template, meta[http-equiv]",
    )
  ) {
    throw new TypeError("Invalid archive index");
  }
  const stylesheets = [...document.querySelectorAll("link")];
  if (
    stylesheets.length !== 1 ||
    stylesheets[0]!.getAttribute("rel") !== "stylesheet" ||
    stylesheets[0]!.getAttribute("href") !== "assets/archive.css"
  ) {
    throw new TypeError("Invalid archive index");
  }
  for (const element of document.querySelectorAll("*")) {
    for (const attribute of [...element.attributes]) {
      const name = attribute.name.toLowerCase();
      if (
        name.startsWith("on") ||
        name.includes(":") ||
        [
          "style",
          "src",
          "srcset",
          "poster",
          "data",
          "action",
          "formaction",
        ].includes(name)
      ) {
        throw new TypeError("Invalid archive index");
      }
    }
  }
  for (const anchor of document.querySelectorAll("a[href]")) {
    const href = anchor.getAttribute("href");
    if (href === null) throw new TypeError("Invalid archive index");
    const local = safeLocalHref(href);
    if (!local && !safeExternalHref(href)) {
      throw new TypeError("Invalid archive index");
    }
    if (!local && anchor.getAttribute("rel") !== "noopener noreferrer") {
      throw new TypeError("Invalid archive index");
    }
  }
  return html;
};

const validateArchiveCss = (value: unknown): string => {
  const css = archiveText(value);
  if (/@import|@font-face|url\s*\(|javascript:|content\s*:/iu.test(css)) {
    throw new TypeError("Invalid archive stylesheet");
  }
  return css;
};

const typedArrayPrototype = Object.getPrototypeOf(
  Uint8Array.prototype,
) as object;
// This intrinsic getter is intentionally invoked with Reflect.apply below so
// only values with real typed-array internal slots are accepted.
// eslint-disable-next-line @typescript-eslint/unbound-method
const typedArrayBufferGetter = Object.getOwnPropertyDescriptor(
  typedArrayPrototype,
  "buffer",
)?.get;

const cloneBytes = (value: unknown): Uint8Array => {
  let prototype: object | null;
  try {
    prototype = Object.getPrototypeOf(value) as object | null;
  } catch {
    throw new TypeError("Invalid archive bytes");
  }
  const bytesPerElement =
    prototype === null
      ? undefined
      : Object.getOwnPropertyDescriptor(prototype, "BYTES_PER_ELEMENT");
  const constructor =
    prototype === null
      ? undefined
      : Object.getOwnPropertyDescriptor(prototype, "constructor");
  const constructorValue: unknown = constructor?.value;
  if (
    !typedArrayBufferGetter ||
    !bytesPerElement ||
    !("value" in bytesPerElement) ||
    bytesPerElement.value !== 1 ||
    !constructor ||
    !("value" in constructor) ||
    typeof constructorValue !== "function" ||
    constructorValue.name !== "Uint8Array"
  ) {
    throw new TypeError("Invalid archive bytes");
  }
  let buffer: ArrayBufferLike;
  try {
    buffer = Reflect.apply(
      typedArrayBufferGetter,
      value,
      [],
    ) as ArrayBufferLike;
  } catch {
    throw new TypeError("Invalid archive bytes");
  }
  if (
    typeof SharedArrayBuffer !== "undefined" &&
    buffer instanceof SharedArrayBuffer
  ) {
    throw new TypeError("Invalid archive bytes");
  }
  try {
    return Uint8Array.prototype.slice.call(value as Uint8Array);
  } catch {
    throw new TypeError("Invalid archive bytes");
  }
};

const compareText = (left: string, right: string): number =>
  left < right ? -1 : left > right ? 1 : 0;

const validateContentPath = (path: unknown): string => {
  if (
    !isCanonicalArchivePath(path) ||
    CORE_CANONICAL.has(canonicalArchivePath(path)) ||
    (!path.startsWith("files/") && !path.startsWith("pages/"))
  ) {
    throw new TypeError("Invalid ZIP entry path");
  }
  return path;
};

const hasAncestorConflict = (left: string, right: string): boolean =>
  left.startsWith(`${right}/`) || right.startsWith(`${left}/`);

const expectedPrefix = (resource: ArchiveManifestResource): string =>
  resource.kind === "file" ? "files/" : "pages/";

const collectPayloads = (
  rawEntries: unknown,
  manifest: ArchiveManifest,
): Map<string, Uint8Array> => {
  if (Object.getPrototypeOf(rawEntries) !== Map.prototype) {
    throw new TypeError("Invalid archive entries");
  }
  let rawPairs: [unknown, unknown][];
  try {
    rawPairs = [
      ...(Map.prototype.entries.call(
        rawEntries as Map<unknown, unknown>,
      ) as IterableIterator<[unknown, unknown]>),
    ];
  } catch {
    throw new TypeError("Invalid archive entries");
  }
  const payloads = new Map<string, Uint8Array>();
  const canonicalPaths = new Map<string, string>();
  for (const [rawPath, rawBytes] of rawPairs) {
    const path = validateContentPath(rawPath);
    const canonical = canonicalArchivePath(path);
    if (canonicalPaths.has(canonical)) {
      throw new TypeError("Duplicate ZIP entry path");
    }
    for (const other of canonicalPaths.keys()) {
      if (hasAncestorConflict(canonical, other)) {
        throw new TypeError("Conflicting ZIP entry path");
      }
    }
    canonicalPaths.set(canonical, path);
    payloads.set(path, cloneBytes(rawBytes));
  }

  const expected = new Map<string, ArchiveManifestResource>();
  for (const resource of manifest.resources) {
    if (resource.status !== "success") continue;
    if (
      resource.archivePath === null ||
      !resource.archivePath.startsWith(expectedPrefix(resource))
    ) {
      throw new TypeError("Invalid successful resource path");
    }
    const canonical = canonicalArchivePath(resource.archivePath);
    if (expected.has(canonical)) {
      throw new TypeError("Duplicate manifest payload path");
    }
    for (const other of expected.keys()) {
      if (hasAncestorConflict(canonical, other)) {
        throw new TypeError("Conflicting manifest payload path");
      }
    }
    expected.set(canonical, resource);
  }
  if (payloads.size !== expected.size) {
    throw new TypeError("ZIP payload set does not match manifest");
  }
  for (const [path, bytes] of payloads) {
    const resource = expected.get(canonicalArchivePath(path));
    if (
      !resource ||
      resource.archivePath !== path ||
      resource.actualBytes !== bytes.byteLength
    ) {
      throw new TypeError("ZIP payload does not match manifest");
    }
  }
  return payloads;
};

const patchZipTimes = (bytes: Uint8Array): Uint8Array => {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let offset = 0;
  while (
    offset + 30 <= bytes.byteLength &&
    view.getUint32(offset, true) === 0x04034b50
  ) {
    view.setUint16(offset + 10, FIXED_ZIP_TIME, true);
    view.setUint16(offset + 12, FIXED_ZIP_DATE, true);
    const compressedSize = view.getUint32(offset + 18, true);
    const nameLength = view.getUint16(offset + 26, true);
    const extraLength = view.getUint16(offset + 28, true);
    offset += 30 + nameLength + extraLength + compressedSize;
  }
  while (
    offset + 46 <= bytes.byteLength &&
    view.getUint32(offset, true) === 0x02014b50
  ) {
    view.setUint16(offset + 12, FIXED_ZIP_TIME, true);
    view.setUint16(offset + 14, FIXED_ZIP_DATE, true);
    const nameLength = view.getUint16(offset + 28, true);
    const extraLength = view.getUint16(offset + 30, true);
    const commentLength = view.getUint16(offset + 32, true);
    offset += 46 + nameLength + extraLength + commentLength;
  }
  if (
    offset + 22 > bytes.byteLength ||
    view.getUint32(offset, true) !== 0x06054b50
  ) {
    throw new TypeError("Invalid generated ZIP");
  }
  return bytes;
};

export function buildCourseZip(input: ArchiveInput): Uint8Array;
export function buildCourseZip(input: unknown): Uint8Array {
  const record = exactInput(input);
  const indexHtml = validateIndexHtml(ownValue(record, "indexHtml"));
  const archiveCss = validateArchiveCss(ownValue(record, "archiveCss"));
  const manifest = normalizeArchiveManifest(ownValue(record, "manifest"));
  const payloads = collectPayloads(ownValue(record, "entries"), manifest);
  const sources = new Map<string, Uint8Array>([
    ["assets/archive.css", strToU8(archiveCss)],
    ["index.html", strToU8(indexHtml)],
    ["manifest.json", strToU8(`${JSON.stringify(manifest, null, 2)}\n`)],
    ...[...payloads.entries()].sort(([left], [right]) =>
      compareText(left, right),
    ),
  ]);
  const zipEntries: Zippable = Object.create(null) as Zippable;
  for (const [path, bytes] of [...sources].sort(([left], [right]) =>
    compareText(left, right),
  )) {
    zipEntries[path] = [
      bytes,
      {
        level: 6,
        mtime: ZIP_MTIME_SEED,
        os: 3,
        attrs: 0o100644 * 65_536,
      },
    ];
  }
  return patchZipTimes(zipSync(zipEntries, { level: 6 }));
}

const safeZipName = (value: unknown): string => {
  if (
    typeof value !== "string" ||
    value.length === 0 ||
    value.length > MAX_ZIP_NAME_LENGTH ||
    value.includes("/") ||
    value.includes("\\") ||
    !value.endsWith(".zip") ||
    value !== value.normalize("NFKC") ||
    !isCanonicalArchivePath(value)
  ) {
    throw new TypeError("Invalid ZIP filename");
  }
  return value;
};

export function downloadCourseZip(fileName: string, bytes: Uint8Array): void;
export function downloadCourseZip(fileName: unknown, bytes: unknown): void {
  const safeName = safeZipName(fileName);
  const snapshot = cloneBytes(bytes);
  const stableBuffer = new Uint8Array(snapshot).buffer;
  const blob = new Blob([stableBuffer], { type: "application/zip" });
  const url = URL.createObjectURL(blob);
  setTimeout(() => URL.revokeObjectURL(url), 0);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = safeName;
  anchor.click();
}
