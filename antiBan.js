const NodeCache = require('node-cache');

class AntiBanSystem {
  constructor() {
    // Límites por ventana de tiempo
    this.limits = {
      perHour: new NodeCache({ stdTTL: 3600 }),    // 10-15 mensajes/hora
      perDay: new NodeCache({ stdTTL: 86400 }),    // 50 mensajes/día
      groupCooldown: new NodeCache({ stdTTL: 7200 }) // 1 mensaje/2h por grupo frío
    };
  }

  canSend(jid, isGroup = false) {
    const now = Date.now();
    const phone = jid.split('@')[0];
    
    // 1. Límite por hora (10-15 aleatorio para parecer humano)
    const hourLimit = 10 + Math.floor(Math.random() * 6);
    const hourCount = this.limits.perHour.get(phone) || 0;
    if (hourCount >= hourLimit) return { allowed: false, reason: 'hour_limit' };

    // 2. Límite por día
    const dayCount = this.limits.perDay.get(phone) || 0;
    if (dayCount >= 50) return { allowed: false, reason: 'day_limit' };

    // 3. Cooldown de grupo
    if (isGroup) {
      const lastGroupMsg = this.limits.groupCooldown.get(jid);
      if (lastGroupMsg && (now - lastGroupMsg) < 7200000) {
        return { allowed: false, reason: 'group_cooldown' };
      }
    }

    return { allowed: true };
  }

  registerSend(jid, isGroup = false) {
    const phone = jid.split('@')[0];
    const now = Date.now();
    
    // Incrementar contadores
    const hourCount = (this.limits.perHour.get(phone) || 0) + 1;
    const dayCount = (this.limits.perDay.get(phone) || 0) + 1;
    
    this.limits.perHour.set(phone, hourCount);
    this.limits.perDay.set(phone, dayCount);
    
    if (isGroup) {
      this.limits.groupCooldown.set(jid, now);
    }
  }

  // Delay aleatorio 2-5 minutos entre mensajes masivos
  getInterval() {
    return (2 + Math.random() * 3) * 60 * 1000; // 2-5 min en ms
  }
}

module.exports = new AntiBanSystem();
