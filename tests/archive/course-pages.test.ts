import { describe, expect, it } from "vitest";
import { renderCoursePages } from "../../src/archive/course-pages";
import { buildArchiveNavigationModel } from "../../src/archive/navigation-model";
import { COURSE_HTML_PATHS } from "../../src/archive/archive-links";
import type { CourseArchivePartPlan } from "../../src/shared/model";
import {
  syntheticArchiveOutcomes,
  syntheticArchivePlan,
} from "../fixtures/course-plan";

describe("course pages", () => {
  it("labels the active part, cross-part resources, and unfiled fallback", () => {
    const plan = structuredClone(syntheticArchivePlan);
    plan.folderPathFallbackKeys = ["file:301"];
    plan.resources[0]!.archivePath = "files/unfiled/slides.pdf";
    const outcomes = structuredClone(syntheticArchiveOutcomes)
      .filter(({ key }) => key !== "page:welcome")
      .map((outcome) =>
        outcome.key === "file:301"
          ? { ...outcome, archivePath: "files/unfiled/slides.pdf" }
          : outcome,
      );
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
    const pages = renderCoursePages(
      buildArchiveNavigationModel(
        plan,
        outcomes,
        "2026-08-21T12:00:00.000Z",
        part,
      ),
    );

    expect(
      [...pages.values()].every((html) => html.includes("Part 1 of 2")),
    ).toBe(true);
    expect(pages.get("pages.html")).toContain("Available in Part 2");
    expect(pages.get("pages.html")).not.toContain('href="pages/welcome.html"');
    expect(pages.get("index.html")).toContain("files/unfiled/");
    expect(pages.get("status.html")).toContain("Complete course resources");
  });

  it("renders all deterministic destinations and resource outcomes", () => {
    const pages = renderCoursePages(
      buildArchiveNavigationModel(
        structuredClone(syntheticArchivePlan),
        structuredClone(syntheticArchiveOutcomes),
        "2026-08-21T12:00:00.000Z",
      ),
    );
    expect([...pages.keys()].sort()).toEqual([...COURSE_HTML_PATHS]);
    expect(pages.get("modules.html")).toContain("Module One");
    expect(pages.get("modules.html")).toContain("files/slides.pdf");
    expect(pages.get("pages.html")).toContain("Welcome");
    expect(pages.get("files.html")).toContain("slides.pdf");
    expect(pages.get("files.html")).toContain("19 bytes");
    expect(pages.get("files.html")).toContain("Modules: Module One");
    expect(pages.get("status.html")).toContain("Archive status");
    expect(pages.get("status.html")).toContain("Resource outcomes");
    expect(pages.get("status.html")).toContain("Unsupported");
    expect([...pages.values()].every((html) => !html.includes("<script"))).toBe(
      true,
    );
  });

  it("discloses disabled module navigation throughout the archive", () => {
    const plan = {
      ...structuredClone(syntheticArchivePlan),
      moduleDiscovery: "disabled" as const,
      modules: [],
    };
    const pages = renderCoursePages(
      buildArchiveNavigationModel(
        plan,
        structuredClone(syntheticArchiveOutcomes),
        "2026-08-21T12:00:00.000Z",
      ),
    );
    const notice =
      "Module navigation is unavailable; GradPack archived accessible pages and files instead.";

    expect(pages.get("index.html")).toContain(notice);
    expect(pages.get("modules.html")).toContain(notice);
    expect(pages.get("status.html")).toContain(notice);
    expect(pages.get("modules.html")).not.toContain("No modules were listed.");
    expect(pages.get("pages.html")).toContain("Welcome");
    expect(pages.get("files.html")).toContain("slides.pdf");
  });
});
