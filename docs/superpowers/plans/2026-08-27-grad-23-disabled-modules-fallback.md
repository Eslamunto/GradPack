# GRAD-23 Disabled Modules Fallback Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Keep a Canvas course downloadable when its Modules collection returns the exact disabled-course response, while clearly recording that only accessible pages and files could be discovered.

**Architecture:** Introduce a closed `ModuleDiscovery` state and propagate it through the course plan, runner protocol, archive manifest, and offline UI. The Canvas HTTP boundary recognizes only the exact disabled Modules response and raises a dedicated typed error; discovery catches only that error, skips module-item work, and continues through the existing validated Pages, Files, Folders, and page-linked-file paths.

**Tech Stack:** TypeScript 5.9, Chrome MV3, Canvas same-origin REST endpoints, Vitest 4, JSDOM, fflate, pnpm 11.

## Global Constraints

- Use only synthetic course data in source, tests, commits, pull requests, Linear, and release notes.
- Recognize only the exact JSON shape `{"message":"That page has been disabled for this course"}` on the initial expected Modules collection request.
- Make no module-item requests after the exact disabled Modules response.
- Continue only through existing same-origin, read-only Pages, Files, Folders, page-detail, and file-detail requests.
- Preserve 401/session-loss, redirect, origin, path, query, JSON-shape, identifier, archive-path, advertised-byte, streamed-byte, resource-count, and ZIP-entry protections.
- Preserve the 250 MiB hard limit for every course archive and all existing combined-to-per-course packaging fallback rules.
- Use the exact review sentence: `Module navigation is unavailable; GradPack will archive accessible pages and files instead.`
- Use the exact offline sentence: `Module navigation is unavailable; GradPack archived accessible pages and files instead.`
- Use `moduleDiscovery: "available" | "disabled"`; do not reuse `PlanFallbackReason` or a skipped-course failure category.
- Keep processing local-only with no backend, analytics, telemetry, credentials, or persistent response bodies.
- Follow TDD: observe every focused test fail for the intended reason before adding production behavior.

---

### Task 1: Add the typed module-discovery contract

**Files:**

- Modify: `src/shared/model.ts:23-29,96-102`
- Modify: `src/shared/messages.ts:239-255`
- Modify: `src/page/run-course.ts:82-106`
- Modify: `src/archive/manifest.ts:50-64,460-505,578-810`
- Modify: `tests/shared/messages.test.ts`
- Modify: `tests/page/run-course.test.ts`
- Modify: `tests/archive/manifest.test.ts`
- Modify: `tests/fixtures/course-plan.ts`
- Modify: all test-local `CoursePlan`, `CoursePlanSummary`, and `ArchiveManifest` literals reported by `pnpm typecheck`

**Interfaces:**

- Consumes: existing `CoursePlan`, `CoursePlanSummary`, `parseRunnerEvent`, and `freezeCoursePlan` contracts.
- Produces: `export type ModuleDiscovery = "available" | "disabled"`; required `moduleDiscovery` on `CoursePlan`, `CoursePlanSummary`, and `ArchiveManifest`; strict protocol and archive parsers.

- [ ] **Step 1: Add failing protocol tests for the closed state**

In `tests/shared/messages.test.ts`, add `moduleDiscovery: "available"` to every valid selected-course summary and add this rejection coverage beside the existing selected-summary validation tests:

```ts
it.each([undefined, null, "", "unavailable", false])(
  "rejects selected-course module discovery state %s",
  (moduleDiscovery) => {
    const event = resilientPlanEvent();
    const selected = event.selected as Record<string, unknown>[];
    selected[0] = { ...selected[0], moduleDiscovery };
    expect(() => parseRunnerEvent(event)).toThrow(TypeError);
  },
);
```

Add one positive assertion:

```ts
expect(parseRunnerEvent(resilientPlanEvent())).toMatchObject({
  selected: [{ courseId: 42, moduleDiscovery: "available" }],
});
```

- [ ] **Step 2: Run the protocol test and verify the intended failure**

Run: `pnpm exec vitest run tests/shared/messages.test.ts`

Expected: FAIL because `moduleDiscovery` is not parsed or returned.

- [ ] **Step 3: Add the model and strict parser**

In `src/shared/model.ts`, add:

```ts
export type ModuleDiscovery = "available" | "disabled";

export type CoursePlanSummary = {
  courseId: number;
  moduleDiscovery: ModuleDiscovery;
  advertisedBytes: number;
  unknownSizeCount: number;
  resourceCount: number;
};

export type CoursePlan = {
  course: CourseSummary;
  moduleDiscovery: ModuleDiscovery;
  modules: CourseModule[];
  resources: PlannedResource[];
  advertisedBytes: number;
};
```

Import `ModuleDiscovery` in `src/shared/messages.ts`, then add:

```ts
const moduleDiscovery = (value: unknown): ModuleDiscovery => {
  if (value !== "available" && value !== "disabled") {
    throw new TypeError("Invalid module discovery state");
  }
  return value;
};
```

Replace the selected-summary exact-key list and return value with:

```ts
exactKeys(input, [
  "courseId",
  "moduleDiscovery",
  "advertisedBytes",
  "unknownSizeCount",
  "resourceCount",
]);
return {
  courseId: positiveInteger(input.courseId, "Invalid course ID"),
  moduleDiscovery: moduleDiscovery(input.moduleDiscovery),
  advertisedBytes: nonNegativeInteger(input.advertisedBytes),
  unknownSizeCount: nonNegativeInteger(input.unknownSizeCount),
  resourceCount: nonNegativeInteger(input.resourceCount),
};
```

In `freezeCoursePlan`, copy the new scalar before `modules`:

```ts
const clone: CoursePlan = {
  course: { ...plan.course },
  moduleDiscovery: plan.moduleDiscovery,
  modules: plan.modules.map((module) => ({
    ...module,
    items: module.items.map((item) => ({ ...item })),
  })),
  resources: plan.resources.map((resource) => ({ ...resource })),
  advertisedBytes: plan.advertisedBytes,
};
```

- [ ] **Step 4: Extend strict plan and manifest validation**

Import `ModuleDiscovery` in `src/archive/manifest.ts` and add:

```ts
const moduleDiscovery = (value: unknown): ModuleDiscovery => {
  if (value !== "available" && value !== "disabled") {
    throw new TypeError("Invalid archive data");
  }
  return value;
};
```

Add `moduleDiscovery: ModuleDiscovery` to `ArchiveManifest`. Require it in the validated plan and normalized manifest exact-key lists:

```ts
const record = exactRecord(value, [
  "course",
  "moduleDiscovery",
  "modules",
  "resources",
  "advertisedBytes",
]);
```

```ts
const record = exactRecord(value, [
  "schemaVersion",
  "gradPackVersion",
  "createdAt",
  "canvasHost",
  "course",
  "moduleDiscovery",
  "totals",
  "resources",
]);
```

Return `moduleDiscovery: moduleDiscovery(valueOf(record, "moduleDiscovery"))` from validated plans and normalized manifests. Build manifests with:

```ts
moduleDiscovery: validatedPlan.moduleDiscovery,
```

Retain `schemaVersion: 1` because this alpha release reads and verifies only manifests generated during the current run.

- [ ] **Step 5: Update synthetic defaults and strict contract coverage**

Add `moduleDiscovery: "available"` to `planWithOneFile`, `syntheticArchivePlan`, and every other valid `CoursePlan` fixture. Add it to every valid `CoursePlanSummary` and `ArchiveManifest` literal. Do not use a cast to bypass the required property.

In `tests/page/run-course.test.ts`, extend the existing freeze test with:

```ts
expect(frozen.moduleDiscovery).toBe("available");
```

In `tests/archive/manifest.test.ts`, clone the synthetic plan with `moduleDiscovery: "disabled"` and assert:

```ts
const manifest = buildManifest(plan, copyOutcomes(), CREATED_AT);
expect(manifest.moduleDiscovery).toBe("disabled");
expect(() =>
  normalizeArchiveManifest({ ...manifest, moduleDiscovery: "unknown" }),
).toThrow(TypeError);
const missing = { ...manifest } as Record<string, unknown>;
Reflect.deleteProperty(missing, "moduleDiscovery");
expect(() => normalizeArchiveManifest(missing)).toThrow(TypeError);
```

- [ ] **Step 6: Run the focused contract tests and typecheck**

Run: `pnpm exec vitest run tests/shared/messages.test.ts tests/page/run-course.test.ts tests/archive/manifest.test.ts tests/archive/build-zip.test.ts && pnpm typecheck`

Expected: PASS; TypeScript reports no missing `moduleDiscovery` properties.

- [ ] **Step 7: Commit the typed contract**

```bash
git add src/shared/model.ts src/shared/messages.ts src/page/run-course.ts src/archive/manifest.ts tests/shared/messages.test.ts tests/page/run-course.test.ts tests/archive/manifest.test.ts tests/archive/build-zip.test.ts tests/fixtures/course-plan.ts tests
git commit -m "feat: add module discovery state"
```

---

### Task 2: Classify the exact disabled Modules response at the HTTP boundary

**Files:**

- Modify: `src/canvas/http.ts:4-20,59-160,293-317,459-469`
- Test: `tests/canvas/http.test.ts`

**Interfaces:**

- Consumes: `CanvasHttp.fetchAll<T>(url: URL): Promise<T[]>` and the existing exact same-origin response validation.
- Produces: `CanvasCourseModulesDisabledError extends CanvasResponseError`; exact disabled-shape classification for initial Modules collection responses with either a successful JSON object or a 403/404 JSON response.

- [ ] **Step 1: Write failing HTTP tests for exact classification**

Import `CanvasCourseModulesDisabledError` in `tests/canvas/http.test.ts`. Add:

```ts
it.each([200, 403, 404])(
  "classifies exact disabled Modules JSON at status %i",
  async (status) => {
    const url = `${CANVAS_ORIGIN}/api/v1/courses/101/modules?include%5B%5D=items&per_page=100`;
    const fetcher = vi
      .fn<typeof fetch>()
      .mockResolvedValue(
        jsonResponse(
          status,
          { message: "That page has been disabled for this course" },
          { url },
        ),
      );

    await expect(
      new CanvasHttp(fetcher).fetchAll(new URL(url)),
    ).rejects.toBeInstanceOf(CanvasCourseModulesDisabledError);
    expect(fetcher).toHaveBeenCalledOnce();
  },
);
```

Add strict negative cases:

```ts
it.each([
  { message: "That page has been disabled for this course", extra: true },
  { message: "Modules unavailable" },
  [],
])("does not classify non-exact Modules body %#", async (body) => {
  const url = `${CANVAS_ORIGIN}/api/v1/courses/101/modules?per_page=100`;
  const fetcher = vi
    .fn<typeof fetch>()
    .mockResolvedValue(jsonResponse(200, body, { url }));
  await expect(
    new CanvasHttp(fetcher).fetchAll(new URL(url)),
  ).rejects.not.toBeInstanceOf(CanvasCourseModulesDisabledError);
});
```

Add an unrelated endpoint case using `/files` and the exact message, expecting the existing invalid-response failure rather than `CanvasCourseModulesDisabledError`.

Exercise the defensive own-data-property checks by overriding a synthetic successful response's `json()` method:

```ts
it.each([
  Object.create({
    message: "That page has been disabled for this course",
  }) as object,
  Object.defineProperty({}, "message", {
    enumerable: true,
    get: () => "That page has been disabled for this course",
  }),
])("rejects inherited or accessor disabled messages", async (body) => {
  const url = `${CANVAS_ORIGIN}/api/v1/courses/101/modules?per_page=100`;
  const response = jsonResponse(200, [], { url });
  Object.defineProperty(response, "json", {
    value: vi.fn().mockResolvedValue(body),
  });
  const fetcher = vi.fn<typeof fetch>().mockResolvedValue(response);

  await expect(
    new CanvasHttp(fetcher).fetchAll(new URL(url)),
  ).rejects.not.toBeInstanceOf(CanvasCourseModulesDisabledError);
});
```

- [ ] **Step 2: Run the HTTP tests and verify the missing-error failure**

Run: `pnpm exec vitest run tests/canvas/http.test.ts`

Expected: FAIL because `CanvasCourseModulesDisabledError` is not exported and successful object responses still reach array pagination.

- [ ] **Step 3: Add exact endpoint and shape helpers**

In `src/canvas/http.ts`, add:

```ts
export class CanvasCourseModulesDisabledError extends CanvasResponseError {
  override readonly name = "CanvasCourseModulesDisabledError";
}

const isCourseCollectionIndex = (url: URL): boolean =>
  /^\/api\/v1\/courses\/[1-9]\d*\/(?:files|folders|modules|pages)$/.test(
    url.pathname,
  );

const isCourseModulesIndex = (url: URL): boolean =>
  /^\/api\/v1\/courses\/[1-9]\d*\/modules$/.test(url.pathname);

const hasConservativeDisabledCourseShape = (value: unknown): boolean => {
  if (!isRecord(value)) return false;
  const keys = ownKeys(value);
  if (!keys || keys.length !== 1 || keys[0] !== "message") return false;
  return (
    ownDataValue(value, "message") ===
    "That page has been disabled for this course"
  );
};
```

Rename the existing Pages-only helper usage to `hasConservativeDisabledCourseShape`.

- [ ] **Step 4: Classify both error-status and successful object responses**

In the 403/404 optional-index branch, place this check immediately after JSON parsing and before generic optional-index validation:

```ts
if (
  isCourseModulesIndex(url) &&
  hasConservativeDisabledCourseShape(errorValue)
) {
  throw new CanvasCourseModulesDisabledError(
    "Canvas course Modules are disabled",
  );
}
```

Retain the Pages condition using the renamed helper. Then make the `fetchAll` request callback async and inspect only the initial Modules page:

```ts
fetchAll<T>(url: URL): Promise<T[]> {
  let initial = true;
  return fetchAllPages<T>(async (next) => {
    const isInitial = initial;
    initial = false;
    const page = await this.requestJson<unknown>(next, {
      optionalCourseIndexInitial: isInitial && isCourseCollectionIndex(url),
      continuation: !isInitial,
    });
    if (
      isInitial &&
      isCourseModulesIndex(url) &&
      hasConservativeDisabledCourseShape(page.value)
    ) {
      throw new CanvasCourseModulesDisabledError(
        "Canvas course Modules are disabled",
      );
    }
    return page as { value: T[]; response: Response };
  }, url);
}
```

The existing request validation already proves the successful response has the exact requested origin, path, and query before this check executes.

- [ ] **Step 5: Run focused HTTP and pagination tests**

Run: `pnpm exec vitest run tests/canvas/http.test.ts tests/canvas/pagination.test.ts`

Expected: PASS, including existing redirect, malformed JSON, optional index, continuation, and pagination safety tests.

- [ ] **Step 6: Commit HTTP classification**

```bash
git add src/canvas/http.ts tests/canvas/http.test.ts
git commit -m "feat: classify disabled Canvas modules"
```

---

### Task 3: Continue course discovery through Pages and Files

**Files:**

- Modify: `src/canvas/discovery.ts:1-20,356-414,591-790`
- Modify: `src/page/run-courses.ts:126-171`
- Modify: `tests/fixtures/course-plan.ts:20-200`
- Test: `tests/canvas/discovery.test.ts`
- Test: `tests/page/run-courses.test.ts`

**Interfaces:**

- Consumes: `CanvasCourseModulesDisabledError`, `ModuleDiscovery`, and existing optional-index and page-linked-file behavior.
- Produces: disabled-Modules `CoursePlan` values with `moduleDiscovery: "disabled"`, `modules: []`, accessible page/file resources, accurate bytes, and no module-item calls; plan summaries preserving the state.

- [ ] **Step 1: Extend the synthetic HTTP fixture and write the failing discovery test**

Add `modulesDisabled?: boolean` to `SyntheticOptions`. Import `CanvasCourseModulesDisabledError`, then make the Modules fixture branch explicit:

```ts
if (url.pathname.endsWith("/modules")) {
  if (options.modulesDisabled) {
    throw new CanvasCourseModulesDisabledError(
      "Canvas course Modules are disabled",
    );
  }
  return options.modules ?? [module];
}
```

In `tests/canvas/discovery.test.ts`, add:

```ts
it("archives accessible pages and files when Modules are disabled", async () => {
  const http = syntheticCanvasHttp({
    modulesDisabled: true,
    files: [
      {
        id: 301,
        folder_id: 401,
        display_name: "reading.pdf",
        filename: "reading.pdf",
        size: 19,
        url: `${CANVAS_ORIGIN}/files/301/download`,
      },
    ],
    pages: [{ page_id: 501, url: "day-1", title: "Day 1" }],
    pageDetails: {
      "day-1": {
        title: "Day 1",
        body: '<a href="/courses/101/files/302/download">Reading</a>',
      },
    },
  });

  const plan = await discoverCoursePlan(http, syntheticCourse);

  expect(plan.moduleDiscovery).toBe("disabled");
  expect(plan.modules).toEqual([]);
  expect(plan.resources.map(({ key }) => key)).toEqual([
    "file:301",
    "file:302",
    "page:day-1",
  ]);
  expect(http.fetchAll.mock.calls.map(([url]) => url.pathname)).not.toContain(
    "/api/v1/courses/101/modules/201/items",
  );
});
```

Add an empty-index case expecting `moduleDiscovery: "disabled"`, zero modules, zero resources, and zero advertised bytes. Add an ordinary-course assertion expecting `moduleDiscovery: "available"`.

- [ ] **Step 2: Run discovery tests and verify disabled Modules still rejects**

Run: `pnpm exec vitest run tests/canvas/discovery.test.ts`

Expected: FAIL with `CanvasCourseModulesDisabledError` escaping discovery.

- [ ] **Step 3: Convert only the dedicated error before the scheduler can latch it**

Import `CanvasCourseModulesDisabledError` and `ModuleDiscovery`. Add:

```ts
type LoadedModules = {
  moduleDiscovery: ModuleDiscovery;
  parsedModules: ParsedModule[];
};

const loadModules = async (
  http: CanvasHttp,
  run: DiscoveryRun,
  courseId: number,
): Promise<LoadedModules> => {
  const initial = await run.one(async () => {
    try {
      return {
        moduleDiscovery: "available" as const,
        rawModules: await http.fetchAll<unknown>(
          canvasEndpoint({ type: "courseModules", courseId }),
        ),
      };
    } catch (error) {
      if (error instanceof CanvasCourseModulesDisabledError) {
        return { moduleDiscovery: "disabled" as const, rawModules: [] };
      }
      throw error;
    }
  });
  if (initial.moduleDiscovery === "disabled") {
    return { moduleDiscovery: "disabled", parsedModules: [] };
  }
  const descriptors = initial.rawModules.map((value) => {
    if (!isRecord(value)) throw new TypeError("Invalid module record");
    const id = positiveId(own(value, "id"), "module ID");
    const inline = own(value, "items");
    if (inline !== undefined && inline !== null && !Array.isArray(inline)) {
      throw new TypeError("Invalid inline module items");
    }
    return { value, id, inline: Array.isArray(inline) ? inline : null };
  });
  const loaded = await run.all(
    descriptors.map(({ value, id, inline }) => async () => {
      const rawItems =
        inline ??
        (await http.fetchAll<unknown>(
          canvasEndpoint({ type: "moduleItems", courseId, moduleId: id }),
        ));
      const normalized = rawItems.map(normalizeItem);
      normalized.sort(
        (left, right) =>
          left.item.position - right.item.position ||
          left.item.id - right.item.id,
      );
      return {
        module: {
          id,
          name: optionalText(own(value, "name"), `Module ${id}`, "module name"),
          position: position(own(value, "position")),
          items: normalized.map(({ item }) => item),
        },
        rawItems: normalized.map(({ raw }) => raw),
      };
    }),
  );
  loaded.sort(
    (left, right) =>
      left.module.position - right.module.position ||
      left.module.id - right.module.id,
  );
  const ids = new Set<number>();
  for (const { module } of loaded) {
    if (ids.has(module.id)) throw new TypeError("Duplicate module ID");
    ids.add(module.id);
  }
  return { moduleDiscovery: "available", parsedModules: loaded };
};
```

Because the dedicated error is converted inside the `run.one` operation, the shared scheduler never latches this expected state. Every other rejection still reaches the existing scheduler failure and abort path unchanged.

At the start of `discoverCoursePlan`, replace the old `parsedModules` assignment with:

```ts
const { moduleDiscovery, parsedModules } = await loadModules(
  http,
  run,
  course.id,
);
```

Add `moduleDiscovery` to the returned plan:

```ts
const plan: CoursePlan = {
  course,
  moduleDiscovery,
  modules: parsedModules.map(({ module }) => module),
  resources,
  advertisedBytes,
};
```

- [ ] **Step 4: Propagate state into run-plan summaries**

In `src/page/run-courses.ts`, replace the selected mapping with:

```ts
const selected = courses.map(
  ({ course, moduleDiscovery, advertisedBytes, resources }) => ({
    courseId: course.id,
    moduleDiscovery,
    advertisedBytes,
    unknownSizeCount: resources.filter(
      (resource) =>
        resource.kind === "file" && resource.advertisedBytes === null,
    ).length,
    resourceCount: resources.length,
  }),
);
```

In `tests/page/run-courses.test.ts`, assert mixed planning preserves both states:

```ts
expect(plan.summary.selected).toEqual([
  expect.objectContaining({ courseId: 101, moduleDiscovery: "available" }),
  expect.objectContaining({ courseId: 202, moduleDiscovery: "disabled" }),
]);
```

- [ ] **Step 5: Run discovery and orchestration tests**

Run: `pnpm exec vitest run tests/canvas/discovery.test.ts tests/page/run-courses.test.ts tests/integration/pilot-flow.test.ts`

Expected: PASS; the disabled course remains ready and totals include only its discovered resources.

- [ ] **Step 6: Commit discovery fallback**

```bash
git add src/canvas/discovery.ts src/page/run-courses.ts tests/fixtures/course-plan.ts tests/canvas/discovery.test.ts tests/page/run-courses.test.ts
git commit -m "feat: discover files without Canvas modules"
```

---

### Task 4: Show the per-course limitation during review

**Files:**

- Modify: `src/sidepanel/main.ts:237-280`
- Test: `tests/sidepanel/main.test.ts`

**Interfaces:**

- Consumes: `RunPlanSummary.selected[].moduleDiscovery` and the existing `courseList` detail rendering.
- Produces: affected courses remain under **Ready courses** with the exact fixed notice; no new skipped category.

- [ ] **Step 1: Write the failing review rendering test**

Add a review event fixture with one `available` and one `disabled` selected summary. After dispatching `PLAN_READY`, assert:

```ts
const ready = [...document.querySelectorAll(".ready-courses li")].map(
  (element) => element.textContent,
);
expect(ready).toHaveLength(2);
expect(ready[1]).toContain(
  "Module navigation is unavailable; GradPack will archive accessible pages and files instead.",
);
expect(document.querySelectorAll(".skipped-courses li")).toHaveLength(0);
expect(document.body.textContent).not.toContain(
  "Course metadata did not pass GradPack's safety checks.",
);
```

- [ ] **Step 2: Run the Side Panel test and verify the notice is missing**

Run: `pnpm exec vitest run tests/sidepanel/main.test.ts`

Expected: FAIL because ready courses currently render without details.

- [ ] **Step 3: Map ready summaries to course details**

Add the fixed constant near the existing failure messages:

```ts
const MODULES_DISABLED_NOTICE =
  "Module navigation is unavailable; GradPack will archive accessible pages and files instead.";
```

Replace `readyCourses` construction with:

```ts
const readyCourses = review.plan.selected
  .map((summary) => {
    const course = courseForId(review.courses, summary.courseId);
    return course
      ? {
          course,
          detail:
            summary.moduleDiscovery === "disabled"
              ? MODULES_DISABLED_NOTICE
              : undefined,
        }
      : null;
  })
  .filter(
    (entry): entry is { course: CourseSummary; detail: string | undefined } =>
      entry !== null,
  );
```

Render it directly:

```ts
courseList("ready-courses", readyCourses);
```

Keep `readyCourses.length` for the summary and action logic.

- [ ] **Step 4: Run Side Panel and state tests**

Run: `pnpm exec vitest run tests/sidepanel/main.test.ts tests/sidepanel/state.test.ts tests/shared/messages.test.ts`

Expected: PASS; affected courses are ready, not skipped.

- [ ] **Step 5: Commit review messaging**

```bash
git add src/sidepanel/main.ts tests/sidepanel/main.test.ts
git commit -m "feat: explain disabled modules during review"
```

---

### Task 5: Render module discovery in each archive

**Files:**

- Modify: `src/archive/course-pages.ts:80-140`
- Modify: `src/archive/combined.ts:125-145`
- Test: `tests/archive/course-pages.test.ts`
- Test: `tests/archive/combined.test.ts`
- Test: `tests/archive/build-zip.test.ts`
- Test: `tests/archive/navigation-model.test.ts`

**Interfaces:**

- Consumes: the strictly validated `ArchiveManifest.moduleDiscovery` contract from Task 1.
- Produces: disabled notices on `index.html`, `modules.html`, and `status.html`; accurate combined-course card copy.

- [ ] **Step 1: Write failing page and combined-archive tests**

In `tests/archive/course-pages.test.ts`, render a disabled clone and assert the exact notice appears in `index.html`, `modules.html`, and `status.html`, while `pages.html` and `files.html` remain present.

In `tests/archive/combined.test.ts`, build one available and one disabled archive and assert the root card for the disabled course contains `Module navigation unavailable` and does not contain `0 modules · 0 module items`.

- [ ] **Step 2: Run archive tests and verify the new copy is absent**

Run: `pnpm exec vitest run tests/archive/course-pages.test.ts tests/archive/combined.test.ts`

Expected: FAIL because the HTML does not render the validated state.

- [ ] **Step 3: Render the exact offline limitation**

In `src/archive/course-pages.ts`, add:

```ts
const modulesUnavailable = model.manifest.moduleDiscovery === "disabled";
const modulesNotice =
  '<aside class="panel modules-unavailable"><h2>Module navigation unavailable</h2><p>Module navigation is unavailable; GradPack archived accessible pages and files instead.</p></aside>';
```

Append `modulesNotice` to the home and status content only when `modulesUnavailable`. For `modules.html`, use:

```ts
`<h1>Modules</h1>${
  modulesUnavailable
    ? modulesNotice
    : modules || "<p>No modules were listed.</p>"
}`;
```

Keep the approved future-tense Side Panel sentence unchanged; the offline sentence uses past tense because packaging has completed.

- [ ] **Step 4: Make combined cards truthful**

In `src/archive/combined.ts`, derive each card detail from its nested manifest:

```ts
const inventory =
  archive.manifest.moduleDiscovery === "disabled"
    ? `Module navigation unavailable · ${archive.manifest.totals.success} saved resources`
    : `${archive.moduleCount} modules · ${archive.itemCount} module items · ${archive.manifest.totals.success} saved resources`;
```

Insert `escapeHtml(inventory)` inside the card paragraph. Do not change combined totals or nested manifest normalization.

- [ ] **Step 5: Run the complete archive test group**

Run: `pnpm exec vitest run tests/archive tests/integration/offline-archive-navigation.test.ts`

Expected: PASS, including deterministic ZIP payload, manifest normalization, navigation, HTML allowlist, and combined archive checks.

- [ ] **Step 6: Commit archive disclosure**

```bash
git add src/archive/course-pages.ts src/archive/combined.ts tests/archive tests/integration/offline-archive-navigation.test.ts
git commit -m "feat: disclose disabled modules in archives"
```

---

### Task 6: Add an end-to-end mixed-course regression and run release verification

**Files:**

- Modify: `tests/integration/pilot-flow.test.ts`
- Verify: `docs/superpowers/specs/2026-08-27-grad-23-disabled-modules-fallback-design.md`

**Interfaces:**

- Consumes: all contracts from Tasks 1-5.
- Produces: one regression proving an available course and a disabled-Modules course both reach retrieval and produce truthful offline archives in the same run.

- [ ] **Step 1: Add the mixed-run integration regression**

Add a test that supplies two synthetic courses to the multi-course runner: one ordinary plan and one plan with `moduleDiscovery: "disabled"`, `modules: []`, one page, and one file. Capture downloads and unzip them. Assert:

```ts
expect(planReady.selected).toEqual([
  expect.objectContaining({ courseId: 101, moduleDiscovery: "available" }),
  expect.objectContaining({ courseId: 202, moduleDiscovery: "disabled" }),
]);
expect(downloads).toHaveLength(2);
expect(disabledManifest.moduleDiscovery).toBe("disabled");
expect(disabledModulesHtml).toContain("Module navigation unavailable");
expect(disabledPagesHtml).toContain("Day 1");
expect(disabledFilesHtml).toContain("reading.pdf");
```

Also assert no skipped-course entry exists and that advertised/resource totals equal the sum of the two actual plans.

- [ ] **Step 2: Run the mixed-run regression**

Run: `pnpm exec vitest run tests/integration/pilot-flow.test.ts`

Expected: PASS because Tasks 1-5 established each contract with focused failing tests before this end-to-end assertion was added.

- [ ] **Step 3: Run focused feature verification**

Run:

```bash
pnpm exec vitest run tests/canvas/http.test.ts tests/canvas/discovery.test.ts tests/shared/messages.test.ts tests/page/run-course.test.ts tests/page/run-courses.test.ts tests/sidepanel/main.test.ts tests/archive tests/integration/pilot-flow.test.ts tests/integration/offline-archive-navigation.test.ts
```

Expected: PASS with no unhandled rejection, snapshot drift, or fixture cast bypass.

- [ ] **Step 4: Run formatting and inspect the exact diff**

Run: `pnpm format`

Run: `git diff --check`

Run: `git diff --stat origin/main && git status --short`

Expected: formatting completes; `git diff --check` prints nothing; only GRAD-23 spec, plan, source, and test files are changed.

- [ ] **Step 5: Run the full repository gate**

Run: `CI=true pnpm verify`

Expected: formatting check, ESLint, TypeScript, all Vitest files, and production build pass.

- [ ] **Step 6: Build and verify the pilot package**

Run: `pnpm package:pilot`

Run: `pnpm exec vitest run tests/build/release-files.test.ts tests/build/manifest.test.ts tests/build/output.test.ts tests/package-pilot.test.ts`

Expected: PASS; the generated extension and pilot ZIP inventory, checksums, manifest, and deterministic package checks are valid.

- [ ] **Step 7: Scan for private evidence and placeholders**

Run:

```bash
rg -n "Capital Market[s]|Corporate Financia[l]|1814[6]|1806[6]|1953[9]" src tests docs/superpowers/specs/2026-08-27-grad-23-disabled-modules-fallback-design.md docs/superpowers/plans/2026-08-27-grad-23-disabled-modules-fallback.md
rg -n "T[B]D|T[O]DO|F[I]XME" src tests
```

Expected: no real course identifiers or names; no implementation placeholders. Existing unrelated source comments, if any, must be inspected and shown unrelated before proceeding.

- [ ] **Step 8: Commit final regression and verification adjustments**

```bash
git add tests/integration/pilot-flow.test.ts docs/superpowers/specs/2026-08-27-grad-23-disabled-modules-fallback-design.md docs/superpowers/plans/2026-08-27-grad-23-disabled-modules-fallback.md
git commit -m "test: verify disabled modules fallback"
```

- [ ] **Step 9: Perform the separate live acceptance gate**

Load the newly built unpacked extension in the signed-in Chrome profile, select one course whose Modules area is disabled, and complete review and retrieval. Verify:

1. The course is listed as ready with the fixed limitation notice.
2. No `safety-validation` message appears for the exact disabled Modules response.
3. The ZIP downloads successfully.
4. `manifest.json` records `moduleDiscovery: "disabled"`.
5. `index.html`, `modules.html`, and `status.html` disclose unavailable module navigation.
6. Every page and file visible through the accessible Canvas Pages and Files indexes appears in the offline archive or has an explicit resource outcome.

Record only pass/fail counts and privacy-safe behavior. Do not copy course names, IDs, URLs, filenames, or content into the repository or pull request. Automated verification is complete before this step, but release acceptance is not complete until this signed-in gate passes.
