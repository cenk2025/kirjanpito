// ═══════════════════════════════════════════════════════
// KOJELAUTA — Tilanne kirjanpidosta ja tehtävälista
// ═══════════════════════════════════════════════════════

import {
  haeLaskut, haeTilikaudet, haeTilisaldot, haePankkitapahtumat, haeKulut, haeProfiili,
} from '../utils/supabase.js'
import { formatoiEuro, formatoiPaiva, tilaHTML, efektiivinenTila, KUUKAUDET_LYHYT, isoTanaan } from '../utils/formatters.js'
import { laskunSummat, haeALVKaudet } from '../utils/laskuri.js'
import { html } from '../utils/html.js'
import { renderNakyma, asetaTopbarToiminnot, virheNakyma, naytaLatausRuutu } from './ui.js'
import { navigoi } from './router.js'
import { laskeTuloslaskelma } from './raportit.js'

export async function renderKojelauta(kayttajaId) {
  asetaTopbarToiminnot('')
  naytaLatausRuutu()
  try {
    const tanaan = isoTanaan()
    const [laskut, kaudet, pankki, profiili] = await Promise.all([
      haeLaskut(), haeTilikaudet(), haePankkitapahtumat('avoin'), haeProfiili(kayttajaId),
    ])
    const kausi = kaudet.find(k => k.alku <= tanaan && k.loppu >= tanaan) || kaudet[0]
    const [saldot, kulut] = kausi
      ? await Promise.all([haeTilisaldot(kausi.alku, kausi.loppu), haeKulut(kausi.alku, kausi.loppu)])
      : [[], []]
    renderNakyma(rakenna({ laskut, kausi, saldot, kulut, pankki, profiili: profiili || {}, tanaan }))
    document.querySelectorAll('[data-lasku]').forEach(r => r.addEventListener('click', () => navigoi(`laskut/${r.dataset.lasku}`)))
  } catch (err) {
    virheNakyma('Kojelaudan lataus epäonnistui', err)
  }
}

function rakenna({ laskut, kausi, saldot, kulut, pankki, profiili, tanaan }) {
  const saldo = (nro) => Number(saldot.find(s => s.numero === nro)?.loppusaldo || 0)
  const tulos = laskeTuloslaskelma(saldot)
  const alvVelka = -(saldo('2939') + saldo('1763') + saldo('2935') + saldo('1765'))
  const myohassa = laskut.filter(l => efektiivinenTila(l) === 'myohassa')
  const luonnokset = laskut.filter(l => l.tila === 'luonnos')
  const ilmanTositetta = kulut.filter(k => k.tila !== 'peruttu' && !k.liitteet?.length)
  const vanhat = laskut.filter(l => ['lahetetty', 'maksettu'].includes(l.tila) && !l.tosite_id)
  const seuraavaAlv = profiili.alv_rekisteroity === false ? null
    : [...haeALVKaudet(Number(tanaan.slice(0, 4)) - 1, profiili.alv_kausi), ...haeALVKaudet(Number(tanaan.slice(0, 4)), profiili.alv_kausi)]
      .find(k => k.erapaiva >= tanaan)

  const kk = Array(12).fill(0)
  const vuosi = tanaan.slice(0, 4)
  for (const l of laskut) {
    if (l.tila === 'luonnos' || !l.laskupaiva?.startsWith(vuosi)) continue
    kk[Number(l.laskupaiva.slice(5, 7)) - 1] += laskunSummat(l).verotonYhteensa
  }
  const max = Math.max(...kk, 1)
  const puuttuvat = ['yritys_nimi', 'y_tunnus', 'osoite', 'iban', 'kotipaikka'].filter(k => !profiili[k])

  const tehtavat = [
    puuttuvat.length && { teksti: `Täydennä yritystiedot (${puuttuvat.join(', ')})`, linkki: '#asetukset' },
    vanhat.length && { teksti: `${vanhat.length} vanhaa laskua ei ole vielä kirjattu pääkirjaan`, linkki: '#asetukset' },
    pankki.length && { teksti: `${pankki.length} pankkitapahtumaa kirjaamatta`, linkki: '#pankki' },
    myohassa.length && { teksti: `${myohassa.length} laskua myöhässä`, linkki: '#laskut' },
    ilmanTositetta.length && { teksti: `${ilmanTositetta.length} kulua ilman tositetta`, linkki: '#kulut' },
    luonnokset.length && { teksti: `${luonnokset.length} laskuluonnosta lähettämättä`, linkki: '#laskut' },
    seuraavaAlv && { teksti: `ALV-ilmoitus ${seuraavaAlv.nimi}: eräpäivä ${formatoiPaiva(seuraavaAlv.erapaiva)}`, linkki: '#raportit/alv' },
  ].filter(Boolean)

  return html`
    <div class="section-header"><div>
      <h1 class="section-title">${profiili.yritys_nimi || 'Kojelauta'}</h1>
      <p class="section-sub">${kausi ? `Tilikausi ${formatoiPaiva(kausi.alku)} – ${formatoiPaiva(kausi.loppu)}` : 'Ei tilikautta'}</p>
    </div></div>

    <div class="kpi-grid">
      <div class="kpi-card"><div class="kpi-label">Pankkitili (kirjanpito)</div><div class="kpi-value">${formatoiEuro(saldo('1910'))}</div></div>
      <div class="kpi-card"><div class="kpi-label">Myyntisaamiset</div><div class="kpi-value">${formatoiEuro(saldo('1701'))}</div>
        <div class="kpi-change">${myohassa.length ? `${myohassa.length} myöhässä` : 'Ei myöhässä olevia'}</div></div>
      <div class="kpi-card"><div class="kpi-label">Liikevaihto (tilikausi)</div><div class="kpi-value">${formatoiEuro(tulos.liikevaihto)}</div></div>
      <div class="kpi-card"><div class="kpi-label">Tulos ennen veroja</div><div class="kpi-value">${formatoiEuro(tulos.ennen_veroja)}</div></div>
      <div class="kpi-card"><div class="kpi-label">ALV-velka</div><div class="kpi-value">${formatoiEuro(alvVelka)}</div>
        <div class="kpi-change">${alvVelka < 0 ? 'Palautettavaa' : 'Maksettavaa'}</div></div>
    </div>

    <div class="dashboard-grid" style="margin-top:var(--s5)">
      <div class="dashboard-main">
        <div class="card">
          <div class="card-header"><div class="card-title">Laskutus ${vuosi} (veroton)</div></div>
          <div class="chart-bars">
            ${kk.map((v, i) => html`<div class="chart-bar-wrap" title="${KUUKAUDET_LYHYT[i]}: ${formatoiEuro(v)}">
              <div class="chart-bar${i === Number(tanaan.slice(5, 7)) - 1 ? ' current' : ''}" style="height:${Math.max(v / max * 100, 2)}%"></div>
              <div class="chart-label">${KUUKAUDET_LYHYT[i]}</div></div>`)}
          </div>
        </div>
        <div class="card" style="margin-top:var(--s4)">
          <div class="card-header"><div class="card-title">Viimeisimmät laskut</div><a href="#laskut" style="font-size:0.85rem">Kaikki →</a></div>
          <table class="table"><tbody>
            ${laskut.slice(0, 8).map(l => html`<tr style="cursor:pointer" data-lasku="${l.id}">
              <td><strong>${l.laskunumero || 'Luonnos'}</strong></td><td>${l.ostaja?.nimi || l.asiakas?.nimi || '—'}</td>
              <td>${formatoiPaiva(l.laskupaiva)}</td><td style="text-align:right">${formatoiEuro(laskunSummat(l).verollinenYhteensa)}</td>
              <td>${tilaHTML(efektiivinenTila(l))}</td></tr>`)}
            ${laskut.length === 0 ? html`<tr><td style="text-align:center;color:var(--text-3);padding:2rem">Ei laskuja</td></tr>` : ''}
          </tbody></table>
        </div>
      </div>
      <div class="dashboard-side">
        <div class="card">
          <div class="card-title" style="margin-bottom:var(--s3)">Tehtävät</div>
          ${tehtavat.length ? html`<ul style="list-style:none;line-height:2.1">
            ${tehtavat.map(t => html`<li>• <a href="${t.linkki}">${t.teksti}</a></li>`)}</ul>`
            : html`<p style="color:var(--text-2)">✓ Kaikki ajan tasalla.</p>`}
        </div>
      </div>
    </div>`
}
