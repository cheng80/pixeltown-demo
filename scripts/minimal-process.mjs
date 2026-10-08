import { createServer } from 'node:net';
import { setTimeout as delay } from 'node:timers/promises';

export async function assertFree(port) {
  const probe = createServer();
  await new Promise((resolve, reject) => {
    probe.once('error', () => reject(new Error(`포트 ${port}가 사용 중입니다. 기존 서버는 그대로 둡니다.`)));
    probe.listen(port, '127.0.0.1', () => probe.close(resolve));
  });
}

export async function waitReady(url, child, timeout = 25000) {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) {
    if (child.exitCode !== null || child.signalCode) throw new Error('Minimal process exited before ready');
    try { if ((await fetch(url, { signal: AbortSignal.timeout(750) })).ok) return; } catch {}
    await delay(100);
  }
  throw new Error('Minimal process readiness timed out');
}

export async function stopChild(child) {
  if (!child?.pid || child.exitCode !== null || child.signalCode) return;
  const exited = new Promise(resolve => child.once('exit', resolve));
  child.kill('SIGTERM');
  // Colyseus may need to finish a tick and persist its outbox.
  await Promise.race([exited, delay(15000, undefined, { ref: false })]);
  if (child.exitCode === null && !child.signalCode) {
    child.kill('SIGKILL');
    await exited;
  }
}
