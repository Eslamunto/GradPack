import { describe, expect, it } from "vitest";
import { renderIndexPage } from "../../src/archive/index-page";
import type { CoursePlan, ResourceOutcome } from "../../src/shared/model";
import {
  syntheticArchiveOutcomes,
  syntheticArchivePlan,
} from "../fixtures/course-plan";

const CREATED_AT = "2026-08-16T12:00:00.000Z";
const copyPlan = (): CoursePlan => structuredClone(syntheticArchivePlan);
const copyOutcomes = (): ResourceOutcome[] =>
  structuredClone(syntheticArchiveOutcomes);

describe("renderIndexPage", () => {
  it("renders deterministic metadata, ordered modules, broad resources, and totals", () => {
    const first = renderIndexPage(copyPlan(), copyOutcomes(), CREATED_AT);
    const second = renderIndexPage(copyPlan(), copyOutcomes(), CREATED_AT);
    const document = new DOMParser().parseFromString(first, "text/html");

    expect(first).toBe(second);
    expect(document.querySelector("link")?.getAttribute("href")).toBe(
      "assets/archive.css",
    );
    expect(document.body.textContent).toContain("Synthetic Course");
    expect(document.body.textContent).toContain(CREATED_AT);
    expect(document.body.textContent).toContain("2 successful");
    expect(document.body.textContent).toContain("1 unsupported");
    expect(document.body.textContent).toContain("1 external");
    expect(document.body.textContent).toContain("48 bytes archived");
    expect(document.body.textContent).toContain("Synthetic unsupported item");
    expect(document.body.textContent).toContain(
      "You are responsible for applicable copyright, licensing, confidentiality, and course-material restrictions.",
    );
  });

  it("links only successful local resources and safe explicit external references", () => {
    const document = new DOMParser().parseFromString(
      renderIndexPage(copyPlan(), copyOutcomes(), CREATED_AT),
      "text/html",
    );
    const links = [...document.querySelectorAll("a")].map((anchor) => ({
      text: anchor.textContent,
      href: anchor.getAttribute("href"),
      rel: anchor.getAttribute("rel"),
    }));

    expect(links).toContainEqual({
      text: "Slides",
      href: "files/slides.pdf",
      rel: null,
    });
    expect(links).toContainEqual({
      text: "Public reference (external)",
      href: "https://reference.example/reading",
      rel: "noopener noreferrer",
    });
    expect(links.some(({ href }) => href?.includes("verifier="))).toBe(false);
  });

  it("URL-encodes canonical local paths without turning literal percent into an escape", () => {
    const plan = copyPlan();
    plan.resources[0]!.archivePath = "files/Résumé 100%.pdf";
    const outcomes = copyOutcomes();
    outcomes[0]!.archivePath = "files/Résumé 100%.pdf";
    const document = new DOMParser().parseFromString(
      renderIndexPage(plan, outcomes, CREATED_AT),
      "text/html",
    );

    expect(
      [...document.querySelectorAll("a")]
        .find((anchor) => anchor.textContent === "Slides")
        ?.getAttribute("href"),
    ).toBe("files/R%C3%A9sum%C3%A9%20100%25.pdf");
  });

  it("renders failed, unavailable, unsupported, and unlinked outcomes without unsafe links or raw failures", () => {
    const plan = copyPlan();
    const outcomes = copyOutcomes();
    outcomes[0] = {
      ...outcomes[0]!,
      status: "failed",
      actualBytes: null,
      failureCategory: "network-exhausted",
    };
    outcomes[1] = {
      ...outcomes[1]!,
      status: "unavailable",
      actualBytes: null,
      failureCategory: "not-found",
    };
    const html = renderIndexPage(plan, outcomes, CREATED_AT);
    const document = new DOMParser().parseFromString(html, "text/html");

    expect(document.body.textContent).toContain("failed");
    expect(document.body.textContent).toContain("unavailable");
    expect(document.body.textContent).toContain("network-exhausted");
    expect(document.body.textContent).not.toContain("raw 403");
    expect(
      [...document.querySelectorAll("a")].some(
        (anchor) => anchor.textContent === "Slides",
      ),
    ).toBe(false);
    expect(document.body.textContent).toContain("Welcome");
  });

  it("escapes all untrusted text, path, status, and URL contexts", () => {
    const plan = copyPlan();
    plan.course.name = '<script id="course-xss">alert(1)</script>';
    plan.course.courseCode = 'SYN" onmouseover="alert(2)';
    plan.modules[0]!.name = "<img src=x onerror=alert(3)>";
    plan.modules[0]!.items[0]!.title = '<svg id="item-xss" onload=alert(4)>';
    const document = new DOMParser().parseFromString(
      renderIndexPage(plan, copyOutcomes(), CREATED_AT),
      "text/html",
    );

    expect(document.querySelector("script")).toBeNull();
    expect(document.querySelector("#course-xss")).toBeNull();
    expect(document.querySelector("#item-xss")).toBeNull();
    expect(
      document.querySelector("[onerror], [onload], [onmouseover]"),
    ).toBeNull();
    expect(document.body.textContent).toContain("<script");
    expect(document.body.textContent).toContain("<svg");
  });

  it.each([
    "https://reference.example/reading?token=secret",
    "https://reference.example/reading#fragment",
  ])("does not link an unsafe external reference %#", (sourceUrl) => {
    const plan = copyPlan();
    plan.resources[2]!.sourceUrl = sourceUrl;
    const outcomes = copyOutcomes();
    outcomes[2]!.sourceUrl = sourceUrl;
    const document = new DOMParser().parseFromString(
      renderIndexPage(plan, outcomes, CREATED_AT),
      "text/html",
    );
    const reference = [...document.querySelectorAll("li")].find((item) =>
      item.textContent?.includes("Public reference"),
    );

    expect(reference?.querySelector("a")).toBeNull();
  });

  it.each([
    "http://reference.example/reading",
    "https://user:pass@reference.example/reading",
    "https://reference.example/%0Areading",
  ])("rejects an invalid external reference %#", (sourceUrl) => {
    const plan = copyPlan();
    plan.resources[2]!.sourceUrl = sourceUrl;
    const outcomes = copyOutcomes();
    outcomes[2]!.sourceUrl = sourceUrl;

    expect(() => renderIndexPage(plan, outcomes, CREATED_AT)).toThrowError(
      TypeError,
    );
  });

  it("rejects an invalid plan/outcome correspondence instead of rendering partial data", () => {
    expect(() =>
      renderIndexPage(copyPlan(), copyOutcomes().slice(1), CREATED_AT),
    ).toThrowError(TypeError);
  });

  it("renders solely from the validated snapshot without direct caller rereads", () => {
    const plan = copyPlan();
    const target = plan.resources[2]!;
    plan.resources[2] = new Proxy(target, {
      getOwnPropertyDescriptor(value, key) {
        return Reflect.getOwnPropertyDescriptor(value, key);
      },
      get() {
        throw new Error("caller object reread");
      },
    });

    const html = renderIndexPage(plan, copyOutcomes(), CREATED_AT);
    const document = new DOMParser().parseFromString(html, "text/html");
    expect(
      [...document.querySelectorAll("a")].some(
        (anchor) =>
          anchor.getAttribute("href") === "https://reference.example/reading",
      ),
    ).toBe(true);
  });
});
