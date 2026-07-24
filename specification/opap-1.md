# Open Payment Address Protocol — OPAP/1

**A URL-native, non-custodial address layer for payments**

Protocol version 1 · 24 July 2026

**Status:** Draft specification.

The key words **MUST**, **MUST NOT**, **SHOULD**, and **MAY** are normative.

## 1. Purpose and scope

OPAP resolves an HTTPS URL into a verified payment instruction. It is a discovery
protocol, not a wallet, payment institution, merchant account, payment router,
settlement network, or product catalogue.

### 1.1 Payment-instruction layer boundary

OPAP is a transport and discovery layer for authenticated payment instructions.
Its responsibility ends when a resolver has produced and immediately
revalidated an immutable execution plan for handoff to an external wallet,
payment rail, or executor.

OPAP implementations MUST NOT hold or pool funds, maintain beneficiary
balances, initiate or schedule settlement, perform currency conversion or
netting, retry or compensate failed payments, reverse completed payments,
allocate refunds or disputes, reconcile settlement, or determine whether an
economic obligation has been fulfilled. Those responsibilities belong to the
external application and settlement systems.

Every executable Payment Option MUST compile to exactly one external executor
invocation under one settlement context. A set of instructions requiring
multiple independent executor invocations is not one atomic OPAP/1 Payment
Option and MUST NOT be described as such. Applications MAY coordinate multiple
OPAP-derived payments, but that coordination, its partial-failure semantics,
and its completion state are outside OPAP/1.

An underlying wallet, contract, bank, or payment rail may have its own custody
and execution model. Describing that external option does not make OPAP a
custodian or executor, and OPAP trust results MUST NOT be presented as an
assurance about the external system's custody, solvency, reversibility, or
settlement outcome.

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
across terminal addresses or stable OPIDs, or a namespaced extension. A split
is therefore one selectable way to satisfy a payment, not a separate top-level
routing mode.

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
released. The initial registration status is provisional. The change
controller is the Open Payment Address protocol project.

The registration applies only to the `https` scheme on its default port 443.
The registered name is a non-empty RFC 3986 path segment. The required
`record/<path-key>` suffix is additional path syntax defined by OPAP/1; it is
not itself a registry name. OPAP/1 defines no representation at
`/.well-known/open-payment` itself, and a record URL has no query or fragment.
Sections 4.1, 5, and 6 define hostname selection and scope, the HTTPS retrieval
profile, the representation, and its permitted media types.

The reviewed registration request and its RFC 8615 conformance analysis are in
[`open-payment-well-known-registration.md`](open-payment-well-known-registration.md).

## 5. Transport profile

A publisher MUST serve a valid record with status `200`, without a redirect,
and at least these headers:

```http
Access-Control-Allow-Origin: *
Access-Control-Expose-Headers: Content-Encoding, OPAP-Proof, X-Content-Type-Options
Cache-Control: no-store
Content-Encoding: identity
Content-Type: application/opap+json
X-Content-Type-Options: nosniff
```

`application/json` with parameters is also permitted. The publisher MUST NOT
require cookies, HTTP authentication, client certificates, or other credentials,
MUST NOT use ambient request credentials to select or vary a record, and MUST
NOT send `Access-Control-Allow-Credentials: true`. Record paths are read-only;
a publisher MUST NOT assign state-changing semantics to any HTTP method at
those paths.

The resolver MUST retrieve a record with HTTPS `GET`, validate TLS, request
without credentials, require status `200`, reject redirects, require a
permitted media type, explicit `Content-Encoding: identity`, and
`X-Content-Type-Options: nosniff`, reject duplicate JSON keys, and reject a
body larger than 65,536 bytes or deeper than 32 JSON nesting levels. Each
request MUST time out within ten seconds.

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
extend replay exposure when no applicable revision evidence is supplied and
when supplied evidence does not contain a later revision.

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

A split option is one logical allocation instruction that compiles into one
fixed, atomic execution plan among the published alternatives. It MUST have one
settlement currency, one network and one asset, ordered logical allocations,
positive integer `share_ppm` values that sum exactly to 1,000,000,
deterministic rounding, and verified contract state. It MUST contain between
two and sixteen allocations. Each allocation contains `share_ppm` and exactly
one of:

- `recipient`, a terminal EVM address; or
- `target`, a canonical HTTPS OPID to resolve under the split settlement
  context.

The settlement profile is the split's `currency` plus the execution `type`,
`adapter`, `chain`, and `asset`. Target matching uses the fields a terminal
option can publish: its type MUST be `erc20`, and its currency, chain, and asset
MUST exactly equal the split profile. `adapter`, `contract`, and `config_id`
remain properties of the root split executor and are not inherited from or
matched against a target record. Address comparison is case-insensitive. After
bounded delegation, the resolver MUST select the first matching option in the
target's published option order, replace the logical target with that option's
terminal `recipient` in the compiled plan, and preserve the root allocation's
position and `share_ppm`. The target publisher therefore controls which of its
compatible terminal addresses is selected through its published option order,
subject to normal continuity and change confirmation; the root split publisher
continues to control the settlement profile, allocation order, and shares.

If a target is unavailable, malformed, untrusted, stale, or otherwise fails
normal OPID resolution, the underlying fail-closed error applies. If it has no
compatible terminal option but contains a split that matches the settlement
context, resolution stops with `nested_split_unsupported`. If it has neither,
resolution stops with `split_target_incompatible`.
OPAP/1 does not flatten nested splits and a resolver MUST NOT treat a split
contract, SEPA destination, extension option, or other incompatible option as a
terminal allocation. A failure of an unselected split option does not invalidate
other independently executable options in the root record; selecting or
executing that split still fails closed and MUST NOT produce a partial payment.

Before target resolution, terminal `recipient` values MUST be unique under
case-insensitive comparison and `target` values MUST be unique as canonical
OPIDs. After compilation, every terminal recipient MUST again be unique under
case-insensitive comparison. A resolver MUST stop with
`split_recipient_collision` rather than merge duplicate terminal recipients or
their shares.

Graph resolution and allocation compilation are pure protocol operations and
MUST NOT call a concrete executor. After compilation, the configured adapter
MUST separately verify before review and again before execution that
`(chain, asset, contract, config_id)` is active and will execute the compiled
ordered allocation list; a mismatch is `split_config_mismatch`.

Allocation order is execution-significant. For an amount expressed as a
non-negative integer number of the asset's atomic units, allocations other than
the final one receive `floor(amount * share_ppm / 1000000)`, computed with exact
integer arithmetic. The final allocation receives the original amount minus
the sum of all earlier results. An implementation MUST NOT reorder allocations.

### 6.5 Bounded payment graph resolution

Delegation and OPID-targeted allocations form one directed graph whose node
identity is the exact canonical OPID. A resolver MUST process root options in
published order, allocation targets in allocation order, and delegation edges
in encounter order. It MAY fetch independent nodes concurrently, but observable
selection and error precedence MUST be the same as depth-first traversal in
that order.

One resolution, including the payer-supplied root, MUST enforce all of these
limits:

- at most eight OPID edges on any path;
- at most 128 distinct OPIDs;
- at most sixteen outgoing allocation targets from one split option;
- at most eight simultaneous graph-record fetches;
- at most 8,388,608 aggregate fetched record-body bytes;
- at most thirty seconds total wall-clock resolution time; and
- at most 256 compiled terminal allocation leaves across all root alternatives,
  with at most sixteen in any one executable split.

The per-response size and timeout limits in section 5 also apply. Exceeding any
graph bound is `resolution_limit_exceeded`. Implementations MAY apply lower
limits only as explicit payer policy and MUST NOT claim conformance for a graph
that is within the bounds above but rejected solely by an undocumented limit.

The traversal maintains both the active path and a global visited set.
Encountering an OPID already on the active path is `resolution_cycle`;
encountering one that was visited on another path is `duplicate_opid`. These
checks occur before a cached result is reused. Thus cycles and convergent
duplicate targets fail in a deterministic position rather than being silently
coalesced.

Every graph hostname is publisher-controlled input and MUST be treated as an
untrusted network destination. Before each connection attempt, the resolver
MUST resolve the hostname and reject the node with `target_address_forbidden`
if any candidate address is loopback, private-use, link-local, carrier-grade
NAT/shared, unspecified, documentation-only, benchmarking, multicast, reserved,
or an IPv4-mapped form of such an IPv6 address. An IP-literal hostname is
subject to the same test. An IPv4-embedded translation address, including the
well-known NAT64 prefix, is permitted only when its embedded IPv4 destination
passes the same test. Implementations SHOULD derive special-purpose ranges from
the current IANA IPv4 and IPv6 Special-Purpose Address Registries rather than
assume that a syntactically public-looking address is globally reachable.

The resolver MUST connect only to an allowed address from that validated answer
set while retaining the canonical hostname for TLS verification. It MUST NOT
follow redirects, accept a certificate for the connected address in place of
the hostname, or use an ambient proxy that can bypass the same destination
policy. A retry performs a new resolution and the complete address test again.
These requirements prevent DNS rebinding and server-side request forgery from
turning publisher-supplied delegation or allocation targets into access to the
resolver's local or privileged networks.

### 6.6 Compatibility

An allocation with `recipient` retains its existing OPAP/1 meaning and needs no
migration. An allocation with `target` is an additive OPAP/1 record form; an
older resolver using the earlier draft schema will reject the record as invalid
rather than misdirect it. Publishers that require compatibility with such
resolvers SHOULD continue publishing terminal-address allocations until target
support is available to their payer population. OPAP/1 remains a draft, so this
change retains `version: 1`; after version 1 is stable, an incompatible schema
change requires explicit protocol-version negotiation.

`config_id` remains an adapter-defined identifier owned by the root split. It
does not come from a target record and its syntax is unchanged. Existing fixed
address configurations compile to the published allocation list. Configurations
using OPID targets compile to the resolved terminal list and are executable only
when adapter verification confirms that exact result, as required above.

## 7. Binding, continuity, and origin-key epochs

Origin binding and previously established continuity are orthogonal:

```text
prior evidence: "none" | "available" | "unavailable"
binding:        "https" | "dnssec"
continuity:     "none" | "first-use" | "bound"
history:        "none" | "available"
```

- `https/none` is an unsigned HTTPS publication.
- `https/first-use` is a valid proof under an origin key learned from insecure
  DNS when the caller supplied no applicable host evidence.
- `https/bound` is a valid proof under the origin key or authenticated
  successor in caller-supplied host evidence.
- `dnssec/first-use` is the equivalent first successful proof with secure
  DNSSEC evidence.
- `dnssec/bound` combines current secure DNSSEC evidence with the supplied
  lineage.

`history` reports whether an applicable prior OPID entry was compared. It is
independent of `continuity`: an OPID first encountered on a hostname with
supplied host evidence can be `bound` with history `none`.

An application MUST display binding, continuity, and the absence of applicable
OPID history. It MAY require `bound` and history `available` for high-value,
recurring, or unattended payments. It MUST NOT describe `https/first-use` or
history `none` as protected against the corresponding cross-resolution attack.

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

### 7.3 Exact-host continuity transition

Exact-host continuity is a pure comparison over current validated trust
material and the applicable host entry in caller-supplied prior evidence. The
resolver MUST NOT open, own, or write a continuity store. The host lookup key
is the exact canonical hostname; a public-key index cannot substitute for it.

With prior-evidence state `none`, or with no entry for a newly encountered
hostname in an `available` bundle, only a proof under the current `ed25519` key
establishes `first-use`; the `next` key is not trusted merely because it appears
in DNS. This applies identically to secure and insecure TXT records. An
unsigned HTTPS publication has continuity `none`.

With an applicable origin-key host entry, the evaluator MUST:

1. accept the supplied epoch and key only when `rec` still matches;
2. authenticate `next` before including it as the one permitted successor in
   proposed evidence;
3. advance exactly one epoch only when the new key was authenticated as
   `authenticated_next` in the supplied evidence, or when valid one-step
   `previous` evidence authenticates it from the supplied current key;
4. add the replaced key fingerprint to `retired_key_fingerprints` in proposed
   evidence and reject every later reuse;
5. reject a lower epoch or retired-key reuse with `identity_key_rollback`, a
   same-epoch replacement or other unauthenticated replacement with
   `identity_key_changed`, and an invalid transition, changed commitment, jump
   of more than one epoch, or unapproved-next proof with
   `identity_key_transition_invalid`.

Prior-evidence state `unavailable` stops evaluation with
`trust_history_unavailable`. A caller that expected an entry but could not load
or validate it MUST use `unavailable`; it MUST NOT omit the entry or translate
the failure to `none`.

DNSSEC validity determines `binding`; it never authorizes key replacement.
Missing more than one retained transition is a recovery event, not permission
to trust the current key. Until recovery authorization is specified,
unauthenticated replacement remains blocked. A missing trust record after a
supplied origin-key entry is `identity_key_changed` and MUST NOT fall back to
unsigned HTTPS. DNSSEC-bogus is always `dnssec_bogus`.

On success, the evaluator includes a deterministic host entry in proposed next
evidence. It does not persist or implicitly accept that proposal.

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

## 8. Portable continuity evidence and target continuity

Core OPAP owns no storage. It defines a portable evidence envelope,
deterministic comparison rules, proposed next evidence, and reason codes.
Callers decide whether and how to persist, synchronize, encrypt, discard, or
decline to provide evidence. Storage availability, concurrency, backup, and
commit atomicity are application responsibilities and are not resolver
conformance requirements.

Given identical current publication bytes, trust material, current time, payer
policy, and prior evidence, conforming evaluators MUST produce the same
continuity result, protocol reason code, and proposed next evidence.

### 8.1 Prior-evidence input and portable schema

Each resolution has exactly one logical prior-evidence input:

- `none`: the caller has no prior evidence for this resolution. Current
  publication validity is evaluated, but no cross-resolution protection is
  claimed.
- `available`: the caller supplies a validated evidence bundle. Every
  applicable host and OPID entry triggers the comparisons in sections 7.3,
  8.2, and 8.3. An omitted entry means that canonical identity was not
  previously evidenced by this bundle.
- `unavailable`: the caller expected evidence but could not load or validate
  it. Resolution fails closed with `trust_history_unavailable`.

A clean process, command-line tool, private session, or deliberately stateless
caller can conform using `none`; provisioning durable storage is not required.
An application that promised continuity MUST NOT convert missing, corrupt, or
unverifiable expected evidence to `none`.

The normative JSON representation is
`schema/open-payment-continuity-evidence-v1.schema.json`. Its envelope contains
`version: 1`, `protocol: "OPAP/1"`, and `state`. Only `available` carries an
`evidence` bundle. That bundle contains:

- `hosts`, unique entries sorted by ascending UTF-8 bytes of exact canonical
  `hostname`. An unsigned entry carries `highest_binding` and
  `authentication: "unsigned"`. An origin-key entry additionally carries the
  current `epoch`, raw `public_key`, its `key_fingerprint`, immutable
  `recovery_commitment`, sorted retired-key fingerprints, and any
  `authenticated_next` epoch, key, fingerprint, and transition signature.
- `opids`, unique entries sorted by ascending UTF-8 bytes of canonical `opid`.
  Each carries its exact `hostname`, highest accepted `revision`, exact-byte
  `record_fingerprint`, complete canonical `target_projection` and
  `target_fingerprint`, `highest_binding`, and strongest accepted
  `authentication`.

The key fingerprint is `sha256:` followed by lowercase hexadecimal SHA-256 of
the raw 32-byte Ed25519 public key. Record and target fingerprints use the same
prefix and hexadecimal representation; their respective inputs remain the
exact response body bytes and canonical target-projection bytes.

Before using an `available` envelope, an evaluator MUST validate the schema,
canonical OPIDs and hostname correspondence, deterministic ordering and
uniqueness, key and target fingerprints, transition signatures, and that a
current key is not in its retired set. Failure is
`trust_history_unavailable`, not first use.

An input bundle can contain only entries applicable to the requested
resolution. Proposed next evidence MUST contain one entry for every distinct
resolved hostname and canonical OPID, in the deterministic order above. Thus a
payment graph produces one portable bundle without prescribing a database,
transaction engine, synchronization service, or storage topology.

### 8.2 Revision evaluation

With an applicable OPID entry in `available` prior evidence, a lower revision
is `record_rollback`. Reusing its highest revision with a different exact-byte
fingerprint is `record_revision_conflict`. The same revision with the same
bytes is permitted until expiry. A higher revision passes revision comparison
independently of whether its payment target changed.

With prior evidence `none`, or no applicable OPID entry, the evaluator validates
the current revision's syntax and authenticated publication metadata but MUST
NOT claim cross-resolution rollback detection. Every successful node result
exposes the current revision and reports history `none` or `available`.

### 8.3 Canonical target projection

The target projection contains recipient-affecting values only and is encoded
as canonical JSON with object keys lexicographically sorted, no insignificant
whitespace, and arrays handled as follows:

- options: the order-independent set of every option's recipient-affecting
  fields (SEPA currency and IBAN; ERC-20 currency, chain, asset, and recipient;
  split currency, adapter, chain, asset, contract, config ID, and the ordered
  allocation sequence; an extension option's type, currency, and complete
  `data` object). The ordered split allocation sequence uses exactly these
  logical object shapes before canonical key sorting:

  ```json
  {"recipient":"0x...","share_ppm":600000}
  {"target":"https://alice.example/","share_ppm":400000,"terminal_opid":"https://alice.example/","selected":{"type":"erc20","currency":"EUR","chain":"eip155:100","asset":"0x...","recipient":"0x..."}}
  ```

  `terminal_opid` is the OPID containing the selected option after delegation.
  Hexadecimal EVM addresses and `config_id` values in every projection are
  lowercase. The target OPID's own complete projection and evidence entry are
  also computed independently;
- a delegated source OPID: the resolved terminal OPID and that terminal
  projection.

Set entries are sorted by their own canonical JSON bytes. The canonical target
fingerprint is `sha256:` followed by lowercase hexadecimal SHA-256 of the UTF-8
canonical JSON bytes.

With an applicable OPID entry, a different target fingerprint stops normal
resolution with `payment_target_changed`. With no applicable entry, the target
is currently valid but has no cross-resolution target-change protection.

### 8.4 Proposed next evidence and confirmation

Every successful resolution returns deterministic proposed next evidence
alongside its result. The proposal advances accepted epochs and revisions,
preserves the strongest accepted binding and authentication evidence, retires
replaced keys, and contains the current target projections. The resolver MUST
NOT persist or implicitly accept it.

Continuity comparisons follow proposed-evidence order: hosts by canonical
hostname, then OPIDs by canonical OPID. For one OPID, revision rollback is
checked before same-revision byte conflict, which is checked before target
change. Evaluation stops at the first reason. This ordering is normative when
multiple current inputs would otherwise fail.

Ordinary failed resolution returns no replacement evidence. A change requiring
confirmation—`identity_key_changed` or `payment_target_changed`—returns the
reason, old supplied evidence, and proposed evidence as separate values.
Continuing requires application confirmation that shows the old and proposed
keys or targets. OPAP/1 does not authorize the change or commit the proposal.
Any later evidence commit is an explicit application action and is neither
payment execution nor custody.

## 9. Resolver algorithm

For an OPID supplied by a payer or explicitly selected by the payer, current
time and trust material, payer policy, and one prior-evidence input:

1. If prior evidence is `unavailable`, stop with
   `trust_history_unavailable`; validate an `available` envelope as section 8.1.
2. Parse and canonicalise the HTTPS URL; otherwise stop with `invalid_opid`.
3. Derive the canonical record URL from section 4.
4. Fetch only that URL using section 5.
5. Validate transport, JSON, schema, exact `id` equality, `issued_at`, and
   `expires_at`.
6. Query the optional origin trust record; validate its proof and apply the
   exact-host transition in section 7.3 to supplied host evidence when present.
7. Resolve options, delegation, and OPID-targeted allocations within the
   applicable bounds, independently of any concrete payment executor.
8. Apply revision and target comparisons to supplied OPID evidence. Do not
   mutate the input or persist a result.
9. Produce an immutable execution plan containing hostname, key fingerprint and
   epoch where applicable, binding, continuity, record revision and expiry,
   exact-byte record fingerprint, and final options. For a payment graph this
   evidence is included for the root and every resolved OPID in deterministic
   traversal order, together with each target projection, selected option, and
   compiled terminal allocation.
10. Return the plan plus deterministic proposed next evidence from section
    8.4. The caller may explicitly commit that proposal after accepting the
    resolution.
11. Immediately before execution, re-resolve the complete graph using the same
    prior-evidence input and revalidate
    every record and the adapter configuration. Compare graph node and edge
    identity, trust results, target projections, selected options, and compiled
    allocations with the immutable plan. Stop with `execution_changed` on any
    difference in those recipient-affecting or trust values. A newer valid
    revision, expiry, or exact-byte record fingerprint is retained as separate
    revalidation evidence but does not alone change the reviewed execution when
    its trust result and target projection are unchanged.

Resolvers MUST NOT crawl links, inspect page HTML, infer a record from an
ordinary URL, or send a speculative lookup without payer intent.

`payment_target_changed` is an across-resolution history decision.
`execution_changed` is a within-payment review-versus-execution decision. They
are distinct and non-overlapping; a flow MAY encounter either or both.
Immediate review-to-execution re-resolution does not create or commit
cross-resolution evidence.

Graph resolution and plan compilation MUST produce data, not perform payment
execution. A concrete executor consumes only a reviewed, immutable, immediately
revalidated plan. A plan MUST be described as an atomic split only when every
compiled leaf shares the one settlement context and the adapter verifies one
atomic execution. A mixed SEPA/blockchain or cross-network batch is never an
atomic OPAP/1 split.

### 9.1 Immutable execution plan

One selected Payment Option is encoded using the normative OPAP/1 Execution
Plan schema at `schema/open-payment-execution-plan-v1.schema.json`. The plan
contains:

- `version`, `protocol`, and the payer-supplied canonical `root_opid`;
- the successful input state as `prior_evidence`, which is `none` or
  `available` (`unavailable` cannot produce a plan);
- a graph whose evidence nodes are in deterministic depth-first traversal order
  and whose edges are in deterministic encounter order; and
- exactly one `execution` object for one external executor invocation.

Each evidence node contains the canonical OPID, hostname, derived record URL,
record revision and expiry, exact-byte record fingerprint, binding, continuity,
applicable-history status, origin-key fingerprint and epoch where applicable,
complete target projection and fingerprint, and the selected option projection
where that node supplies an executable option. Graph OPIDs MUST be unique. A
node with continuity `none` MUST omit `origin_key`; a node with continuity
`first-use` or `bound` MUST include it. History `available` requires input
state `available`; continuity `bound` requires applicable host evidence but
does not require prior OPID history.

Proposed next evidence is returned alongside the plan using the section 8.1
schema. It is not embedded in the plan and is not part of the plan fingerprint.

Every EVM address and `config_id` in a plan is lowercase. The plan is encoded
as canonical JSON using the rules in section 8.3. Its plan fingerprint is
`sha256:` followed by lowercase hexadecimal SHA-256 of those UTF-8 canonical
JSON bytes. The fingerprint is carried alongside the immutable plan and is not
embedded in the hashed object.

The execution-plan schema intentionally leaves `target_projection` and
`option_projection` structurally open so namespaced Payment Options can retain
their complete recipient-affecting data. Schema validation alone does not
establish projection correctness. A conforming resolver MUST construct both
objects from already validated records using section 8.3 and MUST verify each
`target_fingerprint` against the canonical target projection.

Amount and economic context remain application data under section 1. A payer
application MUST bind its reviewed amount, asset quantity, invoice or order
reference, and the OPAP plan fingerprint in its own immutable authorization
object. They MUST NOT be inserted into the OPAP plan or inferred by the
resolver.

### 9.2 External adapter boundary

Split graph resolution and allocation compilation finish before adapter
validation. The adapter receives only the selected adapter identifier,
settlement currency, chain, asset, contract, opaque `config_id`, and compiled
ordered terminal allocations. It MUST either confirm that one external
invocation will execute that exact instruction or fail closed. It MUST NOT
rewrite, reorder, merge, add, or remove allocations.

`config_id` is an opaque 32-byte identifier whose interpretation belongs to
the named adapter. Adapter validation MUST authenticate the relevant external
configuration and establish that it is active for the exact compiled plan.
Unknown adapters are unsupported options; a known adapter whose configuration
does not match fails with `split_config_mismatch`. Validation does not execute,
schedule, sign, custody, or settle a payment.

### 9.3 Error codes

In addition to transport, parsing, payment, and resolution errors defined
elsewhere, implementations use: `dnssec_bogus`, `record_not_yet_valid`,
`record_expired`, `record_rollback`, `record_revision_conflict`,
`identity_key_changed`, `identity_key_rollback`,
`identity_key_transition_invalid`, `payment_target_changed`, and
`trust_history_unavailable`. Split graph resolution additionally uses
`split_target_incompatible`, `nested_split_unsupported`,
`split_config_mismatch`, `resolution_limit_exceeded`, `resolution_cycle`, and
`duplicate_opid`. A collision between terminal recipients discovered only
after target compilation uses `split_recipient_collision`. A graph hostname
resolving to a forbidden network destination uses
`target_address_forbidden`.

`trust_history_unavailable` applies only when the caller reports unavailable
expected evidence or an `available` envelope fails validation.
`identity_key_changed`, `identity_key_rollback`,
`identity_key_transition_invalid`, `record_rollback`,
`record_revision_conflict`, and `payment_target_changed` apply when the
corresponding supplied evidence makes the comparison possible. They remain
portable protocol results; application policy and storage choices do not
redefine them.

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
hostname. `payment_target_changed` protects callers that supply applicable
OPID evidence against an undisclosed change; it does not itself give the
recipient control of the signing key. Hosted-publication providers SHOULD
disclose whether the origin key is provider-held or recipient-held. Publisher
tooling SHOULD make this distinction visible when an identity is created. This
is an operational disclosure, not a self-asserted record field.

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

The record endpoint is intentionally accessible to browsers and CORS-readable.
Scripts running elsewhere on the same origin may request it, so publishers
MUST keep the endpoint read-only, credential-independent, and free of secrets.
Operators MUST inventory and protect the route even when their server,
deployment tool, or filesystem hides names beginning with a dot; the
`.well-known` name is not an access-control mechanism.

When suitable `available` prior evidence is supplied, continuity protects
previously established exact-host trust; first use and resolutions with
`none` can still be compromised. Takeover fails closed for a
continuity-bound payer, but denial of service, loss of the hostname, and loss
of reachability remain possible. OPAP/1 does not preserve an address after its
hostname is lost. Compromise of the ordinary signing key remains authoritative
until a future recovery mechanism uses `rec`. Supplied revision evidence
rejects values below its highest accepted revision, but that exact publication
can be replayed until expiry.

**OPAP/1 converts silent substitution into visible failure for
continuity-bound payers. It does not keep a payment address reachable.**

| Scenario | Payer misdirected | Recipient keeps address |
|---|---|---|
| Web server compromised; signing key held offline | No — bounded replay only | No — denial of service remains possible |
| Web server compromised; signing key co-located | **Yes** | No |
| Hostname lost or repossessed; suitable prior evidence supplied | No — `identity_key_changed` | **No** |
| Hostname lost or repossessed; prior evidence `none` | **Yes** | **No** |

The first row assumes a signed publication, a genuinely isolated key, and a
caller that supplied evidence for a sufficiently recent revision. With prior
evidence `none`, serving-environment compromise is total. A stolen co-located
key can authorize malicious records and transitions. An evaluator supplied
with highest accepted revision R accepts an exact replay of R until it expires.

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
- **First-use assurance.** A payer using `none` or without applicable evidence
  sees only the current publication. A future fail-closed `opk` reference can
  help only when it
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
- **Resolver:** validates and resolves an OPID into an execution plan and
  proposed next evidence without owning storage.
- **Payer application:** obtains payer intent, supplies or declines prior
  evidence, displays the plan, may explicitly retain proposed evidence, and
  may hand the plan to a bank or wallet. It owns any evidence storage and is
  responsible for actual payment execution.
