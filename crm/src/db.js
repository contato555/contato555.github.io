// Camada de dados: Firestore (Google Cloud) em produção, arquivo JSON local em desenvolvimento.
// Uso: DB_DRIVER=firestore (padrão quando GOOGLE_CLOUD_PROJECT/K_SERVICE existe) ou DB_DRIVER=json.
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const newId = () => crypto.randomBytes(10).toString('hex');
const now = () => new Date().toISOString();

class JsonDriver {
  constructor(file) {
    this.file = file;
    this.data = {};
    if (fs.existsSync(file)) this.data = JSON.parse(fs.readFileSync(file, 'utf8') || '{}');
    this._t = null;
  }
  _save() {
    clearTimeout(this._t);
    this._t = setTimeout(() => this.flush(), 200);
  }
  flush() {
    fs.mkdirSync(path.dirname(this.file), { recursive: true });
    const tmp = this.file + '.tmp';
    fs.writeFileSync(tmp, JSON.stringify(this.data));
    fs.renameSync(tmp, this.file);
  }
  _col(c) { return (this.data[c] = this.data[c] || {}); }
  async list(c) { return Object.values(this._col(c)).map((d) => ({ ...d })); }
  async get(c, id) { const d = this._col(c)[id]; return d ? { ...d } : null; }
  async set(c, id, doc) { this._col(c)[id] = { ...doc, id }; this._save(); }
  async delete(c, id) { delete this._col(c)[id]; this._save(); }
  async bulkSet(c, docs) { const col = this._col(c); for (const d of docs) col[d.id] = d; this._save(); }
  async nextSeq(name) {
    const col = this._col('_counters');
    const v = ((col[name] && col[name].value) || 0) + 1;
    col[name] = { id: name, value: v };
    this._save();
    return v;
  }
}

class FirestoreDriver {
  constructor() {
    const { Firestore } = require('@google-cloud/firestore');
    this.fs = new Firestore({ ignoreUndefinedProperties: true, ...(process.env.FIRESTORE_DATABASE ? { databaseId: process.env.FIRESTORE_DATABASE } : {}) });
  }
  async list(c) { const s = await this.fs.collection(c).get(); return s.docs.map((d) => ({ ...d.data(), id: d.id })); }
  async get(c, id) { const d = await this.fs.collection(c).doc(String(id)).get(); return d.exists ? { ...d.data(), id: d.id } : null; }
  async set(c, id, doc) { await this.fs.collection(c).doc(String(id)).set({ ...doc, id: String(id) }); }
  async delete(c, id) { await this.fs.collection(c).doc(String(id)).delete(); }
  async bulkSet(c, docs) {
    for (let i = 0; i < docs.length; i += 400) {
      const b = this.fs.batch();
      for (const d of docs.slice(i, i + 400)) b.set(this.fs.collection(c).doc(String(d.id)), d);
      await b.commit();
    }
  }
  async nextSeq(name) {
    const ref = this.fs.collection('_counters').doc(name);
    return this.fs.runTransaction(async (t) => {
      const d = await t.get(ref);
      const v = ((d.exists && d.data().value) || 0) + 1;
      t.set(ref, { value: v });
      return v;
    });
  }
}

// Cache em memória por coleção (reduz leituras no Firestore). TTL curto por causa de múltiplas instâncias.
const TTL = Number(process.env.DB_CACHE_TTL_MS || 30000);

function createDb() {
  const useFirestore = (process.env.DB_DRIVER || (process.env.K_SERVICE || process.env.GOOGLE_CLOUD_PROJECT ? 'firestore' : 'json')) === 'firestore';
  const driver = useFirestore ? new FirestoreDriver() : new JsonDriver(process.env.DB_FILE || path.join(__dirname, '..', 'data', 'db.json'));
  const cache = new Map();
  const inval = (c) => cache.delete(c);

  const db = {
    driverName: useFirestore ? 'firestore' : 'json',
    newId,
    async list(c, filter) {
      let e = cache.get(c);
      if (!e || Date.now() - e.t > TTL) { e = { t: Date.now(), rows: await driver.list(c) }; cache.set(c, e); }
      const rows = e.rows.map((r) => ({ ...r }));
      return filter ? rows.filter(filter) : rows;
    },
    async get(c, id) {
      if (id === undefined || id === null || id === '') return null;
      const e = cache.get(c);
      if (e && Date.now() - e.t <= TTL) { const r = e.rows.find((x) => x.id === String(id)); return r ? { ...r } : null; }
      return driver.get(c, String(id));
    },
    async insert(c, doc) {
      const id = doc.id ? String(doc.id) : newId();
      const d = { ...doc, id, criadoEm: doc.criadoEm || now(), atualizadoEm: now() };
      await driver.set(c, id, d); inval(c); return d;
    },
    async update(c, id, patch) {
      const cur = await driver.get(c, String(id));
      if (!cur) return null;
      const d = { ...cur, ...patch, id: String(id), atualizadoEm: now() };
      await driver.set(c, String(id), d); inval(c); return d;
    },
    async put(c, id, doc) { const d = { ...doc, id: String(id), atualizadoEm: now() }; await driver.set(c, String(id), d); inval(c); return d; },
    async remove(c, id) { await driver.delete(c, String(id)); inval(c); },
    async bulkSet(c, docs) { await driver.bulkSet(c, docs.map((d) => ({ ...d, id: String(d.id), atualizadoEm: now() }))); inval(c); },
    nextSeq: (n) => driver.nextSeq(n),
    flush: () => driver.flush && driver.flush(),
  };
  return db;
}

module.exports = { createDb, now };
