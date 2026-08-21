import { describe, expect, it } from "vitest";
import { renderIndexPage } from "../../src/archive/index-page";
import { syntheticArchiveOutcomes, syntheticArchivePlan } from "../fixtures/course-plan";

describe("renderIndexPage", () => {
  it("keeps the compatibility API deterministic and Canvas-familiar", () => {
    const first = renderIndexPage(structuredClone(syntheticArchivePlan), structuredClone(syntheticArchiveOutcomes), "2026-08-16T12:00:00.000Z");
    const second = renderIndexPage(structuredClone(syntheticArchivePlan), structuredClone(syntheticArchiveOutcomes), "2026-08-16T12:00:00.000Z");
    const document = new DOMParser().parseFromString(first, "text/html");
    expect(first).toBe(second);
    expect(document.querySelector(".archive-layout")).not.toBeNull();
    expect(document.body.textContent).toContain("Synthetic Course");
    expect(document.querySelector("script, [onerror], [onclick]")).toBeNull();
  });

  it("rejects invalid plan/outcome correspondence", () => {
    expect(() => renderIndexPage(structuredClone(syntheticArchivePlan), structuredClone(syntheticArchiveOutcomes).slice(1), "2026-08-16T12:00:00.000Z")).toThrow(TypeError);
  });
});
