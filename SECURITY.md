# Security policy

## Reporting a vulnerability

Please do not report suspected vulnerabilities in a public issue.

Use GitHub's private vulnerability-reporting feature for this repository. If that route is unavailable, email [opap@patricksavalle.com](mailto:opap@patricksavalle.com) with a concise reproduction, affected version or commit, and impact assessment.

We will acknowledge a report, assess its scope, coordinate a fix where appropriate, and credit reporters who want public acknowledgement.

## Scope

Security-sensitive areas include canonical URL processing, record parsing,
exact-byte hashing, authenticated freshness, DNSSEC binding, exact-host key
continuity transitions, epoch transitions, recovery commitments, portable
prior-evidence validation, deterministic proposed evidence, target projection,
redirects, CORS and content encoding, bounded delegation, and execution-plan
immutability.

OPAP/1 continuity is a pure evaluation over current publication and trust
inputs plus caller-supplied prior evidence. With `available` evidence it can
protect previously established key lineage, revision, and payment targets.
Explicit `none` is conforming but provides no cross-resolution protection;
`unavailable` fails closed when expected evidence cannot be loaded or
validated. Core OPAP never owns or writes a continuity store. It does not
preserve reachability after hostname loss, prevent denial of service, or
override a compromised signing key. A provider-held origin key gives that
provider publication authority for every OPID under the hostname; it is not
proof of economic-recipient identity.

This repository does not operate custody, a hosted payment service, a wallet, a payment gateway, a production smart contract, or a payment rail. Reports about a third-party implementation should go to that implementation's maintainer.
