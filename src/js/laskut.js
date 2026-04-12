// ═══════════════════════════════════════════════════════
// LASKUT — Laskujen hallinta
// ═══════════════════════════════════════════════════════

import {
  haeLaskut, haeLasku, tallennaLasku, poistaLasku,
  paivitaLaskunTila, haeSeuraavaLaskunumero, haeAsiakkaat
} from '../utils/supabase.js'
import {
  formatoiEuro, formatoiPaiva, tilaHTML, LASKU_TILAT,
  onMyohassa, paiviaErapaivaan, MAKSUEHTO_VAIHTOEHDOT
} from '../utils/formatters.js'
import {
  laskeLaskuSummat, laskeRivi, laskeViitenumero,
  muotoileViitenumero, laskeErapaiva, ALV_KANNAT
} from '../utils/laskuri.js'
import {
  renderNakyma, asetaTopbarToiminnot, avaaModaali,
  suljeModaali, naytaToast, naytaVahvistus, tyhjaLista
} from './ui.js'
import { navigoi } from './router.js'
import { tulostalasku } from './laskuTulostus.js'

let _kayttajaId = null
let _laskut = []
let _asiakkaat = []

export async function renderLaskut(kayttajaId, polku) {
  _kayttajaId = kayttajaId

  // Reitti: laskut/uusi, laskut/muokkaa/:id tai laskut/:id
  if (polku === 'laskut/uusi') {
    await renderUusiLasku()
    return
  }
  if (polku.startsWith('laskut/muokkaa/')) {
    const id = polku.slice('laskut/muokkaa/'.length)
    await renderUusiLasku(id)
    return
  }
  const idOsa = polku.replace('laskut/', '')
  if (idOsa && idOsa !== 'laskut') {
    await renderLaskuNakyma(idOsa)
    return
  }

  await renderLaskuLista()
}

// ─── Laskulista ────────────────────────────────────────

async function renderLaskuLista() {
  asetaTopbarToiminnot(`
    <button class="btn btn-primary btn-sm" id="uusi-lasku-btn">
      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5">
        <line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/>
      </svg>
      Uusi lasku
    </button>
  `)

  renderNakyma('<div class="loading-screen"><div class="spinner"></div></div>')

  try {
    _laskut = await haeLaskut(_kayttajaId)
    renderLaskuListaHTML(_laskut)
  } catch (err) {
    renderNakyma(`<div class="alert alert-error">Laskujen lataus epäonnistui: ${err.message}</div>`)
  }
}

function renderLaskuListaHTML(laskut) {
  if (laskut.length === 0) {
    renderNakyma(`
      <div class="section-header">
        <div><h1 class="section-title">Laskut</h1></div>
      </div>
      ${tyhjaLista('Ei laskuja', 'Luo ensimmäinen laskusi painamalla "Uusi lasku".', 'Uusi lasku', 'empty-uusi-lasku')}
    `)
    document.getElementById('uusi-lasku-btn')?.addEventListener('click', () => navigoi('laskut/uusi'))
    document.getElementById('empty-uusi-lasku')?.addEventListener('click', () => navigoi('laskut/uusi'))
    return
  }

  const tilaVaihtoehdot = Object.entries(LASKU_TILAT)
    .map(([k, v]) => `<option value="${k}">${v.nimi}</option>`).join('')

  const rivit = laskut.map(l => {
    const summat = laskeLaskuSummat(l.rivit || [])
    const efektiivinenTila = onMyohassa(l.erapaiva, l.tila) ? 'myohassa' : l.tila
    const paiviaJaljella = paiviaErapaivaan(l.erapaiva)
    const paiviaStr = efektiivinenTila === 'myohassa'
      ? `<span style="color:var(--red);font-size:0.78rem">${Math.abs(paiviaJaljella)} pv myöhässä</span>`
      : efektiivinenTila === 'maksettu'
        ? ''
        : `<span style="color:var(--text-3);font-size:0.78rem">${paiviaJaljella} pv</span>`

    return `
      <tr style="cursor:pointer" data-id="${l.id}" data-tila="${efektiivinenTila}" data-haku="${(l.laskunumero + ' ' + (l.asiakas?.nimi || '')).toLowerCase()}">
        <td><strong style="color:var(--lime)">${l.laskunumero}</strong></td>
        <td>${l.asiakas?.nimi || '—'}</td>
        <td>${formatoiPaiva(l.laskupaiva)}</td>
        <td>${formatoiPaiva(l.erapaiva)}<br>${paiviaStr}</td>
        <td style="text-align:right"><strong>${formatoiEuro(summat.verollinenYhteensa)}</strong></td>
        <td>${tilaHTML(efektiivinenTila, l.erapaiva)}</td>
        <td>
          <div class="table-actions">
            <button class="btn btn-ghost btn-sm" data-action="tulosta" data-id="${l.id}" title="Tulosta">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                <polyline points="6 9 6 2 18 2 18 9"/><path d="M6 18H4a2 2 0 01-2-2v-5a2 2 0 012-2h16a2 2 0 012 2v5a2 2 0 01-2 2h-2"/>
                <rect x="6" y="14" width="12" height="8"/>
              </svg>
            </button>
            <button class="btn btn-ghost btn-sm" data-action="muokkaa" data-id="${l.id}" title="Muokkaa">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                <path d="M11 4H4a2 2 0 00-2 2v14a2 2 0 002 2h14a2 2 0 002-2v-7"/>
                <path d="M18.5 2.5a2.121 2.121 0 013 3L12 15l-4 1 1-4 9.5-9.5z"/>
              </svg>
            </button>
            <button class="btn btn-ghost btn-sm" data-action="poista" data-id="${l.id}" title="Poista" style="color:var(--red-soft)">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                <polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14a2 2 0 01-2 2H8a2 2 0 01-2-2L5 6"/>
                <path d="M10 11v6"/><path d="M14 11v6"/>
              </svg>
            </button>
          </div>
        </td>
      </tr>
    `
  }).join('')

  renderNakyma(`
    <div class="section-header">
      <div>
        <h1 class="section-title">Laskut</h1>
        <p class="section-sub">${laskut.length} laskua yhteensä</p>
      </div>
    </div>

    <div class="filter-bar">
      <input class="form-input" type="search" id="lasku-haku" placeholder="Hae laskunumerolla tai asiakkaalla…" />
      <select class="form-select" id="lasku-tila-filter">
        <option value="">Kaikki tilat</option>
        ${tilaVaihtoehdot}
        <option value="myohassa">Myöhässä</option>
      </select>
    </div>

    <div class="table-wrapper">
      <table class="table" id="lasku-taulukko">
        <thead>
          <tr>
            <th>Numero</th>
            <th>Asiakas</th>
            <th>Laskupäivä</th>
            <th>Eräpäivä</th>
            <th style="text-align:right">Summa (ALV)</th>
            <th>Tila</th>
            <th></th>
          </tr>
        </thead>
        <tbody id="lasku-tbody">${rivit}</tbody>
      </table>
    </div>
  `)

  lisaaLaskuListaTapahtumankuuntelijat()
  document.getElementById('uusi-lasku-btn')?.addEventListener('click', () => navigoi('laskut/uusi'))
}

function lisaaLaskuListaTapahtumankuuntelijat() {
  const tbody = document.getElementById('lasku-tbody')

  tbody?.addEventListener('click', async (e) => {
    const btn = e.target.closest('[data-action]')
    if (btn) {
      e.stopPropagation()
      const id = btn.dataset.id
      if (btn.dataset.action === 'tulosta') {
        const lasku = await haeLasku(id)
        tulostalasku(lasku)
      } else if (btn.dataset.action === 'muokkaa') {
        navigoi(`laskut/muokkaa/${id}`)
      } else if (btn.dataset.action === 'poista') {
        const ok = await naytaVahvistus('Haluatko varmasti poistaa tämän laskun? Toimintoa ei voi peruuttaa.', 'Poista lasku')
        if (ok) {
          try {
            await poistaLasku(id)
            naytaToast('Lasku poistettu', 'success')
            renderLaskuLista()
          } catch (err) {
            naytaToast('Poisto epäonnistui: ' + err.message, 'error')
          }
        }
      }
      return
    }

    const rivi = e.target.closest('tr[data-id]')
    if (rivi) navigoi(`laskut/${rivi.dataset.id}`)
  })

  // Haku — debounced
  let _hakuTimer = null
  const suodataDebounced = () => {
    clearTimeout(_hakuTimer)
    _hakuTimer = setTimeout(() => {
      suodataLaskut(
        document.getElementById('lasku-haku')?.value,
        document.getElementById('lasku-tila-filter')?.value
      )
    }, 150)
  }
  document.getElementById('lasku-haku')?.addEventListener('input', suodataDebounced)
  document.getElementById('lasku-tila-filter')?.addEventListener('change', suodataDebounced)
}

function suodataLaskut(hakusana, tila) {
  const rivit = document.querySelectorAll('#lasku-tbody tr[data-id]')
  const haku = (hakusana || '').toLowerCase()

  rivit.forEach(rivi => {
    const hakuOk = !haku || (rivi.dataset.haku || '').includes(haku)
    const tilaOk = !tila || rivi.dataset.tila === tila
    rivi.style.display = hakuOk && tilaOk ? '' : 'none'
  })
}

// ─── Lasku-näkymä (yksittäinen) ───────────────────────

async function renderLaskuNakyma(id) {
  renderNakyma('<div class="loading-screen"><div class="spinner"></div></div>')
  asetaTopbarToiminnot('')

  try {
    const lasku = await haeLasku(id)
    if (!lasku) { navigoi('laskut'); return }

    const summat = laskeLaskuSummat(lasku.rivit || [])
    const asiakas = lasku.asiakas || {}

    asetaTopbarToiminnot(`
      <button class="btn btn-ghost btn-sm" id="btn-muokkaa-lasku">Muokkaa</button>
      <button class="btn btn-secondary btn-sm" id="btn-tulosta-lasku">Tulosta / PDF</button>
      ${lasku.tila !== 'maksettu' ? `<button class="btn btn-primary btn-sm" id="btn-merkitse-maksettu">Merkitse maksetuksi</button>` : ''}
    `)

    const riviHTML = (lasku.rivit || []).map(r => {
      const s = laskeRivi(r.maara, r.yksikkohinta, r.alv_kanta)
      return `
        <tr>
          <td>${r.kuvaus}</td>
          <td style="text-align:right">${r.maara} ${r.yksikko || 'kpl'}</td>
          <td style="text-align:right">${formatoiEuro(r.yksikkohinta)}</td>
          <td style="text-align:right">${r.alv_kanta} %</td>
          <td style="text-align:right">${formatoiEuro(s.alv)}</td>
          <td style="text-align:right"><strong>${formatoiEuro(s.verollinenYhteensa)}</strong></td>
        </tr>
      `
    }).join('')

    const alvRivit = Object.entries(summat.alvErittely).map(([kanta, e]) => `
      <div class="totals-row">
        <span>ALV ${kanta} %</span>
        <span>${formatoiEuro(e.alv)}</span>
      </div>
    `).join('')

    renderNakyma(`
      <div style="margin-bottom:var(--s4)">
        <a href="#laskut" style="color:var(--text-2);font-size:0.875rem">← Takaisin laskuihin</a>
      </div>

      <div class="card">
        <div style="display:flex;justify-content:space-between;align-items:flex-start;flex-wrap:wrap;gap:var(--s4);margin-bottom:var(--s6)">
          <div>
            <div style="font-size:0.75rem;color:var(--text-3);text-transform:uppercase;letter-spacing:0.05em;margin-bottom:4px">LASKU</div>
            <h1 style="font-family:var(--font-display);font-size:2rem;font-weight:800;color:var(--lime)">${lasku.laskunumero}</h1>
            ${tilaHTML(onMyohassa(lasku.erapaiva, lasku.tila) ? 'myohassa' : lasku.tila, lasku.erapaiva)}
          </div>
          <div style="text-align:right">
            <div style="color:var(--text-3);font-size:0.82rem">Laskupäivä: ${formatoiPaiva(lasku.laskupaiva)}</div>
            <div style="color:var(--text-3);font-size:0.82rem">Eräpäivä: <strong style="color:var(--text)">${formatoiPaiva(lasku.erapaiva)}</strong></div>
            ${lasku.viitenumero ? `<div style="color:var(--text-3);font-size:0.82rem">Viite: ${muotoileViitenumero(lasku.viitenumero)}</div>` : ''}
          </div>
        </div>

        <div style="display:grid;grid-template-columns:1fr 1fr;gap:var(--s6);margin-bottom:var(--s6)">
          <div>
            <div style="font-size:0.75rem;color:var(--text-3);text-transform:uppercase;margin-bottom:var(--s2)">ASIAKAS</div>
            <div style="font-weight:700;color:var(--text)">${asiakas.nimi || '—'}</div>
            ${asiakas.y_tunnus ? `<div style="color:var(--text-2);font-size:0.875rem">Y-tunnus: ${asiakas.y_tunnus}</div>` : ''}
            ${asiakas.osoite ? `<div style="color:var(--text-2);font-size:0.875rem">${asiakas.osoite}</div>` : ''}
            ${asiakas.postinumero || asiakas.kaupunki ? `<div style="color:var(--text-2);font-size:0.875rem">${[asiakas.postinumero, asiakas.kaupunki].filter(Boolean).join(' ')}</div>` : ''}
          </div>
        </div>

        <div class="table-wrapper" style="margin-bottom:var(--s4)">
          <table class="table">
            <thead>
              <tr>
                <th>Kuvaus</th>
                <th style="text-align:right">Määrä</th>
                <th style="text-align:right">À-hinta</th>
                <th style="text-align:right">ALV %</th>
                <th style="text-align:right">ALV €</th>
                <th style="text-align:right">Yhteensä</th>
              </tr>
            </thead>
            <tbody>${riviHTML}</tbody>
          </table>
        </div>

        <div class="invoice-totals">
          <div class="totals-row">
            <span>Yhteensä (veroton)</span>
            <span>${formatoiEuro(summat.verotonYhteensa)}</span>
          </div>
          ${alvRivit}
          <div class="totals-row grand-total">
            <span>Maksettava yhteensä</span>
            <span>${formatoiEuro(summat.verollinenYhteensa)}</span>
          </div>
        </div>

        ${lasku.lisatiedot ? `
          <div style="margin-top:var(--s4);padding-top:var(--s4);border-top:1px solid var(--border)">
            <div style="font-size:0.75rem;color:var(--text-3);text-transform:uppercase;margin-bottom:var(--s1)">LISÄTIEDOT</div>
            <p style="color:var(--text-2);font-size:0.9rem">${lasku.lisatiedot}</p>
          </div>
        ` : ''}
      </div>
    `)

    // Napit
    document.getElementById('btn-muokkaa-lasku')?.addEventListener('click', () => navigoi(`laskut/muokkaa/${lasku.id}`))
    document.getElementById('btn-tulosta-lasku')?.addEventListener('click', () => tulostalasku(lasku))
    document.getElementById('btn-merkitse-maksettu')?.addEventListener('click', async () => {
      try {
        await paivitaLaskunTila(lasku.id, 'maksettu')
        naytaToast('Lasku merkitty maksetuksi!', 'success')
        renderLaskuNakyma(id)
      } catch (err) {
        naytaToast('Virhe: ' + err.message, 'error')
      }
    })
  } catch (err) {
    renderNakyma(`<div class="alert alert-error">Laskun lataus epäonnistui: ${err.message}</div>`)
  }
}

// ─── Uusi / Muokkaa lasku -lomake ────────────────────

async function renderUusiLasku(muokkausId = null) {
  renderNakyma('<div class="loading-screen"><div class="spinner"></div></div>')
  asetaTopbarToiminnot('')

  try {
    const [asiakkaat, laskunumero, muokattava] = await Promise.all([
      haeAsiakkaat(_kayttajaId),
      muokkausId ? Promise.resolve(null) : haeSeuraavaLaskunumero(_kayttajaId),
      muokkausId ? haeLasku(muokkausId) : Promise.resolve(null),
    ])

    _asiakkaat = asiakkaat

    const tanaan = new Date().toISOString().split('T')[0]
    const erapaiva = laskeErapaiva(tanaan, 14)

    const existingRivit = muokattava?.rivit || []
    const alkuRivit = existingRivit.length > 0 ? existingRivit : [{ kuvaus: '', maara: 1, yksikko: 'kpl', yksikkohinta: '', alv_kanta: 25.5 }]

    const asiakasOptions = asiakkaat.map(a =>
      `<option value="${a.id}" ${muokattava?.asiakas_id === a.id ? 'selected' : ''}>${a.nimi}</option>`
    ).join('')

    const maksuehtoOptions = MAKSUEHTO_VAIHTOEHDOT.map(m =>
      `<option value="${m.paivat}" ${m.paivat === 14 ? 'selected' : ''}>${m.nimi}</option>`
    ).join('')

    const riviHTML = alkuRivit.map((r, i) => rakennalaskurivi(i, r)).join('')

    renderNakyma(`
      <div style="margin-bottom:var(--s4)">
        <a href="#laskut" style="color:var(--text-2);font-size:0.875rem">← Takaisin laskuihin</a>
      </div>

      <h1 class="section-title" style="margin-bottom:var(--s5)">${muokkausId ? 'Muokkaa laskua' : 'Uusi lasku'}</h1>

      <form id="lasku-lomake">
        <div class="card" style="margin-bottom:var(--s4)">
          <div class="card-title" style="margin-bottom:var(--s4)">Perustiedot</div>
          <div class="invoice-form-grid">
            <div class="form-group">
              <label class="form-label">Asiakas *</label>
              <select class="form-select" id="lasku-asiakas" required>
                <option value="">— Valitse asiakas —</option>
                ${asiakasOptions}
              </select>
              <div class="form-hint"><a href="#asiakkaat" target="_blank">+ Lisää uusi asiakas</a></div>
            </div>
            <div class="form-group">
              <label class="form-label">Laskunumero *</label>
              <input class="form-input" type="text" id="lasku-numero"
                value="${muokattava?.laskunumero || laskunumero || ''}" required />
            </div>
            <div class="form-group">
              <label class="form-label">Laskupäivä *</label>
              <input class="form-input" type="date" id="lasku-pvm"
                value="${muokattava?.laskupaiva || tanaan}" required />
            </div>
            <div class="form-group">
              <label class="form-label">Maksuehto</label>
              <select class="form-select" id="lasku-maksuehto">${maksuehtoOptions}</select>
            </div>
            <div class="form-group">
              <label class="form-label">Eräpäivä *</label>
              <input class="form-input" type="date" id="lasku-erapaiva"
                value="${muokattava?.erapaiva || erapaiva}" required />
            </div>
            <div class="form-group">
              <label class="form-label">Tila</label>
              <select class="form-select" id="lasku-tila">
                ${Object.entries(LASKU_TILAT).map(([k, v]) =>
                  `<option value="${k}" ${(muokattava?.tila || 'luonnos') === k ? 'selected' : ''}>${v.nimi}</option>`
                ).join('')}
              </select>
            </div>
          </div>
        </div>

        <!-- Laskurivit -->
        <div class="card" style="margin-bottom:var(--s4)">
          <div class="card-title" style="margin-bottom:var(--s3)">Laskurivit</div>
          <div class="line-items-header">
            <span>Kuvaus</span>
            <span style="text-align:right">Määrä</span>
            <span class="col-unit">Yksikkö</span>
            <span style="text-align:right">À-hinta (€)</span>
            <span class="col-alv-header" style="text-align:right">ALV %</span>
            <span style="text-align:right">Yhteensä</span>
            <span></span>
          </div>
          <div id="lasku-rivit">${riviHTML}</div>
          <button type="button" class="btn btn-ghost btn-sm" id="lisaa-rivi" style="margin-top:var(--s3)">
            + Lisää rivi
          </button>
        </div>

        <!-- Yhteenveto -->
        <div class="card" style="margin-bottom:var(--s4)">
          <div class="invoice-totals" id="lasku-yhteenveto">
            <!-- Lasketaan JS:ssä -->
          </div>
        </div>

        <!-- Lisätiedot -->
        <div class="card" style="margin-bottom:var(--s5)">
          <div class="card-title" style="margin-bottom:var(--s3)">Lisätiedot</div>
          <div class="form-group" style="margin-bottom:0">
            <textarea class="form-textarea" id="lasku-lisatiedot" placeholder="Vapaamuotoiset lisätiedot laskulle…" rows="3">${muokattava?.lisatiedot || ''}</textarea>
          </div>
        </div>

        <div style="display:flex;gap:var(--s3);justify-content:flex-end">
          <a href="#laskut" class="btn btn-secondary">Peruuta</a>
          <button type="submit" class="btn btn-primary" id="tallenna-lasku-btn">
            ${muokkausId ? 'Tallenna muutokset' : 'Luo lasku'}
          </button>
        </div>
      </form>
    `)

    document.getElementById('lasku-maksuehto')?.addEventListener('change', (e) => {
      const paivat = parseInt(e.target.value)
      const laskuPvm = document.getElementById('lasku-pvm')?.value || tanaan
      document.getElementById('lasku-erapaiva').value = laskeErapaiva(laskuPvm, paivat)
    })
    document.getElementById('lasku-pvm')?.addEventListener('change', (e) => {
      const paivat = parseInt(document.getElementById('lasku-maksuehto')?.value || '14')
      document.getElementById('lasku-erapaiva').value = laskeErapaiva(e.target.value, paivat)
    })

    document.getElementById('lisaa-rivi')?.addEventListener('click', () => {
      const container = document.getElementById('lasku-rivit')
      const idx = container.querySelectorAll('.line-item-row').length
      const uusiRivi = document.createElement('div')
      uusiRivi.innerHTML = rakennalaskurivi(idx)
      container.appendChild(uusiRivi.firstElementChild)
      lisaaRiviTapahtumankuuntelijat(container.lastElementChild)
      paivitaYhteenveto()
    })

    // Kuuntelijat olemassaoleville riveille
    document.querySelectorAll('.line-item-row').forEach(rivi => {
      lisaaRiviTapahtumankuuntelijat(rivi)
    })
    paivitaYhteenveto()

    // Lomakkeen lähetys
    document.getElementById('lasku-lomake')?.addEventListener('submit', async (e) => {
      e.preventDefault()
      await tallennaLaskuLomake(muokkausId)
    })
  } catch (err) {
    renderNakyma(`<div class="alert alert-error">Virhe: ${err.message}</div>`)
  }
}

function rakennalaskurivi(idx, rivi = {}) {
  const alvOptions = ALV_KANNAT.map(k =>
    `<option value="${k.arvo}" ${(rivi.alv_kanta ?? 25.5) == k.arvo ? 'selected' : ''}>${k.arvo} %</option>`
  ).join('')

  return `
    <div class="line-item-row" data-idx="${idx}">
      <input class="form-input" type="text" placeholder="Palvelun / tuotteen kuvaus"
        name="kuvaus" value="${rivi.kuvaus || ''}" required />
      <input class="form-input" type="number" placeholder="1" min="0" step="0.01"
        name="maara" value="${rivi.maara || 1}" style="text-align:right" required />
      <select class="form-select col-unit" name="yksikko">
        <option ${(rivi.yksikko||'kpl')==='kpl' ? 'selected':''}>kpl</option>
        <option ${rivi.yksikko==='h'?'selected':''}>h</option>
        <option ${rivi.yksikko==='pv'?'selected':''}>pv</option>
        <option ${rivi.yksikko==='kk'?'selected':''}>kk</option>
      </select>
      <input class="form-input" type="number" placeholder="0,00" min="0" step="0.01"
        name="yksikkohinta" value="${rivi.yksikkohinta || ''}" style="text-align:right" required />
      <select class="form-select col-alv" name="alv_kanta">${alvOptions}</select>
      <div class="line-item-total" data-total>0,00 €</div>
      <button type="button" class="btn-remove-line" data-poista-rivi title="Poista rivi">
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
          <path d="M18 6L6 18M6 6l12 12"/>
        </svg>
      </button>
    </div>
  `
}

function lisaaRiviTapahtumankuuntelijat(rivi) {
  rivi.querySelectorAll('input').forEach(input => {
    input.addEventListener('input', paivitaYhteenveto)
  })
  rivi.querySelectorAll('select').forEach(sel => {
    sel.addEventListener('change', paivitaYhteenveto)
  })
  rivi.querySelector('[data-poista-rivi]')?.addEventListener('click', () => {
    const kaikki = document.querySelectorAll('.line-item-row')
    if (kaikki.length > 1) {
      rivi.remove()
      paivitaYhteenveto()
    }
  })
}

function paivitaYhteenveto() {
  const rivit = haeRiviData()
  const summat = laskeLaskuSummat(rivit)

  // Päivitä rivin oma total
  document.querySelectorAll('.line-item-row').forEach((riviEl, i) => {
    const r = rivit[i]
    if (!r) return
    const s = laskeRivi(r.maara || 0, r.yksikkohinta || 0, r.alv_kanta || 25.5)
    riviEl.querySelector('[data-total]').textContent = formatoiEuro(s.verollinenYhteensa)
  })

  const alvRivit = Object.entries(summat.alvErittely).map(([kanta, e]) => `
    <div class="totals-row">
      <span>ALV ${kanta} %</span>
      <span>${formatoiEuro(e.alv)}</span>
    </div>
  `).join('')

  document.getElementById('lasku-yhteenveto').innerHTML = `
    <div class="totals-row">
      <span>Yhteensä (veroton)</span>
      <span>${formatoiEuro(summat.verotonYhteensa)}</span>
    </div>
    ${alvRivit}
    <div class="totals-row grand-total">
      <span>Maksettava yhteensä</span>
      <span>${formatoiEuro(summat.verollinenYhteensa)}</span>
    </div>
  `
}

function haeRiviData() {
  return Array.from(document.querySelectorAll('.line-item-row')).map(rivi => ({
    kuvaus:      rivi.querySelector('[name="kuvaus"]')?.value || '',
    maara:       parseFloat(rivi.querySelector('[name="maara"]')?.value) || 0,
    yksikko:     rivi.querySelector('[name="yksikko"]')?.value || 'kpl',
    yksikkohinta: parseFloat(rivi.querySelector('[name="yksikkohinta"]')?.value) || 0,
    alv_kanta:   parseFloat(rivi.querySelector('[name="alv_kanta"]')?.value) || 25.5,
  }))
}

async function tallennaLaskuLomake(muokkausId) {
  const btn = document.getElementById('tallenna-lasku-btn')
  btn.disabled = true
  btn.textContent = 'Tallennetaan…'

  try {
    const asiakasId = document.getElementById('lasku-asiakas').value
    if (!asiakasId) {
      naytaToast('Valitse asiakas', 'error')
      return
    }

    const laskupaiva = document.getElementById('lasku-pvm').value
    const rivit = haeRiviData().filter(r => r.kuvaus && r.yksikkohinta)

    if (rivit.length === 0) {
      naytaToast('Lisää vähintään yksi laskurivi', 'error')
      return
    }

    const laskuData = {
      id: muokkausId || undefined,
      asiakas_id:  asiakasId,
      laskunumero: document.getElementById('lasku-numero').value,
      laskupaiva:  laskupaiva,
      erapaiva:    document.getElementById('lasku-erapaiva').value,
      tila:        document.getElementById('lasku-tila').value,
      lisatiedot:  document.getElementById('lasku-lisatiedot').value || null,
      viitenumero: laskeViitenumero(document.getElementById('lasku-numero').value.replace(/\D/g, '')),
    }

    await tallennaLasku(_kayttajaId, laskuData, rivit)
    naytaToast(muokkausId ? 'Lasku päivitetty!' : 'Lasku luotu!', 'success')
    navigoi('laskut')
  } catch (err) {
    naytaToast('Tallennus epäonnistui: ' + err.message, 'error')
  } finally {
    btn.disabled = false
    btn.textContent = muokkausId ? 'Tallenna muutokset' : 'Luo lasku'
  }
}
