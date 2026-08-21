import { describe, expect, it } from "vitest";
import {
  COURSE_HTML_PATHS,
  relativeArchiveHref,
} from "../../src/archive/archive-links";

describe("archive links", () => {
  it("defines the five fixed course pages", () => {
    expect(COURSE_HTML_PATHS).toEqual([
      "files.html",
      "index.html",
      "modules.html",
      "pages.html",
      "status.html",
    ]);
  });

  it("resolves canonical encoded links at different depths", () => {
    expect(relativeArchiveHref("pages/welcome.html", "modules.html")).toBe(
      "../modules.html",
    );
    expect(relativeArchiveHref("index.html", "files/Résumé 100%.pdf")).toBe(
      "files/R%C3%A9sum%C3%A9%20100%25.pdf",
    );
  });

  it("rejects unsafe source or target paths", () => {
    expect(() => relativeArchiveHref("../escape.html", "index.html")).toThrow(
      TypeError,
    );
    expect(() => relativeArchiveHref("index.html", "../escape.html")).toThrow(
      TypeError,
    );
  });
});
