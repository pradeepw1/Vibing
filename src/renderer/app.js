// Buddy - the chat window.

import { renderMarkdown, escapeHtml, typesetMath, previewKind, previewTitle } from './markdown.js';
import { icon, logo } from './icons.js';

const api = window.buddy;

const EFFORT_LABELS = { low: 'Quick', medium: 'Balanced', high: 'Deep' };
const EFFORT_HINTS = {
  low: 'Short thinking, fastest replies',
  medium: 'A good balance for most things',
  high: 'Thinks longer on hard problems',
};
const MAX_ATTACHMENTS = 20;
const SUGGESTIONS = [
  { icon: 'pen', label: 'Help me write', prompt: 'Help me write ' },
  { icon: 'bulb', label: 'Explain something', prompt: 'Explain this to me like I’m new to it: ' },
  { icon: 'calendar', label: 'Plan my week', prompt: 'Help me plan my week. Here’s what I have going on: ' },
  { icon: 'code', label: 'Code with me', prompt: 'Help me with some code. ' },
];

const state = {
  info: null,
  settings: {},
  models: [],
  hasKey: false,
  keyHint: '',
  chats: [],
  search: '',
  current: null, // { id, title, isNew, messages: [] }
  composer: { model: 'claude-opus-5-5', effort: 'medium', webSearch: true },
  drafts: [], // { tempId, pending, meta?, previewUrl?, name }
  editingId: null,
  renamingId: null,
  shortcutOk: true,
  local: { status: null }, // what Ollama reports: running, installed, models on this Mac
};

const $ = (sel, root = document) => root.querySelector(sel);
const uuid = () => crypto.randomUUID();

function h(html) {
  const t = document.createElement('template');
  t.innerHTML = html.trim();
  return t.content.firstElementChild;
}

function debounce(fn, ms) {
  let t;
  return (...args) => {
    clearTimeout(t);
    t = setTimeout(() => fn(...args), ms);
  };
}

function hostOf(url) {
  try {
    return new URL(url).hostname.replace(/^www\./, '');
  } catch {
    return '';
  }
}

function formatSize(bytes) {
  if (!bytes && bytes !== 0) return '';
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

// Models running on this Mac (through Ollama) are named "local:<name>".
function isLocalModel(id) {
  return typeof id === 'string' && id.startsWith('local:');
}

function modelLabel(id) {
  if (isLocalModel(id)) {
    const name = id.slice('local:'.length);
    const known = state.info?.local?.models.find((m) => m.name === name || `${m.name}:latest` === name);
    return known ? known.label : name.replace(/:latest$/, '');
  }
  return state.models.find((m) => m.id === id)?.label || 'Claude';
}

function assistantName() {
  return (state.settings.assistantName || '').trim() || 'Buddy';
}

function toast(text, kind = '', action = null) {
  const root = $('.toasts');
  if (!root) return;
  const el = h(`<div class="toast ${kind}"><span></span></div>`);
  el.firstElementChild.textContent = text;
  if (action) {
    const btn = h('<button class="toast-action" type="button"></button>');
    btn.textContent = action.label;
    btn.addEventListener('click', () => {
      action.run();
      el.remove();
    });
    el.appendChild(btn);
  }
  root.appendChild(el);
  setTimeout(() => el.remove(), kind === 'error' || action ? 5000 : 2200);
}

async function copyText(text, note = 'Copied') {
  await api.copy(text);
  toast(note);
}

function errorText(err) {
  const msg = String(err?.message || err || 'Something went wrong');
  // Errors thrown in the main process arrive as "Error invoking remote method '...': Error: <text>"
  return msg.replace(/^Error invoking remote method '[^']+': (Error: )?/, '');
}

// ---------------------------------------------------------------------------------------------
// Boot

async function boot() {
  const info = await api.init();
  state.info = info;
  state.settings = info.settings;
  state.models = info.models;
  state.hasKey = info.hasKey;
  state.keyHint = info.keyHint || '';
  state.shortcutOk = info.shortcutOk;
  document.body.classList.toggle('mac', info.platform === 'darwin');
  applyTheme();
  applyFont();
  resetComposerOptions();

  api.onEvent(onEvent);
  api.onMenu(onMenu);
  wireGlobalKeys();
  wireDragAndDrop();

  if (!canChat()) renderOnboarding();
  else startApp();
}

// You can chat if you have a Claude key, or if your default model runs on this Mac.
function canChat() {
  return state.hasKey || isLocalModel(state.settings.model);
}

// Make sure Ollama is up (opening it if it's installed), and remember what it has.
async function wakeOllama({ quiet = true } = {}) {
  let s = await api.localStatus().catch(() => null);
  if (s && !s.running && s.installed) {
    if (!quiet) toast('Opening Ollama…');
    s = await api.localStart().catch(() => s);
  }
  state.local.status = s;
  return s;
}

function applyFont() {
  document.body.classList.toggle('font-serif', state.settings.font === 'serif');
}

// "system" follows the Mac's light/dark setting; "light" and "dark" force one.
function applyTheme() {
  document.documentElement.dataset.theme = state.settings.theme || 'system';
}

function resetComposerOptions() {
  state.composer = {
    model: state.settings.model,
    effort: state.settings.effort,
    webSearch: state.settings.webSearch,
  };
}

function startApp() {
  renderShell();
  newChat();
  loadChats();
  if (isLocalModel(state.composer.model)) wakeOllama().then(() => updateComposer());
}

// ---------------------------------------------------------------------------------------------
// First run

function onboardScreen(inner) {
  const root = $('#root');
  root.innerHTML = '';
  const el = h(`<div class="onboard drag"><div class="onboard-card">${inner}</div></div>`);
  root.appendChild(el);
  root.appendChild(h('<div class="toasts"></div>'));
  return el;
}

function renderOnboarding() {
  const el = onboardScreen(`
    ${logo(52)}
    <h1>Welcome to Buddy</h1>
    <p class="lead">Your own AI assistant, right on your Mac. First, pick where its brain runs.</p>
    <div class="choices">
      <button class="choice" data-choice="local">
        <span class="choice-icon">${icon('laptop', 20)}</span>
        <span class="choice-main">
          <span class="choice-title">Run on this Mac</span>
          <span class="choice-sub">Free and private. No account or key, works offline, no usage limits. Uses the free Ollama app. Not as smart as Claude.</span>
        </span>
        ${icon('chevronRight', 16)}
      </button>
      <button class="choice" data-choice="claude">
        <span class="choice-icon">${icon('sparkle', 20)}</span>
        <span class="choice-main">
          <span class="choice-title">Use Claude</span>
          <span class="choice-sub">The smartest option, with web search. Needs an Anthropic API key, and you pay as you go.</span>
        </span>
        ${icon('chevronRight', 16)}
      </button>
    </div>
    <div class="fine-print">${icon('shield', 15)}<div>You can switch or use both any time. Your chats are always saved only on this Mac.</div></div>`);
  $('[data-choice="local"]', el).addEventListener('click', () => renderLocalSetup());
  $('[data-choice="claude"]', el).addEventListener('click', () => renderKeySetup());
}

function gb(bytes) {
  if (!bytes) return '';
  return bytes >= 1e9 ? `${(bytes / 1e9).toFixed(1)} GB` : `${Math.max(1, Math.round(bytes / 1e6))} MB`;
}

function pullProgressNode(model) {
  const node = h(`
    <div class="pull-progress">
      <div class="progress"><div class="bar"></div></div>
      <div class="progress-row"><span class="progress-text">Starting the download…</span><button class="link-btn" type="button">Cancel</button></div>
    </div>`);
  node.dataset.model = model;
  node.querySelector('.link-btn').addEventListener('click', () => api.localCancelPull(model));
  return node;
}

// Download progress for a model, shown wherever a progress bar for it is on screen.
function updatePullProgress(ev) {
  for (const node of document.querySelectorAll('.pull-progress')) {
    if (node.dataset.model !== ev.model) continue;
    const bar = node.querySelector('.bar');
    const text = node.querySelector('.progress-text');
    const biggest = Number(node.dataset.total || 0);
    if (ev.status === 'success') {
      bar.style.width = '100%';
      text.textContent = 'Done!';
    } else if (ev.total > 0 && ev.total >= biggest) {
      // The model file is the big piece; the small extra files that follow don't move the bar back.
      node.dataset.total = String(ev.total);
      bar.style.width = `${Math.min(100, (ev.completed / ev.total) * 100).toFixed(1)}%`;
      text.textContent = `Downloading… ${gb(ev.completed) || '0 MB'} of ${gb(ev.total)}`;
    } else if (!ev.total) {
      text.textContent = /verifying/i.test(ev.status)
        ? 'Checking the download…'
        : /manifest/i.test(ev.status) && biggest
          ? 'Almost done…'
          : 'Getting ready…';
    }
  }
}

function renderLocalSetup() {
  const rec = state.info.local;
  const el = onboardScreen(`
    <button class="back" type="button">${icon('chevronLeft', 15)} Back</button>
    ${logo(52)}
    <h1>Run on this Mac</h1>
    <p class="lead">Buddy uses Ollama, a free app that runs AI models right on your Mac. Nothing you type leaves your computer.</p>
    <div class="local-box" id="ls-ollama"></div>
    <div id="ls-models"></div>
    <div class="field" id="ls-name-row">
      <label for="ob-name">What should Buddy call you? <span class="kbd">(optional)</span></label>
      <input class="input" type="text" id="ob-name" placeholder="Your first name" autocomplete="off" />
    </div>
    <div id="ls-progress"></div>
    <div class="row between">
      <div class="form-msg" id="ls-msg"></div>
      <button class="btn primary" id="ls-go" disabled>Start chatting</button>
    </div>`);
  const box = $('#ls-ollama', el);
  const modelsBox = $('#ls-models', el);
  const go = $('#ls-go', el);
  const msg = $('#ls-msg', el);
  const nameInput = $('#ob-name', el);
  nameInput.value = state.settings.name || '';
  let alive = true;
  let busy = false;
  let choice = null; // { name, download, sizeGB }

  $('.back', el).addEventListener('click', () => {
    alive = false;
    renderOnboarding();
  });

  const paintButton = () => {
    go.disabled = busy || !choice;
    go.textContent = choice?.download ? `Download and start${choice.sizeGB ? ` (about ${choice.sizeGB} GB)` : ''}` : 'Start chatting';
  };

  const paintModels = (s) => {
    modelsBox.innerHTML = '';
    if (!s?.running) {
      choice = null;
      paintButton();
      return;
    }
    const list = h('<div class="model-options"></div>');
    const add = (opt) => {
      const row = h(`
        <label class="model-option">
          <input type="radio" name="ls-model" />
          <span class="mo-main"><span class="mo-title"></span><span class="mo-sub"></span></span>
          <span class="mo-size"></span>
        </label>`);
      row.querySelector('input').value = opt.name;
      row.querySelector('.mo-title').textContent = opt.title;
      row.querySelector('.mo-sub').textContent = opt.sub;
      row.querySelector('.mo-size').textContent = opt.size;
      if (opt.tag) row.querySelector('.mo-title').appendChild(h(`<span class="tag">${escapeHtml(opt.tag)}</span>`));
      row.querySelector('input').addEventListener('change', () => {
        choice = { name: opt.name, download: opt.download, sizeGB: opt.sizeGB };
        paintButton();
      });
      list.appendChild(row);
      return row;
    };
    if (s.models.length) {
      list.appendChild(h('<div class="mo-group">Already on your Mac</div>'));
      for (const m of s.models) {
        add({ name: m.name, title: modelLabel(`local:${m.name}`), sub: m.parameterSize ? `${m.parameterSize} model` : 'Ready to use', size: gb(m.size), download: false });
      }
    }
    const installed = new Set(s.models.map((m) => m.name));
    const toGet = rec.models.filter((m) => !installed.has(m.name) && !installed.has(`${m.name}:latest`));
    if (toGet.length) {
      list.appendChild(h(`<div class="mo-group">${s.models.length ? 'Or download one' : 'Pick one to download'}</div>`));
      for (const m of toGet) {
        const tooBig = m.minRamGB > rec.ram;
        add({
          name: m.name,
          title: m.label,
          sub: tooBig ? `${m.blurb} (Your Mac has ${rec.ram} GB.)` : m.blurb,
          size: `${m.sizeGB} GB`,
          sizeGB: m.sizeGB,
          download: true,
          tag: m.name === rec.pick ? 'Best for your Mac' : '',
        });
      }
    }
    modelsBox.appendChild(list);
    // Pre-pick: something already downloaded, or the best fit for this Mac.
    const preferred = s.models[0]?.name || rec.pick;
    const radio = [...list.querySelectorAll('input')].find((r) => r.value === preferred) || list.querySelector('input');
    if (radio) {
      radio.checked = true;
      radio.dispatchEvent(new Event('change'));
    }
  };

  const paint = (s) => {
    if (!alive) return;
    if (!s) {
      box.innerHTML = `<div class="lb-row">${icon('sparkle', 16)}<span>Looking for Ollama…</span></div>`;
    } else if (s.running) {
      box.innerHTML = `<div class="lb-row ok">${icon('check', 16)}<span>Ollama is ready</span></div>`;
    } else if (s.installed) {
      box.innerHTML = `<div class="lb-row">${icon('sparkle', 16)}<span>Opening Ollama… If nothing happens, open it from your Applications folder.</span></div>`;
    } else {
      box.innerHTML = `
        <div class="lb-row">${icon('download', 16)}<span><b>First, get Ollama.</b> It's free. Install it, open it once, and Buddy will notice by itself.</span></div>
        <div class="lb-actions"><button class="btn" type="button" data-a="get-ollama">${icon('external', 15)} Download Ollama</button></div>`;
      $('[data-a="get-ollama"]', box).addEventListener('click', () => api.openExternal('https://ollama.com/download'));
    }
    if (!busy) paintModels(s);
  };

  const finish = async (name) => {
    const patch = { model: `local:${name}`, name: nameInput.value.trim() };
    const saved = await api.saveSettings(patch);
    state.settings = saved.settings;
    alive = false;
    resetComposerOptions();
    startApp();
  };

  go.addEventListener('click', async () => {
    if (!choice || busy) return;
    msg.textContent = '';
    msg.className = 'form-msg';
    if (!choice.download) {
      await finish(choice.name);
      return;
    }
    busy = true;
    paintButton();
    const progressBox = $('#ls-progress', el);
    progressBox.innerHTML = '';
    progressBox.appendChild(pullProgressNode(choice.name));
    const result = await api.localPull(choice.name).catch((err) => ({ ok: false, error: errorText(err) }));
    busy = false;
    if (result.ok) {
      await finish(choice.name);
      return;
    }
    progressBox.innerHTML = '';
    msg.textContent = result.cancelled ? 'Download stopped.' : result.error;
    if (!result.cancelled) msg.classList.add('error');
    paintButton();
  });

  paint(null);
  // Keep checking until Ollama is up (it may still be installing).
  (async () => {
    let first = true;
    while (alive) {
      const s = first ? await wakeOllama() : await api.localStatus().catch(() => null);
      first = false;
      if (!alive) return;
      const wasRunning = state.local.status?.running;
      state.local.status = s;
      if (!busy && (!s?.running || !wasRunning || modelsBox.childElementCount === 0)) paint(s);
      if (s?.running) return;
      await new Promise((r) => setTimeout(r, 2500));
    }
  })();
}

function renderKeySetup() {
  const root = $('#root');
  root.innerHTML = '';
  const el = h(`
    <div class="onboard drag">
      <div class="onboard-card">
        <button class="back" type="button">${icon('chevronLeft', 15)} Back</button>
        ${logo(52)}
        <h1>Use Claude</h1>
        <p class="lead">Connect your Anthropic API key. It takes a minute.</p>
        <ol class="steps">
          <li>
            <div class="step-head">Get an API key from Anthropic</div>
            <button class="btn" data-act="console">${icon('external', 15)} Open the Anthropic Console</button>
          </li>
          <li>
            <div class="step-head">Paste your key here</div>
            <input class="input" type="password" id="ob-key" placeholder="sk-ant-..." autocomplete="off" spellcheck="false" />
          </li>
          <li>
            <div class="step-head">What should Buddy call you? <span class="kbd">(optional)</span></div>
            <input class="input" type="text" id="ob-name" placeholder="Your first name" autocomplete="off" />
          </li>
        </ol>
        <div class="row between">
          <div class="form-msg" id="ob-msg"></div>
          <button class="btn primary" id="ob-go">Get started</button>
        </div>
        <div class="fine-print">${icon('shield', 15)}<div>Your key is locked in your Mac’s Keychain and is only used to talk to Anthropic. Chats are saved on this Mac. You pay Anthropic directly for what you use.</div></div>
      </div>
    </div>`);
  root.appendChild(el);
  root.appendChild(h('<div class="toasts"></div>'));
  const keyInput = $('#ob-key', el);
  const nameInput = $('#ob-name', el);
  nameInput.value = state.settings.name || '';
  const go = $('#ob-go', el);
  const msg = $('#ob-msg', el);
  $('.back', el).addEventListener('click', () => renderOnboarding());
  $('[data-act="console"]', el).addEventListener('click', () => api.openExternal('https://platform.claude.com/settings/keys'));

  async function submit() {
    msg.textContent = '';
    msg.className = 'form-msg';
    const key = keyInput.value.trim();
    if (!key) {
      msg.textContent = 'Paste your API key first.';
      msg.classList.add('error');
      keyInput.focus();
      return;
    }
    go.disabled = true;
    go.textContent = 'Checking…';
    const result = await api.setApiKey(key).catch((err) => ({ ok: false, error: errorText(err) }));
    go.disabled = false;
    go.textContent = 'Get started';
    if (!result.ok) {
      msg.textContent = result.error;
      msg.classList.add('error');
      return;
    }
    const name = nameInput.value.trim();
    const patch = {};
    if (name !== (state.settings.name || '')) patch.name = name;
    // Coming here from a local setup? Make Claude the default now that there's a key.
    if (isLocalModel(state.settings.model)) patch.model = 'claude-opus-5-5';
    if (Object.keys(patch).length) {
      const saved = await api.saveSettings(patch);
      state.settings = saved.settings;
    }
    state.hasKey = true;
    state.keyHint = result.keyHint || '';
    resetComposerOptions();
    startApp();
    if (result.warning) toast(result.warning);
  }
  go.addEventListener('click', submit);
  keyInput.addEventListener('keydown', (e) => e.key === 'Enter' && submit());
  nameInput.addEventListener('keydown', (e) => e.key === 'Enter' && submit());
  setTimeout(() => keyInput.focus(), 50);
}

// ---------------------------------------------------------------------------------------------
// Main layout

function renderShell() {
  const root = $('#root');
  root.innerHTML = '';
  const app = h(`
    <div class="app ${state.settings.sidebarCollapsed ? 'sidebar-collapsed' : ''}">
      <aside class="sidebar">
        <div class="sidebar-head drag">
          <button class="icon-btn" data-act="toggle-sidebar" title="Hide sidebar (⌘\\)">${icon('sidebar')}</button>
        </div>
        <div class="brand">${logo(24)}<span class="brand-name"></span></div>
        <button class="new-chat" data-act="new-chat">${icon('newChat', 17)}<span>New chat</span><span class="kbd">⌘N</span></button>
        <div class="search-box">${icon('search', 15)}<input type="text" placeholder="Search chats" spellcheck="false" /></div>
        <nav class="chat-list"></nav>
        <div class="sidebar-foot">
          <button class="profile" data-act="settings" title="Settings">
            <span class="avatar"></span><span class="name"></span>
          </button>
          <button class="icon-btn" data-act="settings" title="Settings (⌘,)">${icon('settings')}</button>
        </div>
      </aside>
      <main class="main empty">
        <header class="topbar drag">
          <button class="icon-btn when-collapsed" data-act="toggle-sidebar" title="Show sidebar (⌘\\)">${icon('sidebar')}</button>
          <button class="icon-btn when-collapsed" data-act="new-chat" title="New chat (⌘N)">${icon('newChat', 17)}</button>
          <div class="topbar-title"></div>
        </header>
        <div class="scroller">
          <div class="welcome">
            ${logo(46)}
            <h1 class="greeting"></h1>
            <div class="greeting-sub">How can I help you today?</div>
          </div>
          <div class="thread"></div>
        </div>
        <button class="to-bottom" title="Scroll to bottom">${icon('arrowDown', 17)}</button>
        <div class="composer-area">
          <div class="composer">
            <div class="drafts"></div>
            <textarea rows="1" spellcheck="true"></textarea>
            <div class="toolbar">
              <button class="tool-btn" data-act="attach" title="Add photos and files">${icon('paperclip', 17)}</button>
              <button class="tool-btn web-btn" data-act="web" title="Let Claude search the web">${icon('globe', 17)}<span>Search</span></button>
              <div class="spacer"></div>
              <button class="tool-btn model-btn" data-act="model"><span class="model-name"></span>${icon('chevronDown', 14)}</button>
              <button class="send-btn" data-act="send" title="Send (Enter)">${icon('arrowUp', 18)}</button>
            </div>
            <input type="file" class="file-input" multiple hidden />
          </div>
          <div class="suggestions"></div>
          <div class="footnote"></div>
        </div>
      </main>
      <aside class="preview-panel" hidden>
        <div class="preview-resizer" title="Drag to resize"></div>
        <header class="preview-head drag">
          <div class="preview-title"></div>
          <button class="icon-btn small" data-pv="copy" title="Copy the code">${icon('copy', 15)}</button>
          <button class="icon-btn small" data-pv="browser" title="Open in your browser">${icon('external', 15)}</button>
          <button class="icon-btn small" data-pv="close" title="Close preview (Esc)">${icon('x', 16)}</button>
        </header>
        <div class="preview-body"></div>
      </aside>
      <div class="drop-overlay">Drop files to add them to your message</div>
      <div class="toasts"></div>
    </div>`);
  root.appendChild(app);
  wirePreviewPanel();

  app.addEventListener('click', onClick);

  const search = $('.search-box input', app);
  const runSearch = debounce(() => {
    state.search = search.value;
    loadChats();
  }, 180);
  search.addEventListener('input', runSearch);
  search.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
      search.value = '';
      state.search = '';
      loadChats();
      focusComposer();
    }
  });

  const suggestions = $('.suggestions', app);
  for (const s of SUGGESTIONS) {
    const b = h(`<button class="suggestion">${icon(s.icon, 15)}<span></span></button>`);
    b.querySelector('span').textContent = s.label;
    b.addEventListener('click', () => {
      const ta = composerInput();
      ta.value = s.prompt;
      autosize();
      updateComposer();
      ta.focus();
      ta.setSelectionRange(ta.value.length, ta.value.length);
    });
    suggestions.appendChild(b);
  }

  wireComposer();
  wireScroller();
  renderProfile();
  updateComposer();
}

function renderProfile() {
  const name = (state.settings.name || '').trim();
  $('.profile .avatar').textContent = (name[0] || '?').toUpperCase();
  $('.profile .name').textContent = name || 'You';
  $('.brand-name').textContent = assistantName();
  $('.composer textarea').placeholder = `Message ${assistantName()}…`;
  updateGreeting();
}

function updateGreeting() {
  const el = $('.greeting');
  if (!el) return;
  const hour = new Date().getHours();
  const part = hour < 5 ? 'Up late' : hour < 12 ? 'Good morning' : hour < 17 ? 'Good afternoon' : hour < 22 ? 'Good evening' : 'Up late';
  const name = (state.settings.name || '').trim();
  el.textContent = name ? `${part}, ${name}` : part;
}

function onClick(e) {
  const target = e.target.closest('[data-act]');
  if (!target) return;
  const act = target.dataset.act;
  switch (act) {
    case 'toggle-sidebar':
      toggleSidebar();
      break;
    case 'new-chat':
      newChat();
      break;
    case 'settings':
      openSettings();
      break;
    case 'attach':
      $('.file-input').click();
      break;
    case 'web':
      setComposerOption({ webSearch: !state.composer.webSearch }, true);
      toast(state.composer.webSearch ? 'Web search is on' : 'Web search is off');
      break;
    case 'model':
      openModelMenu(target);
      break;
    case 'send':
      if (isBusy()) stopReply();
      else sendMessage();
      break;
    default:
      break;
  }
}

function onMenu(action) {
  if (!state.hasKey) return;
  switch (action) {
    case 'new-chat':
      newChat();
      break;
    case 'settings':
      openSettings();
      break;
    case 'toggle-sidebar':
      toggleSidebar();
      break;
    case 'search': {
      if (state.settings.sidebarCollapsed) toggleSidebar();
      const input = $('.search-box input');
      input?.focus();
      input?.select();
      break;
    }
    case 'focus-composer':
      if (!document.querySelector('.overlay')) focusComposer();
      break;
    case 'export':
      if (!state.current || state.current.isNew) toast('Start a chat first, then you can export it.');
      else exportChat(state.current.id);
      break;
    default:
      break;
  }
}

async function toggleSidebar() {
  const collapsed = !state.settings.sidebarCollapsed;
  state.settings.sidebarCollapsed = collapsed;
  $('.app')?.classList.toggle('sidebar-collapsed', collapsed);
  const saved = await api.saveSettings({ sidebarCollapsed: collapsed });
  state.settings = saved.settings;
}

// ---------------------------------------------------------------------------------------------
// Sidebar

async function loadChats() {
  try {
    state.chats = await api.listChats(state.search);
  } catch {
    state.chats = [];
  }
  renderChatList();
}

const reloadChats = debounce(loadChats, 120);

function groupLabel(ts) {
  const now = new Date();
  const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
  const day = 86400000;
  if (ts >= startOfToday) return 'Today';
  if (ts >= startOfToday - day) return 'Yesterday';
  if (ts >= startOfToday - 7 * day) return 'Previous 7 days';
  if (ts >= startOfToday - 30 * day) return 'Previous 30 days';
  return new Date(ts).toLocaleDateString(undefined, { month: 'long', year: 'numeric' });
}

function renderChatList() {
  const list = $('.chat-list');
  if (!list) return;
  list.innerHTML = '';
  if (!state.chats.length) {
    const empty = h('<div class="chat-empty"></div>');
    empty.textContent = state.search ? 'No chats match your search.' : 'Your chats will show up here.';
    list.appendChild(empty);
    return;
  }
  let lastGroup = '';
  for (const chat of state.chats) {
    const group = groupLabel(chat.updatedAt || chat.createdAt || 0);
    if (group !== lastGroup) {
      const g = h('<div class="chat-group"></div>');
      g.textContent = group;
      list.appendChild(g);
      lastGroup = group;
    }
    list.appendChild(chatItem(chat));
  }
}

function chatItem(chat) {
  const active = state.current?.id === chat.id;
  const item = h(`<div class="chat-item ${active ? 'active' : ''}" data-id="${escapeHtml(chat.id)}" title=""></div>`);
  if (state.renamingId === chat.id) {
    const input = h('<input type="text" maxlength="120" />');
    input.value = chat.title;
    item.appendChild(input);
    const finish = async (save) => {
      if (state.renamingId !== chat.id) return;
      state.renamingId = null;
      const title = input.value.trim();
      if (save && title && title !== chat.title) {
        await api.renameChat(chat.id, title);
        if (state.current?.id === chat.id) {
          state.current.title = title;
          renderTitle();
        }
      }
      loadChats();
    };
    input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') finish(true);
      if (e.key === 'Escape') finish(false);
    });
    input.addEventListener('blur', () => finish(true));
    setTimeout(() => {
      input.focus();
      input.select();
    }, 0);
    return item;
  }
  const title = h('<span class="title"></span>');
  title.textContent = chat.title || 'New chat';
  item.title = chat.title || '';
  item.appendChild(title);
  if (chat.busy) item.appendChild(h('<span class="busy-dot" title="Replying…"></span>'));
  const more = h(`<button class="icon-btn small more" title="More">${icon('more', 16)}</button>`);
  item.appendChild(more);
  more.addEventListener('click', (e) => {
    e.stopPropagation();
    openChatMenu(more, chat);
  });
  item.addEventListener('click', () => openChat(chat.id));
  item.addEventListener('contextmenu', (e) => {
    e.preventDefault();
    openChatMenu(more, chat);
  });
  item.addEventListener('dblclick', () => startRename(chat.id));
  return item;
}

function startRename(id) {
  state.renamingId = id;
  renderChatList();
}

function openChatMenu(anchor, chat) {
  const menu = h(`
    <div class="popover">
      <button class="menu-item" data-a="rename">${icon('pencil', 16)}<span class="mi-main">Rename</span></button>
      <button class="menu-item" data-a="export">${icon('download', 16)}<span class="mi-main">Export as Markdown</span></button>
      <button class="menu-item danger" data-a="delete">${icon('trash', 16)}<span class="mi-main">Delete</span></button>
    </div>`);
  anchor.classList.add('open');
  openPopover(anchor, menu, {
    placement: 'below-start',
    onClose: () => anchor.classList.remove('open'),
  });
  menu.addEventListener('click', async (e) => {
    const a = e.target.closest('[data-a]')?.dataset.a;
    if (!a) return;
    closePopover();
    if (a === 'rename') startRename(chat.id);
    if (a === 'export') exportChat(chat.id);
    if (a === 'delete') {
      const deleted = await api.deleteChat(chat.id);
      if (deleted && state.current?.id === chat.id) newChat();
      loadChats();
    }
  });
}

// ---------------------------------------------------------------------------------------------
// Popovers

let activePopover = null;

function openPopover(anchor, el, { placement = 'above-end', onClose } = {}) {
  closePopover();
  document.body.appendChild(el);
  const r = anchor.getBoundingClientRect();
  const w = el.offsetWidth;
  const hgt = el.offsetHeight;
  const margin = 8;
  let top;
  let left;
  const spaceAbove = r.top;
  const wantAbove = placement.startsWith('above') ? spaceAbove > hgt + margin : false;
  if (wantAbove || (placement.startsWith('below') && window.innerHeight - r.bottom < hgt + margin && spaceAbove > hgt)) {
    top = r.top - hgt - 6;
  } else {
    top = r.bottom + 6;
  }
  left = placement.endsWith('end') ? r.right - w : r.left;
  left = Math.max(margin, Math.min(left, window.innerWidth - w - margin));
  top = Math.max(margin, Math.min(top, window.innerHeight - hgt - margin));
  el.style.top = `${top}px`;
  el.style.left = `${left}px`;

  const onDown = (e) => {
    if (!el.contains(e.target) && !anchor.contains(e.target)) closePopover();
  };
  const onKey = (e) => {
    if (e.key === 'Escape') {
      e.stopPropagation();
      closePopover();
    }
  };
  setTimeout(() => document.addEventListener('mousedown', onDown), 0);
  document.addEventListener('keydown', onKey, true);
  window.addEventListener('blur', closePopover, { once: true });
  activePopover = {
    el,
    close: () => {
      document.removeEventListener('mousedown', onDown);
      document.removeEventListener('keydown', onKey, true);
      el.remove();
      onClose?.();
    },
  };
}

function closePopover() {
  if (!activePopover) return;
  const p = activePopover;
  activePopover = null;
  p.close();
}

function openModelMenu(anchor) {
  const menu = h('<div class="popover model-menu" style="width: 320px"></div>');
  const item = (id, title, sub, { disabled = false, action = '' } = {}) => {
    const el = h(`
      <button class="menu-item ${id === state.composer.model ? 'checked' : ''} ${disabled ? 'disabled' : ''}">
        <span class="mi-main"><div class="mi-title"></div><div class="mi-sub"></div></span>
        <span class="check">${icon('check', 16)}</span>
      </button>`);
    if (id) el.dataset.model = id;
    if (action) el.dataset.a = action;
    el.querySelector('.mi-title').textContent = title;
    el.querySelector('.mi-sub').textContent = sub;
    if (!sub) el.querySelector('.mi-sub').remove();
    return el;
  };
  const render = () => {
    menu.innerHTML = '';
    // Models on this Mac
    menu.appendChild(h('<div class="menu-section">On this Mac · free and private</div>'));
    const s = state.local.status;
    if (s?.running) {
      for (const m of s.models) {
        const id = `local:${m.name}`;
        menu.appendChild(item(id, modelLabel(id), [m.parameterSize, gb(m.size)].filter(Boolean).join(' · ')));
      }
      if (!s.models.length) menu.appendChild(h('<div class="menu-hint">No models downloaded yet.</div>'));
    } else if (s && !s.installed) {
      menu.appendChild(item('', 'Get Ollama (free)', 'Runs AI models on your Mac', { action: 'get-ollama' }));
    } else {
      menu.appendChild(item('', s ? "Ollama isn't open" : 'Checking…', s ? 'Click to open it' : '', { action: 'start-ollama' }));
    }
    menu.appendChild(item('', 'Get more models…', '', { action: 'get-models' }));
    // Claude
    menu.appendChild(h('<div class="menu-sep"></div>'));
    menu.appendChild(h(`<div class="menu-section">Claude${state.hasKey ? '' : ' · needs an API key'}</div>`));
    for (const m of state.models) menu.appendChild(item(m.id, m.label, m.blurb, { disabled: !state.hasKey }));
    menu.appendChild(h('<div class="menu-sep"></div>'));
    menu.appendChild(h('<div class="menu-section">Thinking</div>'));
    const seg = h('<div class="segmented"></div>');
    for (const effort of ['low', 'medium', 'high']) {
      const b = h(`<button data-effort="${effort}" class="${state.composer.effort === effort ? 'on' : ''}"></button>`);
      b.textContent = EFFORT_LABELS[effort];
      seg.appendChild(b);
    }
    menu.appendChild(seg);
    const hint = h('<div class="menu-hint"></div>');
    hint.textContent = EFFORT_HINTS[state.composer.effort] || '';
    menu.appendChild(hint);
  };
  render();
  // Refresh what's on this Mac while the menu is open.
  api
    .localStatus()
    .then((s) => {
      state.local.status = s;
      if (menu.isConnected) render();
    })
    .catch(() => {});
  menu.addEventListener('click', async (e) => {
    const modelBtn = e.target.closest('[data-model]');
    const effortBtn = e.target.closest('[data-effort]');
    const action = e.target.closest('[data-a]')?.dataset.a;
    if (modelBtn) {
      const id = modelBtn.dataset.model;
      if (!isLocalModel(id) && !state.hasKey) {
        toast('Claude models need an API key.', '', { label: 'Add one', run: () => openSettings('key') });
        return;
      }
      setComposerOption({ model: id }, true);
      closePopover();
    } else if (effortBtn) {
      setComposerOption({ effort: effortBtn.dataset.effort }, true);
      render();
    } else if (action === 'get-ollama') {
      api.openExternal('https://ollama.com/download');
    } else if (action === 'start-ollama') {
      await wakeOllama({ quiet: false });
      if (menu.isConnected) render();
    } else if (action === 'get-models') {
      closePopover();
      openSettings('local');
    }
  });
  openPopover(anchor, menu, { placement: 'above-end' });
}

async function setComposerOption(patch, persist) {
  Object.assign(state.composer, patch);
  updateComposer();
  if (persist) {
    try {
      const saved = await api.saveSettings(patch);
      state.settings = saved.settings;
    } catch {
      // keep going; it's only a default
    }
  }
}

// ---------------------------------------------------------------------------------------------
// Opening chats

function newChat() {
  if (!$('.app')) return;
  closePreview();
  state.current = { id: uuid(), title: 'New chat', isNew: true, messages: [] };
  state.editingId = null;
  resetComposerOptions();
  renderConversation();
  renderChatList();
  focusComposer();
}

async function openChat(id) {
  if (state.current?.id === id && !state.current.isNew) {
    focusComposer();
    return;
  }
  const conv = await api.getChat(id);
  if (!conv) {
    toast('That chat could not be opened.', 'error');
    loadChats();
    return;
  }
  closePreview();
  state.current = { ...conv, isNew: false };
  state.editingId = null;
  if (state.models.some((m) => m.id === conv.model)) state.composer.model = conv.model;
  renderConversation();
  renderChatList();
  scrollToBottom(true);
  focusComposer();
}

function isBusy() {
  return Boolean(state.current?.messages.some((m) => m.role === 'assistant' && m.status === 'streaming'));
}

function renderTitle() {
  const title = state.current?.isNew ? 'New chat' : state.current?.title || 'New chat';
  const el = $('.topbar-title');
  if (el) el.textContent = title;
  document.title = state.current && !state.current.isNew ? `${title} – ${assistantName()}` : assistantName();
}

// ---------------------------------------------------------------------------------------------
// Rendering messages

const messageNodes = new Map(); // message id -> element

function renderConversation() {
  const main = $('.main');
  const thread = $('.thread');
  if (!main || !thread) return;
  const conv = state.current;
  const empty = !conv || conv.messages.length === 0;
  main.classList.toggle('empty', empty);
  updateGreeting();
  renderTitle();
  thread.innerHTML = '';
  messageNodes.clear();
  if (!conv) return;
  conv.messages.forEach((m) => {
    const node = buildMessage(m);
    messageNodes.set(m.id, node);
    thread.appendChild(node);
  });
  markLast();
  updateComposer();
}

function appendMessageNode(m) {
  const thread = $('.thread');
  const node = buildMessage(m);
  messageNodes.set(m.id, node);
  thread.appendChild(node);
  $('.main').classList.remove('empty');
  markLast();
}

function replaceMessageNode(m) {
  const old = messageNodes.get(m.id);
  const node = buildMessage(m);
  messageNodes.set(m.id, node);
  if (old && old.parentNode) old.replaceWith(node);
  else $('.thread')?.appendChild(node);
  markLast();
}

function markLast() {
  const msgs = state.current?.messages || [];
  const lastAssistant = [...msgs].reverse().find((m) => m.role === 'assistant');
  for (const [id, node] of messageNodes) node.classList.toggle('last', lastAssistant?.id === id && msgs[msgs.length - 1]?.id === id);
}

function buildMessage(m) {
  return m.role === 'user' ? buildUser(m) : buildAssistant(m);
}

function attachmentNode(att, { thumbClass = 'thumb' } = {}) {
  if (att.kind === 'image') {
    const img = h(`<img class="${thumbClass}" alt="" draggable="false" />`);
    img.src = `/att/${encodeURIComponent(att.id)}`;
    img.alt = att.name;
    img.title = att.name;
    img.addEventListener('click', () => openLightbox(img.src));
    return img;
  }
  const chip = h(`
    <div class="file-chip">
      <div class="file-icon ${att.kind === 'pdf' ? 'pdf' : ''}">${icon(att.kind === 'pdf' ? 'file' : 'fileText', 16)}</div>
      <div class="meta"><div class="fname"></div><div class="fsub"></div></div>
    </div>`);
  chip.querySelector('.fname').textContent = att.name;
  chip.querySelector('.fsub').textContent = `${att.kind === 'pdf' ? 'PDF' : 'Text'} · ${formatSize(att.size)}`;
  chip.title = att.name;
  return chip;
}

function openLightbox(src) {
  const box = h('<div class="lightbox"><img alt="" /></div>');
  box.querySelector('img').src = src;
  const close = () => {
    box.remove();
    document.removeEventListener('keydown', onKey, true);
  };
  const onKey = (e) => {
    if (e.key === 'Escape') {
      e.stopPropagation();
      close();
    }
  };
  box.addEventListener('click', close);
  document.addEventListener('keydown', onKey, true);
  document.body.appendChild(box);
}

function buildUser(m) {
  const node = h(`<div class="msg user" data-id="${escapeHtml(m.id)}"></div>`);
  if (m.attachments?.length) {
    const atts = h('<div class="user-atts"></div>');
    for (const att of m.attachments) atts.appendChild(attachmentNode(att));
    node.appendChild(atts);
  }
  if (state.editingId === m.id) {
    const box = h(`
      <div class="edit-box">
        <textarea rows="1"></textarea>
        <div class="row">
          <button class="btn ghost" data-a="cancel">Cancel</button>
          <button class="btn primary" data-a="save">Send</button>
        </div>
      </div>`);
    const ta = box.querySelector('textarea');
    ta.value = m.text;
    const grow = () => {
      ta.style.height = 'auto';
      ta.style.height = `${Math.min(ta.scrollHeight, 320)}px`;
      ta.style.overflowY = ta.scrollHeight > 320 ? 'auto' : 'hidden';
    };
    ta.addEventListener('input', grow);
    ta.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' && !e.shiftKey && !e.isComposing) {
        e.preventDefault();
        submitEdit(m, ta.value);
      }
      if (e.key === 'Escape') {
        e.stopPropagation();
        cancelEdit(m);
      }
    });
    box.querySelector('[data-a="cancel"]').addEventListener('click', () => cancelEdit(m));
    box.querySelector('[data-a="save"]').addEventListener('click', () => submitEdit(m, ta.value));
    node.appendChild(box);
    setTimeout(() => {
      grow();
      ta.focus();
      ta.setSelectionRange(ta.value.length, ta.value.length);
    }, 0);
    return node;
  }
  if (m.text) {
    const bubble = h('<div class="bubble"></div>');
    bubble.textContent = m.text;
    node.appendChild(bubble);
  }
  const actions = h(`
    <div class="msg-actions">
      <button class="icon-btn small" data-a="copy" title="Copy">${icon('copy', 15)}</button>
      <button class="icon-btn small" data-a="edit" title="Edit">${icon('pencil', 15)}</button>
    </div>`);
  actions.querySelector('[data-a="copy"]').addEventListener('click', () => copyText(m.text));
  actions.querySelector('[data-a="edit"]').addEventListener('click', () => {
    if (isBusy()) {
      toast('Wait for the reply to finish first.');
      return;
    }
    state.editingId = m.id;
    replaceMessageNode(m);
  });
  if (!m.text) actions.querySelector('[data-a="copy"]').remove();
  node.appendChild(actions);
  return node;
}

function cancelEdit(m) {
  state.editingId = null;
  replaceMessageNode(m);
}

// Group raw blocks into what you see: thinking/tool steps, text, and model switches.
function segmentize(blocks) {
  const segs = [];
  let text = null;
  blocks.forEach((b, i) => {
    if (!b) return;
    if (b.type === 'text') {
      if (!text) {
        text = { type: 'text', key: `t${i}`, parts: [] };
        segs.push(text);
      }
      text.parts.push(b);
      return;
    }
    if (b.type === 'thinking' || b.type === 'tool' || b.type === 'tool_result') {
      // Whitespace-only text between steps shouldn't split them.
      const last = segs[segs.length - 1];
      if (text && last === text && text.parts.every((p) => !p.text.trim())) segs.pop();
      text = null;
      const prev = segs[segs.length - 1];
      if (prev && prev.type === 'process') prev.items.push(b);
      else segs.push({ type: 'process', key: `p${i}`, items: [b] });
      return;
    }
    text = null;
    if (b.type === 'fallback') segs.push({ type: 'fallback', key: `f${i}`, block: b });
  });
  return segs;
}

function seconds(ms) {
  const s = Math.max(1, Math.round(ms / 1000));
  if (s < 60) return `${s}s`;
  return `${Math.floor(s / 60)}m ${s % 60}s`;
}

function processLabel(seg, active) {
  const items = seg.items;
  const resultsById = new Map(items.filter((b) => b.type === 'tool_result').map((b) => [b.toolUseId, b]));
  if (active) {
    const last = items[items.length - 1];
    if (last.type === 'tool' && !resultsById.has(last.id)) {
      if (last.name === 'web_search') return last.query ? `Searching “${last.query}”` : 'Searching the web';
      if (last.name === 'web_fetch') return last.url ? `Reading ${hostOf(last.url) || 'a page'}` : 'Reading a page';
      return 'Working';
    }
    if (last.type === 'tool_result') return 'Thinking';
    return 'Thinking';
  }
  const thinking = items.filter((b) => b.type === 'thinking');
  const ms = thinking.reduce((sum, b) => sum + (b.start && b.end ? b.end - b.start : 0), 0);
  const searches = items.filter((b) => b.type === 'tool' && b.name === 'web_search').length;
  const reads = items.filter((b) => b.type === 'tool' && b.name === 'web_fetch').length;
  const bits = [];
  if (thinking.length) bits.push(ms >= 1000 ? `Thought for ${seconds(ms)}` : 'Thought it over');
  if (searches) bits.push(searches === 1 ? 'searched the web' : `searched ${searches} times`);
  if (reads) bits.push(reads === 1 ? 'read a page' : `read ${reads} pages`);
  if (!bits.length) return 'Worked on it';
  const label = bits.join(', ');
  return label[0].toUpperCase() + label.slice(1);
}

const openProcesses = new Set(); // `${messageId}:${segKey}` the user expanded

function buildProcess(m, seg, active) {
  const id = `${m.id}:${seg.key}`;
  const node = h(`
    <div class="process ${openProcesses.has(id) ? 'open' : ''} ${active ? 'active' : ''}">
      <button class="process-head">${icon(active ? 'sparkle' : 'sparkle', 16)}<span class="label"></span>${icon('chevronRight', 14, 'chev')}</button>
      <div class="process-body"></div>
    </div>`);
  node.querySelector('.label').textContent = processLabel(seg, active);
  node.querySelector('.process-head').addEventListener('click', () => {
    if (openProcesses.has(id)) openProcesses.delete(id);
    else openProcesses.add(id);
    node.classList.toggle('open');
  });
  const body = node.querySelector('.process-body');
  const results = new Map(seg.items.filter((b) => b.type === 'tool_result').map((b) => [b.toolUseId, b]));
  for (const b of seg.items) {
    if (b.type === 'thinking') {
      const step = h('<div class="step"><div class="step-thinking"></div></div>');
      const t = step.querySelector('.step-thinking');
      if (b.text.trim()) t.textContent = b.text.trim();
      else {
        if (b.redacted) t.textContent = 'Some of this thinking is hidden for safety reasons.';
        else t.textContent = m.status === 'streaming' && !b.end ? 'Thinking…' : 'No notes for this step.';
        t.classList.add('empty');
      }
      body.appendChild(step);
    } else if (b.type === 'tool') {
      const res = results.get(b.id);
      const step = h(`<div class="step"><div class="step-title"></div></div>`);
      const title = step.querySelector('.step-title');
      if (b.name === 'web_search') {
        title.innerHTML = `${icon('search', 14)}<span></span>`;
        title.querySelector('span').textContent = b.query ? `Searched “${b.query}”` : 'Searched the web';
      } else if (b.name === 'web_fetch') {
        title.innerHTML = `${icon('read', 14)}<span></span>`;
        title.querySelector('span').textContent = b.url ? `Read ${hostOf(b.url) || b.url}` : 'Read a page';
      } else {
        title.innerHTML = `${icon('code', 14)}<span>Ran a quick check</span>`;
      }
      if (res?.error) {
        const err = h('<div class="step-error"></div>');
        err.textContent = res.error === 'max_uses_exceeded' ? 'Reached the search limit for this reply.' : `That didn’t work (${res.error}).`;
        step.appendChild(err);
      } else if (res?.results?.length) {
        const list = h('<div class="results"></div>');
        for (const r of res.results.slice(0, 10)) {
          const a = h('<a class="result" href="#"><span class="rtitle"></span><span class="rhost"></span></a>');
          a.querySelector('.rtitle').textContent = r.title || r.url;
          a.querySelector('.rhost').textContent = hostOf(r.url);
          a.title = r.url;
          a.addEventListener('click', (e) => {
            e.preventDefault();
            api.openExternal(r.url);
          });
          list.appendChild(a);
        }
        step.appendChild(list);
      }
      body.appendChild(step);
    }
  }
  return node;
}

function citationSources(seg) {
  // Number each distinct source once per message segment.
  const sources = [];
  const byUrl = new Map();
  let md = '';
  for (const part of seg.parts) {
    md += part.text;
    const ids = [];
    for (const c of part.citations || []) {
      const key = c.url || c.title;
      if (!key) continue;
      if (!byUrl.has(key)) {
        byUrl.set(key, sources.length);
        sources.push({ ...c, texts: [] });
      }
      const idx = byUrl.get(key);
      if (c.text) sources[idx].texts.push(c.text);
      if (!ids.includes(idx)) ids.push(idx);
    }
    if (ids.length) md += ids.map((i) => `⟦c${i}⟧`).join('');
  }
  return { md, sources };
}

function insertCitations(root, sources) {
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  const hits = [];
  while (walker.nextNode()) {
    if (walker.currentNode.nodeValue.includes('⟦c')) hits.push(walker.currentNode);
  }
  for (const node of hits) {
    const inCode = node.parentElement?.closest('code, pre');
    const parts = node.nodeValue.split(/(⟦c\d+⟧)/);
    const frag = document.createDocumentFragment();
    for (const p of parts) {
      const m = /^⟦c(\d+)⟧$/.exec(p);
      if (!m) {
        if (p) frag.appendChild(document.createTextNode(p));
        continue;
      }
      const src = sources[Number(m[1])];
      if (!src || inCode) continue;
      const chip = document.createElement('button');
      chip.className = 'cite';
      chip.type = 'button';
      chip.textContent = src.url ? hostOf(src.url) || 'source' : src.title || 'source';
      const quote = src.texts[0] ? `\n“${src.texts[0].slice(0, 220)}${src.texts[0].length > 220 ? '…' : ''}”` : '';
      chip.title = `${src.title || src.url}${quote}`;
      if (src.url) chip.addEventListener('click', () => api.openExternal(src.url));
      frag.appendChild(chip);
    }
    node.replaceWith(frag);
  }
}

function buildText(seg) {
  const { md, sources } = citationSources(seg);
  const node = h('<div class="md"></div>');
  node.innerHTML = renderMarkdown(md);
  if (sources.length) insertCitations(node, sources);
  typesetMath(node);
  return node;
}

function noticeNode(kind, title, detail, actions = []) {
  const node = h(`
    <div class="notice ${kind}">
      ${icon(kind === 'error' ? 'alert' : kind === 'warn' ? 'shield' : 'alert', 18)}
      <div><div class="ntitle"></div><div class="ndetail"></div><div class="nactions"></div></div>
    </div>`);
  node.querySelector('.ntitle').textContent = title;
  const d = node.querySelector('.ndetail');
  if (detail) d.textContent = detail;
  else d.remove();
  const acts = node.querySelector('.nactions');
  for (const a of actions) {
    const b = h(`<button class="btn"></button>`);
    b.textContent = a.label;
    b.addEventListener('click', a.run);
    acts.appendChild(b);
  }
  if (!actions.length) acts.remove();
  return node;
}

function assistantText(m) {
  return (m.blocks || [])
    .filter((b) => b && b.type === 'text')
    .map((b) => b.text)
    .join('')
    .trim();
}

function isLastMessage(m) {
  const msgs = state.current?.messages || [];
  return msgs[msgs.length - 1]?.id === m.id;
}

function buildAssistant(m) {
  const node = h(`<div class="msg assistant" data-id="${escapeHtml(m.id)}"></div>`);
  // One listener per message (fillAssistant re-draws the inside many times while streaming).
  node.addEventListener('click', onCodeCopy);
  fillAssistant(node, m);
  return node;
}

const expandedCode = new Set(); // `${messageId}:${cardIndex}` for code cards you opened

function fillAssistant(node, m) {
  node.innerHTML = '';
  const streaming = m.status === 'streaming';
  const head = h(`<div class="assistant-head ${streaming ? 'streaming' : ''}">${logo(22)}</div>`);
  node.appendChild(head);
  const reply = h('<div class="reply"></div>');
  node.appendChild(reply);

  const refused = m.status === 'refused';
  const segs = segmentize(m.blocks || []);
  const lastIdx = segs.length - 1;
  segs.forEach((seg, i) => {
    if (seg.type === 'process') {
      reply.appendChild(buildProcess(m, seg, streaming && i === lastIdx));
    } else if (seg.type === 'text') {
      if (refused) return; // a declined reply's partial text isn't shown
      reply.appendChild(buildText(seg));
    } else if (seg.type === 'fallback') {
      const n = h(`<div class="switch-note">${icon('swap', 14)}<span></span></div>`);
      n.querySelector('span').textContent = `${seg.block.to} took over to finish this reply`;
      reply.appendChild(n);
    }
  });

  if (streaming && (!segs.length || segs[lastIdx].type !== 'process')) {
    reply.appendChild(h('<div class="typing"><span></span><span></span><span></span></div>'));
  }

  if (m.status === 'error' && m.error) {
    const actions = [];
    if (m.error.action === 'settings') actions.push({ label: 'Open Settings', run: () => openSettings(isLocalModel(state.composer.model) ? 'local' : '') });
    if (m.error.action === 'start-ollama') {
      actions.push({
        label: 'Open Ollama',
        run: async () => {
          const s = await wakeOllama({ quiet: false });
          if (s?.running) toast('Ollama is running. Try again now.');
          else if (s?.installed) toast("Ollama didn't start. Open it from your Applications folder.", 'error');
          else toast('Ollama isn’t installed yet.', 'error', { label: 'Get Ollama', run: () => api.openExternal('https://ollama.com/download') });
        },
      });
    }
    if (isLastMessage(m)) actions.push({ label: 'Try again', run: () => regenerate() });
    reply.appendChild(noticeNode('error', m.error.title, m.error.detail, actions));
  }
  if (refused) {
    const cat = m.refusal?.category;
    const detail =
      'Claude’s safety checks flagged this request, so it stopped here.' +
      (cat ? ` (Reason: ${cat.replace(/_/g, ' ')})` : '') +
      ' You can rephrase your message or try a different model.';
    const actions = isLastMessage(m) ? [{ label: 'Try again', run: () => regenerate() }] : [];
    reply.appendChild(noticeNode('warn', 'Claude can’t help with this one', detail, actions));
  }
  if (m.status === 'stopped') reply.appendChild(h('<div class="muted-note">You stopped this reply.</div>'));
  if (m.notice) {
    const note = h('<div class="muted-note"></div>');
    note.textContent = m.notice;
    reply.appendChild(note);
  }
  if (m.status === 'done' && m.stopReason === 'max_tokens') {
    reply.appendChild(h('<div class="muted-note">This reply hit the length limit and was cut off.</div>'));
  }
  if (m.status === 'done' && m.stopReason === 'model_context_window_exceeded') {
    reply.appendChild(h('<div class="muted-note">This chat got too long. Start a new chat to keep going.</div>'));
  }

  if (!streaming) {
    const actions = h('<div class="msg-actions"></div>');
    const text = assistantText(m);
    if (text && !refused) {
      const copy = h(`<button class="icon-btn small" title="Copy">${icon('copy', 15)}</button>`);
      copy.addEventListener('click', () => copyText(text));
      actions.appendChild(copy);
    }
    if (isLastMessage(m)) {
      const retry = h(`<button class="icon-btn small" title="Retry">${icon('retry', 15)}</button>`);
      retry.addEventListener('click', () => regenerate());
      actions.appendChild(retry);
    }
    if (m.model) {
      const tag = h('<span class="model-tag"></span>');
      tag.textContent = m.model;
      const u = m.usage;
      if (u && (u.input || u.output)) {
        const n = (x) => Number(x || 0).toLocaleString();
        const searches = u.searches ? ` · ${u.searches} web search${u.searches === 1 ? '' : 'es'}` : '';
        tag.title = `Tokens: ${n(u.input + u.cacheRead + u.cacheWrite)} in (${n(u.cacheRead)} from cache) · ${n(u.output)} out${searches}`;
      }
      actions.appendChild(tag);
    }
    node.appendChild(actions);
  }

  // Code cards keep the open/closed state you gave them, even as the reply re-draws.
  const cards = [...reply.querySelectorAll('.codeblock.artifact')];
  cards.forEach((card, i) => {
    if (!expandedCode.has(`${m.id}:${i}`)) return;
    card.classList.remove('collapsed');
    card.querySelector('[data-action="toggle-code"]').textContent = 'Hide code';
  });
  const lastCard = cards[cards.length - 1];
  const texts = reply.querySelectorAll('.md');
  if (streaming && lastCard && !lastCard.nextElementSibling && lastCard.parentElement === texts[texts.length - 1]) {
    lastCard.classList.add('writing');
  }
}

function onCodeCopy(e) {
  const btn = e.target.closest('[data-action="copy-code"], [data-action="preview-code"], [data-action="toggle-code"]');
  if (!btn) return;
  const block = btn.closest('.codeblock');
  const code = block?.querySelector('code');
  if (!code) return;
  if (btn.dataset.action === 'preview-code') {
    openPreview(code.textContent, block.dataset.lang || '');
    return;
  }
  if (btn.dataset.action === 'toggle-code') {
    const collapsed = block.classList.toggle('collapsed');
    btn.textContent = collapsed ? 'Show code' : 'Hide code';
    const msg = block.closest('.msg');
    const key = `${msg?.dataset.id}:${[...msg.querySelectorAll('.codeblock.artifact')].indexOf(block)}`;
    if (collapsed) expandedCode.delete(key);
    else expandedCode.add(key);
    return;
  }
  api.copy(code.textContent);
  btn.textContent = 'Copied';
  setTimeout(() => {
    btn.textContent = 'Copy';
  }, 1400);
}

// ---------------------------------------------------------------------------------------------
// Live previews of code Claude writes. They run in a locked-down frame on their own origin:
// scripts work, but the page can't reach the app, your chats or your files.

const MERMAID_URL = 'https://cdn.jsdelivr.net/npm/mermaid@11.17.2/dist/mermaid.esm.min.mjs';

function previewDocument(code, kind) {
  const head = '<meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">';
  if (kind === 'html') {
    if (/<html[\s>]|<!doctype/i.test(code)) return code;
    return `<!doctype html><html><head>${head}</head><body>${code}</body></html>`;
  }
  if (kind === 'svg') {
    return (
      `<!doctype html><html><head>${head}<style>html,body{margin:0;height:100%;background:#fff}` +
      'body{display:flex;align-items:center;justify-content:center}svg{max-width:100%;max-height:100vh;height:auto}</style>' +
      `</head><body>${code}</body></html>`
    );
  }
  // Mermaid diagrams are drawn by the Mermaid library, loaded from the web.
  return (
    `<!doctype html><html><head>${head}<style>body{margin:0;padding:24px;font-family:-apple-system,BlinkMacSystemFont,sans-serif;background:#fff;color:#222}` +
    '.note{color:#888;font-size:13px;margin-top:16px}</style></head><body>' +
    `<pre class="mermaid">${escapeHtml(code)}</pre>` +
    '<p class="note" id="note">Drawing the diagram… (this needs an internet connection)</p>' +
    `<script type="module">import mermaid from '${MERMAID_URL}';` +
    "mermaid.initialize({ startOnLoad: false, securityLevel: 'strict' });" +
    "await mermaid.run({ querySelector: '.mermaid' }).then(() => document.getElementById('note').remove())" +
    ".catch((e) => { document.getElementById('note').textContent = 'Could not draw this diagram: ' + e.message; });" +
    '</script></body></html>'
  );
}

async function openPreview(code, lang) {
  const kind = previewKind(lang, code);
  if (!kind) return;
  const html = previewDocument(code, kind);
  let url;
  try {
    url = await api.createPreview(html);
  } catch (err) {
    toast(errorText(err), 'error');
    return;
  }
  state.preview = { code, kind, html, title: previewTitle(code, kind) };
  const panel = $('.preview-panel');
  if (!panel) return;
  panel.hidden = false;
  $('.app').classList.add('preview-open');
  $('.preview-title', panel).textContent = state.preview.title;
  const body = $('.preview-body', panel);
  body.innerHTML = '';
  const frame = document.createElement('iframe');
  // No "allow-same-origin": the page gets a sealed-off origin of its own.
  frame.setAttribute('sandbox', 'allow-scripts allow-forms allow-modals allow-pointer-lock allow-popups');
  frame.setAttribute('referrerpolicy', 'no-referrer');
  frame.title = state.preview.title;
  frame.src = url;
  body.appendChild(frame);
}

function closePreview() {
  const panel = $('.preview-panel');
  if (!panel || panel.hidden) return false;
  panel.hidden = true;
  $('.preview-body', panel).innerHTML = '';
  $('.app')?.classList.remove('preview-open');
  state.preview = null;
  return true;
}

function wirePreviewPanel() {
  const panel = $('.preview-panel');
  try {
    const saved = Number(localStorage.getItem('previewWidth'));
    if (saved >= 320) panel.style.width = `${saved}px`;
  } catch {
    // no saved width; use the default
  }
  panel.addEventListener('click', async (e) => {
    const a = e.target.closest('[data-pv]')?.dataset.pv;
    if (!a || !state.preview) return;
    if (a === 'close') closePreview();
    if (a === 'copy') copyText(state.preview.code, 'Code copied');
    if (a === 'browser') {
      try {
        await api.openPreviewInBrowser(state.preview.html, state.preview.title);
        toast('Opened in your browser');
      } catch (err) {
        toast(errorText(err), 'error');
      }
    }
  });
  // Drag the left edge to make the preview wider or narrower.
  const resizer = $('.preview-resizer', panel);
  resizer.addEventListener('mousedown', (e) => {
    e.preventDefault();
    const app = $('.app');
    app.classList.add('resizing');
    const move = (ev) => {
      const width = Math.min(Math.max(window.innerWidth - ev.clientX, 320), window.innerWidth - 420);
      panel.style.width = `${width}px`;
    };
    const up = () => {
      app.classList.remove('resizing');
      document.removeEventListener('mousemove', move);
      document.removeEventListener('mouseup', up);
      try {
        localStorage.setItem('previewWidth', String(parseInt(panel.style.width, 10) || ''));
      } catch {
        // fine, it just won't be remembered
      }
    };
    document.addEventListener('mousemove', move);
    document.addEventListener('mouseup', up);
  });
}

// ---------------------------------------------------------------------------------------------
// Export

async function exportChat(id) {
  if (!id) return;
  try {
    const file = await api.exportChat(id);
    if (!file) return;
    const name = file.split(/[\\/]/).pop();
    toast(`Saved “${name}”`, '', { label: 'Show in Finder', run: () => api.reveal(file) });
  } catch (err) {
    toast(errorText(err), 'error');
  }
}

// Repaint a streaming reply at most once per frame.
const pendingPaint = new Set();
let paintScheduled = false;

function schedulePaint(messageId) {
  pendingPaint.add(messageId);
  if (paintScheduled) return;
  paintScheduled = true;
  requestAnimationFrame(() => {
    paintScheduled = false;
    const stick = isNearBottom();
    for (const id of pendingPaint) {
      const m = state.current?.messages.find((x) => x.id === id);
      const node = messageNodes.get(id);
      if (m && node) fillAssistant(node, m);
    }
    pendingPaint.clear();
    if (stick) scrollToBottom();
    updateToBottom();
  });
}

// ---------------------------------------------------------------------------------------------
// Events from the main process

function findMessage(convId, messageId) {
  if (!state.current || state.current.id !== convId) return null;
  return state.current.messages.find((m) => m.id === messageId) || null;
}

function onEvent(ev) {
  switch (ev.type) {
    case 'start':
    case 'meta': {
      const m = findMessage(ev.convId, ev.messageId);
      if (m && ev.model) {
        m.model = ev.model;
      }
      break;
    }
    case 'block': {
      const m = findMessage(ev.convId, ev.messageId);
      if (!m || m.status !== 'streaming') break;
      m.blocks[ev.index] = ev.block;
      schedulePaint(m.id);
      break;
    }
    case 'done': {
      const listed = state.chats.find((c) => c.id === ev.convId);
      if (listed?.busy) {
        listed.busy = false;
        renderChatList();
      }
      const m = findMessage(ev.convId, ev.messageId);
      if (m) {
        Object.assign(m, ev.message);
        const stick = isNearBottom();
        replaceMessageNode(m);
        renderOtherAssistantActions();
        if (stick) scrollToBottom();
        updateComposer();
        // Like Claude's artifacts: when a reply finishes with a web page, picture or diagram,
        // show it right away.
        if (m.status === 'done') {
          const cards = messageNodes.get(m.id)?.querySelectorAll('.codeblock.artifact') || [];
          const card = cards[cards.length - 1];
          if (card) openPreview(card.querySelector('code').textContent, card.dataset.lang || '');
        }
      }
      reloadChats();
      break;
    }
    case 'title':
      if (state.current?.id === ev.convId) {
        state.current.title = ev.title;
        renderTitle();
      }
      reloadChats();
      break;
    case 'pull-progress':
      updatePullProgress(ev);
      break;
    case 'list-changed':
      reloadChats();
      break;
    default:
      break;
  }
}

// When a newer reply arrives, older replies lose their Retry button.
function renderOtherAssistantActions() {
  const msgs = state.current?.messages || [];
  for (const m of msgs) {
    if (m.role !== 'assistant' || m.status === 'streaming') continue;
    const node = messageNodes.get(m.id);
    if (node) fillAssistant(node, m);
  }
  markLast();
}

// ---------------------------------------------------------------------------------------------
// Sending

function composerInput() {
  return $('.composer textarea');
}

function focusComposer() {
  const ta = composerInput();
  if (ta && !document.querySelector('.overlay')) ta.focus();
}

function autosize() {
  const ta = composerInput();
  if (!ta) return;
  const max = window.innerHeight * 0.4;
  ta.style.height = 'auto';
  ta.style.height = `${Math.min(ta.scrollHeight, max)}px`;
  // Only show a scrollbar once the text is taller than the box can grow.
  ta.style.overflowY = ta.scrollHeight > max ? 'auto' : 'hidden';
}

function updateComposer() {
  if (!$('.composer')) return;
  const busy = isBusy();
  const send = $('.send-btn');
  const text = composerInput().value.trim();
  const pending = state.drafts.some((d) => d.pending);
  const ready = state.drafts.some((d) => d.meta);
  send.classList.toggle('stop', busy);
  send.innerHTML = busy ? icon('stop', 18) : icon('arrowUp', 18);
  send.title = busy ? 'Stop (Esc)' : 'Send (Enter)';
  send.disabled = !busy && (pending || (!text && !ready));
  const local = isLocalModel(state.composer.model);
  // Models on this Mac can't search the web, so the button goes away for them.
  $('.web-btn').hidden = local;
  $('.web-btn').classList.toggle('on', state.composer.webSearch);
  $('.web-btn').title = state.composer.webSearch ? 'Web search is on' : 'Web search is off';
  const effort = EFFORT_LABELS[state.composer.effort];
  $('.model-name').textContent = `${modelLabel(state.composer.model)}${state.composer.effort !== 'medium' ? ` · ${effort}` : ''}`;
  $('.footnote').textContent = local
    ? `${assistantName()} is running ${modelLabel(state.composer.model)} privately on your Mac. It can make mistakes, so double-check anything important.`
    : `${assistantName()} runs on Claude and can make mistakes. Double-check anything important.`;
}

function wireComposer() {
  const ta = composerInput();
  requestAnimationFrame(autosize);
  window.addEventListener('resize', debounce(autosize, 100));
  ta.addEventListener('input', () => {
    autosize();
    updateComposer();
  });
  ta.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && !e.shiftKey && !e.isComposing) {
      e.preventDefault();
      if (!isBusy()) sendMessage();
    }
  });
  ta.addEventListener('paste', (e) => {
    const files = [...(e.clipboardData?.files || [])];
    if (files.length) {
      e.preventDefault();
      addFiles(files);
    }
  });
  const fileInput = $('.file-input');
  fileInput.addEventListener('change', () => {
    addFiles([...fileInput.files]);
    fileInput.value = '';
  });
}

async function addFiles(files) {
  if (!files.length) return;
  const room = MAX_ATTACHMENTS - state.drafts.length;
  if (room <= 0) {
    toast(`You can add up to ${MAX_ATTACHMENTS} files to one message.`, 'error');
    return;
  }
  for (const file of files.slice(0, room)) {
    if (file.size > 32 * 1024 * 1024) {
      toast(`${file.name} is too big. Files need to be under 30 MB.`, 'error');
      continue;
    }
    const draft = { tempId: uuid(), pending: true, name: file.name, kind: file.type.startsWith('image/') ? 'image' : 'file' };
    if (draft.kind === 'image') draft.previewUrl = URL.createObjectURL(file);
    state.drafts.push(draft);
    renderDrafts();
    try {
      const data = new Uint8Array(await file.arrayBuffer());
      const result = await api.addAttachment({ name: file.name, mediaType: file.type, data });
      if (!state.drafts.includes(draft)) {
        if (result.ok) api.removeAttachment(result.attachment.id);
        continue;
      }
      if (!result.ok) {
        removeDraft(draft, false);
        toast(result.error, 'error');
        continue;
      }
      draft.pending = false;
      draft.meta = result.attachment;
      if (draft.meta.kind === 'pdf' && isLocalModel(state.composer.model)) {
        toast('Only Claude models can read PDFs. The model on your Mac will just be told one is attached.');
      }
    } catch (err) {
      removeDraft(draft, false);
      toast(errorText(err), 'error');
    }
    renderDrafts();
  }
  if (files.length > room) toast(`Only the first ${room} files were added.`);
}

function removeDraft(draft, tellMain = true) {
  state.drafts = state.drafts.filter((d) => d !== draft);
  if (draft.previewUrl) URL.revokeObjectURL(draft.previewUrl);
  if (tellMain && draft.meta) api.removeAttachment(draft.meta.id);
  renderDrafts();
}

function renderDrafts() {
  const box = $('.drafts');
  if (!box) return;
  box.innerHTML = '';
  for (const d of state.drafts) {
    const wrap = h(`<div class="draft ${d.pending ? 'pending' : ''}"></div>`);
    if (d.kind === 'image' && d.previewUrl) {
      const img = h('<img class="thumb" alt="" />');
      img.src = d.previewUrl;
      img.title = d.name;
      wrap.appendChild(img);
    } else {
      const meta = d.meta || { name: d.name, kind: /\.pdf$/i.test(d.name) ? 'pdf' : 'text', size: 0 };
      const chip = attachmentNode(meta);
      if (d.pending) chip.querySelector('.fsub').textContent = 'Adding…';
      wrap.appendChild(chip);
    }
    const rm = h(`<button class="remove" title="Remove">${icon('x', 12)}</button>`);
    rm.addEventListener('click', () => removeDraft(d));
    wrap.appendChild(rm);
    box.appendChild(wrap);
  }
  updateComposer();
}

async function sendMessage() {
  const ta = composerInput();
  const text = ta.value.trim();
  const drafts = state.drafts.filter((d) => d.meta);
  if (state.drafts.some((d) => d.pending)) return;
  if (!text && !drafts.length) return;
  if (isBusy()) return;

  const conv = state.current;
  const userMsg = {
    id: uuid(),
    role: 'user',
    text,
    attachments: drafts.map((d) => d.meta),
    createdAt: Date.now(),
  };
  const reply = newReplyPlaceholder();
  const wasNew = conv.isNew;

  conv.messages.push(userMsg, reply);
  for (const d of state.drafts) if (d.previewUrl) URL.revokeObjectURL(d.previewUrl);
  state.drafts = [];
  ta.value = '';
  autosize();
  renderDrafts();
  if (wasNew) {
    renderConversation();
  } else {
    appendMessageNode(userMsg);
    appendMessageNode(reply);
    renderOtherAssistantActions();
  }
  scrollToBottom(true);
  updateComposer();

  try {
    const res = await api.send({
      convId: conv.id,
      messageId: userMsg.id,
      assistantId: reply.id,
      text,
      attachmentIds: userMsg.attachments.map((a) => a.id),
      ...state.composer,
    });
    if (state.current === conv) {
      conv.isNew = false;
      if (wasNew) conv.title = res.title;
      renderTitle();
    }
    loadChats();
  } catch (err) {
    failReply(conv, reply, err);
  }
}

function newReplyPlaceholder() {
  return {
    id: uuid(),
    role: 'assistant',
    status: 'streaming',
    model: modelLabel(state.composer.model),
    blocks: [],
    createdAt: Date.now(),
  };
}

function failReply(conv, reply, err) {
  reply.status = 'error';
  reply.error = { title: 'Message not sent', detail: errorText(err), action: '' };
  if (state.current === conv) {
    replaceMessageNode(reply);
    updateComposer();
  }
}

async function regenerate() {
  const conv = state.current;
  if (!conv || conv.isNew || isBusy()) return;
  while (conv.messages.length && conv.messages[conv.messages.length - 1].role === 'assistant') {
    const m = conv.messages.pop();
    messageNodes.get(m.id)?.remove();
    messageNodes.delete(m.id);
  }
  const reply = newReplyPlaceholder();
  conv.messages.push(reply);
  appendMessageNode(reply);
  scrollToBottom(true);
  updateComposer();
  try {
    await api.regenerate({ convId: conv.id, assistantId: reply.id, ...state.composer });
  } catch (err) {
    failReply(conv, reply, err);
  }
}

async function submitEdit(m, value) {
  const text = value.trim();
  const conv = state.current;
  if (!conv || isBusy()) return;
  if (!text && !m.attachments?.length) return;
  state.editingId = null;
  const index = conv.messages.findIndex((x) => x.id === m.id);
  conv.messages.splice(index + 1);
  m.text = text;
  const reply = newReplyPlaceholder();
  conv.messages.push(reply);
  renderConversation();
  scrollToBottom(true);
  try {
    await api.edit({ convId: conv.id, messageId: m.id, text, assistantId: reply.id, ...state.composer });
  } catch (err) {
    failReply(conv, reply, err);
  }
}

function stopReply() {
  if (state.current) api.stop(state.current.id);
}

// ---------------------------------------------------------------------------------------------
// Scrolling

function scroller() {
  return $('.scroller');
}

function isNearBottom() {
  const s = scroller();
  if (!s) return true;
  return s.scrollHeight - s.scrollTop - s.clientHeight < 60;
}

function scrollToBottom(force = false) {
  const s = scroller();
  if (!s) return;
  if (force || isNearBottom()) s.scrollTop = s.scrollHeight;
  if (force) requestAnimationFrame(() => (s.scrollTop = s.scrollHeight));
}

function updateToBottom() {
  const btn = $('.to-bottom');
  if (!btn) return;
  const empty = $('.main')?.classList.contains('empty');
  btn.classList.toggle('show', !empty && !isNearBottom());
}

function wireScroller() {
  const s = scroller();
  s.addEventListener('scroll', updateToBottom, { passive: true });
  $('.to-bottom').addEventListener('click', () => {
    s.scrollTo({ top: s.scrollHeight, behavior: 'smooth' });
  });
}

// ---------------------------------------------------------------------------------------------
// Keyboard + drag and drop

function wireGlobalKeys() {
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
      if (activePopover) return;
      const overlay = document.querySelector('.overlay');
      if (overlay) {
        overlay.dispatchEvent(new CustomEvent('close'));
        return;
      }
      if (isBusy()) stopReply();
      else closePreview();
    }
  });
  window.addEventListener('focus', updateGreeting);
}

function wireDragAndDrop() {
  let depth = 0;
  const hasFiles = (e) => [...(e.dataTransfer?.types || [])].includes('Files');
  window.addEventListener('dragenter', (e) => {
    if (!hasFiles(e) || !state.hasKey) return;
    e.preventDefault();
    depth++;
    $('.drop-overlay')?.classList.add('show');
  });
  window.addEventListener('dragover', (e) => {
    if (hasFiles(e)) e.preventDefault();
  });
  window.addEventListener('dragleave', (e) => {
    if (!hasFiles(e)) return;
    depth = Math.max(0, depth - 1);
    if (!depth) $('.drop-overlay')?.classList.remove('show');
  });
  window.addEventListener('drop', (e) => {
    if (!hasFiles(e)) return;
    e.preventDefault();
    depth = 0;
    $('.drop-overlay')?.classList.remove('show');
    if (state.hasKey && $('.composer')) addFiles([...e.dataTransfer.files]);
  });
}

// ---------------------------------------------------------------------------------------------
// Settings

function openSettings(section = '') {
  if (!$('.app') || document.querySelector('.overlay')) return;
  closePopover();
  const s = state.settings;
  const overlay = h(`
    <div class="overlay">
      <div class="modal" role="dialog" aria-label="Settings">
        <div class="modal-head"><h2>Settings</h2><button class="icon-btn" data-a="close" title="Close">${icon('x')}</button></div>
        <div class="modal-body">
          <div class="section">
            <h3>About you</h3>
            <p class="hint">This helps your assistant give you more personal answers. Changes apply to new chats.</p>
            <div class="row" style="gap:14px">
              <div class="field" style="flex:1"><label for="s-name">Your name</label><input class="input" id="s-name" maxlength="80" /></div>
              <div class="field" style="flex:1"><label for="s-aname">Assistant’s name</label><input class="input" id="s-aname" maxlength="40" placeholder="Buddy" /></div>
            </div>
            <div class="field">
              <label for="s-about">What should it know about you?</label>
              <textarea class="textarea" id="s-about" placeholder="For example: I’m a nurse in Seattle, I’m learning Python, and I like short, practical answers."></textarea>
            </div>
            <div class="field">
              <label for="s-style">How should it reply?</label>
              <textarea class="textarea" id="s-style" placeholder="For example: Talk like a friend. Keep it simple. Skip the fluff."></textarea>
            </div>
          </div>

          <div class="section" id="s-local">
            <h3>Models on this Mac</h3>
            <p class="hint">Free and private: these run on your Mac through Ollama, and need no internet once downloaded. They’re not as smart as Claude.</p>
            <div class="local-box" id="s-ollama"></div>
            <div class="installed-list" id="s-installed"></div>
            <div class="field" id="s-pull-field">
              <label for="s-pull-pick">Download a model</label>
              <div class="row"><select class="select" id="s-pull-pick"></select><button class="btn" data-a="pull">Download</button></div>
              <input class="input" id="s-pull-name" placeholder="A name from ollama.com/library, like llama3.2:3b" autocomplete="off" spellcheck="false" hidden style="margin-top:8px" />
              <div id="s-pull-progress"></div>
              <div class="form-msg" id="s-pull-msg"></div>
              <div class="sub">Browse more at <a href="#" data-a="library">ollama.com/library</a>. Bigger models are smarter but need more memory.</div>
            </div>
          </div>

          <div class="section" id="s-key">
            <h3>Claude API key</h3>
            <p class="hint">To use Claude, Buddy needs your own Anthropic API key. It’s stored in your Mac’s Keychain.</p>
            <div class="row between wrap">
              <div class="key-status"><span class="dot"></span><span class="key-text"></span></div>
              <div class="row"><button class="btn" data-a="change-key">Change key</button><button class="btn ghost danger" data-a="remove-key">Remove</button></div>
            </div>
            <div class="key-edit" hidden style="margin-top:12px">
              <div class="row"><input class="input" id="s-key" type="password" placeholder="sk-ant-..." autocomplete="off" spellcheck="false" /><button class="btn primary" data-a="save-key">Save</button></div>
              <div class="form-msg" id="s-key-msg"></div>
            </div>
            <div class="sub" style="font-size:12.5px;color:var(--text-3);margin:10px 0 8px">Get or manage keys at <a href="#" data-a="console">platform.claude.com</a>.</div>
          </div>

          <div class="section">
            <h3>Defaults for new chats</h3>
            <div class="row" style="gap:14px">
              <div class="field" style="flex:1"><label for="s-model">Model</label><select class="select" id="s-model"></select></div>
              <div class="field" style="flex:1"><label for="s-effort">Thinking</label>
                <select class="select" id="s-effort">
                  <option value="low">Quick</option><option value="medium">Balanced</option><option value="high">Deep</option>
                </select>
              </div>
            </div>
            <div class="row between field">
              <div><label style="margin:0">Search the web</label><div class="sub" style="margin-top:2px">Lets Claude look things up. Searches cost about a cent each.</div></div>
              <button class="toggle" id="s-web" role="switch"></button>
            </div>
          </div>

          <div class="section">
            <h3>Appearance</h3>
            <div class="field"><label>Theme</label>
              <div class="segmented" id="s-theme" style="margin:0;max-width:330px">
                <button data-v="system">System</button><button data-v="light">Light</button><button data-v="dark">Dark</button>
              </div>
            </div>
            <div class="field"><label>Reply font</label>
              <div class="segmented" id="s-font" style="margin:0;max-width:220px">
                <button data-v="sans">Sans</button><button data-v="serif">Serif</button>
              </div>
            </div>
          </div>

          <div class="section">
            <h3>Quick open</h3>
            <p class="hint">Press this from any app to show or hide Buddy.</p>
            <div class="field" style="max-width:330px">
              <select class="select" id="s-shortcut"></select>
              <div class="form-msg warn" id="s-shortcut-msg"></div>
            </div>
          </div>

          <div class="section">
            <h3>Your data</h3>
            <p class="hint">Chats and files are saved only on this Mac. Messages are sent to Anthropic to get replies.</p>
            <div class="row wrap"><button class="btn" data-a="reveal">Show data folder</button><button class="btn danger" data-a="delete-all">Delete all chats</button></div>
            <div class="sub" style="font-size:12.5px;color:var(--text-3);margin:14px 0 4px" id="s-version"></div>
          </div>
        </div>
      </div>
    </div>`);
  document.body.appendChild(overlay);

  const close = () => {
    overlay.remove();
    renderProfile();
    updateComposer();
    focusComposer();
  };
  overlay.addEventListener('close', close);
  overlay.addEventListener('mousedown', (e) => {
    if (e.target === overlay) close();
  });

  const save = async (patch) => {
    try {
      const res = await api.saveSettings(patch);
      state.settings = res.settings;
      state.shortcutOk = res.shortcutOk;
      return res;
    } catch (err) {
      toast(errorText(err), 'error');
      return null;
    }
  };

  // text fields
  const bindText = (sel, key) => {
    const el = $(sel, overlay);
    el.value = s[key] || '';
    const commit = debounce(() => save({ [key]: el.value.trim() }).then(() => renderProfile()), 400);
    el.addEventListener('input', commit);
  };
  bindText('#s-name', 'name');
  bindText('#s-aname', 'assistantName');
  bindText('#s-about', 'about');
  bindText('#s-style', 'style');

  // API key
  const keyText = $('.key-text', overlay);
  const dot = $('.key-status .dot', overlay);
  const renderKey = () => {
    dot.classList.toggle('off', !state.hasKey);
    keyText.textContent = state.hasKey ? `Connected${state.keyHint ? ` · key ending in ${state.keyHint}` : ''}` : 'No key saved';
    $('[data-a="change-key"]', overlay).textContent = state.hasKey ? 'Change key' : 'Add a key';
    $('[data-a="remove-key"]', overlay).hidden = !state.hasKey;
  };
  renderKey();
  const keyEdit = $('.key-edit', overlay);
  const keyMsg = $('#s-key-msg', overlay);
  overlay.addEventListener('click', async (e) => {
    const a = e.target.closest('[data-a]')?.dataset.a;
    if (!a) return;
    if (a === 'close') close();
    if (a === 'console') {
      e.preventDefault();
      api.openExternal('https://platform.claude.com/settings/keys');
    }
    if (a === 'change-key') {
      keyEdit.hidden = false;
      $('#s-key', overlay).focus();
    }
    if (a === 'save-key') {
      const input = $('#s-key', overlay);
      keyMsg.className = 'form-msg';
      keyMsg.textContent = 'Checking…';
      const res = await api.setApiKey(input.value).catch((err) => ({ ok: false, error: errorText(err) }));
      if (!res.ok) {
        keyMsg.classList.add('error');
        keyMsg.textContent = res.error;
        return;
      }
      state.hasKey = true;
      state.keyHint = res.keyHint || '';
      input.value = '';
      keyEdit.hidden = true;
      keyMsg.textContent = '';
      renderKey();
      fillModelSelect();
      toast(res.warning || 'API key saved');
    }
    if (a === 'remove-key') {
      const res = await api.clearApiKey();
      state.hasKey = res.hasKey;
      state.keyHint = res.keyHint || '';
      overlay.remove();
      if (!canChat()) renderOnboarding();
      else if (!state.hasKey && !isLocalModel(state.composer.model)) {
        resetComposerOptions();
        updateComposer();
      }
    }
    if (a === 'library') {
      e.preventDefault();
      api.openExternal('https://ollama.com/library');
    }
    if (a === 'get-ollama') api.openExternal('https://ollama.com/download');
    if (a === 'start-ollama') {
      await wakeOllama({ quiet: false });
      if (overlay.isConnected) paintLocal();
    }
    if (a === 'pull') {
      const name = (pullPick.value || pullName.value).trim();
      pullMsg.className = 'form-msg';
      pullMsg.textContent = '';
      if (!name) {
        pullMsg.textContent = 'Type the name of a model first.';
        pullMsg.classList.add('error');
        return;
      }
      const btn = e.target.closest('[data-a="pull"]');
      btn.disabled = true;
      const progressBox = $('#s-pull-progress', overlay);
      progressBox.innerHTML = '';
      progressBox.appendChild(pullProgressNode(name));
      const result = await api.localPull(name).catch((err) => ({ ok: false, error: errorText(err) }));
      btn.disabled = false;
      progressBox.innerHTML = '';
      if (result.ok) {
        toast(`${modelLabel(`local:${name}`)} is ready`);
        await refreshLocal();
      } else {
        pullMsg.textContent = result.cancelled ? 'Download stopped.' : result.error;
        if (!result.cancelled) pullMsg.classList.add('error');
      }
    }
    if (a === 'reveal') api.revealData();
    if (a === 'delete-all') {
      const done = await api.deleteAllChats();
      if (done) {
        toast('All chats deleted');
        newChat();
        loadChats();
      }
    }
  });
  $('#s-key', overlay).addEventListener('keydown', (e) => {
    if (e.key === 'Enter') overlay.querySelector('[data-a="save-key"]').click();
  });

  // defaults
  const modelSel = $('#s-model', overlay);
  // Both kinds of model can be the default: ones on this Mac, and Claude.
  const fillModelSelect = () => {
    modelSel.innerHTML = '';
    const localGroup = document.createElement('optgroup');
    localGroup.label = 'On this Mac';
    for (const m of state.local.status?.models || []) {
      const o = document.createElement('option');
      o.value = `local:${m.name}`;
      o.textContent = modelLabel(o.value);
      localGroup.appendChild(o);
    }
    if (isLocalModel(state.settings.model) && ![...localGroup.children].some((o) => o.value === state.settings.model)) {
      const o = document.createElement('option');
      o.value = state.settings.model;
      o.textContent = modelLabel(o.value);
      localGroup.appendChild(o);
    }
    if (localGroup.children.length) modelSel.appendChild(localGroup);
    const claudeGroup = document.createElement('optgroup');
    claudeGroup.label = state.hasKey ? 'Claude' : 'Claude (needs an API key)';
    for (const m of state.models) {
      const o = document.createElement('option');
      o.value = m.id;
      o.textContent = m.label;
      o.disabled = !state.hasKey;
      claudeGroup.appendChild(o);
    }
    modelSel.appendChild(claudeGroup);
    modelSel.value = state.settings.model;
  };
  fillModelSelect();
  modelSel.addEventListener('change', () => save({ model: modelSel.value }));

  // Models on this Mac
  const ollamaBox = $('#s-ollama', overlay);
  const installedBox = $('#s-installed', overlay);
  const pullPick = $('#s-pull-pick', overlay);
  const pullName = $('#s-pull-name', overlay);
  const pullMsg = $('#s-pull-msg', overlay);
  const rec = state.info.local;
  for (const m of rec.models) {
    const o = document.createElement('option');
    o.value = m.name;
    o.textContent = `${m.label} · about ${m.sizeGB} GB${m.name === rec.pick ? ' · best for your Mac' : ''}`;
    pullPick.appendChild(o);
  }
  const other = document.createElement('option');
  other.value = '';
  other.textContent = 'Another model (type its name)…';
  pullPick.appendChild(other);
  pullPick.value = rec.pick;
  pullPick.addEventListener('change', () => {
    pullName.hidden = pullPick.value !== '';
    if (!pullName.hidden) pullName.focus();
  });
  const paintLocal = () => {
    const ls = state.local.status;
    if (!ls) {
      ollamaBox.innerHTML = `<div class="lb-row">${icon('sparkle', 16)}<span>Checking for Ollama…</span></div>`;
    } else if (ls.running) {
      ollamaBox.innerHTML = `<div class="lb-row ok">${icon('check', 16)}<span>Ollama is running${ls.version ? ` (version ${escapeHtml(ls.version)})` : ''}</span></div>`;
    } else if (ls.installed) {
      ollamaBox.innerHTML = `<div class="lb-row">${icon('alert', 16)}<span>Ollama isn't open right now.</span></div><div class="lb-actions"><button class="btn" data-a="start-ollama">Open Ollama</button></div>`;
    } else {
      ollamaBox.innerHTML = `<div class="lb-row">${icon('download', 16)}<span>To run models on this Mac, first install Ollama. It's free.</span></div><div class="lb-actions"><button class="btn" data-a="get-ollama">${icon('external', 15)} Download Ollama</button></div>`;
    }
    installedBox.innerHTML = '';
    for (const m of ls?.models || []) {
      const row = h('<div class="installed-row"><span class="ir-name"></span><span class="ir-size"></span></div>');
      row.querySelector('.ir-name').textContent = modelLabel(`local:${m.name}`);
      row.querySelector('.ir-size').textContent = [m.parameterSize, gb(m.size)].filter(Boolean).join(' · ');
      row.title = m.name;
      installedBox.appendChild(row);
    }
    $('#s-pull-field', overlay).hidden = !ls?.running;
    fillModelSelect();
  };
  const refreshLocal = async () => {
    state.local.status = await api.localStatus().catch(() => null);
    if (overlay.isConnected) paintLocal();
  };
  paintLocal();
  refreshLocal();
  const effortSel = $('#s-effort', overlay);
  effortSel.value = s.effort;
  effortSel.addEventListener('change', () => save({ effort: effortSel.value }));
  const web = $('#s-web', overlay);
  web.classList.toggle('on', s.webSearch);
  web.setAttribute('aria-checked', String(s.webSearch));
  web.addEventListener('click', async () => {
    const res = await save({ webSearch: !state.settings.webSearch });
    if (res) {
      web.classList.toggle('on', res.settings.webSearch);
      web.setAttribute('aria-checked', String(res.settings.webSearch));
    }
  });

  // appearance
  const bindSegmented = (sel, key, after) => {
    const seg = $(sel, overlay);
    const paint = () => seg.querySelectorAll('button').forEach((b) => b.classList.toggle('on', b.dataset.v === state.settings[key]));
    paint();
    seg.addEventListener('click', async (e) => {
      const b = e.target.closest('button');
      if (!b) return;
      await save({ [key]: b.dataset.v });
      paint();
      after?.();
    });
  };
  bindSegmented('#s-theme', 'theme', applyTheme);
  bindSegmented('#s-font', 'font', applyFont);

  // shortcut
  const shortcutSel = $('#s-shortcut', overlay);
  const shortcutMsg = $('#s-shortcut-msg', overlay);
  const pretty = (acc) =>
    acc
      ? acc
          .replace('CommandOrControl', '⌘')
          .replace('Control', '⌃')
          .replace('Alt', '⌥')
          .replace('Shift', '⇧')
          .replace(/\+/g, ' ')
          .replace('Space', 'Space')
      : 'Off';
  for (const acc of state.info.shortcuts) {
    const o = document.createElement('option');
    o.value = acc;
    o.textContent = pretty(acc);
    shortcutSel.appendChild(o);
  }
  shortcutSel.value = s.shortcut;
  const paintShortcut = () => {
    shortcutMsg.textContent = state.shortcutOk || !state.settings.shortcut ? '' : 'Another app is already using this shortcut. Pick a different one.';
  };
  paintShortcut();
  shortcutSel.addEventListener('change', async () => {
    await save({ shortcut: shortcutSel.value });
    paintShortcut();
  });

  $('#s-version', overlay).textContent = `Buddy ${state.info.version}`;
  if (section) overlay.querySelector(`#s-${section}`)?.scrollIntoView({ block: 'start' });
}

boot().catch((err) => {
  document.body.textContent = `Buddy could not start: ${errorText(err)}`;
});
