// Compiles and runs every example with the real tools, and records what passed.
//   node tools/verify.mjs            only what changed since the last pass
//   node tools/verify.mjs --all      everything
//   node tools/verify.mjs cobol      only that language (or an id such as loops/java)

import { execFile } from 'node:child_process';
import { cpSync, existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { homedir, tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';
import { CONTENT, ROOT, collectJobs, jobHash, loadContent } from './content.mjs';

const exec = promisify(execFile);
const args = process.argv.slice(2);
const all = args.includes('--all');
const filter = args.find((a) => !a.startsWith('--'));
const RECORD = join(CONTENT, 'verified.json');
const TSC = join(ROOT, 'node_modules/.bin/tsc');
const ENV = {
  ...process.env,
  PATH: `${join(homedir(), '.local/gnucobol/bin')}:${process.env.PATH}`,
  DD_NAMES: 'names.txt',     // a mainframe DD name, pointed at a test file
  NO_COLOR: '1',
};

const LANGS = {
  python: { file: () => 'main.py', compile: () => [['python3', '-m', 'py_compile', 'main.py']], run: () => [['python3', 'main.py']] },
  js: {
    file: (code) => (/\brequire\(/.test(code) ? 'main.cjs' : 'main.mjs'),
    compile: (f) => [['node', '--check', f]],
    run: (f) => [['node', '--no-warnings', f]],
  },
  ts: {
    file: () => 'main.ts',
    compile: () => [[TSC, '--noEmit', '--strict', '--target', 'es2022', '--module', 'nodenext',
      '--moduleDetection', 'force', '--skipLibCheck', '--lib', 'es2023,dom,dom.iterable',
      '--typeRoots', join(ROOT, 'node_modules/@types'), '--types', 'node', 'main.ts']],
    run: () => [['node', '--experimental-strip-types', '--no-warnings', 'main.ts']],
  },
  swift: {
    file: () => 'main.swift',
    compile: () => [['swiftc', '-typecheck', 'main.swift']],
    run: () => [['swiftc', 'main.swift', '-o', 'prog'], ['./prog']],
  },
  java: {
    file: () => 'Main.java',
    compile: () => [['javac', '-d', 'out', 'Main.java']],
    run: () => [['java', 'Main.java']],
  },
  cobol: {
    file: () => 'main.cob',
    compile: () => [['cobc', '-fsyntax-only', '-std=ibm', 'main.cob']],
    run: () => [['cobc', '-x', '-std=ibm', '-o', 'prog', 'main.cob'], ['./prog']],
  },
};

const clean = (s) => s.split('\n').map((l) => l.trimEnd()).join('\n').trimEnd();

function runOne(cmd, argv, cwd, stdin) {
  return new Promise((resolve) => {
    const child = execFile(cmd, argv, { cwd, env: ENV, timeout: 60000, maxBuffer: 1 << 22 },
      (err, stdout, stderr) => resolve({ err, stdout, stderr }));
    child.stdin.end(stdin == null ? '' : `${stdin}\n`);
  });
}

async function runJob(job) {
  const lang = LANGS[job.lang];
  const dir = mkdtempSync(join(tmpdir(), 'cuecode-'));
  try {
    cpSync(join(CONTENT, 'fixtures'), dir, { recursive: true });
    writeFileSync(join(dir, 'package.json'), '{"type":"module"}');
    const file = lang.file(job.code);
    writeFileSync(join(dir, file), job.code.endsWith('\n') ? job.code : `${job.code}\n`);
    const steps = [...lang.compile(file)];
    // Swift, Java and COBOL compile as part of running, so don't do it twice.
    if (job.mode === 'full') {
      if (['swift', 'java', 'cobol'].includes(job.lang)) steps.length = 0;
      steps.push(...lang.run(file));
    }
    let out = null;
    for (const [cmd, ...argv] of steps) {
      out = await runOne(cmd, argv, dir, job.stdin);
      if (out.err) return { ok: false, why: `${cmd} failed\n${out.stderr || out.stdout || out.err.message}` };
    }
    if (job.mode === 'full' && clean(out.stdout) !== clean(job.expected ?? '')) {
      return { ok: false, why: `output differs\n--- expected\n${clean(job.expected ?? '')}\n--- got\n${clean(out.stdout)}` };
    }
    return { ok: true };
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

async function toolVersions() {
  const first = async (cmd, argv) => {
    try {
      const r = await exec(cmd, argv, { env: ENV });
      return (r.stdout || r.stderr).split('\n')[0].trim();
    } catch { return null; }
  };
  const swift = await first('swiftc', ['--version']);
  const cobol = await first('cobc', ['--version']);
  const java = await first('java', ['--version']);
  const ts = existsSync(TSC) ? await first(TSC, ['--version']) : null;
  return {
    python: await first('python3', ['--version']),
    swift: swift?.match(/Swift version [\d.]+/)?.[0].replace('version ', '') ?? null,
    java: java ? `Java ${java.split(' ')[1]}` : null,
    cobol: cobol?.match(/\(?GnuCOBOL\)? [\d.]+/)?.[0].replace(/[()]/g, '') ?? null,
    js: `Node ${process.version.slice(1)}`,
    ts: ts?.replace('Version', 'TypeScript') ?? null,
  };
}

const content = loadContent();
const record = existsSync(RECORD) ? JSON.parse(readFileSync(RECORD, 'utf8')) : { passed: {} };
const jobs = collectJobs(content);
const wanted = jobs.filter((j) => !filter || j.lang === filter || j.id === filter || j.id.startsWith(`${filter}/`) || j.id.startsWith(`card:${filter}`));
const todo = wanted.filter((j) => all || !record.passed[jobHash(j)]);
const tools = await toolVersions();
const missing = todo.filter((j) => (j.lang === 'cobol' && !tools.cobol) || (j.lang === 'ts' && !tools.ts));
const runnable = todo.filter((j) => !missing.includes(j));

console.log(`${jobs.length} examples, ${wanted.length} selected, ${runnable.length} to run` +
  (missing.length ? `, ${missing.length} skipped (tool not installed)` : ''));

const failures = [];
let done = 0;
async function worker(queue) {
  for (let job = queue.shift(); job; job = queue.shift()) {
    const result = await runJob(job);
    done += 1;
    if (result.ok) record.passed[jobHash(job)] = job.mode;
    else {
      delete record.passed[jobHash(job)];
      failures.push({ job, why: result.why });
    }
    process.stdout.write(`\r${done}/${runnable.length}`);
  }
}
const queue = [...runnable];
await Promise.all([worker(queue), worker(queue), worker(queue)]); // 3 at once: this Mac has 8 GB
if (runnable.length) process.stdout.write('\n');

// Forget passes for code that no longer exists.
const live = new Set(jobs.map(jobHash));
for (const h of Object.keys(record.passed)) if (!live.has(h)) delete record.passed[h];
writeFileSync(RECORD, `${JSON.stringify({
  toolchains: { ...record.toolchains, ...Object.fromEntries(Object.entries(tools).filter(([, v]) => v)) },
  checkedOn: new Date().toISOString().slice(0, 10),
  passed: Object.fromEntries(Object.entries(record.passed).sort()),
}, null, 1)}\n`);

for (const { job, why } of failures) console.log(`\nFAIL ${job.id} (${job.lang})\n${why.trim().slice(0, 1200)}`);
console.log(`\n${failures.length ? `${failures.length} failed` : 'All passed'}`);
process.exit(failures.length ? 1 : 0);
