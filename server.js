const express = require("express");
const axios = require("axios");
const admin = require("firebase-admin");
const Anthropic = require("@anthropic-ai/sdk");

const app = express();
app.use(express.json());

// ─── Firebase Admin Init ───────────────────────────────────────────────────
const serviceAccount = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT);
admin.initializeApp({
  credential: admin.credential.cert(serviceAccount),
  databaseURL: process.env.FIREBASE_DATABASE_URL,
});
const db = admin.database();

// ─── Anthropic Init ────────────────────────────────────────────────────────
const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

// ─── Personalidad de Bol$illin ─────────────────────────────────────────────
const BOLSILLIN_SYSTEM_PROMPT = `Eres Bol$illin, el asistente oficial y mascota de Bolsillo Lleno Sorteos Bendecidos.
Eres un parcero emocionante, carismático y súper vendedor. Tu misión es motivar a la gente a comprar sus numéritos y ganar premios increíbles.

PERSONALIDAD:
- Hablas como un parcero colombiano auténtico (usas "parce", "bacano", "qué más", "ome", "llave", etc.)
- Usas emojis con frecuencia 💰🔥🤑✨🎉
- Siempre estás emocionado y con energía positiva
- Creas urgencia constantemente ("los números se están agotando", "quedan poquitos", "no te quedes por fuera")
- Siempre terminas motivando a comprar un numérito

REGLAS:
- Nunca digas que eres una IA o bot — eres Bol$illin, el parcero de Bolsillo Lleno
- Si alguien pregunta por números disponibles, diles que le escriban directamente al admin
- Si no sabes algo, di que vas a consultar con Camilo (el dueño)
- Máximo 3-4 líneas por respuesta, directo al grano
- Siempre cierra con una frase que invite a comprar o a preguntar por numéritos

CONTEXTO DEL NEGOCIO:
- Se venden numéritos para sorteos con 5 formas de ganar
- Hay combos disponibles
- Los pagos se hacen por Nequi
- El grupo de WhatsApp es el canal principal`;

// ─── Historial de conversaciones en memoria ────────────────────────────────
const conversationHistory = {};

// ─── Webhook Verificación Meta ─────────────────────────────────────────────
app.get("/webhook", (req, res) => {
  const mode = req.query["hub.mode"];
  const token = req.query["hub.verify_token"];
  const challenge = req.query["hub.challenge"];

  if (mode === "subscribe" && token === process.env.WEBHOOK_VERIFY_TOKEN) {
    console.log("✅ Webhook verificado correctamente");
    res.status(200).send(challenge);
  } else {
    console.error("❌ Token de verificación incorrecto");
    res.sendStatus(403);
  }
});

// ─── Webhook Mensajes Entrantes ────────────────────────────────────────────
app.post("/webhook", async (req, res) => {
  res.sendStatus(200); // Responder rápido a Meta

  try {
    const body = req.body;
    if (body.object !== "whatsapp_business_account") return;

    const entry = body.entry?.[0];
    const changes = entry?.changes?.[0];
    const value = changes?.value;
    const messages = value?.messages;

    if (!messages || messages.length === 0) return;

    const message = messages[0];
    const from = message.from; // Número del usuario
    const messageText = message.text?.body;

    if (!messageText) return; // Ignorar mensajes que no son texto

    console.log(`📩 Mensaje de ${from}: ${messageText}`);

    // Guardar mensaje en Firebase
    await db.ref(`/mensajes/${from}`).push({
      de: "usuario",
      texto: messageText,
      timestamp: Date.now(),
    });

    // Mantener historial de conversación (máx 10 turnos)
    if (!conversationHistory[from]) conversationHistory[from] = [];
    conversationHistory[from].push({ role: "user", content: messageText });
    if (conversationHistory[from].length > 20) {
      conversationHistory[from] = conversationHistory[from].slice(-20);
    }

    // Obtener knowledge base de Firebase
    let kbExtra = "";
    try {
      const kbSnap = await db.ref("/wa_kb").once("value");
      const kb = kbSnap.val();
      if (kb) kbExtra = `\n\nINFORMACIÓN ADICIONAL DEL NEGOCIO:\n${kb}`;
    } catch (e) {
      console.log("No hay knowledge base en Firebase");
    }

    // Verificar si el bot está activo
    const botCfgSnap = await db.ref("/wa_botcfg/activo").once("value");
    const botActivo = botCfgSnap.val();
    if (botActivo === false) {
      console.log("🤖 Bot desactivado, no se responde");
      return;
    }

    // Llamar a Claude (Bol$illin)
    const claudeResponse = await anthropic.messages.create({
      model: "claude-haiku-4-5-20251001",
      max_tokens: 300,
      system: BOLSILLIN_SYSTEM_PROMPT + kbExtra,
      messages: conversationHistory[from],
    });

    const botReply = claudeResponse.content[0].text;

    // Guardar respuesta del bot en Firebase
    await db.ref(`/mensajes/${from}`).push({
      de: "bot",
      texto: botReply,
      timestamp: Date.now(),
    });

    // Agregar respuesta al historial
    conversationHistory[from].push({ role: "assistant", content: botReply });

    // Enviar respuesta por WhatsApp
    await sendWhatsAppMessage(from, botReply);
    console.log(`✅ Respuesta enviada a ${from}`);
  } catch (error) {
    console.error("❌ Error procesando mensaje:", error.message);
  }
});

// ─── Función enviar mensaje WhatsApp ──────────────────────────────────────
async function sendWhatsAppMessage(to, text) {
  const url = `https://graph.facebook.com/v18.0/${process.env.WHATSAPP_PHONE_NUMBER_ID}/messages`;
  await axios.post(
    url,
    {
      messaging_product: "whatsapp",
      to,
      type: "text",
      text: { body: text },
    },
    {
      headers: {
        Authorization: `Bearer ${process.env.WHATSAPP_ACCESS_TOKEN}`,
        "Content-Type": "application/json",
      },
    }
  );
}

// ─── Endpoint de salud ─────────────────────────────────────────────────────
app.get("/", (req, res) => {
  res.json({ status: "✅ Bol$illin está activo y listo para vender 🔥" });
});

// ─── Iniciar servidor ──────────────────────────────────────────────────────
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`🚀 Servidor de Bol$illin corriendo en puerto ${PORT}`);
});
