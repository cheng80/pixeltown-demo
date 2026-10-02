import test from 'node:test';
import assert from 'node:assert/strict';
import { generateId } from '@colyseus/core';
import nanoid from 'nanoid';

test('colyseus ids come from the patched nanoid shim', () => {
  const ids = new Set(Array.from({ length: 2000 }, () => generateId()));
  assert.equal(ids.size, 2000);
  for (const id of ids) assert.match(id, /^[A-Za-z0-9_-]{9}$/);
  assert.equal(nanoid().length, 21);
  for (const bad of [0, -1, 1.5, NaN, 2 ** 40]) assert.throws(() => nanoid(bad), RangeError);
});
