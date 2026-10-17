// ═══════════════════════════════════════════════════════
// ASETUKSET — Yritystiedot, tilikaudet, turvallisuus ja varmuuskopio
// ═══════════════════════════════════════════════════════

import {
  haeProfiili, tallennaProfiili, haeTilikaudet, luoTilikausi, muutaTilikausi, lukitseTilikausi,
  mfaTekijat, mfaAloitaRekisterointi, mfaVahvista, mfaPoista, vaihdaSalasana, haeKaikki, kirjaaVanhatTiedot,
} from '../utils/supabase.js'
import { formatoiIBAN, validoiYTunnus, formatoiPaiva, formatoiAika, ytunnusAlvTunnukseksi, isoTanaan } from '../utils/formatters.js'
import { YEL_RAJAT, tarkistaIBAN, lisaaPaivia } from '../utils/laskuri.js'
import { html } from '../utils/html.js'
import {
  renderNakyma, asetaTopbarToiminnot, naytaToast, naytaVahvistus, naytaVirhe, virheNakyma,
  naytaLatausRuutu, avaaModaali, suljeModaali, lataaTiedosto,
} from './ui.js'

let _kayttajaId = null

export async function renderAsetukset(kayttajaId) {
  _kayttajaId = kayttajaId
  asetaTopbarToiminnot('')
  naytaLatausRuutu()
  try {
    const [p, kaudet, tekijat] = await Promise.all([haeProfiili(kayttajaId), haeTilikaudet(), mfaTekijat()])
    renderSivu(p || {}, kaudet, tekijat)
  } catch (err) {
    virheNakyma('Asetusten lataus epäonnistui', err)
  }
}

function kentta(id, nimi, arvo, { tyyppi = 'text', vihje = '', placeholder = '', max = 200, pakollinen = false } = {}) {
  return html`<div class="form-group">
    <label class="form-label" for="${id}">${nimi}${pakollinen ? ' *' : ''}</label>
    <input class="form-input" type="${tyyppi}" id="${id}" value="${arvo ?? ''}" placeholder="${placeholder}" maxlength="${max}" ${pakollinen ? 'required' : ''} />
    ${vihje ? html`<div class="form-hint" id="${id}-vihje">${vihje}</div>` : ''}
  </div>`
}

function renderSivu(p, kaudet, tekijat) {
  const mfaKaytossa = tekijat.some(t => t.status === 'verified')
  renderNakyma(html`
    <div class="section-header"><div><h1 class="section-title">Asetukset</h1>
      <p class="section-sub">Yritystiedot näkyvät laskuilla. Lähetetyt laskut säilyttävät lähetyshetken tiedot.</p></div></div>

    <form id="asetukset-form">
      <div class="settings-section">
        <h2 class="settings-section-title">Yritystiedot</h2>
        <div class="form-row">
          ${kentta('a-nimi', 'Yrityksen nimi', p.yritys_nimi, { placeholder: 'VOON IQ Oy', pakollinen: true })}
          ${kentta('a-ytunnus', 'Y-tunnus', p.y_tunnus, { placeholder: '1234567-8', max: 9, pakollinen: true, vihje: ' ' })}
        </div>
        <div class="form-row">
          ${kentta('a-kotipaikka', 'Kotipaikka (kaupparekisteri)', p.kotipaikka, { placeholder: 'Jyväskylä', pakollinen: true,
            vihje: 'Pakollinen merkintä yhtiön laskuissa ja kirjeissä' })}
          <div class="form-group"><label class="form-label">ALV-rekisteröinti</label>
            <select class="form-select" id="a-alv-rek">
              <option value="true" ${p.alv_rekisteroity !== false ? 'selected' : ''}>Arvonlisäverovelvollinen (ALV-rekisterissä)</option>
              <option value="false" ${p.alv_rekisteroity === false ? 'selected' : ''}>Ei ALV-rekisterissä (liikevaihto alle 20 000 €)</option>
            </select></div>
        </div>
        <div class="form-row">
          ${kentta('a-alv-tunnus', 'ALV-tunniste', p.alv_tunnus, { placeholder: 'FI12345678', max: 14, vihje: 'Jätä tyhjäksi: muodostetaan Y-tunnuksesta' })}
          ${kentta('a-email', 'Sähköposti', p.sahkoposti, { tyyppi: 'email', placeholder: 'info@voon.fi' })}
        </div>
        ${kentta('a-osoite', 'Katuosoite', p.osoite, { pakollinen: true })}
        <div class="form-row">
          ${kentta('a-postinumero', 'Postinumero', p.postinumero, { max: 10 })}
          ${kentta('a-kaupunki', 'Postitoimipaikka', p.kaupunki)}
        </div>
        <div class="form-row">
          ${kentta('a-puhelin', 'Puhelin', p.puhelin, { tyyppi: 'tel', max: 40 })}
          ${kentta('a-kotisivu', 'Kotisivu', p.kotisivu, { tyyppi: 'url', placeholder: 'https://voon.fi' })}
        </div>
      </div>

      <div class="settings-section">
        <h2 class="settings-section-title">Pankki ja laskutus</h2>
        <div class="form-row">
          ${kentta('a-iban', 'IBAN', formatoiIBAN(p.iban), { placeholder: 'FI00 1234 5600 0007 85', max: 42, pakollinen: true, vihje: ' ' })}
          ${kentta('a-bic', 'BIC', p.bic, { placeholder: 'OKOYFIHH', max: 11 })}
        </div>
        <div class="form-row">
          <div class="form-group"><label class="form-label">Oletusmaksuehto</label>
            <select class="form-select" id="a-maksuehto">${[7, 14, 21, 30].map(d => html`<option value="${d}" ${(p.maksuehto || 14) === d ? 'selected' : ''}>${d} päivää</option>`)}</select></div>
          ${kentta('a-huomautus', 'Huomautusaika (pv)', p.huomautusaika ?? 7, { tyyppi: 'number', max: 3 })}
          ${kentta('a-viitekorko', 'Viitekorko % (maksumuistutuksiin)', p.viitekorko ?? 2, { tyyppi: 'number', max: 6,
            vihje: 'Suomen Pankin vahvistama, päivitä puolivuosittain' })}
        </div>
        ${kentta('a-viivastys', 'Viivästyskorkoteksti', p.viivastyskorko || 'Viivästyskorko korkolain mukaan.', { max: 200 })}
        <div class="form-row">
          ${kentta('a-verkko', 'Oma verkkolaskuosoite', p.verkkolaskuosoite, { max: 40, placeholder: '003712345678' })}
          ${kentta('a-valittaja', 'Oma välittäjätunnus', p.valittajatunnus, { max: 40 })}
        </div>
        <div class="form-group"><label class="form-label">Laskun oletuslisätieto</label>
          <textarea class="form-textarea" id="a-oletusteksti" rows="2" maxlength="1000">${p.oletusteksti || ''}</textarea></div>
      </div>

      <div class="settings-section">
        <h2 class="settings-section-title">ALV ja YEL</h2>
        <div class="form-row">
          <div class="form-group"><label class="form-label">ALV-verokausi</label>
            <select class="form-select" id="a-alv-kausi">
              <option value="monthly" ${p.alv_kausi === 'monthly' ? 'selected' : ''}>Kuukausi (Verohallinnon oletus)</option>
              <option value="quarterly" ${(p.alv_kausi || 'quarterly') === 'quarterly' ? 'selected' : ''}>Neljännesvuosi (liikevaihto enintään 100 000 €)</option>
              <option value="annually" ${p.alv_kausi === 'annually' ? 'selected' : ''}>Kalenterivuosi (liikevaihto enintään 30 000 €)</option>
            </select>
            <div class="form-hint">Pidempi verokausi valitaan ilmoituksella OmaVerossa.</div></div>
          ${kentta('a-yel', 'YEL-työtulo (€/v)', p.yel_tyotulo, { tyyppi: 'number', max: 10,
            vihje: `${YEL_RAJAT.MIN.toLocaleString('fi-FI')} – ${YEL_RAJAT.MAX.toLocaleString('fi-FI')} €` })}
          <div class="form-group"><label class="form-label">Aloittava yrittäjä (YEL −22 %)</label>
            <select class="form-select" id="a-uusi"><option value="false">Ei</option>
              <option value="true" ${p.uusi_yrittaja ? 'selected' : ''}>Kyllä</option></select></div>
        </div>
      </div>

      <div id="a-virhe" class="alert alert-error hidden" style="margin-bottom:var(--s3)"></div>
      <div style="display:flex;justify-content:flex-end;margin-bottom:var(--s6)">
        <button type="submit" class="btn btn-primary" id="a-tallenna">Tallenna yritystiedot</button></div>
    </form>

    <div class="settings-section">
      <h2 class="settings-section-title">Tilikaudet</h2>
      <p style="color:var(--text-2);font-size:0.875rem;margin-bottom:var(--s3)">Tilikausi on 12 kuukautta; ensimmäinen
        (tai muutettu) voi olla enintään 18 kuukautta (KPL 4:7). Lukitse tilikausi, kun tilinpäätös on vahvistettu –
        lukittuun kauteen ei voi enää kirjata.</p>
      <table class="table"><tbody id="kausi-tbody">
        ${kaudet.map(k => html`<tr><td>${formatoiPaiva(k.alku)} – ${formatoiPaiva(k.loppu)}</td>
          <td>${k.lukittu ? html`🔒 Lukittu ${formatoiAika(k.lukittu_aika)}` : 'Avoin'}</td>
          <td><div class="table-actions">${k.lukittu ? '' : html`
            <button class="btn btn-ghost btn-sm" data-muuta="${k.id}">Muuta</button>
            <button class="btn btn-ghost btn-sm" data-lukitse="${k.id}">Lukitse</button>`}</div></td></tr>`)}
      </tbody></table>
      <button class="btn btn-secondary btn-sm" id="uusi-kausi" style="margin-top:var(--s3)">+ Uusi tilikausi</button>
    </div>

    <div class="settings-section">
      <h2 class="settings-section-title">Turvallisuus</h2>
      <div style="display:flex;justify-content:space-between;align-items:center;flex-wrap:wrap;gap:var(--s3);margin-bottom:var(--s4)">
        <div><strong>Kaksivaiheinen tunnistautuminen</strong><br>
          <span style="color:var(--text-2);font-size:0.875rem">${mfaKaytossa
            ? 'Käytössä. Kaikki tietoihin pääsy vaatii todennuskoodin.'
            : 'Ei käytössä. Ota käyttöön: kirjanpito sisältää luottamuksellisia tietoja.'}</span></div>
        ${mfaKaytossa ? html`<button class="btn btn-ghost btn-sm" id="mfa-poista">Poista käytöstä</button>`
          : html`<button class="btn btn-primary btn-sm" id="mfa-ota">Ota käyttöön</button>`}
      </div>
      <form id="salasana-form" class="form-row" style="align-items:end">
        <div class="form-group"><label class="form-label">Uusi salasana (vähintään 12 merkkiä)</label>
          <input class="form-input" type="password" id="uusi-salasana" minlength="12" autocomplete="new-password" required /></div>
        <div class="form-group"><button class="btn btn-secondary" type="submit">Vaihda salasana</button></div>
      </form>
    </div>

    <div class="settings-section">
      <h2 class="settings-section-title">Tiedot ja säilytys</h2>
      <p style="color:var(--text-2);font-size:0.875rem;margin-bottom:var(--s3);line-height:1.6">
        Kirjanpitokirjat ja tilinpäätös on säilytettävä vähintään 10 vuotta ja tositteet 6 vuotta tilikauden päättymisestä
        (KPL 2:10). Lataa varmuuskopio vähintään kuukausittain ja aina tilinpäätöksen jälkeen, ja säilytä se erillään
        (esim. salattu pilvikansio). Käytä tuotannossa Supabasen maksullista tasoa, jossa on päivittäiset varmuuskopiot.</p>
      <div style="display:flex;gap:var(--s3);flex-wrap:wrap">
        <button class="btn btn-primary btn-sm" id="varmuuskopio">Lataa varmuuskopio (JSON)</button>
        <button class="btn btn-ghost btn-sm" id="vanhat">Kirjaa vanhan version laskut ja kulut pääkirjaan</button>
      </div>
    </div>`)

  liitaKuuntelijat(p, kaudet)
}

function liitaKuuntelijat(p, kaudet) {
  const $ = (id) => document.getElementById(id)
  const vihje = (id, ok, teksti) => {
    const el = $(`${id}-vihje`)
    if (!el) return
    el.textContent = teksti
    el.style.color = ok ? 'var(--green)' : 'var(--red)'
  }
  $('a-ytunnus')?.addEventListener('input', (e) => {
    const v = e.target.value.trim()
    if (v.length < 9) return vihje('a-ytunnus', true, '')
    vihje('a-ytunnus', validoiYTunnus(v), validoiYTunnus(v) ? '✓ Oikea muoto' : '✗ Virheellinen Y-tunnus')
  })
  $('a-iban')?.addEventListener('blur', (e) => {
    e.target.value = formatoiIBAN(e.target.value.toUpperCase())
    const ok = tarkistaIBAN(e.target.value)
    vihje('a-iban', ok, e.target.value ? (ok ? '✓ IBAN kelpaa' : '✗ IBAN-tarkiste ei täsmää') : '')
  })

  $('asetukset-form')?.addEventListener('submit', async (e) => {
    e.preventDefault()
    const virhe = $('a-virhe')
    virhe.classList.add('hidden')
    const ytunnus = $('a-ytunnus').value.trim()
    const iban = $('a-iban').value.replace(/\s/g, '').toUpperCase()
    const alvRek = $('a-alv-rek').value === 'true'
    const yel = Number($('a-yel').value) || null
    const virheet = []
    if (!validoiYTunnus(ytunnus)) virheet.push('Y-tunnus on virheellinen.')
    if (!tarkistaIBAN(iban)) virheet.push('IBAN on virheellinen.')
    if (yel && (yel < YEL_RAJAT.MIN || yel > YEL_RAJAT.MAX)) virheet.push('YEL-työtulo on rajojen ulkopuolella.')
    if (virheet.length) {
      virhe.textContent = virheet.join(' ')
      virhe.classList.remove('hidden')
      return
    }
    $('a-tallenna').disabled = true
    try {
      await tallennaProfiili(_kayttajaId, {
        yritys_nimi: $('a-nimi').value.trim(),
        yhtiomuoto: 'oy',
        y_tunnus: ytunnus,
        kotipaikka: $('a-kotipaikka').value.trim(),
        alv_rekisteroity: alvRek,
        alv_tunnus: alvRek ? ($('a-alv-tunnus').value.trim().toUpperCase() || ytunnusAlvTunnukseksi(ytunnus)) : null,
        sahkoposti: $('a-email').value.trim() || null,
        osoite: $('a-osoite').value.trim(),
        postinumero: $('a-postinumero').value.trim() || null,
        kaupunki: $('a-kaupunki').value.trim() || null,
        puhelin: $('a-puhelin').value.trim() || null,
        kotisivu: $('a-kotisivu').value.trim() || null,
        iban,
        bic: $('a-bic').value.trim().toUpperCase() || null,
        maksuehto: Number($('a-maksuehto').value),
        huomautusaika: Number($('a-huomautus').value) || 7,
        viitekorko: Number($('a-viitekorko').value) || 0,
        viivastyskorko: $('a-viivastys').value.trim() || null,
        verkkolaskuosoite: $('a-verkko').value.trim() || null,
        valittajatunnus: $('a-valittaja').value.trim() || null,
        oletusteksti: $('a-oletusteksti').value.trim() || null,
        alv_kausi: $('a-alv-kausi').value,
        yel_tyotulo: yel,
        uusi_yrittaja: $('a-uusi').value === 'true',
      })
      naytaToast('Yritystiedot tallennettu', 'success')
    } catch (err) {
      virhe.textContent = 'Tallennus epäonnistui: ' + err.message
      virhe.classList.remove('hidden')
    } finally {
      $('a-tallenna').disabled = false
    }
  })

  // Tilikaudet
  const kausiLomake = (k = null) => {
    const viimeisin = kaudet.reduce((m, x) => (!m || x.loppu > m.loppu ? x : m), null)
    const alku = k?.alku || (viimeisin ? lisaaPaivia(viimeisin.loppu, 1) : `${isoTanaan().slice(0, 4)}-01-01`)
    const [v, kk, pv] = alku.split('-')
    const loppu = k?.loppu || lisaaPaivia(`${Number(v) + 1}-${kk}-${pv}`, -1)
    avaaModaali(html`
      <h2 class="modal-title">${k ? 'Muuta tilikautta' : 'Uusi tilikausi'}</h2>
      <form id="kausi-form"><div class="form-row">
        <div class="form-group"><label class="form-label">Alkaa</label><input class="form-input" type="date" id="k-alku" value="${alku}" required /></div>
        <div class="form-group"><label class="form-label">Päättyy</label><input class="form-input" type="date" id="k-loppu" value="${loppu}" required /></div>
      </div>
      <div id="k-virhe" class="alert alert-error hidden"></div>
      <div class="modal-footer"><button type="button" class="btn btn-secondary" id="k-peruuta">Peruuta</button>
        <button type="submit" class="btn btn-primary">Tallenna</button></div></form>`)
    $('k-peruuta').addEventListener('click', suljeModaali)
    $('kausi-form').addEventListener('submit', async (e) => {
      e.preventDefault()
      try {
        if (k) await muutaTilikausi(k.id, $('k-alku').value, $('k-loppu').value)
        else await luoTilikausi($('k-alku').value, $('k-loppu').value)
        suljeModaali()
        renderAsetukset(_kayttajaId)
      } catch (err) {
        $('k-virhe').textContent = err.message
        $('k-virhe').classList.remove('hidden')
      }
    })
  }
  $('uusi-kausi')?.addEventListener('click', () => kausiLomake())
  $('kausi-tbody')?.addEventListener('click', async (e) => {
    const muuta = e.target.closest('[data-muuta]')
    const lukitse = e.target.closest('[data-lukitse]')
    if (muuta) kausiLomake(kaudet.find(k => k.id === muuta.dataset.muuta))
    if (lukitse) {
      const ok = await naytaVahvistus('Lukitseminen on pysyvää: tilikaudelle ei voi enää kirjata eikä sitä voi avata. Lukitse vasta, kun tilinpäätös on laadittu ja vahvistettu, ja lataa varmuuskopio ensin.',
        'Lukitse tilikausi', { okTeksti: 'Lukitse pysyvästi' })
      if (!ok) return
      try { await lukitseTilikausi(lukitse.dataset.lukitse); naytaToast('Tilikausi lukittu', 'success'); renderAsetukset(_kayttajaId) } catch (err) { naytaVirhe('Lukitus epäonnistui', err) }
    }
  })

  // MFA
  $('mfa-ota')?.addEventListener('click', async () => {
    try {
      const data = await mfaAloitaRekisterointi()
      avaaModaali(html`
        <h2 class="modal-title">Kaksivaiheinen tunnistautuminen</h2>
        <p style="font-size:0.875rem;color:var(--text-2);margin-bottom:var(--s3)">Skannaa koodi todennussovelluksella
          (Microsoft Authenticator, Google Authenticator, 1Password…) ja syötä sovelluksen näyttämä koodi.</p>
        <img src="${data.totp.qr_code}" alt="QR-koodi" style="width:200px;height:200px;background:#fff;padding:8px;border-radius:8px" />
        <p style="font-size:0.75rem;color:var(--text-3);margin:var(--s2) 0;word-break:break-all">Avain: ${data.totp.secret}</p>
        <form id="mfa-ota-form">
          <div class="form-group"><input class="form-input" id="mfa-ota-koodi" inputmode="numeric" maxlength="6" placeholder="123456" required /></div>
          <div id="mfa-ota-virhe" class="alert alert-error hidden"></div>
          <div class="modal-footer"><button type="button" class="btn btn-secondary" id="mfa-ota-peruuta">Peruuta</button>
            <button type="submit" class="btn btn-primary">Vahvista</button></div>
        </form>`)
      $('mfa-ota-peruuta').addEventListener('click', async () => { await mfaPoista(data.id).catch(() => {}); suljeModaali() })
      $('mfa-ota-form').addEventListener('submit', async (e) => {
        e.preventDefault()
        try {
          await mfaVahvista(data.id, $('mfa-ota-koodi').value.trim())
          suljeModaali()
          naytaToast('Kaksivaiheinen tunnistautuminen otettu käyttöön', 'success')
          renderAsetukset(_kayttajaId)
        } catch {
          $('mfa-ota-virhe').textContent = 'Virheellinen koodi'
          $('mfa-ota-virhe').classList.remove('hidden')
        }
      })
    } catch (err) { naytaVirhe('MFA:n käyttöönotto epäonnistui', err) }
  })
  $('mfa-poista')?.addEventListener('click', async () => {
    if (!await naytaVahvistus('Poistetaanko kaksivaiheinen tunnistautuminen? Tämä heikentää tietoturvaa.', 'Poista MFA')) return
    try {
      for (const t of await mfaTekijat()) await mfaPoista(t.id)
      naytaToast('MFA poistettu', 'warning')
      renderAsetukset(_kayttajaId)
    } catch (err) { naytaVirhe('Poisto epäonnistui', err) }
  })

  $('salasana-form')?.addEventListener('submit', async (e) => {
    e.preventDefault()
    const s = $('uusi-salasana').value
    if (s.length < 12) return naytaToast('Salasanan on oltava vähintään 12 merkkiä', 'error')
    try { await vaihdaSalasana(s); $('uusi-salasana').value = ''; naytaToast('Salasana vaihdettu', 'success') } catch (err) { naytaVirhe('Vaihto epäonnistui', err) }
  })

  // Varmuuskopio
  $('varmuuskopio')?.addEventListener('click', async (e) => {
    e.target.disabled = true
    try {
      const taulut = ['profiilit', 'asiakkaat', 'laskut', 'laskurivit', 'kulut', 'tilit', 'tilikaudet', 'tositteet',
        'viennit', 'pankkitapahtumat', 'numerosarjat', 'muutosloki']
      const tiedot = {}
      for (const t of taulut) tiedot[t] = await haeKaikki(t)
      lataaTiedosto(`kirjanpito-varmuuskopio-${isoTanaan()}.json`,
        JSON.stringify({ luotu: new Date().toISOString(), yritys: p.yritys_nimi, y_tunnus: p.y_tunnus, tiedot }, null, 1),
        'application/json')
      naytaToast('Varmuuskopio ladattu. Tositeliitteet säilyvät tallennustilassa; lataa ne tarvittaessa erikseen.', 'success', 7000)
    } catch (err) { naytaVirhe('Varmuuskopio epäonnistui', err) } finally { e.target.disabled = false }
  })

  $('vanhat')?.addEventListener('click', async () => {
    const ok = await naytaVahvistus('Sovelluksen aiemmalla versiolla luodut lähetetyt ja maksetut laskut sekä kulut kirjataan pääkirjaan tositteiksi. ' +
      'Tilikauden on oltava luotuna ja avoinna niiden päivämäärille. Toiminto ei kirjaa mitään kahteen kertaan.', 'Kirjaa vanhat tiedot',
      { okTeksti: 'Kirjaa', vaarallinen: false })
    if (!ok) return
    try {
      const r = await kirjaaVanhatTiedot()
      naytaToast(`Kirjattu ${r.laskut} laskua ja ${r.kulut} kulua`, 'success')
    } catch (err) { naytaVirhe('Kirjaus epäonnistui', err) }
  })
}
