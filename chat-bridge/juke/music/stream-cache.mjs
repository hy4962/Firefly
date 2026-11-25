import { createHash } from 'node:crypto';
import { createReadStream, createWriteStream, promises as fs } from 'node:fs';
import { Readable, Transform } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import path from 'node:path';
import { idleWatchdog } from './stream-timeouts.mjs';
import { fetchAudio, identifyAudio } from './audio-source.mjs';

const directory = process.env.CHAT_MUSIC_CACHE_DIR || '/opt/chat-server/data/music_cache';
const MAX_BYTES = 500 * 1024 * 1024;
const MAX_FILE = 32 * 1024 * 1024;
const MAX_FILES = 150;
const FETCH_TIMEOUT = 90_000;
const IN_FLIGHT_LOOKAHEAD_BYTES = 2 * 1024 * 1024;
const FIRST_CHUNK_WARM_BYTES = 65_536;

const queue = [];
let downloading = 0;
const inFlight = new Map();
const active = new Map();
let cleanup;

function paths(url, trackKey = '') {
  const seed = typeof trackKey === 'string' && trackKey.trim() ? trackKey.trim() : url;
  const key = createHash('sha256').update(seed).digest('hex').slice(0, 32);
  return {
    key,
    audio: path.join(directory, key + '.audio'),
    meta: path.join(directory, key + '.meta.json')
  };
}

export function parseRange(header, size) {
  if (header === undefined) return null;
  const range = /^bytes=(\d*)-(\d*)$/i.exec(header);
  if (!range || !(range[1] || range[2])) return false;
  const first = range[1] ? Number(range[1]) : null;
  const last = range[2] ? Number(range[2]) : null;
  if ([first, last].some(value => value !== null && !Number.isSafeInteger(value))) return false;
  if (first === null) return last > 0 ? { start: Math.max(0, size - last), end: size - 1 } : false;
  const end = Math.min(last ?? size - 1, size - 1);
  return first <= end ? { start: first, end } : false;
}

async function openCached(files) {
  let file;
  try {
    const meta = JSON.parse(await fs.readFile(files.meta, 'utf8'));
    if (!meta.complete) return null;
    file = await fs.open(files.audio, 'r');
    const { size } = await file.stat();
    const prefix = Buffer.alloc(12);
    const { bytesRead } = await file.read(prefix, 0, prefix.length, 0);
    const type = identifyAudio(prefix.subarray(0, bytesRead));
    if (size <= 0 || size !== meta.size || !type) throw new Error('invalid cached audio');
    return { file, size, type };
  } catch {
    await file?.close().catch(() => {});
    return null;
  }
}

async function openCachedWithFallback(url, trackKey = '') {
  const primary = paths(url, trackKey);
  const cached = await openCached(primary);
  if (cached) return { cached, files: primary };
  if (trackKey) {
    const legacy = paths(url, '');
    if (legacy.key !== primary.key) {
      const legacyCached = await openCached(legacy);
      if (legacyCached) return { cached: legacyCached, files: legacy };
    }
  }
  return { cached: null, files: primary };
}

export async function hasCachedAudio(url, trackKey = '') {
  const files = paths(url, trackKey);
  const running = inFlight.get(files.key);
  if (running?.ready && !running.failed) return true;
  const { cached } = await openCachedWithFallback(url, trackKey);
  if (!cached) return false;
  await cached.file.close();
  return true;
}

async function trimCache() {
  const entries = await fs.readdir(directory, { withFileTypes: true });
  const files = (await Promise.all(entries
    .filter(item => item.isFile() && /^[a-f0-9]{32}\.audio$/.test(item.name))
    .map(async item => {
      const audio = path.join(directory, item.name);
      const stat = await fs.stat(audio).catch(() => null);
      return stat && { audio, stat, key: item.name.slice(0, 32) };
    }))).filter(Boolean).sort((a, b) => a.stat.mtimeMs - b.stat.mtimeMs);
  let size = files.reduce((sum, item) => sum + item.stat.size, 0);
  let count = files.length;
  for (const item of files) {
    if (size <= MAX_BYTES && count <= MAX_FILES) break;
    if (inFlight.has(item.key) || active.has(item.key)) continue;
    if (await fs.unlink(item.audio).then(() => true, () => false)) {
      await fs.unlink(path.join(directory, item.key + '.meta.json')).catch(() => {});
      size -= item.stat.size;
      count--;
    }
  }
}

export function maintainAudioCache() {
  cleanup ??= fs.mkdir(directory, { recursive: true }).then(trimCache)
    .catch(error => console.warn('[StreamCache] cleanup:', error.message))
    .finally(() => { cleanup = undefined; });
  return cleanup;
}

function drainQueue() {
  while (downloading < 3 && queue.length) {
    const job = queue.shift();
    downloading++;
    job.run().finally(() => {
      downloading--;
      drainQueue();
    });
  }
}

function notifyWaiters(entry) {
  for (const wake of [...entry.waiters]) {
    try {
      wake();
    } catch {}
  }
}

function startInFlightDownload(url, trackKey = '', priority = false) {
  const files = paths(url, trackKey);
  const existing = inFlight.get(files.key);
  if (existing) {
    if (priority && !existing.started) {
      const idx = queue.findIndex(job => job.key === files.key);
      if (idx > 0) queue.unshift(queue.splice(idx, 1)[0]);
      drainQueue();
    }
    return existing;
  }

  let resolveHeader;
  let resolveFirstChunk;
  let resolveDone;
  const entry = {
    key: files.key,
    url,
    files,
    started: false,
    ready: false,
    firstChunkReady: false,
    complete: false,
    persisted: false,
    failed: false,
    error: null,
    type: null,
    totalSize: 0,
    bytesReceived: 0,
    chunks: [],
    waiters: new Set(),
    headerPromise: new Promise(resolve => { resolveHeader = resolve; }),
    firstChunkPromise: new Promise(resolve => { resolveFirstChunk = resolve; }),
    donePromise: new Promise(resolve => { resolveDone = resolve; })
  };

  inFlight.set(files.key, entry);

  const markFirstChunk = (ok) => {
    if (!entry.firstChunkReady) {
      entry.firstChunkReady = true;
      resolveFirstChunk(ok);
    }
  };

  const run = async () => {
    entry.started = true;
    const { cached } = await openCachedWithFallback(url, trackKey);
    if (cached) {
      entry.type = cached.type;
      entry.totalSize = cached.size;
      entry.persisted = true;
      entry.ready = true;
      await cached.file.close().catch(() => {});
      resolveHeader(true);
      markFirstChunk(true);
      notifyWaiters(entry);
      return;
    }

    const part = files.audio + '.part';
    const metaPart = files.meta + '.part';
    let diskStream;
    try {
      await fs.mkdir(directory, { recursive: true });
      const controller = new AbortController();
      const signal = AbortSignal.any([controller.signal, AbortSignal.timeout(FETCH_TIMEOUT)]);

      diskStream = createWriteStream(part);
      let diskError = null;
      diskStream.on('error', err => { diskError = err; });

      let headerBuffer = Buffer.alloc(0);
      let length = 0;
      const maxAttempts = 4;

      for (let attempt = 0; attempt < maxAttempts; attempt++) {
        const isResume = attempt > 0 && entry.ready && length > 0 && entry.bytesReceived > 0 && entry.bytesReceived < length;
        if (attempt > 0 && !isResume) break;
        if (isResume) {
          await new Promise(resolve => setTimeout(resolve, 120 * attempt));
        }
        const rangeHeader = isResume ? `bytes=${entry.bytesReceived}-${length - 1}` : undefined;
        const headerTimer = setTimeout(() => controller.abort(new Error('prefetch first-byte timeout')), 8_000);
        let upstream;
        try {
          upstream = await fetchAudio(url, { range: rangeHeader, signal });
        } finally {
          clearTimeout(headerTimer);
        }

        if (!isResume) {
          length = Number(upstream.headers.get('content-length')) || 0;
          if (upstream.status !== 200 || !upstream.body || length > MAX_FILE) {
            await upstream.body?.cancel();
            throw new Error('invalid prefetch response HTTP ' + upstream.status);
          }
        } else {
          const contentRange = upstream.headers.get('content-range') || '';
          if (upstream.status !== 206 || !upstream.body || !contentRange.startsWith(`bytes ${entry.bytesReceived}-`)) {
            await upstream.body?.cancel();
            throw new Error('invalid resume response HTTP ' + upstream.status);
          }
        }

        try {
          for await (const rawChunk of Readable.fromWeb(upstream.body)) {
            if (signal.aborted) throw signal.reason || new Error('prefetch aborted');
            if (diskError) throw diskError;
            const chunk = Buffer.isBuffer(rawChunk) ? rawChunk : Buffer.from(rawChunk);
            if (chunk.length === 0) continue;

            if (entry.bytesReceived + chunk.length > MAX_FILE) {
              throw new Error('audio file too large');
            }

            entry.chunks.push(chunk);
            entry.bytesReceived += chunk.length;

            if (!entry.ready) {
              if (headerBuffer.length < 12) {
                const needed = 12 - headerBuffer.length;
                headerBuffer = Buffer.concat([headerBuffer, chunk.subarray(0, needed)]);
              }
              if (headerBuffer.length >= 12) {
                const detected = identifyAudio(headerBuffer);
                if (!detected) throw new Error('invalid audio header');
                entry.type = detected;
                entry.totalSize = length;
                entry.ready = true;
                resolveHeader(true);
              }
            }

            if (entry.ready && (entry.bytesReceived >= FIRST_CHUNK_WARM_BYTES || (length > 0 && entry.bytesReceived >= length))) {
              markFirstChunk(true);
            }

            notifyWaiters(entry);
            if (!diskStream.write(chunk)) {
              await new Promise((resolve, reject) => {
                const onDrain = () => {
                  diskStream.removeListener('error', onError);
                  resolve();
                };
                const onError = err => {
                  diskStream.removeListener('drain', onDrain);
                  reject(err);
                };
                diskStream.once('drain', onDrain);
                diskStream.once('error', onError);
              });
            }
          }

          if (length === 0 || entry.bytesReceived >= length) {
            break;
          }
        } catch (streamErr) {
          if (
            signal.aborted ||
            diskError ||
            !entry.ready ||
            length <= 0 ||
            entry.bytesReceived <= 0 ||
            entry.bytesReceived >= length ||
            attempt === maxAttempts - 1
          ) {
            throw streamErr;
          }
          // Transient upstream socket drop ('terminated'): resume seamlessly from entry.bytesReceived
        }
      }

      if (!entry.ready) {
        const detected = identifyAudio(headerBuffer);
        if (!detected || entry.bytesReceived < 12) throw new Error('invalid audio cache entry');
        entry.type = detected;
        entry.totalSize = length || entry.bytesReceived;
        entry.ready = true;
        resolveHeader(true);
      }

      if (length > 0 && entry.bytesReceived !== length) {
        throw new Error('incomplete audio download');
      }
      entry.totalSize = entry.bytesReceived;
      entry.complete = true;
      markFirstChunk(true);
      notifyWaiters(entry);

      await new Promise((resolve, reject) => {
        diskStream.end(err => (err ? reject(err) : resolve()));
      });
      diskStream = null;

      await fs.rename(part, files.audio);
      await fs.writeFile(metaPart, JSON.stringify({ complete: true, size: entry.bytesReceived }));
      await fs.rename(metaPart, files.meta);
      entry.persisted = true;
      void maintainAudioCache();
    } catch (error) {
      entry.failed = true;
      entry.error = error;
      if (!entry.ready) resolveHeader(false);
      markFirstChunk(false);
      notifyWaiters(entry);
      console.warn('[StreamCache] download:', files.key, error.message);
    } finally {
      if (diskStream) {
        try { diskStream.destroy(); } catch {}
      }
      await Promise.all([part, metaPart].map(file => fs.unlink(file).catch(() => {})));
    }
  };

  const job = {
    key: files.key,
    run: () => run()
      .finally(() => {
        inFlight.delete(files.key);
        resolveDone();
      })
  };

  if (priority) {
    // Immediate execution for live listener streams even if background prefetch slots are busy
    downloading++;
    job.run().finally(() => {
      downloading--;
      drainQueue();
    });
  } else {
    if (queue.length < 16) {
      queue.push(job);
      drainQueue();
    } else {
      inFlight.delete(files.key);
      resolveHeader(false);
      markFirstChunk(false);
      resolveDone();
    }
  }

  return entry;
}

export function prefetchAudio(url, priorityOrReferer = false, _mimeType, trackKey = '') {
  const isWarm = priorityOrReferer === 'warm';
  const priority = isWarm || (typeof priorityOrReferer === 'boolean' ? priorityOrReferer : false);
  const entry = startInFlightDownload(url, trackKey, priority);
  if (isWarm) {
    if (entry.firstChunkReady) return entry.firstChunkPromise;
    let timer;
    return Promise.race([
      entry.firstChunkPromise,
      new Promise(resolve => { timer = setTimeout(() => resolve(false), 1200); })
    ]).finally(() => clearTimeout(timer));
  }
  return entry.donePromise;
}

async function* generateInFlightSlice(entry, start, end, signal) {
  let cursor = start;
  let chunkIdx = 0;
  let chunkOffset = 0;

  while (cursor <= end) {
    if (signal.aborted) return;

    while (chunkIdx < entry.chunks.length && cursor <= end) {
      const chunk = entry.chunks[chunkIdx];
      const chunkEnd = chunkOffset + chunk.length;
      if (cursor < chunkEnd) {
        const sliceStart = Math.max(0, cursor - chunkOffset);
        const sliceEnd = Math.min(chunk.length, end - chunkOffset + 1);
        if (sliceEnd > sliceStart) {
          const piece = chunk.subarray(sliceStart, sliceEnd);
          cursor += piece.length;
          yield piece;
        }
      }
      if (cursor >= chunkEnd) {
        chunkOffset = chunkEnd;
        chunkIdx++;
      } else {
        break;
      }
    }

    if (cursor > end) break;
    if (entry.failed) throw entry.error || new Error('in-flight audio stream failed');
    if (entry.complete) {
      if (cursor <= end) throw new Error('unexpected EOF in audio stream');
      break;
    }

    await new Promise((resolve, reject) => {
      const onWake = () => {
        cleanupWait();
        resolve();
      };
      const onAbort = () => {
        cleanupWait();
        reject(signal.reason || new Error('aborted'));
      };
      const cleanupWait = () => {
        entry.waiters.delete(onWake);
        signal.removeEventListener('abort', onAbort);
      };
      entry.waiters.add(onWake);
      signal.addEventListener('abort', onAbort, { once: true });
    });
  }
}

const responseHeaders = {
  'Cache-Control': 'public, max-age=86400, immutable, no-transform',
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Expose-Headers': 'Content-Length, Content-Range, Accept-Ranges, X-Audio-Cache',
  'X-Content-Type-Options': 'nosniff'
};

const errorHeaders = { ...responseHeaders, 'Cache-Control': 'no-store' };

export async function handleStreamProxyRequest(req, res, url, _referer, mimeType, trackKey = '') {
  const range = req.headers.range;
  const abort = new AbortController();
  const disconnect = () => abort.abort();
  res.once('close', disconnect);
  const signal = abort.signal;
  const idle = idleWatchdog(abort);
  const progress = new Transform({
    transform(chunk, _encoding, done) {
      idle.touch();
      done(null, chunk);
    }
  });

  const primaryFiles = paths(url, trackKey);
  active.set(primaryFiles.key, (active.get(primaryFiles.key) || 0) + 1);
  let cached = null;
  let activeFiles = primaryFiles;

  try {
    if (range && !/^bytes=(?:\d+-\d*|-\d+)$/i.test(range)) {
      res.writeHead(400, errorHeaders).end();
      return;
    }

    const diskResult = await openCachedWithFallback(url, trackKey);
    cached = diskResult.cached;
    activeFiles = diskResult.files;

    if (cached) {
      const { size, type, file } = cached;
      const slice = parseRange(range, size);
      if (slice === false) {
        res.writeHead(416, { ...errorHeaders, 'Content-Range': 'bytes */' + size });
        res.end();
        return;
      }
      const now = new Date();
      void fs.utimes(activeFiles.audio, now, now).catch(() => {});
      res.writeHead(slice ? 206 : 200, {
        ...responseHeaders,
        'X-Audio-Cache': 'HIT',
        'Content-Type': type,
        'Accept-Ranges': 'bytes',
        'Content-Length': slice ? slice.end - slice.start + 1 : size,
        ...(slice && { 'Content-Range': 'bytes ' + slice.start + '-' + slice.end + '/' + size })
      });
      if (req.method === 'HEAD') res.end();
      else await pipeline(file.createReadStream({ ...slice, autoClose: false, start: slice?.start ?? 0 }), progress, res, { signal });
      return;
    }

    // Progressive In-Flight Stream-Tee: start or join a single shared upstream download.
    // Wait ONLY for the upstream response headers + first 12 magic bytes (~100ms), never the whole file!
    const shared = inFlight.get(primaryFiles.key) ||
      (req.method !== 'HEAD' ? startInFlightDownload(url, trackKey, true) : null);

    if (shared) {
      const headerOk = await shared.headerPromise;
      if (signal.aborted) return;

      if (shared.persisted && shared.chunks.length === 0) {
        const diskHit = await openCachedWithFallback(url, trackKey);
        cached = diskHit.cached;
        activeFiles = diskHit.files;
        if (cached) {
          const { size, type, file } = cached;
          const slice = parseRange(range, size);
          if (slice === false) {
            res.writeHead(416, { ...errorHeaders, 'Content-Range': 'bytes */' + size });
            res.end();
            return;
          }
          res.writeHead(slice ? 206 : 200, {
            ...responseHeaders,
            'X-Audio-Cache': 'HIT',
            'Content-Type': type,
            'Accept-Ranges': 'bytes',
            'Content-Length': slice ? slice.end - slice.start + 1 : size,
            ...(slice && { 'Content-Range': 'bytes ' + slice.start + '-' + slice.end + '/' + size })
          });
          if (req.method === 'HEAD') res.end();
          else await pipeline(file.createReadStream({ ...slice, autoClose: false, start: slice?.start ?? 0 }), progress, res, { signal });
          return;
        }
      }

      if (headerOk && shared.ready && shared.totalSize > 0 && shared.chunks.length > 0) {
        const size = shared.totalSize;
        const slice = parseRange(range, size);
        if (slice === false) {
          res.writeHead(416, { ...errorHeaders, 'Content-Range': 'bytes */' + size });
          res.end();
          return;
        }
        const start = slice ? slice.start : 0;
        const end = slice ? slice.end : size - 1;

        // If the requested range starts within already downloaded bytes (or within 256KB lookahead),
        // stream progressively from the shared in-memory chunk buffer with zero duplicate upstream requests!
        if (shared.complete || start <= shared.bytesReceived + IN_FLIGHT_LOOKAHEAD_BYTES) {
          res.writeHead(slice ? 206 : 200, {
            ...responseHeaders,
            'X-Audio-Cache': 'HIT',
            'Content-Type': shared.type || mimeType || 'audio/mpeg',
            'Accept-Ranges': 'bytes',
            'Content-Length': end - start + 1,
            ...(slice && { 'Content-Range': 'bytes ' + start + '-' + end + '/' + size })
          });
          if (req.method === 'HEAD') {
            res.end();
          } else {
            await pipeline(
              Readable.from(generateInFlightSlice(shared, start, end, signal)),
              progress,
              res,
              { signal }
            );
          }
          return;
        }
      }
    }

    // Fallback for far-ahead unbuffered Range seeks or HEAD on cold cache
    const headerTimer = setTimeout(() => abort.abort(new Error('audio first-byte timeout')), 10_000);
    let upstream;
    try {
      upstream = await fetchAudio(url, { range, signal });
    } finally {
      clearTimeout(headerTimer);
    }
    idle.touch();
    if (!upstream.ok || !upstream.body) {
      await upstream.body?.cancel();
      const contentRange = upstream.headers.get('content-range');
      res.writeHead(upstream.status, {
        ...errorHeaders,
        'Content-Type': 'application/json',
        ...(contentRange && { 'Content-Range': contentRange })
      });
      res.end(JSON.stringify({ ok: false, error: '上游音频服务返回 ' + upstream.status }));
      return;
    }

    const type = upstream.headers.get('content-type')?.split(';')[0]?.trim();
    if (type?.includes('json') || type?.includes('html') ||
        (upstream.status === 206 && !/^bytes \d+-\d+\/\d+$/.test(upstream.headers.get('content-range') || ''))) {
      await upstream.body.cancel();
      throw new Error('invalid audio response');
    }
    const headers = { ...responseHeaders, 'X-Audio-Cache': 'MISS', 'Content-Type': mimeType || 'audio/mpeg' };
    for (const key of ['content-length', 'content-range', 'accept-ranges']) {
      const value = upstream.headers.get(key);
      if (value) headers[key] = value;
    }
    res.writeHead(upstream.status, headers);
    if (req.method === 'HEAD') {
      await upstream.body.cancel();
      res.end();
    } else {
      await pipeline(Readable.fromWeb(upstream.body), progress, res, { signal });
    }
  } catch (error) {
    if (!abort.signal.aborted) console.warn('[StreamCache] response:', primaryFiles.key, error.message);
    if (res.destroyed) return;
    if (res.headersSent) res.destroy();
    else res.writeHead(502, { ...errorHeaders, 'Content-Type': 'application/json' })
      .end(JSON.stringify({ ok: false, error: '音源暂时不可用' }));
  } finally {
    idle.stop();
    await cached?.file.close().catch(() => {});
    res.removeListener('close', disconnect);
    const count = (active.get(primaryFiles.key) || 1) - 1;
    if (count > 0) active.set(primaryFiles.key, count);
    else active.delete(primaryFiles.key);
  }
}
