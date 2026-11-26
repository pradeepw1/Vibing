'use strict';

// Everything Buddy saves lives in one folder on your Mac:
//   ~/Library/Application Support/Buddy
//     settings.json        your preferences
//     secrets.json         your API key, encrypted with the macOS Keychain
//     window-state.json    window size and position
//     conversations/*.json one file per chat
//     attachments/*        files you attached to messages

const fs = require('fs');
const fsp = fs.promises;
const path = require('path');
const crypto = require('crypto');

const DEFAULT_SETTINGS = {
  name: '',
  assistantName: 'Buddy',
  about: '',
  style: '',
  model: 'claude-opus-5-5',
  effort: 'medium',
  webSearch: true,
  theme: 'system',
  font: 'sans',
  shortcut: 'Alt+Space',
  sidebarCollapsed: false,
};

const ID_RE = /^[A-Za-z0-9_-]{6,64}$/;

function newId() {
  return crypto.randomUUID();
}

function isId(value) {
  return typeof value === 'string' && ID_RE.test(value);
}

function readJsonSync(file, fallback) {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch {
    return fallback;
  }
}

async function writeFileAtomic(file, data, mode) {
  const tmp = `${file}.${process.pid}.${crypto.randomBytes(4).toString('hex')}.tmp`;
  await fsp.writeFile(tmp, data, mode ? { mode } : undefined);
  await fsp.rename(tmp, file);
}

function messageText(m) {
  if (m.role === 'user') return m.text || '';
  const parts = Array.isArray(m.parts) ? m.parts : [];
  return parts
    .flat()
    .filter((b) => b && b.type === 'text')
    .map((b) => b.text || '')
    .join('');
}

function summarize(conv) {
  return {
    id: conv.id,
    title: conv.title || 'New chat',
    createdAt: conv.createdAt,
    updatedAt: conv.updatedAt,
    model: conv.model,
  };
}

class Store {
  constructor(dir, safeStorage) {
    this.dir = dir;
    this.safeStorage = safeStorage;
    this.convDir = path.join(dir, 'conversations');
    this.attDir = path.join(dir, 'attachments');
    fs.mkdirSync(this.convDir, { recursive: true });
    fs.mkdirSync(this.attDir, { recursive: true });

    this.settingsFile = path.join(dir, 'settings.json');
    this.secretsFile = path.join(dir, 'secrets.json');
    this.windowFile = path.join(dir, 'window-state.json');
    this.indexFile = path.join(dir, 'index.json');

    this.settings = { ...DEFAULT_SETTINGS, ...readJsonSync(this.settingsFile, {}) };
    this.cache = new Map(); // id -> full conversation (only the ones we opened)
    this.index = null; // id -> summary
    this.chains = new Map(); // id -> promise, so writes to one file never overlap
  }

  // ---------- settings ----------

  getSettings() {
    return { ...this.settings };
  }

  async saveSettings(patch) {
    const next = { ...this.settings };
    for (const [key, value] of Object.entries(patch || {})) {
      if (!(key in DEFAULT_SETTINGS)) continue;
      const def = DEFAULT_SETTINGS[key];
      if (typeof value !== typeof def) continue;
      next[key] = typeof value === 'string' ? value.slice(0, 8000) : value;
    }
    this.settings = next;
    await writeFileAtomic(this.settingsFile, JSON.stringify(next, null, 2));
    return this.getSettings();
  }

  getWindowState() {
    return readJsonSync(this.windowFile, {});
  }

  saveWindowStateSync(state) {
    try {
      fs.writeFileSync(this.windowFile, JSON.stringify(state));
    } catch {
      // not worth crashing over
    }
  }

  // ---------- API key ----------

  getApiKey() {
    const secrets = readJsonSync(this.secretsFile, {});
    if (typeof secrets.apiKey === 'string' && secrets.apiKey) {
      try {
        if (secrets.encrypted) {
          return this.safeStorage.decryptString(Buffer.from(secrets.apiKey, 'base64'));
        }
        return secrets.apiKey;
      } catch {
        return null;
      }
    }
    return process.env.ANTHROPIC_API_KEY || null;
  }

  hasApiKey() {
    return Boolean(this.getApiKey());
  }

  async setApiKey(key) {
    let record;
    // Automated tests skip the Keychain (a Keychain prompt would hang a test machine).
    const skipKeychain = process.env.BUDDY_TEST_MODE === '1';
    if (!skipKeychain && this.safeStorage.isEncryptionAvailable()) {
      record = { encrypted: true, apiKey: this.safeStorage.encryptString(key).toString('base64') };
    } else {
      // Tests, or systems without a keychain (like a Linux test box).
      record = { encrypted: false, apiKey: key };
    }
    await writeFileAtomic(this.secretsFile, JSON.stringify(record), 0o600);
  }

  async clearApiKey() {
    await fsp.rm(this.secretsFile, { force: true });
  }

  // ---------- conversations ----------

  convFile(id) {
    return path.join(this.convDir, `${id}.json`);
  }

  async loadIndex() {
    if (this.index) return this.index;
    const saved = readJsonSync(this.indexFile, null);
    let files = [];
    try {
      files = (await fsp.readdir(this.convDir)).filter((f) => f.endsWith('.json'));
    } catch {
      files = [];
    }
    const ids = new Set(files.map((f) => f.slice(0, -5)).filter(isId));
    const index = new Map();
    if (saved && typeof saved === 'object') {
      for (const [id, summary] of Object.entries(saved)) {
        if (ids.has(id) && summary && typeof summary === 'object') index.set(id, summary);
      }
    }
    // Anything on disk the index doesn't know about gets read once.
    for (const id of ids) {
      if (index.has(id)) continue;
      const conv = readJsonSync(this.convFile(id), null);
      if (conv && conv.id === id) index.set(id, summarize(conv));
    }
    this.index = index;
    await this.saveIndex();
    return index;
  }

  async saveIndex() {
    if (!this.index) return;
    const obj = Object.fromEntries(this.index);
    await writeFileAtomic(this.indexFile, JSON.stringify(obj));
  }

  async listConversations(query) {
    const index = await this.loadIndex();
    let items = [...index.values()];
    const q = typeof query === 'string' ? query.trim().toLowerCase() : '';
    if (q) {
      const hits = [];
      for (const summary of items) {
        if ((summary.title || '').toLowerCase().includes(q)) {
          hits.push(summary);
          continue;
        }
        const conv = await this.getConversation(summary.id, { keepInCache: false });
        if (conv && conv.messages.some((m) => messageText(m).toLowerCase().includes(q))) {
          hits.push(summary);
        }
      }
      items = hits;
    }
    items.sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0));
    return items;
  }

  async getConversation(id, { keepInCache = true } = {}) {
    if (!isId(id)) return null;
    if (this.cache.has(id)) return this.cache.get(id);
    let conv;
    try {
      conv = JSON.parse(await fsp.readFile(this.convFile(id), 'utf8'));
    } catch {
      return null;
    }
    if (!conv || conv.id !== id || !Array.isArray(conv.messages)) return null;
    if (keepInCache) this.cache.set(id, conv);
    return conv;
  }

  newConversation({ id, model, system }) {
    const now = Date.now();
    const conv = {
      id: isId(id) ? id : newId(),
      title: 'New chat',
      createdAt: now,
      updatedAt: now,
      model,
      system,
      messages: [],
    };
    this.cache.set(conv.id, conv);
    return conv;
  }

  saveConversation(conv) {
    const id = conv.id;
    const prev = this.chains.get(id) || Promise.resolve();
    const next = prev
      .catch(() => {})
      .then(async () => {
        if (conv.deleted) return;
        await writeFileAtomic(this.convFile(id), JSON.stringify(conv));
        const index = await this.loadIndex();
        index.set(id, summarize(conv));
        await this.saveIndex();
      });
    this.chains.set(id, next);
    return next;
  }

  async deleteConversation(id) {
    if (!isId(id)) return;
    const conv = await this.getConversation(id, { keepInCache: false });
    if (conv) conv.deleted = true;
    const cached = this.cache.get(id);
    if (cached) cached.deleted = true;
    await (this.chains.get(id) || Promise.resolve()).catch(() => {});
    this.cache.delete(id);
    await fsp.rm(this.convFile(id), { force: true });
    if (conv) {
      for (const m of conv.messages) {
        for (const a of m.attachments || []) await this.deleteAttachment(a);
      }
    }
    const index = await this.loadIndex();
    index.delete(id);
    await this.saveIndex();
  }

  async deleteAllConversations() {
    const index = await this.loadIndex();
    for (const id of [...index.keys()]) await this.deleteConversation(id);
    // Sweep anything left over in the attachments folder too.
    for (const f of await fsp.readdir(this.attDir).catch(() => [])) {
      await fsp.rm(path.join(this.attDir, f), { force: true });
    }
  }

  // ---------- attachments ----------

  attachmentPath(att) {
    if (!att || !isId(att.id) || typeof att.ext !== 'string' || !/^[a-z0-9]{1,8}$/.test(att.ext)) {
      return null;
    }
    return path.join(this.attDir, `${att.id}.${att.ext}`);
  }

  async writeAttachment(meta, data) {
    const file = this.attachmentPath(meta);
    if (!file) throw new Error('Bad attachment');
    await fsp.writeFile(file, data);
    return meta;
  }

  async readAttachment(att, encoding) {
    const file = this.attachmentPath(att);
    if (!file) throw new Error('Bad attachment');
    return fsp.readFile(file, encoding);
  }

  async findAttachmentFile(id) {
    if (!isId(id)) return null;
    const files = await fsp.readdir(this.attDir).catch(() => []);
    const match = files.find((f) => f.startsWith(`${id}.`));
    return match ? path.join(this.attDir, match) : null;
  }

  async deleteAttachment(att) {
    const file = this.attachmentPath(att);
    if (file) await fsp.rm(file, { force: true });
  }
}

module.exports = { Store, DEFAULT_SETTINGS, newId, isId, messageText };
