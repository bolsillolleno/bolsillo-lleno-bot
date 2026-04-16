const IntentDetector = require('./intents');
const SegmentacionService = require('./segmentacion.js');
const SorteosService = require('./sorteos');
const Responses = require('./responses');
const antiBan = require('./antiBan');
const { humanDelay, typingSimulation } = require('./delay');
const ai = require('./ai'); // ✅ IA integrada

class BotLogic {
  constructor(sock, state, firebase, io) {
    this.sock = sock;
    this.state = state;
    this.firebase = firebase;
    this.io = io;
    this.intentDetector = new IntentDetector();
    this.segmentacion = new SegmentacionService(firebase);
    this.sorteos = new SorteosService(firebase);
    this.responses = new Responses(firebase);
    this.activeChats = new Map();
  }

  async handleMessage(msg) {
    if (!this.state.botActive) return;

    const jid = msg.key.remoteJid;
    const isGroup = jid.endsWith('@g.us');
    const pushName = msg.pushName || 'Usuario';
    const text = (
      msg.message?.conversation ||
      msg.message?.extendedTextMessage?.text || ''
    ).trim();

    if (!text) return;

    this.updateChatUI(jid, pushName, text, 'incoming');

    // 1. Anti-Ban
    const banCheck = antiBan.canSend(jid, isGroup);
    if (!banCheck.allowed) {
      console.log(`[ANTI-BAN] Bloqueado ${jid}: ${banCheck.reason}`);
      return;
    }

    // 2. Segmentación
    const perfil = await this.segmentacion.clasificarUsuario(jid, pushName, text);

    // 3. Análisis de intención
    const contexto = {
      isGroup,
      mentioned: this.isMentioned(msg, jid),
      tipoUsuario: perfil.tipo,
      historial: this.activeChats.get(jid)?.messages || []
    };
    const analisis = this.intentDetector.analyze(text, contexto);

    // ✅ FIX #5 — En grupos, solo responder si lo mencionan
    if (isGroup && !analisis.requiereRespuesta && !analisis.loMencionan) {
      console.log(`[BOT] Ignorando grupo sin mención: ${jid}`);
      return;
    }

    console.log(
      `[BOT] ${pushName} | Tipo: ${perfil.tipo} | Intención: ${analisis.intencion} | Acción: ${analisis.accionRecomendada}`
    );

    // 4. Obtener sorteo activo
    const sorteosActivos = await this.firebase.getSorteosActivos();
    const sorteo = sorteosActivos[0] || null;

    // 5. Inicializar chat
    if (!this.activeChats.has(jid)) {
      this.activeChats.set(jid, {
        jid,
        nombre: perfil.data?.nombre || pushName,
        tipo: perfil.tipo,
        numerosReservados: [],
        messages: [],
        startTime: Date.now(),
        lastActivity: Date.now()
      });
    }
    const chat = this.activeChats.get(jid);

    // 6. Sincronizar personalidad del panel → IA
    if (this.state.botPersonalidad) {
      ai.setPersonalidad(this.state.botPersonalidad);
    }

    // 7. Generar respuesta (IA primero, plantilla como fallback)
    const respuesta = await this._generarRespuesta({
      analisis, jid, text, perfil, msg, isGroup, sorteo, chat
    });

    if (respuesta) {
      await this.enviarRespuesta(jid, respuesta, isGroup);
      this.updateChatUI(jid, 'Bot', respuesta, 'outgoing');
    }

    // 8. Anti-ban
    antiBan.registerSend(jid, isGroup);
  }

  async _generarRespuesta({ analisis, jid, text, perfil, msg, isGroup, sorteo, chat }) {
    const { accionRecomendada, entities } = analisis;

    if (accionRecomendada === 'IGNORAR') return null;

    // Cierres: reservar número primero (datos exactos requeridos)
    if (accionRecomendada === 'CIERRE_PRIVADO' || accionRecomendada === 'CIERRE_GRUPO') {
      return await this._manejarCierre({
        accionRecomendada, entities, sorteo, chat, jid, perfil, text, isGroup
      });
    }

    // Intentar IA para todos los demás casos
    if (sorteo) {
      const respuestaIA = await ai.generarRespuesta({
        texto: text,
        perfil,
        sorteo,
        historial: chat.messages,
        isGroup,
        analisis
      });
      if (respuestaIA) return respuestaIA;
    }

    // Fallback a plantillas si la IA falla o no hay API key
    return this._plantillaFallback(accionRecomendada, text, sorteo, perfil, entities);
  }

  async _manejarCierre({ accionRecomendada, entities, sorteo, chat, jid, perfil, text, isGroup }) {
    if (!sorteo) {
      return "⏰ *No hay sorteos activos en este momento.*\n\nTe aviso en cuanto abramos uno nuevo 🍀";
    }

    try {
      const cantidad = entities.cantidad || 1;

      // En grupo sin cantidad específica → informar primero
      if (accionRecomendada === 'CIERRE_GRUPO' && (!entities.cantidad || entities.cantidad > 3)) {
        const respuestaIA = await ai.generarRespuesta({
          texto: text, perfil, sorteo, historial: chat.messages, isGroup: true,
          analisis: { accionRecomendada: 'INFORMACION_GRUPO' }
        });
        return respuestaIA || this.responses.infoGrupo({ sorteo, perfil });
      }

      const asignacion = await this.sorteos.asignarNumeros(
        sorteo.id, cantidad,
        {
          nombre: chat.nombre,
          telefono: jid.split('@')[0],
          source: accionRecomendada === 'CIERRE_GRUPO' ? 'grupo_whatsapp' : 'privado_whatsapp'
        },
        sorteo
      );

      chat.numerosReservados = asignacion.numeros;

      if (accionRecomendada === 'CIERRE_PRIVADO') {
        this.state.stats.sales++;
        this.io.emit('stats-update', this.state.stats);
      }

      // Plantilla para cierres: los datos de pago deben ser exactos
      return accionRecomendada === 'CIERRE_GRUPO'
        ? this.responses.cierreGrupo({ nombre: chat.nombre, cantidad, numeros: asignacion.numeros, sorteo, total: asignacion.total })
        : this.responses.cierrePrivado({ nombre: chat.nombre, cantidad, numeros: asignacion.numeros, sorteo, total: asignacion.total });

    } catch (err) {
      console.error('[BOT] Error en cierre:', err.message);
      return `⚠️ *Hubo un problema al reservar tu número.*\n\nEscríbeme directamente y lo resuelvo en segundos 🙏`;
    }
  }

  _plantillaFallback(accionRecomendada, text, sorteo, perfil, entities) {
    if (!sorteo) return "⏰ *No hay sorteos activos ahora mismo.*\n\nTe notifico cuando abramos uno 🍀";
    switch (accionRecomendada) {
      case 'PERSUASION_PRIVADO': return this.responses.persuasion({ sorteo, perfil, entities });
      case 'INFORMACION_GRUPO':  return this.responses.infoGrupo({ sorteo, perfil });
      case 'NO_INSISTIR':        return this.responses.despedidaAmable();
      default:
        if (/^1$|^ver|^números|^numeros/i.test(text)) return this.responses.verNumeros(sorteo);
        if (/^2$|^comprar|^quiero/i.test(text))        return this.responses.menuCompra(sorteo);
        if (/^3$|^promo|^oferta/i.test(text))          return this.responses.promociones(sorteo);
        return this.responses.bienvenida({ sorteo, perfil });
    }
  }

  isMentioned(msg, jid) {
    const extended = msg.message?.extendedTextMessage;
    if (extended?.contextInfo?.participant === this.sock.user?.id) return true;
    const text = (msg.message?.conversation || extended?.text || '').toLowerCase();
    return /bot|sistema|automatizado|bolsillo/i.test(text);
  }

  async enviarRespuesta(jid, texto, isGroup) {
    try {
      await typingSimulation(this.sock, jid, 1500 + Math.random() * 2000);
      await humanDelay(500, 1500);
      await this.sock.sendMessage(jid, { text: texto }); // ✅ FIX #2
      this.state.stats.sent++;
      this.io.emit('stats-update', this.state.stats);
      await this.firebase.logMessage('outgoing', jid.split('@')[0], texto, true);
    } catch (err) {
      console.error('[BOT] Error enviando:', err);
      await this.firebase.logMessage('outgoing', jid.split('@')[0], texto, false);
    }
  }

  updateChatUI(jid, nombre, mensaje, tipo) {
    const chat = this.activeChats.get(jid) || { jid, nombre, messages: [] };
    chat.messages = chat.messages.slice(-49);
    chat.messages.push({ id: Date.now(), nombre, mensaje: mensaje.substring(0, 200), tipo, timestamp: new Date().toISOString() });
    chat.lastActivity = Date.now(); // ✅ FIX #6
    this.activeChats.set(jid, chat);

    this.state.chats.set(jid, {
      jid, nombre: chat.nombre, tipo: chat.tipo,
      lastMessage: mensaje.substring(0, 50),
      unread: tipo === 'incoming' ? (this.state.chats.get(jid)?.unread || 0) + 1 : 0,
      timestamp: Date.now()
    });
    this.io.emit('chats-update', Array.from(this.state.chats.values()));
  }

  async reactivarGrupos() {
    const grupos = Array.from(this.activeChats.entries()).filter(
      ([jid, chat]) => jid.endsWith('@g.us') && chat.lastActivity &&
        Date.now() - chat.lastActivity > 4 * 60 * 60 * 1000
    );
    for (const [jid, chat] of grupos) {
      const check = antiBan.canSend(jid, true);
      if (!check.allowed) continue;
      const sorteos = await this.firebase.getSorteosActivos();
      if (!sorteos.length) continue;
      const sorteo = sorteos[0];
      const msg = (await ai.generarRespuesta({
        texto: 'Reactiva el grupo con un mensaje de urgencia y escasez corto',
        perfil: { tipo: 'FRIO', data: {} }, sorteo, historial: [], isGroup: true,
        analisis: { accionRecomendada: 'INFORMACION_GRUPO' }
      })) || this.responses.reactivacionGrupo({ sorteo });
      await this.enviarRespuesta(jid, msg, true);
      antiBan.registerSend(jid, true);
      await new Promise(r => setTimeout(r, antiBan.getInterval()));
    }
  }
}

module.exports = BotLogic;
