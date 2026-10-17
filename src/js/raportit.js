// ═══════════════════════════════════════════════════════
// RAPORTIT — Tuloslaskelma, tase, ALV-ilmoitus, yhteenvetoilmoitus,
// tilinpäätös (pien- ja mikroyrityksen kaavat, PMA 1753/2015)
// ═══════════════════════════════════════════════════════

import {
  haeTilikaudet, haeTilisaldot, haeAlvLaskelma, haeYhteenvetoilmoitus, kirjaaAlvTilitys, haeProfiili,
  haeLaskut, haePankkitapahtumat, haeKulut,
} from '../utils/supabase.js'
import { formatoiEuro, formatoiPaiva, isoTanaan } from '../utils/formatters.js'
import { haeALVKaudet } from '../utils/laskuri.js'
import { html } from '../utils/html.js'
import {
  renderNakyma, asetaTopbarToiminnot, naytaToast, naytaVahvistus, naytaVirhe, virheNakyma,
  naytaLatausRuutu, lataaTiedosto, csv,
} from './ui.js'
import { navigoi } from './router.js'
import { tulostaRaportti } from './laskuTulostus.js'

let _kayttajaId = null
let _kausiId = null
let _alvVuosi = new Date().getFullYear()

export async function renderRaportit(kayttajaId, polku) {
  _kayttajaId = kayttajaId
  const nakyma = polku.split('/')[1] || 'tuloslaskelma'
  asetaTopbarToiminnot(html`<button class="btn btn-secondary btn-sm" id="tulosta-raportti">Tulosta / PDF</button>`)
  naytaLatausRuutu()
  try {
    const kaudet = await haeTilikaudet()
    const tanaan = isoTanaan()
    if (!_kausiId || !kaudet.some(k => k.id === _kausiId)) {
      _kausiId = (kaudet.find(k => k.alku <= tanaan && k.loppu >= tanaan) || kaudet[0])?.id
    }
    const kausi = kaudet.find(k => k.id === _kausiId)
    const edellinen = kausi ? kaudet.find(k => k.loppu < kausi.alku && kaudet.every(x => !(x.loppu < kausi.alku && x.loppu > k.loppu))) : null
    const valikko = html`
      <div class="section-header">
        <div><h1 class="section-title">Raportit</h1>
          <p class="section-sub">Lasketaan suoraan pääkirjasta</p></div>
        ${nakyma !== 'alv' && nakyma !== 'yhteenveto' ? html`<select class="form-select" id="kausi-valinta" style="max-width:260px">
          ${kaudet.map(k => html`<option value="${k.id}" ${k.id === _kausiId ? 'selected' : ''}>${formatoiPaiva(k.alku)} – ${formatoiPaiva(k.loppu)}</option>`)}
        </select>` : ''}
      </div>
      <div class="period-selector" style="margin-bottom:var(--s4)">
        ${[['tuloslaskelma', 'Tuloslaskelma'], ['tase', 'Tase'], ['alv', 'ALV-ilmoitus'], ['yhteenveto', 'Yhteenvetoilmoitus'], ['tilinpaatos', 'Tilinpäätös']]
          .map(([k, n]) => html`<a class="period-btn ${nakyma === k ? 'active' : ''}" href="#raportit/${k}">${n}</a>`)}
      </div>`

    if (nakyma === 'alv') await renderAlv(valikko)
    else if (nakyma === 'yhteenveto') await renderYhteenveto(valikko)
    else if (!kausi) virheNakyma('Ei tilikausia', new Error('Luo tilikausi asetuksissa'))
    else if (nakyma === 'tase') await renderTase(valikko, kausi, edellinen)
    else if (nakyma === 'tilinpaatos') await renderTilinpaatos(valikko, kausi, edellinen)
    else await renderTuloslaskelma(valikko, kausi, edellinen)

    document.getElementById('kausi-valinta')?.addEventListener('change', (e) => {
      _kausiId = e.target.value
      renderRaportit(kayttajaId, polku)
    })
  } catch (err) {
    virheNakyma('Raportin lataus epäonnistui', err)
  }
}

// ─── Laskenta pääkirjasta ──────────────────────────────

const TULOS_RIVIT = [
  { avain: 'liikevaihto', nimi: 'LIIKEVAIHTO', ryhmat: ['liikevaihto'], paa: true },
  { avain: 'muut_tuotot', nimi: 'Liiketoiminnan muut tuotot', ryhmat: ['muut_tuotot'] },
  { avain: 'materiaalit', nimi: 'Materiaalit ja palvelut', ryhmat: ['materiaalit'] },
  { avain: 'henkilosto', nimi: 'Henkilöstökulut', ryhmat: ['palkat', 'henkilosivukulut'] },
  { avain: 'poistot', nimi: 'Poistot ja arvonalentumiset', ryhmat: ['poistot'] },
  { avain: 'muut_kulut', nimi: 'Liiketoiminnan muut kulut', ryhmat: ['muut_kulut'] },
  { avain: 'liikevoitto', nimi: 'LIIKEVOITTO (-TAPPIO)', summa: ['liikevaihto', 'muut_tuotot', 'materiaalit', 'henkilosto', 'poistot', 'muut_kulut'] },
  { avain: 'rahoitus', nimi: 'Rahoitustuotot ja -kulut', ryhmat: ['rahoitustuotot', 'rahoituskulut'] },
  { avain: 'ennen_veroja', nimi: 'VOITTO (TAPPIO) ENNEN TILINPÄÄTÖSSIIRTOJA JA VEROJA', summa: ['liikevoitto', 'rahoitus'] },
  { avain: 'tuloverot', nimi: 'Tuloverot', ryhmat: ['tuloverot'] },
  { avain: 'tulos', nimi: 'TILIKAUDEN VOITTO (TAPPIO)', summa: ['ennen_veroja', 'tuloverot'] },
]

const pyor = (n) => Math.round(n * 100) / 100

export function laskeTuloslaskelma(saldot) {
  const ryhmittain = {}
  for (const s of saldot) {
    if (!['tuotto', 'kulu'].includes(s.tyyppi)) continue
    ryhmittain[s.ryhma] = (ryhmittain[s.ryhma] || 0) - (Number(s.debet) - Number(s.kredit))
  }
  const t = {}
  for (const r of TULOS_RIVIT) {
    t[r.avain] = pyor(r.summa ? r.summa.reduce((s, k) => s + t[k], 0) : r.ryhmat.reduce((s, g) => s + (ryhmittain[g] || 0), 0))
  }
  return t
}

const TASE_VASTAAVAA = [
  { otsikko: 'PYSYVÄT VASTAAVAT' },
  { avain: 'aineettomat', nimi: 'Aineettomat hyödykkeet' },
  { avain: 'aineelliset', nimi: 'Aineelliset hyödykkeet' },
  { otsikko: 'VAIHTUVAT VASTAAVAT' },
  { avain: 'lyhyet_saamiset', nimi: 'Saamiset' },
  { avain: 'rahat', nimi: 'Rahat ja pankkisaamiset' },
]
const TASE_VASTATTAVAA = [
  { otsikko: 'OMA PÄÄOMA' },
  { avain: 'osakepaaoma', nimi: 'Osakepääoma' },
  { avain: 'svop', nimi: 'Sijoitetun vapaan oman pääoman rahasto' },
  { avain: 'edelliset', nimi: 'Edellisten tilikausien voitto (tappio)' },
  { avain: 'tilikauden', nimi: 'Tilikauden voitto (tappio)' },
  { otsikko: 'VIERAS PÄÄOMA' },
  { avain: 'pitkaaikainen', nimi: 'Pitkäaikainen vieras pääoma' },
  { avain: 'lyhytaikainen', nimi: 'Lyhytaikainen vieras pääoma' },
]

export function laskeTase(saldot) {
  const r = {}
  let tulosEnnen = 0
  let tulosKausi = 0
  for (const s of saldot) {
    const loppu = Number(s.loppusaldo)
    if (s.tyyppi === 'vastaavaa') r[s.ryhma] = (r[s.ryhma] || 0) + loppu
    else if (s.tyyppi === 'oma_paaoma' || s.tyyppi === 'vieras_paaoma') r[s.ryhma] = (r[s.ryhma] || 0) - loppu
    else {
      tulosEnnen -= Number(s.alkusaldo)
      tulosKausi -= Number(s.debet) - Number(s.kredit)
    }
  }
  r.edelliset = (r.edelliset || 0) + tulosEnnen
  r.tilikauden = tulosKausi
  for (const k of Object.keys(r)) r[k] = pyor(r[k])
  r.oma_paaoma = pyor(['osakepaaoma', 'svop', 'edelliset', 'tilikauden'].reduce((s, k) => s + (r[k] || 0), 0))
  r.vastaavaa = pyor(TASE_VASTAAVAA.filter(x => x.avain).reduce((s, x) => s + (r[x.avain] || 0), 0))
  r.vastattavaa = pyor(TASE_VASTATTAVAA.filter(x => x.avain).reduce((s, x) => s + (r[x.avain] || 0), 0))
  return r
}

async function laskelmat(kausi, edellinen) {
  const [nyt, ed] = await Promise.all([
    haeTilisaldot(kausi.alku, kausi.loppu),
    edellinen ? haeTilisaldot(edellinen.alku, edellinen.loppu) : Promise.resolve(null),
  ])
  return { nyt, ed }
}

function vertailuOtsikko(kausi, edellinen) {
  return html`<tr><th></th><th class="oikea" style="text-align:right">${formatoiPaiva(kausi.alku)}–${formatoiPaiva(kausi.loppu)}</th>
    ${edellinen ? html`<th class="oikea" style="text-align:right">${formatoiPaiva(edellinen.alku)}–${formatoiPaiva(edellinen.loppu)}</th>` : ''}</tr>`
}

function tuloslaskelmaTaulu(kausi, edellinen, t, te) {
  return html`<table class="table">
    <thead>${vertailuOtsikko(kausi, edellinen)}</thead>
    <tbody>${TULOS_RIVIT.map(r => html`<tr class="${r.summa || r.paa ? 'summa' : 'sisennys'}" style="${r.summa || r.paa ? 'font-weight:700' : ''}">
      <td>${r.nimi}</td><td class="oikea" style="text-align:right">${formatoiEuro(t[r.avain])}</td>
      ${te ? html`<td class="oikea" style="text-align:right">${formatoiEuro(te[r.avain])}</td>` : ''}</tr>`)}
    </tbody></table>`
}

function taseTaulu(kausi, edellinen, r, re) {
  const rivi = (x) => x.otsikko
    ? html`<tr class="otsikko"><td colspan="3" style="font-weight:700;padding-top:var(--s3)">${x.otsikko}</td></tr>`
    : html`<tr class="sisennys"><td>${x.nimi}</td><td class="oikea" style="text-align:right">${formatoiEuro(r[x.avain] || 0)}</td>
        ${re ? html`<td class="oikea" style="text-align:right">${formatoiEuro(re[x.avain] || 0)}</td>` : ''}</tr>`
  const summa = (nimi, k) => html`<tr class="summa" style="font-weight:700"><td>${nimi}</td>
    <td class="oikea" style="text-align:right">${formatoiEuro(r[k])}</td>${re ? html`<td class="oikea" style="text-align:right">${formatoiEuro(re[k])}</td>` : ''}</tr>`
  return html`
    <h2>Vastaavaa</h2>
    <table class="table"><thead>${vertailuOtsikko(kausi, edellinen)}</thead><tbody>
      ${TASE_VASTAAVAA.map(rivi)}${summa('VASTAAVAA YHTEENSÄ', 'vastaavaa')}</tbody></table>
    <h2>Vastattavaa</h2>
    <table class="table"><thead>${vertailuOtsikko(kausi, edellinen)}</thead><tbody>
      ${TASE_VASTATTAVAA.map(rivi)}${summa('VASTATTAVAA YHTEENSÄ', 'vastattavaa')}</tbody></table>`
}

async function renderTuloslaskelma(valikko, kausi, edellinen) {
  const { nyt, ed } = await laskelmat(kausi, edellinen)
  const t = laskeTuloslaskelma(nyt)
  const te = ed ? laskeTuloslaskelma(ed) : null
  const taulu = tuloslaskelmaTaulu(kausi, edellinen, t, te)
  const kulutilit = nyt.filter(s => ['tuotto', 'kulu'].includes(s.tyyppi) && (Number(s.debet) || Number(s.kredit)))
  renderNakyma(html`${valikko}
    <div class="card">${taulu}</div>
    <div class="card" style="margin-top:var(--s4)"><div class="card-title" style="margin-bottom:var(--s3)">Erittely tileittäin</div>
      <table class="table"><tbody>${kulutilit.map(s => html`<tr style="cursor:pointer" data-tili="${s.numero}">
        <td>${s.numero} ${s.nimi}</td><td style="text-align:right">${formatoiEuro(-(Number(s.debet) - Number(s.kredit)))}</td></tr>`)}</tbody></table>
      <button class="btn btn-ghost btn-sm" id="vie-csv" style="margin-top:var(--s3)">Vie CSV</button></div>`)
  document.querySelectorAll('[data-tili]').forEach(r => r.addEventListener('click', () => navigoi(`kirjanpito/paakirja/${r.dataset.tili}`)))
  document.getElementById('vie-csv')?.addEventListener('click', () => lataaTiedosto(`tuloslaskelma_${kausi.alku}.csv`,
    csv([['Rivi', 'Kausi', 'Edellinen'], ...TULOS_RIVIT.map(r => [r.nimi, t[r.avain], te ? te[r.avain] : ''])]), 'text/csv;charset=utf-8'))
  document.getElementById('tulosta-raportti')?.addEventListener('click', async () => {
    const p = await haeProfiili(_kayttajaId)
    tulostaRaportti('Tuloslaskelma', html`<h1>${p?.yritys_nimi} – Tuloslaskelma</h1><p>Y-tunnus ${p?.y_tunnus}</p>${taulu}`)
  })
}

async function renderTase(valikko, kausi, edellinen) {
  const { nyt, ed } = await laskelmat(kausi, edellinen)
  const r = laskeTase(nyt)
  const re = ed ? laskeTase(ed) : null
  const taulu = taseTaulu(kausi, edellinen, r, re)
  const tasmaa = Math.abs(r.vastaavaa - r.vastattavaa) < 0.005
  renderNakyma(html`${valikko}
    ${tasmaa ? '' : html`<div class="alert alert-error">Tase ei täsmää (erotus ${formatoiEuro(r.vastaavaa - r.vastattavaa)}).</div>`}
    ${r.oma_paaoma < 0 ? html`<div class="alert alert-warning">Oma pääoma on negatiivinen. Hallituksen on viipymättä tehtävä
      siitä rekisteri-ilmoitus kaupparekisteriin (OYL 20:23).</div>` : ''}
    <div class="card">${taulu}</div>`)
  document.getElementById('tulosta-raportti')?.addEventListener('click', async () => {
    const p = await haeProfiili(_kayttajaId)
    tulostaRaportti('Tase', html`<h1>${p?.yritys_nimi} – Tase ${formatoiPaiva(kausi.loppu)}</h1><p>Y-tunnus ${p?.y_tunnus}</p>${taulu}`)
  })
}

// ─── Tilinpäätös ───────────────────────────────────────

async function renderTilinpaatos(valikko, kausi, edellinen) {
  const [{ nyt, ed }, p, laskut, pankki] = await Promise.all([
    laskelmat(kausi, edellinen), haeProfiili(_kayttajaId), haeLaskut(), haePankkitapahtumat('avoin'),
  ])
  const t = laskeTuloslaskelma(nyt)
  const te = ed ? laskeTuloslaskelma(ed) : null
  const r = laskeTase(nyt)
  const re = ed ? laskeTase(ed) : null
  const luonnokset = laskut.filter(l => l.tila === 'luonnos' && l.laskupaiva >= kausi.alku && l.laskupaiva <= kausi.loppu).length
  const avoimetPankki = pankki.filter(x => x.pvm >= kausi.alku && x.pvm <= kausi.loppu).length
  const kulut = await haeKulut(kausi.alku, kausi.loppu)
  const ilmanTositetta = kulut.filter(k => k.tila !== 'peruttu' && !k.liitteet?.length).length
  const tarkistukset = [
    [luonnokset === 0, `Lähettämättömiä laskuluonnoksia: ${luonnokset}`],
    [avoimetPankki === 0, `Kirjaamattomia pankkitapahtumia: ${avoimetPankki}`],
    [ilmanTositetta === 0, `Kuluja ilman tositetta: ${ilmanTositetta}`],
    [Math.abs(r.vastaavaa - r.vastattavaa) < 0.005, 'Tase täsmää'],
    [!(Number(nyt.find(s => s.numero === '2939')?.loppusaldo) || Number(nyt.find(s => s.numero === '1763')?.loppusaldo)), 'ALV-kaudet tilitetty (2939 ja 1763 nollassa)'],
  ]

  const runko = html`
    <h1>${p?.yritys_nimi}</h1>
    <p>Y-tunnus ${p?.y_tunnus} · Kotipaikka ${p?.kotipaikka || '—'}</p>
    <h1 style="margin-top:8mm">TILINPÄÄTÖS ${formatoiPaiva(kausi.alku)} – ${formatoiPaiva(kausi.loppu)}</h1>
    <h2>Tuloslaskelma</h2>${tuloslaskelmaTaulu(kausi, edellinen, t, te)}
    <h2>Tase ${formatoiPaiva(kausi.loppu)}</h2>${taseTaulu(kausi, edellinen, r, re)}
    <h2>Liitetiedot</h2>
    <p><strong>Laatimisperiaatteet.</strong> Tilinpäätös on laadittu pien- ja mikroyrityksen tilinpäätöksessä esitettävistä
      tiedoista annetun valtioneuvoston asetuksen (1753/2015) mikroyrityssäännöstöä noudattaen.</p>
    <p><strong>Henkilöstö.</strong> Yhtiön palveluksessa oli tilikauden aikana keskimäärin ____ henkilöä.</p>
    <p><strong>Vakuudet ja vastuusitoumukset.</strong> ____ (esim. Finnvera-lainan takaukset, yrityskiinnitykset).</p>
    <p><strong>Lähipiirilainat.</strong> Yhtiö ei ole antanut rahalainoja lähipiiriin kuuluville. ____</p>
    <h2>Luettelo kirjanpitokirjoista ja tositelajeista</h2>
    <p>Päiväkirja ja pääkirja sähköisesti (Kirjanpito-sovellus). Tositelajit: myyntilaskut, hyvityslaskut, maksut, kulut,
      pankkitapahtumat, muistiotositteet, oikaisut, ALV-tilitykset. Tositteet säilytetään sähköisesti.</p>
    <h2>Tilinpäätöksen allekirjoitus</h2>
    <p>Paikka ja aika: ____________________</p>
    <div class="allekirjoitus"><div>Hallituksen jäsen / toimitusjohtaja</div><div>Hallituksen jäsen</div></div>
    <h2>Tilinpäätösmerkintä</h2>
    <p>Tilikaudelta on laadittu tilinpäätös. Tilintarkastusta ei ole toimitettu (tilintarkastuslaki 2:2, pieni yhtiö)
      / Tilintarkastuskertomus on annettu ____.</p>`

  renderNakyma(html`${valikko}
    <div class="card" style="margin-bottom:var(--s4)">
      <div class="card-title" style="margin-bottom:var(--s3)">Ennen tilinpäätöstä</div>
      <ul style="list-style:none;line-height:2">${tarkistukset.map(([ok, txt]) => html`<li>${ok ? '✅' : '⚠️'} ${txt}</li>`)}</ul>
      <p style="color:var(--text-2);font-size:0.85rem;margin-top:var(--s3);line-height:1.6">
        Kirjaa ennen tilinpäätöstä muistiotositteilla: poistot (tili 6800), jaksotukset (1840 / 2950) ja tuloverot (9900 / 2920).
        Tilinpäätös on laadittava 4 kuukauden kuluessa tilikauden päättymisestä (KPL 3:6) ja yhtiökokous pidettävä 6 kuukauden kuluessa.
        Tase ja tuloslaskelma ilmoitetaan PRH:lle 8 kuukauden kuluessa (vero-ilmoituksen 6B yhteydessä OmaVerossa).
        Veroilmoitus 6B on jätettävä 4 kuukauden kuluessa tilikauden päättymisestä.
        Kun tilinpäätös on vahvistettu, lukitse tilikausi asetuksissa.</p>
    </div>
    <div class="card">${runko}</div>`)
  document.getElementById('tulosta-raportti')?.addEventListener('click', () => tulostaRaportti(`Tilinpäätös ${kausi.loppu}`, runko))
}

// ─── ALV-ilmoitus ──────────────────────────────────────

const ALV_KENTAT = [
  ['otsikko', 'Vero kotimaan myynnistä verokannoittain'],
  ['vero_255', '25,5 %:n vero'],
  ['vero_135', '13,5 %:n vero'],
  ['vero_10', '10 %:n vero'],
  ['vero_eu_tavaraostot', 'Vero tavaraostoista muista EU-maista'],
  ['vero_eu_palveluostot', 'Vero palveluostoista muista EU-maista'],
  ['nolla', 'Vero tavaroiden maahantuonneista EU:n ulkopuolelta'],
  ['nolla', 'Vero rakentamispalvelujen ja metalliromun ostoista'],
  ['vahennettava_vero', 'Verokauden vähennettävä vero'],
  ['maksettava', 'Maksettava vero (+) / palautukseen oikeuttava vero (−)', true],
  ['otsikko', 'Myynnit ja ostot'],
  ['nollaverokanta', '0-verokannan alainen liikevaihto'],
  ['eu_tavaramyynti', 'Tavaroiden myynnit muihin EU-maihin'],
  ['eu_palvelumyynti', 'Palveluiden myynnit muihin EU-maihin'],
  ['eu_tavaraostot', 'Tavaraostot muista EU-maista'],
  ['eu_palveluostot', 'Palveluostot muista EU-maista'],
  ['nolla', 'Tavaroiden maahantuonnit EU:n ulkopuolelta'],
  ['nolla', 'Rakentamispalvelujen ja metalliromun myynnit'],
  ['nolla', 'Rakentamispalvelujen ja metalliromun ostot'],
]

async function renderAlv(valikko) {
  const p = await haeProfiili(_kayttajaId) || {}
  const kaudet = haeALVKaudet(_alvVuosi, p.alv_kausi || 'quarterly')
  const tulokset = await Promise.all(kaudet.map(k => haeAlvLaskelma(k.alku, k.loppu)))
  const tanaan = isoTanaan()
  const vuodet = [0, 1, 2].map(i => new Date().getFullYear() - i)

  renderNakyma(html`${valikko}
    <div style="display:flex;justify-content:space-between;align-items:center;flex-wrap:wrap;gap:var(--s3);margin-bottom:var(--s4)">
      <div class="period-selector">${vuodet.map(v => html`<button class="period-btn ${v === _alvVuosi ? 'active' : ''}" data-vuosi="${v}">${v}</button>`)}</div>
      <span style="color:var(--text-2);font-size:0.85rem">Verokausi: ${{ monthly: 'kuukausi', quarterly: 'neljännesvuosi', annually: 'kalenterivuosi' }[p.alv_kausi || 'quarterly']} (muuta asetuksissa)</span>
    </div>
    ${p.alv_rekisteroity === false ? html`<div class="alert alert-info">Yritys ei ole ALV-rekisterissä. Kausiveroilmoituksia ei anneta.</div>` : ''}
    <div class="alert alert-info" style="margin-bottom:var(--s4)">Siirrä luvut OmaVeroon (Arvonlisävero → Kausiveroilmoitus).
      Ilmoitus ja maksu eräpäivään mennessä. Jos kaudella ei ole myyntiä eikä ostoja, anna silti ns. nollailmoitus.
      Kauden päätyttyä kirjaa ALV-tilitys, jolloin vero siirtyy tilille 2935 ja maksu kirjataan pankista.</div>
    ${kaudet.map((k, i) => {
      const v = tulokset[i]
      const paattynyt = k.loppu < tanaan
      return html`<div class="card" style="margin-bottom:var(--s4)">
        <div style="display:flex;justify-content:space-between;flex-wrap:wrap;gap:var(--s2);margin-bottom:var(--s3)">
          <div class="card-title">${k.nimi}</div>
          <div style="font-size:0.85rem;color:var(--text-2)">Eräpäivä ${formatoiPaiva(k.erapaiva)}
            ${v.tilitetty ? html` · <span class="badge badge-maksettu">Tilitetty</span>` : paattynyt
              ? html` · <button class="btn btn-primary btn-sm" data-tilitys="${i}">Kirjaa ALV-tilitys</button>` : ' · kausi kesken'}</div>
        </div>
        <table class="table"><tbody>${ALV_KENTAT.map(([avain, nimi, korosta]) => avain === 'otsikko'
          ? html`<tr><td colspan="2" style="font-weight:700;padding-top:var(--s3)">${nimi}</td></tr>`
          : html`<tr style="${korosta ? 'font-weight:700' : ''}"><td>${nimi}</td>
              <td style="text-align:right">${formatoiEuro(avain === 'nolla' ? 0 : v[avain])}</td></tr>`)}</tbody></table>
      </div>`
    })}`)

  document.querySelectorAll('[data-vuosi]').forEach(b => b.addEventListener('click', () => {
    _alvVuosi = Number(b.dataset.vuosi)
    renderRaportit(_kayttajaId, 'raportit/alv')
  }))
  document.querySelectorAll('[data-tilitys]').forEach(b => b.addEventListener('click', async () => {
    const k = kaudet[Number(b.dataset.tilitys)]
    const v = tulokset[Number(b.dataset.tilitys)]
    const ok = await naytaVahvistus(`Kirjataanko kauden ${k.nimi} ALV-tilitys? Maksettava vero ${formatoiEuro(v.maksettava)}.\n` +
      'Tarkista ensin, että kauden kaikki laskut, kulut ja pankkitapahtumat on kirjattu.', 'ALV-tilitys', { okTeksti: 'Kirjaa', vaarallinen: false })
    if (!ok) return
    try {
      await kirjaaAlvTilitys(k.alku, k.loppu)
      naytaToast('ALV-tilitys kirjattu', 'success')
      renderRaportit(_kayttajaId, 'raportit/alv')
    } catch (err) { naytaVirhe('Tilitys epäonnistui', err) }
  }))
  document.getElementById('tulosta-raportti')?.addEventListener('click', () => {
    tulostaRaportti(`ALV ${_alvVuosi}`, html`<h1>${p.yritys_nimi} – ALV-laskelmat ${_alvVuosi}</h1>
      ${kaudet.map((k, i) => html`<h2>${k.nimi}</h2><table>${ALV_KENTAT.filter(x => x[0] !== 'otsikko').map(([a, n]) =>
        html`<tr><td>${n}</td><td class="oikea">${formatoiEuro(a === 'nolla' ? 0 : tulokset[i][a])}</td></tr>`)}</table>`)}`)
  })
}

// ─── Yhteenvetoilmoitus ────────────────────────────────

async function renderYhteenveto(valikko) {
  const vuosi = _alvVuosi
  const kuukaudet = Array.from({ length: 12 }, (_, i) => {
    const kk = String(i + 1).padStart(2, '0')
    const loppu = new Date(Date.UTC(vuosi, i + 1, 0)).toISOString().slice(0, 10)
    return { nimi: `${kk}/${vuosi}`, alku: `${vuosi}-${kk}-01`, loppu }
  })
  const tulokset = await Promise.all(kuukaudet.map(k => haeYhteenvetoilmoitus(k.alku, k.loppu)))
  const kaytossa = kuukaudet.map((k, i) => ({ ...k, rivit: tulokset[i] })).filter(k => k.rivit.length)

  renderNakyma(html`${valikko}
    <div class="alert alert-info" style="margin-bottom:var(--s4)">Yhteenvetoilmoitus annetaan OmaVerossa kuukausittain niistä kuukausista,
      joina on myyty tavaroita tai palveluita toisen EU-maan ALV-rekisteröidylle ostajalle. Määräaika on myyntikuukautta seuraavan kuukauden 20. päivä.</div>
    ${kaytossa.length === 0 ? html`<div class="empty-state"><p>Ei EU-myyntiä vuonna ${vuosi}.</p></div>`
      : kaytossa.map(k => html`<div class="card" style="margin-bottom:var(--s4)">
        <div class="card-title" style="margin-bottom:var(--s3)">${k.nimi}</div>
        <table class="table"><thead><tr><th>Ostajan ALV-tunniste</th><th>Nimi</th><th style="text-align:right">Tavaramyynti</th>
          <th style="text-align:right">Palvelumyynti</th></tr></thead>
        <tbody>${k.rivit.map(r => html`<tr><td>${r.alv_tunnus}</td><td>${r.nimi}</td>
          <td style="text-align:right">${formatoiEuro(r.tavarat || 0)}</td><td style="text-align:right">${formatoiEuro(r.palvelut || 0)}</td></tr>`)}</tbody></table>
      </div>`)}`)
  document.getElementById('tulosta-raportti')?.addEventListener('click', () => {
    tulostaRaportti(`Yhteenvetoilmoitus ${vuosi}`, html`<h1>Yhteenvetoilmoitukset ${vuosi}</h1>${kaytossa.map(k => html`<h2>${k.nimi}</h2>
      <table><tr><th>ALV-tunniste</th><th>Nimi</th><th class="oikea">Tavarat</th><th class="oikea">Palvelut</th></tr>
      ${k.rivit.map(r => html`<tr><td>${r.alv_tunnus}</td><td>${r.nimi}</td><td class="oikea">${formatoiEuro(r.tavarat || 0)}</td>
        <td class="oikea">${formatoiEuro(r.palvelut || 0)}</td></tr>`)}</table>`)}`)
  })
}
