// ═══════════════════════════════════════════════════════
// AUTH — Kirjautuminen, kaksivaiheinen tunnistautuminen, aikakatkaisu
// ═══════════════════════════════════════════════════════

import {
  kirjauduSisaan, kirjauduUlos, haeKayttaja, mfaTaso, mfaTekijat, mfaVahvista, onAuthStateChange,
  supabaseMaaritetty,
} from '../utils/supabase.js'
import { naytaToast } from './ui.js'
import { nimikirjaimet } from '../utils/formatters.js'

const AIKAKATKAISU_MS = 30 * 60 * 1000   // 30 min käyttämättömyys → uloskirjaus

let _kayttaja = null
let _ajastin = null

export function haeNykyinenKayttaja() {
  return _kayttaja
}

function nayta(id) {
  for (const k of ['login-form', 'mfa-card']) {
    const el = k === 'login-form' ? document.getElementById(k)?.closest('.login-card') : document.getElementById(k)
    el?.classList.toggle('hidden', !(k === id))
  }
}

/** Palauttaa true, jos istunto on riittävällä tasolla (MFA vahvistettu, jos käytössä) */
async function mfaKunnossa() {
  const taso = await mfaTaso()
  return !(taso.nextLevel === 'aal2' && taso.currentLevel !== 'aal2')
}

function kaynnistaAikakatkaisu(onUlos) {
  const nollaa = () => {
    clearTimeout(_ajastin)
    _ajastin = setTimeout(async () => {
      await kirjauduUlos().catch(() => {})
      _kayttaja = null
      onUlos()
      naytaToast('Istunto päättyi käyttämättömyyden vuoksi', 'warning')
    }, AIKAKATKAISU_MS)
  }
  for (const e of ['click', 'keydown', 'pointermove', 'scroll']) {
    document.addEventListener(e, nollaa, { passive: true })
  }
  nollaa()
}

export async function alustAuth(onKirjautunut, onKirjautunutUlos) {
  let kirjautunut = false
  const valmis = async (kayttaja) => {
    if (kirjautunut) return
    kirjautunut = true
    _kayttaja = kayttaja
    kaynnistaAikakatkaisu(() => { kirjautunut = false; onKirjautunutUlos() })
    await onKirjautunut(kayttaja)
  }
  const ulos = async () => {
    await kirjauduUlos().catch(() => {})
    _kayttaja = null
    kirjautunut = false
    clearTimeout(_ajastin)
    onKirjautunutUlos()
    nayta('login-form')
  }

  const jatkaKirjautumista = async (kayttaja) => {
    if (await mfaKunnossa()) {
      await valmis(kayttaja)
    } else {
      nayta('mfa-card')
      document.getElementById('mfa-koodi')?.focus()
    }
  }

  const MAARITYS_PUUTTUU = 'Sovelluksen tietokanta-asetukset puuttuvat tästä ympäristöstä ' +
    '(VITE_SUPABASE_URL ja VITE_SUPABASE_ANON_KEY). Lisää ne Vercelin ympäristömuuttujiin ja julkaise uudelleen.'
  if (!supabaseMaaritetty) {
    const el = document.getElementById('login-error')
    el.textContent = MAARITYS_PUUTTUU
    el.classList.remove('hidden')
  }

  // Kirjautuminen
  const loginForm = document.getElementById('login-form')
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
      document.getElementById('login-password').value = ''
      await jatkaKirjautumista(data.user)
    } catch (err) {
      virheEl.textContent = supabaseMaaritetty ? kaannaVirhe(err.message) : MAARITYS_PUUTTUU
      virheEl.classList.remove('hidden')
    } finally {
      btn.disabled = false
      btn.querySelector('.btn-text').classList.remove('hidden')
      btn.querySelector('.btn-loading').classList.add('hidden')
    }
  })

  // MFA-koodi
  document.getElementById('mfa-form')?.addEventListener('submit', async (e) => {
    e.preventDefault()
    const koodi = document.getElementById('mfa-koodi').value.trim()
    const virheEl = document.getElementById('mfa-error')
    const btn = document.getElementById('mfa-btn')
    virheEl.classList.add('hidden')
    btn.disabled = true
    try {
      const [tekija] = await mfaTekijat()
      if (!tekija) throw new Error('Todennustekijää ei löydy')
      await mfaVahvista(tekija.id, koodi)
      document.getElementById('mfa-koodi').value = ''
      await valmis(await haeKayttaja())
    } catch (err) {
      virheEl.textContent = 'Virheellinen koodi. Yritä uudelleen.'
      virheEl.classList.remove('hidden')
    } finally {
      btn.disabled = false
    }
  })
  document.getElementById('mfa-peruuta')?.addEventListener('click', (e) => { e.preventDefault(); ulos() })

  // Uloskirjautuminen
  document.getElementById('logout-btn')?.addEventListener('click', async () => {
    await ulos()
    naytaToast('Kirjauduttu ulos', 'success')
  })

  // Istunto päättyi toisaalla (esim. toinen välilehti)
  onAuthStateChange((tapahtuma) => {
    if (tapahtuma === 'SIGNED_OUT' && kirjautunut) {
      kirjautunut = false
      _kayttaja = null
      onKirjautunutUlos()
      nayta('login-form')
    }
  })

  // Olemassa oleva istunto
  try {
    const kayttaja = await haeKayttaja()
    if (kayttaja) await jatkaKirjautumista(kayttaja)
  } catch (err) {
    console.error('Istunnon tarkistus epäonnistui', err)
  }
}

export function paivitaSivupalkkiKayttaja(kayttaja, yritys = '') {
  const email = kayttaja?.email || ''
  const nimi = yritys || email.split('@')[0] || 'Käyttäjä'
  const nameEl = document.getElementById('sidebar-user-name')
  const emailEl = document.getElementById('sidebar-user-email')
  const avatarEl = document.getElementById('user-avatar-initials')
  if (nameEl) nameEl.textContent = nimi
  if (emailEl) emailEl.textContent = email
  if (avatarEl) avatarEl.textContent = nimikirjaimet(nimi)
}

function kaannaVirhe(virhe = '') {
  const kaannokset = {
    'Invalid login credentials': 'Virheellinen sähköposti tai salasana.',
    'Email not confirmed': 'Vahvista sähköpostiosoitteesi ensin.',
    'Too many requests': 'Liian monta yritystä. Odota hetki.',
    'rate limit': 'Liian monta yritystä. Odota hetki.',
    'Failed to fetch': 'Yhteys tietokantaan epäonnistui. Tarkista verkkoyhteys ja Supabase-osoite.',
    'NetworkError': 'Yhteys tietokantaan epäonnistui. Tarkista verkkoyhteys ja Supabase-osoite.',
  }
  for (const [en, fi] of Object.entries(kaannokset)) {
    if (virhe.toLowerCase().includes(en.toLowerCase())) return fi
  }
  return `Kirjautuminen epäonnistui: ${virhe}`
}
