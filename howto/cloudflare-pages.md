# Publish an OPID with Cloudflare Pages

This non-normative guide publishes one static OPAP/1 Record. The
[specification](../specification/opap-1.md) and schemas are authoritative.

## Trust profiles

| Profile | Origin proof | DNSSEC | Resolver result |
| --- | --- | --- | --- |
| Minimal | No | No | `https/none`; valid, but no key binding or continuity |
| Signed | Yes | No | `https/first-use` or `https/bound` |
| Recommended | Yes | Yes | `dnssec/first-use` or `dnssec/bound` |

`first-use` means the caller supplied no applicable host evidence; `bound`
means it supplied `available` evidence for the authenticated key lineage.
Publishing does not require the resolver to own or persist that evidence.

Follow every step for the recommended profile. For minimal, skip sections 3
and 5; for signed, skip section 5. An unsigned OPID is valid, but the resolver
must report that DNSSEC key binding is absent.

## Agent contract

Before public changes, obtain and confirm:

- the controlled domain/subdomain and canonical HTTPS OPID;
- the exact public payment destination, including SEPA name and IBAN;
- the Cloudflare account and registrar in scope; and
- whether replacing the website on that hostname is intended.

Never infer payment data. Never expose, commit, upload, or deploy a private
key. Preserve all unrelated DNS records.

Recommended-profile completion requires:

1. Cloudflare is authoritative and Pages reports the custom domain `Active`;
2. the exact record URL returns `200` without redirect, with valid bytes and
   headers;
3. `_opap.<hostname>` returns the intended TXT record with DNSSEC `AD=true`;
4. the parent zone publishes Cloudflare's DS; and
5. an independent resolver reports `Payment address verified` and
   `DNSSEC key binding verified`.

## 1. Make Cloudflare authoritative

Skip this section when the zone is already `Active` in the intended account.
Nameserver changes can interrupt web and mail service; do not proceed with
missing records.

1. Capture the complete old zone, especially `MX`, SPF, DKIM, DMARC,
   verification, `CAA`, and other non-web records.
2. Add the apex domain to Cloudflare and recreate/verify every required record.
3. If DNSSEC is active at the old provider, disable its registrar DS before
   changing nameservers.
4. At the registrar, replace the nameservers with Cloudflare's assigned pair.
5. Wait for Cloudflare status `Active` and verify independently:

```text
# macOS/Linux
dig NS example.com @1.1.1.1

# Windows
nslookup -type=ns example.com 1.1.1.1
```

The result must contain Cloudflare's nameservers. See
[Cloudflare full setup](https://developers.cloudflare.com/dns/zone-setups/full-setup/setup/).

## 2. Build the static record

Choose a canonical OPID:

```text
https://example.com/
https://example.com/donate
```

It must use HTTPS, have no credentials, port, query, or fragment, and satisfy
[OPAP/1 section 3](../specification/opap-1.md#3-opid-syntax-and-canonical-form).
The root slash is significant. If the hostname already serves a website, add
the record to that deployment or use a dedicated hostname such as
`pay.example.com`; do not replace the site without confirmation.

Base64url-encode the UTF-8 URL path, including its leading slash and without
padding:

```text
node -e "const u=new URL(process.argv[1]);console.log(Buffer.from(u.pathname).toString('base64url'))" "https://example.com/"
```

For `/`, the key is `Lw` and the record URL is:

```text
https://example.com/.well-known/open-payment/record/Lw
```

For another path, use the printed key verbatim as the record filename.

Use a work directory whose key material is outside the deployable `site`
directory:

```text
opid-work/
├── origin-epoch-1.pk8
├── origin-epoch-1.pub
├── make-proof.mjs
└── site/
    ├── index.html
    ├── _headers
    └── .well-known/open-payment/record/Lw
```

`site/index.html` may be:

```html
<!doctype html>
<meta charset="utf-8">
<title>Payment address</title>
<p>This domain publishes an Open Payment Address.</p>
```

Create the extensionless record as UTF-8 JSON without a byte-order mark:

```json
{
  "version": 1,
  "id": "https://example.com/",
  "revision": 1,
  "issued_at": "2026-07-23T12:00:00Z",
  "expires_at": "2027-07-23T12:00:00Z",
  "name": "Example recipient",
  "payment": {
    "type": "options",
    "options": [{
      "type": "sepa",
      "currency": "EUR",
      "name": "Example recipient",
      "iban": "NL91ABNA0417164300"
    }]
  }
}
```

Replace every example. `id` must equal the OPID exactly; timestamps must be real
UTC seconds with `expires_at > issued_at`; the confirmed IBAN must be uppercase,
unspaced, and checksum-valid. Use `revision: 1` only for a new OPID. Every later
publication, including freshness-only changes, needs a strictly higher revision.
OPAP/1 sets no universal maximum validity interval; choose one you can renew.

Create `site/_headers`:

```text
/.well-known/open-payment/record/*
  Access-Control-Allow-Origin: *
  Access-Control-Expose-Headers: Content-Encoding, OPAP-Proof, X-Content-Type-Options
  Cache-Control: no-store
  Content-Encoding: identity
  Content-Type: application/opap+json
  X-Content-Type-Options: nosniff
```

Do not redirect the record route. Do not use Pages Functions or `_worker.js`
for this static project: `_headers` applies only to static assets; a
function-based publisher must set these headers in code. Keep `OPAP-Proof` and
`X-Content-Type-Options` in the exposed-header list even for an unsigned record.
See
[Pages headers](https://developers.cloudflare.com/pages/configuration/headers/).

## 3. Sign the exact record bytes

Generate one Ed25519 key pair locally from `opid-work`:

```text
node -e "const{generateKeyPairSync}=require('node:crypto'),{writeFileSync}=require('node:fs'),k=generateKeyPairSync('ed25519');writeFileSync('origin-epoch-1.pk8',k.privateKey.export({format:'der',type:'pkcs8'}),{mode:0o600});writeFileSync('origin-epoch-1.pub',k.publicKey.export({format:'der',type:'spki'}).subarray(-32).toString('base64url')+'\n')"
```

Restrict `origin-epoch-1.pk8` to the current user (`chmod 600` on Unix; remove
inheritance and other principals from its ACL on Windows). Back it up securely.
`rec=none` below deliberately provides no OPAP recovery: losing or replacing
this key produces `identity_key_changed` for callers that supply applicable
host evidence. A caller using explicit `none` has no such takeover protection.

Publish this Cloudflare DNS record, replacing `<public-key>` with the contents
of `origin-epoch-1.pub`:

```text
Type:    TXT
Name:    _opap                    # apex; use _opap.pay for pay.example.com
Content: v=opap1;epoch=1;ed25519=<public-key>;rec=none
TTL:     300
```

Create `make-proof.mjs` outside `site`:

```js
import { createHash, createPrivateKey, sign } from "node:crypto";
import { readFileSync } from "node:fs";

const [recordPath, keyPath] = process.argv.slice(2);
if (!recordPath || !keyPath) throw new Error("record and key paths required");
const body = readFileSync(recordPath);
const id = JSON.parse(body.toString("utf8")).id;
const hash = createHash("sha256").update(body).digest("hex");
const key = createPrivateKey({
  key: readFileSync(keyPath), format: "der", type: "pkcs8"
});
const message = Buffer.from(`OPAP/1\n${id}\n${hash}`);
console.log(`v=1;sig=${sign(null, message, key).toString("base64url")}`);
```

Run it against the final, exact record bytes:

```text
node make-proof.mjs site/.well-known/open-payment/record/Lw origin-epoch-1.pk8
```

Append the printed value to `site/_headers` for that exact record:

```text
/.well-known/open-payment/record/Lw
  OPAP-Proof: v=1;sig=<signature>
```

Any byte change requires a new proof. Never deploy `opid-work` itself.

## 4. Deploy and attach Pages

From `opid-work`, authenticate Wrangler and create a Direct Upload project:

```text
npx wrangler login
npx wrangler pages project create example-opid --production-branch main
npx wrangler pages deploy ./site --project-name example-opid --branch main
```

Use a globally unique, non-sensitive project name. Test the returned
`https://<project>.pages.dev` record URL before attaching the domain.
Do not continue until it returns `200` with the intended bytes and headers.
See [Direct Upload](https://developers.cloudflare.com/pages/get-started/direct-upload/).

In **Workers & Pages → project → Custom domains**, choose **Set up a domain**
and enter the exact OPID hostname. Create this association before manually
adding a CNAME; a bare CNAME can produce `522`. Cloudflare normally creates:

```text
Type:   CNAME
Name:   @                       # use pay for pay.example.com
Target: example-opid.pages.dev
Proxy:  Proxied
```

With confirmation, remove only conflicting web-serving `A`, `AAAA`, or `CNAME`
records for that hostname. Preserve unrelated DNS. Wait for custom-domain and
certificate status `Active`. See
[Pages custom domains](https://developers.cloudflare.com/pages/configuration/custom-domains/).

## 5. Bind the signing key with DNSSEC

Do not confuse the OPAP Ed25519 key with Cloudflare's DNSSEC key.

1. In **Cloudflare → DNS → Settings → DNSSEC**, select **Enable DNSSEC**.
2. Copy Cloudflare's DS data. At the registrar, enable DNSSEC and enter either:
   - **DS form:** key tag, algorithm, digest type, and digest; or
   - **DNSKEY form:** KSK/flags `257`, protocol `3`, algorithm, and public key.
3. Wait until the parent zone publishes that DS and Cloudflare reports DNSSEC
   `Active`.

Verify both the parent DS and secure OPAP TXT response:

```text
dig DS example.com @1.1.1.1 +dnssec
dig TXT _opap.example.com @1.1.1.1 +dnssec
```

The first answer must match Cloudflare's DS; the TXT answer must be the intended
trust record and the response flags must include `ad`. A portable JSON check is:

```text
curl -H "accept: application/dns-json" "https://cloudflare-dns.com/dns-query?name=_opap.example.com&type=TXT&do=1&cd=0"
```

Require `"AD":true`. Immediately after enabling DNSSEC, resolvers may retain
the previous insecure result until its TTL expires; retry after that TTL rather
than changing keys. A continuity-aware application that cannot load or validate
evidence it expected MUST supply `unavailable`, never discard that evidence or
silently substitute `none`.

## 6. Verify end to end

Request the record without following redirects:

```text
curl -i --max-redirs 0 https://example.com/.well-known/open-payment/record/Lw
```

Require:

```text
status                              200
Access-Control-Allow-Origin         *
Access-Control-Expose-Headers       Content-Encoding, OPAP-Proof, X-Content-Type-Options
Cache-Control                       no-store
Content-Encoding                    identity
Content-Type                        application/opap+json
X-Content-Type-Options              nosniff
OPAP-Proof                          v=1;sig=...   # signed profiles only
Location                            absent
body                                valid exact JSON, at most 65,536 bytes
```

Confirm the exact `id`, current validity, revision, recipient, and destination.
Then test the canonical OPID at
[openpaymentaddress.org](https://openpaymentaddress.org/). The minimal profile
must resolve but reports no DNSSEC key binding. The recommended profile must
show the expected masked destination, `Payment address verified`, and
`DNSSEC key binding verified`.

## Updates

For every record change: keep `id`, increase `revision`, set valid timestamps,
sign the final bytes again, deploy the complete `site`, and repeat all checks.
Never restore a lower revision; republish the old destination under a higher
one. Rotate origin keys only through the authenticated epoch transition in
[OPAP/1 section 7](../specification/opap-1.md#7-binding-continuity-and-origin-key-epochs).

## Troubleshooting

- **Not `200`:** check the exact extensionless path, Pages deployment, custom
  domain, certificate, CNAME, and redirects.
- **Invalid response:** compare every transport header; common causes are a
  missing `OPAP-Proof` exposure, compression, bad `id`, expiry, or invalid IBAN.
- **Proof present but trust record missing:** `_opap.<hostname>` was not
  returned; check its owner/value and DNS caches.
- **`identity_key_changed`:** supplied prior evidence contains an origin-key
  entry but the current trust record is absent or unauthenticated. Restore the
  intended trust record; do not discard the evidence or retry with `none`.
- **No DNSSEC key binding:** verify the registrar's parent DS, Cloudflare
  DNSSEC status, TXT `AD=true`, and expired cache TTL.
- **Proof invalid:** the body changed after signing or the exact-route
  `OPAP-Proof` header is wrong; sign the deployed bytes again.
- **Cloudflare-hosted resolver `502`:** if the direct response is valid, the
  resolver project—not this publisher—may need Cloudflare's
  [`global_fetch_strictly_public`](https://developers.cloudflare.com/workers/configuration/compatibility-flags/#global-fetch-strictly-public)
  compatibility flag. Otherwise report the valid direct response to its
  operator.
