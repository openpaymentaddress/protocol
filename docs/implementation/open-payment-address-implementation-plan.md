# Archived legacy reference-stack plan

> **Historical archive:** this plan describes the superseded page-association
> profile. It is retained for migration evidence only and is not active OPAP/1
> implementation guidance.

**Plan version:** 2.2

**Date:** 20 July 2026

**Protocol baseline:** OPAP/1, document revision 1.8

**Status:** superseded by the URL-identity implementation

> **Document role:** implementation plan for the standalone OPAP reference stack. The page-association extension and its Phase 3–7 closeout are specified in the [canonical page-association plan](../../OPAP_PAGE_ASSOCIATION_IMPLEMENTATION_PLAN.md), which supersedes older single-schema or OPID-only milestone wording here. This document does not own the Browser Payer UX, wallet execution, split-contract deployment, Monerium integration or Azure hosting. Those belong to the [Browser Payer final plan](../design/open-payment-address-azure-demonstrator.md).

## 1. Objective

Deliver a replaceable, provider-neutral reference implementation of OPAP/1 that independent publishers, resolvers and payer applications can use to prove interoperability.

The reference stack must prove this path:

```text
Publish a canonical OPAP Record
        ↓
Optionally select an OPID from a DNS-signaled page association
        ↓
Resolve the selected or direct OPID through canonical HTTPS discovery
        ↓
Validate bytes, schema, semantics, transport and optional DNSSEC trust
        ↓
Resolve direct, delegate or split instructions within protocol limits
        ↓
Produce an immutable execution plan
        ↓
Return the plan to a consuming application
```

The reference stack stops at the application boundary. It never holds funds, connects an end-user wallet, selects a commercial provider or claims settlement.

## 2. Product boundary

| Layer | Owns | Must not own |
|---|---|---|
| OPAP specification | Wire behavior, required validation, errors and conforming roles | Product UI, provider policy or hosting |
| Normative schemas | OPAP Record and site-association structural shapes | Runtime behavior not expressible in JSON Schema |
| Conformance suite | Portable compatibility evidence | Application-specific tests |
| `opap-core` | Pure protocol parsing, validation, trust transitions and plans | Network, filesystem, DOM, wallet or cloud code |
| `opap-runtime` | HTTPS, DoH and bounded resolution orchestration | Product presentation or transaction signing |
| `opap-cli` | Publisher and resolver reference commands | Hosted service behavior |
| Browser Payer | URL interpretation, UI, wallet and supported payment execution | Changes to OPAP semantics |

Authority points downward from the specification. Implementations may be replaced; the protocol contract remains stable.

## 3. Repository architecture

```text
apps/opap-cli ───────┐
                     ├──> packages/opap-runtime ──> packages/opap-core ──> schema
apps/opap-demo ──────┘

conformance ─────────────> public core and runtime behavior
```

Production import rules:

- applications may depend on the `opap-runtime` public facade;
- runtime may depend on `opap-core`;
- core may depend only on the authoritative schemas and pure libraries;
- core may not import network, browser, filesystem, wallet, UI or provider SDK code;
- neither core nor runtime may depend on the Browser Payer; and
- no production dependency cycle is allowed.

## 4. Component responsibilities

### `packages/opap-core`

Owns deterministic, side-effect-free protocol behavior:

- OPID and IDNA normalization;
- duplicate-aware JSON parsing and byte limits;
- JSON Schema and semantic validation;
- trust-record grammar and fingerprint comparison;
- direct, delegate and split state models;
- loop, depth, record and resource limits;
- verification-history transitions;
- protocol error taxonomy;
- immutable execution plans; and
- integer-only share and amount calculations required by OPAP.

The same input bytes and policy inputs must always produce the same result.

### `packages/opap-runtime`

Owns I/O at the edge:

- canonical HTTPS discovery;
- credential-free browser CORS requirements;
- media type, encoding, redirect, timeout and size enforcement;
- DNSSEC-validating DNS-over-HTTPS;
- bounded delegation orchestration;
- pre-execution re-resolution support; and
- translation of external failures into protocol errors.

Runtime never invents a fallback destination and never scrapes arbitrary HTML.

### `apps/opap-cli`

Owns reference tooling:

```text
opap record validate <file>
opap record hash <file>
opap publish check <opid>
opap resolve <opid>
opap dns rotation-plan <current-hash> <new-file> --ttl <seconds>
```

The CLI may store local verification history using atomic file replacement. It stores no payment credentials, private keys or bearer tokens.

### `apps/opap-demo`

This path is the consuming Browser Payer application. Its Eleventy/Tailwind UI, ordered settlement-currency selection and payer-side funding routes are governed exclusively by the Browser Payer plan.

The reference-stack plan requires only that the app consume public package boundaries and that browser and CLI resolution agree. It does not use the application to define protocol behavior.

### `conformance`

Owns portable evidence:

- valid and invalid OPAP Records;
- malformed bytes and duplicate-key fixtures;
- DNS trust and rotation fixtures;
- transport-policy fixtures;
- resolution and execution-plan fixtures; and
- a coverage map from protocol clauses to tests.

Fixtures must remain usable by independent implementations.

## 5. Current implementation state

### Complete in the repository

- TypeScript workspace and directed dependency boundaries;
- authoritative schemas and schema-copy integrity checks;
- pure OPID, record and trust validation;
- canonical record fingerprinting;
- direct and delegate resolution models;
- ordered, currency-declaring direct handlers and currency-bound asset validation;
- canonical HTTPS runtime;
- strict transport, CORS and encoding checks;
- validating DoH integration;
- bounded resolution orchestration;
- downgrade-safe CLI history;
- publisher validation, hashing and rotation commands; and
- conformance coverage for the implemented surface.

### Still required for the standalone OPAP product

- complete the controlled DNSSEC-bound live OPID criterion;
- publish additional independent-implementation split vectors beyond the current portable fixtures;
- confirm browser and CLI output equivalence for every supported record type;
- publish versioned package/API documentation; and
- document the compatibility and release policy for independent implementers.

### Not part of this product plan

- Monerium onboarding or API tokens;
- EURe acquisition, redemption or settlement observation;
- wallet connection and signing;
- SEPA app handoff UX;
- split-contract source, audit or deployment;
- QR scanning, PWA installation and local payment history;
- Azure infrastructure; and
- application accounts or hosted publishing.

## 6. Delivery milestones

### Milestone 0 — conformance foundation

**Status:** complete for the implemented surface; coverage grows with later protocol work.

Exit criteria:

- each authoritative schema is loaded from one repository location;
- invalid fixtures fail for their intended reason;
- each implemented normative rule has a test owner; and
- CI rejects schema drift and forbidden dependencies.

### Milestone 1 — pure protocol core

**Status:** complete for direct, delegate and split terminal models.

Exit criteria:

- core tests require no network mocks;
- protocol errors are deterministic;
- no I/O dependency enters core; and
- repeated inputs produce identical fingerprints and plans.

### Milestone 2 — runtime, CLI and live publisher

**Status:** repository-owned work complete; external live-domain criterion pending.

Remaining exit criteria:

- one controlled OPID resolves as `dnssec-bound` from both CLI and a browser;
- byte mutation produces `record_hash_mismatch`;
- invalid CORS, compression and redirects fail closed; and
- `sha256`/`next` rotation is exercised against the live publisher.

### Milestone 3 — protocol-level split support

**Status:** complete for provider-neutral parsing, deterministic plans, allocations and runtime adapter verification.

Deliver:

- complete split parsing and semantic validation;
- deterministic `config_id`, recipients and shares in the execution plan;
- 2–16 recipient boundaries;
- exact share-total and rounding fixtures;
- adapter-state comparison contracts at the runtime boundary; and
- typed failure when a consuming payer lacks the named adapter.

This milestone does not deploy a split contract. The Browser Payer plan owns its one concrete EURe adapter and contract.

Exit criteria:

- core accepts conforming split records and rejects invalid records;
- independent fixtures do not contain production provider addresses;
- a split-aware consumer receives a stable plan;
- a non-split-aware resolver can still resolve and report the record safely; and
- no provider or chain becomes an OPAP dependency.

### Milestone 4 — independent implementer release

**Status:** pending.

Deliver:

- package and CLI versioning policy;
- public API documentation;
- independent implementation guide;
- complete conformance coverage report;
- release notes separating protocol, schema, and implementation changes; and
- one interoperability exercise with an independently authored publisher or resolver.

Exit criteria:

- another implementation can use only public documentation and fixtures;
- it produces compatible outcomes for the selected conformance role; and
- no Browser Payer or Azure knowledge is required.

## 7. Test strategy

### Core

- OPID and IDNA normalization;
- duplicate keys, malformed UTF-8, depth and size limits;
- schema and semantic rules;
- required handler settlement currencies and asset-denomination agreement;
- IBAN checksum and ERC-20 address shape;
- trust-record parsing and rotation;
- direct, delegate and split resolution;
- loop and resource limits;
- immutable plan generation; and
- verification-history transitions.

### Runtime

- canonical URL construction;
- CORS and transport enforcement;
- redirect, compression, timeout and body-size failures;
- DNSSEC secure, insecure, bogus and NODATA states;
- exact response-byte hashing; and
- failure mapping with no silent fallback.

### Cross-runtime

- CLI and browser use identical record bytes;
- CLI and browser produce identical fingerprints;
- equivalent policy produces equivalent terminal plans; and
- controlled live publication and rotation work end to end.

### Release checks

```shell
npm run check
```

Browser Payer accessibility, wallet, contract and Chiado tests are additional application checks, not OPAP conformance checks.

## 8. Security and privacy gates

- Treat all records, DNS answers and remote registries as untrusted input.
- Fail closed when trust, semantics or execution identity changes.
- Keep exact destinations visible to the consuming application.
- Store the minimum local verification history needed for downgrade detection.
- Never log full IBANs, wallet addresses or payment amounts by default.
- Never store private keys, wallet seeds, provider tokens or payment credentials.
- Keep provider SDKs and transaction execution outside core and runtime.

## 9. Success criteria

The standalone OPAP product is release-ready when:

1. the specification, both schemas, and both conformance fixture sets agree;
2. direct, delegate and split records have portable fixtures;
3. the reference core and runtime pass all applicable fixtures;
4. one controlled DNSSEC-bound OPID passes publication and rotation checks;
5. browser and CLI resolution agree;
6. independent implementers can identify their conforming role; and
7. no product/provider/cloud dependency is needed to implement OPAP.

## 10. Architecture decision

```text
Subject:        OPAP specification, reference stack and Browser Payer boundaries
Decision:       Split by authority and direction of dependency
Principle:      Provider neutrality, functional core, separation of concerns and replaceability
Evidence:       Protocol/schema/conformance are portable; core/runtime/CLI implement them; Browser Payer adds independent UI and execution policy
Enforcement:    Existing import-boundary lint keeps apps -> runtime -> core; documentation review keeps application decisions out of the specification
Next action:    Complete the controlled live-publisher criterion and independent implementer release material
Verification:   npm run check plus documentation terminology and link checks
```

## 11. Source documents

- [OPAP/1 protocol](../protocol/open-payment-address-protocol-v1.md)
- [Normative OPAP Record schema](../../schema/open-payment-address-v1.schema.json)
- [OPAP functional design](../design/open-payment-address-functional-design-v1.md)
- [Conformance coverage](../../conformance/coverage.md)
- [Milestone 2 operations](milestone-2-operations.md)
- [Browser Payer final plan](../design/open-payment-address-azure-demonstrator.md)
