import { describe, expect, it, vi } from "vitest";
import {
  renderSavedPageHtml,
  sanitizePageFragment,
  sanitizePageHtml,
  type SanitizePageInput,
} from "../../src/archive/sanitize";

const input = (
  body: string,
  resolveLocalHref: (href: string) => unknown = () => null,
): SanitizePageInput => ({
  title: "Synthetic Page",
  body,
  resolveLocalHref: resolveLocalHref as SanitizePageInput["resolveLocalHref"],
});

const parse = (output: string): Document =>
  new DOMParser().parseFromString(output, "text/html");

const forbiddenTags = [
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
];

const requestAttributes = new Set([
  "action",
  "attributionsrc",
  "background",
  "data",
  "formaction",
  "href",
  "imagesrcset",
  "ping",
  "poster",
  "referrerpolicy",
  "src",
  "srcdoc",
  "srcset",
  "xlink:href",
]);

function expectSafeOutputTree(document: Document): void {
  const body = document.body;
  expect(body.querySelector(forbiddenTags.join(","))).toBeNull();
  for (const element of body.querySelectorAll("*")) {
    expect(element.namespaceURI).toBe("http://www.w3.org/1999/xhtml");
    for (const attribute of [...element.attributes]) {
      const name = attribute.name.toLowerCase();
      expect(name.startsWith("on")).toBe(false);
      expect(name).not.toBe("style");
      if (name === "href") expect(element.localName).toBe("a");
      else expect(requestAttributes.has(name)).toBe(false);
      expect(attribute.namespaceURI).toBeNull();
    }
  }
}

describe("sanitizePageHtml", () => {
  it("separates the sanitized fragment from the trusted saved-page shell", () => {
    const fragment = sanitizePageFragment(
      input("<p>Safe</p><script>alert(1)</script>"),
    );
    expect(fragment).toBe("<p>Safe</p>");
    expect(fragment).not.toContain("<html");

    const model = {
      manifest: {
        course: { name: "Synthetic Course", courseCode: "SYN-101" },
      },
    } as never;
    const html = renderSavedPageHtml({
      model,
      pagePath: "pages/welcome.html",
      title: "Welcome",
      sanitizedFragment: fragment,
      combinedHomeHref: null,
    });
    const document = parse(html);
    expect(document.querySelector('[aria-current="page"]')?.textContent).toBe(
      "Pages",
    );
    expect(document.querySelector('a[href="../modules.html"]')).not.toBeNull();
    expect(document.querySelector("script, [style], [onclick]")).toBeNull();
  });

  it("emits one complete deterministic offline document and escapes the title", () => {
    const page = {
      title: 'Research & <Practice> "Notes" 🌍',
      body: "<p>Benign body</p>",
      resolveLocalHref: () => null,
    };

    const first = sanitizePageHtml(page);
    const second = sanitizePageHtml(page);
    const document = parse(first);

    expect(first).toBe(second);
    expect(first.startsWith("<!doctype html>")).toBe(true);
    expect(document.documentElement.lang).toBe("en");
    expect(document.title).toBe(page.title);
    expect(document.head.querySelectorAll("meta")).toHaveLength(2);
    expect(document.head.querySelector('meta[charset="utf-8"]')).not.toBeNull();
    expect(
      document.head
        .querySelector('meta[name="viewport"]')
        ?.getAttribute("content"),
    ).toBe("width=device-width,initial-scale=1");
    expect(document.head.querySelectorAll("link")).toHaveLength(1);
    expect(document.head.querySelector("link")?.outerHTML).toBe(
      '<link rel="stylesheet" href="../assets/archive.css">',
    );
    expect(document.body.innerHTML).toBe("<main><p>Benign body</p></main>");
  });

  it.each([
    null,
    undefined,
    "page",
    [],
    { title: 1, body: "x", resolveLocalHref: (): null => null },
    { title: "x", body: 1, resolveLocalHref: (): null => null },
    { title: "x", body: "y", resolveLocalHref: null },
  ])("rejects invalid primitive boundaries %#", (value) => {
    expect(() => sanitizePageHtml(value as never)).toThrowError(
      "Invalid page input",
    );
  });

  it("rejects inherited and accessor-backed input without invoking getters", () => {
    const inherited = Object.create({
      title: "Inherited",
      body: "<p>Inherited</p>",
      resolveLocalHref: () => null,
    }) as never;
    const getter = vi.fn(() => "Getter");
    const accessor = {
      body: "<p>Body</p>",
      resolveLocalHref: () => null,
    } as Record<string, unknown>;
    Object.defineProperty(accessor, "title", { enumerable: true, get: getter });

    expect(() => sanitizePageHtml(inherited)).toThrowError(
      "Invalid page input",
    );
    expect(() => sanitizePageHtml(accessor as never)).toThrowError(
      "Invalid page input",
    );
    expect(getter).not.toHaveBeenCalled();
  });

  it("removes active, loading, styling, form, custom, and foreign markup after reparsing", () => {
    const output = sanitizePageHtml(
      input(`
        <base href="https://remote.test/">
        <meta http-equiv="refresh" content="0;url=https://remote.test/">
        <link rel="prefetch stylesheet" href="https://remote.test/a.css">
        <style>@import "https://remote.test/a.css"; p{background:url(https://remote.test/x)}</style>
        <script src="https://remote.test/a.js">alert(1)</script>
        <template><img src="https://remote.test/template.png"></template>
        <iframe src="https://remote.test/" srcdoc="<script>alert(1)</script>"></iframe>
        <object data="https://remote.test/object"></object><embed src="https://remote.test/embed">
        <form action="https://remote.test/post"><input formaction="https://remote.test/post" autofocus><button>Send</button></form>
        <select><option>State</option></select><textarea>State</textarea>
        <img src="https://remote.test/a.png" srcset="https://remote.test/a.png 1x" style="background:url(https://remote.test/b.png)" onerror="alert(1)" alt="Diagram">
        <video src="https://remote.test/a.mp4" poster="https://remote.test/a.jpg"><source src="https://remote.test/a.mp4" srcset="https://remote.test/b.mp4"></video>
        <audio src="https://remote.test/a.mp3"></audio>
        <svg><a xlink:href="javascript:alert(1)"><circle></circle></a></svg>
        <math><mi href="javascript:alert(1)">x</mi></math>
        <canvas-widget data-src="https://remote.test/custom">custom text</canvas-widget>
        <p background="https://remote.test/bg" onclick="alert(1)" aria-label="Safe label" data-note="drop">Safe text</p>
      `),
    );
    const firstParse = parse(output);
    const reparsed = parse(firstParse.documentElement.outerHTML);

    expectSafeOutputTree(firstParse);
    expectSafeOutputTree(reparsed);
    expect(reparsed.body.textContent).toContain("Safe text");
    expect(reparsed.body.querySelector("p")?.getAttribute("aria-label")).toBe(
      "Safe label",
    );
    expect(reparsed.body.querySelector("p")?.hasAttribute("data-note")).toBe(
      false,
    );
    expect(reparsed.body.querySelector("img")?.getAttribute("alt")).toBe(
      "Diagram",
    );
  });

  it("survives malformed mutation-XSS markup without foreign or request surfaces", () => {
    const output = sanitizePageHtml(
      input(
        '<math><mtext><table><mglyph><style><!--</style><img title="--><img src=x onerror=alert(1)>"><svg><foreignObject><p style="background:url(https://remote.test)">Text</p></foreignObject></svg>',
      ),
    );
    const firstParse = parse(output);
    const reparsed = parse(firstParse.documentElement.outerHTML);

    expectSafeOutputTree(firstParse);
    expectSafeOutputTree(reparsed);
  });

  it("calls the resolver for every raw anchor href and accepts only confined sibling targets", () => {
    const resolver = vi.fn((href: string): unknown => {
      if (href === "/files/7/download") return "../files/report.pdf";
      if (href === "/pages/topic") return "../pages/topic.html";
      return null;
    });
    const document = parse(
      sanitizePageHtml(
        input(
          '<a href="/files/7/download">File</a><a href="/pages/topic">Page</a><a href="javascript:alert(1)">Bad</a><a>No href</a>',
          resolver,
        ),
      ),
    );
    const anchors = [...document.body.querySelectorAll("a")];

    expect(resolver.mock.calls).toEqual([
      ["/files/7/download"],
      ["/pages/topic"],
      ["javascript:alert(1)"],
    ]);
    expect(anchors.map((anchor) => anchor.getAttribute("href"))).toEqual([
      "../files/report.pdf",
      "../pages/topic.html",
      null,
      null,
    ]);
  });

  it.each([
    "https://remote.test/file.pdf",
    "http://remote.test/file.pdf",
    "mailto:local@example.test",
    "//remote.test/file.pdf",
    "/files/file.pdf",
    "../../escape.txt",
    "../files/../../escape.txt",
    "../files/%2e%2e/escape.txt",
    "../files/%2Fescape.txt",
    "../files/%5cescape.txt",
    "../files/file.pdf?download=1",
    "../files/file.pdf#section",
    "../files\\file.pdf",
    "../files//file.pdf",
    "../files/http:remote.test",
    "../other/file.pdf",
    "../files/line\nfeed.pdf",
    "../files/safe\u202Ename.pdf",
    new String("../files/wrapped.pdf"),
    7,
  ])("drops unsafe resolver output %#", (resolved) => {
    const document = parse(
      sanitizePageHtml(input('<a href="/known">Known</a>', () => resolved)),
    );

    expect(document.body.querySelector("a")?.hasAttribute("href")).toBe(false);
  });

  it("fails a throwing resolver closed without exposing raw error details", () => {
    const document = parse(
      sanitizePageHtml(
        input('<a href="/known">Known</a>', () => {
          throw new Error("private resolver detail");
        }),
      ),
    );

    expect(document.body.querySelector("a")?.hasAttribute("href")).toBe(false);
    expect(document.documentElement.outerHTML).not.toContain(
      "private resolver detail",
    );
  });

  it("preserves safe fragments, HTTPS, and mailto while hardening external anchors", () => {
    const document = parse(
      sanitizePageHtml(
        input(`
          <h2 id="section-1">Section</h2>
          <a href="#section-1" target="frame" rel="opener" ping="https://remote.test/ping" download referrerpolicy="unsafe-url" attributionsrc="https://remote.test/a">Jump</a>
          <a href="HTTPS://REFERENCE.TEST:443/path?q=ok#part" target="_blank">Reference</a>
          <a href="mailto:reader@example.test?subject=Hello" target="_blank">Email</a>
        `),
      ),
    );
    const anchors = [...document.body.querySelectorAll("a")];

    expect(anchors[0]?.outerHTML).toBe('<a href="#section-1">Jump</a>');
    expect(anchors[1]?.getAttribute("href")).toBe(
      "https://reference.test/path?q=ok#part",
    );
    expect(anchors[1]?.getAttribute("rel")).toBe("noopener noreferrer");
    expect(anchors[1]?.hasAttribute("target")).toBe(false);
    expect(anchors[2]?.getAttribute("href")).toBe(
      "mailto:reader@example.test?subject=Hello",
    );
    expect(anchors[2]?.getAttribute("rel")).toBe("noopener noreferrer");
    expectSafeOutputTree(document);
  });

  it.each([
    "javascript:alert(1)",
    "JaVaScRiPt:alert(1)",
    "jav&#x61;script:alert(1)",
    " javaScript:alert(1)",
    "java\nscript:alert(1)",
    "%6aavascript:alert(1)",
    "data:text/html,boom",
    "blob:https://reference.test/id",
    "file:///tmp/private",
    "http://reference.test/resource",
    "ftp://reference.test/resource",
    "about:blank",
    "//reference.test/resource",
    "https://user:secret@reference.test/resource",
    "https://[invalid/resource",
    "https:reference.test/resource",
    "https:///reference.test/resource",
    "https://frankfurtschool.instructure.com/logout",
    "https://frankfurtschool.instructure.com/api/v1/courses/101",
    "https://FRANKFURTSCHOOL.INSTRUCTURE.COM/resource",
    "https://frankfurtschool.instructure.com./resource",
    "https://frankfurtschool.instructure.com%2e/resource",
    "https://frankfurtschool.instructure.com:8443/resource",
  ])("removes unsafe unresolved reference %#", (href) => {
    const document = parse(
      sanitizePageHtml(input(`<a href="${href}">Reference</a>`)),
    );

    expect(document.body.querySelector("a")?.hasAttribute("href")).toBe(false);
  });

  it("keeps unrelated and subdomain HTTPS hosts distinct from the Canvas host", () => {
    const document = parse(
      sanitizePageHtml(
        input(`
          <a href="https://reference.test/resource">Unrelated</a>
          <a href="https://safe.frankfurtschool.instructure.com/resource">Subdomain</a>
        `),
      ),
    );
    const anchors = [...document.body.querySelectorAll("a")];

    expect(anchors.map((anchor) => anchor.getAttribute("href"))).toEqual([
      "https://reference.test/resource",
      "https://safe.frankfurtschool.instructure.com/resource",
    ]);
    expect(
      anchors.every(
        (anchor) => anchor.getAttribute("rel") === "noopener noreferrer",
      ),
    ).toBe(true);
    expectSafeOutputTree(document);
  });

  it.each([
    "../files/CON",
    "../files/CON.txt",
    "../files/trailing.",
    "../files/trailing ",
    "../files/Re\u0301sume\u0301.pdf",
    "../files/bad<name>.pdf",
    `../files/${"x".repeat(101)}.pdf`,
    `../files/${"x".repeat(100)}/${"y".repeat(100)}/${"z".repeat(50)}`,
    "../files/safe\u202Ename.pdf",
    "../files/bad\ud800name.pdf",
    "../files/%2e%2e/escape.pdf",
    "../files/%2fescape.pdf",
    "../files/%5cescape.pdf",
    "../files/%00control.pdf",
  ])("removes non-canonical resolver archive target %#", (resolved) => {
    const document = parse(
      sanitizePageHtml(input('<a href="/known">Known</a>', () => resolved)),
    );

    expect(document.body.querySelector("a")?.hasAttribute("href")).toBe(false);
    expectSafeOutputTree(document);
  });

  it("accepts canonical encoded and literal-percent Task 4 archive targets exactly once", () => {
    const targets = [
      "../files/Week%20One/R%C3%A9sum%C3%A9%20100%25.pdf",
      "../files/100%-complete.pdf",
      "../pages/topic%20one.html",
      "../files/%252e%252e/notes.txt",
    ];
    let index = 0;
    const document = parse(
      sanitizePageHtml(
        input(
          targets.map(() => '<a href="/known">Known</a>').join(""),
          () => targets[index++] ?? null,
        ),
      ),
    );

    expect(
      [...document.body.querySelectorAll("a")].map((anchor) =>
        anchor.getAttribute("href"),
      ),
    ).toEqual(targets);
    expectSafeOutputTree(document);
  });

  it("preserves benign semantic formatting without preserving unsafe state", () => {
    const document = parse(
      sanitizePageHtml(
        input(`
          <article><h1>Heading 🌍</h1><p class="lead" aria-describedby="note">Text <strong>bold</strong> <em>emphasis</em> <code>const x = 1;</code></p></article>
          <ul><li>One</li><li>Two</li></ul><ol start="3"><li>Three</li></ol>
          <table><caption>Data</caption><thead><tr><th scope="col">Name</th></tr></thead><tbody><tr><td colspan="2">Value</td></tr></tbody></table>
          <pre id="note">line 1\nline 2</pre><blockquote cite="https://remote.test/source">Quote</blockquote>
        `),
      ),
    );

    expect(document.body.querySelector("article h1")?.textContent).toBe(
      "Heading 🌍",
    );
    expect(document.body.querySelectorAll("li")).toHaveLength(3);
    expect(document.body.querySelector("ol")?.getAttribute("start")).toBe("3");
    expect(document.body.querySelector("th")?.getAttribute("scope")).toBe(
      "col",
    );
    expect(document.body.querySelector("td")?.getAttribute("colspan")).toBe(
      "2",
    );
    expect(
      document.body.querySelector("blockquote")?.hasAttribute("cite"),
    ).toBe(false);
    expectSafeOutputTree(document);
  });

  it("keeps a DOM-clobbering namespace and mutation corpus inert across repeated parses", () => {
    const dangerousNames = new Set([
      "__proto__",
      "attributes",
      "body",
      "constructor",
      "cookie",
      "documentElement",
      "forms",
      "parentNode",
    ]);
    let output = sanitizePageHtml(
      input(`
        <form id="forms"><input name="parentNode"><button formaction="https://remote.test/post">Send</button></form>
        <a id="__proto__" name="constructor" href="javascript:alert(1)">Clobber</a>
        <img id="attributes" name="cookie" src="https://remote.test/a.png" onerror="alert(1)">
        <svg><foreignObject><div id="body"><img src="https://remote.test/svg.png"></div></foreignObject></svg>
        <math><annotation-xml encoding="text/html"><img src="https://remote.test/math.png"></annotation-xml></math>
        <table><mglyph><style><!--</style><img title="--><img src=x onerror=alert(1)>"></table>
        <noscript><p title="</noscript><img src=https://remote.test/noscript.png>">Text</p></noscript>
      `),
    );

    for (let cycle = 0; cycle < 4; cycle += 1) {
      const document = parse(output);
      expectSafeOutputTree(document);
      expect(document.forms).toHaveLength(0);
      expect(document.body.querySelector("[name]")).toBeNull();
      for (const element of document.querySelectorAll("[id]")) {
        expect(dangerousNames.has(element.id)).toBe(false);
      }
      output = document.documentElement.outerHTML;
    }
  });
});
