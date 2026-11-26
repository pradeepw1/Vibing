'use strict';

// "Run on this Mac": chat with an open AI model running on your own computer through
// Ollama (a free app from ollama.com). No API key, no account, works offline, no limits.
// These models are not Claude and are less capable, but nothing leaves your Mac.

const fs = require('fs');
const os = require('os');
const path = require('path');
const { shell } = require('electron');

const BASE = (process.env.BUDDY_OLLAMA_URL || 'http://127.0.0.1:11434').replace(/\/+$/, '');
const PREFIX = 'local:';
const NAME_RE = /^[a-z0-9][a-z0-9._\-/]*(:[a-z0-9._\-]+)?$/i;

// A short, friendly starting list. Any model from ollama.com/library also works.
const RECOMMENDED = [
  { name: 'qwen3:4b', label: 'Qwen 3 (4B)', blurb: 'Small and quick. Fine on any Apple-chip Mac.', sizeGB: 2.6, minRamGB: 8 },
  { name: 'qwen3:8b', label: 'Qwen 3 (8B)', blurb: 'A good all-rounder for Macs with 16 GB of memory.', sizeGB: 5.2, minRamGB: 16 },
  { name: 'gemma3:12b', label: 'Gemma 3 (12B)', blurb: 'Can look at images. Needs 16 GB of memory.', sizeGB: 8.1, minRamGB: 16 },
  { name: 'gpt-oss:20b', label: 'gpt-oss (20B)', blurb: 'The smartest of these. Needs 24 GB of memory or more.', sizeGB: 14, minRamGB: 24 },
];

class LocalError extends Error {
  constructor(message, { status, code } = {}) {
    super(message);
    this.status = status;
    this.code = code;
  }
}

function isLocal(model) {
  return typeof model === 'string' && model.startsWith(PREFIX) && NAME_RE.test(model.slice(PREFIX.length)) && model.length < 120;
}

function nameOf(model) {
  return isLocal(model) ? model.slice(PREFIX.length) : String(model || '');
}

function label(model) {
  const name = nameOf(model);
  const known = RECOMMENDED.find((m) => m.name === name || `${m.name}:latest` === name);
  return known ? known.label : name.replace(/:latest$/, '');
}

function ramGB() {
  return Math.round(os.totalmem() / 1024 ** 3);
}

function recommendedFor() {
  const ram = ramGB();
  const pick = ram >= 24 ? 'gpt-oss:20b' : ram >= 16 ? 'qwen3:8b' : 'qwen3:4b';
  return { ram, pick, models: RECOMMENDED };
}

// How much of the conversation the model can keep in mind (more needs more memory).
function contextSize() {
  const ram = ramGB();
  if (ram >= 32) return 32768;
  if (ram >= 16) return 16384;
  return 8192;
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function unreachable(err) {
  return err instanceof TypeError || err?.cause?.code === 'ECONNREFUSED' || err?.name === 'TimeoutError';
}

async function call(pathname, { method = 'GET', body, timeout = 8000, signal } = {}) {
  const signals = [signal, timeout ? AbortSignal.timeout(timeout) : null].filter(Boolean);
  let res;
  try {
    res = await fetch(`${BASE}${pathname}`, {
      method,
      headers: body ? { 'content-type': 'application/json' } : undefined,
      body: body ? JSON.stringify(body) : undefined,
      signal: signals.length > 1 ? AbortSignal.any(signals) : signals[0],
    });
  } catch (err) {
    if (signal?.aborted) throw err;
    throw new LocalError("Can't reach Ollama", { code: 'UNREACHABLE' });
  }
  if (!res.ok) {
    let message = `${res.status} ${res.statusText}`;
    try {
      const data = await res.json();
      if (data?.error) message = String(data.error);
    } catch {
      // keep the status text
    }
    throw new LocalError(message, { status: res.status });
  }
  return res;
}

async function getJSON(pathname, timeout) {
  return (await call(pathname, { timeout })).json();
}

// Ollama streams one JSON object per line.
async function* jsonLines(body) {
  const decoder = new TextDecoder();
  let buffer = '';
  for await (const chunk of body) {
    buffer += decoder.decode(chunk, { stream: true });
    let i;
    while ((i = buffer.indexOf('\n')) >= 0) {
      const line = buffer.slice(0, i).trim();
      buffer = buffer.slice(i + 1);
      if (line) yield JSON.parse(line);
    }
  }
  buffer += decoder.decode();
  if (buffer.trim()) yield JSON.parse(buffer.trim());
}

function ollamaAppPath() {
  if (process.platform !== 'darwin') return null;
  return ['/Applications/Ollama.app', path.join(os.homedir(), 'Applications', 'Ollama.app')].find((p) => fs.existsSync(p)) || null;
}

async function status() {
  try {
    const version = await getJSON('/api/version', 2500);
    const tags = await getJSON('/api/tags', 6000);
    const models = (tags.models || [])
      .map((m) => ({
        name: m.name || m.model,
        size: m.size || 0,
        family: m.details?.family || '',
        parameterSize: m.details?.parameter_size || '',
      }))
      .filter((m) => m.name)
      .sort((a, b) => a.name.localeCompare(b.name));
    return { running: true, installed: true, version: version.version || '', models };
  } catch {
    return { running: false, installed: Boolean(ollamaAppPath()), version: '', models: [] };
  }
}

// If Ollama is installed but not open, open it and wait for it to be ready.
async function start() {
  let s = await status();
  if (s.running) return s;
  const app = ollamaAppPath();
  if (!app || process.env.BUDDY_TEST_MODE === '1') return s;
  await shell.openPath(app);
  for (let i = 0; i < 40; i++) {
    await sleep(500);
    s = await status();
    if (s.running) return s;
  }
  return s;
}

const capabilityCache = new Map();

// What a model can do: "thinking", "vision", ... (null if this Ollama doesn't say).
async function capabilities(name) {
  if (capabilityCache.has(name)) return capabilityCache.get(name);
  let caps = null;
  try {
    const res = await call('/api/show', { method: 'POST', body: { model: name }, timeout: 10000 });
    const info = await res.json();
    caps = Array.isArray(info.capabilities) ? info.capabilities : null;
  } catch (err) {
    if (err instanceof LocalError && err.status === 404) throw err;
  }
  capabilityCache.set(name, caps);
  return caps;
}

const pulls = new Map(); // model name -> AbortController

async function pull(name, onProgress) {
  if (!NAME_RE.test(name)) throw new LocalError("That doesn't look like a model name.");
  if (pulls.has(name)) throw new LocalError('That model is already downloading.');
  const controller = new AbortController();
  pulls.set(name, controller);
  try {
    const res = await call('/api/pull', { method: 'POST', body: { model: name, stream: true }, timeout: 0, signal: controller.signal });
    let last = 0;
    for await (const line of jsonLines(res.body)) {
      if (line.error) throw new LocalError(String(line.error));
      const now = Date.now();
      if (line.status === 'success' || now - last > 150) {
        last = now;
        onProgress({ status: line.status || '', completed: line.completed || 0, total: line.total || 0 });
      }
    }
    capabilityCache.delete(name);
  } catch (err) {
    if (controller.signal.aborted) throw new LocalError('Download stopped.', { code: 'CANCELLED' });
    throw err;
  } finally {
    pulls.delete(name);
  }
}

function cancelPull(name) {
  pulls.get(name)?.abort();
}

// gpt-oss takes a thinking level; other thinking models take on/off.
function thinkValue(name, effort) {
  if (/^gpt-oss/i.test(name)) return effort === 'low' ? 'low' : effort === 'high' ? 'high' : 'medium';
  return effort !== 'low';
}

// Some models write their reasoning inside <think>...</think> at the start of the reply.
function splitThink(raw) {
  const m = /^\s*<think>([\s\S]*?)(<\/think>|$)([\s\S]*)$/.exec(raw);
  if (!m) return { thinking: '', text: raw };
  return { thinking: m[1].trim(), text: m[2] ? m[3].replace(/^\s+/, '') : '' };
}

function describeLocalError(err, model) {
  const msg = String(err?.message || err || '');
  if (err?.code === 'UNREACHABLE' || unreachable(err)) {
    return {
      title: "Buddy can't reach Ollama",
      detail: 'Ollama is the free app that runs AI models on your Mac. Make sure it is open (look for the llama in your menu bar).',
      action: 'start-ollama',
    };
  }
  if (err?.status === 404 || /not found/i.test(msg)) {
    return { title: `${label(model)} isn't on your Mac yet`, detail: 'Download it in Settings → Models on this Mac, or pick another model.', action: 'settings' };
  }
  if (/memory/i.test(msg)) {
    return { title: "This model is too big for your Mac's memory", detail: `Try a smaller model.\n\nDetails: ${msg}`, action: 'settings' };
  }
  return { title: 'The model on your Mac ran into a problem', detail: msg, action: 'retry' };
}

// The chat so far, in the shape Ollama wants. Text files go in as text, images only to models
// that can see, and earlier replies (from any model) as plain text.
async function history(store, conv, { canSee }) {
  const out = [];
  for (const m of conv.messages) {
    if (m.role === 'user') {
      const pieces = [];
      const images = [];
      if (m.context) pieces.push(m.context);
      for (const att of m.attachments || []) {
        try {
          if (att.kind === 'text') {
            pieces.push(`<file name="${att.name}">\n${await store.readAttachment(att, 'utf8')}\n</file>`);
          } else if (att.kind === 'image' && canSee) {
            images.push(await store.readAttachment(att, 'base64'));
          } else if (att.kind === 'image') {
            pieces.push(`[The user attached an image (${att.name}), but this model can't see images.]`);
          } else if (att.kind === 'pdf') {
            pieces.push(`[The user attached a PDF (${att.name}). Only Claude models can read PDFs in this app.]`);
          }
        } catch {
          pieces.push(`[The attached file "${att.name}" is no longer available.]`);
        }
      }
      if (m.text) pieces.push(m.text);
      const msg = { role: 'user', content: pieces.join('\n\n') };
      if (images.length) msg.images = images;
      out.push(msg);
    } else if (m.role === 'assistant' && m.status !== 'refused') {
      const text = (m.parts || [])
        .flat()
        .filter((b) => b && b.type === 'text' && b.text)
        .map((b) => b.text)
        .join('')
        .trim();
      if (text) out.push({ role: 'assistant', content: text });
    }
  }
  return out;
}

// ---------------------------------------------------------------------------------------------
// One reply from a local model. Same shape and events as the Claude Turn, so the window
// shows both the same way.

class LocalTurn {
  constructor({ store, conv, messageId, opts, emit, systemPrompt }) {
    this.store = store;
    this.conv = conv;
    this.opts = opts;
    this.emitRaw = emit;
    this.systemPrompt = systemPrompt;
    this.aborted = false;
    this.controller = new AbortController();
    this.message = {
      id: messageId,
      role: 'assistant',
      status: 'streaming',
      model: opts.model,
      requestedModel: opts.model,
      createdAt: Date.now(),
      parts: [],
      timing: {},
    };
    this.live = {
      id: messageId,
      role: 'assistant',
      status: 'streaming',
      model: label(opts.model),
      blocks: [],
      createdAt: this.message.createdAt,
    };
  }

  emit(event) {
    this.emitRaw({ convId: this.conv.id, messageId: this.message.id, ...event });
  }

  abort() {
    this.aborted = true;
    this.controller.abort();
  }

  async run() {
    const msg = this.message;
    const name = nameOf(this.opts.model);
    this.emit({ type: 'start', model: label(this.opts.model) });

    let caps = null;
    try {
      caps = await capabilities(name);
    } catch (err) {
      msg.status = 'error';
      msg.error = describeLocalError(err, this.opts.model);
      return msg;
    }
    const canThink = caps ? caps.includes('thinking') : false;
    const canSee = caps ? caps.includes('vision') : false;
    const body = {
      model: name,
      messages: [{ role: 'system', content: this.systemPrompt }, ...(await history(this.store, this.conv, { canSee }))],
      stream: true,
      keep_alive: '30m',
      options: { num_ctx: contextSize() },
    };
    if (canThink) body.think = thinkValue(name, this.opts.effort);

    let thinking = '';
    let raw = '';
    let final = null;
    const timing = {};
    let timer = null;
    const blocks = () => {
      const split = splitThink(raw);
      const thought = (thinking + (split.thinking ? `\n${split.thinking}` : '')).trim();
      const out = [];
      if (thought) out.push({ type: 'thinking', thinking: thought, signature: '' });
      if (split.text || !thought) out.push({ type: 'text', text: split.text });
      if (thought && !timing.start) timing.start = Date.now();
      if (thought && split.text && !timing.end) timing.end = Date.now();
      return out;
    };
    const flush = () => {
      clearTimeout(timer);
      timer = null;
      blocks().forEach((b, i) => {
        const slim =
          b.type === 'thinking'
            ? { type: 'thinking', text: b.thinking, start: timing.start, end: timing.end }
            : { type: 'text', text: b.text, citations: [] };
        this.live.blocks[i] = slim;
        this.emit({ type: 'block', index: i, block: slim });
      });
    };

    try {
      const res = await call('/api/chat', { method: 'POST', body, timeout: 0, signal: this.controller.signal });
      for await (const chunk of jsonLines(res.body)) {
        if (chunk.error) throw new LocalError(String(chunk.error));
        if (chunk.message?.thinking) thinking += chunk.message.thinking;
        if (chunk.message?.content) raw += chunk.message.content;
        if (chunk.done) final = chunk;
        if (!timer) timer = setTimeout(flush, 50);
      }
      flush();
      msg.status = 'done';
      msg.stopReason = final?.done_reason === 'length' ? 'max_tokens' : 'end_turn';
      msg.usage = { input: final?.prompt_eval_count || 0, output: final?.eval_count || 0, cacheRead: 0, cacheWrite: 0, searches: 0 };
    } catch (err) {
      clearTimeout(timer);
      if (this.aborted) {
        msg.status = 'stopped';
      } else if (body.think !== undefined && /think/i.test(String(err?.message)) && !raw && !thinking) {
        // This model turned out not to support thinking: try once more without it.
        capabilityCache.set(name, (caps || []).filter((c) => c !== 'thinking'));
        return this.run();
      } else {
        msg.status = 'error';
        msg.error = describeLocalError(err, this.opts.model);
      }
    }
    const parts = blocks().filter((b) => b.type !== 'text' || b.text);
    msg.parts = parts.length ? [parts] : [];
    if (timing.start) msg.timing = { 0: { start: timing.start, end: timing.end || Date.now() } };
    return msg;
  }
}

async function generateTitle(model, text) {
  const name = nameOf(model);
  const caps = await capabilities(name).catch(() => null);
  const body = {
    model: name,
    stream: false,
    keep_alive: '30m',
    messages: [
      {
        role: 'user',
        content:
          'Write a short title for a chat that starts with the message below. Use 2 to 6 plain words, ' +
          'sentence case, no quotes and no ending punctuation. Reply with the title only.\n\n<message>\n' +
          String(text).slice(0, 2000) +
          '\n</message>',
      },
    ],
  };
  if (caps?.includes('thinking')) body.think = /^gpt-oss/i.test(name) ? 'low' : false;
  const res = await call('/api/chat', { method: 'POST', body, timeout: 90000 });
  const data = await res.json();
  return splitThink(String(data?.message?.content || '')).text;
}

module.exports = {
  PREFIX,
  isLocal,
  nameOf,
  label,
  status,
  start,
  pull,
  cancelPull,
  capabilities,
  recommendedFor,
  generateTitle,
  describeLocalError,
  LocalTurn,
  splitThink,
};
