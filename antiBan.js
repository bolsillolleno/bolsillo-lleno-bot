const NodeCache = require('node-cache');

class AntiBanSystem {
  constructor() {
    this.limits = {
      perHour:       new NodeCache({ stdTTL: 3600  }),  // expira en 1h
      perDay:        new NodeCache({ stdTTL: 86400 }),  // expira en 24h
      // ✅ FIX #10 — groupCooldown almacena true/false (booleano),
      //   no un timestamp. La expiración del cache (stdTTL:7200) ya
      //   maneja el cooldown — la comparación manual de tiempo era
      //   redundante y podía dar falsos negativos.
      groupCooldown: new NodeCache({ stdTTL: 7200 })   // expira en 2h
    };
  }

  canSend(jid, isGroup = false) {
    const phone = jid.split('@')[0];

    // 1. Límite por hora (varía 10-15 para parecer humano)
    const hourLimit = 10 + Math.floor(Math.random() * 6);
    const hourCount = this.limits.perHour.get(phone) || 0;
    if (hourCount >= hourLimit) return { allowed: false, reason: 'hour_limit' };

    // 2. Límite por día
    const dayCount = this.limits.perDay.get(phone) || 0;
    if (dayCount >= 50) return { allowed: false, reason: 'day_limit' };

    // 3. Cooldown de grupo
    if (isGroup) {
      // ✅ FIX #10 — si el valor existe en cache → sigue en cooldown (sin comparar timestamps)
      const enCooldown = this.limits.groupCooldown.get(jid);
      if (enCooldown) return { allowed: false, reason: 'group_cooldown' };
    }

    return { allowed: true };
  }

  registerSend(jid, isGroup = false) {
    const phone = jid.split('@')[0];

    const hourCount = (this.limits.perHour.get(phone) || 0) + 1;
    const dayCount  = (this.limits.perDay.get(phone)  || 0) + 1;

    this.limits.perHour.set(phone, hourCount);
    this.limits.perDay.set(phone, dayCount);

    if (isGroup) {
      // ✅ FIX #10 — guardar booleano, no timestamp
      this.limits.groupCooldown.set(jid, true);
    }
  }

  // Delay aleatorio 2-5 minutos entre mensajes masivos
  getInterval() {
    return (2 + Math.random() * 3) * 60 * 1000;
  }
}

module.exports = new AntiBanSystem();
