// Worker thread entry: extracts text from one file at a time (see documentPool.js).
import { parentPort } from 'worker_threads';
import { extractText } from './documentExtract.js';

parentPort.on('message', async ({ id, bytes, meta }) => {
  const result = await extractText(Buffer.from(bytes), meta);
  parentPort.postMessage({ id, result });
});
