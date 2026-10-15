const fs = require('fs');
const path = require('path');
const url = require('url');
const { app, BrowserWindow, ipcMain, dialog } = require('electron');

let mainWindow = null;

// Built-in live hot-reload (like nodemon for Electron)
function setupLiveReload() {
  const watchDirs = [
    path.join(__dirname, 'ui'),
    path.join(__dirname, 'core')
  ];

  let reloadDebounce = null;
  watchDirs.forEach((dir) => {
    try {
      if (fs.existsSync(dir)) {
        fs.watch(dir, { recursive: true }, (eventType, filename) => {
          if (!filename) return;
          if (filename.startsWith('.') || filename.endsWith('~')) return;

          clearTimeout(reloadDebounce);
          reloadDebounce = setTimeout(() => {
            console.log(`[Auto-Refresh] File modified: ${filename} — Reloading interface...`);
            if (mainWindow && !mainWindow.isDestroyed()) {
              mainWindow.webContents.reloadIgnoringCache();
            }
          }, 150);
        });
      }
    } catch (e) {
      console.warn('Live reload watcher notice:', e.message);
    }
  });
}

function createWindow() {
  mainWindow = new BrowserWindow({
    backgroundColor: '#080b14',
    width: 980,
    height: 680,
    minWidth: 840,
    minHeight: 560,
    resizable: true,
    frame: false,
    show: false,
    webPreferences: {
      nodeIntegration: true,
      contextIsolation: false,
      enableRemoteModule: true
    }
  });

  mainWindow.once('ready-to-show', () => {
    mainWindow.show();
  });

  mainWindow.webContents.on('before-input-event', (event, input) => {
    if (input.key === 'F12' || (input.control && input.shift && input.key.toLowerCase() === 'i')) {
      mainWindow.webContents.toggleDevTools();
    }
  });

  mainWindow.loadURL(url.format({
    pathname: path.join(__dirname, 'ui', 'index.html'),
    protocol: 'file:',
    slashes: true
  }));

  mainWindow.on('closed', () => {
    mainWindow = null;
  });
}

// Window control IPC handlers
ipcMain.on('window-minimize', () => {
  if (mainWindow) mainWindow.minimize();
});

ipcMain.on('window-maximize', () => {
  if (!mainWindow) return;
  if (mainWindow.isMaximized()) {
    mainWindow.unmaximize();
  } else {
    mainWindow.maximize();
  }
});

ipcMain.on('window-close', () => {
  if (mainWindow) mainWindow.close();
});

ipcMain.handle('select-folder', async () => {
  if (!mainWindow) return null;
  const result = await dialog.showOpenDialog(mainWindow, {
    properties: ['openDirectory', 'createDirectory']
  });
  if (!result.canceled && result.filePaths.length > 0) {
    return result.filePaths[0];
  }
  return null;
});

app.on('ready', () => {
  createWindow();
  setupLiveReload();
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

app.on('activate', () => {
  if (mainWindow === null) {
    createWindow();
  }
});
