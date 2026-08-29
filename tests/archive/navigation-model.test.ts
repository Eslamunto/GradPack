import { describe, expect, it } from "vitest";
import { buildArchiveNavigationModel } from "../../src/archive/navigation-model";
import type { CourseArchivePartPlan } from "../../src/shared/model";
import {
  syntheticArchiveOutcomes,
  syntheticArchivePlan,
} from "../fixtures/course-plan";

describe("archive navigation model", () => {
  it("represents resources assigned to another part without a local path", () => {
    const part: CourseArchivePartPlan = {
      index: 1,
      total: 2,
      resourceKeys: ["file:301", "external:401", "unsupported:501"],
      resourceParts: [
        { resourceKey: "file:301", partIndex: 1 },
        { resourceKey: "page:welcome", partIndex: 2 },
        { resourceKey: "external:401", partIndex: 1 },
        { resourceKey: "unsupported:501", partIndex: 1 },
      ],
    };
    const outcomes = structuredClone(syntheticArchiveOutcomes).filter(
      ({ key }) => key !== "page:welcome",
    );

    const model = buildArchiveNavigationModel(
      structuredClone(syntheticArchivePlan),
      outcomes,
      "2026-08-21T12:00:00.000Z",
      part,
    );

    expect(model.resourceByKey("page:welcome")).toMatchObject({
      status: "other-part",
      archivePath: null,
      availableInPart: 2,
    });
    expect(model.modules[0]?.items[0]?.resource?.status).toBe("success");
  });

  it("creates a deeply frozen renderer model with resource lookups", () => {
    const plan = structuredClone(syntheticArchivePlan);
    plan.modules[0]!.items[0]!.indent = 2;
    const model = buildArchiveNavigationModel(
      plan,
      structuredClone(syntheticArchiveOutcomes),
      "2026-08-21T12:00:00.000Z",
    );

    expect(Object.isFrozen(model)).toBe(true);
    expect(Object.isFrozen(model.modules[0]?.items)).toBe(true);
    expect(model.modules[0]?.items[0]?.indent).toBe(2);
    expect(model.resourceByKey("file:301")?.status).toBe("success");
    expect(model.resourceByKey("missing")).toBeNull();
  });

  it("rejects an invalid plan/outcome correspondence", () => {
    expect(() =>
      buildArchiveNavigationModel(
        structuredClone(syntheticArchivePlan),
        structuredClone(syntheticArchiveOutcomes).slice(1),
        "2026-08-21T12:00:00.000Z",
      ),
    ).toThrow(TypeError);
  });

  it("rejects module indentation outside Canvas levels zero through five", () => {
    const plan = structuredClone(syntheticArchivePlan);
    plan.modules[0]!.items[0]!.indent = 6;
    expect(() =>
      buildArchiveNavigationModel(
        plan,
        structuredClone(syntheticArchiveOutcomes),
        "2026-08-21T12:00:00.000Z",
      ),
    ).toThrow(TypeError);
  });
});
