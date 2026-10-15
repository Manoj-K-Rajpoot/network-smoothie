'use strict';

const fs = require('fs');
const path = require('path');
const http = require('http');
const https = require('https');
const { URL } = require('url');
const { EventEmitter } = require('events');

class TurboDownloader extends EventEmitter {
  constructor(options = {}) {
    super();
    this.saveDir = options.saveDir || path.join(require('os').homedir(), 'Downloads');
    this.activeWorkers = [];
    this.isDownloading = false;
    this.isCancelled = false;
    this.totalBytes = 0;
    this.downloadedBytes = 0;
    this.startTime = 0;
    this.lastTime = 0;
    this.lastBytes = 0;
    this.currentSpeedMbps = 0;
    this.adapterBytes = {};
    this.lastAdapterBytes = {};
    this.adapterSpeeds = {};
  }

  _getProtocol(parsedUrl) {
    return parsedUrl.protocol === 'https:' ? https : http;
  }

  _resolveUrlAndHeaders(rawUrl, callback, redirectCount = 0) {
    if (redirectCount > 5) {
      return callback(new Error('Too many redirects'));
    }

    let parsed;
    try {
      parsed = new URL(rawUrl);
    } catch (e) {
      return callback(new Error('Invalid download URL'));
    }

    const client = this._getProtocol(parsed);
    const options = {
      method: 'GET',
      headers: {
        'User-Agent': 'Smoothie-TurboDownloader/1.0',
        'Range': 'bytes=0-0'
      }
    };

    const req = client.request(parsed, options, (res) => {
      // Follow redirects
      if ([301, 302, 303, 307, 308].includes(res.statusCode) && res.headers.location) {
        const nextUrl = new URL(res.headers.location, parsed).toString();
        return this._resolveUrlAndHeaders(nextUrl, callback, redirectCount + 1);
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

      // Try extracting filename
      let fileName = 'downloaded_file';
      if (res.headers['content-disposition']) {
        const match = res.headers['content-disposition'].match(/filename="?([^"]+)"?/);
        if (match) fileName = match[1];
      } else {
        const pathname = parsed.pathname;
        const base = path.basename(pathname);
        if (base && !base.startsWith('__')) {
          fileName = base;
        } else {
          fileName = `smoothie_download_${Date.now()}.dat`;
        }
      }

      callback(null, {
        finalUrl: rawUrl,
        fileName,
        contentLength,
        supportsRange
      });
    });

    req.on('error', (err) => callback(err));
    req.end();
  }

  download(rawUrl, adapters, onProgress) {
    if (this.isDownloading) {
      throw new Error('A download is already in progress');
    }

    this.isDownloading = true;
    this.isCancelled = false;
    this.activeWorkers = [];
    this.adapterBytes = {};
    this.lastAdapterBytes = {};
    this.adapterSpeeds = {};

    this._resolveUrlAndHeaders(rawUrl, (err, meta) => {
      if (err) {
        this.isDownloading = false;
        this.emit('error', err);
        return;
      }

      const activeAdapters = (adapters && adapters.length > 0) ? adapters.filter(a => a.enabled !== false) : [];
      if (activeAdapters.length === 0) {
        this.isDownloading = false;
        this.emit('error', new Error('No active network adapters available'));
        return;
      }

      this.totalBytes = meta.contentLength;
      this.downloadedBytes = 0;
      this.startTime = Date.now();
      this.lastTime = this.startTime;
      this.lastBytes = 0;

      const finalFilePath = path.join(this.saveDir, meta.fileName);
      const tempPrefix = path.join(this.saveDir, `.smoothie_temp_${Date.now()}`);

      this.emit('start', {
        fileName: meta.fileName,
        totalBytes: this.totalBytes,
        savePath: finalFilePath,
        supportsRange: meta.supportsRange,
        adaptersCount: activeAdapters.length
      });

      // If Range not supported, fallback to single adapter
      if (!meta.supportsRange || this.totalBytes <= 1024 * 512) {
        this._singleDownload(meta.finalUrl, activeAdapters[0].address, finalFilePath);
        return;
      }

      // Multi-adapter segmented download:
      // Allocate 2 chunks per adapter to keep all pipes continuously full
      const chunksCount = Math.min(activeAdapters.length * 2, 8);
      const chunkSize = Math.ceil(this.totalBytes / chunksCount);
      let finishedChunks = 0;
      const chunkFiles = [];

      const updateTicker = setInterval(() => {
        if (!this.isDownloading) {
          clearInterval(updateTicker);
          return;
        }

        const now = Date.now();
        const dt = Math.max((now - this.lastTime) / 1000, 0.2);
        this.lastTime = now;

        const dBytes = Math.max(this.downloadedBytes - this.lastBytes, 0);
        this.lastBytes = this.downloadedBytes;
        this.currentSpeedMbps = (dBytes * 8) / (dt * 1000 * 1000);

        // Calculate per-adapter speeds
        for (const adapter of activeAdapters) {
          const addr = adapter.address;
          const curr = this.adapterBytes[addr] || 0;
          const prev = this.lastAdapterBytes[addr] || 0;
          const dAddr = Math.max(curr - prev, 0);
          this.lastAdapterBytes[addr] = curr;
          this.adapterSpeeds[addr] = (dAddr * 8) / (dt * 1000 * 1000);
        }

        const percent = this.totalBytes > 0 ? Math.min((this.downloadedBytes / this.totalBytes) * 100, 100) : 0;
        const eta = (this.currentSpeedMbps > 0 && this.totalBytes > this.downloadedBytes)
          ? Math.round(((this.totalBytes - this.downloadedBytes) * 8) / (this.currentSpeedMbps * 1000 * 1000))
          : 0;

        const progressPayload = {
          downloadedBytes: this.downloadedBytes,
          totalBytes: this.totalBytes,
          percent,
          speedMbps: this.currentSpeedMbps,
          speedBytesPerSec: dBytes / dt,
          adapterBytes: Object.assign({}, this.adapterBytes),
          adapterSpeeds: Object.assign({}, this.adapterSpeeds),
          eta
        };

        if (typeof onProgress === 'function') onProgress(progressPayload);
        this.emit('progress', progressPayload);
      }, 500);

      // Launch parallel chunk workers
      for (let i = 0; i < chunksCount; i++) {
        const startByte = i * chunkSize;
        const endByte = Math.min((i + 1) * chunkSize - 1, this.totalBytes - 1);
        const assignedAdapter = activeAdapters[i % activeAdapters.length];
        const chunkPath = `${tempPrefix}_part_${i}.tmp`;
        chunkFiles.push(chunkPath);

        const parsed = new URL(meta.finalUrl);
        const client = this._getProtocol(parsed);
        const options = {
          localAddress: assignedAdapter.address,
          headers: {
            'User-Agent': 'Smoothie-TurboDownloader/1.0',
            'Range': `bytes=${startByte}-${endByte}`
          }
        };

        const req = client.get(parsed, options, (res) => {
          if (res.statusCode !== 206 && res.statusCode !== 200) {
            this.emit('error', new Error(`Chunk ${i} rejected with HTTP ${res.statusCode}`));
            return;
          }

          const fileStream = fs.createWriteStream(chunkPath);
          res.pipe(fileStream);

          res.on('data', (chunk) => {
            if (this.isCancelled) {
              res.destroy();
              return;
            }
            this.downloadedBytes += chunk.length;
            this.adapterBytes[assignedAdapter.address] = (this.adapterBytes[assignedAdapter.address] || 0) + chunk.length;
          });

          fileStream.on('finish', () => {
            finishedChunks++;
            if (finishedChunks === chunksCount) {
              clearInterval(updateTicker);
              this._assembleChunks(chunkFiles, finalFilePath);
            }
          });
        });

        req.on('error', (reqErr) => {
          if (!this.isCancelled) {
            this.emit('error', reqErr);
          }
        });

        this.activeWorkers.push(req);
      }
    });
  }

  _singleDownload(url, localAddress, savePath) {
    const parsed = new URL(url);
    const client = this._getProtocol(parsed);
    const fileStream = fs.createWriteStream(savePath);

    const req = client.get(parsed, { localAddress }, (res) => {
      res.pipe(fileStream);
      res.on('data', (c) => {
        this.downloadedBytes += c.length;
      });
      fileStream.on('finish', () => {
        this.isDownloading = false;
        this.emit('complete', { savePath, totalBytes: this.downloadedBytes });
      });
    });

    req.on('error', (err) => {
      this.isDownloading = false;
      this.emit('error', err);
    });

    this.activeWorkers.push(req);
  }

  _assembleChunks(chunkFiles, finalFilePath) {
    const finalStream = fs.createWriteStream(finalFilePath);

    const appendNext = (index) => {
      if (index >= chunkFiles.length) {
        finalStream.end();
        this.isDownloading = false;
        this.emit('complete', {
          savePath: finalFilePath,
          totalBytes: this.totalBytes
        });
        return;
      }

      const partPath = chunkFiles[index];
      const partStream = fs.createReadStream(partPath);

      partStream.pipe(finalStream, { end: false });
      partStream.on('end', () => {
        try {
          fs.unlinkSync(partPath);
        } catch (e) {
          // ignore
        }
        appendNext(index + 1);
      });
    };

    appendNext(0);
  }

  cancel() {
    this.isCancelled = true;
    this.isDownloading = false;
    for (const req of this.activeWorkers) {
      try {
        req.destroy();
      } catch (e) {
        // ignore
      }
    }
    this.activeWorkers = [];
    this.emit('cancel');
  }
}

module.exports = TurboDownloader;
