-- ═══════════════════════════════════════════════════════════════════════
-- KIRJANPITO — Lakisääteinen kahdenkertainen kirjanpito (Oy)
--
-- Kirjanpitolaki (KPL 1336/1997), kirjanpitoasetus, PMA (1753/2015),
-- arvonlisäverolaki (AVL 1501/1993, laskumerkinnät 209 e §).
--
-- Periaatteet:
--   * Jokainen liiketapahtuma kirjataan tositteelle (tositteet + viennit).
--     Debet = kredit jokaisella tositteella (tarkistetaan tietokannassa).
--   * Kirjauksia ei voi muuttaa eikä poistaa. Virhe korjataan
--     oikaisutositteella (KPL 2:7 §, kirjausketju säilyy).
--   * Tositteet numeroidaan aukottomasti tilikausittain.
--   * Lähetettyä laskua ei voi muuttaa eikä poistaa: korjaus hyvityslaskulla.
--     Laskunumerot annetaan aukottomasti vasta lähetyshetkellä.
--   * Lukittuun tilikauteen ei voi kirjata.
--   * Kaikki kirjoitukset kirjanpitoon tapahtuvat SECURITY DEFINER
--     -funktioiden kautta; selain ei voi kirjoittaa tauluihin suoraan.
--   * Kaikista muutoksista jää muutosloki.
--   * Jos käyttäjällä on MFA käytössä, kaikki tietoon pääsy vaatii aal2:n.
--
-- Migraatio on idempotentti ja säilyttää olemassa olevan datan.
-- ═══════════════════════════════════════════════════════════════════════


-- ─── Apufunktiot: tunnistus ja MFA ─────────────────────────────────────

CREATE OR REPLACE FUNCTION public.mfa_ok()
RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = public, auth, pg_temp
AS $$
  SELECT CASE
    WHEN EXISTS (
      SELECT 1 FROM auth.mfa_factors f
      WHERE f.user_id = auth.uid() AND f.status = 'verified'
    ) THEN coalesce(auth.jwt() ->> 'aal', 'aal1') = 'aal2'
    ELSE true
  END
$$;

-- Palauttaa kirjautuneen käyttäjän id:n tai keskeyttää.
CREATE OR REPLACE FUNCTION public.vaadi_kayttaja()
RETURNS uuid
LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path = public, auth, pg_temp
AS $$
DECLARE
  v uuid := auth.uid();
BEGIN
  IF v IS NULL THEN
    RAISE EXCEPTION 'Kirjautuminen vaaditaan' USING ERRCODE = '28000';
  END IF;
  IF NOT public.mfa_ok() THEN
    RAISE EXCEPTION 'Kaksivaiheinen tunnistautuminen vaaditaan' USING ERRCODE = '28000';
  END IF;
  RETURN v;
END $$;

-- Selaimen suorat kirjoitukset tulevat roolilla "authenticated".
-- SECURITY DEFINER -funktioissa current_user on funktion omistaja.
CREATE OR REPLACE FUNCTION public._suora_kirjoitus()
RETURNS boolean
LANGUAGE sql STABLE
AS $$ SELECT current_user IN ('authenticated', 'anon') $$;

-- ─── Rekisteröitymisen esto (vain sallitut sähköpostit) ───────────────

CREATE TABLE IF NOT EXISTS public.sallitut_kayttajat (
  sahkoposti TEXT PRIMARY KEY,
  lisatty    TIMESTAMPTZ DEFAULT NOW()
);
ALTER TABLE public.sallitut_kayttajat ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.sallitut_kayttajat FROM anon, authenticated;

CREATE OR REPLACE FUNCTION public._tarkista_rekisteroityminen()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM public.sallitut_kayttajat s
    WHERE lower(s.sahkoposti) = lower(NEW.email)
  ) THEN
    RAISE EXCEPTION 'Rekisteröityminen ei ole sallittu' USING ERRCODE = '42501';
  END IF;
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS tr_rajoita_rekisteroityminen ON auth.users;
CREATE TRIGGER tr_rajoita_rekisteroityminen
  BEFORE INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION public._tarkista_rekisteroityminen();

-- ─── Profiili: Oy:n tiedot ─────────────────────────────────────────────

ALTER TABLE profiilit ADD COLUMN IF NOT EXISTS yhtiomuoto       TEXT DEFAULT 'oy';
ALTER TABLE profiilit ADD COLUMN IF NOT EXISTS kotipaikka       TEXT;
ALTER TABLE profiilit ADD COLUMN IF NOT EXISTS alv_rekisteroity BOOLEAN DEFAULT true;
ALTER TABLE profiilit ADD COLUMN IF NOT EXISTS verkkolaskuosoite TEXT;
ALTER TABLE profiilit ADD COLUMN IF NOT EXISTS valittajatunnus  TEXT;
ALTER TABLE profiilit ADD COLUMN IF NOT EXISTS viitekorko       NUMERIC(5,2) DEFAULT 2.00;
ALTER TABLE profiilit ADD COLUMN IF NOT EXISTS huomautusaika    INTEGER DEFAULT 7;
ALTER TABLE profiilit ALTER COLUMN viivastyskorko SET DEFAULT 'Viivästyskorko korkolain mukaan.';

-- ─── Asiakkaat ─────────────────────────────────────────────────────────

ALTER TABLE asiakkaat ADD COLUMN IF NOT EXISTS tyyppi TEXT DEFAULT 'yritys';
ALTER TABLE asiakkaat ADD COLUMN IF NOT EXISTS verkkolaskuosoite TEXT;
ALTER TABLE asiakkaat ADD COLUMN IF NOT EXISTS valittajatunnus TEXT;
ALTER TABLE asiakkaat ADD COLUMN IF NOT EXISTS arkistoitu BOOLEAN DEFAULT false;
DO $$ BEGIN
  ALTER TABLE asiakkaat ADD CONSTRAINT asiakkaat_tyyppi_check
    CHECK (tyyppi IN ('yritys', 'kuluttaja', 'julkinen'));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- ─── Tilikartta ────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS tilit (
  id        UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id   UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  numero    TEXT NOT NULL,
  nimi      TEXT NOT NULL,
  tyyppi    TEXT NOT NULL CHECK (tyyppi IN ('vastaavaa','oma_paaoma','vieras_paaoma','tuotto','kulu')),
  -- PMA:n tase- / tuloslaskelmarivi
  ryhma     TEXT NOT NULL,
  -- ALV:n oletuskäsittely kuluille: 'vahennys' | 'ei_vahennysta'
  alv_oletus TEXT DEFAULT 'vahennys',
  aktiivinen BOOLEAN DEFAULT true,
  luotu     TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE (user_id, numero)
);
CREATE INDEX IF NOT EXISTS idx_tilit_user ON tilit(user_id);

-- ─── Tilikaudet ────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS tilikaudet (
  id        UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id   UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  alku      DATE NOT NULL,
  loppu     DATE NOT NULL,
  lukittu   BOOLEAN NOT NULL DEFAULT false,
  lukittu_aika TIMESTAMPTZ,
  seuraava_tositenumero INTEGER NOT NULL DEFAULT 1,
  luotu     TIMESTAMPTZ DEFAULT NOW(),
  CHECK (loppu > alku),
  UNIQUE (user_id, alku)
);
CREATE INDEX IF NOT EXISTS idx_tilikaudet_user ON tilikaudet(user_id);

-- ─── Tositteet ja viennit (pääkirja / päiväkirja) ─────────────────────

CREATE TABLE IF NOT EXISTS tositteet (
  id          UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id     UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  tilikausi_id UUID NOT NULL REFERENCES tilikaudet(id) ON DELETE RESTRICT,
  numero      INTEGER NOT NULL,
  pvm         DATE NOT NULL,
  selite      TEXT NOT NULL,
  lahde       TEXT NOT NULL CHECK (lahde IN (
                'myyntilasku','hyvityslasku','maksu','kulu','pankki',
                'muistio','oikaisu','alv_tilitys','avaus')),
  lahde_id    UUID,
  -- Jos tämä tosite on oikaisu, viittaus oikaistuun tositteeseen
  oikaisee_id UUID REFERENCES tositteet(id) ON DELETE RESTRICT,
  oikaistu    BOOLEAN NOT NULL DEFAULT false,
  luotu       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  luoja       UUID,
  UNIQUE (tilikausi_id, numero)
);
CREATE INDEX IF NOT EXISTS idx_tositteet_user_pvm ON tositteet(user_id, pvm);
CREATE INDEX IF NOT EXISTS idx_tositteet_lahde ON tositteet(lahde, lahde_id);

CREATE TABLE IF NOT EXISTS viennit (
  id         UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  tosite_id  UUID NOT NULL REFERENCES tositteet(id) ON DELETE RESTRICT,
  user_id    UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  tili_id    UUID NOT NULL REFERENCES tilit(id) ON DELETE RESTRICT,
  debet      NUMERIC(14,2) NOT NULL DEFAULT 0,
  kredit     NUMERIC(14,2) NOT NULL DEFAULT 0,
  -- ALV-raportointia varten
  alv_koodi  TEXT,
  alv_kanta  NUMERIC(5,2),
  selite     TEXT,
  CHECK (debet >= 0 AND kredit >= 0 AND (debet = 0 OR kredit = 0) AND (debet + kredit) > 0)
);
CREATE INDEX IF NOT EXISTS idx_viennit_tosite ON viennit(tosite_id);
CREATE INDEX IF NOT EXISTS idx_viennit_user_tili ON viennit(user_id, tili_id);

-- Debet = kredit, tarkistus transaktion lopussa
CREATE OR REPLACE FUNCTION public._tarkista_tosite_tasapaino()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public, pg_temp
AS $$
DECLARE
  v_d NUMERIC; v_k NUMERIC; v_n INTEGER;
BEGIN
  SELECT coalesce(sum(debet),0), coalesce(sum(kredit),0), count(*)
    INTO v_d, v_k, v_n
    FROM viennit WHERE tosite_id = NEW.tosite_id;
  IF v_n < 2 OR v_d <> v_k THEN
    RAISE EXCEPTION 'Tosite ei täsmää (debet % / kredit %)', v_d, v_k;
  END IF;
  RETURN NULL;
END $$;

DROP TRIGGER IF EXISTS tr_viennit_tasapaino ON viennit;
CREATE CONSTRAINT TRIGGER tr_viennit_tasapaino
  AFTER INSERT ON viennit
  DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW EXECUTE FUNCTION public._tarkista_tosite_tasapaino();

-- Kirjauksia ei muuteta eikä poisteta (oikaistu-lippua lukuun ottamatta)
CREATE OR REPLACE FUNCTION public._esta_muutos()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF TG_OP = 'UPDATE' AND TG_TABLE_NAME = 'tositteet'
     AND NOT public._suora_kirjoitus()
     AND (to_jsonb(NEW) - 'oikaistu') = (to_jsonb(OLD) - 'oikaistu') THEN
    RETURN NEW;
  END IF;
  RAISE EXCEPTION 'Kirjanpidon kirjauksia ei voi muuttaa tai poistaa (%). Käytä oikaisutositetta.', TG_TABLE_NAME;
END $$;

DROP TRIGGER IF EXISTS tr_tositteet_lukko ON tositteet;
CREATE TRIGGER tr_tositteet_lukko BEFORE UPDATE OR DELETE ON tositteet
  FOR EACH ROW EXECUTE FUNCTION public._esta_muutos();
DROP TRIGGER IF EXISTS tr_viennit_lukko ON viennit;
CREATE TRIGGER tr_viennit_lukko BEFORE UPDATE OR DELETE ON viennit
  FOR EACH ROW EXECUTE FUNCTION public._esta_muutos();

-- Uusi tosite vain avoimelle tilikaudelle ja kauden sisälle
CREATE OR REPLACE FUNCTION public._tarkista_tosite_kausi()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public, pg_temp
AS $$
DECLARE k tilikaudet%ROWTYPE;
BEGIN
  SELECT * INTO k FROM tilikaudet WHERE id = NEW.tilikausi_id;
  IF k.user_id <> NEW.user_id THEN RAISE EXCEPTION 'Väärä tilikausi'; END IF;
  IF k.lukittu THEN RAISE EXCEPTION 'Tilikausi % – % on lukittu', k.alku, k.loppu; END IF;
  IF NEW.pvm < k.alku OR NEW.pvm > k.loppu THEN
    RAISE EXCEPTION 'Päivämäärä % ei kuulu tilikauteen % – %', NEW.pvm, k.alku, k.loppu;
  END IF;
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS tr_tositteet_kausi ON tositteet;
CREATE TRIGGER tr_tositteet_kausi BEFORE INSERT ON tositteet
  FOR EACH ROW EXECUTE FUNCTION public._tarkista_tosite_kausi();

-- Tilikautta ei voi avata uudelleen eikä poistaa
CREATE OR REPLACE FUNCTION public._tilikausi_lukko()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'Tilikautta ei voi poistaa';
  END IF;
  IF OLD.lukittu AND (NOT NEW.lukittu OR NEW.alku <> OLD.alku OR NEW.loppu <> OLD.loppu) THEN
    RAISE EXCEPTION 'Lukittua tilikautta ei voi muuttaa';
  END IF;
  IF (NEW.alku <> OLD.alku OR NEW.loppu <> OLD.loppu)
     AND EXISTS (SELECT 1 FROM tositteet WHERE tilikausi_id = OLD.id) THEN
    RAISE EXCEPTION 'Tilikauden rajoja ei voi muuttaa, kun sille on kirjauksia';
  END IF;
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS tr_tilikausi_lukko ON tilikaudet;
CREATE TRIGGER tr_tilikausi_lukko BEFORE UPDATE OR DELETE ON tilikaudet
  FOR EACH ROW EXECUTE FUNCTION public._tilikausi_lukko();

-- Käytössä olevan tilin numeroa/tyyppiä ei voi muuttaa
CREATE OR REPLACE FUNCTION public._tili_lukko()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF (NEW.numero <> OLD.numero OR NEW.tyyppi <> OLD.tyyppi OR NEW.ryhma <> OLD.ryhma)
     AND EXISTS (SELECT 1 FROM viennit WHERE tili_id = OLD.id) THEN
    RAISE EXCEPTION 'Tilillä on kirjauksia: numeroa, tyyppiä tai ryhmää ei voi muuttaa';
  END IF;
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS tr_tili_lukko ON tilit;
CREATE TRIGGER tr_tili_lukko BEFORE UPDATE ON tilit
  FOR EACH ROW EXECUTE FUNCTION public._tili_lukko();

-- ─── Laskut: lakisääteiset kentät, hyvityslaskut, lukitus ─────────────

ALTER TABLE laskut ALTER COLUMN laskunumero DROP NOT NULL;
ALTER TABLE laskut ADD COLUMN IF NOT EXISTS tyyppi          TEXT NOT NULL DEFAULT 'lasku';
ALTER TABLE laskut ADD COLUMN IF NOT EXISTS hyvitettava_id  UUID REFERENCES laskut(id) ON DELETE RESTRICT;
ALTER TABLE laskut ADD COLUMN IF NOT EXISTS toimituspaiva   DATE;
ALTER TABLE laskut ADD COLUMN IF NOT EXISTS alv_kasittely   TEXT NOT NULL DEFAULT 'normaali';
ALTER TABLE laskut ADD COLUMN IF NOT EXISTS maksuehto       INTEGER;
ALTER TABLE laskut ADD COLUMN IF NOT EXISTS myyja           JSONB;
ALTER TABLE laskut ADD COLUMN IF NOT EXISTS ostaja          JSONB;
ALTER TABLE laskut ADD COLUMN IF NOT EXISTS summa_veroton   NUMERIC(14,2);
ALTER TABLE laskut ADD COLUMN IF NOT EXISTS summa_alv       NUMERIC(14,2);
ALTER TABLE laskut ADD COLUMN IF NOT EXISTS summa_verollinen NUMERIC(14,2);
ALTER TABLE laskut ADD COLUMN IF NOT EXISTS alv_erittely    JSONB;
ALTER TABLE laskut ADD COLUMN IF NOT EXISTS maksettu_summa  NUMERIC(14,2) NOT NULL DEFAULT 0;
ALTER TABLE laskut ADD COLUMN IF NOT EXISTS lahetetty_aika  TIMESTAMPTZ;
ALTER TABLE laskut ADD COLUMN IF NOT EXISTS tosite_id       UUID REFERENCES tositteet(id) ON DELETE RESTRICT;
ALTER TABLE laskut ADD COLUMN IF NOT EXISTS hyvityksen_syy  TEXT;

ALTER TABLE laskut DROP CONSTRAINT IF EXISTS laskut_tila_check;
ALTER TABLE laskut ADD CONSTRAINT laskut_tila_check
  CHECK (tila IN ('luonnos','lahetetty','osittain','maksettu','hyvitetty','peruttu'));
DO $$ BEGIN
  ALTER TABLE laskut ADD CONSTRAINT laskut_tyyppi_check CHECK (tyyppi IN ('lasku','hyvitys'));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  ALTER TABLE laskut ADD CONSTRAINT laskut_alv_kasittely_check
    CHECK (alv_kasittely IN ('normaali','eu_palvelu','eu_tavara','vienti','veroton'));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- Vanhan sovelluksen luonnoksille annettuja numeroita ei ole laskutettu:
-- numero annetaan nyt vasta lähetettäessä.
UPDATE laskut SET laskunumero = NULL WHERE tila = 'luonnos' AND laskunumero IS NOT NULL;

DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM laskut WHERE laskunumero IS NOT NULL
              GROUP BY user_id, laskunumero HAVING count(*) > 1) THEN
    RAISE WARNING 'Laskuissa on päällekkäisiä numeroita: yksilöivää indeksiä ei luotu. Korjaa ja aja migraatio uudelleen.';
  ELSE
    CREATE UNIQUE INDEX IF NOT EXISTS uq_laskut_numero
      ON laskut(user_id, laskunumero) WHERE laskunumero IS NOT NULL;
  END IF;
END $$;

-- Asiakasta ei voi poistaa, jos sillä on laskuja (laskun tiedot säilyvät)
ALTER TABLE laskut DROP CONSTRAINT IF EXISTS laskut_asiakas_id_fkey;
ALTER TABLE laskut ADD CONSTRAINT laskut_asiakas_id_fkey
  FOREIGN KEY (asiakas_id) REFERENCES asiakkaat(id) ON DELETE RESTRICT;

-- Laskunumerosarjat (aukoton numerointi)
CREATE TABLE IF NOT EXISTS numerosarjat (
  user_id  UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  sarja    TEXT NOT NULL,
  seuraava INTEGER NOT NULL,
  PRIMARY KEY (user_id, sarja)
);

CREATE OR REPLACE FUNCTION public._lasku_lukko()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    IF public._suora_kirjoitus() THEN
      IF NEW.tila <> 'luonnos' OR NEW.laskunumero IS NOT NULL OR NEW.tosite_id IS NOT NULL
         OR NEW.tyyppi <> 'lasku' OR NEW.hyvitettava_id IS NOT NULL THEN
        RAISE EXCEPTION 'Uusi lasku tallennetaan luonnoksena; numero annetaan lähetettäessä';
      END IF;
      NEW.maksettu_summa := 0;
      NEW.myyja := NULL; NEW.ostaja := NULL;
      NEW.summa_veroton := NULL; NEW.summa_alv := NULL; NEW.summa_verollinen := NULL;
    END IF;
    RETURN NEW;
  END IF;

  IF TG_OP = 'DELETE' THEN
    IF OLD.tila <> 'luonnos' OR OLD.laskunumero IS NOT NULL THEN
      RAISE EXCEPTION 'Lähetettyä laskua ei voi poistaa. Tee hyvityslasku.';
    END IF;
    RETURN OLD;
  END IF;

  -- UPDATE
  IF public._suora_kirjoitus() THEN
    IF OLD.tila <> 'luonnos' THEN
      RAISE EXCEPTION 'Lähetettyä laskua ei voi muuttaa. Tee hyvityslasku.';
    END IF;
    IF NEW.tila <> 'luonnos' OR NEW.laskunumero IS NOT NULL OR NEW.tosite_id IS NOT NULL
       OR NEW.tyyppi <> OLD.tyyppi OR NEW.maksettu_summa <> OLD.maksettu_summa
       OR NEW.user_id <> OLD.user_id THEN
      RAISE EXCEPTION 'Laskun tila muuttuu vain toimintojen kautta (lähetä, kirjaa maksu, hyvitä)';
    END IF;
  ELSIF OLD.tila <> 'luonnos' AND OLD.tosite_id IS NOT NULL THEN
    -- Lähetetyssä (kirjatussa) laskussa vain maksu- ja tilatiedot voivat muuttua
    IF NEW.laskunumero IS DISTINCT FROM OLD.laskunumero
       OR NEW.laskupaiva <> OLD.laskupaiva OR NEW.erapaiva <> OLD.erapaiva
       OR NEW.toimituspaiva IS DISTINCT FROM OLD.toimituspaiva
       OR NEW.asiakas_id IS DISTINCT FROM OLD.asiakas_id
       OR NEW.summa_verollinen IS DISTINCT FROM OLD.summa_verollinen
       OR NEW.myyja IS DISTINCT FROM OLD.myyja OR NEW.ostaja IS DISTINCT FROM OLD.ostaja
       OR NEW.viitenumero IS DISTINCT FROM OLD.viitenumero
       OR NEW.alv_kasittely <> OLD.alv_kasittely
       OR NEW.lisatiedot IS DISTINCT FROM OLD.lisatiedot THEN
      RAISE EXCEPTION 'Lähetetyn laskun sisältöä ei voi muuttaa';
    END IF;
  END IF;
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS tr_laskut_lukko ON laskut;
CREATE TRIGGER tr_laskut_lukko BEFORE INSERT OR UPDATE OR DELETE ON laskut
  FOR EACH ROW EXECUTE FUNCTION public._lasku_lukko();

CREATE OR REPLACE FUNCTION public._laskurivi_lukko()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public, pg_temp
AS $$
DECLARE v_tila TEXT; v_id UUID;
BEGIN
  v_id := CASE WHEN TG_OP = 'DELETE' THEN OLD.lasku_id ELSE NEW.lasku_id END;
  SELECT tila INTO v_tila FROM laskut WHERE id = v_id;
  -- Laskun poisto (CASCADE) etenee vain luonnoksilla, joten v_tila voi olla NULL
  IF v_tila IS NOT NULL AND v_tila <> 'luonnos' AND public._suora_kirjoitus() THEN
    RAISE EXCEPTION 'Lähetetyn laskun rivejä ei voi muuttaa';
  END IF;
  IF TG_OP = 'UPDATE' AND NEW.lasku_id <> OLD.lasku_id THEN
    RAISE EXCEPTION 'Riviä ei voi siirtää toiselle laskulle';
  END IF;
  RETURN CASE WHEN TG_OP = 'DELETE' THEN OLD ELSE NEW END;
END $$;

DROP TRIGGER IF EXISTS tr_laskurivit_lukko ON laskurivit;
CREATE TRIGGER tr_laskurivit_lukko BEFORE INSERT OR UPDATE OR DELETE ON laskurivit
  FOR EACH ROW EXECUTE FUNCTION public._laskurivi_lukko();

-- Lasku saa viitata vain omaan asiakkaaseen
CREATE OR REPLACE FUNCTION public._lasku_asiakas_oma()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public, pg_temp
AS $$
BEGIN
  IF NEW.asiakas_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM asiakkaat WHERE id = NEW.asiakas_id AND user_id = NEW.user_id
  ) THEN
    RAISE EXCEPTION 'Asiakasta ei löydy';
  END IF;
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS tr_laskut_asiakas ON laskut;
CREATE TRIGGER tr_laskut_asiakas BEFORE INSERT OR UPDATE OF asiakas_id ON laskut
  FOR EACH ROW EXECUTE FUNCTION public._lasku_asiakas_oma();

-- ─── Kulut (ostot) ─────────────────────────────────────────────────────

ALTER TABLE kulut ADD COLUMN IF NOT EXISTS tili_id         UUID REFERENCES tilit(id) ON DELETE RESTRICT;
ALTER TABLE kulut ADD COLUMN IF NOT EXISTS toimittaja      TEXT;
ALTER TABLE kulut ADD COLUMN IF NOT EXISTS alv_kasittely   TEXT NOT NULL DEFAULT 'normaali';
ALTER TABLE kulut ADD COLUMN IF NOT EXISTS alv_vahennys    BOOLEAN NOT NULL DEFAULT true;
ALTER TABLE kulut ADD COLUMN IF NOT EXISTS maksutapa       TEXT NOT NULL DEFAULT 'pankki';
ALTER TABLE kulut ADD COLUMN IF NOT EXISTS veroton_summa   NUMERIC(14,2);
ALTER TABLE kulut ADD COLUMN IF NOT EXISTS alv_summa       NUMERIC(14,2);
ALTER TABLE kulut ADD COLUMN IF NOT EXISTS liitteet        TEXT[] NOT NULL DEFAULT '{}';
ALTER TABLE kulut ADD COLUMN IF NOT EXISTS tila            TEXT NOT NULL DEFAULT 'kirjattu';
ALTER TABLE kulut ADD COLUMN IF NOT EXISTS tosite_id       UUID REFERENCES tositteet(id) ON DELETE RESTRICT;
ALTER TABLE kulut ADD COLUMN IF NOT EXISTS pankkitapahtuma_id UUID;
ALTER TABLE kulut ADD COLUMN IF NOT EXISTS peruutuksen_syy TEXT;
DO $$ BEGIN
  ALTER TABLE kulut ADD CONSTRAINT kulut_alv_kasittely_check CHECK (alv_kasittely IN
    ('normaali','eu_palveluosto','ei_eu_palveluosto','eu_tavaraosto','ei_alv'));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  ALTER TABLE kulut ADD CONSTRAINT kulut_maksutapa_check CHECK (maksutapa IN ('pankki','osakas','ostovelka'));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  ALTER TABLE kulut ADD CONSTRAINT kulut_tila_check CHECK (tila IN ('kirjattu','peruttu'));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- ─── Pankkitapahtumat (tiliote) ────────────────────────────────────────

CREATE TABLE IF NOT EXISTS pankkitapahtumat (
  id          UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id     UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  pvm         DATE NOT NULL,
  summa       NUMERIC(14,2) NOT NULL,          -- + saapuva, - lähtevä
  vastapuoli  TEXT,
  viite       TEXT,
  viesti      TEXT,
  arkistointitunnus TEXT NOT NULL,
  tila        TEXT NOT NULL DEFAULT 'avoin' CHECK (tila IN ('avoin','kasitelty','ohitettu')),
  tosite_id   UUID REFERENCES tositteet(id) ON DELETE RESTRICT,
  lasku_id    UUID REFERENCES laskut(id) ON DELETE RESTRICT,
  kulu_id     UUID REFERENCES kulut(id) ON DELETE RESTRICT,
  tuotu       TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE (user_id, arkistointitunnus)
);
CREATE INDEX IF NOT EXISTS idx_pankki_user_pvm ON pankkitapahtumat(user_id, pvm);

-- ─── Muutosloki (audit trail) ──────────────────────────────────────────

CREATE TABLE IF NOT EXISTS muutosloki (
  id        BIGSERIAL PRIMARY KEY,
  user_id   UUID,
  taulu     TEXT NOT NULL,
  rivi_id   UUID,
  toiminto  TEXT NOT NULL,
  vanha     JSONB,
  uusi      JSONB,
  tekija    UUID,
  aika      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_muutosloki_user ON muutosloki(user_id, aika);

CREATE OR REPLACE FUNCTION public._kirjaa_muutos()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_rivi JSONB := to_jsonb(CASE WHEN TG_OP = 'DELETE' THEN OLD ELSE NEW END);
  v_user UUID;
BEGIN
  v_user := (v_rivi ->> 'user_id')::uuid;
  IF v_user IS NULL AND TG_TABLE_NAME = 'laskurivit' THEN
    SELECT user_id INTO v_user FROM laskut WHERE id = (v_rivi ->> 'lasku_id')::uuid;
  END IF;
  INSERT INTO muutosloki (user_id, taulu, rivi_id, toiminto, vanha, uusi, tekija)
  VALUES (
    v_user, TG_TABLE_NAME, (v_rivi ->> 'id')::uuid, TG_OP,
    CASE WHEN TG_OP <> 'INSERT' THEN to_jsonb(OLD) END,
    CASE WHEN TG_OP <> 'DELETE' THEN to_jsonb(NEW) END,
    auth.uid()
  );
  RETURN NULL;
END $$;

DO $$
DECLARE t TEXT;
BEGIN
  FOREACH t IN ARRAY ARRAY['profiilit','asiakkaat','laskut','laskurivit','kulut',
                           'tilit','tilikaudet','tositteet','pankkitapahtumat'] LOOP
    EXECUTE format('DROP TRIGGER IF EXISTS tr_%1$s_loki ON %1$I', t);
    EXECUTE format('CREATE TRIGGER tr_%1$s_loki AFTER INSERT OR UPDATE OR DELETE ON %1$I
                    FOR EACH ROW EXECUTE FUNCTION public._kirjaa_muutos()', t);
  END LOOP;
END $$;

CREATE OR REPLACE FUNCTION public._esta_lokin_muutos()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN RAISE EXCEPTION 'Muutoslokia ei voi muuttaa'; END $$;
DROP TRIGGER IF EXISTS tr_muutosloki_lukko ON muutosloki;
CREATE TRIGGER tr_muutosloki_lukko BEFORE UPDATE OR DELETE ON muutosloki
  FOR EACH ROW EXECUTE FUNCTION public._esta_lokin_muutos();

-- ═══════════════════════════════════════════════════════════════════════
-- RIVITASON TIETOTURVA
-- ═══════════════════════════════════════════════════════════════════════

ALTER TABLE tilit            ENABLE ROW LEVEL SECURITY;
ALTER TABLE tilikaudet       ENABLE ROW LEVEL SECURITY;
ALTER TABLE tositteet        ENABLE ROW LEVEL SECURITY;
ALTER TABLE viennit          ENABLE ROW LEVEL SECURITY;
ALTER TABLE numerosarjat     ENABLE ROW LEVEL SECURITY;
ALTER TABLE pankkitapahtumat ENABLE ROW LEVEL SECURITY;
ALTER TABLE muutosloki       ENABLE ROW LEVEL SECURITY;

-- Poistetaan vanhat "FOR ALL" -politiikat ja luodaan tarkemmat
DROP POLICY IF EXISTS "Käyttäjä hallitsee omaa profiiliaan" ON profiilit;
DROP POLICY IF EXISTS "Käyttäjä hallitsee omia asiakkaitaan" ON asiakkaat;
DROP POLICY IF EXISTS "Käyttäjä hallitsee omia laskujaan" ON laskut;
DROP POLICY IF EXISTS "Käyttäjä hallitsee laskurivejä laskujen kautta" ON laskurivit;
DROP POLICY IF EXISTS "Käyttäjä hallitsee omia kulujaan" ON kulut;

DO $$
DECLARE t TEXT;
BEGIN
  -- Taulut, joihin selain saa kirjoittaa suoraan (triggerit valvovat sääntöjä)
  FOREACH t IN ARRAY ARRAY['profiilit','asiakkaat','laskut'] LOOP
    EXECUTE format('DROP POLICY IF EXISTS oma_rivi ON %I', t);
    EXECUTE format('CREATE POLICY oma_rivi ON %I FOR ALL TO authenticated
                    USING (user_id = auth.uid()) WITH CHECK (user_id = auth.uid())', t);
  END LOOP;

  -- Taulut, joita selain vain lukee (kirjoitus RPC-funktioiden kautta)
  FOREACH t IN ARRAY ARRAY['kulut','tilikaudet','tositteet','viennit','numerosarjat',
                           'pankkitapahtumat','muutosloki','tilit'] LOOP
    EXECUTE format('DROP POLICY IF EXISTS oma_rivi ON %I', t);
    EXECUTE format('CREATE POLICY oma_rivi ON %I FOR SELECT TO authenticated
                    USING (user_id = auth.uid())', t);
  END LOOP;

  -- MFA: kaikkiin tauluihin rajoittava politiikka
  FOREACH t IN ARRAY ARRAY['profiilit','asiakkaat','laskut','laskurivit','kulut','tilit',
                           'tilikaudet','tositteet','viennit','numerosarjat',
                           'pankkitapahtumat','muutosloki'] LOOP
    EXECUTE format('DROP POLICY IF EXISTS mfa_vaaditaan ON %I', t);
    EXECUTE format('CREATE POLICY mfa_vaaditaan ON %I AS RESTRICTIVE FOR ALL TO authenticated
                    USING (public.mfa_ok()) WITH CHECK (public.mfa_ok())', t);
  END LOOP;
END $$;

DROP POLICY IF EXISTS oma_rivi ON laskurivit;
CREATE POLICY oma_rivi ON laskurivit FOR ALL TO authenticated
  USING (EXISTS (SELECT 1 FROM laskut l WHERE l.id = laskurivit.lasku_id AND l.user_id = auth.uid()))
  WITH CHECK (EXISTS (SELECT 1 FROM laskut l WHERE l.id = laskurivit.lasku_id AND l.user_id = auth.uid()));

-- Tilikarttaan saa lisätä omia tilejä ja muuttaa nimiä
DROP POLICY IF EXISTS oma_tili_lisays ON tilit;
CREATE POLICY oma_tili_lisays ON tilit FOR INSERT TO authenticated WITH CHECK (user_id = auth.uid());
DROP POLICY IF EXISTS oma_tili_muutos ON tilit;
CREATE POLICY oma_tili_muutos ON tilit FOR UPDATE TO authenticated
  USING (user_id = auth.uid()) WITH CHECK (user_id = auth.uid());

-- Taulutason oikeudet (puolustus syvyyssuunnassa)
REVOKE ALL ON tilit, tilikaudet, tositteet, viennit, numerosarjat, pankkitapahtumat, muutosloki, kulut
  FROM anon;
REVOKE INSERT, UPDATE, DELETE ON tilikaudet, tositteet, viennit, numerosarjat,
  pankkitapahtumat, muutosloki, kulut FROM authenticated;
REVOKE DELETE ON tilit FROM authenticated;
REVOKE ALL ON profiilit, asiakkaat, laskut, laskurivit FROM anon;
GRANT SELECT ON tilit, tilikaudet, tositteet, viennit, numerosarjat, pankkitapahtumat,
  muutosloki, kulut TO authenticated;
GRANT INSERT, UPDATE ON tilit TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON profiilit, asiakkaat, laskut, laskurivit TO authenticated;

-- ═══════════════════════════════════════════════════════════════════════
-- TILIKARTTA (pien- ja mikroyrityksen osakeyhtiö)
-- ═══════════════════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION public._alusta_tilikartta(p_user UUID)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  INSERT INTO tilit (user_id, numero, nimi, tyyppi, ryhma, alv_oletus) VALUES
  -- VASTAAVAA
  (p_user,'1050','Aineettomat oikeudet','vastaavaa','aineettomat','vahennys'),
  (p_user,'1100','Koneet ja kalusto','vastaavaa','aineelliset','vahennys'),
  (p_user,'1701','Myyntisaamiset','vastaavaa','lyhyet_saamiset',NULL),
  (p_user,'1763','Ostojen arvonlisävero (vähennettävä)','vastaavaa','lyhyet_saamiset',NULL),
  (p_user,'1765','Arvonlisäverosaaminen','vastaavaa','lyhyet_saamiset',NULL),
  (p_user,'1800','Muut saamiset','vastaavaa','lyhyet_saamiset',NULL),
  (p_user,'1805','Saamiset osakkailta','vastaavaa','lyhyet_saamiset',NULL),
  (p_user,'1840','Siirtosaamiset','vastaavaa','lyhyet_saamiset',NULL),
  (p_user,'1910','Pankkitili','vastaavaa','rahat',NULL),
  -- OMA PÄÄOMA
  (p_user,'2000','Osakepääoma','oma_paaoma','osakepaaoma',NULL),
  (p_user,'2050','Sijoitetun vapaan oman pääoman rahasto','oma_paaoma','svop',NULL),
  (p_user,'2250','Edellisten tilikausien voitto (tappio)','oma_paaoma','edelliset',NULL),
  -- VIERAS PÄÄOMA
  (p_user,'2620','Lainat rahoituslaitoksilta','vieras_paaoma','pitkaaikainen',NULL),
  (p_user,'2871','Ostovelat','vieras_paaoma','lyhytaikainen',NULL),
  (p_user,'2875','Velat osakkaille','vieras_paaoma','lyhytaikainen',NULL),
  (p_user,'2900','Muut velat','vieras_paaoma','lyhytaikainen',NULL),
  (p_user,'2920','Verovelat (tulovero)','vieras_paaoma','lyhytaikainen',NULL),
  (p_user,'2935','Arvonlisäverovelka (tilitettävä)','vieras_paaoma','lyhytaikainen',NULL),
  (p_user,'2939','Myynnin arvonlisävero','vieras_paaoma','lyhytaikainen',NULL),
  (p_user,'2950','Siirtovelat','vieras_paaoma','lyhytaikainen',NULL),
  -- TUOTOT
  (p_user,'3000','Myynti, kotimaa','tuotto','liikevaihto',NULL),
  (p_user,'3010','Palvelumyynti muihin EU-maihin','tuotto','liikevaihto',NULL),
  (p_user,'3011','Tavaramyynti muihin EU-maihin','tuotto','liikevaihto',NULL),
  (p_user,'3020','Myynti EU:n ulkopuolelle (0 %)','tuotto','liikevaihto',NULL),
  (p_user,'3030','Arvonlisäveroton myynti','tuotto','liikevaihto',NULL),
  (p_user,'3900','Liiketoiminnan muut tuotot (avustukset)','tuotto','muut_tuotot',NULL),
  -- KULUT
  (p_user,'4000','Ostot','kulu','materiaalit','vahennys'),
  (p_user,'4450','Ulkopuoliset palvelut','kulu','materiaalit','vahennys'),
  (p_user,'5000','Palkat','kulu','palkat',NULL),
  (p_user,'6130','Eläkekulut (TyEL)','kulu','henkilosivukulut',NULL),
  (p_user,'6300','Muut henkilösivukulut','kulu','henkilosivukulut',NULL),
  (p_user,'6800','Suunnitelman mukaiset poistot','kulu','poistot',NULL),
  (p_user,'7000','Toimitilakulut','kulu','muut_kulut','vahennys'),
  (p_user,'7300','Ajoneuvokulut','kulu','muut_kulut','vahennys'),
  (p_user,'7500','Matkakulut','kulu','muut_kulut','vahennys'),
  (p_user,'7550','Päivärahat ja kilometrikorvaukset','kulu','muut_kulut','ei_vahennysta'),
  (p_user,'7600','Edustuskulut','kulu','muut_kulut','ei_vahennysta'),
  (p_user,'7700','Markkinointi ja mainonta','kulu','muut_kulut','vahennys'),
  (p_user,'7800','Puhelin ja tietoliikenne','kulu','muut_kulut','vahennys'),
  (p_user,'7860','Ohjelmistot, API- ja pilvipalvelut','kulu','muut_kulut','vahennys'),
  (p_user,'7870','ATK-laitteet (pienhankinnat)','kulu','muut_kulut','vahennys'),
  (p_user,'7900','Kirjanpito- ja tilintarkastuspalvelut','kulu','muut_kulut','vahennys'),
  (p_user,'7910','Laki- ja konsultointipalvelut','kulu','muut_kulut','vahennys'),
  (p_user,'7920','Pankki- ja maksuliikennekulut','kulu','muut_kulut','ei_vahennysta'),
  (p_user,'7950','Vakuutukset','kulu','muut_kulut','ei_vahennysta'),
  (p_user,'7960','Koulutus ja kirjallisuus','kulu','muut_kulut','vahennys'),
  (p_user,'7970','Toimistotarvikkeet','kulu','muut_kulut','vahennys'),
  (p_user,'7980','Jäsenmaksut','kulu','muut_kulut','ei_vahennysta'),
  (p_user,'7990','Muut liiketoiminnan kulut','kulu','muut_kulut','vahennys'),
  (p_user,'9100','Korkotuotot','tuotto','rahoitustuotot',NULL),
  (p_user,'9400','Korkokulut','kulu','rahoituskulut',NULL),
  (p_user,'9900','Tuloverot','kulu','tuloverot',NULL)
  ON CONFLICT (user_id, numero) DO NOTHING;
END $$;

-- ═══════════════════════════════════════════════════════════════════════
-- SISÄISET KIRJAUSFUNKTIOT (ei kutsuttavissa selaimesta)
-- ═══════════════════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION public._tili(p_user UUID, p_numero TEXT)
RETURNS UUID
LANGUAGE plpgsql STABLE
SET search_path = public, pg_temp
AS $$
DECLARE v UUID;
BEGIN
  SELECT id INTO v FROM tilit WHERE user_id = p_user AND numero = p_numero;
  IF v IS NULL THEN RAISE EXCEPTION 'Tiliä % ei ole tilikartassa', p_numero; END IF;
  RETURN v;
END $$;

-- Kirjaa tositteen. p_viennit: [{tili:'1910', maara:123.45, alv_koodi, alv_kanta, selite}]
-- maara > 0 = debet, maara < 0 = kredit.
CREATE OR REPLACE FUNCTION public._kirjaa_tosite(
  p_user UUID, p_pvm DATE, p_selite TEXT, p_lahde TEXT, p_lahde_id UUID,
  p_viennit JSONB, p_oikaisee UUID DEFAULT NULL
) RETURNS UUID
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_kausi tilikaudet%ROWTYPE;
  v_numero INTEGER;
  v_tosite UUID;
  v_v JSONB;
  v_maara NUMERIC;
  v_summa NUMERIC := 0;
  v_rivit INTEGER := 0;
BEGIN
  SELECT * INTO v_kausi FROM tilikaudet
   WHERE user_id = p_user AND p_pvm BETWEEN alku AND loppu
   FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Päivämäärälle % ei ole tilikautta. Luo tilikausi asetuksissa.', p_pvm;
  END IF;
  IF v_kausi.lukittu THEN
    RAISE EXCEPTION 'Tilikausi % – % on lukittu', v_kausi.alku, v_kausi.loppu;
  END IF;

  v_numero := v_kausi.seuraava_tositenumero;
  UPDATE tilikaudet SET seuraava_tositenumero = v_numero + 1 WHERE id = v_kausi.id;

  INSERT INTO tositteet (user_id, tilikausi_id, numero, pvm, selite, lahde, lahde_id, oikaisee_id, luoja)
  VALUES (p_user, v_kausi.id, v_numero, p_pvm, p_selite, p_lahde, p_lahde_id, p_oikaisee, auth.uid())
  RETURNING id INTO v_tosite;

  FOR v_v IN SELECT * FROM jsonb_array_elements(p_viennit) LOOP
    v_maara := round((v_v ->> 'maara')::numeric, 2);
    CONTINUE WHEN v_maara = 0;
    INSERT INTO viennit (tosite_id, user_id, tili_id, debet, kredit, alv_koodi, alv_kanta, selite)
    VALUES (
      v_tosite, p_user, public._tili(p_user, v_v ->> 'tili'),
      greatest(v_maara, 0), greatest(-v_maara, 0),
      v_v ->> 'alv_koodi', (v_v ->> 'alv_kanta')::numeric, v_v ->> 'selite'
    );
    v_summa := v_summa + v_maara;
    v_rivit := v_rivit + 1;
  END LOOP;

  IF v_rivit < 2 OR v_summa <> 0 THEN
    RAISE EXCEPTION 'Tosite ei täsmää: debet ja kredit eroavat % €', v_summa;
  END IF;
  RETURN v_tosite;
END $$;

-- Oikaisee (vastakirjaa) tositteen. Palauttaa oikaisutositteen id:n.
CREATE OR REPLACE FUNCTION public._oikaise_tosite(p_user UUID, p_tosite UUID, p_pvm DATE, p_syy TEXT)
RETURNS UUID
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  t tositteet%ROWTYPE;
  v_viennit JSONB;
  v_uusi UUID;
  v_pvm DATE;
BEGIN
  SELECT * INTO t FROM tositteet WHERE id = p_tosite AND user_id = p_user FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Tositetta ei löydy'; END IF;
  IF t.oikaistu THEN RAISE EXCEPTION 'Tosite % on jo oikaistu', t.numero; END IF;
  IF t.oikaisee_id IS NOT NULL THEN RAISE EXCEPTION 'Oikaisutositetta ei voi oikaista'; END IF;

  SELECT jsonb_agg(jsonb_build_object(
           'tili', tl.numero, 'maara', v.kredit - v.debet,
           'alv_koodi', v.alv_koodi, 'alv_kanta', v.alv_kanta, 'selite', v.selite))
    INTO v_viennit
    FROM viennit v JOIN tilit tl ON tl.id = v.tili_id
   WHERE v.tosite_id = p_tosite;

  -- Jos alkuperäisen tositteen kausi on lukittu, oikaisu tehdään avoimelle kaudelle
  v_pvm := coalesce(p_pvm, t.pvm);
  v_uusi := public._kirjaa_tosite(p_user, v_pvm,
              'Oikaisu tositteeseen ' || t.numero || ': ' || coalesce(p_syy, ''),
              'oikaisu', t.lahde_id, v_viennit, t.id);
  UPDATE tositteet SET oikaistu = true WHERE id = t.id;
  RETURN v_uusi;
END $$;

-- Laskun summat: rivin veroton = round(määrä × à-hinta, 2), ALV verokannoittain
CREATE OR REPLACE FUNCTION public._laskun_erittely(p_lasku UUID)
RETURNS TABLE (kanta NUMERIC, veroton NUMERIC, alv NUMERIC)
LANGUAGE sql STABLE
SET search_path = public, pg_temp
AS $$
  SELECT r.alv_kanta,
         sum(round(r.maara * r.yksikkohinta, 2)),
         round(sum(round(r.maara * r.yksikkohinta, 2)) * r.alv_kanta / 100, 2)
    FROM laskurivit r
   WHERE r.lasku_id = p_lasku
   GROUP BY r.alv_kanta
   ORDER BY r.alv_kanta DESC
$$;

-- Kirjaa myynti- tai hyvityslaskun pääkirjaan
CREATE OR REPLACE FUNCTION public._kirjaa_lasku(p_user UUID, p_lasku UUID)
RETURNS UUID
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  l laskut%ROWTYPE;
  e RECORD;
  v_viennit JSONB := '[]'::jsonb;
  v_tili TEXT;
  v_koodi TEXT;
  v_brutto NUMERIC := 0;
  v_selite TEXT;
BEGIN
  SELECT * INTO l FROM laskut WHERE id = p_lasku AND user_id = p_user;
  v_tili := CASE l.alv_kasittely
              WHEN 'eu_palvelu' THEN '3010'
              WHEN 'eu_tavara'  THEN '3011'
              WHEN 'vienti'     THEN '3020'
              WHEN 'veroton'    THEN '3030'
              ELSE '3000' END;
  v_koodi := CASE l.alv_kasittely
              WHEN 'eu_palvelu' THEN 'eu_palvelumyynti'
              WHEN 'eu_tavara'  THEN 'eu_tavaramyynti'
              WHEN 'vienti'     THEN 'nollaverokanta'
              WHEN 'veroton'    THEN NULL
              ELSE 'myynti' END;
  v_selite := CASE WHEN l.tyyppi = 'hyvitys' THEN 'Hyvityslasku ' ELSE 'Myyntilasku ' END
              || l.laskunumero || ' / ' || coalesce(l.ostaja ->> 'nimi', '');

  FOR e IN SELECT * FROM public._laskun_erittely(p_lasku) LOOP
    v_viennit := v_viennit || jsonb_build_object(
      'tili', v_tili, 'maara', -e.veroton, 'alv_koodi', v_koodi, 'alv_kanta', e.kanta);
    IF e.alv <> 0 THEN
      v_viennit := v_viennit || jsonb_build_object(
        'tili', '2939', 'maara', -e.alv, 'alv_koodi', 'myynti_vero', 'alv_kanta', e.kanta);
    END IF;
    v_brutto := v_brutto + e.veroton + e.alv;
  END LOOP;
  v_viennit := v_viennit || jsonb_build_object('tili', '1701', 'maara', v_brutto);

  RETURN public._kirjaa_tosite(p_user, l.laskupaiva, v_selite,
           CASE WHEN l.tyyppi = 'hyvitys' THEN 'hyvityslasku' ELSE 'myyntilasku' END,
           l.id, v_viennit);
END $$;

-- Kulun kirjaus. Palauttaa tositteen id:n.
CREATE OR REPLACE FUNCTION public._kirjaa_kulu(p_user UUID, p_kulu UUID)
RETURNS UUID
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  k kulut%ROWTYPE;
  v_tili TEXT;
  v_vasta TEXT;
  v_viennit JSONB;
  v_alv NUMERIC := 0;
  v_veroton NUMERIC;
  v_kulu NUMERIC;
  v_maksu NUMERIC;
BEGIN
  SELECT * INTO k FROM kulut WHERE id = p_kulu AND user_id = p_user;
  SELECT numero INTO v_tili FROM tilit WHERE id = k.tili_id;
  v_vasta := CASE k.maksutapa WHEN 'osakas' THEN '2875' WHEN 'ostovelka' THEN '2871' ELSE '1910' END;

  IF k.alv_kasittely = 'normaali' THEN
    -- summa on verollinen; ALV erotellaan
    v_alv := round(k.summa * k.alv_kanta / (100 + k.alv_kanta), 2);
    v_veroton := k.summa - v_alv;
    v_maksu := k.summa;
    IF k.alv_vahennys AND v_alv <> 0 THEN
      v_kulu := v_veroton;
      v_viennit := jsonb_build_array(
        jsonb_build_object('tili', v_tili, 'maara', v_kulu, 'alv_koodi', 'osto', 'alv_kanta', k.alv_kanta),
        jsonb_build_object('tili', '1763', 'maara', v_alv, 'alv_koodi', 'osto_vero', 'alv_kanta', k.alv_kanta),
        jsonb_build_object('tili', v_vasta, 'maara', -v_maksu));
    ELSE
      v_viennit := jsonb_build_array(
        jsonb_build_object('tili', v_tili, 'maara', v_maksu, 'alv_koodi', 'osto_ei_vahennysta', 'alv_kanta', k.alv_kanta),
        jsonb_build_object('tili', v_vasta, 'maara', -v_maksu));
    END IF;
  ELSIF k.alv_kasittely IN ('eu_palveluosto','ei_eu_palveluosto','eu_tavaraosto') THEN
    -- Käännetty verovelvollisuus: summa on veroton, ostaja laskee veron itse
    v_veroton := k.summa;
    v_alv := round(k.summa * k.alv_kanta / 100, 2);
    v_maksu := k.summa;
    v_viennit := jsonb_build_array(
      jsonb_build_object('tili', v_tili, 'maara', v_veroton, 'alv_koodi', k.alv_kasittely, 'alv_kanta', k.alv_kanta),
      jsonb_build_object('tili', '2939', 'maara', -v_alv, 'alv_koodi', k.alv_kasittely || '_vero', 'alv_kanta', k.alv_kanta),
      jsonb_build_object('tili', v_vasta, 'maara', -v_maksu));
    IF k.alv_vahennys THEN
      v_viennit := v_viennit || jsonb_build_object('tili', '1763', 'maara', v_alv, 'alv_koodi', 'osto_vero', 'alv_kanta', k.alv_kanta);
    ELSE
      v_viennit := v_viennit || jsonb_build_object('tili', v_tili, 'maara', v_alv, 'alv_koodi', 'osto_ei_vahennysta');
    END IF;
  ELSE -- ei_alv
    v_veroton := k.summa; v_alv := 0; v_maksu := k.summa;
    v_viennit := jsonb_build_array(
      jsonb_build_object('tili', v_tili, 'maara', v_maksu),
      jsonb_build_object('tili', v_vasta, 'maara', -v_maksu));
  END IF;

  UPDATE kulut SET veroton_summa = v_veroton, alv_summa = v_alv WHERE id = k.id;

  RETURN public._kirjaa_tosite(p_user, k.paiva,
           'Kulu: ' || k.kuvaus || coalesce(' / ' || k.toimittaja, ''),
           'kulu', k.id, v_viennit);
END $$;

REVOKE EXECUTE ON FUNCTION public._kirjaa_tosite(UUID, DATE, TEXT, TEXT, UUID, JSONB, UUID) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public._oikaise_tosite(UUID, UUID, DATE, TEXT) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public._kirjaa_lasku(UUID, UUID) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public._kirjaa_kulu(UUID, UUID) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public._alusta_tilikartta(UUID) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public._tili(UUID, TEXT) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public._laskun_erittely(UUID) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public._kirjaa_muutos() FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public._tarkista_rekisteroityminen() FROM PUBLIC, anon, authenticated;

-- ═══════════════════════════════════════════════════════════════════════
-- JULKISET RPC-FUNKTIOT (kutsutaan selaimesta)
-- ═══════════════════════════════════════════════════════════════════════

-- Alustaa tilikartan ja ensimmäisen tilikauden (kalenterivuosi), jos puuttuvat
CREATE OR REPLACE FUNCTION public.alusta_kirjanpito()
RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_user UUID := public.vaadi_kayttaja();
  v_vuosi INTEGER := extract(year FROM current_date)::int;
BEGIN
  PERFORM public._alusta_tilikartta(v_user);
  INSERT INTO profiilit (user_id) VALUES (v_user) ON CONFLICT (user_id) DO NOTHING;
  IF NOT EXISTS (SELECT 1 FROM tilikaudet WHERE user_id = v_user) THEN
    INSERT INTO tilikaudet (user_id, alku, loppu)
    VALUES (v_user, make_date(v_vuosi, 1, 1), make_date(v_vuosi, 12, 31));
  END IF;
  RETURN jsonb_build_object(
    'tilit', (SELECT count(*) FROM tilit WHERE user_id = v_user),
    'tilikaudet', (SELECT count(*) FROM tilikaudet WHERE user_id = v_user));
END $$;

-- Uusi tilikausi. KPL 4:7: 12 kk, ensimmäinen/muutettu enintään 18 kk.
CREATE OR REPLACE FUNCTION public.luo_tilikausi(p_alku DATE, p_loppu DATE)
RETURNS UUID
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_user UUID := public.vaadi_kayttaja();
  v_edellinen DATE;
  v_id UUID;
BEGIN
  IF p_loppu <= p_alku THEN RAISE EXCEPTION 'Loppupäivän on oltava alkupäivän jälkeen'; END IF;
  IF p_loppu >= (p_alku + interval '18 months')::date THEN
    RAISE EXCEPTION 'Tilikausi voi olla enintään 18 kuukautta';
  END IF;
  IF EXISTS (SELECT 1 FROM tilikaudet WHERE user_id = v_user
              AND daterange(alku, loppu, '[]') && daterange(p_alku, p_loppu, '[]')) THEN
    RAISE EXCEPTION 'Tilikausi menee päällekkäin olemassa olevan kanssa';
  END IF;
  SELECT max(loppu) INTO v_edellinen FROM tilikaudet WHERE user_id = v_user AND loppu < p_alku;
  IF v_edellinen IS NOT NULL AND v_edellinen + 1 <> p_alku THEN
    RAISE EXCEPTION 'Tilikauden on alettava edellisen päättymistä seuraavana päivänä (%)', v_edellinen + 1;
  END IF;
  INSERT INTO tilikaudet (user_id, alku, loppu) VALUES (v_user, p_alku, p_loppu) RETURNING id INTO v_id;
  RETURN v_id;
END $$;

-- Tilikauden rajojen muutos (vain jos kaudella ei ole kirjauksia)
CREATE OR REPLACE FUNCTION public.muuta_tilikausi(p_id UUID, p_alku DATE, p_loppu DATE)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE v_user UUID := public.vaadi_kayttaja();
BEGIN
  IF p_loppu >= (p_alku + interval '18 months')::date OR p_loppu <= p_alku THEN
    RAISE EXCEPTION 'Virheellinen tilikausi';
  END IF;
  IF EXISTS (SELECT 1 FROM tilikaudet WHERE user_id = v_user AND id <> p_id
              AND daterange(alku, loppu, '[]') && daterange(p_alku, p_loppu, '[]')) THEN
    RAISE EXCEPTION 'Tilikausi menee päällekkäin olemassa olevan kanssa';
  END IF;
  UPDATE tilikaudet SET alku = p_alku, loppu = p_loppu WHERE id = p_id AND user_id = v_user;
  IF NOT FOUND THEN RAISE EXCEPTION 'Tilikautta ei löydy'; END IF;
END $$;

-- Lukitsee tilikauden pysyvästi (tilinpäätöksen jälkeen)
CREATE OR REPLACE FUNCTION public.lukitse_tilikausi(p_id UUID)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_user UUID := public.vaadi_kayttaja();
  k tilikaudet%ROWTYPE;
BEGIN
  SELECT * INTO k FROM tilikaudet WHERE id = p_id AND user_id = v_user FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Tilikautta ei löydy'; END IF;
  IF k.lukittu THEN RETURN; END IF;
  IF k.loppu >= current_date THEN RAISE EXCEPTION 'Tilikausi ei ole vielä päättynyt'; END IF;
  IF EXISTS (SELECT 1 FROM tilikaudet WHERE user_id = v_user AND loppu < k.alku AND NOT lukittu) THEN
    RAISE EXCEPTION 'Lukitse ensin aiemmat tilikaudet';
  END IF;
  IF EXISTS (SELECT 1 FROM laskut WHERE user_id = v_user AND tila = 'luonnos'
              AND laskupaiva BETWEEN k.alku AND k.loppu) THEN
    RAISE EXCEPTION 'Tilikaudella on lähettämättömiä laskuluonnoksia';
  END IF;
  UPDATE tilikaudet SET lukittu = true, lukittu_aika = now() WHERE id = p_id;
END $$;

-- Lähettää (viimeistelee) laskun: aukoton numero, viite, tiedot jäädytetään, kirjaus.
CREATE OR REPLACE FUNCTION public.laheta_lasku(p_lasku UUID)
RETURNS laskut
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_user UUID := public.vaadi_kayttaja();
  l laskut%ROWTYPE;
  p profiilit%ROWTYPE;
  a asiakkaat%ROWTYPE;
  v_vuosi TEXT;
  v_nro INTEGER;
  v_numero TEXT;
  v_perus TEXT;
  v_summa INTEGER := 0;
  v_paino INTEGER[] := ARRAY[7,3,1];
  i INTEGER;
  v_veroton NUMERIC; v_alv NUMERIC;
  v_erittely JSONB;
  v_tosite UUID;
BEGIN
  SELECT * INTO l FROM laskut WHERE id = p_lasku AND user_id = v_user FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Laskua ei löydy'; END IF;
  IF l.tila <> 'luonnos' THEN RAISE EXCEPTION 'Lasku on jo lähetetty'; END IF;

  SELECT * INTO p FROM profiilit WHERE user_id = v_user;
  IF p.yritys_nimi IS NULL OR p.y_tunnus IS NULL OR p.osoite IS NULL OR p.iban IS NULL THEN
    RAISE EXCEPTION 'Täydennä yritystiedot (nimi, Y-tunnus, osoite, IBAN) asetuksissa ennen laskutusta';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM laskurivit WHERE lasku_id = l.id) THEN
    RAISE EXCEPTION 'Laskulla ei ole rivejä';
  END IF;

  IF l.tyyppi = 'lasku' THEN
    SELECT * INTO a FROM asiakkaat WHERE id = l.asiakas_id AND user_id = v_user;
    IF NOT FOUND THEN RAISE EXCEPTION 'Valitse laskulle asiakas'; END IF;

    -- ALV-käsittelyn säännöt (AVL 209 e §)
    IF NOT coalesce(p.alv_rekisteroity, true) THEN
      IF l.alv_kasittely <> 'normaali' OR EXISTS (SELECT 1 FROM laskurivit WHERE lasku_id = l.id AND alv_kanta <> 0) THEN
        RAISE EXCEPTION 'Yritys ei ole ALV-rekisterissä: laskulla ei voi olla arvonlisäveroa';
      END IF;
    END IF;
    IF l.alv_kasittely <> 'normaali' AND EXISTS (SELECT 1 FROM laskurivit WHERE lasku_id = l.id AND alv_kanta <> 0) THEN
      RAISE EXCEPTION 'Valitulla ALV-käsittelyllä rivien verokannan on oltava 0 %%';
    END IF;
    IF l.alv_kasittely IN ('eu_palvelu','eu_tavara') THEN
      IF coalesce(a.alv_tunnus, '') = '' THEN
        RAISE EXCEPTION 'EU-myynnissä ostajan ALV-tunnus on pakollinen';
      END IF;
      IF upper(coalesce(a.maa, 'FI')) = 'FI' OR upper(left(a.alv_tunnus, 2)) = 'FI' THEN
        RAISE EXCEPTION 'EU-myynti koskee vain muissa EU-maissa olevia ostajia';
      END IF;
      IF a.tyyppi = 'kuluttaja' THEN
        RAISE EXCEPTION 'Käännetty verovelvollisuus ei koske kuluttajia';
      END IF;
    END IF;
  ELSE
    SELECT * INTO a FROM asiakkaat WHERE id = l.asiakas_id AND user_id = v_user;
  END IF;

  -- Aukoton laskunumero laskupäivän vuoden sarjasta
  v_vuosi := to_char(l.laskupaiva, 'YYYY');
  INSERT INTO numerosarjat (user_id, sarja, seuraava)
  VALUES (v_user, 'lasku-' || v_vuosi,
          coalesce((SELECT max(nullif(split_part(laskunumero, '-', 2), '')::int) + 1
                      FROM laskut WHERE user_id = v_user AND laskunumero ~ ('^' || v_vuosi || '-[0-9]+$')), 1))
  ON CONFLICT (user_id, sarja) DO NOTHING;
  SELECT seuraava INTO v_nro FROM numerosarjat
   WHERE user_id = v_user AND sarja = 'lasku-' || v_vuosi FOR UPDATE;
  UPDATE numerosarjat SET seuraava = v_nro + 1 WHERE user_id = v_user AND sarja = 'lasku-' || v_vuosi;
  v_numero := v_vuosi || '-' || lpad(v_nro::text, 3, '0');

  -- Viitenumero (7-3-1) laskunumeron numeroista
  v_perus := regexp_replace(v_numero, '\D', '', 'g');
  FOR i IN 1..length(v_perus) LOOP
    v_summa := v_summa + substr(v_perus, length(v_perus) - i + 1, 1)::int * v_paino[((i - 1) % 3) + 1];
  END LOOP;
  v_perus := v_perus || ((10 - (v_summa % 10)) % 10)::text;

  SELECT coalesce(sum(veroton), 0), coalesce(sum(alv), 0),
         coalesce(jsonb_agg(jsonb_build_object('kanta', kanta, 'veroton', veroton, 'alv', alv)), '[]')
    INTO v_veroton, v_alv, v_erittely
    FROM public._laskun_erittely(l.id);

  IF l.tyyppi = 'lasku' AND v_veroton + v_alv <= 0 THEN
    RAISE EXCEPTION 'Laskun loppusumman on oltava positiivinen';
  END IF;

  UPDATE laskut SET
    laskunumero = v_numero,
    viitenumero = v_perus,
    toimituspaiva = coalesce(l.toimituspaiva, l.laskupaiva),
    tila = 'lahetetty',
    lahetetty_aika = now(),
    summa_veroton = v_veroton,
    summa_alv = v_alv,
    summa_verollinen = v_veroton + v_alv,
    alv_erittely = v_erittely,
    myyja = jsonb_build_object(
      'nimi', p.yritys_nimi, 'y_tunnus', p.y_tunnus,
      'alv_tunnus', CASE WHEN coalesce(p.alv_rekisteroity, true)
                         THEN coalesce(nullif(p.alv_tunnus, ''), 'FI' || replace(p.y_tunnus, '-', '')) END,
      'alv_rekisteroity', coalesce(p.alv_rekisteroity, true),
      'kotipaikka', p.kotipaikka, 'osoite', p.osoite, 'postinumero', p.postinumero,
      'kaupunki', p.kaupunki, 'sahkoposti', p.sahkoposti, 'puhelin', p.puhelin,
      'kotisivu', p.kotisivu, 'iban', p.iban, 'bic', p.bic, 'pankki', p.pankki,
      'verkkolaskuosoite', p.verkkolaskuosoite, 'valittajatunnus', p.valittajatunnus,
      'viivastyskorko', p.viivastyskorko, 'huomautusaika', p.huomautusaika),
    ostaja = CASE WHEN l.tyyppi = 'hyvitys' OR a.id IS NULL THEN l.ostaja ELSE jsonb_build_object(
      'nimi', a.nimi, 'y_tunnus', a.y_tunnus, 'alv_tunnus', a.alv_tunnus, 'tyyppi', a.tyyppi,
      'yhteyshenkilo', a."yhteyshenkilö", 'osoite', a.osoite, 'postinumero', a.postinumero,
      'kaupunki', a.kaupunki, 'maa', a.maa, 'sahkoposti', a.sahkoposti,
      'verkkolaskuosoite', a.verkkolaskuosoite, 'valittajatunnus', a.valittajatunnus) END
  WHERE id = l.id;

  v_tosite := public._kirjaa_lasku(v_user, l.id);
  UPDATE laskut SET tosite_id = v_tosite WHERE id = l.id RETURNING * INTO l;
  RETURN l;
END $$;

-- Kirjaa saapuneen maksun (myyntisaaminen → pankki)
CREATE OR REPLACE FUNCTION public.kirjaa_maksu(
  p_lasku UUID, p_pvm DATE, p_summa NUMERIC, p_pankkitapahtuma UUID DEFAULT NULL
) RETURNS laskut
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_user UUID := public.vaadi_kayttaja();
  l laskut%ROWTYPE;
  v_avoin NUMERIC;
  v_tosite UUID;
  pt pankkitapahtumat%ROWTYPE;
BEGIN
  SELECT * INTO l FROM laskut WHERE id = p_lasku AND user_id = v_user FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Laskua ei löydy'; END IF;
  IF l.tyyppi <> 'lasku' OR l.tila NOT IN ('lahetetty','osittain') THEN
    RAISE EXCEPTION 'Laskulle ei voi kirjata maksua (tila: %)', l.tila;
  END IF;
  p_summa := round(p_summa, 2);
  IF p_summa <= 0 THEN RAISE EXCEPTION 'Maksun on oltava positiivinen'; END IF;
  v_avoin := l.summa_verollinen - l.maksettu_summa
             + coalesce((SELECT sum(h.summa_verollinen) FROM laskut h
                          WHERE h.hyvitettava_id = l.id AND h.tila <> 'luonnos'), 0);
  IF p_summa > v_avoin THEN
    RAISE EXCEPTION 'Maksu % € ylittää avoimen saldon % €', p_summa, v_avoin;
  END IF;

  IF p_pankkitapahtuma IS NOT NULL THEN
    SELECT * INTO pt FROM pankkitapahtumat WHERE id = p_pankkitapahtuma AND user_id = v_user FOR UPDATE;
    IF NOT FOUND OR pt.tila <> 'avoin' THEN RAISE EXCEPTION 'Pankkitapahtuma on jo käsitelty'; END IF;
    IF pt.summa <> p_summa THEN RAISE EXCEPTION 'Summa ei vastaa pankkitapahtumaa'; END IF;
    p_pvm := pt.pvm;
  END IF;

  v_tosite := public._kirjaa_tosite(v_user, p_pvm,
    'Maksu laskuun ' || l.laskunumero || ' / ' || coalesce(l.ostaja ->> 'nimi', ''),
    'maksu', l.id, jsonb_build_array(
      jsonb_build_object('tili', '1910', 'maara', p_summa),
      jsonb_build_object('tili', '1701', 'maara', -p_summa)));

  IF p_pankkitapahtuma IS NOT NULL THEN
    UPDATE pankkitapahtumat SET tila = 'kasitelty', tosite_id = v_tosite, lasku_id = l.id
     WHERE id = p_pankkitapahtuma;
  END IF;

  UPDATE laskut SET
    maksettu_summa = maksettu_summa + p_summa,
    tila = CASE WHEN p_summa >= v_avoin THEN 'maksettu' ELSE 'osittain' END,
    maksettu_pvm = p_pvm
  WHERE id = l.id RETURNING * INTO l;
  RETURN l;
END $$;

-- Hyvityslasku (koko lasku tai valitut määrät). Hyvitys lähetetään heti.
CREATE OR REPLACE FUNCTION public.luo_hyvityslasku(p_lasku UUID, p_syy TEXT, p_pvm DATE DEFAULT NULL)
RETURNS laskut
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_user UUID := public.vaadi_kayttaja();
  l laskut%ROWTYPE;
  h laskut%ROWTYPE;
  v_id UUID;
  v_pvm DATE := coalesce(p_pvm, current_date);
BEGIN
  SELECT * INTO l FROM laskut WHERE id = p_lasku AND user_id = v_user FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Laskua ei löydy'; END IF;
  IF l.tyyppi <> 'lasku' OR l.tila NOT IN ('lahetetty','osittain','maksettu') THEN
    RAISE EXCEPTION 'Vain lähetetyn laskun voi hyvittää';
  END IF;
  IF EXISTS (SELECT 1 FROM laskut WHERE hyvitettava_id = l.id) THEN
    RAISE EXCEPTION 'Laskulle on jo tehty hyvityslasku';
  END IF;
  IF coalesce(trim(p_syy), '') = '' THEN RAISE EXCEPTION 'Anna hyvityksen syy'; END IF;

  INSERT INTO laskut (user_id, asiakas_id, laskupaiva, erapaiva, toimituspaiva, tila, tyyppi,
                      hyvitettava_id, alv_kasittely, lisatiedot, hyvityksen_syy, ostaja)
  VALUES (v_user, l.asiakas_id, v_pvm, v_pvm, l.toimituspaiva, 'luonnos', 'hyvitys',
          l.id, l.alv_kasittely,
          'Hyvityslasku laskulle ' || l.laskunumero || ' (' || to_char(l.laskupaiva, 'DD.MM.YYYY') || '). ' || p_syy,
          p_syy, l.ostaja)
  RETURNING id INTO v_id;

  INSERT INTO laskurivit (lasku_id, jarjestys, kuvaus, maara, yksikko, yksikkohinta, alv_kanta)
  SELECT v_id, jarjestys, kuvaus, -maara, yksikko, yksikkohinta, alv_kanta
    FROM laskurivit WHERE lasku_id = l.id;

  h := public.laheta_lasku(v_id);

  -- Hyvitys kattaa koko laskun. Jos lasku oli jo maksettu, asiakkaalle
  -- syntyy saatava (myyntisaamiset-tilin kredit), joka palautetaan pankista.
  UPDATE laskut SET tila = 'hyvitetty' WHERE id = l.id;
  RETURN h;
END $$;

-- Tallentaa ja kirjaa kulun. Muokkaus = vanhan tositteen oikaisu + uusi kirjaus.
CREATE OR REPLACE FUNCTION public.tallenna_kulu(p JSONB)
RETURNS kulut
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_user UUID := public.vaadi_kayttaja();
  k kulut%ROWTYPE;
  v_id UUID := nullif(p ->> 'id', '')::uuid;
  v_tili UUID;
  v_kasittely TEXT := coalesce(p ->> 'alv_kasittely', 'normaali');
  v_kanta NUMERIC := coalesce((p ->> 'alv_kanta')::numeric, 0);
  v_pt UUID := nullif(p ->> 'pankkitapahtuma_id', '')::uuid;
  pt pankkitapahtumat%ROWTYPE;
  v_liitteet TEXT[];
  v_tosite UUID;
BEGIN
  SELECT id INTO v_tili FROM tilit
   WHERE user_id = v_user AND numero = (p ->> 'tili') AND tyyppi IN ('kulu','vastaavaa');
  IF v_tili IS NULL THEN RAISE EXCEPTION 'Valitse kulutili'; END IF;
  IF coalesce((p ->> 'summa')::numeric, 0) <= 0 THEN RAISE EXCEPTION 'Summan on oltava positiivinen'; END IF;
  IF coalesce(trim(p ->> 'kuvaus'), '') = '' THEN RAISE EXCEPTION 'Kuvaus puuttuu'; END IF;
  IF v_kasittely = 'ei_alv' THEN v_kanta := 0; END IF;
  IF v_kasittely IN ('eu_palveluosto','ei_eu_palveluosto','eu_tavaraosto') AND v_kanta = 0 THEN
    v_kanta := 25.5;
  END IF;

  SELECT coalesce(array_agg(x), '{}') INTO v_liitteet
    FROM jsonb_array_elements_text(coalesce(p -> 'liitteet', '[]'::jsonb)) x;
  -- Liitteet vain omasta kansiosta
  IF EXISTS (SELECT 1 FROM unnest(v_liitteet) x WHERE split_part(x, '/', 1) <> v_user::text) THEN
    RAISE EXCEPTION 'Virheellinen liitepolku';
  END IF;

  IF v_id IS NOT NULL THEN
    SELECT * INTO k FROM kulut WHERE id = v_id AND user_id = v_user FOR UPDATE;
    IF NOT FOUND THEN RAISE EXCEPTION 'Kulua ei löydy'; END IF;
    IF k.tila = 'peruttu' THEN RAISE EXCEPTION 'Peruttua kulua ei voi muuttaa'; END IF;
    IF k.pankkitapahtuma_id IS NOT NULL THEN
      SELECT * INTO pt FROM pankkitapahtumat WHERE id = k.pankkitapahtuma_id;
      IF -pt.summa <> round((p ->> 'summa')::numeric, 2) OR (p ->> 'paiva')::date <> pt.pvm
         OR coalesce(p ->> 'maksutapa', 'pankki') <> 'pankki' THEN
        RAISE EXCEPTION 'Pankkitapahtumaan liitetyn kulun summaa, päivää ja maksutapaa ei voi muuttaa';
      END IF;
    END IF;
    IF k.tosite_id IS NOT NULL THEN
      PERFORM public._oikaise_tosite(v_user, k.tosite_id, NULL, 'kulun korjaus');
    END IF;
    UPDATE kulut SET
      paiva = (p ->> 'paiva')::date, kuvaus = p ->> 'kuvaus', toimittaja = nullif(p ->> 'toimittaja', ''),
      summa = round((p ->> 'summa')::numeric, 2), alv_kanta = v_kanta, alv_kasittely = v_kasittely,
      alv_vahennys = coalesce((p ->> 'alv_vahennys')::boolean, true),
      maksutapa = coalesce(p ->> 'maksutapa', 'pankki'), tili_id = v_tili,
      kategoria = (SELECT nimi FROM tilit WHERE id = v_tili),
      kuitin_numero = nullif(p ->> 'kuitin_numero', ''),
      liitteet = (SELECT array(SELECT DISTINCT unnest(k.liitteet || v_liitteet)))
    WHERE id = v_id;
  ELSE
    INSERT INTO kulut (user_id, paiva, kuvaus, toimittaja, summa, alv_kanta, alv_kasittely,
                       alv_vahennys, maksutapa, tili_id, kategoria, kuitin_numero, liitteet)
    VALUES (v_user, (p ->> 'paiva')::date, p ->> 'kuvaus', nullif(p ->> 'toimittaja', ''),
            round((p ->> 'summa')::numeric, 2), v_kanta, v_kasittely,
            coalesce((p ->> 'alv_vahennys')::boolean, true), coalesce(p ->> 'maksutapa', 'pankki'),
            v_tili, (SELECT nimi FROM tilit WHERE id = v_tili), nullif(p ->> 'kuitin_numero', ''),
            v_liitteet)
    RETURNING id INTO v_id;
  END IF;

  IF v_pt IS NOT NULL THEN
    SELECT * INTO pt FROM pankkitapahtumat WHERE id = v_pt AND user_id = v_user FOR UPDATE;
    IF NOT FOUND OR pt.tila <> 'avoin' THEN RAISE EXCEPTION 'Pankkitapahtuma on jo käsitelty'; END IF;
    IF -pt.summa <> round((p ->> 'summa')::numeric, 2) THEN
      RAISE EXCEPTION 'Kulun summa ei vastaa pankkitapahtumaa (% €)', -pt.summa;
    END IF;
    UPDATE kulut SET maksutapa = 'pankki', pankkitapahtuma_id = v_pt, paiva = pt.pvm WHERE id = v_id;
  END IF;

  v_tosite := public._kirjaa_kulu(v_user, v_id);
  UPDATE kulut SET tosite_id = v_tosite WHERE id = v_id RETURNING * INTO k;

  IF v_pt IS NOT NULL THEN
    UPDATE pankkitapahtumat SET tila = 'kasitelty', kulu_id = v_id, tosite_id = k.tosite_id WHERE id = v_pt;
  ELSIF k.pankkitapahtuma_id IS NOT NULL THEN
    UPDATE pankkitapahtumat SET tosite_id = k.tosite_id WHERE id = k.pankkitapahtuma_id;
  END IF;
  RETURN k;
END $$;

-- Peruu kulun (oikaisutosite). Kulu ja sen tosite säilyvät.
CREATE OR REPLACE FUNCTION public.peru_kulu(p_id UUID, p_syy TEXT)
RETURNS kulut
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_user UUID := public.vaadi_kayttaja();
  k kulut%ROWTYPE;
BEGIN
  SELECT * INTO k FROM kulut WHERE id = p_id AND user_id = v_user FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Kulua ei löydy'; END IF;
  IF k.tila = 'peruttu' THEN RETURN k; END IF;
  IF coalesce(trim(p_syy), '') = '' THEN RAISE EXCEPTION 'Anna peruutuksen syy'; END IF;
  IF k.pankkitapahtuma_id IS NOT NULL THEN
    RAISE EXCEPTION 'Pankkitapahtumaan liitettyä kulua ei voi perua; korjaa kulua';
  END IF;
  IF k.tosite_id IS NOT NULL THEN
    PERFORM public._oikaise_tosite(v_user, k.tosite_id, NULL, p_syy);
  END IF;
  UPDATE kulut SET tila = 'peruttu', peruutuksen_syy = p_syy WHERE id = p_id RETURNING * INTO k;
  RETURN k;
END $$;

-- Lisää kulun liitteen (kuitti) polun
CREATE OR REPLACE FUNCTION public.lisaa_kulun_liite(p_id UUID, p_polku TEXT)
RETURNS kulut
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_user UUID := public.vaadi_kayttaja();
  k kulut%ROWTYPE;
BEGIN
  IF split_part(p_polku, '/', 1) <> v_user::text THEN RAISE EXCEPTION 'Virheellinen liitepolku'; END IF;
  UPDATE kulut SET liitteet = array_append(liitteet, p_polku)
   WHERE id = p_id AND user_id = v_user AND NOT (p_polku = ANY(liitteet))
   RETURNING * INTO k;
  IF NOT FOUND THEN SELECT * INTO k FROM kulut WHERE id = p_id AND user_id = v_user; END IF;
  RETURN k;
END $$;

-- Muistiotosite (esim. osakepääoma, poistot, tuloverot, palkat, avaustase)
-- p_viennit: [{tili:'1910', debet:2500, kredit:0, selite:''}]
CREATE OR REPLACE FUNCTION public.kirjaa_muistiotosite(p_pvm DATE, p_selite TEXT, p_viennit JSONB)
RETURNS UUID
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_user UUID := public.vaadi_kayttaja();
  v_lista JSONB;
BEGIN
  IF coalesce(trim(p_selite), '') = '' THEN RAISE EXCEPTION 'Selite puuttuu'; END IF;
  SELECT jsonb_agg(jsonb_build_object(
           'tili', x ->> 'tili',
           'maara', coalesce((x ->> 'debet')::numeric, 0) - coalesce((x ->> 'kredit')::numeric, 0),
           'selite', x ->> 'selite'))
    INTO v_lista FROM jsonb_array_elements(p_viennit) x;
  -- Myynti-/ALV-tilejä ei käsitellä muistiotositteella ilman ALV-tietoja
  IF EXISTS (SELECT 1 FROM jsonb_array_elements(v_lista) x WHERE x ->> 'tili' IN ('1701','2939','1763')) THEN
    RAISE EXCEPTION 'Myyntisaamiset ja ALV-tilit kirjataan laskujen, kulujen ja ALV-tilityksen kautta';
  END IF;
  RETURN public._kirjaa_tosite(v_user, p_pvm, p_selite, 'muistio', NULL, v_lista);
END $$;

-- Oikaisee muistio- tai pankkitositteen
CREATE OR REPLACE FUNCTION public.oikaise_tosite(p_tosite UUID, p_syy TEXT)
RETURNS UUID
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_user UUID := public.vaadi_kayttaja();
  t tositteet%ROWTYPE;
  v_id UUID;
BEGIN
  SELECT * INTO t FROM tositteet WHERE id = p_tosite AND user_id = v_user;
  IF NOT FOUND THEN RAISE EXCEPTION 'Tositetta ei löydy'; END IF;
  IF t.lahde NOT IN ('muistio','pankki','avaus','alv_tilitys') THEN
    RAISE EXCEPTION 'Laskut ja kulut korjataan hyvityslaskulla tai kulun korjauksella';
  END IF;
  IF coalesce(trim(p_syy), '') = '' THEN RAISE EXCEPTION 'Anna oikaisun syy'; END IF;
  v_id := public._oikaise_tosite(v_user, p_tosite, NULL, p_syy);
  UPDATE pankkitapahtumat SET tila = 'avoin', tosite_id = NULL WHERE tosite_id = p_tosite AND user_id = v_user;
  RETURN v_id;
END $$;

-- ─── Pankki ────────────────────────────────────────────────────────────

-- Tuo tiliotteen tapahtumat. p: [{pvm, summa, vastapuoli, viite, viesti, arkistointitunnus}]
CREATE OR REPLACE FUNCTION public.tuo_pankkitapahtumat(p JSONB)
RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_user UUID := public.vaadi_kayttaja();
  v_lisatty INTEGER;
BEGIN
  WITH uudet AS (
    INSERT INTO pankkitapahtumat (user_id, pvm, summa, vastapuoli, viite, viesti, arkistointitunnus)
    SELECT v_user, (x ->> 'pvm')::date, round((x ->> 'summa')::numeric, 2),
           left(x ->> 'vastapuoli', 200), left(regexp_replace(coalesce(x ->> 'viite', ''), '\s', '', 'g'), 40),
           left(x ->> 'viesti', 500),
           coalesce(nullif(x ->> 'arkistointitunnus', ''),
                    md5((x ->> 'pvm') || '|' || (x ->> 'summa') || '|' || coalesce(x ->> 'vastapuoli', '')
                        || '|' || coalesce(x ->> 'viite', '') || '|' || coalesce(x ->> 'viesti', '')))
      FROM jsonb_array_elements(p) x
     WHERE (x ->> 'summa')::numeric <> 0
    ON CONFLICT (user_id, arkistointitunnus) DO NOTHING
    RETURNING 1)
  SELECT count(*) INTO v_lisatty FROM uudet;
  RETURN jsonb_build_object('lisatty', v_lisatty, 'yhteensa', jsonb_array_length(p));
END $$;

-- Kirjaa pankkitapahtuman suoraan tilille (esim. osakepääoman maksu, ALV:n maksu,
-- lainan nosto, pankkikulut ilman ALV:tä). ALV:lliset ostot kirjataan kuluina.
CREATE OR REPLACE FUNCTION public.kirjaa_pankkitapahtuma(p_id UUID, p_tili TEXT, p_selite TEXT)
RETURNS UUID
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_user UUID := public.vaadi_kayttaja();
  pt pankkitapahtumat%ROWTYPE;
  v_tosite UUID;
BEGIN
  SELECT * INTO pt FROM pankkitapahtumat WHERE id = p_id AND user_id = v_user FOR UPDATE;
  IF NOT FOUND OR pt.tila <> 'avoin' THEN RAISE EXCEPTION 'Tapahtuma on jo käsitelty'; END IF;
  IF p_tili IN ('1910','2939','1763') THEN
    RAISE EXCEPTION 'Valitse vastatili (ALV:lliset ostot kirjataan kuluna)';
  END IF;
  v_tosite := public._kirjaa_tosite(v_user, pt.pvm,
    coalesce(nullif(trim(p_selite), ''), coalesce(pt.vastapuoli, '') || ' ' || coalesce(pt.viesti, '')),
    'pankki', pt.id, jsonb_build_array(
      jsonb_build_object('tili', '1910', 'maara', pt.summa),
      jsonb_build_object('tili', p_tili, 'maara', -pt.summa)));
  UPDATE pankkitapahtumat SET tila = 'kasitelty', tosite_id = v_tosite WHERE id = p_id;
  RETURN v_tosite;
END $$;

CREATE OR REPLACE FUNCTION public.ohita_pankkitapahtuma(p_id UUID, p_ohita BOOLEAN DEFAULT true)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE v_user UUID := public.vaadi_kayttaja();
BEGIN
  UPDATE pankkitapahtumat SET tila = CASE WHEN p_ohita THEN 'ohitettu' ELSE 'avoin' END
   WHERE id = p_id AND user_id = v_user AND tosite_id IS NULL;
END $$;

-- ─── ALV ───────────────────────────────────────────────────────────────

-- ALV-laskelma OmaVeron kausiveroilmoituksen kenttien mukaan
CREATE OR REPLACE FUNCTION public.alv_laskelma(p_alku DATE, p_loppu DATE)
RETURNS JSONB
LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_user UUID := public.vaadi_kayttaja();
  v JSONB;
BEGIN
  WITH r AS (
    SELECT v.alv_koodi, v.alv_kanta, (v.kredit - v.debet) AS k, (v.debet - v.kredit) AS d, tl.numero
      FROM viennit v
      JOIN tositteet t ON t.id = v.tosite_id
      JOIN tilit tl ON tl.id = v.tili_id
     WHERE v.user_id = v_user AND t.pvm BETWEEN p_alku AND p_loppu
       AND t.lahde <> 'alv_tilitys'
  )
  SELECT jsonb_build_object(
    'alku', p_alku, 'loppu', p_loppu,
    -- Vero kotimaan myynnistä verokannoittain (sis. EU:n ulkopuoliset palveluostot)
    'vero_255', coalesce(sum(k) FILTER (WHERE numero = '2939' AND alv_kanta = 25.5
                  AND alv_koodi IN ('myynti_vero','ei_eu_palveluosto_vero')), 0),
    'vero_135', coalesce(sum(k) FILTER (WHERE numero = '2939' AND alv_kanta = 13.5
                  AND alv_koodi IN ('myynti_vero','ei_eu_palveluosto_vero')), 0),
    'vero_10',  coalesce(sum(k) FILTER (WHERE numero = '2939' AND alv_kanta = 10
                  AND alv_koodi IN ('myynti_vero','ei_eu_palveluosto_vero')), 0),
    'vero_muut', coalesce(sum(k) FILTER (WHERE numero = '2939' AND alv_kanta NOT IN (25.5, 13.5, 10)
                  AND alv_koodi IN ('myynti_vero','ei_eu_palveluosto_vero')), 0),
    'myynti_255', coalesce(sum(k) FILTER (WHERE alv_koodi = 'myynti' AND alv_kanta = 25.5), 0),
    'myynti_135', coalesce(sum(k) FILTER (WHERE alv_koodi = 'myynti' AND alv_kanta = 13.5), 0),
    'myynti_10',  coalesce(sum(k) FILTER (WHERE alv_koodi = 'myynti' AND alv_kanta = 10), 0),
    'vero_eu_tavaraostot',  coalesce(sum(k) FILTER (WHERE alv_koodi = 'eu_tavaraosto_vero'), 0),
    'vero_eu_palveluostot', coalesce(sum(k) FILTER (WHERE alv_koodi = 'eu_palveluosto_vero'), 0),
    'vahennettava_vero',    coalesce(sum(d) FILTER (WHERE numero = '1763'), 0),
    'nollaverokanta',       coalesce(sum(k) FILTER (WHERE alv_koodi = 'nollaverokanta'), 0),
    'eu_tavaramyynti',      coalesce(sum(k) FILTER (WHERE alv_koodi = 'eu_tavaramyynti'), 0),
    'eu_palvelumyynti',     coalesce(sum(k) FILTER (WHERE alv_koodi = 'eu_palvelumyynti'), 0),
    'eu_tavaraostot',       coalesce(sum(d) FILTER (WHERE alv_koodi = 'eu_tavaraosto'), 0),
    'eu_palveluostot',      coalesce(sum(d) FILTER (WHERE alv_koodi = 'eu_palveluosto'), 0),
    'ei_eu_palveluostot',   coalesce(sum(d) FILTER (WHERE alv_koodi = 'ei_eu_palveluosto'), 0),
    'myynnin_vero_yht',     coalesce(sum(k) FILTER (WHERE numero = '2939'), 0)
  ) INTO v FROM r;

  v := v || jsonb_build_object('maksettava',
         (v ->> 'myynnin_vero_yht')::numeric - (v ->> 'vahennettava_vero')::numeric);
  v := v || jsonb_build_object('tilitetty', EXISTS (
         SELECT 1 FROM tositteet WHERE user_id = v_user AND lahde = 'alv_tilitys'
            AND NOT oikaistu AND oikaisee_id IS NULL
            AND selite = 'ALV-tilitys ' || to_char(p_alku, 'DD.MM.YYYY') || ' – ' || to_char(p_loppu, 'DD.MM.YYYY')));
  RETURN v;
END $$;

-- Yhteenvetoilmoitus (EU-myynnit ostajittain)
CREATE OR REPLACE FUNCTION public.yhteenvetoilmoitus(p_alku DATE, p_loppu DATE)
RETURNS JSONB
LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE v_user UUID := public.vaadi_kayttaja();
BEGIN
  RETURN coalesce((
    SELECT jsonb_agg(jsonb_build_object('alv_tunnus', alv_tunnus, 'nimi', nimi,
                                        'tavarat', tavarat, 'palvelut', palvelut) ORDER BY alv_tunnus)
      FROM (
        SELECT ostaja ->> 'alv_tunnus' AS alv_tunnus, max(ostaja ->> 'nimi') AS nimi,
               sum(summa_veroton) FILTER (WHERE alv_kasittely = 'eu_tavara') AS tavarat,
               sum(summa_veroton) FILTER (WHERE alv_kasittely = 'eu_palvelu') AS palvelut
          FROM laskut
         WHERE user_id = v_user AND tila <> 'luonnos'
           AND alv_kasittely IN ('eu_tavara','eu_palvelu')
           AND laskupaiva BETWEEN p_alku AND p_loppu
         GROUP BY ostaja ->> 'alv_tunnus') s), '[]'::jsonb);
END $$;

-- ALV-tilitys: siirtää kauden myynnin ja ostojen ALV:n tilitettäväksi (2935 / 1765)
CREATE OR REPLACE FUNCTION public.kirjaa_alv_tilitys(p_alku DATE, p_loppu DATE)
RETURNS UUID
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_user UUID := public.vaadi_kayttaja();
  v JSONB;
  v_myynti NUMERIC; v_osto NUMERIC; v_netto NUMERIC;
  v_selite TEXT := 'ALV-tilitys ' || to_char(p_alku, 'DD.MM.YYYY') || ' – ' || to_char(p_loppu, 'DD.MM.YYYY');
BEGIN
  IF p_loppu >= current_date THEN RAISE EXCEPTION 'Verokausi ei ole vielä päättynyt'; END IF;
  IF EXISTS (SELECT 1 FROM tositteet WHERE user_id = v_user AND lahde = 'alv_tilitys'
              AND selite = v_selite AND NOT oikaistu AND oikaisee_id IS NULL) THEN
    RAISE EXCEPTION 'Kausi on jo tilitetty';
  END IF;
  v := public.alv_laskelma(p_alku, p_loppu);
  v_myynti := (v ->> 'myynnin_vero_yht')::numeric;
  v_osto := (v ->> 'vahennettava_vero')::numeric;
  v_netto := v_myynti - v_osto;
  IF v_myynti = 0 AND v_osto = 0 THEN RAISE EXCEPTION 'Kaudella ei ole arvonlisäveroa'; END IF;
  RETURN public._kirjaa_tosite(v_user, p_loppu, v_selite, 'alv_tilitys', NULL, jsonb_build_array(
    jsonb_build_object('tili', '2939', 'maara', v_myynti),
    jsonb_build_object('tili', '1763', 'maara', -v_osto),
    jsonb_build_object('tili', CASE WHEN v_netto >= 0 THEN '2935' ELSE '1765' END, 'maara', -v_netto)));
END $$;

-- ─── Raportit ──────────────────────────────────────────────────────────

-- Tilien saldot: avaava saldo ennen p_alku ja liike kaudella
CREATE OR REPLACE FUNCTION public.tilisaldot(p_alku DATE, p_loppu DATE)
RETURNS TABLE (numero TEXT, nimi TEXT, tyyppi TEXT, ryhma TEXT,
               alkusaldo NUMERIC, debet NUMERIC, kredit NUMERIC, loppusaldo NUMERIC)
LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE v_user UUID := public.vaadi_kayttaja();
BEGIN
  RETURN QUERY
  SELECT tl.numero, tl.nimi, tl.tyyppi, tl.ryhma,
         coalesce(sum(v.debet - v.kredit) FILTER (WHERE t.pvm < p_alku), 0),
         coalesce(sum(v.debet) FILTER (WHERE t.pvm BETWEEN p_alku AND p_loppu), 0),
         coalesce(sum(v.kredit) FILTER (WHERE t.pvm BETWEEN p_alku AND p_loppu), 0),
         coalesce(sum(v.debet - v.kredit) FILTER (WHERE t.pvm <= p_loppu), 0)
    FROM tilit tl
    LEFT JOIN viennit v ON v.tili_id = tl.id
    LEFT JOIN tositteet t ON t.id = v.tosite_id
   WHERE tl.user_id = v_user
   GROUP BY tl.numero, tl.nimi, tl.tyyppi, tl.ryhma
   ORDER BY tl.numero;
END $$;

-- ─── Vanhojen tietojen siirto kirjanpitoon ────────────────────────────

-- Kirjaa ennen tätä migraatiota luodut lähetetyt laskut, maksut ja kulut.
CREATE OR REPLACE FUNCTION public.kirjaa_vanhat_tiedot()
RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_user UUID := public.vaadi_kayttaja();
  l laskut%ROWTYPE;
  k kulut%ROWTYPE;
  p profiilit%ROWTYPE;
  v_laskut INTEGER := 0;
  v_kulut INTEGER := 0;
  v_tosite UUID;
  v_veroton NUMERIC; v_alv NUMERIC; v_erittely JSONB;
  v_tili TEXT;
BEGIN
  PERFORM public._alusta_tilikartta(v_user);
  SELECT * INTO p FROM profiilit WHERE user_id = v_user;

  FOR l IN SELECT * FROM laskut WHERE user_id = v_user AND tosite_id IS NULL
            AND tila IN ('lahetetty','maksettu') ORDER BY laskupaiva, laskunumero LOOP
    SELECT coalesce(sum(veroton),0), coalesce(sum(alv),0),
           coalesce(jsonb_agg(jsonb_build_object('kanta', kanta, 'veroton', veroton, 'alv', alv)), '[]')
      INTO v_veroton, v_alv, v_erittely FROM public._laskun_erittely(l.id);
    UPDATE laskut SET
      summa_veroton = v_veroton, summa_alv = v_alv, summa_verollinen = v_veroton + v_alv,
      alv_erittely = v_erittely, toimituspaiva = coalesce(toimituspaiva, laskupaiva),
      myyja = coalesce(myyja, jsonb_build_object('nimi', p.yritys_nimi, 'y_tunnus', p.y_tunnus,
              'alv_tunnus', p.alv_tunnus, 'osoite', p.osoite, 'postinumero', p.postinumero,
              'kaupunki', p.kaupunki, 'iban', p.iban, 'bic', p.bic)),
      ostaja = coalesce(ostaja, (SELECT jsonb_build_object('nimi', a.nimi, 'y_tunnus', a.y_tunnus,
              'alv_tunnus', a.alv_tunnus, 'osoite', a.osoite, 'postinumero', a.postinumero,
              'kaupunki', a.kaupunki, 'maa', a.maa) FROM asiakkaat a WHERE a.id = l.asiakas_id))
    WHERE id = l.id;
    v_tosite := public._kirjaa_lasku(v_user, l.id);
    UPDATE laskut SET tosite_id = v_tosite WHERE id = l.id;
    IF l.tila = 'maksettu' THEN
      PERFORM public._kirjaa_tosite(v_user, coalesce(l.maksettu_pvm, l.erapaiva),
        'Maksu laskuun ' || l.laskunumero, 'maksu', l.id, jsonb_build_array(
          jsonb_build_object('tili', '1910', 'maara', v_veroton + v_alv),
          jsonb_build_object('tili', '1701', 'maara', -(v_veroton + v_alv))));
      UPDATE laskut SET maksettu_summa = v_veroton + v_alv WHERE id = l.id;
    END IF;
    v_laskut := v_laskut + 1;
  END LOOP;

  FOR k IN SELECT * FROM kulut WHERE user_id = v_user AND tosite_id IS NULL AND tila = 'kirjattu'
            ORDER BY paiva LOOP
    v_tili := CASE k.kategoria
      WHEN 'Toimistotarvikkeet' THEN '7970'
      WHEN 'Atk-laitteet ja ohjelmistot' THEN '7860'
      WHEN 'Puhelin ja tietoliikenne' THEN '7800'
      WHEN 'Matkakulut' THEN '7500'
      WHEN 'Edustuskulut' THEN '7600'
      WHEN 'Markkinointi ja mainonta' THEN '7700'
      WHEN 'Koulutus ja kirjallisuus' THEN '7960'
      WHEN 'Vakuutukset' THEN '7950'
      WHEN 'Toimitilakulut' THEN '7000'
      WHEN 'Kirjanpito ja konsultointi' THEN '7900'
      ELSE '7990' END;
    UPDATE kulut SET tili_id = coalesce(tili_id, public._tili(v_user, v_tili)),
                     alv_vahennys = (v_tili <> '7600'),
                     alv_kasittely = CASE WHEN coalesce(alv_kanta, 0) = 0 THEN 'ei_alv' ELSE 'normaali' END,
                     alv_kanta = coalesce(alv_kanta, 0)
     WHERE id = k.id;
    v_tosite := public._kirjaa_kulu(v_user, k.id);
    UPDATE kulut SET tosite_id = v_tosite WHERE id = k.id;
    v_kulut := v_kulut + 1;
  END LOOP;

  RETURN jsonb_build_object('laskut', v_laskut, 'kulut', v_kulut);
END $$;

-- Funktioiden oikeudet: vain kirjautuneet
DO $$
DECLARE f TEXT;
BEGIN
  FOREACH f IN ARRAY ARRAY[
    'alusta_kirjanpito()', 'luo_tilikausi(date,date)', 'muuta_tilikausi(uuid,date,date)',
    'lukitse_tilikausi(uuid)', 'laheta_lasku(uuid)', 'kirjaa_maksu(uuid,date,numeric,uuid)',
    'luo_hyvityslasku(uuid,text,date)', 'tallenna_kulu(jsonb)', 'peru_kulu(uuid,text)',
    'lisaa_kulun_liite(uuid,text)', 'kirjaa_muistiotosite(date,text,jsonb)', 'oikaise_tosite(uuid,text)',
    'tuo_pankkitapahtumat(jsonb)', 'kirjaa_pankkitapahtuma(uuid,text,text)',
    'ohita_pankkitapahtuma(uuid,boolean)', 'alv_laskelma(date,date)', 'yhteenvetoilmoitus(date,date)',
    'kirjaa_alv_tilitys(date,date)', 'tilisaldot(date,date)', 'kirjaa_vanhat_tiedot()',
    'vaadi_kayttaja()', 'mfa_ok()'] LOOP
    EXECUTE format('REVOKE EXECUTE ON FUNCTION public.%s FROM PUBLIC, anon', f);
    EXECUTE format('GRANT EXECUTE ON FUNCTION public.%s TO authenticated', f);
  END LOOP;
END $$;

-- ═══════════════════════════════════════════════════════════════════════
-- TOSITELIITTEET (Supabase Storage, yksityinen bucket)
-- Polku: <user_id>/<vuosi>/<uuid>-<tiedosto>. Liitteitä ei voi poistaa
-- eikä korvata (säilytys 6 v tilikauden päättymisestä, KPL 2:10).
-- ═══════════════════════════════════════════════════════════════════════

INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES ('tositteet', 'tositteet', false, 10485760,
        ARRAY['application/pdf','image/jpeg','image/png','image/webp','image/heic','application/xml','text/xml'])
ON CONFLICT (id) DO UPDATE SET public = false;

DROP POLICY IF EXISTS tositteet_luku ON storage.objects;
CREATE POLICY tositteet_luku ON storage.objects FOR SELECT TO authenticated
  USING (bucket_id = 'tositteet' AND (storage.foldername(name))[1] = auth.uid()::text AND public.mfa_ok());

DROP POLICY IF EXISTS tositteet_lisays ON storage.objects;
CREATE POLICY tositteet_lisays ON storage.objects FOR INSERT TO authenticated
  WITH CHECK (bucket_id = 'tositteet' AND (storage.foldername(name))[1] = auth.uid()::text AND public.mfa_ok());
-- Ei UPDATE- eikä DELETE-politiikkaa → liitteet ovat pysyviä.
