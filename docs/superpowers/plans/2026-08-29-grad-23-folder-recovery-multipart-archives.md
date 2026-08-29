# GRAD-23 Folder Recovery and Multipart Archives Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Keep valid files when Canvas folder metadata is incomplete and download oversized courses as deterministic, self-contained ZIP parts without raising GradPack's 250 MiB per-part safety limit.

**Architecture:** Extend the immutable course plan with explicit unfiled-fallback keys, then partition each validated course deterministically before the review gate. Build one part at a time from the complete course topology plus a local resource assignment, recording a complete metadata-only resource catalog in every manifest so offline pages can label cross-part material without broken links. Keep Canvas trust checks, runtime byte checks, cancellation, session handling, local-only processing, and per-part cleanup unchanged or stricter.

**Tech Stack:** TypeScript, Chrome Manifest V3, Canvas same-origin HTTP, Vitest with jsdom, fflate ZIP generation, pnpm, esbuild.

## Global Constraints

- Keep `MAX_ARCHIVE_BYTES` exactly `262_144_000` bytes for every part.
- Keep `MAX_ARCHIVE_RESOURCES`, the classic ZIP entry limit, `MAX_CONCURRENCY = 2`, and `MAX_RETRIES = 2` enforced.
- Do not add Canvas origins, Chrome permissions, API permissions, a backend, filesystem access, telemetry, credentials, or persistent diagnostics.
- Recover only an absent folder index or absent referenced folder after the file record, ID, filename, size, exact-origin URL, and generated path have passed validation.
- Malformed, conflicting, cyclic, or unsafe folder metadata remains fail-closed.
- Use deterministic canonical resource order, next-fit partitioning, assignments, filenames, and archive output.
- In multipart or per-course output, retrieve, build, hand off, clear, and then continue one part at a time; never hold multiple part payloads or ZIP byte arrays. Preserve the existing combined path only when every course has one part.
- A known file larger than one part is not requested. An unknown file that crosses the streamed cap becomes `individual-size-limit`; neither condition skips the course.
- Single-part courses retain their existing filename and user experience.
- Never commit real course names, IDs, URLs, filenames, content, screenshots, generated ZIPs, extracted extensions, or live diagnostic output.
- Preserve package identity `0.1.0-alpha.6`; this follow-up completes the current Alpha 6 candidate rather than creating a second version bump.

---

## File Structure

- `src/canvas/discovery.ts` — recover absent folder relationships and validate aggregate advertised-byte arithmetic without rejecting partitionable courses.
- `src/shared/model.ts` — canonical plan, summary, progress, part, and resource-failure contracts.
- `src/shared/constants.ts` — enforced maximum archived-page planning bound.
- `src/page/course-parts.ts` — new focused deterministic partitioner and part filename helper.
- `src/page/run-course.ts` — immutable-plan cloning, part-local retrieval, oversized-resource outcomes, page bound, archive build, and byte cleanup.
- `src/page/run-courses.ts` — pre-review part planning and sequential course/part orchestration.
- `src/archive/manifest.ts` — strict part, course totals, catalog, local outcomes, and fallback validation.
- `src/archive/navigation-model.ts` — merge complete catalog entries with local part outcomes.
- `src/archive/course-pages.ts` — part identity, cross-part labels, and unfiled disclosure.
- `src/archive/index-page.ts` — pass the single-part default descriptor for the compatibility renderer.
- `src/archive/build-zip.ts` — verify the extended manifest and part-local payload inventory.
- `src/archive/style.ts` and `src/static/archive.css` — identical passive styling for part and cross-part labels.
- `src/shared/messages.ts` — exact protocol validation for added summary and progress fields.
- `src/page/runner.ts` — emit part-aware plan, progress, and completion events.
- `src/sidepanel/state.ts` — retain part-aware state and completion counts.
- `src/sidepanel/main.ts` — review, progress, fallback, and completion copy.
- `tests/page/course-parts.test.ts` — new partition boundary and determinism suite.
- Existing focused tests under `tests/canvas`, `tests/archive`, `tests/page`, `tests/shared`, `tests/sidepanel`, and `tests/integration` — synthetic contract and regression coverage.
- `README.md`, `SECURITY.md`, `docs/pilot/INSTALL.md`, and `docs/pilot/TEST_CHECKLIST.md` — current behavior, unchanged trust boundary, and privacy-safe live acceptance.

---

### Task 1: Recover Missing Folder Relationships Without Weakening Validation

**Files:**

- Modify: `src/shared/model.ts`
- Modify: `src/canvas/discovery.ts`
- Modify: `src/page/run-course.ts`
- Modify: `tests/fixtures/course-plan.ts`
- Test: `tests/canvas/discovery.test.ts`
- Test: `tests/page/run-course.test.ts`

**Interfaces:**

- Consumes: existing `CoursePlan.resources`, `safeArchivePath()`, `allocatePaths()`, and validated folder/file records.
- Produces: `CoursePlan.folderPathFallbackKeys: string[]`, where every key identifies one file allocated below `files/unfiled/`.

- [ ] **Step 1: Replace the hard-failure regression with failing recovery and malformed-folder tests**

Add synthetic assertions to `tests/canvas/discovery.test.ts`:

```ts
it("places a file with an absent referenced folder under files/unfiled", async () => {
  const plan = await discoverCoursePlan(
    syntheticCanvasHttp({
      modules: [],
      files: [{ ...file(1, "report.pdf"), folder_id: 999 }],
      folders: [{ id: 401, full_name: "course files/Present" }],
      pages: [],
    }),
    syntheticCourse,
  );

  expect(plan.resources[0]?.archivePath).toBe("files/unfiled/report.pdf");
  expect(plan.folderPathFallbackKeys).toEqual(["file:1"]);
});

it("discloses the same fallback when the folder index is unavailable", async () => {
  const plan = await discoverCoursePlan(
    syntheticCanvasHttp({
      modules: [],
      unavailableIndexes: { folders: 404 },
      files: [file(1, "report.pdf")],
      pages: [],
    }),
    syntheticCourse,
  );

  expect(plan.resources[0]?.archivePath).toBe("files/unfiled/report.pdf");
  expect(plan.folderPathFallbackKeys).toEqual(["file:1"]);
});
```

Keep the existing malformed `full_name`, unsafe path, duplicate conflict, and
cycle tests unchanged. Add a collision fixture with two unfiled files whose
sanitized names collide and assert one path receives its existing
`--file-<id>` suffix.

- [ ] **Step 2: Run the focused tests and verify the old behavior fails**

Run:

```bash
CI=true pnpm exec vitest run tests/canvas/discovery.test.ts tests/page/run-course.test.ts
```

Expected: FAIL because the missing referenced folder still throws, the unavailable index still uses `files/` directly, and `CoursePlan` does not yet contain `folderPathFallbackKeys`.

- [ ] **Step 3: Add and freeze the fallback-key contract**

In `src/shared/model.ts`, extend the plan exactly:

```ts
export type CoursePlan = {
  course: CourseSummary;
  moduleDiscovery: ModuleDiscovery;
  modules: CourseModule[];
  resources: PlannedResource[];
  folderPathFallbackKeys: string[];
  advertisedBytes: number;
};
```

In both discovery's local freezer and `freezeCoursePlan()` in
`src/page/run-course.ts`, clone the array, verify uniqueness and exact
membership, require every referenced resource to be a file with a canonical
path beginning `files/unfiled/`, then freeze the array before freezing the
plan. Update all synthetic plan fixtures with `folderPathFallbackKeys: []`.

- [ ] **Step 4: Implement the narrow unfiled path decision**

In `src/canvas/discovery.ts`, record fallback keys while creating file drafts:

```ts
const folderFallbackDraftKeys = new Set<string>();
for (const file of files.values()) {
  const key = `file:${file.id}`;
  let folderSegments: string[];
  if (rawFolders === null) {
    folderSegments = ["unfiled"];
    folderFallbackDraftKeys.add(key);
  } else if (file.folderId === null) {
    folderSegments = [];
  } else {
    const resolved = folders.get(file.folderId);
    if (resolved === undefined) {
      folderSegments = ["unfiled"];
      folderFallbackDraftKeys.add(key);
    } else {
      folderSegments = resolved;
    }
  }
  drafts.push({
    key,
    kind: "file",
    title: file.title,
    sourceId: String(file.id),
    archivePath: null,
    advertisedBytes: file.size,
    sourceUrl: file.sourceUrl,
    preferredPath: safeArchivePath("files", ...folderSegments, file.title),
    disambiguator: `file-${file.id}`,
  });
}
```

After `allocatePaths(drafts)`, derive the field from canonical resource order:

```ts
const folderPathFallbackKeys = resources
  .filter((resource) => folderFallbackDraftKeys.has(resource.key))
  .map((resource) => resource.key);
```

Do not catch folder parser errors; only the absent relationship follows this
branch.

- [ ] **Step 5: Run focused discovery and freezer tests**

Run:

```bash
CI=true pnpm exec vitest run tests/canvas/discovery.test.ts tests/page/run-course.test.ts
```

Expected: PASS; absent relationships are disclosed under `files/unfiled/`, collision allocation is deterministic, and malformed folders still fail.

- [ ] **Step 6: Commit the independently testable recovery**

```bash
git add src/shared/model.ts src/canvas/discovery.ts src/page/run-course.ts tests/fixtures/course-plan.ts tests/canvas/discovery.test.ts tests/page/run-course.test.ts
git commit -m "feat: recover files with missing folders"
```

---

### Task 2: Add Deterministic Course-Part Planning

**Files:**

- Create: `src/page/course-parts.ts`
- Create: `tests/page/course-parts.test.ts`
- Modify: `src/shared/constants.ts`
- Modify: `src/shared/model.ts`
- Modify: `src/canvas/discovery.ts`
- Modify: `src/page/run-course.ts`
- Modify: `src/page/run-courses.ts`
- Test: `tests/page/run-courses.test.ts`

**Interfaces:**

- Consumes: a frozen `CoursePlan`, `MAX_ARCHIVE_BYTES`, `MAX_ARCHIVE_RESOURCES`, and canonical resource order.
- Produces: `partitionCoursePlan(plan): readonly CourseArchivePartPlan[]`, `partFileName(baseName, part): string`, and `PlannedCourse { plan, parts }`.

- [ ] **Step 1: Write the failing partition boundary suite**

Create `tests/page/course-parts.test.ts` with helpers that build valid synthetic
plans and these exact cases:

```ts
expect(partitionCoursePlan(planWithFile(MAX_ARCHIVE_BYTES))).toHaveLength(1);
expect(
  partitionCoursePlan(planWithFiles([MAX_ARCHIVE_BYTES, 1])).map((part) =>
    part.resourceKeys.slice(),
  ),
).toEqual([["file:1"], ["file:2"]]);
expect(partitionCoursePlan(planWithUnknownFile())).toMatchObject([
  { index: 1, total: 1, resourceKeys: ["file:1"] },
]);
expect(
  partitionCoursePlan(planWithFiles([MAX_ARCHIVE_BYTES + 1])),
).toMatchObject([{ index: 1, total: 1, resourceKeys: ["file:1"] }]);
expect(partFileName("gradpack-synthetic.zip", { index: 2, total: 12 })).toBe(
  "gradpack-synthetic-part-02-of-12.zip",
);
```

Also assert empty plans produce one part, external/unsupported resources are
assigned to part 1, unknown-size files are isolated from adjacent resources,
pages use their enforced bound, no key is omitted or duplicated, input objects
remain untouched, and repeat calls are deeply equal and frozen.

- [ ] **Step 2: Run the new suite and verify the module is missing**

Run:

```bash
CI=true pnpm exec vitest run tests/page/course-parts.test.ts
```

Expected: FAIL because `src/page/course-parts.ts` does not exist.

- [ ] **Step 3: Define exact part and progress types plus the archived-page bound**

Add to `src/shared/constants.ts`:

```ts
export const MAX_ARCHIVED_PAGE_BYTES =
  CANVAS_PAGE_JSON_MAX_BYTES * 8 + 64 * 1024;
```

Add to `src/shared/model.ts`:

```ts
export type ResourcePartAssignment = {
  resourceKey: string;
  partIndex: number;
};

export type CourseArchivePartPlan = {
  index: number;
  total: number;
  resourceKeys: string[];
  resourceParts: ResourcePartAssignment[];
};

export type CoursePlanSummary = {
  courseId: number;
  moduleDiscovery: ModuleDiscovery;
  folderPathFallbackCount: number;
  archivePartCount: number;
  advertisedBytes: number;
  unknownSizeCount: number;
  resourceCount: number;
};

export type RunPlanSummary = {
  requestedCourseCount: number;
  selected: CoursePlanSummary[];
  skipped: CoursePlanFailureSummary[];
  requestedPackaging: PackagingMode;
  effectivePackaging: PackagingMode;
  totalPlannedParts: number;
  expectedArchiveCount: number;
  advertisedBytes: number;
  unknownSizeCount: number;
  resourceCount: number;
  fallbackReason: PlanFallbackReason | null;
};

export type AggregateProgress = Progress & {
  currentCourseId: number;
  currentCourseIndex: number;
  totalCourses: number;
  completedCourses: number;
  currentPartIndex: number;
  totalParts: number;
  totalArchiveParts: number;
  completedParts: number;
  failedParts: number;
};
```

Add `"multipart-course"` to `PlanFallbackReason`.

- [ ] **Step 4: Implement checked deterministic next-fit partitioning**

Create `src/page/course-parts.ts`. The implementation must:

```ts
const resourceWeight = (resource: PlannedResource): number | null => {
  if (resource.kind === "page") return MAX_ARCHIVED_PAGE_BYTES;
  if (resource.kind !== "file") return 0;
  return resource.advertisedBytes;
};

export const partitionCoursePlan = (
  plan: CoursePlan,
): readonly CourseArchivePartPlan[] => {
  const immutable = freezeCoursePlan(plan);
  const terminalKeys = immutable.resources
    .filter(
      (resource) =>
        resource.kind === "external" || resource.kind === "unsupported",
    )
    .map((resource) => resource.key);
  const terminalKeySet = new Set(terminalKeys);
  const groups: string[][] = [];
  let current: string[] = [];
  let bytes = 0;
  let entryLimit = MAX_ARCHIVE_RESOURCES - terminalKeys.length;

  const flush = (): void => {
    if (current.length === 0) return;
    groups.push(current);
    current = [];
    bytes = 0;
    entryLimit = MAX_ARCHIVE_RESOURCES;
  };

  for (const resource of immutable.resources) {
    if (terminalKeySet.has(resource.key)) continue;
    const weight = resourceWeight(resource);
    const isolated =
      (resource.kind === "file" && weight === null) ||
      (typeof weight === "number" && weight > MAX_ARCHIVE_BYTES);
    if (isolated) {
      flush();
      groups.push([resource.key]);
      continue;
    }
    const nextBytes = bytes + (weight ?? 0);
    if (
      current.length > 0 &&
      (nextBytes > MAX_ARCHIVE_BYTES || current.length + 1 > entryLimit)
    ) {
      flush();
    }
    current.push(resource.key);
    bytes += weight ?? 0;
  }
  flush();
  if (groups.length === 0) groups.push([]);
  const firstPayloadKeys = new Set(groups[0]);
  groups[0] = immutable.resources
    .filter(
      (resource) =>
        terminalKeySet.has(resource.key) || firstPayloadKeys.has(resource.key),
    )
    .map((resource) => resource.key);

  const assignments = groups.flatMap((keys, groupIndex) =>
    keys.map((resourceKey) => ({ resourceKey, partIndex: groupIndex + 1 })),
  );
  return freezeAndValidateParts(groups, assignments, immutable.resources);
};
```

`freezeAndValidateParts()` must reject overflow, invalid/duplicate/missing keys,
non-canonical order, invalid indexes/totals, unknown files sharing a part, and
known oversized files sharing a part. It must clone and freeze every nested
array and assignment.

Implement `partFileName()` by requiring a `.zip` suffix, validating positive
safe indexes with `index <= total`, and inserting the zero-padded suffix before
`.zip`; return the input unchanged for `{ index: 1, total: 1 }`.

- [ ] **Step 5: Allow checked course aggregates while retaining per-part validation**

Rename `assertPilotSize()` to `assertCoursePlanSizes()` in discovery and all
imports. Keep exact file-size and checked-sum validation, but remove only the
final aggregate `total > MAX_ARCHIVE_BYTES` throw. The partitioner's validator
becomes the only path that approves an aggregate above the cap.

Update `freezeCoursePlan()` to call `assertCoursePlanSizes()`. Do not weaken the
per-resource safe-integer checks or the aggregate overflow check.

- [ ] **Step 6: Store parts beside each ready plan before review**

In `src/page/run-courses.ts`, introduce:

```ts
export type PlannedCourse = Readonly<{
  plan: CoursePlan;
  parts: readonly CourseArchivePartPlan[];
}>;

export type ImmutableRunPlan = Readonly<{
  courses: readonly PlannedCourse[];
  failures: readonly CoursePlanFailure[];
  summary: Readonly<RunPlanSummary>;
}>;
```

After discovery, freeze the plan, call `partitionCoursePlan()`, and store both.
Populate `folderPathFallbackCount` and `archivePartCount` in every selected
summary. Set `totalPlannedParts` to the checked sum of selected part counts. Set
`expectedArchiveCount` to that same sum for per-course output, `1` for a valid
non-empty combined output, or `0` when no course is ready. If any course has
more than one part and combined packaging was requested, set
`effectivePackaging: "per-course"` and `fallbackReason: "multipart-course"`
before the older combined fallback rules.

Replace the old oversized-course skip test with an assertion that a
`MAX_ARCHIVE_BYTES + 1` known file produces one ready outcome-only part. Add a
two-file aggregate test that produces two parts and the multipart fallback.

- [ ] **Step 7: Run partition and planning suites**

Run:

```bash
CI=true pnpm exec vitest run tests/page/course-parts.test.ts tests/page/run-courses.test.ts tests/canvas/discovery.test.ts tests/page/run-course.test.ts
```

Expected: PASS with deterministic part plans, no aggregate course skip, and all
existing unsafe-size and overflow cases still rejected.

- [ ] **Step 8: Commit the planning layer**

```bash
git add src/shared/constants.ts src/shared/model.ts src/canvas/discovery.ts src/page/course-parts.ts src/page/run-course.ts src/page/run-courses.ts tests/page/course-parts.test.ts tests/page/run-courses.test.ts tests/canvas/discovery.test.ts tests/page/run-course.test.ts
git commit -m "feat: partition oversized course plans"
```

---

### Task 3: Add a Strict Part Manifest and Cross-Part Navigation Model

**Files:**

- Modify: `src/archive/manifest.ts`
- Modify: `src/archive/navigation-model.ts`
- Modify: `src/archive/course-pages.ts`
- Modify: `src/archive/index-page.ts`
- Modify: `src/archive/build-zip.ts`
- Modify: `src/archive/style.ts`
- Modify: `src/static/archive.css`
- Modify: `tests/archive/manifest.test.ts`
- Modify: `tests/archive/navigation-model.test.ts`
- Modify: `tests/archive/course-pages.test.ts`
- Modify: `tests/archive/index-page.test.ts`
- Modify: `tests/archive/build-zip.test.ts`
- Modify: `tests/archive/archive-css.test.ts`

**Interfaces:**

- Consumes: complete `CoursePlan`, one `CourseArchivePartPlan`, and outcomes only for resources assigned to the active part.
- Produces: strict `ArchiveManifest.part`, `courseTotals`, `resourceCatalog`, and navigation entries with `availableInPart`.

- [ ] **Step 1: Write failing manifest and navigation contract tests**

Add a two-part synthetic fixture and assert:

```ts
expect(manifest.part).toEqual({ index: 1, total: 2 });
expect(manifest.courseTotals).toEqual({
  advertisedBytes: MAX_ARCHIVE_BYTES + 10,
  resourceCount: 2,
  unknownSizeCount: 0,
  folderPathFallbackCount: 1,
});
expect(manifest.resourceCatalog).toEqual([
  expect.objectContaining({
    key: "file:1",
    partIndex: 1,
    folderPathFallback: true,
  }),
  expect.objectContaining({
    key: "file:2",
    partIndex: 2,
    folderPathFallback: false,
  }),
]);
expect(model.resources.find(({ key }) => key === "file:2")).toMatchObject({
  status: "other-part",
  archivePath: null,
  availableInPart: 2,
});
```

Mutation tests must reject extra/missing keys, invalid part numbers, duplicate
catalog keys, mismatched catalog assignments, source URLs in the catalog,
incorrect fallback flags/counts, a local outcome assigned to another part, and
part-local payload totals above the existing limit.

- [ ] **Step 2: Run the focused archive suites and verify failure**

Run:

```bash
CI=true pnpm exec vitest run tests/archive/manifest.test.ts tests/archive/navigation-model.test.ts tests/archive/course-pages.test.ts tests/archive/build-zip.test.ts
```

Expected: FAIL because the part and catalog fields do not exist.

- [ ] **Step 3: Define the manifest structures and strict normalizer**

In `src/archive/manifest.ts`, add:

```ts
export type ArchivePart = { index: number; total: number };

export type ArchiveCourseTotals = {
  advertisedBytes: number;
  resourceCount: number;
  unknownSizeCount: number;
  folderPathFallbackCount: number;
};

export type ArchiveResourceCatalogEntry = {
  key: string;
  kind: ResourceKind;
  title: string;
  partIndex: number;
  folderPathFallback: boolean;
};
```

Extend `ArchiveManifest` with `part`, `courseTotals`, and `resourceCatalog`.
Change manifest construction to accept an `ArchiveSnapshot` containing
`partPlan`; local `resources` are produced only from this part's outcomes.
Course totals permit checked aggregates above 250 MiB. Local archived payload
totals remain capped at `MAX_ARCHIVE_BYTES`. A part-local advertised total may
exceed the cap only for a dedicated known-size resource whose outcome is
`unavailable` with `individual-size-limit`; validators must reject every other
over-cap local advertised relationship.

Require exact keys in every nested object. Validate the complete catalog
against the course plan and part assignments before cloning and freezing it.

- [ ] **Step 4: Merge local outcomes and catalog-only resources for navigation**

Extend `ArchiveResourceView` with:

```ts
status: OutcomeStatus | "other-part";
availableInPart: number | null;
folderPathFallback: boolean;
```

In `buildArchiveNavigationModel()`, map every catalog entry. For an entry
assigned to this part, use its exact local outcome. Otherwise create a view
with `status: "other-part"`, `archivePath: null`, `actualBytes: null`, and
`availableInPart: entry.partIndex`. Never copy the original cross-part
`archivePath` into the view.

- [ ] **Step 5: Render part identity, cross-part labels, and unfiled disclosure**

In `src/archive/course-pages.ts`, make non-local rows render fixed text:

```ts
const availability = (resource: ArchiveResourceView): string =>
  resource.availableInPart === null
    ? ""
    : ` <span class="resource-part">Available in Part ${resource.availableInPart}</span>`;
```

Add `Part N of M` to the archive header and each page heading. Add a fixed
unfiled notice when `folderPathFallbackCount > 0`. On `status.html`, show both
part totals and course totals with unambiguous labels. Keep links only for
local `success` resources and exact external resources.

Update `renderIndexPage()` to construct a validated one-part descriptor for
its compatibility call. Update `buildCourseZip()` verification so catalog-only
entries do not require ZIP payload entries and local successes still do.
Add the passive `.resource-part` and part-identity styles byte-for-byte to both
`src/static/archive.css` and the trusted `ARCHIVE_CSS` literal, and retain the
asset equality test.

- [ ] **Step 6: Run all archive contract tests**

Run:

```bash
CI=true pnpm exec vitest run tests/archive/manifest.test.ts tests/archive/navigation-model.test.ts tests/archive/course-pages.test.ts tests/archive/index-page.test.ts tests/archive/build-zip.test.ts tests/archive/archive-css.test.ts
```

Expected: PASS; every part is independently normalizable and verifiable, and
cross-part items are visible but never linked.

- [ ] **Step 7: Commit the archive contract**

```bash
git add src/archive/manifest.ts src/archive/navigation-model.ts src/archive/course-pages.ts src/archive/index-page.ts src/archive/build-zip.ts src/archive/style.ts src/static/archive.css tests/archive/manifest.test.ts tests/archive/navigation-model.test.ts tests/archive/course-pages.test.ts tests/archive/index-page.test.ts tests/archive/build-zip.test.ts tests/archive/archive-css.test.ts
git commit -m "feat: describe multipart archives offline"
```

---

### Task 4: Build One Safe Part and Classify Individually Oversized Files

**Files:**

- Modify: `src/page/run-course.ts`
- Modify: `tests/page/retrieval.test.ts`
- Modify: `tests/page/run-course.test.ts`
- Modify: `tests/integration/offline-archive-navigation.test.ts`

**Interfaces:**

- Consumes: complete `CoursePlan`, validated `CourseArchivePartPlan`, and existing `retrieve()` transport.
- Produces: one `RunResult` for one part; `Retrieval.failureCategory` additionally permits `individual-size-limit`.

- [ ] **Step 1: Write failing known-size, streamed-size, and page-bound tests**

Add tests proving:

```ts
expect(retrieve).not.toHaveBeenCalled();
expect(result.manifest.resources[0]).toMatchObject({
  status: "unavailable",
  failureCategory: "individual-size-limit",
  actualBytes: null,
});
```

for a known file above `MAX_ARCHIVE_BYTES` in its dedicated part. For an
unknown-size response with either an oversized `Content-Length` or a stream
crossing the remaining limit, assert `fetchFileResource()` cancels/clears the
body and returns:

```ts
{ status: "unavailable", failureCategory: "individual-size-limit" }
```

Add a page test whose sanitized or wrapped bytes exceed
`MAX_ARCHIVED_PAGE_BYTES`; it must become `page-too-large`, not a run-wide
safety failure. Assert other local resources in the part still complete.

- [ ] **Step 2: Run retrieval and builder tests to verify failure**

Run:

```bash
CI=true pnpm exec vitest run tests/page/retrieval.test.ts tests/page/run-course.test.ts tests/integration/offline-archive-navigation.test.ts
```

Expected: FAIL because size overflow is currently terminal and the builder
still operates on the complete course resources.

- [ ] **Step 3: Make unknown streamed overflow a local unavailable result**

Extend the closed retrieval failure union with `individual-size-limit`. In
`fetchFileResource()`, replace only the two unknown-size over-cap branches:

```ts
if (advertisedBytes === null && declared > remainingBytes) {
  await cancelBody(response);
  return { status: "unavailable", failureCategory: "individual-size-limit" };
}
```

During chunking, if the next chunk crosses the allowance, cancel the reader,
zero every retained chunk, and return the same unavailable result. Keep
mismatched known `Content-Length`, invalid length syntax, unsafe final URLs,
session responses, and changed stream lengths terminal.

- [ ] **Step 4: Filter work to the active part and preseed known oversized outcomes**

Extend `buildCourseArchive()` options with `partPlan`. Validate it against the
frozen complete plan. Build `localResources` by exact part key order. For a
known file with `advertisedBytes > MAX_ARCHIVE_BYTES`, create this outcome
without calling `retrieve()`:

```ts
{
  ...resource,
  status: "unavailable",
  actualBytes: null,
  failureCategory: "individual-size-limit",
}
```

Use local resource count for worker loops and progress, but pass the complete
plan, part plan, and local outcomes to navigation/manifest construction.

Before returning a successful page retrieval and again after wrapping, enforce
`MAX_ARCHIVED_PAGE_BYTES`; zero oversized buffers and use the existing
`page-too-large` unavailable outcome. Continue to enforce the total active-part
`byteLimit` independently.

- [ ] **Step 5: Preserve compatibility for direct single-course tests**

Keep `runCourse()` as a single-part compatibility helper. It calls
`partitionCoursePlan(plan)` and requires exactly one part before calling
`buildCourseArchive()`. Production multipart execution remains in
`runCourses()`. Update fixtures to pass explicit one-part plans when invoking
`buildCourseArchive()` directly.

- [ ] **Step 6: Run focused retrieval, archive, and integration tests**

Run:

```bash
CI=true pnpm exec vitest run tests/page/retrieval.test.ts tests/page/run-course.test.ts tests/archive/manifest.test.ts tests/archive/build-zip.test.ts tests/integration/offline-archive-navigation.test.ts
```

Expected: PASS; oversized resources are explicit local outcomes, page bounds
are enforced, and unsafe response mutations still stop.

- [ ] **Step 7: Commit the part-local builder**

```bash
git add src/page/run-course.ts tests/page/retrieval.test.ts tests/page/run-course.test.ts tests/integration/offline-archive-navigation.test.ts
git commit -m "feat: build bounded course archive parts"
```

---

### Task 5: Orchestrate Parts Sequentially and Clear Bytes Immediately

**Files:**

- Modify: `src/page/run-courses.ts`
- Modify: `src/page/runner.ts`
- Modify: `tests/page/run-courses.test.ts`
- Modify: `tests/page/runner.test.ts`
- Modify: `tests/integration/all-packing-failed-retry.test.ts`

**Interfaces:**

- Consumes: `PlannedCourse.parts`, `buildCourseArchive({ partPlan })`, and `partFileName()`.
- Produces: part-aware `MultiCourseResult` with completed/failed part descriptors and accurate output count.

- [ ] **Step 1: Write failing sequential-order, cleanup, and partial-failure tests**

Use a two-part first course followed by a one-part second course. Capture build,
download, and buffer state. Assert exact order:

```ts
expect(order).toEqual([
  "build:101:1",
  "download:101:1",
  "build:101:2",
  "download:101:2",
  "build:202:1",
  "download:202:1",
]);
```

At the start of each later build, assert the prior ZIP's `Uint8Array` is all
zero. Add a failure in part 2 of 3 and assert parts 1 and 3 download, the next
course continues, `failedParts` increments, and the course is incomplete.
Repeat with cancellation and `CanvasSessionError` and assert they remain global
stops after preserving already handed-off parts.

- [ ] **Step 2: Run orchestration tests and verify failure**

Run:

```bash
CI=true pnpm exec vitest run tests/page/run-courses.test.ts tests/page/runner.test.ts tests/integration/all-packing-failed-retry.test.ts
```

Expected: FAIL because the runner currently builds and retains one ZIP per
course.

- [ ] **Step 3: Define part-level result records**

In `src/page/run-courses.ts`, replace course-only completion storage with:

```ts
export type CompletedArchivePart = Readonly<{
  courseId: number;
  partIndex: number;
  totalParts: number;
  fileName: string;
}>;

export type FailedArchivePart = Readonly<{
  courseId: number;
  partIndex: number;
  totalParts: number;
}>;
```

`MultiCourseResult` returns `completedParts`, `failedParts`,
`completedCourseIds`, `failedCourseIds`, `outputCount`, and aggregate outcome
counts. Do not return or retain handed-off ZIP bytes.

- [ ] **Step 4: Implement nested sequential orchestration**

Iterate `plan.courses` in selection order and each `parts` array in index
order. For every successful part:

```ts
const result = await dependencies.buildCourseArchive({
  course: planned.plan.course,
  plan: planned.plan,
  partPlan,
  combinedRoot: null,
  signal,
  progress: partProgress,
  dependencies,
});
const outputName = partFileName(
  dependencies.fileName(planned.plan.course),
  partPlan,
);
dependencies.download(outputName, result.zipBytes);
addCounts(counts, result.manifest.totals);
completedParts.push({
  courseId: planned.plan.course.id,
  partIndex: partPlan.index,
  totalParts: partPlan.total,
  fileName: outputName,
});
result.zipBytes.fill(0);
```

Place `fill(0)` in a per-part `finally` so failed download callbacks and thrown
local build errors cannot retain bytes. Never push `zipBytes` into the final
result. A course is complete only when all its parts have successful archive
handoffs; `individual-size-limit` is a partial resource outcome but the
explanatory part itself counts as downloaded.

Combined mode remains available only when every planned course has one part.
Its existing behavior and cleanup stay unchanged.

- [ ] **Step 5: Emit part-aware progress and completion**

Validate the complete immutable run plan once before entering the build loop;
an invalid part assignment or summary is a global protocol/safety failure and
is never reclassified as a local build failure. Populate `currentPartIndex`,
`totalParts`, `totalArchiveParts`,
`completedParts`, and `failedParts` on every progress callback. In
`src/page/runner.ts`, derive the completion event from
`MultiCourseResult.outputCount`, completed course IDs, failed course IDs, and
fixed aggregate counts. Do not expose part filenames in the protocol.

- [ ] **Step 6: Run the orchestration and runner suites**

Run:

```bash
CI=true pnpm exec vitest run tests/page/run-courses.test.ts tests/page/runner.test.ts tests/integration/all-packing-failed-retry.test.ts
```

Expected: PASS with exact sequential order, immediate byte clearing, preserved
completed parts, continued local failures, and global cancellation/session
stops.

- [ ] **Step 7: Commit orchestration**

```bash
git add src/page/run-courses.ts src/page/runner.ts tests/page/run-courses.test.ts tests/page/runner.test.ts tests/integration/all-packing-failed-retry.test.ts
git commit -m "feat: download course parts sequentially"
```

---

### Task 6: Validate and Explain Multipart Plans in the Side Panel

**Files:**

- Modify: `src/shared/messages.ts`
- Modify: `src/sidepanel/state.ts`
- Modify: `src/sidepanel/main.ts`
- Modify: `src/static/sidepanel.css`
- Modify: `tests/shared/messages.test.ts`
- Modify: `tests/sidepanel/state.test.ts`
- Modify: `tests/sidepanel/main.test.ts`

**Interfaces:**

- Consumes: `folderPathFallbackCount`, `archivePartCount`, `multipart-course`, part-aware progress, and output count.
- Produces: strictly parsed runtime events and accessible review/progress/completion copy.

- [ ] **Step 1: Write failing protocol negative tests**

For `PLAN_READY`, reject absent, fractional, negative, overflowing, or
inconsistent `folderPathFallbackCount`, `archivePartCount`,
`totalPlannedParts`, and `expectedArchiveCount`. Require
`archivePartCount >= 1` for every ready course, require `totalPlannedParts` to
equal the checked selected part-count sum, require `expectedArchiveCount` to
equal `totalPlannedParts` for per-course output, `1` for non-empty combined
output, or `0` when no course is ready, and require
`fallbackReason: "multipart-course"` only when requested packaging is combined,
effective packaging is per-course, and at least one selected course has more
than one part.

For progress, reject invalid part indexes and count relationships, including:

```ts
currentPartIndex < 1;
currentPartIndex > totalParts;
completedParts + failedParts > totalArchiveParts;
```

Add parser acceptance for a valid mixed single/multipart plan and completion
with more outputs than courses.

- [ ] **Step 2: Run protocol and UI suites to verify failure**

Run:

```bash
CI=true pnpm exec vitest run tests/shared/messages.test.ts tests/sidepanel/state.test.ts tests/sidepanel/main.test.ts
```

Expected: FAIL because the new exact fields and UI text are absent.

- [ ] **Step 3: Extend exact message parsing**

Update `planSummary()` and `progressEvent()` in `src/shared/messages.ts` to
require the new keys and relationships. Preserve exact-record parsing: do not
use object spreading from untrusted event data. Add `multipart-course` to the
closed fallback parser and retain all existing combined fallback invariants.

- [ ] **Step 4: Retain part-aware state without storing filenames or content**

Update the initial packing progress in `src/sidepanel/state.ts`:

```ts
progress: {
  stage: "discovery",
  currentCourseId: firstCourse.courseId,
  currentCourseIndex: 0,
  totalCourses: state.plan.selected.length,
  completedCourses: 0,
  currentPartIndex: 1,
  totalParts: firstCourse.archivePartCount,
  totalArchiveParts: state.plan.totalPlannedParts,
  completedParts: 0,
  failedParts: 0,
  completed: 0,
  total: firstCourse.resourceCount,
  failed: 0,
},
```

Keep retry at course granularity after state loss. A course with any failed
part is included once in `retryCourseIds`; a course whose explanatory parts all
downloaded is complete even if it has an `individual-size-limit` resource.

- [ ] **Step 5: Render fixed review, progress, and completion explanations**

For each ready course, combine applicable fixed details:

```ts
const details = [
  summary.moduleDiscovery === "disabled" ? MODULES_DISABLED_NOTICE : null,
  summary.folderPathFallbackCount > 0
    ? `${summary.folderPathFallbackCount} file(s) will be saved in files/unfiled because Canvas folder placement was unavailable.`
    : null,
  summary.archivePartCount > 1
    ? `${summary.archivePartCount} ZIP parts will be downloaded.`
    : null,
]
  .filter((value): value is string => value !== null)
  .join(" ");
```

Add a dedicated multipart fallback notice, total expected ZIP count, and
progress text `Course X of Y, part N of M`. Completion must report archives,
completed courses, failed courses, completed parts, failed parts, and resource
outcome counts without claiming all content was saved when unavailable counts
are non-zero. Add only minimal CSS for readable detail lines and status text.

- [ ] **Step 6: Run protocol and Side Panel tests**

Run:

```bash
CI=true pnpm exec vitest run tests/shared/messages.test.ts tests/sidepanel/state.test.ts tests/sidepanel/main.test.ts
```

Expected: PASS, including accessibility assertions for live status, headings,
list labels, focus transitions, and retry behavior.

- [ ] **Step 7: Commit the user-facing contract**

```bash
git add src/shared/messages.ts src/sidepanel/state.ts src/sidepanel/main.ts src/static/sidepanel.css tests/shared/messages.test.ts tests/sidepanel/state.test.ts tests/sidepanel/main.test.ts
git commit -m "feat: explain multipart download plans"
```

---

### Task 7: Prove the Full Mixed Download-All Flow and Update Tester Guidance

**Files:**

- Modify: `tests/integration/pilot-flow.test.ts`
- Modify: `tests/integration/offline-archive-navigation.test.ts`
- Modify: `tests/page/runner.test.ts`
- Modify: `tests/package-pilot.test.ts`
- Modify: `tests/build/release-files.test.ts`
- Modify: `README.md`
- Modify: `SECURITY.md`
- Modify: `docs/pilot/INSTALL.md`
- Modify: `docs/pilot/TEST_CHECKLIST.md`

**Interfaces:**

- Consumes: complete discovery, partition, protocol, Side Panel, part build, ZIP verification, and package behavior from Tasks 1–6.
- Produces: privacy-safe automated and manual evidence for the Alpha 6 candidate.

- [ ] **Step 1: Write the failing mixed end-to-end synthetic test**

Create one Download all scenario with:

- one ordinary single-part course;
- one disabled-Modules course;
- one partial-folder-index course with two colliding unfiled files; and
- one course requiring two parts, including one cross-part module reference.

Capture downloads, unzip every output, and assert:

```ts
expect(downloads.map(({ name }) => name)).toEqual([
  "gradpack-ordinary.zip",
  "gradpack-disabled.zip",
  "gradpack-unfiled.zip",
  "gradpack-multipart-part-01-of-02.zip",
  "gradpack-multipart-part-02-of-02.zip",
]);
```

For every ZIP, normalize `manifest.json`, check `part`, catalog completeness,
part-local payload inventory, offline link containment, and fixed notices.
Assert every successful resource appears as payload exactly once across its
course parts and every cross-part reference is unlinked with the correct part
label.

- [ ] **Step 2: Run the mixed integration and package tests to verify any gaps**

Run:

```bash
CI=true pnpm exec vitest run tests/integration/pilot-flow.test.ts tests/integration/offline-archive-navigation.test.ts tests/page/runner.test.ts tests/package-pilot.test.ts tests/build/release-files.test.ts
```

Expected before final fixture/document updates: FAIL on missing mixed-flow
assertions or stale tester guidance; no production trust-boundary failure may be
waived.

- [ ] **Step 3: Complete integration wiring and deterministic archive assertions**

Make the smallest production adjustments exposed by the mixed test. Do not
change the approved interfaces or add fallback parsing. Ensure generated core
pages and `manifest.json` are deterministic for the same `createdAt`, plan, and
retrieval bytes. Verify each ZIP with `unzipSync()` and the existing build ZIP
validator.

- [ ] **Step 4: Update current behavior and safety documentation**

Document these exact behaviors without live examples:

- incomplete folder placement uses `files/unfiled/` with disclosure;
- courses larger than 250 MiB download as several self-contained ZIPs;
- every part remains under the existing hard payload cap;
- cross-part material is labelled rather than linked;
- an individually oversized file is explicitly unavailable;
- no new permission, origin, backend, persistence, or telemetry is added; and
- users must keep the signed-in Canvas tab open through all parts.

In `docs/pilot/TEST_CHECKLIST.md`, add privacy-safe fields for ready/skipped
course counts, expected/downloaded part counts, unfiled fallback count,
individual-size-limit count, maximum observed part payload, offline opening,
and cross-part labels. Do not add real course details.

- [ ] **Step 5: Run all focused suites and static checks**

Run:

```bash
CI=true pnpm exec vitest run tests/canvas/discovery.test.ts tests/page/course-parts.test.ts tests/page/retrieval.test.ts tests/page/run-course.test.ts tests/page/run-courses.test.ts tests/page/runner.test.ts tests/shared/messages.test.ts tests/archive/manifest.test.ts tests/archive/navigation-model.test.ts tests/archive/course-pages.test.ts tests/archive/build-zip.test.ts tests/sidepanel/state.test.ts tests/sidepanel/main.test.ts tests/integration/pilot-flow.test.ts tests/integration/offline-archive-navigation.test.ts tests/integration/all-packing-failed-retry.test.ts
CI=true pnpm typecheck
git diff --check
```

Expected: all focused tests pass, TypeScript reports no errors, and Git reports
no whitespace errors.

- [ ] **Step 6: Commit the integrated feature and guidance**

```bash
git add tests/integration/pilot-flow.test.ts tests/integration/offline-archive-navigation.test.ts tests/page/runner.test.ts tests/package-pilot.test.ts tests/build/release-files.test.ts README.md SECURITY.md docs/pilot/INSTALL.md docs/pilot/TEST_CHECKLIST.md
git commit -m "test: verify complete multipart download all"
```

---

### Task 8: Run Release Verification and Privacy-Safe Live Acceptance

**Files:**

- Verify only: all changed source, tests, docs, and generated temporary artifacts.
- Do not commit: local live evidence, generated ZIPs, extracted extension folders, checksums, screenshots, or Canvas data.

**Interfaces:**

- Consumes: committed Tasks 1–7.
- Produces: fresh automated result plus the final signed-in Chrome acceptance gate.

- [ ] **Step 1: Run the full repository verification from a clean worktree**

Run:

```bash
git status --short
CI=true pnpm verify
```

Expected: clean status before verification; formatting, linting, all Vitest
tests, type checking, and production build pass.

- [ ] **Step 2: Build and inspect the pilot package in a temporary directory**

Run the existing package script with an artifact root under `/private/tmp`, then
run the repository's release/package tests. Inspect the produced Alpha 6 ZIP
with `unzip -t`, `unzip -Z1`, and its SHA-256 verification command from
`docs/pilot/INSTALL.md`.

Expected: package and checksum verification pass; the ZIP inventory contains
only approved extension files; no package artifact is written into the Git
worktree.

- [ ] **Step 3: Scan committed and generated material for private evidence and placeholders**

Run targeted `rg` scans for known live-only course text and identifiers from the
debug session, plus split placeholder patterns such as `T[B]D`, `T[O]DO`, and
`F[I]XME`, over changed source, tests, docs, and the temporary extracted
package. Inspect every match rather than accepting an unexplained result.

Expected: no real course names, IDs, URLs, filenames, content, credentials, or
implementation placeholders are present.

- [ ] **Step 4: Load the freshly built unpacked extension in Chrome**

Use `chrome://extensions`, enable Developer mode, load or reload the temporary
unpacked Alpha 6 build, and verify the extension version shown is
`0.1.0-alpha.6`. Do not load source files directly.

- [ ] **Step 5: Perform the signed-in Download all acceptance flow**

With the existing signed-in Canvas session:

1. select all displayed active, completed, and concluded courses;
2. complete discovery without starting retrieval;
3. confirm the six folder-index cases are ready with an unfiled notice;
4. confirm the oversized course is ready with its expected part count;
5. confirm retrieval and allow all safe part downloads;
6. verify every downloaded ZIP is within the 250 MiB payload cap and opens;
7. open at least one single-part archive and every part of the multipart course;
8. verify `Part N of M`, `Available in Part N`, and the unfiled notice;
9. verify missing folder relationships do not use the generic safety label; and
10. verify cancellation or tab/session loss still stops safely if that negative
    case can be run without losing the successful evidence.

Record only aggregate counts, maximum part size, fixed outcome categories, and
pass/fail. Keep all course-specific evidence local and uncommitted.

- [ ] **Step 6: Re-run the final clean-state gate**

Run:

```bash
git status --short
git log --oneline -8
```

Expected: no uncommitted files or generated artifacts; the planned commits are
present in order. If live acceptance finds a defect, return to the relevant
task's failing test instead of editing around the plan.

---

## Final Definition of Done

- All eight tasks are committed in the isolated worktree with no unrelated
  changes.
- Missing folder relationships produce deterministic `files/unfiled/` paths
  and complete disclosure, while malformed folders remain rejected.
- Oversized courses produce deterministic self-contained parts and every part
  enforces the unchanged safety limits.
- Known and streamed individually oversized files are explicit local outcomes,
  not skipped courses or generic safety failures.
- Protocol, Side Panel, manifest, offline pages, retry, and completion counts
  agree exactly.
- Part building is sequential, completed downloads survive later local
  failures, and all in-memory bytes are cleared promptly.
- `CI=true pnpm verify`, package integrity, checksum, inventory, privacy scans,
  and fresh signed-in Chrome acceptance all pass.
