// ═══════════════════════════════════════════════════════
// FORMATTERS — Finnish locale formatting utilities
// ═══════════════════════════════════════════════════════

// ─── Raha (Currency) ───────────────────────────────────

/**
 * Muotoilee summan euroiksi suomalaiseen muotoon
 * @param {number} summa
 * @param {number} desimaalit
 * @returns {string} Esim. "1 234,56 €"
 */
export function formatoiEuro(summa, desimaalit = 2) {
  if (summa === null || summa === undefined || isNaN(summa)) return '0,00 €'
  return new Intl.NumberFormat('fi-FI', {
    style: 'currency',
    currency: 'EUR',
    minimumFractionDigits: desimaalit,
    maximumFractionDigits: desimaalit,
  }).format(summa)
}

/**
 * Muotoilee luvun suomalaiseen muotoon (tuhanserottimet, desimaalit)
 */
export function formatoiLuku(luku, desimaalit = 2) {
  if (luku === null || luku === undefined || isNaN(luku)) return '0'
  return new Intl.NumberFormat('fi-FI', {
    minimumFractionDigits: desimaalit,
    maximumFractionDigits: desimaalit,
  }).format(luku)
}

/**
 * Muotoilee prosentin
 */
export function formatoiProsentti(arvo, desimaalit = 1) {
  if (arvo === null || arvo === undefined || isNaN(arvo)) return '0 %'
  return formatoiLuku(arvo, desimaalit) + ' %'
}

// ─── Päivämäärät (Dates) ───────────────────────────────

/**
 * Muotoilee päivämäärän suomalaiseen muotoon
 * @param {string|Date} paiva
 * @returns {string} Esim. "31.12.2025"
 */
export function formatoiPaiva(paiva) {
  if (!paiva) return '—'
  const d = new Date(paiva)
  if (isNaN(d.getTime())) return '—'
  return new Intl.DateTimeFormat('fi-FI', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
  }).format(d)
}

/**
 * Palauttaa päivämäärän ISO-muodossa (YYYY-MM-DD)
 */
export function isoTanaan() {
  return new Date().toISOString().split('T')[0]
}

/**
 * Palauttaa päivämäärän kuukausinimen kanssa
 * @returns {string} Esim. "31. joulukuuta 2025"
 */
export function formatoiPaivaLong(paiva) {
  if (!paiva) return '—'
  const d = new Date(paiva)
  if (isNaN(d.getTime())) return '—'
  return new Intl.DateTimeFormat('fi-FI', {
    day: 'numeric',
    month: 'long',
    year: 'numeric',
  }).format(d)
}

/**
 * Palauttaa kuukauden nimen
 */
export const KUUKAUDET = [
  'Tammikuu', 'Helmikuu', 'Maaliskuu', 'Huhtikuu',
  'Toukokuu', 'Kesäkuu', 'Heinäkuu', 'Elokuu',
  'Syyskuu', 'Lokakuu', 'Marraskuu', 'Joulukuu',
]

export const KUUKAUDET_LYHYT = [
  'Tam', 'Hel', 'Maa', 'Huh',
  'Tou', 'Kes', 'Hei', 'Elo',
  'Syy', 'Lok', 'Mar', 'Jou',
]

/**
 * Tarkistaa onko lasku myöhässä
 */
export function onMyohassa(erapaiva, tila) {
  if (tila === 'maksettu' || tila === 'peruttu') return false
  return new Date(erapaiva) < new Date()
}

/**
 * Laskee päivät eräpäivään (negatiivinen = myöhässä)
 */
export function paiviaErapaivaan(erapaiva) {
  const nyt = new Date()
  nyt.setHours(0, 0, 0, 0)
  const era = new Date(erapaiva)
  era.setHours(0, 0, 0, 0)
  return Math.round((era - nyt) / (1000 * 60 * 60 * 24))
}

// ─── Status-käännökset ─────────────────────────────────

export const LASKU_TILAT = {
  luonnos:   { nimi: 'Luonnos',   luokka: 'badge-luonnos' },
  lahetetty: { nimi: 'Lähetetty', luokka: 'badge-lahetetty' },
  maksettu:  { nimi: 'Maksettu',  luokka: 'badge-maksettu' },
  myohassa:  { nimi: 'Myöhässä',  luokka: 'badge-myohassa' },
  peruttu:   { nimi: 'Peruttu',   luokka: 'badge-peruttu' },
}

export function tilaHTML(tila, erapaiva) {
  const efektiivinenTila = onMyohassa(erapaiva, tila) ? 'myohassa' : tila
  const t = LASKU_TILAT[efektiivinenTila] || LASKU_TILAT.luonnos
  return `<span class="badge ${t.luokka}"><span class="badge-dot"></span>${t.nimi}</span>`
}

// ─── Kulujen kategoriat ────────────────────────────────

export const KULU_KATEGORIAT = [
  'Toimistotarvikkeet',
  'Atk-laitteet ja ohjelmistot',
  'Puhelin ja tietoliikenne',
  'Matkakulut',
  'Edustuskulut',
  'Markkinointi ja mainonta',
  'Koulutus ja kirjallisuus',
  'Vakuutukset',
  'Toimitilakulut',
  'Kirjanpito ja konsultointi',
  'Muut kulut',
]

// ─── Maksuehto-vaihtoehdot ─────────────────────────────

export const MAKSUEHTO_VAIHTOEHDOT = [
  { paivat: 7,  nimi: '7 päivää netto' },
  { paivat: 14, nimi: '14 päivää netto' },
  { paivat: 21, nimi: '21 päivää netto' },
  { paivat: 30, nimi: '30 päivää netto' },
  { paivat: 45, nimi: '45 päivää netto' },
  { paivat: 60, nimi: '60 päivää netto' },
]

// ─── Käyttäjänimikirjaimet ────────────────────────────

export function nimikirjaimet(nimi) {
  if (!nimi) return '?'
  return nimi.split(' ').map(s => s[0]).join('').substring(0, 2).toUpperCase()
}

// ─── Y-tunnus validointi ───────────────────────────────

export function validoiYTunnus(ytunnus) {
  if (!ytunnus) return false
  const regex = /^\d{7}-\d$/
  if (!regex.test(ytunnus)) return false
  const numerot = ytunnus.replace('-', '')
  const painot = [7, 9, 10, 5, 8, 4, 2]
  let summa = 0
  for (let i = 0; i < 7; i++) {
    summa += parseInt(numerot[i]) * painot[i]
  }
  const jakojaannos = summa % 11
  if (jakojaannos === 1) return false
  const tarkiste = jakojaannos === 0 ? 0 : 11 - jakojaannos
  return tarkiste === parseInt(numerot[7])
}

// ─── IBAN formatointi ──────────────────────────────────

export function formatoiIBAN(iban) {
  if (!iban) return ''
  return iban.replace(/\s/g, '').match(/.{1,4}/g)?.join(' ') || iban
}
