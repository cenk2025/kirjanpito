// ═══════════════════════════════════════════════════════
// AUTH — Kirjautuminen & rekisteröinti
// ═══════════════════════════════════════════════════════

import { kirjauduSisaan, kirjauduUlos, rekisteroidy, haeKayttaja } from '../utils/supabase.js'
import { naytaToast } from './ui.js'
import { nimikirjaimet } from '../utils/formatters.js'

let _kayttaja = null

export function haeNykyinenKayttaja() {
  return _kayttaja
}

export async function alustAuth(onKirjautunut, onKirjautunutUlos) {
  // Näytä kirjautumislomake
  renderKirjautuminen(onKirjautunut, onKirjautunutUlos)

  // Tarkista olemassaoleva istunto
  try {
    const kayttaja = await haeKayttaja()
    if (kayttaja) {
      _kayttaja = kayttaja
      await onKirjautunut(kayttaja)
    }
  } catch (err) {
    console.error('Auth init virhe:', err)
  }
}

function renderKirjautuminen(onKirjautunut, onKirjautunutUlos) {
  const loginForm = document.getElementById('login-form')
  const registerForm = document.getElementById('register-form')
  const showRegister = document.getElementById('show-register')
  const showLogin = document.getElementById('show-login')
  const loginCard = loginForm?.closest('.login-card')
  const registerCard = document.getElementById('register-card')
  const logoutBtn = document.getElementById('logout-btn')

  // Vaihda lomakkeet
  showRegister?.addEventListener('click', (e) => {
    e.preventDefault()
    loginCard?.classList.add('hidden')
    registerCard?.classList.remove('hidden')
  })

  showLogin?.addEventListener('click', (e) => {
    e.preventDefault()
    registerCard?.classList.add('hidden')
    loginCard?.classList.remove('hidden')
  })

  // Kirjautuminen
  loginForm?.addEventListener('submit', async (e) => {
    e.preventDefault()
    const email = document.getElementById('login-email').value.trim()
    const salasana = document.getElementById('login-password').value
    const virheEl = document.getElementById('login-error')
    const btn = document.getElementById('login-btn')

    virheEl.classList.add('hidden')
    btn.disabled = true
    btn.querySelector('.btn-text').classList.add('hidden')
    btn.querySelector('.btn-loading').classList.remove('hidden')

    try {
      const data = await kirjauduSisaan(email, salasana)
      _kayttaja = data.user
      await onKirjautunut(data.user)
    } catch (err) {
      virheEl.textContent = kaannaSupabaseVirhe(err.message)
      virheEl.classList.remove('hidden')
    } finally {
      btn.disabled = false
      btn.querySelector('.btn-text').classList.remove('hidden')
      btn.querySelector('.btn-loading').classList.add('hidden')
    }
  })

  // Rekisteröinti
  registerForm?.addEventListener('submit', async (e) => {
    e.preventDefault()
    const email = document.getElementById('reg-email').value.trim()
    const salasana = document.getElementById('reg-password').value
    const virheEl = document.getElementById('register-error')
    const onnistumisEl = document.getElementById('register-success')
    const btn = document.getElementById('register-btn')

    virheEl.classList.add('hidden')
    onnistumisEl.classList.add('hidden')

    if (salasana.length < 8) {
      virheEl.textContent = 'Salasanan on oltava vähintään 8 merkkiä pitkä.'
      virheEl.classList.remove('hidden')
      return
    }

    btn.disabled = true
    btn.textContent = 'Luodaan...'

    try {
      await rekisteroidy(email, salasana)
      onnistumisEl.textContent = 'Tunnus luotu! Tarkista sähköpostisi vahvistuslinkkiä varten.'
      onnistumisEl.classList.remove('hidden')
      registerForm.reset()
    } catch (err) {
      virheEl.textContent = kaannaSupabaseVirhe(err.message)
      virheEl.classList.remove('hidden')
    } finally {
      btn.disabled = false
      btn.textContent = 'Luo tunnus'
    }
  })

  // Uloskirjautuminen
  logoutBtn?.addEventListener('click', async () => {
    try {
      await kirjauduUlos()
      _kayttaja = null
      onKirjautunutUlos()
      naytaToast('Kirjauduttu ulos', 'success')
    } catch (err) {
      naytaToast('Uloskirjautuminen epäonnistui', 'error')
    }
  })
}

export function paivitaSivupalkkiKayttaja(kayttaja) {
  const nameEl = document.getElementById('sidebar-user-name')
  const emailEl = document.getElementById('sidebar-user-email')
  const avatarEl = document.getElementById('user-avatar-initials')

  const email = kayttaja?.email || ''
  const nimimerkki = email.split('@')[0] || 'Käyttäjä'

  if (nameEl) nameEl.textContent = nimimerkki
  if (emailEl) emailEl.textContent = email
  if (avatarEl) avatarEl.textContent = nimikirjaimet(nimimerkki)
}

function kaannaSupabaseVirhe(virhe) {
  const kaannokset = {
    'Invalid login credentials':       'Virheellinen sähköposti tai salasana.',
    'Email not confirmed':             'Vahvista sähköpostiosoitteesi ensin.',
    'User already registered':         'Tämä sähköpostiosoite on jo käytössä.',
    'Password should be at least 6':   'Salasanan on oltava vähintään 6 merkkiä.',
    'Unable to validate email address': 'Tarkista sähköpostiosoite.',
  }
  for (const [en, fi] of Object.entries(kaannokset)) {
    if (virhe.includes(en)) return fi
  }
  return 'Jokin meni pieleen. Yritä uudelleen.'
}
