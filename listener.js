const BotLogic = require('../bot/logic');

class MessageListener {
  constructor(sock, state, firebase, io) {
    this.sock = sock;
    this.state = state;
    this.firebase = firebase;
    this.io = io;
    this.bot = new BotLogic(sock, state, firebase, io);
    
    this.setupListeners();
  }

  setupListeners() {
    // Mensajes entrantes
    this.sock.ev.on('messages.upsert', async ({ messages, type }) => {
      if (type !== 'notify') return;
      
      for (const msg of messages) {
        // Ignorar mensajes propios
        if (msg.key.fromMe) continue;
        
        // Ignorar status (lecturas, etc)
        if (msg.key.remoteJid === 'status@broadcast') continue;

        this.state.stats.received++;
        this.io.emit('stats-update', this.state.stats);

        // Procesar con el bot
        await this.bot.handleMessage(msg);
      }
    });

    // Actualizaciones de presencia (escribiendo...)
    this.sock.ev.on('presence.update', (update) => {
      this.io.emit('presence-update', update);
    });

    // Participantes de grupos (para análisis)
    this.sock.ev.on('groups.upsert', (groups) => {
      console.log('Nuevos grupos:', groups.length);
    });

    this.sock.ev.on('group-participants.update', (update) => {
      console.log('Actualización grupo:', update);
    });
  }
}

module.exports = MessageListener;
