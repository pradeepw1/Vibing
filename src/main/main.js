'use strict';

const path = require('path');
const fs = require('fs');
const fsp = fs.promises;
const crypto = require('crypto');
const {
  app,
  BrowserWindow,
  Menu,
  clipboard,
  dialog,
  globalShortcut,
  ipcMain,
  nativeTheme,
  protocol,
  safeStorage,
  screen,
  shell,
} = require('electron');

const { Store, isId } = require('./store');
const { prepareAttachment, AttachmentError } = require('./attachments');
const claude = require('./claude');

const isMac = process.platform === 'darwin';
const ORIGIN = 'app://buddy';
// Previews of code Claude writes (web pages, games, SVG, diagrams) load from their own
// origin, inside a sandboxed frame, so they can never reach the app or your data.
const PREVIEW_ORIGIN = 'app://preview';
const UI_DIR = path.join(__dirname, '..', 'renderer');
const NODE_MODULES = path.join(__dirname, '..', '..', 'node_modules');
const VENDOR = {
  'marked.js': path.join(NODE_MODULES, 'marked', 'lib', 'marked.esm.js'),
  'purify.js': path.join(NODE_MODULES, 'dompurify', 'dist', 'purify.es.mjs'),
  'highlight.js': path.join(NODE_MODULES, '@highlightjs', 'cdn-assets', 'es', 'highlight.min.js'),
};
// KaTeX (math) is served as a folder because its stylesheet loads its own fonts.
const KATEX_DIR = path.join(NODE_MODULES, 'katex', 'dist');
const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.json': 'application/json',
  '.woff2': 'font/woff2',
  '.woff': 'font/woff',
  '.ttf': 'font/ttf',
};
const CSP = [
  "default-src 'none'",
  "script-src 'self'",
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: blob:",
  "font-src 'self'",
  "connect-src 'self'",
  "base-uri 'none'",
  "form-action 'none'",
  `frame-src ${PREVIEW_ORIGIN}`,
  "object-src 'none'",
].join('; ');
// What a preview may do: run its own scripts and load things from the web (https only).
const PREVIEW_CSP = "default-src https: data: blob: 'unsafe-inline' 'unsafe-eval'";
const TEST_MODE = process.env.BUDDY_TEST_MODE === '1';

const SHORTCUTS = ['Alt+Space', 'Control+Alt+Space', 'Alt+Shift+Space', 'CommandOrControl+Shift+Space', ''];

// Tests (and curious people) can point Buddy at another data folder.
if (process.env.BUDDY_USER_DATA) app.setPath('userData', process.env.BUDDY_USER_DATA);
app.setName('Buddy');

protocol.registerSchemesAsPrivileged([
  { scheme: 'app', privileges: { standard: true, secure: true, supportFetchAPI: true, corsEnabled: true } },
]);

// Only one Buddy at a time; opening it again just brings the window forward.
const isFirstInstance = app.requestSingleInstanceLock();
if (!isFirstInstance) app.quit();

/** @type {Store} */
let store;
/** @type {BrowserWindow | null} */
let win = null;
let client = null;
let clientKey = null;
let shortcutOk = true;
let quitting = false;
const turns = new Map(); // conversation id -> running Turn
const drafts = new Map(); // attachment id -> metadata, for files added but not sent yet
const previews = new Map(); // preview token -> HTML, kept in memory only
const written = new Set(); // files Buddy exported this session (the only ones it will show in Finder)
const MAX_PREVIEW_CHARS = 5_000_000;

// ---------------------------------------------------------------------------------------------
// Helpers

function send(channel, data) {
  if (win && !win.isDestroyed()) win.webContents.send(channel, data);
}

function sendEvent(event) {
  send('chat:event', event);
}

let listTimer = null;
function listChanged() {
  clearTimeout(listTimer);
  listTimer = setTimeout(() => sendEvent({ type: 'list-changed' }), 30);
}

function getClient() {
  const key = store.getApiKey();
  if (!key) {
    const err = new Error('No API key');
    err.code = 'NO_KEY';
    throw err;
  }
  if (!client || clientKey !== key) {
    client = claude.makeClient(key);
    clientKey = key;
  }
  return client;
}

// The window only ever sees the last 4 characters of the key.
function keyHint() {
  const key = store.getApiKey();
  return key ? key.slice(-4) : '';
}

function backgroundColor() {
  return nativeTheme.shouldUseDarkColors ? '#1c1b19' : '#f7f6f3';
}

function provisionalTitle(text, attachments) {
  const line = String(text || '').split('\n').map((s) => s.trim()).find(Boolean);
  if (line) return line.length > 48 ? `${line.slice(0, 46).trimEnd()}…` : line;
  if (attachments.length) return attachments[0].name;
  return 'New chat';
}

function turnOptions(payload) {
  const settings = store.getSettings();
  const model = claude.modelInfo(payload?.model) ? payload.model : settings.model;
  const effort = claude.EFFORTS.includes(payload?.effort) ? payload.effort : settings.effort;
  const webSearch = typeof payload?.webSearch === 'boolean' ? payload.webSearch : settings.webSearch;
  return { model, effort, webSearch };
}

function cleanText(text) {
  return typeof text === 'string' ? text.slice(0, 200000) : '';
}

function safeFileName(name, fallback = 'Chat') {
  const clean = String(name || '')
    .replace(/[\\/:*?"<>|\u0000-\u001f]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 80);
  return clean || fallback;
}

function previewHtml(html) {
  if (typeof html !== 'string' || !html.trim()) throw new Error('There is nothing to preview.');
  if (html.length > MAX_PREVIEW_CHARS) throw new Error('That preview is too big.');
  return html;
}

// Preview files written for "Open in browser" are cleaned up after a week.
async function cleanOldPreviewFiles() {
  const dir = path.join(app.getPath('userData'), 'previews');
  const weekAgo = Date.now() - 7 * 86400000;
  for (const name of await fsp.readdir(dir).catch(() => [])) {
    const file = path.join(dir, name);
    const stat = await fsp.stat(file).catch(() => null);
    if (stat && stat.mtimeMs < weekAgo) await fsp.rm(file, { force: true });
  }
}

async function confirm(message, detail, okLabel) {
  if (TEST_MODE) return true;
  const result = await dialog.showMessageBox(win, {
    type: 'warning',
    buttons: [okLabel, 'Cancel'],
    defaultId: 1,
    cancelId: 1,
    message,
    detail,
  });
  return result.response === 0;
}

// ---------------------------------------------------------------------------------------------
// Running replies

function startTurn(conv, messageId, opts) {
  const turn = new claude.Turn({ store, client: getClient(), conv, messageId, opts, emit: sendEvent });
  turns.set(conv.id, turn);
  listChanged();
  turn.done = turn
    .run()
    .catch((err) => {
      turn.message.status = 'error';
      turn.message.error = claude.describeError(err);
    })
    .then(async () => {
      const msg = turn.message;
      if (msg.status === 'streaming') msg.status = 'error';
      turns.delete(conv.id);
      if (!conv.deleted) {
        conv.messages.push(msg);
        conv.updatedAt = Date.now();
        await store.saveConversation(conv).catch((err) => console.error('Could not save chat', err));
      }
      sendEvent({ type: 'done', convId: conv.id, messageId: msg.id, message: claude.displayAssistant(msg) });
      listChanged();
    });
}

async function autoTitle(conv, text, model) {
  if (!text.trim()) return;
  try {
    const title = await claude.generateTitle(getClient(), model, text);
    if (!title || conv.deleted || conv.titleLocked) return;
    conv.title = title;
    await store.saveConversation(conv);
    sendEvent({ type: 'title', convId: conv.id, title });
    listChanged();
  } catch (err) {
    // A missing title is no big deal; the first words of the message stay as the title.
    console.warn('Title generation failed:', err?.message || err);
  }
}

async function deleteAttachments(messages) {
  for (const m of messages) {
    for (const att of m.attachments || []) await store.deleteAttachment(att);
  }
}

// ---------------------------------------------------------------------------------------------
// IPC

function handle(channel, fn) {
  ipcMain.handle(channel, async (event, ...args) => {
    const url = event.senderFrame?.url || '';
    if (!url.startsWith(`${ORIGIN}/`)) throw new Error('Blocked');
    return fn(...args);
  });
}

function registerIpc() {
  handle('app:init', async () => ({
    settings: store.getSettings(),
    hasKey: store.hasApiKey(),
    keyHint: keyHint(),
    models: claude.MODELS.map(({ id, label, blurb }) => ({ id, label, blurb })),
    shortcuts: SHORTCUTS,
    shortcutOk,
    platform: process.platform,
    version: app.getVersion(),
  }));

  handle('settings:save', async (patch) => {
    const clean = { ...(patch || {}) };
    if ('model' in clean && !claude.modelInfo(clean.model)) delete clean.model;
    if ('effort' in clean && !claude.EFFORTS.includes(clean.effort)) delete clean.effort;
    if ('theme' in clean && !['system', 'light', 'dark'].includes(clean.theme)) delete clean.theme;
    if ('font' in clean && !['sans', 'serif'].includes(clean.font)) delete clean.font;
    if ('shortcut' in clean && !SHORTCUTS.includes(clean.shortcut)) delete clean.shortcut;
    const before = store.getSettings();
    const settings = await store.saveSettings(clean);
    if (settings.theme !== before.theme) nativeTheme.themeSource = settings.theme;
    if (settings.shortcut !== before.shortcut) registerShortcut(settings.shortcut);
    return { settings, shortcutOk };
  });

  handle('key:set', async (key) => {
    const value = typeof key === 'string' ? key.trim() : '';
    if (value.length < 20 || value.length > 500 || /\s/.test(value)) {
      return { ok: false, error: "That doesn't look like an API key. It usually starts with sk-ant-." };
    }
    const result = await claude.checkApiKey(value);
    if (!result.ok) return result;
    await store.setApiKey(value);
    client = null;
    return { ...result, keyHint: keyHint() };
  });

  handle('key:clear', async () => {
    await store.clearApiKey();
    client = null;
    return { hasKey: store.hasApiKey(), keyHint: keyHint() };
  });

  handle('conv:list', async (query) => {
    const items = await store.listConversations(typeof query === 'string' ? query.slice(0, 200) : '');
    return items.map((c) => ({ ...c, busy: turns.has(c.id) }));
  });

  handle('conv:get', async (id) => {
    const conv = await store.getConversation(id);
    if (!conv) return null;
    const turn = turns.get(id);
    return claude.displayConversation(conv, turn ? turn.live : null);
  });

  handle('conv:rename', async (id, title) => {
    const conv = await store.getConversation(id);
    const clean = typeof title === 'string' ? title.replace(/\s+/g, ' ').trim().slice(0, 120) : '';
    if (!conv || !clean) return null;
    conv.title = clean;
    conv.titleLocked = true;
    await store.saveConversation(conv);
    listChanged();
    return clean;
  });

  handle('conv:delete', async (id) => {
    const conv = await store.getConversation(id);
    if (!conv) return false;
    const ok = await confirm(`Delete “${conv.title}”?`, 'This chat will be gone for good.', 'Delete');
    if (!ok) return false;
    turns.get(id)?.abort();
    await store.deleteConversation(id);
    listChanged();
    return true;
  });

  handle('conv:deleteAll', async () => {
    const ok = await confirm('Delete all chats?', 'Every chat and attached file will be removed from this Mac. This can’t be undone.', 'Delete All');
    if (!ok) return false;
    for (const turn of turns.values()) turn.abort();
    await store.deleteAllConversations();
    listChanged();
    return true;
  });

  handle('att:add', async (file) => {
    if (!file || typeof file !== 'object' || !(file.data instanceof Uint8Array)) {
      return { ok: false, error: 'Could not read that file.' };
    }
    try {
      const data = Buffer.from(file.data.buffer, file.data.byteOffset, file.data.byteLength);
      const prepared = prepareAttachment({ name: file.name, mediaType: file.mediaType, data });
      await store.writeAttachment(prepared.meta, prepared.data);
      drafts.set(prepared.meta.id, prepared.meta);
      return { ok: true, attachment: prepared.meta };
    } catch (err) {
      if (err instanceof AttachmentError) return { ok: false, error: err.message };
      console.error(err);
      return { ok: false, error: 'Could not add that file.' };
    }
  });

  handle('att:remove', async (id) => {
    const meta = drafts.get(id);
    if (!meta) return false;
    drafts.delete(id);
    await store.deleteAttachment(meta);
    return true;
  });

  handle('chat:send', async (payload) => {
    if (!store.hasApiKey()) throw new Error('Add your API key in Settings first.');
    const p = payload || {};
    if (!isId(p.convId) || !isId(p.messageId) || !isId(p.assistantId)) throw new Error('Bad request');
    const text = cleanText(p.text);
    const attachments = (Array.isArray(p.attachmentIds) ? p.attachmentIds : [])
      .map((id) => drafts.get(id))
      .filter(Boolean);
    if (!text.trim() && !attachments.length) throw new Error('Type a message first.');

    const opts = turnOptions(p);
    let conv = await store.getConversation(p.convId);
    const isNew = !conv;
    if (conv && turns.has(conv.id)) throw new Error('Buddy is still replying in this chat.');
    if (isNew) {
      conv = store.newConversation({ id: p.convId, model: opts.model, system: claude.buildSystemPrompt(store.getSettings()) });
      conv.title = provisionalTitle(text, attachments);
    }
    for (const att of attachments) drafts.delete(att.id);
    const now = Date.now();
    conv.messages.push({
      id: p.messageId,
      role: 'user',
      text,
      attachments,
      context: claude.buildContext(opts),
      createdAt: now,
    });
    conv.model = opts.model;
    conv.updatedAt = now;
    await store.saveConversation(conv);
    startTurn(conv, p.assistantId, opts);
    if (isNew) autoTitle(conv, text, opts.model);
    return { id: conv.id, title: conv.title };
  });

  handle('chat:regenerate', async (payload) => {
    const p = payload || {};
    if (!isId(p.assistantId)) throw new Error('Bad request');
    const conv = await store.getConversation(p.convId);
    if (!conv) throw new Error('Chat not found');
    if (turns.has(conv.id)) throw new Error('Buddy is still replying in this chat.');
    const opts = turnOptions(p);
    while (conv.messages.length && conv.messages[conv.messages.length - 1].role === 'assistant') conv.messages.pop();
    const last = conv.messages[conv.messages.length - 1];
    if (!last) throw new Error('Nothing to retry');
    // The last message can be refreshed safely: nothing comes after it.
    last.context = claude.buildContext(opts);
    conv.model = opts.model;
    conv.updatedAt = Date.now();
    await store.saveConversation(conv);
    startTurn(conv, p.assistantId, opts);
    return true;
  });

  handle('chat:edit', async (payload) => {
    const p = payload || {};
    if (!isId(p.assistantId)) throw new Error('Bad request');
    const conv = await store.getConversation(p.convId);
    if (!conv) throw new Error('Chat not found');
    if (turns.has(conv.id)) throw new Error('Buddy is still replying in this chat.');
    const index = conv.messages.findIndex((m) => m.id === p.messageId && m.role === 'user');
    if (index < 0) throw new Error('Message not found');
    const target = conv.messages[index];
    const text = cleanText(p.text);
    if (!text.trim() && !(target.attachments || []).length) throw new Error('Type a message first.');
    const opts = turnOptions(p);
    const removed = conv.messages.splice(index + 1);
    await deleteAttachments(removed);
    target.text = text;
    target.context = claude.buildContext(opts);
    target.editedAt = Date.now();
    conv.model = opts.model;
    conv.updatedAt = Date.now();
    await store.saveConversation(conv);
    startTurn(conv, p.assistantId, opts);
    return true;
  });

  handle('chat:stop', async (convId) => {
    const turn = turns.get(convId);
    if (turn) turn.abort();
    return Boolean(turn);
  });

  handle('preview:create', async (html) => {
    const token = crypto.randomUUID();
    previews.set(token, previewHtml(html));
    while (previews.size > 30) previews.delete(previews.keys().next().value);
    return `${PREVIEW_ORIGIN}/${token}`;
  });

  handle('preview:openInBrowser', async (html, title) => {
    const dir = path.join(app.getPath('userData'), 'previews');
    await fsp.mkdir(dir, { recursive: true });
    const file = path.join(dir, `${safeFileName(title, 'Preview')}-${Date.now().toString(36)}.html`);
    await fsp.writeFile(file, previewHtml(html), 'utf8');
    if (!TEST_MODE) {
      const problem = await shell.openPath(file);
      if (problem) throw new Error(problem);
    }
    return file;
  });

  handle('chat:export', async (id) => {
    const conv = await store.getConversation(id);
    if (!conv) throw new Error('Chat not found');
    const markdown = claude.exportMarkdown(conv, store.getSettings());
    const fileName = `${safeFileName(conv.title)}.md`;
    let filePath;
    if (TEST_MODE) {
      const dir = path.join(app.getPath('userData'), 'exports');
      await fsp.mkdir(dir, { recursive: true });
      filePath = path.join(dir, fileName);
    } else {
      const result = await dialog.showSaveDialog(win, {
        title: 'Export chat',
        defaultPath: path.join(app.getPath('documents'), fileName),
        filters: [{ name: 'Markdown', extensions: ['md'] }],
      });
      if (result.canceled || !result.filePath) return null;
      filePath = result.filePath;
    }
    await fsp.writeFile(filePath, markdown, 'utf8');
    written.add(filePath);
    return filePath;
  });

  handle('shell:open', async (url) => {
    if (TEST_MODE) return;
    if (typeof url === 'string' && /^(https?:|mailto:)/i.test(url)) await shell.openExternal(url);
  });

  handle('shell:reveal', async (filePath) => {
    // Only files Buddy itself wrote (exports) can be shown in Finder.
    if (TEST_MODE || !written.has(filePath)) return;
    if (fs.existsSync(filePath)) shell.showItemInFolder(filePath);
  });

  handle('clipboard:write', async (text) => {
    if (typeof text === 'string') clipboard.writeText(text);
  });

  handle('data:reveal', async () => {
    await shell.openPath(app.getPath('userData'));
  });
}

// ---------------------------------------------------------------------------------------------
// The app:// protocol serves the UI, a few library files, and attachment previews.

async function serveFile(file, extraHeaders = {}) {
  const data = await fsp.readFile(file);
  const type = MIME[path.extname(file).toLowerCase()] || 'application/octet-stream';
  return new Response(data, { headers: { 'content-type': type, ...extraHeaders } });
}

function notFound() {
  return new Response('Not found', { status: 404 });
}

function registerProtocol() {
  protocol.handle('app', async (request) => {
    try {
      const url = new URL(request.url);
      if (url.host === 'preview') {
        const html = previews.get(url.pathname.slice(1));
        if (typeof html !== 'string') return notFound();
        return new Response(html, {
          headers: { 'content-type': 'text/html; charset=utf-8', 'content-security-policy': PREVIEW_CSP },
        });
      }
      if (url.host !== 'buddy') return notFound();
      const pathname = decodeURIComponent(url.pathname);
      if (pathname.startsWith('/vendor/katex/')) {
        const file = path.resolve(KATEX_DIR, pathname.slice('/vendor/katex/'.length));
        const allowed = /\.(mjs|css|woff2|woff|ttf)$/.test(file) && file.startsWith(KATEX_DIR + path.sep);
        return allowed ? await serveFile(file, { 'cache-control': 'max-age=31536000, immutable' }) : notFound();
      }
      if (pathname.startsWith('/vendor/')) {
        const file = VENDOR[pathname.slice('/vendor/'.length)];
        return file ? await serveFile(file) : new Response('Not found', { status: 404 });
      }
      if (pathname.startsWith('/att/')) {
        const file = await store.findAttachmentFile(pathname.slice('/att/'.length));
        if (!file || !/\.(png|jpg|gif|webp)$/.test(file)) return new Response('Not found', { status: 404 });
        return await serveFile(file, { 'cache-control': 'max-age=31536000, immutable' });
      }
      const rel = pathname.replace(/^\/+/, '') || 'index.html';
      const file = path.resolve(UI_DIR, rel);
      if (!file.startsWith(UI_DIR + path.sep)) return new Response('Not found', { status: 404 });
      const headers = file.endsWith('.html') ? { 'content-security-policy': CSP } : {};
      return await serveFile(file, headers);
    } catch {
      return new Response('Not found', { status: 404 });
    }
  });
}

// ---------------------------------------------------------------------------------------------
// Window

function visibleBounds(state) {
  if (!state || !state.width || !state.height) return null;
  const fits = screen.getAllDisplays().some(({ workArea: a }) =>
    state.x < a.x + a.width - 80 && state.x + state.width > a.x + 80 && state.y >= a.y - 10 && state.y < a.y + a.height - 80,
  );
  return fits ? state : null;
}

function createWindow() {
  const saved = visibleBounds(store.getWindowState());
  win = new BrowserWindow({
    width: saved?.width || 1180,
    height: saved?.height || 800,
    x: saved?.x,
    y: saved?.y,
    minWidth: 640,
    minHeight: 480,
    show: false,
    title: 'Buddy',
    backgroundColor: backgroundColor(),
    titleBarStyle: isMac ? 'hiddenInset' : 'default',
    trafficLightPosition: { x: 18, y: 18 },
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      spellcheck: true,
    },
  });
  if (saved?.maximized) win.maximize();

  win.loadURL(`${ORIGIN}/index.html`);
  win.once('ready-to-show', () => win.show());

  // Links always open in your normal browser, never inside Buddy.
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (/^(https?:|mailto:)/i.test(url)) shell.openExternal(url);
    return { action: 'deny' };
  });
  win.webContents.on('will-navigate', (event, url) => {
    if (!url.startsWith(`${ORIGIN}/`)) {
      event.preventDefault();
      if (/^(https?:|mailto:)/i.test(url)) shell.openExternal(url);
    }
  });
  // A link clicked inside a preview opens in your browser instead of replacing the preview.
  win.webContents.on('will-frame-navigate', (event) => {
    if (event.isMainFrame) return;
    const url = event.url || '';
    if (url.startsWith(`${PREVIEW_ORIGIN}/`) || url.startsWith('about:')) return;
    event.preventDefault();
    if (!TEST_MODE && /^https?:/i.test(url)) shell.openExternal(url);
  });

  win.webContents.on('context-menu', (_event, params) => showContextMenu(params));

  let saveTimer = null;
  const saveState = () => {
    if (!win || win.isDestroyed()) return;
    const maximized = win.isMaximized();
    const bounds = maximized ? win.getNormalBounds() : win.getBounds();
    store.saveWindowStateSync({ ...bounds, maximized });
  };
  const saveSoon = () => {
    clearTimeout(saveTimer);
    saveTimer = setTimeout(saveState, 400);
  };
  win.on('resize', saveSoon);
  win.on('move', saveSoon);

  win.on('close', (event) => {
    saveState();
    // On a Mac, closing the window just hides it so the hotkey can bring it right back.
    if (isMac && !quitting) {
      event.preventDefault();
      win.hide();
    }
  });
  win.on('closed', () => {
    win = null;
  });
}

function showWindow() {
  if (!win) {
    createWindow();
    win.once('ready-to-show', () => send('menu', 'focus-composer'));
    return;
  }
  if (win.isMinimized()) win.restore();
  win.show();
  win.focus();
  if (isMac) app.focus({ steal: true });
  send('menu', 'focus-composer');
}

function toggleWindow() {
  if (win && win.isVisible() && win.isFocused()) {
    if (isMac) app.hide();
    else win.hide();
    return;
  }
  showWindow();
}

function registerShortcut(accelerator) {
  globalShortcut.unregisterAll();
  shortcutOk = true;
  if (!accelerator) return;
  try {
    shortcutOk = globalShortcut.register(accelerator, toggleWindow);
  } catch {
    shortcutOk = false;
  }
}

function showContextMenu(params) {
  const items = [];
  if (params.misspelledWord) {
    for (const suggestion of params.dictionarySuggestions.slice(0, 5)) {
      items.push({ label: suggestion, click: () => win.webContents.replaceMisspelling(suggestion) });
    }
    if (!params.dictionarySuggestions.length) items.push({ label: 'No suggestions', enabled: false });
    items.push({ type: 'separator' });
  }
  if (params.linkURL && /^https?:/i.test(params.linkURL)) {
    items.push(
      { label: 'Open Link in Browser', click: () => shell.openExternal(params.linkURL) },
      { label: 'Copy Link', click: () => clipboard.writeText(params.linkURL) },
      { type: 'separator' },
    );
  }
  if (params.isEditable) {
    items.push(
      { role: 'cut', enabled: params.editFlags.canCut },
      { role: 'copy', enabled: params.editFlags.canCopy },
      { role: 'paste', enabled: params.editFlags.canPaste },
      { role: 'selectAll' },
    );
  } else if (params.selectionText) {
    items.push({ role: 'copy' });
  }
  if (isMac && params.selectionText && params.selectionText.trim().length < 60) {
    items.push({ type: 'separator' }, {
      label: `Look Up “${params.selectionText.trim()}”`,
      click: () => win.webContents.showDefinitionForSelection(),
    });
  }
  while (items.length && items[items.length - 1].type === 'separator') items.pop();
  if (items.length) Menu.buildFromTemplate(items).popup({ window: win });
}

function buildMenu() {
  const menuAction = (action) => () => {
    showWindow();
    send('menu', action);
  };
  const template = [
    ...(isMac
      ? [{
        label: 'Buddy',
        submenu: [
          { role: 'about' },
          { type: 'separator' },
          { label: 'Settings…', accelerator: 'Cmd+,', click: menuAction('settings') },
          { type: 'separator' },
          { role: 'services' },
          { type: 'separator' },
          { role: 'hide' },
          { role: 'hideOthers' },
          { role: 'unhide' },
          { type: 'separator' },
          { role: 'quit' },
        ],
      }]
      : []),
    {
      label: 'File',
      submenu: [
        { label: 'New Chat', accelerator: 'CmdOrCtrl+N', click: menuAction('new-chat') },
        { label: 'Search Chats', accelerator: 'CmdOrCtrl+K', click: menuAction('search') },
        { label: 'Export Chat…', accelerator: 'CmdOrCtrl+Shift+E', click: menuAction('export') },
        ...(isMac ? [] : [{ label: 'Settings', accelerator: 'Ctrl+,', click: menuAction('settings') }]),
        { type: 'separator' },
        isMac ? { role: 'close' } : { role: 'quit' },
      ],
    },
    { role: 'editMenu' },
    {
      label: 'View',
      submenu: [
        { label: 'Toggle Sidebar', accelerator: 'CmdOrCtrl+\\', click: menuAction('toggle-sidebar') },
        { type: 'separator' },
        { role: 'resetZoom' },
        { role: 'zoomIn' },
        { role: 'zoomOut' },
        { type: 'separator' },
        { role: 'togglefullscreen' },
        ...(app.isPackaged ? [] : [{ type: 'separator' }, { role: 'reload' }, { role: 'toggleDevTools' }]),
      ],
    },
    { role: 'windowMenu' },
  ];
  Menu.setApplicationMenu(Menu.buildFromTemplate(template));
}

// ---------------------------------------------------------------------------------------------
// Start up

app.on('second-instance', () => showWindow());

app.whenReady().then(() => {
  if (!isFirstInstance) return;
  store = new Store(app.getPath('userData'), safeStorage);
  nativeTheme.themeSource = store.getSettings().theme;
  app.setAboutPanelOptions({
    applicationName: 'Buddy',
    applicationVersion: app.getVersion(),
    credits: 'Your personal assistant, powered by Claude.',
  });
  if (isMac && !app.isPackaged) {
    const icon = path.join(__dirname, '..', '..', 'build', 'icon.png');
    if (fs.existsSync(icon)) app.dock.setIcon(icon);
  }
  registerProtocol();
  registerIpc();
  buildMenu();
  createWindow();
  registerShortcut(store.getSettings().shortcut);
  cleanOldPreviewFiles().catch(() => {});
  nativeTheme.on('updated', () => {
    if (win && !win.isDestroyed()) win.setBackgroundColor(backgroundColor());
  });
});

app.on('activate', () => {
  if (store) showWindow();
});

app.on('before-quit', (event) => {
  quitting = true;
  if (!turns.size) return;
  // Stop any replies in progress and give them a moment to save what they have.
  event.preventDefault();
  const pending = [...turns.values()].map((turn) => {
    turn.abort();
    return turn.done;
  });
  const timeout = new Promise((resolve) => setTimeout(resolve, 2000));
  Promise.race([Promise.allSettled(pending), timeout]).then(() => {
    turns.clear();
    app.quit();
  });
});

app.on('will-quit', () => globalShortcut.unregisterAll());

app.on('window-all-closed', () => {
  if (!isMac) app.quit();
});
