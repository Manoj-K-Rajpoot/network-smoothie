'use strict';

const fs = require('fs');

class FileAssembler {
  constructor(filePath, totalBytes) {
    this.filePath = filePath;
    this.totalBytes = totalBytes;
    this.fd = null;
    this.writtenBytes = 0;
    this.isOpen = false;
  }

  open() {
    this.fd = fs.openSync(this.filePath, 'w+');
    this.isOpen = true;

    // Pre-allocate space on disk if total size is known
    if (this.totalBytes > 0) {
      try {
        fs.ftruncateSync(this.fd, this.totalBytes);
      } catch (e) {
        console.warn('ftruncate pre-allocation notice:', e.message);
      }
    }
  }

  writeAt(buffer, offset, callback) {
    if (!this.isOpen || this.fd === null) {
      return callback(new Error('File descriptor is closed'));
    }

    fs.write(this.fd, buffer, 0, buffer.length, offset, (err, bytesWritten) => {
      if (err) return callback(err);
      this.writtenBytes += bytesWritten;
      callback(null, bytesWritten);
    });
  }

  close(callback) {
    if (!this.isOpen || this.fd === null) {
      if (callback) callback();
      return;
    }

    try {
      fs.fsyncSync(this.fd);
      fs.closeSync(this.fd);
      this.isOpen = false;
      this.fd = null;
      if (callback) callback();
    } catch (e) {
      if (callback) callback(e);
    }
  }
}

module.exports = FileAssembler;
