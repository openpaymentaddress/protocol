import { readdir, readFile } from "node:fs/promises";
import { basename, dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";

const repositoryRoot = dirname(dirname(fileURLToPath(import.meta.url)));
const schemaFilenames = ["open-payment-address-v1.schema.json"];
const ignoredDirectories = new Set([".git", "dist", "node_modules"]);

async function findCopies(directory, schemaFilename) {
  const copies = [];
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    if (entry.isDirectory() && !ignoredDirectories.has(entry.name)) {
      copies.push(
        ...(await findCopies(join(directory, entry.name), schemaFilename)),
      );
    } else if (entry.isFile() && entry.name === schemaFilename) {
      copies.push(join(directory, entry.name));
    }
  }
  return copies;
}

for (const schemaFilename of schemaFilenames) {
  const authoritativePath = join(repositoryRoot, "schema", schemaFilename);
  const authoritativeBytes = await readFile(authoritativePath);
  const mismatches = [];

  for (const path of await findCopies(repositoryRoot, schemaFilename)) {
    if (path === authoritativePath) {
      continue;
    }
    const candidateBytes = await readFile(path);
    if (!candidateBytes.equals(authoritativeBytes)) {
      mismatches.push(relative(repositoryRoot, path));
    }
  }

  if (mismatches.length > 0) {
    throw new Error(
      `Schema copies differ from ${basename(authoritativePath)}: ${mismatches.join(", ")}`,
    );
  }
}
