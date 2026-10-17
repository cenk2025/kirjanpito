// @vitest-environment happy-dom
import { describe, it, expect } from 'vitest'
import { html, raw, esc } from '../src/utils/html.js'
import { jasennaCamt053, jasennaCsv, etsiLasku, normalisoiViite } from '../src/utils/pankki.js'
import { rakennaFinvoice } from '../src/utils/finvoice.js'
import { laskeTase, laskeTuloslaskelma } from '../src/js/raportit.js'
import { csv } from '../src/js/ui.js'

describe('HTML-escape', () => {
  it('escapettaa interpoloidut arvot', () => {
    const nimi = '<img src=x onerror=alert(1)>"\''
    expect(String(html`<td>${nimi}</td>`)).toBe('<td>&lt;img src=x onerror=alert(1)&gt;&quot;&#39;</td>')
  })
  it('sisäkkäiset templatet ja taulukot', () => {
    const rivit = ['<a>', 'b'].map(x => html`<li>${x}</li>`)
    expect(String(html`<ul>${rivit}</ul>`)).toBe('<ul><li>&lt;a&gt;</li><li>b</li></ul>')
    expect(String(html`${raw('<b>')}${null}${undefined}${false}`)).toBe('<b>')
    expect(esc('`')).toBe('&#96;')
  })
})

describe('CSV-vienti', () => {
  it('neutraloi kaavat ja käyttää desimaalipilkkua', () => {
    const s = csv([['=HYPERLINK("x")', 12.5, 'a;b']])
    expect(s).toBe('﻿"\'=HYPERLINK(""x"")";12,5;"a;b"')
  })
})

const CAMT = `<?xml version="1.0" encoding="UTF-8"?>
<Document xmlns="urn:iso:std:iso:20022:tech:xsd:camt.053.001.02"><BkToCstmrStmt><Stmt>
  <Ntry><Amt Ccy="EUR">1229.49</Amt><CdtDbtInd>CRDT</CdtDbtInd><Sts>BOOK</Sts>
    <BookgDt><Dt>2026-02-12</Dt></BookgDt><AcctSvcrRef>20260212ABC123</AcctSvcrRef>
    <NtryDtls><TxDtls><RltdPties><Dbtr><Nm>Jyväskylän kaupunki</Nm></Dbtr></RltdPties>
      <RmtInf><Strd><CdtrRefInf><Ref>20260011</Ref></CdtrRefInf></Strd></RmtInf></TxDtls></NtryDtls></Ntry>
  <Ntry><Amt Ccy="EUR">9.90</Amt><CdtDbtInd>DBIT</CdtDbtInd><Sts><Cd>BOOK</Cd></Sts>
    <BookgDt><Dt>2026-02-13</Dt></BookgDt><AcctSvcrRef>20260213X</AcctSvcrRef>
    <NtryDtls><TxDtls><RltdPties><Cdtr><Nm>Pankki</Nm></Cdtr></RltdPties>
      <RmtInf><Ustrd>Palvelumaksu</Ustrd></RmtInf></TxDtls></NtryDtls></Ntry>
  <Ntry><Amt Ccy="EUR">5.00</Amt><CdtDbtInd>DBIT</CdtDbtInd><Sts>PDNG</Sts><BookgDt><Dt>2026-02-14</Dt></BookgDt></Ntry>
</Stmt></BkToCstmrStmt></Document>`

describe('tiliotteet', () => {
  it('camt.053', () => {
    const t = jasennaCamt053(CAMT)
    expect(t).toHaveLength(2)
    expect(t[0]).toEqual({ pvm: '2026-02-12', summa: 1229.49, vastapuoli: 'Jyväskylän kaupunki', viite: '20260011',
      viesti: '', arkistointitunnus: '20260212ABC123' })
    expect(t[1].summa).toBe(-9.9)
    expect(t[1].viesti).toBe('Palvelumaksu')
  })

  it('OP-tyyppinen CSV', () => {
    const t = jasennaCsv('Kirjauspäivä;Arvopäivä;Määrä EUROA;Laji;Selitys;Saaja/Maksaja;Saajan tilinumero;Saajan pankin BIC;Viite;Viesti;Arkistointitunnus\n' +
      '12.02.2026;12.02.2026;+1229,49;710;VIITESIIRTO;Jyväskylän kaupunki;;;20260011;;A1\n' +
      '13.02.2026;13.02.2026;-1.234,50;106;TILISIIRTO;"Cloud; Ltd";;;;"Lasku 77";A2\n')
    expect(t).toHaveLength(2)
    expect(t[0]).toMatchObject({ pvm: '2026-02-12', summa: 1229.49, viite: '20260011', arkistointitunnus: 'A1' })
    expect(t[1]).toMatchObject({ summa: -1234.5, vastapuoli: 'Cloud; Ltd', viesti: 'Lasku 77' })
  })

  it('Nordea-tyyppinen CSV', () => {
    const t = jasennaCsv('Kirjauspäivä;Määrä;Maksaja;Maksunsaaja;Nimi;Otsikko;Viitenumero;Valuutta\n' +
      '2026/02/12;-12,50;;;Kahvila;Kortti 1234;;EUR\n')
    expect(t[0]).toMatchObject({ pvm: '2026-02-12', summa: -12.5, viesti: 'Kortti 1234' })
  })

  it('kohdistaa maksun viitteellä (myös RF-muodossa)', () => {
    const laskut = [{ id: 'a', tyyppi: 'lasku', tila: 'lahetetty', viitenumero: '20260011', laskunumero: '2026-001',
      summa_verollinen: 1229.49, maksettu_summa: 0 }]
    expect(etsiLasku({ summa: 100, viite: '20260011' }, laskut)?.id).toBe('a')
    expect(normalisoiViite('RF4320260011')).toBe('20260011')
    expect(etsiLasku({ summa: 1229.49, viite: '', viesti: 'lasku 2026-001' }, laskut)?.id).toBe('a')
    expect(etsiLasku({ summa: -1, viite: '20260011' }, laskut)).toBeNull()
  })
})

describe('Finvoice', () => {
  it('muodostaa XML:n ja escapettaa arvot', () => {
    const xml = rakennaFinvoice({
      tila: 'lahetetty', tyyppi: 'lasku', laskunumero: '2026-001', laskupaiva: '2026-02-01', toimituspaiva: '2026-01-31',
      erapaiva: '2026-02-15', viitenumero: '20260011', maksuehto: 14, alv_kasittely: 'normaali',
      summa_veroton: 999.99, summa_alv: 229.5, summa_verollinen: 1229.49,
      alv_erittely: [{ kanta: 25.5, veroton: 900, alv: 229.5 }, { kanta: 0, veroton: 99.99, alv: 0 }],
      myyja: { nimi: 'VOON IQ Oy', y_tunnus: '1234567-8', alv_tunnus: 'FI12345678', iban: 'FI2112345600000785', bic: 'NDEAFIHH' },
      ostaja: { nimi: 'A & B <Oy>', y_tunnus: '0208201-1' },
      rivit: [{ kuvaus: 'Lisenssi', maara: 1, yksikkohinta: 900, alv_kanta: 25.5 }],
    })
    expect(xml).toContain('<InvoiceTotalVatIncludedAmount AmountCurrencyIdentifier="EUR">1229,49</InvoiceTotalVatIncludedAmount>')
    expect(xml).toContain('<BuyerOrganisationName>A &amp; B &lt;Oy&gt;</BuyerOrganisationName>')
    expect(xml).toContain('<DeliveryDate Format="CCYYMMDD">20260131</DeliveryDate>')
    expect(new DOMParser().parseFromString(xml, 'application/xml').getElementsByTagName('parsererror')).toHaveLength(0)
  })
  it('ei muodosta luonnoksesta', () => {
    expect(() => rakennaFinvoice({ tila: 'luonnos' })).toThrow()
  })
})

describe('tilinpäätöslaskelmat', () => {
  const s = (numero, tyyppi, ryhma, alkusaldo, debet, kredit) =>
    ({ numero, tyyppi, ryhma, alkusaldo, debet, kredit, loppusaldo: alkusaldo + debet - kredit })
  const saldot = [
    s('1910', 'vastaavaa', 'rahat', 2000, 1255, 500),
    s('1701', 'vastaavaa', 'lyhyet_saamiset', 0, 1255, 1255),
    s('2000', 'oma_paaoma', 'osakepaaoma', -2500, 0, 0),
    s('2939', 'vieras_paaoma', 'lyhytaikainen', 0, 0, 255),
    s('3000', 'tuotto', 'liikevaihto', -1000, 0, 1000),
    s('7860', 'kulu', 'muut_kulut', 1500, 500, 0),
  ]
  it('tuloslaskelma', () => {
    const t = laskeTuloslaskelma(saldot)
    expect(t.liikevaihto).toBe(1000)
    expect(t.muut_kulut).toBe(-500)
    expect(t.tulos).toBe(500)
  })
  it('tase täsmää ja edellisten kausien tulos lasketaan', () => {
    const r = laskeTase(saldot)
    expect(r.edelliset).toBe(-500)
    expect(r.tilikauden).toBe(500)
    expect(r.vastaavaa).toBe(r.vastattavaa)
  })
})
