// ═══════════════════════════════════════════════════════
// ROUTER — Hash-pohjainen reititys
// ═══════════════════════════════════════════════════════

import { asetaSivuOtsikko } from './ui.js'

const _reitit = {}
let _nykyinenReitti = null
let _alustettu = false

const SIVUOTSIKOT = {
  kojelauta:    'Kojelauta',
  laskut:       'Laskut',
  asiakkaat:    'Asiakkaat',
  pankki:       'Pankki',
  kulut:        'Kulut ja ostot',
  kirjanpito:   'Kirjanpito',
  verolaskelma: 'Verot ja määräajat',
  raportit:     'Raportit',
  asetukset:    'Asetukset',
}

export function rekisteroiReitti(polku, handler) {
  _reitit[polku] = handler
}

export function navigoi(polku) {
  if (window.location.hash.replace('#', '') === polku) kasitteleHash()
  else window.location.hash = polku
}

export function haeNykyinenReitti() {
  return _nykyinenReitti
}

export function alustRouter() {
  if (!_alustettu) {
    window.addEventListener('hashchange', kasitteleHash)
    _alustettu = true
  }
  kasitteleHash()
}

function kasitteleHash() {
  const hash = decodeURIComponent(window.location.hash.replace('#', '')) || 'kojelauta'
  const perusReitti = hash.split('/')[0]

  document.querySelectorAll('.nav-item').forEach(link => {
    link.classList.toggle('active', link.dataset.route === perusReitti)
  })

  if (SIVUOTSIKOT[perusReitti]) {
    asetaSivuOtsikko(SIVUOTSIKOT[perusReitti])
    document.title = `${SIVUOTSIKOT[perusReitti]} — Kirjanpito`
  }

  _nykyinenReitti = hash
  const handler = _reitit[perusReitti] || _reitit.kojelauta
  if (handler) handler(hash)

  document.getElementById('sidebar')?.classList.remove('open')
  document.getElementById('content-area')?.scrollTo(0, 0)
}
