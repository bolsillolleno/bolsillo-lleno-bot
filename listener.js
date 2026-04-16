const BotLogic      = require('./logic');
const GroupOutreach = require('./groupOutreach');
const antiBan       = require('./antiBan');

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
//  MessageListener — Bol$illo Lleno x5
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

class MessageListener {
  constructor(sock, state, firebase, io) {
    this.sock     = sock;
    this.state    = state;
    this.firebase = firebase;
    this.io       = io;
    this.bot      = new BotLogic(sock, state, firebase, io);
    this.outreach = new GroupOutreach(sock, state, firebase, io);

    this.setupListeners();
    this.setupSocketControls();
  }

  setupListeners() {
    // ── Mensajes entrantes ───────────────────────
    this.sock.ev.on('messages.upsert', async ({ messages, type }) => {
      if (type !== 'notify') return;

      for (const msg of messages) {
        if (msg.key.fromMe) continue;
        if (msg.key.remoteJid === 'status@broadcast') continue;

        const jid = msg.key.remoteJid;

        // ✅ Regla de oro #1: registrar que este contacto nos escribió
        antiBan.registerIncoming(jid);
        this.state.stats.received++;
        this.io.emit('stats-update', this.state.stats);

        // Guardar en Firebase bandeja (para el panel)
        const text = (
          msg.message?.conversation ||
          msg.message?.extendedTextMessage?.text || ''
        ).trim();

        if (text) {
          await this.firebase.saveInboxMessage({
            jid,
            pushName:  msg.pushName || 'Usuario',
            text,
            timestamp: Date.now(),
            fromMe:    false
          }).catch(() => {});
        }

        this.io.emit('wa-message', {
          jid,
          nombre:    msg.pushName || 'Usuario',
          text:      text.substring(0, 100),
          timestamp: Date.now()
        });

        // Procesar con el bot
        await this.bot.handleMessage(msg);
      }
    });

    // ── Presencia ────────────────────────────────
    this.sock.ev.on('presence.update', (update) => {
      this.io.emit('presence-update', update);
    });

    // ── Grupos: invalidar cache de admin al cambiar ──
    this.sock.ev.on('group-participants.update', (update) => {
      console.log('👥 Cambio en grupo:', update.id);
      this.bot.resetGroupCache();
    });

    this.sock.ev.on('groups.upsert', () => {
      this.bot.resetGroupCache();
    });
  }

  // ── Controles del panel via Socket.IO ───────────
  setupSocketControls() {
    // Registrar en sockets ya conectados (evita duplicados en reconexiones)
    this.io.sockets.sockets.forEach(socket => this._registerSocketControls(socket));
    this.io.on('connection', socket => this._registerSocketControls(socket));
  }

  _registerSocketControls(socket) {
    // Evitar registrar más de una vez por socket
    if (socket._bolsilloControlsRegistered) return;
    socket._bolsilloControlsRegistered = true;

    // Lanzar outreach desde el panel
    socket.on('outreach-launch', async (opciones) => {
      console.log('🚀 Outreach lanzado desde panel:', opciones);
      const result = await this.outreach.launch(opciones);
      socket.emit('outreach-result', result);
    });

    // Detener outreach
    socket.on('outreach-stop', () => {
      this.outreach.stop();
    });

    // Obtener grupos admin (para mostrar en panel)
    socket.on('get-admin-groups', async () => {
      const groups = await this.outreach.getAdminGroups();
      socket.emit('admin-groups', groups.map(g => ({
        jid:      g.jid,
        name:     g.name,
        members:  g.participants.length,
        participants: g.participants.map(p => ({
          id: p.id,
          admin: p.admin || null
        }))
      })));
    });
  }
}

module.exports = MessageListener;
