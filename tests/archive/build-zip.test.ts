import { strFromU8, strToU8, unzipSync } from "fflate";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  buildCourseZip,
  downloadCourseZip,
  type ArchiveInput,
} from "../../src/archive/build-zip";
import { buildManifest } from "../../src/archive/manifest";
import {
  syntheticArchiveInput,
  syntheticArchiveOutcomes,
  syntheticArchivePlan,
} from "../fixtures/course-plan";

const copyInput = (): ArchiveInput => ({
  indexHtml: syntheticArchiveInput.indexHtml,
  archiveCss: syntheticArchiveInput.archiveCss,
  manifest: structuredClone(syntheticArchiveInput.manifest),
  entries: new Map(
    [...syntheticArchiveInput.entries].map(([path, bytes]) => [
      path,
      bytes.slice(),
    ]),
  ),
});

const zipHeaderMetadata = (
  bytes: Uint8Array,
): Array<{ path: string; time: number; date: number; os: number }> => {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const decoder = new TextDecoder();
  const records: Array<{
    path: string;
    time: number;
    date: number;
    os: number;
  }> = [];
  for (let offset = 0; offset <= bytes.byteLength - 46; offset += 1) {
    if (view.getUint32(offset, true) !== 0x02014b50) continue;
    const pathLength = view.getUint16(offset + 28, true);
    const path = decoder.decode(
      bytes.subarray(offset + 46, offset + 46 + pathLength),
    );
    records.push({
      path,
      time: view.getUint16(offset + 12, true),
      date: view.getUint16(offset + 14, true),
      os: view.getUint8(offset + 5),
    });
  }
  return records;
};

describe("buildCourseZip", () => {
  it("contains exactly the required core and successful payload entries", () => {
    const zip = unzipSync(buildCourseZip(copyInput()));

    expect(Object.keys(zip).sort()).toEqual([
      "assets/archive.css",
      "files/slides.pdf",
      "index.html",
      "manifest.json",
      "pages/welcome.html",
    ]);
    expect(strFromU8(zip["index.html"]!)).toBe(syntheticArchiveInput.indexHtml);
    expect(strFromU8(zip["assets/archive.css"]!)).toBe(
      syntheticArchiveInput.archiveCss,
    );
    expect(JSON.parse(strFromU8(zip["manifest.json"]!))).toEqual(
      syntheticArchiveInput.manifest,
    );
    expect(strFromU8(zip["files/slides.pdf"]!)).toBe("synthetic PDF bytes");
  });

  it("is byte-identical across time and entry insertion order with fixed metadata", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2035-01-01T01:02:03.000Z"));
    const first = buildCourseZip(copyInput());
    vi.setSystemTime(new Date("2040-06-07T08:09:10.000Z"));
    const reverse = copyInput();
    reverse.entries = new Map([...reverse.entries].reverse());
    const second = buildCourseZip(reverse);

    expect(second).toEqual(first);
    expect(zipHeaderMetadata(first).map(({ path }) => path)).toEqual([
      "assets/archive.css",
      "files/slides.pdf",
      "index.html",
      "manifest.json",
      "pages/welcome.html",
    ]);
    expect(zipHeaderMetadata(first).every(({ time }) => time === 0)).toBe(true);
    expect(zipHeaderMetadata(first).every(({ date }) => date === 0x2821)).toBe(
      true,
    );
    expect(zipHeaderMetadata(first).every(({ os }) => os === 3)).toBe(true);
  });

  it.each([
    "/files/root.txt",
    "files\\root.txt",
    "files/../root.txt",
    "files/bad\u0000name.txt",
    "files/CON",
    "files/trailing.",
    "assets/archive.css",
    "index.html",
    "manifest.json",
    "other/root.txt",
    "pages/slides.pdf",
  ])("rejects an unsafe, reserved, core, or wrong-prefix entry %#", (path) => {
    const input = copyInput();
    input.entries = new Map([[path, strToU8("synthetic")], ...input.entries]);
    expect(() => buildCourseZip(input)).toThrowError(TypeError);
  });

  it.each([
    ["case-fold collision", ["files/slides.pdf", "files/SLIDES.PDF"]],
    ["Unicode collision", ["files/slides.pdf", "files/ſlides.pdf"]],
    ["ancestor conflict", ["files/slides.pdf", "files/slides.pdf/part.bin"]],
  ])("rejects a %s", (_label, paths) => {
    const input = copyInput();
    input.entries = new Map(paths.map((path) => [path, strToU8("synthetic")]));
    expect(() => buildCourseZip(input)).toThrowError(TypeError);
  });

  it("rejects missing, extra, failed, and byte-length-mismatched payloads", () => {
    const missing = copyInput();
    missing.entries = new Map(
      [...missing.entries].filter(([path]) => path !== "files/slides.pdf"),
    );
    expect(() => buildCourseZip(missing)).toThrowError(TypeError);

    const extra = copyInput();
    extra.entries = new Map([
      ...extra.entries,
      ["files/extra.bin", strToU8("extra")],
    ]);
    expect(() => buildCourseZip(extra)).toThrowError(TypeError);

    const failed = copyInput();
    failed.manifest.resources[0] = {
      ...failed.manifest.resources[0]!,
      status: "failed",
      actualBytes: null,
      failureCategory: "not-found",
    };
    failed.manifest.totals.success -= 1;
    failed.manifest.totals.failed += 1;
    failed.manifest.totals.archivedBytes -= 19;
    expect(() => buildCourseZip(failed)).toThrowError(TypeError);

    const mismatch = copyInput();
    mismatch.entries = new Map(
      [...mismatch.entries].map(([path, bytes]) => [
        path,
        path === "files/slides.pdf" ? strToU8("short") : bytes,
      ]),
    );
    expect(() => buildCourseZip(mismatch)).toThrowError(TypeError);
  });

  it("rejects manifest total corruption and unsafe mutable byte views", () => {
    const total = copyInput();
    total.manifest.totals.archivedBytes += 1;
    expect(() => buildCourseZip(total)).toThrowError(TypeError);

    const shared = copyInput();
    shared.entries = new Map(
      [...shared.entries].map(([path, bytes]) => [
        path,
        path === "files/slides.pdf"
          ? new Uint8Array(new SharedArrayBuffer(19))
          : bytes,
      ]),
    );
    expect(() => buildCourseZip(shared)).toThrowError(TypeError);

    const subclass = copyInput();
    class UnsafeBytes extends Uint8Array {}
    subclass.entries = new Map(
      [...subclass.entries].map(([path, bytes]) => [
        path,
        path === "files/slides.pdf" ? new UnsafeBytes(19) : bytes,
      ]),
    );
    expect(() => buildCourseZip(subclass)).toThrowError(TypeError);
  });

  it("snapshots payload bytes and does not mutate archive input", () => {
    const input = copyInput();
    const payload = input.entries.get("files/slides.pdf")!;
    const before = structuredClone(input.manifest);
    const zip = buildCourseZip(input);
    payload.fill(0);

    expect(input.manifest).toEqual(before);
    expect(strFromU8(unzipSync(zip)["files/slides.pdf"]!)).toBe(
      "synthetic PDF bytes",
    );
  });

  it("rejects accessors and inherited ArchiveInput fields", () => {
    const inherited = Object.create(copyInput()) as ArchiveInput;
    expect(() => buildCourseZip(inherited)).toThrowError(TypeError);

    const accessor = copyInput();
    Object.defineProperty(accessor, "archiveCss", {
      get: () => "body{}",
      enumerable: true,
    });
    expect(() => buildCourseZip(accessor)).toThrowError(TypeError);
  });

  it("rejects active or remote-loading index HTML and CSS", () => {
    for (const indexHtml of [
      '<!doctype html><link rel="stylesheet" href="assets/archive.css"><script>alert(1)</script>',
      '<!doctype html><link rel="stylesheet" href="assets/archive.css"><img src="https://tracking.example/pixel">',
      '<!doctype html><link rel="stylesheet" href="https://tracking.example/archive.css">',
    ]) {
      const input = copyInput();
      input.indexHtml = indexHtml;
      expect(() => buildCourseZip(input)).toThrowError(TypeError);
    }
    for (const archiveCss of [
      '@import "https://tracking.example/archive.css";',
      "body{background:url(https://tracking.example/pixel)}",
      '@font-face{font-family:x;src:url("font.woff2")}',
    ]) {
      const input = copyInput();
      input.archiveCss = archiveCss;
      expect(() => buildCourseZip(input)).toThrowError(TypeError);
    }
  });

  it("accepts only a manifest produced from a valid one-to-one plan", () => {
    const input = copyInput();
    input.manifest = buildManifest(
      structuredClone(syntheticArchivePlan),
      structuredClone(syntheticArchiveOutcomes),
      "2026-08-16T12:00:00.000Z",
    );
    expect(() => buildCourseZip(input)).not.toThrow();
  });
});

describe("downloadCourseZip", () => {
  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it("downloads one snapshotted ZIP Blob and revokes after a browser task turn", async () => {
    vi.useFakeTimers();
    const createObjectURL = vi
      .spyOn(URL, "createObjectURL")
      .mockReturnValue("blob:synthetic");
    const revokeObjectURL = vi
      .spyOn(URL, "revokeObjectURL")
      .mockImplementation(() => {});
    const click = vi.fn();
    const createElement = vi
      .spyOn(document, "createElement")
      .mockReturnValue({ click } as unknown as HTMLAnchorElement);
    const bytes = strToU8("synthetic zip");

    downloadCourseZip("gradpack-synthetic-course.zip", bytes);
    bytes.fill(0);

    expect(createElement).toHaveBeenCalledOnce();
    expect(click).toHaveBeenCalledOnce();
    expect(revokeObjectURL).not.toHaveBeenCalled();
    const blob = createObjectURL.mock.calls[0]![0] as Blob;
    expect(blob.type).toBe("application/zip");
    expect(strFromU8(new Uint8Array(await blob.arrayBuffer()))).toBe(
      "synthetic zip",
    );
    await vi.runOnlyPendingTimersAsync();
    expect(revokeObjectURL).toHaveBeenCalledOnce();
    expect(revokeObjectURL).toHaveBeenCalledWith("blob:synthetic");
  });

  it("schedules revocation even when anchor setup or click throws", async () => {
    vi.useFakeTimers();
    vi.spyOn(URL, "createObjectURL").mockReturnValue("blob:synthetic");
    const revokeObjectURL = vi
      .spyOn(URL, "revokeObjectURL")
      .mockImplementation(() => {});
    vi.spyOn(document, "createElement").mockReturnValue({
      set href(_value: string) {
        throw new Error("synthetic setup failure");
      },
    } as HTMLAnchorElement);

    expect(() =>
      downloadCourseZip("gradpack-synthetic-course.zip", strToU8("zip")),
    ).toThrowError("synthetic setup failure");
    expect(revokeObjectURL).not.toHaveBeenCalled();
    await vi.runOnlyPendingTimersAsync();
    expect(revokeObjectURL).toHaveBeenCalledWith("blob:synthetic");
  });

  it("schedules revocation when the single download click throws", async () => {
    vi.useFakeTimers();
    vi.spyOn(URL, "createObjectURL").mockReturnValue("blob:synthetic");
    const revokeObjectURL = vi
      .spyOn(URL, "revokeObjectURL")
      .mockImplementation(() => {});
    const click = vi.fn(() => {
      throw new Error("synthetic click failure");
    });
    vi.spyOn(document, "createElement").mockReturnValue({
      click,
    } as unknown as HTMLAnchorElement);

    expect(() =>
      downloadCourseZip("gradpack-synthetic-course.zip", strToU8("zip")),
    ).toThrowError("synthetic click failure");
    expect(click).toHaveBeenCalledOnce();
    expect(revokeObjectURL).not.toHaveBeenCalled();
    await vi.runOnlyPendingTimersAsync();
    expect(revokeObjectURL).toHaveBeenCalledWith("blob:synthetic");
  });

  it.each([
    "../gradpack.zip",
    "folder/gradpack.zip",
    "folder\\gradpack.zip",
    "/gradpack.zip",
    "CON.zip",
    "gradpack.zip.",
    "gradpack.ZIP",
    "gradpack\u0000.zip",
    "gradpack．zip",
    `${"x".repeat(238)}.zip`,
    new String("gradpack.zip"),
  ])("rejects an unsafe ZIP basename %#", (fileName) => {
    expect(() =>
      downloadCourseZip(fileName as string, strToU8("zip")),
    ).toThrowError(TypeError);
  });
});
