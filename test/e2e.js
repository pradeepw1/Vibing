'use strict';

// End-to-end test: runs the real app against the fake Claude API in test/mock-api.js.
// Needs Playwright (npm i -D playwright) and, on Linux, a display (xvfb-run -a node test/e2e.js).

const path = require('path');
const fs = require('fs');
const os = require('os');
const assert = require('assert/strict');
const { _electron: electron } = require('playwright');
const { createServer, VALID_KEY } = require('./mock-api');

const repo = path.join(__dirname, '..');
const shots = process.env.BUDDY_SHOTS || path.join(os.tmpdir(), 'buddy-shots');
fs.mkdirSync(shots, { recursive: true });

let mock;
let mockUrl;
let app;
let win;
const userData = fs.mkdtempSync(path.join(os.tmpdir(), 'buddy-test-'));

async function launch(dataDir = userData) {
  app = await electron.launch({
    executablePath: require(path.join(repo, 'node_modules', 'electron')),
    args: ['--no-sandbox', repo],
    cwd: repo,
    env: {
      ...process.env,
      BUDDY_USER_DATA: dataDir,
      BUDDY_API_BASE_URL: mockUrl,
      BUDDY_OLLAMA_URL: mockUrl,
      // Test mode: no Keychain, no confirm dialogs, nothing opened in other apps.
      BUDDY_TEST_MODE: '1',
    },
  });
  win = await app.firstWindow();
  win.on('pageerror', (e) => {
    console.error('  [page error]', e.message);
    pageErrors.push(e.message);
  });
  win.on('console', (m) => {
    if (m.type() === 'error') console.error('  [console]', m.text());
  });
  await win.setViewportSize({ width: 1180, height: 800 }).catch(() => {});
  await win.waitForLoadState('domcontentloaded');
}

const pageErrors = [];
let passed = 0;

async function step(name, fn) {
  process.stdout.write(`• ${name} ... `);
  try {
    await fn();
    passed++;
    console.log('ok');
  } catch (err) {
    console.log('FAILED');
    await win?.screenshot({ path: path.join(shots, 'failure.png') }).catch(() => {});
    throw err;
  }
}

const composer = () => win.locator('.composer textarea');

async function waitIdle(timeout = 15000) {
  await win.waitForFunction(() => !document.querySelector('.assistant-head.streaming'), null, { timeout });
}

async function send(text) {
  const before = mock.requests.length;
  await composer().fill(text);
  await composer().press('Enter');
  await win.waitForFunction((n) => document.querySelectorAll('.msg.assistant').length >= n, 1);
  await waitIdle();
  return mock.requests.slice(before);
}

function streamRequests(list) {
  return list.filter((r) => r.body.stream);
}

async function lastAssistantText() {
  return win.locator('.msg.assistant').last().innerText();
}

(async () => {
  mock = createServer();
  mockUrl = await mock.listen();
  await launch();

  await step('first run shows the welcome screen', async () => {
    await win.locator('text=Welcome to Buddy').waitFor();
    await win.screenshot({ path: path.join(shots, '01-onboarding.png') });
  });

  await step('a wrong API key is rejected with a clear message', async () => {
    await win.click('[data-choice="claude"]');
    await win.fill('#ob-key', 'sk-ant-wrong-key-0000000000000');
    await win.click('#ob-go');
    await win.locator('#ob-msg', { hasText: "didn't work" }).waitFor();
  });

  await step('a good API key opens the app', async () => {
    await win.fill('#ob-key', VALID_KEY);
    await win.fill('#ob-name', 'Sam');
    await win.click('#ob-go');
    await win.locator('.greeting', { hasText: 'Sam' }).waitFor();
    await win.locator('.composer textarea').waitFor();
    await win.screenshot({ path: path.join(shots, '02-welcome.png') });
  });

  await step('sending a message streams a formatted reply', async () => {
    const reqs = streamRequests(await send('Hello there'));
    assert.equal(reqs.length, 1);
    const text = await lastAssistantText();
    assert.match(text, /Hello from mock/);
    assert.ok(await win.locator('.msg.assistant .md table').count(), 'table rendered');
    assert.ok(await win.locator('.msg.assistant .md strong').count(), 'bold rendered');
    assert.match(await win.locator('.msg.assistant .process-head').first().innerText(), /Thought/);
    // The user message bubble is shown.
    assert.equal(await win.locator('.msg.user .bubble').first().innerText(), 'Hello there');
  });

  await step('the request uses the right model, thinking, caching, fallbacks and tools', async () => {
    const req = streamRequests(mock.requests)[0];
    const b = req.body;
    assert.equal(b.model, 'claude-opus-5-5');
    assert.equal(b.max_tokens, 64000);
    assert.deepEqual(b.thinking, { type: 'adaptive', display: 'summarized', block_binding: { prefix_mismatch_behavior: 'drop_block' } });
    assert.deepEqual(b.output_config, { effort: 'medium' });
    assert.deepEqual(b.cache_control, { type: 'ephemeral' });
    assert.equal(b.fallbacks, 'default');
    assert.match(req.betas, /server-side-fallback-2026-07-01/);
    assert.match(req.betas, /thinking-binding-controls-2026-08-01/);
    assert.deepEqual(b.tool_choice, { type: 'auto' });
    assert.deepEqual(b.tools.map((t) => t.type), ['web_search_20260209', 'web_fetch_20260209']);
    assert.match(b.system, /Sam/);
    const content = b.messages[0].content;
    assert.match(content[0].text, /^<context>Sent .+\.<\/context>$/);
    assert.equal(content[1].text, 'Hello there');
  });

  await step('the chat gets a title and shows in the sidebar', async () => {
    await win.locator('.chat-item .title', { hasText: 'Mock chat title' }).waitFor();
    await win.locator('.topbar-title', { hasText: 'Mock chat title' }).waitFor();
  });

  await step('code blocks are highlighted and can be copied', async () => {
    await send('Show me some code');
    const block = win.locator('.msg.assistant').last().locator('.codeblock');
    await block.waitFor();
    assert.equal(await block.locator('.codeblock-lang').innerText(), 'python');
    assert.ok(await block.locator('.hljs-keyword').count(), 'keywords highlighted');
    await block.locator('.copy-code').click();
    await win.locator('.copy-code', { hasText: 'Copied' }).waitFor();
    const clip = await app.evaluate(({ clipboard }) => clipboard.readText());
    assert.match(clip, /def greet\(name\):/);
  });

  await step('history is sent back unchanged (thinking signatures, system prompt)', async () => {
    const reqs = streamRequests(mock.requests);
    const [first, second] = reqs;
    assert.equal(second.body.system, first.body.system, 'system prompt is frozen');
    const replayed = second.body.messages[1];
    assert.equal(replayed.role, 'assistant');
    const thinkingBlock = replayed.content.find((c) => c.type === 'thinking');
    assert.ok(thinkingBlock && thinkingBlock.signature.startsWith('sig-'), 'thinking block replayed with signature');
    assert.deepEqual(second.body.messages[0], first.body.messages[0], 'first user turn is byte-identical');
  });

  await step('web search shows steps, sources and citation chips', async () => {
    await send('Please search the weather in Lisbon');
    const msg = win.locator('.msg.assistant').last();
    assert.match(await msg.locator('.process-head').innerText(), /Thought for|Thought it over|searched the web/i);
    assert.match(await msg.locator('.process-head').innerText(), /searched the web/i);
    const chips = msg.locator('.cite');
    assert.equal(await chips.count(), 2);
    assert.equal(await chips.nth(0).innerText(), 'example.com');
    assert.equal(await chips.nth(1).innerText(), 'weather.example.net');
    assert.match(await msg.locator('.md').innerText(), /sunny in Lisbon today, around 21°C/);
    await msg.locator('.process-head').click();
    await msg.locator('.result .rtitle', { hasText: 'Lisbon weather today' }).waitFor();
    await win.screenshot({ path: path.join(shots, '03-search.png') });
  });

  await step('search results are replayed in the next request', async () => {
    const before = mock.requests.length;
    await send('thanks!');
    const req = streamRequests(mock.requests.slice(before))[0];
    const assistant = req.body.messages[5];
    assert.equal(assistant.role, 'assistant');
    const types = assistant.content.map((c) => c.type);
    assert.ok(types.includes('server_tool_use') && types.includes('web_search_tool_result'), types.join(','));
    const cited = assistant.content.find((c) => c.type === 'text' && c.citations?.length);
    assert.ok(cited, 'cited text block kept');
  });

  await step('turning web search off sets tool_choice none but keeps the same tools', async () => {
    await win.click('.web-btn');
    const reqs = streamRequests(await send('hi again'));
    const b = reqs[0].body;
    assert.deepEqual(b.tool_choice, { type: 'none' });
    assert.deepEqual(b.tools.map((t) => t.type), ['web_search_20260209', 'web_fetch_20260209']);
    const ctx = b.messages[b.messages.length - 1].content[0].text;
    assert.match(ctx, /Web search is turned off/);
    await win.click('.web-btn');
  });

  await step('Stop ends a reply early and keeps what was written', async () => {
    await composer().fill('Tell me a slow story');
    await composer().press('Enter');
    await win.locator('.msg.assistant').last().locator('.md', { hasText: 'Word3' }).waitFor();
    await win.click('.send-btn.stop');
    await waitIdle();
    const msg = win.locator('.msg.assistant').last();
    await msg.locator('.muted-note', { hasText: 'You stopped this reply' }).waitFor();
    assert.match(await msg.innerText(), /Word3/);
  });

  await step('a stopped reply is sent back as plain text', async () => {
    const reqs = streamRequests(await send('ok, after the stop'));
    const msgs = reqs[0].body.messages;
    const stopped = msgs[msgs.length - 2];
    assert.equal(stopped.role, 'assistant');
    assert.ok(stopped.content.every((c) => c.type === 'text' && !('citations' in c)), JSON.stringify(stopped.content).slice(0, 200));
  });

  await step('Retry replaces the last reply', async () => {
    const countBefore = await win.locator('.msg.assistant').count();
    const before = mock.requests.length;
    await win.locator('.msg.assistant').last().locator('[title="Retry"]').click();
    await win.waitForFunction(() => document.querySelector('.assistant-head.streaming'), null, { timeout: 5000 }).catch(() => {});
    await waitIdle();
    assert.equal(await win.locator('.msg.assistant').count(), countBefore);
    const req = streamRequests(mock.requests.slice(before))[0];
    const last = req.body.messages[req.body.messages.length - 1];
    assert.equal(last.role, 'user');
    assert.equal(last.content[last.content.length - 1].text, 'ok, after the stop');
  });

  await step('editing an earlier message starts the chat over from there', async () => {
    const first = win.locator('.msg.user').first();
    await first.hover();
    await first.locator('[title="Edit"]').click();
    const box = first.locator('.edit-box textarea');
    await box.fill('Hello again, edited');
    const before = mock.requests.length;
    await first.locator('[data-a="save"]').click();
    await win.waitForFunction(() => document.querySelectorAll('.msg').length === 2);
    await waitIdle();
    const req = streamRequests(mock.requests.slice(before))[0];
    assert.equal(req.body.messages.length, 1);
    assert.equal(req.body.messages[0].content[1].text, 'Hello again, edited');
    assert.equal(await win.locator('.msg.user .bubble').first().innerText(), 'Hello again, edited');
  });

  await step('a safety refusal shows a friendly notice', async () => {
    await send('please refuse this');
    await win.locator('.msg.assistant').last().locator('.notice.warn', { hasText: 'can’t help with this one' }).waitFor();
  });

  await step('a mid-reply model switch is shown and replayed correctly', async () => {
    await send('fallback test');
    const msg = win.locator('.msg.assistant').last();
    await msg.locator('.switch-note', { hasText: 'Opus 5 took over' }).waitFor();
    assert.match(await msg.innerText(), /finished by the fallback model/);
    assert.equal(await msg.locator('.model-tag').innerText(), 'Opus 5');
    const reqs = streamRequests(await send('and after that?'));
    const msgs = reqs[0].body.messages;
    const replay = msgs[msgs.length - 2].content;
    const fb = replay.findIndex((c) => c.type === 'fallback');
    assert.ok(fb > 0, 'fallback block kept');
    assert.ok(!replay.slice(0, fb).some((c) => c.type === 'thinking'), 'thinking before the switch is left out');
    assert.ok(replay.slice(fb).some((c) => c.type === 'thinking'), 'thinking after the switch is kept');
    // The refused turn before it is skipped, so two user turns sit side by side (the API merges them).
    assert.ok(msgs.every((m) => m.content.length > 0));
  });

  await step('a paused server-tool turn is continued automatically', async () => {
    const reqs = streamRequests(await send('pause test'));
    assert.equal(reqs.length, 2);
    const cont = reqs[1].body.messages;
    assert.equal(cont[cont.length - 1].role, 'assistant');
    assert.ok(cont[cont.length - 1].content.some((c) => c.type === 'server_tool_use'));
    assert.match(await lastAssistantText(), /Picked up right where I paused/);
  });

  await step('a paused reply is replayed with its search call and result together', async () => {
    const reqs = streamRequests(await send('what next?'));
    const msgs = reqs[0].body.messages;
    // The paused reply comes back as two assistant messages, exactly as they were sent.
    const [first, second] = msgs.slice(-3, -1);
    assert.equal(first.role, 'assistant');
    assert.equal(second.role, 'assistant');
    assert.ok(first.content.some((c) => c.type === 'server_tool_use' && c.id === 'srvtoolu_pause'), 'search call kept');
    assert.ok(second.content.some((c) => c.type === 'web_search_tool_result' && c.tool_use_id === 'srvtoolu_pause'), 'result kept');
  });

  await step('if the API rejects the beta extras, Buddy retries without them and keeps web search', async () => {
    const reqs = streamRequests(await send('badbeta check'));
    assert.equal(reqs.length, 2);
    assert.ok(reqs[0].betas, 'first try had betas');
    assert.equal(reqs[1].betas, '', 'second try had no betas');
    assert.ok(reqs[1].body.tools?.length, 'web tools kept');
    assert.equal(reqs[1].body.fallbacks, undefined);
    assert.equal(reqs[1].body.thinking.block_binding, undefined);
    assert.ok(reqs[1].body.messages.some((m) => m.role === 'assistant' && m.content.some((c) => c.type === 'thinking')));
    assert.match(await lastAssistantText(), /Hello from mock/);
  });

  await step('if the API rejects tools too, Buddy falls back to a plain chat and says so', async () => {
    const reqs = streamRequests(await send('badtools check'));
    assert.equal(reqs.length, 2, 'the chat remembered to skip the betas');
    assert.equal(reqs[0].betas, '');
    assert.equal(reqs[1].body.tools, undefined);
    assert.ok(reqs[1].body.messages.every((m) => m.role === 'user' || m.content.every((c) => c.type === 'text')));
    await win.locator('.msg.assistant').last().locator('.muted-note', { hasText: 'Web search was switched off' }).waitFor();
  });

  await step('API errors show a clear message with a retry button', async () => {
    await send('permission please');
    const notice = win.locator('.msg.assistant').last().locator('.notice.error');
    await notice.waitFor();
    assert.match(await notice.innerText(), /isn't allowed/);
    assert.ok(await notice.locator('button', { hasText: 'Try again' }).count());
  });

  await step('files can be attached and are sent as image + document blocks', async () => {
    await win.click('[data-act="new-chat"] >> nth=0');
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'buddy-files-'));
    const txt = path.join(tmp, 'notes.md');
    fs.writeFileSync(txt, '# My notes\n\nRemember the milk.\n');
    const docx = path.join(tmp, 'report.docx');
    fs.writeFileSync(docx, 'PK\u0003\u0004not really a docx');
    await win.setInputFiles('.file-input', [path.join(repo, 'build', 'icon.png'), txt]);
    await win.waitForFunction(() => document.querySelectorAll('.draft:not(.pending)').length === 2);
    await win.setInputFiles('.file-input', [docx]);
    await win.locator('.toast.error', { hasText: 'DOCX' }).waitFor();
    const reqs = streamRequests(await send('What is in these files?'));
    const content = reqs[0].body.messages[0].content;
    assert.equal(content[0].type, 'image');
    assert.equal(content[0].source.media_type, 'image/png');
    assert.equal(content[1].type, 'document');
    assert.equal(content[1].title, 'notes.md');
    assert.equal(content[1].source.type, 'text');
    assert.match(content[1].source.data, /Remember the milk/);
    await win.locator('.msg.user img.thumb').waitFor();
    assert.equal(await win.locator('.msg.user .file-chip .fname').innerText(), 'notes.md');
  });

  await step('switching to Haiku uses the basic search tool and no fallbacks', async () => {
    await win.click('[data-act="model"]');
    await win.click('.popover [data-model="claude-haiku-5-5"]');
    const reqs = streamRequests(await send('quick question'));
    const b = reqs[0].body;
    assert.equal(b.model, 'claude-haiku-5-5');
    assert.equal(b.fallbacks, undefined);
    assert.doesNotMatch(reqs[0].betas, /server-side-fallback/);
    assert.deepEqual(b.tools.map((t) => t.type), ['web_search_20250305']);
    await win.click('[data-act="model"]');
    await win.click('.popover [data-effort="high"]');
    await win.keyboard.press('Escape');
    assert.match(await win.locator('.model-name').innerText(), /Haiku 5.5 · Deep/);
    await win.click('[data-act="model"]');
    await win.click('.popover [data-effort="medium"]');
    await win.click('.popover [data-model="claude-opus-5-5"]');
  });

  await step('settings save your profile and switch to dark mode', async () => {
    await win.click('.sidebar-foot .icon-btn');
    await win.locator('.modal h2', { hasText: 'Settings' }).waitFor();
    await win.fill('#s-about', 'I live in Lisbon and like short answers.');
    await win.fill('#s-aname', 'Pal');
    await win.waitForTimeout(700);
    await win.click('#s-theme [data-v="dark"]');
    await win.waitForFunction(() => getComputedStyle(document.body).backgroundColor === 'rgb(28, 27, 25)');
    await win.screenshot({ path: path.join(shots, '04-settings-dark.png') });
    await win.keyboard.press('Escape');
    await win.locator('.modal').waitFor({ state: 'detached' });
    assert.equal(await win.locator('.brand-name').innerText(), 'Pal');
    await win.click('[data-act="new-chat"] >> nth=0');
    const reqs = streamRequests(await send('Hello there'));
    assert.match(reqs[0].body.system, /You are Pal/);
    assert.match(reqs[0].body.system, /I live in Lisbon/);
    await send('Please search the weather in Lisbon');
    await win.screenshot({ path: path.join(shots, '05-chat-dark.png') });
  });

  await step('chats can be renamed and deleted from the sidebar', async () => {
    const item = win.locator('.chat-item').first();
    await item.hover();
    await item.locator('.more').click();
    await win.click('.popover [data-a="rename"]');
    const input = win.locator('.chat-item input');
    await input.fill('Lisbon trip');
    await input.press('Enter');
    await win.locator('.chat-item .title', { hasText: 'Lisbon trip' }).waitFor();
    await win.locator('.topbar-title', { hasText: 'Lisbon trip' }).waitFor();
    const count = await win.locator('.chat-item').count();
    const target = win.locator('.chat-item', { hasText: 'Lisbon trip' });
    await target.hover();
    await target.locator('.more').click();
    await win.click('.popover [data-a="delete"]');
    await win.waitForFunction((n) => document.querySelectorAll('.chat-item').length === n - 1, count);
    assert.ok(await win.locator('.main.empty').count(), 'back to a new chat');
  });

  await step('search filters the chat list', async () => {
    await win.fill('.search-box input', 'these files');
    await win.waitForFunction(() => document.querySelectorAll('.chat-item').length === 1);
    await win.fill('.search-box input', 'zzz-no-match');
    await win.locator('.chat-empty', { hasText: 'No chats match' }).waitFor();
    await win.fill('.search-box input', '');
    await win.waitForFunction(() => document.querySelectorAll('.chat-item').length > 1);
  });

  await step('math is drawn with KaTeX, and prices stay as plain text', async () => {
    await win.click('[data-act="new-chat"] >> nth=0');
    await send('Show me some math');
    const md = win.locator('.msg.assistant').last().locator('.md');
    await md.locator('.katex').first().waitFor();
    assert.equal(await md.locator('.katex').count(), 3);
    assert.equal(await md.locator('.katex-display').count(), 1);
    assert.match(await md.innerText(), /Coffee costs \$5 and lunch costs \$10\./);
  });

  await step('web pages Claude writes can be previewed in a locked-down panel', async () => {
    await send('Make me a small webpage');
    await win.locator('.msg.assistant').last().locator('[data-action="preview-code"]').click();
    const panel = win.locator('.preview-panel');
    await panel.waitFor();
    assert.equal(await panel.locator('.preview-title').innerText(), 'Hello page');
    // The page's own script ran...
    await win.frameLocator('.preview-panel iframe').locator('#greeting', { hasText: 'Hello from the preview!' }).waitFor();
    // ...but it can't touch the app: no access to the page around it, and no app bridge.
    const frame = await (await win.locator('.preview-panel iframe').elementHandle()).contentFrame();
    const sealed = await frame.evaluate(() => {
      let parent = 'blocked';
      try {
        parent = window.parent.document.title;
      } catch {
        // expected
      }
      return { parent, bridge: typeof window.buddy };
    });
    assert.deepEqual(sealed, { parent: 'blocked', bridge: 'undefined' });
    await win.screenshot({ path: path.join(shots, '07-preview.png') });
    await panel.locator('[data-pv="browser"]').click();
    await win.locator('.toast', { hasText: 'Opened in your browser' }).waitFor();
    const files = fs.readdirSync(path.join(userData, 'previews'));
    assert.ok(files.some((f) => f.startsWith('Hello page') && f.endsWith('.html')), files.join(','));
    await win.keyboard.press('Escape');
    await panel.waitFor({ state: 'hidden' });
  });

  await step('SVG pictures can be previewed too', async () => {
    await send('Draw an svg circle');
    await win.locator('.msg.assistant').last().locator('[data-action="preview-code"]').click();
    await win.frameLocator('.preview-panel iframe').locator('svg circle').waitFor();
    await win.locator('.preview-panel [data-pv="close"]').click();
    await win.locator('.preview-panel').waitFor({ state: 'hidden' });
  });

  await step('long web pages show as a card and open their preview by themselves', async () => {
    await send('Make me a tip calculator');
    const card = win.locator('.msg.assistant').last().locator('.codeblock.artifact');
    assert.equal(await card.locator('.artifact-title').innerText(), 'Tip calculator');
    assert.equal(await card.locator('pre').isVisible(), false, 'code starts folded away');
    await win.locator('.preview-panel .preview-title', { hasText: 'Tip calculator' }).waitFor();
    await win.frameLocator('.preview-panel iframe').locator('#each', { hasText: '$28.61' }).waitFor();
    await card.locator('[data-action="toggle-code"]').click();
    assert.equal(await card.locator('pre').isVisible(), true);
    assert.equal(await card.locator('[data-action="toggle-code"]').innerText(), 'Hide code');
    await card.locator('[data-action="toggle-code"]').click();
    assert.equal(await card.locator('pre').isVisible(), false);
    await win.keyboard.press('Escape');
    await win.locator('.preview-panel').waitFor({ state: 'hidden' });
  });

  await step('a chat can be exported as Markdown', async () => {
    const item = win.locator('.chat-item.active');
    await item.hover();
    await item.locator('.more').click();
    await win.click('.popover [data-a="export"]');
    await win.locator('.toast', { hasText: 'Saved' }).waitFor();
    const dir = path.join(userData, 'exports');
    const [file] = fs.readdirSync(dir);
    const text = fs.readFileSync(path.join(dir, file), 'utf8');
    assert.match(text, /^# Mock chat title/);
    assert.match(text, /\*\*Sam\*\*/);
    assert.match(text, /Show me some math/);
    assert.match(text, /\$E = mc\^2\$/);
    assert.match(text, /\*\*Pal\*\* · Opus 5\.5/);
  });

  await step('everything is still there after a restart', async () => {
    const count = await win.locator('.chat-item').count();
    await win.click('#root .app'); // make sure nothing is focused weirdly
    await app.close();
    await launch();
    await win.locator('.composer textarea').waitFor();
    await win.waitForFunction((n) => document.querySelectorAll('.chat-item').length === n, count);
    await win.locator('.chat-item').first().click();
    await win.waitForFunction(() => document.querySelectorAll('.msg').length > 0);
    await win.screenshot({ path: path.join(shots, '06-after-restart.png') });
  });

  // ---------------------------------------------------------------------------------------
  // Round two: a fresh Mac with no API key, running a model locally through (fake) Ollama.

  const ollamaChats = () => mock.ollama.requests.filter((r) => r.path === '/api/chat' && r.body.stream);
  const lastOllamaChat = () => ollamaChats()[ollamaChats().length - 1].body;

  await step('with no API key, "Run on this Mac" downloads a model and starts', async () => {
    await app.close();
    await launch(fs.mkdtempSync(path.join(os.tmpdir(), 'buddy-local-')));
    await win.locator('text=Welcome to Buddy').waitFor();
    await win.screenshot({ path: path.join(shots, '08-choose.png') });
    await win.click('[data-choice="local"]');
    await win.locator('.lb-row.ok', { hasText: 'Ollama is ready' }).waitFor();
    // It suggests a model that suits this computer's memory...
    const ram = Math.round(os.totalmem() / 1024 ** 3);
    const suited = ram >= 24 ? 'gpt-oss:20b' : ram >= 16 ? 'qwen3:8b' : 'qwen3:4b';
    assert.equal(await win.locator('.model-option input:checked').inputValue(), suited);
    assert.match(await win.locator('.model-option:has(input:checked)').innerText(), /Best for your Mac/);
    // ...but any can be picked. The small one keeps this test quick.
    await win.locator('.model-option', { hasText: 'Qwen 3 (4B)' }).click();
    assert.match(await win.locator('#ls-go').innerText(), /Download and start \(about 2\.6 GB\)/);
    await win.fill('#ob-name', 'Sam');
    await win.screenshot({ path: path.join(shots, '09-local-setup.png') });
    await win.click('#ls-go');
    await win.locator('.pull-progress .progress-text', { hasText: /Downloading|Done|Getting ready/ }).waitFor();
    await win.locator('.composer textarea').waitFor({ timeout: 15000 });
    assert.equal(await win.locator('.model-name').innerText(), 'Qwen 3 (4B)');
    assert.equal(await win.locator('.web-btn').isVisible(), false, 'no web search on local models');
    assert.match(await win.locator('.footnote').innerText(), /privately on your Mac/);
  });

  await step('a local model streams its thinking and reply, and names the chat', async () => {
    const before = ollamaChats().length;
    await send('Hello there');
    assert.equal(ollamaChats().length, before + 1);
    const msg = win.locator('.msg.assistant').last();
    assert.match(await msg.locator('.md').innerText(), /Hello from your Mac!/);
    assert.match(await msg.locator('.process-head').innerText(), /Thought/);
    assert.equal(await msg.locator('.model-tag').innerText(), 'Qwen 3 (4B)');
    const b = lastOllamaChat();
    assert.equal(b.model, 'qwen3:4b');
    assert.equal(b.think, true);
    assert.equal(b.keep_alive, '30m');
    assert.ok(b.options.num_ctx >= 8192);
    assert.equal(b.messages[0].role, 'system');
    assert.match(b.messages[0].content, /running privately on the user's own Mac/);
    assert.match(b.messages[1].content, /^<context>Sent .+\.<\/context>\n\nHello there$/);
    await win.locator('.chat-item .title', { hasText: 'Local chat title' }).waitFor();
    await win.screenshot({ path: path.join(shots, '10-local-chat.png') });
  });

  await step('Quick thinking turns a local model\'s thinking off', async () => {
    await win.click('[data-act="model"]');
    await win.click('.popover [data-effort="low"]');
    await win.keyboard.press('Escape');
    await send('quick one');
    assert.equal(lastOllamaChat().think, false);
    assert.equal(await win.locator('.msg.assistant').last().locator('.process-head').count(), 0);
    // earlier replies are sent back as plain text
    const history = lastOllamaChat().messages;
    assert.equal(history[2].role, 'assistant');
    assert.match(history[2].content, /Hello from your Mac/);
  });

  await step('more models can be downloaded in Settings, and image-capable ones get your images', async () => {
    await win.click('.sidebar-foot .icon-btn');
    await win.locator('#s-ollama .lb-row.ok').waitFor();
    await win.selectOption('#s-pull-pick', 'gemma3:12b');
    await win.click('#s-local [data-a="pull"]');
    await win.locator('.toast', { hasText: 'Gemma 3 (12B) is ready' }).waitFor();
    await win.locator('#s-installed .installed-row', { hasText: 'Gemma 3 (12B)' }).waitFor();
    await win.keyboard.press('Escape');
    await win.click('[data-act="model"]');
    await win.click('.popover [data-model="local:gemma3:12b"]');
    await win.setInputFiles('.file-input', [path.join(repo, 'build', 'icon.png')]);
    await win.waitForFunction(() => document.querySelectorAll('.draft:not(.pending)').length === 1);
    await send('What is in this picture?');
    const b = lastOllamaChat();
    assert.equal(b.model, 'gemma3:12b');
    assert.equal(b.think, undefined, 'no thinking switch for a model that cannot think');
    const last = b.messages[b.messages.length - 1];
    assert.equal(last.images.length, 1);
    assert.ok(last.images[0].length > 1000);
  });

  await step('Claude models show that they need an API key', async () => {
    await win.click('[data-act="model"]');
    assert.ok(await win.locator('.popover .menu-item.disabled[data-model="claude-opus-5-5"]').count());
    await win.click('.popover [data-model="claude-opus-5-5"]');
    await win.locator('.toast', { hasText: 'Claude models need an API key' }).waitFor();
    await win.keyboard.press('Escape');
  });

  await step('Stop works for local replies too', async () => {
    await composer().fill('Tell me something slow');
    await composer().press('Enter');
    await win.locator('.msg.assistant').last().locator('.md', { hasText: 'Step3' }).waitFor();
    await win.click('.send-btn.stop');
    await waitIdle();
    await win.locator('.msg.assistant').last().locator('.muted-note', { hasText: 'You stopped this reply' }).waitFor();
  });

  await step("if Ollama isn't running, Buddy says so plainly", async () => {
    mock.ollama.up = false;
    await send('are you there?');
    const notice = win.locator('.msg.assistant').last().locator('.notice.error');
    await notice.waitFor();
    assert.match(await notice.innerText(), /can't reach Ollama/);
    assert.ok(await notice.locator('button', { hasText: 'Open Ollama' }).count());
    mock.ollama.up = true;
    await notice.locator('button', { hasText: 'Try again' }).click();
    await waitIdle();
    assert.match(await lastAssistantText(), /Hello from your Mac/);
  });

  assert.deepEqual(pageErrors, [], 'no page errors');
  await app.close();
  await mock.close();
  console.log(`\nAll ${passed} checks passed. Screenshots: ${shots}`);
})().catch(async (err) => {
  console.error('\n', err);
  await app?.close().catch(() => {});
  await mock?.close().catch(() => {});
  process.exit(1);
});
