import {
  buildManifestFromSnapshot,
  snapshotArchiveData,
  type ArchiveManifest,
  type ArchiveManifestResource,
} from "./manifest";
import type {
  CourseArchivePartPlan,
  CoursePlan,
  OutcomeStatus,
  ResourceOutcome,
} from "../shared/model";

export type ArchiveResourceView = Readonly<{
  key: string;
  title: string;
  kind: ArchiveManifestResource["kind"];
  status: OutcomeStatus | "other-part";
  archivePath: string | null;
  availableInPart: number | null;
  folderPathFallback: boolean;
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

const safeExternalHref = (value: string | null): string | null => {
  if (value === null) return null;
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    return null;
  }
  return url.protocol === "https:" &&
    url.username === "" &&
    url.password === "" &&
    url.search === "" &&
    url.hash === ""
    ? url.href
    : null;
};

export function buildArchiveNavigationModel(
  plan: CoursePlan,
  outcomes: ResourceOutcome[],
  createdAt: string,
  partPlan?: CourseArchivePartPlan,
): ArchiveNavigationModel;
export function buildArchiveNavigationModel(
  plan: unknown,
  outcomes: unknown,
  createdAt: unknown,
  partPlan?: unknown,
): ArchiveNavigationModel {
  const snapshot = snapshotArchiveData(plan, outcomes, createdAt, partPlan);
  const manifest = buildManifestFromSnapshot(snapshot);
  const sourceByKey = new Map(
    snapshot.plan.resources.map((resource) => [
      resource.key,
      resource.sourceUrl,
    ]),
  );
  const references = new Map<string, string[]>();
  for (const module of snapshot.plan.modules) {
    for (const item of module.items) {
      if (item.resourceKey === null) continue;
      const current = references.get(item.resourceKey) ?? [];
      if (!current.includes(module.name)) current.push(module.name);
      references.set(item.resourceKey, current);
    }
  }
  const localByKey = new Map(
    manifest.resources.map((resource) => [resource.key, resource]),
  );
  const resources = manifest.resourceCatalog.map((catalog) => {
    const resource = localByKey.get(catalog.key);
    return Object.freeze({
      key: catalog.key,
      title: catalog.title,
      kind: catalog.kind,
      status: resource?.status ?? ("other-part" as const),
      archivePath: resource?.archivePath ?? null,
      availableInPart: resource ? null : catalog.partIndex,
      folderPathFallback: catalog.folderPathFallback,
      externalHref:
        resource?.status === "external"
          ? safeExternalHref(sourceByKey.get(resource.key) ?? null)
          : null,
      advertisedBytes: resource?.advertisedBytes ?? null,
      actualBytes: resource?.actualBytes ?? null,
      failureCategory: resource?.failureCategory ?? null,
      moduleReferences: Object.freeze([...(references.get(catalog.key) ?? [])]),
    });
  });
  const lookup = new Map(resources.map((resource) => [resource.key, resource]));
  const modules = snapshot.plan.modules.map((module) =>
    Object.freeze({
      id: module.id,
      name: module.name,
      position: module.position,
      items: Object.freeze(
        module.items.map((item) =>
          Object.freeze({
            id: item.id,
            title: item.title,
            position: item.position,
            indent: item.indent,
            resource:
              item.resourceKey === null
                ? null
                : (lookup.get(item.resourceKey) ?? null),
          }),
        ),
      ),
    }),
  );
  return Object.freeze({
    manifest,
    modules: Object.freeze(modules),
    resources: Object.freeze(resources),
    resourceByKey: (key: string) => lookup.get(key) ?? null,
  });
}
