# OPAP/1 URL-identity conformance coverage

This evidence covers the implemented URL-identity profile only. Live DNSSEC
publication and IANA registration remain external release work.

| Invariant | Evidence |
| --- | --- |
| Canonical HTTPS root and path OPIDs; rejected aliases | `packages/opap-core/test/opid.test.ts` |
| Deterministic same-origin path-key record locations | `opid.test.ts`, `packages/opap-runtime/test/discovery.test.ts` |
| Exact record ID, UTF-8, duplicate-key, size and nesting limits | `record.test.ts`, `conformance/records/` |
| Direct, delegation, split, loops and bounds | `resolution.test.ts`, conformance fixtures |
| Credential-free CORS, identity encoding, media type, no redirects and status mapping | `packages/opap-runtime/test/https.test.ts` |
| Origin-specific DNSSEC Ed25519 active/next key proof | `packages/opap-core/test/trust.test.ts`, `packages/opap-runtime/test/resolve.test.ts` |
| Verification downgrade and execution-plan re-resolution | `verification.test.ts`, `execution-plan.test.ts` |
| Browser URL-only input and no submitted-page fetch | `payment-input.test.ts`, `apps/opap-demo/e2e/payer.spec.ts` |

No page association, tagged identity, bare-domain shorthand, label JSON route,
or per-record DNS content-hash behavior is claimed by this coverage.
