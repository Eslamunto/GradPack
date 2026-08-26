import { describe, expect, it } from "vitest";
import { renderArchiveShell } from "../../src/archive/shell";

describe("archive shell", () => {
  it("renders semantic working navigation and a trusted content slot", () => {
    const html = renderArchiveShell({
      pagePath: "modules.html",
      pageKind: "modules",
      title: "Modules",
      course: { name: "Synthetic Course", courseCode: "SYN-101" },
      combinedHomeHref: null,
      contentHtml: "<h1>Modules</h1><p>Safe content</p>",
    });
    const document = new DOMParser().parseFromString(html, "text/html");

    expect(document.querySelector('a[href="#archive-main"]')).not.toBeNull();
    expect(document.querySelector('main[id="archive-main"]')).not.toBeNull();
    expect(document.querySelector('[aria-current="page"]')?.textContent).toBe(
      "Modules",
    );
    expect(document.querySelector('a[href="index.html"]')).not.toBeNull();
    expect(
      [...document.querySelectorAll("a.courses-home-link")].map((link) => ({
        href: link.getAttribute("href"),
        text: link.textContent,
      })),
    ).toEqual([
      { href: "index.html", text: "Courses" },
      { href: "index.html", text: "Courses" },
    ]);
    expect(document.querySelector("script, style, iframe, form")).toBeNull();
    expect(document.querySelector("main")?.textContent).toContain(
      "Safe content",
    );
  });

  it("escapes shell text and resolves links from saved pages", () => {
    const document = new DOMParser().parseFromString(
      renderArchiveShell({
        pagePath: "pages/welcome.html",
        pageKind: "saved-page",
        title: '<script id="x">bad</script>',
        course: { name: '<img id="x">', courseCode: "SYN" },
        combinedHomeHref: "../../../index.html",
        contentHtml: "<h1>Trusted content</h1>",
      }),
      "text/html",
    );
    expect(document.querySelector("script, img")).toBeNull();
    expect(document.querySelector('a[href="../modules.html"]')).not.toBeNull();
    expect(
      document.querySelector('a[href="../../../index.html"]'),
    ).not.toBeNull();
    expect(
      [...document.querySelectorAll("a.courses-home-link")].map((link) =>
        link.getAttribute("href"),
      ),
    ).toEqual(["../../../index.html", "../../../index.html"]);
    expect(document.querySelector('[aria-current="page"]')?.textContent).toBe(
      "Pages",
    );
  });
});
