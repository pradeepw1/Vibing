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

async function launch() {
  app = await electron.launch({
    executablePath: require(path.join(repo, 'node_modules', 'electron')),
    args: ['--no-sandbox', repo],
    cwd: repo,
    env: {
      ...process.env,
      BUDDY_USER_DATA: userData,
      BUDDY_API_BASE_URL: mockUrl,
      BUDDY_TEST_AUTOCONFIRM: '1',
      BUDDY_PLAIN_KEY_STORAGE: '1',
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
