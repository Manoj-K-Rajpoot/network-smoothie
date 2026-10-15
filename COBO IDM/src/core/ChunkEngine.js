'use strict';

const http = require('http');
const https = require('https');
const { URL } = require('url');
const { EventEmitter } = require('events');
const path = require('path');
const FileAssembler = require('./FileAssembler');

class ChunkEngine extends EventEmitter {
  constructor(options = {}) {
    super();
    this.options = Object.assign({
      connectionsPerAdapter: 2,
      maxTotalConnections: 16,
      minChunkSizeMb: 2,
      workStealing: true
    }, options);

    this.activeWorkers = new Map();
    this.chunks = [];
    this.assembler = null;
    this.isPaused = false;
    this.isCancelled = false;
    this.totalBytes = 0;
    this.downloadedBytes = 0;
    this.adapterBytes = {};
    this.adapterSpeeds = {};
    this.lastAdapterBytes = {};
    this.lastTime = Date.now();
    this.lastBytes = 0;
    this.ticker = null;
    this.customHeaders = {};
  }

  _getClient(parsedUrl) {
    return parsedUrl.protocol === 'https:' ? https : http;
  }

  probe(url, callback, redirectCount = 0, customHeaders = {}) {
    if (redirectCount > 5) return callback(new Error('Too many redirects'));

    let parsed;
    try {
      parsed = new URL(url);
    } catch (e) {
      return callback(new Error('Invalid URL'));
    }

    const client = this._getClient(parsed);
    const headers = Object.assign({
      'User-Agent': 'COBO-IDM/1.0 (Windows NT 10.0; Win64; x64)',
      'Range': 'bytes=0-0'
    }, customHeaders);

    const req = client.request(parsed, {
      method: 'GET',
      headers
    }, (res) => {
      if ([301, 302, 303, 307, 308].includes(res.statusCode) && res.headers.location) {
        const nextUrl = new URL(res.headers.location, parsed).toString();
        res.destroy();
        return this.probe(nextUrl, callback, redirectCount + 1, customHeaders);
      }

      res.destroy();

      let supportsRange = res.statusCode === 206 || res.headers['accept-ranges'] === 'bytes';
      let contentLength = 0;

      if (res.headers['content-range']) {
        const match = res.headers['content-range'].match(/\/(\d+)/);
        if (match) {
          contentLength = parseInt(match[1], 10);
          supportsRange = true;
        }
      }

      if (!contentLength && res.headers['content-length']) {
        contentLength = parseInt(res.headers['content-length'], 10);
      }

      let fileName = 'downloaded_file';
      if (res.headers['content-disposition']) {
        const match = res.headers['content-disposition'].match(/filename="?([^"]+)"?/);
        if (match) fileName = match[1];
      } else {
        const base = path.basename(parsed.pathname);
        if (base && !base.startsWith('__')) fileName = base;
        else fileName = `cobo_file_${Date.now()}.dat`;
      }

      callback(null, {
        finalUrl: url,
        fileName,
        contentLength,
        supportsRange
      });
    });

    req.on('error', err => callback(err));
    req.end();
  }

  startDownload(url, savePath, adapters, taskConfig = {}) {
    this.isPaused = false;
    this.isCancelled = false;
    this.downloadedBytes = 0;
    this.adapterBytes = {};
    this.lastAdapterBytes = {};
    this.adapterSpeeds = {};
    this.customHeaders = taskConfig.headers || {};

    this.probe(url, (err, meta) => {
      if (err) {
        this.emit('error', err);
        return;
      }

      this.totalBytes = meta.contentLength;
      this.assembler = new FileAssembler(savePath, this.totalBytes);
      this.assembler.open();

      // Filter active adapters: if user selected specific adapters, respect that
      let activeAdapters = adapters.filter(a => a.enabled !== false);
      if (taskConfig.selectedAdapters && taskConfig.selectedAdapters.length > 0) {
        activeAdapters = activeAdapters.filter(a => taskConfig.selectedAdapters.includes(a.address));
      }

      if (activeAdapters.length === 0) {
        activeAdapters = adapters.filter(a => a.enabled !== false);
      }

      if (activeAdapters.length === 0) {
        this.emit('error', new Error('No active network adapters selected'));
        return;
      }

      this.emit('meta', meta);

      // Start Telemetry Ticker
      this.startTime = Date.now();
      this.lastTime = Date.now();
      this.lastBytes = 0;
      this.ticker = setInterval(() => this._tickProgress(activeAdapters), 500);

      if (!meta.supportsRange || this.totalBytes <= 1024 * 1024) {
        this._singleStreamDownload(meta.finalUrl, activeAdapters[0].address);
        return;
      }

      // Resume existing chunk offsets if resuming from pause
      if (taskConfig.existingChunks && Array.isArray(taskConfig.existingChunks) && taskConfig.existingChunks.length > 0) {
        this.chunks = taskConfig.existingChunks;
        this.downloadedBytes = 0;
        for (const chunk of this.chunks) {
          this.downloadedBytes += (chunk.downloaded || 0);
          if (!chunk.completed && chunk.current <= chunk.end) {
            const assignedAdapter = activeAdapters[chunk.id % activeAdapters.length];
            chunk.adapter = assignedAdapter.address;
            chunk.adapterName = assignedAdapter.name;
            chunk.active = false;
            this._startChunkWorker(meta.finalUrl, chunk);
          }
        }
        return;
      }

      // Slicing Strategy: use task-configured connections count (e.g. 2, 4, 8, 16, 32)
      const requestedConnections = taskConfig.connections || (activeAdapters.length * this.options.connectionsPerAdapter);
      const connectionsCount = Math.min(Math.max(requestedConnections, 1), 32);

      const chunkSize = Math.ceil(this.totalBytes / connectionsCount);
      this.chunks = [];

      for (let i = 0; i < connectionsCount; i++) {
        const start = i * chunkSize;
        const end = Math.min((i + 1) * chunkSize - 1, this.totalBytes - 1);
        const assignedAdapter = activeAdapters[i % activeAdapters.length];

        const chunk = {
          id: i,
          start,
          end,
          current: start,
          total: end - start + 1,
          downloaded: 0,
          adapter: assignedAdapter.address,
          adapterName: assignedAdapter.name,
          completed: false,
          active: false
        };

        this.chunks.push(chunk);
        this._startChunkWorker(meta.finalUrl, chunk);
      }
    }, 0, this.customHeaders);
  }

  _startChunkWorker(url, chunk) {
    if (this.isPaused || this.isCancelled || chunk.completed) return;

    chunk.active = true;
    const parsed = new URL(url);
    const client = this._getClient(parsed);

    const headers = Object.assign({
      'User-Agent': 'COBO-IDM/1.0 (Windows NT 10.0; Win64; x64)'
    }, this.customHeaders, {
      'Range': `bytes=${chunk.current}-${chunk.end}`
    });

    const req = client.get(parsed, {
      localAddress: chunk.adapter,
      headers
    }, (res) => {
      if (res.statusCode !== 206 && res.statusCode !== 200) {
        chunk.active = false;
        this.emit('error', new Error(`Chunk ${chunk.id} HTTP error: ${res.statusCode}`));
        return;
      }

      res.on('data', (buffer) => {
        if (this.isPaused || this.isCancelled) {
          res.destroy();
          return;
        }

        const writeOffset = chunk.current;
        chunk.current += buffer.length;
        chunk.downloaded += buffer.length;
        this.downloadedBytes += buffer.length;

        this.adapterBytes[chunk.adapter] = (this.adapterBytes[chunk.adapter] || 0) + buffer.length;

        this.assembler.writeAt(buffer, writeOffset, (wErr) => {
          if (wErr) console.warn('Assembler write error:', wErr.message);
        });
      });

      res.on('end', () => {
        chunk.active = false;
        chunk.completed = true;
        this._checkCompletion(url);
      });
    });

    req.on('error', (err) => {
      chunk.active = false;
      if (!this.isPaused && !this.isCancelled) {
        console.warn(`Worker for chunk ${chunk.id} on ${chunk.adapter} retrying:`, err.message);
        setTimeout(() => this._startChunkWorker(url, chunk), 1500);
      }
    });

    this.activeWorkers.set(chunk.id, req);
  }

  _singleStreamDownload(url, localAddress) {
    const parsed = new URL(url);
    const client = this._getClient(parsed);

    const headers = Object.assign({
      'User-Agent': 'COBO-IDM/1.0 (Windows NT 10.0; Win64; x64)'
    }, this.customHeaders);

    const req = client.get(parsed, { localAddress, headers }, (res) => {
      let offset = 0;
      res.on('data', (buf) => {
        if (this.isPaused || this.isCancelled) {
          res.destroy();
          return;
        }
        const currentOffset = offset;
        offset += buf.length;
        this.downloadedBytes += buf.length;
        this.adapterBytes[localAddress] = (this.adapterBytes[localAddress] || 0) + buf.length;
        this.assembler.writeAt(buf, currentOffset, () => {});
      });

      res.on('end', () => {
        this._finish();
      });
    });

    req.on('error', err => this.emit('error', err));
    this.activeWorkers.set('single', req);
  }

  _checkCompletion(url) {
    const allDone = this.chunks.every(c => c.completed);
    if (allDone) {
      this._finish();
    } else if (this.options.workStealing) {
      this._attemptWorkStealing(url);
    }
  }

  _attemptWorkStealing(url) {
    let largestRemainingChunk = null;
    let maxRemaining = 0;

    for (const chunk of this.chunks) {
      if (!chunk.completed && chunk.active) {
        const remaining = chunk.end - chunk.current;
        if (remaining > maxRemaining) {
          maxRemaining = remaining;
          largestRemainingChunk = chunk;
        }
      }
    }

    const minStealBytes = this.options.minChunkSizeMb * 1024 * 1024;
    if (largestRemainingChunk && maxRemaining > minStealBytes) {
      const splitPoint = largestRemainingChunk.current + Math.floor(maxRemaining / 2);
      const originalEnd = largestRemainingChunk.end;

      largestRemainingChunk.end = splitPoint - 1;

      const stolenChunk = {
        id: this.chunks.length,
        start: splitPoint,
        end: originalEnd,
        current: splitPoint,
        total: originalEnd - splitPoint + 1,
        downloaded: 0,
        adapter: largestRemainingChunk.adapter,
        adapterName: largestRemainingChunk.adapterName,
        completed: false,
        active: false
      };

      this.chunks.push(stolenChunk);
      this._startChunkWorker(url, stolenChunk);
    }
  }

  _tickProgress(adapters) {
    const now = Date.now();
    const dt = Math.max((now - this.lastTime) / 1000, 0.2);
    this.lastTime = now;

    const dBytes = Math.max(this.downloadedBytes - this.lastBytes, 0);
    this.lastBytes = this.downloadedBytes;
    const speedMbps = (dBytes * 8) / (dt * 1000 * 1000);

    for (const a of adapters) {
      const addr = a.address;
      const cur = this.adapterBytes[addr] || 0;
      const prev = this.lastAdapterBytes[addr] || 0;
      const dAddr = Math.max(cur - prev, 0);
      this.lastAdapterBytes[addr] = cur;
      this.adapterSpeeds[addr] = (dAddr * 8) / (dt * 1000 * 1000);
    }

    const percent = this.totalBytes > 0 ? Math.min((this.downloadedBytes / this.totalBytes) * 100, 100) : 0;
    
    // Accurate ETA calculation in seconds based on bytes per second
    const remainingBytes = Math.max(this.totalBytes - this.downloadedBytes, 0);
    const speedBytesPerSec = dBytes / dt;
    let etaSec = 0;
    if (remainingBytes > 0 && speedBytesPerSec > 512) {
      etaSec = Math.round(remainingBytes / speedBytesPerSec);
    }

    const elapsedSec = this.startTime ? Math.max(Math.round((now - this.startTime) / 1000), 0) : 0;

    this.emit('progress', {
      downloadedBytes: this.downloadedBytes,
      totalBytes: this.totalBytes,
      percent,
      speedMbps,
      speedBytesPerSec,
      etaSec,
      elapsedSec,
      adapterBytes: Object.assign({}, this.adapterBytes),
      adapterSpeeds: Object.assign({}, this.adapterSpeeds),
      chunks: this.chunks.map(c => ({
        id: c.id,
        percent: c.total > 0 ? Math.min((c.downloaded / c.total) * 100, 100) : 0,
        adapter: c.adapter,
        adapterName: c.adapterName,
        completed: c.completed
      })),
      eta: etaSec
    });
  }

  _finish() {
    if (this.ticker) {
      clearInterval(this.ticker);
      this.ticker = null;
    }

    const durationSec = this.startTime ? Math.max(Math.round((Date.now() - this.startTime) / 1000), 1) : 0;

    if (this.assembler) {
      this.assembler.close((err) => {
        if (err) this.emit('error', err);
        else this.emit('complete', { totalBytes: this.downloadedBytes, durationSec });
      });
    } else {
      this.emit('complete', { totalBytes: this.downloadedBytes, durationSec });
    }
  }

  pause() {
    this.isPaused = true;
    if (this.ticker) {
      clearInterval(this.ticker);
      this.ticker = null;
    }
    for (const [, req] of this.activeWorkers) {
      try { req.destroy(); } catch (e) {}
    }
    this.activeWorkers.clear();
    if (this.assembler) this.assembler.close();
    this.emit('paused', {
      chunks: this.chunks.map(c => Object.assign({}, c, { active: false })),
      downloadedBytes: this.downloadedBytes
    });
  }

  forceStop() {
    this.isCancelled = true;
    if (this.ticker) {
      clearInterval(this.ticker);
      this.ticker = null;
    }
    for (const [, req] of this.activeWorkers) {
      try { req.destroy(); } catch (e) {}
    }
    this.activeWorkers.clear();
    if (this.assembler) this.assembler.close();
    this.emit('stopped');
  }

  cancel() {
    this.isCancelled = true;
    if (this.ticker) clearInterval(this.ticker);
    for (const [, req] of this.activeWorkers) {
      try { req.destroy(); } catch (e) {}
    }
    this.activeWorkers.clear();
    if (this.assembler) this.assembler.close();
    this.emit('cancelled');
  }
}

module.exports = ChunkEngine;
