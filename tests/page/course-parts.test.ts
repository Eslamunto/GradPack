import { describe, expect, it } from "vitest";
import { partFileName, partitionCoursePlan } from "../../src/page/course-parts";
import {
  MAX_ARCHIVED_PAGE_BYTES,
  MAX_ARCHIVE_BYTES,
} from "../../src/shared/constants";
import type { CoursePlan, PlannedResource } from "../../src/shared/model";
import { syntheticCourse } from "../fixtures/course-plan";

const file = (id: number, advertisedBytes: number | null): PlannedResource => ({
  key: `file:${id}`,
  kind: "file",
  title: `file-${id}.bin`,
  sourceId: String(id),
  archivePath: `files/file-${id}.bin`,
  advertisedBytes,
  sourceUrl:
    advertisedBytes === null
      ? `https://frankfurtschool.instructure.com/courses/${syntheticCourse.id}/files/${id}/download`
      : `https://frankfurtschool.instructure.com/files/${id}/download`,
});

const page = (id: number): PlannedResource => ({
  key: `page:page-${id}`,
  kind: "page",
  title: `Page ${id}`,
  sourceId: `page-${id}`,
  archivePath: `pages/page-${id}.html`,
  advertisedBytes: 0,
  sourceUrl: null,
});

const external = (id: number): PlannedResource => ({
  key: `external:${id}`,
  kind: "external",
  title: `Reference ${id}`,
  sourceId: String(id),
  archivePath: null,
  advertisedBytes: 0,
  sourceUrl: `https://reference.example/${id}`,
});

const unsupported = (id: number): PlannedResource => ({
  key: `unsupported:${id}`,
  kind: "unsupported",
  title: `Unsupported ${id}`,
  sourceId: String(id),
  archivePath: null,
  advertisedBytes: 0,
  sourceUrl: null,
});

const plan = (resources: PlannedResource[]): CoursePlan => ({
  course: { ...syntheticCourse },
  moduleDiscovery: "available",
  modules: [],
  resources: resources.map((resource) => ({ ...resource })),
  folderPathFallbackKeys: [],
  advertisedBytes: resources.reduce(
    (total, resource) =>
      total + (resource.kind === "file" ? (resource.advertisedBytes ?? 0) : 0),
    0,
  ),
});

describe("partitionCoursePlan", () => {
  it("keeps an exact-limit file in one part", () => {
    expect(
      partitionCoursePlan(plan([file(1, MAX_ARCHIVE_BYTES)])),
    ).toMatchObject([{ index: 1, total: 1, resourceKeys: ["file:1"] }]);
  });

  it("splits known files in canonical next-fit order", () => {
    expect(
      partitionCoursePlan(plan([file(1, MAX_ARCHIVE_BYTES), file(2, 1)])).map(
        (part) => part.resourceKeys.slice(),
      ),
    ).toEqual([["file:1"], ["file:2"]]);
  });

  it("isolates unknown and individually oversized files", () => {
    expect(
      partitionCoursePlan(
        plan([
          file(1, 1),
          file(2, null),
          file(3, 1),
          file(4, MAX_ARCHIVE_BYTES + 1),
        ]),
      ).map((part) => part.resourceKeys.slice()),
    ).toEqual([["file:1"], ["file:2"], ["file:3"], ["file:4"]]);
  });

  it("uses the enforced archived-page bound for partitioning", () => {
    const perPart = Math.floor(MAX_ARCHIVE_BYTES / MAX_ARCHIVED_PAGE_BYTES);
    const parts = partitionCoursePlan(
      plan(Array.from({ length: perPart + 1 }, (_, index) => page(index + 1))),
    );

    expect(parts).toHaveLength(2);
    expect(parts[0]?.resourceKeys).toHaveLength(perPart);
    expect(parts[1]?.resourceKeys).toEqual([`page:page-${perPart + 1}`]);
  });

  it("assigns external and unsupported entries to part one", () => {
    const parts = partitionCoursePlan(
      plan([
        file(1, MAX_ARCHIVE_BYTES),
        external(2),
        file(3, 1),
        unsupported(4),
      ]),
    );

    expect(parts.map((part) => part.resourceKeys.slice())).toEqual([
      ["file:1", "external:2", "unsupported:4"],
      ["file:3"],
    ]);
  });

  it("produces one empty frozen part and deterministic assignments", () => {
    const source = plan([]);
    const first = partitionCoursePlan(source);
    const second = partitionCoursePlan(source);

    expect(first).toEqual(second);
    expect(first).toMatchObject([
      { index: 1, total: 1, resourceKeys: [], resourceParts: [] },
    ]);
    expect(Object.isFrozen(first)).toBe(true);
    expect(Object.isFrozen(first[0])).toBe(true);
    expect(Object.isFrozen(first[0]?.resourceKeys)).toBe(true);
    expect(Object.isFrozen(first[0]?.resourceParts)).toBe(true);
  });

  it("maps every resource exactly once to its part", () => {
    const parts = partitionCoursePlan(
      plan([file(1, MAX_ARCHIVE_BYTES), external(2), file(3, 1)]),
    );

    expect(parts[0]?.resourceParts).toEqual([
      { resourceKey: "file:1", partIndex: 1 },
      { resourceKey: "external:2", partIndex: 1 },
      { resourceKey: "file:3", partIndex: 2 },
    ]);
    expect(parts[1]?.resourceParts).toEqual(parts[0]?.resourceParts);
  });
});

describe("partFileName", () => {
  it("keeps one-part filenames and adds a padded multipart suffix", () => {
    expect(partFileName("gradpack-synthetic.zip", { index: 1, total: 1 })).toBe(
      "gradpack-synthetic.zip",
    );
    expect(
      partFileName("gradpack-synthetic.zip", { index: 2, total: 12 }),
    ).toBe("gradpack-synthetic-part-02-of-12.zip");
  });

  it.each([
    ["gradpack-synthetic", { index: 1, total: 2 }],
    ["gradpack-synthetic.zip", { index: 0, total: 2 }],
    ["gradpack-synthetic.zip", { index: 3, total: 2 }],
  ])("rejects an invalid filename or part descriptor", (name, part) => {
    expect(() => partFileName(name, part)).toThrow(TypeError);
  });
});
