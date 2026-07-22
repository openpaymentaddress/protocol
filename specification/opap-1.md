# Open Payment Address Protocol — OPAP/1

**A URL-native, non-custodial address layer for payments**

Protocol version 1 · 22 July 2026

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

OPAP publishes one of two payment objects:

- ordered alternative Payment Options for the payer to select; or
- a delegation to another HTTPS OPID.

A Payment Option may be a direct rail such as SEPA or ERC-20, an atomic split
across fixed destinations, or a namespaced extension. A split is therefore one
selectable way to satisfy a payment, not a separate top-level routing mode.

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
7. HTTPS-only publication is valid. Origin-key binding and previously
   established key continuity are reported independently; DNSSEC strengthens
   binding but never replaces continuity checks.
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
  "revision": 7,
  "issued_at": "2026-07-22T12:00:00Z",
  "expires_at": "2026-08-21T12:00:00Z",
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

### 6.1 Authenticated publication freshness

`revision` is an integer from 1 through 9,007,199,254,740,991. It is a strict
publication counter for one exact canonical OPID. Every publication, including
a freshness-only re-sign whose destination is unchanged, MUST use a value
strictly greater than every earlier publication. An honest publisher MUST NOT
reuse a revision for different bytes.

`issued_at` and `expires_at` MUST be UTC RFC 3339 timestamps at exact second
precision in the form `YYYY-MM-DDTHH:MM:SSZ`. `expires_at` MUST be later than
`issued_at`. A resolver MUST reject a record before `issued_at` with
`record_not_yet_valid` and at or after `expires_at` with `record_expired`.
The resolver's clock is a security input and SHOULD be obtained from a
reliable, authenticated source.

Expiry bounds the freshness of a publication; it does not independently say
that an account or wallet has been withdrawn. OPAP/1 imposes no universal
maximum validity interval. Publishers SHOULD choose an interval compatible
with protected re-signing, and payer applications MAY require a shorter
interval for high-value, recurring, or unattended payments. Longer intervals
extend replay exposure for a first-time resolver and for a returning resolver
that has not observed a later revision.

### 6.2 Payment options

An `options` object contains one or more ordered alternative Payment Options
for the same economic obligation. Each option names one settlement currency;
an asset is identified by its network and asset identifier, never by symbol
alone. The first supported option is the recipient preference, but the payer
MAY select any supported option. Options MAY use different currencies.

The structurally defined OPAP/1 option types are `sepa`, `erc20`, `split`, and
a namespaced extension type. A resolver MUST retain every valid option when it
computes target continuity. A payer MUST fail closed for any option it cannot
execute, without making other supported options unusable. An `options` array
MUST NOT contain the same recipient-affecting option target more than once.

### 6.3 Delegation

A delegation contains only a canonical HTTPS `target` OPID. It has no local
options. A resolver MAY follow at most eight delegation hops and MUST reject a
loop, a duplicate OPID, or a changed record during payment revalidation.

Product records commonly delegate to a merchant root identity. That avoids
duplicating payment destinations as product pages change.

### 6.4 Atomic split option

A split option is one fixed, atomic payment instruction among the published
alternatives. It MUST have one settlement currency, one network and one asset,
fixed allocations, positive integer `share_ppm` values that sum exactly to
1,000,000, deterministic rounding, and verified contract state. It MUST contain
between two and sixteen allocations. Recipient addresses MUST be unique under
case-insensitive comparison.

Allocation order is execution-significant: integer division is applied to all
but the final allocation and the final allocation receives the remainder. An
implementation MUST NOT reorder allocations. Nested splits are forbidden.

## 7. Binding, continuity, and origin-key epochs

Origin binding and previously established continuity are orthogonal:

```text
binding:    "https" | "dnssec"
continuity: "none" | "first-use" | "bound"
```

- `https/none` is an unsigned HTTPS publication.
- `https/first-use` is a valid proof under an origin key learned from insecure
  DNS when this device has no exact-host pin.
- `https/bound` is a valid proof under the exact-host pin or its authenticated
  successor, with integrity-protected history available.
- `dnssec/first-use` is the equivalent first successful proof with secure
  DNSSEC evidence.
- `dnssec/bound` combines current secure DNSSEC evidence with the pinned
  lineage.

An application MUST display both values and the absence of continuity history.
It MAY require `bound` for high-value, recurring, or unattended payments. It
MUST NOT describe `https/first-use` as protected against origin takeover.

### 7.1 Origin trust record

The optional TXT owner is `_opap.<hostname>`, scoped to that one exact
canonical hostname. Its base form is:

```text
v=opap1;epoch=<n>;ed25519=<current>;rec=ed25519-sha256:<commitment>
v=opap1;epoch=<n>;ed25519=<current>;rec=none
```

`epoch` is an integer from 1 through 9,007,199,254,740,991. Public keys and
signatures use RFC 4648 base64url without padding. An Ed25519 public key is its
raw 32-byte encoding.

For `ed25519-sha256`, let `R` be the raw 32-byte Ed25519 recovery public key.
The commitment bytes are:

```text
SHA-256(UTF8("OPAP/1 RECOVERY KEY\n") || R)
```

`<commitment>` is the unpadded base64url encoding of those 32 digest bytes.
Thus the complete literal value is `ed25519-sha256:<commitment>`. This domain
separator, raw-key encoding, SHA-256 operation, and base64url representation
are fixed by OPAP/1. `rec=none` explicitly forgoes protocol recovery. OPAP/1
commits to a recovery key but does not define recovery authorization.

A staged successor appends:

```text
;next=<next-public-key>;nextsig=<transition-signature>
```

A promoted key MAY retain one-step catch-up evidence:

```text
;previous=<previous-public-key>;previoussig=<transition-signature>
```

Each key/signature pair MUST occur together. Unknown, duplicated, or
out-of-order fields are invalid. The current, next, and previous keys MUST be
distinct where present.

### 7.2 Authenticated transition

The current key signs the exact UTF-8 bytes below, including the final newline:

```text
OPAP/1 KEY TRANSITION
<canonical-hostname>
<recovery-commitment>
<current-epoch>
<current-public-key>
<next-epoch>
<next-public-key>
```

`next-epoch` MUST equal `current-epoch + 1`. `nextsig` is this signature by the
current key. After promotion, `previoussig` is the same signature retained
with the previous key and previous epoch occupying the current fields and the
published key and epoch occupying the next fields.

The recovery commitment is immutable across ordinary transitions and is
authenticated by every transition. A changed or missing commitment is
`identity_key_transition_invalid`. A publisher SHOULD generate the recovery
key offline, store it independently, and never place it on the ordinary
signing machine.

### 7.3 Exact-host continuity algorithm

After the first successful origin-key proof, a resolver atomically creates an
exact-host pin containing the hostname, current epoch and key, immutable
recovery commitment, any authenticated next key, and retired-key
fingerprints. The lookup key MUST be the exact canonical hostname; a public-key
index MAY assist but MUST NOT replace it.

With no existing pin, only a proof under the current `ed25519` key establishes
`first-use`; the `next` key is not trusted merely because it appears in DNS.
This applies identically to secure and insecure TXT records. An unsigned HTTPS
publication creates no pin and has continuity `none`.

With an existing pin, a resolver MUST:

1. accept the pinned epoch and key only when `rec` still matches;
2. authenticate `next` before recording it as the one permitted successor;
3. advance exactly one epoch only when the new key was previously authenticated
   as `next`, or when valid one-step `previous` evidence authenticates it from
   the pinned key;
4. retire the replaced key and reject every later reuse;
5. reject a lower epoch with `identity_key_rollback`, a same-epoch replacement
   or other unauthenticated replacement with `identity_key_changed`, and an
   invalid transition, changed commitment, jump of more than one epoch, or
   unapproved-next proof with `identity_key_transition_invalid`.

DNSSEC validity determines `binding`; it never authorizes key replacement.
Missing more than one retained transition is a recovery event, not permission
to trust the current key. Until recovery authorization is specified,
unauthenticated replacement remains blocked. A missing trust record after a
pin exists is also a continuity failure and MUST NOT fall back to unsigned
HTTPS. DNSSEC-bogus is always `dnssec_bogus`.

### 7.4 Record proof

A signed response includes `OPAP-Proof: v=1;sig=<signature>`. The signature is
made over the exact UTF-8 bytes of:

```text
OPAP/1\n<canonical-opid>\n<lowercase-hex-sha256-of-exact-response-body>
```

The body hash is over the transferred identity-encoded bytes exactly as
received, never JSON reserialization. A resolver verifies only a key authorized
by section 7.3. A missing or invalid required proof is
`record_proof_invalid`; proof, transition, freshness, or history failure MUST
NOT trigger a weaker fallback.

## 8. Normative security history and target continuity

Resolvers maintain two integrity-protected stores. The exact-host pin is
defined in section 7.3. Per canonical OPID, history contains the highest
verified revision, fingerprint at that revision, previously accepted canonical
target fingerprint, and highest binding evidence.

A lower revision is `record_rollback`. Reusing the highest revision with a
different exact-byte fingerprint is `record_revision_conflict`. The same
revision with the same bytes is permitted until expiry. A higher revision is
accepted independently of whether its payment target changed.

Detectable corruption, load failure, or save failure is
`trust_history_unavailable` and blocks resolution. A resolver MUST NOT silently
turn failed or deleted state into first use. A genuinely clean device cannot
always be distinguished from deleted state, so UI MUST say that the device has
no continuity history. Cross-device continuity requires explicit export,
backup, or authenticated sync. Each read/transition/write update across both
stores MUST be atomic.

### 8.1 Canonical target projection

The target projection contains recipient-affecting values only and is encoded
as canonical JSON with object keys lexicographically sorted, no insignificant
whitespace, and arrays handled as follows:

- options: the order-independent set of every option's recipient-affecting
  fields (SEPA currency and IBAN; ERC-20 currency, chain, asset, and recipient;
  split currency, adapter, chain, asset, contract, config ID, and the ordered
  allocation sequence; an extension option's type, currency, and complete
  `data` object);
- a delegated source OPID: the resolved terminal OPID and that terminal
  projection.

Set entries are sorted by their own canonical JSON bytes. The canonical target
fingerprint is `sha256:` followed by lowercase hexadecimal SHA-256 of the UTF-8
canonical JSON bytes.

When this differs from the previously accepted value for any OPID in the
resolution, normal resolution stops with `payment_target_changed`. Continuing
requires a separate confirmation that shows old and proposed targets. It MUST
NOT overwrite key pins or target history as part of ordinary failed
resolution. Recovery from `identity_key_changed` is a separate action showing
old and proposed key fingerprints; OPAP/1 does not authorize it.

## 9. Resolver algorithm

For an OPID supplied by a payer or explicitly selected by the payer:

1. Parse and canonicalise the HTTPS URL; otherwise stop with `invalid_opid`.
2. Derive the canonical record URL from section 4.
3. Fetch only that URL using section 5.
4. Validate transport, JSON, schema, and exact `id` equality.
5. Enforce `issued_at`, `expires_at`, and per-OPID revision history.
6. Query the optional origin trust record; enforce its exact-host pin and proof.
7. Resolve options or delegate semantics within the applicable bounds.
8. Compare and atomically persist key, revision, binding, and target history.
9. Produce an immutable execution plan containing hostname, key fingerprint and
   epoch where applicable, binding, continuity, record revision and expiry,
   exact-byte record fingerprint, and final options.
10. Immediately before execution, repeat the resolution and stop with
   `execution_changed` when recipient-affecting values or trust evidence differ
   from the plan the payer reviewed.

Resolvers MUST NOT crawl links, inspect page HTML, infer a record from an
ordinary URL, or send a speculative lookup without payer intent.

`payment_target_changed` is an across-resolution history decision.
`execution_changed` is a within-payment review-versus-execution decision. They
are distinct and non-overlapping; a flow MAY encounter either or both.

### 9.1 Error codes

In addition to transport, parsing, payment, and resolution errors defined
elsewhere, implementations use: `dnssec_bogus`, `record_not_yet_valid`,
`record_expired`, `record_rollback`, `record_revision_conflict`,
`identity_key_changed`, `identity_key_rollback`,
`identity_key_transition_invalid`, `payment_target_changed`, and
`trust_history_unavailable`.

## 10. Publisher model

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

Where a provider holds the origin key on a recipient's behalf, that provider
controls publication and the payment target for every OPID under that
hostname. `payment_target_changed` protects returning payers against an
undisclosed change; it does not itself give the recipient control of the
signing key. Hosted-publication providers SHOULD disclose whether the origin
key is provider-held or recipient-held. Publisher tooling SHOULD make this
distinction visible when an identity is created. This is an operational
disclosure, not a self-asserted record field.

## 11. Security, privacy, and limitations

The well-known location is an origin-security boundary. Publishers MUST limit
write access to it. Payers and resolvers MUST treat the submitted page and the
record endpoint as different resources and never trust one as content from the
other.

Records, lookup paths, DNS queries, and destination data are public metadata.
Publish only data required to form the payment instruction. A URL path can reveal
a product or invoice identifier; use an opaque URL path when that is not
acceptable. DNSSEC is optional because it adds operator responsibility, not
because it changes the public nature of lookup.

Continuity protects previously established exact-host trust; first use can
still be compromised. Takeover fails closed for a continuity-bound payer, but
denial of service, loss of the hostname, and loss of reachability remain
possible. OPAP/1 does not preserve an address after its hostname is lost.
Compromise of the ordinary signing key remains authoritative until a future
recovery mechanism uses `rec`. Revision history rejects values below the
highest observed, but the exact highest-observed publication can be replayed
until its expiry.

**OPAP/1 converts silent substitution into visible failure for
continuity-bound payers. It does not keep a payment address reachable.**

| Scenario | Payer misdirected | Recipient keeps address |
|---|---|---|
| Web server compromised; signing key held offline | No — bounded replay only | No — denial of service remains possible |
| Web server compromised; signing key co-located | **Yes** | No |
| Hostname lost or repossessed; payer continuity-bound | No — `identity_key_changed` | **No** |
| Hostname lost or repossessed; payer at first use | **Yes** | **No** |

The first row assumes a signed publication, a genuinely isolated key, and a
payer that has observed a sufficiently recent revision. At continuity `none`,
serving-environment compromise is total. A stolen co-located key can authorize
malicious records and transitions. A resolver whose highest observed revision
is R accepts an exact replay of R until it expires.

### 11.1 Independent identity commitment

Publishers SHOULD record the epoch-0 origin public key and exact `rec` value in
at least one location independent of continued control of the OPID hostname,
such as a domain at another registrar, version-controlled repository, key
directory, notarised document, or printed contract. This is an out-of-band
commitment of those two literal values. OPAP/1 defines no resolver discovery or
retrieval mechanism for it and no additional derived fingerprint.

A resolver MUST NOT treat a commitment discovered through the OPID hostname as
independent identity evidence: an attacker controlling the hostname also
controls references published there.

### 11.2 Open problems outside OPAP/1

- **Recipient continuity after hostname loss.** A lost hostname cannot resolve.
  A future per-OPID migration design must bind an exact successor OPID and key,
  define validity, supersession and revocation for clients that miss revisions,
  require separate migration confirmation, and provide discovery for payers
  without cached state. Origin-wide identity is not a substitute because
  takeover detection begins at the exact hostname.
- **First-use assurance.** A payer without history sees only the current
  publication. A future fail-closed `opk` reference can help only when it
  reaches the payer independently. A resolver that cannot verify such a future
  reference must reject it, never silently degrade it; publishers should not
  place one on long-lived printed or public artifacts before support is broad.
  OPAP/1 defines no `opk` syntax.
- **Replay under long validity.** Offline signing encourages longer validity
  while replay bounds encourage shorter validity. A separate freshness
  attestation is a possible future design and is not specified here.
- **Denial of service.** Availability recovery is out of scope.

## 12. Roles

- **Publisher:** controls the OPID hostname and publishes its records.
- **Provider:** optionally operates the publisher service for many publishers
  or resources; it is not made a payment intermediary by OPAP.
- **Resolver:** validates and resolves an OPID into an execution plan.
- **Payer application:** obtains payer intent, displays the plan, and may hand
  it to a bank or wallet. It is responsible for actual payment execution.
