/* Roteamento por hash, layout com menu filtrado por permissão e tela de login */
const MENU = [
  { grp: '' }, { path: '/', label: '📊 Painel', perm: 'dashboard.ver', page: 'dashboard' },
  { grp: 'Vendas' }, { path: '/pedidos', label: '🧾 Pedidos de venda', perm: 'pedidos.ver', page: 'pedidos' }, { path: '/funil', label: '🎯 Funil de vendas', perm: 'funil.ver', page: 'funil' },
  { path: '/clientes', label: '👥 Clientes', perm: 'clientes.ver', page: 'clientes' }, { path: '/tarefas', label: '✅ Tarefas', perm: 'tarefas.ver', page: 'tarefas' },
  { path: '/whatsapp', label: '💬 WhatsApp', perm: 'whatsapp.ver', page: 'whatsapp', badge: true },
  { grp: 'Cadastros' }, { path: '/produtos', label: '📦 Produtos', perm: 'produtos.ver', page: 'produtos' }, { path: '/listas', label: '🏷️ Listas de preço', perm: 'listas.ver', page: 'listas' },
  { path: '/vendedores', label: '🧑‍💼 Vendedores', perm: 'vendedores.ver', page: 'vendedores' }, { path: '/relatorios', label: '📈 Relatórios', perm: 'relatorios.ver', page: 'relatorios' },
  { grp: 'Administração' }, { path: '/usuarios', label: '🔐 Usuários', perm: 'usuarios.gerenciar', page: 'usuarios' }, { path: '/config', label: '⚙️ Configurações', perm: 'config.gerenciar', page: 'config' },
  { path: '/auditoria', label: '📜 Auditoria', perm: 'auditoria.ver', page: 'auditoria' },
];
const DETALHE = [[/^\/clientes\/(.+)$/, 'cliente'], [/^\/pedidos\/(.+)$/, 'pedido'], [/^\/listas\/(.+)$/, 'lista']];

function parseHash() {
  const h = location.hash.replace(/^#/, '') || '/';
  const [path, qs] = h.split('?');
  store.route = { path, query: Object.fromEntries(new URLSearchParams(qs || '')) };
}
window.addEventListener('hashchange', parseHash);
parseHash();

const Login = {
  setup() {
    const f = reactive({ email: '', senha: '' }); const erro = ref(''); const busy = ref(false);
    const entrar = async () => { erro.value = ''; busy.value = true; try { const r = await api.post('/api/auth/login', f); store.user = r.user; } catch (e) { erro.value = e.message; } finally { busy.value = false; } };
    return { f, erro, entrar, busy };
  },
  template: `<div class="login"><form class="card" @submit.prevent="entrar"><h1 style="margin-bottom:4px">CRM</h1><p class="mu sm" style="margin-top:0">Integrado ao Bling e WhatsApp Business</p>
  <div style="margin-bottom:10px"><label>E-mail</label><input v-model="f.email" type="email" autofocus autocomplete="username"></div><div style="margin-bottom:14px"><label>Senha</label><input v-model="f.senha" type="password" autocomplete="current-password"></div>
  <div v-if="erro" class="err-box">{{erro}}</div><button class="btn p" style="width:100%;justify-content:center" :disabled="busy">Entrar</button></form></div>`,
};

const App = {
  components: { Login, TrocaSenha, ...Object.fromEntries(Object.entries(Pages).map(([k, v]) => ['p-' + k, v])) },
  setup() {
    const pronto = ref(false); const menuAberto = ref(false); const senha = ref(false); const naoLidas = ref(0);
    onMounted(async () => { try { store.user = await api.get('/api/me'); } catch {} pronto.value = true; });
    const menu = computed(() => { const out = []; let g = null; for (const m of MENU) { if ('grp' in m) { g = m; continue; } if (can(m.perm)) { if (g) { out.push(g); g = null; } out.push(m); } } return out; });
    const atual = computed(() => {
      const p = store.route.path;
      for (const [re, page] of DETALHE) { const m = p.match(re); if (m && Pages[page]) return { page, props: { id: decodeURIComponent(m[1]) }, key: p }; }
      const it = MENU.find((m) => m.path === p && m.page);
      if (it && can(it.perm)) return { page: it.page, props: {}, key: p };
      const primeiro = menu.value.find((m) => m.page);
      return primeiro ? { page: primeiro.page, props: {}, key: primeiro.path } : null;
    });
    const ativo = (m) => (m.path === '/' ? store.route.path === '/' : store.route.path.startsWith(m.path));
    watch(() => store.route.path, () => { menuAberto.value = false; });
    let t; watch(() => store.user && store.user.id, (id) => { clearInterval(t); if (id && can('whatsapp.ver')) { const f = async () => { try { const cs = await api.get('/api/whatsapp/conversas'); naoLidas.value = cs.reduce((s, c) => s + (c.naoLidas || 0), 0); } catch {} }; f(); t = setInterval(f, 20000); } });
    const sair = async () => { await api.post('/api/auth/logout'); store.user = null; store.cache = {}; };
    return { store, pronto, menu, atual, ativo, menuAberto, sair, senha, naoLidas };
  },
  template: `<template v-if="pronto"><Login v-if="!store.user"/><div v-else class="app">
   <nav class="side" :class="{open:menuAberto}"><div class="logo"><span>C</span> CRM Bling</div>
    <template v-for="m in menu"><div v-if="'grp' in m" class="grp">{{m.grp}}</div><a v-else :href="'#'+m.path" :class="{on:ativo(m)}">{{m.label}}<span v-if="m.badge && naoLidas" class="badge n">{{naoLidas}}</span></a></template></nav>
   <div class="main"><div class="top"><button class="burger" @click="menuAberto=!menuAberto">☰</button><div class="sp"></div><span class="sm"><b>{{store.user.nome}}</b> <span class="mu">· {{store.user.perfilNome}}</span></span><button class="btn sm" @click="senha=true">Senha</button><button class="btn sm" @click="sair">Sair</button></div>
    <div class="content"><component v-if="atual" :is="'p-'+atual.page" v-bind="atual.props" :key="atual.key"/><div v-else class="empty">Seu perfil não tem acesso a nenhuma funcionalidade.</div></div></div>
   <TrocaSenha v-if="senha || store.user.trocarSenha" :obrigatoria="store.user.trocarSenha" @close="senha=false"/></div></template>
  <div class="toast"><div v-for="t in store.toasts" :key="t.id" :class="t.tipo">{{t.msg}}</div></div>`,
};
Vue.createApp(App).mount('#app');
