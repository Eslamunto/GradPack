import { cp, mkdir, rm } from "node:fs/promises";
import { build } from "esbuild";

await rm("dist", { recursive: true, force: true });
await mkdir("dist", { recursive: true });

const entries = [
  ["src/service-worker.ts", "dist/service-worker.js", "esm"],
  ["src/sidepanel/main.ts", "dist/sidepanel.js", "esm"],
  ["src/content/relay.ts", "dist/relay.js", "iife"],
  ["src/page/runner.ts", "dist/runner.js", "iife"],
];

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

await cp("src/manifest.json", "dist/manifest.json");
await cp("src/static/sidepanel.html", "dist/sidepanel.html");
await cp("src/static/sidepanel.css", "dist/sidepanel.css");
await cp("src/static/archive.css", "dist/archive.css");
