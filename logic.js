const IntentDetector      = require('./intents');
const SegmentacionService = require('./segmentacion.js');
const SorteosService      = require('./sorteos');
const Responses           = require('./responses');
const antiBan             = require('./antiBan');
const { humanDelay, typingSimulation } = require('./delay');

class BotLogic {
  constructor(sock, state, firebase, io) {
    this.sock           = sock;
    this.state          = state;
    this.firebase       = firebase;
    this.io             = io;
    this.intentDetector = new IntentDetector();
    this.segmentacion   = new SegmentacionService(firebase);
    this.sorteos        = new SorteosService(firebase);
    this.responses      = new Responses(firebase);
    this.activeChats    = new Map();
  }

  async handleMessage(msg) {
    if (!this.state.botActive) return;

    const jid      = msg.key.remoteJid;
    const isGroup  = jid.endsWith('@g.us');
    const pushName = msg.pushName || 'Usuario';
    const text     = (msg.message?.conversation || msg.message?.extendedTextMessage?.text || '').trim();

    if (!text) return;

    this.updateChatUI(jid, pushName, text, 'incoming');

    const banCheck = antiBan.canSend(jid, isGroup);
    if (!banCheck.allowed) {
      console.log(`[ANTI-BAN] Bloqueado ${jid}: ${banCheck.reason}`);
      return;
    }

    const perfil  = await this.segmentacion.clasificarUsuario(jid, pushName, text);
    const contexto = {
      isGroup,
      mentioned:   this.isMentioned(msg, jid),
      tipoUsuario: perfil.tipo,
      historial:   this.activeChats.get(jid)?.messages || []
    };
    const analisis = this.intentDetector.analyze(text, contexto);

    console.log(`[BOT] ${pushName} | ${jid} | Tipo: ${perfil.tipo} | Intención: ${analisis.intencion} | Acción: ${analisis.accionRecomendada}`);

    const respuesta = await this.ejecutarAccion(analisis, jid, text, perfil, msg, isGroup);

    if (respuesta) {
      await this.enviarRespuesta(jid, respuesta, isGroup);
      this.updateChatUI(jid, 'Bot', respuesta, 'outgoing');
    }

    antiBan.registerSend(jid, isGroup);
  }

  isMentioned(msg, jid) {
    const extended = msg.message?.extendedTextMessage;
    if (extended?.contextInfo?.participant === this.sock.user?.id) return true;
    const text = (msg.message?.conversation || extended?.text || '').toLowerCase();
    return /bot|sistema|automatizado|bolsillo/i.test(text);
  }

  async ejecutarAccion(analisis, jid, text, perfil, msg, isGroup) {
    const { intencion, accionRecomendada, entities } = analisis;
    const sorteosActivos = await this.firebase.getSorteosActivos();
    const sorteo = sorteosActivos[0];

    if (!sorteo) return "⏰ *No hay sorteos activos en este momento.*\n\nTe aviso en cuanto abramos uno nuevo 🍀";

    if (!this.activeChats.has(jid)) {
      this.activeChats.set(jid, {
        jid,
        nombre:            perfil.data?.nombre || msg.pushName,
        tipo:              perfil.tipo,
        intencionActual:   intencion,
        numerosReservados: [],
        startTime:         Date.now()
      });
    }
    const chat = this.activeChats.get(jid);

    switch (accionRecomendada) {
      case 'IGNORAR':
        return null;

      case 'CIERRE_GRUPO': {
        if (entities.cantidad && entities.cantidad <= 3) {
          const asignacion = await this.sorteos.asignarNumeros(sorteo.id, entities.cantidad, {
            nombre: chat.nombre, telefono: jid.split('@')[0], source: 'grupo_whatsapp'
          });
          chat.numerosReservados = asignacion.numeros;
          return this.responses.cierreGrupo({
            nombre: chat.nombre, cantidad: entities.cantidad,
            numeros: asignacion.numeros, sorteo, total: asignacion.total
          });
        }
        return this.responses.infoGrupo({ sorteo, perfil });
      }

      case 'CIERRE_PRIVADO': {
        const cantidad   = entities.cantidad || 1;
        const asignacion = await this.sorteos.asignarNumeros(sorteo.id, cantidad, {
          nombre: chat.nombre, telefono: jid.split('@')[0], source: 'privado_whatsapp'
        });
        chat.numerosReservados = asignacion.numeros;
        this.state.stats.sales++;
        this.io.emit('stats-update', this.state.stats);
        return this.responses.cierrePrivado({
          nombre: chat.nombre, cantidad,
          numeros: asignacion.numeros, sorteo, total: asignacion.total
        });
      }

      case 'PERSUASION_PRIVADO':
        return this.responses.persuasion({ sorteo, perfil, entities });

      case 'INFORMACION_GRUPO':
        return this.responses.infoGrupo({ sorteo, perfil });

      case 'NO_INSISTIR':
        return this.responses.despedidaAmable();

      default:
        if (/^1$|^ver|^números|^numeros/i.test(text)) return this.responses.verNumeros(sorteo);
        if (/^2$|^comprar|^quiero/i.test(text))       return this.responses.menuCompra(sorteo);
        if (/^3$|^promo|^oferta/i.test(text))         return this.responses.promociones(sorteo);
        return this.responses.bienvenida({ sorteo, perfil });
    }
  }

  async enviarRespuesta(jid, texto, isGroup) {
    try {
      await typingSimulation(this.sock, jid, 1500 + Math.random() * 2000);
      await humanDelay(500, 1500);

      // ✅ FIX #4: era { text } — variable inexistente → mensaje undefined/vacío.
      // WhatsApp recibe el mensaje vacío y lo descarta silenciosamente.
      await this.sock.sendMessage(jid, { text: texto });

      // ✅ FIX #5: stats.sent nunca se incrementaba
      this.state.stats.sent++;
      this.io.emit('stats-update', this.state.stats);

      await this.firebase.logMessage('outgoing', jid.split('@')[0], texto, true);

    } catch (err) {
      console.error('Error enviando:', err);
      // ✅ FIX #5: stats.errors nunca se incrementaba
      this.state.stats.errors++;
      this.io.emit('stats-update', this.state.stats);
      await this.firebase.logMessage('outgoing', jid.split('@')[0], texto, false);
    }
  }

  updateChatUI(jid, nombre, mensaje, tipo) {
    const chat = this.activeChats.get(jid) || { jid, nombre, messages: [] };
    chat.messages = chat.messages.slice(-49);
    chat.messages.push({
      id: Date.now(), nombre,
      mensaje:   mensaje.substring(0, 200),
      tipo,
      timestamp: new Date().toISOString()
    });
    this.activeChats.set(jid, chat);
    this.state.chats.set(jid, {
      jid,
      nombre:      chat.nombre,
      tipo:        chat.tipo,
      lastMessage: mensaje.substring(0, 50),
      unread:      tipo === 'incoming' ? (this.state.chats.get(jid)?.unread || 0) + 1 : 0,
      timestamp:   Date.now()
    });
    this.io.emit('chats-update', Array.from(this.state.chats.values()));
  }

  async reactivarGrupos() {
    const grupos = Array.from(this.activeChats.entries())
      .filter(([jid, chat]) => jid.endsWith('@g.us') &&
        Date.now() - chat.startTime > 4 * 60 * 60 * 1000);
    for (const [jid] of grupos) {
      const check = antiBan.canSend(jid, true);
      if (!check.allowed) continue;
      const sorteos = await this.firebase.getSorteosActivos();
      if (!sorteos[0]) continue;
      const msg = this.responses.reactivacionGrupo({ sorteo: sorteos[0] });
      await this.enviarRespuesta(jid, msg, true);
      antiBan.registerSend(jid, true);
      await new Promise(r => setTimeout(r, antiBan.getInterval()));
    }
  }
}

module.exports = BotLogic;
