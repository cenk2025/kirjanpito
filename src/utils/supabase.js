// ═══════════════════════════════════════════════════════
// SUPABASE — tietokanta-, tunnistus- ja tallennusrajapinta
//
// Kirjanpitoon kirjoitetaan vain tietokantafunktioiden (RPC) kautta.
// Tietokanta valvoo täsmäytyksen, lukitukset ja numeroinnin.
// ═══════════════════════════════════════════════════════

import { createClient } from '@supabase/supabase-js'

const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL
const SUPABASE_ANON_KEY = import.meta.env.VITE_SUPABASE_ANON_KEY

export const supabaseMaaritetty = !!(SUPABASE_URL && SUPABASE_ANON_KEY)

if (!supabaseMaaritetty) {
  console.warn('[Supabase] Ympäristömuuttujat puuttuvat. Kopioi .env.example → .env ja lisää arvot.')
}

export const supabase = createClient(SUPABASE_URL || 'http://localhost', SUPABASE_ANON_KEY || 'puuttuu', {
  auth: {
    persistSession: true,
    autoRefreshToken: true,
    detectSessionInUrl: false,
    flowType: 'pkce',
  },
})

export const LIITE_BUCKET = 'tositteet'

function tarkista({ data, error }) {
  if (error) throw new Error(error.message || 'Tietokantavirhe')
  return data
}

async function rpc(nimi, parametrit = {}) {
  return tarkista(await supabase.rpc(nimi, parametrit))
}

/** Hakee kaikki rivit sivuttain (PostgREST palauttaa enintään 1000 riviä kerralla) */
async function sivuta(rakenna, koko = 1000) {
  const tulos = []
  for (let alku = 0; ; alku += koko) {
    const sivu = tarkista(await rakenna().range(alku, alku + koko - 1)) || []
    tulos.push(...sivu)
    if (sivu.length < koko) return tulos
  }
}

// ─── Tunnistautuminen ──────────────────────────────────

export async function kirjauduSisaan(email, salasana) {
  return tarkista(await supabase.auth.signInWithPassword({ email, password: salasana }))
}

export async function kirjauduUlos() {
  const { error } = await supabase.auth.signOut()
  if (error) throw error
}

export async function haeKayttaja() {
  const { data: { session } } = await supabase.auth.getSession()
  if (!session) return null
  const { data: { user } } = await supabase.auth.getUser()
  return user
}

export function onAuthStateChange(callback) {
  return supabase.auth.onAuthStateChange(callback)
}

export async function vaihdaSalasana(uusi) {
  return tarkista(await supabase.auth.updateUser({ password: uusi }))
}

// ─── Kaksivaiheinen tunnistautuminen (TOTP) ───────────

export async function mfaTaso() {
  return tarkista(await supabase.auth.mfa.getAuthenticatorAssuranceLevel())
}

export async function mfaTekijat() {
  const data = tarkista(await supabase.auth.mfa.listFactors())
  return data.totp || []
}

export async function mfaAloitaRekisterointi() {
  // Poistetaan keskeneräiset, vahvistamattomat tekijät
  const kaikki = tarkista(await supabase.auth.mfa.listFactors()).all || []
  for (const f of kaikki.filter(f => f.status !== 'verified')) {
    await supabase.auth.mfa.unenroll({ factorId: f.id })
  }
  return tarkista(await supabase.auth.mfa.enroll({ factorType: 'totp', friendlyName: 'Kirjanpito ' + Date.now() }))
}

export async function mfaVahvista(factorId, koodi) {
  return tarkista(await supabase.auth.mfa.challengeAndVerify({ factorId, code: koodi }))
}

export async function mfaPoista(factorId) {
  return tarkista(await supabase.auth.mfa.unenroll({ factorId }))
}

// ─── Profiili ja alustus ──────────────────────────────

export async function alustaKirjanpito() {
  return rpc('alusta_kirjanpito')
}

export async function haeProfiili(userId) {
  const { data, error } = await supabase.from('profiilit').select('*').eq('user_id', userId).maybeSingle()
  if (error) throw new Error(error.message)
  return data
}

export async function tallennaProfiili(userId, profiili) {
  return tarkista(await supabase.from('profiilit')
    .upsert({ ...profiili, user_id: userId }, { onConflict: 'user_id' }).select().single())
}

// ─── Tilikaudet ja tilit ──────────────────────────────

export async function haeTilikaudet() {
  return tarkista(await supabase.from('tilikaudet').select('*').order('alku', { ascending: false })) || []
}

export async function luoTilikausi(alku, loppu) {
  return rpc('luo_tilikausi', { p_alku: alku, p_loppu: loppu })
}

export async function muutaTilikausi(id, alku, loppu) {
  return rpc('muuta_tilikausi', { p_id: id, p_alku: alku, p_loppu: loppu })
}

export async function lukitseTilikausi(id) {
  return rpc('lukitse_tilikausi', { p_id: id })
}

export async function haeTilit() {
  return tarkista(await supabase.from('tilit').select('*').order('numero')) || []
}

export async function lisaaTili(userId, tili) {
  return tarkista(await supabase.from('tilit').insert({ ...tili, user_id: userId }).select().single())
}

export async function paivitaTili(id, muutokset) {
  return tarkista(await supabase.from('tilit').update(muutokset).eq('id', id).select().single())
}

// ─── Asiakkaat ─────────────────────────────────────────

export async function haeAsiakkaat() {
  return tarkista(await supabase.from('asiakkaat').select('*').order('nimi')) || []
}

export async function tallennaAsiakas(userId, asiakas) {
  const { id, ...muut } = asiakas
  const payload = { ...muut, user_id: userId }
  if (id) return tarkista(await supabase.from('asiakkaat').update(payload).eq('id', id).select().single())
  return tarkista(await supabase.from('asiakkaat').insert(payload).select().single())
}

export async function poistaAsiakas(id) {
  const { error } = await supabase.from('asiakkaat').delete().eq('id', id)
  if (error) {
    if (error.code === '23503') {
      // Asiakkaalla on laskuja: arkistoidaan poistamisen sijaan
      return tarkista(await supabase.from('asiakkaat').update({ arkistoitu: true }).eq('id', id).select().single())
    }
    throw new Error(error.message)
  }
  return null
}

// ─── Laskut ────────────────────────────────────────────

export async function haeLaskut() {
  return sivuta(() => supabase.from('laskut')
    .select('*, asiakas:asiakkaat(nimi), rivit:laskurivit(*)')
    .order('laskupaiva', { ascending: false })
    .order('laskunumero', { ascending: false, nullsFirst: true })
    .order('id'))
}

export async function haeLasku(id) {
  const lasku = tarkista(await supabase.from('laskut')
    .select('*, asiakas:asiakkaat(*), rivit:laskurivit(*)').eq('id', id).maybeSingle())
  if (lasku?.rivit) lasku.rivit.sort((a, b) => (a.jarjestys ?? 0) - (b.jarjestys ?? 0))
  return lasku
}

/** Tallentaa luonnoksen (rivit korvataan). Lähetetty lasku on lukittu tietokannassa. */
export async function tallennaLaskuluonnos(userId, lasku, rivit) {
  const { id, ...kentat } = lasku
  const payload = { ...kentat, user_id: userId, tila: 'luonnos' }
  let laskuId = id
  if (id) {
    tarkista(await supabase.from('laskut').update(payload).eq('id', id).select('id').single())
    tarkista(await supabase.from('laskurivit').delete().eq('lasku_id', id))
  } else {
    laskuId = tarkista(await supabase.from('laskut').insert(payload).select('id').single()).id
  }
  if (rivit.length > 0) {
    tarkista(await supabase.from('laskurivit').insert(
      rivit.map((r, i) => ({ ...r, lasku_id: laskuId, jarjestys: i }))))
  }
  return laskuId
}

export async function poistaLaskuluonnos(id) {
  tarkista(await supabase.from('laskut').delete().eq('id', id))
}

export async function lahetaLasku(id) {
  return rpc('laheta_lasku', { p_lasku: id })
}

export async function kirjaaMaksu(laskuId, pvm, summa, pankkitapahtumaId = null) {
  return rpc('kirjaa_maksu', { p_lasku: laskuId, p_pvm: pvm, p_summa: summa, p_pankkitapahtuma: pankkitapahtumaId })
}

export async function luoHyvityslasku(laskuId, syy, pvm) {
  return rpc('luo_hyvityslasku', { p_lasku: laskuId, p_syy: syy, p_pvm: pvm })
}

// ─── Kulut ─────────────────────────────────────────────

export async function haeKulut(alku, loppu) {
  return sivuta(() => {
    let q = supabase.from('kulut').select('*, tili:tilit(numero, nimi)').order('paiva', { ascending: false }).order('id')
    if (alku) q = q.gte('paiva', alku)
    if (loppu) q = q.lte('paiva', loppu)
    return q
  })
}

export async function tallennaKulu(kulu) {
  return rpc('tallenna_kulu', { p: kulu })
}

export async function peruKulu(id, syy) {
  return rpc('peru_kulu', { p_id: id, p_syy: syy })
}

export async function lisaaKulunLiite(id, polku) {
  return rpc('lisaa_kulun_liite', { p_id: id, p_polku: polku })
}

// ─── Tositeliitteet (Storage) ──────────────────────────

const SALLITUT_TYYPIT = ['application/pdf', 'image/jpeg', 'image/png', 'image/webp', 'image/heic',
  'application/xml', 'text/xml']

export async function lataaLiite(userId, tiedosto) {
  if (!SALLITUT_TYYPIT.includes(tiedosto.type)) throw new Error('Sallitut tiedostot: PDF, JPG, PNG, WEBP, HEIC, XML')
  if (tiedosto.size > 10 * 1024 * 1024) throw new Error('Tiedosto on yli 10 Mt')
  const turvallinen = tiedosto.name.normalize('NFKD').replace(/[^\w.-]+/g, '_').slice(-80)
  const polku = `${userId}/${new Date().getFullYear()}/${crypto.randomUUID()}-${turvallinen}`
  tarkista(await supabase.storage.from(LIITE_BUCKET).upload(polku, tiedosto, {
    contentType: tiedosto.type, upsert: false,
  }))
  return polku
}

export async function liitteenLinkki(polku) {
  const data = tarkista(await supabase.storage.from(LIITE_BUCKET).createSignedUrl(polku, 120))
  return data.signedUrl
}

// ─── Kirjanpito ────────────────────────────────────────

export async function haeTositteet(alku, loppu) {
  return sivuta(() => supabase.from('tositteet')
    .select('*, viennit(*, tili:tilit(numero, nimi))')
    .gte('pvm', alku).lte('pvm', loppu)
    .order('pvm').order('numero'), 500)
}

export async function haeTilinViennit(tiliNumero, alku, loppu) {
  return sivuta(() => supabase.from('viennit')
    .select('*, tili:tilit!inner(numero, nimi), tosite:tositteet!inner(numero, pvm, selite, lahde)')
    .eq('tili.numero', tiliNumero)
    .gte('tosite.pvm', alku).lte('tosite.pvm', loppu)
    .order('id'))
}

export async function haeTilisaldot(alku, loppu) {
  return rpc('tilisaldot', { p_alku: alku, p_loppu: loppu })
}

export async function kirjaaMuistiotosite(pvm, selite, viennit) {
  return rpc('kirjaa_muistiotosite', { p_pvm: pvm, p_selite: selite, p_viennit: viennit })
}

export async function oikaiseTosite(id, syy) {
  return rpc('oikaise_tosite', { p_tosite: id, p_syy: syy })
}

export async function kirjaaVanhatTiedot() {
  return rpc('kirjaa_vanhat_tiedot')
}

// ─── ALV ───────────────────────────────────────────────

export async function haeAlvLaskelma(alku, loppu) {
  return rpc('alv_laskelma', { p_alku: alku, p_loppu: loppu })
}

export async function haeYhteenvetoilmoitus(alku, loppu) {
  return rpc('yhteenvetoilmoitus', { p_alku: alku, p_loppu: loppu })
}

export async function kirjaaAlvTilitys(alku, loppu) {
  return rpc('kirjaa_alv_tilitys', { p_alku: alku, p_loppu: loppu })
}

// ─── Pankki ────────────────────────────────────────────

export async function haePankkitapahtumat(tila = null) {
  return sivuta(() => {
    let q = supabase.from('pankkitapahtumat').select('*').order('pvm', { ascending: false }).order('id')
    if (tila) q = q.eq('tila', tila)
    return q
  })
}

export async function tuoPankkitapahtumat(tapahtumat) {
  return rpc('tuo_pankkitapahtumat', { p: tapahtumat })
}

export async function kirjaaPankkitapahtuma(id, tili, selite) {
  return rpc('kirjaa_pankkitapahtuma', { p_id: id, p_tili: tili, p_selite: selite })
}

export async function ohitaPankkitapahtuma(id, ohita = true) {
  return rpc('ohita_pankkitapahtuma', { p_id: id, p_ohita: ohita })
}

// ─── Muutosloki ja varmuuskopio ────────────────────────

export async function haeMuutosloki(raja = 200) {
  return tarkista(await supabase.from('muutosloki').select('*').order('aika', { ascending: false }).limit(raja)) || []
}

/** Hakee kaikki käyttäjän tiedot varmuuskopioon (sivutettuna) */
export async function haeKaikki(taulu, valinta = '*') {
  const jarjestys = taulu === 'profiilit' || taulu === 'numerosarjat' ? 'user_id' : 'id'
  return sivuta(() => supabase.from(taulu).select(valinta).order(jarjestys))
}
