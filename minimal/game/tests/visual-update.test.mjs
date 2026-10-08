import test from 'node:test';
import assert from 'node:assert/strict';
import { validateVisualManifest } from '../src/visual-update.js';
const revision = 'a'.repeat(64), compatibility = 'b'.repeat(64), origin = 'https://pixeltown.fastmake.net';
const manifest = () => ({ schema: 1, revision, compatibility, entry: `/visual/releases/${revision}/assets/visual.js`, styles: [], fonts: [], images: [] });
test('visual release accepts only the same origin and immutable version directory', () => {
  assert.equal(validateVisualManifest(manifest(), compatibility, origin).revision, revision);
  for (const entry of ['https://elsewhere.test/file.js', '/src/main.jsx', `/visual/releases/${revision}/../other.js`, `/visual/releases/${revision}/entry.js?change=1`]) {
    assert.throws(() => validateVisualManifest({ ...manifest(), entry }, compatibility, origin));
  }
  assert.throws(() => validateVisualManifest({ ...manifest(), images: [{ name: 'avatar', url: '/avatar.png' }] }, compatibility, origin));
});
test('incompatible shell or map is retained without importing a new renderer', () => {
  assert.equal(validateVisualManifest(manifest(), 'c'.repeat(64), origin), null);
  assert.throws(() => validateVisualManifest({ ...manifest(), schema: 2 }, compatibility, origin));
});
