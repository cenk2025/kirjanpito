// ═══════════════════════════════════════════════════════
// FORMATTERS — Suomalaiset muotoilut
// ═══════════════════════════════════════════════════════

import { html } from './html.js'
import { isoTanaanPaikallinen } from './laskuri.js'

// ─── Raha ──────────────────────────────────────────────

const EURO = new Intl.NumberFormat('fi-FI', { style: 'currency', currency: 'EUR' })

export function formatoiEuro(summa) {
  const n = Number(summa)
  if (summa === null || summa === undefined || !Number.isFinite(n)) return '0,00 €'
  return EURO.format(n)
}

export function formatoiLuku(luku, desimaalit = 2) {
  const n = Number(luku)
  if (!Number.isFinite(n)) return '0'
  return new Intl.NumberFormat('fi-FI', {
    minimumFractionDigits: desimaalit,
    maximumFractionDigits: desimaalit,
  }).format(n)
}

export function formatoiProsentti(arvo, desimaalit = 1) {
  return formatoiLuku(arvo, desimaalit) + ' %'
}

// ─── Päivämäärät ───────────────────────────────────────

/** "2026-03-05" → "05.03.2026" (ilman aikavyöhykemuunnoksia) */
export function formatoiPaiva(paiva) {
  if (!paiva) return '—'
  const m = String(paiva).match(/^(\d{4})-(\d{2})-(\d{2})/)
  if (m) return `${m[3]}.${m[2]}.${m[1]}`
  const d = new Date(paiva)
  return isNaN(d.getTime()) ? '—' : new Intl.DateTimeFormat('fi-FI').format(d)
}

export function formatoiAika(aika) {
  if (!aika) return '—'
  const d = new Date(aika)
  return isNaN(d.getTime()) ? '—' : new Intl.DateTimeFormat('fi-FI', {
    day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit',
  }).format(d)
}

export function isoTanaan() {
  return isoTanaanPaikallinen()
}

export const KUUKAUDET_LYHYT = ['Tam', 'Hel', 'Maa', 'Huh', 'Tou', 'Kes', 'Hei', 'Elo', 'Syy', 'Lok', 'Mar', 'Jou']

export function onMyohassa(erapaiva, tila) {
  if (!['lahetetty', 'osittain'].includes(tila)) return false
  return erapaiva < isoTanaan()
}

export function paiviaErapaivaan(erapaiva) {
  const [v1, k1, p1] = isoTanaan().split('-').map(Number)
  const [v2, k2, p2] = erapaiva.split('-').map(Number)
  return Math.round((Date.UTC(v2, k2 - 1, p2) - Date.UTC(v1, k1 - 1, p1)) / 86400000)
}

// ─── Laskun tilat ──────────────────────────────────────

export const LASKU_TILAT = {
  luonnos:   { nimi: 'Luonnos',   luokka: 'badge-luonnos' },
  lahetetty: { nimi: 'Lähetetty', luokka: 'badge-lahetetty' },
  osittain:  { nimi: 'Osittain maksettu', luokka: 'badge-lahetetty' },
  maksettu:  { nimi: 'Maksettu',  luokka: 'badge-maksettu' },
  myohassa:  { nimi: 'Myöhässä',  luokka: 'badge-myohassa' },
  hyvitetty: { nimi: 'Hyvitetty', luokka: 'badge-peruttu' },
  peruttu:   { nimi: 'Peruttu',   luokka: 'badge-peruttu' },
}

export function efektiivinenTila(lasku) {
  if (lasku.tyyppi === 'hyvitys') return 'hyvitys'
  return onMyohassa(lasku.erapaiva, lasku.tila) ? 'myohassa' : lasku.tila
}

export function tilaHTML(tila) {
  if (tila === 'hyvitys') {
    return html`<span class="badge badge-peruttu"><span class="badge-dot"></span>Hyvityslasku</span>`
  }
  const t = LASKU_TILAT[tila] || LASKU_TILAT.luonnos
  return html`<span class="badge ${t.luokka}"><span class="badge-dot"></span>${t.nimi}</span>`
}

// ─── ALV-käsittelyt ────────────────────────────────────

export const MYYNNIN_ALV_KASITTELYT = {
  normaali:   { nimi: 'Kotimaan myynti (ALV)', teksti: '' },
  eu_palvelu: { nimi: 'Palvelumyynti toiseen EU-maahan (käännetty verovelvollisuus)',
                teksti: 'Käännetty verovelvollisuus / Reverse charge (AVL 65 §, ALV-direktiivi 196 art.)' },
  eu_tavara:  { nimi: 'Tavaramyynti toiseen EU-maahan (yhteisömyynti)',
                teksti: 'Verovapaa yhteisömyynti / Intra-Community supply (AVL 72 a §, ALV-direktiivi 138 art.)' },
  vienti:     { nimi: 'Myynti EU:n ulkopuolelle (0 %)',
                teksti: 'Verovapaa myynti EU:n ulkopuolelle / Export, VAT 0 % (AVL 70 §)' },
  veroton:    { nimi: 'Arvonlisäveroton myynti', teksti: 'Arvonlisäveroton myynti' },
}

export const OSTON_ALV_KASITTELYT = {
  normaali:          'Kotimaan osto (ALV sisältyy summaan)',
  ei_eu_palveluosto: 'Palveluosto EU:n ulkopuolelta (esim. USA) — käännetty verovelvollisuus',
  eu_palveluosto:    'Palveluosto toisesta EU-maasta — käännetty verovelvollisuus',
  eu_tavaraosto:     'Tavaraosto toisesta EU-maasta (yhteisöhankinta)',
  ei_alv:            'Ei arvonlisäveroa (esim. vakuutus, pankkikulu, palkka)',
}

export const MAKSUTAVAT = {
  pankki:    'Yrityksen pankkitililtä',
  osakas:    'Osakas maksoi omilla varoillaan (velka osakkaalle)',
  ostovelka: 'Maksamatta (ostovelka)',
}

export const MAKSUEHTO_VAIHTOEHDOT = [
  { paivat: 0,  nimi: 'Heti' },
  { paivat: 7,  nimi: '7 päivää netto' },
  { paivat: 14, nimi: '14 päivää netto' },
  { paivat: 21, nimi: '21 päivää netto' },
  { paivat: 30, nimi: '30 päivää netto' },
  { paivat: 45, nimi: '45 päivää netto' },
  { paivat: 60, nimi: '60 päivää netto' },
]

export const EU_MAAT = ['AT', 'BE', 'BG', 'CY', 'CZ', 'DE', 'DK', 'EE', 'ES', 'FI', 'FR', 'GR', 'HR', 'HU',
  'IE', 'IT', 'LT', 'LU', 'LV', 'MT', 'NL', 'PL', 'PT', 'RO', 'SE', 'SI', 'SK']

// ─── Muut ──────────────────────────────────────────────

export function nimikirjaimet(nimi) {
  if (!nimi) return '?'
  return nimi.split(/[\s._-]+/).filter(Boolean).map(s => s[0]).join('').substring(0, 2).toUpperCase()
}

export function validoiYTunnus(ytunnus) {
  if (!ytunnus || !/^\d{7}-\d$/.test(ytunnus)) return false
  const numerot = ytunnus.replace('-', '')
  const painot = [7, 9, 10, 5, 8, 4, 2]
  let summa = 0
  for (let i = 0; i < 7; i++) summa += parseInt(numerot[i], 10) * painot[i]
  const jaannos = summa % 11
  if (jaannos === 1) return false
  return (jaannos === 0 ? 0 : 11 - jaannos) === parseInt(numerot[7], 10)
}

export function formatoiIBAN(iban) {
  if (!iban) return ''
  return iban.replace(/\s/g, '').match(/.{1,4}/g)?.join(' ') || iban
}

export function ytunnusAlvTunnukseksi(ytunnus) {
  return ytunnus ? 'FI' + ytunnus.replace('-', '') : ''
}
