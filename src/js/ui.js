// ═══════════════════════════════════════════════════════
// UI — Shared UI helpers (toast, modal, confirm)
// ═══════════════════════════════════════════════════════

// ─── Toast notifications ───────────────────────────────

export function naytaToast(viesti, tyyppi = 'info', kesto = 3500) {
  const container = document.getElementById('toast-container')
  if (!container) return

  const toast = document.createElement('div')
  toast.className = `toast toast-${tyyppi}`

  const iconit = {
    success: '✓',
    error:   '✕',
    info:    'ℹ',
    warning: '⚠',
  }

  toast.innerHTML = `
    <span style="font-size:1.1em">${iconit[tyyppi] || 'ℹ'}</span>
    <span>${viesti}</span>
  `
  container.appendChild(toast)

  setTimeout(() => {
    toast.classList.add('fade-out')
    setTimeout(() => toast.remove(), 280)
  }, kesto)
}

// ─── Modal ─────────────────────────────────────────────

let _modalSuljeCallback = null

export function avaaModaali(html, koko = '') {
  const overlay = document.getElementById('modal-overlay')
  const container = document.getElementById('modal-container')
  const box = document.getElementById('modal-box')
  const content = document.getElementById('modal-content')

  if (!overlay || !container || !box || !content) return

  box.className = `modal-box${koko ? ' ' + koko : ''}`
  content.innerHTML = html
  overlay.classList.remove('hidden')
  container.classList.remove('hidden')

  // Focus management
  const ensimmainenInput = content.querySelector('input, select, textarea, button')
  ensimmainenInput?.focus()

  return content
}

export function suljeModaali() {
  const overlay = document.getElementById('modal-overlay')
  const container = document.getElementById('modal-container')
  if (overlay) overlay.classList.add('hidden')
  if (container) container.classList.add('hidden')
  if (_modalSuljeCallback) {
    _modalSuljeCallback()
    _modalSuljeCallback = null
  }
}

export function alustaModaali() {
  document.getElementById('modal-close')?.addEventListener('click', suljeModaali)
  document.getElementById('modal-overlay')?.addEventListener('click', (e) => {
    if (e.target === e.currentTarget) suljeModaali()
  })

  // ESC-nappi sulkee modaalin
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
      suljeModaali()
      suljeVahvistus()
    }
  })
}

// ─── Confirmation dialog ───────────────────────────────

export function naytaVahvistus(viesti, otsikko = 'Vahvista toiminto') {
  return new Promise((resolve) => {
    const overlay = document.getElementById('confirm-overlay')
    const container = document.getElementById('confirm-container')
    const titleEl = document.getElementById('confirm-title')
    const msgEl = document.getElementById('confirm-message')
    const okBtn = document.getElementById('confirm-ok')
    const cancelBtn = document.getElementById('confirm-cancel')

    if (!overlay || !container) {
      resolve(false)
      return
    }

    if (titleEl) titleEl.textContent = otsikko
    if (msgEl) msgEl.textContent = viesti

    overlay.classList.remove('hidden')
    container.classList.remove('hidden')

    const cleanup = () => {
      overlay.classList.add('hidden')
      container.classList.add('hidden')
      okBtn?.removeEventListener('click', onOk)
      cancelBtn?.removeEventListener('click', onCancel)
    }

    const onOk = () => { cleanup(); resolve(true) }
    const onCancel = () => { cleanup(); resolve(false) }

    okBtn?.addEventListener('click', onOk)
    cancelBtn?.addEventListener('click', onCancel)
  })
}

function suljeVahvistus() {
  document.getElementById('confirm-overlay')?.classList.add('hidden')
  document.getElementById('confirm-container')?.classList.add('hidden')
}

// ─── Page title ────────────────────────────────────────

export function asetaSivuOtsikko(otsikko) {
  const el = document.getElementById('page-title')
  if (el) el.textContent = otsikko
}

export function asetaTopbarToiminnot(html) {
  const el = document.getElementById('topbar-actions')
  if (el) el.innerHTML = html
}

// ─── Content area ──────────────────────────────────────

export function renderNakyma(html) {
  const el = document.getElementById('content-area')
  if (el) el.innerHTML = html
}

export function naytaLatausRuutu() {
  renderNakyma('<div class="loading-screen"><div class="spinner"></div></div>')
}

// ─── Empty state ───────────────────────────────────────

export function tyhjaLista(otsikko, kuvaus, btnTeksti, btnId) {
  return `
    <div class="empty-state">
      <div class="empty-state-icon">📄</div>
      <h3>${otsikko}</h3>
      <p>${kuvaus}</p>
      ${btnId ? `<button class="btn btn-primary" id="${btnId}" style="margin-top:1.5rem">${btnTeksti}</button>` : ''}
    </div>
  `
}
