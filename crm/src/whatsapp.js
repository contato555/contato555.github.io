// WhatsApp Business Platform (Cloud API da Meta): envio de mensagens, templates e webhook de recebimento.
const crypto = require('crypto');
const GRAPH = () => process.env.WHATSAPP_GRAPH_URL || 'https://graph.facebook.com';

function normalizaFone(f) {
  let d = String(f || '').replace(/\D/g, '');
  if (!d) return '';
  if (d.startsWith('0')) d = d.replace(/^0+/, '');
  if (d.length === 10 || d.length === 11) d = '55' + d; // número brasileiro sem DDI
  return d;
}
// chave para casar números com/sem o 9º dígito (WhatsApp às vezes devolve sem o 9)
function chaveFone(f) {
  const d = normalizaFone(f);
  if (d.startsWith('55') && d.length === 13) return d.slice(0, 4) + d.slice(5);
  return d;
}

function createWhatsApp(db) {
  async function cfg() {
    const c = (await db.get('config', 'whatsapp')) || {};
    return {
      phoneNumberId: c.phoneNumberId || process.env.WHATSAPP_PHONE_NUMBER_ID || '',
      businessAccountId: c.businessAccountId || process.env.WHATSAPP_BUSINESS_ACCOUNT_ID || '',
      token: c.token || process.env.WHATSAPP_TOKEN || '',
      verifyToken: c.verifyToken || process.env.WHATSAPP_VERIFY_TOKEN || '',
      appSecret: c.appSecret || process.env.WHATSAPP_APP_SECRET || '',
      apiVersion: c.apiVersion || process.env.WHATSAPP_API_VERSION || 'v21.0',
    };
  }

  async function graph(method, path, body) {
    const c = await cfg();
    if (!c.token) throw new Error('WhatsApp não configurado (token ausente).');
    const r = await fetch(`${GRAPH()}/${c.apiVersion}/${path}`, {
      method,
      headers: { Authorization: 'Bearer ' + c.token, 'Content-Type': 'application/json' },
      body: body ? JSON.stringify(body) : undefined,
    });
    const j = await r.json().catch(() => ({}));
    if (!r.ok) {
      const e = j.error || {};
      const msg = e.code === 131047 || e.code === 131026
        ? 'Fora da janela de 24h: o cliente não respondeu nas últimas 24 horas. Envie um template aprovado.'
        : (e.error_data && e.error_data.details) || e.message || `HTTP ${r.status}`;
      const err = new Error('WhatsApp: ' + msg); err.status = r.status; throw err;
    }
    return j;
  }

  async function registra(fone, msg, extra = {}) {
    const id = chaveFone(fone);
    const conv = (await db.get('wa_conversas', id)) || { id, telefone: normalizaFone(fone), naoLidas: 0 };
    const cliente = conv.clienteId ? null : (await db.list('clientes', (c) => [c.celular, c.telefone, c.whatsapp].some((t) => t && chaveFone(t) === id)))[0];
    const m = await db.insert('wa_mensagens', { conversaId: id, ...msg });
    await db.put('wa_conversas', id, {
      ...conv, ...extra,
      ...(cliente ? { clienteId: cliente.id, nome: conv.nome || cliente.nome } : {}),
      ultimaMensagem: msg.texto || `[${msg.tipo}]`, ultimaData: m.criadoEm,
      ...(msg.direcao === 'in' ? { naoLidas: (conv.naoLidas || 0) + 1, ultimaEntrada: m.criadoEm } : {}),
    });
    return m;
  }

  async function enviarTexto(fone, texto, user) {
    const c = await cfg();
    const to = normalizaFone(fone);
    if (!to) throw new Error('Telefone inválido');
    const r = await graph('POST', `${c.phoneNumberId}/messages`, { messaging_product: 'whatsapp', recipient_type: 'individual', to, type: 'text', text: { preview_url: false, body: texto } });
    return registra(to, { direcao: 'out', tipo: 'text', texto, waId: r.messages && r.messages[0] && r.messages[0].id, status: 'sent', usuarioId: user && user.id, usuarioNome: user && user.nome });
  }

  async function enviarTemplate(fone, nome, idioma, parametros, user) {
    const c = await cfg();
    const to = normalizaFone(fone);
    const components = parametros && parametros.length ? [{ type: 'body', parameters: parametros.map((t) => ({ type: 'text', text: String(t) })) }] : undefined;
    const r = await graph('POST', `${c.phoneNumberId}/messages`, { messaging_product: 'whatsapp', to, type: 'template', template: { name: nome, language: { code: idioma || 'pt_BR' }, components } });
    return registra(to, { direcao: 'out', tipo: 'template', texto: `[template ${nome}] ${(parametros || []).join(' | ')}`, waId: r.messages && r.messages[0] && r.messages[0].id, status: 'sent', usuarioId: user && user.id, usuarioNome: user && user.nome });
  }

  async function templates() {
    const c = await cfg();
    if (!c.businessAccountId) return [];
    const r = await graph('GET', `${c.businessAccountId}/message_templates?limit=100&status=APPROVED`);
    return (r.data || []).map((t) => ({ nome: t.name, idioma: t.language, categoria: t.category, corpo: ((t.components || []).find((x) => x.type === 'BODY') || {}).text || '' }));
  }

  function verificaAssinatura(rawBody, header, appSecret) {
    if (!appSecret) return true;
    if (!header || !rawBody) return false;
    const esperado = 'sha256=' + crypto.createHmac('sha256', appSecret).update(rawBody).digest('hex');
    const a = Buffer.from(esperado), b = Buffer.from(String(header));
    return a.length === b.length && crypto.timingSafeEqual(a, b);
  }

  async function processaWebhook(body) {
    for (const entry of body.entry || []) {
      for (const ch of entry.changes || []) {
        const v = ch.value || {};
        const nomes = Object.fromEntries((v.contacts || []).map((c) => [c.wa_id, c.profile && c.profile.name]));
        for (const m of v.messages || []) {
          const texto = m.type === 'text' ? m.text.body
            : m.type === 'button' ? m.button.text
            : m.type === 'interactive' ? ((m.interactive.button_reply || m.interactive.list_reply || {}).title || '')
            : m.type === 'location' ? `📍 ${m.location.latitude},${m.location.longitude}`
            : (m[m.type] && m[m.type].caption) || `[${m.type}]`;
          const ja = await db.list('wa_mensagens', (x) => x.waId === m.id);
          if (ja.length) continue;
          await registra(m.from, { direcao: 'in', tipo: m.type, texto, waId: m.id, midiaId: (m[m.type] && m[m.type].id) || null, timestamp: Number(m.timestamp) * 1000 }, nomes[m.from] ? { nomePerfil: nomes[m.from] } : {});
        }
        for (const s of v.statuses || []) {
          const msg = (await db.list('wa_mensagens', (x) => x.waId === s.id))[0];
          if (msg) await db.update('wa_mensagens', msg.id, { status: s.status, ...(s.errors ? { erro: s.errors.map((e) => e.title || e.message).join('; ') } : {}) });
        }
      }
    }
  }

  return { cfg, enviarTexto, enviarTemplate, templates, verificaAssinatura, processaWebhook, registra };
}

module.exports = { createWhatsApp, normalizaFone, chaveFone };
