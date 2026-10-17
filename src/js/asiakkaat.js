// ═══════════════════════════════════════════════════════
// ASIAKKAAT — Asiakasrekisteri
// ═══════════════════════════════════════════════════════

import { haeAsiakkaat, tallennaAsiakas, poistaAsiakas } from '../utils/supabase.js'
import { validoiYTunnus, EU_MAAT } from '../utils/formatters.js'
import { html } from '../utils/html.js'
import {
  renderNakyma, asetaTopbarToiminnot, avaaModaali, suljeModaali, naytaToast, naytaVahvistus,
  virheNakyma, naytaLatausRuutu, tyhjaLista, PLUS_IKONI,
} from './ui.js'

let _kayttajaId = null
let _asiakkaat = []
let _naytaArkistoidut = false

export async function renderAsiakkaat(kayttajaId) {
  _kayttajaId = kayttajaId
  asetaTopbarToiminnot(html`<button class="btn btn-primary btn-sm" id="uusi-asiakas-btn">${PLUS_IKONI} Uusi asiakas</button>`)
  document.getElementById('uusi-asiakas-btn')?.addEventListener('click', () => avaaLomake())
  naytaLatausRuutu()
  try {
    _asiakkaat = await haeAsiakkaat()
    renderLista()
  } catch (err) {
    virheNakyma('Asiakkaiden lataus epäonnistui', err)
  }
}

function renderLista() {
  const naytettavat = _asiakkaat.filter(a => _naytaArkistoidut || !a.arkistoitu)
  if (_asiakkaat.length === 0) {
    renderNakyma(html`
      <div class="section-header"><div><h1 class="section-title">Asiakkaat</h1></div></div>
      ${tyhjaLista('Ei asiakkaita', 'Lisää ensimmäinen asiakkaasi laskuttamista varten.', 'Lisää asiakas', 'empty-uusi-asiakas')}`)
    document.getElementById('empty-uusi-asiakas')?.addEventListener('click', () => avaaLomake())
    return
  }

  renderNakyma(html`
    <div class="section-header">
      <div><h1 class="section-title">Asiakkaat</h1><p class="section-sub">${naytettavat.length} asiakasta</p></div>
      <label style="font-size:0.85rem;color:var(--text-2)"><input type="checkbox" id="nayta-arkisto" ${_naytaArkistoidut ? 'checked' : ''}/> Näytä arkistoidut</label>
    </div>
    <div class="table-wrapper">
      <table class="table">
        <thead><tr><th>Nimi</th><th>Y-tunnus / ALV</th><th>Maa</th><th>Sähköposti</th><th>Verkkolasku</th><th></th></tr></thead>
        <tbody id="asiakas-tbody">
          ${naytettavat.map(a => html`
            <tr>
              <td><div style="font-weight:600">${a.nimi}${a.arkistoitu ? html` <span class="badge badge-peruttu">Arkistoitu</span>` : ''}</div>
                ${a['yhteyshenkilö'] ? html`<div style="font-size:0.8rem;color:var(--text-2)">${a['yhteyshenkilö']}</div>` : ''}</td>
              <td>${a.y_tunnus || '—'}${a.alv_tunnus ? html`<br><span style="font-size:0.8rem;color:var(--text-2)">${a.alv_tunnus}</span>` : ''}</td>
              <td>${a.maa || 'FI'}</td>
              <td>${a.sahkoposti || '—'}</td>
              <td>${a.verkkolaskuosoite || '—'}</td>
              <td><div class="table-actions">
                <button class="btn btn-ghost btn-sm" data-action="muokkaa" data-id="${a.id}">Muokkaa</button>
                <button class="btn btn-ghost btn-sm" data-action="poista" data-id="${a.id}" style="color:var(--red)">
                  ${a.arkistoitu ? 'Palauta' : 'Poista'}</button>
              </div></td>
            </tr>`)}
        </tbody>
      </table>
    </div>`)

  document.getElementById('nayta-arkisto')?.addEventListener('change', (e) => { _naytaArkistoidut = e.target.checked; renderLista() })
  document.getElementById('asiakas-tbody')?.addEventListener('click', async (e) => {
    const btn = e.target.closest('[data-action]')
    if (!btn) return
    const asiakas = _asiakkaat.find(a => a.id === btn.dataset.id)
    if (btn.dataset.action === 'muokkaa') return avaaLomake(asiakas)
    if (asiakas.arkistoitu) {
      await tallennaAsiakas(_kayttajaId, { id: asiakas.id, arkistoitu: false })
    } else {
      if (!await naytaVahvistus(`Poistetaanko asiakas "${asiakas.nimi}"? Jos asiakkaalla on laskuja, se arkistoidaan (laskujen tiedot säilyvät).`, 'Poista asiakas')) return
      try {
        const tulos = await poistaAsiakas(asiakas.id)
        naytaToast(tulos ? 'Asiakkaalla on laskuja: asiakas arkistoitiin' : 'Asiakas poistettu', 'success')
      } catch (err) {
        return naytaToast('Poisto epäonnistui: ' + err.message, 'error')
      }
    }
    _asiakkaat = await haeAsiakkaat()
    renderLista()
  })
}

function avaaLomake(a = null) {
  avaaModaali(html`
    <h2 class="modal-title">${a ? 'Muokkaa asiakasta' : 'Uusi asiakas'}</h2>
    <form id="asiakas-form">
      <div class="form-row">
        <div class="form-group"><label class="form-label">Nimi *</label>
          <input class="form-input" type="text" id="a-nimi" maxlength="200" value="${a?.nimi || ''}" required /></div>
        <div class="form-group"><label class="form-label">Asiakastyyppi</label>
          <select class="form-select" id="a-tyyppi">
            <option value="yritys" ${(a?.tyyppi || 'yritys') === 'yritys' ? 'selected' : ''}>Yritys</option>
            <option value="julkinen" ${a?.tyyppi === 'julkinen' ? 'selected' : ''}>Julkinen sektori (kunta, työllisyysalue)</option>
            <option value="kuluttaja" ${a?.tyyppi === 'kuluttaja' ? 'selected' : ''}>Kuluttaja (yksityishenkilö)</option>
          </select></div>
      </div>
      <div class="form-row">
        <div class="form-group"><label class="form-label">Y-tunnus</label>
          <input class="form-input" type="text" id="a-ytunnus" maxlength="9" placeholder="1234567-8" value="${a?.y_tunnus || ''}" />
          <div class="form-hint" id="a-ytunnus-vihje"></div></div>
        <div class="form-group"><label class="form-label">ALV-tunniste (EU-asiakas: pakollinen)</label>
          <input class="form-input" type="text" id="a-alv" maxlength="20" placeholder="SE556677889901" value="${a?.alv_tunnus || ''}" />
          <div class="form-hint">Tarkista voimassaolo: ec.europa.eu/taxation_customs/vies</div></div>
      </div>
      <div class="form-group"><label class="form-label">Yhteyshenkilö</label>
        <input class="form-input" type="text" id="a-yhteys" maxlength="200" value="${a?.['yhteyshenkilö'] || ''}" /></div>
      <div class="form-group"><label class="form-label">Osoite</label>
        <input class="form-input" type="text" id="a-osoite" maxlength="200" value="${a?.osoite || ''}" /></div>
      <div class="form-row">
        <div class="form-group"><label class="form-label">Postinumero</label>
          <input class="form-input" type="text" id="a-postinumero" maxlength="12" value="${a?.postinumero || ''}" /></div>
        <div class="form-group"><label class="form-label">Kaupunki</label>
          <input class="form-input" type="text" id="a-kaupunki" maxlength="100" value="${a?.kaupunki || ''}" /></div>
        <div class="form-group"><label class="form-label">Maa (ISO)</label>
          <input class="form-input" type="text" id="a-maa" maxlength="2" value="${a?.maa || 'FI'}" style="text-transform:uppercase" /></div>
      </div>
      <div class="form-row">
        <div class="form-group"><label class="form-label">Sähköposti</label>
          <input class="form-input" type="email" id="a-email" maxlength="200" value="${a?.sahkoposti || ''}" /></div>
        <div class="form-group"><label class="form-label">Puhelin</label>
          <input class="form-input" type="tel" id="a-puhelin" maxlength="40" value="${a?.puhelin || ''}" /></div>
      </div>
      <div class="form-row">
        <div class="form-group"><label class="form-label">Verkkolaskuosoite (OVT/IBAN)</label>
          <input class="form-input" type="text" id="a-verkko" maxlength="40" placeholder="0037..." value="${a?.verkkolaskuosoite || ''}" /></div>
        <div class="form-group"><label class="form-label">Välittäjätunnus</label>
          <input class="form-input" type="text" id="a-valittaja" maxlength="40" placeholder="esim. 003721291126" value="${a?.valittajatunnus || ''}" /></div>
      </div>
      <div id="a-virhe" class="alert alert-error hidden"></div>
      <div class="modal-footer">
        <button type="button" class="btn btn-secondary" id="a-peruuta">Peruuta</button>
        <button type="submit" class="btn btn-primary">Tallenna</button>
      </div>
    </form>`)

  document.getElementById('a-peruuta')?.addEventListener('click', suljeModaali)
  document.getElementById('a-ytunnus')?.addEventListener('input', (e) => {
    const v = document.getElementById('a-ytunnus-vihje')
    const arvo = e.target.value.trim()
    v.textContent = arvo.length < 9 ? '' : validoiYTunnus(arvo) ? '✓ Oikea muoto' : '✗ Virheellinen Y-tunnus'
    v.style.color = validoiYTunnus(arvo) ? 'var(--green)' : 'var(--red)'
  })

  document.getElementById('asiakas-form')?.addEventListener('submit', async (e) => {
    e.preventDefault()
    const virhe = document.getElementById('a-virhe')
    const nayta = (t) => { virhe.textContent = t; virhe.classList.remove('hidden') }
    virhe.classList.add('hidden')
    const ytunnus = document.getElementById('a-ytunnus').value.trim()
    const maa = document.getElementById('a-maa').value.trim().toUpperCase() || 'FI'
    const alv = document.getElementById('a-alv').value.replace(/\s/g, '').toUpperCase()
    const tyyppi = document.getElementById('a-tyyppi').value
    if (ytunnus && !validoiYTunnus(ytunnus)) return nayta('Y-tunnus on virheellinen (esim. 1234567-8).')
    if (!/^[A-Z]{2}$/.test(maa)) return nayta('Maa kahdella kirjaimella (esim. FI, SE, DE).')
    if (alv && !/^[A-Z]{2}[0-9A-Z]{2,13}$/.test(alv)) return nayta('ALV-tunniste: maatunnus + numero (esim. SE556677889901).')
    if (maa !== 'FI' && EU_MAAT.includes(maa) && tyyppi !== 'kuluttaja' && !alv) {
      return nayta('EU-yritysasiakkaalta tarvitaan ALV-tunniste käännettyä verovelvollisuutta varten.')
    }
    try {
      await tallennaAsiakas(_kayttajaId, {
        id: a?.id,
        nimi: document.getElementById('a-nimi').value.trim(),
        tyyppi,
        y_tunnus: ytunnus || null,
        alv_tunnus: alv || null,
        'yhteyshenkilö': document.getElementById('a-yhteys').value.trim() || null,
        osoite: document.getElementById('a-osoite').value.trim() || null,
        postinumero: document.getElementById('a-postinumero').value.trim() || null,
        kaupunki: document.getElementById('a-kaupunki').value.trim() || null,
        maa,
        sahkoposti: document.getElementById('a-email').value.trim() || null,
        puhelin: document.getElementById('a-puhelin').value.trim() || null,
        verkkolaskuosoite: document.getElementById('a-verkko').value.trim() || null,
        valittajatunnus: document.getElementById('a-valittaja').value.trim() || null,
      })
      suljeModaali()
      naytaToast(a ? 'Asiakas päivitetty' : 'Asiakas lisätty', 'success')
      _asiakkaat = await haeAsiakkaat()
      renderLista()
    } catch (err) {
      nayta('Tallennus epäonnistui: ' + err.message)
    }
  })
}
