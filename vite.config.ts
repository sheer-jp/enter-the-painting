import { defineConfig, type Plugin } from 'vite';
import basicSsl from '@vitejs/plugin-basic-ssl';
import { readdirSync, existsSync, statSync, mkdirSync, copyFileSync } from 'node:fs';
import { resolve, join } from 'node:path';

// works/<id>/ の絵と generated/ を dist/works/<id>/ にコピーする（dev ではそのまま root から配信される）
function copyWorks(): Plugin {
  return {
    name: 'copy-works',
    apply: 'build',
    closeBundle() {
      const src = resolve('works');
      const dst = resolve('dist/works');
      if (!existsSync(src)) return;
      for (const id of readdirSync(src)) {
        const dir = join(src, id);
        if (!statSync(dir).isDirectory()) continue;
        const copyDir = (from: string, to: string) => {
          if (!existsSync(from)) return;
          mkdirSync(to, { recursive: true });
          for (const f of readdirSync(from)) {
            const p = join(from, f);
            if (statSync(p).isDirectory()) copyDir(p, join(to, f));
            else if (!/\.(wav|json\.bak)$/.test(f)) copyFileSync(p, join(to, f));
          }
        };
        copyDir(join(dir, 'generated'), join(dst, id, 'generated'));
        for (const f of ['voice.mp3', 'work.json']) {
          if (existsSync(join(dir, f))) {
            mkdirSync(join(dst, id), { recursive: true });
            copyFileSync(join(dir, f), join(dst, id, f));
          }
        }
      }
    },
  };
}

// w/<id>/index.html を MPA の入力にする
function workPages(): Record<string, string> {
  const inputs: Record<string, string> = { main: resolve('index.html') };
  const wdir = resolve('w');
  if (existsSync(wdir)) {
    for (const id of readdirSync(wdir)) {
      const p = join(wdir, id, 'index.html');
      if (existsSync(p)) inputs[`w-${id}`] = p;
    }
  }
  return inputs;
}

export default defineConfig(({ command, isPreview }) => ({
  // ホスティングのパスに依存しないよう相対にする（独自ドメインでも project site でも動く）
  base: './',
  plugins: [...(command === 'serve' && !isPreview ? [basicSsl()] : []), copyWorks()],
  build: {
    target: 'es2022',
    rollupOptions: { input: workPages() },
    chunkSizeWarningLimit: 900,
  },
  server: { host: true, port: 5173 },
}));
