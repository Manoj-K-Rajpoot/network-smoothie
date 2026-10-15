'use strict';

const path = require('path');
const { ipcRenderer, clipboard, shell } = require('electron');

// Resilient module loader for Electron renderer
function loadModule(moduleRelPath) {
  const candidates = [
    path.join(__dirname, moduleRelPath),
    path.join(__dirname, '..', moduleRelPath),
    path.join(__dirname, '..', '..', moduleRelPath),
    path.join(__dirname, '..', '..', 'src', moduleRelPath),
    path.resolve(process.cwd(), 'src', moduleRelPath),
    path.resolve(process.cwd(), 'COBO IDM', 'src', moduleRelPath)
  ];
  for (const c of candidates) {
    try {
      return require(c);
    } catch (e) {
      if (e.code !== 'MODULE_NOT_FOUND') throw e;
    }
  }
  return require(moduleRelPath);
}

const NetworkManager = loadModule('core/NetworkManager');
const TaskManager = loadModule('core/TaskManager');
const config = loadModule('config');

const networkManager = new NetworkManager();
const taskManager = new TaskManager(networkManager);

networkManager.startMonitoring(10);

// DOM Elements — Windows & App
const tasksContainer = document.getElementById('tasks-container');
const btnAddDownload = document.getElementById('btn-add-download');
const btnResumeAll = document.getElementById('btn-resume-all');
const btnPauseAll = document.getElementById('btn-pause-all');
const btnClearCompleted = document.getElementById('btn-clear-completed');
const btnNetworkSettings = document.getElementById('btn-network-settings');

const footerAdaptersStrip = document.getElementById('footer-adapters-strip');
const footerTotalSpeed = document.getElementById('footer-total-speed');

const btnMin = document.getElementById('btn-min');
const btnMax = document.getElementById('btn-max');
const btnClose = document.getElementById('btn-close');

// DOM Elements — Modal
const addModal = document.getElementById('add-modal');
const btnModalClose = document.getElementById('btn-modal-close');
const btnModalCancel = document.getElementById('btn-modal-cancel');
const btnModalQueue = document.getElementById('btn-modal-queue');
const btnModalStart = document.getElementById('btn-modal-start');
const btnPasteUrl = document.getElementById('btn-paste-url');

const modalUrlInput = document.getElementById('modal-url-input');
const modalFilenameInput = document.getElementById('modal-filename-input');
const modalCategorySelect = document.getElementById('modal-category-select');
const modalSavedirInput = document.getElementById('modal-savedir-input');
const btnBrowseFolder = document.getElementById('btn-browse-folder');

const valConnections = document.getElementById('val-connections');
const modalAdaptersList = document.getElementById('modal-adapters-list');

const modalSample10 = document.getElementById('modal-sample-10mb');
const modalSample100 = document.getElementById('modal-sample-100mb');
const modalSampleUbuntu = document.getElementById('modal-sample-ubuntu');

// Probe Elements
const probeCard = document.getElementById('probe-card');
const probeSpinner = document.getElementById('probe-spinner');
const probeStatusText = document.getElementById('probe-status-text');
const probeMetaBadges = document.getElementById('probe-meta-badges');
const probeBadgeSize = document.getElementById('probe-badge-size');
const probeBadgeResume = document.getElementById('probe-badge-resume');

// Advanced Settings Elements
const advancedToggle = document.getElementById('advanced-toggle');
const advancedPanel = document.getElementById('advanced-panel');
const modalRefererInput = document.getElementById('modal-referer-input');
const modalCookieInput = document.getElementById('modal-cookie-input');
const modalUseragentSelect = document.getElementById('modal-useragent-select');
const groupCustomUseragent = document.getElementById('group-custom-useragent');
const modalUseragentCustom = document.getElementById('modal-useragent-custom');
const modalSpeedlimitSelect = document.getElementById('modal-speedlimit-select');

// Window Controls
if (btnMin) btnMin.addEventListener('click', () => ipcRenderer.send('window-minimize'));
if (btnMax) btnMax.addEventListener('click', () => ipcRenderer.send('window-maximize'));
if (btnClose) btnClose.addEventListener('click', () => ipcRenderer.send('window-close'));

// State Variables
let currentFilter = 'all';
let selectedConnections = 8;
let probeDebounceTimer = null;
let lastProbedUrl = '';
let currentProbeMeta = null;

// Helper: Format Bytes to MB / GB
function formatBytes(bytes) {
  if (!bytes || bytes <= 0) return '0.00 MB';
  const mb = bytes / (1024 * 1024);
  if (mb < 1000) return `${mb.toFixed(2)} MB`;
  return `${(mb / 1024).toFixed(2)} GB`;
}

// Helper: Format Seconds into Human-Readable Duration (e.g., 45s, 1m 24s, 1h 05m)
function formatDuration(seconds) {
  if (seconds === undefined || seconds === null || seconds < 0) return '0s';
  const s = Math.round(seconds);
  if (s < 60) return `${s}s`;
  const mins = Math.floor(s / 60);
  const remSec = s % 60;
  if (mins < 60) {
    return remSec > 0 ? `${mins}m ${remSec}s` : `${mins}m`;
  }
  const hours = Math.floor(mins / 60);
  const remMins = mins % 60;
  return `${hours}h ${remMins}m`;
}

// Helper: Format Speed into Mbps & MB/s
function formatSpeed(mbps) {
  if (!mbps || mbps <= 0) return '0.00 Mbps';
  const mbPerSec = (mbps / 8).toFixed(2);
  return `${mbps.toFixed(2)} Mbps (${mbPerSec} MB/s)`;
}

// Category Count Badges
function updateCategoryCounts() {
  const tasks = taskManager.getTasks();
  document.getElementById('count-all').textContent = tasks.length;
  document.getElementById('count-downloading').textContent = tasks.filter(t => t.status === 'Downloading' || t.status === 'Connecting').length;
  document.getElementById('count-completed').textContent = tasks.filter(t => t.status === 'Completed').length;
  document.getElementById('count-compressed').textContent = tasks.filter(t => t.category === 'Compressed').length;
  document.getElementById('count-video').textContent = tasks.filter(t => t.category === 'Video').length;
  document.getElementById('count-audio').textContent = tasks.filter(t => t.category === 'Audio').length;
  document.getElementById('count-program').textContent = tasks.filter(t => t.category === 'Program').length;
  document.getElementById('count-document').textContent = tasks.filter(t => t.category === 'Document').length;
}

// Main Queue Rendering
function renderTasks() {
  const allTasks = taskManager.getTasks();
  let filtered = allTasks;

  if (currentFilter === 'downloading') {
    filtered = allTasks.filter(t => t.status === 'Downloading' || t.status === 'Connecting');
  } else if (currentFilter === 'completed') {
    filtered = allTasks.filter(t => t.status === 'Completed');
  } else if (currentFilter !== 'all') {
    filtered = allTasks.filter(t => t.category === currentFilter);
  }

  updateCategoryCounts();

  if (filtered.length === 0) {
    tasksContainer.innerHTML = `
      <div style="text-align: center; padding: 70px 20px; color: var(--text-muted);">
        <svg width="44" height="44" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" style="margin-bottom: 12px; opacity: 0.4;"><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>
        <p style="font-size: 14px; font-weight: 600; color: #fff;">No downloads in this view</p>
        <p style="font-size: 12px; margin-top: 4px;">Click "+ Add Download" to start link-based accelerated downloading</p>
      </div>`;
    return;
  }

  let html = '';
  filtered.forEach((task) => {
    const isCompleted = task.status === 'Completed';
    const isDownloading = task.status === 'Downloading';
    const isConnecting = task.status === 'Connecting';
    const isError = task.status === 'Error';
    const isPaused = task.status === 'Paused' || task.status === 'Cancelled' || task.status === 'Queued' || task.status === 'Stopped';

    let speedBadge = task.status;
    if (isDownloading) speedBadge = formatSpeed(task.speedMbps || 0);
    else if (isCompleted) speedBadge = '✓ Completed';
    else if (isConnecting) speedBadge = 'Connecting...';
    else if (isError) speedBadge = 'Error';

    const timeTakenText = isCompleted 
      ? `Time Taken: ${formatDuration(task.durationSec)}` 
      : `Elapsed: ${formatDuration(task.elapsedSec || 0)}`;

    const etaText = (task.eta && task.eta > 0) ? formatDuration(task.eta) : 'Calculating...';

    html += `
      <div class="task-card" id="task-card-${task.id}">
        <div class="task-header">
          <div class="task-identity">
            <div class="task-icon">
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/></svg>
            </div>
            <div class="task-name-row">
              <span class="task-name" title="${task.fileName}">${task.fileName}</span>
              
              <div class="task-stat-chips">
                <span class="stat-pill size">
                  <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>
                  <span class="val-size">${formatBytes(task.downloadedBytes)} / ${formatBytes(task.totalBytes)} (${task.percent.toFixed(1)}%)</span>
                </span>

                <span class="stat-pill time-taken">
                  <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg>
                  <span class="val-elapsed">${timeTakenText}</span>
                </span>

                <span class="stat-pill eta" style="${isDownloading ? '' : 'display: none;'}">
                  <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 14 10"/></svg>
                  <span class="val-eta">ETA: ${etaText}</span>
                </span>

                <span class="stat-pill stream">
                  <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2"/></svg>
                  <span>${task.connections || 8} Streams</span>
                </span>
              </div>
            </div>
          </div>

          <div class="task-actions">
            <span class="task-speed-badge ${isDownloading ? 'active' : ''}">${speedBadge}</span>
            
            ${isPaused || isError ? `
              <button class="btn-icon-action btn-start-task" data-id="${task.id}" title="Play / Resume">
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polygon points="5 3 19 12 5 21 5 3"/></svg>
              </button>
            ` : ''}

            ${isDownloading || isConnecting ? `
              <button class="btn-icon-action btn-pause-task" data-id="${task.id}" title="Pause">
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="6" y="4" width="4" height="16"/><rect x="14" y="4" width="4" height="16"/></svg>
              </button>
              <button class="btn-icon-action btn-stop-task" data-id="${task.id}" title="Force Stop">
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="5" y="5" width="14" height="14" rx="2"/></svg>
              </button>
            ` : ''}

            <button class="btn-icon-action btn-restart-task" data-id="${task.id}" title="Restart / Redownload from 0%">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="23 4 23 10 17 10"/><path d="M20.49 15a9 9 0 1 1-2.12-9.36L23 10"/></svg>
            </button>

            ${isCompleted ? `
              <button class="btn-icon-action btn-open-folder" data-id="${task.id}" title="Open Folder">
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"/></svg>
              </button>
            ` : ''}

            <button class="btn-icon-action btn-delete-task" data-id="${task.id}" title="Delete Task">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
            </button>
          </div>
        </div>

        <div class="task-bar-container">
          <div class="task-bar-fill" style="width: ${task.percent}%;"></div>
        </div>
      </div>
    `;
  });

  tasksContainer.innerHTML = html;

  // Bind actions
  document.querySelectorAll('.btn-open-folder').forEach((btn) => {
    btn.addEventListener('click', () => {
      const id = btn.getAttribute('data-id');
      const task = taskManager.getTasks().find(t => t.id === id);
      if (task && task.savePath) {
        shell.showItemInFolder(task.savePath);
      }
    });
  });

  document.querySelectorAll('.btn-start-task').forEach((btn) => {
    btn.addEventListener('click', () => {
      const id = btn.getAttribute('data-id');
      taskManager.resumeTask(id);
      renderTasks();
    });
  });

  document.querySelectorAll('.btn-pause-task').forEach((btn) => {
    btn.addEventListener('click', () => {
      const id = btn.getAttribute('data-id');
      taskManager.pauseTask(id);
      renderTasks();
    });
  });

  document.querySelectorAll('.btn-stop-task').forEach((btn) => {
    btn.addEventListener('click', () => {
      const id = btn.getAttribute('data-id');
      taskManager.forceStopTask(id);
      renderTasks();
    });
  });

  document.querySelectorAll('.btn-restart-task').forEach((btn) => {
    btn.addEventListener('click', () => {
      const id = btn.getAttribute('data-id');
      taskManager.restartTask(id);
      renderTasks();
    });
  });

  document.querySelectorAll('.btn-delete-task').forEach((btn) => {
    btn.addEventListener('click', () => {
      const id = btn.getAttribute('data-id');
      taskManager.deleteTask(id, false);
      renderTasks();
    });
  });
}

// Build Custom Headers from UI
function buildHeaders() {
  const headers = {};
  const referer = modalRefererInput ? modalRefererInput.value.trim() : '';
  if (referer) headers['Referer'] = referer;

  const cookie = modalCookieInput ? modalCookieInput.value.trim() : '';
  if (cookie) headers['Cookie'] = cookie;

  const uaPreset = modalUseragentSelect ? modalUseragentSelect.value : 'default';
  if (uaPreset === 'chrome') {
    headers['User-Agent'] = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36';
  } else if (uaPreset === 'firefox') {
    headers['User-Agent'] = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:123.0) Gecko/20100101 Firefox/123.0';
  } else if (uaPreset === 'edge') {
    headers['User-Agent'] = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36 Edg/122.0.0.0';
  } else if (uaPreset === 'custom' && modalUseragentCustom) {
    const customUa = modalUseragentCustom.value.trim();
    if (customUa) headers['User-Agent'] = customUa;
  }
  return headers;
}

// Live URL Probe
function triggerProbe(force = false) {
  const url = modalUrlInput.value.trim();
  if (!url || !url.startsWith('http')) {
    probeCard.style.display = 'none';
    currentProbeMeta = null;
    return;
  }

  if (!force && url === lastProbedUrl) return;
  lastProbedUrl = url;

  probeCard.style.display = 'flex';
  probeSpinner.style.display = 'block';
  probeStatusText.textContent = 'Probing remote server headers & resumability...';
  probeStatusText.style.color = 'var(--text-secondary)';
  probeMetaBadges.style.display = 'none';

  const headers = buildHeaders();

  taskManager.probeUrl(url, headers, (err, meta) => {
    if (url !== modalUrlInput.value.trim()) return; // Stale request

    probeSpinner.style.display = 'none';

    if (err) {
      probeStatusText.textContent = `Server notice: ${err.message}`;
      probeStatusText.style.color = '#ff9800';
      return;
    }

    currentProbeMeta = meta;
    probeStatusText.textContent = '✓ Ready to download';
    probeStatusText.style.color = '#00e676';
    probeMetaBadges.style.display = 'flex';

    // Auto populate filename if not touched by user
    if (!modalFilenameInput.value || modalFilenameInput.dataset.autoFilled === 'true') {
      modalFilenameInput.value = meta.fileName;
      modalFilenameInput.dataset.autoFilled = 'true';
    }

    // Auto set category
    const cat = taskManager._getCategory(meta.fileName);
    modalCategorySelect.value = cat;

    // Badges
    probeBadgeSize.textContent = meta.contentLength ? formatBytes(meta.contentLength) : 'Dynamic stream';
    if (meta.supportsRange) {
      probeBadgeResume.textContent = '✓ Multi-Thread Resumable';
      probeBadgeResume.className = 'badge resume';
    } else {
      probeBadgeResume.textContent = '⚠ Single Connection Only';
      probeBadgeResume.className = 'badge no-resume';
    }
  });
}

// Populate detected network adapters in Modal
function populateModalAdapters() {
  const adapters = networkManager.getActiveAdapters();
  if (adapters.length === 0) {
    modalAdaptersList.innerHTML = `<span style="font-size:12px; color:var(--text-muted); padding:4px;">No active adapters detected</span>`;
    return;
  }

  let html = '';
  const colors = ['#00f2fe', '#b388ff', '#00e676', '#ffb300'];
  adapters.forEach((adapter, idx) => {
    const color = colors[idx % colors.length];
    html += `
      <label class="adapter-chip-item">
        <div class="adapter-chip-left">
          <input type="checkbox" class="adapter-select-cb" value="${adapter.address}" checked>
          <div>
            <div class="adapter-chip-name" style="color:${color};">${adapter.name}</div>
            <div class="adapter-chip-ip">${adapter.address} (Gateway: ${adapter.gateway || 'Local'})</div>
          </div>
        </div>
        <span class="adapter-badge-speed">Active</span>
      </label>
    `;
  });
  modalAdaptersList.innerHTML = html;
}

// Open Mature Configuration Modal
function openAddModal(prefillUrl = '') {
  addModal.classList.add('open');
  modalSavedirInput.value = config.get().general.downloadDir;
  populateModalAdapters();

  let targetUrl = prefillUrl;
  if (!targetUrl) {
    const clip = clipboard.readText().trim();
    if (clip.startsWith('http://') || clip.startsWith('https://')) {
      targetUrl = clip;
    }
  }

  if (targetUrl) {
    modalUrlInput.value = targetUrl;
    triggerProbe(true);
  } else {
    modalUrlInput.value = '';
    modalFilenameInput.value = '';
    modalFilenameInput.dataset.autoFilled = 'false';
    probeCard.style.display = 'none';
  }

  modalUrlInput.focus();
}

function closeAddModal() {
  addModal.classList.remove('open');
}

// Modal Event Listeners
btnAddDownload.addEventListener('click', () => openAddModal());
btnModalClose.addEventListener('click', closeAddModal);
btnModalCancel.addEventListener('click', closeAddModal);

btnPasteUrl.addEventListener('click', () => {
  const clip = clipboard.readText().trim();
  if (clip) {
    modalUrlInput.value = clip;
    triggerProbe(true);
  }
});

// URL Input Input & Debounced Probe
modalUrlInput.addEventListener('input', () => {
  clearTimeout(probeDebounceTimer);
  probeDebounceTimer = setTimeout(() => triggerProbe(), 400);
});

modalFilenameInput.addEventListener('input', () => {
  modalFilenameInput.dataset.autoFilled = 'false';
});

// Quick Sample Buttons
modalSample10.addEventListener('click', () => {
  modalUrlInput.value = 'https://proof.ovh.net/files/10Mb.dat';
  triggerProbe(true);
});

modalSample100.addEventListener('click', () => {
  modalUrlInput.value = 'https://proof.ovh.net/files/100Mb.dat';
  triggerProbe(true);
});

modalSampleUbuntu.addEventListener('click', () => {
  modalUrlInput.value = 'https://cloud-images.ubuntu.com/minimal/releases/jammy/release/ubuntu-22.04-minimal-cloudimg-amd64.img';
  triggerProbe(true);
});

// Browse Native Folder Picker
btnBrowseFolder.addEventListener('click', async () => {
  const selectedPath = await ipcRenderer.invoke('select-folder');
  if (selectedPath) {
    modalSavedirInput.value = selectedPath;
  }
});

// Stream Count Buttons
document.querySelectorAll('.stream-btn').forEach((btn) => {
  btn.addEventListener('click', () => {
    document.querySelectorAll('.stream-btn').forEach(b => b.classList.remove('active'));
    btn.classList.add('active');
    selectedConnections = parseInt(btn.dataset.val, 10);
    valConnections.textContent = `${selectedConnections} Streams`;
  });
});

// Advanced Accordion Toggle
advancedToggle.addEventListener('click', () => {
  const isOpen = advancedPanel.style.display !== 'none';
  if (isOpen) {
    advancedPanel.style.display = 'none';
    advancedToggle.classList.remove('open');
  } else {
    advancedPanel.style.display = 'flex';
    advancedToggle.classList.add('open');
  }
});

modalUseragentSelect.addEventListener('change', () => {
  if (modalUseragentSelect.value === 'custom') {
    groupCustomUseragent.style.display = 'flex';
  } else {
    groupCustomUseragent.style.display = 'none';
  }
});

// Submission Logic (Queue vs. Start)
function submitDownload(startImmediately = true) {
  const url = modalUrlInput.value.trim();
  if (!url || !url.startsWith('http')) {
    alert('Please enter a valid HTTP or HTTPS download URL.');
    return;
  }

  // Selected adapters
  const selectedAdapters = [];
  document.querySelectorAll('.adapter-select-cb:checked').forEach(cb => {
    selectedAdapters.push(cb.value);
  });

  const options = {
    fileName: modalFilenameInput.value.trim() || (currentProbeMeta ? currentProbeMeta.fileName : null),
    saveDir: modalSavedirInput.value.trim() || config.get().general.downloadDir,
    category: modalCategorySelect.value,
    connections: selectedConnections,
    selectedAdapters: selectedAdapters.length > 0 ? selectedAdapters : null,
    headers: buildHeaders(),
    speedLimit: parseInt(modalSpeedlimitSelect.value, 10) || 0,
    totalBytes: currentProbeMeta ? currentProbeMeta.contentLength : 0
  };

  const task = taskManager.createTask(url, options);
  closeAddModal();
  renderTasks();

  if (startImmediately) {
    taskManager.startTask(task.id);
  }
}

btnModalStart.addEventListener('click', () => submitDownload(true));
btnModalQueue.addEventListener('click', () => submitDownload(false));

// Top Toolbar Actions
btnResumeAll.addEventListener('click', () => {
  taskManager.getTasks().forEach(t => {
    if (t.status === 'Queued' || t.status === 'Paused' || t.status === 'Cancelled' || t.status === 'Stopped' || t.status === 'Error') {
      taskManager.resumeTask(t.id);
    }
  });
  renderTasks();
});

btnPauseAll.addEventListener('click', () => {
  taskManager.getTasks().forEach(t => {
    if (t.status === 'Downloading' || t.status === 'Connecting') {
      taskManager.pauseTask(t.id);
    }
  });
  renderTasks();
});

btnClearCompleted.addEventListener('click', () => {
  const completed = taskManager.getTasks().filter(t => t.status === 'Completed');
  completed.forEach(t => taskManager.deleteTask(t.id, false));
  renderTasks();
});

btnNetworkSettings.addEventListener('click', () => {
  const adapters = networkManager.getActiveAdapters();
  alert(`Active Hardware Pool:\n\n` + adapters.map(a => `• ${a.name}: ${a.address} (Gateway: ${a.gateway || 'Local'})`).join('\n'));
});

// Category Filtering
document.querySelectorAll('.category-item').forEach((item) => {
  item.addEventListener('click', () => {
    document.querySelectorAll('.category-item').forEach(i => i.classList.remove('active'));
    item.classList.add('active');
    currentFilter = item.getAttribute('data-filter');
    renderTasks();
  });
});

// Telemetry & Task Events
taskManager.on('task-updated', () => renderTasks());
taskManager.on('task-completed', () => renderTasks());
taskManager.on('task-error', () => renderTasks());

taskManager.on('task-progress', ({ task, progress }) => {
  const card = document.getElementById(`task-card-${task.id}`);
  if (card) {
    const valSize = card.querySelector('.val-size');
    if (valSize) valSize.textContent = `${formatBytes(task.downloadedBytes)} / ${formatBytes(task.totalBytes)} (${task.percent.toFixed(1)}%)`;

    const valElapsed = card.querySelector('.val-elapsed');
    if (valElapsed) valElapsed.textContent = `Elapsed: ${formatDuration(task.elapsedSec || 0)}`;

    const pillEta = card.querySelector('.stat-pill.eta');
    if (pillEta) pillEta.style.display = '';

    const valEta = card.querySelector('.val-eta');
    if (valEta) valEta.textContent = `ETA: ${task.eta > 0 ? formatDuration(task.eta) : 'Calculating...'}`;

    const bar = card.querySelector('.task-bar-fill');
    if (bar) bar.style.width = `${task.percent}%`;

    const badge = card.querySelector('.task-speed-badge');
    if (badge) {
      badge.textContent = formatSpeed(task.speedMbps || 0);
      badge.classList.add('active');
    }
  }

  // Update Footer Telemetry
  let totalSpeed = 0;
  let stripHtml = '';
  const adapters = networkManager.getActiveAdapters();
  adapters.forEach((adapter, idx) => {
    const colors = ['#00f2fe', '#b388ff', '#00e676', '#ffb300'];
    const color = colors[idx % colors.length];
    const mbps = (progress.adapterSpeeds[adapter.address] || 0).toFixed(2);
    totalSpeed += (progress.adapterSpeeds[adapter.address] || 0);

    stripHtml += `
      <div class="footer-chip">
        <span class="dot" style="background:${color}; box-shadow: 0 0 6px ${color};"></span>
        <span style="color:${color}; font-weight:700;">${adapter.name}:</span>
        <span>${mbps} Mbps</span>
      </div>
    `;
  });

  footerAdaptersStrip.innerHTML = stripHtml;
  footerTotalSpeed.textContent = `${totalSpeed.toFixed(2)} Mbps`;
});

// Initial boot
renderTasks();

// Footer idle refresh
setInterval(() => {
  if (taskManager.getTasks().every(t => t.status !== 'Downloading')) {
    let stripHtml = '';
    const adapters = networkManager.getActiveAdapters();
    adapters.forEach((adapter, idx) => {
      const colors = ['#00f2fe', '#b388ff', '#00e676', '#ffb300'];
      const color = colors[idx % colors.length];
      stripHtml += `
        <div class="footer-chip">
          <span class="dot" style="background:${color}; box-shadow: 0 0 6px ${color};"></span>
          <span style="color:${color}; font-weight:700;">${adapter.name}</span>
          <span style="color:var(--text-muted); font-size:10px;">Ready</span>
        </div>
      `;
    });
    footerAdaptersStrip.innerHTML = stripHtml;
    footerTotalSpeed.textContent = '0.00 Mbps';
  }
}, 3000);
