/**
 * documentPool.js
 *
 * Runs document text extraction in worker threads so large PDFs never block the API server's
 * event loop, uses several CPU cores, and can be stopped by a real timeout (a worker that hangs
 * is terminated and replaced; the file is reported as an error and retried on the next sync).
 */
import { Worker } from 'worker_threads';
import { cpus } from 'os';
import { fileURLToPath } from 'url';

const WORKER_FILE = fileURLToPath(new URL('./documentWorker.js', import.meta.url));
const POOL_SIZE = Math.max(1, Math.min(3, cpus().length - 1));
const TASK_TIMEOUT_MS = 120_000;

const idle = [];
const queue = [];
let nextId = 1;
let live = 0;

function spawn() {
  live++;
  const worker = new Worker(WORKER_FILE);
  worker.unref();
  worker.on('error', () => {});          // handled per task through exit/timeout
  return worker;
}

function release(worker) {
  idle.push(worker);
  pump();
}

function pump() {
  while (queue.length && (idle.length || live < POOL_SIZE)) {
    const task = queue.shift();
    run(idle.pop() ?? spawn(), task);
  }
}

function run(worker, { buffer, meta, resolve }) {
  const id = nextId++;
  let done = false;
  const finish = (result, replace) => {
    if (done) return;
    done = true;
    clearTimeout(timer);
    worker.off('message', onMessage);
    worker.off('exit', onExit);
    if (replace) { live--; worker.terminate().catch(() => {}); pump(); } else release(worker);
    resolve(result);
  };
  const onMessage = (m) => { if (m.id === id) finish(m.result, false); };
  const onExit = () => finish({ status: 'error', text: null, error: 'extraction worker crashed' }, true);
  const timer = setTimeout(
    () => finish({ status: 'error', text: null, error: `extraction timed out after ${TASK_TIMEOUT_MS / 1000}s` }, true),
    TASK_TIMEOUT_MS,
  );
  worker.on('message', onMessage);
  worker.on('exit', onExit);
  const bytes = new Uint8Array(buffer);        // copy: Buffer may share a pooled ArrayBuffer
  worker.postMessage({ id, bytes, meta }, [bytes.buffer]);
}

/** Extracts text in a worker thread. Resolves (never rejects) with { status, text, error }. */
export function extractTextInWorker(buffer, meta) {
  return new Promise((resolve) => {
    queue.push({ buffer, meta, resolve });
    pump();
  });
}
