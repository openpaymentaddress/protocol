export default {
  components: [
    {
      name: "authoritative-schema",
      pattern: "schema/*.schema.json",
      mode: "file",
    },
    { name: "conformance", pattern: "conformance/**" },
  ],
  forbidden: [
    {
      from: "core-*",
      to: "*",
      except_to: ["core-*", "authoritative-schema"],
      why: "opap-core must remain pure and may depend only on its own code and the authoritative schema.",
    },
    {
      from: "runtime-*",
      to: "*",
      except_to: ["runtime-*", "core-*"],
      why: "opap-runtime may depend only on its own code and the opap-core public facade.",
    },
    {
      from: "cli-*",
      to: "*",
      except_to: ["cli-*", "runtime-*"],
      why: "opap-cli may depend only on its own code and the opap-runtime public facade.",
    },
    {
      from: "conformance",
      to: "*",
      except_to: ["conformance", "core-*", "runtime-*", "authoritative-schema"],
      why: "Conformance tests exercise public APIs and the authoritative schema, never package internals.",
    },
  ],
};
