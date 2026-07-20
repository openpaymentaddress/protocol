# OPAP/1 documentation map

The repository is organized around one rule: the specification defines protocol behavior; schemas and fixtures make it testable; reference code implements it without becoming the authority.

## Normative sources

| Source | Role |
| --- | --- |
| [English specification](protocol/open-payment-address-protocol-v1.en.md) | Normative OPAP/1 source in English |
| [Dutch specification](protocol/open-payment-address-protocol-v1.md) | Normative OPAP/1 source in Dutch; maintained with the English text |
| [OPAP Record schema](../schema/open-payment-address-v1.schema.json) | Normative structural contract |
| [Conformance records](../conformance/records) | Portable valid and invalid test vectors |

If a conflict appears, the two specification texts govern semantics; the schema governs structural validation; conformance fixtures supply executable evidence. Design and implementation documents are informative.

## Informative sources

| Source | Role |
| --- | --- |
| [Functional design](design/open-payment-address-functional-design-v1.md) | Plain-language explanation of the URL-identity model |
| [Publisher and resolver operations](implementation/milestone-2-operations.md) | Publishing, DNSSEC and rotation procedure |

## Reference implementation

- [`@opap/core`](../packages/opap-core) contains pure protocol behavior.
- [`@opap/runtime`](../packages/opap-runtime) owns HTTPS, DNS-over-HTTPS and bounded resolution I/O.
- [`@opap/cli`](../apps/opap-cli) provides reference validation, hashing, publication checking and resolution commands.

The reference implementation is deliberately replaceable. A conforming implementation may use another language, architecture, user interface, payment rail, hosting provider, or execution environment.
