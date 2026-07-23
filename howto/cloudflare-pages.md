# How to publish an OPID on your domain with Cloudflare Pages

This is a non-normative, provider-specific deployment guide for publishing one
static OPAP/1 Record. The [OPAP/1 specification](../specification/opap-1.md)
and schemas remain authoritative.

The procedure deliberately uses a separate, minimal Cloudflare Pages project
with no Pages Functions or `_worker.js`.

## Agent contract

An agent following this guide must obtain and confirm these inputs before
making public changes:

- the domain or subdomain the user controls;
- the exact canonical HTTPS OPID;
- the exact payment destination, including recipient name and IBAN for SEPA;
- the Cloudflare account and registrar that are in scope;
- whether replacing the current website on that hostname is intended.

The payment record and its destination data are public. Never infer, alter, or
publish payment details that the user has not explicitly confirmed.

The procedure is complete only when:

1. Cloudflare is authoritative for the DNS zone;
2. the Pages custom domain is `Active`;
3. the derived record URL returns `200` without a redirect;
4. all five required OPAP transport headers have the exact required values;
5. the returned JSON contains the exact canonical OPID and confirmed payment
   destination; and
6. an independent OPAP resolver accepts the OPID.

## 1. Move the domain's authoritative DNS to Cloudflare

Skip this section only if the domain already has status `Active` in the
intended Cloudflare account.

Changing nameservers can interrupt the website, email, and domain verification.
Before changing anything:

1. Export or capture every current DNS record.
2. Identify all `MX`, mail-related `TXT`, DKIM, DMARC, verification, `CAA`, and
   non-web records.
3. Add the apex domain to Cloudflare with **Onboard a domain** and import or
   recreate all required records.
4. Compare the Cloudflare DNS record set with the previous authoritative
   provider. Do not proceed while required records are missing.
5. If DNSSEC is enabled at the registrar, disable it before changing
   nameservers. Re-enable DNSSEC through Cloudflare only after the zone is
   active and resolving correctly.
6. At the registrar, replace the existing authoritative nameservers with the
   two nameservers assigned by Cloudflare.
7. Wait until Cloudflare reports the zone as `Active`.

Verify from an independent resolver:

```text
# macOS or Linux
dig NS example.com @1.1.1.1

# Windows
nslookup -type=ns example.com 1.1.1.1
```

The result must contain the two Cloudflare-assigned nameservers. Cloudflare's
[full DNS setup guide](https://developers.cloudflare.com/dns/zone-setups/full-setup/setup/)
documents the current dashboard and registrar procedure.

## 2. Choose and canonicalise the OPID

Use either the root URL:

```text
https://example.com/
```

or a canonical path:

```text
https://example.com/donate
```

The URL must use HTTPS, contain no port, credentials, query, or fragment, and
must follow the canonical path rules in
[OPAP/1 section 3](../specification/opap-1.md#3-opid-syntax-and-canonical-form).
The root slash is part of the canonical OPID.

If the apex hostname already serves a website that must remain online, do not
replace it with this minimal Pages project. Either publish the record files
from that website's existing deployment or use a dedicated hostname such as
`pay.example.com`, making the OPID `https://pay.example.com/`.

Derive the record path key by base64url-encoding the UTF-8 bytes of the
canonical URL path, including its leading slash and without padding:

```text
node -e "const u=new URL(process.argv[1]); console.log(Buffer.from(u.pathname,'utf8').toString('base64url'))" "https://example.com/"
```

For the root path `/`, the result is `Lw`. The corresponding record URL is:

```text
https://example.com/.well-known/open-payment/record/Lw
```

For a non-root OPID, use the generated key verbatim as the filename.

## 3. Create the minimal static publication

Create this directory structure:

```text
opid-site/
├── index.html
├── _headers
└── .well-known/
    └── open-payment/
        └── record/
            └── Lw
```

Replace `Lw` with the path key derived in the previous section when the OPID
does not use `/`.

`index.html` may be minimal:

```html
<!doctype html>
<meta charset="utf-8">
<title>Payment address</title>
<p>This domain publishes an Open Payment Address.</p>
```

Create the extensionless record file with UTF-8 JSON and no byte-order mark.
For a new SEPA OPID, use this shape:

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
    "options": [
      {
        "type": "sepa",
        "currency": "EUR",
        "name": "Example recipient",
        "iban": "NL91ABNA0417164300"
      }
    ]
  }
}
```

Before deployment, replace every example value:

- `id` must exactly equal the canonical OPID;
- `revision` is `1` only for a never-before-published OPID;
- timestamps must be real UTC timestamps at exact-second precision;
- `expires_at` must be later than `issued_at`;
- `name` and `iban` must be the confirmed public destination;
- the IBAN must be uppercase, contain no spaces, and pass its checksum.

OPAP/1 has no universal maximum validity interval. Choose an expiry that can be
renewed operationally. Every later publication for the same OPID, including a
freshness-only change, must use a strictly higher revision.

Create `_headers` with exactly:

```text
/.well-known/open-payment/record/*
  Access-Control-Allow-Origin: *
  Access-Control-Expose-Headers: Content-Encoding, OPAP-Proof
  Cache-Control: no-store
  Content-Encoding: identity
  Content-Type: application/opap+json
```

`OPAP-Proof` must appear in `Access-Control-Expose-Headers` even when the record
does not carry an `OPAP-Proof` response header.

Do not add redirects for the record path. Do not add Pages Functions or
`_worker.js` to this minimal project. Cloudflare applies `_headers` to static
assets, but not to responses generated by Pages Functions; a function-based
publisher must set the required headers in its own response code. See
Cloudflare's [_headers documentation](https://developers.cloudflare.com/pages/configuration/headers/).

## 4. Create and deploy the Cloudflare Pages project

Node.js and npm are required. Authenticate Wrangler:

```text
npx wrangler login
```

Create a Direct Upload Pages project:

```text
npx wrangler pages project create example-opid --production-branch main
```

Use a globally unique, non-sensitive project name instead of `example-opid`.
Then deploy the directory:

```text
npx wrangler pages deploy ./opid-site --project-name example-opid --branch main
```

Record the production `https://<project>.pages.dev` URL returned by Wrangler.
Cloudflare's [Direct Upload guide](https://developers.cloudflare.com/pages/get-started/direct-upload/)
documents the current commands.

Test the Pages URL before attaching the real domain:

```text
curl -i https://example-opid.pages.dev/.well-known/open-payment/record/Lw
```

Do not continue unless it returns the intended JSON with status `200` and the
required headers.

## 5. Attach the custom domain

In the Cloudflare dashboard:

1. Open **Workers & Pages**.
2. Select the Pages project.
3. Open **Custom domains**.
4. Select **Set up a domain**.
5. Enter the exact OPID hostname, such as `example.com` or
   `pay.example.com`, and continue.

Associate the hostname with the Pages project before manually creating a
CNAME. A CNAME created without the Pages custom-domain association can produce
a Cloudflare `522`.

When the DNS zone is in the same Cloudflare account, Cloudflare normally
creates the required proxied CNAME automatically:

```text
Type:    CNAME
Name:    @
Target:  example-opid.pages.dev
Proxy:   Proxied
```

For `pay.example.com`, use `pay` as the name. If conflicting web-serving
`A`, `AAAA`, or `CNAME` records already exist for that exact hostname, confirm
that replacing the existing website is intended, then remove only those
conflicting web records and create the Pages CNAME. Preserve unrelated records,
especially `MX`, mail `TXT`, DKIM, DMARC, verification, and `CAA` records.

Wait until the Pages custom-domain status and certificate validation are both
active. Follow Cloudflare's
[Pages custom-domain guide](https://developers.cloudflare.com/pages/configuration/custom-domains/)
if activation remains pending.

## 6. Verify the live OPID

Request the derived record URL without following redirects:

```text
curl -i --max-redirs 0 https://example.com/.well-known/open-payment/record/Lw
```

The response must have:

```text
HTTP status:                   200
Access-Control-Allow-Origin:   *
Access-Control-Expose-Headers: Content-Encoding, OPAP-Proof
Cache-Control:                 no-store
Content-Encoding:             identity
Content-Type:                 application/opap+json
```

Also verify:

- there is no `Location` header;
- the body is no larger than 65,536 bytes;
- the body parses as JSON;
- `id` exactly equals the submitted canonical OPID;
- timestamps are currently valid;
- the name and destination exactly match the confirmed values.

Finally, enter the canonical OPID in an independent OPAP resolver, such as
[openpaymentaddress.org](https://openpaymentaddress.org/). Success requires the
resolver to report the payment address as verified and show the expected
payment method and masked destination.

## Updating or recovering a publication

For every change:

1. keep the same canonical `id`;
2. increment `revision` above every previously published revision;
3. set new valid `issued_at` and `expires_at` values;
4. deploy the complete static directory again; and
5. repeat the direct and resolver tests.

Do not restore an old deployment containing a lower revision. Returning
resolvers will correctly reject it as a rollback. To restore an earlier payment
destination, publish that destination again in a new record with a higher
revision.

## Troubleshooting

### Direct request is not `200`

Check the Pages deployment, exact path key, custom-domain status, TLS
certificate, and DNS CNAME. The record filename has no `.json` extension.

### Direct request is `200`, but the resolver rejects the response

Compare all transport headers exactly. A frequent error is exposing only
`Content-Encoding`; the value must be:

```text
Content-Encoding, OPAP-Proof
```

Also check for redirects, compression instead of explicit `identity`, an
expired record, an incorrect `id`, or an invalid IBAN checksum.

### A Cloudflare-hosted resolver returns a generic `502`

First verify the record directly. If the direct response is valid and the
resolver itself runs as a Cloudflare Worker or Pages Function in the same
Cloudflare account or zone, the resolver operator may need the
`global_fetch_strictly_public` compatibility flag.

Set that flag on the **resolver project**, not on this static publisher, and
redeploy the resolver. The flag makes the resolver's global `fetch()` use
Cloudflare's public front door. See Cloudflare's
[compatibility flag documentation](https://developers.cloudflare.com/workers/configuration/compatibility-flags/#global-fetch-strictly-public).

If the resolver is operated by someone else, report the valid direct response
and the resolver's `502` to that operator.
