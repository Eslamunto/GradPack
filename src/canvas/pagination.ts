import { CANVAS_ORIGIN } from "../shared/constants";

function splitLinkHeader(header: string): string[] {
  const entries: string[] = [];
  let start = 0;
  let inAngleBrackets = false;
  let inQuotes = false;

  for (let index = 0; index < header.length; index += 1) {
    const character = header[index];
    if (character === "<" && !inQuotes) inAngleBrackets = true;
    if (character === ">" && !inQuotes) inAngleBrackets = false;
    if (character === '"' && !inAngleBrackets) inQuotes = !inQuotes;
    if (character === "," && !inAngleBrackets && !inQuotes) {
      entries.push(header.slice(start, index).trim());
      start = index + 1;
    }
  }
  entries.push(header.slice(start).trim());
  return entries.filter(Boolean);
}

function hasNextRelation(entry: string): boolean {
  for (const parameter of entry.split(";").slice(1)) {
    const match = parameter.trim().match(/^rel\s*=\s*(?:"([^"]*)"|([^\s]+))$/i);
    const value = match?.[1] ?? match?.[2];
    if (value?.split(/\s+/).includes("next")) return true;
  }
  return false;
}

export function parseNextLink(header: string | null): URL | null {
  if (!header) return null;
  const entries = splitLinkHeader(header).filter(hasNextRelation);
  if (entries.length === 0) return null;
  if (entries.length !== 1) {
    throw new TypeError("Rejected multiple next links");
  }

  const match = entries[0]?.match(/^\s*<([^>]+)>/);
  if (!match?.[1]) throw new TypeError("Malformed pagination link");

  let url: URL;
  try {
    url = new URL(match[1]);
  } catch {
    throw new TypeError("Malformed pagination link");
  }
  if (
    url.origin !== CANVAS_ORIGIN ||
    !url.pathname.startsWith("/api/v1/") ||
    url.username !== "" ||
    url.password !== "" ||
    url.hash !== ""
  ) {
    throw new TypeError("Rejected pagination URL");
  }
  return url;
}

const PAGINATION_PARAMETERS = new Set(["page", "per_page", "bookmark"]);

const sortedValues = (url: URL, key: string): string[] =>
  url.searchParams.getAll(key).sort();

const sameValues = (
  left: readonly string[],
  right: readonly string[],
): boolean =>
  left.length === right.length &&
  left.every((value, index) => value === right[index]);

function validatePaginationParameters(first: URL, next: URL): void {
  const keys = new Set([
    ...first.searchParams.keys(),
    ...next.searchParams.keys(),
  ]);
  for (const key of keys) {
    if (PAGINATION_PARAMETERS.has(key)) continue;
    if (!sameValues(sortedValues(first, key), sortedValues(next, key))) {
      throw new TypeError("Rejected pagination query");
    }
  }
  const pageValues = next.searchParams.getAll("page");
  const page = pageValues.length === 1 ? Number(pageValues[0]) : null;
  if (
    pageValues.length > 1 ||
    (pageValues.length === 1 &&
      (!/^[1-9]\d*$/.test(pageValues[0]!) ||
        !Number.isSafeInteger(page) ||
        page === null ||
        page < 1))
  ) {
    throw new TypeError("Rejected pagination query");
  }
  const perPageValues = next.searchParams.getAll("per_page");
  if (perPageValues.length > 1)
    throw new TypeError("Rejected pagination query");
  if (perPageValues.length === 1) {
    const perPage = Number(perPageValues[0]);
    if (!Number.isSafeInteger(perPage) || perPage < 1 || perPage > 100) {
      throw new TypeError("Rejected pagination query");
    }
  }
  const bookmarkValues = next.searchParams.getAll("bookmark");
  if (
    bookmarkValues.length > 1 ||
    (bookmarkValues.length === 1 &&
      (!bookmarkValues[0] || bookmarkValues[0].length > 1_000))
  ) {
    throw new TypeError("Rejected pagination query");
  }
}

function validateContinuation(first: URL, next: URL): void {
  if (next.pathname !== first.pathname) {
    throw new TypeError("Rejected pagination path");
  }
  validatePaginationParameters(first, next);
}

export async function fetchAllPages<T>(
  request: (url: URL) => Promise<{ value: T[]; response: Response }>,
  first: URL,
): Promise<T[]> {
  const seen = new Set<string>();
  const output: T[] = [];
  let next: URL | null = first;

  while (next) {
    if (seen.has(next.href)) throw new TypeError("Pagination loop detected");
    seen.add(next.href);
    const page = await request(next);
    output.push(...page.value);
    next = parseNextLink(page.response.headers.get("link"));
    if (next) validateContinuation(first, next);
  }

  return output;
}
