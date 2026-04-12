global.crypto = require('crypto');

const {
  default: makeWASocket,
  DisconnectReason,
  useMultiFileAuthState,
  fetchLatestBaileysVersion
} = require('@whiskeysockets/baileys');

const P       = require('pino');
const QRCode  = require('qrcode');
const fs      = require('fs');
const path    = require('path');

// ✅ BUG RAÍZ CORREGIDO: importar MessageListener
const MessageListener = require('./listener');

const SESSION_DIR = path.join(process.cwd(), 'auth_info');

class WhatsAppConnection {
  constructor(io, state, firebase) {
    this.io         = io;
    this.state      = state;
    this.firebase   = firebase;
    this.sock       = null;
    this.retryCount = 0;
    this.listener   = null;
  }

  async connect() {
    try {
      // ✅ BUG #2 CORREGIDO: NO borrar sesión aquí.
      // Antes borraba auth_info en CADA connect() incluyendo reconexiones automáticas
      // → loop infinito de QR. Ahora solo se borra en logout real o reconnectFresh().

      const { state: authState, saveCreds } = await useMultiFileAuthState(SESSION_DIR);
      const { version } = await fetchLatestBaileysVersion();

      this.state.connection = 'connecting';
      this.io.emit('connection-status', 'connecting');

      this.sock = makeWASocket({
        version,
        logger: P({ level: 'silent' }),
        printQRInTerminal: true,
        auth: authState,
        browser: ['Bol$illoBot', 'Chrome', '1.0'],
        connectTimeoutMs: 60000,
        defaultQueryTimeoutMs: 0,
        keepAliveIntervalMs: 10000,
        emitOwnEvents: true,
        fireInitQueries: true
      });

      // ✅ BUG RAÍZ CORREGIDO: instanciar MessageListener inmediatamente.
      // ANTES: listener.js existía pero JAMÁS se instanciaba en ningún archivo.
      // Los mensajes llegaban al socket pero nadie llamaba bot.handleMessage(msg).
      // Por eso el bot aparecía "en línea" pero nunca respondía nada.
      this.listener = new MessageListener(this.sock, this.state, this.firebase, this.io);

      this.setupListeners(saveCreds);

    } catch (err) {
      console.error('❌ Error conexión:', err);
      this.handleReconnect();
    }
  }

  // ✅ BUG #3 CORREGIDO: método público sendMessage faltaba
  // server.js llama waConnection.sendMessage() → crash sin este método
  async sendMessage(jid, text) {
    if (!this.sock) throw new Error('Socket no inicializado');
    return this.sock.sendMessage(jid, { text });
  }

  // ✅ Reconexión limpia: borra sesión y fuerza nuevo QR (solo manual desde panel)
  async reconnectFresh() {
    if (fs.existsSync(SESSION_DIR)) {
      fs.rmSync(SESSION_DIR, { recursive: true, force: true });
      console.log('🧹 Sesión eliminada para reconexión limpia');
    }
    this.retryCount = 0;
    await this.connect();
  }

  // ✅ Desconexión limpia desde panel
  disconnect() {
    if (this.sock) {
      this.sock.end(new Error('Desconexión manual'));
      this.sock = null;
    }
    this.listener = null;
    this.state.connection = 'disconnected';
    this.io.emit('connection-status', 'disconnected');
  }

  setupListeners(saveCreds) {
    this.sock.ev.on('creds.update', async () => {
      await saveCreds();
    });

    this.sock.ev.on('connection.update', (update) => {
      console.log('🧠 UPDATE:', update);

      const { connection, lastDisconnect, qr } = update;

      if (qr) {
        console.log('📲 QR generado');
        this.state.qrCode     = qr;
        this.state.connection = 'qr';
        this.io.emit('connection-status', 'qr');
        QRCode.toDataURL(qr, (err, url) => {
          if (!err) this.io.emit('qr-code', url);
        });
      }

      if (connection === 'close') {
        const code      = lastDisconnect?.error?.output?.statusCode;
        const loggedOut = code === DisconnectReason.loggedOut;

        if (loggedOut) {
          console.log('🔴 Sesión cerrada — se requiere nuevo QR');
          this.state.connection = 'disconnected';
          this.io.emit('connection-status', 'disconnected');
          if (fs.existsSync(SESSION_DIR)) {
            fs.rmSync(SESSION_DIR, { recursive: true, force: true });
          }
        } else {
          this.handleReconnect();
        }

      } else if (connection === 'open') {
        console.log('✅ WhatsApp Conectado — Listener activo 🟢');
        this.state.connection = 'connected';
        this.state.qrCode     = null;
        this.retryCount       = 0;
        this.io.emit('connection-status', 'connected');
      }
    });
  }

  handleReconnect() {
    this.retryCount++;
    const delay = Math.min(1000 * 2 ** this.retryCount, 30000);
    console.log(`🔄 Reconectando en ${delay / 1000}s... (intento #${this.retryCount})`);
    setTimeout(() => this.connect(), delay);
  }
}

module.exports = WhatsAppConnection;
