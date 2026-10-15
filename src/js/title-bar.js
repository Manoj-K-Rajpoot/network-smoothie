'use strict';

const { ipcRenderer } = require('electron');

document.addEventListener('DOMContentLoaded', () => {
  const minBtn = document.getElementById('btn-minimize');
  const maxBtn = document.getElementById('btn-maximize');
  const closeBtn = document.getElementById('btn-close');

  if (minBtn) {
    minBtn.addEventListener('click', () => {
      ipcRenderer.send('window-minimize');
    });
  }

  if (maxBtn) {
    maxBtn.addEventListener('click', () => {
      ipcRenderer.send('window-maximize');
    });
  }

  if (closeBtn) {
    closeBtn.addEventListener('click', () => {
      ipcRenderer.send('window-close');
    });
  }
});
