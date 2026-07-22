import crypto from "node:crypto";
import fs from "node:fs";
import net from "node:net";
import path from "node:path";
import { fileURLToPath } from "node:url";
import Ajv2020 from "ajv/dist/2020.js";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const failures = [];
let checks = 0;

function check(condition, message) {
  checks += 1;
  if (!condition) failures.push(message);
}

function readBytes(relativePath) {
  return fs.readFileSync(path.join(repoRoot, relativePath));
}

function readText(relativePath) {
  return readBytes(relativePath).toString("utf8");
}

function parseJsonStrict(text, label) {
  let offset = 0;

  function syntax(message) {
    throw new Error(`${label}:json_syntax:${message}@${offset}`);
  }

  function whitespace() {
    while (/\s/u.test(text[offset] ?? "")) offset += 1;
  }

  function stringToken() {
    if (text[offset] !== '"') syntax("expected_string");
    const start = offset;
    offset += 1;
    while (offset < text.length) {
      const character = text[offset];
      if (character === '"') {
        offset += 1;
        return JSON.parse(text.slice(start, offset));
      }
      if (character === "\\") {
        offset += 1;
        if (text[offset] === "u") {
          const hex = text.slice(offset + 1, offset + 5);
          if (!/^[0-9a-fA-F]{4}$/u.test(hex)) syntax("invalid_unicode_escape");
          offset += 5;
          continue;
        }
        if (!/["\\/bfnrt]/u.test(text[offset] ?? "")) syntax("invalid_escape");
        offset += 1;
        continue;
      }
      if (character.charCodeAt(0) < 0x20) syntax("control_character");
      offset += 1;
    }
    syntax("unterminated_string");
  }

  function value() {
    whitespace();
    const character = text[offset];
    if (character === "{") return object();
    if (character === "[") return array();
    if (character === '"') return stringToken();
    for (const literal of ["true", "false", "null"]) {
      if (text.startsWith(literal, offset)) {
        offset += literal.length;
        return;
      }
    }
    const number = text.slice(offset).match(/^-?(?:0|[1-9][0-9]*)(?:\.[0-9]+)?(?:[eE][+-]?[0-9]+)?/u)?.[0];
    if (!number) syntax("expected_value");
    offset += number.length;
  }

  function object() {
    offset += 1;
    whitespace();
    const keys = new Set();
    if (text[offset] === "}") {
      offset += 1;
      return;
    }
    while (offset < text.length) {
      whitespace();
      const key = stringToken();
      if (keys.has(key)) throw new Error(`${label}:duplicate_key:${key}`);
      keys.add(key);
      whitespace();
      if (text[offset] !== ":") syntax("expected_colon");
      offset += 1;
      value();
      whitespace();
      if (text[offset] === "}") {
        offset += 1;
        return;
      }
      if (text[offset] !== ",") syntax("expected_object_separator");
      offset += 1;
    }
    syntax("unterminated_object");
  }

  function array() {
    offset += 1;
    whitespace();
    if (text[offset] === "]") {
      offset += 1;
      return;
    }
    while (offset < text.length) {
      value();
      whitespace();
      if (text[offset] === "]") {
        offset += 1;
        return;
      }
      if (text[offset] !== ",") syntax("expected_array_separator");
      offset += 1;
    }
    syntax("unterminated_array");
  }

  value();
  whitespace();
  if (offset !== text.length) syntax("trailing_content");
  return JSON.parse(text);
}

function readJson(relativePath) {
  return parseJsonStrict(readText(relativePath), relativePath);
}

function jsonFiles(relativeDirectory) {
  const absoluteDirectory = path.join(repoRoot, relativeDirectory);
  return fs.readdirSync(absoluteDirectory, { withFileTypes: true }).flatMap((entry) => {
    const relativePath = path.posix.join(relativeDirectory.replaceAll("\\", "/"), entry.name);
    return entry.isDirectory() ? jsonFiles(relativePath) : (entry.name.endsWith(".json") ? [relativePath] : []);
  });
}

function canonicalJson(value) {
  if (value === null || typeof value !== "object") {
    if (typeof value === "number" && (!Number.isSafeInteger(value) || Object.is(value, -0))) {
      throw new Error("canonical JSON permits safe integers other than negative zero only");
    }
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${canonicalJson(value[key])}`).join(",")}}`;
}

function fingerprint(value) {
  return `sha256:${crypto.createHash("sha256").update(value).digest("hex")}`;
}

function canonicalOpid(value) {
  if (typeof value !== "string" || !/^[\x00-\x7F]+$/u.test(value) || value.length > 512) return false;
  try {
    const url = new URL(value);
    if (url.protocol !== "https:" || url.username || url.password || url.port || url.search || url.hash) return false;
    if (url.href !== value || url.pathname === "" || (url.pathname !== "/" && url.pathname.endsWith("/"))) return false;
    if (url.pathname.includes("//")) return false;
    decodeURIComponent(url.pathname);
    for (const encoded of url.pathname.matchAll(/%([0-9A-F]{2})/gu)) {
      const byte = Number.parseInt(encoded[1], 16);
      const character = String.fromCharCode(byte);
      if (/[A-Za-z0-9._~-]/u.test(character) || byte === 0x2f || byte === 0x5c) return false;
    }
    return !/%[0-9a-f]*[a-f][0-9a-f]*/u.test(url.pathname);
  } catch {
    return false;
  }
}

function validUtcSecond(value) {
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/u.test(value ?? "")) return false;
  try {
    return new Date(value).toISOString().replace(".000Z", "Z") === value;
  } catch {
    return false;
  }
}

function validIban(value) {
  if (!/^[A-Z]{2}[0-9]{2}[A-Z0-9]{11,30}$/u.test(value ?? "")) return false;
  const rearranged = `${value.slice(4)}${value.slice(0, 4)}`;
  let remainder = 0;
  for (const character of rearranged) {
    const digits = /[A-Z]/u.test(character) ? String(character.charCodeAt(0) - 55) : character;
    for (const digit of digits) remainder = (remainder * 10 + Number(digit)) % 97;
  }
  return remainder === 1;
}

function directOptionProjection(option) {
  if (option.type === "sepa") return { type: "sepa", currency: option.currency, iban: option.iban };
  if (option.type === "erc20") {
    return {
      type: "erc20",
      currency: option.currency,
      chain: option.chain,
      asset: option.asset.toLowerCase(),
      recipient: option.recipient.toLowerCase()
    };
  }
  if (option.type.includes("/")) return { type: option.type, currency: option.currency, data: option.data };
  return null;
}

function rawOptionProjection(option) {
  const direct = directOptionProjection(option);
  if (direct) return direct;
  if (option.type !== "split") return option;
  return {
    type: "split",
    currency: option.currency,
    adapter: option.execution.adapter,
    chain: option.execution.chain,
    asset: option.execution.asset.toLowerCase(),
    contract: option.execution.contract.toLowerCase(),
    config_id: option.execution.config_id.toLowerCase(),
    allocations: option.allocations.map((allocation) => ({
      ...(allocation.recipient ? { recipient: allocation.recipient.toLowerCase() } : { target: allocation.target }),
      share_ppm: allocation.share_ppm
    }))
  };
}

function semanticRecordDiagnostics(record) {
  const diagnostics = [];
  if (!canonicalOpid(record.id)) diagnostics.push("noncanonical_id");
  if (!validUtcSecond(record.issued_at)) diagnostics.push("issued_at");
  if (!validUtcSecond(record.expires_at) || record.expires_at <= record.issued_at) diagnostics.push("expires_at");
  if (record.payment?.type === "delegate" && !canonicalOpid(record.payment.target)) diagnostics.push("noncanonical_target");
  if (record.payment?.type !== "options" || !Array.isArray(record.payment.options)) return diagnostics;

  const optionTargets = new Set();
  for (const option of record.payment.options) {
    if (option.type === "sepa" && !validIban(option.iban)) diagnostics.push("iban");
    if (option.type === "split" && Array.isArray(option.allocations)) {
      const recipients = new Set();
      const targets = new Set();
      let shareSum = 0;
      for (const allocation of option.allocations) {
        const destinationCount = Number(typeof allocation.recipient === "string") + Number(typeof allocation.target === "string");
        if (destinationCount !== 1) diagnostics.push("allocation_destination");
        if (Number.isInteger(allocation.share_ppm)) shareSum += allocation.share_ppm;
        if (typeof allocation.recipient === "string") {
          const recipient = allocation.recipient.toLowerCase();
          if (recipients.has(recipient)) diagnostics.push("duplicate_recipient");
          recipients.add(recipient);
        }
        if (typeof allocation.target === "string") {
          if (!canonicalOpid(allocation.target)) diagnostics.push("noncanonical_target");
          if (targets.has(allocation.target)) diagnostics.push("duplicate_target");
          targets.add(allocation.target);
        }
      }
      if (shareSum !== 1_000_000) diagnostics.push("share_ppm");
    }
    try {
      const projection = canonicalJson(rawOptionProjection(option));
      if (optionTargets.has(projection)) diagnostics.push("duplicate_option_target");
      optionTargets.add(projection);
    } catch {
      // Structural schema diagnostics own malformed option shapes.
    }
  }
  return diagnostics;
}

const ajv = new Ajv2020({ allErrors: true, strict: true, strictRequired: false });
const recordSchema = readJson("schema/open-payment-address-v1.schema.json");
const planSchema = readJson("schema/open-payment-execution-plan-v1.schema.json");
const validateRecordSchema = ajv.compile(recordSchema);
const validatePlanSchema = ajv.compile(planSchema);

function schemaDiagnostics(validator) {
  return (validator.errors ?? []).map((error) => `${error.instancePath || "/"}:${error.schemaPath}:${error.message}`);
}

function inspectRecord(relativePath, expectedOpid) {
  let record;
  try {
    record = readJson(relativePath);
  } catch (error) {
    return { error: "invalid_record", diagnostics: [String(error.message)] };
  }

  const schemaValid = validateRecordSchema(record);
  const diagnostics = [...schemaDiagnostics(validateRecordSchema), ...semanticRecordDiagnostics(record)];
  if (!schemaValid || diagnostics.length > 0) return { error: "invalid_record", diagnostics };
  if (expectedOpid && record.id !== expectedOpid) return { error: "id_mismatch", diagnostics: [] };
  return { record, diagnostics: [] };
}

function recordUrl(opid) {
  const url = new URL(opid);
  return `${url.origin}/.well-known/open-payment/record/${Buffer.from(url.pathname).toString("base64url")}`;
}

function sortedProjections(options) {
  return options.map(rawOptionProjection).sort((left, right) => Buffer.compare(Buffer.from(canonicalJson(left)), Buffer.from(canonicalJson(right))));
}

function buildCompatiblePlan(rootPath, targetPath) {
  const root = readJson(rootPath);
  const target = readJson(targetPath);
  const split = root.payment.options.find((option) => option.type === "split");
  const optionIndex = root.payment.options.indexOf(split);
  const selectedIndex = target.payment.options.findIndex((option) => option.type === "erc20"
    && option.currency === split.currency
    && option.chain === split.execution.chain
    && option.asset.toLowerCase() === split.execution.asset.toLowerCase());
  if (selectedIndex < 0) throw new Error("compatible scenario contains no matching option");
  const selected = target.payment.options[selectedIndex];
  const selectedProjection = directOptionProjection(selected);
  const compiledAllocations = split.allocations.map((allocation) => ({
    recipient: (allocation.recipient ?? selected.recipient).toLowerCase(),
    share_ppm: allocation.share_ppm
  }));
  const compiledRecipients = compiledAllocations.map((allocation) => allocation.recipient);
  if (new Set(compiledRecipients).size !== compiledRecipients.length) throw new Error("split_recipient_collision");
  const splitProjection = {
    type: "split",
    currency: split.currency,
    adapter: split.execution.adapter,
    chain: split.execution.chain,
    asset: split.execution.asset.toLowerCase(),
    contract: split.execution.contract.toLowerCase(),
    config_id: split.execution.config_id.toLowerCase(),
    allocations: split.allocations.map((allocation) => allocation.recipient
      ? { recipient: allocation.recipient.toLowerCase(), share_ppm: allocation.share_ppm }
      : { target: allocation.target, share_ppm: allocation.share_ppm, terminal_opid: target.id, selected: selectedProjection })
  };
  const rootProjection = { options: [splitProjection] };
  const targetProjection = { options: sortedProjections(target.payment.options) };
  const node = (relativePath, record, projection, selection) => ({
    opid: record.id,
    hostname: new URL(record.id).hostname,
    record_url: recordUrl(record.id),
    revision: record.revision,
    expires_at: record.expires_at,
    record_fingerprint: fingerprint(readBytes(relativePath)),
    binding: "https",
    continuity: "none",
    target_projection: projection,
    target_fingerprint: fingerprint(canonicalJson(projection)),
    selection
  });

  return {
    version: 1,
    protocol: "OPAP/1",
    root_opid: root.id,
    graph: {
      nodes: [
        node(rootPath, root, rootProjection, { option_index: optionIndex, option_projection: splitProjection }),
        node(targetPath, target, targetProjection, { option_index: selectedIndex, option_projection: selectedProjection })
      ],
      edges: [{
        type: "allocation",
        from: root.id,
        option_index: optionIndex,
        allocation_index: split.allocations.findIndex((allocation) => allocation.target),
        to: target.id
      }]
    },
    execution: {
      type: "split",
      source_opid: root.id,
      source_option_index: optionIndex,
      currency: split.currency,
      adapter: split.execution.adapter,
      chain: split.execution.chain,
      asset: split.execution.asset.toLowerCase(),
      contract: split.execution.contract.toLowerCase(),
      config_id: split.execution.config_id.toLowerCase(),
      allocations: compiledAllocations
    }
  };
}

function validatePlanSemantics(plan, label) {
  const schemaValid = validatePlanSchema(plan);
  check(schemaValid, `${label}: schema errors: ${schemaDiagnostics(validatePlanSchema).join(" | ")}`);
  const opids = plan.graph.nodes.map((node) => node.opid);
  check(new Set(opids).size === opids.length, `${label}: duplicate graph OPID`);
  check(plan.graph.nodes[0]?.opid === plan.root_opid, `${label}: root node is not first`);
  for (const node of plan.graph.nodes) {
    check(node.target_fingerprint === fingerprint(canonicalJson(node.target_projection)), `${label}: wrong target fingerprint for ${node.opid}`);
    check((node.continuity === "none") === !("origin_key" in node), `${label}: origin_key presence conflicts with continuity for ${node.opid}`);
  }
  for (const edge of plan.graph.edges) {
    check(opids.includes(edge.from) && opids.includes(edge.to), `${label}: edge refers to an unknown node`);
    check(edge.from !== edge.to, `${label}: self-referencing graph edge`);
  }
  check(plan.graph.edges.length === plan.graph.nodes.length - 1, `${label}: graph is not a rooted tree`);
  for (const opid of opids.slice(1)) {
    check(plan.graph.edges.filter((edge) => edge.to === opid).length === 1, `${label}: non-root node does not have exactly one incoming edge: ${opid}`);
  }
  const sourceNode = plan.graph.nodes.find((node) => node.opid === plan.execution.source_opid);
  check(Boolean(sourceNode), `${label}: execution source is not in graph`);
  check(sourceNode?.selection?.option_index === plan.execution.source_option_index, `${label}: execution source index differs from graph selection`);
  if (plan.execution.type === "split") {
    check(plan.execution.allocations.reduce((sum, allocation) => sum + allocation.share_ppm, 0) === 1_000_000, `${label}: compiled shares do not sum to 1000000`);
    const recipients = plan.execution.allocations.map((allocation) => allocation.recipient.toLowerCase());
    check(new Set(recipients).size === recipients.length, `${label}: compiled recipients are not unique`);
  }
}

function ipv4Integer(address) {
  return address.split(".").reduce((result, part) => (result << 8n) | BigInt(Number(part)), 0n);
}

function inIpv4Range(address, base, prefix) {
  const shift = 32n - BigInt(prefix);
  return (ipv4Integer(address) >> shift) === (ipv4Integer(base) >> shift);
}

const forbiddenIpv4 = [
  ["0.0.0.0", 8], ["10.0.0.0", 8], ["100.64.0.0", 10], ["127.0.0.0", 8],
  ["169.254.0.0", 16], ["172.16.0.0", 12], ["192.0.0.0", 24], ["192.0.2.0", 24],
  ["192.88.99.0", 24], ["192.168.0.0", 16], ["198.18.0.0", 15], ["198.51.100.0", 24], ["203.0.113.0", 24],
  ["224.0.0.0", 4], ["240.0.0.0", 4]
];

function ipv6Integer(address) {
  let source = address.toLowerCase();
  const embeddedIpv4 = source.match(/(?:^|:)(\d{1,3}(?:\.\d{1,3}){3})$/u)?.[1];
  if (embeddedIpv4) {
    const value = ipv4Integer(embeddedIpv4);
    source = `${source.slice(0, source.length - embeddedIpv4.length)}${(value >> 16n).toString(16)}:${(value & 0xffffn).toString(16)}`;
  }
  const [left, right] = source.split("::");
  const leftParts = left ? left.split(":") : [];
  const rightParts = right ? right.split(":") : [];
  const missing = 8 - leftParts.length - rightParts.length;
  const parts = source.includes("::") ? [...leftParts, ...Array(missing).fill("0"), ...rightParts] : leftParts;
  if (parts.length !== 8) throw new Error(`invalid IPv6 address ${address}`);
  return parts.reduce((result, part) => (result << 16n) | BigInt(`0x${part || "0"}`), 0n);
}

function inIpv6Range(value, base, prefix) {
  const shift = 128n - BigInt(prefix);
  return (value >> shift) === (ipv6Integer(base) >> shift);
}

function allowedNetworkAddress(address) {
  const family = net.isIP(address);
  if (family === 4) return !forbiddenIpv4.some(([base, prefix]) => inIpv4Range(address, base, prefix));
  if (family !== 6) return false;
  const value = ipv6Integer(address);
  if ((value >> 32n) === 0xffffn) {
    const mapped = [24n, 16n, 8n, 0n].map((shift) => Number((value >> shift) & 0xffn)).join(".");
    return allowedNetworkAddress(mapped);
  }
  if (inIpv6Range(value, "64:ff9b::", 96)) {
    const translated = [24n, 16n, 8n, 0n].map((shift) => Number((value >> shift) & 0xffn)).join(".");
    return allowedNetworkAddress(translated);
  }
  if (!inIpv6Range(value, "2000::", 3)) return false;
  const forbidden = [["2001:2::", 48], ["2001:20::", 28], ["2001:db8::", 32], ["3fff::", 20]];
  return !forbidden.some(([base, prefix]) => inIpv6Range(value, base, prefix));
}

function runRecordFixtures() {
  const manifest = readJson("conformance/records/manifest.json");
  for (const fixture of manifest.valid) {
    const result = inspectRecord(`conformance/records/${fixture.file}`, fixture.expectedOpid);
    check(!result.error, `${fixture.file}: expected valid, got ${result.error}: ${(result.diagnostics ?? []).join(" | ")}`);
  }
  for (const fixture of manifest.invalid) {
    const result = inspectRecord(`conformance/records/${fixture.file}`, fixture.expectedOpid);
    check(result.error === fixture.expectedError, `${fixture.file}: expected ${fixture.expectedError}, got ${result.error ?? "valid"}`);
    if (fixture.diagnosticIncludes) {
      check(result.diagnostics.some((diagnostic) => diagnostic.includes(fixture.diagnosticIncludes)), `${fixture.file}: missing diagnostic ${fixture.diagnosticIncludes}: ${result.diagnostics.join(" | ")}`);
    }
  }
}

function runJsonSyntax() {
  const intentionalDuplicate = "conformance/records/invalid/duplicate-key.json";
  for (const relativePath of [...jsonFiles("schema"), ...jsonFiles("conformance")]) {
    if (relativePath === intentionalDuplicate) continue;
    try {
      readJson(relativePath);
      check(true, `${relativePath}: valid JSON syntax`);
    } catch (error) {
      check(false, `${relativePath}: ${error.message}`);
    }
  }
}

function runDocumentationLinks() {
  const markdownFiles = [
    "README.md",
    "CONTRIBUTING.md",
    "SECURITY.md",
    ...fs.readdirSync(path.join(repoRoot, "specification"))
      .filter((file) => file.endsWith(".md"))
      .map((file) => `specification/${file}`)
  ];
  const linkPattern = /\[[^\]]*\]\(([^)]+)\)/gu;
  for (const markdownPath of markdownFiles) {
    const markdown = readText(markdownPath);
    for (const match of markdown.matchAll(linkPattern)) {
      const destination = match[1].trim().replace(/^<|>$/gu, "");
      if (/^(?:https?:|mailto:|#)/u.test(destination)) continue;
      const localPath = decodeURIComponent(destination.split("#", 1)[0]);
      const resolved = path.resolve(repoRoot, path.dirname(markdownPath), localPath);
      check(resolved.startsWith(`${repoRoot}${path.sep}`) && fs.existsSync(resolved), `${markdownPath}: broken local link ${destination}`);
    }
  }
}

function delegationResult(start, records, active = [], visited = new Set()) {
  if (active.includes(start)) return "resolution_cycle";
  if (visited.has(start)) return "duplicate_opid";
  const record = records.get(start);
  if (!record) return "record_not_found";
  visited.add(start);
  if (record.payment.type !== "delegate") return "terminal";
  return delegationResult(record.payment.target, records, [...active, start], visited);
}

function runSplitFixtures() {
  const manifest = readJson("conformance/split-resolution/manifest.json");
  const base = "conformance/split-resolution";
  const success = manifest.scenarios.find((scenario) => scenario.id === "compatible-opid-target");
  const rootPath = path.posix.normalize(`${base}/${manifest.rootRecord}`);
  const targetPath = `${base}/${success.records[0]}`;
  const actualPlan = buildCompatiblePlan(rootPath, targetPath);
  const expectedPlanPath = path.posix.normalize(`${base}/${success.expectedPlan}`);
  const expectedPlan = readJson(expectedPlanPath);
  validatePlanSemantics(expectedPlan, success.id);
  check(canonicalJson(actualPlan) === canonicalJson(expectedPlan), `${success.id}: compiled plan differs from exact vector`);
  check(fingerprint(canonicalJson(actualPlan)) === success.expectedPlanFingerprint, `${success.id}: plan fingerprint mismatch`);
  check(canonicalJson(actualPlan.execution.allocations) === canonicalJson(success.expectedAllocations), `${success.id}: compiled allocations mismatch`);
  check(actualPlan.graph.nodes[1].selection.option_index === success.expectedSelectedOptionIndex, `${success.id}: selected option index mismatch`);

  const workflowState = structuredClone(expectedPlan);
  workflowState.settlement_status = "pending";
  check(!validatePlanSchema(workflowState), "execution-plan schema accepted settlement workflow state");
  const multipleExecutions = structuredClone(expectedPlan);
  multipleExecutions.execution = [expectedPlan.execution, expectedPlan.execution];
  check(!validatePlanSchema(multipleExecutions), "execution-plan schema accepted multiple executor invocations");

  const split = readJson(rootPath).payment.options[0];
  const compatible = readJson(targetPath);
  const matches = (option) => option.type === "erc20" && option.currency === split.currency && option.chain === split.execution.chain && option.asset.toLowerCase() === split.execution.asset.toLowerCase();
  const incompatible = readJson(`${base}/targets/alice-incompatible.json`);
  check(!incompatible.payment.options.some(matches), "incompatible-target-options: compatible option found");
  const nested = readJson(`${base}/targets/alice-nested-split.json`);
  check(nested.payment.options.some((option) => option.type === "split" && option.currency === split.currency && option.execution.chain === split.execution.chain && option.execution.asset.toLowerCase() === split.execution.asset.toLowerCase()), "nested-split-unsupported: matching nested split missing");
  const collisionScenario = manifest.scenarios.find((scenario) => scenario.id === "post-compilation-recipient-collision");
  let collisionError;
  try {
    buildCompatiblePlan(rootPath, `${base}/${collisionScenario.records[0]}`);
  } catch (error) {
    collisionError = error.message;
  }
  check(collisionError === collisionScenario.expectedError, `post-compilation-recipient-collision: expected ${collisionScenario.expectedError}, got ${collisionError ?? "success"}`);

  const splitBearingScenario = manifest.scenarios.find((scenario) => scenario.id === "compatible-target-with-unselected-split");
  const splitBearingPlan = buildCompatiblePlan(rootPath, `${base}/${splitBearingScenario.records[0]}`);
  const splitBearingNode = splitBearingPlan.graph.nodes[1];
  check(splitBearingNode.selection.option_index === splitBearingScenario.expectedSelectedOptionIndex, "compatible-target-with-unselected-split: wrong selected option");
  check(splitBearingNode.target_projection.options.every((option) => option !== null), "compatible-target-with-unselected-split: projection contains null");
  check(splitBearingNode.target_projection.options.some((option) => option.type === "split"), "compatible-target-with-unselected-split: split missing from projection");
  check(splitBearingNode.target_fingerprint === splitBearingScenario.expectedTargetFingerprint, `compatible-target-with-unselected-split: expected ${splitBearingScenario.expectedTargetFingerprint}, got ${splitBearingNode.target_fingerprint}`);
  const refreshed = readJson(`${base}/targets/alice-compatible-refreshed.json`);
  check(canonicalJson(compatible.payment) === canonicalJson(refreshed.payment), "freshness-only-target-refresh: target projection changed");
  check(fingerprint(readBytes(targetPath)) !== fingerprint(readBytes(`${base}/targets/alice-compatible-refreshed.json`)), "freshness-only-target-refresh: record fingerprint did not change");
  const changed = readJson(`${base}/targets/alice-compatible-changed.json`);
  check(canonicalJson(compatible.payment) !== canonicalJson(changed.payment), "target-changed-before-execution: target projection did not change");

  const cycleScenario = manifest.scenarios.find((scenario) => scenario.id === "delegation-cycle");
  const cycleRecords = new Map(cycleScenario.records.map((relativePath) => {
    const record = readJson(`${base}/${relativePath}`);
    return [record.id, record];
  }));
  check(delegationResult("https://alice.example/", cycleRecords) === cycleScenario.expectedError, "delegation-cycle: wrong traversal result");
  const unavailable = manifest.scenarios.find((scenario) => scenario.id === "unavailable-target");
  check(unavailable.records.length === 0 && unavailable.fetchResult.status === 404 && unavailable.expectedError === "record_not_found", "unavailable-target: malformed scenario");

  for (const targetFile of jsonFiles(`${base}/targets`)) {
    const targetRecord = readJson(targetFile);
    const result = inspectRecord(targetFile, targetRecord.id);
    check(!result.error, `${targetFile}: target record is invalid: ${(result.diagnostics ?? []).join(" | ")}`);
  }

  for (const scenario of manifest.scenarios) {
    for (const field of ["records", "reviewRecords", "executionRecords"]) {
      for (const relativePath of scenario[field] ?? []) check(fs.existsSync(path.join(repoRoot, base, relativePath)), `${scenario.id}: missing ${relativePath}`);
    }
  }
}

function runLimitFixtures() {
  const vectors = readJson("conformance/split-resolution/limits.json");
  check(recordSchema.$defs.splitPaymentOption.properties.allocations.maxItems === vectors.limits.allocation_targets_per_split, "record schema split fan-out differs from the normative limit vector");
  check(planSchema.$defs.resolutionGraph.properties.nodes.maxItems === vectors.limits.distinct_opids, "execution-plan graph size differs from the normative limit vector");
  check(planSchema.$defs.splitExecution.properties.allocations.maxItems === vectors.limits.terminal_leaves_per_split, "execution-plan split size differs from the normative limit vector");
  for (const vector of vectors.cases) {
    const accepted = vector.value <= vectors.limits[vector.metric];
    check(accepted === Boolean(vector.expectedAccepted), `${vector.id}: boundary result mismatch`);
    if (!accepted) check(vector.expectedError === "resolution_limit_exceeded", `${vector.id}: wrong error`);
  }
}

function runNetworkFixtures() {
  const vectors = readJson("conformance/split-resolution/network-policy.json");
  for (const vector of vectors.cases) {
    const accepted = vector.resolutionAttempts.every((addresses) => addresses.length > 0 && addresses.every(allowedNetworkAddress));
    check(accepted === Boolean(vector.expectedAccepted), `${vector.id}: network-policy result mismatch`);
    if (!accepted) check(vector.expectedError === "target_address_forbidden", `${vector.id}: wrong error`);
  }
}

runJsonSyntax();
runDocumentationLinks();
runRecordFixtures();
runSplitFixtures();
runLimitFixtures();
runNetworkFixtures();

if (failures.length > 0) {
  for (const failure of failures) console.error(`FAIL ${failure}`);
  console.error(`\n${failures.length} of ${checks} conformance checks failed.`);
  process.exitCode = 1;
} else {
  console.log(`All ${checks} conformance checks passed.`);
}
