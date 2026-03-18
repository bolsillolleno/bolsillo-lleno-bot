// ═══════════════════════════════════════════════════════════════
//  Bol$illo Lleno — WhatsApp Bot Backend
//  Node.js + Express | Webhook Meta + Claude AI + Firebase
// ═══════════════════════════════════════════════════════════════

const express    = require('express');
const axios      = require('axios');
const admin      = require('firebase-admin');
require('dotenv').config();

const app  = express();
app.use(express.json());

// ── Variables de entorno ─────────────────────────────────────
const {
  WHATSAPP_TOKEN,          // Access Token de Meta
  WHATSAPP_PHONE_ID,       // Phone Number ID de Meta
  WHATSAPP_VERIFY_TOKEN,   // Token que tú inventas para verificar el webhook
  CLAUDE_API_KEY,          // API Key de Anthropic (Claude)
  FIREBASE_DATABASE_URL,   // https://tu-proyecto.firebaseio.com
  PORT = 3000
} = process.env;

// ── Firebase Admin ───────────────────────────────────────────
let db = null;
try {
  // Si tienes serviceAccountKey.json lo usa, si no usa la variable de entorno
  const serviceAccount = process.env.FIREBASE_SERVICE_ACCOUNT
    ? JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT)
    : null;

  if (serviceAccount) {
    admin.initializeApp({
      credential: admin.credential.cert(serviceAccount),
      databaseURL: FIREBASE_DATABASE_URL
    });
    db = admin.database();
    console.log('✅ Firebase conectado');
  } else {
    console.log('⚠️  Firebase no configurado (FIREBASE_SERVICE_ACCOUNT vacío)');
  }
} catch(e) {
  console.error('❌ Error Firebase:', e.message);
}

// ── Historial de conversaciones (en memoria) ─────────────────
// Clave: número de teléfono | Valor: array de mensajes
const conversaciones = new Map();
const MAX_HISTORIAL  = 20; // máximo de mensajes a recordar por cliente

// ── Utilidades Firebase ──────────────────────────────────────
async function getSorteosActivos() {
  if (!db) return [];
  try {
    const snap = await db.ref('sorteos').once('value');
    const data = snap.val() || {};
    const now  = new Date();
    return Object.values(data)
      .filter(s => new Date(s.date) > now)
      .map(s => ({
        name        : s.name        || 'Sin nombre',
        prize       : s.prize       || 'Por confirmar',
        date        : s.date        || '',
        precioNumero: s.precioNumero || 2000,
        totalNumbers: s.totalNumbers || 100
      }));
  } catch(e) {
    console.error('Error leyendo sorteos:', e.message);
    return [];
  }
}

async function getKnowledgeBase() {
  if (!db) return [];
  try {
    const snap = await db.ref('wa_kb').once('value');
    return snap.val() || [];
  } catch(e) { return []; }
}

async function getBusinessInfo() {
  if (!db) return {};
  try {
    const snap = await db.ref('wa_biz').once('value');
    return snap.val() || {};
  } catch(e) { return {}; }
}

async function getBotConfig() {
  if (!db) return {};
  try {
    const snap = await db.ref('wa_botcfg').once('value');
    return snap.val() || {};
  } catch(e) { return {}; }
}

async function verificarNumero(phone) {
  // Verifica si el número tiene números comprados y cuáles son
  if (!db) return null;
  try {
    const sorteosSnap = await db.ref('sorteos').once('value');
    const sorteos     = sorteosSnap.val() || {};
    const numeros     = [];

    for (const [sid, sorteo] of Object.entries(sorteos)) {
      const occSnap = await db.ref('occupied/' + sid).once('value');
      const occ     = occSnap.val() || {};
      for (const [num, data] of Object.entries(occ)) {
        const tel = (data.telefono || data.phone || '').replace(/\D/g, '');
        if (tel && phone.includes(tel.slice(-8))) {
          numeros.push({ sorteo: sorteo.name, numero: num, fecha: sorteo.date });
        }
      }
    }
    return numeros.length ? numeros : null;
  } catch(e) { return null; }
}

// ── Construir system prompt para Claude ──────────────────────
async function buildSystemPrompt(phone) {
  const [sorteos, kb, biz, botCfg, numeros] = await Promise.all([
    getSorteosActivos(),
    getKnowledgeBase(),
    getBusinessInfo(),
    getBotConfig(),
    verificarNumero(phone)
  ]);

  const botName = botCfg.name || 'Asistente de Bol$illo Lleno';

  let prompt = `Eres ${botName}, el asistente virtual de Bol$illo Lleno, una empresa colombiana de sorteos y rifas.
Tu misión es atender clientes con amabilidad, responder dudas y animarlos a participar.

REGLAS:
- Responde siempre en español colombiano natural y cercano
- Usa emojis con moderación
- Sé conciso (máximo 3-4 párrafos)
- Nunca inventes precios, fechas ni datos que no tengas
- Si no sabes algo, invita a contactar directamente`;

  // Info del negocio
  if (biz.pagos || biz.contacto || biz.horario || biz.info) {
    prompt += '\n\nINFO DEL NEGOCIO:';
    if (biz.pagos)    prompt += `\n- Métodos de pago: ${biz.pagos}`;
    if (biz.contacto) prompt += `\n- WhatsApp/Contacto: ${biz.contacto}`;
    if (biz.horario)  prompt += `\n- Horario: ${biz.horario}`;
    if (biz.info)     prompt += `\n- Info adicional: ${biz.info}`;
  }

  // Sorteos activos
  if (sorteos.length) {
    prompt += '\n\nSORTEOS ACTIVOS AHORA MISMO:';
    sorteos.forEach(s => {
      prompt += `\n- ${s.name}: premio ${s.prize}, fecha ${s.date}, precio por número $${s.precioNumero.toLocaleString()}, ${s.totalNumbers} números en total`;
    });
  } else {
    prompt += '\n\nActualmente no hay sorteos activos programados.';
  }

  // Números del cliente
  if (numeros && numeros.length) {
    prompt += `\n\nINFO DEL CLIENTE ACTUAL (tiene números comprados):`;
    numeros.forEach(n => {
      prompt += `\n- Sorteo "${n.sorteo}": número ${n.numero} (fecha: ${n.fecha})`;
    });
    prompt += '\nUsa esta info si pregunta por sus números o el estado de su participación.';
  }

  // Base de conocimiento
  if (kb.length) {
    prompt += '\n\nPREGUNTAS FRECUENTES Y SUS RESPUESTAS:';
    kb.forEach(entry => {
      if (entry && entry.q && entry.a) {
        prompt += `\nP: ${entry.q}\nR: ${entry.a}\n`;
      }
    });
  }

  // Instrucciones adicionales
  if (botCfg.instructions) {
    prompt += `\n\nINSTRUCCIONES ADICIONALES: ${botCfg.instructions}`;
  }

  return prompt;
}

// ── Llamar a Claude ──────────────────────────────────────────
async function askClaude(systemPrompt, historial) {
  const response = await axios.post(
    'https://api.anthropic.com/v1/messages',
    {
      model      : 'claude-haiku-4-5-20251001', // Rápido y económico para el bot
      max_tokens : 500,
      system     : systemPrompt,
      messages   : historial.slice(-MAX_HISTORIAL)
    },
    {
      headers: {
        'Content-Type'     : 'application/json',
        'x-api-key'        : CLAUDE_API_KEY,
        'anthropic-version': '2023-06-01'
      }
    }
  );
  return response.data.content[0]?.text || 'No pude generar una respuesta.';
}

// ── Enviar mensaje de WhatsApp ───────────────────────────────
async function sendWhatsApp(to, text) {
  await axios.post(
    `https://graph.facebook.com/v19.0/${WHATSAPP_PHONE_ID}/messages`,
    {
      messaging_product: 'whatsapp',
      to,
      type: 'text',
      text: { body: text, preview_url: false }
    },
    {
      headers: {
        'Authorization' : `Bearer ${WHATSAPP_TOKEN}`,
        'Content-Type'  : 'application/json'
      }
    }
  );
}

// ── Marcar mensaje como leído ────────────────────────────────
async function markAsRead(messageId) {
  await axios.post(
    `https://graph.facebook.com/v19.0/${WHATSAPP_PHONE_ID}/messages`,
    { messaging_product: 'whatsapp', status: 'read', message_id: messageId },
    { headers: { 'Authorization': `Bearer ${WHATSAPP_TOKEN}`, 'Content-Type': 'application/json' } }
  ).catch(() => {}); // no fatal si falla
}

// ═══════════════════════════════════════════════════════════════
//  RUTAS
// ═══════════════════════════════════════════════════════════════

// ── GET /webhook — Verificación de Meta ─────────────────────
app.get('/webhook', (req, res) => {
  const mode      = req.query['hub.mode'];
  const token     = req.query['hub.verify_token'];
  const challenge = req.query['hub.challenge'];

  if (mode === 'subscribe' && token === WHATSAPP_VERIFY_TOKEN) {
    console.log('✅ Webhook verificado por Meta');
    return res.status(200).send(challenge);
  }
  console.warn('❌ Verificación fallida — token incorrecto');
  res.sendStatus(403);
});

// ── POST /webhook — Mensajes entrantes ──────────────────────
app.post('/webhook', async (req, res) => {
  // Responder 200 inmediatamente para que Meta no reintente
  res.sendStatus(200);

  try {
    const entry   = req.body?.entry?.[0];
    const changes = entry?.changes?.[0];
    const value   = changes?.value;

    if (!value?.messages?.length) return; // sin mensajes

    const msg    = value.messages[0];
    const from   = msg.from;          // número del cliente
    const msgId  = msg.id;
    const text   = msg.text?.body?.trim();

    if (!text) return; // ignorar stickers, audios, etc. (por ahora)

    console.log(`📨 Mensaje de ${from}: ${text}`);

    // Marcar como leído
    await markAsRead(msgId);

    // Obtener o crear historial de conversación
    if (!conversaciones.has(from)) conversaciones.set(from, []);
    const historial = conversaciones.get(from);
    historial.push({ role: 'user', content: text });

    // Mantener tamaño del historial
    if (historial.length > MAX_HISTORIAL) historial.splice(0, historial.length - MAX_HISTORIAL);

    // Construir system prompt con info actualizada de Firebase
    const systemPrompt = await buildSystemPrompt(from);

    // Llamar a Claude
    const respuesta = await askClaude(systemPrompt, historial);

    // Guardar respuesta en historial
    historial.push({ role: 'assistant', content: respuesta });

    // Enviar respuesta al cliente
    await sendWhatsApp(from, respuesta);

    console.log(`✅ Respuesta enviada a ${from}`);

  } catch (err) {
    console.error('❌ Error procesando mensaje:', err.response?.data || err.message);
  }
});

// ── GET / — Health check ─────────────────────────────────────
app.get('/', (req, res) => {
  res.json({
    status  : 'online',
    app     : 'Bol$illo Lleno WhatsApp Bot',
    version : '1.0.0',
    uptime  : Math.floor(process.uptime()) + 's'
  });
});

// ── GET /status — Estado del bot ─────────────────────────────
app.get('/status', async (req, res) => {
  const sorteos = await getSorteosActivos();
  const kb      = await getKnowledgeBase();
  res.json({
    firebase    : db ? 'conectado' : 'no configurado',
    sorteos     : sorteos.length,
    kb_entries  : Array.isArray(kb) ? kb.length : 0,
    conversaciones_activas: conversaciones.size,
    configurado : {
      whatsapp_token  : !!WHATSAPP_TOKEN,
      whatsapp_phone  : !!WHATSAPP_PHONE_ID,
      claude_api      : !!CLAUDE_API_KEY,
      firebase        : !!FIREBASE_DATABASE_URL
    }
  });
});

// ── Iniciar servidor ─────────────────────────────────────────
app.listen(PORT, () => {
  console.log(`
╔══════════════════════════════════════════╗
║   🤑 Bol$illo Lleno — WhatsApp Bot       ║
║   Corriendo en puerto ${PORT}               ║
║   Webhook: /webhook                      ║
╚══════════════════════════════════════════╝
  `);
});
