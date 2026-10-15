'use strict';

const path = require('path');
const { exec, execFile } = require('child_process');

module.exports = class WindowsProxy {
  constructor() {
    this.host = '127.0.0.1';
    this.port = '1080';
    this.psScriptPath = path.join(__dirname, 'refresh-proxy.ps1');
  }

  _refreshWinINet(callback) {
    execFile(
      'powershell.exe',
      ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', this.psScriptPath],
      (err) => {
        if (err) {
          console.warn('WinINet refresh notice:', err.message);
        }
        if (typeof callback === 'function') callback();
      }
    );
  }

  enableSocksProxy(callback) {
    const regCmd = `reg add "HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Internet Settings" /v ProxyEnable /t REG_DWORD /d 1 /f && ` +
      `reg add "HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Internet Settings" /v ProxyServer /t REG_SZ /d "socks=${this.host}:${this.port}" /f && ` +
      `reg add "HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Internet Settings" /v ProxyOverride /t REG_SZ /d "<local>" /f`;

    exec(regCmd, (err) => {
      if (err) {
        console.error('Failed to enable proxy via reg:', err);
      }
      this._refreshWinINet(callback);
    });
  }

  disableSocksProxy(callback) {
    const regCmd = `reg add "HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Internet Settings" /v ProxyEnable /t REG_DWORD /d 0 /f`;

    exec(regCmd, (err) => {
      if (err) {
        console.error('Failed to disable proxy via reg:', err);
      }
      this._refreshWinINet(callback);
    });
  }

  getProxyStatus(callback) {
    const queryCmd = `reg query "HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Internet Settings" /v ProxyEnable`;
    exec(queryCmd, (err, stdout) => {
      if (err || !stdout) {
        if (typeof callback === 'function') callback(false);
        return;
      }
      const isEnabled = stdout.includes('0x1');
      if (typeof callback === 'function') callback(isEnabled);
    });
  }
};
