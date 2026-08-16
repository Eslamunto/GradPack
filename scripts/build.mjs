import { cp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { build } from "esbuild";

const argumentsList = process.argv.slice(2);
if (
  argumentsList.length > 1 ||
  (argumentsList.length === 1 && argumentsList[0] !== "--dev")
) {
  throw new TypeError("Unsupported build arguments");
}
const development = argumentsList[0] === "--dev";
const outputDirectory = development ? "dist-dev" : "dist";
const entries = development
  ? [
      [
        "src/dev/service-worker.ts",
        `${outputDirectory}/service-worker.js`,
        "esm",
      ],
      ["src/sidepanel/main.ts", `${outputDirectory}/sidepanel.js`, "esm"],
      ["src/dev/relay.ts", `${outputDirectory}/relay.js`, "iife"],
      ["src/dev/runner.ts", `${outputDirectory}/runner.js`, "iife"],
    ]
  : [
      ["src/service-worker.ts", `${outputDirectory}/service-worker.js`, "esm"],
      ["src/sidepanel/main.ts", `${outputDirectory}/sidepanel.js`, "esm"],
      ["src/content/relay.ts", `${outputDirectory}/relay.js`, "iife"],
      ["src/page/runner.ts", `${outputDirectory}/runner.js`, "iife"],
    ];

await rm(outputDirectory, { recursive: true, force: true });
await mkdir(outputDirectory, { recursive: true });

for (const [entryPoint, outfile, format] of entries) {
  await build({
    entryPoints: [entryPoint],
    outfile,
    bundle: true,
    format,
    platform: "browser",
    target: "chrome116",
    sourcemap: false,
    legalComments: "eof",
  });
}

/** @type {unknown} */
const manifest = JSON.parse(await readFile("src/manifest.json", "utf8"));
if (development) {
  if (
    typeof manifest !== "object" ||
    manifest === null ||
    !("name" in manifest) ||
    !("version_name" in manifest) ||
    typeof manifest.name !== "string" ||
    typeof manifest.version_name !== "string"
  ) {
    throw new TypeError("Invalid source manifest");
  }
  manifest.name = "GradPack Dev";
  manifest.version_name += "-dev";
}
await writeFile(
  `${outputDirectory}/manifest.json`,
  `${JSON.stringify(manifest, null, 2)}\n`,
);
await cp("src/static/sidepanel.html", `${outputDirectory}/sidepanel.html`);
await cp("src/static/sidepanel.css", `${outputDirectory}/sidepanel.css`);
await cp("src/static/archive.css", `${outputDirectory}/archive.css`);
