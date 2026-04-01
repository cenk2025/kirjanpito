// ═══════════════════════════════════════════════════════
// RAPORTIT — Tax & financial reports
// ═══════════════════════════════════════════════════════

import { haeLaskut, haeKulut } from '../utils/supabase.js'
import { laskeLaskuSummat, haeALVKaudet } from '../utils/laskuri.js'
import { eritteleALV } from '../utils/laskuri.js'
import { formatoiEuro, formatoiPaiva, KUUKAUDET, onMyohassa } from '../utils/formatters.js'
import { renderNakyma, asetaTopbarToiminnot, naytaToast } from './ui.js'

let _kayttajaId = null

export async function renderRaportit(kayttajaId) {
  _kayttajaId = kayttajaId
  asetaTopbarToiminnot('')

  const vuosi = new Date().getFullYear()
  renderNakyma('<div class="loading-screen"><div class="spinner"></div></div>')

  try {
    const [laskut, kulut] = await Promise.all([
      haeLaskut(kayttajaId),
      haeKulut(kayttajaId),
    ])
    renderRaportitHTML(laskut, kulut, vuosi)
  } catch (err) {
    renderNakyma(`<div class="alert alert-error">Raporttien lataus epäonnistui: ${err.message}</div>`)
  }
}

function renderRaportitHTML(laskut, kulut, vuosi) {
  renderNakyma(`
    <div class="section-header">
      <div>
        <h1 class="section-title">Raportit</h1>
        <p class="section-sub">Veroraportointi ja kirjanpitotiivistelmät</p>
      </div>
    </div>

    <div class="period-selector" style="margin-bottom:var(--s5)">
      <button class="period-btn active" data-vuosi="${vuosi}">${vuosi}</button>
      <button class="period-btn" data-vuosi="${vuosi - 1}">${vuosi - 1}</button>
    </div>

    <div id="raportti-sisalto">
      <!-- Ladataan -->
    </div>
  `)

  renderRapottiSisalto(laskut, kulut, vuosi)

  document.querySelectorAll('.period-btn').forEach(btn => {
    btn.addEventListener('click', async (e) => {
      document.querySelectorAll('.period-btn').forEach(b => b.classList.remove('active'))
      e.target.classList.add('active')
      const v = parseInt(e.target.dataset.vuosi)
      document.getElementById('raportti-sisalto').innerHTML = '<div class="loading-screen"><div class="spinner"></div></div>'
      try {
        const [uudetLaskut, uudetKulut] = await Promise.all([
          haeLaskut(_kayttajaId),
          haeKulut(_kayttajaId),
        ])
        renderRapottiSisalto(uudetLaskut, uudetKulut, v)
      } catch (err) {
        naytaToast('Lataus epäonnistui', 'error')
      }
    })
  })
}

function renderRapottiSisalto(kaikkilaskut, kaikkirkulut, vuosi) {
  const v = String(vuosi)
  const laskut = kaikkilaskut.filter(l => l.laskupaiva?.startsWith(v))
  const kulut = kaikkirkulut.filter(k => k.paiva?.startsWith(v))

  // ─── Liikevaihto & ALV yhteenveto ─────────────────────
  let liikevaihtoVeroton = 0
  let alvKertymaMyynti = {}  // per kanta
  let maksettuYhteensa = 0

  for (const lasku of laskut) {
    if (!['lahetetty', 'maksettu'].includes(lasku.tila)) continue
    const summat = laskeLaskuSummat(lasku.rivit || [])
    liikevaihtoVeroton += summat.verotonYhteensa
    for (const [kanta, e] of Object.entries(summat.alvErittely)) {
      if (!alvKertymaMyynti[kanta]) alvKertymaMyynti[kanta] = { veroton: 0, alv: 0 }
      alvKertymaMyynti[kanta].veroton += e.veroton
      alvKertymaMyynti[kanta].alv += e.alv
    }
    if (lasku.tila === 'maksettu') {
      maksettuYhteensa += summat.verollinenYhteensa
    }
  }

  // Ostojen ALV (vähennetään)
  let alvOstot = 0
  let kulutVeroton = 0
  for (const k of kulut) {
    const summa = parseFloat(k.summa) || 0
    if (k.alv_kanta && k.alv_kanta > 0) {
      const { alv, verotonHinta } = eritteleALV(summa, k.alv_kanta)
      alvOstot += alv
      kulutVeroton += verotonHinta
    } else {
      kulutVeroton += summa
    }
  }

  const alvMaksettava = Object.values(alvKertymaMyynti).reduce((s, e) => s + e.alv, 0) - alvOstot
  const kulutYhteensa = kulut.reduce((s, k) => s + (parseFloat(k.summa) || 0), 0)

  // ─── Kvartaalidata ─────────────────────────────────────
  const kvartaalit = [
    { nimi: 'Q1', kk: [1,2,3] },
    { nimi: 'Q2', kk: [4,5,6] },
    { nimi: 'Q3', kk: [7,8,9] },
    { nimi: 'Q4', kk: [10,11,12] },
  ]

  const kvartaaliHTML = kvartaalit.map(q => {
    let qVeroton = 0, qAlv = 0, qKulut = 0
    for (const lasku of laskut) {
      const kk = new Date(lasku.laskupaiva).getMonth() + 1
      if (!q.kk.includes(kk)) continue
      if (!['lahetetty', 'maksettu'].includes(lasku.tila)) continue
      const summat = laskeLaskuSummat(lasku.rivit || [])
      qVeroton += summat.verotonYhteensa
      for (const e of Object.values(summat.alvErittely)) qAlv += e.alv
    }
    for (const k of kulut) {
      const kk = new Date(k.paiva).getMonth() + 1
      if (!q.kk.includes(kk)) continue
      qKulut += parseFloat(k.summa) || 0
    }
    const qAlvVahennys = kulut.filter(k => {
      const kk = new Date(k.paiva).getMonth() + 1
      return q.kk.includes(kk) && k.alv_kanta > 0
    }).reduce((s, k) => s + eritteleALV(parseFloat(k.summa)||0, k.alv_kanta).alv, 0)
    const nettoAlv = qAlv - qAlvVahennys

    return `
      <div class="card">
        <div style="font-size:0.75rem;color:var(--text-3);text-transform:uppercase;letter-spacing:0.05em;margin-bottom:var(--s2)">${q.nimi} — ${q.kk.map(k => KUUKAUDET[k-1]).join('–')}</div>
        <div class="yel-row"><span>Liikevaihto (veroton)</span><strong>${formatoiEuro(qVeroton)}</strong></div>
        <div class="yel-row"><span>Myynti-ALV</span><strong>${formatoiEuro(qAlv)}</strong></div>
        <div class="yel-row"><span>Ostot (ALV)</span><strong style="color:var(--green)">−${formatoiEuro(qAlvVahennys)}</strong></div>
        <div class="yel-row" style="margin-top:var(--s2)"><span>ALV maksettava</span><strong style="color:${nettoAlv >= 0 ? 'var(--amber)' : 'var(--green)'}">${formatoiEuro(nettoAlv)}</strong></div>
        <div style="margin-top:var(--s2)">
          <button class="btn btn-ghost btn-sm" onclick="window.print()" style="font-size:0.78rem">
            Tulosta kvartaali
          </button>
        </div>
      </div>
    `
  }).join('')

  // ─── Kuukausikohtainen taulukko ─────────────────────────
  const kuukausiData = Array.from({ length: 12 }, (_, i) => {
    const kk = i + 1
    const kkStr = String(kk).padStart(2, '0')
    const prefix = `${vuosi}-${kkStr}`

    const kkLaskut = laskut.filter(l =>
      l.laskupaiva?.startsWith(prefix) && ['lahetetty', 'maksettu'].includes(l.tila)
    )
    const kkKulut = kulut.filter(k => k.paiva?.startsWith(prefix))

    let veroton = 0, alv = 0
    for (const l of kkLaskut) {
      const s = laskeLaskuSummat(l.rivit || [])
      veroton += s.verotonYhteensa
      for (const e of Object.values(s.alvErittely)) alv += e.alv
    }
    const kuluSumma = kkKulut.reduce((s, k) => s + (parseFloat(k.summa)||0), 0)

    return { kk, nimi: KUUKAUDET[i], veroton, alv, kulut: kuluSumma }
  })

  const kuukausiHTML = kuukausiData.map(k => `
    <tr>
      <td>${k.nimi}</td>
      <td style="text-align:right">${formatoiEuro(k.veroton)}</td>
      <td style="text-align:right">${formatoiEuro(k.alv)}</td>
      <td style="text-align:right">${formatoiEuro(k.kulut)}</td>
      <td style="text-align:right;font-weight:600;color:${k.veroton - k.kulut >= 0 ? 'var(--lime)' : 'var(--red)'}">
        ${formatoiEuro(k.veroton - k.kulut)}
      </td>
    </tr>
  `).join('')

  // ─── ALV-erittely ──────────────────────────────────────
  const alvErittelyHTML = Object.entries(alvKertymaMyynti).map(([kanta, e]) => `
    <div class="yel-row">
      <span>Myynti ALV ${kanta} %</span>
      <strong>${formatoiEuro(e.alv)}</strong>
    </div>
    <div class="yel-row" style="padding-left:var(--s3)">
      <span style="color:var(--text-3)">Veroton myynti</span>
      <span style="color:var(--text-2)">${formatoiEuro(e.veroton)}</span>
    </div>
  `).join('') || '<div style="color:var(--text-3);font-size:0.875rem">Ei ALV-myyntiä tällä kaudella</div>'

  document.getElementById('raportti-sisalto').innerHTML = `
    <!-- Vuosiyhteveto KPI -->
    <div class="kpi-grid" style="margin-bottom:var(--s5)">
      <div class="kpi-card" style="--kpi-color:var(--lime);--kpi-color-soft:var(--lime-soft)">
        <div class="kpi-label">Liikevaihto ${vuosi} (veroton)</div>
        <div class="kpi-value">${formatoiEuro(liikevaihtoVeroton)}</div>
      </div>
      <div class="kpi-card" style="--kpi-color:var(--red);--kpi-color-soft:var(--red-soft)">
        <div class="kpi-label">Kulut yhteensä</div>
        <div class="kpi-value">${formatoiEuro(kulutYhteensa)}</div>
      </div>
      <div class="kpi-card" style="--kpi-color:var(--amber);--kpi-color-soft:var(--amber-soft)">
        <div class="kpi-label">ALV netto (maksettava)</div>
        <div class="kpi-value">${formatoiEuro(alvMaksettava)}</div>
      </div>
      <div class="kpi-card" style="--kpi-color:var(--cyan);--kpi-color-soft:var(--cyan-soft)">
        <div class="kpi-label">Kate (veroton)</div>
        <div class="kpi-value">${formatoiEuro(liikevaihtoVeroton - kulutVeroton)}</div>
      </div>
    </div>

    <!-- ALV-raportti (Verohallinnolle) -->
    <div class="settings-section" style="margin-bottom:var(--s4)">
      <h2 class="settings-section-title">
        ALV-raportti ${vuosi}
        <button class="btn btn-ghost btn-sm" onclick="window.print()" style="float:right;margin-top:-4px">Tulosta raportti</button>
      </h2>
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:var(--s6)">
        <div>
          <h3 style="font-size:0.9rem;font-weight:700;margin-bottom:var(--s3);color:var(--text-2)">Myynti-ALV eriteltynä</h3>
          ${alvErittelyHTML}
        </div>
        <div>
          <h3 style="font-size:0.9rem;font-weight:700;margin-bottom:var(--s3);color:var(--text-2)">Yhteenveto</h3>
          <div class="yel-row"><span>Myynti-ALV yhteensä</span><strong>${formatoiEuro(Object.values(alvKertymaMyynti).reduce((s,e)=>s+e.alv,0))}</strong></div>
          <div class="yel-row"><span>Ostojen ALV (vähennys)</span><strong style="color:var(--green)">−${formatoiEuro(alvOstot)}</strong></div>
          <div class="yel-row" style="margin-top:var(--s2);border-top:2px solid var(--border-2);padding-top:var(--s2)">
            <span style="font-weight:700">Maksettava ALV</span>
            <strong style="font-size:1.1rem;color:${alvMaksettava >= 0 ? 'var(--amber)' : 'var(--green)'}">${formatoiEuro(alvMaksettava)}</strong>
          </div>
        </div>
      </div>
    </div>

    <!-- Kvartaaliraportit -->
    <div class="settings-section" style="margin-bottom:var(--s4)">
      <h2 class="settings-section-title">Kvartaaliraportit ${vuosi}</h2>
      <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(220px,1fr));gap:var(--s3)">
        ${kvartaaliHTML}
      </div>
    </div>

    <!-- Kuukausikohtainen taulukko -->
    <div class="settings-section">
      <h2 class="settings-section-title">Kuukausittainen erittely ${vuosi}</h2>
      <div class="table-wrapper">
        <table class="table">
          <thead>
            <tr>
              <th>Kuukausi</th>
              <th style="text-align:right">Liikevaihto (veroton)</th>
              <th style="text-align:right">Myynti-ALV</th>
              <th style="text-align:right">Kulut (brutto)</th>
              <th style="text-align:right">Kate</th>
            </tr>
          </thead>
          <tbody>${kuukausiHTML}</tbody>
          <tfoot>
            <tr>
              <td>Yhteensä</td>
              <td style="text-align:right">${formatoiEuro(liikevaihtoVeroton)}</td>
              <td style="text-align:right">${formatoiEuro(Object.values(alvKertymaMyynti).reduce((s,e)=>s+e.alv,0))}</td>
              <td style="text-align:right">${formatoiEuro(kulutYhteensa)}</td>
              <td style="text-align:right">${formatoiEuro(liikevaihtoVeroton - kulutVeroton)}</td>
            </tr>
          </tfoot>
        </table>
      </div>
    </div>
  `
}
