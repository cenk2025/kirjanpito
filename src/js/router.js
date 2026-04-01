// ═══════════════════════════════════════════════════════
// ROUTER — Hash-pohjainen reititys
// ═══════════════════════════════════════════════════════

import { asetaSivuOtsikko } from './ui.js'

const _reitit = {}
let _nykyinenReitti = null

const SIVUOTSIKOT = {
  kojelauta:    'Kojelauta',
  laskut:       'Laskut',
  asiakkaat:    'Asiakkaat',
  kulut:        'Kulut',
  verolaskelma: 'Verolaskelma',
  raportit:     'Raportit',
  asetukset:    'Asetukset',
}

export function rekisteroiReitti(polku, handler) {
  _reitit[polku] = handler
}

export function navigoi(polku) {
  window.location.hash = polku
}

export function haeNykyinenReitti() {
  return _nykyinenReitti
}

export function alustRouter() {
  window.addEventListener('hashchange', kasiitteleHash)
  kasiitteleHash()
}

function kasiitteleHash() {
  const hash = window.location.hash.replace('#', '') || 'kojelauta'

  // Päivitä aktiivinen nav-linkki
  document.querySelectorAll('.nav-item').forEach(link => {
    const reitti = link.dataset.route
    link.classList.toggle('active', hash === reitti || hash.startsWith(reitti + '/'))
  })

  // Aseta sivuotsikko
  const perusReitti = hash.split('/')[0]
  if (SIVUOTSIKOT[perusReitti]) {
    asetaSivuOtsikko(SIVUOTSIKOT[perusReitti])
    document.title = `${SIVUOTSIKOT[perusReitti]} — Kirjanpito`
  }

  _nykyinenReitti = hash

  // Kutsu handleria
  const handler = _reitit[perusReitti] || _reitit['kojelauta']
  if (handler) handler(hash)

  // Sulje mobiilinavigaatio
  document.getElementById('sidebar')?.classList.remove('open')

  // Skrollaa ylös
  document.getElementById('content-area')?.scrollTo(0, 0)
}
