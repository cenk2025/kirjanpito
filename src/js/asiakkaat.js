// ═══════════════════════════════════════════════════════
// ASIAKKAAT — Client management
// ═══════════════════════════════════════════════════════

import { haeAsiakkaat, tallennaAsiakas, poistaAsiakas } from '../utils/supabase.js'
import { validoiYTunnus, formatoiIBAN } from '../utils/formatters.js'
import {
  renderNakyma, asetaTopbarToiminnot, avaaModaali,
  suljeModaali, naytaToast, naytaVahvistus, tyhjaLista
} from './ui.js'

let _kayttajaId = null
let _asiakkaat = []

export async function renderAsiakkaat(kayttajaId) {
  _kayttajaId = kayttajaId

  asetaTopbarToiminnot(`
    <button class="btn btn-primary btn-sm" id="uusi-asiakas-btn">
      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5">
        <line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/>
      </svg>
      Uusi asiakas
    </button>
  `)

  renderNakyma('<div class="loading-screen"><div class="spinner"></div></div>')

  try {
    _asiakkaat = await haeAsiakkaat(kayttajaId)
    renderAsiakasLista()
  } catch (err) {
    renderNakyma(`<div class="alert alert-error">Asiakkaiden lataus epäonnistui: ${err.message}</div>`)
  }
}

function renderAsiakasLista() {
  document.getElementById('uusi-asiakas-btn')?.addEventListener('click', () => avaaAsiakasLomake())

  if (_asiakkaat.length === 0) {
    renderNakyma(`
      <div class="section-header">
        <div><h1 class="section-title">Asiakkaat</h1></div>
      </div>
      ${tyhjaLista('Ei asiakkaita', 'Lisää ensimmäinen asiakkaasi laskuttamista varten.', 'Lisää asiakas', 'empty-uusi-asiakas')}
    `)
    document.getElementById('empty-uusi-asiakas')?.addEventListener('click', () => avaaAsiakasLomake())
    return
  }

  const rivit = _asiakkaat.map(a => `
    <tr>
      <td>
        <div style="font-weight:600">${a.nimi}</div>
        ${a.yhteyshenkilö ? `<div style="font-size:0.8rem;color:var(--text-2)">${a.yhteyshenkilö}</div>` : ''}
      </td>
      <td>${a.y_tunnus || '—'}</td>
      <td>${a.sahkoposti || '—'}</td>
      <td>${a.puhelin || '—'}</td>
      <td>${[a.postinumero, a.kaupunki].filter(Boolean).join(' ') || '—'}</td>
      <td>
        <div class="table-actions">
          <button class="btn btn-ghost btn-sm" data-action="muokkaa" data-id="${a.id}" title="Muokkaa">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <path d="M11 4H4a2 2 0 00-2 2v14a2 2 0 002 2h14a2 2 0 002-2v-7"/>
              <path d="M18.5 2.5a2.121 2.121 0 013 3L12 15l-4 1 1-4 9.5-9.5z"/>
            </svg>
          </button>
          <button class="btn btn-ghost btn-sm" data-action="poista" data-id="${a.id}" title="Poista" style="color:var(--red-soft)">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14a2 2 0 01-2 2H8a2 2 0 01-2-2L5 6"/>
            </svg>
          </button>
        </div>
      </td>
    </tr>
  `).join('')

  renderNakyma(`
    <div class="section-header">
      <div>
        <h1 class="section-title">Asiakkaat</h1>
        <p class="section-sub">${_asiakkaat.length} asiakasta</p>
      </div>
    </div>

    <div class="filter-bar">
      <input class="form-input" type="search" id="asiakas-haku" placeholder="Hae nimellä tai Y-tunnuksella…" />
    </div>

    <div class="table-wrapper">
      <table class="table">
        <thead>
          <tr>
            <th>Nimi</th>
            <th>Y-tunnus</th>
            <th>Sähköposti</th>
            <th>Puhelin</th>
            <th>Kaupunki</th>
            <th></th>
          </tr>
        </thead>
        <tbody id="asiakas-tbody">${rivit}</tbody>
      </table>
    </div>
  `)

  document.getElementById('asiakas-tbody')?.addEventListener('click', async (e) => {
    const btn = e.target.closest('[data-action]')
    if (!btn) return
    const id = btn.dataset.id
    const asiakas = _asiakkaat.find(a => a.id === id)

    if (btn.dataset.action === 'muokkaa') {
      avaaAsiakasLomake(asiakas)
    } else if (btn.dataset.action === 'poista') {
      const ok = await naytaVahvistus(`Haluatko poistaa asiakkaan "${asiakas?.nimi}"? Tähän asiakkaaseen liittyvät laskut säilyvät.`, 'Poista asiakas')
      if (ok) {
        try {
          await poistaAsiakas(id)
          naytaToast('Asiakas poistettu', 'success')
          _asiakkaat = await haeAsiakkaat(_kayttajaId)
          renderAsiakasLista()
        } catch (err) {
          naytaToast('Poisto epäonnistui: ' + err.message, 'error')
        }
      }
    }
  })

  document.getElementById('asiakas-haku')?.addEventListener('input', (e) => {
    const haku = e.target.value.toLowerCase()
    document.querySelectorAll('#asiakas-tbody tr').forEach(rivi => {
      rivi.style.display = rivi.textContent.toLowerCase().includes(haku) ? '' : 'none'
    })
  })
}

function avaaAsiakasLomake(asiakas = null) {
  const otsikko = asiakas ? 'Muokkaa asiakasta' : 'Uusi asiakas'
  const html = `
    <h2 class="modal-title">${otsikko}</h2>
    <form id="asiakas-form">
      <div class="form-row">
        <div class="form-group">
          <label class="form-label">Yrityksen nimi / Nimi *</label>
          <input class="form-input" type="text" id="a-nimi" value="${asiakas?.nimi || ''}" required placeholder="Oy Esimerkki Ab" />
        </div>
        <div class="form-group">
          <label class="form-label">Y-tunnus</label>
          <input class="form-input" type="text" id="a-ytunnus" value="${asiakas?.y_tunnus || ''}" placeholder="1234567-8" maxlength="9" />
          <div class="form-hint" id="ytunnus-validointi"></div>
        </div>
      </div>
      <div class="form-row">
        <div class="form-group">
          <label class="form-label">Yhteyshenkilö</label>
          <input class="form-input" type="text" id="a-yhteyshenkilö" value="${asiakas?.yhteyshenkilö || ''}" placeholder="Matti Meikäläinen" />
        </div>
        <div class="form-group">
          <label class="form-label">ALV-tunnus (EU)</label>
          <input class="form-input" type="text" id="a-alv-tunnus" value="${asiakas?.alv_tunnus || ''}" placeholder="FI12345678" />
        </div>
      </div>
      <div class="form-group">
        <label class="form-label">Osoite</label>
        <input class="form-input" type="text" id="a-osoite" value="${asiakas?.osoite || ''}" placeholder="Esimerkkikatu 1" />
      </div>
      <div class="form-row">
        <div class="form-group">
          <label class="form-label">Postinumero</label>
          <input class="form-input" type="text" id="a-postinumero" value="${asiakas?.postinumero || ''}" placeholder="00100" maxlength="10" />
        </div>
        <div class="form-group">
          <label class="form-label">Kaupunki</label>
          <input class="form-input" type="text" id="a-kaupunki" value="${asiakas?.kaupunki || ''}" placeholder="Helsinki" />
        </div>
        <div class="form-group">
          <label class="form-label">Maa</label>
          <input class="form-input" type="text" id="a-maa" value="${asiakas?.maa || 'FI'}" placeholder="FI" maxlength="3" />
        </div>
      </div>
      <div class="form-row">
        <div class="form-group">
          <label class="form-label">Sähköposti</label>
          <input class="form-input" type="email" id="a-email" value="${asiakas?.sahkoposti || ''}" placeholder="laskut@yritys.fi" />
        </div>
        <div class="form-group">
          <label class="form-label">Puhelin</label>
          <input class="form-input" type="tel" id="a-puhelin" value="${asiakas?.puhelin || ''}" placeholder="+358 40 123 4567" />
        </div>
      </div>

      <div id="asiakas-virhe" class="alert alert-error hidden"></div>

      <div class="modal-footer">
        <button type="button" class="btn btn-secondary" id="peruuta-asiakas">Peruuta</button>
        <button type="submit" class="btn btn-primary">Tallenna</button>
      </div>
    </form>
  `

  const content = avaaModaali(html)

  document.getElementById('peruuta-asiakas')?.addEventListener('click', suljeModaali)

  // Y-tunnus validointi live
  document.getElementById('a-ytunnus')?.addEventListener('input', (e) => {
    const validointi = document.getElementById('ytunnus-validointi')
    const arvo = e.target.value
    if (arvo.length === 0) { validointi.textContent = ''; return }
    if (validoiYTunnus(arvo)) {
      validointi.textContent = '✓ Oikea muoto'
      validointi.style.color = 'var(--green)'
    } else if (arvo.length >= 9) {
      validointi.textContent = '✗ Virheellinen Y-tunnus'
      validointi.style.color = 'var(--red)'
    } else {
      validointi.textContent = ''
    }
  })

  document.getElementById('asiakas-form')?.addEventListener('submit', async (e) => {
    e.preventDefault()
    const virheEl = document.getElementById('asiakas-virhe')
    virheEl.classList.add('hidden')

    const ytunnus = document.getElementById('a-ytunnus').value.trim()
    if (ytunnus && !validoiYTunnus(ytunnus)) {
      virheEl.textContent = 'Y-tunnus on virheellinen. Tarkista muoto (esim. 1234567-8).'
      virheEl.classList.remove('hidden')
      return
    }

    const data = {
      id:           asiakas?.id || undefined,
      nimi:         document.getElementById('a-nimi').value.trim(),
      y_tunnus:     ytunnus || null,
      alv_tunnus:   document.getElementById('a-alv-tunnus').value.trim() || null,
      yhteyshenkilö: document.getElementById('a-yhteyshenkilö').value.trim() || null,
      osoite:       document.getElementById('a-osoite').value.trim() || null,
      postinumero:  document.getElementById('a-postinumero').value.trim() || null,
      kaupunki:     document.getElementById('a-kaupunki').value.trim() || null,
      maa:          document.getElementById('a-maa').value.trim() || 'FI',
      sahkoposti:   document.getElementById('a-email').value.trim() || null,
      puhelin:      document.getElementById('a-puhelin').value.trim() || null,
    }

    try {
      await tallennaAsiakas(_kayttajaId, data)
      suljeModaali()
      naytaToast(asiakas ? 'Asiakas päivitetty!' : 'Asiakas lisätty!', 'success')
      _asiakkaat = await haeAsiakkaat(_kayttajaId)
      renderAsiakasLista()
    } catch (err) {
      virheEl.textContent = 'Tallennus epäonnistui: ' + err.message
      virheEl.classList.remove('hidden')
    }
  })
}
