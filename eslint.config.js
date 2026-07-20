import { readdirSync } from "node:fs";
import { dirname, join, sep } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

import eslint from "@eslint/js";
import boundaries from "eslint-plugin-boundaries";
import tseslint from "typescript-eslint";

const repositoryRoot = dirname(fileURLToPath(import.meta.url));
const ignoredDirectories = new Set([
  ".git",
  ".idea",
  ".vscode",
  "coverage",
  "dist",
  "node_modules",
]);

function findArchitectureFiles(directory) {
  const files = [];

  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    if (entry.isDirectory()) {
      if (!ignoredDirectories.has(entry.name)) {
        files.push(...findArchitectureFiles(join(directory, entry.name)));
      }
    } else if (entry.name === "eslint.architecture.mjs") {
      files.push(join(directory, entry.name));
    }
  }

  return files;
}

const architectureFiles = findArchitectureFiles(repositoryRoot).sort(
  (left, right) => right.split(sep).length - left.split(sep).length,
);
const architectures = await Promise.all(
  architectureFiles.map(
    async (path) => (await import(pathToFileURL(path).href)).default,
  ),
);
const components = architectures.flatMap(
  (architecture) => architecture.components ?? [],
);
const forbidden = architectures.flatMap(
  (architecture) => architecture.forbidden ?? [],
);
const componentNames = components.map((component) => component.name);
const fileComponentNames = new Set(
  components
    .filter((component) => component.mode === "file")
    .map((component) => component.name),
);

function resolveNames(specification) {
  const specifications = Array.isArray(specification)
    ? specification
    : [specification];

  return specifications.flatMap((item) => {
    if (item === "*") {
      return componentNames;
    }
    if (item.endsWith("*")) {
      const prefix = item.slice(0, -1);
      return componentNames.filter((name) => name.startsWith(prefix));
    }
    return [item];
  });
}

function expand(specification, exclusions = []) {
  if (typeof specification === "object" && !Array.isArray(specification)) {
    return specification;
  }

  const excludedNames = new Set(resolveNames(exclusions));
  const names = [...new Set(resolveNames(specification))].filter(
    (name) => !excludedNames.has(name),
  );
  const selectors = names.map((name) =>
    fileComponentNames.has(name)
      ? { file: { categories: name } }
      : { element: { types: name } },
  );
  return selectors.length === 1 ? selectors[0] : selectors;
}

const boundaryElements = components
  .filter((component) => component.mode !== "file")
  .map((component) => ({
    type: component.name,
    pattern: component.pattern,
    ...(component.capture === undefined ? {} : { capture: component.capture }),
  }));
const boundaryFiles = components
  .filter((component) => component.mode === "file")
  .map((component) => ({
    category: component.name,
    pattern: component.pattern,
    ...(component.capture === undefined ? {} : { capture: component.capture }),
  }));
const boundaryRules = forbidden.map((edge) => ({
  from: expand(edge.from, edge.except),
  disallow: { to: expand(edge.to, edge.except_to) },
  message: edge.why,
}));
const facadePolicies = components
  .filter((component) => component.facade !== undefined)
  .map((component) => ({
    from: {
      element: { types: { noneOf: [component.name] } },
    },
    disallow: {
      to: [
        {
          element: { types: component.name },
          file: { isUnknown: true },
        },
        {
          element: { types: component.name },
          file: { categories: { noneOf: [component.facade] } },
        },
      ],
    },
    message: `External callers must import ${component.name.replace("-internal", "")} through its public facade.`,
  }));

export default tseslint.config(
  {
    ignores: [
      "**/dist/**",
      "**/node_modules/**",
      "**/coverage/**",
      "packages/opap-core/src/generated/**",
    ],
  },
  eslint.configs.recommended,
  ...tseslint.configs.recommended,
  {
    files: ["**/*.{ts,js,mjs}"],
    plugins: { boundaries },
    settings: {
      "boundaries/elements": boundaryElements,
      "boundaries/files": boundaryFiles,
      "boundaries/include": ["apps/**", "packages/**", "conformance/**"],
      "boundaries/root-path": repositoryRoot,
      "import/resolver": {
        typescript: {
          alwaysTryTypes: true,
          project: "./tsconfig.json",
        },
      },
    },
    rules: {
      "boundaries/dependencies": [
        "error",
        {
          default: "allow",
          policies: [...boundaryRules, ...facadePolicies],
        },
      ],
      "boundaries/no-unknown-files": "error",
    },
  },
  {
    files: ["eslint.config.js"],
    languageOptions: {
      globals: { console: "readonly", process: "readonly" },
    },
  },
  {
    files: ["**/*.mjs"],
    languageOptions: {
      globals: {
        Buffer: "readonly",
        console: "readonly",
        process: "readonly",
        URL: "readonly",
      },
    },
  },
  {
    files: [
      "packages/opap-core/src/**/*.ts",
      "packages/opap-runtime/src/**/*.ts",
    ],
    rules: {
      "no-restricted-imports": [
        "error",
        {
          patterns: [
            {
              group: ["node:*"],
              message:
                "Core and runtime packages must remain browser-compatible; put Node adapters in an app.",
            },
          ],
        },
      ],
    },
  },
);
