 const { 
  default: makeWASocket, 
  DisconnectReason, 
  useMultiFileAuthState,
  fetchLatestBaileysVersion 
} = require('@whiskeysockets/baileys');
const P = require('pino');
const QRCode = require('qrcode');

class WhatsAppConnection {
  constructor(io, state, firebase) {
    this.io = io;
    this.state = state;
    this.firebase = firebase;
    this.sock = null;
    this.retryCount = 0;
  }

  async connect() {
    try {
      const { state: authState, saveCreds } = await useMultiFileAuthState('./auth_info');
      const { version } = await fetchLatestBaileysVersion();
      
      this.state.connection = 'connecting';
      this.io.emit('connection-status', 'connecting');

      this.sock = makeWASocket({
        version,
        logger: P({ level: 'silent' }),
        printQRInTerminal: true,
        auth: authState,
        browser: ['Bol$illoBot', 'Chrome', '1.0'],
        generateHighQualityLinkPreview: true
      });

      this.setupListeners(saveCreds);
    } catch (err) {
      console.error('Error conexión:', err);
      this.handleReconnect();
    }
  }

  setupListeners(saveCreds) {
    this.sock.ev.on('creds.update', saveCreds);
    
    this.sock.ev.on('connection.update', (update) => {
      const { connection, lastDisconnect, qr } = update;
      
      if (qr) {
        this.state.qrCode = qr;
        this.state.connection = 'qr';
        // Generar QR para el frontend
        QRCode.toDataURL(qr, (err, url) => {
          this.io.emit('qr-code', url);
        });
      }

      if (connection === 'close') {
        const shouldReconnect = lastDisconnect?.error?.output?.statusCode !== DisconnectReason.loggedOut;
        if (shouldReconnect) {
          this.handleReconnect();
        } else {
          this.state.connection = 'disconnected';
          this.io.emit('connection-status', 'disconnected');
        }
      } else if (connection === 'open') {
        this.state.connection = 'connected';
        this.retryCount = 0;
        this.io.emit('connection-status', 'connected');
        console.log('✅ WhatsApp Conectado');
      }
    });

    // Delegar mensajes al listener especializado
    const MessageListener = require('./listener');
    new MessageListener(this.sock, this.state, this.firebase, this.io);
  }

  handleReconnect() {
    this.retryCount++;
    const delay = Math.min(1000 * 2 ** this.retryCount, 30000);
    console.log(`Reconectando en ${delay}ms...`);
    setTimeout(() => this.connect(), delay);
  }

  async sendMessage(jid, text, options = {}) {
    if (!this.sock || this.state.connection !== 'connected') {
      throw new Error('WhatsApp no conectado');
    }
    
    // Delay humanizado anti-ban
    const { humanDelay } = require('../utils/delay');
    await humanDelay(1000, 3000);
    
    return await this.sock.sendMessage(jid, { 
      text,
      ...options 
    });
  }

  async disconnect() {
    await this.sock?.logout();
    this.state.connection = 'disconnected';
    this.io.emit('connection-status', 'disconnected');
  }
}

module.exports = WhatsAppConnection;
