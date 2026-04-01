// ═══════════════════════════════════════════════════════
// DASHBOARD — Kojelauta
// ═══════════════════════════════════════════════════════

import { haeLaskut, haeKulut, haeProfiili } from '../utils/supabase.js'
import { formatoiEuro, formatoiPaiva, tilaHTML, KUUKAUDET_LYHYT, onMyohassa } from '../utils/formatters.js'
import { laskeLaskuSummat } from '../utils/laskuri.js'
import { renderNakyma, asetaTopbarToiminnot, naytaToast } from './ui.js'
import { navigoi } from './router.js'

export async function renderKojelauta(kayttajaId) {
  renderNakyma('<div class="loading-screen"><div class="spinner"></div></div>')
  asetaTopbarToiminnot('')

  try {
    const [laskut, kulut] = await Promise.all([
      haeLaskut(kayttajaId),
      haeKulut(kayttajaId),
    ])

    const vuosi = new Date().getFullYear()
    const stats = laskeKojelautaStats(laskut, kulut, vuosi)

    renderNakyma(rakennaDashboardHTML(stats, laskut, vuosi))
    lisaaKojelautaTapahtumankuuntelijat()
  } catch (err) {
    console.error('Dashboard virhe:', err)
    renderNakyma(`<div class="alert alert-error">Kojelaudan lataus epäonnistui: ${err.message}</div>`)
  }
}

// ─── Tilastolaskenta ───────────────────────────────────

function laskeKojelautaStats(laskut, kulut, vuosi) {
  const tanaanISO = new Date().toISOString().split('T')[0]
  const vuosiAlku = `${vuosi}-01-01`
  const vuosiLoppu = `${vuosi}-12-31`

  // Suodata kuluvan vuoden laskut
  const vuodenLaskut = laskut.filter(l =>
    l.laskupaiva >= vuosiAlku && l.laskupaiva <= vuosiLoppu
  )

  // Liikevaihto (lähetetyt + maksetut, veroton)
  let liikevaihtoVeroton = 0
  let liikevaihtoVerollinen = 0
  let alvVelka = 0

  for (const lasku of vuodenLaskut) {
    if (!['lahetetty', 'maksettu'].includes(lasku.tila)) continue
    const rivit = lasku.rivit || []
    const summat = laskeLaskuSummat(rivit)
    liikevaihtoVeroton += summat.verotonYhteensa
    liikevaihtoVerollinen += summat.verollinenYhteensa
    for (const [, erittely] of Object.entries(summat.alvErittely)) {
      alvVelka += erittely.alv
    }
  }

  // Maksetut laskut
  const maksetutLaskut = vuodenLaskut.filter(l => l.tila === 'maksettu')
  let maksettuYhteensa = 0
  for (const lasku of maksetutLaskut) {
    const rivit = lasku.rivit || []
    const summat = laskeLaskuSummat(rivit)
    maksettuYhteensa += summat.verollinenYhteensa
  }

  // Myöhässä olevat
  const myohassaLaskut = laskut.filter(l =>
    l.tila === 'lahetetty' && onMyohassa(l.erapaiva, l.tila)
  )
  let myohassaSumma = 0
  for (const lasku of myohassaLaskut) {
    const rivit = lasku.rivit || []
    myohassaSumma += laskeLaskuSummat(rivit).verollinenYhteensa
  }

  // Kulut yhteensä
  const vuodenKulut = kulut.filter(k =>
    k.paiva >= vuosiAlku && k.paiva <= vuosiLoppu
  )
  const kulutYhteensa = vuodenKulut.reduce((s, k) => s + (k.summa || 0), 0)

  // Kuukausidata
  const kuukausiData = Array.from({ length: 12 }, (_, i) => ({
    kuukausi: i,
    liikevaihto: 0,
    nimi: KUUKAUDET_LYHYT[i]
  }))

  for (const lasku of vuodenLaskut) {
    if (!['lahetetty', 'maksettu'].includes(lasku.tila)) continue
    const kk = new Date(lasku.laskupaiva).getMonth()
    const summat = laskeLaskuSummat(lasku.rivit || [])
    kuukausiData[kk].liikevaihto += summat.verotonYhteensa
  }

  // Viimeisimmät laskut
  const viimeisimmatLaskut = [...laskut].slice(0, 8)

  return {
    liikevaihtoVeroton,
    liikevaihtoVerollinen,
    maksettuYhteensa,
    alvVelka,
    kulutYhteensa,
    myohassaLaskujenMaara: myohassaLaskut.length,
    myohassaSumma,
    kuukausiData,
    viimeisimmatLaskut,
    vuosi,
  }
}

// ─── HTML rakentaminen ─────────────────────────────────

function rakennaDashboardHTML(stats, laskut, vuosi) {
  const maxLiikevaihto = Math.max(...stats.kuukausiData.map(k => k.liikevaihto), 1)
  const nykyinenKuukausi = new Date().getMonth()

  const palkit = stats.kuukausiData.map((k, i) => {
    const korkeus = Math.max((k.liikevaihto / maxLiikevaihto) * 100, 2)
    return `
      <div class="chart-bar-wrap" title="${k.nimi}: ${formatoiEuro(k.liikevaihto)}">
        <div class="chart-bar${i === nykyinenKuukausi ? ' current' : ''}"
             style="height:${korkeus}%"></div>
        <div class="chart-label">${k.nimi}</div>
      </div>
    `
  }).join('')

  const laskuRivit = stats.viimeisimmatLaskut.length === 0
    ? `<tr><td colspan="5" style="text-align:center;color:var(--text-3);padding:2rem">Ei laskuja</td></tr>`
    : stats.viimeisimmatLaskut.map(l => {
        const rivit = l.rivit || []
        const summat = laskeLaskuSummat(rivit)
        const efektiivinenTila = onMyohassa(l.erapaiva, l.tila) ? 'myohassa' : l.tila
        const tilaEl = tilaHTML(efektiivinenTila, l.erapaiva)
        const asiakasNimi = l.asiakas?.nimi || '—'
        return `
          <tr style="cursor:pointer" data-lasku-id="${l.id}">
            <td><strong>${l.laskunumero}</strong></td>
            <td>${asiakasNimi}</td>
            <td>${formatoiPaiva(l.erapaiva)}</td>
            <td><strong>${formatoiEuro(summat.verollinenYhteensa)}</strong></td>
            <td>${tilaEl}</td>
          </tr>
        `
      }).join('')

  return `
    <!-- KPI-ruudukko -->
    <div class="kpi-grid">
      <div class="kpi-card" style="--kpi-color:var(--lime);--kpi-color-soft:var(--lime-soft)">
        <div class="kpi-icon">
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <polyline points="23 6 13.5 15.5 8.5 10.5 1 18"/><polyline points="17 6 23 6 23 12"/>
          </svg>
        </div>
        <div class="kpi-label">Liikevaihto ${vuosi} (veroton)</div>
        <div class="kpi-value">${formatoiEuro(stats.liikevaihtoVeroton)}</div>
        <div class="kpi-change">Verollinen: ${formatoiEuro(stats.liikevaihtoVerollinen)}</div>
      </div>

      <div class="kpi-card" style="--kpi-color:var(--green);--kpi-color-soft:var(--green-soft)">
        <div class="kpi-icon">
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <path d="M12 1v22M17 5H9.5a3.5 3.5 0 000 7h5a3.5 3.5 0 010 7H6"/>
          </svg>
        </div>
        <div class="kpi-label">Maksettu ${vuosi}</div>
        <div class="kpi-value">${formatoiEuro(stats.maksettuYhteensa)}</div>
        <div class="kpi-change">Saapuneet maksut</div>
      </div>

      <div class="kpi-card" style="--kpi-color:var(--amber);--kpi-color-soft:var(--amber-soft)">
        <div class="kpi-icon">
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <rect x="2" y="3" width="20" height="14" rx="2"/><line x1="8" y1="21" x2="16" y2="21"/><line x1="12" y1="17" x2="12" y2="21"/>
          </svg>
        </div>
        <div class="kpi-label">ALV-velka ${vuosi}</div>
        <div class="kpi-value">${formatoiEuro(stats.alvVelka)}</div>
        <div class="kpi-change">Maksettava Verohallinnolle</div>
      </div>

      <div class="kpi-card" style="--kpi-color:${stats.myohassaLaskujenMaara > 0 ? 'var(--red)' : 'var(--cyan)'};--kpi-color-soft:${stats.myohassaLaskujenMaara > 0 ? 'var(--red-soft)' : 'var(--cyan-soft)'}">
        <div class="kpi-icon">
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/>
          </svg>
        </div>
        <div class="kpi-label">Myöhässä olevat</div>
        <div class="kpi-value">${stats.myohassaLaskujenMaara} kpl</div>
        <div class="kpi-change">${formatoiEuro(stats.myohassaSumma)} maksamatta</div>
      </div>
    </div>

    <!-- Pääruudukko: kaavio + viimeisimmät laskut -->
    <div class="dashboard-grid">
      <div class="dashboard-main">
        <!-- Kuukausittainen liikevaihto -->
        <div class="card" style="margin-bottom:var(--s4)">
          <div class="card-header">
            <div>
              <div class="card-title">Kuukausittainen liikevaihto</div>
              <div class="card-subtitle">${vuosi} — veroton</div>
            </div>
          </div>
          <div class="chart-bars">${palkit}</div>
        </div>

        <!-- Viimeisimmät laskut -->
        <div class="card">
          <div class="card-header">
            <div class="card-title">Viimeisimmät laskut</div>
            <a href="#laskut" class="btn btn-ghost btn-sm">Näytä kaikki</a>
          </div>
          <div class="table-wrapper">
            <table class="table">
              <thead>
                <tr>
                  <th>Numero</th>
                  <th>Asiakas</th>
                  <th>Eräpäivä</th>
                  <th>Summa</th>
                  <th>Tila</th>
                </tr>
              </thead>
              <tbody id="dashboard-laskut">${laskuRivit}</tbody>
            </table>
          </div>
        </div>
      </div>

      <!-- Sivupalkki -->
      <div class="dashboard-side">
        <!-- Kulut -->
        <div class="card" style="margin-bottom:var(--s4)">
          <div class="card-header">
            <div class="card-title">Kulut ${vuosi}</div>
            <a href="#kulut" class="btn btn-ghost btn-sm">Näytä</a>
          </div>
          <div style="font-family:var(--font-display);font-size:1.8rem;font-weight:800;color:var(--red);margin-bottom:var(--s2)">
            ${formatoiEuro(stats.kulutYhteensa)}
          </div>
          <div style="font-size:0.85rem;color:var(--text-2)">Kirjatut kulut yhteensä</div>
        </div>

        <!-- Nettotulos -->
        <div class="card" style="margin-bottom:var(--s4)">
          <div class="card-header">
            <div class="card-title">Arvioitu kate</div>
          </div>
          <div style="font-family:var(--font-display);font-size:1.8rem;font-weight:800;color:${stats.liikevaihtoVeroton - stats.kulutYhteensa >= 0 ? 'var(--lime)' : 'var(--red)'};margin-bottom:var(--s2)">
            ${formatoiEuro(stats.liikevaihtoVeroton - stats.kulutYhteensa)}
          </div>
          <div style="font-size:0.85rem;color:var(--text-2)">Liikevaihto − kulut (veroton)</div>
        </div>

        <!-- Pikaohjeet -->
        <div class="card">
          <div class="card-title" style="margin-bottom:var(--s3)">Pikatoiminnot</div>
          <div style="display:flex;flex-direction:column;gap:var(--s2)">
            <button class="btn btn-primary" id="dash-uusi-lasku">
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>
              Uusi lasku
            </button>
            <button class="btn btn-secondary" id="dash-lisaa-kulu">
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>
              Kirjaa kulu
            </button>
            <a href="#raportit" class="btn btn-ghost">
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="22 12 18 12 15 21 9 3 6 12 2 12"/></svg>
              Raportit
            </a>
          </div>
        </div>
      </div>
    </div>
  `
}

function lisaaKojelautaTapahtumankuuntelijat() {
  // Laskurivit → avaa lasku
  document.getElementById('dashboard-laskut')?.addEventListener('click', (e) => {
    const rivi = e.target.closest('tr[data-lasku-id]')
    if (rivi) navigoi(`laskut/${rivi.dataset.laskuId}`)
  })

  // Pikatoiminnot
  document.getElementById('dash-uusi-lasku')?.addEventListener('click', () => {
    navigoi('laskut/uusi')
  })
  document.getElementById('dash-lisaa-kulu')?.addEventListener('click', () => {
    navigoi('kulut')
  })
}
