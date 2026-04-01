-- ═══════════════════════════════════════════════════════
-- KIRJANPITO — Supabase Schema
-- Suorita tämä Supabase SQL Editorissa
-- ═══════════════════════════════════════════════════════

-- UUID-laajennus (yleensä jo käytössä)
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- ─── Profiilit (yritystiedot) ─────────────────────────

CREATE TABLE IF NOT EXISTS profiilit (
  id              UUID DEFAULT uuid_generate_v4() PRIMARY KEY,
  user_id         UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  yritys_nimi     TEXT,
  y_tunnus        TEXT,
  alv_tunnus      TEXT,
  sahkoposti      TEXT,
  puhelin         TEXT,
  kotisivu        TEXT,
  osoite          TEXT,
  postinumero     TEXT,
  kaupunki        TEXT,
  -- Pankkitiedot
  iban            TEXT,
  bic             TEXT,
  pankki          TEXT,
  -- Verotus
  yel_tyotulo     NUMERIC(12,2),
  ika             INTEGER,
  uusi_yrittaja   BOOLEAN DEFAULT false,
  kunnallisvero   NUMERIC(5,2) DEFAULT 21.5,
  alv_kausi       TEXT DEFAULT 'quarterly',   -- quarterly / monthly / annually
  maksuehto       INTEGER DEFAULT 14,
  -- Laskupohjatekstit
  viivastyskorko  TEXT DEFAULT 'Viivästyskorko lakisääteinen viivästyskorko.',
  oletusteksti    TEXT,
  -- Aikaleimat
  luotu           TIMESTAMPTZ DEFAULT NOW(),
  paivitetty      TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE (user_id)
);

-- ─── Asiakkaat ────────────────────────────────────────

CREATE TABLE IF NOT EXISTS asiakkaat (
  id              UUID DEFAULT uuid_generate_v4() PRIMARY KEY,
  user_id         UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  nimi            TEXT NOT NULL,
  y_tunnus        TEXT,
  alv_tunnus      TEXT,
  yhteyshenkilö   TEXT,
  sahkoposti      TEXT,
  puhelin         TEXT,
  osoite          TEXT,
  postinumero     TEXT,
  kaupunki        TEXT,
  maa             TEXT DEFAULT 'FI',
  luotu           TIMESTAMPTZ DEFAULT NOW(),
  paivitetty      TIMESTAMPTZ DEFAULT NOW()
);

-- ─── Laskut ───────────────────────────────────────────

CREATE TABLE IF NOT EXISTS laskut (
  id              UUID DEFAULT uuid_generate_v4() PRIMARY KEY,
  user_id         UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  asiakas_id      UUID REFERENCES asiakkaat(id) ON DELETE SET NULL,
  laskunumero     TEXT NOT NULL,
  laskupaiva      DATE NOT NULL,
  erapaiva        DATE NOT NULL,
  tila            TEXT NOT NULL DEFAULT 'luonnos'
                  CHECK (tila IN ('luonnos','lahetetty','maksettu','peruttu')),
  viitenumero     TEXT,
  lisatiedot      TEXT,
  maksettu_pvm    DATE,
  luotu           TIMESTAMPTZ DEFAULT NOW(),
  paivitetty      TIMESTAMPTZ DEFAULT NOW()
);

-- ─── Laskurivit ───────────────────────────────────────

CREATE TABLE IF NOT EXISTS laskurivit (
  id              UUID DEFAULT uuid_generate_v4() PRIMARY KEY,
  lasku_id        UUID NOT NULL REFERENCES laskut(id) ON DELETE CASCADE,
  jarjestys       INTEGER DEFAULT 0,
  kuvaus          TEXT NOT NULL,
  maara           NUMERIC(12,4) NOT NULL DEFAULT 1,
  yksikko         TEXT DEFAULT 'kpl',
  yksikkohinta    NUMERIC(12,2) NOT NULL DEFAULT 0,
  alv_kanta       NUMERIC(5,2) NOT NULL DEFAULT 25.5,
  luotu           TIMESTAMPTZ DEFAULT NOW()
);

-- ─── Kulut ────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS kulut (
  id              UUID DEFAULT uuid_generate_v4() PRIMARY KEY,
  user_id         UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  paiva           DATE NOT NULL,
  kuvaus          TEXT NOT NULL,
  summa           NUMERIC(12,2) NOT NULL,           -- verollinen summa
  alv_kanta       NUMERIC(5,2) DEFAULT 25.5,
  kategoria       TEXT DEFAULT 'Muut kulut',
  kuitin_numero   TEXT,
  luotu           TIMESTAMPTZ DEFAULT NOW(),
  paivitetty      TIMESTAMPTZ DEFAULT NOW()
);

-- ═══════════════════════════════════════════════════════
-- ROW LEVEL SECURITY (RLS)
-- Käyttäjät näkevät vain omat tietonsa
-- ═══════════════════════════════════════════════════════

ALTER TABLE profiilit  ENABLE ROW LEVEL SECURITY;
ALTER TABLE asiakkaat  ENABLE ROW LEVEL SECURITY;
ALTER TABLE laskut     ENABLE ROW LEVEL SECURITY;
ALTER TABLE laskurivit ENABLE ROW LEVEL SECURITY;
ALTER TABLE kulut      ENABLE ROW LEVEL SECURITY;

-- Profiilit
CREATE POLICY "Käyttäjä hallitsee omaa profiiliaan"
  ON profiilit FOR ALL
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

-- Asiakkaat
CREATE POLICY "Käyttäjä hallitsee omia asiakkaitaan"
  ON asiakkaat FOR ALL
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

-- Laskut
CREATE POLICY "Käyttäjä hallitsee omia laskujaan"
  ON laskut FOR ALL
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

-- Laskurivit — käyttäjä voi käsitellä rivejä jos lasku kuuluu hänelle
CREATE POLICY "Käyttäjä hallitsee laskurivejä laskujen kautta"
  ON laskurivit FOR ALL
  USING (
    EXISTS (
      SELECT 1 FROM laskut
      WHERE laskut.id = laskurivit.lasku_id
        AND laskut.user_id = auth.uid()
    )
  );

-- Kulut
CREATE POLICY "Käyttäjä hallitsee omia kulujaan"
  ON kulut FOR ALL
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

-- ═══════════════════════════════════════════════════════
-- INDEKSIT (suorituskyky)
-- ═══════════════════════════════════════════════════════

CREATE INDEX IF NOT EXISTS idx_asiakkaat_user_id   ON asiakkaat(user_id);
CREATE INDEX IF NOT EXISTS idx_laskut_user_id      ON laskut(user_id);
CREATE INDEX IF NOT EXISTS idx_laskut_laskupaiva   ON laskut(laskupaiva);
CREATE INDEX IF NOT EXISTS idx_laskut_tila         ON laskut(tila);
CREATE INDEX IF NOT EXISTS idx_laskurivit_lasku_id ON laskurivit(lasku_id);
CREATE INDEX IF NOT EXISTS idx_kulut_user_id       ON kulut(user_id);
CREATE INDEX IF NOT EXISTS idx_kulut_paiva         ON kulut(paiva);

-- ═══════════════════════════════════════════════════════
-- PÄIVITYS-TRIGGER (paivitetty-sarake)
-- ═══════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION paivita_aikaleima()
RETURNS TRIGGER AS $$
BEGIN
  NEW.paivitetty = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER tr_profiilit_paivitetty
  BEFORE UPDATE ON profiilit
  FOR EACH ROW EXECUTE FUNCTION paivita_aikaleima();

CREATE TRIGGER tr_asiakkaat_paivitetty
  BEFORE UPDATE ON asiakkaat
  FOR EACH ROW EXECUTE FUNCTION paivita_aikaleima();

CREATE TRIGGER tr_laskut_paivitetty
  BEFORE UPDATE ON laskut
  FOR EACH ROW EXECUTE FUNCTION paivita_aikaleima();

CREATE TRIGGER tr_kulut_paivitetty
  BEFORE UPDATE ON kulut
  FOR EACH ROW EXECUTE FUNCTION paivita_aikaleima();
