'use strict';

// A tiny fake of the Claude Messages API, used by the tests.
// It speaks the same streaming (SSE) format, so the real SDK in the app parses it.
// What the user's message says decides what the fake does:
//   "search"     web search with citations      "code"      a code block
//   "slow"       a long, slow reply (to test Stop)   "refuse"    a safety refusal
//   "fallback"   a mid-reply switch to another model  "pause"     a paused server-tool turn
//   "badbeta"    rejects beta headers (tests safe mode)  "permission"  a 403 error

const http = require('http');

const VALID_KEY = 'sk-ant-test-valid-key-1234567890';

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

let counter = 0;
const nextId = (p) => `${p}_${Date.now().toString(36)}${(counter++).toString(36)}`;

function lastUserText(body) {
  const msgs = body.messages || [];
  for (let i = msgs.length - 1; i >= 0; i--) {
    const m = msgs[i];
    if (m.role !== 'user') continue;
    if (typeof m.content === 'string') return m.content;
    const texts = (m.content || []).filter((b) => b.type === 'text' && !b.text.startsWith('<context>'));
    if (texts.length) return texts[texts.length - 1].text;
  }
  return '';
}

function chunks(text, size = 12) {
  const out = [];
  for (let i = 0; i < text.length; i += size) out.push(text.slice(i, i + size));
  return out;
}

function createServer() {
  const requests = [];

  const server = http.createServer(async (req, res) => {
    const url = new URL(req.url, 'http://localhost');
    let raw = '';
    for await (const c of req) raw += c;

    if (url.pathname === '/_requests') {
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify(requests));
      return;
    }
    if (url.pathname === '/_reset') {
      requests.length = 0;
      res.end('ok');
      return;
    }

    // Newer SDKs send the key as "Authorization: Bearer ...", older ones as "x-api-key".
    const bearer = /^Bearer (.+)$/.exec(String(req.headers.authorization || ''))?.[1];
    const key = bearer || req.headers['x-api-key'];
    if (key !== VALID_KEY) {
      res.writeHead(401, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ type: 'error', error: { type: 'authentication_error', message: 'invalid x-api-key' } }));
      return;
    }

    if (req.method === 'GET' && url.pathname === '/v1/models') {
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(
        JSON.stringify({
          data: [{ id: 'claude-opus-5-5', type: 'model', display_name: 'Claude Opus 5.5', created_at: '2026-10-01T00:00:00Z' }],
          has_more: false,
          first_id: 'claude-opus-5-5',
          last_id: 'claude-opus-5-5',
        }),
      );
      return;
    }

    if (req.method !== 'POST' || url.pathname !== '/v1/messages') {
      res.writeHead(404, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ type: 'error', error: { type: 'not_found_error', message: 'not found' } }));
      return;
    }

    const body = JSON.parse(raw);
    const betas = String(req.headers['anthropic-beta'] || '');
    requests.push({ path: req.url, betas, body });
    const text = lastUserText(body).toLowerCase();

    // Title requests (non-streaming)
    if (!body.stream) {
      const prompt = JSON.stringify(body.messages).toLowerCase();
      const title = prompt.includes('weekend')
        ? 'Packing for a Lisbon weekend'
        : prompt.includes('python function')
          ? 'Python greeting function'
          : prompt.includes('email')
            ? 'Friendly reminder email'
            : 'Mock chat title';
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(
        JSON.stringify({
          id: nextId('msg'),
          type: 'message',
          role: 'assistant',
          model: body.model,
          content: [{ type: 'text', text: title }],
          stop_reason: 'end_turn',
          stop_sequence: null,
          usage: { input_tokens: 20, output_tokens: 4 },
        }),
      );
      return;
    }

    if (text.includes('permission')) {
      res.writeHead(403, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ type: 'error', error: { type: 'permission_error', message: 'This key is not allowed here.' } }));
      return;
    }
    if ((text.includes('badbeta') && betas) || (text.includes('badtools') && (betas || body.tools))) {
      res.writeHead(400, { 'content-type': 'application/json' });
      res.end(
        JSON.stringify({
          type: 'error',
          error: { type: 'invalid_request_error', message: `Unexpected value(s) \`${betas}\` for the \`anthropic-beta\` header.` },
        }),
      );
      return;
    }

    res.writeHead(200, { 'content-type': 'text/event-stream', 'cache-control': 'no-cache', connection: 'keep-alive' });
    let closed = false;
    req.on('close', () => {
      closed = true;
    });
    const send = (event, data) => {
      if (!closed) res.write(`event: ${event}\ndata: ${JSON.stringify({ type: event, ...data })}\n\n`);
    };
    let index = 0;
    const thinking = async (summary) => {
      const i = index++;
      send('content_block_start', { index: i, content_block: { type: 'thinking', thinking: '', signature: '' } });
      for (const c of chunks(summary, 16)) {
        send('content_block_delta', { index: i, delta: { type: 'thinking_delta', thinking: c } });
        await sleep(8);
      }
      send('content_block_delta', { index: i, delta: { type: 'signature_delta', signature: `sig-${nextId('t')}` } });
      send('content_block_stop', { index: i });
    };
    const textBlock = async (t, { delay = 6, size = 14, citations = [] } = {}) => {
      const i = index++;
      send('content_block_start', { index: i, content_block: { type: 'text', text: '' } });
      for (const c of citations) send('content_block_delta', { index: i, delta: { type: 'citations_delta', citation: c } });
      for (const c of chunks(t, size)) {
        if (closed) return;
        send('content_block_delta', { index: i, delta: { type: 'text_delta', text: c } });
        await sleep(delay);
      }
      send('content_block_stop', { index: i });
    };
    const finish = (stop_reason, extra = {}) => {
      send('message_delta', { delta: { stop_reason, stop_sequence: null, ...extra.delta }, usage: { output_tokens: 120, ...extra.usage } });
      send('message_stop', {});
      res.end();
    };

    const continuing = body.messages[body.messages.length - 1]?.role === 'assistant';
    send('message_start', {
      message: {
        id: nextId('msg'),
        type: 'message',
        role: 'assistant',
        model: body.model,
        content: [],
        stop_reason: null,
        stop_sequence: null,
        usage: { input_tokens: 50, output_tokens: 1, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 },
      },
    });

    if (continuing) {
      // Second half of a paused turn.
      send('content_block_start', {
        index: index++,
        content_block: {
          type: 'web_search_tool_result',
          tool_use_id: 'srvtoolu_pause',
          content: [{ type: 'web_search_result', url: 'https://news.example.org/story', title: 'Paused story', encrypted_content: 'enc', page_age: null }],
        },
      });
      send('content_block_stop', { index: index - 1 });
      await textBlock('Picked up right where I paused. All done.');
      finish('end_turn');
      return;
    }

    if (text.includes('pause')) {
      await thinking('I should look this up.');
      const i = index++;
      send('content_block_start', { index: i, content_block: { type: 'server_tool_use', id: 'srvtoolu_pause', name: 'web_search', input: {} } });
      send('content_block_delta', { index: i, delta: { type: 'input_json_delta', partial_json: '{"query": "paused query"}' } });
      send('content_block_stop', { index: i });
      finish('pause_turn');
      return;
    }

    if (text.includes('refuse')) {
      await thinking('Hmm.');
      send('message_delta', {
        delta: { stop_reason: 'refusal', stop_sequence: null, stop_details: { type: 'refusal', category: 'cyber', explanation: null } },
        usage: { output_tokens: 3 },
      });
      send('message_stop', {});
      res.end();
      return;
    }

    if (text.includes('fallback')) {
      await thinking('Starting on this.');
      await textBlock('Here is the first part. ');
      const i = index++;
      send('content_block_start', {
        index: i,
        content_block: { type: 'fallback', from: { model: body.model }, to: { model: 'claude-opus-5' } },
      });
      send('content_block_stop', { index: i });
      await thinking('Continuing after the switch.');
      await textBlock('And here is the rest, finished by the fallback model.');
      finish('end_turn');
      return;
    }

    if (text.includes('weekend')) {
      // A realistic reply, used for README screenshots.
      await thinking('They want packing tips, so the forecast matters. Checking the weekend weather in Lisbon first.');
      const i = index++;
      send('content_block_start', { index: i, content_block: { type: 'server_tool_use', id: 'srvtoolu_w', name: 'web_search', input: {} } });
      send('content_block_delta', { index: i, delta: { type: 'input_json_delta', partial_json: '{"query": "Lisbon weather this weekend"}' } });
      send('content_block_stop', { index: i });
      const r = index++;
      send('content_block_start', {
        index: r,
        content_block: {
          type: 'web_search_tool_result',
          tool_use_id: 'srvtoolu_w',
          content: [
            { type: 'web_search_result', url: 'https://www.ipma.pt/en/otempo/prev.localidade.hora/', title: 'Lisbon 10-day forecast', encrypted_content: 'a', page_age: '2 hours ago' },
            { type: 'web_search_result', url: 'https://www.visitlisboa.com/en/p/what-to-pack', title: 'What to pack for Lisbon', encrypted_content: 'b', page_age: null },
          ],
        },
      });
      send('content_block_stop', { index: r });
      await textBlock('Lisbon looks lovely this weekend: ');
      await textBlock('**sunny and around 21°C**, with a light breeze in the evening', {
        citations: [{ type: 'web_search_result_location', url: 'https://www.ipma.pt/en/otempo/prev.localidade.hora/', title: 'Lisbon 10-day forecast', encrypted_index: 'x', cited_text: 'Sunny, max 21°C.' }],
      });
      await textBlock(
        '.\n\nHere’s what I’d pack:\n\n' +
          '- **Layers.** A T-shirt for the day and a light jacket for the windy evenings.\n' +
          '- **Comfy walking shoes.** The hills and cobblestones are no joke.\n' +
          '- **Sunglasses and sunscreen.** The sun is strong, even in late autumn.\n' +
          '- **A small umbrella**, just in case. ',
      );
      await textBlock('There’s a small chance of rain on Sunday', {
        citations: [{ type: 'web_search_result_location', url: 'https://www.visitlisboa.com/en/p/what-to-pack', title: 'What to pack for Lisbon', encrypted_index: 'y', cited_text: 'Light showers possible Sunday.' }],
      });
      await textBlock('.\n\nWant me to plan a walking route for Saturday too?');
      finish('end_turn', { usage: { server_tool_use: { web_search_requests: 1 } } });
      return;
    }

    if (text.includes('search')) {
      await thinking('The user wants current info, so I will search.');
      const i = index++;
      send('content_block_start', { index: i, content_block: { type: 'server_tool_use', id: 'srvtoolu_1', name: 'web_search', input: {} } });
      for (const part of ['{"que', 'ry": "weather in Lisbon', ' today"}']) {
        send('content_block_delta', { index: i, delta: { type: 'input_json_delta', partial_json: part } });
        await sleep(30);
      }
      send('content_block_stop', { index: i });
      await sleep(120);
      const r = index++;
      send('content_block_start', {
        index: r,
        content_block: {
          type: 'web_search_tool_result',
          tool_use_id: 'srvtoolu_1',
          content: [
            { type: 'web_search_result', url: 'https://www.example.com/lisbon-weather', title: 'Lisbon weather today', encrypted_content: 'abc', page_age: '1 hour ago' },
            { type: 'web_search_result', url: 'https://weather.example.net/pt/lisbon', title: 'Lisbon forecast', encrypted_content: 'def', page_age: null },
          ],
        },
      });
      send('content_block_stop', { index: r });
      await textBlock('Here is what I found. ');
      await textBlock('It is sunny in Lisbon today, around 21°C', {
        citations: [
          {
            type: 'web_search_result_location',
            url: 'https://www.example.com/lisbon-weather',
            title: 'Lisbon weather today',
            encrypted_index: 'idx1',
            cited_text: 'Sunny, high of 21°C.',
          },
        ],
      });
      await textBlock(', with light wind in the evening.', {
        citations: [
          {
            type: 'web_search_result_location',
            url: 'https://weather.example.net/pt/lisbon',
            title: 'Lisbon forecast',
            encrypted_index: 'idx2',
            cited_text: 'Light winds after 6pm.',
          },
        ],
      });
      finish('end_turn', { usage: { server_tool_use: { web_search_requests: 1 } } });
      return;
    }

    if (text.includes('slow')) {
      await thinking('Writing a long story.');
      const i = index++;
      send('content_block_start', { index: i, content_block: { type: 'text', text: '' } });
      for (let n = 0; n < 400 && !closed; n++) {
        send('content_block_delta', { index: i, delta: { type: 'text_delta', text: `Word${n} ` } });
        await sleep(40);
      }
      send('content_block_stop', { index: i });
      finish('end_turn');
      return;
    }

    if (text.includes('code')) {
      await thinking('A short Python example will do.');
      await textBlock(
        'Here is a small example:\n\n```python\ndef greet(name):\n    return f"Hello, {name}!"\n\nprint(greet("Sam"))\n```\n\nRun it with `python3 hello.py`.',
      );
      finish('end_turn');
      return;
    }

    await thinking('The user said hello. I will answer warmly and show some formatting.');
    await textBlock(
      '## Hello from mock\n\nNice to meet you! Here is what I can do:\n\n- Answer **questions**\n- Help you *write*\n- Explain things step by step\n\n| Thing | Good for |\n|---|---|\n| Lists | Quick scanning |\n| Tables | Comparing |\n\nWhat would you like to do next?',
    );
    finish('end_turn');
  });

  return {
    server,
    requests,
    listen: () =>
      new Promise((resolve) => {
        server.listen(0, '127.0.0.1', () => resolve(`http://127.0.0.1:${server.address().port}`));
      }),
    close: () => new Promise((resolve) => server.close(resolve)),
  };
}

module.exports = { createServer, VALID_KEY };

if (require.main === module) {
  const mock = createServer();
  mock.listen().then((url) => console.log(`Mock Claude API running at ${url}`));
}
