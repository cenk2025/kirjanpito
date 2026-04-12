// ═══════════════════════════════════════════════════════
// KULUT — Expense tracking
// ═══════════════════════════════════════════════════════

import { haeKulut, tallennaKulu, poistaKulu } from '../utils/supabase.js'
import { formatoiEuro, formatoiPaiva, isoTanaan, KULU_KATEGORIAT } from '../utils/formatters.js'
import { ALV_KANNAT, eritteleALV } from '../utils/laskuri.js'
import {
  renderNakyma, asetaTopbarToiminnot, avaaModaali,
  suljeModaali, naytaToast, naytaVahvistus, tyhjaLista
} from './ui.js'

let _kayttajaId = null
let _kulut = []

export async function renderKulut(kayttajaId) {
  _kayttajaId = kayttajaId

  asetaTopbarToiminnot(`
    <button class="btn btn-primary btn-sm" id="uusi-kulu-btn">
      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5">
        <line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/>
      </svg>
      Kirjaa kulu
    </button>
  `)

  renderNakyma('<div class="loading-screen"><div class="spinner"></div></div>')

  try {
    _kulut = await haeKulut(kayttajaId)
    renderKuluLista()
  } catch (err) {
    renderNakyma(`<div class="alert alert-error">Kulujen lataus epäonnistui: ${err.message}</div>`)
  }
}

function renderKuluLista() {
  document.getElementById('uusi-kulu-btn')?.addEventListener('click', () => avaaKuluLomake())

  if (_kulut.length === 0) {
    renderNakyma(`
      <div class="section-header">
        <div><h1 class="section-title">Kulut</h1></div>
      </div>
      ${tyhjaLista('Ei kirjattuja kuluja', 'Kirjaa ensimmäinen kulusi verovähennysten seurantaa varten.', 'Kirjaa kulu', 'empty-uusi-kulu')}
    `)
    document.getElementById('empty-uusi-kulu')?.addEventListener('click', () => avaaKuluLomake())
    return
  }

  // Laske yhteenvedot
  const yhteensa = _kulut.reduce((s, k) => s + (parseFloat(k.summa) || 0), 0)
  const alvYhteensa = _kulut.reduce((s, k) => {
    if (!k.alv_kanta || k.alv_kanta === 0) return s
    const { alv } = eritteleALV(parseFloat(k.summa) || 0, k.alv_kanta)
    return s + alv
  }, 0)

  // Kategoriayhteenveto
  const kategoriat = {}
  for (const k of _kulut) {
    const kat = k.kategoria || 'Muut kulut'
    kategoriat[kat] = (kategoriat[kat] || 0) + (parseFloat(k.summa) || 0)
  }

  const katRivit = Object.entries(kategoriat)
    .sort(([, a], [, b]) => b - a)
    .map(([kat, summa]) => `
      <div style="display:flex;justify-content:space-between;padding:0.35rem 0;font-size:0.85rem;border-bottom:1px solid var(--border)">
        <span style="color:var(--text-2)">${kat}</span>
        <span>${formatoiEuro(summa)}</span>
      </div>
    `).join('')

  const vuosi = new Date().getFullYear()
  const kategoriaOptions = KULU_KATEGORIAT.map(k => `<option value="${k}">${k}</option>`).join('')

  const rivit = _kulut.map(k => {
    const veroton = k.alv_kanta ? eritteleALV(k.summa, k.alv_kanta).verotonHinta : k.summa
    return `
      <tr>
        <td>${formatoiPaiva(k.paiva)}</td>
        <td>
          <div style="font-weight:500">${k.kuvaus}</div>
          ${k.kuitin_numero ? `<div style="font-size:0.75rem;color:var(--text-3)">Kuitti: ${k.kuitin_numero}</div>` : ''}
        </td>
        <td><span class="badge badge-luonnos">${k.kategoria || 'Muut kulut'}</span></td>
        <td style="text-align:right">${formatoiEuro(veroton)}</td>
        <td style="text-align:right">${k.alv_kanta ? k.alv_kanta + ' %' : '—'}</td>
        <td style="text-align:right"><strong>${formatoiEuro(k.summa)}</strong></td>
        <td>
          <div class="table-actions">
            <button class="btn btn-ghost btn-sm" data-action="muokkaa" data-id="${k.id}" title="Muokkaa">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                <path d="M11 4H4a2 2 0 00-2 2v14a2 2 0 002 2h14a2 2 0 002-2v-7"/>
                <path d="M18.5 2.5a2.121 2.121 0 013 3L12 15l-4 1 1-4 9.5-9.5z"/>
              </svg>
            </button>
            <button class="btn btn-ghost btn-sm" data-action="poista" data-id="${k.id}" title="Poista">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                <polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14a2 2 0 01-2 2H8a2 2 0 01-2-2L5 6"/>
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
        <h1 class="section-title">Kulut</h1>
        <p class="section-sub">${_kulut.length} merkintää</p>
      </div>
    </div>

    <!-- Yhteenveto-kortit -->
    <div class="kpi-grid" style="margin-bottom:var(--s5)">
      <div class="kpi-card" style="--kpi-color:var(--red);--kpi-color-soft:var(--red-soft)">
        <div class="kpi-icon">
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <line x1="12" y1="1" x2="12" y2="23"/><path d="M17 5H9.5a3.5 3.5 0 000 7h5a3.5 3.5 0 010 7H6"/>
          </svg>
        </div>
        <div class="kpi-label">Kulut yhteensä</div>
        <div class="kpi-value">${formatoiEuro(yhteensa)}</div>
        <div class="kpi-change">Kaikki kirjatut kulut</div>
      </div>
      <div class="kpi-card" style="--kpi-color:var(--cyan);--kpi-color-soft:var(--cyan-soft)">
        <div class="kpi-icon">
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <rect x="2" y="3" width="20" height="14" rx="2"/><line x1="8" y1="21" x2="16" y2="21"/>
          </svg>
        </div>
        <div class="kpi-label">Ostojen ALV (vähennyskelpoinen)</div>
        <div class="kpi-value">${formatoiEuro(alvYhteensa)}</div>
        <div class="kpi-change">Vähennä myynti-ALV:stä</div>
      </div>
      <div class="kpi-card" style="--kpi-color:var(--lime);--kpi-color-soft:var(--lime-soft)">
        <div class="kpi-icon">
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z"/>
          </svg>
        </div>
        <div class="kpi-label">Kulukuitteja</div>
        <div class="kpi-value">${_kulut.length} kpl</div>
        <div class="kpi-change">Kirjattuja kuluja</div>
      </div>
    </div>

    <div style="display:grid;grid-template-columns:1fr 300px;gap:var(--s4);margin-bottom:var(--s4)">
      <div>
        <div class="filter-bar">
          <input class="form-input" type="search" id="kulu-haku" placeholder="Hae kuluista…" />
          <select class="form-select" id="kulu-kategoria-filter">
            <option value="">Kaikki kategoriat</option>
            ${KULU_KATEGORIAT.map(k => `<option value="${k}">${k}</option>`).join('')}
          </select>
          <select class="form-select" id="kulu-vuosi-filter">
            <option value="${vuosi}">${vuosi}</option>
            <option value="${vuosi - 1}">${vuosi - 1}</option>
          </select>
        </div>

        <div class="table-wrapper">
          <table class="table">
            <thead>
              <tr>
                <th>Päivä</th>
                <th>Kuvaus</th>
                <th>Kategoria</th>
                <th style="text-align:right">Veroton</th>
                <th style="text-align:right">ALV %</th>
                <th style="text-align:right">Yhteensä</th>
                <th></th>
              </tr>
            </thead>
            <tbody id="kulut-tbody">${rivit}</tbody>
            <tfoot>
              <tr>
                <td colspan="5" style="text-align:right;color:var(--text-2)">Yhteensä:</td>
                <td style="text-align:right"><strong>${formatoiEuro(yhteensa)}</strong></td>
                <td></td>
              </tr>
            </tfoot>
          </table>
        </div>
      </div>

      <!-- Kategoriapalkki -->
      <div class="card">
        <div class="card-title" style="margin-bottom:var(--s3)">Jakautuminen</div>
        ${katRivit}
      </div>
    </div>
  `)

  document.getElementById('kulut-tbody')?.addEventListener('click', async (e) => {
    const btn = e.target.closest('[data-action]')
    if (!btn) return
    const id = btn.dataset.id
    const kulu = _kulut.find(k => k.id === id)

    if (btn.dataset.action === 'muokkaa') {
      avaaKuluLomake(kulu)
    } else if (btn.dataset.action === 'poista') {
      const ok = await naytaVahvistus(`Haluatko poistaa kulun "${kulu?.kuvaus}"?`, 'Poista kulu')
      if (ok) {
        try {
          await poistaKulu(id)
          naytaToast('Kulu poistettu', 'success')
          _kulut = await haeKulut(_kayttajaId)
          renderKuluLista()
        } catch (err) {
          naytaToast('Poisto epäonnistui', 'error')
        }
      }
    }
  })

  let _kuluHakuTimer = null
  const suodataDebounced = () => {
    clearTimeout(_kuluHakuTimer)
    _kuluHakuTimer = setTimeout(suodataKulut, 150)
  }
  document.getElementById('kulu-haku')?.addEventListener('input', suodataDebounced)
  document.getElementById('kulu-kategoria-filter')?.addEventListener('change', suodataKulut)
}

function suodataKulut() {
  const haku = document.getElementById('kulu-haku')?.value.toLowerCase() || ''
  const kat = document.getElementById('kulu-kategoria-filter')?.value || ''
  document.querySelectorAll('#kulut-tbody tr').forEach(rivi => {
    const hakuOk = !haku || rivi.textContent.toLowerCase().includes(haku)
    const katOk = !kat || rivi.textContent.includes(kat)
    rivi.style.display = hakuOk && katOk ? '' : 'none'
  })
}

function avaaKuluLomake(kulu = null) {
  const otsikko = kulu ? 'Muokkaa kulua' : 'Kirjaa kulu'

  const kategoriaOptions = KULU_KATEGORIAT.map(k =>
    `<option value="${k}" ${kulu?.kategoria === k ? 'selected' : ''}>${k}</option>`
  ).join('')

  const alvOptions = ALV_KANNAT.map(k =>
    `<option value="${k.arvo}" ${(kulu?.alv_kanta ?? 25.5) == k.arvo ? 'selected' : ''}>${k.nimi}</option>`
  ).join('')

  const html = `
    <h2 class="modal-title">${otsikko}</h2>
    <form id="kulu-form">
      <div class="form-row">
        <div class="form-group">
          <label class="form-label">Päivämäärä *</label>
          <input class="form-input" type="date" id="k-paiva" value="${kulu?.paiva || isoTanaan()}" required />
        </div>
        <div class="form-group">
          <label class="form-label">Kategoria</label>
          <select class="form-select" id="k-kategoria">${kategoriaOptions}</select>
        </div>
      </div>

      <div class="form-group">
        <label class="form-label">Kuvaus *</label>
        <input class="form-input" type="text" id="k-kuvaus" value="${kulu?.kuvaus || ''}"
          placeholder="Esim. Toimistotarvikkeet, Puhelin, Matkakulut…" required />
      </div>

      <div class="form-row">
        <div class="form-group">
          <label class="form-label">Summa (ALV sis.) *</label>
          <input class="form-input" type="number" id="k-summa" value="${kulu?.summa || ''}"
            placeholder="0,00" min="0" step="0.01" required />
        </div>
        <div class="form-group">
          <label class="form-label">ALV-kanta</label>
          <select class="form-select" id="k-alv">${alvOptions}</select>
        </div>
      </div>

      <div id="k-veroton-naytto" class="alert alert-info" style="font-size:0.85rem;margin-bottom:var(--s3)">
        Veroton osuus: lasketaan automaattisesti
      </div>

      <div class="form-group">
        <label class="form-label">Kuitin numero</label>
        <input class="form-input" type="text" id="k-kuitti" value="${kulu?.kuitin_numero || ''}"
          placeholder="Vapaaehtoinen kuitin tai tositteen numero" />
      </div>

      <div id="kulu-virhe" class="alert alert-error hidden"></div>

      <div class="modal-footer">
        <button type="button" class="btn btn-secondary" id="peruuta-kulu">Peruuta</button>
        <button type="submit" class="btn btn-primary">Tallenna</button>
      </div>
    </form>
  `

  avaaModaali(html)

  document.getElementById('peruuta-kulu')?.addEventListener('click', suljeModaali)

  // Live veroton-näyttö
  const paivitaVeroton = () => {
    const summa = parseFloat(document.getElementById('k-summa')?.value) || 0
    const alv = parseFloat(document.getElementById('k-alv')?.value) || 0
    const el = document.getElementById('k-veroton-naytto')
    if (!el) return
    if (alv === 0) {
      el.textContent = 'ALV 0 % — koko summa verotonta'
    } else {
      const { verotonHinta, alv: alvSumma } = eritteleALV(summa, alv)
      el.textContent = `Veroton: ${formatoiEuro(verotonHinta)} | ALV ${alv}%: ${formatoiEuro(alvSumma)}`
    }
  }

  document.getElementById('k-summa')?.addEventListener('input', paivitaVeroton)
  document.getElementById('k-alv')?.addEventListener('change', paivitaVeroton)
  paivitaVeroton()

  document.getElementById('kulu-form')?.addEventListener('submit', async (e) => {
    e.preventDefault()
    const virheEl = document.getElementById('kulu-virhe')
    virheEl.classList.add('hidden')

    const data = {
      id:            kulu?.id || undefined,
      paiva:         document.getElementById('k-paiva').value,
      kuvaus:        document.getElementById('k-kuvaus').value.trim(),
      summa:         parseFloat(document.getElementById('k-summa').value),
      alv_kanta:     parseFloat(document.getElementById('k-alv').value),
      kategoria:     document.getElementById('k-kategoria').value,
      kuitin_numero: document.getElementById('k-kuitti').value.trim() || null,
    }

    try {
      await tallennaKulu(_kayttajaId, data)
      suljeModaali()
      naytaToast(kulu ? 'Kulu päivitetty!' : 'Kulu kirjattu!', 'success')
      _kulut = await haeKulut(_kayttajaId)
      renderKuluLista()
    } catch (err) {
      virheEl.textContent = 'Tallennus epäonnistui: ' + err.message
      virheEl.classList.remove('hidden')
    }
  })
}
