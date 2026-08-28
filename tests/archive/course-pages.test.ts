import { describe, expect, it } from "vitest";
import { renderCoursePages } from "../../src/archive/course-pages";
import { buildArchiveNavigationModel } from "../../src/archive/navigation-model";
import { COURSE_HTML_PATHS } from "../../src/archive/archive-links";
import {
  syntheticArchiveOutcomes,
  syntheticArchivePlan,
} from "../fixtures/course-plan";

describe("course pages", () => {
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
