export const CANVAS_ORIGIN = "https://frankfurtschool.instructure.com";
export const CANVAS_PAGE_JSON_MAX_BYTES = 5 * 1024 * 1024;
export const MAX_ARCHIVED_PAGE_BYTES =
  CANVAS_PAGE_JSON_MAX_BYTES * 8 + 64 * 1024;
export const PROTOCOL_VERSION = 1 as const;
export const MAX_ARCHIVE_BYTES = 262_144_000;
export const CLASSIC_ZIP_ENTRY_LIMIT = 65_535;
export const COURSE_CORE_ENTRY_COUNT = 7;
export const COMBINED_CORE_ENTRY_COUNT = 4;
// Classic ZIP has 65,535 entries; seven are reserved for GradPack core files.
export const MAX_ARCHIVE_RESOURCES =
  CLASSIC_ZIP_ENTRY_LIMIT - COURSE_CORE_ENTRY_COUNT;
export const MAX_CONCURRENCY = 2;
export const MAX_RETRIES = 2;
export const EXTENSION_CHANNEL = "gradpack/extension/v1";
export const RUNNER_CHANNEL = "gradpack/runner/v1";
