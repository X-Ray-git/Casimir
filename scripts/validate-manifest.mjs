import { access, readFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const readJson = async (path) =>
  JSON.parse(await readFile(resolve(repositoryRoot, path), "utf8"));

const manifest = await readJson("manifest.json");
const packageMetadata = await readJson("package.json");

if (manifest.manifest_version !== 3) {
  throw new Error("manifest.json must use Manifest V3");
}

if (manifest.name !== "Casimir") {
  throw new Error(`unexpected extension name: ${manifest.name}`);
}

if (manifest.version !== packageMetadata.version) {
  throw new Error(
    `version mismatch: manifest=${manifest.version}, package=${packageMetadata.version}`,
  );
}

const referencedFiles = [
  manifest.background?.service_worker,
  ...Object.values(manifest.icons ?? {}),
  ...(manifest.content_scripts ?? []).flatMap((entry) => entry.js ?? []),
].filter(Boolean);

await Promise.all(
  referencedFiles.map(async (path) => {
    await access(resolve(repositoryRoot, path));
  }),
);

console.log(
  `Validated ${manifest.name} ${manifest.version} and ${referencedFiles.length} referenced scripts.`,
);
