# Functional Design — Open Payment Address Protocol (OPAP/1)

**One canonical URL. One verified payment plan. One recipient or one atomic split.**

Version 2.0 · URL-identity design · July 2026

> **Document role:** non-normative explanation of the active OPAP/1 product.
> The [Dutch](../protocol/open-payment-address-protocol-v1.md) and
> [English](../protocol/open-payment-address-protocol-v1.en.md) specifications
> and the [OPAP Record](../../schema/open-payment-address-v1.schema.json)
> schema are authoritative.

## Purpose

OPAP is an open standard for publishing payment instructions from a canonical
HTTPS URL. The URL is the Open Payment Identifier (OPID):

```text
https://patricksavalle.com/
https://patricksavalle.com/music
https://foundation.example/donate
```

An OPID resolves to one direct payment destination, another URL OPID through a
bounded delegation, or one atomic split. OPAP does not hold or move money.

## Resolution

1. A payer submits a canonical HTTPS URL.
2. The resolver canonicalizes its hostname and path, rejecting credentials,
   ports, queries, fragments, unsafe percent encodings, and noncanonical paths.
3. It derives a base64url path key and fetches only:

   ```text
   https://<hostname>/.well-known/open-payment/record/<path-key>
   ```

4. It rejects redirects and invalid transport profiles, validates exact response
   bytes, schema, the exact record `id`, proof, and payment semantics.
5. Before execution, it resolves again and blocks recipient-affecting changes.

The submitted OPID page is never fetched and no discovery fallback exists.

## Origin trust

An origin may publish one DNSSEC-protected TXT key at `_opap.<hostname>`:

```text
v=opap1;ed25519=<base64url-public-key>[;next=<base64url-public-key>]
```

The record proof binds the canonical OPID and exact record bytes to the active
or rotating `next` key. A key applies only to its exact hostname.

## Publisher experience

Publishers choose a stable URL for each payment purpose and serve the resulting
record route with public credential-free CORS, `Content-Encoding: identity`,
`Cache-Control: no-store`, and `application/opap+json` or `application/json`.
The browser payer displays the canonical OPID, derived record URL, verification
level, record chain, and final payment plan before execution.
