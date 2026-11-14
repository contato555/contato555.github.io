// OAuth e sincronização com o Bling + webhook e caixa de entrada do WhatsApp.
const crypto = require('crypto');
const { need } = require('../auth');
const { normalizaFone, chaveFone } = require('../whatsapp');

module.exports = function integracoes(app, ctx, publicRouter) {
  const { db, bling, wa, audit } = ctx;

  // ---------- Configurações ----------
  const mascara = (s) => (s ? '••••' + String(s).slice(-4) : '');
  app.get('/api/config', need('config.gerenciar'), async (req, res) => {
    const b = (await db.get('config', 'bling')) || {}, w = (await db.get('config', 'whatsapp')) || {}, e = (await db.get('config', 'empresa')) || {};
    const base = `${req.protocol}://${req.get('host')}`;
    res.json({
      empresa: e,
      bling: { clientId: b.clientId || process.env.BLING_CLIENT_ID || '', clientSecret: mascara(b.clientSecret || process.env.BLING_CLIENT_SECRET), redirectUri: b.redirectUri || process.env.BLING_REDIRECT_URI || `${base}/api/bling/callback`, status: await bling.status() },
      whatsapp: { phoneNumberId: w.phoneNumberId || '', businessAccountId: w.businessAccountId || '', token: mascara(w.token || process.env.WHATSAPP_TOKEN), verifyToken: w.verifyToken || '', appSecret: mascara(w.appSecret), apiVersion: w.apiVersion || 'v21.0', webhookUrl: `${base}/api/whatsapp/webhook` },
    });
  });
  app.put('/api/config/:sec', need('config.gerenciar'), async (req, res) => {
    const sec = req.params.sec;
    if (!['bling', 'whatsapp', 'empresa'].includes(sec)) return res.status(400).json({ erro: 'Seção inválida' });
    const cur = (await db.get('config', sec)) || {};
    const patch = {};
    for (const [k, v] of Object.entries(req.body || {})) if (typeof v !== 'object' && !String(v).startsWith('••••')) patch[k] = String(v).trim();
    if (sec === 'whatsapp' && !cur.verifyToken && !patch.verifyToken) patch.verifyToken = crypto.randomBytes(12).toString('hex');
    await db.put('config', sec, { ...cur, ...patch });
    await audit(req, 'config', 'config', sec, Object.keys(patch).join(','));
    res.json({ ok: true });
  });

  // ---------- Bling OAuth ----------
  app.get('/api/bling/autorizar', need('config.gerenciar'), async (req, res, next) => {
    try {
      const state = crypto.randomBytes(16).toString('hex');
      await db.put('config', 'bling_state', { state, usuarioId: req.user.id, em: Date.now() });
      res.json({ url: await bling.authorizeUrl(state) });
    } catch (e) { next(e); }
  });
  publicRouter.get('/api/bling/callback', async (req, res) => {
    const st = await db.get('config', 'bling_state');
    if (!req.query.code || !st || st.state !== req.query.state || Date.now() - st.em > 15 * 60 * 1000) return res.redirect('/#/config?bling=erro_state');
    try {
      await bling.exchangeCode(req.query.code);
      await db.remove('config', 'bling_state');
      res.redirect('/#/config?bling=ok');
    } catch (e) { res.redirect('/#/config?bling=' + encodeURIComponent('erro: ' + e.message)); }
  });
  app.get('/api/bling/status', async (req, res) => res.json(await bling.status()));

  // ---------- Sincronizações ----------
  async function marcaSync(tipo, qtd) {
    const c = (await db.get('config', 'bling')) || {};
    await db.put('config', 'bling', { ...c, ultimaSync: { ...(c.ultimaSync || {}), [tipo]: { em: new Date().toISOString(), qtd } } });
  }
  const syncs = {
    async produtos() {
      const rows = await bling.paginate('/produtos', { criterio: 5 });
      const docs = rows.map((p) => ({
        id: String(p.id), nome: p.nome, codigo: p.codigo || '', preco: Number(p.preco || 0), precoCusto: Number(p.precoCusto || 0), unidade: p.unidade || 'UN', tipo: p.tipo, situacao: p.situacao, formato: p.formato,
        estoque: p.estoque ? Number(p.estoque.saldoVirtualTotal ?? 0) : null, imagem: p.imagemURL || '', gtin: p.gtin || '', idProdutoPai: p.idProdutoPai || null, origem: 'bling',
      }));
      await db.bulkSet('produtos', docs);
      return docs.length;
    },
    async vendedores() {
      const rows = await bling.paginate('/vendedores', { situacaoContato: 'A' });
      const docs = [];
      for (const v of rows) {
        let nome = v.contato && v.contato.nome;
        if (!nome) { const d = await bling.get(`/vendedores/${v.id}`).catch(() => null); nome = d && d.data && d.data.contato && d.data.contato.nome; }
        docs.push({ id: String(v.id), nome: nome || `Vendedor ${v.id}`, contatoId: v.contato ? String(v.contato.id) : '', descontoLimite: Number(v.descontoLimite || 0), lojaId: v.loja ? String(v.loja.id || '') : '' });
      }
      await db.bulkSet('vendedores', docs);
      return docs.length;
    },
    async clientes() {
      const rows = await bling.paginate('/contatos', { criterio: 1 });
      const existentes = await db.list('clientes');
      const porBling = Object.fromEntries(existentes.filter((c) => c.blingId).map((c) => [c.blingId, c]));
      const docs = rows.map((c) => {
        const cur = porBling[String(c.id)] || {};
        return {
          ...cur, id: cur.id || 'b' + c.id, blingId: String(c.id), nome: c.nome, codigo: c.codigo || '', documento: c.numeroDocumento || cur.documento || '',
          telefone: c.telefone || cur.telefone || '', celular: c.celular || cur.celular || '', situacao: c.situacao === 'I' ? 'inativo' : 'ativo',
          criadoEm: cur.criadoEm || new Date().toISOString(), origem: cur.origem || 'bling', vendedorId: cur.vendedorId || '',
        };
      });
      await db.bulkSet('clientes', docs);
      return docs.length;
    },
    async formas_pagamento() {
      const rows = await bling.paginate('/formas-pagamentos', {});
      await db.bulkSet('formas_pagamento', rows.map((f) => ({ id: String(f.id), descricao: f.descricao, tipoPagamento: f.tipoPagamento, situacao: f.situacao })));
      return rows.length;
    },
  };
  const permSync = { produtos: 'produtos.sincronizar', vendedores: 'vendedores.sincronizar', clientes: 'clientes.editar', formas_pagamento: 'produtos.sincronizar' };
  app.post('/api/bling/sync/:tipo', async (req, res) => {
    const t = req.params.tipo;
    if (!syncs[t]) return res.status(400).json({ erro: 'Tipo inválido' });
    if (!req.can(permSync[t]) && !req.can('config.gerenciar')) return res.status(403).json({ erro: 'Sem permissão' });
    try {
      const qtd = await syncs[t]();
      await marcaSync(t, qtd);
      await audit(req, 'sync_bling', t, '', `${qtd} registros`);
      res.json({ ok: true, qtd });
    } catch (e) { res.status(502).json({ erro: 'Falha ao sincronizar com Bling: ' + e.message }); }
  });
  // atualiza detalhes completos de um cliente vindo do Bling (e-mail, endereço, vendedor)
  app.post('/api/clientes/:id/atualizar-bling', need('clientes.editar'), async (req, res) => {
    const c = await db.get('clientes', req.params.id);
    if (!c || !c.blingId) return res.status(400).json({ erro: 'Cliente não vinculado ao Bling' });
    try {
      const d = (await bling.get(`/contatos/${c.blingId}`)).data || {};
      const g = (d.endereco && d.endereco.geral) || {};
      res.json(await db.update('clientes', c.id, {
        nome: d.nome || c.nome, fantasia: d.fantasia || c.fantasia || '', documento: d.numeroDocumento || c.documento || '', ie: d.ie || c.ie || '', email: d.email || c.email || '',
        telefone: d.telefone || c.telefone || '', celular: d.celular || c.celular || '', tipoPessoa: d.tipo || c.tipoPessoa || '',
        cep: g.cep || c.cep || '', endereco: g.endereco || c.endereco || '', numero: g.numero || c.numero || '', complemento: g.complemento || c.complemento || '', bairro: g.bairro || c.bairro || '', cidade: g.municipio || c.cidade || '', uf: g.uf || c.uf || '',
        vendedorId: d.vendedor && d.vendedor.id ? String(d.vendedor.id) : c.vendedorId || '',
      }));
    } catch (e) { res.status(502).json({ erro: e.message }); }
  });

  // sincronização automática opcional (Cloud Scheduler → POST /api/cron/sync com header X-Cron-Key)
  publicRouter.post('/api/cron/sync', async (req, res) => {
    if (!process.env.CRON_KEY || req.get('x-cron-key') !== process.env.CRON_KEY) return res.status(403).json({ erro: 'Proibido' });
    const out = {};
    for (const t of String(req.query.tipos || 'produtos,vendedores').split(',')) {
      try { out[t] = await syncs[t](); await marcaSync(t, out[t]); } catch (e) { out[t] = 'erro: ' + e.message; }
    }
    res.json(out);
  });

  // ---------- WhatsApp: webhook público ----------
  publicRouter.get('/api/whatsapp/webhook', async (req, res) => {
    const c = await wa.cfg();
    if (req.query['hub.mode'] === 'subscribe' && c.verifyToken && req.query['hub.verify_token'] === c.verifyToken) return res.status(200).send(req.query['hub.challenge']);
    res.sendStatus(403);
  });
  publicRouter.post('/api/whatsapp/webhook', async (req, res) => {
    const c = await wa.cfg();
    if (!wa.verificaAssinatura(req.rawBody, req.get('x-hub-signature-256'), c.appSecret)) return res.sendStatus(401);
    try { await wa.processaWebhook(req.body || {}); } catch (e) { console.error('webhook whatsapp', e); }
    res.sendStatus(200);
  });

  // ---------- WhatsApp: caixa de entrada ----------
  const podeVerConversa = (req, c) => req.can('whatsapp.ver_todas') || !c.responsavelId || c.responsavelId === req.user.id;
  app.get('/api/whatsapp/conversas', need('whatsapp.ver'), async (req, res) => {
    const [cs, cls] = await Promise.all([db.list('wa_conversas', (c) => podeVerConversa(req, c)), db.list('clientes')]);
    const cm = Object.fromEntries(cls.map((c) => [c.id, c.nome]));
    res.json(cs.map((c) => ({ ...c, clienteNome: cm[c.clienteId] || '' })).sort((a, b) => (b.ultimaData > a.ultimaData ? 1 : -1)));
  });
  app.get('/api/whatsapp/conversas/:id', need('whatsapp.ver'), async (req, res) => {
    const conv = await db.get('wa_conversas', req.params.id);
    if (!conv || !podeVerConversa(req, conv)) return res.status(404).json({ erro: 'Conversa não encontrada' });
    if (conv.naoLidas) await db.update('wa_conversas', conv.id, { naoLidas: 0 });
    const msgs = await db.list('wa_mensagens', (m) => m.conversaId === conv.id);
    const dentroJanela = conv.ultimaEntrada && Date.now() - new Date(conv.ultimaEntrada).getTime() < 24 * 3600 * 1000;
    res.json({ ...conv, dentroJanela: !!dentroJanela, mensagens: msgs.sort((a, b) => (a.criadoEm > b.criadoEm ? 1 : -1)).slice(-300) });
  });
  app.put('/api/whatsapp/conversas/:id', need('whatsapp.enviar'), async (req, res) => {
    const patch = {};
    for (const k of ['clienteId', 'responsavelId', 'nome', 'etiqueta', 'arquivada']) if (req.body[k] !== undefined) patch[k] = req.body[k];
    res.json(await db.update('wa_conversas', req.params.id, patch));
  });
  app.post('/api/whatsapp/enviar', need('whatsapp.enviar'), async (req, res, next) => {
    try {
      const { telefone, texto, template, idioma, parametros } = req.body;
      if (!telefone) return res.status(400).json({ erro: 'Informe o telefone' });
      const m = template ? await wa.enviarTemplate(telefone, template, idioma, parametros, req.user) : await wa.enviarTexto(telefone, String(texto || ''), req.user);
      const conv = await db.get('wa_conversas', chaveFone(telefone));
      if (conv && !conv.responsavelId) await db.update('wa_conversas', conv.id, { responsavelId: req.user.id });
      res.json(m);
    } catch (e) { next(e); }
  });
  app.get('/api/whatsapp/templates', need('whatsapp.enviar'), async (req, res) => {
    try { res.json(await wa.templates()); } catch (e) { res.json([]); }
  });
  // respostas rápidas (internas do CRM)
  app.get('/api/respostas', need('whatsapp.ver'), async (req, res) => res.json(await db.list('respostas')));
  app.post('/api/respostas', need('whatsapp.enviar'), async (req, res) => res.json(await db.insert('respostas', { atalho: req.body.atalho || '', texto: req.body.texto || '' })));
  app.delete('/api/respostas/:id', need('whatsapp.enviar'), async (req, res) => { await db.remove('respostas', req.params.id); res.json({ ok: true }); });
  // criar cliente a partir da conversa
  app.post('/api/whatsapp/conversas/:id/criar-cliente', need('clientes.editar'), async (req, res) => {
    const conv = await db.get('wa_conversas', req.params.id);
    if (!conv) return res.status(404).json({ erro: 'Conversa não encontrada' });
    const c = await db.insert('clientes', { nome: req.body.nome || conv.nomePerfil || conv.telefone, whatsapp: conv.telefone, celular: conv.telefone, origem: 'whatsapp', situacao: 'ativo', vendedorId: req.user.vendedorId || '', criadoPor: req.user.id });
    await db.update('wa_conversas', conv.id, { clienteId: c.id, nome: c.nome });
    res.json(c);
  });
  ctx.normalizaFone = normalizaFone;
};
