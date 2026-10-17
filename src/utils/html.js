// ═══════════════════════════════════════════════════════
// HTML — XSS-turvallinen HTML-muodostus
//
// Kaikki näkymät rakennetaan html`...`-tagilla. Interpoloidut arvot
// escapetaan automaattisesti. Valmis HTML (toinen html``-tulos tai
// raw()) lisätään sellaisenaan.
// ═══════════════════════════════════════════════════════

class Raw {
  constructor(arvo) { this.arvo = arvo }
  toString() { return this.arvo }
}

const KORVAUKSET = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;', '`': '&#96;' }

export function esc(arvo) {
  if (arvo === null || arvo === undefined || arvo === false) return ''
  return String(arvo).replace(/[&<>"'`]/g, m => KORVAUKSET[m])
}

/** Merkitsee merkkijonon luotetuksi HTML:ksi. Käytä vain vakioille. */
export function raw(arvo) {
  return new Raw(String(arvo ?? ''))
}

function muunna(arvo) {
  if (arvo instanceof Raw) return arvo.arvo
  if (Array.isArray(arvo)) return arvo.map(muunna).join('')
  return esc(arvo)
}

export function html(osat, ...arvot) {
  let tulos = osat[0]
  for (let i = 0; i < arvot.length; i++) {
    tulos += muunna(arvot[i]) + osat[i + 1]
  }
  return new Raw(tulos)
}

/** Asettaa elementin sisällön. Hyväksyy vain html``-tuloksen. */
export function asetaHTML(el, sisalto) {
  if (!el) return
  if (!(sisalto instanceof Raw)) {
    el.textContent = String(sisalto ?? '')
    return
  }
  el.innerHTML = sisalto.arvo
}
