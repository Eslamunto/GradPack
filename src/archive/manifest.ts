import { assertArchivePathSet, isCanonicalArchivePath } from "./paths";
import type {
  CourseArchivePartPlan,
  CoursePlan,
  ModuleDiscovery,
  OutcomeStatus,
  PlannedResource,
  ResourceKind,
  ResourceOutcome,
  ResourcePartAssignment,
} from "../shared/model";
import {
  MAX_ARCHIVE_BYTES,
  MAX_ARCHIVE_RESOURCES as SHARED_MAX_ARCHIVE_RESOURCES,
} from "../shared/constants";

const GRADPACK_VERSION = "0.1.0-alpha.6";
const CANVAS_HOST = "frankfurtschool.instructure.com";
const CANVAS_ORIGIN = `https://${CANVAS_HOST}`;
// Classic ZIP stores at most 65,535 entries. Three are reserved for GradPack's
// core files, so this pilot stops rather than silently omitting resources.
export const MAX_ARCHIVE_RESOURCES = SHARED_MAX_ARCHIVE_RESOURCES;
export const MAX_ZIP_PAYLOAD_ENTRIES = SHARED_MAX_ARCHIVE_RESOURCES;
const MAX_TEXT_LENGTH = 4096;
const CANONICAL_ISO = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/u;
const CONTROL = /[\p{Cc}\p{Cf}\p{Cs}]/u;
const ENCODED_CONTROL = /%(?:0[0-9a-f]|1[0-9a-f]|7f)/iu;
const FAILURE_CATEGORIES = new Set([
  "access-denied",
  "network-exhausted",
  "not-found",
  "page-too-large",
  "transient-exhausted",
]);
const RESOURCE_KINDS = new Set<ResourceKind>([
  "file",
  "page",
  "external",
  "unsupported",
]);
const OUTCOME_STATUSES = new Set<OutcomeStatus>([
  "success",
  "failed",
  "unavailable",
  "unsupported",
  "external",
]);

export type ArchiveManifestResource = Omit<PlannedResource, "sourceUrl"> & {
  status: OutcomeStatus;
  actualBytes: number | null;
  failureCategory: string | null;
};

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

export type ArchiveManifest = {
  schemaVersion: 1;
  gradPackVersion: typeof GRADPACK_VERSION;
  createdAt: string;
  canvasHost: typeof CANVAS_HOST;
  course: { id: number; name: string; courseCode: string };
  moduleDiscovery: ModuleDiscovery;
  part: ArchivePart;
  courseTotals: ArchiveCourseTotals;
  totals: Record<OutcomeStatus, number> & {
    advertisedBytes: number;
    archivedBytes: number;
  };
  resourceCatalog: ArchiveResourceCatalogEntry[];
  resources: ArchiveManifestResource[];
};

export class ArchiveSafetyError extends TypeError {
  override readonly name = "ArchiveSafetyError";
}

export type ArchiveSnapshot = Readonly<{
  plan: CoursePlan;
  partPlan: CourseArchivePartPlan;
  outcomes: ResourceOutcome[];
  createdAt: string;
}>;

const isPlainRecord = (
  value: unknown,
): value is Record<PropertyKey, unknown> => {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return false;
  }
  let prototype: object | null;
  try {
    prototype = Object.getPrototypeOf(value) as object | null;
  } catch {
    return false;
  }
  return prototype === Object.prototype || prototype === null;
};

const ownKeys = (value: object): PropertyKey[] => {
  try {
    return Reflect.ownKeys(value);
  } catch {
    throw new TypeError("Invalid archive data");
  }
};

const exactRecord = (
  value: unknown,
  expectedKeys: readonly string[],
): Record<string, unknown> => {
  if (!isPlainRecord(value)) throw new TypeError("Invalid archive data");
  const keys = ownKeys(value);
  if (
    keys.length !== expectedKeys.length ||
    keys.some((key) => typeof key !== "string" || !expectedKeys.includes(key))
  ) {
    throw new TypeError("Invalid archive data");
  }
  const snapshot: Record<string, unknown> = Object.create(null) as Record<
    string,
    unknown
  >;
  for (const key of expectedKeys) {
    let descriptor: PropertyDescriptor | undefined;
    try {
      descriptor = Object.getOwnPropertyDescriptor(value, key);
    } catch {
      throw new TypeError("Invalid archive data");
    }
    if (!descriptor || !("value" in descriptor)) {
      throw new TypeError("Invalid archive data");
    }
    snapshot[key] = descriptor.value;
  }
  return snapshot;
};

const valueOf = (record: Record<string, unknown>, key: string): unknown => {
  return record[key];
};

const exactArray = (value: unknown): unknown[] => {
  if (
    !Array.isArray(value) ||
    Object.getPrototypeOf(value) !== Array.prototype
  ) {
    throw new TypeError("Invalid archive data");
  }
  const keys = ownKeys(value);
  if (
    keys.some(
      (key) =>
        typeof key !== "string" ||
        (key !== "length" && !/^(?:0|[1-9]\d*)$/u.test(key)),
    )
  ) {
    throw new TypeError("Invalid archive data");
  }
  const lengthDescriptor = Object.getOwnPropertyDescriptor(value, "length");
  if (!lengthDescriptor || !("value" in lengthDescriptor)) {
    throw new TypeError("Invalid archive data");
  }
  const length = lengthDescriptor.value as unknown;
  if (
    typeof length !== "number" ||
    !Number.isSafeInteger(length) ||
    length < 0
  ) {
    throw new TypeError("Invalid archive data");
  }
  const output: unknown[] = [];
  for (let index = 0; index < length; index += 1) {
    const descriptor = Object.getOwnPropertyDescriptor(value, String(index));
    if (!descriptor || !("value" in descriptor)) {
      throw new TypeError("Invalid archive data");
    }
    output.push(descriptor.value);
  }
  return output;
};

const text = (value: unknown, allowEmpty = false): string => {
  if (
    typeof value !== "string" ||
    value.length > MAX_TEXT_LENGTH ||
    (!allowEmpty && value.length === 0) ||
    CONTROL.test(value)
  ) {
    throw new TypeError("Invalid archive data");
  }
  return value;
};

const safeInteger = (value: unknown, minimum = 0): number => {
  if (
    typeof value !== "number" ||
    !Number.isSafeInteger(value) ||
    value < minimum
  ) {
    throw new TypeError("Invalid archive data");
  }
  return value;
};

const nullableBytes = (value: unknown): number | null =>
  value === null ? null : safeInteger(value);

const canonicalTimestamp = (value: unknown): string => {
  if (typeof value !== "string" || !CANONICAL_ISO.test(value)) {
    throw new TypeError("Invalid archive timestamp");
  }
  try {
    if (new Date(value).toISOString() !== value) {
      throw new TypeError("Invalid archive timestamp");
    }
  } catch {
    throw new TypeError("Invalid archive timestamp");
  }
  return value;
};

const validateSourceUrl = (
  value: unknown,
  kind: ResourceKind,
  sourceId: string,
  courseId: number,
  advertisedBytes: number | null,
): string | null => {
  if (value === null) {
    if (kind === "file" || kind === "external") {
      throw new TypeError("Invalid archive data");
    }
    return null;
  }
  if (
    typeof value !== "string" ||
    value !== value.trim() ||
    CONTROL.test(value) ||
    ENCODED_CONTROL.test(value)
  ) {
    throw new TypeError("Invalid archive data");
  }
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new TypeError("Invalid archive data");
  }
  if (
    url.protocol !== "https:" ||
    url.username !== "" ||
    url.password !== "" ||
    (kind === "file" && url.hash !== "")
  ) {
    throw new TypeError("Invalid archive data");
  }
  if (kind === "file") {
    if (
      advertisedBytes === null &&
      (!/^[1-9]\d*$/u.test(sourceId) || !Number.isSafeInteger(Number(sourceId)))
    ) {
      throw new TypeError("Invalid archive data");
    }
    const expectedPath =
      advertisedBytes === null
        ? `/courses/${courseId}/files/${sourceId}/download`
        : `/files/${sourceId}/download`;
    if (
      url.origin !== CANVAS_ORIGIN ||
      url.pathname !== expectedPath ||
      (advertisedBytes === null && url.search !== "")
    ) {
      throw new TypeError("Invalid archive data");
    }
  }
  if (kind === "page" || kind === "unsupported") {
    throw new TypeError("Invalid archive data");
  }
  return value;
};

type ValidatedResource = PlannedResource;

const resourceKeys = [
  "key",
  "kind",
  "title",
  "sourceId",
  "archivePath",
  "advertisedBytes",
  "sourceUrl",
] as const;

const validateResource = (
  value: unknown,
  courseId: number,
): ValidatedResource => {
  const record = exactRecord(value, resourceKeys);
  const key = text(valueOf(record, "key"));
  const rawKind = valueOf(record, "kind");
  if (
    typeof rawKind !== "string" ||
    !RESOURCE_KINDS.has(rawKind as ResourceKind)
  ) {
    throw new TypeError("Invalid archive data");
  }
  const kind = rawKind as ResourceKind;
  const title = text(valueOf(record, "title"), true);
  const sourceId = text(valueOf(record, "sourceId"));
  const rawArchivePath = valueOf(record, "archivePath");
  const archivePath =
    rawArchivePath === null
      ? null
      : isCanonicalArchivePath(rawArchivePath)
        ? rawArchivePath
        : (() => {
            throw new TypeError("Invalid archive data");
          })();
  const advertisedBytes = nullableBytes(valueOf(record, "advertisedBytes"));
  const sourceUrl = validateSourceUrl(
    valueOf(record, "sourceUrl"),
    kind,
    sourceId,
    courseId,
    advertisedBytes,
  );

  if (
    (kind === "file" &&
      (archivePath === null || !archivePath.startsWith("files/"))) ||
    (kind === "page" &&
      (archivePath === null ||
        !archivePath.startsWith("pages/") ||
        advertisedBytes !== 0)) ||
    ((kind === "external" || kind === "unsupported") &&
      (archivePath !== null || advertisedBytes !== 0))
  ) {
    throw new TypeError("Invalid archive data");
  }
  return {
    key,
    kind,
    title,
    sourceId,
    archivePath,
    advertisedBytes,
    sourceUrl,
  };
};

const outcomeKeys = [
  ...resourceKeys,
  "status",
  "actualBytes",
  "failureCategory",
];

const validateOutcome = (value: unknown, courseId: number): ResourceOutcome => {
  const record = exactRecord(value, outcomeKeys);
  const resource = validateResource(
    Object.fromEntries(resourceKeys.map((key) => [key, valueOf(record, key)])),
    courseId,
  );
  const rawStatus = valueOf(record, "status");
  if (
    typeof rawStatus !== "string" ||
    !OUTCOME_STATUSES.has(rawStatus as OutcomeStatus)
  ) {
    throw new TypeError("Invalid archive data");
  }
  const status = rawStatus as OutcomeStatus;
  const actualBytes = nullableBytes(valueOf(record, "actualBytes"));
  const rawFailure = valueOf(record, "failureCategory");
  const failureCategory =
    rawFailure === null
      ? null
      : typeof rawFailure === "string" && FAILURE_CATEGORIES.has(rawFailure)
        ? rawFailure
        : (() => {
            throw new TypeError("Invalid archive data");
          })();

  if (
    (status === "success" &&
      ((resource.kind !== "file" && resource.kind !== "page") ||
        resource.archivePath === null ||
        actualBytes === null ||
        failureCategory !== null)) ||
    ((status === "failed" || status === "unavailable") &&
      ((resource.kind !== "file" && resource.kind !== "page") ||
        actualBytes !== null ||
        failureCategory === null)) ||
    (status === "external" &&
      (resource.kind !== "external" ||
        actualBytes !== 0 ||
        failureCategory !== null)) ||
    (status === "unsupported" &&
      (resource.kind !== "unsupported" ||
        actualBytes !== 0 ||
        failureCategory !== null))
  ) {
    throw new TypeError("Invalid archive data");
  }
  return { ...resource, status, actualBytes, failureCategory };
};

const addSafe = (left: number, right: number): number => {
  if (right > Number.MAX_SAFE_INTEGER - left) {
    throw new TypeError("Archive byte total overflow");
  }
  return left + right;
};

const validateCourse = (value: unknown): CoursePlan["course"] => {
  const record = exactRecord(value, [
    "id",
    "name",
    "courseCode",
    "workflowState",
    "concluded",
  ]);
  const concluded = valueOf(record, "concluded");
  if (typeof concluded !== "boolean")
    throw new TypeError("Invalid archive data");
  return {
    id: safeInteger(valueOf(record, "id"), 1),
    name: text(valueOf(record, "name"), true),
    courseCode: text(valueOf(record, "courseCode"), true),
    workflowState: text(valueOf(record, "workflowState"), true),
    concluded,
  };
};

const validateModules = (value: unknown): CoursePlan["modules"] =>
  exactArray(value).map((rawModule) => {
    const module = exactRecord(rawModule, ["id", "name", "position", "items"]);
    const items = exactArray(valueOf(module, "items")).map((rawItem) => {
      const item = exactRecord(rawItem, [
        "id",
        "title",
        "position",
        "indent",
        "resourceKey",
        "type",
      ]);
      const resourceKey = valueOf(item, "resourceKey");
      if (resourceKey !== null && typeof resourceKey !== "string") {
        throw new TypeError("Invalid archive data");
      }
      return {
        id: safeInteger(valueOf(item, "id"), 1),
        title: text(valueOf(item, "title"), true),
        position: safeInteger(valueOf(item, "position")),
        indent: (() => {
          const indent = safeInteger(valueOf(item, "indent"));
          if (indent > 5) throw new TypeError("Invalid archive data");
          return indent;
        })(),
        resourceKey: resourceKey === null ? null : text(resourceKey),
        type: text(valueOf(item, "type"), true),
      };
    });
    return {
      id: safeInteger(valueOf(module, "id"), 1),
      name: text(valueOf(module, "name"), true),
      position: safeInteger(valueOf(module, "position")),
      items,
    };
  });

const moduleDiscovery = (value: unknown): ModuleDiscovery => {
  if (value !== "available" && value !== "disabled") {
    throw new TypeError("Invalid archive data");
  }
  return value;
};

const validatePlan = (value: unknown): CoursePlan => {
  const record = exactRecord(value, [
    "course",
    "moduleDiscovery",
    "modules",
    "resources",
    "folderPathFallbackKeys",
    "advertisedBytes",
  ]);
  const rawResources = exactArray(valueOf(record, "resources"));
  if (rawResources.length > MAX_ARCHIVE_RESOURCES) {
    throw new ArchiveSafetyError("Archive resource limit exceeded");
  }
  const course = validateCourse(valueOf(record, "course"));
  const resources = rawResources.map((resource) =>
    validateResource(resource, course.id),
  );
  const keys = new Set<string>();
  let advertisedBytes = 0;
  for (const resource of resources) {
    if (keys.has(resource.key))
      throw new TypeError("Duplicate planned resource");
    keys.add(resource.key);
    advertisedBytes = addSafe(advertisedBytes, resource.advertisedBytes ?? 0);
  }
  assertArchivePathSet(resources);
  const folderPathFallbackKeys = exactArray(
    valueOf(record, "folderPathFallbackKeys"),
  ).map((key) => text(key));
  if (new Set(folderPathFallbackKeys).size !== folderPathFallbackKeys.length) {
    throw new TypeError("Invalid folder fallback keys");
  }
  for (const key of folderPathFallbackKeys) {
    const resource = resources.find((candidate) => candidate.key === key);
    if (
      resource?.kind !== "file" ||
      resource.archivePath === null ||
      !resource.archivePath.startsWith("files/unfiled/")
    ) {
      throw new TypeError("Invalid folder fallback keys");
    }
  }
  const declared = safeInteger(valueOf(record, "advertisedBytes"));
  if (declared !== advertisedBytes) {
    throw new TypeError("Invalid advertised byte total");
  }
  const modules = validateModules(valueOf(record, "modules"));
  const discovery = moduleDiscovery(valueOf(record, "moduleDiscovery"));
  if (discovery === "disabled" && modules.length !== 0) {
    throw new TypeError("Disabled module discovery cannot include modules");
  }
  for (const module of modules) {
    for (const item of module.items) {
      if (item.resourceKey !== null && !keys.has(item.resourceKey)) {
        throw new TypeError("Unknown module resource");
      }
    }
  }
  return {
    course,
    moduleDiscovery: discovery,
    modules,
    resources,
    folderPathFallbackKeys,
    advertisedBytes: declared,
  };
};

const defaultPartPlan = (plan: CoursePlan): CourseArchivePartPlan => ({
  index: 1,
  total: 1,
  resourceKeys: plan.resources.map(({ key }) => key),
  resourceParts: plan.resources.map(({ key }) => ({
    resourceKey: key,
    partIndex: 1,
  })),
});

const validatePartPlan = (
  value: unknown,
  plan: CoursePlan,
): CourseArchivePartPlan => {
  const record = exactRecord(value, [
    "index",
    "total",
    "resourceKeys",
    "resourceParts",
  ]);
  const index = safeInteger(valueOf(record, "index"), 1);
  const total = safeInteger(valueOf(record, "total"), 1);
  if (index > total) throw new TypeError("Invalid archive part");
  const resourceKeys = exactArray(valueOf(record, "resourceKeys")).map((key) =>
    text(key),
  );
  const resourceParts = exactArray(valueOf(record, "resourceParts")).map(
    (assignment): ResourcePartAssignment => {
      const assignmentRecord = exactRecord(assignment, [
        "resourceKey",
        "partIndex",
      ]);
      const partIndex = safeInteger(valueOf(assignmentRecord, "partIndex"), 1);
      if (partIndex > total) throw new TypeError("Invalid archive part");
      return {
        resourceKey: text(valueOf(assignmentRecord, "resourceKey")),
        partIndex,
      };
    },
  );
  if (
    resourceParts.length !== plan.resources.length ||
    resourceParts.some(
      (assignment, assignmentIndex) =>
        assignment.resourceKey !== plan.resources[assignmentIndex]?.key,
    )
  ) {
    throw new TypeError("Invalid archive part assignments");
  }
  const expectedKeys = resourceParts
    .filter((assignment) => assignment.partIndex === index)
    .map((assignment) => assignment.resourceKey);
  if (
    resourceKeys.length !== expectedKeys.length ||
    resourceKeys.some((key, keyIndex) => key !== expectedKeys[keyIndex])
  ) {
    throw new TypeError("Invalid archive part resources");
  }
  if (
    plan.resources.length > 0 &&
    Array.from({ length: total }, (_, partIndex) => partIndex + 1).some(
      (partIndex) =>
        !resourceParts.some((assignment) => assignment.partIndex === partIndex),
    )
  ) {
    throw new TypeError("Empty archive part assignment");
  }
  resourceParts.forEach(Object.freeze);
  Object.freeze(resourceKeys);
  Object.freeze(resourceParts);
  return Object.freeze({ index, total, resourceKeys, resourceParts });
};

const sameResource = (
  planned: PlannedResource,
  outcome: ResourceOutcome,
): boolean =>
  planned.key === outcome.key &&
  planned.kind === outcome.kind &&
  planned.title === outcome.title &&
  planned.sourceId === outcome.sourceId &&
  planned.archivePath === outcome.archivePath &&
  planned.advertisedBytes === outcome.advertisedBytes &&
  planned.sourceUrl === outcome.sourceUrl;

const freezePlan = (plan: CoursePlan): CoursePlan => {
  Object.freeze(plan.course);
  for (const module of plan.modules) {
    for (const item of module.items) Object.freeze(item);
    Object.freeze(module.items);
    Object.freeze(module);
  }
  Object.freeze(plan.modules);
  for (const resource of plan.resources) Object.freeze(resource);
  Object.freeze(plan.resources);
  Object.freeze(plan.folderPathFallbackKeys);
  return Object.freeze(plan);
};

const freezeOutcomes = (outcomes: ResourceOutcome[]): ResourceOutcome[] => {
  for (const outcome of outcomes) Object.freeze(outcome);
  return Object.freeze(outcomes) as ResourceOutcome[];
};

const freezeManifest = (manifest: ArchiveManifest): ArchiveManifest => {
  for (const resource of manifest.resources) Object.freeze(resource);
  for (const resource of manifest.resourceCatalog) Object.freeze(resource);
  Object.freeze(manifest.resources);
  Object.freeze(manifest.resourceCatalog);
  Object.freeze(manifest.totals);
  Object.freeze(manifest.courseTotals);
  Object.freeze(manifest.part);
  Object.freeze(manifest.course);
  return Object.freeze(manifest);
};

export function snapshotArchiveData(
  plan: unknown,
  outcomes: unknown,
  createdAt: unknown,
  partPlan?: unknown,
): ArchiveSnapshot {
  const validatedPlan = validatePlan(plan);
  const validatedPartPlan = validatePartPlan(
    partPlan ?? defaultPartPlan(validatedPlan),
    validatedPlan,
  );
  const rawOutcomes = exactArray(outcomes);
  if (rawOutcomes.length > MAX_ARCHIVE_RESOURCES) {
    throw new ArchiveSafetyError("Archive resource limit exceeded");
  }
  const validatedOutcomes = rawOutcomes.map((outcome) =>
    validateOutcome(outcome, validatedPlan.course.id),
  );
  if (validatedOutcomes.length !== validatedPartPlan.resourceKeys.length) {
    throw new TypeError("Incomplete resource outcomes");
  }
  const byKey = new Map<string, ResourceOutcome>();
  for (const outcome of validatedOutcomes) {
    if (byKey.has(outcome.key))
      throw new TypeError("Duplicate resource outcome");
    byKey.set(outcome.key, outcome);
  }

  const resourcesByKey = new Map(
    validatedPlan.resources.map((resource) => [resource.key, resource]),
  );
  const orderedOutcomes = validatedPartPlan.resourceKeys.map((key) => {
    const planned = resourcesByKey.get(key);
    const outcome = byKey.get(key);
    if (!planned || !outcome || !sameResource(planned, outcome)) {
      throw new TypeError("Mismatched resource outcome");
    }
    return outcome;
  });
  const snapshot = {
    plan: freezePlan(validatedPlan),
    partPlan: validatedPartPlan,
    outcomes: freezeOutcomes(orderedOutcomes),
    createdAt: canonicalTimestamp(createdAt),
  };
  return Object.freeze(snapshot);
}

export function buildManifestFromSnapshot(
  snapshot: ArchiveSnapshot,
): ArchiveManifest {
  const validatedPlan = snapshot.plan;
  const validatedPartPlan = snapshot.partPlan;
  const validatedOutcomes = snapshot.outcomes;

  const totals: ArchiveManifest["totals"] = {
    success: 0,
    failed: 0,
    unavailable: 0,
    unsupported: 0,
    external: 0,
    advertisedBytes: validatedPlan.advertisedBytes,
    archivedBytes: 0,
  };
  const resources = validatedOutcomes.map((outcome) => {
    totals[outcome.status] += 1;
    if (outcome.status === "success") {
      totals.archivedBytes = addSafe(
        totals.archivedBytes,
        outcome.actualBytes!,
      );
    }
    const { key, kind, title, sourceId, archivePath, advertisedBytes } =
      outcome;
    return {
      key,
      kind,
      title,
      sourceId,
      archivePath,
      advertisedBytes,
      status: outcome.status,
      actualBytes: outcome.actualBytes,
      failureCategory: outcome.failureCategory,
    };
  });
  const partByKey = new Map(
    validatedPartPlan.resourceParts.map(({ resourceKey, partIndex }) => [
      resourceKey,
      partIndex,
    ]),
  );
  const fallbackKeys = new Set(validatedPlan.folderPathFallbackKeys);
  const resourceCatalog: ArchiveResourceCatalogEntry[] =
    validatedPlan.resources.map((resource) => ({
      key: resource.key,
      kind: resource.kind,
      title: resource.title,
      partIndex: partByKey.get(resource.key)!,
      folderPathFallback: fallbackKeys.has(resource.key),
    }));

  return freezeManifest({
    schemaVersion: 1,
    gradPackVersion: GRADPACK_VERSION,
    createdAt: snapshot.createdAt,
    canvasHost: CANVAS_HOST,
    course: {
      id: validatedPlan.course.id,
      name: validatedPlan.course.name,
      courseCode: validatedPlan.course.courseCode,
    },
    moduleDiscovery: validatedPlan.moduleDiscovery,
    part: {
      index: validatedPartPlan.index,
      total: validatedPartPlan.total,
    },
    courseTotals: {
      advertisedBytes: validatedPlan.advertisedBytes,
      resourceCount: validatedPlan.resources.length,
      unknownSizeCount: validatedPlan.resources.filter(
        (resource) =>
          resource.kind === "file" && resource.advertisedBytes === null,
      ).length,
      folderPathFallbackCount: validatedPlan.folderPathFallbackKeys.length,
    },
    totals,
    resourceCatalog,
    resources,
  });
}

export function buildManifest(
  plan: unknown,
  outcomes: unknown,
  createdAt: unknown,
  partPlan?: unknown,
): ArchiveManifest {
  return buildManifestFromSnapshot(
    snapshotArchiveData(plan, outcomes, createdAt, partPlan),
  );
}

export function normalizeArchiveManifest(value: unknown): ArchiveManifest {
  const record = exactRecord(value, [
    "schemaVersion",
    "gradPackVersion",
    "createdAt",
    "canvasHost",
    "course",
    "moduleDiscovery",
    "part",
    "courseTotals",
    "totals",
    "resourceCatalog",
    "resources",
  ]);
  if (
    valueOf(record, "schemaVersion") !== 1 ||
    valueOf(record, "gradPackVersion") !== GRADPACK_VERSION ||
    valueOf(record, "canvasHost") !== CANVAS_HOST
  ) {
    throw new TypeError("Invalid archive manifest");
  }
  const courseRecord = exactRecord(valueOf(record, "course"), [
    "id",
    "name",
    "courseCode",
  ]);
  const course: ArchiveManifest["course"] = {
    id: safeInteger(valueOf(courseRecord, "id"), 1),
    name: text(valueOf(courseRecord, "name"), true),
    courseCode: text(valueOf(courseRecord, "courseCode"), true),
  };
  const partRecord = exactRecord(valueOf(record, "part"), ["index", "total"]);
  const part: ArchivePart = {
    index: safeInteger(valueOf(partRecord, "index"), 1),
    total: safeInteger(valueOf(partRecord, "total"), 1),
  };
  if (part.index > part.total) throw new TypeError("Invalid archive part");
  const courseTotalsRecord = exactRecord(valueOf(record, "courseTotals"), [
    "advertisedBytes",
    "resourceCount",
    "unknownSizeCount",
    "folderPathFallbackCount",
  ]);
  const courseTotals: ArchiveCourseTotals = {
    advertisedBytes: safeInteger(
      valueOf(courseTotalsRecord, "advertisedBytes"),
    ),
    resourceCount: safeInteger(valueOf(courseTotalsRecord, "resourceCount")),
    unknownSizeCount: safeInteger(
      valueOf(courseTotalsRecord, "unknownSizeCount"),
    ),
    folderPathFallbackCount: safeInteger(
      valueOf(courseTotalsRecord, "folderPathFallbackCount"),
    ),
  };
  if (courseTotals.resourceCount > MAX_ARCHIVE_RESOURCES) {
    throw new ArchiveSafetyError("Archive resource limit exceeded");
  }
  if (
    courseTotals.unknownSizeCount > courseTotals.resourceCount ||
    courseTotals.folderPathFallbackCount > courseTotals.resourceCount
  ) {
    throw new TypeError("Invalid course totals");
  }
  const resourceCatalog = exactArray(valueOf(record, "resourceCatalog")).map(
    (value): ArchiveResourceCatalogEntry => {
      const catalogRecord = exactRecord(value, [
        "key",
        "kind",
        "title",
        "partIndex",
        "folderPathFallback",
      ]);
      const kind = valueOf(catalogRecord, "kind");
      const partIndex = safeInteger(valueOf(catalogRecord, "partIndex"), 1);
      const folderPathFallback = valueOf(catalogRecord, "folderPathFallback");
      if (
        !RESOURCE_KINDS.has(kind as ResourceKind) ||
        partIndex > part.total ||
        typeof folderPathFallback !== "boolean"
      ) {
        throw new TypeError("Invalid resource catalog");
      }
      return {
        key: text(valueOf(catalogRecord, "key")),
        kind: kind as ResourceKind,
        title: text(valueOf(catalogRecord, "title"), true),
        partIndex,
        folderPathFallback,
      };
    },
  );
  const catalogKeys = new Set(resourceCatalog.map(({ key }) => key));
  if (
    catalogKeys.size !== resourceCatalog.length ||
    resourceCatalog.length !== courseTotals.resourceCount ||
    resourceCatalog.filter(({ folderPathFallback }) => folderPathFallback)
      .length !== courseTotals.folderPathFallbackCount ||
    (resourceCatalog.length > 0 &&
      Array.from({ length: part.total }, (_, index) => index + 1).some(
        (index) =>
          !resourceCatalog.some(({ partIndex }) => partIndex === index),
      ))
  ) {
    throw new TypeError("Invalid resource catalog");
  }
  const rawResources = exactArray(valueOf(record, "resources"));
  if (rawResources.length > MAX_ARCHIVE_RESOURCES) {
    throw new ArchiveSafetyError("Archive resource limit exceeded");
  }
  const resources = rawResources.map((value) => {
    const resourceRecord = exactRecord(value, [
      "key",
      "kind",
      "title",
      "sourceId",
      "archivePath",
      "advertisedBytes",
      "status",
      "actualBytes",
      "failureCategory",
    ]);
    const kind = valueOf(resourceRecord, "kind");
    const sourceId = valueOf(resourceRecord, "sourceId");
    const advertisedBytes = valueOf(resourceRecord, "advertisedBytes");
    return validateOutcome(
      {
        ...Object.fromEntries(
          [
            "key",
            "kind",
            "title",
            "sourceId",
            "archivePath",
            "advertisedBytes",
            "status",
            "actualBytes",
            "failureCategory",
          ].map((key) => [key, valueOf(resourceRecord, key)]),
        ),
        sourceUrl:
          kind === "file"
            ? typeof sourceId !== "string"
              ? null
              : advertisedBytes === null
                ? `${CANVAS_ORIGIN}/courses/${course.id}/files/${sourceId}/download`
                : `${CANVAS_ORIGIN}/files/${sourceId}/download`
            : kind === "external"
              ? "https://reference.invalid/"
              : null,
      },
      course.id,
    );
  });
  assertArchivePathSet(resources);
  const catalogByKey = new Map(
    resourceCatalog.map((resource) => [resource.key, resource]),
  );
  const expectedLocalKeys = resourceCatalog
    .filter(({ partIndex }) => partIndex === part.index)
    .map(({ key }) => key);
  if (
    resources.length !== expectedLocalKeys.length ||
    resources.some((resource, index) => {
      const catalog = catalogByKey.get(resource.key);
      return (
        resource.key !== expectedLocalKeys[index] ||
        catalog === undefined ||
        catalog.kind !== resource.kind ||
        catalog.title !== resource.title ||
        catalog.partIndex !== part.index ||
        (catalog.folderPathFallback &&
          (resource.kind !== "file" ||
            resource.archivePath === null ||
            !resource.archivePath.startsWith("files/unfiled/")))
      );
    })
  ) {
    throw new TypeError("Invalid local part resources");
  }
  const totalsRecord = exactRecord(valueOf(record, "totals"), [
    "success",
    "failed",
    "unavailable",
    "unsupported",
    "external",
    "advertisedBytes",
    "archivedBytes",
  ]);
  const totals: ArchiveManifest["totals"] = {
    success: safeInteger(valueOf(totalsRecord, "success")),
    failed: safeInteger(valueOf(totalsRecord, "failed")),
    unavailable: safeInteger(valueOf(totalsRecord, "unavailable")),
    unsupported: safeInteger(valueOf(totalsRecord, "unsupported")),
    external: safeInteger(valueOf(totalsRecord, "external")),
    advertisedBytes: safeInteger(valueOf(totalsRecord, "advertisedBytes")),
    archivedBytes: safeInteger(valueOf(totalsRecord, "archivedBytes")),
  };
  const calculated: ArchiveManifest["totals"] = {
    success: 0,
    failed: 0,
    unavailable: 0,
    unsupported: 0,
    external: 0,
    advertisedBytes: 0,
    archivedBytes: 0,
  };
  const keys = new Set<string>();
  for (const resource of resources) {
    if (keys.has(resource.key))
      throw new TypeError("Duplicate manifest resource");
    keys.add(resource.key);
    calculated[resource.status] += 1;
    calculated.advertisedBytes = addSafe(
      calculated.advertisedBytes,
      resource.advertisedBytes ?? 0,
    );
    if (resource.status === "success") {
      calculated.archivedBytes = addSafe(
        calculated.archivedBytes,
        resource.actualBytes!,
      );
    }
  }
  if (
    totals.archivedBytes > MAX_ARCHIVE_BYTES ||
    totals.advertisedBytes > courseTotals.advertisedBytes ||
    Object.keys(calculated).some(
      (key) =>
        calculated[key as keyof typeof calculated] !==
        totals[key as keyof typeof totals],
    )
  ) {
    throw new TypeError("Invalid manifest totals");
  }
  return freezeManifest({
    schemaVersion: 1,
    gradPackVersion: GRADPACK_VERSION,
    createdAt: canonicalTimestamp(valueOf(record, "createdAt")),
    canvasHost: CANVAS_HOST,
    course,
    moduleDiscovery: moduleDiscovery(valueOf(record, "moduleDiscovery")),
    part,
    courseTotals,
    totals,
    resourceCatalog,
    resources: resources.map((resource) => ({
      key: resource.key,
      kind: resource.kind,
      title: resource.title,
      sourceId: resource.sourceId,
      archivePath: resource.archivePath,
      advertisedBytes: resource.advertisedBytes,
      status: resource.status,
      actualBytes: resource.actualBytes,
      failureCategory: resource.failureCategory,
    })),
  });
}
