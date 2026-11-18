// The Orca CLI supplies tail and a separate UI draft. Only tail is passed here.
import { stripVTControlCharacters } from 'node:util';

const privateKeyStart = /-----BEGIN [A-Z ]*PRIVATE KEY-----/;
const privateKeyEnd = /-----END [A-Z ]*PRIVATE KEY-----/;
const credentialField = /(?:^|[^a-z0-9])[\w-]{0,32}(?:pass(?:word|wd|phrase)|pwd|secrets?|credentials?|cookies?|authorization|token|session[_-]?id|(?:api|bind|signing|secret|private|access|session)[_-]?key(?:[_-]?id)?)(?:["']?\s*[:=]|[-_]\S|\s+\S)/i;
const knownToken = /\b(?:sk-(?:proj-|ant-)?[\w-]{12,}|(?:gh[pousr]_|github_pat_|glpat-|xox[baprs]-|hf_)[\w-]{10,}|(?:AKIA|ASIA)[A-Z0-9]{16}|eyJ[\w-]+\.[\w-]+\.[\w-]+)/g;

export function terminalExcerpt(tail) {
  // Strip string controls before CSI and other escapes so hidden OSC/DCS
  // payloads (including clipboard data) cannot become visible plaintext.
  const visible = stripVTControlCharacters(tail.join('\n')
    .replace(/(?:\x1b\]|\x9d)[\s\S]*?(?:\x07|\x1b\\|\x9c|$)/g, '')
    .replace(/(?:\x1b[PX^_]|[\x90\x98\x9e\x9f])[\s\S]*?(?:\x1b\\|\x9c|$)/g, ''))
    .replace(/\r\n?/g, '\n').replace(/[\x00-\x08\x0b\x0c\x0e-\x1f\x7f-\x9f\u200b-\u200f\u202a-\u202e\u2066-\u2069]/g, '');
  // A bounded read can start inside a PEM block. Its visible footer marks
  // the preceding fragment as sensitive even when the header rolled off.
  const begin = visible.search(privateKeyStart);
  const end = visible.search(privateKeyEnd);
  let inKey = end >= 0 && (begin < 0 || end < begin);
  const lines = [];
  for (let line of visible.split('\n')) {
    if (privateKeyStart.test(line)) inKey = true;
    if (inKey) {
      if (privateKeyEnd.test(line)) inKey = false;
      continue;
    }
    if (credentialField.test(line) || /^\s*(?:export\s+)?[A-Z_][A-Z0-9_]*=\S/.test(line) ||
        /^[a-zA-Z0-9+/]{48,}={0,2}$/.test(line.trim())) {
      lines.push('[redacted]');
      continue;
    }
    line = line.replace(/\b[a-z][\w+.-]*:\/\/[^\s<>"']+/gi, '[redacted]')
      .replace(/\b(?:Bearer|Basic)\s+[A-Za-z0-9._~+\/=-]+/gi, '[redacted]')
      .replace(knownToken, '[redacted]');
    lines.push(line.trimEnd());
  }
  const bytes = Buffer.from(lines.join('\n').trim());
  let start = Math.max(0, bytes.length - 8192);
  // Keep a valid UTF-8 prefix at the truncation boundary.
  while (start < bytes.length && (bytes[start] & 0xc0) === 0x80) start++;
  const text = bytes.toString('utf8', start);
  return /[\p{L}\p{N}]/u.test(text.replaceAll('[redacted]', '')) ? text : '';
}
