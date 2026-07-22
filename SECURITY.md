# Security policy

## Reporting a vulnerability

Please do not report suspected vulnerabilities in a public issue.

Use GitHub's private vulnerability-reporting feature for this repository. If that route is unavailable, email [opap@patricksavalle.com](mailto:opap@patricksavalle.com) with a concise reproduction, affected version or commit, and impact assessment.

We will acknowledge a report, assess its scope, coordinate a fix where appropriate, and credit reporters who want public acknowledgement.

## Scope

Security-sensitive areas include canonical URL processing, record parsing,
exact-byte hashing, authenticated freshness, DNSSEC binding, exact-host key
pins, epoch transitions, recovery commitments, atomic trust history, target
projection, redirects, CORS and content encoding, bounded delegation, and
execution-plan immutability.

OPAP/1 continuity is trust on first use. It protects only devices that retained
integrity-protected history. It does not preserve reachability after hostname
loss, prevent denial of service, or override a compromised signing key. A
provider-held origin key gives that provider publication authority for every
OPID under the hostname; it is not proof of economic-recipient identity.

This repository does not operate custody, a hosted payment service, a wallet, a payment gateway, a production smart contract, or a payment rail. Reports about a third-party implementation should go to that implementation's maintainer.
