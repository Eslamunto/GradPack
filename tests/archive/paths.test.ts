import { describe, expect, it } from "vitest";
import { safeArchivePath } from "../../src/archive/paths";

describe("safeArchivePath", () => {
  it.each([
    [["files", "..", "secret.txt"], "files/_/secret.txt"],
    [["files", "CON"], "files/_CON"],
    [["files", "a/b\\c.txt"], "files/a_b_c.txt"],
    [["pages", ""], "pages/untitled"],
  ])("confines synthetic segments %#", (segments, expected) => {
    expect(safeArchivePath(...segments)).toBe(expected);
  });

  it("rejects non-string segments without coercion", () => {
    expect(() => safeArchivePath("files", 7 as unknown as string)).toThrowError(
      "Invalid archive segment",
    );
  });

  it.each([
    ["../secret", ".._secret"],
    ["CON", "_CON"],
    ["a/b\\c", "a_b_c"],
    ["", "untitled"],
    ["e\u0301", "é"],
  ])("normalizes %j", (input, expected) => {
    expect(safeArchivePath(input)).toBe(expected);
  });

  it("returns only relative cross-platform-safe paths", () => {
    const path = safeArchivePath("/root", "..", "bad:<name>?. ");

    expect(path).toBe("_root/_/bad__name__");
    expect(path.startsWith("/")).toBe(false);
    expect(path.includes("../")).toBe(false);
    expect(
      Array.from(path).some((character) => {
        const code = character.codePointAt(0) ?? 0;
        return code <= 31 || code === 127 || '<>:"\\|?*'.includes(character);
      }),
    ).toBe(false);
  });

  it("deterministically bounds excessive paths to 240 characters", () => {
    const segments = Array.from(
      { length: 12 },
      (_, index) => `${index}-${"x".repeat(80)}`,
    );

    const first = safeArchivePath(...segments);
    const second = safeArchivePath(...segments);

    expect(first).toBe(second);
    expect(first.length).toBeLessThanOrEqual(240);
    expect(first.split("/")[0]).toBe(segments[0]);
  });

  it.each([
    ["safe\u202Ename", "safe_name"],
    ["safe\u2066name", "safe_name"],
    ["safe\ud800name", "safe_name"],
  ])(
    "neutralizes Unicode format and surrogate controls in %j",
    (input, expected) => {
      expect(safeArchivePath(input)).toBe(expected);
    },
  );
});
