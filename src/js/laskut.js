// ═══════════════════════════════════════════════════════
// LASKUT — Myyntilaskut ja hyvityslaskut
//
// Elinkaari: luonnos → lähetetty (numero, viite ja kirjaus annetaan,
// lasku lukittuu) → osittain maksettu / maksettu, tai hyvitetty.
// Lähetettyä laskua ei muuteta eikä poisteta: korjaus hyvityslaskulla.
// ═══════════════════════════════════════════════════════

import {
  haeLaskut, haeLasku, tallennaLaskuluonnos, poistaLaskuluonnos, lahetaLasku,
  kirjaaMaksu, luoHyvityslasku, haeAsiakkaat, haeProfiili, supabase,
} from '../utils/supabase.js'
import {
  formatoiEuro, formatoiPaiva, formatoiAika, tilaHTML, LASKU_TILAT, efektiivinenTila,
  paiviaErapaivaan, MAKSUEHTO_VAIHTOEHDOT, MYYNNIN_ALV_KASITTELYT, isoTanaan, EU_MAAT,
} from '../utils/formatters.js'
import {
  laskeLaskuSummat, laskunSummat, laskeRivi, muotoileViitenumero, laskeErapaiva,
  alvKannatPaivalle, paivienErotus,
} from '../utils/laskuri.js'
import { html } from '../utils/html.js'
import { rakennaFinvoice } from '../utils/finvoice.js'
import {
  renderNakyma, asetaTopbarToiminnot, avaaModaali, suljeModaali, naytaToast, naytaVahvistus,
  naytaVirhe, virheNakyma, naytaLatausRuutu, tyhjaLista, PLUS_IKONI, lataaTiedosto,
} from './ui.js'
import { navigoi } from './router.js'
import { tulostalasku, tulostaMaksumuistutus } from './laskuTulostus.js'

let _kayttajaId = null
let _profiili = null

export async function renderLaskut(kayttajaId, polku) {
  _kayttajaId = kayttajaId
  _profiili = await haeProfiili(kayttajaId).catch(() => null) || {}

  if (polku === 'laskut/uusi') return renderLomake()
  if (polku.startsWith('laskut/muokkaa/')) return renderLomake(polku.slice('laskut/muokkaa/'.length))
  const id = polku.replace(/^laskut\/?/, '')
  if (id) return renderLaskuNakyma(id)
  return renderLista()
}

// ─── Lista ─────────────────────────────────────────────

async function renderLista() {
  asetaTopbarToiminnot(html`<button class="btn btn-primary btn-sm" id="uusi-lasku-btn">${PLUS_IKONI} Uusi lasku</button>`)
  document.getElementById('uusi-lasku-btn')?.addEventListener('click', () => navigoi('laskut/uusi'))
  naytaLatausRuutu()

  let laskut
  try {
    laskut = await haeLaskut()
  } catch (err) {
    return virheNakyma('Laskujen lataus epäonnistui', err)
  }

  if (laskut.length === 0) {
    renderNakyma(html`
      <div class="section-header"><div><h1 class="section-title">Laskut</h1></div></div>
      ${tyhjaLista('Ei laskuja', 'Luo ensimmäinen laskusi painamalla "Uusi lasku".', 'Uusi lasku', 'empty-uusi-lasku')}`)
    document.getElementById('empty-uusi-lasku')?.addEventListener('click', () => navigoi('laskut/uusi'))
    return
  }

  const avoinYht = laskut.filter(l => ['lahetetty', 'osittain'].includes(l.tila))
    .reduce((s, l) => s + Number(l.summa_verollinen) - Number(l.maksettu_summa), 0)

  const rivit = laskut.map(l => {
    const tila = efektiivinenTila(l)
    const summa = laskunSummat(l).verollinenYhteensa
    const pv = ['lahetetty', 'osittain'].includes(l.tila) ? paiviaErapaivaan(l.erapaiva) : null
    return html`
      <tr style="cursor:pointer" data-id="${l.id}" data-tila="${tila}"
          data-haku="${`${l.laskunumero || 'luonnos'} ${l.asiakas?.nimi || l.ostaja?.nimi || ''}`.toLowerCase()}">
        <td><strong style="color:var(--lime)">${l.laskunumero || 'Luonnos'}</strong>
          ${l.tyyppi === 'hyvitys' ? html`<div style="font-size:0.75rem;color:var(--text-3)">Hyvityslasku</div>` : ''}</td>
        <td>${l.ostaja?.nimi || l.asiakas?.nimi || '—'}</td>
        <td>${formatoiPaiva(l.laskupaiva)}</td>
        <td>${l.tyyppi === 'hyvitys' ? '—' : formatoiPaiva(l.erapaiva)}
          ${pv !== null ? html`<br><span style="font-size:0.78rem;color:${pv < 0 ? 'var(--red)' : 'var(--text-3)'}">
            ${pv < 0 ? `${Math.abs(pv)} pv myöhässä` : `${pv} pv`}</span>` : ''}</td>
        <td style="text-align:right"><strong>${formatoiEuro(summa)}</strong></td>
        <td>${tilaHTML(tila)}</td>
      </tr>`
  })

  const tilaVaihtoehdot = Object.entries(LASKU_TILAT).map(([k, v]) => html`<option value="${k}">${v.nimi}</option>`)

  renderNakyma(html`
    <div class="section-header">
      <div>
        <h1 class="section-title">Laskut</h1>
        <p class="section-sub">${laskut.length} laskua · avoimia saatavia ${formatoiEuro(avoinYht)}</p>
      </div>
    </div>
    <div class="filter-bar">
      <input class="form-input" type="search" id="lasku-haku" placeholder="Hae numerolla tai asiakkaalla…" />
      <select class="form-select" id="lasku-tila-filter">
        <option value="">Kaikki tilat</option>${tilaVaihtoehdot}<option value="hyvitys">Hyvityslaskut</option>
      </select>
    </div>
    <div class="table-wrapper">
      <table class="table">
        <thead><tr><th>Numero</th><th>Asiakas</th><th>Laskupäivä</th><th>Eräpäivä</th>
          <th style="text-align:right">Summa (sis. ALV)</th><th>Tila</th></tr></thead>
        <tbody id="lasku-tbody">${rivit}</tbody>
      </table>
    </div>`)

  document.getElementById('lasku-tbody')?.addEventListener('click', (e) => {
    const rivi = e.target.closest('tr[data-id]')
    if (rivi) navigoi(`laskut/${rivi.dataset.id}`)
  })
  let ajastin
  const suodata = () => {
    clearTimeout(ajastin)
    ajastin = setTimeout(() => {
      const haku = (document.getElementById('lasku-haku')?.value || '').toLowerCase()
      const tila = document.getElementById('lasku-tila-filter')?.value
      document.querySelectorAll('#lasku-tbody tr[data-id]').forEach(r => {
        r.style.display = (!haku || r.dataset.haku.includes(haku)) && (!tila || r.dataset.tila === tila) ? '' : 'none'
      })
    }, 120)
  }
  document.getElementById('lasku-haku')?.addEventListener('input', suodata)
  document.getElementById('lasku-tila-filter')?.addEventListener('change', suodata)
}

// ─── Yksittäinen lasku ─────────────────────────────────

async function haeLaskunTapahtumat(laskuId) {
  const { data } = await supabase.from('tositteet').select('id, numero, pvm, selite, lahde, oikaistu')
    .eq('lahde_id', laskuId).order('pvm').order('numero')
  return data || []
}

async function renderLaskuNakyma(id) {
  naytaLatausRuutu()
  asetaTopbarToiminnot('')
  let lasku, tositteet, alkuperainen = null, hyvitys = null
  try {
    lasku = await haeLasku(id)
    if (!lasku) return navigoi('laskut')
    tositteet = await haeLaskunTapahtumat(id)
    if (lasku.hyvitettava_id) alkuperainen = await haeLasku(lasku.hyvitettava_id)
    if (lasku.tila === 'hyvitetty') {
      const { data } = await supabase.from('laskut').select('id, laskunumero').eq('hyvitettava_id', id).maybeSingle()
      hyvitys = data
    }
  } catch (err) {
    return virheNakyma('Laskun lataus epäonnistui', err)
  }

  const luonnos = lasku.tila === 'luonnos'
  const summat = laskunSummat(lasku)
  const avoin = Math.round((summat.verollinenYhteensa - Number(lasku.maksettu_summa)) * 100) / 100
  const ostaja = lasku.ostaja || lasku.asiakas || {}
  const tila = efektiivinenTila(lasku)
  const voiMaksaa = lasku.tyyppi === 'lasku' && ['lahetetty', 'osittain'].includes(lasku.tila)
  const voiHyvittaa = lasku.tyyppi === 'lasku' && ['lahetetty', 'osittain', 'maksettu'].includes(lasku.tila)

  asetaTopbarToiminnot(html`
    ${luonnos ? html`
      <button class="btn btn-ghost btn-sm" id="btn-poista">Poista luonnos</button>
      <button class="btn btn-secondary btn-sm" id="btn-muokkaa">Muokkaa</button>
      <button class="btn btn-ghost btn-sm" id="btn-tulosta">Esikatselu</button>
      <button class="btn btn-primary btn-sm" id="btn-laheta">Lähetä lasku</button>` : html`
      <button class="btn btn-secondary btn-sm" id="btn-tulosta">Tulosta / PDF</button>
      <button class="btn btn-ghost btn-sm" id="btn-finvoice">Verkkolasku (Finvoice)</button>
      ${voiHyvittaa ? html`<button class="btn btn-ghost btn-sm" id="btn-hyvita">Hyvitä</button>` : ''}
      ${tila === 'myohassa' ? html`<button class="btn btn-ghost btn-sm" id="btn-muistutus">Maksumuistutus</button>` : ''}
      ${voiMaksaa ? html`<button class="btn btn-primary btn-sm" id="btn-maksu">Kirjaa maksu</button>` : ''}`}
  `)

  const riviHTML = (lasku.rivit || []).map(r => {
    const s = laskeRivi(r.maara, r.yksikkohinta, r.alv_kanta)
    return html`<tr>
      <td>${r.kuvaus}</td>
      <td style="text-align:right">${r.maara} ${r.yksikko || 'kpl'}</td>
      <td style="text-align:right">${formatoiEuro(r.yksikkohinta)}</td>
      <td style="text-align:right">${r.alv_kanta} %</td>
      <td style="text-align:right">${formatoiEuro(s.verotonYhteensa)}</td>
    </tr>`
  })

  renderNakyma(html`
    <div style="margin-bottom:var(--s4)"><a href="#laskut" style="color:var(--text-2);font-size:0.875rem">← Takaisin laskuihin</a></div>
    ${luonnos ? html`<div class="alert alert-info" style="margin-bottom:var(--s4)">
      Tämä on luonnos. Laskunumero, viitenumero ja kirjanpitokirjaus annetaan, kun lasku lähetetään.
      Lähetyksen jälkeen laskua ei voi muuttaa – virheet korjataan hyvityslaskulla.</div>` : ''}
    <div class="card">
      <div style="display:flex;justify-content:space-between;flex-wrap:wrap;gap:var(--s4);margin-bottom:var(--s6)">
        <div>
          <div style="font-size:0.75rem;color:var(--text-3);text-transform:uppercase;letter-spacing:0.05em;margin-bottom:4px">
            ${lasku.tyyppi === 'hyvitys' ? 'HYVITYSLASKU' : 'LASKU'}</div>
          <h1 style="font-family:var(--font-display);font-size:2rem;font-weight:800;color:var(--lime)">${lasku.laskunumero || 'Luonnos'}</h1>
          ${tilaHTML(tila)}
          ${alkuperainen ? html`<div style="margin-top:var(--s2);font-size:0.85rem">Hyvittää laskun
            <a href="#laskut/${alkuperainen.id}">${alkuperainen.laskunumero}</a></div>` : ''}
          ${hyvitys ? html`<div style="margin-top:var(--s2);font-size:0.85rem">Hyvitetty laskulla
            <a href="#laskut/${hyvitys.id}">${hyvitys.laskunumero}</a></div>` : ''}
        </div>
        <div style="text-align:right;color:var(--text-3);font-size:0.85rem;line-height:1.7">
          <div>Laskupäivä: ${formatoiPaiva(lasku.laskupaiva)}</div>
          <div>Toimituspäivä: ${formatoiPaiva(lasku.toimituspaiva || lasku.laskupaiva)}</div>
          ${lasku.tyyppi === 'lasku' ? html`<div>Eräpäivä: <strong style="color:var(--text)">${formatoiPaiva(lasku.erapaiva)}</strong></div>` : ''}
          ${lasku.viitenumero ? html`<div>Viite: ${muotoileViitenumero(lasku.viitenumero)}</div>` : ''}
          ${lasku.lahetetty_aika ? html`<div>Lähetetty: ${formatoiAika(lasku.lahetetty_aika)}</div>` : ''}
        </div>
      </div>

      <div style="display:grid;grid-template-columns:1fr 1fr;gap:var(--s6);margin-bottom:var(--s6)">
        <div>
          <div style="font-size:0.75rem;color:var(--text-3);text-transform:uppercase;margin-bottom:var(--s2)">Ostaja</div>
          <div style="font-weight:700">${ostaja.nimi || '—'}</div>
          <div style="color:var(--text-2);font-size:0.875rem;line-height:1.6">
            ${ostaja.y_tunnus ? html`Y-tunnus ${ostaja.y_tunnus}<br>` : ''}
            ${ostaja.alv_tunnus ? html`ALV-tunniste ${ostaja.alv_tunnus}<br>` : ''}
            ${ostaja.osoite || ''} ${[ostaja.postinumero, ostaja.kaupunki].filter(Boolean).join(' ')}
          </div>
        </div>
        <div>
          <div style="font-size:0.75rem;color:var(--text-3);text-transform:uppercase;margin-bottom:var(--s2)">ALV-käsittely</div>
          <div>${(MYYNNIN_ALV_KASITTELYT[lasku.alv_kasittely] || {}).nimi}</div>
        </div>
      </div>

      <div class="table-wrapper" style="margin-bottom:var(--s4)">
        <table class="table">
          <thead><tr><th>Kuvaus</th><th style="text-align:right">Määrä</th><th style="text-align:right">À-hinta (veroton)</th>
            <th style="text-align:right">ALV %</th><th style="text-align:right">Veroton</th></tr></thead>
          <tbody>${riviHTML}</tbody>
        </table>
      </div>

      <div class="invoice-totals">
        <div class="totals-row"><span>Veroton yhteensä</span><span>${formatoiEuro(summat.verotonYhteensa)}</span></div>
        ${summat.alvErittely.map(e => html`<div class="totals-row"><span>ALV ${e.kanta} % (peruste ${formatoiEuro(e.veroton)})</span><span>${formatoiEuro(e.alv)}</span></div>`)}
        <div class="totals-row grand-total"><span>Yhteensä</span><span>${formatoiEuro(summat.verollinenYhteensa)}</span></div>
        ${Number(lasku.maksettu_summa) > 0 ? html`
          <div class="totals-row"><span>Maksettu</span><span>${formatoiEuro(lasku.maksettu_summa)}</span></div>
          <div class="totals-row"><span>Avoinna</span><span>${formatoiEuro(avoin)}</span></div>` : ''}
      </div>

      ${lasku.lisatiedot ? html`<div style="margin-top:var(--s4);padding-top:var(--s4);border-top:1px solid var(--border)">
        <div style="font-size:0.75rem;color:var(--text-3);text-transform:uppercase;margin-bottom:var(--s1)">Lisätiedot</div>
        <p style="color:var(--text-2);font-size:0.9rem;white-space:pre-line">${lasku.lisatiedot}</p></div>` : ''}
    </div>

    ${tositteet.length ? html`
      <div class="card" style="margin-top:var(--s4)">
        <div class="card-title" style="margin-bottom:var(--s3)">Kirjanpitokirjaukset</div>
        <table class="table"><tbody>
          ${tositteet.map(t => html`<tr>
            <td><a href="#kirjanpito/tosite/${t.id}">Tosite ${t.numero}</a></td>
            <td>${formatoiPaiva(t.pvm)}</td><td>${t.selite}</td>
            <td>${t.oikaistu ? html`<span class="badge badge-peruttu">Oikaistu</span>` : ''}</td></tr>`)}
        </tbody></table>
      </div>` : ''}
  `)

  const nappi = (id, fn) => document.getElementById(id)?.addEventListener('click', fn)
  nappi('btn-muokkaa', () => navigoi(`laskut/muokkaa/${lasku.id}`))
  nappi('btn-tulosta', () => tulostalasku(lasku, _profiili, alkuperainen).catch(e => naytaVirhe('Tulostus epäonnistui', e)))
  nappi('btn-poista', async () => {
    if (!await naytaVahvistus('Poistetaanko laskuluonnos? Luonnokselle ei ole annettu numeroa.', 'Poista luonnos')) return
    try { await poistaLaskuluonnos(lasku.id); naytaToast('Luonnos poistettu', 'success'); navigoi('laskut') } catch (e) { naytaVirhe('Poisto epäonnistui', e) }
  })
  nappi('btn-laheta', () => lahetaVahvistaen(lasku.id))
  nappi('btn-maksu', () => avaaMaksuLomake(lasku, avoin))
  nappi('btn-hyvita', async () => {
    const syy = await naytaVahvistus(
      `Laskusta ${lasku.laskunumero} tehdään hyvityslasku koko summalle (${formatoiEuro(-summat.verollinenYhteensa)}).\n` +
      'Hyvityslasku saa oman numeron ja se kirjataan heti. Jos lasku on jo maksettu, palautus asiakkaalle kirjataan pankista.',
      'Hyvityslasku', { kysy: 'Hyvityksen syy (näkyy laskulla)', okTeksti: 'Luo hyvityslasku' })
    if (!syy) return
    try {
      const h = await luoHyvityslasku(lasku.id, syy, isoTanaan())
      naytaToast(`Hyvityslasku ${h.laskunumero} luotu`, 'success')
      navigoi(`laskut/${h.id}`)
    } catch (e) { naytaVirhe('Hyvitys epäonnistui', e) }
  })
  nappi('btn-finvoice', () => {
    try {
      lataaTiedosto(`finvoice-${lasku.laskunumero}.xml`, rakennaFinvoice(lasku), 'application/xml')
      if (!lasku.ostaja?.verkkolaskuosoite) naytaToast('Ostajalta puuttuu verkkolaskuosoite: lisää se asiakastietoihin ennen seuraavaa laskua.', 'warning', 7000)
    } catch (e) { naytaVirhe('Verkkolaskun muodostus epäonnistui', e) }
  })
  nappi('btn-muistutus', async () => {
    const yritys = lasku.ostaja?.tyyppi !== 'kuluttaja'
    const maksu = await naytaVahvistus(
      'Maksumuistutukseen lisätään viivästyskorko (viitekorko + 8 %). ' +
      (yritys ? 'Yritysasiakkaalta voi periä 40 € kiinteän perintäkulun (perintälaki 10 e §).'
              : 'Kuluttajalta muistutusmaksu on enintään 5 € (perintälaki 10 §).') +
      '\nAnna muistutusmaksu euroina (0, jos ei peritä).', 'Maksumuistutus',
      { kysy: yritys ? '0 tai 40' : '0–5', okTeksti: 'Tulosta', vaarallinen: false })
    if (maksu === null) return
    const n = Number(String(maksu).replace(',', '.'))
    if (!Number.isFinite(n) || n < 0 || n > (yritys ? 40 : 5)) return naytaToast('Virheellinen muistutusmaksu', 'error')
    tulostaMaksumuistutus(lasku, _profiili, n)
  })
}

async function lahetaVahvistaen(id) {
  const ok = await naytaVahvistus(
    'Lasku saa seuraavan vapaan laskunumeron ja viitenumeron, se kirjataan kirjanpitoon (myyntisaaminen, myynti ja ALV) ja lukitaan.\n\n' +
    'Lähetettyä laskua ei voi enää muuttaa tai poistaa. Toimita lasku sen jälkeen asiakkaalle PDF:nä tai verkkolaskuna.',
    'Lähetä lasku', { okTeksti: 'Lähetä ja lukitse', vaarallinen: false })
  if (!ok) return
  try {
    const l = await lahetaLasku(id)
    naytaToast(`Lasku ${l.laskunumero} lähetetty ja kirjattu`, 'success')
    navigoi(`laskut/${id}`)
  } catch (e) {
    naytaVirhe('Lähetys epäonnistui', e)
  }
}

function avaaMaksuLomake(lasku, avoin) {
  avaaModaali(html`
    <h2 class="modal-title">Kirjaa maksu – lasku ${lasku.laskunumero}</h2>
    <p style="color:var(--text-2);font-size:0.875rem;margin-bottom:var(--s4)">
      Maksut kannattaa kirjata pankin tiliotteelta (Pankki-sivu), jolloin ne täsmäytyvät viitteellä.
      Käytä tätä, jos maksu ei tule tiliotteen kautta.</p>
    <form id="maksu-form">
      <div class="form-row">
        <div class="form-group"><label class="form-label">Maksupäivä *</label>
          <input class="form-input" type="date" id="m-pvm" value="${isoTanaan()}" required /></div>
        <div class="form-group"><label class="form-label">Summa (€) *</label>
          <input class="form-input" type="number" id="m-summa" value="${avoin.toFixed(2)}" min="0.01" max="${avoin.toFixed(2)}" step="0.01" required /></div>
      </div>
      <div id="m-virhe" class="alert alert-error hidden"></div>
      <div class="modal-footer">
        <button type="button" class="btn btn-secondary" id="m-peruuta">Peruuta</button>
        <button type="submit" class="btn btn-primary">Kirjaa maksu</button>
      </div>
    </form>`)
  document.getElementById('m-peruuta')?.addEventListener('click', suljeModaali)
  document.getElementById('maksu-form')?.addEventListener('submit', async (e) => {
    e.preventDefault()
    try {
      await kirjaaMaksu(lasku.id, document.getElementById('m-pvm').value, Number(document.getElementById('m-summa').value))
      suljeModaali()
      naytaToast('Maksu kirjattu', 'success')
      renderLaskuNakyma(lasku.id)
    } catch (err) {
      const el = document.getElementById('m-virhe')
      el.textContent = err.message
      el.classList.remove('hidden')
    }
  })
}

// ─── Luonnoslomake ─────────────────────────────────────

async function renderLomake(muokkausId = null) {
  naytaLatausRuutu()
  asetaTopbarToiminnot('')
  let asiakkaat, lasku
  try {
    ;[asiakkaat, lasku] = await Promise.all([haeAsiakkaat(), muokkausId ? haeLasku(muokkausId) : null])
  } catch (err) {
    return virheNakyma('Lomakkeen lataus epäonnistui', err)
  }
  if (lasku && lasku.tila !== 'luonnos') {
    naytaToast('Lähetettyä laskua ei voi muokata. Tee tarvittaessa hyvityslasku.', 'warning')
    return navigoi(`laskut/${lasku.id}`)
  }
  asiakkaat = asiakkaat.filter(a => !a.arkistoitu || a.id === lasku?.asiakas_id)

  const p = _profiili
  const alvRekisteroity = p.alv_rekisteroity !== false
  const tanaan = isoTanaan()
  const maksuehto = lasku?.maksuehto ?? p.maksuehto ?? 14
  const laskupaiva = lasku?.laskupaiva || tanaan
  const alkuRivit = lasku?.rivit?.length ? lasku.rivit
    : [{ kuvaus: '', maara: 1, yksikko: 'kpl', yksikkohinta: '', alv_kanta: alvRekisteroity ? 25.5 : 0 }]

  const puuttuu = ['yritys_nimi', 'y_tunnus', 'osoite', 'iban'].filter(k => !p[k])

  renderNakyma(html`
    <div style="margin-bottom:var(--s4)"><a href="#laskut" style="color:var(--text-2);font-size:0.875rem">← Takaisin laskuihin</a></div>
    <h1 class="section-title" style="margin-bottom:var(--s5)">${muokkausId ? 'Muokkaa luonnosta' : 'Uusi lasku'}</h1>
    ${puuttuu.length ? html`<div class="alert alert-warning" style="margin-bottom:var(--s4)">
      Yritystiedoista puuttuu: ${puuttuu.join(', ')}. Laskua ei voi lähettää ennen kuin tiedot on täydennetty
      <a href="#asetukset">asetuksissa</a>.</div>` : ''}
    <form id="lasku-lomake">
      <div class="card" style="margin-bottom:var(--s4)">
        <div class="card-title" style="margin-bottom:var(--s4)">Perustiedot</div>
        <div class="invoice-form-grid">
          <div class="form-group">
            <label class="form-label">Asiakas *</label>
            <select class="form-select" id="l-asiakas" required>
              <option value="">— Valitse asiakas —</option>
              ${asiakkaat.map(a => html`<option value="${a.id}" ${lasku?.asiakas_id === a.id ? 'selected' : ''}>${a.nimi}</option>`)}
            </select>
            <div class="form-hint"><a href="#asiakkaat">+ Lisää uusi asiakas</a></div>
          </div>
          <div class="form-group">
            <label class="form-label">Laskupäivä *</label>
            <input class="form-input" type="date" id="l-pvm" value="${laskupaiva}" required />
          </div>
          <div class="form-group">
            <label class="form-label">Toimitus- / suorituspäivä *</label>
            <input class="form-input" type="date" id="l-toimitus" value="${lasku?.toimituspaiva || laskupaiva}" required />
            <div class="form-hint">Ratkaisee ALV-kauden ja -kannan</div>
          </div>
          <div class="form-group">
            <label class="form-label">Maksuehto</label>
            <select class="form-select" id="l-maksuehto">
              ${MAKSUEHTO_VAIHTOEHDOT.map(m => html`<option value="${m.paivat}" ${m.paivat === Number(maksuehto) ? 'selected' : ''}>${m.nimi}</option>`)}
            </select>
          </div>
          <div class="form-group">
            <label class="form-label">Eräpäivä *</label>
            <input class="form-input" type="date" id="l-erapaiva" value="${lasku?.erapaiva || laskeErapaiva(laskupaiva, maksuehto)}" required />
          </div>
          <div class="form-group">
            <label class="form-label">ALV-käsittely</label>
            <select class="form-select" id="l-alv-kasittely" ${alvRekisteroity ? '' : 'disabled'}>
              ${Object.entries(MYYNNIN_ALV_KASITTELYT).map(([k, v]) =>
                html`<option value="${k}" ${(lasku?.alv_kasittely || 'normaali') === k ? 'selected' : ''}>${v.nimi}</option>`)}
            </select>
            <div class="form-hint" id="l-alv-vihje"></div>
          </div>
        </div>
      </div>

      <div class="card" style="margin-bottom:var(--s4)">
        <div class="card-title" style="margin-bottom:var(--s3)">Laskurivit</div>
        <div class="line-items-header">
          <span>Kuvaus</span><span style="text-align:right">Määrä</span><span class="col-unit">Yksikkö</span>
          <span style="text-align:right">À-hinta, veroton (€)</span><span class="col-alv-header" style="text-align:right">ALV %</span>
          <span style="text-align:right">Yhteensä</span><span></span>
        </div>
        <div id="l-rivit">${alkuRivit.map(r => riviHTML(r, laskupaiva))}</div>
        <button type="button" class="btn btn-ghost btn-sm" id="lisaa-rivi" style="margin-top:var(--s3)">+ Lisää rivi</button>
      </div>

      <div class="card" style="margin-bottom:var(--s4)"><div class="invoice-totals" id="l-yhteenveto"></div></div>

      <div class="card" style="margin-bottom:var(--s5)">
        <div class="card-title" style="margin-bottom:var(--s3)">Lisätiedot</div>
        <textarea class="form-textarea" id="l-lisatiedot" rows="3" maxlength="2000"
          placeholder="Esim. tilausnumero, ostajan viite, projektin nimi…">${lasku ? lasku.lisatiedot || '' : p.oletusteksti || ''}</textarea>
      </div>

      <div style="display:flex;gap:var(--s3);justify-content:flex-end;flex-wrap:wrap">
        <a href="#laskut" class="btn btn-secondary">Peruuta</a>
        <button type="submit" class="btn btn-secondary" id="tallenna-luonnos">Tallenna luonnos</button>
        <button type="button" class="btn btn-primary" id="tallenna-laheta">Tallenna ja lähetä</button>
      </div>
    </form>`)

  const asiakasMap = new Map(asiakkaat.map(a => [a.id, a]))
  const kasittelyEl = document.getElementById('l-alv-kasittely')
  const paivitaKasittely = () => {
    const k = alvRekisteroity ? kasittelyEl.value : 'normaali'
    const nolla = k !== 'normaali' || !alvRekisteroity
    document.querySelectorAll('#l-rivit [name="alv_kanta"]').forEach(s => {
      if (nolla) s.value = '0'
      s.disabled = nolla
    })
    const a = asiakasMap.get(document.getElementById('l-asiakas').value)
    const vihje = document.getElementById('l-alv-vihje')
    vihje.textContent = !alvRekisteroity ? 'Yritys ei ole ALV-rekisterissä: laskulle ei merkitä veroa.'
      : k.startsWith('eu_') && !a?.alv_tunnus ? 'EU-myynnissä ostajan ALV-tunniste on pakollinen.'
      : MYYNNIN_ALV_KASITTELYT[k]?.teksti || ''
    paivitaYhteenveto()
  }
  document.getElementById('l-asiakas')?.addEventListener('change', (e) => {
    const a = asiakasMap.get(e.target.value)
    if (a && alvRekisteroity) {
      const maa = (a.maa || 'FI').toUpperCase()
      if (maa !== 'FI' && EU_MAAT.includes(maa) && a.tyyppi !== 'kuluttaja') kasittelyEl.value = 'eu_palvelu'
      else if (maa !== 'FI' && !EU_MAAT.includes(maa)) kasittelyEl.value = 'vienti'
      else if (maa === 'FI') kasittelyEl.value = 'normaali'
    }
    paivitaKasittely()
  })
  kasittelyEl?.addEventListener('change', paivitaKasittely)

  const paivitaEra = () => {
    document.getElementById('l-erapaiva').value =
      laskeErapaiva(document.getElementById('l-pvm').value || tanaan, Number(document.getElementById('l-maksuehto').value))
  }
  document.getElementById('l-maksuehto')?.addEventListener('change', paivitaEra)
  document.getElementById('l-pvm')?.addEventListener('change', (e) => {
    const t = document.getElementById('l-toimitus')
    if (!t.value || t.dataset.muutettu !== '1') t.value = e.target.value
    paivitaEra()
  })
  document.getElementById('l-toimitus')?.addEventListener('change', (e) => { e.target.dataset.muutettu = '1' })

  document.getElementById('lisaa-rivi')?.addEventListener('click', () => {
    const wrap = document.createElement('div')
    wrap.innerHTML = String(riviHTML({ maara: 1, yksikko: 'kpl', alv_kanta: alvRekisteroity ? 25.5 : 0 },
      document.getElementById('l-toimitus').value))
    const uusi = wrap.firstElementChild
    document.getElementById('l-rivit').appendChild(uusi)
    lisaaRiviKuuntelijat(uusi)
    paivitaKasittely()
  })
  document.querySelectorAll('#l-rivit .line-item-row').forEach(lisaaRiviKuuntelijat)
  paivitaKasittely()

  const tallenna = async (laheta) => {
    const napit = document.querySelectorAll('#tallenna-luonnos, #tallenna-laheta')
    napit.forEach(b => { b.disabled = true })
    try {
      const asiakasId = document.getElementById('l-asiakas').value
      if (!asiakasId) throw new Error('Valitse asiakas')
      const rivit = haeRivit().filter(r => r.kuvaus)
      if (!rivit.length) throw new Error('Lisää vähintään yksi rivi, jolla on kuvaus')
      if (rivit.some(r => r.maara <= 0)) throw new Error('Rivin määrän on oltava positiivinen')
      const pvm = document.getElementById('l-pvm').value
      const era = document.getElementById('l-erapaiva').value
      if (paivienErotus(pvm, era) < 0) throw new Error('Eräpäivä ei voi olla ennen laskupäivää')
      const id = await tallennaLaskuluonnos(_kayttajaId, {
        id: muokkausId || undefined,
        asiakas_id: asiakasId,
        laskupaiva: pvm,
        toimituspaiva: document.getElementById('l-toimitus').value || pvm,
        erapaiva: era,
        maksuehto: Number(document.getElementById('l-maksuehto').value),
        alv_kasittely: alvRekisteroity ? kasittelyEl.value : 'normaali',
        lisatiedot: document.getElementById('l-lisatiedot').value.trim() || null,
      }, rivit)
      if (laheta) {
        await lahetaVahvistaen(id)
        if (window.location.hash !== `#laskut/${id}`) navigoi(`laskut/${id}`)
      } else {
        naytaToast('Luonnos tallennettu', 'success')
        navigoi(`laskut/${id}`)
      }
    } catch (err) {
      naytaVirhe('Tallennus epäonnistui', err)
    } finally {
      napit.forEach(b => { b.disabled = false })
    }
  }
  document.getElementById('lasku-lomake')?.addEventListener('submit', (e) => { e.preventDefault(); tallenna(false) })
  document.getElementById('tallenna-laheta')?.addEventListener('click', () => {
    if (document.getElementById('lasku-lomake').reportValidity()) tallenna(true)
  })
}

function riviHTML(rivi, toimituspaiva) {
  const kannat = alvKannatPaivalle(toimituspaiva || isoTanaan())
  const nykyinen = Number(rivi.alv_kanta ?? 25.5)
  if (!kannat.some(k => k.arvo === nykyinen)) kannat.push({ arvo: nykyinen, nimi: `${nykyinen} %` })
  const yksikot = ['kpl', 'h', 'pv', 'kk', 'v', 'krt', 'lisenssi']
  return html`
    <div class="line-item-row">
      <input class="form-input" type="text" name="kuvaus" maxlength="500" placeholder="Palvelun / tuotteen kuvaus" value="${rivi.kuvaus || ''}" />
      <input class="form-input" type="number" name="maara" min="0" step="0.01" value="${rivi.maara ?? 1}" style="text-align:right" />
      <select class="form-select col-unit" name="yksikko">
        ${yksikot.map(y => html`<option ${(rivi.yksikko || 'kpl') === y ? 'selected' : ''}>${y}</option>`)}
      </select>
      <input class="form-input" type="number" name="yksikkohinta" min="0" step="0.01" placeholder="0,00" value="${rivi.yksikkohinta ?? ''}" style="text-align:right" />
      <select class="form-select col-alv" name="alv_kanta">
        ${kannat.map(k => html`<option value="${k.arvo}" ${k.arvo === nykyinen ? 'selected' : ''}>${k.arvo} %</option>`)}
      </select>
      <div class="line-item-total" data-total>0,00 €</div>
      <button type="button" class="btn-remove-line" data-poista-rivi title="Poista rivi">✕</button>
    </div>`
}

function lisaaRiviKuuntelijat(rivi) {
  rivi.querySelectorAll('input').forEach(i => i.addEventListener('input', paivitaYhteenveto))
  rivi.querySelectorAll('select').forEach(s => s.addEventListener('change', paivitaYhteenveto))
  rivi.querySelector('[data-poista-rivi]')?.addEventListener('click', () => {
    if (document.querySelectorAll('#l-rivit .line-item-row').length > 1) {
      rivi.remove()
      paivitaYhteenveto()
    }
  })
}

function haeRivit() {
  return Array.from(document.querySelectorAll('#l-rivit .line-item-row')).map(r => ({
    kuvaus: r.querySelector('[name="kuvaus"]').value.trim(),
    maara: Number(r.querySelector('[name="maara"]').value) || 0,
    yksikko: r.querySelector('[name="yksikko"]').value,
    yksikkohinta: Number(r.querySelector('[name="yksikkohinta"]').value) || 0,
    alv_kanta: Number(r.querySelector('[name="alv_kanta"]').value) || 0,
  }))
}

function paivitaYhteenveto() {
  const rivit = haeRivit()
  document.querySelectorAll('#l-rivit .line-item-row').forEach((el, i) => {
    const r = rivit[i]
    el.querySelector('[data-total]').textContent = formatoiEuro(laskeRivi(r.maara, r.yksikkohinta, r.alv_kanta).verotonYhteensa)
  })
  const s = laskeLaskuSummat(rivit)
  const el = document.getElementById('l-yhteenveto')
  if (!el) return
  el.innerHTML = String(html`
    <div class="totals-row"><span>Veroton yhteensä</span><span>${formatoiEuro(s.verotonYhteensa)}</span></div>
    ${s.alvErittely.map(e => html`<div class="totals-row"><span>ALV ${e.kanta} %</span><span>${formatoiEuro(e.alv)}</span></div>`)}
    <div class="totals-row grand-total"><span>Yhteensä</span><span>${formatoiEuro(s.verollinenYhteensa)}</span></div>`)
}
