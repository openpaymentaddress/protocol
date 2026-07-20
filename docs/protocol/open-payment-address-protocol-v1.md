# Open Payment Address Protocol — OPAP/1

**Een URL-native, non-custodial adreslaag voor betalingen**

Protocolversie 1 · URL-identiteitsrevisie · 20 juli 2026

> **Status:** normatieve vervangingsspecificatie. Deze revisie vervangt bewust
> het eerdere OPAP/1-profiel met `label@domain` en siteassociatie. De schema's,
> fixtures, runtime, CLI en Browser Payer in deze repository implementeren deze
> revisie. Zie het
> [requirements- en migratieregister](opap-v1-url-identity-requirements.md).

De woorden **MOET**, **MAG NIET**, **ZOU MOETEN** en **MAG** zijn normatief.

## 1. Doel en scope

OPAP resolveert een HTTPS-URL naar een geverifieerde betalingsinstructie. Het is
een discoveryprotocol, geen wallet, betaalinstelling, merchantaccount,
betalingsrouter, settlementnetwerk of productcatalogus.

Voorbeelden van OPID's:

```text
https://customer.opid.provider/
https://customer.opid.provider/product/1223
https://shop.example/donate
```

De URL is de stabiele betalingsidentiteit. Een productpagina kan voor browsers
gewone HTML blijven, maar een OPAP Resolver haalt die pagina nooit op. Hij haalt
alleen het deterministische well-known OPAP Record voor de URL op.

OPAP publiceert een van drie betalingsobjecten:

- een directe ontvanger met geordende alternatieve Payment Handlers;
- een delegatie naar een andere HTTPS-OPID; of
- een atomische split over vaste bestemmingen.

Bedrag, belasting, productbeschrijving, voorraad, levering, vervaldatum,
factuurstatus en settlementstatus zijn applicatiedata. Zij worden niet uit een
webpagina afgeleid en zijn geen OPAP/1-semantiek.

## 2. Kernbeslissingen

1. Een OPID is één canonieke HTTPS-URL, geen e-mailachtig identificatiemiddel.
2. Het pad mag een product, factuur, donatie of andere resource identificeren.
3. Eén same-origin OPAP Record is de enige bron van betalingsinhoud.
4. De resolver haalt de aangeleverde OPID-pagina nooit op en parseert haar niet.
5. Discovery gebruikt de origin-rooted RFC 8615-naamruimte
   `/.well-known/open-payment/`.
6. Een provider mag willekeurig veel identiteiten via één generiek endpoint
   aanbieden.
7. HTTPS-only-publicatie is geldig. Een DNSSEC-bound origin-signing-key is een
   optioneel sterker verificatieprofiel.
8. Het protocol beheert nooit geld, private keys, accounts of uitvoering.

## 3. OPID-syntaxis en canonieke vorm

Een OPID is een absolute HTTPS-URL in deze beperkte vorm:

```text
https://<hostname>/<path>
```

De hostname MOET worden omgezet naar lowercase IDNA2008 ASCII A-labelvorm. De
poort MOET ontbreken; HTTPS-poort 443 is impliciet. Userinfo, query en fragment
zijn verboden.

Het pad is `/` of een of meer niet-lege segmenten. Een segment gebruikt
RFC-3986-unreserved tekens en percent-encodings voor UTF-8 met hoofdletters.
Lege segmenten, dot-segmenten, encoded solidus of reverse solidus, percent-encoded unreserved
tekens en een trailing slash op een niet-rootpad zijn ongeldig. Een canonieke
OPID is maximaal 512 ASCII-tekens lang.

Deze invoer is bijvoorbeeld ongeldig en geen alias:

```text
http://shop.example/product/1223
https://shop.example/product/../donate
https://shop.example/product//1223
https://shop.example/product/1223/
https://shop.example/product/1223?campaign=mail
```

De canonieke rootidentiteit wordt met `/` geschreven:

```text
https://customer.opid.provider/
```

Implementaties MOETEN de canonieke OPID in de review-UI tonen. Zij MOGEN de
root-slash alleen voor weergave weglaten wanneer dat de kopieerbare waarde niet
kan wijzigen.

## 4. Record discovery

### 4.1 Canonieke record-URL

Laat `path-key` de unpadded base64url-encoding zijn van de UTF-8-bytes van het
canonieke OPID-pad, inclusief de eerste slash. De canonieke OPAP Record-URL is:

```text
https://<hostname>/.well-known/open-payment/record/<path-key>
```

Voorbeeld:

```text
OPID:       https://customer.opid.provider/product/1223
Pad:        /product/1223
Path key:   L3Byb2R1Y3QvMTIyMw
Record URL: https://customer.opid.provider/.well-known/open-payment/record/L3Byb2R1Y3QvMTIyMw
```

De path key voor `/` is `Lw`.

De resolver MOET deze URL zelf construeren en MAG GEEN recordlocatie uit
pagina-HTML, redirect, DNS, queryparameter of cache-entry gebruiken. De
record-URL heeft dezelfde origin als de OPID. Een record op één host MAG GEEN
OPID op een andere host autoriseren.

### 4.2 RFC 8615-registratie

`open-payment` is de applicatienaam relatief aan `/.well-known/` en MOET in
het IANA Well-Known URI Registry worden geregistreerd wanneer deze specificatie
wordt uitgebracht. `record/<path-key>` is aanvullende padsyntax die OPAP/1
definieert; het is zelf geen registratienaam.

## 5. Transportprofiel

Een publisher MOET een geldig record met status `200`, zonder redirect, en ten
minste deze headers aanbieden:

```http
Access-Control-Allow-Origin: *
Access-Control-Expose-Headers: Content-Encoding, OPAP-Proof
Cache-Control: no-store
Content-Encoding: identity
Content-Type: application/opap+json
```

`application/json` met parameters is ook toegestaan. De publisher MAG GEEN
cookies, HTTP-authenticatie, clientcertificaten of andere credentials vereisen,
en MAG GEEN `Access-Control-Allow-Credentials: true` meesturen.

De resolver MOET HTTPS gebruiken, TLS valideren, zonder credentials aanvragen,
status `200` vereisen, redirects weigeren, een toegestaan mediatype en
expliciete `Content-Encoding: identity` vereisen, dubbele JSON-sleutels
weigeren en een body groter dan 65.536 bytes of dieper dan 32 JSON-niveaus
weigeren. Elke request MOET binnen tien seconden timeouten.

`404` of `410` is `record_not_found`; andere transportfouten zijn
`record_unavailable`; een ongeldige `200`-response is `invalid_record`.

## 6. OPAP Record

Het OPAP Record is UTF-8 JSON zonder byte-order mark. Het veld `id` is exact de
canonieke OPID die voor discovery is gebruikt.

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

Het recordschema definieert `version`, `id`, optionele displayinformatie en
precies één `payment`-object. Het MOET onbekende top-level members weigeren,
tenzij een toekomstige OPAP/1-revisie die expliciet toestaat.

### 6.1 Directe betaling

Een direct object bevat een of meer geordende alternatieve Payment Handlers voor
dezelfde economische ontvanger. De bestaande OPAP/1-handlersemantiek voor SEPA
en ERC-20 blijft gelden: elke uitvoerbare handler noemt een settlement currency;
een asset wordt via netwerk en assetidentifier geïdentificeerd, nooit alleen via
symbool. De eerste ondersteunde handler is de voorkeur van de ontvanger.

### 6.2 Delegatie

Een delegatie bevat alleen een canonieke HTTPS-OPID `target`. Zij heeft geen
lokale methods. Een resolver MAG maximaal acht delegatiehops volgen en MOET een
loop, dubbele OPID of gewijzigd record tijdens payment revalidation weigeren.

Productrecords delegeren vaak naar een rootidentiteit van de merchant. Daardoor
hoeven betalingsbestemmingen niet bij iedere productwijziging te worden gekopieerd.

### 6.3 Atomische split

Een split blijft één vaste, atomische betalingsinstructie. Hij MOET één
settlementnetwerk en één asset, vaste ontvangers en positieve integer shares
hebben, en de bestaande OPAP-rounding- en contract-verificatiegaranties volgen.
Nested splits zijn verboden.

## 7. Verificatieniveaus

OPAP/1 definieert twee verificatieniveaus:

- `https-only`: geldige HTTPS-transportlaag en een geldig OPAP Record;
- `dnssec-key-bound`: geldige HTTPS, een secure DNSSEC-origin key en een geldig
  record proof van die key.

Een applicatie MAG `dnssec-key-bound` via lokaal beleid vereisen. Zij MOET het
bereikte niveau tonen en het hoogste eerder gebruikte niveau per canonieke OPID
onthouden. Een normale betaling MOET stoppen met `verification_downgrade`
wanneer een eerder key-bound OPID alleen als `https-only` resolveert. Herstel
vereist een afzonderlijke, expliciete gebruikersactie.

### 7.1 DNSSEC-origin key

De optionele TXT-owner is:

```text
_opap.<hostname>
```

Het secure TXT-record heeft exact een van deze vormen:

```text
v=opap1;ed25519=<base64url-public-key>
v=opap1;ed25519=<base64url-public-key>;next=<base64url-public-key>
```

De twee keys MOETEN verschillen. De DNSSEC-key geldt alleen voor OPID's op de
exacte hostname, niet voor parent-, child- of sibling-hosts. Een insecure,
afwezige of niet-beschikbare DNS-key levert nooit betalingsinhoud en geeft
`https-only`. Een malformed secure record is `invalid_trust_record`; bogus
DNSSEC is `dnssec_bogus`.

### 7.2 Record proof

Een key-bound response bevat `OPAP-Proof`:

```text
OPAP-Proof: v=1;sig=<base64url-ed25519-signature>
```

De signature wordt gemaakt over de UTF-8-bytes van:

```text
OPAP/1\n<canonical-opid>\n<lowercase-hex-sha256-of-exact-response-body>
```

De resolver valideert de signature met de actieve `ed25519`-key of tijdens
rotatie met `next`. Hij MOET de hash berekenen over de exact ontvangen,
identity-encoded response body. De proof-header MOET via CORS exposed zijn. Een
ontbrekende of ongeldige proof terwijl een secure key aanwezig is, is
`record_proof_invalid`.

### 7.3 Keyrotatie

Voor rotatie publiceert een publisher `next`, wacht hij minstens de oude DNS
TTL, begint hij met ondertekenen met de nieuwe key, wacht hij opnieuw minstens
die TTL en promoveert hij daarna `next` naar `ed25519`. Een publisher MAG de
secure key NIET als normale rollback verwijderen.

## 8. Resolveralgoritme

Voor een OPID die een payer heeft aangeleverd of expliciet geselecteerd:

1. Parse en canonicaliseer de HTTPS-URL; stop anders met `invalid_opid`.
2. Leid de canonieke record-URL uit sectie 4 af.
3. Haal alleen die URL op volgens sectie 5.
4. Valideer transport, JSON, schema en exacte `id`-gelijkheid.
5. Query de optionele origin DNS-key en valideer de proof wanneer die secure is.
6. Resolve direct-, delegate- of splitsemantiek binnen de geldende grenzen.
7. Maak een immutable execution plan met OPID, record-URL, verificatieniveau,
   record fingerprints en finale Payment Handlers.
8. Herhaal de resolutie direct voor uitvoering en stop met `execution_changed`
   wanneer een ontvangerbepalende waarde verschilt.

Resolvers MOGEN GEEN links crawlen, pagina-HTML inspecteren, een record uit een
gewone URL afleiden of zonder payer intent een speculatieve lookup sturen.

## 9. Publishermodel

Een provider mag één generieke route aanbieden:

```text
/.well-known/open-payment/record/*
```

Hij decodeert `path-key`, valideert het daaruit voortkomende canonieke pad en
zoekt het paar `(hostname, path)` in zijn datastore op. Er is geen statisch
sitebreed manifest, script per klant of DNS-content-hash per pad nodig.

Een WordPress- of WooCommerce-plugin kan deze route implementeren en een record
teruggeven dat uit een product-, donatie- of shopconfiguratie volgt. Een
statische site kan individuele recordbestanden tijdens de build genereren. Een
host die het root well-known pad niet kan aanbieden, kan voor die origin geen
OPAP Records publiceren.

## 10. Security en privacy

De well-known locatie is een origin-security boundary. Publishers MOETEN de
schrijftoegang ertoe beperken. Payers en resolvers MOETEN de aangeleverde pagina
en het recordendpoint als verschillende resources behandelen en mogen nooit de
inhoud van de een als inhoud van de ander vertrouwen.

Records, lookuppaden, DNS-queries en bestemmingsdata zijn publieke metadata.
Publiceer alleen gegevens die nodig zijn voor de betalingsinstructie. Een URL-pad
kan een product- of factuuridentifier onthullen; gebruik een opaque URL-pad als
dat niet aanvaardbaar is. DNSSEC is optioneel omdat het extra operationele
verantwoordelijkheid toevoegt, niet omdat het de publieke aard van lookups wijzigt.

## 11. Rollen

- **Publisher:** beheert de OPID-hostname en publiceert haar records.
- **Provider:** kan de publisherdienst voor veel publishers of resources
  uitvoeren; OPAP maakt hem daardoor geen betalingsintermediair.
- **Resolver:** valideert en resolveert een OPID naar een execution plan.
- **Payerapplicatie:** verkrijgt payer intent, toont het plan en kan het aan een
  bank of wallet overdragen. Zij is verantwoordelijk voor betalingsexecutie.

## 12. Compatibiliteit en migratie

Deze revisie verwijdert alle volgende eerdere OPAP/1-concepten:

- `label@domain`-identiteiten en bare-domain shorthand;
- recordpaden in de vorm `/.well-known/open-payment/<label>.json`;
- DNS SHA-256 TXT-hashes per record;
- `_site.json`, `_site._opap` en page-association matching;
- input precedence tussen tagged OPID's, pagina-URL's en record-URL's.

Een oude resolver MOET een URL-identiteitsrecord weigeren in plaats van het
anders te interpreteren. Een nieuwe resolver MOET oude tagged records weigeren,
tenzij een expliciet aparte legacy-compatibilitymodule is ingeschakeld. Schema's,
generated validators, conformance vectors, CLI-commands, runtime packages,
Browser Payer-flows en publisher operations vereisen een gecoördineerde migratie
voordat deze specificatie als geïmplementeerd mag worden geclaimd.
