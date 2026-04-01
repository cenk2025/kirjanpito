// ═══════════════════════════════════════════════════════
// LASKUTULOSTUS — Invoice print / PDF generation
// Avaa tulostettavan version selainikkunassa
// ═══════════════════════════════════════════════════════

import { laskeLaskuSummat, muotoileViitenumero, rakennaPankkiviivakoodi, rakennaSepaQR } from '../utils/laskuri.js'
import { formatoiEuro, formatoiPaiva, formatoiIBAN } from '../utils/formatters.js'

export function tulostalasku(lasku) {
  if (!lasku) return

  const asiakas = lasku.asiakas || {}
  const rivit = lasku.rivit || []
  const summat = laskeLaskuSummat(rivit)

  // Barkod & QR verisi
  const iban = lasku._profiili?.iban || ''
  const viitenumero = lasku.viitenumero || ''
  const pankkiviivakoodi = rakennaPankkiviivakoodi(
    iban, summat.verollinenYhteensa, viitenumero, lasku.erapaiva
  )
  const sepaQR = iban ? rakennaSepaQR(
    lasku._profiili?.yritys_nimi || '',
    iban,
    summat.verollinenYhteensa,
    viitenumero,
    `Lasku ${lasku.laskunumero}`
  ) : null

  const riviHTML = rivit.map(r => {
    const verollinenYhteensa = r.maara * r.yksikkohinta * (1 + r.alv_kanta / 100)
    const alvSumma = r.maara * r.yksikkohinta * (r.alv_kanta / 100)
    return `
      <tr>
        <td>${r.kuvaus || ''}</td>
        <td style="text-align:right">${r.maara} ${r.yksikko || 'kpl'}</td>
        <td style="text-align:right">${formatoiEuro(r.yksikkohinta)}</td>
        <td style="text-align:right">${r.alv_kanta} %</td>
        <td style="text-align:right">${formatoiEuro(alvSumma)}</td>
        <td style="text-align:right"><strong>${formatoiEuro(verollinenYhteensa)}</strong></td>
      </tr>
    `
  }).join('')

  const alvErittelyHTML = Object.entries(summat.alvErittely).map(([kanta, e]) => `
    <tr>
      <td>ALV ${kanta} %</td>
      <td style="text-align:right">${formatoiEuro(e.veroton)}</td>
      <td style="text-align:right">${formatoiEuro(e.alv)}</td>
    </tr>
  `).join('')

  const html = `<!DOCTYPE html>
<html lang="fi">
<head>
  <meta charset="UTF-8" />
  <title>Lasku ${lasku.laskunumero}</title>
  <style>
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body {
      font-family: Arial, Helvetica, sans-serif;
      font-size: 11pt;
      color: #111;
      background: #fff;
      padding: 15mm 20mm;
    }
    .inv-header {
      display: flex;
      justify-content: space-between;
      align-items: flex-start;
      margin-bottom: 12mm;
      padding-bottom: 8mm;
      border-bottom: 2px solid #111;
    }
    .company-name {
      font-size: 22pt;
      font-weight: bold;
      margin-bottom: 4mm;
    }
    .company-info { font-size: 9pt; color: #444; line-height: 1.6; }
    .inv-meta { text-align: right; }
    .inv-meta h1 {
      font-size: 20pt;
      font-weight: bold;
      color: #333;
      margin-bottom: 3mm;
    }
    .inv-meta .meta-row {
      font-size: 10pt;
      margin-bottom: 2mm;
      color: #444;
    }
    .inv-meta .meta-row strong { color: #111; }
    .parties {
      display: grid;
      grid-template-columns: 1fr 1fr;
      gap: 10mm;
      margin-bottom: 10mm;
    }
    .party-label {
      font-size: 8pt;
      text-transform: uppercase;
      letter-spacing: 0.1em;
      color: #888;
      margin-bottom: 2mm;
    }
    .party-name { font-size: 12pt; font-weight: bold; margin-bottom: 2mm; }
    .party-info { font-size: 9pt; color: #444; line-height: 1.6; }
    table {
      width: 100%;
      border-collapse: collapse;
      margin-bottom: 6mm;
    }
    thead th {
      background: #f5f5f5;
      padding: 3mm 4mm;
      text-align: left;
      font-size: 9pt;
      font-weight: bold;
      border-bottom: 1px solid #ccc;
    }
    tbody td {
      padding: 2.5mm 4mm;
      font-size: 10pt;
      border-bottom: 1px solid #eee;
      vertical-align: middle;
    }
    .totals-table {
      width: 90mm;
      margin-left: auto;
      border: none;
    }
    .totals-table td {
      padding: 1.5mm 3mm;
      border: none;
    }
    .totals-grand td {
      font-weight: bold;
      font-size: 12pt;
      border-top: 2px solid #111 !important;
      padding-top: 3mm;
    }
    .payment-section {
      margin-top: 12mm;
      padding-top: 6mm;
      border-top: 1px solid #ccc;
    }
    .payment-section h3 {
      font-size: 10pt;
      text-transform: uppercase;
      letter-spacing: 0.08em;
      color: #888;
      margin-bottom: 4mm;
    }
    .payment-grid {
      display: grid;
      grid-template-columns: repeat(3, 1fr);
      gap: 6mm;
      font-size: 9pt;
    }
    .payment-item label {
      display: block;
      font-size: 8pt;
      color: #888;
      text-transform: uppercase;
      letter-spacing: 0.08em;
      margin-bottom: 1mm;
    }
    .payment-item strong { font-size: 10pt; }
    .alv-section {
      margin-top: 6mm;
      padding-top: 4mm;
      border-top: 1px solid #eee;
    }
    .alv-section h3 {
      font-size: 9pt;
      color: #888;
      margin-bottom: 3mm;
    }
    .alv-table { width: 90mm; margin-left: auto; }
    .alv-table td { padding: 1mm 3mm; font-size: 9pt; border: none; }
    .footer {
      margin-top: 12mm;
      padding-top: 5mm;
      border-top: 1px solid #eee;
      font-size: 8pt;
      color: #888;
      text-align: center;
    }
    /* Barkod & QR */
    .barcode-section {
      margin-top: 10mm;
      padding-top: 6mm;
      border-top: 2px solid #111;
    }
    .barcode-section h3 {
      font-size: 8pt;
      text-transform: uppercase;
      letter-spacing: 0.1em;
      color: #888;
      margin-bottom: 4mm;
    }
    .barcode-row {
      display: flex;
      align-items: flex-start;
      gap: 8mm;
    }
    .barcode-wrap {
      flex: 1;
    }
    .barcode-wrap label {
      display: block;
      font-size: 7pt;
      color: #888;
      text-transform: uppercase;
      letter-spacing: 0.08em;
      margin-bottom: 2mm;
    }
    #barcode-canvas {
      display: block;
      max-width: 100%;
      height: 18mm;
    }
    .barcode-number {
      font-size: 8pt;
      font-family: 'Courier New', monospace;
      letter-spacing: 0.05em;
      margin-top: 2mm;
      color: #333;
    }
    .qr-wrap {
      text-align: center;
      flex-shrink: 0;
    }
    .qr-wrap label {
      display: block;
      font-size: 7pt;
      color: #888;
      text-transform: uppercase;
      letter-spacing: 0.08em;
      margin-bottom: 2mm;
    }
    #qr-canvas { display: block; }
    @media print {
      body { padding: 0; }
    }
  </style>
  <!-- JsBarcode CDN -->
  <script src="https://cdn.jsdelivr.net/npm/jsbarcode@3.11.6/dist/JsBarcode.all.min.js"></script>
  <!-- QRCode CDN -->
  <script src="https://cdn.jsdelivr.net/npm/qrcode@1.5.3/build/qrcode.min.js"></script>
</head>
<body>

  <!-- Otsikko: Myyjä + Laskumeta -->
  <div class="inv-header">
    <div>
      <div class="company-name">${lasku._profiili?.yritys_nimi || 'Yritys'}</div>
      <div class="company-info">
        ${lasku._profiili?.osoite ? lasku._profiili.osoite + '<br>' : ''}
        ${[lasku._profiili?.postinumero, lasku._profiili?.kaupunki].filter(Boolean).join(' ')}
        ${lasku._profiili?.y_tunnus ? '<br>Y-tunnus: ' + lasku._profiili.y_tunnus : ''}
        ${lasku._profiili?.alv_tunnus ? '<br>ALV-tunnus: ' + lasku._profiili.alv_tunnus : ''}
        ${lasku._profiili?.sahkoposti ? '<br>' + lasku._profiili.sahkoposti : ''}
        ${lasku._profiili?.puhelin ? '<br>' + lasku._profiili.puhelin : ''}
      </div>
    </div>
    <div class="inv-meta">
      <h1>LASKU</h1>
      <div class="meta-row">Laskunumero: <strong>${lasku.laskunumero}</strong></div>
      <div class="meta-row">Laskupäivä: <strong>${formatoiPaiva(lasku.laskupaiva)}</strong></div>
      <div class="meta-row">Eräpäivä: <strong>${formatoiPaiva(lasku.erapaiva)}</strong></div>
      ${lasku.viitenumero ? `<div class="meta-row">Viitenumero: <strong>${lasku.viitenumero}</strong></div>` : ''}
    </div>
  </div>

  <!-- Ostaja -->
  <div class="parties">
    <div>
      <div class="party-label">Laskuttaja</div>
      <div class="party-name">${lasku._profiili?.yritys_nimi || ''}</div>
      <div class="party-info">
        ${lasku._profiili?.y_tunnus ? 'Y-tunnus: ' + lasku._profiili.y_tunnus : ''}
      </div>
    </div>
    <div>
      <div class="party-label">Laskutettu</div>
      <div class="party-name">${asiakas.nimi || ''}</div>
      <div class="party-info">
        ${asiakas.y_tunnus ? 'Y-tunnus: ' + asiakas.y_tunnus + '<br>' : ''}
        ${asiakas.osoite ? asiakas.osoite + '<br>' : ''}
        ${[asiakas.postinumero, asiakas.kaupunki].filter(Boolean).join(' ')}
      </div>
    </div>
  </div>

  <!-- Laskurivit -->
  <table>
    <thead>
      <tr>
        <th>Kuvaus</th>
        <th style="text-align:right">Määrä</th>
        <th style="text-align:right">Yksikköhinta</th>
        <th style="text-align:right">ALV-%</th>
        <th style="text-align:right">ALV €</th>
        <th style="text-align:right">Yhteensä</th>
      </tr>
    </thead>
    <tbody>${riviHTML}</tbody>
  </table>

  <!-- ALV-erittely -->
  <div class="alv-section">
    <h3>ALV-erittely</h3>
    <table class="alv-table">
      <thead>
        <tr>
          <th>ALV-kanta</th>
          <th style="text-align:right">Veroton</th>
          <th style="text-align:right">ALV</th>
        </tr>
      </thead>
      <tbody>${alvErittelyHTML}</tbody>
    </table>
  </div>

  <!-- Loppusummat -->
  <table class="totals-table">
    <tbody>
      <tr>
        <td>Yhteensä (veroton)</td>
        <td style="text-align:right">${formatoiEuro(summat.verotonYhteensa)}</td>
      </tr>
      <tr>
        <td>ALV yhteensä</td>
        <td style="text-align:right">${formatoiEuro(summat.verollinenYhteensa - summat.verotonYhteensa)}</td>
      </tr>
    </tbody>
    <tfoot>
      <tr class="totals-grand">
        <td>Maksettava yhteensä</td>
        <td style="text-align:right">${formatoiEuro(summat.verollinenYhteensa)}</td>
      </tr>
    </tfoot>
  </table>

  <!-- Maksutiedot -->
  <div class="payment-section">
    <h3>Maksutiedot</h3>
    <div class="payment-grid">
      <div class="payment-item">
        <label>Tilinumero (IBAN)</label>
        <strong>${formatoiIBAN(lasku._profiili?.iban || '') || '—'}</strong>
      </div>
      <div class="payment-item">
        <label>BIC / SWIFT</label>
        <strong>${lasku._profiili?.bic || '—'}</strong>
      </div>
      <div class="payment-item">
        <label>Viitenumero</label>
        <strong>${lasku.viitenumero ? muotoileViitenumero(lasku.viitenumero) : '—'}</strong>
      </div>
      <div class="payment-item">
        <label>Eräpäivä</label>
        <strong>${formatoiPaiva(lasku.erapaiva)}</strong>
      </div>
      <div class="payment-item">
        <label>Maksettava</label>
        <strong>${formatoiEuro(summat.verollinenYhteensa)}</strong>
      </div>
    </div>
  </div>

  ${lasku.lisatiedot ? `<div style="margin-top:8mm;padding:4mm;background:#f9f9f9;border-radius:3mm;font-size:9pt;color:#444">${lasku.lisatiedot}</div>` : ''}

  ${lasku._profiili?.viivastyskorko ? `<p style="margin-top:6mm;font-size:8pt;color:#888">${lasku._profiili.viivastyskorko}</p>` : ''}

  <!-- Pankkiviivakoodi + QR -->
  ${(pankkiviivakoodi || sepaQR) ? `
  <div class="barcode-section">
    <h3>Maksukoodi</h3>
    <div class="barcode-row">
      ${pankkiviivakoodi ? `
      <div class="barcode-wrap">
        <label>Pankkiviivakoodi (FI versio 5)</label>
        <canvas id="barcode-canvas"></canvas>
        <div class="barcode-number">${pankkiviivakoodi}</div>
      </div>
      ` : ''}
      ${sepaQR ? `
      <div class="qr-wrap">
        <label>SEPA QR-maksukoodi</label>
        <canvas id="qr-canvas" width="80" height="80"></canvas>
        <div style="font-size:7pt;color:#888;margin-top:1mm">Skannaa mobiilipankilla</div>
      </div>
      ` : ''}
    </div>
  </div>
  ` : ''}

  <div class="footer">
    ${[lasku._profiili?.yritys_nimi, lasku._profiili?.y_tunnus ? 'Y-tunnus: ' + lasku._profiili.y_tunnus : '', lasku._profiili?.sahkoposti].filter(Boolean).join(' | ')}
  </div>

  <script>
    // Pankkiviivakoodi
    const barcodeCanvas = document.getElementById('barcode-canvas');
    if (barcodeCanvas && typeof JsBarcode !== 'undefined') {
      try {
        JsBarcode(barcodeCanvas, '${pankkiviivakoodi || ''}', {
          format: 'CODE128',
          width: 1.5,
          height: 55,
          displayValue: false,
          margin: 0,
        });
      } catch(e) { barcodeCanvas.style.display = 'none'; }
    }

    // SEPA QR
    const qrCanvas = document.getElementById('qr-canvas');
    if (qrCanvas && typeof QRCode !== 'undefined') {
      QRCode.toCanvas(qrCanvas, ${JSON.stringify(sepaQR || '')}, {
        width: 90,
        margin: 1,
        color: { dark: '#000000', light: '#ffffff' }
      }, function(err) {
        if (err) qrCanvas.style.display = 'none';
      });
    }

    window.print();
  </script>
</body>
</html>`

  const ikkuna = window.open('', '_blank', 'width=900,height=700')
  if (ikkuna) {
    ikkuna.document.write(html)
    ikkuna.document.close()
  }
}
