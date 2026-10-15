'use strict';

const fs = require('fs');
const path = require('path');
const os = require('os');
const { EventEmitter } = require('events');
const ChunkEngine = require('./ChunkEngine');
const config = require('../config');

class TaskManager extends EventEmitter {
  constructor(networkManager) {
    super();
    this.networkManager = networkManager;
    this.tasksFile = path.join(os.homedir(), '.cobo-tasks.json');
    this.tasks = this._loadTasks();
    this.activeEngines = new Map();
  }

  _loadTasks() {
    try {
      if (fs.existsSync(this.tasksFile)) {
        return JSON.parse(fs.readFileSync(this.tasksFile, 'utf8'));
      }
    } catch (e) {
      console.warn('Failed to load tasks store:', e.message);
    }
    return [];
  }

  _saveTasks() {
    try {
      fs.writeFileSync(this.tasksFile, JSON.stringify(this.tasks, null, 2), 'utf8');
    } catch (e) {
      console.error('Failed saving tasks:', e.message);
    }
  }

  _getCategory(fileName) {
    const ext = path.extname(fileName).toLowerCase().replace('.', '');
    if (['zip', 'rar', '7z', 'tar', 'gz', 'iso', 'bz2'].includes(ext)) return 'Compressed';
    if (['mp4', 'mkv', 'avi', 'mov', 'webm', 'flv'].includes(ext)) return 'Video';
    if (['mp3', 'flac', 'wav', 'aac', 'ogg'].includes(ext)) return 'Audio';
    if (['pdf', 'docx', 'xlsx', 'pptx', 'txt', 'epub'].includes(ext)) return 'Document';
    if (['exe', 'msi', 'dmg', 'pkg', 'apk', 'bin'].includes(ext)) return 'Program';
    return 'Other';
  }

  probeUrl(url, headers = {}, callback) {
    const engine = new ChunkEngine();
    engine.probe(url, callback, 0, headers);
  }

  createTask(url, options = {}) {
    const id = `task_${Date.now()}_${Math.random().toString(36).substr(2, 5)}`;
    const downloadDir = options.saveDir || config.get().general.downloadDir;
    const initialFileName = options.fileName || 'Resolving...';
    const category = options.category || (options.fileName ? this._getCategory(options.fileName) : 'Other');
    
    const task = {
      id,
      url,
      fileName: initialFileName,
      category,
      totalBytes: options.totalBytes || 0,
      downloadedBytes: 0,
      percent: 0,
      speedMbps: 0,
      status: 'Queued', // Queued, Connecting, Downloading, Completed, Paused, Error
      saveDir: downloadDir,
      savePath: options.fileName ? path.join(downloadDir, options.fileName) : '',
      connections: options.connections || 8,
      selectedAdapters: options.selectedAdapters || null,
      headers: options.headers || {},
      speedLimit: options.speedLimit || 0,
      createdAt: new Date().toISOString(),
      completedAt: null,
      eta: 0
    };

    this.tasks.unshift(task);
    this._saveTasks();
    this.emit('task-added', task);
    return task;
  }

  startTask(taskId) {
    const task = this.tasks.find(t => t.id === taskId);
    if (!task) return;

    const downloadDir = task.saveDir || config.get().general.downloadDir;
    const engine = new ChunkEngine({
      maxTotalConnections: task.connections || 16
    });
    this.activeEngines.set(taskId, engine);

    task.status = 'Connecting';
    this.emit('task-updated', task);

    engine.on('meta', (meta) => {
      if (!task.fileName || task.fileName === 'Resolving...') {
        task.fileName = meta.fileName;
        task.category = this._getCategory(meta.fileName);
      }
      task.totalBytes = meta.contentLength || task.totalBytes;
      task.savePath = path.join(downloadDir, task.fileName);
      task.status = 'Downloading';
      this._saveTasks();
      this.emit('task-updated', task);
    });

    engine.on('progress', (p) => {
      task.downloadedBytes = p.downloadedBytes;
      task.percent = p.percent;
      task.speedMbps = p.speedMbps;
      task.speedBytesPerSec = p.speedBytesPerSec;
      task.eta = p.etaSec;
      task.elapsedSec = p.elapsedSec;
      task.status = 'Downloading';
      this.emit('task-progress', { task, progress: p });
    });

    engine.on('complete', (res = {}) => {
      task.status = 'Completed';
      task.percent = 100;
      task.speedMbps = 0;
      task.eta = 0;
      task.durationSec = res.durationSec || (task.elapsedSec || 0);
      task.completedAt = new Date().toISOString();
      this.activeEngines.delete(taskId);
      this._saveTasks();
      this.emit('task-completed', task);
    });

    engine.on('error', (err) => {
      task.status = 'Error';
      task.speedMbps = 0;
      task.errorMessage = err.message;
      this.activeEngines.delete(taskId);
      this._saveTasks();
      this.emit('task-error', { task, error: err.message });
    });

    engine.on('paused', (snapshot) => {
      task.chunks = snapshot.chunks;
      task.downloadedBytes = snapshot.downloadedBytes;
      task.status = 'Paused';
      task.speedMbps = 0;
      this._saveTasks();
      this.emit('task-updated', task);
    });

    const activeAdapters = this.networkManager.getActiveAdapters();
    const savePath = task.savePath || path.join(downloadDir, task.fileName && task.fileName !== 'Resolving...' ? task.fileName : `download_${Date.now()}.dat`);
    const taskConfig = {
      connections: task.connections,
      selectedAdapters: task.selectedAdapters,
      headers: task.headers,
      speedLimit: task.speedLimit,
      existingChunks: task.chunks || null
    };
    engine.startDownload(task.url, savePath, activeAdapters, taskConfig);
  }

  pauseTask(taskId) {
    const engine = this.activeEngines.get(taskId);
    const task = this.tasks.find(t => t.id === taskId);
    if (engine) {
      engine.pause();
      this.activeEngines.delete(taskId);
    }
    if (task) {
      task.status = 'Paused';
      task.speedMbps = 0;
      this._saveTasks();
      this.emit('task-updated', task);
    }
  }

  resumeTask(taskId) {
    this.startTask(taskId);
  }

  forceStopTask(taskId) {
    const engine = this.activeEngines.get(taskId);
    const task = this.tasks.find(t => t.id === taskId);
    if (engine) {
      engine.forceStop();
      this.activeEngines.delete(taskId);
    }
    if (task) {
      task.status = 'Stopped';
      task.speedMbps = 0;
      this._saveTasks();
      this.emit('task-updated', task);
    }
  }

  restartTask(taskId) {
    const task = this.tasks.find(t => t.id === taskId);
    if (!task) return;

    this.forceStopTask(taskId);
    if (task.savePath && fs.existsSync(task.savePath)) {
      try { fs.unlinkSync(task.savePath); } catch (e) {}
    }
    task.downloadedBytes = 0;
    task.percent = 0;
    task.speedMbps = 0;
    task.chunks = null;
    task.status = 'Queued';
    this._saveTasks();
    this.emit('task-updated', task);
    this.startTask(taskId);
  }

  cancelTask(taskId) {
    const engine = this.activeEngines.get(taskId);
    if (engine) {
      engine.cancel();
      this.activeEngines.delete(taskId);
    }
    const task = this.tasks.find(t => t.id === taskId);
    if (task) {
      task.status = 'Cancelled';
      task.speedMbps = 0;
      this._saveTasks();
      this.emit('task-updated', task);
    }
  }

  deleteTask(taskId, deleteFile = false) {
    this.forceStopTask(taskId);
    const idx = this.tasks.findIndex(t => t.id === taskId);
    if (idx !== -1) {
      const task = this.tasks[idx];
      if (deleteFile && task.savePath && fs.existsSync(task.savePath)) {
        try { fs.unlinkSync(task.savePath); } catch (e) {}
      }
      this.tasks.splice(idx, 1);
      this._saveTasks();
      this.emit('task-deleted', taskId);
    }
  }

  getTasks() {
    return this.tasks;
  }
}

module.exports = TaskManager;
