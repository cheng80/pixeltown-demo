// nanoid 2.x default-export API (`nanoid(size)`) for @colyseus/core 0.16, which ships a vulnerable nanoid 2.1.11
// and breaks on nanoid 3's named exports. 64-symbol alphabet, so `byte & 63` is unbiased; size must be a sane integer.
const { randomBytes } = require('node:crypto');
const alphabet = 'useandom-26T198340PX75pxJACKVERYMINDBUSHWOLF_GQZbfghjklqvwyzrict';
module.exports = (size = 21) => {
  if (!Number.isInteger(size) || size < 1 || size > 1024) throw new RangeError('nanoid size must be an integer 1..1024');
  let id = '';
  for (const byte of randomBytes(size)) id += alphabet[byte & 63];
  return id;
};
