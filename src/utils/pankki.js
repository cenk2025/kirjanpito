// ═══════════════════════════════════════════════════════
// PANKKI — Tiliotteen jäsennys (ISO 20022 camt.053 ja CSV)
//
// Palauttaa tapahtumat muodossa:
//   { pvm: 'YYYY-MM-DD', summa: 12.34 (+ saapuva, - lähtevä),
//     vastapuoli, viite, viesti, arkistointitunnus }
// ═══════════════════════════════════════════════════════

function teksti(el, polku) {
  let nykyinen = el
  for (const osa of polku.split('/')) {
    if (!nykyinen) return ''
    nykyinen = Array.from(nykyinen.children || []).find(c => c.localName === osa)
  }
  return nykyinen?.textContent?.trim() || ''
}

function kaikki(el, nimi) {
  const ns = el.getElementsByTagNameNS('*', nimi)
  return Array.from(ns.length ? ns : el.getElementsByTagName(nimi))
}

/** camt.053 (kaikki suomalaiset pankit tarjoavat XML-tiliotteen) */
export function jasennaCamt053(xmlTeksti, parser = new DOMParser()) {
  const doc = parser.parseFromString(xmlTeksti, 'application/xml')
  if (doc.getElementsByTagName('parsererror').length) throw new Error('XML-tiedosto ei ole kelvollinen')
  const tapahtumat = []
  for (const ntry of kaikki(doc, 'Ntry')) {
    // Vain kirjatut tapahtumat (<Sts>BOOK</Sts> tai <Sts><Cd>BOOK</Cd></Sts>)
    const tila = teksti(ntry, 'Sts')
    if (tila && tila !== 'BOOK') continue
    const maara = parseFloat(teksti(ntry, 'Amt'))
    if (!Number.isFinite(maara)) continue
    const merkki = teksti(ntry, 'CdtDbtInd') === 'DBIT' ? -1 : 1
    const pvm = (teksti(ntry, 'BookgDt/Dt') || teksti(ntry, 'BookgDt/DtTm') || teksti(ntry, 'ValDt/Dt')).slice(0, 10)
    const arkisto = teksti(ntry, 'AcctSvcrRef') || teksti(ntry, 'NtryRef')
    const tx = kaikki(ntry, 'TxDtls')[0] || ntry
    const vastapuoli = merkki > 0
      ? (teksti(tx, 'RltdPties/Dbtr/Nm') || teksti(tx, 'RltdPties/Dbtr/Pty/Nm'))
      : (teksti(tx, 'RltdPties/Cdtr/Nm') || teksti(tx, 'RltdPties/Cdtr/Pty/Nm'))
    const viite = teksti(tx, 'RmtInf/Strd/CdtrRefInf/Ref')
    const viesti = kaikki(tx, 'Ustrd').map(e => e.textContent.trim()).join(' ')
      || teksti(ntry, 'AddtlNtryInf')
    tapahtumat.push({
      pvm,
      summa: Math.round(maara * 100) / 100 * merkki,
      vastapuoli,
      viite: viite.replace(/\s/g, ''),
      viesti,
      arkistointitunnus: arkisto,
    })
  }
  return tapahtumat
}

// ─── CSV ───────────────────────────────────────────────

function jaaRivi(rivi, erotin) {
  const solut = []
  let nykyinen = ''
  let lainaus = false
  for (let i = 0; i < rivi.length; i++) {
    const c = rivi[i]
    if (c === '"') {
      if (lainaus && rivi[i + 1] === '"') { nykyinen += '"'; i++ } else lainaus = !lainaus
    } else if (c === erotin && !lainaus) {
      solut.push(nykyinen); nykyinen = ''
    } else nykyinen += c
  }
  solut.push(nykyinen)
  return solut.map(s => s.trim())
}

function jasennaPvm(s) {
  s = (s || '').trim()
  let m = s.match(/^(\d{4})[-/](\d{2})[-/](\d{2})/)
  if (m) return `${m[1]}-${m[2]}-${m[3]}`
  m = s.match(/^(\d{1,2})\.(\d{1,2})\.(\d{4})/)
  if (m) return `${m[3]}-${m[2].padStart(2, '0')}-${m[1].padStart(2, '0')}`
  m = s.match(/^(\d{4})(\d{2})(\d{2})$/)
  if (m) return `${m[1]}-${m[2]}-${m[3]}`
  return null
}

function jasennaSumma(s) {
  s = (s || '').replace(/\s| |€|EUR/g, '')
  if (!s) return NaN
  if (s.includes(',') && s.includes('.')) s = s.replace(/\./g, '').replace(',', '.')
  else s = s.replace(',', '.')
  if (s.startsWith('+')) s = s.slice(1)
  return parseFloat(s)
}

const SARAKKEET = {
  pvm: ['kirjauspäivä', 'kirjauspaiva', 'päivämäärä', 'paivamaara', 'arvopäivä', 'maksupäivä', 'date', 'booking date', 'pvm'],
  summa: ['määrä', 'maara', 'summa', 'määrä eur', 'amount', 'määrä euroa', 'rahamäärä'],
  vastapuoli: ['saaja/maksaja', 'maksaja/saaja', 'saajan nimi', 'vastapuoli', 'nimi', 'saaja tai maksaja', 'payee', 'counterparty', 'saaja', 'maksaja'],
  viite: ['viite', 'viitenumero', 'reference', 'viite/viesti'],
  viesti: ['viesti', 'selite', 'otsikko', 'message', 'kuvaus', 'description', 'selitys', 'tapahtumalaji'],
  arkistointitunnus: ['arkistointitunnus', 'arkistotunnus', 'archive id', 'arkistointi-id'],
}

/** CSV-tiliote (OP, Nordea, S-Pankki, Holvi ym. — sarakkeet tunnistetaan otsikoista) */
export function jasennaCsv(csvTeksti) {
  const rivit = csvTeksti.replace(/^﻿/, '').split(/\r?\n/).filter(r => r.trim())
  if (rivit.length < 2) throw new Error('CSV-tiedostossa ei ole tapahtumia')
  const otsikkoIndeksi = rivit.findIndex(r => /määrä|maara|summa|amount/i.test(r))
  if (otsikkoIndeksi < 0) throw new Error('CSV-otsikkoriviä ei tunnistettu (tarvitaan päivämäärä- ja määräsarake)')
  const otsikko = rivit[otsikkoIndeksi]
  const erotin = [';', '\t', ','].sort((a, b) => otsikko.split(b).length - otsikko.split(a).length)[0]
  const otsikot = jaaRivi(otsikko, erotin).map(o => o.toLowerCase().replace(/"/g, ''))
  const sarake = {}
  for (const [kentta, nimet] of Object.entries(SARAKKEET)) {
    // Ensisijaisuusjärjestys: listan ensimmäinen täsmällinen osuma, sitten alkuosa
    const tarkka = nimet.map(n => otsikot.indexOf(n)).find(i => i >= 0)
    sarake[kentta] = tarkka ?? otsikot.findIndex(o => nimet.some(n => o.startsWith(n)))
  }
  if (sarake.pvm < 0 || sarake.summa < 0) throw new Error('Päivämäärä- tai määräsaraketta ei löytynyt')

  const tapahtumat = []
  for (const rivi of rivit.slice(otsikkoIndeksi + 1)) {
    const s = jaaRivi(rivi, erotin)
    const pvm = jasennaPvm(s[sarake.pvm])
    const summa = jasennaSumma(s[sarake.summa])
    if (!pvm || !Number.isFinite(summa) || summa === 0) continue
    const viiteRaaka = sarake.viite >= 0 ? s[sarake.viite] : ''
    tapahtumat.push({
      pvm,
      summa: Math.round(summa * 100) / 100,
      vastapuoli: sarake.vastapuoli >= 0 ? s[sarake.vastapuoli] : '',
      viite: /^(RF\d{2})?[\d\s]+$/i.test(viiteRaaka) ? viiteRaaka.replace(/\s/g, '') : '',
      viesti: [sarake.viesti >= 0 ? s[sarake.viesti] : '', /^(RF\d{2})?[\d\s]+$/i.test(viiteRaaka) ? '' : viiteRaaka]
        .filter(Boolean).join(' '),
      arkistointitunnus: sarake.arkistointitunnus >= 0 ? s[sarake.arkistointitunnus] : '',
    })
  }
  return tapahtumat
}

/** Kansallinen viite RF-viitteestä (RF + 2 tarkistetta + viite) */
export function normalisoiViite(viite) {
  const v = String(viite || '').replace(/\s/g, '').toUpperCase()
  if (v.startsWith('RF')) return v.slice(4).replace(/^0+/, '')
  return v.replace(/^0+/, '')
}

/** Etsii avoimen laskun, jonka viite ja avoin summa vastaavat saapunutta maksua */
export function etsiLasku(tapahtuma, laskut) {
  if (tapahtuma.summa <= 0) return null
  const viite = normalisoiViite(tapahtuma.viite)
  const avoimet = laskut.filter(l => l.tyyppi === 'lasku' && ['lahetetty', 'osittain'].includes(l.tila))
  if (viite) {
    const osuma = avoimet.find(l => normalisoiViite(l.viitenumero) === viite)
    if (osuma) return osuma
  }
  // Viitteetön maksu: laskunumero viestissä ja summa täsmää
  return avoimet.find(l => l.laskunumero && (tapahtuma.viesti || '').includes(l.laskunumero)
    && Math.abs(Number(l.summa_verollinen) - Number(l.maksettu_summa) - tapahtuma.summa) < 0.005) || null
}
