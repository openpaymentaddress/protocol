export default {
  components: [
    {
      name: "core-facade",
      pattern: "packages/opap-core/src/index.ts",
      mode: "file",
    },
    {
      name: "core-internal",
      pattern: "packages/opap-core/**",
      facade: "core-facade",
    },
  ],
};
