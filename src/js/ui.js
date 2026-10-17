// ═══════════════════════════════════════════════════════
// UI — Yhteiset käyttöliittymäapurit (toast, modaali, vahvistus)
// ═══════════════════════════════════════════════════════

import { html, asetaHTML } from '../utils/html.js'

// ─── Toast-ilmoitukset ─────────────────────────────────

export function naytaToast(viesti, tyyppi = 'info', kesto = 4000) {
  const container = document.getElementById('toast-container')
  if (!container) return
  const iconit = { success: '✓', error: '✕', info: 'ℹ', warning: '⚠' }
  const toast = document.createElement('div')
  toast.className = `toast toast-${tyyppi}`
  asetaHTML(toast, html`<span style="font-size:1.1em">${iconit[tyyppi] || 'ℹ'}</span><span>${viesti}</span>`)
  container.appendChild(toast)
  setTimeout(() => {
    toast.classList.add('fade-out')
    setTimeout(() => toast.remove(), 280)
  }, tyyppi === 'error' ? Math.max(kesto, 7000) : kesto)
}

/** Näyttää virheen ilmoituksena; palauttaa viestin */
export function naytaVirhe(otsikko, err) {
  const viesti = `${otsikko}: ${err?.message || err}`
  console.error(otsikko, err)
  naytaToast(viesti, 'error')
  return viesti
}

// ─── Modaali ───────────────────────────────────────────

export function avaaModaali(sisalto, koko = '') {
  const overlay = document.getElementById('modal-overlay')
  const container = document.getElementById('modal-container')
  const box = document.getElementById('modal-box')
  const content = document.getElementById('modal-content')
  if (!overlay || !container || !box || !content) return null

  box.className = `modal-box${koko ? ' ' + koko : ''}`
  asetaHTML(content, sisalto)
  overlay.classList.remove('hidden')
  container.classList.remove('hidden')
  content.querySelector('input, select, textarea, button')?.focus()
  return content
}

export function suljeModaali() {
  document.getElementById('modal-overlay')?.classList.add('hidden')
  document.getElementById('modal-container')?.classList.add('hidden')
  const content = document.getElementById('modal-content')
  if (content) content.textContent = ''
}

export function alustaModaali() {
  document.getElementById('modal-close')?.addEventListener('click', suljeModaali)
  document.getElementById('modal-overlay')?.addEventListener('click', (e) => {
    if (e.target === e.currentTarget) suljeModaali()
  })
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
      suljeModaali()
      document.getElementById('confirm-cancel')?.click()
    }
  })
}

// ─── Vahvistus ja tekstikysely ─────────────────────────

/**
 * Vahvistusdialogi. Jos kysy-parametri annetaan, käyttäjältä pyydetään
 * teksti (esim. hyvityksen syy) ja se palautetaan; peruutus → null.
 */
export function naytaVahvistus(viesti, otsikko = 'Vahvista toiminto', { kysy = null, okTeksti = 'Vahvista', vaarallinen = true } = {}) {
  return new Promise((resolve) => {
    const overlay = document.getElementById('confirm-overlay')
    const container = document.getElementById('confirm-container')
    const titleEl = document.getElementById('confirm-title')
    const msgEl = document.getElementById('confirm-message')
    const inputWrap = document.getElementById('confirm-input-wrap')
    const input = document.getElementById('confirm-input')
    const okBtn = document.getElementById('confirm-ok')
    const cancelBtn = document.getElementById('confirm-cancel')
    if (!overlay || !container || !okBtn || !cancelBtn) { resolve(kysy ? null : false); return }

    titleEl.textContent = otsikko
    msgEl.textContent = viesti
    okBtn.textContent = okTeksti
    okBtn.className = `btn ${vaarallinen ? 'btn-danger' : 'btn-primary'}`
    if (inputWrap && input) {
      inputWrap.classList.toggle('hidden', !kysy)
      input.value = ''
      input.placeholder = kysy || ''
    }
    overlay.classList.remove('hidden')
    container.classList.remove('hidden')
    if (kysy) input?.focus()

    const siivoa = () => {
      overlay.classList.add('hidden')
      container.classList.add('hidden')
      okBtn.removeEventListener('click', onOk)
      cancelBtn.removeEventListener('click', onCancel)
    }
    const onOk = () => {
      if (kysy) {
        const arvo = input.value.trim()
        if (!arvo) { input.focus(); return }
        siivoa(); resolve(arvo)
      } else { siivoa(); resolve(true) }
    }
    const onCancel = () => { siivoa(); resolve(kysy ? null : false) }
    okBtn.addEventListener('click', onOk)
    cancelBtn.addEventListener('click', onCancel)
  })
}

// ─── Sivun osat ────────────────────────────────────────

export function asetaSivuOtsikko(otsikko) {
  const el = document.getElementById('page-title')
  if (el) el.textContent = otsikko
}

export function asetaTopbarToiminnot(sisalto) {
  const el = document.getElementById('topbar-actions')
  if (!el) return
  if (!sisalto) { el.textContent = ''; return }
  asetaHTML(el, sisalto)
}

export function renderNakyma(sisalto) {
  asetaHTML(document.getElementById('content-area'), sisalto)
}

export function naytaLatausRuutu() {
  renderNakyma(html`<div class="loading-screen"><div class="spinner"></div></div>`)
}

export function virheNakyma(otsikko, err) {
  console.error(otsikko, err)
  renderNakyma(html`<div class="alert alert-error">${otsikko}: ${err?.message || err}</div>`)
}

export function tyhjaLista(otsikko, kuvaus, btnTeksti, btnId) {
  return html`
    <div class="empty-state">
      <div class="empty-state-icon">📄</div>
      <h3>${otsikko}</h3>
      <p>${kuvaus}</p>
      ${btnId ? html`<button class="btn btn-primary" id="${btnId}" style="margin-top:1.5rem">${btnTeksti}</button>` : ''}
    </div>
  `
}

export const PLUS_IKONI = html`<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>`

// ─── Tiedostot ─────────────────────────────────────────

export function lataaTiedosto(nimi, sisalto, tyyppi = 'text/plain;charset=utf-8') {
  const blob = sisalto instanceof Blob ? sisalto : new Blob([sisalto], { type: tyyppi })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = nimi
  document.body.appendChild(a)
  a.click()
  a.remove()
  setTimeout(() => URL.revokeObjectURL(url), 1000)
}

/** CSV (puolipiste, desimaalipilkku) Excel-yhteensopivana; kaavat neutraloidaan */
export function csv(rivit) {
  const solu = (v) => {
    if (v === null || v === undefined) return ''
    let s = typeof v === 'number' ? String(v).replace('.', ',') : String(v)
    if (/^[=+\-@\t\r]/.test(s) && typeof v !== 'number') s = "'" + s
    return /[";\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s
  }
  return '﻿' + rivit.map(r => r.map(solu).join(';')).join('\r\n')
}
