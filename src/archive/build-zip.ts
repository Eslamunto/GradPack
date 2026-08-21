import { strToU8, zipSync, type Zippable } from "fflate";
import {
  ArchiveSafetyError,
  MAX_ZIP_PAYLOAD_ENTRIES,
  normalizeArchiveManifest,
  type ArchiveManifest,
  type ArchiveManifestResource,
} from "./manifest";
import {
  assertArchivePathSet,
  canonicalArchivePath,
  isCanonicalArchivePath,
} from "./paths";
import { ARCHIVE_CSS } from "./style";
import {
  COURSE_HTML_PATHS,
  relativeArchiveHref,
  type CourseHtmlPath,
} from "./archive-links";

const CORE_PATHS = [
  "assets/archive.css",
  "files.html",
  "index.html",
  "manifest.json",
  "modules.html",
  "pages.html",
  "status.html",
] as const;
const CORE_CANONICAL = new Set(CORE_PATHS.map(canonicalArchivePath));
const FIXED_ZIP_DATE = 0x2821;
const FIXED_ZIP_TIME = 0;
const ZIP_MTIME_SEED = "2000-01-01T12:00:00.000Z";
const MAX_TEXT_BYTES = 16 * 1024 * 1024;
const MAX_ZIP_NAME_LENGTH = 180;
const HTML_NAMESPACE = "http://www.w3.org/1999/xhtml";
const INDEX_TAGS = new Set([
  "a",
  "aside",
  "body",
  "dd",
  "div",
  "dl",
  "dt",
  "h1",
  "h2",
  "head",
  "header",
  "html",
  "li",
  "link",
  "main",
  "meta",
  "ol",
  "p",
  "section",
  "span",
  "title",
  "ul",
]);
const INDEX_CLASSES = new Set([
  "all-resources",
  "archive-header",
  "eyebrow",
  "metadata",
  "module",
  "resource-status",
  "responsibility-notice",
  "summary",
]);
const INDEX_IDS = new Set([
  "modules-title",
  "resources-title",
  "summary-title",
]);

export type ArchiveInput = {
  pages: ReadonlyMap<CourseHtmlPath, string>;
  archiveCss: string;
  manifest: ArchiveManifest;
  entries: ReadonlyMap<string, Uint8Array>;
};

const exactInput = (value: unknown): Record<string, unknown> => {
  let prototype: object | null;
  try {
    prototype =
      typeof value === "object" && value !== null
        ? (Object.getPrototypeOf(value) as object | null)
        : null;
  } catch {
    throw new TypeError("Invalid archive input");
  }
  if (
    typeof value !== "object" ||
    value === null ||
    Array.isArray(value) ||
    (prototype !== Object.prototype && prototype !== null)
  ) {
    throw new TypeError("Invalid archive input");
  }
  let keys: PropertyKey[];
  try {
    keys = Reflect.ownKeys(value);
  } catch {
    throw new TypeError("Invalid archive input");
  }
  const expected = ["pages", "archiveCss", "manifest", "entries"];
  if (
    keys.length !== expected.length ||
    keys.some((key) => typeof key !== "string" || !expected.includes(key))
  ) {
    throw new TypeError("Invalid archive input");
  }
  const snapshot: Record<string, unknown> = Object.create(null) as Record<
    string,
    unknown
  >;
  for (const key of expected) {
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    if (!descriptor || !("value" in descriptor)) {
      throw new TypeError("Invalid archive input");
    }
    snapshot[key] = descriptor.value;
  }
  return snapshot;
};

const ownValue = (value: Record<string, unknown>, key: string): unknown => {
  return value[key];
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

const exactAttributes = (
  element: Element,
  expected: Readonly<Record<string, string>>,
): boolean => {
  const attributes = [...element.attributes];
  return (
    attributes.length === Object.keys(expected).length &&
    attributes.every(
      (attribute) =>
        attribute.namespaceURI === null &&
        Object.hasOwn(expected, attribute.name) &&
        expected[attribute.name] === attribute.value,
    )
  );
};

const safeShellHref = (value: string): boolean => {
  if (value === "#archive-main") return true;
  if (safeExternalHref(value)) return true;
  if (
    value.includes("\\") ||
    value.includes(":") ||
    value.includes("?") ||
    value.includes("#") ||
    value.startsWith("//")
  ) return false;
  let url: URL;
  try {
    url = new URL(value, "https://archive.invalid/index.html");
  } catch {
    return false;
  }
  let path: string;
  try {
    path = decodeURIComponent(url.pathname.slice(1));
  } catch {
    return false;
  }
  return url.origin === "https://archive.invalid" && isCanonicalArchivePath(path);
};

const validateShellIndex = (
  html: string,
  document: Document,
  pagePath: string,
): string => {
  if (
    document.doctype?.name.toLowerCase() !== "html" ||
    !exactAttributes(document.documentElement, { lang: "en" }) ||
    !document.body.querySelector(":scope > .skip-link + .archive-layout") ||
    document.querySelector("script, style, form, iframe, object, embed, input, button")
  ) throw new TypeError("Invalid archive index");
  const link = document.head.querySelector('link[rel="stylesheet"]');
  if (
    link?.getAttribute("href") !==
    relativeArchiveHref(pagePath, "assets/archive.css")
  ) {
    throw new TypeError("Invalid archive index");
  }
  for (const element of document.querySelectorAll("*")) {
    for (const attribute of [...element.attributes]) {
      if (
        attribute.namespaceURI !== null ||
        attribute.name.startsWith("on") ||
        attribute.name === "style" ||
        attribute.name === "src"
      ) throw new TypeError("Invalid archive index");
    }
  }
  for (const anchor of document.querySelectorAll("a[href]")) {
    const href = anchor.getAttribute("href");
    if (href === null || !safeShellHref(href)) throw new TypeError("Invalid archive index");
    if (safeExternalHref(href) && anchor.getAttribute("rel") !== "noopener noreferrer") {
      throw new TypeError("Invalid archive index");
    }
  }
  const walker = document.createTreeWalker(document, NodeFilter.SHOW_COMMENT);
  if (walker.nextNode()) throw new TypeError("Invalid archive index");
  return `<!doctype html>${document.documentElement.outerHTML}`;
};

export const validateArchiveHtml = (
  pagePath: string,
  value: unknown,
): string => {
  if (!isCanonicalArchivePath(pagePath)) {
    throw new TypeError("Invalid archive page path");
  }
  const html = archiveText(value);
  const document = new DOMParser().parseFromString(html, "text/html");
  if (document.body.querySelector(".archive-layout")) {
    return validateShellIndex(html, document, pagePath);
  }
  const main = document.body.firstElementChild;
  if (
    document.doctype?.name.toLowerCase() !== "html" ||
    document.documentElement.namespaceURI !== HTML_NAMESPACE ||
    !exactAttributes(document.documentElement, { lang: "en" }) ||
    !exactAttributes(document.head, {}) ||
    document.body.children.length !== 1 ||
    main?.localName !== "main" ||
    !exactAttributes(document.body, {}) ||
    !exactAttributes(main, {})
  ) {
    throw new TypeError("Invalid archive index");
  }
  const head = [...document.head.children];
  if (
    head.length !== 4 ||
    head[0]?.localName !== "meta" ||
    !exactAttributes(head[0], { charset: "utf-8" }) ||
    head[1]?.localName !== "meta" ||
    !exactAttributes(head[1], {
      name: "viewport",
      content: "width=device-width,initial-scale=1",
    }) ||
    head[2]?.localName !== "title" ||
    !exactAttributes(head[2], {}) ||
    head[2].children.length !== 0 ||
    head[3]?.localName !== "link" ||
    !exactAttributes(head[3], {
      rel: "stylesheet",
      href: "assets/archive.css",
    })
  ) {
    throw new TypeError("Invalid archive index");
  }
  const trustedStructure = new Set<Element>([
    document.documentElement,
    document.head,
    document.body,
    main,
    ...head,
  ]);
  for (const element of document.querySelectorAll("*")) {
    if (
      element.namespaceURI !== HTML_NAMESPACE ||
      !INDEX_TAGS.has(element.localName)
    ) {
      throw new TypeError("Invalid archive index");
    }
    if (
      ["html", "head", "body", "main", "meta", "title", "link"].includes(
        element.localName,
      )
    ) {
      if (!trustedStructure.has(element)) {
        throw new TypeError("Invalid archive index");
      }
      continue;
    }
    if (element.localName === "a") continue;
    const attributes = [...element.attributes];
    if (
      attributes.some(
        (attribute) =>
          attribute.namespaceURI !== null ||
          !["aria-labelledby", "class", "id"].includes(attribute.name),
      )
    ) {
      throw new TypeError("Invalid archive index");
    }
    const className = element.getAttribute("class");
    const id = element.getAttribute("id");
    const labelledBy = element.getAttribute("aria-labelledby");
    if (
      (className !== null && !INDEX_CLASSES.has(className)) ||
      (id !== null && !INDEX_IDS.has(id)) ||
      (labelledBy !== null &&
        !(
          INDEX_IDS.has(labelledBy) &&
          (labelledBy === id ||
            (element.localName === "section" && id === null))
        ))
    ) {
      throw new TypeError("Invalid archive index");
    }
  }
  for (const anchor of document.querySelectorAll("a[href]")) {
    const href = anchor.getAttribute("href");
    if (href === null) throw new TypeError("Invalid archive index");
    const local = safeLocalHref(href);
    if (!local && !safeExternalHref(href)) {
      throw new TypeError("Invalid archive index");
    }
    const expected = local ? { href } : { href, rel: "noopener noreferrer" };
    if (!exactAttributes(anchor, expected)) {
      throw new TypeError("Invalid archive index");
    }
  }
  if (document.querySelector("a:not([href])")) {
    throw new TypeError("Invalid archive index");
  }
  const walker = document.createTreeWalker(document, NodeFilter.SHOW_COMMENT);
  if (walker.nextNode()) throw new TypeError("Invalid archive index");
  return `<!doctype html>${document.documentElement.outerHTML}`;
};

const validateArchiveCss = (value: unknown): string => {
  const css = archiveText(value);
  if (css !== ARCHIVE_CSS) {
    throw new TypeError("Invalid archive stylesheet");
  }
  return css;
};

const collectGeneratedPages = (value: unknown): Map<CourseHtmlPath, string> => {
  if (Object.getPrototypeOf(value) !== Map.prototype) {
    throw new TypeError("Invalid generated pages");
  }
  const pairs = [...Map.prototype.entries.call(value as Map<unknown, unknown>)];
  if (pairs.length !== COURSE_HTML_PATHS.length) {
    throw new TypeError("Invalid generated page set");
  }
  const pages = new Map<CourseHtmlPath, string>();
  for (const path of COURSE_HTML_PATHS) {
    const pair = pairs.find(([candidate]) => candidate === path);
    if (!pair) throw new TypeError("Invalid generated page set");
    pages.set(path, validateArchiveHtml(path, pair[1]));
  }
  return pages;
};

const typedArrayPrototype = Object.getPrototypeOf(
  Uint8Array.prototype,
) as object;
// eslint-disable-next-line @typescript-eslint/unbound-method
const typedArrayBufferGetter = Object.getOwnPropertyDescriptor(
  typedArrayPrototype,
  "buffer",
)?.get;
// eslint-disable-next-line @typescript-eslint/unbound-method
const typedArrayByteLengthGetter = Object.getOwnPropertyDescriptor(
  typedArrayPrototype,
  "byteLength",
)?.get;
// eslint-disable-next-line @typescript-eslint/unbound-method
const typedArrayTagGetter = Object.getOwnPropertyDescriptor(
  typedArrayPrototype,
  Symbol.toStringTag,
)?.get;
// eslint-disable-next-line @typescript-eslint/unbound-method
const arrayBufferByteLengthGetter = Object.getOwnPropertyDescriptor(
  ArrayBuffer.prototype,
  "byteLength",
)?.get;
/* eslint-disable @typescript-eslint/unbound-method -- captured intrinsic getters are invoked only through Reflect.apply */
const sharedArrayBufferByteLengthGetter =
  typeof SharedArrayBuffer === "undefined"
    ? undefined
    : Object.getOwnPropertyDescriptor(SharedArrayBuffer.prototype, "byteLength")
        ?.get;
/* eslint-enable @typescript-eslint/unbound-method */
// eslint-disable-next-line @typescript-eslint/unbound-method
const uint8ArraySet = Uint8Array.prototype.set;
const IntrinsicDataView = DataView;

const cloneBytes = (value: unknown): Uint8Array => {
  if (
    !typedArrayBufferGetter ||
    !typedArrayByteLengthGetter ||
    !typedArrayTagGetter ||
    !arrayBufferByteLengthGetter
  ) {
    throw new TypeError("Invalid archive bytes");
  }
  let buffer: ArrayBufferLike;
  let byteLength: number;
  let tag: unknown;
  try {
    buffer = Reflect.apply(
      typedArrayBufferGetter,
      value,
      [],
    ) as ArrayBufferLike;
    byteLength = Reflect.apply(typedArrayByteLengthGetter, value, []) as number;
    tag = Reflect.apply(typedArrayTagGetter, value, []);
  } catch {
    throw new TypeError("Invalid archive bytes");
  }
  if (
    tag !== "Uint8Array" ||
    !Number.isSafeInteger(byteLength) ||
    byteLength < 0
  ) {
    throw new TypeError("Invalid archive bytes");
  }
  let arrayBufferLength: number;
  try {
    arrayBufferLength = Reflect.apply(
      arrayBufferByteLengthGetter,
      buffer,
      [],
    ) as number;
  } catch {
    if (sharedArrayBufferByteLengthGetter) {
      try {
        Reflect.apply(sharedArrayBufferByteLengthGetter, buffer, []);
      } catch {
        throw new TypeError("Invalid archive bytes");
      }
    }
    throw new TypeError("Invalid archive bytes");
  }
  if (
    !Number.isSafeInteger(arrayBufferLength) ||
    arrayBufferLength < byteLength
  ) {
    throw new TypeError("Invalid archive bytes");
  }
  try {
    new IntrinsicDataView(buffer as ArrayBuffer, 0, 0);
    const output = new Uint8Array(byteLength);
    Reflect.apply(uint8ArraySet, output, [value, 0]);
    return output;
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

const expectedPrefix = (resource: ArchiveManifestResource): string =>
  resource.kind === "file" ? "files/" : "pages/";

const collectPayloads = (
  rawEntries: unknown,
  manifest: ArchiveManifest,
): Map<string, Uint8Array> => {
  if (Object.getPrototypeOf(rawEntries) !== Map.prototype) {
    throw new TypeError("Invalid archive entries");
  }
  // eslint-disable-next-line @typescript-eslint/unbound-method
  const mapSizeGetter = Object.getOwnPropertyDescriptor(
    Map.prototype,
    "size",
  )?.get;
  let entryCount: number;
  try {
    entryCount = mapSizeGetter
      ? (Reflect.apply(mapSizeGetter, rawEntries, []) as number)
      : Number.NaN;
  } catch {
    throw new TypeError("Invalid archive entries");
  }
  if (entryCount > MAX_ZIP_PAYLOAD_ENTRIES) {
    throw new ArchiveSafetyError("ZIP payload entry limit exceeded");
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
  for (const [rawPath, rawBytes] of rawPairs) {
    const path = validateContentPath(rawPath);
    payloads.set(path, cloneBytes(rawBytes));
  }
  assertArchivePathSet(
    [...payloads.keys()].map((path) => ({
      kind: path.startsWith("files/") ? ("file" as const) : ("page" as const),
      archivePath: path,
    })),
  );

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
  const pages = collectGeneratedPages(ownValue(record, "pages"));
  const archiveCss = validateArchiveCss(ownValue(record, "archiveCss"));
  const manifest = normalizeArchiveManifest(ownValue(record, "manifest"));
  const payloads = collectPayloads(ownValue(record, "entries"), manifest);
  const sources = new Map<string, Uint8Array>([
    ["assets/archive.css", strToU8(archiveCss)],
    ["manifest.json", strToU8(`${JSON.stringify(manifest, null, 2)}\n`)],
    ...[...pages].map(([path, html]) => [path, strToU8(html)] as const),
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
