const antiBan = require('./antiBan');
const { humanDelay, typingSimulation } = require('./delay');
const Responses = require('./responses');

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
//  GroupOutreach — Bol$illo Lleno x5
//  Contacta miembros del grupo admin uno a uno
//  según su clasificación como cliente
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

class GroupOutreach {
  constructor(sock, state, firebase, io) {
    this.sock      = sock;
    this.state     = state;
    this.firebase  = firebase;
    this.io        = io;
    this.responses = new Responses(firebase);
    this.running   = false;
  }

  // ─────────────────────────────────────────────
  //  Obtener grupos donde somos admin
  // ─────────────────────────────────────────────
  async getAdminGroups() {
    try {
      const groups  = await this.sock.groupFetchAllParticipating();
      const myId    = this.sock.user.id.split(':')[0];
      const adminGs = [];

      for (const [jid, meta] of Object.entries(groups)) {
        const me      = meta.participants.find(p => p.id.split(':')[0] === myId);
        const esAdmin = me?.admin === 'admin' || me?.admin === 'superadmin';
        if (esAdmin) {
          adminGs.push({ jid, name: meta.subject, participants: meta.participants });
          console.log(`✅ Grupo admin encontrado: ${meta.subject} (${meta.participants.length} miembros)`);
        }
      }

      return adminGs;
    } catch (err) {
      console.error('❌ Error obteniendo grupos:', err);
      return [];
    }
  }

  // ─────────────────────────────────────────────
  //  Clasificar miembros del grupo
  // ─────────────────────────────────────────────
  async clasificarMiembros(participants, sorteoId) {
    const myId     = this.sock.user.id.split(':')[0];
    const clientes = await this.firebase.getClientesDB();
    const compras  = await this.firebase.getComprasBySorteo(sorteoId);

    const compradores = new Set(
      (compras || []).map(c => c.telefono?.slice(-8))
    );
    const clientesDB  = new Set(
      (clientes || []).map(c => c.telefono?.slice(-8))
    );

    const clasificados = { COMPRADOR: [], CLIENTE: [], INTERESADO: [], FRIO: [] };

    for (const p of participants) {
      const phone = p.id.split('@')[0].split(':')[0];

      // Ignorar al propio bot
      if (phone === myId) continue;

      const jid = `${phone}@s.whatsapp.net`;

      if (compradores.has(phone.slice(-8))) {
        clasificados.COMPRADOR.push({ jid, phone });
      } else if (clientesDB.has(phone.slice(-8))) {
        clasificados.CLIENTE.push({ jid, phone });
      } else {
        // Sin historial → frío, pero es miembro del grupo → interesado potencial
        clasificados.INTERESADO.push({ jid, phone });
      }
    }

    console.log(`📊 Clasificación:
      COMPRADOR (ya compró este sorteo): ${clasificados.COMPRADOR.length}
      CLIENTE (ha comprado antes):       ${clasificados.CLIENTE.length}
      INTERESADO (miembro del grupo):    ${clasificados.INTERESADO.length}`);

    return clasificados;
  }

  // ─────────────────────────────────────────────
  //  Lanzar outreach completo
  //  opciones.tipos: array de tipos a contactar
  //  ej: ['CLIENTE', 'INTERESADO']
  //  opciones.limiteTotal: max mensajes esta sesión
  // ─────────────────────────────────────────────
  async launch({ tipos = ['CLIENTE', 'INTERESADO'], limiteTotal = 40 } = {}) {
    if (this.running) {
      console.log('⚠️ Outreach ya está corriendo');
      return { ok: false, reason: 'already_running' };
    }
    if (this.state.connection !== 'connected') {
      return { ok: false, reason: 'not_connected' };
    }

    this.running = true;
    this.io.emit('outreach-status', { running: true, sent: 0, total: 0 });

    try {
      // Obtener grupo admin
      const adminGroups = await this.getAdminGroups();
      if (!adminGroups.length) {
        this.running = false;
        return { ok: false, reason: 'no_admin_groups' };
      }

      // Usar el primer grupo admin (Bol$illo Lleno)
      const grupo = adminGroups[0];
      console.log(`🎯 Trabajando con grupo: ${grupo.name}`);

      // Sorteo activo
      const sorteosActivos = await this.firebase.getSorteosActivos();
      const sorteo = sorteosActivos?.[0];
      if (!sorteo) {
        this.running = false;
        return { ok: false, reason: 'no_sorteo_activo' };
      }

      // Clasificar miembros
      const clasificados = await this.clasificarMiembros(grupo.participants, sorteo.id);

      // Construir lista a contactar según tipos solicitados
      let listaFinal = [];
      for (const tipo of tipos) {
        listaFinal = listaFinal.concat(
          (clasificados[tipo] || []).map(m => ({ ...m, tipo }))
        );
      }

      // Limitar total
      listaFinal = listaFinal.slice(0, limiteTotal);

      console.log(`📤 Iniciando outreach: ${listaFinal.length} contactos`);
      this.io.emit('outreach-status', { running: true, sent: 0, total: listaFinal.length });

      let enviados = 0, omitidos = 0;

      for (let i = 0; i < listaFinal.length; i++) {
        if (!this.running) {
          console.log('🛑 Outreach detenido manualmente');
          break;
        }

        const { jid, tipo } = listaFinal[i];

        // Verificar anti-ban
        const check = antiBan.canSend(jid, false, true);
        if (!check.allowed) {
          console.log(`⏭️ Omitiendo ${jid}: ${check.reason}`);
          omitidos++;
          continue;
        }

        // Generar mensaje personalizado con Claude
        const perfil = {
          tipo,
          data: { nombre: '' }
        };

        const mensajeBase = this.getMensajeBase(tipo, sorteo);
        const texto = await this.responses.generate({
          jid,
          mensaje:   mensajeBase,
          sorteo,
          perfil,
          isGroup:   false,
          accion:    tipo === 'COMPRADOR' ? 'PERSUASION_PRIVADO' : 'INFORMACION_GRUPO'
        });

        // Enviar con simulación humana
        try {
          await typingSimulation(this.sock, jid, antiBan.getTypingDelay(texto.length));
          await humanDelay(500, 1500);
          await this.sock.sendMessage(jid, { text: texto });
          antiBan.registerSend(jid, false);
          enviados++;

          console.log(`✅ [${enviados}/${listaFinal.length}] Enviado a ${jid} (${tipo})`);
          this.io.emit('outreach-status', { running: true, sent: enviados, total: listaFinal.length });

          // Pausa entre lotes de 10
          if (enviados % 10 === 0 && i < listaFinal.length - 1) {
            const pausa = antiBan.getBatchDelay();
            console.log(`⏸️ Pausa de lote: ${Math.round(pausa / 60000)} minutos`);
            this.io.emit('outreach-status', {
              running: true, sent: enviados, total: listaFinal.length,
              pausaHasta: Date.now() + pausa
            });
            await new Promise(r => setTimeout(r, pausa));
          } else {
            // Pausa entre mensajes individuales
            const intervalo = antiBan.getBroadcastInterval();
            await new Promise(r => setTimeout(r, intervalo));
          }

        } catch (err) {
          console.error(`❌ Error enviando a ${jid}:`, err.message);
          omitidos++;
        }
      }

      console.log(`🏁 Outreach finalizado: ${enviados} enviados, ${omitidos} omitidos`);
      this.io.emit('outreach-status', {
        running: false, sent: enviados, skipped: omitidos, total: listaFinal.length, done: true
      });

      return { ok: true, enviados, omitidos };

    } catch (err) {
      console.error('❌ Error en outreach:', err);
      return { ok: false, reason: err.message };
    } finally {
      this.running = false;
    }
  }

  // ─────────────────────────────────────────────
  //  Detener outreach desde el panel
  // ─────────────────────────────────────────────
  stop() {
    this.running = false;
    this.io.emit('outreach-status', { running: false, stopped: true });
    console.log('🛑 Outreach detenido');
  }

  // ─────────────────────────────────────────────
  //  Mensaje base según tipo (Claude lo personaliza)
  // ─────────────────────────────────────────────
  getMensajeBase(tipo, sorteo) {
    switch (tipo) {
      case 'COMPRADOR':
        return `[CONTEXTO: Esta persona ya compró en sorteos anteriores. Recuérdale que hay un nuevo sorteo activo: ${sorteo.name}. Invítala a participar de nuevo con entusiasmo pero sin presionar.]`;
      case 'CLIENTE':
        return `[CONTEXTO: Esta persona es miembro del grupo Bol$illo Lleno x5 y ha interactuado antes. Preséntale el sorteo activo: ${sorteo.name}. Sé cálido y directo.]`;
      case 'INTERESADO':
      default:
        return `[CONTEXTO: Esta persona es miembro del grupo Bol$illo Lleno x5 pero nunca ha comprado. Preséntate brevemente y cuéntale del sorteo activo: ${sorteo.name}. Sé amigable, no invasivo.]`;
    }
  }
}

module.exports = GroupOutreach;
