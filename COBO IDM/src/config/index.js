'use strict';

const fs = require('fs');
const path = require('path');
const os = require('os');

const DEFAULT_CONFIG = {
  general: {
    downloadDir: path.join(os.homedir(), 'Downloads', 'COBO'),
    autoStartOnLaunch: false,
    minimizeToTray: true,
    maxConcurrentDownloads: 3
  },
  connectionPool: {
    connectionsPerAdapter: 2,
    maxTotalConnections: 16,
    bufferSizeKb: 64,
    socketTimeoutMs: 12000,
    workStealingEnabled: true,
    minChunkSizeMb: 2
  },
  adapters: {
    autoDiscover: true,
    defaultPriority: 2,
    healthCheckIntervalSec: 8
  }
};

class ConfigManager {
  constructor() {
    this.configPath = path.join(os.homedir(), '.cobo-idm-config.json');
    this.config = this._load();
    this._ensureDownloadDir();
  }

  _ensureDownloadDir() {
    try {
      if (!fs.existsSync(this.config.general.downloadDir)) {
        fs.mkdirSync(this.config.general.downloadDir, { recursive: true });
      }
    } catch (e) {
      console.warn('Could not create default download directory:', e.message);
    }
  }

  _load() {
    try {
      if (fs.existsSync(this.configPath)) {
        const raw = fs.readFileSync(this.configPath, 'utf8');
        return Object.assign({}, DEFAULT_CONFIG, JSON.parse(raw));
      }
    } catch (e) {
      console.warn('Failed loading config, using defaults:', e.message);
    }
    return JSON.parse(JSON.stringify(DEFAULT_CONFIG));
  }

  save(newConfig) {
    this.config = Object.assign({}, this.config, newConfig);
    try {
      fs.writeFileSync(this.configPath, JSON.stringify(this.config, null, 2), 'utf8');
    } catch (e) {
      console.error('Failed saving config:', e.message);
    }
    this._ensureDownloadDir();
    return this.config;
  }

  get() {
    return this.config;
  }
}

module.exports = new ConfigManager();
