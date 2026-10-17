// ═══════════════════════════════════════════════════════
// PANKKI — Tiliotteen tuonti ja täsmäytys
//
// Kaikki pankkitilin tapahtumat kirjataan kirjanpitoon: saapuvat
// maksut laskuille (viitteellä), ostot kuluina tositteineen ja muut
// (ALV:n maksu, osakepääoma, laina, oma pano) suoraan tilille.
// ═══════════════════════════════════════════════════════

import {
  haePankkitapahtumat, tuoPankkitapahtumat, kirjaaPankkitapahtuma, ohitaPankkitapahtuma,
  haeLaskut, kirjaaMaksu, haeTilit, haeTilisaldot,
} from '../utils/supabase.js'
import { jasennaCamt053, jasennaCsv, etsiLasku } from '../utils/pankki.js'
import { formatoiEuro, formatoiPaiva, isoTanaan } from '../utils/formatters.js'
import { html } from '../utils/html.js'
import {
  renderNakyma, asetaTopbarToiminnot, avaaModaali, suljeModaali, naytaToast, naytaVahvistus,
  naytaVirhe, virheNakyma, naytaLatausRuutu,
} from './ui.js'
import { avaaKuluLomake } from './kulut.js'

let _suodatin = 'avoin'

// Vastatilit, joille pankkitapahtuman voi kirjata suoraan
const SUORAT_TILIT = ['2935', '1765', '2920', '2875', '1805', '2000', '2050', '2620', '1701', '2871', '7920', '7950', '7980', '9100', '9400', '3900', '5000', '2900']

export async function renderPankki() {
  asetaTopbarToiminnot(html`
    <label class="btn btn-primary btn-sm" style="cursor:pointer">Tuo tiliote
      <input type="file" id="tiliote-input" accept=".xml,.csv,.txt" class="hidden" /></label>`)
  document.getElementById('tiliote-input')?.addEventListener('change', tuoTiliote)
  await paivita()
}

async function paivita() {
  naytaLatausRuutu()
  let tapahtumat, laskut, tilit, saldot
  try {
    ;[tapahtumat, laskut, tilit, saldot] = await Promise.all([
      haePankkitapahtumat(), haeLaskut(), haeTilit(), haeTilisaldot('1900-01-01', isoTanaan()),
    ])
  } catch (err) {
    return virheNakyma('Pankkitietojen lataus epäonnistui', err)
  }
  const kirjanpitoSaldo = Number(saldot.find(s => s.numero === '1910')?.loppusaldo || 0)
  const maarat = { avoin: 0, kasitelty: 0, ohitettu: 0 }
  tapahtumat.forEach(t => { maarat[t.tila]++ })
  const naytettavat = tapahtumat.filter(t => t.tila === _suodatin)
  const tiliNimet = new Map(tilit.map(t => [t.numero, t.nimi]))

  renderNakyma(html`
    <div class="section-header">
      <div><h1 class="section-title">Pankki</h1>
        <p class="section-sub">Tuo tiliote verkkopankista (XML camt.053 tai CSV) ja kirjaa jokainen tapahtuma.</p></div>
    </div>
    <div class="kpi-grid" style="margin-bottom:var(--s5)">
      <div class="kpi-card"><div class="kpi-label">Pankkitili kirjanpidossa (1910)</div>
        <div class="kpi-value">${formatoiEuro(kirjanpitoSaldo)}</div>
        <div class="kpi-change">Täsmäytä kuukausittain pankin saldoon</div></div>
      <div class="kpi-card"><div class="kpi-label">Kirjaamatta</div>
        <div class="kpi-value" style="color:${maarat.avoin ? 'var(--amber)' : 'inherit'}">${maarat.avoin}</div></div>
      <div class="kpi-card"><div class="kpi-label">Kirjattu</div><div class="kpi-value">${maarat.kasitelty}</div></div>
    </div>
    <div class="period-selector" style="margin-bottom:var(--s4)">
      ${[['avoin', 'Kirjaamatta'], ['kasitelty', 'Kirjatut'], ['ohitettu', 'Ohitetut']].map(([k, n]) =>
        html`<button class="period-btn ${_suodatin === k ? 'active' : ''}" data-suodatin="${k}">${n} (${maarat[k]})</button>`)}
    </div>
    ${naytettavat.length === 0 ? html`<div class="empty-state"><h3>Ei tapahtumia</h3>
      <p>Lataa tiliote verkkopankista: <em>Tiliote → XML (camt.053)</em> tai CSV, ja tuo se tästä.</p></div>` : html`
      <div class="table-wrapper"><table class="table">
        <thead><tr><th>Päivä</th><th>Vastapuoli / viesti</th><th style="text-align:right">Summa</th><th>Toiminto</th></tr></thead>
        <tbody id="pankki-tbody">
          ${naytettavat.map(t => {
            const lasku = t.tila === 'avoin' ? etsiLasku({ ...t, summa: Number(t.summa) }, laskut) : null
            return html`<tr>
              <td>${formatoiPaiva(t.pvm)}</td>
              <td><div style="font-weight:500">${t.vastapuoli || '—'}</div>
                <div style="font-size:0.78rem;color:var(--text-3)">${[t.viite ? 'Viite ' + t.viite : '', t.viesti].filter(Boolean).join(' · ')}</div></td>
              <td style="text-align:right;font-weight:600;color:${Number(t.summa) >= 0 ? 'var(--green)' : 'inherit'}">${formatoiEuro(t.summa)}</td>
              <td><div class="table-actions" style="flex-wrap:wrap">
                ${t.tila === 'avoin' ? html`
                  ${lasku ? html`<button class="btn btn-primary btn-sm" data-action="maksu" data-id="${t.id}" data-lasku="${lasku.id}">
                    Maksu laskulle ${lasku.laskunumero}</button>` : ''}
                  ${Number(t.summa) > 0 && !lasku ? html`<button class="btn btn-secondary btn-sm" data-action="valitse-lasku" data-id="${t.id}">Valitse lasku</button>` : ''}
                  ${Number(t.summa) < 0 ? html`<button class="btn btn-secondary btn-sm" data-action="kulu" data-id="${t.id}">Kirjaa kuluksi</button>` : ''}
                  <button class="btn btn-ghost btn-sm" data-action="tili" data-id="${t.id}">Kirjaa tilille</button>
                  <button class="btn btn-ghost btn-sm" data-action="ohita" data-id="${t.id}">Ohita</button>`
                : t.tila === 'ohitettu' ? html`<button class="btn btn-ghost btn-sm" data-action="palauta" data-id="${t.id}">Palauta</button>`
                : html`<a href="#kirjanpito/tosite/${t.tosite_id}">Tosite →</a>`}
              </div></td></tr>`
          })}
        </tbody></table></div>`}
  `)

  document.querySelectorAll('[data-suodatin]').forEach(b => b.addEventListener('click', () => { _suodatin = b.dataset.suodatin; paivita() }))
  document.getElementById('pankki-tbody')?.addEventListener('click', async (e) => {
    const btn = e.target.closest('[data-action]')
    if (!btn) return
    const t = tapahtumat.find(x => x.id === btn.dataset.id)
    try {
      switch (btn.dataset.action) {
        case 'maksu':
          await kirjaaMaksu(btn.dataset.lasku, t.pvm, Number(t.summa), t.id)
          naytaToast('Maksu kirjattu laskulle', 'success')
          return paivita()
        case 'valitse-lasku':
          return valitseLasku(t, laskut)
        case 'kulu':
          return avaaKuluLomake({ pankkitapahtuma: t, onValmis: paivita })
        case 'tili':
          return valitseTili(t, tilit.filter(x => SUORAT_TILIT.includes(x.numero)), tiliNimet)
        case 'ohita': {
          const ok = await naytaVahvistus('Ohita vain tapahtuma, joka ei kuulu yhtiön kirjanpitoon (esim. kaksoiskappale). Kaikki yhtiön tilin tapahtumat on kirjattava.', 'Ohita tapahtuma', { okTeksti: 'Ohita' })
          if (!ok) return
          await ohitaPankkitapahtuma(t.id, true)
          return paivita()
        }
        case 'palauta':
          await ohitaPankkitapahtuma(t.id, false)
          return paivita()
      }
    } catch (err) {
      naytaVirhe('Kirjaus epäonnistui', err)
    }
  })
}

async function tuoTiliote(e) {
  const tiedosto = e.target.files[0]
  e.target.value = ''
  if (!tiedosto) return
  if (tiedosto.size > 5 * 1024 * 1024) return naytaToast('Tiedosto on liian suuri (max 5 Mt)', 'error')
  try {
    const sisalto = await tiedosto.text()
    const tapahtumat = sisalto.trimStart().startsWith('<') ? jasennaCamt053(sisalto) : jasennaCsv(sisalto)
    if (!tapahtumat.length) throw new Error('Tiedostosta ei löytynyt tapahtumia')
    const tulos = await tuoPankkitapahtumat(tapahtumat)
    naytaToast(`Tuotiin ${tulos.lisatty} uutta tapahtumaa (${tulos.yhteensa - tulos.lisatty} oli jo tuotu)`, 'success')
    _suodatin = 'avoin'
    await paivita()
  } catch (err) {
    naytaVirhe('Tiliotteen tuonti epäonnistui', err)
  }
}

function valitseLasku(t, laskut) {
  const avoimet = laskut.filter(l => l.tyyppi === 'lasku' && ['lahetetty', 'osittain'].includes(l.tila))
  avaaModaali(html`
    <h2 class="modal-title">Kohdista maksu ${formatoiEuro(t.summa)}</h2>
    <p style="color:var(--text-2);font-size:0.875rem;margin-bottom:var(--s3)">${t.vastapuoli || ''} ${t.viesti || ''}</p>
    ${avoimet.length ? html`<div class="table-wrapper"><table class="table"><tbody id="valinta-tbody">
      ${avoimet.map(l => html`<tr>
        <td>${l.laskunumero}</td><td>${l.ostaja?.nimi || ''}</td>
        <td style="text-align:right">${formatoiEuro(Number(l.summa_verollinen) - Number(l.maksettu_summa))}</td>
        <td><button class="btn btn-primary btn-sm" data-lasku="${l.id}">Kohdista</button></td></tr>`)}
    </tbody></table></div>` : html`<p>Ei avoimia laskuja. Kirjaa tapahtuma tarvittaessa tilille.</p>`}
    <div class="modal-footer"><button class="btn btn-secondary" id="v-peruuta">Peruuta</button></div>`)
  document.getElementById('v-peruuta')?.addEventListener('click', suljeModaali)
  document.getElementById('valinta-tbody')?.addEventListener('click', async (e) => {
    const b = e.target.closest('[data-lasku]')
    if (!b) return
    try {
      await kirjaaMaksu(b.dataset.lasku, t.pvm, Number(t.summa), t.id)
      suljeModaali()
      naytaToast('Maksu kirjattu', 'success')
      paivita()
    } catch (err) { naytaVirhe('Kohdistus epäonnistui', err) }
  })
}

function valitseTili(t, tilit) {
  const vihjeet = {
    '2935': 'ALV:n maksu Verohallinnolle (OmaVero)', '1765': 'ALV-palautus Verohallinnolta',
    '2920': 'Yhteisöveron / ennakkoveron maksu', '2875': 'Osakkaan rahoitus tai sen takaisinmaksu',
    '2000': 'Osakepääoman maksu', '2050': 'Sijoitus SVOP-rahastoon', '2620': 'Lainan nosto tai lyhennys (esim. Finnvera)',
    '1701': 'Hyvitetyn laskun palautus asiakkaalle', '2871': 'Ostovelan maksu', '7920': 'Pankkikulut (ei ALV:tä)',
    '9400': 'Korkokulut', '9100': 'Korkotuotot', '3900': 'Avustus (esim. Business Finland)',
  }
  avaaModaali(html`
    <h2 class="modal-title">Kirjaa tapahtuma tilille</h2>
    <p style="color:var(--text-2);font-size:0.875rem;margin-bottom:var(--s3)">
      ${formatoiPaiva(t.pvm)} · ${t.vastapuoli || ''} · <strong>${formatoiEuro(t.summa)}</strong><br>
      ALV:lliset ostot kirjataan "Kirjaa kuluksi" -toiminnolla tositteen kanssa.</p>
    <form id="tili-form">
      <div class="form-group"><label class="form-label">Vastatili *</label>
        <select class="form-select" id="t-tili" required>
          ${tilit.map(x => html`<option value="${x.numero}">${x.numero} ${x.nimi}${vihjeet[x.numero] ? ` — ${vihjeet[x.numero]}` : ''}</option>`)}
        </select></div>
      <div class="form-group"><label class="form-label">Selite *</label>
        <input class="form-input" type="text" id="t-selite" maxlength="300" required value="${[t.vastapuoli, t.viesti].filter(Boolean).join(' ')}" /></div>
      <div class="modal-footer">
        <button type="button" class="btn btn-secondary" id="t-peruuta">Peruuta</button>
        <button type="submit" class="btn btn-primary">Kirjaa</button>
      </div>
    </form>`)
  document.getElementById('t-peruuta')?.addEventListener('click', suljeModaali)
  document.getElementById('tili-form')?.addEventListener('submit', async (e) => {
    e.preventDefault()
    try {
      await kirjaaPankkitapahtuma(t.id, document.getElementById('t-tili').value, document.getElementById('t-selite').value.trim())
      suljeModaali()
      naytaToast('Tapahtuma kirjattu', 'success')
      paivita()
    } catch (err) { naytaVirhe('Kirjaus epäonnistui', err) }
  })
}
