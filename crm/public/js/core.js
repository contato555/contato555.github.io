/* Núcleo do front-end: API, formatação, estado global e componentes reutilizáveis. */
const { reactive, ref, computed, watch, onMounted, onUnmounted, nextTick } = Vue;
const Pages = {};
const store = reactive({ user: null, toasts: [], route: { path: '/', query: {} }, cache: {} });

async function api(method, url, body) {
  const r = await fetch(url, { method, headers: body ? { 'Content-Type': 'application/json' } : {}, body: body ? JSON.stringify(body) : undefined, credentials: 'same-origin' });
  const j = await r.json().catch(() => ({}));
  if (r.status === 401 && !url.includes('/auth/')) { store.user = null; throw new Error(j.erro || 'Sessão expirada'); }
  if (r.status === 403 && j.trocarSenha && store.user) store.user.trocarSenha = true;
  if (!r.ok) throw new Error(j.erro || `Erro ${r.status}`);
  return j;
}
api.get = (u) => api('GET', u); api.post = (u, b) => api('POST', u, b || {}); api.put = (u, b) => api('PUT', u, b); api.del = (u) => api('DELETE', u);

// cache simples de listas auxiliares (vendedores, produtos...) por 60s
async function cached(key, url, force) {
  const c = store.cache[key];
  if (!force && c && Date.now() - c.t < 60000) return c.v;
  const v = await api.get(url); store.cache[key] = { t: Date.now(), v }; return v;
}
const invalidate = (...keys) => keys.forEach((k) => delete store.cache[k]);

function toast(msg, tipo = '') { const t = { id: Math.random(), msg, tipo }; store.toasts.push(t); setTimeout(() => { const i = store.toasts.indexOf(t); if (i >= 0) store.toasts.splice(i, 1); }, tipo === 'err' ? 7000 : 3500); }
const can = (p) => !!(store.user && store.user.permissoes.includes(p));
const go = (path) => { location.hash = '#' + path; };
const brl = (v) => Number(v || 0).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
const n2 = (v) => Number(v || 0).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const dt = (s) => (s ? new Date(s.length === 10 ? s + 'T12:00:00' : s).toLocaleDateString('pt-BR') : '');
const dth = (s) => (s ? new Date(s).toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', year: '2-digit', hour: '2-digit', minute: '2-digit' }) : '');
const hojeISO = () => new Date(Date.now() - new Date().getTimezoneOffset() * 60000).toISOString().slice(0, 10);
const norm = (s) => String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
const match = (q, ...campos) => { const t = norm(q).split(/\s+/).filter(Boolean); const h = norm(campos.join(' ')); return t.every((x) => h.includes(x)); };
async function run(fn, okMsg) { try { const r = await fn(); if (okMsg) toast(okMsg, 'ok'); return r; } catch (e) { toast(e.message, 'err'); throw e; } }
const helpers = { brl, n2, dt, dth, can, go, store };

const Modal = {
  props: { title: String, lg: Boolean },
  emits: ['close'],
  template: `<div class="modal-bg" @mousedown.self="$emit('close')"><div class="modal" :class="{lg}"><div class="row" style="margin-bottom:12px"><h2 style="margin:0">{{title}}</h2><button class="btn link nogrow" style="font-size:20px" @click="$emit('close')">×</button></div><slot/><div class="ft" v-if="$slots.ft"><slot name="ft"/></div></div></div>`,
};

// Autocomplete genérico: items [{...}], label(item), sub(item), filtro por texto
const AutoComplete = {
  props: { items: Array, modelValue: [String, Number], label: Function, sub: Function, placeholder: String, keys: Function, limit: { type: Number, default: 30 } },
  emits: ['update:modelValue', 'pick'],
  setup(props, { emit }) {
    const q = ref(''); const open = ref(false); const hi = ref(0);
    const sel = computed(() => props.items.find((i) => String(i.id) === String(props.modelValue)));
    watch(sel, (s) => { if (!open.value) q.value = s ? props.label(s) : ''; }, { immediate: true });
    const list = computed(() => { const k = props.keys || props.label; return props.items.filter((i) => !q.value || (sel.value && q.value === props.label(sel.value)) || match(q.value, k(i))).slice(0, props.limit); });
    const pick = (i) => { emit('update:modelValue', i.id); emit('pick', i); q.value = props.label(i); open.value = false; };
    const key = (e) => {
      if (e.key === 'ArrowDown') { hi.value = Math.min(hi.value + 1, list.value.length - 1); e.preventDefault(); }
      else if (e.key === 'ArrowUp') { hi.value = Math.max(hi.value - 1, 0); e.preventDefault(); }
      else if (e.key === 'Enter') { if (open.value && list.value[hi.value]) { pick(list.value[hi.value]); e.preventDefault(); } }
      else if (e.key === 'Escape') open.value = false;
    };
    const blur = () => setTimeout(() => { open.value = false; q.value = sel.value ? props.label(sel.value) : ''; }, 180);
    return { q, open, hi, list, pick, key, blur };
  },
  template: `<div class="ac"><input v-model="q" :placeholder="placeholder" @focus="open=true;$event.target.select()" @input="open=true;hi=0" @keydown="key" @blur="blur" autocomplete="off">
  <ul v-if="open && list.length"><li v-for="(i,ix) in list" :key="i.id" :class="{on:ix===hi}" @mousedown.prevent="pick(i)">{{label(i)}}<div v-if="sub" class="sm mu">{{sub(i)}}</div></li></ul></div>`,
};

const Bars = {
  props: { data: Array, lbl: Function },
  template: `<div class="bars"><div v-for="d in data" :title="brl(d.total)"><span class="sm">{{d.total ? (d.total>=1000? (d.total/1000).toFixed(1)+'k' : Math.round(d.total)) : ''}}</span><i :style="{height: (max? d.total/max*100 : 0)+'%'}"></i><span>{{lbl(d)}}</span></div></div>`,
  computed: { max() { return Math.max(0, ...this.data.map((d) => d.total)); } },
  methods: { brl },
};
