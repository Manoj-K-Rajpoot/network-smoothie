'use strict';

const net = require('net');
const socks = require('socks-handler');
const Dispatcher = require('./dispatcher');

class SocksProxy extends Dispatcher {
  constructor(addresses, listenPort = 1080, listenHost = 'localhost') {
    super(addresses);

    this.listenPort = listenPort;
    this.listenHost = listenHost;
    this.activeSockets = new Set();
    this.isListening = false;

    this.server = net.createServer((clientConnection) => {
      this.activeSockets.add(clientConnection);
      clientConnection.on('close', () => {
        this.activeSockets.delete(clientConnection);
      });

      socks.handle(clientConnection, (err, handler) => {
        if (err) {
          this.emit('socksError', err);
          return;
        }

        handler.on('error', (hErr) => {
          this.emit('socksError', hErr);
        });

        handler.on('request', ({ version, command, host, port }, callback) => {
          if (command !== socks[5].COMMAND.CONNECT) {
            this.emit('socksError', new Error(`Unsupported command: ${command}`));
            if (version === 5) {
              callback(socks[5].REQUEST_STATUS.COMMAND_NOT_SUPPORTED);
            } else {
              callback(socks[4].REQUEST_STATUS.REFUSED);
            }
            return;
          }

          const localAddress = this.dispatch();
          if (!localAddress) {
            callback(version === 5 ? socks[5].REQUEST_STATUS.SERVER_FAILURE : socks[4].REQUEST_STATUS.FAILED);
            return;
          }

          const serverConnection = net.createConnection({ port, host, localAddress });
          this.activeSockets.add(serverConnection);

          serverConnection.on('close', () => {
            this.activeSockets.delete(serverConnection);
          });

          // Metrics instrumentation: track upload (client -> server) & download (server -> client)
          clientConnection.on('data', (chunk) => {
            this.recordBytes(localAddress, 0, chunk.length);
          });

          serverConnection.on('data', (chunk) => {
            this.recordBytes(localAddress, chunk.length, 0);
          });

          clientConnection.pipe(serverConnection).pipe(clientConnection);

          const onConnectError = (connErr) => {
            let status;
            if (version === 5) {
              switch (connErr.code) {
                case 'EHOSTUNREACH':
                  status = socks[5].REQUEST_STATUS.HOST_UNREACHABLE;
                  break;
                case 'ECONNREFUSED':
                  status = socks[5].REQUEST_STATUS.CONNECTION_REFUSED;
                  break;
                case 'ENETUNREACH':
                  status = socks[5].REQUEST_STATUS.NETWORK_UNREACHABLE;
                  break;
                default:
                  status = socks[5].REQUEST_STATUS.SERVER_FAILURE;
              }
            } else {
              status = socks[4].REQUEST_STATUS.FAILED;
            }
            callback(status);
          };

          serverConnection
            .on('error', onConnectError)
            .on('connect', () => {
              serverConnection.removeListener('error', onConnectError);
              const status = (version === 5) ? socks[5].REQUEST_STATUS.SUCCESS : socks[4].REQUEST_STATUS.GRANTED;
              callback(status);
            })
            .on('end', () => {
              this.free(localAddress);
            })
            .on('close', () => {
              this.free(localAddress);
            });

          this.emit('request', { clientConnection, serverConnection, host, port, localAddress });
        });
      });
    });

    this.server.on('error', (err) => {
      this.emit('error', err);
    });

    this.server.listen(this.listenPort, this.listenHost, () => {
      this.isListening = true;
      this.emit('listening', { port: this.listenPort, host: this.listenHost });
    });
  }

  stop(callback) {
    this.isListening = false;
    for (const socket of this.activeSockets) {
      try {
        socket.destroy();
      } catch (e) {
        // ignore
      }
    }
    this.activeSockets.clear();
    if (this.server) {
      try {
        this.server.close((err) => {
          if (callback) callback(err);
        });
      } catch (err) {
        if (callback) callback(err);
      }
    } else if (callback) {
      callback();
    }
  }
}

module.exports = SocksProxy;
