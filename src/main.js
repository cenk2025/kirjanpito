// ═══════════════════════════════════════════════════════
// MAIN — Entry point
// ═══════════════════════════════════════════════════════

import './styles/main.css'
import { alustAuth, paivitaSivupalkkiKayttaja, haeNykyinenKayttaja } from './js/auth.js'
import { alustaModaali } from './js/ui.js'
import { rekisteroiReitti, alustRouter, navigoi } from './js/router.js'
import { renderKojelauta } from './js/dashboard.js'
import { renderLaskut } from './js/laskut.js'
import { renderAsiakkaat } from './js/asiakkaat.js'
import { renderKulut } from './js/kulut.js'
import { renderVerolaskelma } from './js/verolaskelma.js'
import { renderRaportit } from './js/raportit.js'
import { renderAsetukset } from './js/asetukset.js'

// ─── Mobiilinavigaatio ─────────────────────────────────

function alustaMobiiliNav() {
  const menuToggle = document.getElementById('menu-toggle')
  const sidebarClose = document.getElementById('sidebar-close')
  const sidebar = document.getElementById('sidebar')

  menuToggle?.addEventListener('click', () => sidebar?.classList.add('open'))
  sidebarClose?.addEventListener('click', () => sidebar?.classList.remove('open'))

  // Taustaklikkaus sulkee sidebarin
  document.addEventListener('click', (e) => {
    if (
      sidebar?.classList.contains('open') &&
      !sidebar.contains(e.target) &&
      !menuToggle?.contains(e.target)
    ) {
      sidebar.classList.remove('open')
    }
  })
}

// ─── Näkymät kirjautumisen jälkeen ────────────────────

function rekisteroiReitit(kayttajaId) {
  rekisteroiReitti('kojelauta',    () => renderKojelauta(kayttajaId))
  rekisteroiReitti('laskut',       (polku) => renderLaskut(kayttajaId, polku))
  rekisteroiReitti('asiakkaat',    () => renderAsiakkaat(kayttajaId))
  rekisteroiReitti('kulut',        () => renderKulut(kayttajaId))
  rekisteroiReitti('verolaskelma', () => renderVerolaskelma(kayttajaId))
  rekisteroiReitti('raportit',     () => renderRaportit(kayttajaId))
  rekisteroiReitti('asetukset',    () => renderAsetukset(kayttajaId))
}

// ─── Kirjautuminen ─────────────────────────────────────

async function onKirjautunut(kayttaja) {
  const loginView = document.getElementById('login-view')
  const appShell  = document.getElementById('app-shell')

  loginView?.classList.add('hidden')
  appShell?.classList.remove('hidden')

  paivitaSivupalkkiKayttaja(kayttaja)
  rekisteroiReitit(kayttaja.id)
  alustRouter()
  alustaMobiiliNav()
}

function onKirjautunutUlos() {
  const loginView = document.getElementById('login-view')
  const appShell  = document.getElementById('app-shell')

  appShell?.classList.add('hidden')
  loginView?.classList.remove('hidden')

  // Tyhjennä hash ja lataa sivu uudelleen
  window.location.hash = ''
}

// ─── Käynnistys ────────────────────────────────────────

alustaModaali()
alustAuth(onKirjautunut, onKirjautunutUlos)
