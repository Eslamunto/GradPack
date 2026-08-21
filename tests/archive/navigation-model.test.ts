import { describe, expect, it } from "vitest";
import { buildArchiveNavigationModel } from "../../src/archive/navigation-model";
import {
  syntheticArchiveOutcomes,
  syntheticArchivePlan,
} from "../fixtures/course-plan";

describe("archive navigation model", () => {
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
