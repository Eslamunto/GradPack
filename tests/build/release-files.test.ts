import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const read = (path: string): string => readFileSync(path, "utf8");

describe("pilot release surface", () => {
  it("uses a least-privilege, SHA-pinned, synthetic-only CI workflow", () => {
    const workflow = read(".github/workflows/ci.yml");

    expect(workflow).toContain("contents: read");
    expect(workflow).toContain("persist-credentials: false");
    expect(workflow).toContain(
      "actions/checkout@d23441a48e516b6c34aea4fa41551a30e30af803 # v6",
    );
    expect(workflow).toContain(
      "pnpm/action-setup@0977fd99725f1db4007ccb2928dbb4e90d06cc86 # v6",
    );
    expect(workflow).toContain(
      "actions/setup-node@249970729cb0ef3589644e2896645e5dc5ba9c38 # v6",
    );
    expect(workflow).toContain("version: 11.17.0");
    expect(workflow).toContain("node-version: 22");
    expect(workflow).toContain("pnpm install --frozen-lockfile");
    expect(workflow).toContain("pnpm verify");
    expect(workflow).not.toMatch(/upload-artifact|chrome|canvas|artifacts\//iu);
    const uses = workflow.match(/^\s*- uses: [^\s@]+@[0-9a-f]{40} # v6$/gmu);
    expect(uses).toHaveLength(3);
  });

  it("keeps the package command and public guidance within pilot policy", () => {
    const packageJson = JSON.parse(read("package.json"));
    const install = read("docs/pilot/INSTALL.md");
    const checklist = read("docs/pilot/TEST_CHECKLIST.md");
    const contributing = read("CONTRIBUTING.md");
    const security = read("SECURITY.md");
    const readme = read("README.md");

    expect(packageJson.scripts["package:pilot"]).toBe(
      "pnpm build && node scripts/package-pilot.mjs",
    );
    for (const token of [
      "macOS",
      "Windows",
      "Linux",
      "Chrome 116",
      "Load unpacked",
      "250 MiB",
      "signed in",
      "Remove",
    ]) {
      expect(install).toContain(token);
    }
    expect(checklist).toContain("Do not include");
    expect(checklist).not.toMatch(
      /^- (?:Course name|Filename|Canvas URL|Student identity|Screenshot|Archive):/gimu,
    );
    expect(contributing).toContain("pnpm verify");
    expect(contributing).toContain("privacy-safe");
    expect(security).toContain("private vulnerability reporting");
    expect(security).toContain("Do not include Canvas");
    expect(readme).toContain("alpha classmate pilot");
    expect(readme).not.toContain("product-definition and feasibility phase");
  });

  it("keeps every committed Canvas fixture invented and synthetic", () => {
    const fixtureText = [
      "active-courses.json",
      "completed-courses.json",
      "modules.json",
      "files.json",
      "pages.json",
      "page.html",
    ]
      .map((name) => read(`tests/fixtures/canvas/${name}`))
      .join("\n");

    expect(fixtureText).toMatch(/Synthetic|synthetic|\[\]/u);
    expect(fixtureText).not.toMatch(
      /cookie|authorization|student|@|bearer|verifier|session/iu,
    );
  });
});
