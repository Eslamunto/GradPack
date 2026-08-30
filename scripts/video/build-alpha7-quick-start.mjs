import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { quickStartContent } from "./alpha7-quick-start-scenes.mjs";
import {
  buildVideo,
  loadSharp,
  parseArgs,
} from "./build-alpha7-installation.mjs";

const thisFile = fileURLToPath(import.meta.url);
if (process.argv[1] && resolve(process.argv[1]) === thisFile) {
  const options = parseArgs(process.argv.slice(2));
  const outputs = await buildVideo({
    ...options,
    sharp: loadSharp(),
    content: quickStartContent,
  });
  process.stdout.write(`${JSON.stringify(outputs)}\n`);
}
