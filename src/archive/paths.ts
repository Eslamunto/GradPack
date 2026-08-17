const RESERVED = /^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\..*)?$/i;
const UNSAFE_CHARACTERS = /[\p{Cc}\p{Cf}\p{Cs}<>:"/\\|?#*]/gu;
const MAX_SEGMENT_LENGTH = 100;
const MAX_PATH_LENGTH = 240;

const characters = (value: string): string[] => Array.from(value);

const truncate = (value: string, length: number): string =>
  characters(value).slice(0, length).join("");

const digest = (value: string): string => {
  let hash = 0x811c9dc5;
  for (const character of value) {
    hash ^= character.codePointAt(0) ?? 0;
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(16).padStart(8, "0");
};

function safeSegment(input: string): string {
  if (typeof input !== "string") throw new TypeError("Invalid archive segment");
  let value = input
    .normalize("NFC")
    .replace(UNSAFE_CHARACTERS, "_")
    .replace(/^\.+$/, "_")
    .replace(/[. ]+$/g, "")
    .trim();
  if (!value) value = "untitled";
  if (RESERVED.test(value)) value = `_${value}`;
  return truncate(value, MAX_SEGMENT_LENGTH);
}

function addDigestToLastSegment(value: string, pathDigest: string): string {
  const dot = value.lastIndexOf(".");
  const hasExtension = dot > 0 && value.length - dot <= 16;
  const extension = hasExtension ? value.slice(dot) : "";
  const stem = hasExtension ? value.slice(0, dot) : value;
  const suffix = `~${pathDigest}`;
  return `${truncate(stem, MAX_SEGMENT_LENGTH - suffix.length - extension.length)}${suffix}${extension}`;
}

export function safeArchivePath(...segments: string[]): string {
  const normalized = (segments.length > 0 ? segments : [""]).map(safeSegment);
  const direct = normalized.join("/");
  if (direct.length <= MAX_PATH_LENGTH) return direct;

  const pathDigest = digest(direct);
  const last = addDigestToLastSegment(normalized.at(-1)!, pathDigest);
  if (normalized.length === 1) return truncate(last, MAX_PATH_LENGTH);

  const bounded = [normalized[0]!];
  for (const segment of normalized.slice(1, -1)) {
    if ([...bounded, segment, last].join("/").length > MAX_PATH_LENGTH) break;
    bounded.push(segment);
  }
  if (bounded.length < normalized.length - 1) {
    const omission = `_~${pathDigest}`;
    if ([...bounded, omission, last].join("/").length <= MAX_PATH_LENGTH) {
      bounded.push(omission);
    }
  }
  bounded.push(last);
  const path = bounded.join("/");
  if (path.length > MAX_PATH_LENGTH) {
    throw new TypeError("Unsafe archive path");
  }
  return path;
}

export function canonicalArchivePath(path: string): string {
  if (typeof path !== "string") throw new TypeError("Invalid archive path");
  return path
    .normalize("NFKC")
    .toLowerCase()
    .replace(/\u03c2/g, "\u03c3")
    .replace(/\u00df/g, "ss");
}

export function isCanonicalArchivePath(path: unknown): path is string {
  if (
    typeof path !== "string" ||
    path.length === 0 ||
    path.length > MAX_PATH_LENGTH ||
    path !== path.normalize("NFC")
  ) {
    return false;
  }
  const segments = path.split("/");
  if (
    segments.some(
      (segment) =>
        segment.length === 0 || characters(segment).length > MAX_SEGMENT_LENGTH,
    )
  ) {
    return false;
  }
  try {
    return safeArchivePath(...segments) === path;
  } catch {
    return false;
  }
}

export type ArchivePathRecord = {
  kind: "file" | "page" | "external" | "unsupported";
  archivePath: string | null;
};

/**
 * Validates a complete archive namespace in bounded O(total path segments)
 * work. Canonical equality and file/directory ancestor conflicts are checked
 * across every resource, regardless of retrieval outcome.
 */
export function assertArchivePathSet(
  resources: readonly ArchivePathRecord[],
): void {
  const paths = new Set<string>();
  for (const resource of resources) {
    const { kind, archivePath } = resource;
    if (kind === "external" || kind === "unsupported") {
      if (archivePath !== null) throw new TypeError("Invalid archive path set");
      continue;
    }
    if (
      !isCanonicalArchivePath(archivePath) ||
      (kind === "file" && !archivePath.startsWith("files/")) ||
      (kind === "page" && !archivePath.startsWith("pages/"))
    ) {
      throw new TypeError("Invalid archive path set");
    }
    const canonical = canonicalArchivePath(archivePath);
    if (paths.has(canonical)) throw new TypeError("Conflicting archive path");
    paths.add(canonical);
  }
  for (const path of paths) {
    let separator = path.indexOf("/");
    while (separator !== -1) {
      if (paths.has(path.slice(0, separator))) {
        throw new TypeError("Conflicting archive path");
      }
      separator = path.indexOf("/", separator + 1);
    }
  }
}
