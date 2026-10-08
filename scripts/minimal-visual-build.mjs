import { createHash } from 'node:crypto';
import { mkdirSync, readFileSync, readdirSync, writeFileSync, copyFileSync, existsSync, statSync } from 'node:fs';
import { resolve, relative, join } from 'node:path';

const ROOT = resolve(import.meta.dirname, '..');
const files = dir => readdirSync(dir).sort().flatMap(name => {
  const path = join(dir, name); return statSync(path).isDirectory() ? files(path) : [path];
});
const digest = paths => {
  const hash = createHash('sha256');
  for (const path of [...paths].sort()) hash.update(relative(ROOT, path)).update('\0').update(readFileSync(path)).update('\0');
  return hash.digest('hex');
};
export function minimalVisualBuild() {
  let config, compatibility, revision;
  return {
    name: 'minimal-visual-release', apply: 'build',
    config() {
      // Stable shell changes require a new page. Visual-only changes share this compatibility hash.
      compatibility = digest(['main.jsx', 'WorldCanvas.jsx', 'engine.js', 'visual-update.js', 'VisualStatus.jsx', 'api.js', 'state.js', 'playback.js']
        .map(name => resolve(ROOT, 'minimal/game/src', name)).concat(resolve(ROOT, 'minimal/shared/world.js'), resolve(ROOT, 'package-lock.json')));
      revision = createHash('sha256').update(compatibility).update(digest([
        resolve(ROOT, 'minimal/game/src/visual-release.js'), resolve(ROOT, 'minimal/game/src/art.js'), resolve(ROOT, 'minimal/game/src/style.css'),
        ...files(resolve(ROOT, 'minimal/game/public')),
      ])).digest('hex');
      return {
        define: { __MINIMAL_VISUAL_COMPAT__: JSON.stringify(compatibility), __MINIMAL_VISUAL_REVISION__: JSON.stringify(revision) },
        build: { rollupOptions: { preserveEntrySignatures: 'strict', input: { main: resolve(ROOT, 'minimal/game/index.html'), visual: resolve(ROOT, 'minimal/game/src/visual-release.js') } } },
      };
    },
    configResolved(resolved) { config = resolved; },
    writeBundle(_options, bundle) {
      const out = resolve(config.root, config.build.outDir);
      const store = resolve(process.env.MINIMAL_VISUAL_STORE || resolve(ROOT, '.local/minimal/frontend-releases'));
      const releaseRoot = resolve(store, revision), prefix = `/visual/releases/${revision}/`;
      mkdirSync(releaseRoot, { recursive: true });
      const put = (name, data) => {
        const dest = resolve(releaseRoot, name); mkdirSync(resolve(dest, '..'), { recursive: true });
        if (existsSync(dest) && !readFileSync(dest).equals(Buffer.from(data))) throw new Error(`Immutable visual release changed: ${name}`);
        writeFileSync(dest, data);
      };
      const entry = Object.values(bundle).find(item => item.type === 'chunk' && item.isEntry && item.facadeModuleId?.endsWith('/visual-release.js'));
      if (!entry) throw new Error('Missing visual entry');
      const required = new Set();
      const include = name => {
        if (required.has(name)) return;
        required.add(name);
        for (const dep of [...(bundle[name]?.imports || []), ...(bundle[name]?.dynamicImports || [])]) if (bundle[dep]) include(dep);
      };
      include(entry.fileName);
      const styles = [];
      for (const item of Object.values(bundle)) {
        if (item.type === 'chunk') { if (required.has(item.fileName)) put(item.fileName, item.code.replaceAll('"/assets/', `"${prefix}assets/`).replaceAll("'/assets/", `'${prefix}assets/`)); }
        else {
          let source = item.source;
          if (item.fileName.endsWith('.css')) {
            source = String(source).replaceAll('Galmuri11', `PixelTown_${revision}`).replaceAll('/fonts/', `${prefix}fonts/`).replaceAll('/assets/', `${prefix}assets/`);
            styles.push(prefix + item.fileName);
          }
          put(item.fileName, source);
        }
      }
      const images = [], fonts = [];
      for (const source of files(resolve(ROOT, 'minimal/game/public'))) {
        const name = relative(resolve(ROOT, 'minimal/game/public'), source).split('\\').join('/');
        if (name.startsWith('_') || name.startsWith('visual/')) continue;
        put(name, readFileSync(source));
        if (/\.(png|jpe?g|webp|gif|svg|avif)$/i.test(name)) images.push({ name, url: prefix + name });
        if (/^fonts\/Galmuri11(?:-Bold)?\.woff2$/.test(name)) fonts.push({ url: prefix + name, weight: name.includes('-Bold') ? '700' : '400' });
      }
      const inventory = files(releaseRoot).filter(path => !path.endsWith('/manifest.json')).map(path => ({
        path: relative(releaseRoot, path).split('\\').join('/'), sha256: createHash('sha256').update(readFileSync(path)).digest('hex'),
      }));
      const manifest = { schema: 1, revision, compatibility, entry: prefix + entry.fileName, styles, fonts, images, files: inventory };
      writeFileSync(resolve(releaseRoot, 'manifest.json'), JSON.stringify(manifest, null, 2) + '\n');
      // Every publication carries old immutable files. Never delete a release automatically.
      for (const source of files(store)) {
        const dest = resolve(out, 'visual/releases', relative(store, source)); mkdirSync(resolve(dest, '..'), { recursive: true }); copyFileSync(source, dest);
      }
      writeFileSync(resolve(out, 'visual/current.json'), JSON.stringify(manifest, null, 2) + '\n');
      writeFileSync(resolve(out, 'visual/releases.json'), JSON.stringify({ schema: 1, releases: readdirSync(store).filter(name => /^[a-f0-9]{64}$/.test(name)).sort() }, null, 2) + '\n');
      writeFileSync(resolve(out, '_headers'), '/visual/current.json\n  Cache-Control: no-store\n/visual/releases.json\n  Cache-Control: no-store\n/visual/releases/*\n  Cache-Control: public, max-age=31536000, immutable\n');
      // Missing versioned files must be 404, not the SPA HTML returned as a fake script/image.
      writeFileSync(resolve(out, '404.html'), '<!doctype html><html lang="ko"><meta charset="utf-8"><title>파일을 찾을 수 없어요</title><p>파일을 찾을 수 없어요.</p><a href="/">픽셀타운으로 돌아가기</a></html>\n');
      console.log(`Visual release ${revision.slice(0, 8)}, compatibility ${compatibility.slice(0, 8)}, ${readdirSync(store).length} retained releases`);
    },
  };
}
