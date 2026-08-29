import { assertCoursePlanSizes } from "../canvas/discovery";
import {
  MAX_ARCHIVED_PAGE_BYTES,
  MAX_ARCHIVE_BYTES,
  MAX_ARCHIVE_RESOURCES,
} from "../shared/constants";
import type {
  CourseArchivePartPlan,
  CoursePlan,
  PlannedResource,
  ResourcePartAssignment,
} from "../shared/model";

const resourceWeight = (resource: PlannedResource): number | null => {
  if (resource.kind === "page") return MAX_ARCHIVED_PAGE_BYTES;
  if (resource.kind !== "file") return 0;
  return resource.advertisedBytes;
};

const freezeParts = (
  groups: string[][],
  resources: readonly PlannedResource[],
): readonly CourseArchivePartPlan[] => {
  const total = groups.length;
  const partByKey = new Map<string, number>();
  for (const [groupIndex, keys] of groups.entries()) {
    for (const key of keys) {
      if (partByKey.has(key)) throw new TypeError("Duplicate part resource");
      partByKey.set(key, groupIndex + 1);
    }
  }
  if (
    partByKey.size !== resources.length ||
    resources.some((resource) => !partByKey.has(resource.key))
  ) {
    throw new TypeError("Incomplete part resources");
  }

  const resourceParts: ResourcePartAssignment[] = resources.map((resource) => ({
    resourceKey: resource.key,
    partIndex: partByKey.get(resource.key)!,
  }));
  resourceParts.forEach(Object.freeze);
  Object.freeze(resourceParts);

  const parts = groups.map((resourceKeys, index): CourseArchivePartPlan => {
    const keys = [...resourceKeys];
    Object.freeze(keys);
    return Object.freeze({
      index: index + 1,
      total,
      resourceKeys: keys,
      resourceParts,
    });
  });
  return Object.freeze(parts);
};

export const partitionCoursePlan = (
  plan: CoursePlan,
): readonly CourseArchivePartPlan[] => {
  assertCoursePlanSizes(plan);
  if (plan.resources.length > MAX_ARCHIVE_RESOURCES) {
    throw new TypeError("Archive resource limit exceeded");
  }
  const resourceKeys = new Set(plan.resources.map((resource) => resource.key));
  if (resourceKeys.size !== plan.resources.length) {
    throw new TypeError("Duplicate planned resource");
  }

  const terminalKeys = plan.resources
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

  for (const resource of plan.resources) {
    if (terminalKeySet.has(resource.key)) continue;
    const weight = resourceWeight(resource);
    const isolated =
      (resource.kind === "file" && weight === null) ||
      (typeof weight === "number" && weight > MAX_ARCHIVE_BYTES);
    if (isolated) {
      flush();
      groups.push([resource.key]);
      entryLimit = MAX_ARCHIVE_RESOURCES;
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
  groups[0] = plan.resources
    .filter(
      (resource) =>
        terminalKeySet.has(resource.key) || firstPayloadKeys.has(resource.key),
    )
    .map((resource) => resource.key);
  return freezeParts(groups, plan.resources);
};

export const partFileName = (
  baseName: string,
  part: Pick<CourseArchivePartPlan, "index" | "total">,
): string => {
  if (
    typeof baseName !== "string" ||
    !baseName.endsWith(".zip") ||
    !Number.isSafeInteger(part.index) ||
    !Number.isSafeInteger(part.total) ||
    part.index < 1 ||
    part.total < 1 ||
    part.index > part.total
  ) {
    throw new TypeError("Invalid archive part filename");
  }
  if (part.total === 1) return baseName;
  const width = Math.max(2, String(part.total).length);
  const index = String(part.index).padStart(width, "0");
  const total = String(part.total).padStart(width, "0");
  return `${baseName.slice(0, -4)}-part-${index}-of-${total}.zip`;
};
