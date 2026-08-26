// @vitest-environment node
import { createHash } from "node:crypto";
import { execFile as execFileCallback } from "node:child_process";
import { mkdir, mkdtemp, readFile, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import { strFromU8, unzipSync } from "fflate";
import { describe, expect, it } from "vitest";
import {
  PILOT_ARTIFACT_NAME,
  PILOT_FILES,
} from "../../scripts/package-pilot.mjs";

const execFile = promisify(execFileCallback);
const COMMAND_TIMEOUT_MS = 20_000;

describe("pilot package command", () => {
  it(
    "packages Alpha 4 through the pnpm script boundary",
    async () => {
      const root = await mkdtemp(join(tmpdir(), "gradpack-pnpm-package-"));
      const artifactRoot = join(root, "artifacts");
      await mkdir(artifactRoot);

      try {
        await execFile(
          process.platform === "win32" ? "pnpm.cmd" : "pnpm",
          ["run", "package:pilot", "--", artifactRoot],
          {
            cwd: process.cwd(),
            maxBuffer: 1_048_576,
            timeout: COMMAND_TIMEOUT_MS,
          },
        );

        const checksumName = `${PILOT_ARTIFACT_NAME}.sha256`;
        expect((await readdir(artifactRoot)).sort()).toEqual(
          [PILOT_ARTIFACT_NAME, checksumName].sort(),
        );

        const zipBytes = await readFile(
          join(artifactRoot, PILOT_ARTIFACT_NAME),
        );
        const digest = createHash("sha256").update(zipBytes).digest("hex");
        expect(await readFile(join(artifactRoot, checksumName), "utf8")).toBe(
          `${digest}  ${PILOT_ARTIFACT_NAME}\n`,
        );

        const entries = unzipSync(zipBytes);
        expect(Object.keys(entries)).toEqual([...PILOT_FILES]);
        const manifest = JSON.parse(strFromU8(entries["manifest.json"]!)) as {
          version: string;
          version_name: string;
        };
        expect(manifest).toMatchObject({
          version: "0.1.0",
          version_name: "0.1.0-alpha.4",
        });
      } finally {
        await rm(root, { force: true, recursive: true });
      }
    },
    COMMAND_TIMEOUT_MS + 5_000,
  );
});
