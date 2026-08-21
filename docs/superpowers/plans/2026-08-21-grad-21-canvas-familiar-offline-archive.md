# GRAD-21 Canvas-Familiar Offline Archive Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the minimal downloaded archive index with a GradPack-branded, Canvas-familiar, static multi-page experience for individual and combined archives.

**Architecture:** Derive one immutable navigation view model from the validated course plan and manifest, render every trusted HTML page through a shared static shell, validate the exact generated page map before ZIP creation, and wrap sanitized Canvas page fragments only after retrieval completes. Combined archives reuse complete validated course archives and add their own deterministic root home/status pages.

**Tech Stack:** TypeScript 5.9, DOMPurify, fflate, Vitest/jsdom, esbuild, static HTML/CSS, Chrome Manifest V3.

## Global Constraints

- Offline archive only; do not change the extension Side Panel.
- Support individual-course and combined multi-course archives with one visual system.
- Use GradPack branding; do not copy Canvas or institutional logos, CSS, JavaScript, fonts, or live controls.
- Generate static HTML/CSS only: no archive JavaScript, service worker, local server, or network dependency.
- Expose only working offline destinations: Archive, Courses, Status, Home, Modules, Pages, Files, and Archive Status.
- Preserve authored module/item order and every terminal manifest outcome.
- Preserve strict sanitizer, canonical-path, link, privacy, deterministic ZIP, byte cleanup, and cancellation contracts.
- Reserve seven course-core ZIP entries and enforce exactly 65,528 maximum captured resources.
- `manifest.json` remains authoritative and its schema stays at version 1.
- All implementation work follows test-driven development and each task ends in its own commit.

## File Structure

- Create `src/archive/archive-links.ts`: fixed generated paths and safe relative-link resolution.
- Create `src/archive/navigation-model.ts`: immutable renderer-facing model derived from validated plan/outcomes/manifest.
- Modify `src/shared/model.ts` and `src/canvas/discovery.ts`: retain validated Canvas module-item indentation from 0 through 5.
- Create `src/archive/shell.ts`: trusted document shell, global rail, course menu, breadcrumbs, and semantic landmarks.
- Create `src/archive/course-pages.ts`: course home, modules, pages, files, and status renderers.
- Modify `src/archive/index-page.ts`: compatibility wrapper delegating to the course page renderer.
- Modify `src/archive/sanitize.ts`: return a sanitized content fragment and render it inside the trusted shell.
- Modify `src/archive/build-zip.ts`: validate/package the exact generated page map and seven reserved core entries.
- Modify `src/archive/combined.ts`: render/validate combined home and status pages and preserve nested navigation.
- Modify `src/archive/style.ts` and `src/static/archive.css`: Canvas-familiar GradPack visual system.
- Modify `src/archive/manifest.ts` and `src/shared/constants.ts`: enforce the approved 65,528 resource maximum.
- Modify `src/page/run-course.ts`: build the view model/page map, wrap sanitized page fragments, and package them.
- Add focused tests under `tests/archive/` and update `tests/page/` and `tests/integration/` contracts.

---

### Task 1: Lock generated paths, resource limit, and immutable navigation data

**Files:**
- Create: `src/archive/archive-links.ts`
- Create: `src/archive/navigation-model.ts`
- Modify: `src/shared/constants.ts`
- Modify: `src/shared/model.ts`
- Modify: `src/canvas/discovery.ts`
- Modify: `src/archive/manifest.ts`
- Test: `tests/archive/archive-links.test.ts`
- Test: `tests/archive/navigation-model.test.ts`
- Test: `tests/archive/manifest.test.ts`
- Test: `tests/canvas/discovery.test.ts`

**Interfaces:**
- Produces: `COURSE_HTML_PATHS`, `relativeArchiveHref(fromPath, toPath)`, `ArchiveNavigationModel`, and `buildArchiveNavigationModel(plan, outcomes, createdAt)`.
- Consumes: existing `CoursePlan`, `ResourceOutcome`, `ArchiveManifest`, `snapshotArchiveData`, and `buildManifestFromSnapshot`.

- [ ] **Step 1: Write failing path, limit, and model tests**

```ts
expect(MAX_ARCHIVE_RESOURCES).toBe(65_528);
expect(COURSE_HTML_PATHS).toEqual([
  "files.html",
  "index.html",
  "modules.html",
  "pages.html",
  "status.html",
]);
expect(relativeArchiveHref("pages/welcome.html", "modules.html")).toBe(
  "../modules.html",
);
expect(relativeArchiveHref("index.html", "files/slides.pdf")).toBe(
  "files/slides.pdf",
);
expect(() => relativeArchiveHref("../escape.html", "index.html")).toThrow(
  TypeError,
);

const model = buildArchiveNavigationModel(plan, outcomes, CREATED_AT);
expect(Object.isFrozen(model)).toBe(true);
expect(model.modules[0]?.items.map(({ title }) => title)).toEqual([
  "First item",
  "Second item",
]);
expect(model.modules[0]?.items.map(({ indent }) => indent)).toEqual([0, 2]);
expect(model.resourceByKey("page:welcome")?.status).toBe("success");
```

- [ ] **Step 2: Run the focused tests and confirm the red state**

Run: `pnpm exec vitest run tests/archive/archive-links.test.ts tests/archive/navigation-model.test.ts tests/archive/manifest.test.ts tests/canvas/discovery.test.ts`

Expected: FAIL because the modules are missing and the old limit is 65,532.

- [ ] **Step 3: Implement fixed paths, canonical relative links, and the frozen model**

```ts
export const COURSE_HTML_PATHS = Object.freeze([
  "files.html",
  "index.html",
  "modules.html",
  "pages.html",
  "status.html",
] as const);
export type CourseHtmlPath = (typeof COURSE_HTML_PATHS)[number];

export const relativeArchiveHref = (fromPath: string, toPath: string): string => {
  if (!isCanonicalArchivePath(fromPath) || !isCanonicalArchivePath(toPath)) {
    throw new TypeError("Invalid archive link path");
  }
  const from = fromPath.split("/").slice(0, -1);
  const to = toPath.split("/");
  while (from[0] === to[0]) {
    from.shift();
    to.shift();
  }
  return [...from.map(() => ".."), ...to].map(encodeURIComponent).join("/");
};

export type ArchiveResourceView = Readonly<{
  key: string;
  title: string;
  kind: ArchiveManifestResource["kind"];
  status: ArchiveManifestResource["status"];
  archivePath: string | null;
  externalHref: string | null;
  advertisedBytes: number | null;
  actualBytes: number | null;
  failureCategory: string | null;
  moduleReferences: readonly string[];
}>;

export type ArchiveNavigationModel = Readonly<{
  manifest: ArchiveManifest;
  modules: readonly Readonly<{
    id: number;
    name: string;
    position: number;
    items: readonly Readonly<{
      id: number;
      title: string;
      position: number;
      indent: number;
      resource: ArchiveResourceView | null;
    }>[];
  }>[];
  resources: readonly ArchiveResourceView[];
  resourceByKey: (key: string) => ArchiveResourceView | null;
}>;
```

Keep the mutable lookup `Map` private inside the builder closure. Freeze every
resource, item, module, array, course/manifest snapshot, and the root model so a
caller cannot mutate renderer input through a nominal `ReadonlyMap` cast.

Set `MAX_ARCHIVE_RESOURCES` to `65_528`; keep `MAX_ZIP_PAYLOAD_ENTRIES` equal to that value and update comments to state that seven core entries are reserved.

Add `indent: number` to `ModuleItem`. Normalize a missing Canvas `indent` to 0,
accept only safe integers from 0 through 5, and reject negative, fractional, or
larger values instead of emitting an unbounded presentation class:

```ts
const moduleIndent = (value: unknown): number => {
  if (value === undefined) return 0;
  if (
    typeof value !== "number" ||
    !Number.isSafeInteger(value) ||
    value < 0 ||
    value > 5
  ) {
    throw new TypeError("Invalid module item indent");
  }
  return value;
};
```

- [ ] **Step 4: Run the focused tests**

Run: `pnpm exec vitest run tests/archive/archive-links.test.ts tests/archive/navigation-model.test.ts tests/archive/manifest.test.ts tests/canvas/discovery.test.ts`

Expected: PASS, including rejection at 65,529 resources and acceptance at 65,528.

- [ ] **Step 5: Commit**

```bash
git add src/archive/archive-links.ts src/archive/navigation-model.ts src/shared/constants.ts src/shared/model.ts src/canvas/discovery.ts src/archive/manifest.ts tests/archive/archive-links.test.ts tests/archive/navigation-model.test.ts tests/archive/manifest.test.ts tests/canvas/discovery.test.ts
git commit -m "feat: model offline archive navigation"
```

### Task 2: Build the trusted static shell and Canvas-familiar stylesheet

**Files:**
- Create: `src/archive/shell.ts`
- Modify: `src/archive/style.ts`
- Modify: `src/static/archive.css`
- Test: `tests/archive/shell.test.ts`
- Test: `tests/archive/archive-css.test.ts`

**Interfaces:**
- Consumes: `CourseHtmlPath` and `relativeArchiveHref` from Task 1.
- Produces: `ArchivePageKind`, `ArchiveShellInput`, and `renderArchiveShell(input)`.

- [ ] **Step 1: Write failing semantic-shell and CSS tests**

```ts
const html = renderArchiveShell({
  pagePath: "modules.html",
  pageKind: "modules",
  title: "Modules",
  course: { name: "Synthetic Course", courseCode: "SYN-101" },
  combinedHomeHref: null,
  contentHtml: "<h1>Modules</h1><p>Safe content</p>",
});
const document = new DOMParser().parseFromString(html, "text/html");
expect(document.querySelector('a[href="#archive-main"]')).not.toBeNull();
expect(document.querySelectorAll("nav")).toHaveLength(3);
expect(document.querySelector('[aria-current="page"]')?.textContent).toBe(
  "Modules",
);
expect(document.querySelector("script, style, iframe, form")).toBeNull();
expect(document.querySelector("main")?.textContent).toContain("Safe content");

expect(ARCHIVE_CSS).toContain("--gradpack-rail");
expect(ARCHIVE_CSS).toContain(":focus-visible");
expect(ARCHIVE_CSS).toContain("@media (max-width:");
expect(ARCHIVE_CSS).not.toMatch(/@import|url\s*\(/iu);
```

- [ ] **Step 2: Run the tests and verify failure**

Run: `pnpm exec vitest run tests/archive/shell.test.ts tests/archive/archive-css.test.ts`

Expected: FAIL because `shell.ts` and the new design tokens do not exist.

- [ ] **Step 3: Implement the trusted shell**

```ts
export type ArchivePageKind =
  | "home"
  | "modules"
  | "pages"
  | "files"
  | "status"
  | "saved-page";

export type ArchiveShellInput = Readonly<{
  pagePath: string;
  pageKind: ArchivePageKind;
  title: string;
  course: Readonly<{ name: string; courseCode: string }>;
  combinedHomeHref: string | null;
  contentHtml: string;
}>;

export const renderArchiveShell = (input: ArchiveShellInput): string => {
  const cssHref = relativeArchiveHref(input.pagePath, "assets/archive.css");
  const nav = renderCourseNavigation(input.pagePath, input.pageKind);
  const breadcrumbs = renderBreadcrumbs(input);
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${escapeHtml(input.title)} — GradPack</title><link rel="stylesheet" href="${cssHref}"></head><body><a class="skip-link" href="#archive-main">Skip to content</a><div class="archive-layout">${renderGlobalRail(input)}${nav}<div class="archive-workspace">${breadcrumbs}<main id="archive-main" tabindex="-1">${input.contentHtml}</main><footer class="archive-identity">Local GradPack archive</footer></div></div></body></html>`;
};
```

Implement the approved dark rail, neutral course menu, accent links, module rows, status chips, readable content width, focus rings, and CSS-only narrow-screen stacking in `src/static/archive.css`; then mechanically keep `src/archive/style.ts` identical under the existing asset contract.

- [ ] **Step 4: Run shell and CSS tests**

Run: `pnpm exec vitest run tests/archive/shell.test.ts tests/archive/archive-css.test.ts`

Expected: PASS with semantic landmarks, one `h1`, visible active navigation, no external assets, and exact CSS identity.

- [ ] **Step 5: Commit**

```bash
git add src/archive/shell.ts src/archive/style.ts src/static/archive.css tests/archive/shell.test.ts tests/archive/archive-css.test.ts
git commit -m "feat: add Canvas-familiar archive shell"
```

### Task 3: Render all individual-course pages from the validated model

**Files:**
- Create: `src/archive/course-pages.ts`
- Modify: `src/archive/index-page.ts`
- Test: `tests/archive/course-pages.test.ts`
- Modify: `tests/archive/index-page.test.ts`

**Interfaces:**
- Consumes: `ArchiveNavigationModel` and `renderArchiveShell`.
- Produces: `renderCoursePages(model, options?) => ReadonlyMap<CourseHtmlPath, string>`.
- Preserves: `renderIndexPage(plan, outcomes, createdAt)` as a compatibility wrapper returning `index.html`.

- [ ] **Step 1: Write failing renderer tests for all five pages**

```ts
const pages = renderCoursePages(model);
expect([...pages.keys()].sort()).toEqual([...COURSE_HTML_PATHS]);
expect(text(pages.get("modules.html"))).toContain("Module One");
expect(links(pages.get("modules.html"))).toContainEqual({
  text: "Slides",
  href: "files/slides.pdf",
});
expect(text(pages.get("pages.html"))).toContain("unavailable");
expect(links(pages.get("files.html"))).toContainEqual({
  text: "Slides",
  href: "files/slides.pdf",
});
expect(text(pages.get("status.html"))).toContain("2 saved");
expect(pages.get("index.html")).toBe(
  renderIndexPage(plan, outcomes, CREATED_AT),
);
```

Add malicious course/module/resource titles, external references with query or fragment, failed outcomes, empty modules, and deterministic repeated rendering.

- [ ] **Step 2: Run the renderer tests and confirm failure**

Run: `pnpm exec vitest run tests/archive/course-pages.test.ts tests/archive/index-page.test.ts`

Expected: FAIL because `renderCoursePages` is missing and the old index has no shell.

- [ ] **Step 3: Implement focused page renderers**

```ts
const COURSE_RENDERERS: Readonly<Record<CourseHtmlPath, PageRenderer>> = {
  "index.html": renderCourseHome,
  "modules.html": renderModulesPage,
  "pages.html": renderPagesPage,
  "files.html": renderFilesPage,
  "status.html": renderStatusPage,
};

export const renderCoursePages = (
  model: ArchiveNavigationModel,
  options: Readonly<{ combinedHomeHref?: string }> = {},
): ReadonlyMap<CourseHtmlPath, string> =>
  new Map(
    COURSE_HTML_PATHS.map((pagePath) => [
      pagePath,
      COURSE_RENDERERS[pagePath](model, {
        pagePath,
        combinedHomeHref: options.combinedHomeHref ?? null,
      }),
    ]),
  );
```

Use one resource-row helper that emits a local link only for successful canonical resources, an external link only under the existing external policy, and plain status text for unavailable, unsupported, or failed resources. Preserve module and item order from the model; sort broad page/file indexes by canonical archive path.

- [ ] **Step 4: Run the renderer tests**

Run: `pnpm exec vitest run tests/archive/course-pages.test.ts tests/archive/index-page.test.ts`

Expected: PASS for five deterministic pages, safe links, escaped text, active navigation, and all terminal outcomes.

- [ ] **Step 5: Commit**

```bash
git add src/archive/course-pages.ts src/archive/index-page.ts tests/archive/course-pages.test.ts tests/archive/index-page.test.ts
git commit -m "feat: render offline course pages"
```

### Task 4: Separate Canvas-page sanitization from trusted shell rendering

**Files:**
- Modify: `src/archive/sanitize.ts`
- Modify: `src/page/run-course.ts`
- Modify: `tests/archive/sanitize.test.ts`
- Modify: `tests/page/run-course.test.ts`

**Interfaces:**
- Produces: `sanitizePageFragment(input) => string` and `renderSavedPageHtml({ model, pagePath, title, sanitizedFragment, combinedHomeHref }) => string`.
- Preserves: `sanitizePageHtml(input)` as a compatibility wrapper for tests/callers until Task 7 removes obsolete use.

- [ ] **Step 1: Write failing fragment, shell, and cleanup tests**

```ts
const fragment = sanitizePageFragment(input('<p>Safe</p><script>x()</script>'));
expect(fragment).toBe("<p>Safe</p>");
expect(fragment).not.toContain("<html");

const html = renderSavedPageHtml({
  model,
  pagePath: "pages/welcome.html",
  title: "Welcome",
  sanitizedFragment: fragment,
  combinedHomeHref: null,
});
const document = parse(html);
expect(document.querySelector('[aria-current="page"]')?.textContent).toBe(
  "Pages",
);
expect(document.querySelector('a[href="../modules.html"]')).not.toBeNull();
expect(document.querySelector("script, [style], [onclick]")).toBeNull();
```

Add a run-course test proving that replaced fragment bytes are zeroed after shell wrapping and that terminal failure zeroes both fragment and wrapped-page bytes.

- [ ] **Step 2: Run the focused tests and verify failure**

Run: `pnpm exec vitest run tests/archive/sanitize.test.ts tests/page/run-course.test.ts`

Expected: FAIL because sanitization currently returns a complete minimal document.

- [ ] **Step 3: Implement fragment sanitization and trusted wrapping**

```ts
export const sanitizePageFragment = (input: SanitizePageInput): string => {
  const { body, resolveLocalHref } = validateInput(input);
  const container = sanitizeIntoContainer(body);
  auditAttributes(container);
  rewriteAnchors(container, resolveLocalHref);
  auditAttributes(container);
  return container.innerHTML;
};

export const renderSavedPageHtml = (input: SavedPageRenderInput): string =>
  renderArchiveShell({
    pagePath: input.pagePath,
    pageKind: "saved-page",
    title: input.title,
    course: input.model.manifest.course,
    combinedHomeHref: input.combinedHomeHref,
    contentHtml: `<article class="saved-page-content"><h1>${escapeHtml(input.title)}</h1>${input.sanitizedFragment}</article>`,
  });
```

Store page retrieval results as sanitized UTF-8 fragments. After all outcomes are known, build the navigation model, wrap each successful page fragment, replace its entry bytes, and fill the superseded fragment buffer with zeroes. Keep external/local anchor rewriting unchanged.

- [ ] **Step 4: Run sanitizer and run-course tests**

Run: `pnpm exec vitest run tests/archive/sanitize.test.ts tests/page/run-course.test.ts`

Expected: PASS, including nested navigation, XSS rejection, resolver failure behavior, and byte cleanup.

- [ ] **Step 5: Commit**

```bash
git add src/archive/sanitize.ts src/page/run-course.ts tests/archive/sanitize.test.ts tests/page/run-course.test.ts
git commit -m "feat: wrap sanitized pages in archive shell"
```

### Task 5: Validate and package the exact generated course-page map

**Files:**
- Modify: `src/archive/build-zip.ts`
- Modify: `tests/archive/build-zip.test.ts`
- Modify: `tests/fixtures/course-plan.ts`

**Interfaces:**
- Changes `ArchiveInput` from `{ indexHtml, archiveCss, manifest, entries }` to `{ pages, archiveCss, manifest, entries }`.
- Consumes the exact `ReadonlyMap<CourseHtmlPath, string>` from Task 3.
- Produces deterministic ZIPs with seven core entries plus at most 65,528 payload entries.

- [ ] **Step 1: Write failing exact-map and generated-page validation tests**

```ts
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
expect(() => buildCourseZip(withoutPage("status.html"))).toThrow(TypeError);
expect(() => buildCourseZip(withExtraPage("debug.html"))).toThrow(TypeError);
expect(() => buildCourseZip(withHtml("modules.html", "<script>x()</script>"))).toThrow(TypeError);
expect(() => buildCourseZip(inputAtPayloadCount(65_529))).toThrow(
  ArchiveSafetyError,
);
```

Retain cases for accessor/inherited inputs, comments, remote styles, unsafe links, malformed percent encoding, manifest/payload mismatch, deterministic ordering, and cloned bytes.

- [ ] **Step 2: Run build-ZIP tests and confirm failure**

Run: `pnpm exec vitest run tests/archive/build-zip.test.ts`

Expected: FAIL because `ArchiveInput` accepts only one `indexHtml` and reserves three core entries.

- [ ] **Step 3: Implement exact page-map validation and seven-entry reservation**

```ts
export type ArchiveInput = {
  pages: ReadonlyMap<CourseHtmlPath, string>;
  archiveCss: string;
  manifest: ArchiveManifest;
  entries: ReadonlyMap<string, Uint8Array>;
};

const collectGeneratedPages = (raw: unknown): Map<CourseHtmlPath, string> => {
  if (Object.getPrototypeOf(raw) !== Map.prototype) {
    throw new TypeError("Invalid generated pages");
  }
  const pairs = [...Map.prototype.entries.call(raw)];
  if (pairs.length !== COURSE_HTML_PATHS.length) {
    throw new TypeError("Invalid generated page set");
  }
  const pages = new Map<CourseHtmlPath, string>();
  for (const path of COURSE_HTML_PATHS) {
    const html = pairs.find(([candidate]) => candidate === path)?.[1];
    pages.set(path, validateGeneratedPage(path, html));
  }
  if (pages.size !== pairs.length) throw new TypeError("Invalid generated page set");
  return pages;
};
```

Replace the index-only validator with page-kind-aware exact validation. Allow only the approved structural elements, attributes, IDs, and classes; validate every local link relative to its current generated path and every external link under the existing policy. Add all validated generated pages to the sorted source map before payloads.

- [ ] **Step 4: Run build-ZIP and manifest tests**

Run: `pnpm exec vitest run tests/archive/build-zip.test.ts tests/archive/manifest.test.ts`

Expected: PASS with exactly seven core entries, 65,528 payload capacity, strict HTML/CSS validation, and deterministic bytes.

- [ ] **Step 5: Commit**

```bash
git add src/archive/build-zip.ts tests/archive/build-zip.test.ts tests/fixtures/course-plan.ts
git commit -m "feat: package validated multi-page archives"
```

### Task 6: Add combined archive home/status pages and nested backlinks

**Files:**
- Modify: `src/archive/combined.ts`
- Modify: `src/page/run-courses.ts`
- Modify: `tests/archive/combined.test.ts`
- Modify: `tests/archive/archive-links.test.ts`
- Modify: `tests/page/run-courses.test.ts`

**Interfaces:**
- Consumes complete validated course ZIPs from Task 5.
- Extends course archive rendering options with `combinedRoot: string | null`; multi-course orchestration supplies the deterministic `courses/<safe-course-root>` only in combined mode.
- Produces combined `index.html` and `status.html` using the shared visual system and pre-rendered safe paths back from nested course pages.

- [ ] **Step 1: Write failing combined navigation and validation tests**

```ts
const entries = unzipSync(result.zipBytes);
expect(entries["status.html"]).toBeDefined();
expect(parse(entries["index.html"]).querySelectorAll(".course-card")).toHaveLength(2);
expect(links(entries["index.html"])).toContainEqual({
  text: "First Course",
  href: "courses/First%20Course-101/index.html",
});
expect(
  links(entries["courses/First Course-101/pages/welcome.html"]),
).toContainEqual({ text: "Courses", href: "../../../index.html" });
expect(text(entries["status.html"])).toContain("Combined archive status");
expect(() => buildCombinedZip(withUnsafeNestedShell())).toThrow(TypeError);
expect(() => buildCombinedZip(atClassicZipEntryLimit(65_536))).toThrow(
  TypeError,
);
```

- [ ] **Step 2: Run combined tests and confirm failure**

Run: `pnpm exec vitest run tests/archive/combined.test.ts tests/archive/archive-links.test.ts tests/page/run-courses.test.ts`

Expected: FAIL because the combined archive has only a minimal index and no nested backlink contract.

- [ ] **Step 3: Implement trusted combined pages and nested course rendering context**

```ts
const COMBINED_HTML_PATHS = Object.freeze(["index.html", "status.html"] as const);

const renderCombinedPages = (
  archives: readonly CourseArchiveOutput[],
  roots: readonly string[],
  manifest: CombinedArchiveManifest,
): ReadonlyMap<(typeof COMBINED_HTML_PATHS)[number], string> =>
  new Map([
    ["index.html", renderCombinedHome(archives, roots, manifest)],
    ["status.html", renderCombinedStatus(archives, roots, manifest)],
  ]);
```

When `runCourses` chooses combined packaging, compute each deterministic course
root before calling `buildCourseArchive` and pass it as rendering context. The
course page renderers then calculate backlinks from
`courses/<safe-course-root>/<page-path>` to combined `index.html`. In per-course
mode pass `null`, so no combined backlink appears. `buildCombinedZip` validates
and copies the already trusted nested pages byte-for-byte; it must never patch
HTML after course ZIP validation. Keep deterministic roots, archive order,
nested manifests, aggregate totals, path collision checks, and the classic
65,535 total-entry ceiling including four combined root entries.

- [ ] **Step 4: Run combined tests**

Run: `pnpm exec vitest run tests/archive/combined.test.ts tests/archive/archive-links.test.ts tests/page/run-courses.test.ts`

Expected: PASS with two combined root pages, working nested backlinks at every depth, unchanged nested manifests, and deterministic output.

- [ ] **Step 5: Commit**

```bash
git add src/archive/combined.ts src/page/run-courses.ts tests/archive/combined.test.ts tests/archive/archive-links.test.ts tests/page/run-courses.test.ts
git commit -m "feat: add combined archive navigation"
```

### Task 7: Integrate the full archive flow and verify extracted offline behavior

**Files:**
- Modify: `src/page/run-course.ts`
- Modify: `tests/page/run-course.test.ts`
- Modify: `tests/page/run-courses.test.ts`
- Modify: `tests/integration/pilot-flow.test.ts`
- Create: `tests/integration/offline-archive-navigation.test.ts`
- Modify: `tests/build/output.test.ts`
- Modify: `README.md`
- Modify: `docs/development/multi-course-runs.md`

**Interfaces:**
- Consumes all Task 1-6 interfaces.
- Produces the complete user-visible single-course and combined Canvas-familiar archive flow.

- [ ] **Step 1: Write failing integration and extracted-offline tests**

```ts
const archive = unzipSync(await runSyntheticCourse());
for (const page of [
  "index.html",
  "modules.html",
  "pages.html",
  "files.html",
  "status.html",
  "pages/welcome.html",
]) {
  const document = parse(archive[page]);
  expect(document.querySelector("script")).toBeNull();
  expect(document.querySelector('link[rel="stylesheet"]')).not.toBeNull();
  expect(allLocalLinksResolve(page, document, archive)).toBe(true);
}
expect(networkReferences(archive)).toEqual([]);
expect(activeNavigation(archive["modules.html"])).toBe("Modules");
expect(activeNavigation(archive["pages/welcome.html"])).toBe("Pages");
```

Add a combined fixture with two courses, verify every root/course/saved-page link, direct `file://` opening with network disabled, keyboard tab order, visible focus styles, semantic landmarks, narrow-screen stacking, manifest totals, cancellation cleanup, and exact extension permissions.

- [ ] **Step 2: Run integration tests and confirm failure**

Run: `pnpm exec vitest run tests/page/run-course.test.ts tests/page/run-courses.test.ts tests/integration/pilot-flow.test.ts tests/integration/offline-archive-navigation.test.ts tests/build/output.test.ts`

Expected: FAIL until run-course passes the generated page map and the offline navigation fixture exists.

- [ ] **Step 3: Wire the final pipeline and document the new archive contract**

```ts
const model = buildArchiveNavigationModel(immutablePlan, outcomes, createdAt);
wrapSuccessfulPageFragments(entries, model, retained);
const pages = renderCoursePages(model);
zipBytes = buildCourseZip({
  pages,
  archiveCss: dependencies.archiveCss,
  manifest: model.manifest,
  entries,
});
```

Update README and multi-course documentation to state that archives include static Home, Modules, Pages, Files, and Status navigation; remain GradPack-branded and fully offline; contain no archive JavaScript; and enforce a 65,528-resource maximum.

- [ ] **Step 4: Run the focused integration suite**

Run: `pnpm exec vitest run tests/page/run-course.test.ts tests/page/run-courses.test.ts tests/integration/pilot-flow.test.ts tests/integration/offline-archive-navigation.test.ts tests/build/output.test.ts`

Expected: PASS for individual, combined, saved-page, cancellation, and direct-offline navigation flows.

- [ ] **Step 5: Run the full verification suite**

Run: `CI=true pnpm verify`

Expected: formatting, lint, type checking, all Vitest suites, and production build pass.

Run: `CI=true pnpm package:pilot`

Expected: versioned pilot ZIP and SHA-256 sidecar are generated deterministically; checksum verification, ZIP integrity, exact production extension inventory, and unchanged Manifest V3 permissions pass.

- [ ] **Step 6: Perform extracted archive smoke verification**

Run: `pnpm exec vitest run tests/integration/offline-archive-navigation.test.ts`

Expected: every generated local link resolves from extracted files, no network reference exists, and single/combined pages remain usable with Canvas and GradPack unavailable.

- [ ] **Step 7: Commit**

```bash
git add src/page/run-course.ts tests/page/run-course.test.ts tests/page/run-courses.test.ts tests/integration/pilot-flow.test.ts tests/integration/offline-archive-navigation.test.ts tests/build/output.test.ts README.md docs/development/multi-course-runs.md
git commit -m "feat: deliver Canvas-familiar offline archives"
```

## Final Review Gate

- [ ] Confirm `git diff --check` passes and the worktree contains no unrelated changes.
- [ ] Confirm the branch is based on the intended merged GRAD-15 source and record the exact candidate SHA.
- [ ] Inspect an extracted synthetic individual archive and combined archive at desktop and narrow widths.
- [ ] Confirm all generated links work under `file://` with networking disabled.
- [ ] Confirm `manifest.json` bytes and schema remain authoritative and no Canvas/institutional assets were added.
- [ ] Request code review before integration and route any product defects into separate Linear issues.
