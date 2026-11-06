import { copyFile, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const scriptDirectory = dirname(fileURLToPath(import.meta.url));
const appDirectory = resolve(scriptDirectory, "..");
const repositoryDirectory = resolve(appDirectory, "../..");
const distributionDirectory = resolve(appDirectory, "dist");
const packageDirectory = resolve(distributionDirectory, "npm");
const workspaceManifest = JSON.parse(
  await readFile(resolve(appDirectory, "package.json"), "utf8"),
);

await rm(packageDirectory, { recursive: true, force: true });
await mkdir(packageDirectory, { recursive: true });
await Promise.all([
  copyFile(
    resolve(distributionDirectory, "blocklab.js"),
    resolve(packageDirectory, "blocklab.js"),
  ),
  copyFile(
    resolve(appDirectory, "README.md"),
    resolve(packageDirectory, "README.md"),
  ),
  copyFile(
    resolve(repositoryDirectory, "LICENSE"),
    resolve(packageDirectory, "LICENSE"),
  ),
]);

const packageManifest = {
  name: workspaceManifest.name,
  version: workspaceManifest.version,
  description: workspaceManifest.description,
  license: workspaceManifest.license,
  type: "module",
  engines: { node: ">=24" },
  bin: { blocklab: "./blocklab.js" },
  files: ["blocklab.js", "README.md", "LICENSE"],
};
await writeFile(
  resolve(packageDirectory, "package.json"),
  `${JSON.stringify(packageManifest, null, 2)}\n`,
);
