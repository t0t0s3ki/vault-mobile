// Rebuild PNGs from the editable SVG. Requires sharp (or NODE_PATH pointing to it).
// Usage: node scripts/generate-icons.cjs
const fs = require('node:fs/promises');
const path = require('node:path');
const sharp = require('sharp');
const root = path.resolve(__dirname, '..');
(async () => {
  const source = path.join(root, 'public/vault-icon-v2.svg');
  for (const [name, size] of [['apple-touch-icon-v2',180], ['vault-icon-v2-192',192], ['vault-icon-v2-512',512], ['vault-icon-v2-maskable-512',512]]) {
    const target = path.join(root, 'public', `${name}.png`);
    await sharp(source).resize(size,size).removeAlpha().png().toFile(target);
    const meta = await sharp(target).metadata();
    if(meta.width !== size || meta.height !== size || meta.hasAlpha) throw new Error(`Invalid icon: ${name}`);
    console.log(`${name}.png: ${size}x${size}, opaque`);
  }
})();
