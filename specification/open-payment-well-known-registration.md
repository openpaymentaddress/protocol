# `open-payment` well-known URI registration

**Status:** Draft registration request; reviewed against RFC 8615 sections 3
and 4 on 24 July 2026. This document does not claim that the request has been
submitted or approved.

## Registration request

- **URI suffix:** `open-payment`
- **Change controller:** Open Payment Address protocol project
  ([project site](https://openpaymentaddress.org/),
  [GitHub organisation](https://github.com/openpaymentaddress))
- **Specification document:** [Open Payment Address Protocol — OPAP/1,
  sections 4–6 and 11](https://github.com/openpaymentaddress/protocol/blob/main/specification/opap-1.md)
- **Status:** provisional
- **Related information:** OPAP maps a canonical HTTPS URL, called an OPID, to
  a same-origin payment-instruction record. The well-known URI uses only the
  `https` scheme and its default port 443. Its complete path is
  `/.well-known/open-payment/record/<path-key>`, where `<path-key>` is the
  unpadded RFC 4648 base64url encoding of the UTF-8 bytes of the canonical
  OPID path, including its leading slash. The base
  `/.well-known/open-payment` URI has no defined representation. Query and
  fragment components are forbidden.

Dereferencing a record uses an unauthenticated HTTPS `GET`. A successful
response is UTF-8 JSON without a byte-order mark and uses
`application/opap+json`, or the OPAP/1 `application/json` compatibility
profile. OPAP/1 defines response headers, size and nesting limits, timeouts,
redirect rejection, exact-origin scope, record authentication, bounded graph
resolution, and DNS-rebinding and server-side-request-forgery protections.

## RFC 8615 section 3 review

| RFC 8615 requirement | Review |
|---|---|
| Register every new well-known name | `open-payment` is not in the IANA registry as checked on 24 July 2026. OPAP/1 section 4.2 requires registration before release. |
| Name conforms to RFC 3986 `segment-nz` and contains no `/` | `open-payment` is one non-empty segment containing only unreserved characters. |
| Name is precise rather than generic | `open-payment` identifies the Open Payment Address protocol and is narrower than a generic name such as `payment`. |
| Specification defines the representation and media types | OPAP/1 sections 5 and 6 define UTF-8 JSON, `application/opap+json`, and the permitted `application/json` compatibility profile. |
| URI scheme and any non-default port are stated | The registration says `https` only and default port 443 only. OPIDs forbid an explicit port. |
| Additional path, query, fragment, and method syntax is defined where used | OPAP/1 section 4 defines `record/<path-key>`. Queries and fragments are forbidden, the base URI has no representation, and section 5 requires HTTPS `GET`. |
| Hostname discovery and metadata scope are defined by the application | The OPID supplies the hostname. OPAP constructs the record URL at the exact same origin, and a record cannot authorise an OPID on another origin. |
| Well-known URI is rooted at the top of the path hierarchy | The only discovery prefix is origin-rooted `/.well-known/open-payment/`; an OPID path is encoded into `<path-key>` rather than prepended to that prefix. |
| Section 3.1 registration fields are present | The request above supplies URI suffix, change controller, specification document, provisional status, and related information. |

## RFC 8615 section 4 review

| RFC 8615 consideration | OPAP/1 treatment |
|---|---|
| Sensitive-data exposure | Sections 5 and 11 make records unauthenticated, credential-independent, and public. Publishers are told to publish only required payment metadata and to use opaque OPID paths when path disclosure is unacceptable. |
| Denial of service | Sections 5 and 6.5 bound response bytes, JSON depth, per-request time, total resolution time, graph size, concurrency, and compiled outputs. Redirects are rejected. |
| Server and client authentication | Section 5 requires HTTPS with TLS validation and forbids cookies, HTTP authentication, client certificates, and credential-dependent variants. Sections 7.3 and 7.4 separately define OPAP record authentication. |
| DNS rebinding and privileged-network access | Section 6.5 requires destination classification after each DNS resolution, connection only to a validated address, hostname-preserving TLS verification, no ambient proxy bypass, and full revalidation on retry. |
| Protecting well-known resources | Section 11 makes the location an origin-security boundary and requires publishers to limit write access. Section 5 makes record paths read-only. |
| Interaction with Web browsing | Sections 5 and 11 acknowledge browser and CORS access, require `X-Content-Type-Options: nosniff`, prohibit credential-dependent representations and state-changing endpoint behavior, and require a non-active JSON media type. |
| Application scope | Sections 4.1 and 11 limit authority to the exact OPID origin. Submitted page content, other hosts, subdomains, and alternative ports do not expand that scope. |
| Hidden capabilities | Section 11 warns operators that dot-prefixed paths may be hidden by tooling and explicitly states that `.well-known` is not access control. |

## Review disposition

The registration text covers the syntax, representation, scheme, default port,
additional path syntax, discovery, scope, and security information requested by
RFC 8615 sections 3 and 4. The requested provisional status is appropriate
while OPAP/1 remains a draft.

Before submission, replace the moving `main` specification link with an
immutable versioned publication URL. The registry's current submission
guidance also asks non-standards projects to demonstrate stable stewardship,
community support, and specification maturity; those submission-readiness
points are separate from this RFC 8615 content review.
