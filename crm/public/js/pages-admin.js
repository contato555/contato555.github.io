/* Usuários, perfis/permissões, configurações de integração e auditoria */
Pages.usuarios = {
  components: { Modal },
  setup() {
    const tab = ref('usuarios'); const us = ref([]); const perfis = ref([]); const vend = ref([]); const perms = ref([]); const eu = ref(null); const ep = ref(null);
    const load = async () => { [us.value, perfis.value, vend.value, perms.value] = await Promise.all([api.get('/api/usuarios'), api.get('/api/perfis'), cached('vendedores', '/api/vendedores', true), api.get('/api/permissoes')]); };
    onMounted(load);
    const pn = (id) => (perfis.value.find((p) => p.id === id) || {}).nome; const vn = (id) => (vend.value.find((v) => v.id === id) || {}).nome;
    const salvarU = () => run(async () => { const u = eu.value; u.id ? await api.put('/api/usuarios/' + u.id, u) : await api.post('/api/usuarios', u); eu.value = null; await load(); }, 'Usuário salvo');
    const salvarP = () => run(async () => { const p = ep.value; p.id ? await api.put('/api/perfis/' + p.id, p) : await api.post('/api/perfis', p); ep.value = null; await load(); }, 'Perfil salvo');
    const excluirP = () => confirm('Excluir perfil?') && run(async () => { await api.del('/api/perfis/' + ep.value.id); ep.value = null; await load(); });
    const grupo = (g, on) => { for (const [k] of g.itens) { const i = ep.value.permissoes.indexOf(k); if (on && i < 0) ep.value.permissoes.push(k); if (!on && i >= 0) ep.value.permissoes.splice(i, 1); } };
    const gerarSenha = () => { eu.value.senha = Math.random().toString(36).slice(2, 8) + Math.random().toString(36).slice(2, 6).toUpperCase(); };
    return { tab, us, perfis, vend, perms, eu, ep, pn, vn, salvarU, salvarP, excluirP, grupo, gerarSenha, ...helpers };
  },
  template: `<div><h1 style="margin-bottom:14px">Usuários e permissões</h1>
  <div class="tabs"><a href="javascript:" :class="{on:tab==='usuarios'}" @click="tab='usuarios'">Usuários</a><a href="javascript:" :class="{on:tab==='perfis'}" @click="tab='perfis'">Perfis de acesso</a></div>
  <div v-if="tab==='usuarios'" class="card"><div class="row" style="margin-bottom:10px"><div class="grow"></div><button class="btn p nogrow" @click="eu={ativo:true,trocarSenha:true,perfilId:'vendedor'}">+ Novo usuário</button></div>
   <table><thead><tr><th>Nome</th><th>E-mail</th><th>Perfil</th><th>Vendedor Bling</th><th>Último acesso</th><th>Situação</th></tr></thead><tbody>
   <tr v-for="u in us" class="click" @click="eu={...u,senha:''}"><td><b>{{u.nome}}</b></td><td>{{u.email}}</td><td>{{pn(u.perfilId)}}</td><td>{{vn(u.vendedorId)}}</td><td class="sm">{{dth(u.ultimoAcesso)}}</td><td><span class="badge" :class="u.ativo?'ok':'err'">{{u.ativo?'ativo':'inativo'}}</span></td></tr></tbody></table></div>
  <div v-if="tab==='perfis'" class="card"><div class="row" style="margin-bottom:10px"><p class="grow sm mu">Perfis definem quais funcionalidades cada usuário pode acessar.</p><button class="btn p nogrow" @click="ep={nome:'',permissoes:[]}">+ Novo perfil</button></div>
   <table><tr v-for="p in perfis" class="click" @click="ep={...p,permissoes:[...p.permissoes]}"><td><b>{{p.nome}}</b></td><td class="sm mu">{{p.permissoes.length}} permissões</td><td class="sm">{{us.filter(u=>u.perfilId===p.id).length}} usuários</td></tr></table></div>
  <Modal v-if="eu" :title="eu.id?'Editar usuário':'Novo usuário'" @close="eu=null"><div class="grid" style="gap:10px">
   <div class="row"><div><label>Nome *</label><input v-model="eu.nome"></div><div><label>E-mail (login) *</label><input v-model="eu.email" type="email"></div></div>
   <div class="row"><div><label>Perfil de acesso</label><select v-model="eu.perfilId"><option v-for="p in perfis" :value="p.id">{{p.nome}}</option></select></div><div><label>Vendedor no Bling</label><select v-model="eu.vendedorId"><option value="">— nenhum —</option><option v-for="v in vend" :value="v.id">{{v.nome}}</option></select></div></div>
   <div class="row"><div><label>{{eu.id?'Nova senha (deixe vazio para manter)':'Senha *'}}</label><input v-model="eu.senha" type="text" autocomplete="new-password"></div><button class="btn nogrow" @click="gerarSenha">Gerar</button></div>
   <div class="row"><label style="display:flex;gap:6px;color:var(--tx)"><input type="checkbox" v-model="eu.ativo"> Ativo</label><label style="display:flex;gap:6px;color:var(--tx)"><input type="checkbox" v-model="eu.trocarSenha"> Exigir troca de senha no próximo acesso</label></div></div>
   <template #ft><button class="btn" @click="eu=null">Cancelar</button><button class="btn p" @click="salvarU">Salvar</button></template></Modal>
  <Modal v-if="ep" lg :title="ep.id?'Perfil: '+ep.nome:'Novo perfil'" @close="ep=null"><div style="margin-bottom:12px"><label>Nome do perfil</label><input v-model="ep.nome" :disabled="ep.id==='admin'"></div>
   <p v-if="ep.id==='admin'" class="ok-box">O perfil Administrador tem sempre todas as permissões.</p>
   <div class="perm" v-else><div class="g" v-for="g in perms"><h3>{{g.grupo}} <a href="javascript:" class="sm" @click="grupo(g,true)">todas</a> · <a href="javascript:" class="sm" @click="grupo(g,false)">nenhuma</a></h3><label v-for="[k,l] in g.itens"><input type="checkbox" :value="k" v-model="ep.permissoes"> {{l}}</label></div></div>
   <template #ft><button class="btn d" v-if="ep.id && ep.id!=='admin'" @click="excluirP">Excluir</button><button class="btn" @click="ep=null">Cancelar</button><button class="btn p" v-if="ep.id!=='admin'" @click="salvarP">Salvar</button></template></Modal></div>`,
};

Pages.config = {
  setup() {
    const c = ref(null); const etapas = ref([]); const msg = ref(store.route.query.bling || '');
    const load = async () => { c.value = await api.get('/api/config'); etapas.value = await api.get('/api/funil/etapas'); };
    onMounted(load);
    const salvar = (sec) => run(async () => { await api.put('/api/config/' + sec, c.value[sec]); await load(); }, 'Configuração salva');
    const conectar = () => run(async () => { await api.put('/api/config/bling', c.value.bling); const r = await api.get('/api/bling/autorizar'); location.href = r.url; });
    const sync = (t) => run(async () => { const r = await api.post('/api/bling/sync/' + t); invalidate('produtos', 'vendedores'); await load(); toast(`${t}: ${r.qtd} registros importados`, 'ok'); });
    const salvarEtapas = () => run(() => api.put('/api/funil/etapas', { etapas: etapas.value }), 'Etapas salvas');
    const copiar = (t) => { navigator.clipboard.writeText(t); toast('Copiado'); };
    return { c, salvar, conectar, sync, msg, etapas, salvarEtapas, copiar, ...helpers };
  },
  template: `<div v-if="c"><h1 style="margin-bottom:14px">Configurações</h1>
  <div v-if="msg==='ok'" class="ok-box">Bling conectado com sucesso! Agora importe vendedores, produtos e formas de pagamento.</div><div v-else-if="msg" class="err-box">Falha ao conectar ao Bling: {{msg}}</div>
  <div class="grid g2">
  <div class="card"><h2>Bling (API v3)</h2>
   <p class="sm mu">1) Em <b>Bling → Central de Extensões → Área do Integrador</b>, crie um aplicativo com os escopos de Produtos, Contatos, Vendedores, Pedidos de Venda, Formas de pagamento e Situações.<br>2) Informe a URL de redirecionamento abaixo no app do Bling.<br>3) Cole Client ID e Secret, salve e clique em Conectar.</p>
   <div class="grid" style="gap:10px"><div><label>URL de redirecionamento (callback)</label><div class="row"><input :value="c.bling.redirectUri" readonly class="grow"><button class="btn nogrow" @click="copiar(c.bling.redirectUri)">Copiar</button></div></div>
    <div><label>Client ID</label><input v-model="c.bling.clientId"></div><div><label>Client Secret</label><input v-model="c.bling.clientSecret" placeholder="cole para alterar"></div></div>
   <p>Status: <span class="badge" :class="c.bling.status.conectado?'ok':'err'">{{c.bling.status.conectado?'Conectado':'Não conectado'}}</span> <span class="sm mu" v-if="c.bling.status.conectadoEm">token renovado em {{dth(c.bling.status.conectadoEm)}}</span></p>
   <div class="row"><button class="btn nogrow" @click="salvar('bling')">Salvar</button><button class="btn p nogrow" @click="conectar">{{c.bling.status.conectado?'Reconectar':'Conectar ao Bling'}}</button></div>
   <div v-if="c.bling.status.conectado" style="margin-top:14px"><h3>Importar do Bling</h3><div class="row"><button class="btn nogrow" v-for="t in ['vendedores','produtos','formas_pagamento','clientes']" @click="sync(t)">⟳ {{t.replace('_',' ')}}</button></div>
    <table class="sm" style="margin-top:8px"><tr v-for="(v,k) in c.bling.status.ultimaSync"><td>{{k}}</td><td>{{v.qtd}} registros</td><td>{{dth(v.em)}}</td></tr></table></div></div>
  <div class="card"><h2>WhatsApp Business (Cloud API)</h2>
   <p class="sm mu">Em <b>developers.facebook.com</b> → seu app → WhatsApp → Configuração da API: copie o <i>Phone number ID</i>, o <i>WhatsApp Business Account ID</i> e gere um token permanente (usuário do sistema). Em Webhooks, use a URL e o token de verificação abaixo e assine o campo <b>messages</b>.</p>
   <div class="grid" style="gap:10px"><div><label>URL do webhook</label><div class="row"><input :value="c.whatsapp.webhookUrl" readonly class="grow"><button class="btn nogrow" @click="copiar(c.whatsapp.webhookUrl)">Copiar</button></div></div>
    <div class="row"><div><label>Phone number ID</label><input v-model="c.whatsapp.phoneNumberId"></div><div><label>Business Account ID (WABA)</label><input v-model="c.whatsapp.businessAccountId"></div></div>
    <div><label>Token de acesso</label><input v-model="c.whatsapp.token" placeholder="cole para alterar"></div>
    <div class="row"><div><label>Token de verificação do webhook</label><input v-model="c.whatsapp.verifyToken" placeholder="gerado automaticamente"></div><div><label>App Secret (valida assinatura)</label><input v-model="c.whatsapp.appSecret" placeholder="opcional, recomendado"></div><div class="nogrow" style="width:100px"><label>Versão API</label><input v-model="c.whatsapp.apiVersion"></div></div></div>
   <button class="btn p" style="margin-top:12px" @click="salvar('whatsapp')">Salvar WhatsApp</button></div>
  <div class="card"><h2>Empresa</h2><div class="grid" style="gap:10px"><div><label>Nome da empresa</label><input v-model="c.empresa.nome"></div><div><label>Telefone / WhatsApp</label><input v-model="c.empresa.telefone"></div></div><button class="btn p" style="margin-top:12px" @click="salvar('empresa')">Salvar</button></div>
  <div class="card"><h2>Etapas do funil</h2><div v-for="(e,ix) in etapas" class="row" style="margin-bottom:6px"><div class="nogrow" style="width:140px"><input v-model="e.id" :disabled="['ganho','perdido','novo'].includes(e.id)"></div><div class="grow"><input v-model="e.nome"></div><button class="btn sm d nogrow" v-if="!['ganho','perdido','novo'].includes(e.id)" @click="etapas.splice(ix,1)">✕</button></div>
   <div class="row"><button class="btn nogrow" @click="etapas.splice(etapas.length-2,0,{id:'etapa'+etapas.length,nome:'Nova etapa'})">+ Etapa</button><button class="btn p nogrow" @click="salvarEtapas">Salvar etapas</button></div></div></div></div>`,
};

Pages.auditoria = {
  setup() { const rows = ref([]); const q = ref(''); onMounted(async () => { rows.value = await api.get('/api/auditoria'); }); const lista = computed(() => rows.value.filter((r) => !q.value || match(q.value, r.usuarioNome, r.acao, r.entidade, r.detalhe))); return { lista, q, ...helpers }; },
  template: `<div><h1 style="margin-bottom:14px">Log de auditoria</h1><div class="card"><input v-model="q" placeholder="Filtrar..." style="margin-bottom:10px"><div class="tw"><table><thead><tr><th>Quando</th><th>Usuário</th><th>Ação</th><th>Entidade</th><th>Detalhe</th></tr></thead><tr v-for="r in lista"><td class="nowrap sm">{{dth(r.criadoEm)}}</td><td>{{r.usuarioNome}}</td><td><span class="badge">{{r.acao}}</span></td><td>{{r.entidade}}</td><td class="sm">{{r.detalhe}}</td></tr></table></div></div></div>`,
};

const TrocaSenha = {
  components: { Modal },
  props: { obrigatoria: Boolean }, emits: ['close'],
  setup(props, { emit }) {
    const f = reactive({ atual: '', nova: '', conf: '' });
    const salvar = () => { if (f.nova !== f.conf) return toast('As senhas não conferem', 'err'); run(async () => { await api.post('/api/me/senha', f); store.user.trocarSenha = false; emit('close'); }, 'Senha alterada'); };
    return { f, salvar };
  },
  template: `<Modal title="Alterar senha" @close="!obrigatoria && $emit('close')"><p v-if="obrigatoria" class="sm mu">Por segurança, defina uma nova senha para continuar.</p><div class="grid" style="gap:10px"><div><label>Senha atual</label><input type="password" v-model="f.atual"></div><div><label>Nova senha (mín. 8)</label><input type="password" v-model="f.nova"></div><div><label>Confirme</label><input type="password" v-model="f.conf" @keyup.enter="salvar"></div></div>
  <template #ft><button class="btn" v-if="!obrigatoria" @click="$emit('close')">Cancelar</button><button class="btn p" @click="salvar">Salvar</button></template></Modal>`,
};
