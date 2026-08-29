import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { quickStartContent } from "./alpha7-quick-start-scenes.mjs";
import { validateRelease } from "./validate-alpha7-installation.mjs";

/**
 * @param {string[]} argv
 * @param {string} name
 */
const requiredArgument = (argv, name) => {
  const index = argv.indexOf(name);
  if (index === -1 || !argv[index + 1]) throw new Error(`${name} is required`);
  return resolve(argv[index + 1]);
};

const thisFile = fileURLToPath(import.meta.url);
if (process.argv[1] && resolve(process.argv[1]) === thisFile) {
  const argv = process.argv.slice(2);
  const result = await validateRelease({
    videoPath: requiredArgument(argv, "--video"),
    captionPath: requiredArgument(argv, "--captions"),
    metadataPath: requiredArgument(argv, "--metadata"),
    releaseDirectory: requiredArgument(argv, "--release-dir"),
    content: quickStartContent,
  });
  process.stdout.write(`${JSON.stringify(result)}\n`);
}
