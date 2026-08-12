import { readFile, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const version = process.argv[2];

if (!/^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/.test(version ?? "")) {
  throw new Error("usage: npm run version:set -- <major.minor.patch>");
}

async function readJson(path) {
  return JSON.parse(await readFile(resolve(repositoryRoot, path), "utf8"));
}

async function writeJson(path, value) {
  await writeFile(
    resolve(repositoryRoot, path),
    `${JSON.stringify(value, null, 2)}\n`,
  );
}

const manifest = await readJson("manifest.json");
const packageMetadata = await readJson("package.json");
const packageLock = await readJson("package-lock.json");

manifest.version = version;
packageMetadata.version = version;
packageLock.version = version;
packageLock.packages[""].version = version;

await Promise.all([
  writeJson("manifest.json", manifest),
  writeJson("package.json", packageMetadata),
  writeJson("package-lock.json", packageLock),
]);

console.log(`Updated Casimir version metadata to ${version}.`);
