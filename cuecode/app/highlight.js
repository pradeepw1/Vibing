// A small syntax colourer. Written here because the usual libraries either skip
// COBOL and JCL or get their column rules wrong, and the app must work offline.
(function (root) {
  const esc = (s) => s.replace(/[&<>]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c]));
  const span = (cls, text) => `<span class="t-${cls}">${esc(text)}</span>`;
  const set = (s) => new Set(s.split(/\s+/).filter(Boolean));

  // C-family and script languages share one tokenizer with different word lists.
  const SCRIPT = {
    python: {
      comment: /#.*/y,
      string: /f?r?"""[\s\S]*?"""|f?r?'''[\s\S]*?'''|[fr]?"(?:\\.|[^"\\\n])*"|[fr]?'(?:\\.|[^'\\\n])*'/y,
      keywords: set('and as assert async await break class continue def del elif else except finally for from global if import in is lambda None nonlocal not or pass raise return True False try while with yield'),
      types: set('int float str bool list dict set tuple print len range sorted sum input open'),
    },
    swift: {
      comment: /\/\/.*|\/\*[\s\S]*?\*\//y,
      string: /"(?:\\.|[^"\\\n])*"/y,
      keywords: set('actor as async await break case catch class continue default defer do else enum extension false fileprivate for func guard if import in init inout internal let mutating nil private protocol public repeat return self static struct super switch throw throws true try var where while some any'),
      types: set('Int Double Float String Bool Array Dictionary Set Optional Error Decimal View Text VStack HStack Button Link URL Task'),
      attribute: /@[A-Za-z]+/y,
    },
    java: {
      comment: /\/\/.*|\/\*[\s\S]*?\*\//y,
      string: /"(?:\\.|[^"\\\n])*"|'(?:\\.|[^'\\\n])'/y,
      keywords: set('abstract break case catch class continue default do else enum extends false final finally for if implements import instanceof interface new null package private protected public record return static super switch this throw throws true try var void while'),
      types: set('int double float long short byte char boolean String Integer Double Boolean List Map ArrayList LinkedHashMap Optional System Math BigDecimal Scanner Object'),
      attribute: /@[A-Za-z]+/y,
    },
    js: {
      comment: /\/\/.*|\/\*[\s\S]*?\*\//y,
      string: /`(?:\\[\s\S]|[^`\\])*`|"(?:\\.|[^"\\\n])*"|'(?:\\.|[^'\\\n])*'/y,
      keywords: set('async await break case catch class const continue default delete do else export extends false finally for from function if import in instanceof let new null of return static super switch this throw true try typeof undefined var void while yield'),
      types: set('console document window Math JSON Object Array Promise Number String Map Set fetch'),
    },
  };
  SCRIPT.ts = {
    ...SCRIPT.js,
    keywords: new Set([...SCRIPT.js.keywords, ...set('as enum implements interface keyof private protected public readonly type')]),
    types: new Set([...SCRIPT.js.types, ...set('string number boolean unknown any never Record Promise HTMLElement HTMLButtonElement HTMLInputElement HTMLFormElement HTMLDivElement HTMLHeadingElement')]),
  };
  SCRIPT.sql = {
    comment: /--.*/y,
    string: /'(?:''|[^'])*'/y,
    keywords: set('SELECT FROM WHERE ORDER BY GROUP HAVING INSERT INTO VALUES UPDATE SET DELETE CREATE TABLE JOIN ON AND OR NOT NULL AS'),
    types: set('TEXT REAL INTEGER'),
  };
  SCRIPT.json = {
    string: /"(?:\\.|[^"\\\n])*"/y,
    keywords: set('true false null'),
    types: new Set(),
  };

  const WORD = /[A-Za-z_$][\w$]*/y;
  const NUMBER = /\d[\d_]*(?:\.\d+)?/y;

  function script(code, def) {
    let out = '';
    let i = 0;
    const take = (re) => {
      if (!re) return null;
      re.lastIndex = i;
      const m = re.exec(code);
      return m && m[0].length ? m[0] : null;
    };
    while (i < code.length) {
      let t;
      if ((t = take(def.comment))) { out += span('com', t); i += t.length; continue; }
      if ((t = take(def.string))) { out += span('str', t); i += t.length; continue; }
      if ((t = take(def.attribute))) { out += span('attr', t); i += t.length; continue; }
      if ((t = take(NUMBER))) { out += span('num', t); i += t.length; continue; }
      if ((t = take(WORD))) {
        const next = code[i + t.length];
        if (def.keywords.has(t)) out += span('kw', t);
        else if (def.types.has(t)) out += span('type', t);
        else if (next === '(') out += span('fn', t);
        else out += esc(t);
        i += t.length;
        continue;
      }
      out += esc(code[i]);
      i += 1;
    }
    return out;
  }

  const COBOL_WORDS = set(`ACCEPT ADD AFTER ALL AND ASCENDING ASSIGN AT BY CALL CLOSE COMPUTE CONTINUE COPY
    DATA DELIMITED DESCENDING DISPLAY DIVIDE DIVISION ELSE END END-CALL END-COMPUTE END-DIVIDE END-EVALUATE END-EXEC
    END-IF END-PERFORM END-READ END-SEARCH END-STRING ENVIRONMENT EVALUATE EXEC EXIT FD FILE FILE-CONTROL FOR
    FROM FUNCTION GIVING GOBACK IDENTIFICATION IF INDEXED INPUT INPUT-OUTPUT INSPECT INTO IS KEY LEADING LINE LINKAGE
    MOVE NOT OCCURS OF ON OPEN OR ORGANIZATION OTHER OUTPUT PERFORM PROCEDURE PROGRAM-ID READ REDEFINES REMAINDER
    ROUNDED RUN SEARCH SECTION SELECT SEQUENTIAL SET SIZE SORT SPACE SPACES STATUS STOP STRING SUBTRACT TALLYING TEST
    THAN THEN TIMES TO TRUE FALSE UNTIL USING VALUE VARYING WHEN WITH WORKING-STORAGE WRITE ZERO ZEROS ERROR
    SQL CICS SEND MAP MAPSET RETURN TRANSID ERASE COMMAREA`);
  const COBOL_RE = /("(?:[^"\n])*"|'(?:[^'\n])*')|(\bPIC(?:TURE)?\s+[A-Z0-9()V.,S+-]+?(?=[\s.]*(?:\s|$)))|(\bCOMP(?:-\d)?\b)|([A-Za-z0-9][A-Za-z0-9-]*)|(:[A-Z][A-Z0-9-]*)/g;

  function cobolLine(line) {
    if (/^.{6}\*/.test(line) || /^\s*\*>/.test(line)) return span('com', line);
    const level = line.match(/^(\s{7,})(\d{2})(\s)/);
    let out = '';
    let body = line;
    if (level) {
      out = level[1] + span('label', level[2]) + level[3];
      body = line.slice(level[0].length);
    }
    let last = 0;
    for (const m of body.matchAll(COBOL_RE)) {
      out += esc(body.slice(last, m.index));
      last = m.index + m[0].length;
      if (m[1]) out += span('str', m[0]);
      else if (m[2] || m[3]) out += span('type', m[0]);
      else if (m[5]) out += span('attr', m[0]);
      else if (COBOL_WORDS.has(m[0])) out += span('kw', m[0]);
      else if (/^\d+$/.test(m[0])) out += span('num', m[0]);
      else out += esc(m[0]);
    }
    return out + esc(body.slice(last));
  }

  function jclLine(line) {
    if (line.startsWith('//*')) return span('com', line);
    if (line.startsWith('/*')) return span('kw', line);
    const m = line.match(/^(\/\/\S*)(\s+)(JOB|EXEC|DD|PROC|PEND|IF|THEN|ELSE|ENDIF)?(\s*)(.*)$/);
    if (!m) return esc(line);
    const params = m[5].replace(/[&<>]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c]))
      .replace(/([A-Z]+)=/g, '<span class="t-attr">$1</span>=')
      .replace(/'[^']*'/g, (s) => `<span class="t-str">${s}</span>`);
    return span('label', m[1]) + m[2] + (m[3] ? span('kw', m[3]) : '') + m[4] + params;
  }

  function html(code) {
    let out = '';
    let i = 0;
    const re = /<!--[\s\S]*?-->|<!doctype[^>]*>|<\/?[a-zA-Z][\w-]*(?:\s+[\w-:]+(?:=(?:"[^"]*"|'[^']*'|[^\s>]+))?)*\s*\/?>/gi;
    for (const m of code.matchAll(re)) {
      out += esc(code.slice(i, m.index));
      i = m.index + m[0].length;
      const tag = m[0];
      if (tag.startsWith('<!')) { out += span('com', tag); continue; }
      out += tag.replace(/^(<\/?)([a-zA-Z][\w-]*)|(\s)([\w-:]+)(=)("[^"]*"|'[^']*'|[^\s>]+)?|(\s)([\w-:]+)(?=[\s>/])|(\/?>)$/g,
        (all, open, name, sp, attr, eq, val, sp2, bare, close) => {
          if (open) return esc(open) + span('tag', name);
          if (attr) return sp + span('attr', attr) + eq + (val ? span('str', val) : '');
          if (bare) return sp2 + span('attr', bare);
          if (close) return esc(close);
          return esc(all);
        });
      // Colour the script's content as JavaScript.
      if (/^<script\b/i.test(tag) && !/\ssrc=/.test(tag)) {
        const end = code.toLowerCase().indexOf('</script', i);
        if (end > i) { out += script(code.slice(i, end), SCRIPT.js); i = end; }
      }
    }
    return out + esc(code.slice(i));
  }

  function css(code) {
    let out = '';
    let depth = 0;
    const re = /\/\*[\s\S]*?\*\/|"[^"]*"|'[^']*'|[{}]|[^{}"'/]+|\//g;
    for (const m of code.matchAll(re)) {
      const t = m[0];
      if (t.startsWith('/*')) out += span('com', t);
      else if (t[0] === '"' || t[0] === "'") out += span('str', t);
      else if (t === '{') { depth += 1; out += '{'; } else if (t === '}') { depth -= 1; out += '}'; } else if (depth === 0 || !/:/.test(t)) {
        out += t.trim().startsWith('@')
          ? t.replace(/@[\w-]+/, (a) => span('kw', a))
          : `<span class="t-tag">${esc(t)}</span>`;
      } else {
        out += esc(t).replace(/([\w-]+)(\s*:\s*)([^;\n]*)/g, (all, prop, colon, val) =>
          `${span('attr', prop).replace(/&amp;/g, '&')}${colon}<span class="t-str">${val}</span>`);
      }
    }
    return out;
  }

  function bash(code) {
    return code.split('\n').map((line) => {
      if (/^\s*#/.test(line)) return span('com', line);
      const m = line.match(/^(\s*)(\S+)(.*)$/);
      return m ? m[1] + span('fn', m[2]) + esc(m[3]) : esc(line);
    }).join('\n');
  }

  function highlight(code, lang) {
    if (SCRIPT[lang]) return script(code, SCRIPT[lang]);
    if (lang === 'cobol') return code.split('\n').map(cobolLine).join('\n');
    if (lang === 'jcl') return code.split('\n').map(jclLine).join('\n');
    if (lang === 'html') return html(code);
    if (lang === 'css') return css(code);
    if (lang === 'bash') return bash(code);
    return esc(code);
  }

  (root.Cuecode ??= {}).highlight = highlight;
})(globalThis);
