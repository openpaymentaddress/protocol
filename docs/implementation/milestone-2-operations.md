# OPAP/1 publisher and resolver operations

This guide applies to the URL-identity OPAP/1 profile. An OPID is a canonical
HTTPS URL; the submitted URL is never fetched.

## Resolver trust boundary

The CLI uses `https://dns.google/resolve` by default and treats authenticated
data (`AD`) as DNSSEC evidence. Use another compatible validating JSON resolver
with `--doh <https-url>` where that operational trust or privacy trade-off is
unsuitable.

The resolver treats authenticated answers and authenticated absence as secure,
unsigned answers as insecure, explicit DNSSEC validation failures as bogus, and
other resolver failures as unavailable. DNS never supplies payment content.
The resolver fetches only the deterministic record URL derived from the OPID.

## Publish a controlled OPID

For an OPID such as `https://example.com/donate`:

1. Create final UTF-8 OPAP Record bytes without a BOM. Its `id` must exactly be
   `https://example.com/donate`.
2. Publish those bytes at the derived record route:

   ```text
   https://example.com/.well-known/open-payment/record/L2RvbmF0ZQ
   ```

3. Serve status `200` without redirects and these response headers:

   ```text
   Access-Control-Allow-Origin: *
   Access-Control-Expose-Headers: Content-Encoding, OPAP-Proof
   Cache-Control: no-store
   Content-Encoding: identity
   Content-Type: application/opap+json
   ```

4. To bind trust with DNSSEC, publish a TXT record at `_opap.example.com` in
   this exact form:

   ```text
   v=opap1;ed25519=<base64url-public-key>[;next=<base64url-public-key>]
   ```

5. Sign the exact record bytes with the active or `next` Ed25519 key and expose
   the proof in `OPAP-Proof`. Verify the publication before use:

   ```shell
   node apps/opap-cli/dist/index.js publish check https://example.com/donate
   node apps/opap-cli/dist/index.js resolve https://example.com/donate
   ```

Both commands must report the expected record URL and `dnssec-bound` before a
DNSSEC-bound publication is claimed.

## Rotate an origin key safely

1. Publish the new public key as `next` alongside the active key.
2. Wait at least the prior DNS TTL.
3. Begin serving proofs made by the new key and verify them externally.
4. After the TTL and deployment checks, promote the new key to `ed25519` and
   remove the old key.

Do not authorize a parent, child, or sibling hostname with an origin key. Each
OPID hostname has its own `_opap.<hostname>` trust name.
