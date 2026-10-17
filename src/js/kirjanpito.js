// ═══════════════════════════════════════════════════════
// KIRJANPITO — Päiväkirja, pääkirja, tositteet, tilikartta, muutosloki
// ═══════════════════════════════════════════════════════

import {
  haeTilikaudet, haeTositteet, haeTilisaldot, haeTilinViennit, haeTilit, lisaaTili, paivitaTili,
  kirjaaMuistiotosite, oikaiseTosite, haeMuutosloki, supabase,
} from '../utils/supabase.js'
import { formatoiEuro, formatoiPaiva, formatoiAika, isoTanaan } from '../utils/formatters.js'
import { html } from '../utils/html.js'
import {
  renderNakyma, asetaTopbarToiminnot, avaaModaali, suljeModaali, naytaToast, naytaVahvistus,
  naytaVirhe, virheNakyma, naytaLatausRuutu, lataaTiedosto, csv,
} from './ui.js'
import { navigoi } from './router.js'

let _kayttajaId = null
let _kausiId = null

const LAHTEET = {
  myyntilasku: 'Myyntilasku', hyvityslasku: 'Hyvityslasku', maksu: 'Maksu', kulu: 'Kulu', pankki: 'Pankki',
  muistio: 'Muistiotosite', oikaisu: 'Oikaisu', alv_tilitys: 'ALV-tilitys', avaus: 'Avaus',
}

const TYYPIT = { vastaavaa: 'Vastaavaa', oma_paaoma: 'Oma pääoma', vieras_paaoma: 'Vieras pääoma', tuotto: 'Tuotto', kulu: 'Kulu' }

export async function renderKirjanpito(kayttajaId, polku) {
  _kayttajaId = kayttajaId
  const osat = polku.split('/')
  const nakyma = osat[1] || 'paivakirja'
  asetaTopbarToiminnot(html`<button class="btn btn-primary btn-sm" id="uusi-tosite">+ Muistiotosite</button>`)
  document.getElementById('uusi-tosite')?.addEventListener('click', () => avaaMuistiotosite())
  naytaLatausRuutu()

  try {
    const kaudet = await haeTilikaudet()
    if (!kaudet.length) return virheNakyma('Ei tilikausia', new Error('Luo tilikausi asetuksissa'))
    const tanaan = isoTanaan()
    if (!_kausiId || !kaudet.some(k => k.id === _kausiId)) {
      _kausiId = (kaudet.find(k => k.alku <= tanaan && k.loppu >= tanaan) || kaudet[0]).id
    }
    const kausi = kaudet.find(k => k.id === _kausiId)
    const valikko = html`
      <div class="section-header">
        <div><h1 class="section-title">Kirjanpito</h1>
          <p class="section-sub">Tilikausi ${formatoiPaiva(kausi.alku)} – ${formatoiPaiva(kausi.loppu)} ${kausi.lukittu ? '🔒 lukittu' : ''}</p></div>
        <select class="form-select" id="kausi-valinta" style="max-width:260px">
          ${kaudet.map(k => html`<option value="${k.id}" ${k.id === _kausiId ? 'selected' : ''}>${formatoiPaiva(k.alku)} – ${formatoiPaiva(k.loppu)}${k.lukittu ? ' 🔒' : ''}</option>`)}
        </select>
      </div>
      <div class="period-selector" style="margin-bottom:var(--s4)">
        ${[['paivakirja', 'Päiväkirja'], ['paakirja', 'Pääkirja'], ['tilikartta', 'Tilikartta'], ['loki', 'Muutosloki']].map(([k, n]) =>
          html`<a class="period-btn ${nakyma === k ? 'active' : ''}" href="#kirjanpito/${k}">${n}</a>`)}
      </div>`

    if (nakyma === 'tosite') await renderTosite(osat[2])
    else if (nakyma === 'paakirja') await renderPaakirja(valikko, kausi, osat[2])
    else if (nakyma === 'tilikartta') await renderTilikartta(valikko)
    else if (nakyma === 'loki') await renderLoki(valikko)
    else await renderPaivakirja(valikko, kausi)

    document.getElementById('kausi-valinta')?.addEventListener('change', (e) => {
      _kausiId = e.target.value
      renderKirjanpito(kayttajaId, polku)
    })
  } catch (err) {
    virheNakyma('Kirjanpidon lataus epäonnistui', err)
  }
}

// ─── Päiväkirja ────────────────────────────────────────

async function renderPaivakirja(valikko, kausi) {
  const tositteet = await haeTositteet(kausi.alku, kausi.loppu)
  renderNakyma(html`
    ${valikko}
    <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:var(--s3)">
      <p style="color:var(--text-2);font-size:0.875rem">${tositteet.length} tositetta aikajärjestyksessä (päiväkirja, KPL 2:4).</p>
      <button class="btn btn-ghost btn-sm" id="vie-paivakirja">Vie CSV</button>
    </div>
    <div class="table-wrapper"><table class="table">
      <thead><tr><th>Nro</th><th>Päivä</th><th>Selite</th><th>Tili</th><th style="text-align:right">Debet</th><th style="text-align:right">Kredit</th></tr></thead>
      <tbody>
        ${tositteet.map(t => html`
          <tr style="border-top:2px solid var(--border)">
            <td><a href="#kirjanpito/tosite/${t.id}"><strong>${t.numero}</strong></a></td>
            <td>${formatoiPaiva(t.pvm)}</td>
            <td colspan="4"><span class="badge badge-luonnos">${LAHTEET[t.lahde] || t.lahde}</span> ${t.selite}
              ${t.oikaistu ? html` <span class="badge badge-peruttu">Oikaistu</span>` : ''}</td>
          </tr>
          ${t.viennit.map(v => html`<tr style="font-size:0.85rem">
            <td></td><td></td><td style="color:var(--text-3)">${v.selite || ''}</td>
            <td>${v.tili.numero} ${v.tili.nimi}</td>
            <td style="text-align:right">${Number(v.debet) ? formatoiEuro(v.debet) : ''}</td>
            <td style="text-align:right">${Number(v.kredit) ? formatoiEuro(v.kredit) : ''}</td></tr>`)}`)}
      </tbody></table></div>`)

  document.getElementById('vie-paivakirja')?.addEventListener('click', () => {
    const rivit = [['Tosite', 'Päivä', 'Lähde', 'Selite', 'Tili', 'Tilin nimi', 'Debet', 'Kredit', 'ALV-koodi', 'ALV %']]
    for (const t of tositteet) {
      for (const v of t.viennit) {
        rivit.push([t.numero, t.pvm, LAHTEET[t.lahde], t.selite, v.tili.numero, v.tili.nimi,
          Number(v.debet), Number(v.kredit), v.alv_koodi || '', v.alv_kanta ?? ''])
      }
    }
    lataaTiedosto(`paivakirja_${kausi.alku}_${kausi.loppu}.csv`, csv(rivit), 'text/csv;charset=utf-8')
  })
}

// ─── Pääkirja ──────────────────────────────────────────

async function renderPaakirja(valikko, kausi, tiliNumero) {
  const saldot = (await haeTilisaldot(kausi.alku, kausi.loppu))
    .filter(s => Number(s.debet) || Number(s.kredit) || Number(s.alkusaldo))
  let tilinViennit = null
  if (tiliNumero) {
    tilinViennit = (await haeTilinViennit(tiliNumero, kausi.alku, kausi.loppu))
      .sort((a, b) => a.tosite.pvm.localeCompare(b.tosite.pvm) || a.tosite.numero - b.tosite.numero)
  }
  const tili = saldot.find(s => s.numero === tiliNumero)
  let juokseva = Number(tili?.alkusaldo || 0)

  renderNakyma(html`
    ${valikko}
    <div style="display:grid;grid-template-columns:minmax(260px,1fr) 2fr;gap:var(--s4)">
      <div class="table-wrapper"><table class="table">
        <thead><tr><th>Tili</th><th style="text-align:right">Saldo</th></tr></thead>
        <tbody>${saldot.map(s => html`<tr style="cursor:pointer;${s.numero === tiliNumero ? 'background:var(--ink-3)' : ''}" data-tili="${s.numero}">
          <td>${s.numero} ${s.nimi}</td><td style="text-align:right">${formatoiEuro(s.loppusaldo)}</td></tr>`)}</tbody>
      </table></div>
      <div>${tili ? html`
        <div class="card">
          <div class="card-title" style="margin-bottom:var(--s3)">${tili.numero} ${tili.nimi}
            <button class="btn btn-ghost btn-sm" id="vie-tili" style="float:right">Vie CSV</button></div>
          <table class="table">
            <thead><tr><th>Päivä</th><th>Tosite</th><th>Selite</th><th style="text-align:right">Debet</th>
              <th style="text-align:right">Kredit</th><th style="text-align:right">Saldo</th></tr></thead>
            <tbody>
              <tr><td colspan="5">Alkusaldo</td><td style="text-align:right">${formatoiEuro(tili.alkusaldo)}</td></tr>
              ${tilinViennit.map(v => {
                juokseva += Number(v.debet) - Number(v.kredit)
                return html`<tr>
                  <td>${formatoiPaiva(v.tosite.pvm)}</td>
                  <td><a href="#kirjanpito/tosite/${v.tosite_id}">${v.tosite.numero}</a></td>
                  <td>${v.tosite.selite}</td>
                  <td style="text-align:right">${Number(v.debet) ? formatoiEuro(v.debet) : ''}</td>
                  <td style="text-align:right">${Number(v.kredit) ? formatoiEuro(v.kredit) : ''}</td>
                  <td style="text-align:right">${formatoiEuro(juokseva)}</td></tr>`
              })}
            </tbody>
          </table>
        </div>` : html`<div class="empty-state"><p>Valitse tili nähdäksesi sen tapahtumat (pääkirja, KPL 2:4).</p></div>`}
      </div>
    </div>`)

  document.querySelectorAll('[data-tili]').forEach(r => r.addEventListener('click', () => navigoi(`kirjanpito/paakirja/${r.dataset.tili}`)))
  document.getElementById('vie-tili')?.addEventListener('click', () => {
    let saldo = Number(tili.alkusaldo)
    const rivit = [['Päivä', 'Tosite', 'Selite', 'Debet', 'Kredit', 'Saldo'], ['', '', 'Alkusaldo', '', '', saldo]]
    for (const v of tilinViennit) {
      saldo += Number(v.debet) - Number(v.kredit)
      rivit.push([v.tosite.pvm, v.tosite.numero, v.tosite.selite, Number(v.debet), Number(v.kredit), Math.round(saldo * 100) / 100])
    }
    lataaTiedosto(`paakirja_${tili.numero}_${kausi.alku}_${kausi.loppu}.csv`, csv(rivit), 'text/csv;charset=utf-8')
  })
}

// ─── Yksittäinen tosite ────────────────────────────────

async function renderTosite(id) {
  const { data: t, error } = await supabase.from('tositteet')
    .select('*, viennit(*, tili:tilit(numero, nimi)), kausi:tilikaudet(alku, loppu, lukittu)').eq('id', id).maybeSingle()
  if (error) throw new Error(error.message)
  if (!t) return navigoi('kirjanpito')
  const [{ data: oikaisut }, lahde] = await Promise.all([
    supabase.from('tositteet').select('id, numero, pvm').eq('oikaisee_id', t.id),
    t.lahde_id ? haeLahde(t.lahde, t.lahde_id) : Promise.resolve(null),
  ])
  const voiOikaista = ['muistio', 'pankki', 'alv_tilitys', 'avaus'].includes(t.lahde) && !t.oikaistu && !t.oikaisee_id

  renderNakyma(html`
    <div style="margin-bottom:var(--s4)"><a href="#kirjanpito" style="color:var(--text-2);font-size:0.875rem">← Päiväkirja</a></div>
    <div class="card">
      <div style="display:flex;justify-content:space-between;flex-wrap:wrap;gap:var(--s3)">
        <div>
          <div style="font-size:0.75rem;color:var(--text-3);text-transform:uppercase">${LAHTEET[t.lahde]}</div>
          <h1 style="font-size:1.6rem;font-weight:800">Tosite ${t.numero}</h1>
          <div style="color:var(--text-2)">${formatoiPaiva(t.pvm)} · ${t.selite}</div>
          <div style="color:var(--text-3);font-size:0.8rem;margin-top:4px">Kirjattu ${formatoiAika(t.luotu)}</div>
        </div>
        <div>${voiOikaista ? html`<button class="btn btn-ghost btn-sm" id="oikaise">Oikaise tosite</button>` : ''}</div>
      </div>
      ${t.oikaistu ? html`<div class="alert alert-warning" style="margin-top:var(--s3)">Tosite on oikaistu:
        ${(oikaisut || []).map(o => html`<a href="#kirjanpito/tosite/${o.id}">tosite ${o.numero}</a> `)}</div>` : ''}
      ${t.oikaisee_id ? html`<div class="alert alert-info" style="margin-top:var(--s3)">Oikaisee
        <a href="#kirjanpito/tosite/${t.oikaisee_id}">alkuperäisen tositteen</a>.</div>` : ''}
      ${lahde ? html`<div style="margin-top:var(--s3)"><a href="${lahde.linkki}">${lahde.teksti} →</a></div>` : ''}
      <table class="table" style="margin-top:var(--s4)">
        <thead><tr><th>Tili</th><th>ALV</th><th style="text-align:right">Debet</th><th style="text-align:right">Kredit</th></tr></thead>
        <tbody>${t.viennit.map(v => html`<tr><td>${v.tili.numero} ${v.tili.nimi}</td>
          <td style="font-size:0.8rem;color:var(--text-3)">${v.alv_koodi ? `${v.alv_koodi} ${v.alv_kanta ?? ''} %` : ''}</td>
          <td style="text-align:right">${Number(v.debet) ? formatoiEuro(v.debet) : ''}</td>
          <td style="text-align:right">${Number(v.kredit) ? formatoiEuro(v.kredit) : ''}</td></tr>`)}
        </tbody>
      </table>
    </div>`)

  document.getElementById('oikaise')?.addEventListener('click', async () => {
    const syy = await naytaVahvistus('Tosite vastakirjataan oikaisutositteella. Alkuperäinen tosite säilyy.', 'Oikaise tosite',
      { kysy: 'Oikaisun syy', okTeksti: 'Oikaise' })
    if (!syy) return
    try {
      const uusi = await oikaiseTosite(t.id, syy)
      naytaToast('Tosite oikaistu', 'success')
      navigoi(`kirjanpito/tosite/${uusi}`)
    } catch (e) { naytaVirhe('Oikaisu epäonnistui', e) }
  })
}

async function haeLahde(lahde, id) {
  if (['myyntilasku', 'hyvityslasku', 'maksu', 'oikaisu'].includes(lahde)) {
    const { data } = await supabase.from('laskut').select('id, laskunumero').eq('id', id).maybeSingle()
    if (data) return { linkki: `#laskut/${data.id}`, teksti: `Lasku ${data.laskunumero}` }
  }
  if (['kulu', 'oikaisu'].includes(lahde)) {
    const { data } = await supabase.from('kulut').select('id, kuvaus, liitteet').eq('id', id).maybeSingle()
    if (data) return { linkki: '#kulut', teksti: `Kulu: ${data.kuvaus} (${data.liitteet?.length || 0} liitettä)` }
  }
  return null
}

// ─── Muistiotosite ─────────────────────────────────────

async function avaaMuistiotosite() {
  const tilit = (await haeTilit()).filter(t => t.aktiivinen && !['1701', '2939', '1763'].includes(t.numero))
  const tiliOptiot = html`<option value="">— tili —</option>${tilit.map(t => html`<option value="${t.numero}">${t.numero} ${t.nimi}</option>`)}`
  const riviHTML = () => html`<div class="form-row muistio-rivi" style="align-items:end">
    <div class="form-group" style="flex:2"><select class="form-select" name="tili">${tiliOptiot}</select></div>
    <div class="form-group"><input class="form-input" type="number" name="debet" min="0" step="0.01" placeholder="Debet" /></div>
    <div class="form-group"><input class="form-input" type="number" name="kredit" min="0" step="0.01" placeholder="Kredit" /></div>
  </div>`

  avaaModaali(html`
    <h2 class="modal-title">Muistiotosite</h2>
    <p style="color:var(--text-2);font-size:0.85rem;margin-bottom:var(--s3)">
      Käytä kirjauksiin, joilla ei ole ulkoista tositetta: osakepääoma, avaava tase, poistot, palkat,
      tuloverot, jaksotukset. Liitä laskelma tai päätös tositteeksi Kulut-sivulle tarvittaessa.</p>
    <form id="muistio-form">
      <div class="form-row">
        <div class="form-group"><label class="form-label">Päivä *</label>
          <input class="form-input" type="date" id="mt-pvm" value="${isoTanaan()}" required /></div>
        <div class="form-group" style="flex:2"><label class="form-label">Selite *</label>
          <input class="form-input" type="text" id="mt-selite" maxlength="300" required placeholder="Esim. Osakepääoman maksu" /></div>
      </div>
      <div id="mt-rivit">${riviHTML()}${riviHTML()}</div>
      <button type="button" class="btn btn-ghost btn-sm" id="mt-lisaa">+ Rivi</button>
      <div id="mt-summa" style="margin-top:var(--s3);font-size:0.875rem"></div>
      <div id="mt-virhe" class="alert alert-error hidden"></div>
      <div class="modal-footer">
        <button type="button" class="btn btn-secondary" id="mt-peruuta">Peruuta</button>
        <button type="submit" class="btn btn-primary">Kirjaa</button>
      </div>
    </form>`, 'modal-lg')

  const rivit = () => Array.from(document.querySelectorAll('.muistio-rivi')).map(r => ({
    tili: r.querySelector('[name="tili"]').value,
    debet: Number(r.querySelector('[name="debet"]').value) || 0,
    kredit: Number(r.querySelector('[name="kredit"]').value) || 0,
  })).filter(r => r.tili && (r.debet || r.kredit))
  const paivitaSumma = () => {
    const r = rivit()
    const d = r.reduce((s, x) => s + x.debet, 0)
    const k = r.reduce((s, x) => s + x.kredit, 0)
    const el = document.getElementById('mt-summa')
    el.textContent = `Debet ${formatoiEuro(d)} · Kredit ${formatoiEuro(k)} · Erotus ${formatoiEuro(d - k)}`
    el.style.color = Math.abs(d - k) < 0.005 ? 'var(--green)' : 'var(--red)'
  }
  document.getElementById('mt-rivit').addEventListener('input', paivitaSumma)
  document.getElementById('mt-lisaa').addEventListener('click', () => {
    const w = document.createElement('div')
    w.innerHTML = String(riviHTML())
    document.getElementById('mt-rivit').appendChild(w.firstElementChild)
  })
  document.getElementById('mt-peruuta').addEventListener('click', suljeModaali)
  document.getElementById('muistio-form').addEventListener('submit', async (e) => {
    e.preventDefault()
    try {
      const id = await kirjaaMuistiotosite(document.getElementById('mt-pvm').value,
        document.getElementById('mt-selite').value.trim(), rivit())
      suljeModaali()
      naytaToast('Muistiotosite kirjattu', 'success')
      navigoi(`kirjanpito/tosite/${id}`)
    } catch (err) {
      const el = document.getElementById('mt-virhe')
      el.textContent = err.message
      el.classList.remove('hidden')
    }
  })
}

// ─── Tilikartta ────────────────────────────────────────

async function renderTilikartta(valikko) {
  const tilit = await haeTilit()
  renderNakyma(html`
    ${valikko}
    <div style="display:flex;justify-content:flex-end;margin-bottom:var(--s3)">
      <button class="btn btn-secondary btn-sm" id="uusi-tili">+ Uusi tili</button></div>
    <div class="table-wrapper"><table class="table">
      <thead><tr><th>Numero</th><th>Nimi</th><th>Tyyppi</th><th>Ryhmä</th><th>ALV-oletus</th><th></th></tr></thead>
      <tbody id="tili-tbody">${tilit.map(t => html`<tr style="${t.aktiivinen ? '' : 'opacity:0.5'}">
        <td>${t.numero}</td><td>${t.nimi}</td><td>${TYYPIT[t.tyyppi]}</td><td>${t.ryhma}</td>
        <td>${t.alv_oletus === 'ei_vahennysta' ? 'Ei vähennystä' : t.alv_oletus === 'vahennys' ? 'Vähennys' : ''}</td>
        <td><button class="btn btn-ghost btn-sm" data-id="${t.id}">${t.aktiivinen ? 'Muokkaa' : 'Muokkaa'}</button></td></tr>`)}</tbody>
    </table></div>`)
  document.getElementById('uusi-tili')?.addEventListener('click', () => avaaTiliLomake(null, valikko))
  document.getElementById('tili-tbody')?.addEventListener('click', (e) => {
    const b = e.target.closest('[data-id]')
    if (b) avaaTiliLomake(tilit.find(t => t.id === b.dataset.id), valikko)
  })
}

const RYHMAT = {
  vastaavaa: ['aineettomat', 'aineelliset', 'lyhyet_saamiset', 'rahat'],
  oma_paaoma: ['osakepaaoma', 'svop', 'edelliset'],
  vieras_paaoma: ['pitkaaikainen', 'lyhytaikainen'],
  tuotto: ['liikevaihto', 'muut_tuotot', 'rahoitustuotot'],
  kulu: ['materiaalit', 'palkat', 'henkilosivukulut', 'poistot', 'muut_kulut', 'rahoituskulut', 'tuloverot'],
}

function avaaTiliLomake(tili, valikko) {
  avaaModaali(html`
    <h2 class="modal-title">${tili ? 'Muokkaa tiliä' : 'Uusi tili'}</h2>
    <form id="tili-form">
      <div class="form-row">
        <div class="form-group"><label class="form-label">Numero *</label>
          <input class="form-input" type="text" id="ti-numero" pattern="[0-9]{3,6}" required value="${tili?.numero || ''}" /></div>
        <div class="form-group" style="flex:2"><label class="form-label">Nimi *</label>
          <input class="form-input" type="text" id="ti-nimi" maxlength="120" required value="${tili?.nimi || ''}" /></div>
      </div>
      <div class="form-row">
        <div class="form-group"><label class="form-label">Tyyppi</label>
          <select class="form-select" id="ti-tyyppi">${Object.entries(TYYPIT).map(([k, v]) =>
            html`<option value="${k}" ${tili?.tyyppi === k ? 'selected' : ''}>${v}</option>`)}</select></div>
        <div class="form-group"><label class="form-label">Tase-/tuloslaskelmarivi</label>
          <select class="form-select" id="ti-ryhma"></select></div>
        <div class="form-group"><label class="form-label">ALV-oletus</label>
          <select class="form-select" id="ti-alv">
            <option value="">—</option>
            <option value="vahennys" ${tili?.alv_oletus === 'vahennys' ? 'selected' : ''}>Vähennyskelpoinen</option>
            <option value="ei_vahennysta" ${tili?.alv_oletus === 'ei_vahennysta' ? 'selected' : ''}>Ei vähennystä</option>
          </select></div>
      </div>
      ${tili ? html`<label style="font-size:0.875rem"><input type="checkbox" id="ti-aktiivinen" ${tili.aktiivinen ? 'checked' : ''}/> Käytössä</label>` : ''}
      <div id="ti-virhe" class="alert alert-error hidden"></div>
      <div class="modal-footer">
        <button type="button" class="btn btn-secondary" id="ti-peruuta">Peruuta</button>
        <button type="submit" class="btn btn-primary">Tallenna</button>
      </div>
    </form>`)
  const tyyppiEl = document.getElementById('ti-tyyppi')
  const ryhmaEl = document.getElementById('ti-ryhma')
  const paivitaRyhmat = () => {
    ryhmaEl.innerHTML = String(html`${RYHMAT[tyyppiEl.value].map(r => html`<option ${tili?.ryhma === r ? 'selected' : ''}>${r}</option>`)}`)
  }
  tyyppiEl.addEventListener('change', paivitaRyhmat)
  paivitaRyhmat()
  document.getElementById('ti-peruuta').addEventListener('click', suljeModaali)
  document.getElementById('tili-form').addEventListener('submit', async (e) => {
    e.preventDefault()
    const data = {
      numero: document.getElementById('ti-numero').value.trim(),
      nimi: document.getElementById('ti-nimi').value.trim(),
      tyyppi: tyyppiEl.value,
      ryhma: ryhmaEl.value,
      alv_oletus: document.getElementById('ti-alv').value || null,
    }
    try {
      if (tili) await paivitaTili(tili.id, { ...data, aktiivinen: document.getElementById('ti-aktiivinen').checked })
      else await lisaaTili(_kayttajaId, data)
      suljeModaali()
      naytaToast('Tili tallennettu', 'success')
      renderTilikartta(valikko)
    } catch (err) {
      const el = document.getElementById('ti-virhe')
      el.textContent = err.message
      el.classList.remove('hidden')
    }
  })
}

// ─── Muutosloki ────────────────────────────────────────

async function renderLoki(valikko) {
  const loki = await haeMuutosloki(300)
  const kuvaa = (r) => {
    const d = r.uusi || r.vanha || {}
    return d.laskunumero || d.kuvaus || d.selite || d.nimi || d.numero || ''
  }
  renderNakyma(html`
    ${valikko}
    <p style="color:var(--text-2);font-size:0.875rem;margin-bottom:var(--s3)">
      Kaikki tietoihin tehdyt muutokset tallentuvat pysyvästi (300 viimeisintä). Lokia ei voi muokata.</p>
    <div class="table-wrapper"><table class="table">
      <thead><tr><th>Aika</th><th>Taulu</th><th>Toiminto</th><th>Kohde</th></tr></thead>
      <tbody>${loki.map(r => html`<tr><td>${formatoiAika(r.aika)}</td><td>${r.taulu}</td>
        <td>${{ INSERT: 'Lisäys', UPDATE: 'Muutos', DELETE: 'Poisto' }[r.toiminto]}</td><td>${kuvaa(r)}</td></tr>`)}</tbody>
    </table></div>`)
}
