// ═══════════════════════════════════════════════════════
// KULUT — Ostot ja kulut tositteineen
//
// Jokaiselle kululle tarvitaan tosite (kuitti/lasku, KPL 2:5).
// Tallennus kirjaa kulun heti pääkirjaan. Korjaus tehdään
// oikaisutositteella; peruttu kulu säilyy näkyvissä.
// ═══════════════════════════════════════════════════════

import {
  haeKulut, tallennaKulu, peruKulu, lisaaKulunLiite, lataaLiite, liitteenLinkki, haeTilit, haeProfiili, haeKayttaja,
} from '../utils/supabase.js'
import { formatoiEuro, formatoiPaiva, isoTanaan, OSTON_ALV_KASITTELYT, MAKSUTAVAT } from '../utils/formatters.js'
import { alvKannatPaivalle, eritteleALV, laskeALV } from '../utils/laskuri.js'
import { html } from '../utils/html.js'
import {
  renderNakyma, asetaTopbarToiminnot, avaaModaali, suljeModaali, naytaToast, naytaVahvistus,
  naytaVirhe, virheNakyma, naytaLatausRuutu, tyhjaLista, PLUS_IKONI,
} from './ui.js'

let _kayttajaId = null
let _kulut = []
let _tilit = []
let _vuosi = new Date().getFullYear()

export async function renderKulut(kayttajaId) {
  _kayttajaId = kayttajaId
  asetaTopbarToiminnot(html`<button class="btn btn-primary btn-sm" id="uusi-kulu-btn">${PLUS_IKONI} Kirjaa kulu</button>`)
  document.getElementById('uusi-kulu-btn')?.addEventListener('click', () => avaaKuluLomake())
  naytaLatausRuutu()
  try {
    ;[_kulut, _tilit] = await Promise.all([haeKulut(`${_vuosi}-01-01`, `${_vuosi}-12-31`), haeTilit()])
    renderLista()
  } catch (err) {
    virheNakyma('Kulujen lataus epäonnistui', err)
  }
}

async function paivita() {
  _kulut = await haeKulut(`${_vuosi}-01-01`, `${_vuosi}-12-31`)
  renderLista()
}

function renderLista() {
  const vuodet = [0, 1, 2, 3].map(i => new Date().getFullYear() - i)
  const voimassa = _kulut.filter(k => k.tila !== 'peruttu')
  const yhteensa = voimassa.reduce((s, k) => s + Number(k.summa), 0)
  const alvVahennys = voimassa.filter(k => k.alv_vahennys).reduce((s, k) => s + Number(k.alv_summa || 0), 0)
  const ilmanTositetta = voimassa.filter(k => !k.liitteet?.length).length

  renderNakyma(html`
    <div class="section-header">
      <div><h1 class="section-title">Kulut ja ostot</h1>
        <p class="section-sub">Kirjaa jokainen ostolasku ja kuitti tositteineen.</p></div>
      <div class="period-selector">
        ${vuodet.map(v => html`<button class="period-btn ${v === _vuosi ? 'active' : ''}" data-vuosi="${v}">${v}</button>`)}
      </div>
    </div>
    <div class="kpi-grid" style="margin-bottom:var(--s5)">
      <div class="kpi-card"><div class="kpi-label">Kulut ${_vuosi}</div><div class="kpi-value">${formatoiEuro(yhteensa)}</div>
        <div class="kpi-change">${voimassa.length} kirjausta</div></div>
      <div class="kpi-card"><div class="kpi-label">Vähennettävä ALV</div><div class="kpi-value">${formatoiEuro(alvVahennys)}</div></div>
      <div class="kpi-card"><div class="kpi-label">Tosite puuttuu</div>
        <div class="kpi-value" style="color:${ilmanTositetta ? 'var(--red)' : 'inherit'}">${ilmanTositetta}</div>
        <div class="kpi-change">Liitä kuitti tai lasku jokaiseen kirjaukseen</div></div>
    </div>
    ${_kulut.length === 0 ? tyhjaLista('Ei kirjattuja kuluja', 'Kirjaa ensimmäinen kulu tositteineen.', 'Kirjaa kulu', 'empty-uusi-kulu') : html`
      <div class="table-wrapper">
        <table class="table">
          <thead><tr><th>Päivä</th><th>Kuvaus</th><th>Tili</th><th style="text-align:right">Summa</th>
            <th style="text-align:right">ALV</th><th>Tosite</th><th></th></tr></thead>
          <tbody id="kulu-tbody">
            ${_kulut.map(k => html`
              <tr style="${k.tila === 'peruttu' ? 'opacity:0.5' : ''}">
                <td>${formatoiPaiva(k.paiva)}</td>
                <td><div style="font-weight:500">${k.kuvaus}</div>
                  <div style="font-size:0.75rem;color:var(--text-3)">${[k.toimittaja, k.kuitin_numero ? 'Nro ' + k.kuitin_numero : '',
                    k.alv_kasittely !== 'normaali' ? OSTON_ALV_KASITTELYT[k.alv_kasittely]?.split(' —')[0] : ''].filter(Boolean).join(' · ')}</div>
                  ${k.tila === 'peruttu' ? html`<span class="badge badge-peruttu">Peruttu: ${k.peruutuksen_syy}</span>` : ''}</td>
                <td>${k.tili ? `${k.tili.numero} ${k.tili.nimi}` : k.kategoria || '—'}</td>
                <td style="text-align:right">${formatoiEuro(k.summa)}</td>
                <td style="text-align:right">${k.alv_vahennys && Number(k.alv_summa) ? formatoiEuro(k.alv_summa) : '—'}</td>
                <td>${k.liitteet?.length
                  ? k.liitteet.map((p, i) => html`<button class="btn btn-ghost btn-sm" data-action="liite" data-polku="${p}">📎 ${i + 1}</button>`)
                  : html`<span class="badge badge-myohassa">Puuttuu</span>`}</td>
                <td><div class="table-actions">${k.tila === 'peruttu' ? '' : html`
                  <button class="btn btn-ghost btn-sm" data-action="liita" data-id="${k.id}" title="Liitä tosite">+📎</button>
                  <button class="btn btn-ghost btn-sm" data-action="korjaa" data-id="${k.id}">Korjaa</button>
                  ${k.pankkitapahtuma_id ? '' : html`<button class="btn btn-ghost btn-sm" data-action="peru" data-id="${k.id}" style="color:var(--red)">Peru</button>`}`}
                </div></td>
              </tr>`)}
          </tbody>
        </table>
      </div>`}
    <input type="file" id="kulu-liite-input" class="hidden" accept="application/pdf,image/*,.xml" />
  `)

  document.getElementById('empty-uusi-kulu')?.addEventListener('click', () => avaaKuluLomake())
  document.querySelectorAll('.period-btn').forEach(b => b.addEventListener('click', () => {
    _vuosi = Number(b.dataset.vuosi)
    paivita().catch(e => naytaVirhe('Lataus epäonnistui', e))
  }))

  const liiteInput = document.getElementById('kulu-liite-input')
  let liitettava = null
  liiteInput?.addEventListener('change', async () => {
    const tiedosto = liiteInput.files[0]
    if (!tiedosto || !liitettava) return
    try {
      const polku = await lataaLiite(_kayttajaId, tiedosto)
      await lisaaKulunLiite(liitettava, polku)
      naytaToast('Tosite liitetty', 'success')
      await paivita()
    } catch (e) { naytaVirhe('Liitteen tallennus epäonnistui', e) }
    liiteInput.value = ''
  })

  document.getElementById('kulu-tbody')?.addEventListener('click', async (e) => {
    const btn = e.target.closest('[data-action]')
    if (!btn) return
    const kulu = _kulut.find(k => k.id === btn.dataset.id)
    if (btn.dataset.action === 'liite') {
      try { window.open(await liitteenLinkki(btn.dataset.polku), '_blank', 'noopener') } catch (err) { naytaVirhe('Liitteen avaus epäonnistui', err) }
    } else if (btn.dataset.action === 'liita') {
      liitettava = kulu.id
      liiteInput.click()
    } else if (btn.dataset.action === 'korjaa') {
      avaaKuluLomake({ kulu })
    } else if (btn.dataset.action === 'peru') {
      const syy = await naytaVahvistus(`Kulu "${kulu.kuvaus}" (${formatoiEuro(kulu.summa)}) perutaan oikaisutositteella. Alkuperäinen kirjaus säilyy.`,
        'Peru kulu', { kysy: 'Peruutuksen syy', okTeksti: 'Peru kulu' })
      if (!syy) return
      try { await peruKulu(kulu.id, syy); naytaToast('Kulu peruttu', 'success'); await paivita() } catch (err) { naytaVirhe('Peruutus epäonnistui', err) }
    }
  })
}

/**
 * Kululomake. Valinnaiset: kulu (korjaus) tai pankkitapahtuma (tiliotteelta).
 * onValmis kutsutaan tallennuksen jälkeen.
 */
export async function avaaKuluLomake({ kulu = null, pankkitapahtuma = null, onValmis = null } = {}) {
  if (!_tilit.length) _tilit = await haeTilit()
  if (!_kayttajaId) _kayttajaId = (await haeKayttaja())?.id
  const pankista = !!(pankkitapahtuma || kulu?.pankkitapahtuma_id)
  const profiili = await haeProfiili(_kayttajaId).catch(() => ({})) || {}
  const alvRekisteroity = profiili.alv_rekisteroity !== false
  const kulutilit = _tilit.filter(t => t.aktiivinen && (t.tyyppi === 'kulu' && !['9900', '5000', '6130', '6300', '6800'].includes(t.numero)
    || ['1050', '1100'].includes(t.numero)))
  const pvm = kulu?.paiva || pankkitapahtuma?.pvm || isoTanaan()
  const summa = kulu?.summa ?? (pankkitapahtuma ? -Number(pankkitapahtuma.summa) : '')
  const kannat = alvKannatPaivalle(pvm)

  avaaModaali(html`
    <h2 class="modal-title">${kulu ? 'Korjaa kulu' : 'Kirjaa kulu'}</h2>
    ${kulu ? html`<div class="alert alert-info" style="margin-bottom:var(--s3)">Korjaus oikaisee alkuperäisen kirjauksen ja kirjaa kulun uudelleen.</div>` : ''}
    ${pankkitapahtuma ? html`<div class="alert alert-info" style="margin-bottom:var(--s3)">
      Tiliotteelta: ${formatoiPaiva(pankkitapahtuma.pvm)} · ${pankkitapahtuma.vastapuoli || ''} · ${formatoiEuro(pankkitapahtuma.summa)}</div>` : ''}
    <form id="kulu-form">
      <div class="form-row">
        <div class="form-group"><label class="form-label">Tositteen päivä *</label>
          <input class="form-input" type="date" id="k-paiva" value="${pvm}" ${pankista ? 'readonly' : ''} required /></div>
        <div class="form-group"><label class="form-label">Toimittaja</label>
          <input class="form-input" type="text" id="k-toimittaja" maxlength="200" value="${kulu?.toimittaja || pankkitapahtuma?.vastapuoli || ''}" /></div>
      </div>
      <div class="form-group"><label class="form-label">Kuvaus *</label>
        <input class="form-input" type="text" id="k-kuvaus" maxlength="300" required
          value="${kulu?.kuvaus || pankkitapahtuma?.viesti || ''}" placeholder="Mitä ostettiin ja mihin liiketoimintaan" /></div>
      <div class="form-row">
        <div class="form-group"><label class="form-label">Kirjanpitotili *</label>
          <select class="form-select" id="k-tili" required>
            ${kulutilit.map(t => html`<option value="${t.numero}" data-alv="${t.alv_oletus || ''}"
              ${(kulu?.tili?.numero || '7990') === t.numero ? 'selected' : ''}>${t.numero} ${t.nimi}</option>`)}
          </select>
          <div class="form-hint">Yli 1 200 €:n kone- tai laitehankinnat (kesto > 3 v) tilille 1100 ja poistoina.</div></div>
        <div class="form-group"><label class="form-label">Maksutapa</label>
          <select class="form-select" id="k-maksutapa" ${pankista ? 'disabled' : ''}>
            ${Object.entries(MAKSUTAVAT).map(([k, v]) => html`<option value="${k}" ${(kulu?.maksutapa || 'pankki') === k ? 'selected' : ''}>${v}</option>`)}
          </select></div>
      </div>
      <div class="form-group"><label class="form-label">ALV-käsittely</label>
        <select class="form-select" id="k-kasittely" ${alvRekisteroity ? '' : 'disabled'}>
          ${Object.entries(OSTON_ALV_KASITTELYT).map(([k, v]) => html`<option value="${k}"
            ${(kulu?.alv_kasittely || (alvRekisteroity ? 'normaali' : 'ei_alv')) === k ? 'selected' : ''}>${v}</option>`)}
        </select></div>
      <div class="form-row">
        <div class="form-group"><label class="form-label" id="k-summa-label">Summa *</label>
          <input class="form-input" type="number" id="k-summa" value="${summa}" min="0.01" step="0.01" required ${pankista ? 'readonly' : ''} /></div>
        <div class="form-group"><label class="form-label">ALV-kanta</label>
          <select class="form-select" id="k-alv">${kannat.map(k => html`<option value="${k.arvo}"
            ${Number(kulu?.alv_kanta ?? 25.5) === k.arvo ? 'selected' : ''}>${k.nimi}</option>`)}</select></div>
      </div>
      <label style="display:flex;gap:8px;align-items:center;margin-bottom:var(--s3);font-size:0.875rem">
        <input type="checkbox" id="k-vahennys" ${kulu ? (kulu.alv_vahennys ? 'checked' : '') : 'checked'} ${alvRekisteroity ? '' : 'disabled'} />
        ALV on vähennyskelpoinen (ei edustusta, ei yksityiskäyttöä)
      </label>
      <div id="k-laskelma" class="alert alert-info" style="font-size:0.85rem;margin-bottom:var(--s3)"></div>
      <div class="form-row">
        <div class="form-group"><label class="form-label">Kuitin / laskun numero</label>
          <input class="form-input" type="text" id="k-kuitti" maxlength="60" value="${kulu?.kuitin_numero || ''}" /></div>
        <div class="form-group"><label class="form-label">Tosite (kuitti / lasku) ${kulu?.liitteet?.length ? `– ${kulu.liitteet.length} liitetty` : ''}</label>
          <input class="form-input" type="file" id="k-liite" accept="application/pdf,image/*,.xml" /></div>
      </div>
      <div id="kulu-virhe" class="alert alert-error hidden"></div>
      <div class="modal-footer">
        <button type="button" class="btn btn-secondary" id="peruuta-kulu">Peruuta</button>
        <button type="submit" class="btn btn-primary" id="tallenna-kulu">Tallenna ja kirjaa</button>
      </div>
    </form>`)

  document.getElementById('peruuta-kulu')?.addEventListener('click', suljeModaali)
  const $ = (id) => document.getElementById(id)

  const paivitaLaskelma = () => {
    const kasittely = $('k-kasittely').value
    const s = Number($('k-summa').value) || 0
    const kanta = Number($('k-alv').value)
    const kaannetty = kasittely.endsWith('osto')
    $('k-alv').disabled = kasittely === 'ei_alv' || !alvRekisteroity
    $('k-summa-label').textContent = kaannetty ? 'Summa (veroton, laskulla ei ALV:tä) *' : 'Summa (sisältää ALV:n) *'
    const el = $('k-laskelma')
    if (kasittely === 'ei_alv' || !alvRekisteroity) {
      el.textContent = 'Ei arvonlisäveroa: koko summa kirjataan kuluksi.'
    } else if (kaannetty) {
      const { alv } = laskeALV(s, kanta)
      el.textContent = `Käännetty verovelvollisuus: ilmoitat itse ALV:n ${formatoiEuro(alv)} (${kanta} %) myynnin verona` +
        ($('k-vahennys').checked ? ' ja vähennät saman summan.' : '. Vero ei ole vähennyskelpoinen.')
    } else {
      const { verotonHinta, alv } = eritteleALV(s, kanta)
      el.textContent = $('k-vahennys').checked
        ? `Veroton ${formatoiEuro(verotonHinta)} + vähennettävä ALV ${formatoiEuro(alv)}`
        : `Kuluksi koko summa ${formatoiEuro(s)} (ALV ${formatoiEuro(alv)} ei vähennyskelpoinen)`
    }
  }
  $('k-tili')?.addEventListener('change', (e) => {
    const valittu = e.target.selectedOptions[0]
    if (valittu?.dataset.alv) $('k-vahennys').checked = valittu.dataset.alv === 'vahennys'
    paivitaLaskelma()
  })
  for (const id of ['k-summa', 'k-alv', 'k-kasittely', 'k-vahennys']) {
    $(id)?.addEventListener('input', paivitaLaskelma)
    $(id)?.addEventListener('change', paivitaLaskelma)
  }
  paivitaLaskelma()

  $('kulu-form')?.addEventListener('submit', async (e) => {
    e.preventDefault()
    const virhe = $('kulu-virhe')
    virhe.classList.add('hidden')
    const btn = $('tallenna-kulu')
    btn.disabled = true
    try {
      const tiedosto = $('k-liite').files[0]
      if (!tiedosto && !kulu?.liitteet?.length) {
        const ok = await naytaVahvistus('Kululle ei ole liitetty tositetta. Kirjanpitolain mukaan jokaisella kirjauksella on oltava tosite. Liitä se mahdollisimman pian.',
          'Tosite puuttuu', { okTeksti: 'Tallenna silti', vaarallinen: false })
        if (!ok) return
      }
      const liitteet = tiedosto ? [await lataaLiite(_kayttajaId, tiedosto)] : []
      await tallennaKulu({
        id: kulu?.id || null,
        paiva: $('k-paiva').value,
        toimittaja: $('k-toimittaja').value.trim(),
        kuvaus: $('k-kuvaus').value.trim(),
        tili: $('k-tili').value,
        maksutapa: pankista ? 'pankki' : $('k-maksutapa').value,
        alv_kasittely: alvRekisteroity ? $('k-kasittely').value : 'ei_alv',
        summa: Number($('k-summa').value),
        alv_kanta: $('k-kasittely').value === 'ei_alv' ? 0 : Number($('k-alv').value),
        alv_vahennys: alvRekisteroity && $('k-vahennys').checked,
        kuitin_numero: $('k-kuitti').value.trim(),
        liitteet,
        pankkitapahtuma_id: pankkitapahtuma?.id || null,
      })
      suljeModaali()
      naytaToast(kulu ? 'Kulu korjattu' : 'Kulu kirjattu', 'success')
      if (onValmis) onValmis()
      else await paivita()
    } catch (err) {
      virhe.textContent = 'Tallennus epäonnistui: ' + err.message
      virhe.classList.remove('hidden')
    } finally {
      btn.disabled = false
    }
  })
}
