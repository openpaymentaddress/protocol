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
const evidenceSchema = readJson("schema/open-payment-continuity-evidence-v1.schema.json");
const validateRecordSchema = ajv.compile(recordSchema);
const validatePlanSchema = ajv.compile(planSchema);
const validateEvidenceSchema = ajv.compile(evidenceSchema);

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
    history: "none",
    target_projection: projection,
    target_fingerprint: fingerprint(canonicalJson(projection)),
    selection
  });

  return {
    version: 1,
    protocol: "OPAP/1",
    root_opid: root.id,
    prior_evidence: "none",
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
    check(plan.prior_evidence === "available" || node.history === "none", `${label}: node reports history when prior evidence is none for ${node.opid}`);
    check(plan.prior_evidence === "available" || node.continuity !== "bound", `${label}: node is continuity-bound when prior evidence is none for ${node.opid}`);
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

function compareUtf8(left, right) {
  return Buffer.compare(Buffer.from(left), Buffer.from(right));
}

function strongerBinding(left, right) {
  return left === "dnssec" || right === "dnssec" ? "dnssec" : "https";
}

function keyFingerprint(publicKey) {
  return fingerprint(Buffer.from(publicKey, "base64url"));
}

function transitionMessage(hostname, recoveryCommitment, fromEpoch, fromKey, toEpoch, toKey) {
  return `OPAP/1 KEY TRANSITION\n${hostname}\n${recoveryCommitment}\n${fromEpoch}\n${fromKey}\n${toEpoch}\n${toKey}\n`;
}

function verifyTransition(hostname, recoveryCommitment, fromEpoch, fromKey, next) {
  const spkiPrefix = Buffer.from("302a300506032b6570032100", "hex");
  const publicKey = crypto.createPublicKey({
    key: Buffer.concat([spkiPrefix, Buffer.from(fromKey, "base64url")]),
    format: "der",
    type: "spki"
  });
  return next.epoch === fromEpoch + 1
    && crypto.verify(
      null,
      Buffer.from(transitionMessage(hostname, recoveryCommitment, fromEpoch, fromKey, next.epoch, next.public_key)),
      publicKey,
      Buffer.from(next.transition_signature, "base64url")
    );
}

function sortedUnique(items, identity) {
  const values = items.map(identity);
  return new Set(values).size === values.length
    && values.every((value, index) => index === 0 || compareUtf8(values[index - 1], value) < 0);
}

function evidenceDiagnostics(envelope) {
  const diagnostics = [];
  const valid = validateEvidenceSchema(envelope);
  if (!valid) return schemaDiagnostics(validateEvidenceSchema);
  if (envelope.state !== "available") return diagnostics;
  if (!sortedUnique(envelope.evidence.hosts, (host) => host.hostname)) diagnostics.push("hosts are not unique and sorted");
  if (!sortedUnique(envelope.evidence.opids, (opid) => opid.opid)) diagnostics.push("OPIDs are not unique and sorted");
  const hosts = new Map(envelope.evidence.hosts.map((host) => [host.hostname, host]));
  const usedHostnames = new Set();
  for (const host of envelope.evidence.hosts) {
    if (host.authentication !== "origin-key") continue;
    if (host.key_fingerprint !== keyFingerprint(host.public_key)) diagnostics.push(`wrong key fingerprint for ${host.hostname}`);
    if (host.retired_key_fingerprints.includes(host.key_fingerprint)) diagnostics.push(`current key is retired for ${host.hostname}`);
    if (!sortedUnique(host.retired_key_fingerprints, (value) => value)) diagnostics.push(`retired keys are not unique and sorted for ${host.hostname}`);
    if (host.authenticated_next) {
      if (host.authenticated_next.key_fingerprint !== keyFingerprint(host.authenticated_next.public_key)) diagnostics.push(`wrong successor fingerprint for ${host.hostname}`);
      if (host.authenticated_next.key_fingerprint === host.key_fingerprint
          || host.retired_key_fingerprints.includes(host.authenticated_next.key_fingerprint)) {
        diagnostics.push(`successor is current or retired for ${host.hostname}`);
      }
      try {
        if (!verifyTransition(host.hostname, host.recovery_commitment, host.epoch, host.public_key, host.authenticated_next)) diagnostics.push(`invalid authenticated successor for ${host.hostname}`);
      } catch {
        diagnostics.push(`invalid authenticated successor for ${host.hostname}`);
      }
    }
  }
  for (const opid of envelope.evidence.opids) {
    if (!canonicalOpid(opid.opid)) {
      diagnostics.push(`noncanonical evidence OPID ${opid.opid}`);
      continue;
    }
    if (new URL(opid.opid).hostname !== opid.hostname) diagnostics.push(`OPID hostname mismatch for ${opid.opid}`);
    const host = hosts.get(opid.hostname);
    if (!host) {
      diagnostics.push(`OPID has no host evidence for ${opid.opid}`);
    } else {
      usedHostnames.add(host.hostname);
      if (opid.authentication === "origin-key" && host.authentication !== "origin-key") diagnostics.push(`OPID authentication exceeds host evidence for ${opid.opid}`);
      if (opid.highest_binding === "dnssec" && host.highest_binding !== "dnssec") diagnostics.push(`OPID binding exceeds host evidence for ${opid.opid}`);
    }
    if (opid.target_fingerprint !== fingerprint(canonicalJson(opid.target_projection))) diagnostics.push(`wrong target fingerprint for ${opid.opid}`);
  }
  for (const hostname of hosts.keys()) {
    if (!usedHostnames.has(hostname)) diagnostics.push(`host has no OPID evidence for ${hostname}`);
  }
  return diagnostics;
}

function validateEvidenceSemantics(envelope, label, expectedValid = true) {
  const diagnostics = evidenceDiagnostics(envelope);
  check((diagnostics.length === 0) === expectedValid, `${label}: expected evidence valid=${expectedValid}, got: ${diagnostics.join(" | ") || "valid"}`);
}

function validateCurrentEvidence(current, label) {
  check(sortedUnique(current.hosts, (host) => host.hostname), `${label}: current hosts are not unique and sorted`);
  check(sortedUnique(current.opids, (opid) => opid.opid), `${label}: current OPIDs are not unique and sorted`);
  const hosts = new Map(current.hosts.map((host) => [host.hostname, host]));
  for (const host of current.hosts) {
    check(["https", "dnssec"].includes(host.binding), `${label}: invalid binding for ${host.hostname}`);
    check(["unsigned", "origin-key"].includes(host.authentication), `${label}: invalid authentication for ${host.hostname}`);
    if (host.authentication === "origin-key") {
      check(Number.isSafeInteger(host.epoch) && host.epoch >= 1, `${label}: invalid epoch for ${host.hostname}`);
      check(Buffer.from(host.public_key, "base64url").length === 32, `${label}: invalid public key for ${host.hostname}`);
      if (host.next) check(verifyTransition(host.hostname, host.recovery_commitment, host.epoch, host.public_key, host.next), `${label}: invalid current successor for ${host.hostname}`);
    }
  }
  for (const opid of current.opids) {
    check(canonicalOpid(opid.opid), `${label}: noncanonical current OPID ${opid.opid}`);
    check(new URL(opid.opid).hostname === opid.hostname, `${label}: current OPID hostname mismatch for ${opid.opid}`);
    check(hosts.has(opid.hostname), `${label}: current OPID has no host input for ${opid.opid}`);
    check(hosts.get(opid.hostname)?.binding === opid.binding, `${label}: current OPID binding differs from host for ${opid.opid}`);
    check(hosts.get(opid.hostname)?.authentication === opid.authentication, `${label}: current OPID authentication differs from host for ${opid.opid}`);
    check(opid.target_fingerprint === fingerprint(canonicalJson(opid.target_projection)), `${label}: wrong current target fingerprint for ${opid.opid}`);
  }
}

function proposedHostEvidence(current, prior) {
  if (current.authentication === "unsigned") {
    return {
      hostname: current.hostname,
      highest_binding: strongerBinding(prior?.highest_binding, current.binding),
      authentication: "unsigned"
    };
  }
  const currentFingerprint = keyFingerprint(current.public_key);
  const retired = prior?.authentication === "origin-key"
    ? [...prior.retired_key_fingerprints, ...(prior.key_fingerprint === currentFingerprint ? [] : [prior.key_fingerprint])]
    : [];
  const proposal = {
    hostname: current.hostname,
    highest_binding: strongerBinding(prior?.highest_binding, current.binding),
    authentication: "origin-key",
    epoch: current.epoch,
    public_key: current.public_key,
    key_fingerprint: currentFingerprint,
    recovery_commitment: current.recovery_commitment,
    retired_key_fingerprints: [...new Set(retired)].sort(compareUtf8)
  };
  if (current.next) {
    proposal.authenticated_next = {
      epoch: current.next.epoch,
      public_key: current.next.public_key,
      key_fingerprint: keyFingerprint(current.next.public_key),
      transition_signature: current.next.transition_signature
    };
  } else if (prior?.authentication === "origin-key"
      && prior.key_fingerprint === currentFingerprint
      && prior.authenticated_next) {
    proposal.authenticated_next = structuredClone(prior.authenticated_next);
  }
  return proposal;
}

function proposedOpidEvidence(current, prior) {
  return {
    opid: current.opid,
    hostname: current.hostname,
    revision: current.revision,
    record_fingerprint: current.record_fingerprint,
    target_projection: structuredClone(current.target_projection),
    target_fingerprint: current.target_fingerprint,
    highest_binding: strongerBinding(prior?.highest_binding, current.binding),
    authentication: current.authentication
  };
}

function proposedEnvelope(current, priorEnvelope) {
  const priorHosts = new Map((priorEnvelope.evidence?.hosts ?? []).map((host) => [host.hostname, host]));
  const priorOpids = new Map((priorEnvelope.evidence?.opids ?? []).map((opid) => [opid.opid, opid]));
  return {
    version: 1,
    protocol: "OPAP/1",
    state: "available",
    evidence: {
      hosts: current.hosts.map((host) => proposedHostEvidence(host, priorHosts.get(host.hostname))),
      opids: current.opids.map((opid) => proposedOpidEvidence(opid, priorOpids.get(opid.opid)))
    }
  };
}

function continuityError(reason, priorEvidence, current, exposeChange = false) {
  return {
    result: "error",
    reason,
    ...(exposeChange ? {
      old_evidence: structuredClone(priorEvidence),
      proposed_evidence: proposedEnvelope(current, priorEvidence)
    } : { proposed_evidence: null })
  };
}

function evaluateContinuity(current, priorEvidence) {
  if (priorEvidence?.state === "unavailable") return continuityError("trust_history_unavailable", priorEvidence, current);
  if (evidenceDiagnostics(priorEvidence).length > 0) return continuityError("trust_history_unavailable", priorEvidence, current);
  const priorHosts = new Map((priorEvidence.evidence?.hosts ?? []).map((host) => [host.hostname, host]));
  const priorOpids = new Map((priorEvidence.evidence?.opids ?? []).map((opid) => [opid.opid, opid]));
  const hostContinuity = new Map();

  for (const host of current.hosts) {
    const prior = priorHosts.get(host.hostname);
    if (host.authentication === "unsigned") {
      if (prior?.authentication === "origin-key") return continuityError("identity_key_changed", priorEvidence, current, true);
      hostContinuity.set(host.hostname, "none");
      continue;
    }
    if (!prior || prior.authentication === "unsigned") {
      hostContinuity.set(host.hostname, "first-use");
      continue;
    }
    const currentFingerprint = keyFingerprint(host.public_key);
    if (host.recovery_commitment !== prior.recovery_commitment) {
      return continuityError("identity_key_transition_invalid", priorEvidence, current);
    }
    if (prior.retired_key_fingerprints.includes(currentFingerprint) || host.epoch < prior.epoch) {
      return continuityError("identity_key_rollback", priorEvidence, current);
    }
    if (host.epoch === prior.epoch) {
      if (currentFingerprint !== prior.key_fingerprint) return continuityError("identity_key_changed", priorEvidence, current, true);
      if (host.next && prior.authenticated_next
          && keyFingerprint(host.next.public_key) !== prior.authenticated_next.key_fingerprint) {
        return continuityError("identity_key_transition_invalid", priorEvidence, current);
      }
      hostContinuity.set(host.hostname, "bound");
      continue;
    }
    if (host.epoch !== prior.epoch + 1) return continuityError("identity_key_transition_invalid", priorEvidence, current);
    const staged = prior.authenticated_next;
    const acceptedStaged = staged?.epoch === host.epoch && staged.key_fingerprint === currentFingerprint;
    const acceptedCatchup = host.previous?.epoch === prior.epoch
      && host.previous.public_key === prior.public_key
      && verifyTransition(host.hostname, host.recovery_commitment, host.previous.epoch, host.previous.public_key, {
        epoch: host.epoch,
        public_key: host.public_key,
        transition_signature: host.previous.transition_signature
      });
    if (!acceptedStaged && !acceptedCatchup) return continuityError("identity_key_transition_invalid", priorEvidence, current);
    hostContinuity.set(host.hostname, "bound");
  }

  const nodeResults = [];
  for (const opid of current.opids) {
    const prior = priorOpids.get(opid.opid);
    if (prior) {
      if (opid.revision < prior.revision) return continuityError("record_rollback", priorEvidence, current);
      if (opid.revision === prior.revision && opid.record_fingerprint !== prior.record_fingerprint) {
        return continuityError("record_revision_conflict", priorEvidence, current);
      }
      if (opid.target_fingerprint !== prior.target_fingerprint) {
        return continuityError("payment_target_changed", priorEvidence, current, true);
      }
    }
    nodeResults.push({
      opid: opid.opid,
      history: prior ? "available" : "none",
      continuity: hostContinuity.get(opid.hostname)
    });
  }
  return {
    result: "success",
    node_results: nodeResults,
    proposed_evidence: proposedEnvelope(current, priorEvidence)
  };
}

function runContinuityFixtures() {
  const manifest = readJson("conformance/resolver-state/manifest.json");
  check(manifest.evidenceTransitions === "evidence-transition-vectors.json", "resolver-state manifest does not point to evidence-transition vectors");
  const recordManifestPath = path.posix.normalize(`conformance/resolver-state/${manifest.recordFixtures}`);
  const keyVectorsPath = path.posix.normalize(`conformance/resolver-state/${manifest.keyTransitionVectors}`);
  check(Array.isArray(readJson(recordManifestPath).valid), "resolver-state manifest does not point to record fixtures");
  check(Array.isArray(readJson(keyVectorsPath).transitions), "resolver-state manifest does not point to key-transition vectors");
  const vectors = readJson(`conformance/resolver-state/${manifest.evidenceTransitions}`);
  const availableFixture = vectors.vectors.find((vector) => vector.prior_evidence.state === "available").prior_evidence.evidence;
  check(!validateEvidenceSchema({ version: 1, protocol: "OPAP/1", state: "none", evidence: availableFixture }), "evidence schema accepted data with state none");
  check(!validateEvidenceSchema({ version: 1, protocol: "OPAP/1", state: "available" }), "evidence schema accepted available without a bundle");
  check(!validateEvidenceSchema({ version: 1, protocol: "OPAP/1", state: "unavailable", evidence: availableFixture }), "evidence schema accepted data with state unavailable");
  for (const vector of vectors.vectors) {
    validateEvidenceSemantics(vector.prior_evidence, `${vector.id}: prior`, vector.prior_evidence_valid !== false);
    if (vector.expected.old_evidence) validateEvidenceSemantics(vector.expected.old_evidence, `${vector.id}: expected old`);
    if (vector.expected.proposed_evidence) validateEvidenceSemantics(vector.expected.proposed_evidence, `${vector.id}: expected proposed`);
    validateCurrentEvidence(vector.current, vector.id);
    const inputBefore = canonicalJson(vector.prior_evidence);
    const actual = evaluateContinuity(vector.current, vector.prior_evidence);
    const repeated = evaluateContinuity(vector.current, vector.prior_evidence);
    check(canonicalJson(vector.prior_evidence) === inputBefore, `${vector.id}: evaluator mutated caller-supplied prior evidence`);
    check(canonicalJson(repeated) === canonicalJson(actual), `${vector.id}: repeated pure evaluation was not deterministic`);
    check(canonicalJson(actual) === canonicalJson(vector.expected), `${vector.id}: continuity result differs from exact vector`);
    if (actual.result === "error" && !["identity_key_changed", "payment_target_changed"].includes(actual.reason)) {
      check(actual.proposed_evidence === null, `${vector.id}: ordinary failure proposed replacement evidence`);
    }
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
      .map((file) => `specification/${file}`),
    ...fs.readdirSync(path.join(repoRoot, "howto"))
      .filter((file) => file.endsWith(".md"))
      .map((file) => `howto/${file}`)
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
  const availableHistoryPlan = structuredClone(expectedPlan);
  availableHistoryPlan.prior_evidence = "available";
  for (const node of availableHistoryPlan.graph.nodes) node.history = "available";
  check(validatePlanSchema(availableHistoryPlan), `execution-plan schema rejected available history: ${schemaDiagnostics(validatePlanSchema).join(" | ")}`);
  const hiddenHistoryPlan = structuredClone(expectedPlan);
  hiddenHistoryPlan.graph.nodes[0].history = "available";
  check(!validatePlanSchema(hiddenHistoryPlan), "execution-plan schema accepted available history with prior evidence none");
  const unavailableEvidencePlan = structuredClone(expectedPlan);
  unavailableEvidencePlan.prior_evidence = "unavailable";
  check(!validatePlanSchema(unavailableEvidencePlan), "execution-plan schema accepted unavailable evidence as a successful plan");

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
runContinuityFixtures();
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
