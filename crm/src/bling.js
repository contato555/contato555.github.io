// Cliente da API Bling v3 (OAuth2): tokens, renovação automática, limite de 3 req/s e paginação.
const API = () => process.env.BLING_API_URL || 'https://api.bling.com.br/Api/v3';
const AUTH_URL = () => process.env.BLING_AUTH_URL || 'https://www.bling.com.br/Api/v3/oauth/authorize';

class BlingError extends Error {
  constructor(status, body) {
    const e = (body && body.error) || {};
    const campos = (e.fields || []).map((f) => `${f.element || f.namespace || ''}: ${f.msg || f.message || ''}`.trim()).join('; ');
    super([e.description || e.message || (typeof body === 'string' ? body : '') || `HTTP ${status}`, campos].filter(Boolean).join(' — '));
    this.status = status; this.body = body;
  }
}

function createBling(db) {
  let fila = Promise.resolve();
  let ultima = 0;
  const espera = (ms) => new Promise((r) => setTimeout(r, ms));
  const intervalo = Number(process.env.BLING_MIN_INTERVAL_MS ?? 350);

  async function cfg() {
    const c = (await db.get('config', 'bling')) || {};
    return {
      ...c,
      clientId: c.clientId || process.env.BLING_CLIENT_ID || '',
      clientSecret: c.clientSecret || process.env.BLING_CLIENT_SECRET || '',
      redirectUri: c.redirectUri || process.env.BLING_REDIRECT_URI || '',
    };
  }

  async function tokenRequest(params) {
    const c = await cfg();
    if (!c.clientId || !c.clientSecret) throw new Error('Configure Client ID e Client Secret do Bling em Configurações.');
    const r = await fetch(API() + '/oauth/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded', Accept: '1.0', Authorization: 'Basic ' + Buffer.from(`${c.clientId}:${c.clientSecret}`).toString('base64') },
      body: new URLSearchParams(params).toString(),
    });
    const body = await r.json().catch(() => ({}));
    if (!r.ok) throw new BlingError(r.status, body);
    const patch = { accessToken: body.access_token, refreshToken: body.refresh_token, expiresAt: Date.now() + (Number(body.expires_in || 21600) - 120) * 1000, conectadoEm: new Date().toISOString() };
    await db.put('config', 'bling', { ...(await db.get('config', 'bling')), ...patch });
    return patch.accessToken;
  }

  async function authorizeUrl(state) {
    const c = await cfg();
    if (!c.clientId) throw new Error('Configure o Client ID do Bling primeiro.');
    const u = new URL(AUTH_URL());
    u.searchParams.set('response_type', 'code');
    u.searchParams.set('client_id', c.clientId);
    u.searchParams.set('state', state);
    if (c.redirectUri) u.searchParams.set('redirect_uri', c.redirectUri);
    return u.toString();
  }

  const exchangeCode = (code) => tokenRequest({ grant_type: 'authorization_code', code });

  let renovando = null;
  async function accessToken(force) {
    const c = await cfg();
    if (!c.accessToken && !c.refreshToken) throw new Error('Bling não conectado. Vá em Configurações → Conectar ao Bling.');
    if (!force && c.accessToken && Date.now() < (c.expiresAt || 0)) return c.accessToken;
    if (!renovando) renovando = tokenRequest({ grant_type: 'refresh_token', refresh_token: c.refreshToken }).finally(() => { renovando = null; });
    return renovando;
  }

  async function request(method, path, body, tentativa = 0) {
    // serializa chamadas para respeitar o limite da API (3 req/s)
    const exec = fila.then(async () => {
      const w = ultima + intervalo - Date.now();
      if (w > 0) await espera(w);
      ultima = Date.now();
    });
    fila = exec.catch(() => {});
    await exec;
    const tok = await accessToken(tentativa > 0 && tentativa < 2);
    const r = await fetch(API() + path, {
      method,
      headers: { Authorization: 'Bearer ' + tok, Accept: 'application/json', ...(body ? { 'Content-Type': 'application/json' } : {}) },
      body: body ? JSON.stringify(body) : undefined,
    });
    if (r.status === 401 && tentativa === 0) return request(method, path, body, 1);
    if (r.status === 429 && tentativa < 4) { await espera(1100 * (tentativa + 1)); return request(method, path, body, tentativa + 2); }
    const txt = await r.text();
    let json; try { json = txt ? JSON.parse(txt) : {}; } catch { json = txt; }
    if (!r.ok) throw new BlingError(r.status, json);
    return json;
  }

  async function paginate(path, params = {}, max = 200) {
    const out = [];
    for (let pagina = 1; pagina <= max; pagina++) {
      const q = new URLSearchParams({ ...params, pagina, limite: 100 }).toString();
      const r = await request('GET', `${path}?${q}`);
      const data = (r && r.data) || [];
      out.push(...data);
      if (data.length < 100) break;
    }
    return out;
  }

  async function status() {
    const c = await cfg();
    return { configurado: !!(c.clientId && c.clientSecret), conectado: !!c.refreshToken, conectadoEm: c.conectadoEm || null, expiresAt: c.expiresAt || null, redirectUri: c.redirectUri, ultimaSync: c.ultimaSync || {} };
  }

  return { request, paginate, authorizeUrl, exchangeCode, status, cfg, get: (p) => request('GET', p), post: (p, b) => request('POST', p, b), put: (p, b) => request('PUT', p, b) };
}

module.exports = { createBling, BlingError };
