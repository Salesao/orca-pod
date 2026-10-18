import { test } from 'node:test';
import assert from 'node:assert/strict';
import { slugify } from '../src/index.js';

test('slugify: basic case', () => {
  assert.equal(slugify('Hello, World!'), 'hello-world');
});

test('slugify: diacritics and surrounding spaces', () => {
  assert.equal(slugify('  Crème brûlée  '), 'creme-brulee');
});

test('slugify: not a string — TypeError', () => {
  assert.throws(() => slugify(42), TypeError);
});
