// ═══════════════════════════════════════════════════════
// LASKURI — Suomalaiset verolaskelmat
// Finnish tax calculation utilities
// ═══════════════════════════════════════════════════════

// ─── ALV-kannat (VAT rates in Finland 2024–2025) ───────
export const ALV_KANNAT = [
  { arvo: 25.5, nimi: '25,5 % (yleinen)' },
  { arvo: 14,   nimi: '14 % (ruoka, ravintolat)' },
  { arvo: 10,   nimi: '10 % (lääkkeet, kirjat, liikenne)' },
  { arvo: 0,    nimi: '0 % (ei ALV)' },
]

// ─── YEL-prosentit 2025 ────────────────────────────────
export const YEL_PROSENTIT = {
  NORMAALI: 24.10,  // alle 53 tai yli 62
  KESKI:    25.60,  // 53–62-vuotiaat
}

// YEL työtulo rajat 2025
export const YEL_RAJAT = {
  MIN:  9010.28,
  MAX: 207528.00,
}

// Uuden yrittäjän alennus (4 ensimmäistä vuotta)
export const YEL_UUSI_ALENNUS = 0.22  // 22%

// ─── ALV laskut ────────────────────────────────────────

/**
 * Laskee ALV:n verottomasta hinnasta
 * @param {number} verotonHinta - Hinta ilman ALV
 * @param {number} alvKanta - ALV-kanta prosentteina (esim. 25.5)
 * @returns {{ alv: number, verollinenHinta: number }}
 */
export function laskeALV(verotonHinta, alvKanta) {
  const alv = verotonHinta * (alvKanta / 100)
  return {
    alv: Math.round(alv * 100) / 100,
    verollinenHinta: Math.round((verotonHinta + alv) * 100) / 100
  }
}

/**
 * Purkaa ALV:n verollisesta hinnasta
 * @param {number} verollinenHinta
 * @param {number} alvKanta
 * @returns {{ verotonHinta: number, alv: number }}
 */
export function eritteleALV(verollinenHinta, alvKanta) {
  const verotonHinta = verollinenHinta / (1 + alvKanta / 100)
  const alv = verollinenHinta - verotonHinta
  return {
    verotonHinta: Math.round(verotonHinta * 100) / 100,
    alv: Math.round(alv * 100) / 100
  }
}

// ─── Laskurivit ────────────────────────────────────────

/**
 * Laskee yhden laskurivin summat
 */
export function laskeRivi(maara, yksikkohinta, alvKanta) {
  const verotonYhteensa = maara * yksikkohinta
  const { alv, verollinenHinta } = laskeALV(verotonYhteensa, alvKanta)
  return {
    verotonYhteensa: Math.round(verotonYhteensa * 100) / 100,
    alv,
    verollinenYhteensa: Math.round(verollinenHinta * 100) / 100,
  }
}

/**
 * Laskee laskun kokonaissummat (rivit voi olla eri ALV-kannoilla)
 * @param {Array<{maara, yksikkohinta, alv_kanta}>} rivit
 * @returns {{ verotonYhteensa, alvErittely, verollinenYhteensa }}
 */
export function laskeLaskuSummat(rivit) {
  const alvErittely = {}  // { '25.5': { veroton, alv } }
  let verotonYhteensa = 0
  let verollinenYhteensa = 0

  for (const rivi of rivit) {
    const maara = parseFloat(rivi.maara) || 0
    const hinta = parseFloat(rivi.yksikkohinta) || 0
    const kanta = parseFloat(rivi.alv_kanta) || 25.5
    const { verotonYhteensa: vt, alv, verollinenYhteensa: vl } = laskeRivi(maara, hinta, kanta)

    verotonYhteensa += vt
    verollinenYhteensa += vl

    const kantaKey = String(kanta)
    if (!alvErittely[kantaKey]) alvErittely[kantaKey] = { veroton: 0, alv: 0 }
    alvErittely[kantaKey].veroton += vt
    alvErittely[kantaKey].alv += alv
  }

  return {
    verotonYhteensa: Math.round(verotonYhteensa * 100) / 100,
    alvErittely,
    verollinenYhteensa: Math.round(verollinenYhteensa * 100) / 100,
  }
}

// ─── YEL-laskelmat ─────────────────────────────────────

/**
 * Laskee YEL-maksun
 * @param {number} yelTyotulo - Vuotuinen YEL-työtulo
 * @param {number} ika - Yrittäjän ikä
 * @param {boolean} uusiYrittaja - Onko alle 4 vuotta yrittäjänä
 * @returns {{ prosenti, kuukausimaksu, vuosimaksu, alennettu }}
 */
export function laskeYEL(yelTyotulo, ika = 40, uusiYrittaja = false) {
  let prosentti = (ika >= 53 && ika <= 62) ? YEL_PROSENTIT.KESKI : YEL_PROSENTIT.NORMAALI
  let alennettu = false

  if (uusiYrittaja) {
    prosentti = prosentti * (1 - YEL_UUSI_ALENNUS)
    alennettu = true
  }

  const vuosimaksu = yelTyotulo * (prosentti / 100)
  const kuukausimaksu = vuosimaksu / 12

  return {
    prosentti: Math.round(prosentti * 100) / 100,
    kuukausimaksu: Math.round(kuukausimaksu * 100) / 100,
    vuosimaksu: Math.round(vuosimaksu * 100) / 100,
    alennettu,
  }
}

// ─── Tuloveroarvio (yksinkertaistettu) ────────────────

/**
 * Kunnallisverotaulukko 2025 (arvio, keski-Suomi ~21.5%)
 * Valtion tulovero 2025 (progressiivinen)
 */
const VALTION_VEROTAULUKKO_2025 = [
  { min: 0,      max: 21200,  aste: 0,     muuttuva: 0 },
  { min: 21200,  max: 31500,  aste: 6.00,  kiintea: 0 },
  { min: 31500,  max: 52100,  aste: 17.25, kiintea: 618 },
  { min: 52100,  max: 88000,  aste: 21.25, kiintea: 4171.5 },
  { min: 88000,  max: 150000, aste: 31.25, kiintea: 11795.5 },
  { min: 150000, max: Infinity, aste: 34.00, kiintea: 31170.5 },
]

/**
 * Laskee arvion vuosittaisesta tuloverorasituksesta
 * @param {number} bruttoTulo - Verotettava tulo
 * @param {number} kunnallisVero - Kunnallisvero % (oletus 21.5)
 * @returns {{ valtionvero, kunnallisvero, yhteensa, efektiivinenProsentti }}
 */
export function laskeArviolinenTulovero(bruttoTulo, kunnallisVero = 21.5) {
  // Valtionvero
  let valtionvero = 0
  for (const porras of VALTION_VEROTAULUKKO_2025) {
    if (bruttoTulo <= porras.min) break
    const verotettava = Math.min(bruttoTulo, porras.max) - porras.min
    valtionvero = (porras.kiintea || 0) + verotettava * (porras.aste / 100)
  }

  // Kunnallisvero (yksinkertaistettu, ei vähennetä perusvähennystä)
  const kunnallisVeroSumma = bruttoTulo * (kunnallisVero / 100)

  const yhteensa = valtionvero + kunnallisVeroSumma
  const efektiivinenProsentti = bruttoTulo > 0 ? (yhteensa / bruttoTulo) * 100 : 0

  return {
    valtionvero:  Math.round(valtionvero * 100) / 100,
    kunnallisvero: Math.round(kunnallisVeroSumma * 100) / 100,
    yhteensa: Math.round(yhteensa * 100) / 100,
    efektiivinenProsentti: Math.round(efektiivinenProsentti * 10) / 10,
  }
}

// ─── Maksuviite (Finnish bank reference number) ────────

/**
 * Laskee suomalaisen viitenumeron tarkistenumeron
 * Algoritmi: Modulo 10, painot 7–3–1
 * @param {string|number} numero - Perusnumero (esim. laskun numero)
 * @returns {string} Täydellinen viitenumero tarkisteineen
 */
export function laskeViitenumero(numero) {
  const str = String(numero).replace(/\s/g, '')
  const painot = [7, 3, 1]
  let summa = 0
  for (let i = str.length - 1, j = 0; i >= 0; i--, j++) {
    summa += parseInt(str[i]) * painot[j % 3]
  }
  const tarkiste = (10 - (summa % 10)) % 10
  return str + tarkiste
}

/**
 * Muotoilee viitenumeron esitysmuotoon (5 numeroa kerrallaan)
 * @param {string} viitenumero
 * @returns {string} Esim. "12345 67890 3"
 */
export function muotoileViitenumero(viitenumero) {
  const rev = viitenumero.split('').reverse().join('')
  const groups = rev.match(/.{1,5}/g) || []
  return groups.map(g => g.split('').reverse().join('')).reverse().join(' ')
}

// ─── Eräpäivän laskenta ─────────────────────────────────

/**
 * Laskee eräpäivän laskupäivästä
 * @param {string} laskupaiva - ISO date string
 * @param {number} maksuehto - Päiviä (oletus 14)
 * @returns {string} ISO date string
 */
export function laskeErapaiva(laskupaiva, maksuehto = 14) {
  const d = new Date(laskupaiva)
  d.setDate(d.getDate() + maksuehto)
  return d.toISOString().split('T')[0]
}

// ─── Pankkiviivakoodi (Finnish bank barcode version 5) ─

/**
 * Rakentaa suomalaisen pankkiviivakoodin (versio 5)
 * Standardi: https://www.finanssiala.fi/maksaminen/dokumentit/Pankkiviivakoodistandardi.pdf
 *
 * Rakenne (54 merkkiä):
 *   [1]  Versio: 5
 *   [16] IBAN-numero ilman FI-etuliitettä (vain numerot, 16 kpl)
 *   [6]  Eurot (6 numeroa, etunollat)
 *   [2]  Sentit (2 numeroa)
 *   [3]  Välimerkit: 000
 *   [20] Viitenumero (oikealle tasattu, etunollat, ilman välilyöntejä)
 *   [6]  Eräpäivä VVKKPP-muodossa
 *
 * @param {string} iban       - IBAN esim. "FI2112345600000785"
 * @param {number} summa      - Maksettava summa euroina
 * @param {string} viitenumero - Viitenumero (ilman välilyöntejä)
 * @param {string} erapaiva   - ISO date "YYYY-MM-DD"
 * @returns {string} 54-merkkinen viivakoodinumero tai null jos tiedot puuttuvat
 */
export function rakennaPankkiviivakoodi(iban, summa, viitenumero, erapaiva) {
  if (!iban || !summa || !viitenumero || !erapaiva) return null

  // IBAN: poista FI + tarkistenumeot → jäljelle jää 14-numeroinen tilinumero
  // Muoto: FI[2 tarkiste][14 tilinumero] = 18 merkkiä yhteensä
  const ibanPuhdas = iban.replace(/\s/g, '').toUpperCase()
  if (!ibanPuhdas.startsWith('FI') || ibanPuhdas.length !== 18) return null
  const tilinumero = ibanPuhdas.slice(2).padStart(16, '0') // 16 numeroa

  // Summa: eurot 6 numeroa + sentit 2 numeroa
  const summaPyoristetty = Math.round(summa * 100)
  const eurot  = String(Math.floor(summaPyoristetty / 100)).padStart(6, '0')
  const sentit = String(summaPyoristetty % 100).padStart(2, '0')

  // Viitenumero: 20 numeroa, oikealle tasattu, etunollat
  const viite = viitenumero.replace(/\s/g, '').padStart(20, '0')

  // Eräpäivä: VVKKPP (2-digit year, month, day)
  const [vuosi, kuukausi, paiva] = erapaiva.split('-')
  const pvmStr = vuosi.slice(2) + kuukausi + paiva

  return `5${tilinumero}${eurot}${sentit}000${viite}${pvmStr}`
}

/**
 * Rakentaa SEPA-maksun QR-koodin sisällön (EPC QR)
 * Luettavissa suomalaisilla mobiilipankkisovelluksilla (OP, Nordea, S-Pankki jne.)
 *
 * @param {string} saajaNimi  - Yrityksen nimi
 * @param {string} iban       - IBAN
 * @param {number} summa      - Summa euroina
 * @param {string} viite      - Viitenumero
 * @param {string} viesti     - Vapaaehtoinen viesti
 * @returns {string} QR-koodin tekstisisältö
 */
export function rakennaSepaQR(saajaNimi, iban, summa, viite, viesti = '') {
  const ibanPuhdas = (iban || '').replace(/\s/g, '').toUpperCase()
  const summaTeksti = `EUR${summa.toFixed(2)}`
  return [
    'BCD',          // Service tag
    '002',          // Version
    '1',            // Character set (UTF-8)
    'SCT',          // SEPA Credit Transfer
    '',             // BIC (vapaaehtoinen)
    saajaNimi.substring(0, 70),
    ibanPuhdas,
    summaTeksti,
    '',             // Purpose (vapaaehtoinen)
    viite.replace(/\s/g, ''),
    viesti.substring(0, 140),
  ].join('\n')
}

// ─── ALV-kauden laskenta ───────────────────────────────

/**
 * Palauttaa ALV-ilmoituskauden raporttia varten
 */
export function haeALVKaudet(vuosi) {
  return [
    { nimi: 'Q1 (tammi–maaliskuu)',  alku: `${vuosi}-01-01`, loppu: `${vuosi}-03-31` },
    { nimi: 'Q2 (huhti–kesäkuu)',    alku: `${vuosi}-04-01`, loppu: `${vuosi}-06-30` },
    { nimi: 'Q3 (heinä–syyskuu)',    alku: `${vuosi}-07-01`, loppu: `${vuosi}-09-30` },
    { nimi: 'Q4 (loka–joulukuu)',    alku: `${vuosi}-10-01`, loppu: `${vuosi}-12-31` },
  ]
}
