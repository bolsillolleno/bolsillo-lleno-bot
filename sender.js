const antiBan = require('../utils/antiBan');
const { humanDelay } = require('../utils/delay');

class MessageQueue {
  constructor(sock, firebase) {
    this.sock = sock;
    this.firebase = firebase;
    this.queue = [];
    this.processing = false;
  }

  async add(jid, message, priority = 'normal') {
    this.queue.push({ jid, message, priority, addedAt: Date.now() });
    this.queue.sort((a, b) => {
      if (a.priority === 'high') return -1;
      if (b.priority === 'high') return 1;
      return a.addedAt - b.addedAt;
    });
    
    if (!this.processing) this.process();
  }

  async process() {
    this.processing = true;
    
    while (this.queue.length > 0) {
      const item = this.queue.shift();
      const isGroup = item.jid.endsWith('@g.us');
      
      // Verificar anti-ban
      const check = antiBan.canSend(item.jid, isGroup);
      if (!check.allowed) {
        console.log(`[QUEUE] Postergado ${item.jid}: ${check.reason}`);
        this.queue.push({ ...item, retryAfter: Date.now() + 300000 }); // Reintentar en 5min
        await humanDelay(5000, 10000);
        continue;
      }

      try {
        await this.sock.sendMessage(item.jid, { text: item.message });
        await this.firebase.logMessage('queued', item.jid.split('@')[0], item.message, true);
        
        // Delay entre mensajes (2-5 min)
        await new Promise(r => setTimeout(r, antiBan.getInterval()));
        
      } catch (err) {
        console.error('[QUEUE] Error:', err);
        await this.firebase.logMessage('queued', item.jid.split('@')[0], item.message, false);
      }
    }
    
    this.processing = false;
  }
}

module.exports = MessageQueue;
