# Kirjanpito

Lakisääteinen kahdenkertainen kirjanpito pienelle osakeyhtiölle (rakennettu VOON IQ Oy:n tarpeisiin).
Vite + vanilla JS, tietokantana Supabase (PostgreSQL). Kirjanpidon säännöt (täsmäytys, lukitukset,
numerointi) valvotaan tietokannassa, ei selaimessa.

## Mitä sovellus tekee

| Vaatimus | Toteutus |
|---|---|
| Kahdenkertainen kirjanpito (KPL 2:1) | Tilikartta (PMA:n tase- ja tuloslaskelmakaavat), tositteet ja viennit. Tietokanta hylkää tositteen, jonka debet ≠ kredit. |
| Päiväkirja ja pääkirja (KPL 2:4) | Kirjanpito-sivu, CSV-vienti |
| Aukoton tositenumerointi | Numerot tilikausittain tietokannassa rivilukolla |
| Kirjauksia ei muuteta (KPL 2:7) | Tositteita ja vientejä ei voi muuttaa eikä poistaa (trigger). Virheet korjataan oikaisutositteella. |
| Tositteet (KPL 2:5) ja säilytys (KPL 2:10) | Kuitit ja laskut yksityiseen Storage-bucketiin. Liitteitä ei voi poistaa eikä korvata. |
| Laskumerkinnät (AVL 209 e §) | Aukoton laskunumero lähetettäessä, toimituspäivä, myyjän ja ostajan tunnisteet, ALV verokannoittain, käännetyn verovelvollisuuden tekstit, kotipaikka |
| Lähetetty lasku lukittu | Muutos ja poisto estetty tietokannassa. Korjaus tehdään hyvityslaskulla. |
| ALV | Kannat toimituspäivän mukaan (25,5 / 13,5 / 10 / 0 %), EU-myynti, EU:n ja EU:n ulkopuoliset palveluostot (käännetty verovelvollisuus), vähennyskelvoton ALV, OmaVeron kausiveroilmoituksen kentät, ALV-tilitys, yhteenvetoilmoitus |
| Pankki | camt.053- ja CSV-tiliotteiden tuonti, maksujen kohdistus viitteellä, kaikki tapahtumat kirjataan |
| Tilinpäätös | Tuloslaskelma ja tase vertailutietoineen, liitetietopohja (mikroyritys), tilikauden lukitus |
| Verkkolasku | Finvoice 3.0 XML lähetettäväksi operaattorin kautta |
| Muutosloki | Kaikki muutokset kirjautuvat pysyvästi `muutosloki`-tauluun |
| Tietoturva | RLS, kirjoitukset vain tietokantafunktioiden kautta, MFA (TOTP) pakotettu tietokannassa, rekisteröitymisen esto, XSS-suojattu renderöinti, CSP ja muut tietoturvaotsakkeet, 30 min aikakatkaisu |

## Mitä sovellus ei tee

- **Palkat**: palkanlaskenta, tulorekisteri-ilmoitukset ja työnantajasuoritukset tehdään erikseen
  (esim. palkanlaskentapalvelu). Palkan kirjaus muistiotositteella (5000 / 6130 / 2900 / 1910).
- **Ilmoitukset Verohallinnolle ja PRH:lle**: luvut siirretään käsin OmaVeroon (kausiveroilmoitus,
  yhteenvetoilmoitus, veroilmoitus 6B, tilinpäätöksen toimitus PRH:lle).
- **Verkkolaskujen lähetys**: Finvoice-tiedosto ladataan ja lähetetään operaattorin palvelussa.
- **Poistot, jaksotukset, tuloverot**: kirjataan muistiotositteilla tilinpäätöksessä.
- **Maksuperusteinen ALV** ja **marginaaliverotus**: ei tuettu. Sovellus käyttää suoriteperustetta.

Sovellus ei ole tilitoimisto. Ensimmäisestä tilinpäätöksestä kannattaa pyytää tilitoimistolta tarkistus.

## Käyttöönotto

### 1. Supabase-projekti

1. Luo projekti **EU-alueelle** (esim. Frankfurt tai Stockholm), koska tiedot sisältävät henkilötietoja.
2. Aja migraatiot järjestyksessä: `supabase db push` tai SQL Editorissa
   `supabase/migrations/20260401000000_kirjanpito_schema.sql` ja sitten
   `supabase/migrations/20261017000000_lakisaateinen_kirjanpito.sql`.
   Migraatio on idempotentti ja säilyttää olemassa olevat tiedot.
3. **Authentication → Sign In / Providers → Email**: poista *Allow new users to sign up* käytöstä,
   aseta salasanan vähimmäispituudeksi 12 ja ota käyttöön *Leaked password protection*.
4. **Authentication → Multi-Factor**: TOTP päälle (oletuksena päällä).
5. Salli kirjautujat. Tietokanta estää kaikki muut rekisteröitymiset:
   ```sql
   insert into public.sallitut_kayttajat (sahkoposti) values ('cenk@voon.fi');
   ```
   Luo käyttäjä sen jälkeen kohdassa *Authentication → Users → Add user*.
6. **Varmuuskopiot**: käytä tuotannossa maksullista tasoa (päivittäiset varmuuskopiot). Lataa lisäksi
   sovelluksen JSON-varmuuskopio kuukausittain ja tilinpäätöksen jälkeen. Kirjanpitokirjat on säilytettävä
   10 vuotta ja tositteet 6 vuotta.

### 2. Vercel

Ympäristömuuttujat: `VITE_SUPABASE_URL` ja `VITE_SUPABASE_ANON_KEY`. Tietoturvaotsakkeet ja CSP ovat
tiedostossa `vercel.json`. Jos käytät omaa Supabase-verkkotunnusta, lisää se CSP:n `connect-src`- ja
`img-src`-kohtiin.

### 3. Ensimmäinen kirjautuminen

1. **Asetukset → Turvallisuus**: ota kaksivaiheinen tunnistautuminen käyttöön.
2. **Asetukset → Yritystiedot**: nimi, Y-tunnus, kotipaikka, osoite, IBAN, ALV-rekisteröinti ja verokausi.
3. **Asetukset → Tilikaudet**: sovellus luo kalenterivuoden. Vaihda tarvittaessa ensimmäinen tilikausi
   alkamaan rekisteröintipäivästä. Ensimmäinen tilikausi voi olla enintään 18 kk, esim. 1.11.2026–31.12.2027.
4. **Osakepääoma**: kirjaa muistiotositteella (Debet 1910 Pankkitili / Kredit 2000 Osakepääoma) tai
   tuo pankkitapahtuma ja kirjaa se tilille 2000.
5. Jos sovelluksen vanhalla versiolla on luotu laskuja tai kuluja: **Asetukset → Kirjaa vanhan version
   laskut ja kulut pääkirjaan**. Vanhoille luonnoksille annetut numerot vapautetaan, ja numero annetaan
   vasta lähetettäessä.

## Kehitys

```bash
npm ci
cp .env.example .env    # lisää Supabasen URL ja anon key
npm run dev
npm test                # yksikkötestit (laskenta, viitteet, viivakoodi, tiliotteet, Finvoice, XSS)
npm run test:db         # tietokantatestit paikallista PostgreSQL:ää vasten (ks. supabase/tests/run.sh)
npm run build
```

`supabase/tests/run.sh` luo tyhjän tietokannan, Supabasen auth- ja storage-skeemojen tyngät, ajaa
migraatiot (myös toiseen kertaan idempotenssin tarkistamiseksi) ja testaa mm. täsmäytyksen,
lukitukset, aukottoman numeroinnin, hyvityslaskut, ALV-laskelman, RLS-eristyksen ja MFA-vaatimuksen.

## Rakenne

```
src/utils/laskuri.js     ALV, pyöristys (sentit, BigInt), viitteet, viivakoodi, YEL, verokaudet
src/utils/html.js        XSS-turvallinen html``-tagi
src/utils/supabase.js    Tietokanta- ja RPC-kutsut
src/utils/pankki.js      camt.053- ja CSV-jäsennys, maksujen kohdistus
src/utils/finvoice.js    Finvoice 3.0
src/js/*                 Näkymät
supabase/migrations      Tietokanta, säännöt ja RPC-funktiot
supabase/tests           Tietokantatestit
tests/                   Yksikkötestit (vitest)
```
