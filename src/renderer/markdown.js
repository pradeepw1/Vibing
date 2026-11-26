// Markdown -> safe HTML, with code highlighting, copy/preview buttons and math.

import { Marked, Renderer } from '/vendor/marked.js';
import DOMPurify from '/vendor/purify.js';
import hljs from '/vendor/highlight.js';
import katex from '/vendor/katex/katex.mjs';

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
  htm: 'xml',
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

// Code that can be shown as a live preview: web pages, SVG pictures and Mermaid diagrams.
export function previewKind(lang, code) {
  const name = (lang || '').toLowerCase();
  if (name === 'html' || name === 'htm') return 'html';
  if (name === 'svg') return 'svg';
  if (name === 'mermaid') return 'mermaid';
  if (name === 'xml' && /^\s*(<\?xml[^>]*>\s*)?<svg[\s>]/i.test(code)) return 'svg';
  return '';
}

export function previewTitle(code, kind) {
  if (kind === 'html') {
    const t = /<title[^>]*>([^<]{1,80})<\/title>/i.exec(code);
    return t ? t[1].trim() : 'Web page';
  }
  return kind === 'svg' ? 'Picture (SVG)' : 'Diagram';
}

const KIND_LABEL = { html: 'Web page', svg: 'SVG picture', mermaid: 'Diagram' };
const KIND_GLYPH = { html: '&lt;/&gt;', svg: 'SVG', mermaid: '◇' };
// Longer previewable code shows as a compact card (like Claude's artifacts) instead of a wall of code.
const CARD_MIN_LINES = 12;

// ---------------------------------------------------------------------------------------------
// Math. TeX is pulled out before Markdown runs (so underscores and backslashes survive),
// left as a placeholder through sanitizing, then drawn by KaTeX.

// Math inside a sentence uses a <span> (a <div> there would break the paragraph in two).
function mathPlaceholder(tex, display, inSentence) {
  const tag = inSentence ? 'span' : 'div';
  const fallback = display ? `$$${tex}$$` : `$${tex}$`;
  return `<${tag} class="math ${display ? 'math-block' : 'math-inline'}" data-tex="${escapeHtml(tex)}">${escapeHtml(fallback)}</${tag}>`;
}

const BLOCK_MATH = /^[ \t]*(?:\$\$([\s\S]+?)\$\$|\\\[([\s\S]+?)\\\])[ \t]*(?:\n+|$)/;

const mathExtension = {
  extensions: [
    {
      name: 'mathBlock',
      level: 'block',
      // Only a line that starts with $$ or \[ can begin a math block.
      start(src) {
        const m = /(^|\n)[ \t]*(?:\$\$|\\\[)/.exec(src);
        return m ? m.index + m[1].length : undefined;
      },
      tokenizer(src) {
        const m = BLOCK_MATH.exec(src);
        if (!m) return undefined;
        return { type: 'mathBlock', raw: m[0], text: (m[1] ?? m[2]).trim() };
      },
      renderer(token) {
        return mathPlaceholder(token.text, true, false);
      },
    },
    {
      name: 'mathInline',
      level: 'inline',
      start(src) {
        const m = /\$|\\\(|\\\[/.exec(src);
        return m ? m.index : undefined;
      },
      tokenizer(src) {
        let m = /^\$\$((?:\\[\s\S]|[^\\$])+?)\$\$/.exec(src);
        if (m) return { type: 'mathInline', raw: m[0], text: m[1].trim(), display: true };
        m = /^\\\(([\s\S]+?)\\\)/.exec(src);
        if (m) return { type: 'mathInline', raw: m[0], text: m[1].trim(), display: false };
        m = /^\\\[([\s\S]+?)\\\]/.exec(src);
        if (m) return { type: 'mathInline', raw: m[0], text: m[1].trim(), display: true };
        // $...$ - but not prices like "$5 and $10": no space just inside the dollar signs,
        // and no digit right after the closing one.
        m = /^\$(?![\s$])((?:\\[\s\S]|[^\\$\n])+?)(?<![\s\\])\$(?![\d$])/.exec(src);
        if (m) return { type: 'mathInline', raw: m[0], text: m[1], display: false };
        return undefined;
      },
      renderer(token) {
        return mathPlaceholder(token.text, token.display, true);
      },
    },
  ],
};

const mathCache = new Map();

function renderTex(tex, display) {
  const key = `${display ? 'D' : 'I'}${tex}`;
  let html = mathCache.get(key);
  if (html === undefined) {
    try {
      html = katex.renderToString(tex, {
        displayMode: display,
        throwOnError: false,
        strict: 'ignore',
        trust: false,
        output: 'html', // (no hidden MathML copy, so selecting and copying text stays clean)
      });
    } catch {
      html = null;
    }
    if (mathCache.size > 500) mathCache.clear();
    mathCache.set(key, html);
  }
  return html;
}

// Draw any math placeholders inside `root`. KaTeX's own output is safe (trust: false),
// so it goes in after the Markdown has been sanitized.
export function typesetMath(root) {
  for (const el of root.querySelectorAll('.math[data-tex]:not([data-done])')) {
    const html = renderTex(el.getAttribute('data-tex'), el.classList.contains('math-block'));
    if (html) el.innerHTML = html;
    el.setAttribute('data-done', '');
  }
}

// ---------------------------------------------------------------------------------------------

const marked = new Marked({ gfm: true, breaks: false });

marked.use(mathExtension, {
  renderer: {
    code({ text, lang }) {
      const language = (lang || '').trim().split(/\s+/)[0] || '';
      const label = language || 'text';
      const code = text.replace(/\n$/, '');
      const kind = previewKind(language, code);
      const previewBtn = kind
        ? '<button class="copy-code" type="button" data-action="preview-code">Preview</button>'
        : '';
      const lines = code.split('\n').length;
      if (kind && lines >= CARD_MIN_LINES) {
        return (
          `<div class="codeblock artifact collapsed" data-lang="${escapeHtml(language.toLowerCase())}">` +
          `<div class="artifact-head"><div class="artifact-icon">${KIND_GLYPH[kind]}</div>` +
          `<div class="artifact-meta"><div class="artifact-title">${escapeHtml(previewTitle(code, kind))}</div>` +
          `<div class="artifact-sub">${KIND_LABEL[kind]} · ${lines} lines</div></div>` +
          `<span class="codeblock-actions">${previewBtn}` +
          '<button class="copy-code" type="button" data-action="toggle-code">Show code</button>' +
          '<button class="copy-code" type="button" data-action="copy-code">Copy</button></span></div>' +
          `<pre><code class="hljs">${highlight(code, language)}</code></pre></div>`
        );
      }
      return (
        `<div class="codeblock" data-lang="${escapeHtml(language.toLowerCase())}"><div class="codeblock-head"><span class="codeblock-lang">${escapeHtml(label)}</span>` +
        `<span class="codeblock-actions">${previewBtn}<button class="copy-code" type="button" data-action="copy-code">Copy</button></span></div>` +
        `<pre><code class="hljs">${highlight(code, language)}</code></pre></div>`
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
