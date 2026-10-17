// ═══════════════════════════════════════════════════════
// LASKUTULOSTUS — Tulostettava lasku / PDF ja maksumuistutus
//
// Lähetetty lasku tulostetaan aina tietokantaan jäädytetyillä
// tiedoilla (myyjä, ostaja, summat), jolloin tuloste vastaa
// kirjanpitoon kirjattua laskua. Luonnoksesta tulostuu esikatselu.
// AVL 209 e §:n pakolliset merkinnät + Oy:n kotipaikka (KRL 22 a §).
// ═══════════════════════════════════════════════════════

import JsBarcode from 'jsbarcode'
import QRCode from 'qrcode'
import { html, raw } from '../utils/html.js'
import {
  laskunSummat, muotoileViitenumero, rakennaPankkiviivakoodi, rakennaSepaQR,
  laskeRivi, laskeViivastyskorko, isoTanaanPaikallinen, rfViite,
} from '../utils/laskuri.js'
import { formatoiEuro, formatoiPaiva, formatoiIBAN, formatoiLuku, MYYNNIN_ALV_KASITTELYT } from '../utils/formatters.js'

const TYYLIT = `
  * { box-sizing: border-box; margin: 0; padding: 0; }
  body { font-family: Arial, Helvetica, sans-serif; font-size: 10pt; color: #111; background: #fff; padding: 14mm 18mm; }
  .header { display: flex; justify-content: space-between; gap: 10mm; padding-bottom: 6mm; border-bottom: 2px solid #111; margin-bottom: 8mm; }
  .yritys { font-size: 18pt; font-weight: bold; margin-bottom: 2mm; }
  .pieni { font-size: 8.5pt; color: #444; line-height: 1.55; }
  .meta { text-align: right; }
  .meta h1 { font-size: 18pt; margin-bottom: 3mm; letter-spacing: 0.04em; }
  .meta td { padding: 0.6mm 0 0.6mm 6mm; font-size: 9.5pt; }
  .meta td:first-child { color: #555; }
  .osapuolet { display: grid; grid-template-columns: 1fr 1fr; gap: 10mm; margin-bottom: 8mm; }
  .label { font-size: 7.5pt; text-transform: uppercase; letter-spacing: 0.1em; color: #777; margin-bottom: 1.5mm; }
  .nimi { font-size: 11pt; font-weight: bold; margin-bottom: 1mm; }
  table.rivit { width: 100%; border-collapse: collapse; margin-bottom: 5mm; }
  table.rivit th { background: #f2f2f2; padding: 2.5mm 3mm; text-align: left; font-size: 8.5pt; border-bottom: 1px solid #bbb; }
  table.rivit td { padding: 2mm 3mm; border-bottom: 1px solid #eee; font-size: 9.5pt; }
  .oikea { text-align: right; }
  .summat { width: 95mm; margin-left: auto; border-collapse: collapse; }
  .summat td { padding: 1.2mm 3mm; }
  .summat .yht td { font-weight: bold; font-size: 12pt; border-top: 2px solid #111; padding-top: 2.5mm; }
  .huom { margin-top: 5mm; padding: 3mm 4mm; border: 1px solid #111; font-weight: bold; font-size: 9.5pt; }
  .lisa { margin-top: 5mm; padding: 3mm 4mm; background: #f7f7f7; font-size: 9pt; color: #333; white-space: pre-line; }
  .maksu { margin-top: 8mm; padding-top: 5mm; border-top: 2px solid #111; display: grid; grid-template-columns: repeat(4, 1fr); gap: 4mm; }
  .maksu strong { font-size: 10.5pt; }
  .koodit { margin-top: 6mm; display: flex; gap: 8mm; align-items: flex-end; }
  .viivakoodi svg { width: 105mm; height: 13mm; display: block; }
  .viivakoodi .nro { font-family: 'Courier New', monospace; font-size: 7.5pt; margin-top: 1mm; letter-spacing: 0.03em; }
  .qr svg { width: 26mm; height: 26mm; display: block; }
  .alaviite { margin-top: 10mm; padding-top: 3mm; border-top: 1px solid #ddd; font-size: 7.5pt; color: #666; text-align: center; line-height: 1.6; }
  .vesileima { position: fixed; top: 40%; left: 10%; font-size: 64pt; color: rgba(200,0,0,0.12); transform: rotate(-25deg); font-weight: bold; pointer-events: none; }
  @media print { body { padding: 0; } @page { margin: 14mm 16mm; } }
`

function viivakoodiSvg(koodi) {
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg')
  JsBarcode(svg, koodi, { format: 'CODE128C', width: 1, height: 40, displayValue: false, margin: 0 })
  svg.setAttribute('preserveAspectRatio', 'none')
  return svg.outerHTML
}

function osoite(o) {
  return [o?.osoite, [o?.postinumero, o?.kaupunki].filter(Boolean).join(' '),
    o?.maa && o.maa !== 'FI' ? o.maa : ''].filter(Boolean)
}

function avaaTulostus(otsikko, runko) {
  const ikkuna = window.open('', '_blank', 'width=900,height=1000')
  if (!ikkuna) throw new Error('Selain esti tulostusikkunan. Salli ponnahdusikkunat tälle sivulle.')
  ikkuna.document.open()
  ikkuna.document.write(String(html`<!DOCTYPE html><html lang="fi"><head><meta charset="UTF-8" />
    <title>${otsikko}</title><style>${raw(TYYLIT)}</style></head><body>${runko}</body></html>`))
  ikkuna.document.close()
  ikkuna.focus()
  setTimeout(() => ikkuna.print(), 400)
}

/** Yleinen raporttituloste (tuloslaskelma, tase, ALV-laskelma) */
export function tulostaRaportti(otsikko, runko) {
  avaaTulostus(otsikko, html`
    <style>table { width: 100%; border-collapse: collapse; } td, th { padding: 1.5mm 2mm; font-size: 9.5pt; text-align: left; }
      th { border-bottom: 1px solid #999; } .oikea { text-align: right; } .summa td { font-weight: bold; border-top: 1px solid #111; }
      .otsikko td { font-weight: bold; padding-top: 4mm; } h1 { font-size: 16pt; margin-bottom: 2mm; } h2 { font-size: 12pt; margin: 6mm 0 2mm; }
      .sisennys td:first-child { padding-left: 8mm; } .allekirjoitus { margin-top: 18mm; display: grid; grid-template-columns: 1fr 1fr; gap: 15mm; }
      .allekirjoitus div { border-top: 1px solid #111; padding-top: 2mm; font-size: 9pt; }</style>
    ${runko}`)
}

/**
 * @param {object} lasku haeLasku()-tulos
 * @param {object} profiili luonnoksen esikatselua varten (lähetetyllä käytetään lasku.myyja)
 * @param {object} [alkuperainen] hyvityslaskun alkuperäinen lasku
 */
export async function tulostalasku(lasku, profiili = {}, alkuperainen = null) {
  if (!lasku) return
  const luonnos = lasku.tila === 'luonnos'
  const hyvitys = lasku.tyyppi === 'hyvitys'
  const m = lasku.myyja || {
    nimi: profiili.yritys_nimi, y_tunnus: profiili.y_tunnus,
    alv_tunnus: profiili.alv_rekisteroity === false ? null : (profiili.alv_tunnus || (profiili.y_tunnus ? 'FI' + profiili.y_tunnus.replace('-', '') : '')),
    alv_rekisteroity: profiili.alv_rekisteroity !== false,
    kotipaikka: profiili.kotipaikka, osoite: profiili.osoite, postinumero: profiili.postinumero,
    kaupunki: profiili.kaupunki, sahkoposti: profiili.sahkoposti, puhelin: profiili.puhelin,
    kotisivu: profiili.kotisivu, iban: profiili.iban, bic: profiili.bic,
    viivastyskorko: profiili.viivastyskorko, huomautusaika: profiili.huomautusaika,
  }
  const o = lasku.ostaja || lasku.asiakas || {}
  const summat = laskunSummat(lasku)
  const avoin = Math.round((summat.verollinenYhteensa - Number(lasku.maksettu_summa || 0)) * 100) / 100
  const kasittely = MYYNNIN_ALV_KASITTELYT[lasku.alv_kasittely] || MYYNNIN_ALV_KASITTELYT.normaali

  const maksettava = !hyvitys && !luonnos && avoin > 0
  const viivakoodi = maksettava ? rakennaPankkiviivakoodi(m.iban, avoin, lasku.viitenumero, lasku.erapaiva) : null
  const qrSisalto = maksettava ? rakennaSepaQR(m.nimi, m.iban, avoin, lasku.viitenumero, m.bic) : null
  const qrSvg = qrSisalto ? await QRCode.toString(qrSisalto, { type: 'svg', errorCorrectionLevel: 'M', margin: 0 }) : null

  const rivit = (lasku.rivit || []).map(r => {
    const s = laskeRivi(r.maara, r.yksikkohinta, r.alv_kanta)
    return html`<tr>
      <td>${r.kuvaus}</td>
      <td class="oikea">${formatoiLuku(r.maara, Number(r.maara) % 1 ? 2 : 0)} ${r.yksikko || 'kpl'}</td>
      <td class="oikea">${formatoiEuro(r.yksikkohinta)}</td>
      <td class="oikea">${formatoiLuku(r.alv_kanta, Number(r.alv_kanta) % 1 ? 1 : 0)} %</td>
      <td class="oikea">${formatoiEuro(s.verotonYhteensa)}</td>
    </tr>`
  })

  const erittely = summat.alvErittely.map(e => html`<tr>
    <td>ALV ${formatoiLuku(e.kanta, e.kanta % 1 ? 1 : 0)} % (peruste ${formatoiEuro(e.veroton)})</td>
    <td class="oikea">${formatoiEuro(e.alv)}</td></tr>`)

  const otsikko = hyvitys ? 'HYVITYSLASKU' : 'LASKU'
  const runko = html`
    ${luonnos ? html`<div class="vesileima">LUONNOS</div>` : ''}
    <div class="header">
      <div>
        <div class="yritys">${m.nimi || ''}</div>
        <div class="pieni">
          ${osoite(m).map(r => html`${r}<br>`)}
          ${m.sahkoposti ? html`${m.sahkoposti}<br>` : ''}${m.puhelin ? html`${m.puhelin}<br>` : ''}
        </div>
      </div>
      <div class="meta">
        <h1>${otsikko}</h1>
        <table>
          <tr><td>Laskun numero</td><td><strong>${luonnos ? '(annetaan lähetettäessä)' : lasku.laskunumero}</strong></td></tr>
          <tr><td>Laskun päiväys</td><td>${formatoiPaiva(lasku.laskupaiva)}</td></tr>
          <tr><td>Toimituspäivä</td><td>${formatoiPaiva(lasku.toimituspaiva || lasku.laskupaiva)}</td></tr>
          ${!hyvitys ? html`
            <tr><td>Eräpäivä</td><td><strong>${formatoiPaiva(lasku.erapaiva)}</strong></td></tr>
            ${lasku.maksuehto !== null && lasku.maksuehto !== undefined ? html`<tr><td>Maksuehto</td><td>${lasku.maksuehto} pv netto</td></tr>` : ''}
            ${lasku.viitenumero ? html`<tr><td>Viitenumero</td><td><strong>${muotoileViitenumero(lasku.viitenumero)}</strong></td></tr>` : ''}` : ''}
          ${hyvitys && alkuperainen ? html`<tr><td>Hyvitettävä lasku</td><td>${alkuperainen.laskunumero} (${formatoiPaiva(alkuperainen.laskupaiva)})</td></tr>` : ''}
        </table>
      </div>
    </div>

    <div class="osapuolet">
      <div>
        <div class="label">Laskuttaja</div>
        <div class="nimi">${m.nimi || ''}</div>
        <div class="pieni">
          ${m.y_tunnus ? html`Y-tunnus ${m.y_tunnus}<br>` : ''}
          ${m.alv_rekisteroity !== false && m.alv_tunnus ? html`ALV-tunniste ${m.alv_tunnus}<br>` : ''}
          ${m.kotipaikka ? html`Kotipaikka ${m.kotipaikka}` : ''}
        </div>
      </div>
      <div>
        <div class="label">Ostaja</div>
        <div class="nimi">${o.nimi || ''}</div>
        <div class="pieni">
          ${o.yhteyshenkilo || o['yhteyshenkilö'] ? html`${o.yhteyshenkilo || o['yhteyshenkilö']}<br>` : ''}
          ${osoite(o).map(r => html`${r}<br>`)}
          ${o.y_tunnus ? html`Y-tunnus ${o.y_tunnus}<br>` : ''}
          ${o.alv_tunnus ? html`ALV-tunniste ${o.alv_tunnus}` : ''}
        </div>
      </div>
    </div>

    <table class="rivit">
      <thead><tr><th>Kuvaus</th><th class="oikea">Määrä</th><th class="oikea">À-hinta (veroton)</th>
        <th class="oikea">ALV %</th><th class="oikea">Yhteensä (veroton)</th></tr></thead>
      <tbody>${rivit}</tbody>
    </table>

    <table class="summat">
      <tr><td>Veroton yhteensä</td><td class="oikea">${formatoiEuro(summat.verotonYhteensa)}</td></tr>
      ${erittely}
      <tr><td>Arvonlisävero yhteensä</td><td class="oikea">${formatoiEuro(summat.alvYhteensa)}</td></tr>
      <tr class="yht"><td>${hyvitys ? 'Hyvitys yhteensä' : 'Yhteensä'}</td><td class="oikea">${formatoiEuro(summat.verollinenYhteensa)}</td></tr>
      ${Number(lasku.maksettu_summa) > 0 && !hyvitys ? html`
        <tr><td>Maksettu</td><td class="oikea">−${formatoiEuro(lasku.maksettu_summa)}</td></tr>
        <tr><td><strong>Maksettavaa</strong></td><td class="oikea"><strong>${formatoiEuro(avoin)}</strong></td></tr>` : ''}
    </table>

    ${kasittely.teksti ? html`<div class="huom">${kasittely.teksti}</div>` : ''}
    ${m.alv_rekisteroity === false ? html`<div class="huom">Myyjä ei ole arvonlisäverovelvollinen (AVL 3 §).</div>` : ''}
    ${lasku.lisatiedot ? html`<div class="lisa">${lasku.lisatiedot}</div>` : ''}

    ${!hyvitys ? html`
      <div class="maksu">
        <div><div class="label">Saajan tilinumero (IBAN)</div><strong>${formatoiIBAN(m.iban) || '—'}</strong></div>
        <div><div class="label">BIC</div><strong>${m.bic || '—'}</strong></div>
        <div><div class="label">Viitenumero</div><strong>${lasku.viitenumero ? muotoileViitenumero(lasku.viitenumero) : '—'}</strong></div>
        <div><div class="label">Eräpäivä / Euro</div><strong>${formatoiPaiva(lasku.erapaiva)} / ${formatoiEuro(maksettava ? avoin : summat.verollinenYhteensa)}</strong></div>
      </div>
      ${viivakoodi || qrSvg ? html`
        <div class="koodit">
          ${viivakoodi ? html`<div class="viivakoodi">${raw(viivakoodiSvg(viivakoodi))}<div class="nro">${viivakoodi}</div></div>` : ''}
          ${qrSvg ? html`<div class="qr">${raw(qrSvg)}</div>` : ''}
        </div>` : ''}
      <p class="pieni" style="margin-top:4mm">
        ${m.viivastyskorko || 'Viivästyskorko korkolain mukaan.'}
        Huomautukset laskusta ${m.huomautusaika || 7} päivän kuluessa.
      </p>` : html`<p class="pieni" style="margin-top:5mm">Hyvitys maksetaan tai vähennetään avoimista laskuista.</p>`}

    <div class="alaviite">
      ${[m.nimi, m.y_tunnus ? 'Y-tunnus ' + m.y_tunnus : '', m.kotipaikka ? 'Kotipaikka ' + m.kotipaikka : '',
         m.sahkoposti, m.kotisivu].filter(Boolean).join(' · ')}
    </div>
  `
  avaaTulostus(`${otsikko} ${lasku.laskunumero || 'luonnos'}`, runko)
}

/** Maksumuistutus erääntyneestä laskusta (korkolaki 4 §, perintälaki 10 e §) */
export function tulostaMaksumuistutus(lasku, profiili, muistutusmaksu = 0) {
  const m = lasku.myyja || {}
  const o = lasku.ostaja || {}
  const avoin = Math.round((Number(lasku.summa_verollinen) - Number(lasku.maksettu_summa || 0)) * 100) / 100
  const tanaan = isoTanaanPaikallinen()
  const korko = laskeViivastyskorko(avoin, lasku.erapaiva, tanaan, profiili?.viitekorko)
  const yhteensa = Math.round((avoin + korko.summa + Number(muistutusmaksu || 0)) * 100) / 100
  const uusiEra = (() => {
    const [v, k, p] = tanaan.split('-').map(Number)
    return new Date(Date.UTC(v, k - 1, p + 14)).toISOString().slice(0, 10)
  })()
  const viivakoodi = rakennaPankkiviivakoodi(m.iban, yhteensa, lasku.viitenumero, uusiEra)

  const runko = html`
    <div class="header">
      <div><div class="yritys">${m.nimi}</div><div class="pieni">${osoite(m).map(r => html`${r}<br>`)}Y-tunnus ${m.y_tunnus}</div></div>
      <div class="meta"><h1>MAKSUMUISTUTUS</h1>
        <table><tr><td>Päiväys</td><td>${formatoiPaiva(tanaan)}</td></tr>
          <tr><td>Uusi eräpäivä</td><td><strong>${formatoiPaiva(uusiEra)}</strong></td></tr></table></div>
    </div>
    <div class="osapuolet"><div>
      <div class="label">Vastaanottaja</div><div class="nimi">${o.nimi}</div>
      <div class="pieni">${osoite(o).map(r => html`${r}<br>`)}</div>
    </div></div>
    <p>Kirjanpitomme mukaan seuraava lasku on erääntynyt maksamatta. Jos lasku on jo maksettu, tämä muistutus on aiheeton.</p>
    <table class="rivit" style="margin-top:5mm">
      <thead><tr><th>Lasku</th><th>Päiväys</th><th>Eräpäivä</th><th class="oikea">Avoinna</th></tr></thead>
      <tbody><tr><td>${lasku.laskunumero}</td><td>${formatoiPaiva(lasku.laskupaiva)}</td>
        <td>${formatoiPaiva(lasku.erapaiva)}</td><td class="oikea">${formatoiEuro(avoin)}</td></tr></tbody>
    </table>
    <table class="summat">
      <tr><td>Avoin pääoma</td><td class="oikea">${formatoiEuro(avoin)}</td></tr>
      <tr><td>Viivästyskorko ${formatoiLuku(korko.korko, 2)} % (${korko.paivat} pv)</td><td class="oikea">${formatoiEuro(korko.summa)}</td></tr>
      ${Number(muistutusmaksu) > 0 ? html`<tr><td>Muistutusmaksu</td><td class="oikea">${formatoiEuro(muistutusmaksu)}</td></tr>` : ''}
      <tr class="yht"><td>Maksettava</td><td class="oikea">${formatoiEuro(yhteensa)}</td></tr>
    </table>
    <div class="maksu">
      <div><div class="label">IBAN</div><strong>${formatoiIBAN(m.iban)}</strong></div>
      <div><div class="label">BIC</div><strong>${m.bic || '—'}</strong></div>
      <div><div class="label">Viitenumero</div><strong>${muotoileViitenumero(lasku.viitenumero)}</strong></div>
      <div><div class="label">RF-viite</div><strong>${rfViite(lasku.viitenumero)}</strong></div>
    </div>
    ${viivakoodi ? html`<div class="koodit"><div class="viivakoodi">${raw(viivakoodiSvg(viivakoodi))}<div class="nro">${viivakoodi}</div></div></div>` : ''}
    <div class="alaviite">${[m.nimi, 'Y-tunnus ' + m.y_tunnus, m.kotipaikka ? 'Kotipaikka ' + m.kotipaikka : '', m.sahkoposti].filter(Boolean).join(' · ')}</div>
  `
  avaaTulostus(`Maksumuistutus ${lasku.laskunumero}`, runko)
}
