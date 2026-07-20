# OPAP/1 URL identity requirements

**Status:** agreed design input for the OPAP/1 URL-identity rewrite
**Date:** 20 July 2026
**Scope:** protocol and publication model; not a hosted-provider product implementation

## Decision record

**Subject:** Replace the `label@domain` OPID syntax and DNS-signalled page
association with an HTTPS URL identity model.

**Decision:** Proceed with a clean OPAP/1 cut-over. A URL, including its path,
is the OPID. The resolver derives a record URL below the same origin's
`/.well-known/open-payment/` namespace and never fetches the submitted page.

**Problem:** A provider, product site, or blog needs to publish payment
identities that people can use as ordinary URLs. The existing email-shaped
notation invites email confusion. Mapping pages to tagged identities through
one association document would make a provider maintain a large, rotating
path-to-identity manifest.

**Compatibility decision:** This is intentionally incompatible with the
earlier tag-based OPAP/1 documents, schemas, fixtures, and reference runtime.
Those materials are legacy implementation evidence until they are migrated.
Keeping the name OPAP/1 is a product decision, not wire compatibility. If old
and new deployments must interoperate, the URL identity profile must instead
receive a new protocol major version.

## Actors and outcomes

| Actor                | Situation                                                                      | Required outcome                                                                                              |
| -------------------- | ------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------- |
| Publisher            | Publishes a payment identity for a site, tenant, product, invoice, or donation | Publishes one authoritative record without bespoke resolver logic                                             |
| Provider             | Hosts many customers and resources                                             | Serves records through one generic, data-driven service rather than per-customer scripts or a global manifest |
| Product or CMS owner | Wants a product or blog URL to be payable                                      | Uses a conventional root-level publishing endpoint, directly or through a plugin                              |
| Payer                | Supplies or selects a payment URL                                              | Resolves a payment plan without fetching or scraping the page                                                 |
| Resolver             | Receives an OPID                                                               | Derives exactly one same-origin record location and fails safely on invalid publication                       |

## Requirements

### Identity and usability

| ID  | Requirement                                                                                    | Priority | Completion evidence                                                                       |
| --- | ---------------------------------------------------------------------------------------------- | -------- | ----------------------------------------------------------------------------------------- |
| R1  | An OPID is a canonical HTTPS URL, not an email-shaped identifier.                              | Must     | `https://customer.opid.provider/product/1223` is accepted as an OPID.                     |
| R2  | The same URL form is suitable for links, browser input, QR payloads, invoices, and speech.     | Must     | No `@` syntax is required in normal publisher or payer flows.                             |
| R3  | A path can identify a product, invoice, donation, or other resource.                           | Must     | A resolver can distinguish the root URL from `/product/1223`.                             |
| R4  | Product, tax, stock, delivery, description, amount, and expiry are not inferred from the page. | Must     | Resolving a URL makes no request to the submitted page and only consumes the OPAP Record. |

### Discovery and deployment

| ID  | Requirement                                                                                                              | Priority | Completion evidence                                                                                   |
| --- | ------------------------------------------------------------------------------------------------------------------------ | -------- | ----------------------------------------------------------------------------------------------------- |
| R5  | Every valid OPID deterministically maps to one record URL under the same HTTPS origin.                                   | Must     | Independent resolvers construct the same lookup URL from the same canonical OPID.                     |
| R6  | Discovery uses a root-level RFC 8615 well-known location.                                                                | Must     | All record URLs begin `/.well-known/open-payment/`; no nested `.well-known` path is used.             |
| R7  | A provider can publish unlimited tenants and paths with one generic route backed by data.                                | Must     | A catch-all record route can serve two different tenants without code changes.                        |
| R8  | A CMS or product site can publish a root record or path records through a plugin or static build.                        | Must     | One endpoint rule or generated file set is sufficient; no site-wide association manifest is required. |
| R9  | The protocol does not require a DNS record, script, or static configuration file per customer merely to route a request. | Must     | A dynamic provider can resolve a path from the request key and its data store.                        |

### Safety and integrity

| ID  | Requirement                                                                                                                                                 | Priority | Completion evidence                                                                       |
| --- | ----------------------------------------------------------------------------------------------------------------------------------------------------------- | -------- | ----------------------------------------------------------------------------------------- |
| R10 | URL syntax and canonicalisation prevent two spellings from silently naming different payment identities.                                                    | Must     | Invalid credentials, query, fragment, dot segments, and ambiguous encodings are rejected. |
| R11 | A returned record binds itself to the requested OPID.                                                                                                       | Must     | The resolver rejects an `id` other than the canonical URL it requested.                   |
| R12 | The resolver never follows redirects or substitutes page, DNS, or cached data for the current record.                                                       | Must     | Transport and revalidation tests reject each substitution.                                |
| R13 | Browser publication is public and credential-free, with CORS, a protocol media type, identity encoding, response limits, and fresh payment-time resolution. | Must     | A browser resolver can read a compliant record and rejects a non-compliant response.      |
| R14 | Strong optional integrity verification scales by origin rather than requiring one DNS content hash per path.                                                | Must     | One DNSSEC-bound origin key verifies records for two different paths.                     |
| R15 | Verification downgrade is visible and blocks a normal payment until explicitly recovered.                                                                   | Must     | A previously key-bound identity cannot silently continue as HTTPS-only.                   |

### Payment model and boundaries

| ID  | Requirement                                                                                        | Priority | Completion evidence                                                          |
| --- | -------------------------------------------------------------------------------------------------- | -------- | ---------------------------------------------------------------------------- |
| R16 | Direct, delegation, and atomic split payment objects remain available.                             | Must     | Each object validates with URL identifiers.                                  |
| R17 | A product identity may delegate to a stable merchant identity.                                     | Should   | A product record can point to its merchant without duplicating destinations. |
| R18 | OPAP remains non-custodial and does not sign, submit, hold, route, convert, or settle funds.       | Must     | The protocol publishes and resolves instructions only.                       |
| R19 | Clients resolve only payer-supplied or payer-selected URLs; they do not crawl arbitrary web links. | Must     | Client requirements prohibit passive discovery.                              |

### Standardisation and migration

| ID  | Requirement                                                                                                  | Priority | Completion evidence                                                                                                            |
| --- | ------------------------------------------------------------------------------------------------------------ | -------- | ------------------------------------------------------------------------------------------------------------------------------ |
| R20 | `open-payment` is registered once in the IANA Well-Known URI Registry when the specification is stable.      | Should   | The registration references this specification and its media type.                                                             |
| R21 | The protocol states plainly that old `label@domain` records and site-association documents are incompatible. | Must     | The compatibility section and migration work list name affected artefacts.                                                     |
| R22 | The protocol defines typed failure results rather than fallback behaviour.                                   | Must     | Resolver behaviour maps malformed input, unavailable records, trust failure, and changed execution plans to distinct failures. |

## Non-requirements

- Making every website automatically payable.
- Fetching, parsing, or trusting payment data embedded in ordinary HTML pages.
- Hosting customer accounts, onboarding, billing, provider policy, or merchant administration.
- Defining product price, tax, inventory, fulfilment, invoice status, or settlement status.
- Requiring DNSSEC for basic HTTPS publication.
- Compatibility with the previous tagged OPID implementation under the same endpoint shape.

## Design decisions derived from the requirements

1. The page URL is the identity; page association is removed.
2. The record endpoint is encoded from the URL path, so a provider or plugin can
   route it generically without maintaining a manifest.
3. The record is the only payment-content source. A product page can be normal
   HTML for browsers while its derived record is JSON for resolvers.
4. Origin-level DNSSEC signing keys replace per-record DNS hashes in the new
   verification profile. HTTPS-only publication remains available.
5. A path record can delegate to a root merchant record, keeping stable payment
   destinations separate from rapidly changing product pages.

## Open delivery work

The requirements are agreed; implementation remains separate work:

- replace the two normative schemas and their generated validators;
- replace tag parsing, record URL construction, DNS hash verification, and
  site-association code in the core and runtime packages;
- add origin-key signing, rotation, and browser proof verification;
- migrate CLI, Browser Payer, fixtures, conformance coverage, operations guides,
  demo publication files, and release documentation;
- submit the well-known URI registration once the wire format is stable.
