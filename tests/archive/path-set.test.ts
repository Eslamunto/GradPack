import { describe, expect, it } from "vitest";
import { assertArchivePathSet } from "../../src/archive/paths";

describe("assertArchivePathSet", () => {
  it("rejects equality and ancestor conflicts in either direction", () => {
    expect(() =>
      assertArchivePathSet([
        { kind: "file", archivePath: "files/Folder/report.pdf" },
        { kind: "file", archivePath: "files/folder/REPORT.PDF" },
      ]),
    ).toThrowError(TypeError);
    expect(() =>
      assertArchivePathSet([
        { kind: "file", archivePath: "files/folder" },
        { kind: "file", archivePath: "files/folder/report.pdf" },
      ]),
    ).toThrowError(TypeError);
    expect(() =>
      assertArchivePathSet([
        { kind: "file", archivePath: "files/folder/report.pdf" },
        { kind: "file", archivePath: "files/folder" },
      ]),
    ).toThrowError(TypeError);
  });

  it("validates a large unique path set without pairwise scanning", () => {
    const paths = Array.from({ length: 30_000 }, (_, index) => ({
      kind: "page" as const,
      archivePath: `pages/topic-${index.toString().padStart(5, "0")}.html`,
    }));

    expect(() => assertArchivePathSet(paths)).not.toThrow();
  }, 3_000);
});
