import { describe, it, expect } from 'vitest'
import {
  laskeLaskuSummat, eritteleALV, laskeALV, laskeViitenumero, tarkistaViitenumero, muotoileViitenumero,
  rfViite, tarkistaIBAN, rakennaPankkiviivakoodi, rakennaSepaQR, haeALVKaudet, alvKannatPaivalle,
  laskeYEL, laskeYhteisovero, laskeErapaiva, skaalaa, laskeViivastyskorko, isoTanaanPaikallinen,
} from '../src/utils/laskuri.js'
import { validoiYTunnus } from '../src/utils/formatters.js'

describe('laskun summat', () => {
  it('0 % ALV säilyy nollana (vanha virhe: 0 → 25,5 %)', () => {
    const s = laskeLaskuSummat([{ maara: 1, yksikkohinta: 100, alv_kanta: 0 }])
    expect(s.alvYhteensa).toBe(0)
    expect(s.verollinenYhteensa).toBe(100)
  })

  it('vastaa tietokannan laskentaa (sama kuin SQL-testissä)', () => {
    const s = laskeLaskuSummat([
      { maara: 1, yksikkohinta: 900, alv_kanta: 25.5 },
      { maara: 3, yksikkohinta: 33.33, alv_kanta: 0 },
    ])
    expect(s.verotonYhteensa).toBe(999.99)
    expect(s.alvYhteensa).toBe(229.5)
    expect(s.verollinenYhteensa).toBe(1229.49)
    expect(s.alvErittely.map(e => e.kanta)).toEqual([25.5, 0])
  })

  it('pyöristää ALV:n verokannoittain eikä riveittäin', () => {
    // 3 × 0,10 € @ 25,5 %: riveittäin 3 × 0,03 = 0,09; oikein round(0,30 × 0,255) = 0,08
    const rivit = [1, 2, 3].map(() => ({ maara: 1, yksikkohinta: 0.1, alv_kanta: 25.5 }))
    expect(laskeLaskuSummat(rivit).alvYhteensa).toBe(0.08)
  })

  it('käsittelee liukulukuongelmat (1,005 → 1,01)', () => {
    expect(laskeLaskuSummat([{ maara: 1, yksikkohinta: '1.005', alv_kanta: 0 }]).verotonYhteensa).toBe(1.01)
    expect(skaalaa('0.1', 2) + skaalaa('0.2', 2)).toBe(30n)
  })

  it('hyvityslaskun negatiiviset rivit', () => {
    const s = laskeLaskuSummat([{ maara: -10, yksikkohinta: 100, alv_kanta: 25.5 }])
    expect(s.verollinenYhteensa).toBe(-1255)
  })
})

describe('ALV', () => {
  it('erottelee ALV:n verollisesta summasta', () => {
    expect(eritteleALV(124, 25.5)).toEqual({ verotonHinta: 98.8, alv: 25.2 })
    expect(eritteleALV(57, 14)).toEqual({ verotonHinta: 50, alv: 7 })
    expect(eritteleALV(10, 0)).toEqual({ verotonHinta: 10, alv: 0 })
  })

  it('laskee käännetyn verovelvollisuuden veron', () => {
    expect(laskeALV(200, 25.5).alv).toBe(51)
  })

  it('verokannat toimituspäivän mukaan', () => {
    expect(alvKannatPaivalle('2026-03-01').map(k => k.arvo)).toEqual([25.5, 13.5, 10, 0])
    expect(alvKannatPaivalle('2025-06-01').map(k => k.arvo)).toEqual([25.5, 14, 10, 0])
    expect(alvKannatPaivalle('2024-08-31').map(k => k.arvo)).toEqual([24, 14, 10, 0])
  })

  it('verokausien eräpäivät', () => {
    const q = haeALVKaudet(2026, 'quarterly')
    expect(q[0].erapaiva).toBe('2026-05-12')
    expect(q[1].erapaiva).toBe('2026-08-12')
    expect(q[2].erapaiva).toBe('2026-11-12')
    expect(q[3].erapaiva).toBe('2027-02-12')
    const kk = haeALVKaudet(2026, 'monthly')
    expect(kk[0].erapaiva).toBe('2026-03-12')
    expect(kk[1].loppu).toBe('2026-02-28')
    // 12.12.2026 on lauantai → maanantai 14.12.
    expect(kk[9].erapaiva).toBe('2026-12-14')
    expect(haeALVKaudet(2026, 'annually')[0].erapaiva).toBe('2027-02-26')
  })
})

describe('viitteet, IBAN ja viivakoodi', () => {
  it('viitenumero 7-3-1', () => {
    expect(laskeViitenumero('123456')).toBe('1234561')
    expect(laskeViitenumero('2026-001')).toBe('20260011')
    expect(tarkistaViitenumero('1234561')).toBe(true)
    expect(tarkistaViitenumero('1234562')).toBe(false)
    expect(muotoileViitenumero('868516259619897')).toBe('86851 62596 19897')
  })

  it('RF-viite (ISO 11649)', () => {
    expect(rfViite('539007547034')).toBe('RF18539007547034')
  })

  it('IBAN-tarkiste', () => {
    expect(tarkistaIBAN('FI21 1234 5600 0007 85')).toBe(true)
    expect(tarkistaIBAN('FI21 1234 5600 0007 86')).toBe(false)
  })

  it('pankkiviivakoodi versio 4 (Finanssialan esimerkki)', () => {
    expect(rakennaPankkiviivakoodi('FI79 4405 2020 0360 82', 4883.15, '86851 62596 19897', '2010-06-12'))
      .toBe('479440520200360820048831500000000868516259619897100612')
  })

  it('viivakoodia ei muodosteta liian suurelle tai negatiiviselle summalle', () => {
    expect(rakennaPankkiviivakoodi('FI2112345600000785', 1000000, '1234561', '2026-01-01')).toBeNull()
    expect(rakennaPankkiviivakoodi('FI2112345600000785', -5, '1234561', '2026-01-01')).toBeNull()
  })

  it('EPC QR -sisältö', () => {
    const qr = rakennaSepaQR('VOON IQ Oy', 'FI21 1234 5600 0007 85', 1229.49, '20260011', 'NDEAFIHH').split('\n')
    expect(qr.slice(0, 8)).toEqual(['BCD', '002', '1', 'SCT', 'NDEAFIHH', 'VOON IQ Oy', 'FI2112345600000785', 'EUR1229.49'])
    expect(qr[9]).toMatch(/^RF\d{2}20260011$/)
  })

  it('Y-tunnus', () => {
    expect(validoiYTunnus('0208201-1')).toBe(true)
    expect(validoiYTunnus('0208201-2')).toBe(false)
  })
})

describe('verot ja päivät', () => {
  it('YEL 2026', () => {
    expect(laskeYEL(30000).vuosimaksu).toBe(7320)
    expect(laskeYEL(30000, true).prosentti).toBe(19.03)
    expect(laskeYEL(5000).alleAlarajan).toBe(true)
  })

  it('yhteisövero 20 %', () => {
    expect(laskeYhteisovero(10000, 100).vero).toBe(2020)
    expect(laskeYhteisovero(-5000).vero).toBe(0)
  })

  it('eräpäivä ilman aikavyöhykevirhettä', () => {
    expect(laskeErapaiva('2026-12-25', 14)).toBe('2027-01-08')
    expect(isoTanaanPaikallinen(new Date(2026, 0, 1, 0, 30))).toBe('2026-01-01')
  })

  it('viivästyskorko', () => {
    expect(laskeViivastyskorko(1000, '2026-01-01', '2026-01-31', 2)).toEqual({ paivat: 30, korko: 10, summa: 8.22 })
  })
})
