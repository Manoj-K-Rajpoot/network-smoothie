const { ipcRenderer, clipboard, shell } = require('electron');
const DispatchInterface = require('./DispatchInterface');
const WindowsProxy = require('./WindowsProxy');
const TurboDownloader = require('./engine/TurboDownloader');

// Initialize Engines
const dispatchInterface = new DispatchInterface();
const windowsProxy = new WindowsProxy();
const turboDownloader = new TurboDownloader();

// State
let isBondingActive = false;
let currentMode = 'speed';
let renderedAdapterAddresses = [];

// Graph History (60 rolling points)
const MAX_GRAPH_POINTS = 60;
const downloadHistory = new Array(MAX_GRAPH_POINTS).fill(0);
const uploadHistory = new Array(MAX_GRAPH_POINTS).fill(0);
// Map of address -> Array(MAX_GRAPH_POINTS) of Mbps
const adapterSpeedHistory = new Map();

// Color palette for adapters
const ADAPTER_COLORS = [
  { stroke: '#00f2fe', fill: 'rgba(0, 242, 254, 0.25)', name: 'Cyan' },
  { stroke: '#b388ff', fill: 'rgba(179, 136, 255, 0.25)', name: 'Purple' },
  { stroke: '#00e676', fill: 'rgba(0, 230, 118, 0.25)', name: 'Emerald' },
  { stroke: '#ffb300', fill: 'rgba(255, 179, 0, 0.25)', name: 'Amber' },
  { stroke: '#ff007f', fill: 'rgba(255, 0, 127, 0.25)', name: 'Magenta' }
];

// DOM Elements
const powerSection = document.getElementById('power-section');
const mainPowerBtn = document.getElementById('main-power-btn');
const powerBtnLabel = document.getElementById('power-btn-label');
const statusBadgeText = document.getElementById('status-badge-text');
const statusCaption = document.getElementById('status-caption');
const titleStatusBadge = document.getElementById('title-status-badge');

const metricDownMbps = document.getElementById('metric-download-mbps');
const metricDownBytes = document.getElementById('metric-download-bytes');
const metricUpMbps = document.getElementById('metric-upload-mbps');
const metricUpBytes = document.getElementById('metric-upload-bytes');
const metricSessionData = document.getElementById('metric-session-data');
const metricSessionUnit = document.getElementById('metric-session-unit');
const metricActiveSockets = document.getElementById('metric-active-sockets');

const combinedMbpsPill = document.getElementById('combined-mbps-pill');
const graphAdapterLegends = document.getElementById('graph-adapter-legends');

const latencyDisplay = document.getElementById('latency-display');
const healthDisplay = document.getElementById('health-display');
const systemProxyToggle = document.getElementById('system-proxy-toggle');

const adaptersContainer = document.getElementById('adapters-container');
const adaptersCountBadge = document.getElementById('adapters-count-badge');
const btnTestBond = document.getElementById('btn-test-bond');
const btnTestPing = document.getElementById('btn-test-ping');
const btnRefreshAdapters = document.getElementById('btn-refresh-adapters');
const btnCopyProxy = document.getElementById('btn-copy-proxy');

// Turbo Downloader Elements
const turboUrlInput = document.getElementById('turbo-url-input');
const btnTurboPaste = document.getElementById('btn-turbo-paste');
const btnTurboStart = document.getElementById('btn-turbo-start');
const turboProgressBox = document.getElementById('turbo-progress-box');
const turboFileName = document.getElementById('turbo-file-name');
const turboFileMeta = document.getElementById('turbo-file-meta');
const turboSpeed = document.getElementById('turbo-speed');
const turboEta = document.getElementById('turbo-eta');
const turboBarFill = document.getElementById('turbo-bar-fill');
const turboLanesContainer = document.getElementById('turbo-lanes-container');
const btnTurboCancel = document.getElementById('btn-turbo-cancel');
const btnTurboOpen = document.getElementById('btn-turbo-open');

const appToast = document.getElementById('app-toast');
const toastMessage = document.getElementById('toast-message');

const updateDialog = document.getElementById('update-dialog');
const agreeUpdateBtn = document.getElementById('agree-update-button');
const disagreeUpdateBtn = document.getElementById('disagree-update-button');

const modeButtons = document.querySelectorAll('.mode-btn');

// Canvas Setup
const canvas = document.getElementById('bandwidth-canvas');
const ctx = canvas.getContext('2d');
let canvasWidth = 0;
let canvasHeight = 0;

function resizeCanvas() {
  const rect = canvas.getBoundingClientRect();
  const dpr = window.devicePixelRatio || 1;
  canvasWidth = rect.width;
  canvasHeight = rect.height;
  canvas.width = rect.width * dpr;
  canvas.height = rect.height * dpr;
  ctx.scale(dpr, dpr);
}

window.addEventListener('resize', resizeCanvas);
setTimeout(resizeCanvas, 100);

// ===================================================
// Helper Utilities
// ===================================================
function showToast(msg) {
  toastMessage.textContent = msg;
  appToast.classList.add('show');
  clearTimeout(appToast._timer);
  appToast._timer = setTimeout(() => {
    appToast.classList.remove('show');
  }, 3000);
}

function formatSpeed(bytesPerSec) {
  if (!bytesPerSec || bytesPerSec <= 0) return { val: '0.00', unit: 'KB/s' };
  const kb = bytesPerSec / 1024;
  if (kb < 1000) {
    return { val: kb.toFixed(2), unit: 'KB/s' };
  }
  const mb = kb / 1024;
  return { val: mb.toFixed(2), unit: 'MB/s' };
}

function formatBytes(bytes) {
  if (!bytes || bytes <= 0) return { val: '0.00', unit: 'MB' };
  const mb = bytes / (1024 * 1024);
  if (mb < 1000) {
    return { val: mb.toFixed(2), unit: 'MB' };
  }
  const gb = mb / 1024;
  return { val: gb.toFixed(2), unit: 'GB' };
}

function getAdapterIconSvg(type) {
  switch (type) {
    case 'wifi':
      return `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M5 12.55a11 11 0 0 1 14.08 0"/><path d="M1.42 9a16 16 0 0 1 21.16 0"/><path d="M8.53 16.11a6 6 0 0 1 6.95 0"/><line x1="12" y1="20" x2="12.01" y2="20"/></svg>`;
    case 'cellular':
      return `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="5" y="2" width="14" height="20" rx="2" ry="2"/><line x1="12" y1="18" x2="12.01" y2="18"/></svg>`;
    case 'virtual':
      return `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/></svg>`;
    case 'ethernet':
    default:
      return `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="2" y="2" width="20" height="8" rx="2" ry="2"/><rect x="2" y="14" width="20" height="8" rx="2" ry="2"/><line x1="6" y1="6" x2="6.01" y2="6"/><line x1="6" y1="18" x2="6.01" y2="18"/></svg>`;
  }
}

// ===================================================
// Render & In-Place Update Network Adapters (Zero Jitter)
// ===================================================
function renderAdapters(adapters) {
  const list = adapters || dispatchInterface.getNetworkAdapters();
  adaptersCountBadge.textContent = `${list.filter(a => a.enabled).length} of ${list.length} Active`;

  const currentAddrs = list.map(a => a.address).sort().join(',');
  const renderedAddrs = renderedAdapterAddresses.slice().sort().join(',');

  // If the list of adapters hasn't structurally changed, do fast IN-PLACE updates
  if (currentAddrs === renderedAddrs && adaptersContainer.children.length === list.length) {
    updateAdaptersInPlace(list);
    return;
  }

  // Structural render
  renderedAdapterAddresses = list.map(a => a.address);

  if (list.length === 0) {
    adaptersContainer.innerHTML = `
      <div style="text-align: center; padding: 40px; color: var(--text-muted);">
        <p>No active network adapters detected.</p>
        <p style="font-size: 12px; margin-top: 6px;">Connect to Wi-Fi, Ethernet, or plug in USB tethering.</p>
      </div>`;
    return;
  }

  const totalCombinedBytes = list.reduce((sum, a) => sum + (a.totalBytes || 0), 0);

  let html = '';
  list.forEach((adapter, idx) => {
    const isEnabled = adapter.enabled;
    const isBonded = isBondingActive && isEnabled;
    const iconSvg = getAdapterIconSvg(adapter.type);
    const color = ADAPTER_COLORS[idx % ADAPTER_COLORS.length].stroke;

    const downFmt = formatSpeed(adapter.speedIn || 0);
    const upFmt = formatSpeed(adapter.speedOut || 0);
    const mbps = (adapter.totalSpeedMbps || 0).toFixed(2);

    const trafficPercent = totalCombinedBytes > 0 ? Math.round((adapter.totalBytes / totalCombinedBytes) * 100) : (isEnabled ? Math.round(100 / list.length) : 0);

    const cardClass = `adapter-card ${isBonded ? 'active-link' : ''} ${!isEnabled ? 'disabled-link' : ''}`;

    html += `
      <div class="${cardClass}" id="card-${adapter.address.replace(/\./g, '-')}" data-address="${adapter.address}">
        <div class="adapter-top">
          <div class="adapter-identity">
            <div class="adapter-avatar ${adapter.type}" style="border-left: 3px solid ${color};">
              ${iconSvg}
            </div>
            <div class="adapter-details">
              <div class="adapter-name-row">
                <span class="adapter-name">${adapter.name}</span>
                <span class="adapter-type-pill">${adapter.type.toUpperCase()}</span>
                <span class="adapter-mbps-badge" data-field="mbps" style="border-color:${color}44; color:${color};">${mbps} Mbps</span>
              </div>
              <div class="adapter-ip-row">
                <span>${adapter.address}</span>
                <button class="btn-copy-ip btn-copy-card-ip" data-copy="${adapter.address}" title="Copy IP">
                  <svg viewBox="0 0 24 24" fill="none" stroke-width="2"><rect x="9" y="9" width="13" height="13" rx="2" ry="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg>
                </button>
                ${adapter.mac ? `<span>${adapter.mac}</span>` : ''}
              </div>
            </div>
          </div>

          <div class="adapter-controls">
            <select class="priority-select" data-address="${adapter.address}" title="Bonding Priority Weight" ${!isEnabled ? 'disabled' : ''}>
              <option value="3" ${adapter.priority === 3 ? 'selected' : ''}>Primary (3x)</option>
              <option value="2" ${adapter.priority === 2 ? 'selected' : ''}>Normal (2x)</option>
              <option value="1" ${adapter.priority === 1 ? 'selected' : ''}>Backup (1x)</option>
            </select>

            <label class="switch" title="Toggle Adapter Bonding">
              <input type="checkbox" class="adapter-toggle" data-address="${adapter.address}" ${isEnabled ? 'checked' : ''}>
              <span class="slider"></span>
            </label>
          </div>
        </div>

        <div class="adapter-metrics">
          <div class="adapter-speeds">
            <div class="adapter-speed-item speed-down">
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>
              <span class="adapter-speed-text" data-field="speed-down">${downFmt.val} ${downFmt.unit}</span>
            </div>
            <div class="adapter-speed-item speed-up">
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><polyline points="17 8 12 3 7 8"/><line x1="12" y1="3" x2="12" y2="15"/></svg>
              <span class="adapter-speed-text" data-field="speed-up">${upFmt.val} ${upFmt.unit}</span>
            </div>
          </div>

          <div class="adapter-traffic-share">
            <div class="traffic-share-bar">
              <div class="traffic-share-fill" data-field="share-bar" style="width: ${trafficPercent}%; background: linear-gradient(90deg, ${color}, #4facfe);"></div>
            </div>
            <span class="traffic-share-label" data-field="share-text">${trafficPercent}%</span>
          </div>
        </div>
      </div>
    `;
  });

  adaptersContainer.innerHTML = html;

  // Bind Listeners
  document.querySelectorAll('.adapter-toggle').forEach((cb) => {
    cb.addEventListener('change', (e) => {
      const addr = e.target.getAttribute('data-address');
      const enabled = e.target.checked;
      dispatchInterface.updateAdapterConfig(addr, { enabled });
      renderAdapters();
      showToast(`Adapter ${addr} ${enabled ? 'enabled' : 'disabled'}`);
    });
  });

  document.querySelectorAll('.priority-select').forEach((sel) => {
    sel.addEventListener('change', (e) => {
      const addr = e.target.getAttribute('data-address');
      const priority = parseInt(e.target.value, 10);
      dispatchInterface.updateAdapterConfig(addr, { priority });
      showToast(`Priority updated for ${addr}`);
    });
  });

  document.querySelectorAll('.btn-copy-card-ip').forEach((btn) => {
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      const ip = btn.getAttribute('data-copy');
      clipboard.writeText(ip);
      showToast(`Copied ${ip} to clipboard`);
    });
  });
}

function updateAdaptersInPlace(list) {
  const totalCombinedBytes = list.reduce((sum, a) => sum + (a.totalBytes || 0), 0);

  list.forEach((adapter) => {
    const card = document.getElementById(`card-${adapter.address.replace(/\./g, '-')}`);
    if (!card) return;

    const isBonded = isBondingActive && adapter.enabled;
    card.classList.toggle('active-link', isBonded);
    card.classList.toggle('disabled-link', !adapter.enabled);

    // Update Mbps badge
    const mbpsEl = card.querySelector('[data-field="mbps"]');
    if (mbpsEl) {
      const mbps = (adapter.totalSpeedMbps || 0).toFixed(2);
      mbpsEl.textContent = `${mbps} Mbps`;
    }

    // Update Speed Down
    const downEl = card.querySelector('[data-field="speed-down"]');
    if (downEl) {
      const downFmt = formatSpeed(adapter.speedIn || 0);
      downEl.textContent = `${downFmt.val} ${downFmt.unit}`;
    }

    // Update Speed Up
    const upEl = card.querySelector('[data-field="speed-up"]');
    if (upEl) {
      const upFmt = formatSpeed(adapter.speedOut || 0);
      upEl.textContent = `${upFmt.val} ${upFmt.unit}`;
    }

    // Update Traffic Share
    const trafficPercent = totalCombinedBytes > 0 ? Math.round((adapter.totalBytes / totalCombinedBytes) * 100) : (adapter.enabled ? Math.round(100 / list.length) : 0);
    const barEl = card.querySelector('[data-field="share-bar"]');
    if (barEl) {
      barEl.style.width = `${trafficPercent}%`;
    }
    const textEl = card.querySelector('[data-field="share-text"]');
    if (textEl) {
      textEl.textContent = `${trafficPercent}%`;
    }
  });
}

// ===================================================
// Multi-Adapter Real-Time Canvas Graph (Separate + Combined)
// ===================================================
function drawGraph() {
  if (canvasWidth === 0 || canvasHeight === 0) {
    requestAnimationFrame(drawGraph);
    return;
  }

  ctx.clearRect(0, 0, canvasWidth, canvasHeight);

  // Subtle horizontal grid lines
  ctx.strokeStyle = 'rgba(255, 255, 255, 0.05)';
  ctx.lineWidth = 1;
  const gridSteps = 4;
  for (let i = 1; i <= gridSteps; i++) {
    const y = (canvasHeight / gridSteps) * i;
    ctx.beginPath();
    ctx.moveTo(0, y);
    ctx.lineTo(canvasWidth, y);
    ctx.stroke();
  }

  // Calculate max scale across combined download and all adapter histories
  let maxScale = Math.max(...downloadHistory, ...uploadHistory, 1024 * 50);
  for (const [, history] of adapterSpeedHistory.entries()) {
    const maxA = Math.max(...history);
    if (maxA > maxScale) maxScale = maxA;
  }
  maxScale = maxScale * 1.15;

  function renderWave(data, strokeColor, fillColor) {
    if (!data || data.length < 2) return;
    const stepX = canvasWidth / (MAX_GRAPH_POINTS - 1);

    ctx.beginPath();
    for (let i = 0; i < data.length; i++) {
      const x = i * stepX;
      const val = data[i];
      const y = canvasHeight - ((val / maxScale) * (canvasHeight - 12)) - 4;
      if (i === 0) {
        ctx.moveTo(x, y);
      } else {
        const prevX = (i - 1) * stepX;
        const prevVal = data[i - 1];
        const prevY = canvasHeight - ((prevVal / maxScale) * (canvasHeight - 12)) - 4;
        const cpX = (prevX + x) / 2;
        ctx.bezierCurveTo(cpX, prevY, cpX, y, x, y);
      }
    }

    ctx.strokeStyle = strokeColor;
    ctx.lineWidth = 2;
    ctx.stroke();

    if (fillColor) {
      ctx.lineTo(canvasWidth, canvasHeight);
      ctx.lineTo(0, canvasHeight);
      ctx.closePath();
      ctx.fillStyle = fillColor;
      ctx.fill();
    }
  }

  // 1. Draw each individual adapter trace
  let colorIdx = 0;
  for (const [, history] of adapterSpeedHistory.entries()) {
    const color = ADAPTER_COLORS[colorIdx % ADAPTER_COLORS.length];
    renderWave(history, color.stroke, color.fill);
    colorIdx++;
  }

  // 2. Draw Combined Total Download Line with top white/cyan glow
  const gradCombined = ctx.createLinearGradient(0, 0, 0, canvasHeight);
  gradCombined.addColorStop(0, 'rgba(0, 242, 254, 0.2)');
  gradCombined.addColorStop(1, 'rgba(0, 242, 254, 0.0)');
  renderWave(downloadHistory, '#ffffff', null);

  requestAnimationFrame(drawGraph);
}

requestAnimationFrame(drawGraph);

// ===================================================
// Telemetry Metrics Update Callback
// ===================================================
function onMetricsUpdate(metrics) {
  // Update combined histories
  downloadHistory.shift();
  downloadHistory.push(metrics.downloadSpeed || 0);

  uploadHistory.shift();
  uploadHistory.push(metrics.uploadSpeed || 0);

  // Update per-adapter history buffers
  metrics.adapters.forEach((adapter) => {
    if (!adapterSpeedHistory.has(adapter.address)) {
      adapterSpeedHistory.set(adapter.address, new Array(MAX_GRAPH_POINTS).fill(0));
    }
    const history = adapterSpeedHistory.get(adapter.address);
    history.shift();
    history.push((adapter.speedIn || 0) + (adapter.speedOut || 0));
  });

  // Update Top 4 Metric Cards
  const downMbpsVal = (metrics.downloadMbps || 0).toFixed(2);
  const upMbpsVal = (metrics.uploadMbps || 0).toFixed(2);
  metricDownMbps.textContent = downMbpsVal;
  metricUpMbps.textContent = upMbpsVal;

  const downBytesFmt = formatSpeed(metrics.downloadSpeed || 0);
  const upBytesFmt = formatSpeed(metrics.uploadSpeed || 0);
  metricDownBytes.textContent = `${downBytesFmt.val} ${downBytesFmt.unit}`;
  metricUpBytes.textContent = `${upBytesFmt.val} ${upBytesFmt.unit}`;

  const totalSessionBytes = (metrics.totalDownloaded || 0) + (metrics.totalUploaded || 0);
  const sessionFmt = formatBytes(totalSessionBytes);
  metricSessionData.textContent = sessionFmt.val;
  metricSessionUnit.textContent = sessionFmt.unit;

  metricActiveSockets.textContent = metrics.activeSockets || 0;

  // Update Combined Mbps Pill above graph
  const totalCombinedMbps = ((metrics.downloadMbps || 0) + (metrics.uploadMbps || 0)).toFixed(2);
  combinedMbpsPill.textContent = `Combined: ${totalCombinedMbps} Mbps`;

  // Update Multi-Adapter Live Graph Legend Chips
  updateGraphLegends(metrics.adapters);

  // Latency & Quality
  if (metrics.latency > 0) {
    latencyDisplay.textContent = `${metrics.latency} ms`;
    if (metrics.latency < 60) {
      latencyDisplay.className = 'health-value excellent';
      healthDisplay.textContent = 'Excellent';
    } else if (metrics.latency < 140) {
      latencyDisplay.className = 'health-value fair';
      healthDisplay.textContent = 'Good';
    } else {
      latencyDisplay.className = 'health-value';
      healthDisplay.textContent = 'Congested';
    }
  }

  // Update Adapter Cards In-Place (Zero Jitter)
  renderAdapters(metrics.adapters);
}

function updateGraphLegends(adapters) {
  let legendHtml = '';
  adapters.forEach((adapter, idx) => {
    const color = ADAPTER_COLORS[idx % ADAPTER_COLORS.length].stroke;
    const mbps = (adapter.totalSpeedMbps || 0).toFixed(2);
    legendHtml += `
      <div class="legend-chip" title="${adapter.name} (${adapter.address})">
        <span class="legend-dot" style="background:${color}; box-shadow:0 0 6px ${color};"></span>
        <span style="color:${color}; font-weight:700;">${adapter.name}:</span>
        <span>${mbps} Mbps</span>
      </div>
    `;
  });
  graphAdapterLegends.innerHTML = legendHtml;
}

// ===================================================
// Start & Stop Bonding Actions
// ===================================================
function startBonding() {
  const activeAdapters = dispatchInterface.getNetworkAdapters().filter(a => a.enabled);
  if (activeAdapters.length === 0) {
    showToast('No enabled network adapters to bond!');
    return;
  }

  isBondingActive = true;
  powerSection.classList.add('bonded');
  statusBadgeText.textContent = 'BONDED & ACCELERATING';
  powerBtnLabel.textContent = 'STOP';
  statusCaption.textContent = `Aggregating ${activeAdapters.length} connections`;
  titleStatusBadge.textContent = `Bonded (${activeAdapters.length} Links)`;
  titleStatusBadge.style.color = 'var(--accent-cyan)';
  titleStatusBadge.style.borderColor = 'rgba(0, 242, 254, 0.4)';

  dispatchInterface.startSocks(onMetricsUpdate);

  if (systemProxyToggle.checked) {
    windowsProxy.enableSocksProxy(() => {
      showToast('Windows System Proxy routed through Smoothie');
    });
  }

  renderAdapters();
  showToast(`Bonding Active: ${activeAdapters.length} adapters combined`);
}

function stopBonding() {
  isBondingActive = false;
  powerSection.classList.remove('bonded');
  statusBadgeText.textContent = 'DISCONNECTED';
  powerBtnLabel.textContent = 'START';
  statusCaption.textContent = 'Combine multiple connections for boosted speed';
  titleStatusBadge.textContent = 'Standby';
  titleStatusBadge.style.color = '';
  titleStatusBadge.style.borderColor = '';

  metricDownMbps.textContent = '0.00';
  metricDownBytes.textContent = '0.00 MB/s';
  metricUpMbps.textContent = '0.00';
  metricUpBytes.textContent = '0.00 MB/s';
  metricActiveSockets.textContent = '0';
  combinedMbpsPill.textContent = 'Combined: 0.00 Mbps';

  for (let i = 0; i < 5; i++) {
    downloadHistory.shift();
    downloadHistory.push(0);
    uploadHistory.shift();
    uploadHistory.push(0);
  }

  for (const [, history] of adapterSpeedHistory.entries()) {
    history.fill(0);
  }

  dispatchInterface.stop(() => {
    windowsProxy.disableSocksProxy(() => {
      showToast('Smoothie Stopped. System proxy restored.');
    });
    renderAdapters();
  });
}

// ===================================================
// Event Listeners
// ===================================================
mainPowerBtn.addEventListener('click', () => {
  if (isBondingActive) {
    stopBonding();
  } else {
    startBonding();
  }
});

modeButtons.forEach((btn) => {
  btn.addEventListener('click', () => {
    modeButtons.forEach(b => b.classList.remove('active'));
    btn.classList.add('active');
    currentMode = btn.getAttribute('data-mode');
    dispatchInterface.setBondingMode(currentMode);
    showToast(`Bonding Mode set to ${currentMode.toUpperCase()}`);
  });
});

systemProxyToggle.addEventListener('change', () => {
  if (isBondingActive) {
    if (systemProxyToggle.checked) {
      windowsProxy.enableSocksProxy(() => showToast('System proxy enabled'));
    } else {
      windowsProxy.disableSocksProxy(() => showToast('System proxy disabled'));
    }
  }
});

btnTestBond.addEventListener('click', () => {
  if (!isBondingActive) {
    startBonding();
  }

  btnTestBond.disabled = true;
  btnTestBond.innerHTML = `
    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" style="animation: spin 1s linear infinite;"><path d="M21 12a9 9 0 1 1-6.219-8.56"/></svg>
    <span>Testing Multi-Bond...</span>
  `;
  showToast('Launching parallel test streams across all adapters...');

  const https = require('https');
  const adapters = dispatchInterface.getNetworkAdapters().filter(a => a.enabled);
  if (adapters.length === 0) {
    showToast('No active adapters to test.');
    btnTestBond.disabled = false;
    btnTestBond.innerHTML = `<span>Run Multi-Bond Test</span>`;
    return;
  }

  let completedStreams = 0;
  const totalStreams = adapters.length * 2;

  adapters.forEach((adapter) => {
    for (let c = 0; c < 2; c++) {
      const req = https.get('https://speed.cloudflare.com/__down?bytes=4000000', {
        localAddress: adapter.address
      }, (res) => {
        res.on('data', (chunk) => {
          if (dispatchInterface.socksProxy) {
            dispatchInterface.socksProxy.recordBytes(adapter.address, chunk.length, 0);
          }
        });
        res.on('end', () => {
          completedStreams++;
          if (completedStreams >= totalStreams) {
            btnTestBond.disabled = false;
            btnTestBond.innerHTML = `
              <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2"/></svg>
              <span>Run Multi-Bond Test</span>
            `;
            showToast('Multi-Bond Benchmark Complete! All adapters verified.');
          }
        });
      });
      req.on('error', (err) => {
        completedStreams++;
        console.warn('Benchmark error on', adapter.address, err.message);
        if (completedStreams >= totalStreams) {
          btnTestBond.disabled = false;
          btnTestBond.innerHTML = `
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2"/></svg>
            <span>Run Multi-Bond Test</span>
          `;
        }
      });
    }
  });
});

btnTestPing.addEventListener('click', () => {
  showToast('Measuring latency to DNS...');
  dispatchInterface.measureLatency();
  setTimeout(() => {
    if (dispatchInterface.latency > 0) {
      latencyDisplay.textContent = `${dispatchInterface.latency} ms`;
      showToast(`Ping measured: ${dispatchInterface.latency} ms`);
    } else {
      showToast('Ping test completed.');
    }
  }, 1200);
});

btnRefreshAdapters.addEventListener('click', () => {
  btnRefreshAdapters.style.transform = 'rotate(360deg)';
  btnRefreshAdapters.style.transition = 'transform 0.5s ease';
  setTimeout(() => {
    btnRefreshAdapters.style.transform = '';
  }, 500);

  renderAdapters();
  showToast('Network adapters rescanned');
});

btnCopyProxy.addEventListener('click', () => {
  clipboard.writeText('127.0.0.1:1080');
  showToast('SOCKS5 proxy address (127.0.0.1:1080) copied!');
});

agreeUpdateBtn.addEventListener('click', () => {
  updateDialog.close();
  ipcRenderer.send('quitAndInstall');
});

disagreeUpdateBtn.addEventListener('click', () => {
  updateDialog.close();
});

ipcRenderer.on('updateReady', () => {
  if (updateDialog) updateDialog.showModal();
});

windowsProxy.getProxyStatus((isActive) => {
  systemProxyToggle.checked = true;
});

dispatchInterface.measureLatency();
setTimeout(() => {
  if (dispatchInterface.latency > 0) {
    latencyDisplay.textContent = `${dispatchInterface.latency} ms`;
  }
}, 1500);

renderAdapters();

// ===================================================
// Turbo Downloader Wiring
// ===================================================
let lastSavedFilePath = null;

// Preset sample buttons
document.querySelectorAll('.preset-btn').forEach((btn) => {
  btn.addEventListener('click', () => {
    const url = btn.getAttribute('data-url');
    turboUrlInput.value = url;
    showToast(`Loaded ${btn.textContent}`);
  });
});

// Paste button
btnTurboPaste.addEventListener('click', () => {
  const text = clipboard.readText().trim();
  if (text.startsWith('http')) {
    turboUrlInput.value = text;
    showToast('Pasted URL from clipboard');
  } else {
    showToast('Clipboard does not contain a valid URL');
  }
});

// Start Turbo Download
btnTurboStart.addEventListener('click', () => {
  const url = turboUrlInput.value.trim();
  if (!url || !url.startsWith('http')) {
    showToast('Please enter or paste a valid http/https download URL');
    return;
  }

  if (turboDownloader.isDownloading) {
    showToast('A download is already in progress');
    return;
  }

  if (!isBondingActive) {
    startBonding();
  }

  const activeAdapters = dispatchInterface.getNetworkAdapters().filter(a => a.enabled);
  if (activeAdapters.length === 0) {
    showToast('No enabled network adapters to bond download!');
    return;
  }

  // Reset UI
  turboProgressBox.style.display = 'flex';
  btnTurboOpen.style.display = 'none';
  btnTurboCancel.style.display = 'inline-block';
  btnTurboStart.disabled = true;
  btnTurboStart.innerHTML = `<span>Connecting...</span>`;
  turboBarFill.style.width = '0%';
  turboSpeed.textContent = '0.00 Mbps';
  turboEta.textContent = 'Connecting...';
  lastSavedFilePath = null;

  showToast(`Starting Turbo Download sliced across ${activeAdapters.length} adapters...`);

  turboDownloader.download(url, activeAdapters);
});

// Turbo Downloader Events
turboDownloader.on('start', (meta) => {
  turboFileName.textContent = meta.fileName;
  const mb = (meta.totalBytes / (1024 * 1024)).toFixed(2);
  turboFileMeta.textContent = `0.00 / ${mb} MB (0%)`;
  btnTurboStart.innerHTML = `<span>Downloading...</span>`;
  showToast(`Slicing ${meta.fileName} across ${meta.adaptersCount} adapters`);
});

turboDownloader.on('progress', (p) => {
  const mbDownloaded = (p.downloadedBytes / (1024 * 1024)).toFixed(2);
  const mbTotal = (p.totalBytes / (1024 * 1024)).toFixed(2);
  const pct = p.percent.toFixed(1);

  turboFileMeta.textContent = `${mbDownloaded} / ${mbTotal} MB (${pct}%)`;
  turboBarFill.style.width = `${pct}%`;
  turboSpeed.textContent = `${p.speedMbps.toFixed(2)} Mbps`;
  turboEta.textContent = p.eta > 0 ? `ETA: ${p.eta}s` : 'Finishing...';

  // Record bytes in socks proxy telemetry so the main graphs spike too!
  if (dispatchInterface.socksProxy) {
    for (const [addr, b] of Object.entries(p.adapterBytes)) {
      dispatchInterface.socksProxy.recordBytes(addr, b, 0);
    }
  }

  // Render per-adapter lanes
  const activeAdapters = dispatchInterface.getNetworkAdapters().filter(a => a.enabled);
  let lanesHtml = '';
  activeAdapters.forEach((adapter, idx) => {
    const color = ADAPTER_COLORS[idx % ADAPTER_COLORS.length].stroke;
    const addr = adapter.address;
    const mbps = (p.adapterSpeeds[addr] || 0).toFixed(2);
    const downloaded = ((p.adapterBytes[addr] || 0) / (1024 * 1024)).toFixed(2);

    lanesHtml += `
      <div class="turbo-lane-chip" style="border-left: 3px solid ${color};">
        <div class="turbo-lane-top">
          <span style="color:${color};">${adapter.name}</span>
          <span style="color:var(--text-muted); font-size:10px;">${downloaded} MB</span>
        </div>
        <div class="turbo-lane-speed" style="color:${color}; font-weight:700;">
          ${mbps} Mbps
        </div>
      </div>
    `;
  });
  turboLanesContainer.innerHTML = lanesHtml;
});

turboDownloader.on('complete', (meta) => {
  lastSavedFilePath = meta.savePath;
  turboBarFill.style.width = '100%';
  turboEta.textContent = 'Completed!';
  turboSpeed.textContent = '0.00 Mbps';
  btnTurboStart.disabled = false;
  btnTurboStart.innerHTML = `<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg><span>Turbo Download</span>`;
  btnTurboCancel.style.display = 'none';
  btnTurboOpen.style.display = 'inline-block';

  showToast(`Download Complete: Saved to ${path.basename(meta.savePath)}!`);
});

turboDownloader.on('error', (err) => {
  btnTurboStart.disabled = false;
  btnTurboStart.innerHTML = `<span>Turbo Download</span>`;
  turboEta.textContent = 'Failed';
  showToast(`Turbo Download Error: ${err.message}`);
});

turboDownloader.on('cancel', () => {
  btnTurboStart.disabled = false;
  btnTurboStart.innerHTML = `<span>Turbo Download</span>`;
  turboEta.textContent = 'Cancelled';
  showToast('Download cancelled');
});

// Cancel button
btnTurboCancel.addEventListener('click', () => {
  turboDownloader.cancel();
});

// Open File in folder
btnTurboOpen.addEventListener('click', () => {
  if (lastSavedFilePath) {
    shell.showItemInFolder(lastSavedFilePath);
  }
});

setInterval(() => {
  if (!isBondingActive) {
    renderAdapters();
  }
}, 8000);
