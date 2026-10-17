// ═══════════════════════════════════════════════════════
// LASKURI — Suomalaiset vero- ja laskulaskelmat
//
// Rahasummat lasketaan kokonaislukuina (sentteinä, BigInt), jotta
// pyöristys vastaa tietokannan NUMERIC-laskentaa (round half away
// from zero). Tietokanta on aina lopullinen totuus: lähetetyn laskun
// summat luetaan laskulta, ei lasketa uudelleen.
// ═══════════════════════════════════════════════════════

// ─── ALV-kannat ───────────────────────────────────────
// Lähde: vero.fi. Yleinen 25,5 % 1.9.2024 alkaen, alennettu 14 % → 13,5 %
// 1.1.2026 alkaen (elintarvikkeet, ravintolat, kirjat, lääkkeet,
// henkilökuljetus, majoitus, kulttuuri, liikunta), 10 % lehdet.
const ALV_HISTORIA = [
  { alkaen: '2026-01-01', kannat: [25.5, 13.5, 10, 0] },
  { alkaen: '2024-09-01', kannat: [25.5, 14, 10, 0] },
  { alkaen: '2013-01-01', kannat: [24, 14, 10, 0] },
]

const KANTA_NIMET = {
  25.5: '25,5 % (yleinen)',
  24: '24 % (yleinen, ennen 1.9.2024)',
  14: '14 % (alennettu, ennen 2026)',
  13.5: '13,5 % (ruoka, ravintolat, kirjat, lääkkeet, kuljetus)',
  10: '10 % (sanoma- ja aikakauslehdet)',
  0: '0 %',
}

/** Toimituspäivänä voimassa olevat ALV-kannat */
export function alvKannatPaivalle(pvm = isoTanaanPaikallinen()) {
  const jakso = ALV_HISTORIA.find(j => pvm >= j.alkaen) || ALV_HISTORIA[ALV_HISTORIA.length - 1]
  return jakso.kannat.map(arvo => ({ arvo, nimi: KANTA_NIMET[arvo] || `${arvo} %` }))
}

export const YLEINEN_ALV = 25.5

// ─── YEL 2026 ─────────────────────────────────────────
// Lähde: työeläkeyhtiöiden sosiaalivakuutusmaksut 2026.
export const YEL_VUOSI = 2026
export const YEL_PROSENTTI = 24.40          // iästä riippumatta
export const YEL_RAJAT = { MIN: 9423.09, MAX: 214000.00 }
export const YEL_UUSI_ALENNUS = 0.22        // 48 kk aloittavana yrittäjänä

// ─── Yhteisövero ──────────────────────────────────────
export const YHTEISOVERO_PROSENTTI = 20

// ─── Desimaalit ja pyöristys ───────────────────────────

/** Muuntaa luvun/merkkijonon kokonaisluvuksi kertoimella 10^desimaalit (BigInt). */
export function skaalaa(arvo, desimaalit) {
  if (arvo === null || arvo === undefined || arvo === '') return 0n
  let s = typeof arvo === 'number'
    ? (Number.isFinite(arvo) ? arvo.toFixed(Math.min(desimaalit + 2, 10)) : '0')
    : String(arvo).trim().replace(',', '.')
  if (!/^-?\d*(\.\d*)?$/.test(s) || s === '-' || s === '.' || s === '') return 0n
  const neg = s.startsWith('-')
  if (neg) s = s.slice(1)
  const [kok, desOsa = ''] = s.split('.')
  const ylimaara = desOsa.slice(desimaalit)
  const des = desOsa.slice(0, desimaalit).padEnd(desimaalit, '0')
  let tulos = BigInt((kok || '0') + des)
  if (ylimaara && ylimaara[0] >= '5') tulos += 1n
  return neg ? -tulos : tulos
}

/** Jako pyöristäen puolikkaat nollasta poispäin */
function jaaPyoristaen(osoittaja, nimittaja) {
  const neg = (osoittaja < 0n) !== (nimittaja < 0n)
  const a = osoittaja < 0n ? -osoittaja : osoittaja
  const b = nimittaja < 0n ? -nimittaja : nimittaja
  const q = (a * 2n + b) / (b * 2n)
  return neg ? -q : q
}

const senteista = (c) => Number(c) / 100

// ─── Laskurivit ja laskun summat ───────────────────────

/** Rivin veroton summa sentteinä: round(määrä × à-hinta, 2) */
export function rivinVerotonSentit(maara, yksikkohinta) {
  const m = skaalaa(maara, 4)
  const h = skaalaa(yksikkohinta, 2)
  return jaaPyoristaen(m * h, 10000n)
}

/** ALV verottomasta summasta (sentit): round(veroton × kanta / 100, 2) */
export function alvSentit(verotonSentit, kanta) {
  const k = skaalaa(kanta, 2)
  return jaaPyoristaen(verotonSentit * k, 10000n)
}

export function laskeRivi(maara, yksikkohinta, alvKanta) {
  const veroton = rivinVerotonSentit(maara, yksikkohinta)
  const alv = alvSentit(veroton, alvKanta)
  return {
    verotonYhteensa: senteista(veroton),
    alv: senteista(alv),
    verollinenYhteensa: senteista(veroton + alv),
  }
}

/**
 * Laskun summat. ALV lasketaan verokannoittain yhteenlasketusta
 * verottomasta summasta (sama sääntö kuin tietokannassa).
 * Verokanta 0 säilyy nollana.
 */
export function laskeLaskuSummat(rivit) {
  const kannat = new Map()
  for (const rivi of rivit || []) {
    const kanta = Number(rivi.alv_kanta ?? 0)
    const avain = Number.isFinite(kanta) ? kanta : 0
    kannat.set(avain, (kannat.get(avain) || 0n) + rivinVerotonSentit(rivi.maara, rivi.yksikkohinta))
  }
  let veroton = 0n
  let alv = 0n
  const alvErittely = []
  for (const [kanta, vt] of [...kannat.entries()].sort((a, b) => b[0] - a[0])) {
    const a = alvSentit(vt, kanta)
    veroton += vt
    alv += a
    alvErittely.push({ kanta, veroton: senteista(vt), alv: senteista(a) })
  }
  return {
    verotonYhteensa: senteista(veroton),
    alvYhteensa: senteista(alv),
    verollinenYhteensa: senteista(veroton + alv),
    alvErittely,
  }
}

/** Lähetetyn laskun jäädytetyt summat, luonnokselle laskettuna */
export function laskunSummat(lasku) {
  if (lasku && lasku.summa_verollinen !== null && lasku.summa_verollinen !== undefined) {
    return {
      verotonYhteensa: Number(lasku.summa_veroton),
      alvYhteensa: Number(lasku.summa_alv),
      verollinenYhteensa: Number(lasku.summa_verollinen),
      alvErittely: (lasku.alv_erittely || []).map(e => ({
        kanta: Number(e.kanta), veroton: Number(e.veroton), alv: Number(e.alv),
      })),
    }
  }
  return laskeLaskuSummat(lasku?.rivit || [])
}

/** Erottelee ALV:n verollisesta summasta: alv = round(summa × k / (100 + k), 2) */
export function eritteleALV(verollinenHinta, alvKanta) {
  const s = skaalaa(verollinenHinta, 2)
  const k = skaalaa(alvKanta, 2)
  const alv = k === 0n ? 0n : jaaPyoristaen(s * k, 10000n + k)
  return { verotonHinta: senteista(s - alv), alv: senteista(alv) }
}

/** ALV verottomasta summasta (esim. käännetty verovelvollisuus) */
export function laskeALV(verotonHinta, alvKanta) {
  const s = skaalaa(verotonHinta, 2)
  const alv = alvSentit(s, alvKanta)
  return { alv: senteista(alv), verollinenHinta: senteista(s + alv) }
}

// ─── YEL ja yhteisövero ────────────────────────────────

export function laskeYEL(yelTyotulo, uusiYrittaja = false) {
  let prosentti = YEL_PROSENTTI
  if (uusiYrittaja) prosentti = prosentti * (1 - YEL_UUSI_ALENNUS)
  const tulo = Math.min(Math.max(Number(yelTyotulo) || 0, 0), YEL_RAJAT.MAX)
  const vuosimaksu = tulo * (prosentti / 100)
  return {
    prosentti: Math.round(prosentti * 100) / 100,
    vuosimaksu: Math.round(vuosimaksu * 100) / 100,
    kuukausimaksu: Math.round((vuosimaksu / 12) * 100) / 100,
    alennettu: !!uusiYrittaja,
    alleAlarajan: tulo > 0 && tulo < YEL_RAJAT.MIN,
  }
}

/** Arvio Oy:n yhteisöverosta (20 %). Vahvistetut tappiot vähennetään. */
export function laskeYhteisovero(tulosEnnenVeroja, vahennyskelvottomat = 0, tappiot = 0) {
  const verotettava = Math.max(0, (Number(tulosEnnenVeroja) || 0) + (Number(vahennyskelvottomat) || 0)
    - (Number(tappiot) || 0))
  return {
    verotettava: Math.round(verotettava * 100) / 100,
    vero: Math.round(verotettava * YHTEISOVERO_PROSENTTI) / 100,
  }
}

// ─── Viitenumerot ja IBAN ─────────────────────────────

/** Suomalainen viitenumero (tarkiste 7-3-1) */
export function laskeViitenumero(numero) {
  const str = String(numero).replace(/\D/g, '')
  if (!str) return ''
  const painot = [7, 3, 1]
  let summa = 0
  for (let i = str.length - 1, j = 0; i >= 0; i--, j++) {
    summa += parseInt(str[i], 10) * painot[j % 3]
  }
  return str + ((10 - (summa % 10)) % 10)
}

export function tarkistaViitenumero(viite) {
  const s = String(viite || '').replace(/\s/g, '')
  if (!/^\d{4,20}$/.test(s)) return false
  return laskeViitenumero(s.slice(0, -1)) === s
}

/** Esitysmuoto viiden numeron ryhmissä oikealta */
export function muotoileViitenumero(viitenumero) {
  const s = String(viitenumero || '').replace(/\s/g, '')
  const ryhmat = []
  for (let i = s.length; i > 0; i -= 5) ryhmat.unshift(s.slice(Math.max(0, i - 5), i))
  return ryhmat.join(' ')
}

function mod97(numerot) {
  let jaannos = 0
  for (const c of numerot) jaannos = (jaannos * 10 + Number(c)) % 97
  return jaannos
}

/** Kansallinen viite → RF-viite (ISO 11649) */
export function rfViite(kansallinenViite) {
  const viite = String(kansallinenViite || '').replace(/\s/g, '')
  const tarkiste = 98 - mod97(viite + '271500') // R=27, F=15, 00
  return 'RF' + String(tarkiste).padStart(2, '0') + viite
}

export function tarkistaIBAN(iban) {
  const s = String(iban || '').replace(/\s/g, '').toUpperCase()
  if (!/^[A-Z]{2}\d{2}[A-Z0-9]{10,30}$/.test(s)) return false
  const siirretty = s.slice(4) + s.slice(0, 4)
  const numerot = siirretty.replace(/[A-Z]/g, c => String(c.charCodeAt(0) - 55))
  return mod97(numerot) === 1
}

// ─── Päivämäärät ──────────────────────────────────────

/** Paikallinen päivä ISO-muodossa (UTC voisi antaa edellisen päivän klo 00–03) */
export function isoTanaanPaikallinen(d = new Date()) {
  const kk = String(d.getMonth() + 1).padStart(2, '0')
  const pv = String(d.getDate()).padStart(2, '0')
  return `${d.getFullYear()}-${kk}-${pv}`
}

export function lisaaPaivia(iso, paivat) {
  const [v, k, p] = iso.split('-').map(Number)
  return new Date(Date.UTC(v, k - 1, p + Number(paivat || 0))).toISOString().slice(0, 10)
}

export function laskeErapaiva(laskupaiva, maksuehto = 14) {
  return lisaaPaivia(laskupaiva, maksuehto)
}

export function paivienErotus(alku, loppu) {
  const [v1, k1, p1] = alku.split('-').map(Number)
  const [v2, k2, p2] = loppu.split('-').map(Number)
  return Math.round((Date.UTC(v2, k2 - 1, p2) - Date.UTC(v1, k1 - 1, p1)) / 86400000)
}

function seuraavaArkipaiva(iso) {
  let d = iso
  for (;;) {
    const [v, k, p] = d.split('-').map(Number)
    const vp = new Date(Date.UTC(v, k - 1, p)).getUTCDay()
    if (vp !== 0 && vp !== 6) return d
    d = lisaaPaivia(d, 1)
  }
}

function kuunViimeinen(v, k) {
  return new Date(Date.UTC(v, k, 0)).toISOString().slice(0, 10)
}

/**
 * ALV-verokaudet ja eräpäivät (ilmoitus ja maksu).
 * Kuukausi ja neljännes: verokautta seuraavan toisen kuukauden 12. päivä.
 * Kalenterivuosi: seuraavan vuoden helmikuun 26. päivä.
 * Viikonloppu siirtää eräpäivän seuraavaan arkipäivään (pyhiä ei huomioida).
 */
export function haeALVKaudet(vuosi, kausi = 'quarterly') {
  const v = Number(vuosi)
  const era = (loppuK) => {
    const k = loppuK + 2
    const ev = k > 12 ? v + 1 : v
    const ek = k > 12 ? k - 12 : k
    return seuraavaArkipaiva(`${ev}-${String(ek).padStart(2, '0')}-12`)
  }
  if (kausi === 'annually') {
    return [{ nimi: `Vuosi ${v}`, alku: `${v}-01-01`, loppu: `${v}-12-31`,
              erapaiva: seuraavaArkipaiva(`${v + 1}-02-26`) }]
  }
  if (kausi === 'monthly') {
    const nimet = ['Tammi', 'Helmi', 'Maalis', 'Huhti', 'Touko', 'Kesä', 'Heinä', 'Elo', 'Syys', 'Loka', 'Marras', 'Joulu']
    return nimet.map((n, i) => ({
      nimi: `${n}kuu ${v}`,
      alku: `${v}-${String(i + 1).padStart(2, '0')}-01`,
      loppu: kuunViimeinen(v, i + 1),
      erapaiva: era(i + 1),
    }))
  }
  return [
    { nimi: `Q1/${v} (tammi–maaliskuu)`, alku: `${v}-01-01`, loppu: `${v}-03-31`, erapaiva: era(3) },
    { nimi: `Q2/${v} (huhti–kesäkuu)`, alku: `${v}-04-01`, loppu: `${v}-06-30`, erapaiva: era(6) },
    { nimi: `Q3/${v} (heinä–syyskuu)`, alku: `${v}-07-01`, loppu: `${v}-09-30`, erapaiva: era(9) },
    { nimi: `Q4/${v} (loka–joulukuu)`, alku: `${v}-10-01`, loppu: `${v}-12-31`, erapaiva: era(12) },
  ]
}

/** Viivästyskorko (korkolaki 4 §): viitekorko + 8 %-yksikköä, todelliset päivät / 365 */
export function laskeViivastyskorko(paaoma, erapaiva, maksupaiva, viitekorko) {
  const paivat = Math.max(0, paivienErotus(erapaiva, maksupaiva))
  const korko = (Number(viitekorko) || 0) + 8
  return { paivat, korko, summa: Math.round(paaoma * korko / 100 * paivat / 365 * 100) / 100 }
}

// ─── Pankkiviivakoodi (versio 4, kansallinen viite) ───

/**
 * Pankkiviivakoodi versio 4 (Finanssiala, pankkiviivakoodistandardi).
 * 54 numeroa: "4" + IBAN ilman maatunnusta (16) + eurot (6) + sentit (2)
 * + "000" + kansallinen viite etunollin (20) + eräpäivä VVKKPP (6).
 * Versio 5 on varattu RF-viitteelle.
 */
export function rakennaPankkiviivakoodi(iban, summa, viitenumero, erapaiva) {
  if (!iban || !viitenumero || !erapaiva) return null
  const ibanPuhdas = iban.replace(/\s/g, '').toUpperCase()
  if (!ibanPuhdas.startsWith('FI') || ibanPuhdas.length !== 18 || !/^\d{16}$/.test(ibanPuhdas.slice(2))) return null
  const sentit = skaalaa(summa, 2)
  if (sentit <= 0n || sentit > 99999999n) return null
  const viite = String(viitenumero).replace(/\s/g, '')
  if (!/^\d{1,20}$/.test(viite)) return null
  const [vuosi, kuukausi, paiva] = erapaiva.split('-')
  return `4${ibanPuhdas.slice(2)}${sentit.toString().padStart(8, '0')}000${viite.padStart(20, '0')}${vuosi.slice(2)}${kuukausi}${paiva}`
}

/** EPC QR -koodin sisältö (SEPA-tilisiirto), viite RF-muodossa */
export function rakennaSepaQR(saajaNimi, iban, summa, viite, bic = '') {
  const ibanPuhdas = (iban || '').replace(/\s/g, '').toUpperCase()
  const sentit = skaalaa(summa, 2)
  if (!ibanPuhdas || sentit <= 0n) return null
  const euroa = `${sentit / 100n}.${String(sentit % 100n).padStart(2, '0')}`
  return [
    'BCD', '002', '1', 'SCT',
    (bic || '').replace(/\s/g, '').toUpperCase(),
    (saajaNimi || '').substring(0, 70),
    ibanPuhdas,
    `EUR${euroa}`,
    '',
    viite ? rfViite(viite) : '',
    '',
  ].join('\n')
}
