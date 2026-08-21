import { strFromU8, unzipSync } from "fflate";
import { describe, expect, it } from "vitest";
import { runSyntheticPilot } from "../fixtures/course-plan";

type GateManifest = {
  totals: Record<string, number>;
  resources: Array<{
    key: string;
    kind: string;
    status: string;
    failureCategory: string | null;
    actualBytes: number | null;
  }>;
};

describe("one-course classmate pilot Gate C", () => {
  it("runs the production pipeline within strict request bounds", async () => {
    const result = await runSyntheticPilot();
    const zip = unzipSync(result.zipBytes);
    const manifest = JSON.parse(
      strFromU8(zip["manifest.json"]!),
    ) as GateManifest;
    const page = strFromU8(zip["pages/welcome.html"]!);

    expect(
      result.requestedUrls.map(({ pathname, search }) => pathname + search),
    ).toEqual([
      "/api/v1/courses/101/modules?include%5B%5D=items&include%5B%5D=content_details&per_page=100",
      "/api/v1/courses/101/files?per_page=100",
      "/api/v1/courses/101/folders?per_page=100",
      "/api/v1/courses/101/pages?per_page=100",
      "/files/301/download?verifier=synthetic-boundary-marker",
      "/api/v1/courses/101/pages/welcome",
    ]);
    expect(result.maximumConcurrency).toBeLessThanOrEqual(2);
    expect(result.maximumConcurrency).toBeGreaterThanOrEqual(2);
    expect(result.requestHeaders).toEqual([
      [["accept", "application/json"]],
      [["accept", "application/json"]],
      [["accept", "application/json"]],
      [["accept", "application/json"]],
      [],
      [["accept", "application/json"]],
    ]);
    expect(
      result.requestedUrls.filter(
        ({ search }) => search === "?verifier=synthetic-boundary-marker",
      ),
    ).toHaveLength(1);
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
    expect(strFromU8(zip["index.html"]!)).toContain("Synthetic Course");
    expect(page).toContain("../files/slides.pdf");
    expect(page).not.toMatch(/script|alert|onerror|javascript:/iu);
    expect(manifest.totals).toMatchObject({
      success: 2,
      failed: 0,
      unavailable: 0,
      unsupported: 0,
      external: 0,
    });
    expect(manifest.resources).toHaveLength(2);
    expect(new Set(manifest.resources.map(({ key }) => key)).size).toBe(2);
    expect(
      Object.values(manifest.totals)
        .slice(0, 5)
        .reduce((total, value) => total + value, 0),
    ).toBe(2);
    expect(
      manifest.resources.every((resource) =>
        [
          "success",
          "failed",
          "unavailable",
          "unsupported",
          "external",
        ].includes(String(resource.status)),
      ),
    ).toBe(true);
    const serialized = Object.entries(zip)
      .map(([path, bytes]) => `${path}\n${strFromU8(bytes)}`)
      .join("\n");
    expect(serialized).not.toMatch(
      /authorization|cookie|synthetic-boundary-marker|student identity/iu,
    );
  });

  it("records a safe terminal outcome when a resource is unavailable", async () => {
    const result = await runSyntheticPilot({ unavailableFile: true });
    const zip = unzipSync(result.zipBytes);
    const manifest = JSON.parse(
      strFromU8(zip["manifest.json"]!),
    ) as GateManifest;

    expect(zip["files/slides.pdf"]).toBeUndefined();
    expect(manifest.totals).toMatchObject({
      success: 1,
      failed: 0,
      unavailable: 1,
    });
    expect(manifest.resources).toHaveLength(2);
    expect(manifest.resources).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          kind: "file",
          status: "unavailable",
          failureCategory: "not-found",
          actualBytes: null,
        }),
      ]),
    );
  });
});
