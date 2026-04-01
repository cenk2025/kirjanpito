// ═══════════════════════════════════════════════════════
// VEROLASKELMA — Tax calculator
// ═══════════════════════════════════════════════════════

import { haeProfiili } from '../utils/supabase.js'
import {
  laskeYEL, laskeArviolinenTulovero,
  YEL_RAJAT, YEL_PROSENTIT, haeALVKaudet
} from '../utils/laskuri.js'
import { formatoiEuro, formatoiProsentti } from '../utils/formatters.js'
import { renderNakyma, asetaTopbarToiminnot, naytaToast } from './ui.js'

let _kayttajaId = null
let _profiili = null

export async function renderVerolaskelma(kayttajaId) {
  _kayttajaId = kayttajaId
  asetaTopbarToiminnot('')
  renderNakyma('<div class="loading-screen"><div class="spinner"></div></div>')

  try {
    _profiili = await haeProfiili(kayttajaId)
    renderVerolaskelmaHTML()
  } catch (err) {
    renderNakyma(`<div class="alert alert-error">Virhe: ${err.message}</div>`)
  }
}

function renderVerolaskelmaHTML() {
  const yelTyotulo = _profiili?.yel_tyotulo || 40000
  const ika = _profiili?.ika || 40
  const uusiYrittaja = _profiili?.uusi_yrittaja || false
  const kunnallisVero = _profiili?.kunnallisvero || 21.5
  const vuosi = new Date().getFullYear()
  const alvKaudet = haeALVKaudet(vuosi)

  const yel = laskeYEL(yelTyotulo, ika, uusiYrittaja)
  const tulo = laskeArviolinenTulovero(yelTyotulo, kunnallisVero)

  renderNakyma(`
    <div class="section-header">
      <div>
        <h1 class="section-title">Verolaskelma</h1>
        <p class="section-sub">Arviot perustuvat ${vuosi} verotaulukoihin</p>
      </div>
    </div>

    <div class="alert alert-warning" style="margin-bottom:var(--s5)">
      <strong>Huomio:</strong> Nämä ovat likimääräisiä arvioita. Tarkat verot vahvistaa Verohallinto. Konsultoi kirjanpitäjääsi.
    </div>

    <!-- YEL-laskelma -->
    <div class="settings-section" style="margin-bottom:var(--s4)">
      <h2 class="settings-section-title">YEL — Yrittäjän eläkevakuutus</h2>

      <div style="display:grid;grid-template-columns:1fr 1fr;gap:var(--s6)">
        <div>
          <div class="form-group">
            <label class="form-label">YEL-työtulo (€/vuosi)</label>
            <input class="form-input" type="number" id="yel-tyotulo" value="${yelTyotulo}"
              min="${YEL_RAJAT.MIN}" max="${YEL_RAJAT.MAX}" step="100" />
            <div class="form-hint">
              Minimi: ${formatoiEuro(YEL_RAJAT.MIN)} — Maksimi: ${formatoiEuro(YEL_RAJAT.MAX)}
            </div>
          </div>
          <div class="form-group">
            <label class="form-label">Ikä</label>
            <input class="form-input" type="number" id="yel-ika" value="${ika}" min="18" max="70" />
            <div class="form-hint">53–62-vuotiaille korkeampi maksu (${YEL_PROSENTIT.KESKI} %)</div>
          </div>
          <div class="form-group">
            <label class="form-label">Uusi yrittäjä (alle 4 vuotta)</label>
            <select class="form-select" id="yel-uusi">
              <option value="ei" ${!uusiYrittaja ? 'selected' : ''}>Ei</option>
              <option value="kylla" ${uusiYrittaja ? 'selected' : ''}>Kyllä (22 % alennus)</option>
            </select>
          </div>
          <button class="btn btn-primary" id="laske-yel-btn">Laske YEL</button>
        </div>

        <div id="yel-tulos" class="yel-result">
          <div style="font-size:0.75rem;color:var(--lime);text-transform:uppercase;letter-spacing:0.05em;margin-bottom:var(--s3)">YEL-laskelma</div>
          <div class="yel-row"><span>YEL-työtulo</span><strong>${formatoiEuro(yelTyotulo)} / vuosi</strong></div>
          <div class="yel-row"><span>YEL-prosentti</span><strong>${formatoiProsentti(yel.prosentti)}</strong></div>
          ${uusiYrittaja ? '<div class="yel-row"><span>Uuden yrittäjän alennus</span><strong style="color:var(--green)">−22 %</strong></div>' : ''}
          <div class="yel-row"><span>Maksu / kuukausi</span><strong>${formatoiEuro(yel.kuukausimaksu)}</strong></div>
          <div class="yel-row" style="margin-top:var(--s2);padding-top:var(--s2)"><span>Maksu / vuosi</span><strong style="font-size:1.1rem">${formatoiEuro(yel.vuosimaksu)}</strong></div>
        </div>
      </div>
    </div>

    <!-- Tuloveroarvio -->
    <div class="settings-section" style="margin-bottom:var(--s4)">
      <h2 class="settings-section-title">Arvioitu tulovero ${vuosi}</h2>

      <div style="display:grid;grid-template-columns:1fr 1fr;gap:var(--s6)">
        <div>
          <div class="form-group">
            <label class="form-label">Verotettava tulo (€/vuosi)</label>
            <input class="form-input" type="number" id="tv-tulo" value="${yelTyotulo}" step="100" />
            <div class="form-hint">Tulo ennen verovähennyksiä (YEL-työtulo tai liikevaihto)</div>
          </div>
          <div class="form-group">
            <label class="form-label">Kunnallisvero % (paikkakunnittain)</label>
            <input class="form-input" type="number" id="tv-kunnallis" value="${kunnallisVero}" min="16" max="25" step="0.5" />
            <div class="form-hint">Tarkista oma kunnallisvero: vero.fi</div>
          </div>
          <button class="btn btn-primary" id="laske-tv-btn">Laske veroarvio</button>
        </div>

        <div id="tv-tulos" class="yel-result" style="background:var(--cyan-soft);border-color:var(--cyan-border)">
          <div style="font-size:0.75rem;color:var(--cyan);text-transform:uppercase;letter-spacing:0.05em;margin-bottom:var(--s3)">Tuloveroarvio</div>
          <div class="yel-row"><span>Verotettava tulo</span><strong>${formatoiEuro(yelTyotulo)} / vuosi</strong></div>
          <div class="yel-row"><span>Valtionvero</span><strong>${formatoiEuro(tulo.valtionvero)}</strong></div>
          <div class="yel-row"><span>Kunnallisvero (${kunnallisVero} %)</span><strong>${formatoiEuro(tulo.kunnallisvero)}</strong></div>
          <div class="yel-row" style="margin-top:var(--s2);padding-top:var(--s2)"><span>Verot yhteensä</span><strong style="font-size:1.1rem">${formatoiEuro(tulo.yhteensa)}</strong></div>
          <div class="yel-row"><span>Efektiivinen veroprosentti</span><strong style="color:var(--cyan)">${formatoiProsentti(tulo.efektiivinenProsentti)}</strong></div>
        </div>
      </div>
    </div>

    <!-- ALV-kalenteri -->
    <div class="settings-section">
      <h2 class="settings-section-title">ALV-ilmoituskalenteri ${vuosi}</h2>
      <p style="color:var(--text-2);font-size:0.875rem;margin-bottom:var(--s4)">
        Muista ilmoittaa ALV Verohallinnolle kvartaaleittain (alle 100 000 € liikevaihto).
        Määräpäivä: kvartaalin päättymistä seuraavan toisen kuukauden 12. päivä.
      </p>
      <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(200px,1fr));gap:var(--s3)">
        ${alvKaudet.map((kausi, i) => {
          const maarapaivat = ['2026-05-12', '2026-08-12', '2026-11-12', '2027-02-12']
          const onMenneisyydessa = new Date(maarapaivat[i]) < new Date()
          return `
            <div class="card" style="border-color:${onMenneisyydessa ? 'var(--border)' : 'var(--lime-border)'}">
              <div style="font-size:0.75rem;text-transform:uppercase;letter-spacing:0.05em;color:var(--text-3);margin-bottom:var(--s2)">Q${i+1} ${vuosi}</div>
              <div style="font-weight:600;margin-bottom:4px">${kausi.nimi}</div>
              <div style="font-size:0.8rem;color:${onMenneisyydessa ? 'var(--text-3)' : 'var(--lime)'}">
                Määräpäivä: ${maarapaivat[i].split('-').reverse().join('.')}
              </div>
              <div style="margin-top:var(--s2)">
                <a href="#raportit" class="btn btn-ghost btn-sm" style="font-size:0.78rem">Avaa raportti</a>
              </div>
            </div>
          `
        }).join('')}
      </div>
    </div>
  `)

  // YEL-laskuri
  document.getElementById('laske-yel-btn')?.addEventListener('click', () => {
    const tyotulo = parseFloat(document.getElementById('yel-tyotulo').value) || 0
    const ika = parseInt(document.getElementById('yel-ika').value) || 40
    const uusi = document.getElementById('yel-uusi').value === 'kylla'

    if (tyotulo < YEL_RAJAT.MIN) {
      naytaToast(`YEL-työtulo ei voi olla alle ${formatoiEuro(YEL_RAJAT.MIN)}`, 'warning')
      return
    }

    const yel = laskeYEL(tyotulo, ika, uusi)
    document.getElementById('yel-tulos').innerHTML = `
      <div style="font-size:0.75rem;color:var(--lime);text-transform:uppercase;letter-spacing:0.05em;margin-bottom:var(--s3)">YEL-laskelma</div>
      <div class="yel-row"><span>YEL-työtulo</span><strong>${formatoiEuro(tyotulo)} / vuosi</strong></div>
      <div class="yel-row"><span>YEL-prosentti</span><strong>${formatoiProsentti(yel.prosentti)}</strong></div>
      ${uusi ? '<div class="yel-row"><span>Uuden yrittäjän alennus</span><strong style="color:var(--green)">−22 %</strong></div>' : ''}
      <div class="yel-row"><span>Maksu / kuukausi</span><strong>${formatoiEuro(yel.kuukausimaksu)}</strong></div>
      <div class="yel-row" style="margin-top:var(--s2);padding-top:var(--s2)"><span>Maksu / vuosi</span><strong style="font-size:1.1rem">${formatoiEuro(yel.vuosimaksu)}</strong></div>
    `
    naytaToast('YEL laskettu', 'success')
  })

  // Tulovero-laskuri
  document.getElementById('laske-tv-btn')?.addEventListener('click', () => {
    const tulo = parseFloat(document.getElementById('tv-tulo').value) || 0
    const kunnallis = parseFloat(document.getElementById('tv-kunnallis').value) || 21.5
    const tulos = laskeArviolinenTulovero(tulo, kunnallis)

    document.getElementById('tv-tulos').innerHTML = `
      <div style="font-size:0.75rem;color:var(--cyan);text-transform:uppercase;letter-spacing:0.05em;margin-bottom:var(--s3)">Tuloveroarvio</div>
      <div class="yel-row"><span>Verotettava tulo</span><strong>${formatoiEuro(tulo)} / vuosi</strong></div>
      <div class="yel-row"><span>Valtionvero</span><strong>${formatoiEuro(tulos.valtionvero)}</strong></div>
      <div class="yel-row"><span>Kunnallisvero (${kunnallis} %)</span><strong>${formatoiEuro(tulos.kunnallisvero)}</strong></div>
      <div class="yel-row" style="margin-top:var(--s2);padding-top:var(--s2)"><span>Verot yhteensä</span><strong style="font-size:1.1rem">${formatoiEuro(tulos.yhteensa)}</strong></div>
      <div class="yel-row"><span>Efektiivinen veroprosentti</span><strong style="color:var(--cyan)">${formatoiProsentti(tulos.efektiivinenProsentti)}</strong></div>
    `
    naytaToast('Veroarvio laskettu', 'success')
  })
}
