'use strict';

// Chats with a REAL model through a real Ollama, start to finish, the way a person would:
// first-run setup, then a couple of messages. The Mac build on GitHub runs this after
// installing Ollama and pulling a tiny model.
//
//   ollama serve &  &&  ollama pull qwen3:0.6b
//   BUDDY_REAL_MODEL=qwen3:0.6b node test/local-real.js

const path = require('path');
const fs = require('fs');
const os = require('os');
const assert = require('assert/strict');
const { _electron: electron } = require('playwright');

const repo = path.join(__dirname, '..');
const model = process.env.BUDDY_REAL_MODEL || 'qwen3:0.6b';
const shots = process.env.BUDDY_SHOTS || path.join(os.tmpdir(), 'buddy-shots');
fs.mkdirSync(shots, { recursive: true });

(async () => {
  const app = await electron.launch({
    executablePath: require(path.join(repo, 'node_modules', 'electron')),
    args: ['--no-sandbox', repo],
    cwd: repo,
    env: { ...process.env, BUDDY_USER_DATA: fs.mkdtempSync(path.join(os.tmpdir(), 'buddy-real-')), BUDDY_TEST_MODE: '1' },
  });
  const win = await app.firstWindow();
  win.on('pageerror', (e) => console.log('[page error]', e.message));

  const ask = async (text) => {
    const before = await win.locator('.msg.assistant').count();
    await win.locator('.composer textarea').fill(text);
    await win.locator('.composer textarea').press('Enter');
    await win.waitForFunction((n) => document.querySelectorAll('.msg.assistant').length > n, before);
    await win.waitForFunction(() => !document.querySelector('.assistant-head.streaming'), null, { timeout: 300000 });
    const msg = win.locator('.msg.assistant').last();
    const error = await msg.locator('.notice.error').count();
    if (error) throw new Error(`The model replied with an error: ${await msg.locator('.notice.error').innerText()}`);
    return msg;
  };

  try {
    await win.click('[data-choice="local"]');
    await win.locator('.lb-row.ok', { hasText: 'Ollama is ready' }).waitFor({ timeout: 30000 });
    // The model we pulled shows up as already downloaded, and is picked.
    await win.locator('.mo-group', { hasText: 'Already on your Mac' }).waitFor();
    assert.equal(await win.locator('.model-option input:checked').inputValue(), model);
    await win.click('#ls-go');
    await win.locator('.composer textarea').waitFor();

    const first = await ask('Say hello to me in one short, friendly sentence.');
    const reply = (await first.locator('.md').innerText()).trim();
    assert.ok(reply.length > 0, 'got a reply');
    const thought = await first.locator('.process-head').count();
    console.log(`::notice::${model} replied: ${reply.slice(0, 200).replace(/\s+/g, ' ')}${thought ? ' (and showed its thinking)' : ''}`);

    // Quick: thinking off.
    await win.click('[data-act="model"]');
    await win.click('.popover [data-effort="low"]');
    await win.keyboard.press('Escape');
    const second = await ask('What is 2 + 2? Answer with just the number.');
    const answer = (await second.locator('.md').innerText()).trim();
    assert.ok(answer.length > 0, 'got a second reply');
    console.log(`::notice::With Quick thinking, ${model} answered: ${answer.slice(0, 120).replace(/\s+/g, ' ')}`);

    const title = await win.locator('.chat-item .title').first().innerText();
    console.log(`::notice::The chat was named: ${title}`);
    await win.screenshot({ path: path.join(shots, 'real-local-model.png') });
    console.log('Real local model check passed.');
  } catch (err) {
    await win.screenshot({ path: path.join(shots, 'real-local-model-failure.png') }).catch(() => {});
    throw err;
  } finally {
    await app.close();
  }
})().catch((err) => {
  console.error(err);
  process.exit(1);
});
