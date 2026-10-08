// Test-only: observe the actual avatar canvases passed to drawImage, without changing rendering.
import { avatar, lookFor } from '../src/art.js';

function pixels(canvas) {
  let hash = 2166136261;
  for (const byte of canvas.getContext('2d').getImageData(0, 0, canvas.width, canvas.height).data) hash = Math.imul(hash ^ byte, 16777619);
  return hash >>> 0;
}

export function observeWalking(engine) {
  const expected = new Map();
  for (let frame = 0; frame < 4; frame++) expected.set(pixels(avatar(lookFor(engine.userId), 2, frame)), frame === 2 ? 0 : frame);
  const frames = new Map(), original = CanvasRenderingContext2D.prototype.drawImage;
  CanvasRenderingContext2D.prototype.drawImage = function(source, ...args) {
    if (source instanceof HTMLCanvasElement && source.width === 18 && source.height === 29) {
      const hash = pixels(source);
      if (expected.has(hash)) frames.set(expected.get(hash), (frames.get(expected.get(hash)) || 0) + 1);
    }
    return original.call(this, source, ...args);
  };
  return {
    read: () => Object.fromEntries(frames),
    clear: () => frames.clear(),
    dispose: () => { CanvasRenderingContext2D.prototype.drawImage = original; },
  };
}
