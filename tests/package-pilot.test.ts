import { createHash } from "node:crypto";
import { execFile as execFileCallback } from "node:child_process";
import {
  link,
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  rename,
  rm,
  stat,
  symlink,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import { unzipSync } from "fflate";
import { describe, expect, it } from "vitest";
import {
  PILOT_ARTIFACT_NAME,
  PILOT_FILES,
  packagePilot,
} from "../scripts/package-pilot.mjs";

const execFile = promisify(execFileCallback);

const makeBuild = async (): Promise<string> => {
  const root = await mkdtemp(join(tmpdir(), "gradpack-package-test-"));
  for (const path of PILOT_FILES) {
    await writeFile(
      join(root, path),
      path === "manifest.json"
        ? '{"name":"GradPack","version":"0.1.0","version_name":"0.1.0-alpha.6"}\n'
        : `synthetic:${path}\n`,
    );
  }
  return root;
};

type Header = {
  path: string;
  time: number;
  date: number;
  flags: number;
  method: number;
  os: number;
  attrs: number;
  commentLength: number;
  extraLength: number;
};

const centralHeaders = (bytes: Uint8Array): Header[] => {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const decoder = new TextDecoder();
  const headers: Header[] = [];
  for (let offset = 0; offset <= bytes.byteLength - 46; offset += 1) {
    if (view.getUint32(offset, true) !== 0x02014b50) continue;
    const pathLength = view.getUint16(offset + 28, true);
    headers.push({
      path: decoder.decode(
        bytes.subarray(offset + 46, offset + 46 + pathLength),
      ),
      time: view.getUint16(offset + 12, true),
      date: view.getUint16(offset + 14, true),
      flags: view.getUint16(offset + 8, true),
      method: view.getUint16(offset + 10, true),
      os: view.getUint8(offset + 5),
      attrs: view.getUint32(offset + 38, true),
      extraLength: view.getUint16(offset + 30, true),
      commentLength: view.getUint16(offset + 32, true),
    });
  }
  return headers;
};

describe("pilot package", () => {
  it("writes CLI artifacts to the requested destination", async () => {
    const root = await mkdtemp(join(tmpdir(), "gradpack-package-cli-"));
    const buildRoot = join(root, "dist");
    const artifactRoot = join(root, "requested-output");
    await mkdir(buildRoot);
    for (const path of PILOT_FILES) {
      await writeFile(
        join(buildRoot, path),
        path === "manifest.json"
          ? '{"name":"GradPack","version":"0.1.0","version_name":"0.1.0-alpha.6"}\n'
          : `synthetic:${path}\n`,
      );
    }

    await execFile(
      process.execPath,
      [join(process.cwd(), "scripts/package-pilot.mjs"), "--", artifactRoot],
      { cwd: root },
    );

    expect((await readdir(artifactRoot)).sort()).toEqual([
      PILOT_ARTIFACT_NAME,
      `${PILOT_ARTIFACT_NAME}.sha256`,
    ]);
  });

  it("rejects the stale Alpha 5 release identity", async () => {
    const buildRoot = await makeBuild();
    await writeFile(
      join(buildRoot, "manifest.json"),
      '{"name":"GradPack","version":"0.1.0","version_name":"0.1.0-alpha.5"}\n',
    );

    await expect(
      packagePilot({
        buildRoot,
        artifactRoot: join(buildRoot, "out"),
      }),
    ).rejects.toThrow("Pilot manifest identity is invalid");
  });

  it("is byte-identical and contains only fixed, allowlisted members", async () => {
    const buildRoot = await makeBuild();
    const firstArtifacts = await mkdtemp(
      join(tmpdir(), "gradpack-artifact-a-"),
    );
    const secondArtifacts = await mkdtemp(
      join(tmpdir(), "gradpack-artifact-b-"),
    );
    const first = await packagePilot({
      buildRoot,
      artifactRoot: firstArtifacts,
    });
    const second = await packagePilot({
      buildRoot,
      artifactRoot: secondArtifacts,
    });
    const firstBytes = new Uint8Array(await readFile(first.artifactPath));
    const secondBytes = new Uint8Array(await readFile(second.artifactPath));

    expect(first.artifactPath).toBe(join(firstArtifacts, PILOT_ARTIFACT_NAME));
    expect(firstBytes).toEqual(secondBytes);
    expect(first.digest).toBe(second.digest);
    const independentDigest = createHash("sha256")
      .update(firstBytes)
      .digest("hex");
    expect(first.digest).toBe(independentDigest);
    expect(await readFile(first.checksumPath, "utf8")).toBe(
      `${independentDigest}  ${PILOT_ARTIFACT_NAME}\n`,
    );
    expect(Object.keys(unzipSync(firstBytes))).toEqual([...PILOT_FILES]);
    expect(centralHeaders(firstBytes).map(({ path }) => path)).toEqual([
      ...PILOT_FILES,
    ]);
    expect(
      centralHeaders(firstBytes).every(
        ({
          time,
          date,
          flags,
          method,
          os,
          attrs,
          commentLength,
          extraLength,
        }) =>
          time === 0 &&
          date === 0x2821 &&
          flags === 0 &&
          method === 8 &&
          os === 3 &&
          attrs === 0o100644 * 65_536 &&
          commentLength === 0 &&
          extraLength === 0,
      ),
    ).toBe(true);
    const end = new DataView(
      firstBytes.buffer,
      firstBytes.byteOffset + firstBytes.byteLength - 22,
      22,
    );
    expect(end.getUint32(0, true)).toBe(0x06054b50);
    expect(end.getUint16(20, true)).toBe(0);
    expect((await readdir(firstArtifacts)).sort()).toEqual([
      PILOT_ARTIFACT_NAME,
      `${PILOT_ARTIFACT_NAME}.sha256`,
    ]);
  });

  it("fails closed for missing, extra, symlinked, and forbidden build input", async () => {
    const missing = await makeBuild();
    await rm(join(missing, "runner.js"));
    await expect(
      packagePilot({ buildRoot: missing, artifactRoot: join(missing, "out") }),
    ).rejects.toThrow(/missing/iu);

    const extra = await makeBuild();
    await writeFile(join(extra, "runner.js.map"), "{}");
    await expect(
      packagePilot({ buildRoot: extra, artifactRoot: join(extra, "out") }),
    ).rejects.toThrow(/unexpected|forbidden/iu);

    const linked = await makeBuild();
    const outside = await mkdtemp(join(tmpdir(), "gradpack-outside-test-"));
    await writeFile(join(outside, "relay.js"), "synthetic");
    await rm(join(linked, "relay.js"));
    await symlink(join(outside, "relay.js"), join(linked, "relay.js"));
    await expect(
      packagePilot({ buildRoot: linked, artifactRoot: join(linked, "out") }),
    ).rejects.toThrow(/symlink|unexpected|forbidden/iu);

    const secret = await makeBuild();
    await writeFile(join(secret, ".env"), "SECRET=synthetic");
    await expect(
      packagePilot({ buildRoot: secret, artifactRoot: join(secret, "out") }),
    ).rejects.toThrow(/unexpected|forbidden/iu);

    const development = await makeBuild();
    await writeFile(join(development, "runner.js"), "GradPack Dev");
    await expect(
      packagePilot({
        buildRoot: development,
        artifactRoot: join(development, "out"),
      }),
    ).rejects.toThrow(/forbidden/iu);
  });

  it("rejects build root, ancestor, and file identity substitution", async () => {
    const rootSwap = await makeBuild();
    const rootArtifacts = await mkdtemp(join(tmpdir(), "gradpack-root-swap-"));
    await expect(
      packagePilot({
        buildRoot: rootSwap,
        artifactRoot: rootArtifacts,
        checkpoint: async (name) => {
          if (name !== "build-sealed") return;
          await rename(rootSwap, `${rootSwap}-moved`);
          await mkdir(rootSwap);
        },
      }),
    ).rejects.toThrow(/identity|changed/iu);

    const ancestor = await mkdtemp(join(tmpdir(), "gradpack-ancestor-"));
    const ancestorBuild = join(ancestor, "dist");
    await mkdir(ancestorBuild);
    for (const path of PILOT_FILES) {
      await writeFile(
        join(ancestorBuild, path),
        path === "manifest.json"
          ? '{"name":"GradPack","version":"0.1.0","version_name":"0.1.0-alpha.6"}\n'
          : `synthetic:${path}\n`,
      );
    }
    const ancestorArtifacts = await mkdtemp(
      join(tmpdir(), "gradpack-ancestor-output-"),
    );
    await expect(
      packagePilot({
        buildRoot: ancestorBuild,
        artifactRoot: ancestorArtifacts,
        checkpoint: async (name) => {
          if (name !== "build-sealed") return;
          await rename(ancestor, `${ancestor}-moved`);
          await mkdir(ancestor);
          await mkdir(ancestorBuild);
        },
      }),
    ).rejects.toThrow(/identity|changed/iu);

    const fileSwap = await makeBuild();
    const fileArtifacts = await mkdtemp(join(tmpdir(), "gradpack-file-swap-"));
    await expect(
      packagePilot({
        buildRoot: fileSwap,
        artifactRoot: fileArtifacts,
        checkpoint: async (name) => {
          if (name !== "build-file-opened:runner.js") return;
          await rm(join(fileSwap, "runner.js"));
          await writeFile(join(fileSwap, "runner.js"), "replacement");
        },
      }),
    ).rejects.toThrow(/identity|changed/iu);

    const inPlace = await makeBuild();
    const inPlaceArtifacts = await mkdtemp(
      join(tmpdir(), "gradpack-in-place-swap-"),
    );
    await expect(
      packagePilot({
        buildRoot: inPlace,
        artifactRoot: inPlaceArtifacts,
        checkpoint: async (name) => {
          if (name !== "build-file-opened:runner.js") return;
          await writeFile(join(inPlace, "runner.js"), "replacement-in-place");
        },
      }),
    ).rejects.toThrow(/identity|changed/iu);
  });

  it("rejects artifact-root substitution and existing hardlink targets", async () => {
    const buildRoot = await makeBuild();
    const artifactRoot = await mkdtemp(join(tmpdir(), "gradpack-output-swap-"));
    await expect(
      packagePilot({
        buildRoot,
        artifactRoot,
        checkpoint: async (name) => {
          if (name !== "artifact-root-sealed") return;
          await rename(artifactRoot, `${artifactRoot}-moved`);
          await mkdir(artifactRoot);
        },
      }),
    ).rejects.toThrow(/identity|changed/iu);

    const linkedBuild = await makeBuild();
    const linkedArtifacts = await mkdtemp(
      join(tmpdir(), "gradpack-hardlink-output-"),
    );
    const outside = join(linkedArtifacts, "outside-sentinel");
    const target = join(linkedArtifacts, PILOT_ARTIFACT_NAME);
    await writeFile(outside, "sentinel");
    await link(outside, target);
    await expect(
      packagePilot({
        buildRoot: linkedBuild,
        artifactRoot: linkedArtifacts,
      }),
    ).rejects.toThrow(/hardlink|link count/iu);
    expect(await readFile(outside, "utf8")).toBe("sentinel");
    expect((await stat(outside)).nlink).toBe(2);

    const lateBuild = await makeBuild();
    const lateArtifacts = await mkdtemp(
      join(tmpdir(), "gradpack-late-output-swap-"),
    );
    await expect(
      packagePilot({
        buildRoot: lateBuild,
        artifactRoot: lateArtifacts,
        checkpoint: async (name) => {
          if (name !== "artifact-temporaries-written") return;
          await rename(lateArtifacts, `${lateArtifacts}-moved`);
          await mkdir(lateArtifacts);
        },
      }),
    ).rejects.toThrow(/identity|changed/iu);

    const targetSwapBuild = await makeBuild();
    const targetSwapArtifacts = await mkdtemp(
      join(tmpdir(), "gradpack-target-swap-"),
    );
    const targetSwapOutside = join(targetSwapArtifacts, "outside");
    await writeFile(targetSwapOutside, "sentinel");
    await expect(
      packagePilot({
        buildRoot: targetSwapBuild,
        artifactRoot: targetSwapArtifacts,
        checkpoint: async (name) => {
          if (name !== "artifact-temporaries-written") return;
          await link(
            targetSwapOutside,
            join(targetSwapArtifacts, PILOT_ARTIFACT_NAME),
          );
        },
      }),
    ).rejects.toThrow(/hardlink|link count/iu);
    expect(await readFile(targetSwapOutside, "utf8")).toBe("sentinel");
  });

  it("rejects hardlinked build members", async () => {
    const buildRoot = await makeBuild();
    const outside = join(
      await mkdtemp(join(tmpdir(), "gradpack-hardlink-")),
      "runner.js",
    );
    await writeFile(outside, "synthetic");
    await rm(join(buildRoot, "runner.js"));
    await link(outside, join(buildRoot, "runner.js"));

    await expect(
      packagePilot({
        buildRoot,
        artifactRoot: await mkdtemp(join(tmpdir(), "gradpack-hardlink-out-")),
      }),
    ).rejects.toThrow(/hardlink|link count/iu);
  });

  it("cleans its temporary file when creation or validation fails", async () => {
    for (const stage of [
      `artifact-temporary-opened:${PILOT_ARTIFACT_NAME}`,
      `artifact-temporary-written:${PILOT_ARTIFACT_NAME}`,
    ]) {
      const buildRoot = await makeBuild();
      const artifactRoot = await mkdtemp(
        join(tmpdir(), "gradpack-temp-failure-"),
      );
      await expect(
        packagePilot({
          buildRoot,
          artifactRoot,
          checkpoint: (name) => {
            if (name === stage) throw new TypeError("Injected temp failure");
          },
        }),
      ).rejects.toThrow("Injected temp failure");
      expect(await readdir(artifactRoot)).toEqual([]);
    }

    const buildRoot = await makeBuild();
    const artifactRoot = await mkdtemp(
      join(tmpdir(), "gradpack-temp-identity-"),
    );
    const outsideRoot = await mkdtemp(
      join(tmpdir(), "gradpack-temp-identity-link-"),
    );
    const outside = join(outsideRoot, "outside-hardlink");
    await expect(
      packagePilot({
        buildRoot,
        artifactRoot,
        checkpoint: async (name) => {
          if (name !== `artifact-temporary-created:${PILOT_ARTIFACT_NAME}`)
            return;
          const temporary = (await readdir(artifactRoot)).find((path) =>
            path.startsWith(".gradpack-"),
          );
          if (!temporary) throw new TypeError("Missing injected temporary");
          await link(join(artifactRoot, temporary), outside);
        },
      }),
    ).rejects.toThrow(/link count|identity/iu);
    expect(await readdir(artifactRoot)).toEqual([]);
    expect((await stat(outside)).nlink).toBe(1);

    const syncedBuild = await makeBuild();
    const syncedRoot = await mkdtemp(
      join(tmpdir(), "gradpack-temp-synced-identity-"),
    );
    const syncedOutside = join(
      await mkdtemp(join(tmpdir(), "gradpack-temp-synced-link-")),
      "outside-hardlink",
    );
    await expect(
      packagePilot({
        buildRoot: syncedBuild,
        artifactRoot: syncedRoot,
        checkpoint: async (name) => {
          if (name !== `artifact-temporary-synced:${PILOT_ARTIFACT_NAME}`)
            return;
          const temporary = (await readdir(syncedRoot)).find((path) =>
            path.startsWith(".gradpack-"),
          );
          if (!temporary) throw new TypeError("Missing injected temporary");
          await link(join(syncedRoot, temporary), syncedOutside);
        },
      }),
    ).rejects.toThrow(/link count|identity/iu);
    expect(await readdir(syncedRoot)).toEqual([]);
    expect((await stat(syncedOutside)).nlink).toBe(1);
  });

  it("treats an existing versioned artifact pair as immutable", async () => {
    const buildRoot = await makeBuild();
    const artifactRoot = await mkdtemp(join(tmpdir(), "gradpack-immutable-"));
    const first = await packagePilot({ buildRoot, artifactRoot });
    const beforeArtifact = await stat(first.artifactPath);
    const beforeChecksum = await stat(first.checksumPath);
    const same = await packagePilot({ buildRoot, artifactRoot });

    expect(same.digest).toBe(first.digest);
    expect((await stat(first.artifactPath)).ino).toBe(beforeArtifact.ino);
    expect((await stat(first.checksumPath)).ino).toBe(beforeChecksum.ino);
    expect((await readdir(artifactRoot)).sort()).toEqual([
      PILOT_ARTIFACT_NAME,
      `${PILOT_ARTIFACT_NAME}.sha256`,
    ]);

    const originalChecksum = await readFile(first.checksumPath);
    await writeFile(first.artifactPath, "different-versioned-bytes");
    const changedArtifact = await readFile(first.artifactPath);
    await expect(packagePilot({ buildRoot, artifactRoot })).rejects.toThrow(
      /immutable|differ|inconsistent/iu,
    );
    expect(await readFile(first.artifactPath)).toEqual(changedArtifact);
    expect(await readFile(first.checksumPath)).toEqual(originalChecksum);
    expect(
      (await readdir(artifactRoot)).filter((path) =>
        path.startsWith(".gradpack-"),
      ),
    ).toEqual([]);
  });

  it("fails closed for an incomplete pair and rolls back a failed first install", async () => {
    const incompleteBuild = await makeBuild();
    const incompleteRoot = await mkdtemp(
      join(tmpdir(), "gradpack-incomplete-pair-"),
    );
    const loneArtifact = join(incompleteRoot, PILOT_ARTIFACT_NAME);
    await writeFile(loneArtifact, "lone-versioned-artifact");
    await expect(
      packagePilot({
        buildRoot: incompleteBuild,
        artifactRoot: incompleteRoot,
      }),
    ).rejects.toThrow(/incomplete|inconsistent/iu);
    expect(await readFile(loneArtifact, "utf8")).toBe(
      "lone-versioned-artifact",
    );
    expect(await readdir(incompleteRoot)).toEqual([PILOT_ARTIFACT_NAME]);

    const rollbackBuild = await makeBuild();
    const rollbackRoot = await mkdtemp(
      join(tmpdir(), "gradpack-pair-rollback-"),
    );
    await expect(
      packagePilot({
        buildRoot: rollbackBuild,
        artifactRoot: rollbackRoot,
        checkpoint: (name) => {
          if (
            name === `artifact-before-install:${PILOT_ARTIFACT_NAME}.sha256`
          ) {
            throw new TypeError("Injected pair install failure");
          }
        },
      }),
    ).rejects.toThrow("Injected pair install failure");
    expect(await readdir(rollbackRoot)).toEqual([]);
  });
});
