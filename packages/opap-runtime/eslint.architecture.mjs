export default {
  components: [
    {
      name: "runtime-facade",
      pattern: "packages/opap-runtime/src/index.ts",
      mode: "file",
    },
    {
      name: "runtime-internal",
      pattern: "packages/opap-runtime/**",
      facade: "runtime-facade",
    },
  ],
};
