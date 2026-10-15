'use strict';

const os = require('os');
const net = require('net');
const SocksProxy = require('./engine/socks');

module.exports = class DispatchInterface {
  constructor() {
    this.socksProxy = null;
    this.running = false;
    this.adaptersConfig = new Map(); // address -> { enabled, priority }
    this.telemetryInterval = null;
    this.latency = 0;
    this.latencyInterval = null;

    // Previous bytes snapshots for rate calculation
    this.lastBytesIn = 0;
    this.lastBytesOut = 0;
    this.lastTime = Date.now();
    this.lastAdapterBytes = {};

    // Current speeds (bytes per second)
    this.currentDownloadSpeed = 0;
    this.currentUploadSpeed = 0;
    this.sessionBytesDownloaded = 0;
    this.sessionBytesUploaded = 0;

    // Bonding mode: 'speed', 'streaming', 'redundant'
    this.bondingMode = 'speed';
  }

  getNetworkAdapters() {
    const interfaces = os.networkInterfaces();
    const results = [];

    for (const name in interfaces) {
      const addrs = interfaces[name];
      let selectedIPv4 = null;
      let selectedIPv6 = null;
      let isInternal = true;
      let macAddress = '';

      for (const item of addrs) {
        if (!item.internal) {
          isInternal = false;
          if (item.family === 'IPv4' || item.family === 4) {
            selectedIPv4 = item.address;
            macAddress = item.mac;
          } else if (item.family === 'IPv6' || item.family === 6) {
            selectedIPv6 = item.address;
          }
        }
      }

      if (!isInternal && selectedIPv4) {
        const lowerName = name.toLowerCase();
        let type = 'ethernet';
        if (lowerName.includes('wi-fi') || lowerName.includes('wifi') || lowerName.includes('wlan') || lowerName.includes('wireless')) {
          type = 'wifi';
        } else if (lowerName.includes('cellular') || lowerName.includes('mobile') || lowerName.includes('lte') || lowerName.includes('tether') || lowerName.includes('phone')) {
          type = 'cellular';
        } else if (lowerName.includes('vethernet') || lowerName.includes('virtual') || lowerName.includes('vmware') || lowerName.includes('vbox') || lowerName.includes('tap') || lowerName.includes('tun') || lowerName.includes('tailscale') || lowerName.includes('wireguard')) {
          type = 'virtual';
        }

        const savedConfig = this.adaptersConfig.get(selectedIPv4) || {
          enabled: true,
          priority: 2
        };

        const adapterBytesIn = this.socksProxy ? (this.socksProxy.bytesInByAddress[selectedIPv4] || 0) : 0;
        const adapterBytesOut = this.socksProxy ? (this.socksProxy.bytesOutByAddress[selectedIPv4] || 0) : 0;
        const activeConnections = this.socksProxy ? (this.socksProxy.connectionsByAddress[selectedIPv4] || 0) : 0;
        const lastAdapter = this.lastAdapterBytes[selectedIPv4] || { in: 0, out: 0, speedIn: 0, speedOut: 0 };

        const speedIn = lastAdapter.speedIn || 0;
        const speedOut = lastAdapter.speedOut || 0;
        const speedDownMbps = (speedIn * 8) / (1000 * 1000);
        const speedUpMbps = (speedOut * 8) / (1000 * 1000);
        const totalSpeedMbps = speedDownMbps + speedUpMbps;

        results.push({
          name,
          address: selectedIPv4,
          ipv6: selectedIPv6,
          mac: macAddress,
          type,
          priority: savedConfig.priority,
          enabled: savedConfig.enabled,
          bytesIn: adapterBytesIn,
          bytesOut: adapterBytesOut,
          totalBytes: adapterBytesIn + adapterBytesOut,
          speedIn,
          speedOut,
          speedDownMbps,
          speedUpMbps,
          totalSpeedMbps,
          connections: activeConnections,
          status: this.running && savedConfig.enabled ? 'active' : 'ready'
        });
      }
    }

    return results;
  }

  updateAdapterConfig(address, config) {
    const current = this.adaptersConfig.get(address) || { enabled: true, priority: 2 };
    this.adaptersConfig.set(address, Object.assign({}, current, config));

    if (this.socksProxy && this.running) {
      const activeAdapters = this.getNetworkAdapters()
        .filter(a => a.enabled)
        .map(a => ({
          name: a.name,
          address: a.address,
          priority: a.priority
        }));
      this.socksProxy.setAddresses(activeAdapters);
    }
  }

  setBondingMode(mode) {
    this.bondingMode = mode;
  }

  startSocks(onMetricsUpdate) {
    if (this.running && this.socksProxy) {
      return;
    }

    this.running = true;
    const port = 1080;
    const host = '127.0.0.1';

    const adapters = this.getNetworkAdapters()
      .filter(a => a.enabled)
      .map(a => ({
        name: a.name,
        address: a.address,
        priority: a.priority
      }));

    this.socksProxy = new SocksProxy(adapters, port, host);

    // Reset session metrics
    this.lastBytesIn = 0;
    this.lastBytesOut = 0;
    this.lastTime = Date.now();
    this.lastAdapterBytes = {};

    this.startTelemetry(onMetricsUpdate);
    this.measureLatency();
    this.latencyInterval = setInterval(() => this.measureLatency(), 5000);
  }

  startTelemetry(onMetricsUpdate) {
    if (this.telemetryInterval) clearInterval(this.telemetryInterval);

    this.telemetryInterval = setInterval(() => {
      if (!this.socksProxy || !this.running) return;

      const now = Date.now();
      const dt = Math.max((now - this.lastTime) / 1000, 0.2);
      this.lastTime = now;

      const currentTotalIn = this.socksProxy.totalBytesIn || 0;
      const currentTotalOut = this.socksProxy.totalBytesOut || 0;

      const deltaIn = Math.max(currentTotalIn - this.lastBytesIn, 0);
      const deltaOut = Math.max(currentTotalOut - this.lastBytesOut, 0);

      this.lastBytesIn = currentTotalIn;
      this.lastBytesOut = currentTotalOut;

      this.currentDownloadSpeed = deltaIn / dt;
      this.currentUploadSpeed = deltaOut / dt;
      this.sessionBytesDownloaded = currentTotalIn;
      this.sessionBytesUploaded = currentTotalOut;

      // Update per-adapter speeds for EVERY adapter
      const rawAdapters = this.getNetworkAdapters();
      for (const adapter of rawAdapters) {
        const addr = adapter.address;
        const inBytes = this.socksProxy.bytesInByAddress[addr] || 0;
        const outBytes = this.socksProxy.bytesOutByAddress[addr] || 0;
        const prev = this.lastAdapterBytes[addr] || { in: 0, out: 0, speedIn: 0, speedOut: 0 };

        const dIn = Math.max(inBytes - prev.in, 0);
        const dOut = Math.max(outBytes - prev.out, 0);

        this.lastAdapterBytes[addr] = {
          in: inBytes,
          out: outBytes,
          speedIn: dIn / dt,
          speedOut: dOut / dt
        };
      }

      const refreshedAdapters = this.getNetworkAdapters();

      if (typeof onMetricsUpdate === 'function') {
        onMetricsUpdate({
          downloadSpeed: this.currentDownloadSpeed,
          uploadSpeed: this.currentUploadSpeed,
          downloadMbps: (this.currentDownloadSpeed * 8) / (1000 * 1000),
          uploadMbps: (this.currentUploadSpeed * 8) / (1000 * 1000),
          totalDownloaded: this.sessionBytesDownloaded,
          totalUploaded: this.sessionBytesUploaded,
          activeSockets: this.socksProxy.connectionsTotal || 0,
          latency: this.latency,
          adapters: refreshedAdapters
        });
      }
    }, 1000);
  }

  measureLatency() {
    const startTime = Date.now();
    const socket = new net.Socket();
    socket.setTimeout(2500);

    socket.connect(53, '1.1.1.1', () => {
      this.latency = Math.max(Date.now() - startTime, 1);
      socket.destroy();
    });

    socket.on('error', () => {
      socket.destroy();
      const fallbackStart = Date.now();
      const s2 = new net.Socket();
      s2.setTimeout(2500);
      s2.connect(53, '8.8.8.8', () => {
        this.latency = Math.max(Date.now() - fallbackStart, 1);
        s2.destroy();
      });
      s2.on('error', () => {
        this.latency = 0;
        s2.destroy();
      });
    });

    socket.on('timeout', () => {
      this.latency = 0;
      socket.destroy();
    });
  }

  stop(callback) {
    this.running = false;
    if (this.telemetryInterval) {
      clearInterval(this.telemetryInterval);
      this.telemetryInterval = null;
    }
    if (this.latencyInterval) {
      clearInterval(this.latencyInterval);
      this.latencyInterval = null;
    }

    this.currentDownloadSpeed = 0;
    this.currentUploadSpeed = 0;

    if (this.socksProxy) {
      this.socksProxy.stop(() => {
        this.socksProxy = null;
        if (callback) callback();
      });
    } else if (callback) {
      callback();
    }
  }
};
