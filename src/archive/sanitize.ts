import DOMPurify from "dompurify";
import { CANVAS_ORIGIN } from "../shared/constants";

export type SanitizePageInput = {
  title: string;
  body: string;
  resolveLocalHref: (href: string) => string | null;
};

const HTML_NAMESPACE = "http://www.w3.org/1999/xhtml";
const ARCHIVE_BASE = "https://archive.invalid/pages/current.html";
const CONTROL = /[\p{Cc}\p{Cf}\p{Cs}]/u;
const ENCODED_CONTROL = /%(?:0[0-9a-f]|1[0-9a-f]|7f)/iu;
const SAFE_FRAGMENT = /^#[a-z0-9][a-z0-9_.:-]*$/iu;
const LOCAL_PREFIX = /^\.\.\/(?:files|pages)\//u;
const ARIA_ATTRIBUTE = /^aria-[a-z][a-z0-9-]*$/u;

const ALLOWED_TAGS = [
  "a",
  "abbr",
  "article",
  "aside",
  "b",
  "blockquote",
  "br",
  "caption",
  "cite",
  "code",
  "col",
  "colgroup",
  "dd",
  "del",
  "details",
  "dfn",
  "div",
  "dl",
  "dt",
  "em",
  "figcaption",
  "figure",
  "footer",
  "h1",
  "h2",
  "h3",
  "h4",
  "h5",
  "h6",
  "header",
  "hr",
  "i",
  "img",
  "kbd",
  "li",
  "main",
  "mark",
  "nav",
  "ol",
  "p",
  "pre",
  "q",
  "s",
  "samp",
  "section",
  "small",
  "span",
  "strong",
  "sub",
  "summary",
  "sup",
  "table",
  "tbody",
  "td",
  "tfoot",
  "th",
  "thead",
  "time",
  "tr",
  "u",
  "ul",
  "var",
] as const;

const ALLOWED_ATTRIBUTES = [
  "abbr",
  "alt",
  "aria-describedby",
  "aria-label",
  "class",
  "colspan",
  "datetime",
  "dir",
  "headers",
  "height",
  "href",
  "id",
  "lang",
  "rel",
  "reversed",
  "role",
  "rowspan",
  "scope",
  "span",
  "start",
  "title",
  "type",
  "value",
  "width",
] as const;

const GLOBAL_ATTRIBUTES = new Set([
  "class",
  "dir",
  "id",
  "lang",
  "role",
  "title",
]);

const ELEMENT_ATTRIBUTES: Readonly<Record<string, ReadonlySet<string>>> = {
  a: new Set(["href", "rel"]),
  col: new Set(["span", "width"]),
  colgroup: new Set(["span", "width"]),
  del: new Set(["datetime"]),
  img: new Set(["alt", "height", "width"]),
  li: new Set(["value"]),
  ol: new Set(["reversed", "start", "type"]),
  td: new Set(["abbr", "colspan", "headers", "rowspan"]),
  th: new Set(["abbr", "colspan", "headers", "rowspan", "scope"]),
  time: new Set(["datetime"]),
};

const descriptorValue = (
  input: object,
  key: keyof SanitizePageInput,
): unknown => {
  let descriptor: PropertyDescriptor | undefined;
  try {
    descriptor = Object.getOwnPropertyDescriptor(input, key);
  } catch {
    throw new TypeError("Invalid page input");
  }
  if (!descriptor || !("value" in descriptor)) {
    throw new TypeError("Invalid page input");
  }
  return descriptor.value;
};

const validateInput = (input: unknown): SanitizePageInput => {
  if (typeof input !== "object" || input === null || Array.isArray(input)) {
    throw new TypeError("Invalid page input");
  }
  const title = descriptorValue(input, "title");
  const body = descriptorValue(input, "body");
  const resolveLocalHref = descriptorValue(input, "resolveLocalHref");
  if (
    typeof title !== "string" ||
    typeof body !== "string" ||
    typeof resolveLocalHref !== "function"
  ) {
    throw new TypeError("Invalid page input");
  }
  return {
    title,
    body,
    resolveLocalHref: resolveLocalHref as SanitizePageInput["resolveLocalHref"],
  };
};

const isAllowedAttribute = (element: Element, name: string): boolean => {
  if (ARIA_ATTRIBUTE.test(name)) return true;
  if (GLOBAL_ATTRIBUTES.has(name)) return true;
  return ELEMENT_ATTRIBUTES[element.localName]?.has(name) ?? false;
};

const auditAttributes = (root: ParentNode): void => {
  for (const element of root.querySelectorAll("*")) {
    if (element.namespaceURI !== HTML_NAMESPACE) {
      element.remove();
      continue;
    }
    const retained = [...element.attributes]
      .filter((attribute) => {
        const name = attribute.name.toLowerCase();
        return (
          attribute.namespaceURI === null &&
          !name.includes(":") &&
          !name.startsWith("on") &&
          name !== "style" &&
          isAllowedAttribute(element, name)
        );
      })
      .sort((left, right) =>
        left.name < right.name ? -1 : left.name > right.name ? 1 : 0,
      );
    for (const attribute of [...element.attributes]) {
      element.removeAttributeNode(attribute);
    }
    for (const attribute of retained) {
      element.setAttribute(attribute.name.toLowerCase(), attribute.value);
    }
  }
};

const isSafeLocalHref = (value: string): boolean => {
  if (
    !LOCAL_PREFIX.test(value) ||
    CONTROL.test(value) ||
    value.includes("\\") ||
    value.includes(":") ||
    value.includes("?") ||
    value.includes("#") ||
    value.includes("//")
  ) {
    return false;
  }
  const pathSegments = value.split("/").slice(2);
  if (pathSegments.length === 0 || pathSegments.some((segment) => !segment)) {
    return false;
  }
  for (const segment of pathSegments) {
    let decoded: string;
    try {
      decoded = decodeURIComponent(segment);
    } catch {
      return false;
    }
    if (
      decoded === "." ||
      decoded === ".." ||
      CONTROL.test(decoded) ||
      decoded.includes("/") ||
      decoded.includes("\\")
    ) {
      return false;
    }
  }
  let url: URL;
  try {
    url = new URL(value, ARCHIVE_BASE);
  } catch {
    return false;
  }
  return (
    url.origin === "https://archive.invalid" &&
    url.username === "" &&
    url.password === "" &&
    url.search === "" &&
    url.hash === "" &&
    (/^\/(?:files|pages)\/[^/]/u.test(url.pathname) ||
      /^\/(?:files|pages)\/.+\/[^/]/u.test(url.pathname))
  );
};

const unresolvedHref = (raw: string): string | null => {
  let decoded: string;
  try {
    decoded = decodeURI(raw);
  } catch {
    return null;
  }
  if (
    raw !== raw.trim() ||
    CONTROL.test(raw) ||
    CONTROL.test(decoded) ||
    ENCODED_CONTROL.test(raw) ||
    raw.includes("\\")
  ) {
    return null;
  }
  if (SAFE_FRAGMENT.test(raw)) return raw;
  if (raw.startsWith("#") || raw.startsWith("//")) return null;
  if (
    !/^https:\/\/[^/?#]+(?:[/?#]|$)/iu.test(raw) &&
    !/^mailto:[^/\s]/iu.test(raw)
  ) {
    return null;
  }

  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return null;
  }
  if (
    (url.protocol !== "https:" && url.protocol !== "mailto:") ||
    url.username !== "" ||
    url.password !== "" ||
    (url.protocol === "https:" && url.origin === CANVAS_ORIGIN)
  ) {
    return null;
  }
  return url.href;
};

const rewriteAnchors = (
  root: ParentNode,
  resolveLocalHref: SanitizePageInput["resolveLocalHref"],
): void => {
  for (const anchor of root.querySelectorAll("a[href]")) {
    const raw = anchor.getAttribute("href");
    if (raw === null) continue;
    anchor.removeAttribute("rel");
    let resolved: unknown;
    try {
      resolved = Reflect.apply(resolveLocalHref, undefined, [raw]);
    } catch {
      anchor.removeAttribute("href");
      continue;
    }
    if (resolved !== null) {
      if (typeof resolved === "string" && isSafeLocalHref(resolved)) {
        anchor.setAttribute("href", resolved);
      } else {
        anchor.removeAttribute("href");
      }
      continue;
    }
    const retained = unresolvedHref(raw);
    if (retained === null) {
      anchor.removeAttribute("href");
      continue;
    }
    anchor.setAttribute("href", retained);
    if (!retained.startsWith("#")) {
      anchor.setAttribute("rel", "noopener noreferrer");
    }
  }
};

const escapeHtml = (value: string): string =>
  value.replace(/[&<>"']/gu, (character) => {
    switch (character) {
      case "&":
        return "&amp;";
      case "<":
        return "&lt;";
      case ">":
        return "&gt;";
      case '"':
        return "&quot;";
      default:
        return "&#39;";
    }
  });

export function sanitizePageHtml(input: SanitizePageInput): string;
export function sanitizePageHtml(input: unknown): string {
  const { title, body, resolveLocalHref } = validateInput(input);
  const sanitized = DOMPurify.sanitize(body, {
    ALLOWED_TAGS: [...ALLOWED_TAGS],
    ALLOWED_ATTR: [...ALLOWED_ATTRIBUTES],
    ALLOWED_NAMESPACES: [HTML_NAMESPACE],
    ALLOWED_URI_REGEXP: /^[\s\S]*$/u,
    ALLOW_ARIA_ATTR: true,
    ALLOW_DATA_ATTR: false,
    ALLOW_UNKNOWN_PROTOCOLS: false,
    CUSTOM_ELEMENT_HANDLING: {
      tagNameCheck: null,
      attributeNameCheck: null,
      allowCustomizedBuiltInElements: false,
    },
    FORBID_TAGS: [
      "base",
      "button",
      "embed",
      "form",
      "iframe",
      "input",
      "link",
      "math",
      "meta",
      "object",
      "script",
      "select",
      "style",
      "svg",
      "template",
      "textarea",
    ],
    KEEP_CONTENT: true,
    RETURN_DOM_FRAGMENT: true,
    SANITIZE_DOM: true,
    SAFE_FOR_XML: true,
  });
  const container = document.createElement("div");
  container.append(sanitized);
  auditAttributes(container);
  rewriteAnchors(container, resolveLocalHref);
  auditAttributes(container);

  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${escapeHtml(title)}</title><link rel="stylesheet" href="../assets/archive.css"></head><body><main>${container.innerHTML}</main></body></html>`;
}
