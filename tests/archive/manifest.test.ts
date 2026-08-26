import { describe, expect, it } from "vitest";
import { buildManifest } from "../../src/archive/manifest";
import type { CoursePlan, ResourceOutcome } from "../../src/shared/model";
import {
  syntheticArchiveInput,
  syntheticArchiveOutcomes,
  syntheticArchivePlan,
  unknownFileResource,
} from "../fixtures/course-plan";

const CREATED_AT = "2026-08-16T12:00:00.000Z";

const copyPlan = (): CoursePlan => structuredClone(syntheticArchivePlan);
const copyOutcomes = (): ResourceOutcome[] =>
  structuredClone(syntheticArchiveOutcomes);

describe("buildManifest", () => {
  it.each([
    ["success", 25, null],
    ["unavailable", null, "not-found"],
  ] as const)(
    "records an unknown-size file with a %s outcome",
    (status, actualBytes, failureCategory) => {
      const resource = unknownFileResource();
      const plan: CoursePlan = {
        course: structuredClone(syntheticArchivePlan.course),
        modules: [],
        resources: [resource],
        advertisedBytes: 0,
      };
      const outcomes: ResourceOutcome[] = [
        { ...resource, status, actualBytes, failureCategory },
      ];

      const manifest = buildManifest(plan, outcomes, CREATED_AT);

      expect(manifest.schemaVersion).toBe(1);
      expect(manifest.totals).toMatchObject({
        success: status === "success" ? 1 : 0,
        unavailable: status === "unavailable" ? 1 : 0,
        advertisedBytes: 0,
        archivedBytes: actualBytes ?? 0,
      });
      expect(manifest.resources).toEqual([
        expect.objectContaining({
          key: "file:777",
          advertisedBytes: null,
          status,
          actualBytes,
          failureCategory,
        }),
      ]);
    },
  );

  it.each([
    [
      "another course",
      "https://frankfurtschool.instructure.com/courses/202/files/777/download",
    ],
    [
      "a query",
      "https://frankfurtschool.instructure.com/courses/101/files/777/download?verifier=synthetic",
    ],
    [
      "the known-size route",
      "https://frankfurtschool.instructure.com/files/777/download",
    ],
  ])("rejects an unknown-size file URL for %s", (_label, sourceUrl) => {
    const resource = { ...unknownFileResource(), sourceUrl };
    const plan: CoursePlan = {
      course: structuredClone(syntheticArchivePlan.course),
      modules: [],
      resources: [resource],
      advertisedBytes: 0,
    };
    const outcomes: ResourceOutcome[] = [
      {
        ...resource,
        status: "unavailable",
        actualBytes: null,
        failureCategory: "not-found",
      },
    ];

    expect(() => buildManifest(plan, outcomes, CREATED_AT)).toThrowError(
      TypeError,
    );
  });

  it.each(["0", "0777", "not-a-file-id"])(
    "rejects the non-canonical unknown-size file ID %s",
    (sourceId) => {
      const resource = {
        ...unknownFileResource(),
        key: `file:${sourceId}`,
        sourceId,
        sourceUrl: `https://frankfurtschool.instructure.com/courses/101/files/${sourceId}/download`,
      };
      const plan: CoursePlan = {
        course: structuredClone(syntheticArchivePlan.course),
        modules: [],
        resources: [resource],
        advertisedBytes: 0,
      };
      const outcomes: ResourceOutcome[] = [
        {
          ...resource,
          status: "unavailable",
          actualBytes: null,
          failureCategory: "not-found",
        },
      ];

      expect(() => buildManifest(plan, outcomes, CREATED_AT)).toThrowError(
        TypeError,
      );
    },
  );

  it("builds a deterministic privacy-safe manifest in plan order", () => {
    const manifest = buildManifest(copyPlan(), copyOutcomes(), CREATED_AT);

    expect(manifest).toEqual({
      schemaVersion: 1,
      gradPackVersion: "0.1.0-alpha.4",
      createdAt: CREATED_AT,
      canvasHost: "frankfurtschool.instructure.com",
      course: { id: 101, name: "Synthetic Course", courseCode: "SYN-101" },
      totals: {
        success: 2,
        failed: 0,
        unavailable: 0,
        unsupported: 1,
        external: 1,
        advertisedBytes: 19,
        archivedBytes: syntheticArchiveInput.manifest.totals.archivedBytes,
      },
      resources: expect.arrayContaining([
        expect.objectContaining({ key: "file:301", status: "success" }),
        expect.objectContaining({ key: "page:welcome", status: "success" }),
      ]),
    });
    expect(manifest.resources.map(({ key }) => key)).toEqual(
      syntheticArchivePlan.resources.map(({ key }) => key),
    );
    expect(JSON.stringify(manifest)).not.toContain("sourceUrl");
    expect(JSON.stringify(manifest)).not.toContain("verifier=");
  });

  it("deep-copies and freezes its result without mutating caller values", () => {
    const plan = copyPlan();
    const outcomes = copyOutcomes();
    const before = structuredClone({ plan, outcomes });
    const manifest = buildManifest(plan, outcomes, CREATED_AT);

    expect({ plan, outcomes }).toEqual(before);
    plan.course.name = "Changed later";
    outcomes[0]!.title = "Changed later";
    expect(manifest.course.name).toBe("Synthetic Course");
    expect(manifest.resources[0]!.title).toBe("slides.pdf");
    expect(Object.isFrozen(manifest)).toBe(true);
    expect(Object.isFrozen(manifest.resources)).toBe(true);
    expect(Object.isFrozen(manifest.resources[0])).toBe(true);
  });

  it.each([
    ["missing", (values: ResourceOutcome[]) => values.slice(1)],
    ["duplicate", (values: ResourceOutcome[]) => [...values, values[0]!]],
    [
      "extra",
      (values: ResourceOutcome[]) => [
        ...values,
        { ...values[0]!, key: "file:999", sourceId: "999" },
      ],
    ],
    [
      "mismatched kind",
      (values: ResourceOutcome[]) => [
        { ...values[0]!, kind: "page" as const },
        ...values.slice(1),
      ],
    ],
    [
      "mismatched path",
      (values: ResourceOutcome[]) => [
        { ...values[0]!, archivePath: "files/other.pdf" },
        ...values.slice(1),
      ],
    ],
    [
      "mismatched title",
      (values: ResourceOutcome[]) => [
        { ...values[0]!, title: "Other" },
        ...values.slice(1),
      ],
    ],
    [
      "mismatched source ID",
      (values: ResourceOutcome[]) => [
        { ...values[0]!, sourceId: "999" },
        ...values.slice(1),
      ],
    ],
    [
      "mismatched advertised bytes",
      (values: ResourceOutcome[]) => [
        { ...values[0]!, advertisedBytes: 20 },
        ...values.slice(1),
      ],
    ],
    [
      "mismatched file source URL",
      (values: ResourceOutcome[]) => [
        {
          ...values[0]!,
          sourceUrl:
            "https://frankfurtschool.instructure.com/files/301/download?verifier=other-synthetic",
        },
        ...values.slice(1),
      ],
    ],
    [
      "mismatched external source URL",
      (values: ResourceOutcome[]) => [
        ...values.slice(0, 2),
        {
          ...values[2]!,
          sourceUrl: "https://reference.example/other-reading",
        },
        ...values.slice(3),
      ],
    ],
    [
      "textually different external source URL",
      (values: ResourceOutcome[]) => [
        ...values.slice(0, 2),
        {
          ...values[2]!,
          sourceUrl: "https://REFERENCE.example/reading",
        },
        ...values.slice(3),
      ],
    ],
  ])("rejects a %s outcome set", (_label, change) => {
    expect(() =>
      buildManifest(copyPlan(), change(copyOutcomes()), CREATED_AT),
    ).toThrowError(TypeError);
  });

  it.each([
    ["bad declared total", (plan: CoursePlan) => (plan.advertisedBytes = 18)],
    [
      "over-limit total",
      (plan: CoursePlan) => {
        plan.resources[0]!.advertisedBytes = 250 * 1024 * 1024 + 1;
        plan.advertisedBytes = 250 * 1024 * 1024 + 1;
      },
    ],
    [
      "unsafe declared total",
      (plan: CoursePlan) =>
        (plan.advertisedBytes = Number.MAX_SAFE_INTEGER + 1),
    ],
  ])("rejects a %s", (_label, change) => {
    const plan = copyPlan();
    change(plan);
    expect(() => buildManifest(plan, copyOutcomes(), CREATED_AT)).toThrowError(
      TypeError,
    );
  });

  it.each([
    ["unsafe actual bytes", Number.MAX_SAFE_INTEGER + 1],
    ["negative actual bytes", -1],
  ])("rejects %s", (_label, actualBytes) => {
    const outcomes = copyOutcomes();
    outcomes[0]!.actualBytes = actualBytes;
    expect(() => buildManifest(copyPlan(), outcomes, CREATED_AT)).toThrowError(
      TypeError,
    );
  });

  it("rejects archived-byte total overflow", () => {
    const outcomes = copyOutcomes();
    outcomes[0]!.actualBytes = Number.MAX_SAFE_INTEGER;
    outcomes[1]!.actualBytes = 1;
    expect(() => buildManifest(copyPlan(), outcomes, CREATED_AT)).toThrowError(
      TypeError,
    );
  });

  it.each([
    ["case-fold collision", "files/SLIDES.PDF"],
    ["ancestor conflict", "files/slides.pdf/part.bin"],
  ])("rejects a planned archive-path %s", (_label, archivePath) => {
    const plan = copyPlan();
    plan.resources[1] = {
      ...plan.resources[1]!,
      kind: "file",
      sourceId: "302",
      archivePath,
      advertisedBytes: 0,
      sourceUrl: "https://frankfurtschool.instructure.com/files/302/download",
    };
    const outcomes = copyOutcomes();
    outcomes[1] = {
      ...plan.resources[1],
      status: "success",
      actualBytes: 0,
      failureCategory: null,
    };
    expect(() => buildManifest(plan, outcomes, CREATED_AT)).toThrowError(
      TypeError,
    );
  });

  it.each([
    ["success with a failure", "success", 19, "not-found"],
    ["failed with bytes", "failed", 1, "network-exhausted"],
    ["failed without category", "failed", null, null],
    ["unavailable with unknown category", "unavailable", null, "raw 403 body"],
    ["external file", "external", 0, null],
    ["unsupported page", "unsupported", 0, null],
  ])(
    "rejects invalid status combination: %s",
    (_label, status, actualBytes, failureCategory) => {
      const outcomes = copyOutcomes();
      Object.assign(outcomes[0]!, { status, actualBytes, failureCategory });
      expect(() =>
        buildManifest(copyPlan(), outcomes, CREATED_AT),
      ).toThrowError(TypeError);
    },
  );

  it.each([
    "2026-08-16T12:00:00Z",
    "2026-08-16T14:00:00.000+02:00",
    "2026-02-30T12:00:00.000Z",
    "2026-99-30T12:00:00.000Z",
    "not-a-date",
    new String(CREATED_AT),
  ])("rejects a non-canonical createdAt %#", (createdAt) => {
    expect(() =>
      buildManifest(copyPlan(), copyOutcomes(), createdAt as string),
    ).toThrowError(TypeError);
  });

  it("rejects inherited fields, accessors, and coercible scalar values", () => {
    const inherited = Object.create(copyOutcomes()[0]!) as ResourceOutcome;
    const outcomes = copyOutcomes();
    outcomes[0] = inherited;
    expect(() => buildManifest(copyPlan(), outcomes, CREATED_AT)).toThrowError(
      TypeError,
    );

    const accessor = copyOutcomes()[0]!;
    Object.defineProperty(accessor, "status", {
      get: () => "success",
      enumerable: true,
    });
    expect(() =>
      buildManifest(
        copyPlan(),
        [accessor, ...copyOutcomes().slice(1)],
        CREATED_AT,
      ),
    ).toThrowError(TypeError);

    const plan = copyPlan();
    plan.course.id = "101" as unknown as number;
    expect(() => buildManifest(plan, copyOutcomes(), CREATED_AT)).toThrowError(
      TypeError,
    );
  });

  it("reads each proxied resource data property only once", () => {
    const plan = copyPlan();
    const target = plan.resources[0]!;
    const reads = new Map<PropertyKey, number>();
    plan.resources[0] = new Proxy(target, {
      getOwnPropertyDescriptor(value, key) {
        const count = (reads.get(key) ?? 0) + 1;
        reads.set(key, count);
        if (count > 1) throw new Error("property read twice");
        return Reflect.getOwnPropertyDescriptor(value, key);
      },
    });

    expect(() => buildManifest(plan, copyOutcomes(), CREATED_AT)).not.toThrow();
    expect([...reads.values()].every((count) => count === 1)).toBe(true);
  });

  it("caps the total immutable resource plan before packaging", () => {
    const count = 65_533;
    const plan: CoursePlan = {
      course: structuredClone(syntheticArchivePlan.course),
      modules: [],
      advertisedBytes: 0,
      resources: Array.from({ length: count }, (_, index) => ({
        key: `unsupported:${index}`,
        kind: "unsupported",
        title: "Synthetic unsupported item",
        sourceId: String(index),
        archivePath: null,
        advertisedBytes: 0,
        sourceUrl: null,
      })),
    };
    const outcomes: ResourceOutcome[] = plan.resources.map((resource) => ({
      ...resource,
      status: "unsupported",
      actualBytes: 0,
      failureCategory: null,
    }));

    expect(() => buildManifest(plan, outcomes, CREATED_AT)).toThrowError(
      expect.objectContaining({
        name: "ArchiveSafetyError",
        message: "Archive resource limit exceeded",
      }),
    );
  });
});
