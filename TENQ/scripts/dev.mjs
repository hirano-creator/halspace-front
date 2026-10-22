// 画面（Vite）と API（wrangler dev）を同時に起動する。Ctrl+C で両方止まる。
import { spawn } from 'node:child_process';

const procs = [
  ['api', 'npm run dev -w api'],
  ['web', 'npm run dev -w web'],
].map(([name, cmd]) => {
  const p = spawn(cmd, { shell: true, stdio: ['inherit', 'pipe', 'pipe'] });
  const tag = (s) => s.toString().split(/\r?\n/).filter(Boolean).map((l) => `[${name}] ${l}`).join('\n') + '\n';
  p.stdout.on('data', (d) => process.stdout.write(tag(d)));
  p.stderr.on('data', (d) => process.stderr.write(tag(d)));
  p.on('exit', (code) => { console.log(`[${name}] 終了 (${code})`); procs.forEach((q) => q.kill()); process.exit(code ?? 0); });
  return p;
});
process.on('SIGINT', () => procs.forEach((p) => p.kill()));
