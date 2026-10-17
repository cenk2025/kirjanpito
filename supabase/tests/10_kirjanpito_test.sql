-- Kirjanpidon tietokantatestit. Ajetaan run.sh:lla.
\set ON_ERROR_STOP 1
SET client_min_messages = warning;

-- Apufunktio: odottaa, että SQL epäonnistuu
CREATE OR REPLACE FUNCTION public.testi_odota_virhe(p_sql TEXT, p_viesti TEXT)
RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  BEGIN
    EXECUTE p_sql;
  EXCEPTION WHEN OTHERS THEN
    IF SQLERRM NOT ILIKE '%' || p_viesti || '%' THEN
      RAISE EXCEPTION 'Väärä virhe lauseelle %: % (odotettiin %)', p_sql, SQLERRM, p_viesti;
    END IF;
    RETURN;
  END;
  RAISE EXCEPTION 'Lauseen piti epäonnistua: %', p_sql;
END $$;
GRANT EXECUTE ON FUNCTION public.testi_odota_virhe(TEXT, TEXT) TO authenticated;

CREATE OR REPLACE FUNCTION public.testi_assert(p BOOLEAN, p_viesti TEXT)
RETURNS void LANGUAGE plpgsql AS $$
BEGIN IF p IS NOT TRUE THEN RAISE EXCEPTION 'TESTI EPÄONNISTUI: %', p_viesti; END IF; END $$;
GRANT EXECUTE ON FUNCTION public.testi_assert(BOOLEAN, TEXT) TO authenticated;

-- ─── Rekisteröitymisen esto ────────────────────────────────────────────
SELECT testi_odota_virhe($$INSERT INTO auth.users (id, email) VALUES (gen_random_uuid(), 'hyokkaaja@example.com')$$,
                         'Rekisteröityminen ei ole sallittu');
INSERT INTO sallitut_kayttajat VALUES ('omistaja@voon.fi'), ('toinen@example.com');
INSERT INTO auth.users (id, email) VALUES
  ('11111111-1111-1111-1111-111111111111', 'omistaja@voon.fi'),
  ('22222222-2222-2222-2222-222222222222', 'toinen@example.com');

-- ─── Käyttäjä 1 ────────────────────────────────────────────────────────
SET ROLE authenticated;
SELECT set_config('request.jwt.claim.sub', '11111111-1111-1111-1111-111111111111', false);

SELECT alusta_kirjanpito();
SELECT testi_assert((SELECT count(*) FROM tilit) > 40, 'tilikartta alustettu');
SELECT testi_odota_virhe($$SELECT luo_tilikausi('2026-06-01', '2027-05-31')$$, 'päällekkäin');

UPDATE profiilit SET yritys_nimi = 'VOON IQ Oy', y_tunnus = '1234567-8', osoite = 'Testikatu 1',
  postinumero = '40100', kaupunki = 'Jyväskylä', kotipaikka = 'Jyväskylä',
  iban = 'FI2112345600000785', bic = 'NDEAFIHH'
 WHERE user_id = auth.uid();

INSERT INTO asiakkaat (id, user_id, nimi, y_tunnus, maa)
VALUES ('aaaaaaaa-0000-0000-0000-000000000001', auth.uid(), 'Jyväskylän kaupunki', '0208201-1', 'FI');
INSERT INTO asiakkaat (id, user_id, nimi, alv_tunnus, maa)
VALUES ('aaaaaaaa-0000-0000-0000-000000000002', auth.uid(), 'Svensk AB', 'SE556677889901', 'SE');

-- Suora kirjoitus kirjanpitoon on estetty
SELECT testi_odota_virhe($$INSERT INTO tositteet (user_id, tilikausi_id, numero, pvm, selite, lahde)
  SELECT auth.uid(), id, 99, '2026-01-01', 'x', 'muistio' FROM tilikaudet LIMIT 1$$, 'permission denied');
SELECT testi_odota_virhe($$DELETE FROM tilikaudet$$, 'permission denied');
SELECT testi_odota_virhe($$INSERT INTO kulut (user_id, paiva, kuvaus, summa) VALUES (auth.uid(), '2026-01-01', 'x', 1)$$,
                         'permission denied');
SELECT testi_odota_virhe($$SELECT _kirjaa_tosite(auth.uid(), '2026-01-01', 'x', 'muistio', NULL, '[]')$$, 'permission denied');

-- Luonnos ei voi olla suoraan lähetetty
SELECT testi_odota_virhe($$INSERT INTO laskut (user_id, asiakas_id, laskupaiva, erapaiva, tila)
  VALUES (auth.uid(), 'aaaaaaaa-0000-0000-0000-000000000001', '2026-02-01', '2026-02-15', 'lahetetty')$$,
  'luonnoksena');

-- Lasku 1: 25,5 % ja 0 % rivit (0 % ei saa muuttua 25,5 %:ksi)
INSERT INTO laskut (id, user_id, asiakas_id, laskupaiva, erapaiva, tila)
VALUES ('bbbbbbbb-0000-0000-0000-000000000001', auth.uid(), 'aaaaaaaa-0000-0000-0000-000000000001',
        '2026-02-01', '2026-02-15', 'luonnos');
INSERT INTO laskurivit (lasku_id, kuvaus, maara, yksikkohinta, alv_kanta) VALUES
  ('bbbbbbbb-0000-0000-0000-000000000001', 'SkillPath-lisenssi', 1, 900, 25.5),
  ('bbbbbbbb-0000-0000-0000-000000000001', 'Koulutus', 3, 33.33, 0);

SELECT laheta_lasku('bbbbbbbb-0000-0000-0000-000000000001');
SELECT testi_assert((SELECT laskunumero = '2026-001' AND summa_veroton = 999.99 AND summa_alv = 229.50
                       AND summa_verollinen = 1229.49 AND viitenumero = '20260011'
                       AND myyja ->> 'alv_tunnus' = 'FI12345678'
                     FROM laskut WHERE id = 'bbbbbbbb-0000-0000-0000-000000000001'), 'laskun summat ja numero');

-- Lähetetty lasku on lukittu
SELECT testi_odota_virhe($$UPDATE laskut SET erapaiva = '2026-03-01' WHERE id = 'bbbbbbbb-0000-0000-0000-000000000001'$$,
                         'ei voi muuttaa');
SELECT testi_odota_virhe($$DELETE FROM laskut WHERE id = 'bbbbbbbb-0000-0000-0000-000000000001'$$, 'ei voi poistaa');
SELECT testi_odota_virhe($$UPDATE laskurivit SET yksikkohinta = 1 WHERE lasku_id = 'bbbbbbbb-0000-0000-0000-000000000001'$$,
                         'rivejä ei voi muuttaa');
SELECT testi_odota_virhe($$DELETE FROM asiakkaat WHERE id = 'aaaaaaaa-0000-0000-0000-000000000001'$$, 'foreign key');

-- Maksut: osittainen + loput, ylimaksu estetään
SELECT kirjaa_maksu('bbbbbbbb-0000-0000-0000-000000000001', '2026-02-10', 200);
SELECT testi_assert((SELECT tila FROM laskut WHERE id = 'bbbbbbbb-0000-0000-0000-000000000001') = 'osittain', 'osittain maksettu');
SELECT testi_odota_virhe($$SELECT kirjaa_maksu('bbbbbbbb-0000-0000-0000-000000000001', '2026-02-11', 2000)$$, 'ylittää');
SELECT kirjaa_maksu('bbbbbbbb-0000-0000-0000-000000000001', '2026-02-12', 1029.49);
SELECT testi_assert((SELECT tila FROM laskut WHERE id = 'bbbbbbbb-0000-0000-0000-000000000001') = 'maksettu', 'maksettu');

-- Lasku 2: EU-palvelumyynti ilman ALV:tä → hyvitys
INSERT INTO laskut (id, user_id, asiakas_id, laskupaiva, erapaiva, alv_kasittely)
VALUES ('bbbbbbbb-0000-0000-0000-000000000002', auth.uid(), 'aaaaaaaa-0000-0000-0000-000000000002',
        '2026-03-05', '2026-03-19', 'eu_palvelu');
INSERT INTO laskurivit (lasku_id, kuvaus, maara, yksikkohinta, alv_kanta) VALUES
  ('bbbbbbbb-0000-0000-0000-000000000002', 'AI consulting', 10, 100, 25.5);
SELECT testi_odota_virhe($$SELECT laheta_lasku('bbbbbbbb-0000-0000-0000-000000000002')$$, 'verokannan');
UPDATE laskurivit SET alv_kanta = 0 WHERE lasku_id = 'bbbbbbbb-0000-0000-0000-000000000002';
SELECT laheta_lasku('bbbbbbbb-0000-0000-0000-000000000002');
SELECT testi_assert((SELECT laskunumero FROM laskut WHERE id = 'bbbbbbbb-0000-0000-0000-000000000002') = '2026-002', 'aukoton numero');

SELECT luo_hyvityslasku('bbbbbbbb-0000-0000-0000-000000000002', 'Väärä asiakas', '2026-03-20');
SELECT testi_assert((SELECT tila FROM laskut WHERE id = 'bbbbbbbb-0000-0000-0000-000000000002') = 'hyvitetty', 'hyvitetty');
SELECT testi_assert((SELECT summa_verollinen = -1000 AND laskunumero = '2026-003'
                     FROM laskut WHERE hyvitettava_id = 'bbbbbbbb-0000-0000-0000-000000000002'), 'hyvityslasku');
SELECT testi_odota_virhe($$SELECT kirjaa_maksu('bbbbbbbb-0000-0000-0000-000000000002', '2026-03-21', 10)$$, 'ei voi kirjata');

-- Luonnoksen voi poistaa; poisto ei kuluta numeroa
INSERT INTO laskut (id, user_id, asiakas_id, laskupaiva, erapaiva)
VALUES ('bbbbbbbb-0000-0000-0000-000000000003', auth.uid(), 'aaaaaaaa-0000-0000-0000-000000000001', '2026-03-25', '2026-04-08');
INSERT INTO laskurivit (lasku_id, kuvaus, maara, yksikkohinta, alv_kanta)
VALUES ('bbbbbbbb-0000-0000-0000-000000000003', 'x', 1, 1, 25.5);
DELETE FROM laskut WHERE id = 'bbbbbbbb-0000-0000-0000-000000000003';

-- Kulut
SELECT tallenna_kulu('{"paiva":"2026-02-03","kuvaus":"Näyttö","toimittaja":"Verkkokauppa","summa":124,"alv_kanta":25.5,"tili":"7870"}');
SELECT testi_assert((SELECT alv_summa = 25.20 AND veroton_summa = 98.80 FROM kulut WHERE kuvaus = 'Näyttö'), 'kulun ALV');
SELECT tallenna_kulu('{"paiva":"2026-02-04","kuvaus":"Asiakaslounas","summa":50.20,"alv_kanta":13.5,"tili":"7600","alv_vahennys":false}');
SELECT tallenna_kulu('{"paiva":"2026-02-05","kuvaus":"API-käyttö","toimittaja":"US AI Inc","summa":100,"alv_kanta":25.5,"tili":"7860","alv_kasittely":"ei_eu_palveluosto"}');
SELECT tallenna_kulu('{"paiva":"2026-02-06","kuvaus":"Pilvipalvelu","toimittaja":"Cloud Ireland Ltd","summa":200,"alv_kanta":25.5,"tili":"7860","alv_kasittely":"eu_palveluosto"}');
SELECT testi_odota_virhe($$SELECT tallenna_kulu('{"paiva":"2026-02-06","kuvaus":"x","summa":1,"tili":"7860","liitteet":["22222222-2222-2222-2222-222222222222/a.pdf"]}')$$,
                         'liitepolku');

-- Kulun korjaus: vanha tosite oikaistaan
SELECT tallenna_kulu(jsonb_build_object('id', (SELECT id FROM kulut WHERE kuvaus = 'Näyttö'),
  'paiva','2026-02-03','kuvaus','Näyttö','summa',125.50,'alv_kanta',25.5,'tili','7870'));
SELECT testi_assert((SELECT count(*) FROM tositteet WHERE lahde = 'oikaisu') = 1, 'kulun korjaus oikaisutositteella');
SELECT peru_kulu((SELECT id FROM kulut WHERE kuvaus = 'Asiakaslounas'), 'Yksityinen meno');
SELECT testi_assert((SELECT tila FROM kulut WHERE kuvaus = 'Asiakaslounas') = 'peruttu', 'kulu peruttu');

-- Muistiotosite: osakepääoma
SELECT kirjaa_muistiotosite('2026-01-02', 'Osakepääoman maksu',
  '[{"tili":"1910","debet":2500},{"tili":"2000","kredit":2500}]');
SELECT testi_odota_virhe($$SELECT kirjaa_muistiotosite('2026-01-02', 'x', '[{"tili":"1910","debet":10},{"tili":"2000","kredit":9}]')$$,
                         'ei täsmää');

-- Kirjauksia ei voi muuttaa edes funktiolla (trigger)
RESET ROLE;
SELECT testi_odota_virhe($$UPDATE viennit SET debet = debet + 1$$, 'ei voi muuttaa');
SELECT testi_odota_virhe($$DELETE FROM tositteet$$, 'ei voi muuttaa');
SET ROLE authenticated;

-- ALV-laskelma Q1/2026
SELECT testi_assert((SELECT
    (v ->> 'vero_255')::numeric = 229.50 + 25.50       -- myynti + EU:n ulkop. palveluosto
    AND (v ->> 'myynti_255')::numeric = 900
    AND (v ->> 'vero_eu_palveluostot')::numeric = 51.00
    AND (v ->> 'eu_palveluostot')::numeric = 200
    AND (v ->> 'ei_eu_palveluostot')::numeric = 100
    AND (v ->> 'eu_palvelumyynti')::numeric = 0        -- myynti + hyvitys = 0
    AND (v ->> 'vahennettava_vero')::numeric = 25.50 + 25.50 + 51.00  -- korjattu näyttö + palveluostot
    AND (v ->> 'maksettava')::numeric = 204.00
  FROM (SELECT alv_laskelma('2026-01-01', '2026-03-31') v) s), 'ALV-laskelma');

SELECT kirjaa_alv_tilitys('2026-01-01', '2026-03-31');
SELECT testi_odota_virhe($$SELECT kirjaa_alv_tilitys('2026-01-01', '2026-03-31')$$, 'jo tilitetty');
SELECT testi_odota_virhe($$SELECT kirjaa_alv_tilitys('2026-10-01', '2026-12-31')$$, 'ei ole vielä päättynyt');

-- Saldot: debet = kredit, 1701 = 0, ALV-tilit nollautuneet
SELECT testi_assert((SELECT sum(loppusaldo) = 0 FROM tilisaldot('2026-01-01', '2026-12-31')), 'pääkirja täsmää');
SELECT testi_assert((SELECT loppusaldo FROM tilisaldot('2026-01-01', '2026-12-31') WHERE numero = '1701') = 0, 'myyntisaamiset');
SELECT testi_assert((SELECT loppusaldo FROM tilisaldot('2026-01-01', '2026-12-31') WHERE numero = '2939') = 0, 'myynnin ALV tilitetty');
SELECT testi_assert((SELECT loppusaldo FROM tilisaldot('2026-01-01', '2026-12-31') WHERE numero = '2935') = -204.00, 'ALV-velka');
SELECT testi_assert((SELECT bool_and(numero = rn) FROM (
    SELECT numero, row_number() OVER (ORDER BY numero) rn FROM tositteet) s), 'aukoton tositenumerointi');

-- Pankki: tuonti, duplikaatit, kirjaus
SELECT tuo_pankkitapahtumat('[{"pvm":"2026-04-12","summa":-204.00,"vastapuoli":"Verohallinto","viite":"RF123","arkistointitunnus":"A1"},
                              {"pvm":"2026-04-13","summa":-9.90,"vastapuoli":"Pankki","viesti":"Palvelumaksu"}]');
SELECT testi_assert((tuo_pankkitapahtumat('[{"pvm":"2026-04-12","summa":-204.00,"arkistointitunnus":"A1"}]') ->> 'lisatty')::int = 0, 'duplikaatti ohitettu');
SELECT kirjaa_pankkitapahtuma((SELECT id FROM pankkitapahtumat WHERE arkistointitunnus = 'A1'), '2935', 'ALV Q1/2026');
SELECT tallenna_kulu(jsonb_build_object('paiva','2026-04-13','kuvaus','Palvelumaksu','summa',9.90,
  'alv_kasittely','ei_alv','tili','7920','pankkitapahtuma_id',(SELECT id FROM pankkitapahtumat WHERE summa = -9.90)));
SELECT testi_assert((SELECT count(*) FROM pankkitapahtumat WHERE tila = 'kasitelty') = 2, 'pankkitapahtumat käsitelty');

-- Muutosloki
SELECT testi_assert((SELECT count(*) FROM muutosloki WHERE taulu = 'laskut') > 3, 'muutosloki');
SELECT testi_odota_virhe($$DELETE FROM muutosloki$$, 'permission denied');

-- Tilikauden lukitus
SELECT luo_tilikausi('2025-01-01', '2025-12-31');
SELECT kirjaa_muistiotosite('2025-12-31', 'Testi 2025', '[{"tili":"1910","debet":1},{"tili":"2875","kredit":1}]');
SELECT testi_odota_virhe($$SELECT lukitse_tilikausi((SELECT id FROM tilikaudet WHERE alku = '2026-01-01'))$$, 'ei ole vielä päättynyt');
SELECT lukitse_tilikausi((SELECT id FROM tilikaudet WHERE alku = '2025-01-01'));
SELECT testi_odota_virhe($$SELECT kirjaa_muistiotosite('2025-06-01', 'x', '[{"tili":"1910","debet":1},{"tili":"2875","kredit":1}]')$$,
                         'lukittu');

-- ─── Käyttäjä 2 ei näe käyttäjän 1 tietoja ─────────────────────────────
SELECT set_config('request.jwt.claim.sub', '22222222-2222-2222-2222-222222222222', false);
SELECT testi_assert((SELECT count(*) FROM laskut) = 0 AND (SELECT count(*) FROM tositteet) = 0
                    AND (SELECT count(*) FROM kulut) = 0 AND (SELECT count(*) FROM muutosloki) = 0, 'RLS eristys');
SELECT testi_odota_virhe($$SELECT laheta_lasku('bbbbbbbb-0000-0000-0000-000000000001')$$, 'ei löydy');
SELECT testi_odota_virhe($$SELECT kirjaa_maksu('bbbbbbbb-0000-0000-0000-000000000001', '2026-02-10', 1)$$, 'ei löydy');
SELECT alusta_kirjanpito();
SELECT testi_odota_virhe($$INSERT INTO laskut (user_id, asiakas_id, laskupaiva, erapaiva)
  VALUES (auth.uid(), 'aaaaaaaa-0000-0000-0000-000000000001', '2026-01-01', '2026-01-02')$$, 'Asiakasta ei löydy');

-- ─── MFA: kun tekijä on vahvistettu, aal1-istunto ei näe mitään ────────
RESET ROLE;
INSERT INTO auth.factors (user_id, status) VALUES ('11111111-1111-1111-1111-111111111111', 'verified');
SET ROLE authenticated;
SELECT set_config('request.jwt.claim.sub', '11111111-1111-1111-1111-111111111111', false);
SELECT set_config('request.jwt.claim.aal', 'aal1', false);
SELECT testi_assert((SELECT count(*) FROM laskut) = 0, 'MFA estää lukemisen aal1:llä');
SELECT testi_odota_virhe($$SELECT alv_laskelma('2026-01-01', '2026-03-31')$$, 'Kaksivaiheinen');
SELECT set_config('request.jwt.claim.aal', 'aal2', false);
SELECT testi_assert((SELECT count(*) FROM laskut) > 0, 'MFA aal2 näkee');

-- ─── Anonyymi ei näe mitään ────────────────────────────────────────────
RESET ROLE;
SET ROLE anon;
SELECT testi_odota_virhe($$SELECT count(*) FROM laskut$$, 'permission denied');
SELECT testi_odota_virhe($$SELECT alusta_kirjanpito()$$, 'permission denied');
RESET ROLE;
