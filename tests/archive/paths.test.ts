import { describe, expect, it } from "vitest";
import { safeArchivePath } from "../../src/archive/paths";

describe("safeArchivePath", () => {
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
});
