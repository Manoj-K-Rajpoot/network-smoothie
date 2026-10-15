'use strict';

const { EventEmitter } = require('events');

class Dispatcher extends EventEmitter {
  constructor(addresses) {
    super();
    this.addresses = addresses || [];
    this.connectionsTotal = 0;
    this.connectionsByAddress = {};
    this.bytesInByAddress = {};
    this.bytesOutByAddress = {};
    this.totalBytesIn = 0;
    this.totalBytesOut = 0;

    // Weighted Round-Robin state
    this.currentIndex = 0;
    this.currentWeight = 0;
    this.maxWeight = 1;
    this.gcdWeight = 1;

    // Historical dispatch counter per address
    this.dispatchesByAddress = {};

    this._recomputeWeights();
  }

  setAddresses(addresses) {
    this.addresses = addresses || [];
    this._recomputeWeights();
  }

  _gcd(a, b) {
    let x = Math.abs(a);
    let y = Math.abs(b);
    while (y) {
      const t = y;
      y = x % y;
      x = t;
    }
    return x || 1;
  }

  _recomputeWeights() {
    const active = this.addresses.filter(a => a.enabled !== false && (a.priority === undefined || a.priority > 0));
    if (active.length === 0) {
      this.maxWeight = 1;
      this.gcdWeight = 1;
      return;
    }

    let max = 0;
    let gcd = 0;
    for (const a of active) {
      const p = Math.max(a.priority || 1, 1);
      if (p > max) max = p;
      gcd = gcd === 0 ? p : this._gcd(gcd, p);
    }

    this.maxWeight = max;
    this.gcdWeight = gcd || 1;
  }

  /**
   * Smooth Weighted Round-Robin Dispatcher
   * Ensures fair distribution across all active adapters even with rapid connection closes.
   */
  dispatch() {
    const active = this.addresses.filter(a => a.enabled !== false && (a.priority === undefined || a.priority > 0));
    if (active.length === 0) {
      if (this.addresses.length > 0) return this.addresses[0].address;
      return null;
    }

    if (active.length === 1) {
      const addr = active[0].address;
      this._increment(addr);
      return addr;
    }

    const n = active.length;
    let chosen = null;

    // Classic Nginx-style Smooth Weighted Round Robin
    for (let attempts = 0; attempts < n * 10; attempts++) {
      this.currentIndex = (this.currentIndex + 1) % n;
      if (this.currentIndex === 0) {
        this.currentWeight = this.currentWeight - this.gcdWeight;
        if (this.currentWeight <= 0) {
          this.currentWeight = this.maxWeight;
          if (this.currentWeight === 0) {
            chosen = active[0].address;
            break;
          }
        }
      }

      const candidate = active[this.currentIndex];
      const candidatePriority = candidate.priority || 1;
      if (candidatePriority >= this.currentWeight) {
        chosen = candidate.address;
        break;
      }
    }

    if (!chosen) {
      chosen = active[this.currentIndex % n].address;
    }

    this._increment(chosen);
    return chosen;
  }

  _increment(address) {
    if (!address) return;
    this.connectionsByAddress[address] = (this.connectionsByAddress[address] || 0) + 1;
    this.dispatchesByAddress[address] = (this.dispatchesByAddress[address] || 0) + 1;
    this.connectionsTotal++;
  }

  free(address) {
    if (!address) return;
    if (this.connectionsTotal > 0) this.connectionsTotal--;
    if (this.connectionsByAddress[address]) {
      this.connectionsByAddress[address]--;
      if (this.connectionsByAddress[address] <= 0) {
        delete this.connectionsByAddress[address];
      }
    }
  }

  recordBytes(address, bytesIn, bytesOut) {
    if (bytesIn) {
      this.totalBytesIn += bytesIn;
      if (address) {
        this.bytesInByAddress[address] = (this.bytesInByAddress[address] || 0) + bytesIn;
      }
    }
    if (bytesOut) {
      this.totalBytesOut += bytesOut;
      if (address) {
        this.bytesOutByAddress[address] = (this.bytesOutByAddress[address] || 0) + bytesOut;
      }
    }
  }
}

module.exports = Dispatcher;
