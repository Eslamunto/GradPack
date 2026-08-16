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
    url.password !== ""
  ) {
    throw new TypeError("Rejected pagination URL");
  }
  return url;
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
  }

  return output;
}
