// ═══════════════════════════════════════════════════════
// FINVOICE 3.0 — verkkolaskun XML
//
// Julkinen sektori (kunnat, työllisyysalueet) ja monet yritykset
// vaativat verkkolaskun (laki 241/2019). Tiedosto lähetetään
// verkkolaskuoperaattorin kautta (esim. operaattorin selainpalvelu
// tai API). Sovellus muodostaa XML:n lähetetyn laskun jäädytetyistä
// tiedoista.
// ═══════════════════════════════════════════════════════

import { esc } from './html.js'
import { laskunSummat, rivinVerotonSentit, alvSentit } from './laskuri.js'

const maara = (n) => (Math.round(Number(n) * 100) / 100).toFixed(2).replace('.', ',')
const pvm = (iso) => String(iso || '').replace(/-/g, '')

const VAT_KOODI = { normaali: 'S', eu_palvelu: 'AE', eu_tavara: 'K', vienti: 'G', veroton: 'E' }

function el(nimi, arvo, attr = '') {
  if (arvo === null || arvo === undefined || arvo === '') return ''
  return `<${nimi}${attr}>${esc(arvo)}</${nimi}>`
}

export function rakennaFinvoice(lasku) {
  if (lasku.tila === 'luonnos') throw new Error('Verkkolasku muodostetaan vasta lähetetystä laskusta')
  const m = lasku.myyja || {}
  const o = lasku.ostaja || {}
  const s = laskunSummat(lasku)
  const hyvitys = lasku.tyyppi === 'hyvitys'
  const vatKoodi = VAT_KOODI[lasku.alv_kasittely] || 'S'
  const eur = ' AmountCurrencyIdentifier="EUR"'
  const f = ' Format="CCYYMMDD"'
  const aika = new Date().toISOString().replace(/\.\d+Z$/, '+00:00')
  const ibanM = (m.iban || '').replace(/\s/g, '')

  const rivit = (lasku.rivit || []).map(r => {
    const vt = rivinVerotonSentit(r.maara, r.yksikkohinta)
    const alv = alvSentit(vt, r.alv_kanta)
    return `<InvoiceRow>
    ${el('ArticleName', r.kuvaus)}
    ${el('DeliveredQuantity', String(r.maara).replace('.', ','), ` QuantityUnitCode="${esc(r.yksikko || 'kpl')}"`)}
    ${el('UnitPriceAmount', maara(r.yksikkohinta), eur)}
    ${el('RowVatRatePercent', String(r.alv_kanta).replace('.', ','))}
    ${el('RowVatCode', vatKoodi)}
    ${el('RowVatAmount', maara(Number(alv) / 100), eur)}
    ${el('RowVatExcludedAmount', maara(Number(vt) / 100), eur)}
    ${el('RowAmount', maara(Number(vt + alv) / 100), eur)}
  </InvoiceRow>`
  }).join('\n  ')

  const alvErittely = s.alvErittely.map(e => `<VatSpecificationDetails>
      ${el('VatBaseAmount', maara(e.veroton), eur)}
      ${el('VatRatePercent', String(e.kanta).replace('.', ','))}
      ${el('VatCode', vatKoodi)}
      ${el('VatRateAmount', maara(e.alv), eur)}
    </VatSpecificationDetails>`).join('\n    ')

  return `<?xml version="1.0" encoding="UTF-8"?>
<Finvoice Version="3.0" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance" xsi:noNamespaceSchemaLocation="Finvoice3.0.xsd">
  <MessageTransmissionDetails>
    <MessageSenderDetails>
      ${el('FromIdentifier', m.verkkolaskuosoite || ibanM)}
      ${el('FromIntermediator', m.valittajatunnus)}
    </MessageSenderDetails>
    <MessageReceiverDetails>
      ${el('ToIdentifier', o.verkkolaskuosoite)}
      ${el('ToIntermediator', o.valittajatunnus)}
    </MessageReceiverDetails>
    <MessageDetails>
      ${el('MessageIdentifier', lasku.laskunumero)}
      ${el('MessageTimeStamp', aika)}
    </MessageDetails>
  </MessageTransmissionDetails>
  <SellerPartyDetails>
    ${el('SellerPartyIdentifier', m.y_tunnus)}
    ${el('SellerOrganisationName', m.nimi)}
    ${el('SellerOrganisationTaxCode', m.alv_tunnus)}
    <SellerPostalAddressDetails>
      ${el('SellerStreetName', m.osoite)}
      ${el('SellerTownName', m.kaupunki)}
      ${el('SellerPostCodeIdentifier', m.postinumero)}
      ${el('CountryCode', 'FI')}
    </SellerPostalAddressDetails>
  </SellerPartyDetails>
  <SellerInformationDetails>
    ${el('SellerHomeTownName', m.kotipaikka)}
    ${m.alv_rekisteroity !== false ? el('SellerVatRegistrationText', 'Alv.Rek.') : ''}
    ${el('SellerCommonEmailaddressIdentifier', m.sahkoposti)}
    <SellerAccountDetails>
      ${el('SellerAccountID', ibanM, ' IdentificationSchemeName="IBAN"')}
      ${el('SellerBic', m.bic, ' IdentificationSchemeName="BIC"')}
    </SellerAccountDetails>
  </SellerInformationDetails>
  <BuyerPartyDetails>
    ${el('BuyerPartyIdentifier', o.y_tunnus)}
    ${el('BuyerOrganisationName', o.nimi)}
    ${el('BuyerOrganisationTaxCode', o.alv_tunnus)}
    <BuyerPostalAddressDetails>
      ${el('BuyerStreetName', o.osoite)}
      ${el('BuyerTownName', o.kaupunki)}
      ${el('BuyerPostCodeIdentifier', o.postinumero)}
      ${el('CountryCode', o.maa || 'FI')}
    </BuyerPostalAddressDetails>
  </BuyerPartyDetails>
  ${el('BuyerContactPersonName', o.yhteyshenkilo)}
  <DeliveryDetails>
    ${el('DeliveryDate', pvm(lasku.toimituspaiva || lasku.laskupaiva), f)}
  </DeliveryDetails>
  <InvoiceDetails>
    ${el('InvoiceTypeCode', hyvitys ? 'INV02' : 'INV01')}
    ${el('InvoiceTypeText', hyvitys ? 'HYVITYSLASKU' : 'LASKU')}
    ${el('OriginCode', 'Original')}
    ${el('InvoiceNumber', lasku.laskunumero)}
    ${el('InvoiceDate', pvm(lasku.laskupaiva), f)}
    ${el('InvoiceTotalVatExcludedAmount', maara(s.verotonYhteensa), eur)}
    ${el('InvoiceTotalVatAmount', maara(s.alvYhteensa), eur)}
    ${el('InvoiceTotalVatIncludedAmount', maara(s.verollinenYhteensa), eur)}
    ${alvErittely}
    ${el('InvoiceFreeText', lasku.lisatiedot)}
    <PaymentTermsDetails>
      ${el('PaymentTermsFreeText', lasku.maksuehto !== null && lasku.maksuehto !== undefined ? `${lasku.maksuehto} pv netto` : '')}
      ${el('InvoiceDueDate', pvm(lasku.erapaiva), f)}
      <PaymentOverDueFineDetails>
        ${el('PaymentOverDueFineFreeText', m.viivastyskorko || 'Viivästyskorko korkolain mukaan')}
      </PaymentOverDueFineDetails>
    </PaymentTermsDetails>
  </InvoiceDetails>
  ${rivit}
  <EpiDetails>
    <EpiIdentificationDetails>
      ${el('EpiDate', pvm(lasku.laskupaiva), f)}
      ${el('EpiReference', lasku.viitenumero)}
    </EpiIdentificationDetails>
    <EpiPartyDetails>
      <EpiBfiPartyDetails>
        ${el('EpiBfiIdentifier', m.bic, ' IdentificationSchemeName="BIC"')}
      </EpiBfiPartyDetails>
      <EpiBeneficiaryPartyDetails>
        ${el('EpiNameAddressDetails', m.nimi)}
        ${el('EpiBei', m.y_tunnus)}
        ${el('EpiAccountID', ibanM, ' IdentificationSchemeName="IBAN"')}
      </EpiBeneficiaryPartyDetails>
    </EpiPartyDetails>
    <EpiPaymentInstructionDetails>
      ${el('EpiRemittanceInfoIdentifier', lasku.viitenumero, ' IdentificationSchemeName="SPY"')}
      ${el('EpiInstructedAmount', maara(Math.max(0, s.verollinenYhteensa)), eur)}
      <EpiCharge ChargeOption="SHA">SHA</EpiCharge>
      ${el('EpiDateOptionDate', pvm(lasku.erapaiva), f)}
    </EpiPaymentInstructionDetails>
  </EpiDetails>
</Finvoice>
`.replace(/^\s*\n/gm, '')
}
