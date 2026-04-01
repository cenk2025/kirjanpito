// ═══════════════════════════════════════════════════════
// ASETUKSET — Company settings & profile
// ═══════════════════════════════════════════════════════

import { haeProfiili, tallennaProfiiili } from '../utils/supabase.js'
import { formatoiIBAN, validoiYTunnus } from '../utils/formatters.js'
import { YEL_RAJAT } from '../utils/laskuri.js'
import { renderNakyma, asetaTopbarToiminnot, naytaToast } from './ui.js'

let _kayttajaId = null

export async function renderAsetukset(kayttajaId) {
  _kayttajaId = kayttajaId
  asetaTopbarToiminnot('')
  renderNakyma('<div class="loading-screen"><div class="spinner"></div></div>')

  try {
    const profiili = await haeProfiili(kayttajaId)
    renderAsetuksetHTML(profiili || {})
  } catch (err) {
    renderNakyma(`<div class="alert alert-error">Asetusten lataus epäonnistui: ${err.message}</div>`)
  }
}

function renderAsetuksetHTML(p) {
  renderNakyma(`
    <div class="section-header">
      <div>
        <h1 class="section-title">Asetukset</h1>
        <p class="section-sub">Yritystiedot, verotusasetukset ja laskupohjatiedot</p>
      </div>
    </div>

    <form id="asetukset-form">

      <!-- Yritystiedot -->
      <div class="settings-section">
        <h2 class="settings-section-title">Yritystiedot</h2>
        <div class="form-row">
          <div class="form-group">
            <label class="form-label">Yrityksen nimi *</label>
            <input class="form-input" type="text" id="a-yritys-nimi" value="${p.yritys_nimi || ''}"
              placeholder="Oy Esimerkki Ab / Toiminimi Meikäläinen" required />
          </div>
          <div class="form-group">
            <label class="form-label">Y-tunnus</label>
            <input class="form-input" type="text" id="a-ytunnus" value="${p.y_tunnus || ''}"
              placeholder="1234567-8" maxlength="9" />
            <div class="form-hint" id="ytunnus-hint"></div>
          </div>
        </div>
        <div class="form-row">
          <div class="form-group">
            <label class="form-label">ALV-tunnus</label>
            <input class="form-input" type="text" id="a-alv-tunnus" value="${p.alv_tunnus || ''}"
              placeholder="FI12345678" />
            <div class="form-hint">Sama kuin Y-tunnus ilman väliviivaa, FI-etuliitteellä</div>
          </div>
          <div class="form-group">
            <label class="form-label">Sähköposti</label>
            <input class="form-input" type="email" id="a-email" value="${p.sahkoposti || ''}"
              placeholder="laskut@yritys.fi" />
          </div>
        </div>
        <div class="form-row">
          <div class="form-group">
            <label class="form-label">Puhelin</label>
            <input class="form-input" type="tel" id="a-puhelin" value="${p.puhelin || ''}"
              placeholder="+358 40 123 4567" />
          </div>
          <div class="form-group">
            <label class="form-label">Kotisivu</label>
            <input class="form-input" type="url" id="a-kotisivu" value="${p.kotisivu || ''}"
              placeholder="https://www.yritys.fi" />
          </div>
        </div>
        <div class="form-group">
          <label class="form-label">Osoite</label>
          <input class="form-input" type="text" id="a-osoite" value="${p.osoite || ''}"
            placeholder="Esimerkkikatu 1" />
        </div>
        <div class="form-row">
          <div class="form-group">
            <label class="form-label">Postinumero</label>
            <input class="form-input" type="text" id="a-postinumero" value="${p.postinumero || ''}"
              placeholder="00100" maxlength="10" />
          </div>
          <div class="form-group">
            <label class="form-label">Kaupunki</label>
            <input class="form-input" type="text" id="a-kaupunki" value="${p.kaupunki || ''}"
              placeholder="Helsinki" />
          </div>
        </div>
      </div>

      <!-- Pankkitiedot -->
      <div class="settings-section">
        <h2 class="settings-section-title">Pankkitiedot (laskulle)</h2>
        <div class="form-row">
          <div class="form-group">
            <label class="form-label">IBAN</label>
            <input class="form-input" type="text" id="a-iban" value="${p.iban || ''}"
              placeholder="FI00 1234 5678 9012 34" />
            <div class="form-hint">Näkyy laskuissa maksutietona</div>
          </div>
          <div class="form-group">
            <label class="form-label">BIC / SWIFT</label>
            <input class="form-input" type="text" id="a-bic" value="${p.bic || ''}"
              placeholder="NDEAFIHH" />
          </div>
        </div>
        <div class="form-group">
          <label class="form-label">Pankki</label>
          <input class="form-input" type="text" id="a-pankki" value="${p.pankki || ''}"
            placeholder="Nordea / OP / Holvi..." />
        </div>
      </div>

      <!-- Verotus- ja YEL-asetukset -->
      <div class="settings-section">
        <h2 class="settings-section-title">Verotus- ja YEL-asetukset</h2>
        <div class="form-row">
          <div class="form-group">
            <label class="form-label">YEL-työtulo (€/vuosi)</label>
            <input class="form-input" type="number" id="a-yel-tyotulo" value="${p.yel_tyotulo || ''}"
              min="${YEL_RAJAT.MIN}" max="${YEL_RAJAT.MAX}" step="100"
              placeholder="${YEL_RAJAT.MIN}" />
            <div class="form-hint">
              Minimi ${YEL_RAJAT.MIN.toLocaleString('fi-FI')} € — Maksimi ${YEL_RAJAT.MAX.toLocaleString('fi-FI')} €
            </div>
          </div>
          <div class="form-group">
            <label class="form-label">Ikä</label>
            <input class="form-input" type="number" id="a-ika" value="${p.ika || ''}"
              min="18" max="70" placeholder="Käytetään YEL-laskennassa" />
          </div>
        </div>
        <div class="form-row">
          <div class="form-group">
            <label class="form-label">Uusi yrittäjä (4 v alennus)</label>
            <select class="form-select" id="a-uusi-yrittaja">
              <option value="false" ${!p.uusi_yrittaja ? 'selected' : ''}>Ei</option>
              <option value="true" ${p.uusi_yrittaja ? 'selected' : ''}>Kyllä</option>
            </select>
          </div>
          <div class="form-group">
            <label class="form-label">Kunnallisvero %</label>
            <input class="form-input" type="number" id="a-kunnallisvero" value="${p.kunnallisvero || 21.5}"
              min="16" max="25" step="0.1" />
            <div class="form-hint">Tarkista vero.fi:stä oman kuntasi veroprosentti</div>
          </div>
        </div>
        <div class="form-row">
          <div class="form-group">
            <label class="form-label">ALV-ilmoitusväli</label>
            <select class="form-select" id="a-alv-kausi">
              <option value="quarterly" ${(p.alv_kausi||'quarterly') === 'quarterly' ? 'selected' : ''}>Neljännesvuosittain (alle 100 000 € liikevaihto)</option>
              <option value="monthly" ${p.alv_kausi === 'monthly' ? 'selected' : ''}>Kuukausittain (yli 100 000 €)</option>
              <option value="annually" ${p.alv_kausi === 'annually' ? 'selected' : ''}>Vuosittain (alle 30 000 €)</option>
            </select>
          </div>
          <div class="form-group">
            <label class="form-label">Oletusarvoinen maksuehto</label>
            <select class="form-select" id="a-maksuehto">
              <option value="7"  ${p.maksuehto === 7  ? 'selected' : ''}>7 päivää</option>
              <option value="14" ${!p.maksuehto || p.maksuehto === 14 ? 'selected' : ''}>14 päivää</option>
              <option value="21" ${p.maksuehto === 21 ? 'selected' : ''}>21 päivää</option>
              <option value="30" ${p.maksuehto === 30 ? 'selected' : ''}>30 päivää</option>
            </select>
          </div>
        </div>
      </div>

      <!-- Laskun lisätietoteksti -->
      <div class="settings-section">
        <h2 class="settings-section-title">Laskun oletustekstit</h2>
        <div class="form-group">
          <label class="form-label">Viivästyskorko (teksti laskulle)</label>
          <input class="form-input" type="text" id="a-viivastyskorko" value="${p.viivastyskorko || 'Viivästyskorko lakisääteinen viivästyskorko.'}"
            placeholder="Viivästyskorko lakisääteinen viivästyskorko." />
        </div>
        <div class="form-group">
          <label class="form-label">Oletus-lisätiedot laskuille</label>
          <textarea class="form-textarea" id="a-oletusteksti" rows="3" placeholder="Vapaaehtoinen teksti, joka lisätään jokaiselle laskulle automaattisesti">${p.oletusteksti || ''}</textarea>
        </div>
      </div>

      <div id="asetukset-virhe" class="alert alert-error hidden" style="margin-bottom:var(--s3)"></div>
      <div id="asetukset-ok" class="alert alert-success hidden" style="margin-bottom:var(--s3)">Asetukset tallennettu!</div>

      <div style="display:flex;gap:var(--s3);justify-content:flex-end">
        <button type="submit" class="btn btn-primary" id="tallenna-asetukset-btn">
          Tallenna asetukset
        </button>
      </div>
    </form>
  `)

  // Y-tunnus live-validointi
  document.getElementById('a-ytunnus')?.addEventListener('input', (e) => {
    const hint = document.getElementById('ytunnus-hint')
    const arvo = e.target.value.trim()
    if (!arvo || arvo.length < 9) { hint.textContent = ''; return }
    if (validoiYTunnus(arvo)) {
      hint.textContent = '✓ Oikea muoto'
      hint.style.color = 'var(--green)'
    } else {
      hint.textContent = '✗ Virheellinen Y-tunnus'
      hint.style.color = 'var(--red)'
    }
  })

  // IBAN muotoilu
  document.getElementById('a-iban')?.addEventListener('blur', (e) => {
    e.target.value = formatoiIBAN(e.target.value)
  })

  // Lomakkeen tallennus
  document.getElementById('asetukset-form')?.addEventListener('submit', async (e) => {
    e.preventDefault()
    const btn = document.getElementById('tallenna-asetukset-btn')
    const virheEl = document.getElementById('asetukset-virhe')
    const okEl = document.getElementById('asetukset-ok')

    btn.disabled = true
    btn.textContent = 'Tallennetaan…'
    virheEl.classList.add('hidden')
    okEl.classList.add('hidden')

    const ytunnus = document.getElementById('a-ytunnus').value.trim()
    if (ytunnus && !validoiYTunnus(ytunnus)) {
      virheEl.textContent = 'Y-tunnus on virheellinen.'
      virheEl.classList.remove('hidden')
      btn.disabled = false
      btn.textContent = 'Tallenna asetukset'
      return
    }

    const data = {
      yritys_nimi:   document.getElementById('a-yritys-nimi').value.trim(),
      y_tunnus:      ytunnus || null,
      alv_tunnus:    document.getElementById('a-alv-tunnus').value.trim() || null,
      sahkoposti:    document.getElementById('a-email').value.trim() || null,
      puhelin:       document.getElementById('a-puhelin').value.trim() || null,
      kotisivu:      document.getElementById('a-kotisivu').value.trim() || null,
      osoite:        document.getElementById('a-osoite').value.trim() || null,
      postinumero:   document.getElementById('a-postinumero').value.trim() || null,
      kaupunki:      document.getElementById('a-kaupunki').value.trim() || null,
      iban:          document.getElementById('a-iban').value.replace(/\s/g,'') || null,
      bic:           document.getElementById('a-bic').value.trim() || null,
      pankki:        document.getElementById('a-pankki').value.trim() || null,
      yel_tyotulo:   parseFloat(document.getElementById('a-yel-tyotulo').value) || null,
      ika:           parseInt(document.getElementById('a-ika').value) || null,
      uusi_yrittaja: document.getElementById('a-uusi-yrittaja').value === 'true',
      kunnallisvero: parseFloat(document.getElementById('a-kunnallisvero').value) || 21.5,
      alv_kausi:     document.getElementById('a-alv-kausi').value,
      maksuehto:     parseInt(document.getElementById('a-maksuehto').value) || 14,
      viivastyskorko: document.getElementById('a-viivastyskorko').value.trim() || null,
      oletusteksti:  document.getElementById('a-oletusteksti').value.trim() || null,
    }

    try {
      await tallennaProfiiili(_kayttajaId, data)
      okEl.classList.remove('hidden')
      naytaToast('Asetukset tallennettu!', 'success')
      setTimeout(() => okEl.classList.add('hidden'), 4000)
    } catch (err) {
      virheEl.textContent = 'Tallennus epäonnistui: ' + err.message
      virheEl.classList.remove('hidden')
    } finally {
      btn.disabled = false
      btn.textContent = 'Tallenna asetukset'
    }
  })
}
