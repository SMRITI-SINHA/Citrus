// Production entry: one API process per CPU core (WEB_CONCURRENCY), all stateless. Background workers are safe to run
// in every process (outbox rows are claimed with SKIP LOCKED; jobs and insights take Redis locks).
import cluster from 'node:cluster';
import { availableParallelism } from 'node:os';

const n = Number(process.env.WEB_CONCURRENCY ?? availableParallelism());
if (cluster.isPrimary) {
  for (let i = 0; i < n; i++) cluster.fork();
  cluster.on('exit', (w, code) => { if (code !== 0) { console.error(`worker ${w.process.pid} exited (${code}); restarting`); cluster.fork(); } });
} else {
  process.argv[1] = new URL('./server.ts', import.meta.url).pathname;
  await import('./server.ts');
}
