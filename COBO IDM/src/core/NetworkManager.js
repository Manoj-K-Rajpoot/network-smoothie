'use strict';

const os = require('os');
const net = require('net');
const { EventEmitter } = require('events');

class NetworkManager extends EventEmitter {
  constructor() {
    super();
    this.adaptersConfig = new Map(); // address -> { enabled, priority }
    this.adapterLatencies = new Map();
    this.healthInterval = null;
  }

  getAdapters() {
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
        } else if (lowerName.includes('cellular') || lowerName.includes('mobile') || lowerName.includes('lte') || lowerName.includes('tether') || lowerName.includes('phone') || lowerName.includes('ndis')) {
          type = 'cellular';
        } else if (lowerName.includes('vethernet') || lowerName.includes('virtual') || lowerName.includes('vmware') || lowerName.includes('vbox') || lowerName.includes('tap') || lowerName.includes('tun') || lowerName.includes('tailscale') || lowerName.includes('wireguard')) {
          type = 'virtual';
        }

        const saved = this.adaptersConfig.get(selectedIPv4) || {
          enabled: true,
          priority: 2
        };

        results.push({
          name,
          address: selectedIPv4,
          ipv6: selectedIPv6,
          mac: macAddress,
          type,
          enabled: saved.enabled,
          priority: saved.priority,
          latency: this.adapterLatencies.get(selectedIPv4) || 0
        });
      }
    }

    return results;
  }

  getActiveAdapters() {
    return this.getAdapters().filter(a => a.enabled !== false);
  }

  updateAdapter(address, config) {
    const current = this.adaptersConfig.get(address) || { enabled: true, priority: 2 };
    this.adaptersConfig.set(address, Object.assign({}, current, config));
    this.emit('adapters-changed', this.getAdapters());
  }

  probeLatency() {
    const active = this.getActiveAdapters();
    for (const adapter of active) {
      const startTime = Date.now();
      const socket = new net.Socket();
      socket.setTimeout(2500);

      socket.connect(53, '1.1.1.1', { localAddress: adapter.address }, () => {
        const lat = Math.max(Date.now() - startTime, 1);
        this.adapterLatencies.set(adapter.address, lat);
        socket.destroy();
      });

      socket.on('error', () => {
        socket.destroy();
        this.adapterLatencies.set(adapter.address, 999);
      });

      socket.on('timeout', () => {
        socket.destroy();
        this.adapterLatencies.set(adapter.address, 999);
      });
    }
  }

  startMonitoring(intervalSec = 10) {
    if (this.healthInterval) clearInterval(this.healthInterval);
    this.probeLatency();
    this.healthInterval = setInterval(() => {
      this.probeLatency();
    }, intervalSec * 1000);
  }

  stopMonitoring() {
    if (this.healthInterval) {
      clearInterval(this.healthInterval);
      this.healthInterval = null;
    }
  }
}

module.exports = NetworkManager;
