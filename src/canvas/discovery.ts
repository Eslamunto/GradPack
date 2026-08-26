import { canonicalArchivePath, safeArchivePath } from "../archive/paths";
import {
  CANVAS_PAGE_JSON_MAX_BYTES,
  MAX_ARCHIVE_BYTES,
  MAX_CONCURRENCY,
  CANVAS_ORIGIN,
} from "../shared/constants";
import type {
  CourseModule,
  CoursePlan,
  CourseSummary,
  ModuleItem,
  PlannedResource,
} from "../shared/model";
import { canvasEndpoint } from "./endpoints";
import {
  CanvasBodySizeError,
  CanvasCourseIndexUnavailableError,
  CanvasResourceUnavailableError,
  type CanvasHttp,
} from "./http";
import { exactCanvasPage, pageLinkedFileIds } from "./page-links";

export class PilotSizeError extends Error {}

type RawModuleItem = Record<string, unknown>;

type NormalizedFile = {
  id: number;
  folderId: number | null;
  title: string;
  size: number | null;
  sourceUrl: string;
};

type NormalizedPage = {
  token: string;
  pageId: number | null;
  title: string;
};

type ParsedModule = {
  module: CourseModule;
  rawItems: RawModuleItem[];
};

type ResourceDraft = PlannedResource & {
  preferredPath: string | null;
  disambiguator: string;
};

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const own = (value: Record<string, unknown>, key: string): unknown =>
  Object.hasOwn(value, key) ? value[key] : undefined;

const positiveId = (value: unknown, context = "ID"): number => {
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value <= 0) {
    throw new TypeError(`Invalid ${context}`);
  }
  return value;
};

const position = (value: unknown): number => {
  if (value === undefined) return 0;
  if (typeof value !== "number" || !Number.isSafeInteger(value)) {
    throw new TypeError("Invalid position");
  }
  return value;
};

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

const optionalText = (
  value: unknown,
  fallback: string,
  context: string,
): string => {
  if (value === undefined || value === null) return fallback;
  if (typeof value !== "string") throw new TypeError(`Invalid ${context}`);
  const trimmed = value.trim();
  return trimmed ? trimmed.slice(0, 500) : fallback;
};

const requiredText = (value: unknown, context: string): string => {
  if (typeof value !== "string" || !value.trim()) {
    throw new TypeError(`Invalid ${context}`);
  }
  return value.trim();
};

const pageToken = (value: unknown): string => {
  if (typeof value !== "string" || !/^[a-zA-Z0-9_-]{1,255}$/.test(value)) {
    throw new TypeError("Invalid page token");
  }
  return value;
};

const lexicographic = (left: string, right: string): number =>
  left < right ? -1 : left > right ? 1 : 0;

const strictCanvasFileUrl = (value: unknown, id: number): string => {
  if (typeof value !== "string") throw new TypeError("Invalid file URL");
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new TypeError("Invalid file URL");
  }
  if (
    url.origin !== CANVAS_ORIGIN ||
    url.protocol !== "https:" ||
    url.username !== "" ||
    url.password !== "" ||
    url.hash !== "" ||
    url.pathname !== `/files/${id}/download`
  ) {
    throw new TypeError("Rejected file URL");
  }
  return url.href;
};

const strictExternalUrl = (value: unknown): string => {
  if (typeof value !== "string") throw new TypeError("Invalid external URL");
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new TypeError("Invalid external URL");
  }
  if (url.protocol !== "https:" || url.username !== "" || url.password !== "") {
    throw new TypeError("Rejected external URL");
  }
  return url.href;
};

const normalizeFile = (value: unknown): NormalizedFile => {
  if (!isRecord(value)) throw new TypeError("Invalid file record");
  const id = positiveId(own(value, "id"), "file ID");
  const displayName = own(value, "display_name");
  const filename = own(value, "filename");
  const fallbackName = optionalText(filename, `file-${id}`, "filename");
  const title = optionalText(displayName, fallbackName, "file display name");
  const rawFolderId = own(value, "folder_id");
  const folderId =
    rawFolderId === undefined || rawFolderId === null
      ? null
      : positiveId(rawFolderId, "folder ID");
  const rawSize = own(value, "size");
  if (
    typeof rawSize !== "number" ||
    !Number.isSafeInteger(rawSize) ||
    rawSize < 0
  ) {
    throw new TypeError("Invalid file size");
  }
  const size = rawSize;
  return {
    id,
    folderId,
    title,
    size,
    sourceUrl: strictCanvasFileUrl(own(value, "url"), id),
  };
};

const normalizePage = (value: unknown): NormalizedPage => {
  if (!isRecord(value)) throw new TypeError("Invalid page record");
  const token = pageToken(own(value, "url"));
  const rawPageId = own(value, "page_id");
  return {
    token,
    pageId:
      rawPageId === undefined || rawPageId === null
        ? null
        : positiveId(rawPageId, "page ID"),
    title: optionalText(own(value, "title"), token, "page title"),
  };
};

const normalizeFolderMap = (
  values: readonly unknown[],
): Map<number, string[]> => {
  const folders = new Map<number, string[]>();
  for (const value of values) {
    if (!isRecord(value)) throw new TypeError("Invalid folder record");
    const id = positiveId(own(value, "id"), "folder ID");
    const rawFullName = own(value, "full_name");
    if (typeof rawFullName !== "string" || !rawFullName.trim()) {
      throw new TypeError("Invalid folder path");
    }
    const fullName = rawFullName.trim();
    const segments = fullName.split("/");
    if (segments.some((segment) => !segment.trim())) {
      throw new TypeError("Invalid folder path");
    }
    const relative = segments.slice(1);
    const prior = folders.get(id);
    if (prior && prior.join("/") !== relative.join("/")) {
      throw new TypeError("Conflicting folder record");
    }
    folders.set(id, relative);
  }
  return folders;
};

type DiscoveryFailure = Error | DOMException;
type RunOwner = {
  failure?: { error: DiscoveryFailure };
  abort?: (reason: DiscoveryFailure) => void;
};

type ScheduledJob = {
  owner: RunOwner;
  operation: () => Promise<unknown>;
  resolve: (value: unknown) => void;
  reject: (error: unknown) => void;
};

class SharedRequestScheduler {
  private active = 0;
  private queue: ScheduledJob[] = [];

  schedule<T>(owner: RunOwner, operation: () => Promise<T>): Promise<T> {
    if (owner.failure) return Promise.reject(owner.failure.error);
    return new Promise<T>((resolve, reject) => {
      this.queue.push({
        owner,
        operation,
        resolve: (value) => resolve(value as T),
        reject,
      });
      this.drain();
    });
  }

  private latch(owner: RunOwner, error: unknown): DiscoveryFailure {
    if (!owner.failure) {
      owner.failure = {
        error:
          error instanceof Error || error instanceof DOMException
            ? error
            : new TypeError("Canvas discovery failed"),
      };
      owner.abort?.(owner.failure.error);
    }
    const failure = owner.failure.error;
    const pending: ScheduledJob[] = [];
    for (const job of this.queue) {
      if (job.owner === owner) job.reject(failure);
      else pending.push(job);
    }
    this.queue = pending;
    return failure;
  }

  private drain(): void {
    while (this.active < MAX_CONCURRENCY && this.queue.length > 0) {
      const job = this.queue.shift()!;
      if (job.owner.failure) {
        job.reject(job.owner.failure.error);
        continue;
      }
      this.active += 1;
      void Promise.resolve()
        .then(job.operation)
        .then(job.resolve, (error: unknown) => {
          job.reject(this.latch(job.owner, error));
        })
        .finally(() => {
          this.active -= 1;
          this.drain();
        });
    }
  }
}

const sharedRequestScheduler = new SharedRequestScheduler();

class DiscoveryRun {
  private readonly owner: RunOwner;

  constructor(abort?: (reason: DiscoveryFailure) => void) {
    this.owner = { ...(abort ? { abort } : {}) };
  }

  one<T>(operation: () => Promise<T>): Promise<T> {
    return sharedRequestScheduler.schedule(this.owner, operation);
  }

  async all<T>(operations: ReadonlyArray<() => Promise<T>>): Promise<T[]> {
    const settled = await Promise.allSettled(
      operations.map((operation) => this.one(operation)),
    );
    if (this.owner.failure) throw this.owner.failure.error;
    return settled.map((result) => {
      if (result.status === "rejected") throw result.reason;
      return result.value;
    });
  }
}

const fetchOptionalIndex = async <T>(
  operation: () => Promise<T[]>,
): Promise<T[] | null> => {
  try {
    return await operation();
  } catch (error) {
    if (error instanceof CanvasCourseIndexUnavailableError) return null;
    throw error;
  }
};

const normalizeItem = (
  value: unknown,
): { item: ModuleItem; raw: RawModuleItem } => {
  if (!isRecord(value)) throw new TypeError("Invalid module item");
  const id = positiveId(own(value, "id"), "module item ID");
  const type = requiredText(own(value, "type"), "module item type");
  let resourceKey: string;
  if (type === "File") {
    resourceKey = `file:${positiveId(own(value, "content_id"), "file ID")}`;
  } else if (type === "Page") {
    resourceKey = `page:${pageToken(own(value, "page_url"))}`;
  } else if (type === "ExternalUrl") {
    strictExternalUrl(own(value, "external_url"));
    resourceKey = `external:${id}`;
  } else {
    resourceKey = `unsupported:${id}`;
  }
  return {
    item: {
      id,
      title: optionalText(own(value, "title"), `Item ${id}`, "item title"),
      position: position(own(value, "position")),
      indent: moduleIndent(own(value, "indent")),
      resourceKey,
      type,
    },
    raw: value,
  };
};

const loadModules = async (
  http: CanvasHttp,
  run: DiscoveryRun,
  courseId: number,
): Promise<ParsedModule[]> => {
  const rawModules = await run.one(() =>
    http.fetchAll<unknown>(canvasEndpoint({ type: "courseModules", courseId })),
  );
  const descriptors = rawModules.map((value) => {
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
  return loaded;
};

const sameFile = (left: NormalizedFile, right: NormalizedFile): boolean =>
  left.folderId === right.folderId &&
  left.title === right.title &&
  left.size === right.size &&
  left.sourceUrl === right.sourceUrl;

const samePage = (left: NormalizedPage, right: NormalizedPage): boolean =>
  left.pageId === right.pageId && left.title === right.title;

const addFile = (files: Map<number, NormalizedFile>, value: unknown): void => {
  const normalized = normalizeFile(value);
  const prior = files.get(normalized.id);
  if (prior && !sameFile(prior, normalized)) {
    throw new TypeError("Conflicting file record");
  }
  files.set(normalized.id, prior ?? normalized);
};

const addPage = (pages: Map<string, NormalizedPage>, value: unknown): void => {
  const normalized = normalizePage(value);
  const prior = pages.get(normalized.token);
  if (prior && !samePage(prior, normalized)) {
    throw new TypeError("Conflicting page record");
  }
  pages.set(normalized.token, prior ?? normalized);
};

const insertSuffixAt = (
  path: string,
  segmentIndex: number,
  suffix: string,
): string => {
  const segments = path.split("/");
  const value = segments[segmentIndex];
  if (value === undefined) throw new TypeError("Unsafe archive path");
  const dot = value.lastIndexOf(".");
  const isFilename = segmentIndex === segments.length - 1;
  const hasExtension = isFilename && dot > 0 && value.length - dot <= 16;
  const stem = hasExtension ? value.slice(0, dot) : value;
  const extension = hasExtension ? value.slice(dot) : "";
  const marker = `--${suffix}`;
  const stemBudget = Math.max(1, 100 - marker.length - extension.length);
  const boundedStem = Array.from(stem).slice(0, stemBudget).join("");
  segments[segmentIndex] = `${boundedStem}${marker}${extension}`;
  return safeArchivePath(...segments);
};

const conflictSegment = (candidate: string, other: string): number | null => {
  const candidateCanonical = canonicalArchivePath(candidate);
  const otherCanonical = canonicalArchivePath(other);
  if (candidateCanonical === otherCanonical) {
    return candidate.split("/").length - 1;
  }
  if (candidateCanonical.startsWith(`${otherCanonical}/`)) {
    return other.split("/").length - 1;
  }
  if (otherCanonical.startsWith(`${candidateCanonical}/`)) {
    return candidate.split("/").length - 1;
  }
  return null;
};

const allocatePaths = (drafts: ResourceDraft[]): PlannedResource[] => {
  const ordered = [...drafts].sort((left, right) =>
    lexicographic(left.key, right.key),
  );
  const assigned: string[] = [];
  return ordered.map(({ preferredPath, disambiguator, ...resource }, index) => {
    if (preferredPath === null) return { ...resource, archivePath: null };
    let archivePath = preferredPath;
    let attempt = 1;
    for (;;) {
      let segment: number | null = null;
      for (const other of assigned) {
        segment = conflictSegment(archivePath, other);
        if (segment !== null) break;
      }
      if (segment === null) {
        for (const future of ordered.slice(index + 1)) {
          if (future.preferredPath === null) continue;
          segment = conflictSegment(archivePath, future.preferredPath);
          if (segment !== null) break;
        }
      }
      if (segment === null) break;
      archivePath = insertSuffixAt(
        archivePath,
        segment,
        attempt === 1 ? disambiguator : `${disambiguator}-${attempt}`,
      );
      attempt += 1;
    }
    assigned.push(archivePath);
    return { ...resource, archivePath };
  });
};

const digestToken = (value: string): string => {
  let hash = 0x811c9dc5;
  for (const character of value) {
    hash ^= character.codePointAt(0) ?? 0;
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(16).padStart(8, "0");
};

const validateCourse = (course: CourseSummary): CourseSummary => {
  if (!isRecord(course)) throw new TypeError("Invalid course");
  const id = positiveId(own(course, "id"), "course ID");
  const name = requiredText(own(course, "name"), "course name");
  const courseCode = own(course, "courseCode");
  const workflowState = own(course, "workflowState");
  const concluded = own(course, "concluded");
  if (
    typeof courseCode !== "string" ||
    typeof workflowState !== "string" ||
    typeof concluded !== "boolean"
  ) {
    throw new TypeError("Invalid course");
  }
  return { id, name, courseCode, workflowState, concluded };
};

const freezePlan = (plan: CoursePlan): CoursePlan => {
  Object.freeze(plan.course);
  for (const module of plan.modules) {
    for (const item of module.items) Object.freeze(item);
    Object.freeze(module.items);
    Object.freeze(module);
  }
  for (const resource of plan.resources) Object.freeze(resource);
  Object.freeze(plan.modules);
  Object.freeze(plan.resources);
  return Object.freeze(plan);
};

export function assertPilotSize(plan: CoursePlan): void {
  if (!isRecord(plan) || !Array.isArray(own(plan, "resources"))) {
    throw new PilotSizeError("The plan contains an invalid resource");
  }
  let total = 0;
  for (const resource of plan.resources) {
    if (!isRecord(resource)) {
      throw new PilotSizeError("The plan contains an invalid resource");
    }
    const kind = own(resource, "kind");
    if (
      kind !== "file" &&
      kind !== "page" &&
      kind !== "external" &&
      kind !== "unsupported"
    ) {
      throw new PilotSizeError("The plan contains an invalid resource");
    }
    if (kind !== "file") continue;
    if (!Object.hasOwn(resource, "advertisedBytes")) {
      throw new PilotSizeError("The plan contains an invalid resource");
    }
    const size = own(resource, "advertisedBytes");
    if (size === null) continue;
    if (typeof size !== "number" || !Number.isSafeInteger(size) || size < 0) {
      throw new PilotSizeError("A file has invalid size");
    }
    if (size > Number.MAX_SAFE_INTEGER - total) {
      throw new PilotSizeError("Advertised size total overflow");
    }
    total += size;
  }
  const declaredTotal = own(plan, "advertisedBytes");
  if (
    typeof declaredTotal !== "number" ||
    !Number.isSafeInteger(declaredTotal) ||
    declaredTotal !== total
  ) {
    throw new PilotSizeError("Advertised size total does not match the plan");
  }
  if (total > MAX_ARCHIVE_BYTES) {
    throw new PilotSizeError("Course exceeds the 250 MB pilot limit");
  }
}

export async function discoverCoursePlan(
  http: CanvasHttp,
  selectedCourse: CourseSummary,
  options: { abort?: (reason: Error | DOMException) => void } = {},
): Promise<CoursePlan> {
  const course = validateCourse(selectedCourse);
  const run = new DiscoveryRun(options.abort);
  const parsedModules = await loadModules(http, run, course.id);

  const indexes = await run.all<unknown[] | null>([
    () =>
      fetchOptionalIndex(() =>
        http.fetchAll<unknown>(
          canvasEndpoint({ type: "courseFiles", courseId: course.id }),
        ),
      ),
    () =>
      fetchOptionalIndex(() =>
        http.fetchAll<unknown>(
          canvasEndpoint({ type: "courseFolders", courseId: course.id }),
        ),
      ),
    () =>
      fetchOptionalIndex(() =>
        http.fetchAll<unknown>(
          canvasEndpoint({ type: "coursePages", courseId: course.id }),
        ),
      ),
  ]);
  const rawFiles = indexes[0]!;
  const rawFolders = indexes[1]!;
  const rawPages = indexes[2]!;

  const folders =
    rawFolders === null
      ? new Map<number, string[]>()
      : normalizeFolderMap(rawFolders);
  const files = new Map<number, NormalizedFile>();
  for (const value of rawFiles ?? []) addFile(files, value);
  const pages = new Map<string, NormalizedPage>();
  for (const value of rawPages ?? []) addPage(pages, value);

  const linkedFileIds = new Set<number>();
  const linkedPages = new Map<string, string>();
  const extraDrafts = new Map<string, ResourceDraft>();
  for (const { module, rawItems } of parsedModules) {
    for (let index = 0; index < module.items.length; index += 1) {
      const item = module.items[index]!;
      const raw = rawItems[index]!;
      if (item.type === "File") {
        linkedFileIds.add(positiveId(own(raw, "content_id"), "file ID"));
      } else if (item.type === "Page") {
        const token = pageToken(own(raw, "page_url"));
        linkedPages.set(
          token,
          optionalText(own(raw, "title"), token, "item title"),
        );
      } else if (item.type === "ExternalUrl") {
        const sourceUrl = strictExternalUrl(own(raw, "external_url"));
        const draft: ResourceDraft = {
          key: item.resourceKey!,
          kind: "external",
          title: item.title,
          sourceId: String(item.id),
          archivePath: null,
          advertisedBytes: 0,
          sourceUrl,
          preferredPath: null,
          disambiguator: `external-${item.id}`,
        };
        const prior = extraDrafts.get(draft.key);
        if (prior && prior.sourceUrl !== sourceUrl) {
          throw new TypeError("Conflicting external resource");
        }
        extraDrafts.set(draft.key, prior ?? draft);
      } else {
        const draft: ResourceDraft = {
          key: item.resourceKey!,
          kind: "unsupported",
          title: item.title,
          sourceId: String(item.id),
          archivePath: null,
          advertisedBytes: 0,
          sourceUrl: null,
          preferredPath: null,
          disambiguator: `unsupported-${item.id}`,
        };
        extraDrafts.set(draft.key, extraDrafts.get(draft.key) ?? draft);
      }
    }
  }

  for (const [token, title] of linkedPages) {
    if (!pages.has(token)) pages.set(token, { token, pageId: null, title });
  }

  const pageFileIds = await run.all(
    [...pages.keys()].map((token) => async () => {
      try {
        const detail = await http.jsonBoundedResource<unknown>(
          canvasEndpoint({
            type: "coursePage",
            courseId: course.id,
            pageUrl: token,
          }),
          CANVAS_PAGE_JSON_MAX_BYTES,
        );
        const page = exactCanvasPage(detail.value);
        return pageLinkedFileIds(page.body, course.id);
      } catch (error) {
        if (
          error instanceof CanvasBodySizeError ||
          (error instanceof CanvasResourceUnavailableError &&
            (error.status === 403 || error.status === 404))
        ) {
          return [];
        }
        throw error;
      }
    }),
  );
  for (const ids of pageFileIds) {
    for (const id of ids) linkedFileIds.add(id);
  }

  await run.all(
    [...linkedFileIds]
      .filter((id) => !files.has(id))
      .map((id) => async () => {
        let detail: { value: unknown };
        try {
          detail = await http.jsonBoundedResource<unknown>(
            canvasEndpoint({
              type: "courseFile",
              courseId: course.id,
              fileId: id,
            }),
            CANVAS_PAGE_JSON_MAX_BYTES,
          );
        } catch (error) {
          if (
            error instanceof CanvasResourceUnavailableError &&
            (error.status === 403 || error.status === 404)
          ) {
            files.set(id, {
              id,
              folderId: null,
              title: `file-${id}`,
              size: null,
              sourceUrl: new URL(
                `/courses/${course.id}/files/${id}/download`,
                CANVAS_ORIGIN,
              ).href,
            });
            return;
          }
          throw error;
        }
        if (
          !isRecord(detail.value) ||
          positiveId(own(detail.value, "id"), "file ID") !== id
        ) {
          throw new TypeError("Mismatched file metadata");
        }
        addFile(files, detail.value);
      }),
  );

  const drafts: ResourceDraft[] = [...extraDrafts.values()];
  for (const file of files.values()) {
    let folderSegments: string[] = [];
    if (rawFolders !== null && file.folderId !== null) {
      const resolved = folders.get(file.folderId);
      if (!resolved) throw new TypeError("Missing folder metadata");
      folderSegments = resolved;
    }
    drafts.push({
      key: `file:${file.id}`,
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
  for (const page of pages.values()) {
    drafts.push({
      key: `page:${page.token}`,
      kind: "page",
      title: page.title,
      sourceId: page.token,
      archivePath: null,
      advertisedBytes: 0,
      sourceUrl: null,
      preferredPath: safeArchivePath("pages", `${page.token}.html`),
      disambiguator: `page-${page.pageId ?? digestToken(page.token)}`,
    });
  }

  const resources = allocatePaths(drafts);
  let advertisedBytes = 0;
  for (const resource of resources) {
    if (resource.kind !== "file" || resource.advertisedBytes === null) continue;
    if (
      !Number.isSafeInteger(resource.advertisedBytes) ||
      resource.advertisedBytes < 0
    ) {
      continue;
    }
    if (resource.advertisedBytes > Number.MAX_SAFE_INTEGER - advertisedBytes) {
      throw new PilotSizeError("Advertised size total overflow");
    }
    advertisedBytes += resource.advertisedBytes;
  }
  const plan: CoursePlan = {
    course,
    modules: parsedModules.map(({ module }) => module),
    resources,
    advertisedBytes,
  };
  assertPilotSize(plan);
  return freezePlan(plan);
}
