// Supabase client — credentials set in .env
// Kopioi .env.example tiedosto .env:ksi ja lisää oikeat arvot

const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL
const SUPABASE_ANON_KEY = import.meta.env.VITE_SUPABASE_ANON_KEY

if (!SUPABASE_URL || !SUPABASE_ANON_KEY) {
  console.warn('[Supabase] Ympäristömuuttujat puuttuvat. Kopioi .env.example → .env ja lisää arvot.')
}

// Ladataan Supabase CDN:stä (ei npm-riippuvuutta)
let _supabase = null

export async function getSupabase() {
  if (_supabase) return _supabase

  if (!window.supabase) {
    await loadScript('https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/dist/umd/supabase.min.js')
  }

  _supabase = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
    auth: {
      persistSession: true,
      autoRefreshToken: true
    }
  })
  return _supabase
}

function loadScript(src) {
  return new Promise((resolve, reject) => {
    const script = document.createElement('script')
    script.src = src
    script.onload = resolve
    script.onerror = reject
    document.head.appendChild(script)
  })
}

// ─── Auth helpers ──────────────────────────────────────

export async function kirjauduSisaan(email, salasana) {
  const sb = await getSupabase()
  const { data, error } = await sb.auth.signInWithPassword({ email, password: salasana })
  if (error) throw error
  return data
}

export async function rekisteroidy(email, salasana) {
  const sb = await getSupabase()
  const { data, error } = await sb.auth.signUp({ email, password: salasana })
  if (error) throw error
  return data
}

export async function kirjauduUlos() {
  const sb = await getSupabase()
  const { error } = await sb.auth.signOut()
  if (error) throw error
}

export async function haeKayttaja() {
  const sb = await getSupabase()
  const { data: { user } } = await sb.auth.getUser()
  return user
}

export async function onAuthStateChange(callback) {
  const sb = await getSupabase()
  return sb.auth.onAuthStateChange(callback)
}

// ─── Database helpers ──────────────────────────────────

export async function haeProfiili(userId) {
  const sb = await getSupabase()
  const { data, error } = await sb
    .from('profiilit')
    .select('*')
    .eq('user_id', userId)
    .single()
  if (error && error.code !== 'PGRST116') throw error
  return data
}

export async function tallennaProfiiili(userId, profiili) {
  const sb = await getSupabase()
  const { data, error } = await sb
    .from('profiilit')
    .upsert({ ...profiili, user_id: userId }, { onConflict: 'user_id' })
    .select()
    .single()
  if (error) throw error
  return data
}

// ─── Asiakkaat (Clients) ───────────────────────────────

export async function haeAsiakkaat(userId) {
  const sb = await getSupabase()
  const { data, error } = await sb
    .from('asiakkaat')
    .select('*')
    .eq('user_id', userId)
    .order('nimi')
  if (error) throw error
  return data || []
}

export async function tallennaAsiakas(userId, asiakas) {
  const sb = await getSupabase()
  const payload = { ...asiakas, user_id: userId }
  if (asiakas.id) {
    const { data, error } = await sb.from('asiakkaat').update(payload).eq('id', asiakas.id).select().single()
    if (error) throw error
    return data
  } else {
    const { data, error } = await sb.from('asiakkaat').insert(payload).select().single()
    if (error) throw error
    return data
  }
}

export async function poistaAsiakas(id) {
  const sb = await getSupabase()
  const { error } = await sb.from('asiakkaat').delete().eq('id', id)
  if (error) throw error
}

// ─── Laskut (Invoices) ────────────────────────────────

export async function haeLaskut(userId) {
  const sb = await getSupabase()
  const { data, error } = await sb
    .from('laskut')
    .select(`*, asiakas:asiakkaat(nimi), rivit:laskurivit(*)`)
    .eq('user_id', userId)
    .order('laskupaiva', { ascending: false })
  if (error) throw error
  return data || []
}

export async function haeLasku(id) {
  const sb = await getSupabase()
  const { data, error } = await sb
    .from('laskut')
    .select(`*, asiakas:asiakkaat(*), rivit:laskurivit(*)`)
    .eq('id', id)
    .single()
  if (error) throw error
  return data
}

export async function tallennaLasku(userId, lasku, rivit) {
  const sb = await getSupabase()
  let laskuData

  if (lasku.id) {
    const { data, error } = await sb
      .from('laskut')
      .update({ ...lasku, user_id: userId })
      .eq('id', lasku.id)
      .select()
      .single()
    if (error) throw error
    laskuData = data
    // Poistetaan vanhat rivit
    await sb.from('laskurivit').delete().eq('lasku_id', lasku.id)
  } else {
    const { data, error } = await sb
      .from('laskut')
      .insert({ ...lasku, user_id: userId })
      .select()
      .single()
    if (error) throw error
    laskuData = data
  }

  // Lisätään uudet rivit
  if (rivit && rivit.length > 0) {
    const riviData = rivit.map(r => ({ ...r, lasku_id: laskuData.id }))
    const { error: riviError } = await sb.from('laskurivit').insert(riviData)
    if (riviError) throw riviError
  }

  return laskuData
}

export async function paivitaLaskunTila(id, tila) {
  const sb = await getSupabase()
  const { data, error } = await sb
    .from('laskut')
    .update({ tila, maksettu_pvm: tila === 'maksettu' ? new Date().toISOString().split('T')[0] : null })
    .eq('id', id)
    .select()
    .single()
  if (error) throw error
  return data
}

export async function poistaLasku(id) {
  const sb = await getSupabase()
  await sb.from('laskurivit').delete().eq('lasku_id', id)
  const { error } = await sb.from('laskut').delete().eq('id', id)
  if (error) throw error
}

export async function haeSeuraavaLaskunumero(userId) {
  const sb = await getSupabase()
  const vuosi = new Date().getFullYear()
  const { data, error } = await sb
    .from('laskut')
    .select('laskunumero')
    .eq('user_id', userId)
    .like('laskunumero', `${vuosi}-%`)
    .order('laskunumero', { ascending: false })
    .limit(1)
  if (error) throw error
  if (!data || data.length === 0) return `${vuosi}-001`
  const viimeisin = data[0].laskunumero
  const numero = parseInt(viimeisin.split('-')[1] || '0') + 1
  return `${vuosi}-${String(numero).padStart(3, '0')}`
}

// ─── Kulut (Expenses) ─────────────────────────────────

export async function haeKulut(userId, alku, loppu) {
  const sb = await getSupabase()
  let query = sb
    .from('kulut')
    .select('*')
    .eq('user_id', userId)
    .order('paiva', { ascending: false })
  if (alku) query = query.gte('paiva', alku)
  if (loppu) query = query.lte('paiva', loppu)
  const { data, error } = await query
  if (error) throw error
  return data || []
}

export async function tallennaKulu(userId, kulu) {
  const sb = await getSupabase()
  const payload = { ...kulu, user_id: userId }
  if (kulu.id) {
    const { data, error } = await sb.from('kulut').update(payload).eq('id', kulu.id).select().single()
    if (error) throw error
    return data
  } else {
    const { data, error } = await sb.from('kulut').insert(payload).select().single()
    if (error) throw error
    return data
  }
}

export async function poistaKulu(id) {
  const sb = await getSupabase()
  const { error } = await sb.from('kulut').delete().eq('id', id)
  if (error) throw error
}

// ─── Tilastot (Stats) ─────────────────────────────────

export async function haeLiikevaihtoKuukausittain(userId, vuosi) {
  const sb = await getSupabase()
  const { data, error } = await sb
    .from('laskut')
    .select('laskupaiva, rivit:laskurivit(maara, yksikkohinta, alv_kanta)')
    .eq('user_id', userId)
    .in('tila', ['maksettu', 'lahetetty'])
    .gte('laskupaiva', `${vuosi}-01-01`)
    .lte('laskupaiva', `${vuosi}-12-31`)
  if (error) throw error
  return data || []
}
