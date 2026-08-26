import { strFromU8, strToU8, unzipSync } from "fflate";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { runInNewContext } from "node:vm";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  buildCourseZip,
  downloadCourseZip,
  type ArchiveInput,
} from "../../src/archive/build-zip";
import {
  buildManifest,
  type ArchiveManifest,
} from "../../src/archive/manifest";
import {
  syntheticArchiveInput,
  syntheticArchiveOutcomes,
  syntheticArchivePlan,
} from "../fixtures/course-plan";

const copyInput = (): ArchiveInput => ({
  archiveRoot: syntheticArchiveInput.archiveRoot,
  pages: new Map(syntheticArchiveInput.pages),
  archiveCss: TRUSTED_ARCHIVE_CSS,
  manifest: structuredClone(syntheticArchiveInput.manifest),
  entries: new Map(
    [...syntheticArchiveInput.entries].map(([path, bytes]) => [
      path,
      bytes.slice(),
    ]),
  ),
});

const TRUSTED_ARCHIVE_CSS = readFileSync(
  resolve("src/static/archive.css"),
  "utf8",
);

type HeaderMetadata = {
  path: string;
  time: number;
  date: number;
  flags: number;
  os?: number;
  attrs?: number;
};

const zipHeaderMetadata = (bytes: Uint8Array): HeaderMetadata[] => {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const decoder = new TextDecoder();
  const records: HeaderMetadata[] = [];
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
      flags: view.getUint16(offset + 8, true),
      os: view.getUint8(offset + 5),
      attrs: view.getUint32(offset + 38, true),
    });
  }
  return records;
};

const localHeaderMetadata = (bytes: Uint8Array): HeaderMetadata[] => {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const decoder = new TextDecoder();
  const records: HeaderMetadata[] = [];
  let offset = 0;
  while (
    offset + 30 <= bytes.byteLength &&
    view.getUint32(offset, true) === 0x04034b50
  ) {
    const pathLength = view.getUint16(offset + 26, true);
    const extraLength = view.getUint16(offset + 28, true);
    const compressedSize = view.getUint32(offset + 18, true);
    records.push({
      path: decoder.decode(
        bytes.subarray(offset + 30, offset + 30 + pathLength),
      ),
      time: view.getUint16(offset + 10, true),
      date: view.getUint16(offset + 12, true),
      flags: view.getUint16(offset + 6, true),
    });
    offset += 30 + pathLength + extraLength + compressedSize;
  }
  return records;
};

const manifestWithResources = (
  count: number,
  status: "success" | "unsupported" = "success",
): ArchiveManifest => ({
  schemaVersion: 1,
  gradPackVersion: "0.1.0-alpha.5",
  createdAt: "2026-08-16T12:00:00.000Z",
  canvasHost: "frankfurtschool.instructure.com",
  course: { id: 101, name: "Synthetic Course", courseCode: "SYN-101" },
  totals: {
    success: status === "success" ? count : 0,
    failed: 0,
    unavailable: 0,
    unsupported: status === "unsupported" ? count : 0,
    external: 0,
    advertisedBytes: 0,
    archivedBytes: 0,
  },
  resources: Array.from({ length: count }, (_, index) => {
    const suffix = index.toString().padStart(5, "0");
    return status === "success"
      ? {
          key: `file:${suffix}`,
          kind: "file" as const,
          title: "Synthetic file",
          sourceId: suffix,
          archivePath: `files/item-${suffix}.bin`,
          advertisedBytes: 0,
          status: "success" as const,
          actualBytes: 0,
          failureCategory: null,
        }
      : {
          key: `unsupported:${suffix}`,
          kind: "unsupported" as const,
          title: "Synthetic unsupported item",
          sourceId: suffix,
          archivePath: null,
          advertisedBytes: 0,
          status: "unsupported" as const,
          actualBytes: 0,
          failureCategory: null,
        };
  }),
});

const inputAtPayloadCount = (count: number): ArchiveInput => {
  const input = copyInput();
  input.archiveCss = TRUSTED_ARCHIVE_CSS;
  input.manifest = manifestWithResources(count);
  const empty = new Uint8Array(0);
  input.entries = new Map(
    input.manifest.resources.map((resource) => [resource.archivePath!, empty]),
  );
  return input;
};

describe("buildCourseZip", () => {
  it("accepts exactly five generated course pages", () => {
    const input = copyInput();
    expect(() => buildCourseZip(input)).not.toThrow();
    (input.pages as Map<string, string>).delete("status.html");
    expect(() => buildCourseZip(input)).toThrow(TypeError);
  });

  it("contains exactly the required core and successful payload entries", () => {
    const zip = unzipSync(buildCourseZip(copyInput()));

    expect(Object.keys(zip).sort()).toEqual([
      "assets/archive.css",
      "files.html",
      "files/slides.pdf",
      "index.html",
      "manifest.json",
      "modules.html",
      "pages.html",
      "pages/welcome.html",
      "status.html",
    ]);
    expect(strFromU8(zip["index.html"]!)).toBe(
      syntheticArchiveInput.pages.get("index.html"),
    );
    expect(strFromU8(zip["assets/archive.css"]!)).toBe(TRUSTED_ARCHIVE_CSS);
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
      "files.html",
      "files/slides.pdf",
      "index.html",
      "manifest.json",
      "modules.html",
      "pages.html",
      "pages/welcome.html",
      "status.html",
    ]);
    expect(zipHeaderMetadata(first).every(({ time }) => time === 0)).toBe(true);
    expect(zipHeaderMetadata(first).every(({ date }) => date === 0x2821)).toBe(
      true,
    );
    expect(zipHeaderMetadata(first).every(({ os }) => os === 3)).toBe(true);
    expect(
      zipHeaderMetadata(first).every(
        ({ attrs, flags }) => attrs === 0o100644 * 65_536 && flags === 0,
      ),
    ).toBe(true);
    expect(localHeaderMetadata(first).map(({ path }) => path)).toEqual(
      zipHeaderMetadata(first).map(({ path }) => path),
    );
    expect(
      localHeaderMetadata(first).every(
        ({ time, date, flags }) => time === 0 && date === 0x2821 && flags === 0,
      ),
    ).toBe(true);
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
  });

  it("accepts genuine foreign ArrayBuffer bytes and rejects foreign SharedArrayBuffer bytes", () => {
    const foreignBytes = runInNewContext(
      `new Uint8Array([${[...strToU8("synthetic PDF bytes")].join(",")}])`,
    ) as Uint8Array;
    const accepted = copyInput();
    accepted.archiveCss = TRUSTED_ARCHIVE_CSS;
    accepted.entries = new Map([
      ...[...accepted.entries].filter(([path]) => path !== "files/slides.pdf"),
      ["files/slides.pdf", foreignBytes],
    ]);
    expect(
      strFromU8(unzipSync(buildCourseZip(accepted))["files/slides.pdf"]!),
    ).toBe("synthetic PDF bytes");

    const foreignShared = runInNewContext(
      "new Uint8Array(new SharedArrayBuffer(19))",
    ) as Uint8Array;
    const rejected = copyInput();
    rejected.archiveCss = TRUSTED_ARCHIVE_CSS;
    rejected.entries = new Map([
      ...[...rejected.entries].filter(([path]) => path !== "files/slides.pdf"),
      ["files/slides.pdf", foreignShared],
    ]);
    expect(() => buildCourseZip(rejected)).toThrowError(TypeError);
  });

  it("never reads byte constructors or species and rejects detached, proxied, and forged views", () => {
    const bytes = strToU8("synthetic PDF bytes");
    let constructorReads = 0;
    let speciesReads = 0;
    const speciesCarrier = function SyntheticSpeciesCarrier() {};
    Object.defineProperty(speciesCarrier, Symbol.species, {
      get() {
        speciesReads += 1;
        throw new Error("species accessed");
      },
    });
    Object.defineProperty(bytes, "constructor", {
      get() {
        constructorReads += 1;
        return speciesCarrier;
      },
    });
    const safe = copyInput();
    safe.archiveCss = TRUSTED_ARCHIVE_CSS;
    safe.entries = new Map([
      ...[...safe.entries].filter(([path]) => path !== "files/slides.pdf"),
      ["files/slides.pdf", bytes],
    ]);
    expect(() => buildCourseZip(safe)).not.toThrow();
    expect({ constructorReads, speciesReads }).toEqual({
      constructorReads: 0,
      speciesReads: 0,
    });

    const detached = strToU8("synthetic PDF bytes");
    structuredClone(detached.buffer, { transfer: [detached.buffer] });
    for (const invalid of [
      detached,
      new Proxy(strToU8("synthetic PDF bytes"), {}),
      Object.create(Uint8Array.prototype),
    ]) {
      const input = copyInput();
      input.archiveCss = TRUSTED_ARCHIVE_CSS;
      input.entries = new Map([
        ...[...input.entries].filter(([path]) => path !== "files/slides.pdf"),
        ["files/slides.pdf", invalid as Uint8Array],
      ]);
      expect(() => buildCourseZip(input)).toThrowError(TypeError);
    }
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

  it("snapshots each ArchiveInput own data property once", () => {
    const target = copyInput();
    const reads = new Map<PropertyKey, number>();
    const input = new Proxy(target, {
      getOwnPropertyDescriptor(value, key) {
        const count = (reads.get(key) ?? 0) + 1;
        reads.set(key, count);
        if (count > 1) throw new Error("archive input reread");
        return Reflect.getOwnPropertyDescriptor(value, key);
      },
    });

    expect(() => buildCourseZip(input)).not.toThrow();
    expect([...reads.values()].every((count) => count === 1)).toBe(true);
  });

  it("iterates a genuine payload Map without consulting caller iterator properties", () => {
    const input = copyInput();
    let iteratorReads = 0;
    Object.defineProperty(input.entries, Symbol.iterator, {
      get() {
        iteratorReads += 1;
        throw new Error("caller iterator accessed");
      },
    });

    expect(() => buildCourseZip(input)).not.toThrow();
    expect(iteratorReads).toBe(0);
  });

  it("accepts only the exact bundled CSS bytes", () => {
    const accepted = copyInput();
    accepted.archiveCss = TRUSTED_ARCHIVE_CSS;
    expect(() => buildCourseZip(accepted)).not.toThrow();

    for (const archiveCss of [
      `${TRUSTED_ARCHIVE_CSS}\n/* harmless-looking drift */`,
      "@\\69mport 'https://tracking.example/archive.css';",
      "body{background:u\\72l(https://tracking.example/pixel)}",
      "body{background-image:image-set('https://tracking.example/pixel' 1x)}",
      "body{c\\6fntent:'synthetic'}",
      "/* @im/**/port */ body{}",
    ]) {
      const input = copyInput();
      input.archiveCss = archiveCss;
      expect(() => buildCourseZip(input)).toThrowError(TypeError);
    }
  });

  it("rejects every non-renderer index structure and URL-bearing legacy attribute", () => {
    const trusted = copyInput().pages.get("index.html")!;
    for (const indexHtml of [
      trusted.replace(
        "<main>",
        '<main><table background="https://tracking.example/pixel"><tr><td>x</td></tr></table>',
      ),
      trusted.replace(
        "<main>",
        '<main><a href="https://reference.example/reading" rel="noopener noreferrer" ping="https://tracking.example/ping">Reference</a>',
      ),
      trusted.replace("<main>", "<main><custom-widget>unsafe</custom-widget>"),
      trusted.replace(
        "<head>",
        '<head><meta name="referrer" content="unsafe-url">',
      ),
      trusted.replace(
        "<head>",
        '<head><base href="https://tracking.example/">',
      ),
      trusted.replace(
        "<main>",
        '<main><blockquote cite="https://tracking.example/source">Text</blockquote>',
      ),
      trusted.replace(
        "<main>",
        '<main><div formaction="https://tracking.example/action">Text</div>',
      ),
      trusted.replace(
        "<main>",
        '<main><svg><a href="https://tracking.example/">x</a></svg>',
      ),
      trusted.replace(
        "<main>",
        '<main><link rel="stylesheet" href="https://tracking.example/archive.css">',
      ),
      trusted.replace(
        "<main>",
        '<main><meta http-equiv="refresh" content="0;url=https://tracking.example/">',
      ),
    ]) {
      const input = copyInput();
      input.archiveCss = TRUSTED_ARCHIVE_CSS;
      (input.pages as Map<string, string>).set("index.html", indexHtml);
      expect(() => buildCourseZip(input)).toThrowError(TypeError);
    }
  });

  it("rejects a generated link whose local target is absent", () => {
    const input = copyInput();
    const trusted = input.pages.get("index.html")!;
    (input.pages as Map<string, string>).set(
      "index.html",
      trusted.replace(
        "<main>",
        '<main><a href="files/missing.bin">Missing</a>',
      ),
    );
    expect(() => buildCourseZip(input)).toThrow(TypeError);
  });

  it("rejects local links that escape the archive root or use excess traversal", () => {
    for (const href of ["../../../index.html", "files/../files/slides.pdf"]) {
      const input = copyInput();
      const trusted = input.pages.get("index.html")!;
      (input.pages as Map<string, string>).set(
        "index.html",
        trusted.replace("<main>", `<main><a href="${href}">Unsafe</a>`),
      );
      expect(() => buildCourseZip(input)).toThrow(TypeError);
    }
  });

  it("rejects a network-bearing background attribute on the actual body element", () => {
    const input = copyInput();
    const document = new DOMParser().parseFromString(
      input.pages.get("index.html")!,
      "text/html",
    );
    document.body.setAttribute("background", "https://tracking.example/pixel");
    (input.pages as Map<string, string>).set(
      "index.html",
      `<!doctype html>${document.documentElement.outerHTML}`,
    );

    expect(() => buildCourseZip(input)).toThrowError(TypeError);
  });

  it.each([
    ["duplicate", "files/slides.pdf", "failed"],
    ["case-fold", "files/SLIDES.PDF", "unavailable"],
    ["Unicode-equivalent", "files/ſlides.pdf", "failed"],
    ["descendant", "files/slides.pdf/part.bin", "unavailable"],
  ])(
    "rejects a successful vs non-payload %s manifest path",
    (_label, archivePath, status) => {
      const input = copyInput();
      input.archiveCss = TRUSTED_ARCHIVE_CSS;
      input.manifest.resources[1] = {
        ...input.manifest.resources[1]!,
        kind: "file",
        archivePath,
        status: status as "failed" | "unavailable",
        actualBytes: null,
        failureCategory: "not-found",
      };
      input.manifest.totals.success -= 1;
      input.manifest.totals[status as "failed" | "unavailable"] += 1;
      input.manifest.totals.archivedBytes -=
        syntheticArchiveOutcomes[1]?.actualBytes ?? 0;
      input.entries = new Map(
        [...input.entries].filter(([path]) => path !== "pages/welcome.html"),
      );
      expect(() => buildCourseZip(input)).toThrowError(TypeError);
    },
  );

  it("rejects a non-payload ancestor of a successful path", () => {
    const input = copyInput();
    input.archiveCss = TRUSTED_ARCHIVE_CSS;
    input.manifest.resources[0]!.archivePath = "files/folder/slides.pdf";
    input.manifest.resources[1] = {
      ...input.manifest.resources[1]!,
      kind: "file",
      archivePath: "files/folder",
      status: "failed",
      actualBytes: null,
      failureCategory: "not-found",
    };
    input.manifest.totals.success -= 1;
    input.manifest.totals.failed += 1;
    input.manifest.totals.archivedBytes -=
      syntheticArchiveOutcomes[1]?.actualBytes ?? 0;
    input.entries = new Map([
      ["files/folder/slides.pdf", strToU8("synthetic PDF bytes")],
    ]);
    expect(() => buildCourseZip(input)).toThrowError(TypeError);
  });

  it("rejects 65,529 total resources before ZIP construction", () => {
    const input = copyInput();
    input.archiveCss = TRUSTED_ARCHIVE_CSS;
    input.manifest = manifestWithResources(65_529, "unsupported");
    input.entries = new Map();

    expect(() => buildCourseZip(input)).toThrowError(
      expect.objectContaining({
        name: "ArchiveSafetyError",
        message: "Archive resource limit exceeded",
      }),
    );
  });

  it("accepts exactly 65,528 payloads under the reserved core-entry limit", () => {
    const zip = buildCourseZip(inputAtPayloadCount(65_528));
    const view = new DataView(zip.buffer, zip.byteOffset, zip.byteLength);
    const eocd = zip.byteLength - 22;
    expect(view.getUint32(eocd, true)).toBe(0x06054b50);
    expect(view.getUint16(eocd + 8, true)).toBe(65_535);
    expect(view.getUint16(eocd + 10, true)).toBe(65_535);
  }, 30_000);

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
