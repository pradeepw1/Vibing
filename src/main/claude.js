'use strict';

// Talks to the Claude API. One "turn" = one assistant reply, streamed live to the window.
//
// A few rules this file follows on purpose:
//  * Chat history is append-only. Earlier messages, the system prompt and the tools list never change
//    once a chat has started, so Claude's saved thinking stays valid and prompt caching keeps working.
//  * Thinking blocks are passed back exactly as received.
//  * If a model declines a request, the API can hand it to a fallback model ("fallbacks: default").

const { Anthropic } = require('@anthropic-ai/sdk');
const { newId } = require('./store');

const MODELS = [
  {
    id: 'claude-opus-5-5',
    label: 'Opus 5.5',
    blurb: 'Smart and thorough. A great everyday pick.',
    fallbacks: true,
    webTools: 'dynamic',
  },
  {
    id: 'claude-sonnet-5-5',
    label: 'Sonnet 5.5',
    blurb: 'Quick and capable',
    fallbacks: true,
    webTools: 'dynamic',
  },
  {
    id: 'claude-haiku-5-5',
    label: 'Haiku 5.5',
    blurb: 'Fastest and cheapest',
    fallbacks: false,
    webTools: 'basic',
  },
  {
    id: 'claude-fable-5-2',
    label: 'Fable 5.2',
    blurb: 'Most powerful, and the priciest',
    fallbacks: true,
    webTools: 'dynamic',
  },
];

const EFFORTS = ['low', 'medium', 'high'];
const MAX_TOKENS = 64000;
const MAX_CONTINUATIONS = 5;

function modelInfo(id) {
  return MODELS.find((m) => m.id === id) || null;
}

function prettyModel(id) {
  const known = modelInfo(id);
  if (known) return known.label;
  const m = /^claude-([a-z]+)-(\d+)(?:-(\d+))?/.exec(String(id || ''));
  if (!m) return String(id || 'Claude');
  const family = m[1][0].toUpperCase() + m[1].slice(1);
  return m[3] ? `${family} ${m[2]}.${m[3]}` : `${family} ${m[2]}`;
}

function timeZone() {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || undefined;
  } catch {
    return undefined;
  }
}

// The tool list must stay the same for the whole chat (it is part of what Claude's thinking is tied to),
// so web search is always declared and switched off with tool_choice "none" instead of being removed.
function webTools(info) {
  const tz = timeZone();
  const search = { name: 'web_search', max_uses: 10 };
  if (tz) search.user_location = { type: 'approximate', timezone: tz };
  if (info.webTools === 'basic') {
    return [{ type: 'web_search_20250305', ...search }];
  }
  return [
    { type: 'web_search_20260209', ...search },
    { type: 'web_fetch_20260209', name: 'web_fetch', max_uses: 10, citations: { enabled: true } },
  ];
}

// ---------------------------------------------------------------------------------------------
// Prompts

function buildSystemPrompt(settings) {
  const assistant = (settings.assistantName || '').trim() || 'Buddy';
  const user = (settings.name || '').trim();
  const lines = [
    `You are ${assistant}, a personal AI assistant that lives in a chat app on the user's Mac. You run on Claude, an AI model made by Anthropic.`,
  ];
  if (user) lines.push(`You're chatting with ${user}.`);
  lines.push(
    '',
    'About the app:',
    '- Replies are shown with Markdown, so headings, lists, tables and code blocks all display nicely. Use them when they help, and keep simple answers short and plain.',
    '- Each user message starts with a short <context> note from the app with the current date and time, and sometimes a note that web search is off. Use it when timing matters, but don\'t mention it otherwise.',
    '- When web search is on, use it for anything recent, fast-changing or niche, and cite what you find.',
    '- The user can attach images, PDFs and text files to their messages.',
  );
  const about = (settings.about || '').trim();
  if (about) {
    lines.push('', `What ${user || 'the user'} wants you to know about them:`, '<about_user>', about, '</about_user>');
  }
  const style = (settings.style || '').trim();
  if (style) {
    lines.push('', 'How they want you to respond:', '<response_preferences>', style, '</response_preferences>');
  }
  return lines.join('\n');
}

function buildContext({ webSearch }) {
  const when = new Date().toLocaleString('en-US', {
    weekday: 'long',
    year: 'numeric',
    month: 'long',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
    timeZoneName: 'short',
  });
  let text = `<context>Sent ${when}.`;
  if (!webSearch) text += ' Web search is turned off for this message.';
  return `${text}</context>`;
}

// ---------------------------------------------------------------------------------------------
// History -> API messages

function cloneBlock(block) {
  const out = {};
  for (const key of Object.keys(block)) {
    try {
      out[key] = block[key];
    } catch {
      out[key] = key === 'input' ? {} : null; // a half-streamed tool input that can't be parsed yet
    }
  }
  return JSON.parse(JSON.stringify(out));
}

function textOnly(blocks) {
  const out = [];
  for (const b of blocks) {
    if (b && b.type === 'text' && b.text) out.push({ type: 'text', text: b.text });
  }
  return out;
}

const RESULT_TYPES = new Set([
  'web_search_tool_result',
  'web_fetch_tool_result',
  'code_execution_tool_result',
  'bash_code_execution_tool_result',
  'text_editor_code_execution_tool_result',
]);

// Clean one finished API response before sending it back as history.
function replayable(blocks) {
  const resultIds = new Set(blocks.filter((b) => b && RESULT_TYPES.has(b.type)).map((b) => b.tool_use_id));
  // After a mid-reply switch to a fallback model, model-internal blocks from before the switch are left out.
  let lastFallback = -1;
  blocks.forEach((b, i) => {
    if (b && b.type === 'fallback') lastFallback = i;
  });
  const out = [];
  blocks.forEach((b, i) => {
    if (!b || typeof b.type !== 'string') return;
    const beforeSwitch = i < lastFallback;
    switch (b.type) {
      case 'text':
        if (b.text) out.push(b);
        break;
      case 'thinking':
        if (!beforeSwitch && b.signature) out.push(b);
        break;
      case 'redacted_thinking':
        if (!beforeSwitch) out.push(b);
        break;
      case 'server_tool_use':
        if (resultIds.has(b.id)) out.push(b);
        break;
      case 'fallback':
        out.push(b);
        break;
      case 'tool_use':
        break; // Buddy has no client-side tools
      default:
        if (RESULT_TYPES.has(b.type)) out.push(b);
        else if (!beforeSwitch) out.push(b);
    }
  });
  // A reply can't be only a fallback marker.
  return out.some((b) => b.type !== 'fallback') ? out : [];
}

function assistantTurns(message, plain) {
  const parts = Array.isArray(message.parts) ? message.parts : [];
  if (message.status === 'refused') return [];
  if (plain || message.status === 'stopped' || message.status === 'error') {
    const text = textOnly(parts.flat());
    return text.length ? [text] : [];
  }
  return parts.map(replayable).filter((p) => p.length);
}

async function userContent(store, message) {
  const blocks = [];
  for (const att of message.attachments || []) {
    try {
      if (att.kind === 'image') {
        const data = await store.readAttachment(att, 'base64');
        blocks.push({ type: 'image', source: { type: 'base64', media_type: att.mediaType, data } });
      } else if (att.kind === 'pdf') {
        const data = await store.readAttachment(att, 'base64');
        blocks.push({
          type: 'document',
          source: { type: 'base64', media_type: 'application/pdf', data },
          title: att.name,
        });
      } else if (att.kind === 'text') {
        const data = await store.readAttachment(att, 'utf8');
        blocks.push({
          type: 'document',
          source: { type: 'text', media_type: 'text/plain', data: data || ' ' },
          title: att.name,
        });
      }
    } catch {
      blocks.push({ type: 'text', text: `[The attached file "${att.name}" is no longer available.]` });
    }
  }
  if (message.context) blocks.push({ type: 'text', text: message.context });
  if (message.text) blocks.push({ type: 'text', text: message.text });
  if (!blocks.length) blocks.push({ type: 'text', text: '(empty message)' });
  return blocks;
}

async function toApiMessages(store, conv, plain) {
  const out = [];
  for (const m of conv.messages) {
    if (m.role === 'user') {
      out.push({ role: 'user', content: await userContent(store, m) });
    } else if (m.role === 'assistant') {
      for (const content of assistantTurns(m, plain)) out.push({ role: 'assistant', content });
    }
  }
  return out;
}

// Request "modes", tried in order only if the API rejects the request before replying:
//   0 = everything (web tools, refusal fallbacks, thinking protection)
//   1 = web tools, but none of the beta extras
//   2 = plain chat: no tools, and earlier replies sent back as plain text
const MODE_FULL = 0;
const MODE_NO_BETAS = 1;
const MODE_PLAIN = 2;

async function buildRequest(store, conv, opts, mode = MODE_FULL) {
  const info = modelInfo(opts.model) || MODELS[0];
  const params = {
    model: info.id,
    max_tokens: MAX_TOKENS,
    system: conv.system,
    messages: await toApiMessages(store, conv, mode === MODE_PLAIN),
    cache_control: { type: 'ephemeral' },
    output_config: { effort: opts.effort },
    thinking: { type: 'adaptive', display: 'summarized' },
  };
  if (mode !== MODE_PLAIN) {
    params.tools = webTools(info);
    params.tool_choice = opts.webSearch ? { type: 'auto' } : { type: 'none' };
  }
  if (mode === MODE_FULL) {
    params.betas = ['thinking-binding-controls-2026-08-01'];
    // If something in the history no longer matches (say, after switching models),
    // drop the stale thinking instead of failing the whole request.
    params.thinking.block_binding = { prefix_mismatch_behavior: 'drop_block' };
    if (info.fallbacks) {
      params.betas.push('server-side-fallback-2026-07-01');
      params.fallbacks = 'default';
    }
  }
  return params;
}

// ---------------------------------------------------------------------------------------------
// What the window gets to see (no encrypted payloads, no signatures)

function hostOf(url) {
  try {
    return new URL(url).hostname.replace(/^www\./, '');
  } catch {
    return '';
  }
}

function slimCitation(c) {
  if (!c || typeof c !== 'object') return null;
  if (c.url) return { url: c.url, title: c.title || hostOf(c.url), text: c.cited_text || '' };
  if (c.document_title) return { url: '', title: c.document_title, text: c.cited_text || '' };
  return null;
}

function readInput(block) {
  try {
    const input = block.input;
    return input && typeof input === 'object' ? input : {};
  } catch {
    return {};
  }
}

function slimBlock(b, timing) {
  switch (b.type) {
    case 'text':
      return {
        type: 'text',
        text: b.text || '',
        citations: (b.citations || []).map(slimCitation).filter(Boolean),
      };
    case 'thinking':
      return { type: 'thinking', text: b.thinking || '', start: timing?.start, end: timing?.end };
    case 'redacted_thinking':
      return { type: 'thinking', text: '', redacted: true, start: timing?.start, end: timing?.end };
    case 'server_tool_use': {
      const input = readInput(b);
      return {
        type: 'tool',
        id: b.id,
        name: b.name,
        query: typeof input.query === 'string' ? input.query : '',
        url: typeof input.url === 'string' ? input.url : '',
      };
    }
    case 'web_search_tool_result': {
      const c = b.content;
      if (Array.isArray(c)) {
        return {
          type: 'tool_result',
          toolUseId: b.tool_use_id,
          kind: 'search',
          results: c
            .filter((r) => r && r.type === 'web_search_result')
            .map((r) => ({ title: r.title || hostOf(r.url), url: r.url, age: r.page_age || '' })),
        };
      }
      return { type: 'tool_result', toolUseId: b.tool_use_id, kind: 'search', results: [], error: c?.error_code || 'error' };
    }
    case 'web_fetch_tool_result': {
      const c = b.content;
      if (c && c.type === 'web_fetch_result') {
        return {
          type: 'tool_result',
          toolUseId: b.tool_use_id,
          kind: 'fetch',
          results: [{ title: c.content?.title || hostOf(c.url), url: c.url, age: '' }],
        };
      }
      return { type: 'tool_result', toolUseId: b.tool_use_id, kind: 'fetch', results: [], error: c?.error_code || 'error' };
    }
    case 'fallback':
      return { type: 'fallback', from: prettyModel(b.from?.model), to: prettyModel(b.to?.model) };
    default:
      if (RESULT_TYPES.has(b.type)) return { type: 'tool_result', toolUseId: b.tool_use_id, kind: 'other', results: [] };
      return { type: 'other', kind: b.type };
  }
}

function displayAssistant(message) {
  const blocks = [];
  const timing = message.timing || {};
  let i = 0;
  for (const part of message.parts || []) {
    for (const b of part) {
      if (b && typeof b.type === 'string') blocks.push(slimBlock(b, timing[i]));
      i++;
    }
  }
  return {
    id: message.id,
    role: 'assistant',
    status: message.status,
    model: prettyModel(message.model),
    requestedModel: prettyModel(message.requestedModel),
    stopReason: message.stopReason || null,
    refusal: message.refusal || null,
    error: message.error || null,
    notice: message.notice || null,
    usage: message.usage || null,
    createdAt: message.createdAt,
    blocks,
  };
}

function displayUser(message) {
  return {
    id: message.id,
    role: 'user',
    text: message.text || '',
    attachments: (message.attachments || []).map((a) => ({
      id: a.id,
      name: a.name,
      kind: a.kind,
      mediaType: a.mediaType,
      size: a.size,
      ext: a.ext,
    })),
    createdAt: message.createdAt,
  };
}

function displayConversation(conv, liveMessage) {
  const messages = conv.messages.map((m) => (m.role === 'user' ? displayUser(m) : displayAssistant(m)));
  if (liveMessage) messages.push(liveMessage);
  return {
    id: conv.id,
    title: conv.title,
    model: conv.model,
    createdAt: conv.createdAt,
    updatedAt: conv.updatedAt,
    messages,
  };
}

// ---------------------------------------------------------------------------------------------
// Errors in plain words

function describeError(err) {
  const apiMessage = err?.error?.error?.message || err?.error?.message || '';
  const withDetail = (text) => (apiMessage ? `${text}\n\nDetails: ${apiMessage}` : text);
  if (err instanceof Anthropic.AuthenticationError) {
    return { title: "Your API key didn't work", detail: 'Check the key in Settings, or paste a new one.', action: 'settings' };
  }
  if (err instanceof Anthropic.PermissionDeniedError) {
    return { title: "Your API key isn't allowed to do this", detail: withDetail('Check your account in the Anthropic Console.') };
  }
  if (err instanceof Anthropic.NotFoundError) {
    return { title: "This model isn't available on your account", detail: withDetail('Pick another model and try again.') };
  }
  if (err instanceof Anthropic.RateLimitError) {
    return {
      title: "You're over your usage limit for now",
      detail: withDetail('Wait a minute and try again. If it keeps happening, check your limits in the Anthropic Console.'),
      action: 'retry',
    };
  }
  if (err instanceof Anthropic.PaymentRequiredError) {
    return { title: 'There is a billing problem with your account', detail: withDetail('Check Plans & Billing in the Anthropic Console.') };
  }
  if (err instanceof Anthropic.OverloadedError || err?.status === 529) {
    return { title: 'Claude is very busy right now', detail: 'Give it a moment and try again.', action: 'retry' };
  }
  if (err instanceof Anthropic.APIConnectionTimeoutError) {
    return { title: 'The request timed out', detail: 'Check your internet connection and try again.', action: 'retry' };
  }
  if (err instanceof Anthropic.APIConnectionError) {
    return { title: "Can't reach Anthropic", detail: 'Check your internet connection and try again.', action: 'retry' };
  }
  if (err instanceof Anthropic.BadRequestError) {
    return { title: "Claude couldn't take this request", detail: apiMessage || err.message, action: 'retry' };
  }
  if (err instanceof Anthropic.APIError && typeof err.status === 'number' && err.status >= 500) {
    return { title: 'Something went wrong on Anthropic\'s side', detail: withDetail('Try again in a moment.'), action: 'retry' };
  }
  if (err && err.code === 'NO_KEY') {
    return { title: 'Add your API key first', detail: 'Open Settings and paste your Anthropic API key.', action: 'settings' };
  }
  return { title: 'Something went wrong', detail: String(err?.message || err || 'Unknown error'), action: 'retry' };
}

// ---------------------------------------------------------------------------------------------
// One assistant reply

class Turn {
  /**
   * @param {object} p
   * @param {import('./store').Store} p.store
   * @param {Anthropic} p.client
   * @param {object} p.conv
   * @param {string} p.messageId
   * @param {{model: string, effort: string, webSearch: boolean}} p.opts
   * @param {(event: object) => void} p.emit
   */
  constructor({ store, client, conv, messageId, opts, emit }) {
    this.store = store;
    this.client = client;
    this.conv = conv;
    this.opts = opts;
    this.emitRaw = emit;
    this.aborted = false;
    this.stream = null;
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
    this.live = { ...displayAssistant(this.message), blocks: [] };
  }

  emit(event) {
    this.emitRaw({ convId: this.conv.id, messageId: this.message.id, ...event });
  }

  abort() {
    this.aborted = true;
    if (this.stream) this.stream.abort();
  }

  async run() {
    const msg = this.message;
    const saved = this.conv.safeMode;
    let mode = saved === true ? MODE_PLAIN : Number.isInteger(saved) ? Math.min(Math.max(saved, 0), MODE_PLAIN) : MODE_FULL;
    let rejection = '';
    let continuations = 0;
    const usage = { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, searches: 0 };

    this.emit({ type: 'start', model: prettyModel(msg.model) });

    while (!this.aborted) {
      const params = await buildRequest(this.store, this.conv, this.opts, mode);
      // Continuing a paused reply: send back what we have so far, unchanged.
      for (const part of msg.parts) params.messages.push({ role: 'assistant', content: part });

      const offset = msg.parts.reduce((n, p) => n + p.length, 0);
      const stream = this.client.beta.messages.stream(params);
      this.stream = stream;
      this.watch(stream, offset);

      let final;
      try {
        final = await stream.finalMessage();
      } catch (err) {
        const partial = stream.currentMessage?.content || [];
        if (this.aborted) {
          if (partial.length) msg.parts.push(partial.map(cloneBlock));
          msg.status = 'stopped';
          break;
        }
        // A 400 before any output: step down to a simpler request and try again.
        if (err instanceof Anthropic.BadRequestError && mode < MODE_PLAIN && msg.parts.length === 0 && partial.length === 0) {
          rejection = describeError(err).detail;
          console.warn(`Request rejected (mode ${mode}), trying a simpler one: ${rejection}`);
          mode++;
          continue;
        }
        if (partial.length) msg.parts.push(partial.map(cloneBlock));
        msg.status = 'error';
        msg.error = describeError(err);
        break;
      }

      msg.parts.push(final.content.map(cloneBlock));
      msg.model = final.model || msg.model;
      const u = final.usage || {};
      usage.input += u.input_tokens || 0;
      usage.output += u.output_tokens || 0;
      usage.cacheRead += u.cache_read_input_tokens || 0;
      usage.cacheWrite += u.cache_creation_input_tokens || 0;
      usage.searches += u.server_tool_use?.web_search_requests || 0;

      if (final.stop_reason === 'pause_turn' && continuations < MAX_CONTINUATIONS) {
        continuations++;
        continue;
      }
      msg.stopReason = final.stop_reason || null;
      if (final.stop_reason === 'refusal') {
        msg.status = 'refused';
        msg.refusal = { category: final.stop_details?.category || null };
      } else {
        msg.status = 'done';
      }
      break;
    }

    if (this.aborted && msg.status === 'streaming') msg.status = 'stopped';
    msg.usage = usage;
    if (mode > MODE_FULL && msg.status === 'done') {
      // Remember what worked so the next message in this chat doesn't fail first.
      this.conv.safeMode = mode;
      if (mode === MODE_PLAIN && rejection) {
        msg.notice = `Web search was switched off for this chat because the API didn't accept the request. (${rejection})`;
      }
    }
    return msg;
  }

  watch(stream, offset) {
    const msg = this.message;
    const dirty = new Set();
    let timer = null;

    const flush = () => {
      if (timer) clearTimeout(timer);
      timer = null;
      const snap = stream.currentMessage;
      if (!snap) return;
      for (const i of dirty) {
        const block = snap.content[i];
        if (!block) continue;
        const slim = slimBlock(block, msg.timing[offset + i]);
        this.live.blocks[offset + i] = slim;
        this.emit({ type: 'block', index: offset + i, block: slim });
      }
      dirty.clear();
    };
    const flushSoon = () => {
      if (!timer) timer = setTimeout(flush, 50);
    };

    stream.on('streamEvent', (event) => {
      switch (event.type) {
        case 'message_start':
          if (event.message?.model && event.message.model !== msg.model) {
            msg.model = event.message.model;
            this.live.model = prettyModel(msg.model);
            this.emit({ type: 'meta', model: this.live.model });
          }
          break;
        case 'content_block_start': {
          const t = event.content_block?.type;
          if (t === 'thinking' || t === 'redacted_thinking') msg.timing[offset + event.index] = { start: Date.now() };
          if (t === 'fallback') {
            this.live.model = prettyModel(event.content_block.to?.model);
            this.emit({ type: 'meta', model: this.live.model });
          }
          dirty.add(event.index);
          flushSoon();
          break;
        }
        case 'content_block_delta':
          dirty.add(event.index);
          flushSoon();
          break;
        case 'content_block_stop': {
          const timing = msg.timing[offset + event.index];
          if (timing && !timing.end) timing.end = Date.now();
          dirty.add(event.index);
          flush();
          break;
        }
        default:
          break;
      }
    });
    stream.on('end', flush);
  }
}

// ---------------------------------------------------------------------------------------------
// Little extra calls

function cleanTitle(text) {
  let t = String(text || '').split('\n').map((s) => s.trim()).find(Boolean) || '';
  t = t.replace(/^(title|chat title)\s*:\s*/i, '').replace(/^["'“”‘’`*#\s]+|["'“”‘’`*\s]+$/g, '').replace(/[.!?。]+$/, '');
  if (t.length > 60) t = `${t.slice(0, 57).trimEnd()}…`;
  return t;
}

async function generateTitle(client, model, text) {
  const res = await client.messages.create({
    model,
    max_tokens: 2000,
    output_config: { effort: 'low' },
    messages: [
      {
        role: 'user',
        content:
          'Write a short title for a chat that starts with the message below. ' +
          'Use 2 to 6 plain words, sentence case, no quotes and no ending punctuation. ' +
          'Reply with the title only.\n\n<message>\n' +
          String(text).slice(0, 4000) +
          '\n</message>',
      },
    ],
  });
  if (res.stop_reason === 'refusal') return '';
  return cleanTitle(res.content.filter((b) => b.type === 'text').map((b) => b.text).join(''));
}

function makeClient(apiKey) {
  return new Anthropic({ apiKey, baseURL: process.env.BUDDY_API_BASE_URL || undefined });
}

async function checkApiKey(apiKey) {
  try {
    await makeClient(apiKey).models.list({ limit: 1 });
    return { ok: true };
  } catch (err) {
    if (err instanceof Anthropic.AuthenticationError) {
      return { ok: false, error: "That key didn't work. Copy it again from the Anthropic Console and paste it here." };
    }
    if (err instanceof Anthropic.APIConnectionError) {
      return { ok: true, warning: "Saved, but Buddy couldn't reach Anthropic to check it. It will be checked when you send a message." };
    }
    // Anything else (like a permissions quirk) shouldn't block saving the key.
    return { ok: true, warning: describeError(err).title };
  }
}

module.exports = {
  MODELS,
  EFFORTS,
  modelInfo,
  prettyModel,
  buildSystemPrompt,
  buildContext,
  buildRequest,
  toApiMessages,
  displayConversation,
  displayAssistant,
  displayUser,
  describeError,
  generateTitle,
  cleanTitle,
  makeClient,
  checkApiKey,
  Turn,
  newId,
};
