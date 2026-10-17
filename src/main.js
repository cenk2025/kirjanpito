// ═══════════════════════════════════════════════════════
// MAIN — Sovelluksen käynnistys
// ═══════════════════════════════════════════════════════

import './styles/main.css'
import { alustAuth, paivitaSivupalkkiKayttaja } from './js/auth.js'
import { alustaModaali, naytaVirhe } from './js/ui.js'
import { rekisteroiReitti, alustRouter } from './js/router.js'
import { alustaKirjanpito, haeProfiili } from './utils/supabase.js'
import { renderKojelauta } from './js/dashboard.js'
import { renderLaskut } from './js/laskut.js'
import { renderAsiakkaat } from './js/asiakkaat.js'
import { renderKulut } from './js/kulut.js'
import { renderPankki } from './js/pankki.js'
import { renderKirjanpito } from './js/kirjanpito.js'
import { renderVerolaskelma } from './js/verolaskelma.js'
import { renderRaportit } from './js/raportit.js'
import { renderAsetukset } from './js/asetukset.js'

function alustaMobiiliNav() {
  const menuToggle = document.getElementById('menu-toggle')
  const sidebar = document.getElementById('sidebar')
  menuToggle?.addEventListener('click', () => sidebar?.classList.add('open'))
  document.getElementById('sidebar-close')?.addEventListener('click', () => sidebar?.classList.remove('open'))
  document.addEventListener('click', (e) => {
    if (sidebar?.classList.contains('open') && !sidebar.contains(e.target) && !menuToggle?.contains(e.target)) {
      sidebar.classList.remove('open')
    }
  })
}

function rekisteroiReitit(kayttajaId) {
  rekisteroiReitti('kojelauta',    () => renderKojelauta(kayttajaId))
  rekisteroiReitti('laskut',       (polku) => renderLaskut(kayttajaId, polku))
  rekisteroiReitti('asiakkaat',    () => renderAsiakkaat(kayttajaId))
  rekisteroiReitti('pankki',       () => renderPankki(kayttajaId))
  rekisteroiReitti('kulut',        () => renderKulut(kayttajaId))
  rekisteroiReitti('kirjanpito',   (polku) => renderKirjanpito(kayttajaId, polku))
  rekisteroiReitti('verolaskelma', () => renderVerolaskelma(kayttajaId))
  rekisteroiReitti('raportit',     (polku) => renderRaportit(kayttajaId, polku))
  rekisteroiReitti('asetukset',    () => renderAsetukset(kayttajaId))
}

async function onKirjautunut(kayttaja) {
  document.getElementById('login-view')?.classList.add('hidden')
  document.getElementById('app-shell')?.classList.remove('hidden')

  try {
    await alustaKirjanpito()
  } catch (err) {
    naytaVirhe('Kirjanpidon alustus epäonnistui', err)
  }
  const profiili = await haeProfiili(kayttaja.id).catch(() => null)
  paivitaSivupalkkiKayttaja(kayttaja, profiili?.yritys_nimi)

  rekisteroiReitit(kayttaja.id)
  alustRouter()
  alustaMobiiliNav()
}

function onKirjautunutUlos() {
  // Täysi uudelleenlataus tyhjentää muistissa olevat tiedot
  window.location.hash = ''
  window.location.reload()
}

alustaModaali()
alustAuth(onKirjautunut, onKirjautunutUlos)
