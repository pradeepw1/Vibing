// Markdown -> safe HTML, with code highlighting and copy buttons.

import { Marked, Renderer } from '/vendor/marked.js';
import DOMPurify from '/vendor/purify.js';
import hljs from '/vendor/highlight.js';

const escapeHtml = (s) =>
  String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');

const LANG_ALIASES = {
  js: 'javascript',
  ts: 'typescript',
  py: 'python',
  sh: 'bash',
  zsh: 'bash',
  shell: 'bash',
  console: 'bash',
  yml: 'yaml',
  md: 'markdown',
  html: 'xml',
  svg: 'xml',
  'c++': 'cpp',
  'c#': 'csharp',
  cs: 'csharp',
  rs: 'rust',
  kt: 'kotlin',
  rb: 'ruby',
  objc: 'objectivec',
};

function highlight(code, lang) {
  const name = (lang || '').toLowerCase();
  const resolved = LANG_ALIASES[name] || name;
  try {
    if (resolved && hljs.getLanguage(resolved)) {
      return hljs.highlight(code, { language: resolved, ignoreIllegals: true }).value;
    }
  } catch {
    // fall through to plain text
  }
  return escapeHtml(code);
}

const marked = new Marked({ gfm: true, breaks: false });

marked.use({
  renderer: {
    code({ text, lang }) {
      const language = (lang || '').trim().split(/\s+/)[0] || '';
      const label = language || 'text';
      return (
        `<div class="codeblock"><div class="codeblock-head"><span class="codeblock-lang">${escapeHtml(label)}</span>` +
        `<button class="copy-code" type="button" data-action="copy-code">Copy</button></div>` +
        `<pre><code class="hljs">${highlight(text.replace(/\n$/, ''), language)}</code></pre></div>`
      );
    },
    // Show raw HTML as text instead of rendering it.
    html({ text }) {
      return escapeHtml(text);
    },
    // Images from the web are not loaded (privacy); show them as links instead.
    image({ href, text }) {
      const label = escapeHtml(text || href || 'image');
      return href ? `<a href="${escapeHtml(href)}">🖼 ${label}</a>` : label;
    },
    table(token) {
      // Let marked build the table, then wrap it so wide tables scroll.
      const html = Renderer.prototype.table.call(this, token);
      return `<div class="table-wrap">${html}</div>`;
    },
  },
});

DOMPurify.addHook('afterSanitizeAttributes', (node) => {
  if (node.tagName === 'INPUT') {
    // Only the read-only checkboxes of Markdown task lists are allowed.
    if ((node.getAttribute('type') || '').toLowerCase() !== 'checkbox') node.remove();
    else node.setAttribute('disabled', '');
    return;
  }
  if (node.tagName === 'A') {
    const href = node.getAttribute('href') || '';
    if (!/^(https?:|mailto:)/i.test(href)) {
      node.removeAttribute('href');
    } else {
      node.setAttribute('target', '_blank');
      node.setAttribute('rel', 'noopener noreferrer');
    }
  }
});

const PURIFY_OPTIONS = {
  FORBID_TAGS: ['style', 'img', 'iframe', 'form', 'video', 'audio', 'svg', 'math', 'textarea', 'select'],
  FORBID_ATTR: ['style'],
  ADD_ATTR: ['target', 'data-action'],
};

export function renderMarkdown(text) {
  const html = marked.parse(String(text || ''), { async: false });
  return DOMPurify.sanitize(html, PURIFY_OPTIONS);
}

export { escapeHtml };
