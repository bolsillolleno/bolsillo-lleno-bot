const IntentDetector    = require('./intents');
const SegmentacionService = require('./segmentacion');
const SorteosService    = require('./sorteos');
const Responses         = require('./responses');
const antiBan           = require('./antiBan');
const { humanDelay, typingSimulation } = require('./delay');

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
//  BotLogic — Bol$illo Lleno x5
//  Claude responde · Solo activo en grupos donde
//  Camilo es administrador
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

class BotLogic {
  constructor(sock, state, firebase, io) {
    this.sock         = sock;
    this.state        = state;
    this.firebase     = firebase;
    this.io           = io;
    this.intentDetector = new IntentDetector();
    this.segmentacion = new SegmentacionService(firebase);
    this.sorteos      = new SorteosService(firebase);
    this.responses    = new Responses(firebase);
    this.activeChats  = new Map();

    // Cache de grupos donde somos admin
    // Se rellena la primera vez que llega un mensaje de un grupo
    this.adminGroups  = new Set();
    this.checkedGroups = new Set();
  }

  // ─────────────────────────────────────────────
  //  ¿Somos admin en este grupo?
  // ─────────────────────────────────────────────
  async isAdminInGroup(groupJid) {
    if (this.adminGroups.has(groupJid))  return true;
    if (this.checkedGroups.has(groupJid)) return false;

    try {
      const metadata  = await this.sock.groupMetadata(groupJid);
      const myId      = this.sock.user.id.split(':')[0];
      const me        = metadata.participants.find(p => p.id.split(':')[0] === myId);
      const esAdmin   = me?.admin === 'admin' || me?.admin === 'superadmin';

      this.checkedGroups.add(groupJid);
      if (esAdmin) {
        this.adminGroups.add(groupJid);
        console.log(`✅ Admin confirmado en grupo: ${metadata.subject}`);
      } else {
        console.log(`🚫 No somos admin en: ${metadata.subject} — bot silencioso`);
      }
      return esAdmin;
    } catch (err) {
      console.error('Error verificando admin grupo:', err);
      return false;
    }
  }

  // ─────────────────────────────────────────────
  //  Entry point — procesar mensaje entrante
  // ─────────────────────────────────────────────
  async handleMessage(msg) {
    if (!this.state.botActive) return;

    const jid     = msg.key.remoteJid;
    const isGroup = jid.endsWith('@g.us');
    const pushName = msg.pushName || 'Usuario';
    const text     = (
      msg.message?.conversation ||
      msg.message?.extendedTextMessage?.text || ''
    ).trim();

    if (!text) return;

    // ── Grupos: solo donde somos admin ──────────
    if (isGroup) {
      const esAdmin = await this.isAdminInGroup(jid);
      if (!esAdmin) return;
    }

    // Registrar contacto entrante en antiBan
    antiBan.registerIncoming(jid);

    // Actualizar UI en tiempo real
    this.updateChatUI(jid, pushName, text, 'incoming');
    this.state.stats.received++;
    this.io.emit('stats-update', this.state.stats);

    // ── Anti-Ban ────────────────────────────────
    const banCheck = antiBan.canSend(jid, isGroup);
    if (!banCheck.allowed) {
      console.log(`[ANTI-BAN] Bloqueado ${jid}: ${banCheck.reason}`);
      return;
    }

    // ── Segmentación ────────────────────────────
    const perfil = await this.segmentacion.clasificarUsuario(jid, pushName, text);

    // ── Intención ───────────────────────────────
    const contexto = {
      isGroup,
      mentioned:   this.isMentioned(msg),
      tipoUsuario: perfil.tipo,
      historial:   this.activeChats.get(jid)?.messages || []
    };
    const analisis = this.intentDetector.analyze(text, contexto);

    console.log(`[BOT] ${pushName} | ${perfil.tipo} | ${analisis.intencion} | ${analisis.accionRecomendada}`);

    // ── Ejecutar ─────────────────────────────────
    const respuesta = await this.ejecutarAccion(analisis, jid, text, perfil, msg, isGroup);

    if (respuesta) {
      await this.enviarRespuesta(jid, respuesta, isGroup, text.length);
      this.updateChatUI(jid, 'Bot 🤖', respuesta, 'outgoing');
      antiBan.registerSend(jid, isGroup);
    }
  }

  isMentioned(msg) {
    const extended = msg.message?.extendedTextMessage;
    if (extended?.contextInfo?.participant === this.sock.user?.id) return true;
    const text = (msg.message?.conversation || extended?.text || '').toLowerCase();
    return /bot|sistema|automatizado|bolsillo/i.test(text);
  }

  // ─────────────────────────────────────────────
  //  Lógica de acciones — Claude genera el texto
  // ─────────────────────────────────────────────
  async ejecutarAccion(analisis, jid, text, perfil, msg, isGroup) {
    const { intencion, accionRecomendada, entities } = analisis;

    // Actualizar chat activo
    if (!this.activeChats.has(jid)) {
      this.activeChats.set(jid, {
        jid,
        nombre:           perfil.data?.nombre || msg.pushName,
        tipo:             perfil.tipo,
        numerosReservados: [],
        messages:         [],
        startTime:        Date.now()
      });
    }
    const chat = this.activeChats.get(jid);

    // Sorteo activo
    const sorteosActivos = await this.firebase.getSorteosActivos();
    const sorteo = sorteosActivos?.[0];

    if (!sorteo) {
      return this.responses.generate({
        jid, mensaje: text, sorteo: { name: '', premioMayor: 0, precioNumero: 0, date: '' },
        perfil, isGroup, accion: 'NO_SORTEO'
      });
    }

    switch (accionRecomendada) {

      case 'IGNORAR':
        return null;

      // ── Cierre en grupo ──────────────────────
      case 'CIERRE_GRUPO': {
        const cantidad = Math.min(entities.cantidad || 1, 5);
        const asignacion = await this.sorteos.asignarNumeros(sorteo.id, cantidad, {
          nombre:   chat.nombre,
          telefono: jid.split('@')[0],
          source:   'grupo_whatsapp'
        });
        chat.numerosReservados = asignacion.numeros;
        return this.responses.generate({
          jid, mensaje: text, sorteo, perfil, isGroup,
          accion: 'CIERRE_GRUPO',
          datosExtra: { numeros: asignacion.numeros, total: asignacion.total, cantidad }
        });
      }

      // ── Cierre en privado ────────────────────
      case 'CIERRE_PRIVADO': {
        const cantidad = Math.min(entities.cantidad || 1, 10);
        const asignacion = await this.sorteos.asignarNumeros(sorteo.id, cantidad, {
          nombre:   chat.nombre,
          telefono: jid.split('@')[0],
          source:   'privado_whatsapp'
        });
        chat.numerosReservados = asignacion.numeros;
        this.state.stats.sales++;
        this.io.emit('stats-update', this.state.stats);
        return this.responses.generate({
          jid, mensaje: text, sorteo, perfil, isGroup,
          accion: 'CIERRE_PRIVADO',
          datosExtra: { numeros: asignacion.numeros, total: asignacion.total, cantidad }
        });
      }

      // ── Persuasión / dudas / info ────────────
      default:
        return this.responses.generate({
          jid, mensaje: text, sorteo, perfil, isGroup,
          accion: accionRecomendada
        });
    }
  }

  // ─────────────────────────────────────────────
  //  Enviar con simulación de escritura humana
  // ─────────────────────────────────────────────
  async enviarRespuesta(jid, texto, isGroup, msgLength = 50) {
    try {
      const typingMs = antiBan.getTypingDelay(msgLength);
      await typingSimulation(this.sock, jid, typingMs);
      await humanDelay(300, 800);
      await this.sock.sendMessage(jid, { text: texto });
      await this.firebase.logMessage('outgoing', jid.split('@')[0], texto, true);
    } catch (err) {
      console.error('❌ Error enviando:', err);
      await this.firebase.logMessage('outgoing', jid.split('@')[0], texto, false);
    }
  }

  // ─────────────────────────────────────────────
  //  Actualizar bandeja del panel
  // ─────────────────────────────────────────────
  updateChatUI(jid, nombre, mensaje, tipo) {
    const chat = this.activeChats.get(jid) || { jid, nombre, messages: [] };
    chat.messages = chat.messages.slice(-49);
    chat.messages.push({
      id:        Date.now(),
      nombre,
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
      unread:      tipo === 'incoming'
                     ? (this.state.chats.get(jid)?.unread || 0) + 1
                     : 0,
      timestamp:   Date.now()
    });

    this.io.emit('chats-update', Array.from(this.state.chats.values()));
  }

  // Invalidar cache de grupos (útil al reconectar)
  resetGroupCache() {
    this.adminGroups.clear();
    this.checkedGroups.clear();
  }
}

module.exports = BotLogic;
