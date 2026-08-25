// @vitest-environment node
import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";
import { PILOT_ARTIFACT_NAME } from "../../scripts/package-pilot.mjs";
import { buildManifest } from "../../src/archive/manifest";
import {
  syntheticArchiveOutcomes,
  syntheticArchivePlan,
} from "../fixtures/course-plan";

const RELEASE_VERSION = "0.1.0-alpha.3";
const ARTIFACT_NAME = `gradpack-${RELEASE_VERSION}.zip`;

describe("pilot release identity", () => {
  it("keeps source, package, security, install, and checklist identity aligned", async () => {
    const packageMetadata = JSON.parse(
      await readFile(new URL("../../package.json", import.meta.url), "utf8"),
    ) as { version: string };
    const [manifestText, security, install, checklist] = await Promise.all([
      readFile(new URL("../../src/manifest.json", import.meta.url), "utf8"),
      readFile(new URL("../../SECURITY.md", import.meta.url), "utf8"),
      readFile(new URL("../../docs/pilot/INSTALL.md", import.meta.url), "utf8"),
      readFile(
        new URL("../../docs/pilot/TEST_CHECKLIST.md", import.meta.url),
        "utf8",
      ),
    ]);
    const extensionManifest = JSON.parse(manifestText) as {
      version: string;
      version_name: string;
    };

    expect(packageMetadata.version).toBe(RELEASE_VERSION);
    expect(extensionManifest.version).toBe("0.1.0");
    expect(extensionManifest.version_name).toBe(RELEASE_VERSION);
    const archiveManifest = buildManifest(
      structuredClone(syntheticArchivePlan),
      structuredClone(syntheticArchiveOutcomes),
      "2026-08-25T09:00:00.000Z",
    );
    expect(archiveManifest.gradPackVersion).toBe(RELEASE_VERSION);
    expect(PILOT_ARTIFACT_NAME).toBe(ARTIFACT_NAME);
    expect(security).toContain(`current \`${RELEASE_VERSION}\``);
    expect(install).toContain(ARTIFACT_NAME);
    expect(install).toContain(`${ARTIFACT_NAME}.sha256`);
    expect(checklist).toContain(`Artifact version: ${RELEASE_VERSION}`);
  });
});
