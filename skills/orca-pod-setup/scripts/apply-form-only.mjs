#!/usr/bin/env node
import { TextDecoder } from 'node:util';
import { applyFormOnly } from './form-only-config.mjs';

const MAX_INPUT_BYTES = 8 * 1024 * 1024;
const REQUIRED_FIELDS = ['cwd', 'targetPath', 'sourceHash', 'yaml'];

function invalidRequest(message) {
  return Object.assign(new Error(message), { code: 'FORM_ONLY_INVALID_REQUEST' });
}

async function readRequest() {
  const chunks = [];
  let size = 0;
  for await (const chunk of process.stdin) {
    size += chunk.length;
    if (size > MAX_INPUT_BYTES) throw invalidRequest('The form request is too large.');
    chunks.push(chunk);
  }
  let request;
  try {
    const text = new TextDecoder('utf-8', { fatal: true }).decode(Buffer.concat(chunks));
    request = JSON.parse(text);
  } catch {
    throw invalidRequest('The form request must be valid UTF-8 JSON.');
  }
  if (!request || typeof request !== 'object' || Array.isArray(request) ||
      Object.keys(request).length !== REQUIRED_FIELDS.length ||
      REQUIRED_FIELDS.some((key) => !Object.hasOwn(request, key) || typeof request[key] !== 'string')) {
    throw invalidRequest('The form request must contain cwd, targetPath, sourceHash and yaml strings.');
  }
  return request;
}

try {
  const result = applyFormOnly(await readRequest());
  console.log(JSON.stringify(result));
} catch (error) {
  const code = typeof error.code === 'string' && /^[A-Z0-9_]{1,64}$/.test(error.code) ? error.code : 'FORM_ONLY_IO_ERROR';
  const message = code.startsWith('FORM_ONLY_') ? error.message : 'Cannot save the configuration; check the error code.';
  console.log(JSON.stringify({ status: 'error', code, error: message }));
  process.exitCode = 1;
}
