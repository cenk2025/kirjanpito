// ═══════════════════════════════════════════════════════
// VEROT JA MÄÄRÄAJAT — Oy:n yhteisöveroarvio, YEL ja verokalenteri
// ═══════════════════════════════════════════════════════

import { haeProfiili, haeTilikaudet, haeTilisaldot } from '../utils/supabase.js'
import { formatoiEuro, formatoiPaiva, formatoiProsentti, isoTanaan } from '../utils/formatters.js'
import {
  laskeYEL, laskeYhteisovero, YEL_RAJAT, YEL_PROSENTTI, YEL_VUOSI, YHTEISOVERO_PROSENTTI,
  haeALVKaudet, lisaaPaivia,
} from '../utils/laskuri.js'
import { html } from '../utils/html.js'
import { renderNakyma, asetaTopbarToiminnot, virheNakyma, naytaLatausRuutu } from './ui.js'
import { laskeTuloslaskelma } from './raportit.js'

function lisaaKuukausia(iso, kk) {
  const [v, k, p] = iso.split('-').map(Number)
  const d = new Date(Date.UTC(v, k - 1 + kk + 1, 0))      // kuukauden viimeinen
  return new Date(Date.UTC(v, k - 1 + kk, Math.min(p, d.getUTCDate()))).toISOString().slice(0, 10)
}

export async function renderVerolaskelma(kayttajaId) {
  asetaTopbarToiminnot('')
  naytaLatausRuutu()
  try {
    const [p, kaudet] = await Promise.all([haeProfiili(kayttajaId), haeTilikaudet()])
    const tanaan = isoTanaan()
    const kausi = kaudet.find(k => k.alku <= tanaan && k.loppu >= tanaan) || kaudet[0]
    const saldot = kausi ? await haeTilisaldot(kausi.alku, kausi.loppu) : []
    renderSivu(p || {}, kausi, saldot, kaudet)
  } catch (err) {
    virheNakyma('Verolaskelman lataus epäonnistui', err)
  }
}

function renderSivu(p, kausi, saldot, kaudet) {
  const tulos = laskeTuloslaskelma(saldot)
  const t7600 = saldot.find(s => s.numero === '7600')
  const edustus = t7600 ? Number(t7600.debet) - Number(t7600.kredit) : 0
  const lisays = Math.round(edustus * 0.5 * 100) / 100     // edustusmenoista 50 % vähennyskelvotonta (EVL 8 § 1 mom. 8 k.)
  const vero = laskeYhteisovero(tulos.ennen_veroja, lisays, 0)
  const yel = laskeYEL(p.yel_tyotulo || 0, p.uusi_yrittaja)
  const tanaan = isoTanaan()

  // Verokalenteri seuraavalle 12 kuukaudelle
  const vuosi = Number(tanaan.slice(0, 4))
  const tapahtumat = []
  if (p.alv_rekisteroity !== false) {
    for (const v of [vuosi - 1, vuosi, vuosi + 1]) {
      for (const k of haeALVKaudet(v, p.alv_kausi || 'quarterly')) {
        tapahtumat.push({ pvm: k.erapaiva, teksti: `ALV-ilmoitus ja maksu: ${k.nimi}`, linkki: '#raportit/alv' })
      }
    }
  }
  for (const k of kaudet) {
    tapahtumat.push({ pvm: lisaaKuukausia(k.loppu, 4), teksti: `Tilinpäätös valmis ja veroilmoitus 6B (tilikausi ${formatoiPaiva(k.alku)}–${formatoiPaiva(k.loppu)})`, linkki: '#raportit/tilinpaatos' })
    tapahtumat.push({ pvm: lisaaKuukausia(k.loppu, 6), teksti: 'Varsinainen yhtiökokous viimeistään (OYL 5:3)' })
    tapahtumat.push({ pvm: lisaaKuukausia(k.loppu, 8), teksti: 'Tilinpäätös PRH:lle viimeistään (KPL 3:9)' })
  }
  tapahtumat.push({ pvm: `${vuosi}-01-31`, teksti: 'Vuosi-ilmoitus tulorekisteriin (jos palkkoja / työkorvauksia)' })
  const tulevat = tapahtumat.filter(t => t.pvm >= tanaan && t.pvm <= lisaaPaivia(tanaan, 400)).sort((a, b) => a.pvm.localeCompare(b.pvm))

  renderNakyma(html`
    <div class="section-header"><div><h1 class="section-title">Verot ja määräajat</h1>
      <p class="section-sub">${p.yritys_nimi || 'Osakeyhtiö'} · arviot perustuvat kirjanpidon lukuihin</p></div></div>
    <div class="alert alert-warning" style="margin-bottom:var(--s5)">Arviot ovat suuntaa antavia. Lopullisen veron vahvistaa Verohallinto.
      Tarkista ennakkoveron määrä OmaVerossa ja hae muutosta, jos tulos poikkeaa arviosta.</div>

    <div class="tax-summary-grid">
      <div class="tax-card">
        <div class="tax-card-title">Yhteisövero (arvio, ${YHTEISOVERO_PROSENTTI} %)</div>
        <div class="tax-amount">${formatoiEuro(vero.vero)}</div>
        <div class="tax-detail">Tulos ennen veroja ${formatoiEuro(tulos.ennen_veroja)}
          ${lisays ? html`<br>+ vähennyskelvoton osuus edustuskuluista ${formatoiEuro(lisays)}` : ''}
          <br>Verotettava tulo ${formatoiEuro(vero.verotettava)}
          ${kausi ? html`<br>Tilikausi ${formatoiPaiva(kausi.alku)}–${formatoiPaiva(kausi.loppu)}` : ''}</div>
      </div>
      <div class="tax-card">
        <div class="tax-card-title">YEL ${YEL_VUOSI} (${formatoiProsentti(yel.prosentti, 2)})</div>
        <div class="tax-amount">${formatoiEuro(yel.kuukausimaksu)} / kk</div>
        <div class="tax-detail">YEL-työtulo ${formatoiEuro(p.yel_tyotulo || 0)} · ${formatoiEuro(yel.vuosimaksu)} / v
          ${yel.alennettu ? html`<br>Aloittavan yrittäjän alennus 22 % (48 kk)` : ''}
          ${yel.alleAlarajan ? html`<br><strong>Työtulo on alle alarajan ${formatoiEuro(YEL_RAJAT.MIN)}: vakuutusta ei voi ottaa.</strong>` : ''}</div>
      </div>
      <div class="tax-card">
        <div class="tax-card-title">Tilikauden tulos</div>
        <div class="tax-amount">${formatoiEuro(tulos.tulos)}</div>
        <div class="tax-detail">Liikevaihto ${formatoiEuro(tulos.liikevaihto)}<br>Liikevoitto ${formatoiEuro(tulos.liikevoitto)}</div>
      </div>
    </div>

    <div class="settings-section" style="margin-top:var(--s5)">
      <h2 class="settings-section-title">YEL-laskuri ${YEL_VUOSI}</h2>
      <p style="color:var(--text-2);font-size:0.875rem;margin-bottom:var(--s3)">
        Osakeyhtiön osakas on YEL-vakuutettu, jos hän työskentelee yhtiössä johtavassa asemassa ja omistaa yli 30 %
        (yksin) tai yli 50 % (perheenjäsenten kanssa). YEL on osakkaan henkilökohtainen vakuutus: jos yhtiö maksaa sen,
        maksu on osakkaalle veronalaista palkkaa (kirjaa palkkana ja ilmoita tulorekisteriin). Maksu ${formatoiProsentti(YEL_PROSENTTI, 2)}
        iästä riippumatta, työtulo ${formatoiEuro(YEL_RAJAT.MIN)} – ${formatoiEuro(YEL_RAJAT.MAX)}.</p>
      <div class="form-row">
        <div class="form-group"><label class="form-label">YEL-työtulo (€/v)</label>
          <input class="form-input" type="number" id="yel-tulo" value="${p.yel_tyotulo || ''}" min="0" step="100" /></div>
        <div class="form-group"><label class="form-label">Aloittava yrittäjä</label>
          <select class="form-select" id="yel-uusi"><option value="0">Ei</option><option value="1" ${p.uusi_yrittaja ? 'selected' : ''}>Kyllä (−22 %)</option></select></div>
      </div>
      <div class="yel-result" id="yel-tulos"></div>
    </div>

    <div class="settings-section">
      <h2 class="settings-section-title">Tulevat määräajat</h2>
      <table class="table"><tbody>
        ${tulevat.map(t => html`<tr><td style="white-space:nowrap">${formatoiPaiva(t.pvm)}</td>
          <td>${t.linkki ? html`<a href="${t.linkki}">${t.teksti}</a>` : t.teksti}</td></tr>`)}
      </tbody></table>
      <p style="color:var(--text-3);font-size:0.8rem;margin-top:var(--s3);line-height:1.6">
        Lisäksi: yhteenvetoilmoitus EU-myynneistä kuukausittain seuraavan kuukauden 20. päivään mennessä;
        palkoista tulorekisteri-ilmoitus 5 päivän kuluessa maksupäivästä ja työnantajasuoritukset (ennakonpidätykset,
        sairausvakuutusmaksu) seuraavan kuukauden 12. päivään mennessä; ennakkoverot OmaVeron eräpäivinä.
        Pyhäpäiviä ei ole huomioitu eräpäivissä.</p>
    </div>`)

  const paivitaYel = () => {
    const y = laskeYEL(Number(document.getElementById('yel-tulo').value) || 0, document.getElementById('yel-uusi').value === '1')
    document.getElementById('yel-tulos').innerHTML = String(html`
      <div class="yel-row"><span>Maksuprosentti</span><strong>${formatoiProsentti(y.prosentti, 2)}</strong></div>
      <div class="yel-row"><span>Vuosimaksu</span><strong>${formatoiEuro(y.vuosimaksu)}</strong></div>
      <div class="yel-row"><span>Kuukausimaksu</span><strong>${formatoiEuro(y.kuukausimaksu)}</strong></div>
      ${y.alleAlarajan ? html`<div class="yel-row"><span>Huom.</span><strong>Alle alarajan</strong></div>` : ''}`)
  }
  document.getElementById('yel-tulo')?.addEventListener('input', paivitaYel)
  document.getElementById('yel-uusi')?.addEventListener('change', paivitaYel)
  paivitaYel()
}
