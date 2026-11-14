// Teste ponta a ponta com servidores falsos do Bling e da Meta (WhatsApp). Rode: npm test
const { test, before, after } = require('node:test');
const assert = require('node:assert');
const http = require('http');
const fs = require('fs');
const os = require('os');
const path = require('path');

const recebidos = { pedidos: [], contatos: [], wa: [] };
let mock, app, base, cookie = '';

function startMock() {
  return new Promise((ok) => {
    mock = http.createServer((req, res) => {
      let b = ''; req.on('data', (c) => (b += c)); req.on('end', () => {
        const j = (s, o) => { res.writeHead(s, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(o)); };
        const u = new URL(req.url, 'http://x');
        if (u.pathname === '/oauth/token') return j(200, { access_token: 'AT', refresh_token: 'RT', expires_in: 21600 });
        if (req.headers.authorization !== 'Bearer AT' && !u.pathname.startsWith('/v21.0')) return j(401, { error: { description: 'token' } });
        if (u.pathname === '/produtos') return j(200, { data: u.searchParams.get('pagina') === '1' ? [{ id: 11, nome: 'Parafuso', codigo: 'P01', preco: 10, situacao: 'A' }, { id: 12, nome: 'Porca', codigo: 'P02', preco: 5, situacao: 'A' }] : [] });
        if (u.pathname === '/vendedores') return j(200, { data: [{ id: 77, contato: { id: 1, nome: 'Ana Vendas' }, descontoLimite: 5 }] });
        if (u.pathname === '/formas-pagamentos') return j(200, { data: [{ id: 5, descricao: 'Boleto', situacao: 1 }] });
        if (u.pathname === '/contatos' && req.method === 'GET') return j(200, { data: [] });
        if (u.pathname === '/contatos' && req.method === 'POST') { recebidos.contatos.push(JSON.parse(b)); return j(201, { data: { id: 999 } }); }
        if (u.pathname === '/pedidos/vendas' && req.method === 'POST') { const p = JSON.parse(b); recebidos.pedidos.push(p); if (!p.itens.length) return j(400, { error: { description: 'sem itens' } }); return j(201, { data: { id: 5555 } }); }
        if (u.pathname === '/pedidos/vendas/5555') return j(200, { data: { id: 5555, numero: 1234, situacao: { id: 6 } } });
        if (u.pathname.endsWith('/messages')) { recebidos.wa.push(JSON.parse(b)); return j(200, { messages: [{ id: 'wamid.X' }] }); }
        j(404, { error: { description: 'nf ' + u.pathname } });
      });
    }).listen(0, () => ok(mock.address().port));
  });
}

async function call(method, url, body) {
  const r = await fetch(base + url, { method, headers: { 'Content-Type': 'application/json', Cookie: cookie }, body: body ? JSON.stringify(body) : undefined });
  const sc = r.headers.get('set-cookie'); if (sc) cookie = sc.split(';')[0];
  return { status: r.status, body: await r.json().catch(() => ({})) };
}

before(async () => {
  const port = await startMock();
  process.env.DB_DRIVER = 'json';
  process.env.DB_FILE = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'crm-')), 'db.json');
  process.env.BLING_API_URL = `http://127.0.0.1:${port}`;
  process.env.WHATSAPP_GRAPH_URL = `http://127.0.0.1:${port}`;
  process.env.BLING_MIN_INTERVAL_MS = '0';
  process.env.DB_CACHE_TTL_MS = '0';
  process.env.ADMIN_EMAIL = 'admin@teste.com'; process.env.ADMIN_PASSWORD = 'senha-inicial';
  const { createApp } = require('../server');
  const a = await createApp();
  await new Promise((ok) => { app = a.listen(0, ok); });
  base = `http://127.0.0.1:${app.address().port}`;
  const ctx = a.locals.ctx;
  await ctx.db.put('config', 'bling', { clientId: 'c', clientSecret: 's', accessToken: 'AT', refreshToken: 'RT', expiresAt: Date.now() + 1e7 });
  await ctx.db.put('config', 'whatsapp', { phoneNumberId: '123', token: 'T', verifyToken: 'vt' });
});
after(() => { app.close(); mock.close(); });

test('fluxo completo', async () => {
  assert.equal((await call('POST', '/api/auth/login', { email: 'admin@teste.com', senha: 'errada' })).status, 401);
  assert.equal((await call('POST', '/api/auth/login', { email: 'admin@teste.com', senha: 'senha-inicial' })).status, 200);
  // troca obrigatória de senha bloqueia o resto
  assert.equal((await call('GET', '/api/clientes')).status, 403);
  assert.equal((await call('POST', '/api/me/senha', { atual: 'senha-inicial', nova: 'NovaSenha123' })).status, 200);

  for (const t of ['produtos', 'vendedores', 'formas_pagamento']) assert.equal((await call('POST', '/api/bling/sync/' + t)).status, 200, t);
  assert.equal((await call('GET', '/api/produtos')).body.length, 2);

  const lista = (await call('POST', '/api/listas', { nome: 'Atacado', ajustePercentual: -10, itens: [{ produtoId: '11', preco: 8.5 }] })).body;
  const cli = (await call('POST', '/api/clientes', { nome: 'Cliente Teste', documento: '12.345.678/0001-90', whatsapp: '(11) 98888-7777', listaPrecoId: lista.id, vendedorId: '77' })).body;
  const precos = (await call('GET', '/api/precos?clienteId=' + cli.id)).body.precos;
  assert.equal(precos['11'], 8.5); assert.equal(precos['12'], 4.5);

  // vendedor sem permissão de alterar preço: servidor força preço da lista
  const perfil = (await call('GET', '/api/perfis')).body.find((p) => p.id === 'vendedor');
  assert.ok(!perfil.permissoes.includes('pedidos.alterar_preco'));
  const u = (await call('POST', '/api/usuarios', { nome: 'Ana', email: 'ana@teste.com', senha: 'senhaAna123', perfilId: 'vendedor', vendedorId: '77', trocarSenha: false })).body;
  const adminCookie = cookie; cookie = '';
  await call('POST', '/api/auth/login', { email: 'ana@teste.com', senha: 'senhaAna123' });
  assert.equal((await call('GET', '/api/usuarios')).body[0].email, undefined, 'vendedor não vê dados de usuários');
  assert.equal((await call('GET', '/api/config')).status, 403);
  const ped = (await call('POST', '/api/pedidos', { clienteId: cli.id, itens: [{ produtoId: '11', quantidade: 2, valor: 1 }, { produtoId: '12', quantidade: 10, valor: 1 }], frete: 15, formaPagamentoId: '5', parcelas: 2, intervaloDias: 30, observacoes: 'Entregar cedo' })).body;
  assert.equal(ped.itens[0].valor, 8.5); assert.equal(ped.total, 2 * 8.5 + 10 * 4.5 + 15);
  assert.equal(ped.vendedorId, '77');

  const env = await call('POST', `/api/pedidos/${ped.id}/enviar-bling`);
  assert.equal(env.status, 200, JSON.stringify(env.body));
  assert.equal(env.body.blingNumero, '1234');
  const pb = recebidos.pedidos[0];
  assert.equal(pb.contato.id, 999); assert.equal(pb.vendedor.id, 77); assert.equal(pb.itens[0].produto.id, 11); assert.equal(pb.itens[0].valor, 8.5);
  assert.equal(pb.parcelas.length, 2); assert.equal(pb.parcelas[0].valor + pb.parcelas[1].valor, ped.total);
  assert.equal(recebidos.contatos[0].numeroDocumento, '12345678000190');
  assert.equal((await call('POST', `/api/pedidos/${ped.id}/enviar-bling`)).status, 409, 'não reenvia');
  assert.equal((await call('PUT', `/api/pedidos/${ped.id}`, { clienteId: cli.id, itens: [] })).status, 409);

  // WhatsApp: resumo do pedido
  const w = await call('POST', `/api/pedidos/${ped.id}/whatsapp`);
  assert.equal(w.status, 200, JSON.stringify(w.body));
  assert.equal(recebidos.wa[0].to, '5511988887777');
  assert.match(recebidos.wa[0].text.body, /Total/);

  // webhook de entrada (sem 9º dígito) cai na mesma conversa e vincula ao cliente
  cookie = '';
  const v = await fetch(base + '/api/whatsapp/webhook?hub.mode=subscribe&hub.verify_token=vt&hub.challenge=abc'); assert.equal(await v.text(), 'abc');
  await fetch(base + '/api/whatsapp/webhook', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ entry: [{ changes: [{ value: { contacts: [{ wa_id: '551188887777', profile: { name: 'Cli' } }], messages: [{ from: '551188887777', id: 'in1', timestamp: '1700000000', type: 'text', text: { body: 'Recebi, obrigado!' } }] } }] }] }) });
  cookie = adminCookie;
  const convs = (await call('GET', '/api/whatsapp/conversas')).body;
  assert.equal(convs.length, 1); assert.equal(convs[0].naoLidas, 1); assert.equal(convs[0].clienteId, cli.id);
  const conv = (await call('GET', '/api/whatsapp/conversas/' + convs[0].id)).body;
  assert.equal(conv.mensagens.length, 2); assert.ok(conv.dentroJanela);

  const dash = (await call('GET', '/api/dashboard')).body;
  assert.equal(dash.pedidosMes, 1);
  assert.ok((await call('GET', '/api/auditoria')).body.some((a) => a.acao === 'enviar_bling'));
  assert.ok(u.id);
  const p2 = (await call('POST', '/api/pedidos', { clienteId: cli.id, itens: [{ produtoId: '12', quantidade: 1 }] })).body;
  assert.equal(p2.itens[0].valor, 4.5, 'sem valor informado usa preço da lista');
  const p3 = (await call('POST', '/api/pedidos', { clienteId: cli.id, itens: [{ produtoId: '12', quantidade: 1, valor: 3 }] })).body;
  assert.equal(p3.itens[0].valor, 3, 'admin pode alterar preço');
});
