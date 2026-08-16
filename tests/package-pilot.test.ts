import { mkdtemp, readFile, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { unzipSync } from "fflate";
import { describe, expect, it } from "vitest";
import {
  PILOT_ARTIFACT_NAME,
  PILOT_FILES,
  packagePilot,
} from "../scripts/package-pilot.mjs";

const makeBuild = async (): Promise<string> => {
  const root = await mkdtemp(join(tmpdir(), "gradpack-package-test-"));
  for (const path of PILOT_FILES) {
    await writeFile(
      join(root, path),
      path === "manifest.json"
        ? '{"name":"GradPack","version":"0.1.0","version_name":"0.1.0-alpha.1"}\n'
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
    expect(await readFile(first.checksumPath, "utf8")).toBe(
      `${first.digest}  ${PILOT_ARTIFACT_NAME}\n`,
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
});
