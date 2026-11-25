'use strict';

// Turns a dropped/pasted/picked file into something Claude can read:
//   images -> PNG/JPEG/GIF/WebP (resized if huge, HEIC etc. converted on macOS)
//   PDFs   -> sent as-is
//   text   -> code, notes, CSV, JSON, Markdown and friends

const path = require('path');
const { nativeImage } = require('electron');
const { newId } = require('./store');

const MAX_IMAGE_BYTES = 4.5 * 1024 * 1024;
const MAX_IMAGE_EDGE = 2000;
const MAX_PDF_BYTES = 30 * 1024 * 1024;
const MAX_TEXT_BYTES = 2 * 1024 * 1024;

const API_IMAGE_TYPES = {
  'image/png': 'png',
  'image/jpeg': 'jpg',
  'image/gif': 'gif',
  'image/webp': 'webp',
};

const EXT_TO_IMAGE_TYPE = {
  png: 'image/png',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  gif: 'image/gif',
  webp: 'image/webp',
};

const CONVERTIBLE_IMAGE_EXTS = new Set(['heic', 'heif', 'tif', 'tiff', 'bmp', 'ico', 'icns']);

const TEXT_EXTS = new Set([
  'txt', 'md', 'markdown', 'csv', 'tsv', 'json', 'jsonl', 'xml', 'yaml', 'yml', 'toml', 'ini', 'cfg',
  'conf', 'log', 'html', 'htm', 'css', 'scss', 'less', 'js', 'mjs', 'cjs', 'jsx', 'ts', 'tsx', 'py',
  'rb', 'go', 'rs', 'java', 'kt', 'kts', 'swift', 'm', 'mm', 'h', 'hpp', 'c', 'cc', 'cpp', 'cs', 'php',
  'sh', 'bash', 'zsh', 'fish', 'ps1', 'sql', 'r', 'lua', 'pl', 'scala', 'dart', 'vue', 'svelte',
  'gradle', 'properties', 'env', 'gitignore', 'dockerfile', 'makefile', 'tex', 'bib', 'rst', 'srt',
  'vtt', 'ics', 'vcf', 'svg', 'graphql', 'proto', 'tf', 'hcl', 'ipynb', 'rtf',
]);

const OFFICE_EXTS = new Set(['doc', 'docx', 'xls', 'xlsx', 'ppt', 'pptx', 'pages', 'numbers', 'key', 'odt', 'ods', 'odp']);

class AttachmentError extends Error {}

function extOf(name) {
  const base = path.basename(String(name || '')).toLowerCase();
  if (base === 'dockerfile' || base === 'makefile') return base;
  const dot = base.lastIndexOf('.');
  return dot >= 0 ? base.slice(dot + 1) : '';
}

function looksLikeText(buf) {
  const sample = buf.subarray(0, Math.min(buf.length, 8192));
  if (sample.includes(0)) return false;
  try {
    new TextDecoder('utf-8', { fatal: true }).decode(sample.length < buf.length ? trimPartialUtf8(sample) : sample);
    return true;
  } catch {
    return false;
  }
}

// Avoid failing the UTF-8 check just because the sample cut a character in half.
function trimPartialUtf8(sample) {
  let i = sample.length - 1;
  let back = 0;
  while (i >= 0 && back < 3 && (sample[i] & 0xc0) === 0x80) {
    i--;
    back++;
  }
  if (i < 0) return sample;
  const lead = sample[i];
  let need = 1;
  if ((lead & 0xe0) === 0xc0) need = 2;
  else if ((lead & 0xf0) === 0xe0) need = 3;
  else if ((lead & 0xf8) === 0xf0) need = 4;
  return i + need > sample.length ? sample.subarray(0, i) : sample;
}

function processImage(name, mediaType, data) {
  const ext = API_IMAGE_TYPES[mediaType];
  let img = null;
  const needsLook = !ext || data.length > MAX_IMAGE_BYTES;
  if (needsLook || mediaType !== 'image/gif') {
    img = nativeImage.createFromBuffer(data);
  }

  if (ext && (!img || img.isEmpty())) {
    // We couldn't decode it here (e.g. WebP on some systems), so send it as-is if it's small enough.
    if (data.length <= MAX_IMAGE_BYTES) return { mediaType, ext, data };
    throw new AttachmentError(`${name} is too big. Try an image under 4 MB.`);
  }
  if (!img || img.isEmpty()) {
    throw new AttachmentError(`Buddy can't open ${name}. Try saving it as a PNG or JPEG first.`);
  }

  const { width, height } = img.getSize();
  const longEdge = Math.max(width, height);
  const tooBig = longEdge > MAX_IMAGE_EDGE || data.length > MAX_IMAGE_BYTES;
  if (ext && !tooBig) return { mediaType, ext, data };

  let out = img;
  if (longEdge > MAX_IMAGE_EDGE) {
    const scale = MAX_IMAGE_EDGE / longEdge;
    out = img.resize({ width: Math.round(width * scale), height: Math.round(height * scale), quality: 'best' });
  }
  if (mediaType === 'image/png') {
    const png = out.toPNG();
    if (png.length <= MAX_IMAGE_BYTES) return { mediaType: 'image/png', ext: 'png', data: png };
  }
  for (const quality of [90, 80, 70, 60]) {
    const jpg = out.toJPEG(quality);
    if (jpg.length <= MAX_IMAGE_BYTES) return { mediaType: 'image/jpeg', ext: 'jpg', data: jpg };
  }
  throw new AttachmentError(`${name} is too big, even after shrinking it.`);
}

/**
 * @param {{name: string, mediaType?: string, data: Buffer}} file
 * @returns {{meta: object, data: Buffer}}
 */
function prepareAttachment(file) {
  const name = path.basename(String(file.name || 'file')).slice(0, 200) || 'file';
  const data = file.data;
  if (!Buffer.isBuffer(data) || data.length === 0) {
    throw new AttachmentError(`${name} is empty.`);
  }
  const ext = extOf(name);
  let mediaType = String(file.mediaType || '').toLowerCase();
  if (!mediaType && EXT_TO_IMAGE_TYPE[ext]) mediaType = EXT_TO_IMAGE_TYPE[ext];

  const base = { id: newId(), name, size: data.length };

  const isImage =
    (mediaType.startsWith('image/') && mediaType !== 'image/svg+xml') ||
    Boolean(EXT_TO_IMAGE_TYPE[ext]) ||
    CONVERTIBLE_IMAGE_EXTS.has(ext);
  if (isImage) {
    const img = processImage(name, mediaType || `image/${ext}`, data);
    return { meta: { ...base, kind: 'image', mediaType: img.mediaType, ext: img.ext, size: img.data.length }, data: img.data };
  }

  if (mediaType === 'application/pdf' || ext === 'pdf') {
    if (data.length > MAX_PDF_BYTES) throw new AttachmentError(`${name} is too big. PDFs need to be under 30 MB.`);
    return { meta: { ...base, kind: 'pdf', mediaType: 'application/pdf', ext: 'pdf' }, data };
  }

  if (OFFICE_EXTS.has(ext)) {
    throw new AttachmentError(`Buddy can't read ${ext.toUpperCase()} files yet. Export it as a PDF and attach that instead.`);
  }

  const textish = mediaType.startsWith('text/') || TEXT_EXTS.has(ext) ||
    /(json|xml|javascript|ecmascript|x-sh|yaml|toml|csv|sql|x-python)/.test(mediaType);
  if (textish || looksLikeText(data)) {
    if (data.length > MAX_TEXT_BYTES) throw new AttachmentError(`${name} is too big. Text files need to be under 2 MB.`);
    if (!looksLikeText(data)) throw new AttachmentError(`${name} doesn't look like a text file.`);
    return { meta: { ...base, kind: 'text', mediaType: 'text/plain', ext: 'txt' }, data };
  }

  throw new AttachmentError(`Buddy can't read this kind of file (${name}). Try an image, a PDF or a text file.`);
}

module.exports = { prepareAttachment, AttachmentError };
