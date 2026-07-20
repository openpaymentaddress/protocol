# Open Payment Address Protocol — OPAP/1

**A URL-native, non-custodial address layer for payments**

Protocol version 1 · 20 July 2026

**Status:** Draft specification.

The key words **MUST**, **MUST NOT**, **SHOULD**, and **MAY** are normative.

## 1. Purpose and scope

OPAP resolves an HTTPS URL into a verified payment instruction. It is a discovery
protocol, not a wallet, payment institution, merchant account, payment router,
settlement network, or product catalogue.

Examples of OPIDs:

```text
https://customer.opid.provider/
https://customer.opid.provider/product/1223
https://merchant.example/invoice/2026-001
```

The URL is the stable payment identity. A product page may retain its ordinary
HTML behaviour for browsers, but an OPAP Resolver never retrieves that page. It
retrieves only the deterministic well-known OPAP Record for the URL.

OPAP publishes one of three payment objects:

- a direct recipient with ordered alternative Payment Handlers;
- a delegation to another HTTPS OPID; or
- an atomic split across fixed destinations.

Amount, tax, product description, inventory, delivery, expiry, invoice status,
and settlement status are application-level data. They are not inferred from a
web page and are not OPAP/1 semantics.

## 2. Core decisions

1. An OPID is one canonical HTTPS URL, not an email-like identifier.
2. Its path may identify a person, organisation, product, invoice, account, or other payable resource.
3. One same-origin OPAP Record is the only payment-content source.
4. The resolver never fetches or parses the supplied OPID page.
5. Discovery uses the origin-rooted RFC 8615 namespace
   `/.well-known/open-payment/`.
6. A provider may serve any number of identities with one generic endpoint.
7. HTTPS-only publication is valid. A DNSSEC-bound origin signing key is an
   optional stronger verification profile.
8. The protocol never controls money, private keys, accounts, or payment
   execution.

## 3. OPID syntax and canonical form

An OPID is an absolute HTTPS URL with this constrained form:

```text
https://<hostname>/<path>
```

The hostname MUST be converted to lowercase IDNA2008 ASCII A-label form. The
port MUST be absent; HTTPS port 443 is implicit. User information, query, and
fragment components are forbidden.

The path is `/` or one or more non-empty segments. A segment uses RFC 3986
unreserved characters and uppercase UTF-8 percent encodings. Empty segments,
dot segments, encoded solidus or reverse solidus, percent-encoded unreserved characters, and a
trailing slash on a non-root path are invalid. A canonical OPID MUST be no more
than 512 ASCII characters.

For example, these inputs are invalid rather than aliases:

```text
http://shop.example/product/1223
https://shop.example/product/../invoice
https://shop.example/product//1223
https://shop.example/product/1223/
https://shop.example/product/1223?campaign=mail
```

The canonical root identity is written with `/`:

```text
https://customer.opid.provider/
```

Implementations MUST show the canonical OPID in review UI. They MAY omit the
root slash only for display when doing so cannot change copyable value.

## 4. Record discovery

### 4.1 Canonical record URL

Let `path-key` be unpadded base64url encoding of the UTF-8 bytes of the
canonical OPID path, including its leading slash. The canonical OPAP Record URL
is:

```text
https://<hostname>/.well-known/open-payment/record/<path-key>
```

Example:

```text
OPID:       https://customer.opid.provider/product/1223
Path:       /product/1223
Path key:   L3Byb2R1Y3QvMTIyMw
Record URL: https://customer.opid.provider/.well-known/open-payment/record/L3Byb2R1Y3QvMTIyMw
```

The path key for `/` is `Lw`.

The resolver MUST construct this URL itself and MUST NOT use a record location
advertised by page HTML, a redirect, DNS, a query parameter, or a cache entry.
The record URL has the same origin as the OPID. A record on one host MUST NOT
authorise an OPID on another host.

### 4.2 RFC 8615 registration

`open-payment` is the application name relative to `/.well-known/` and MUST
be registered in the IANA Well-Known URI Registry when this specification is
released. `record/<path-key>` is additional path syntax defined by OPAP/1; it
is not itself a registry name.

## 5. Transport profile

A publisher MUST serve a valid record with status `200`, without a redirect,
and at least these headers:

```http
Access-Control-Allow-Origin: *
Access-Control-Expose-Headers: Content-Encoding, OPAP-Proof
Cache-Control: no-store
Content-Encoding: identity
Content-Type: application/opap+json
```

`application/json` with parameters is also permitted. The publisher MUST NOT
require cookies, HTTP authentication, client certificates, or other credentials,
and MUST NOT send `Access-Control-Allow-Credentials: true`.

The resolver MUST use HTTPS, validate TLS, request without credentials, require
status `200`, reject redirects, require a permitted media type and explicit
`Content-Encoding: identity`, reject duplicate JSON keys, and reject a body
larger than 65,536 bytes or deeper than 32 JSON nesting levels. Each request
MUST time out within ten seconds.

`404` or `410` is `record_not_found`; other transport failures are
`record_unavailable`; an invalid `200` response is `invalid_record`.

## 6. OPAP Record

The OPAP Record is UTF-8 JSON without a byte-order mark. Its `id` is the exact
canonical OPID used for discovery.

```json
{
  "version": 1,
  "id": "https://customer.opid.provider/product/1223",
  "name": "Product 1223",
  "payment": {
    "type": "delegate",
    "target": "https://customer.opid.provider/"
  }
}
```

The record schema defines `version`, `id`, optional display information, and
exactly one `payment` object. It MUST reject unknown top-level members unless a
future OPAP/1 revision expressly permits them.

### 6.1 Direct payment

A direct object contains one or more ordered alternative Payment Handlers for
the same economic recipient. Each executable handler names a settlement
currency; an asset is identified by its network and asset identifier, never by
symbol alone. The first supported handler is the recipient preference.

### 6.2 Delegation

A delegation contains only a canonical HTTPS `target` OPID. It has no local
methods. A resolver MAY follow at most eight delegation hops and MUST reject a
loop, a duplicate OPID, or a changed record during payment revalidation.

Product records commonly delegate to a merchant root identity. That avoids
duplicating payment destinations as product pages change.

### 6.3 Atomic split

A split is one fixed, atomic payment instruction. It MUST have one settlement
network and one asset, fixed recipients, positive integer shares, deterministic
rounding, and verified contract state. Nested splits are forbidden.

## 7. Verification levels

OPAP/1 defines two verification levels:

- `https-only`: valid HTTPS transport and a valid OPAP Record;
- `dnssec-key-bound`: valid HTTPS, a secure DNSSEC origin key, and a valid
  record proof made by that key.

An application MAY require `dnssec-key-bound` by local policy. It MUST display
the achieved level and MUST remember the highest level previously used for each
canonical OPID. A normal payment MUST stop with `verification_downgrade` when a
previously key-bound OPID resolves only as `https-only`. Recovery requires an
explicit separate user action.

### 7.1 DNSSEC origin key

The optional TXT owner is:

```text
_opap.<hostname>
```

The secure TXT record has exactly one of these forms:

```text
v=opap1;ed25519=<base64url-public-key>
v=opap1;ed25519=<base64url-public-key>;next=<base64url-public-key>
```

The two keys MUST differ. The DNSSEC key applies only to OPIDs on its exact
hostname, not to parent, child, or sibling hosts. An insecure, absent, or
unavailable DNS key never supplies payment content and yields `https-only`.
A malformed secure record is `invalid_trust_record`; bogus DNSSEC is
`dnssec_bogus`.

### 7.2 Record proof

A key-bound response includes `OPAP-Proof`:

```text
OPAP-Proof: v=1;sig=<base64url-ed25519-signature>
```

The signature is made over the UTF-8 bytes of:

```text
OPAP/1\n<canonical-opid>\n<lowercase-hex-sha256-of-exact-response-body>
```

The resolver verifies the signature with the active `ed25519` key or, during
rotation, `next`. It MUST calculate the hash over the transferred
identity-encoded response body exactly as received. The proof header MUST be
CORS exposed. A missing or invalid proof when a secure key is present is
`record_proof_invalid`.

### 7.3 Key rotation

To rotate, a publisher publishes `next`, waits at least the old DNS TTL, begins
signing with the new key, waits at least that TTL again, then promotes `next` to
`ed25519`. A publisher MUST NOT remove the secure key as a normal rollback.

## 8. Resolver algorithm

For an OPID supplied by a payer or explicitly selected by the payer:

1. Parse and canonicalise the HTTPS URL; otherwise stop with `invalid_opid`.
2. Derive the canonical record URL from section 4.
3. Fetch only that URL using section 5.
4. Validate transport, JSON, schema, and exact `id` equality.
5. Query the optional origin DNS key and verify its proof when securely present.
6. Resolve direct, delegate, or split semantics within the applicable bounds.
7. Produce an immutable execution plan that includes OPID, record URL,
   verification level, record fingerprints, and final payment handlers.
8. Immediately before execution, repeat the resolution and stop with
   `execution_changed` if any recipient-affecting value differs.

Resolvers MUST NOT crawl links, inspect page HTML, infer a record from an
ordinary URL, or send a speculative lookup without payer intent.

## 9. Publisher model

A provider may serve a single generic route:

```text
/.well-known/open-payment/record/*
```

It decodes `path-key`, validates the resulting canonical path, and looks up the
`(hostname, path)` pair in its data store. No static site-wide manifest, one
script per customer, or one DNS content hash per path is required.

A content-management or commerce plugin can implement this route and return a
record derived from a person, account, invoice, product, or shop configuration.
A static site may emit the individual record files at build time. A host unable
to expose the root well-known path cannot publish OPAP Records for that origin.

## 10. Security and privacy

The well-known location is an origin-security boundary. Publishers MUST limit
write access to it. Payers and resolvers MUST treat the submitted page and the
record endpoint as different resources and never trust one as content from the
other.

Records, lookup paths, DNS queries, and destination data are public metadata.
Publish only data required to form the payment instruction. A URL path can reveal
a product or invoice identifier; use an opaque URL path when that is not
acceptable. DNSSEC is optional because it adds operator responsibility, not
because it changes the public nature of lookup.

## 11. Roles

- **Publisher:** controls the OPID hostname and publishes its records.
- **Provider:** optionally operates the publisher service for many publishers
  or resources; it is not made a payment intermediary by OPAP.
- **Resolver:** validates and resolves an OPID into an execution plan.
- **Payer application:** obtains payer intent, displays the plan, and may hand
  it to a bank or wallet. It is responsible for actual payment execution.
