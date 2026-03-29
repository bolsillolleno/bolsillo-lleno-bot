/**
 * ╔═══════════════════════════════════════════════════════════════╗
 * ║  BOL$ILLO LLENO — Railway Server                              ║
 * ║                                                               ║
 * ║  Variables de entorno en Railway (Settings → Variables):      ║
 * ║  ANTHROPIC_API_KEY   → sk-ant-api03-...                       ║
 * ║  FIREBASE_URL        → https://bolsillolleno-5d1f8-default-   ║
 * ║                        rtdb.firebaseio.com                    ║
 * ║  FIREBASE_SECRET     → Database Secret de Firebase            ║
 * ║  WEBHOOK_TOKEN       → bolsillin2026                          ║
 * ║  PORT                → Railway lo asigna automáticamente      ║
 * ╚═══════════════════════════════════════════════════════════════╝
 */

const express = require('express');
const app     = express();
const PORT    = process.env.PORT || 8080;

// ── Middleware ──────────────────────────────────────────────────
app.use(express.json({ limit: '10mb' }));

// CORS — permite llamadas desde el admin (GitHub Pages / cualquier origen)
app.use((req, res, next) => {
  res.setHeader('Access-Control-Allow-Origin',  '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  if (req.method === 'OPTIONS') return res.status(204).end();
  next();
});

// ── Health check ────────────────────────────────────────────────
app.get('/', (req, res) => {
  res.json({
    ok:       true,
    servicio: 'Bol$illo Lleno API',
    version:  '3.0',
    ts:       new Date().toISOString(),
    endpoints: [
      'POST /api/claude  → Proxy de Anthropic (bot IA)',
      'GET  /health      → Health check',
    ],
  });
});

app.get('/health', (req, res) => {
  res.json({ ok: true, ts: new Date().toISOString() });
});

// ══════════════════════════════════════════════════════════════════
// POST /api/claude
// Proxy hacia Anthropic API — el admin llama aquí con el contexto
// y Railway reenvía usando la API key del servidor (no expuesta al browser)
//
// Body esperado:
// {
//   messages: [{role, content}],   ← historial de conversación
//   system:   "...",               ← system prompt (opcional)
//   max_tokens: 400,               ← opcional, default 400
//   model: "claude-haiku-..."      ← opcional, se puede fijar aquí
// }
//
// Response:
// { ok: true, text: "respuesta del bot" }
// { ok: false, error: "mensaje de error" }
// ══════════════════════════════════════════════════════════════════
app.post('/api/claude', async (req, res) => {
  const apiKey = process.env.ANTHROPIC_API_KEY;

  if (!apiKey) {
    return res.status(500).json({
      ok:    false,
      error: 'ANTHROPIC_API_KEY no configurada en Railway'
    });
  }

  const { messages, system, max_tokens, model } = req.body;

  if (!messages || !Array.isArray(messages) || messages.length === 0) {
    return res.status(400).json({ ok: false, error: 'Se requiere "messages" como array' });
  }

  // Filtrar mensajes vacíos y garantizar alternancia de roles
  const mensajesFiltrados = messages
    .filter(m => m && m.role && m.content && String(m.content).trim())
    .map(m => ({ role: m.role, content: String(m.content) }));

  if (mensajesFiltrados.length === 0) {
    return res.status(400).json({ ok: false, error: 'No hay mensajes válidos' });
  }

  try {
    const payload = {
      model:      model || 'claude-haiku-4-5-20251001',
      max_tokens: max_tokens || 400,
      messages:   mensajesFiltrados,
    };
    if (system) payload.system = system;

    const claudeRes = await fetch('https://api.anthropic.com/v1/messages', {
      method:  'POST',
      headers: {
        'Content-Type':      'application/json',
        'x-api-key':         apiKey,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify(payload),
    });

    const data = await claudeRes.json();

    if (!claudeRes.ok) {
      console.error('Anthropic error:', claudeRes.status, data);
      return res.status(claudeRes.status).json({
        ok:    false,
        error: data?.error?.message || 'Error de Anthropic: ' + claudeRes.status,
      });
    }

    const text = data?.content?.[0]?.text || '';
    res.json({ ok: true, text, usage: data.usage });

  } catch (err) {
    console.error('Error en /api/claude:', err.message);
    res.status(500).json({ ok: false, error: 'Error de servidor: ' + err.message });
  }
});

// ══════════════════════════════════════════════════════════════════
// POST /api/claude-stream (opcional — para respuestas más rápidas)
// Misma funcionalidad pero con streaming si se necesita en el futuro
// ══════════════════════════════════════════════════════════════════

// ── 404 ─────────────────────────────────────────────────────────
app.use((req, res) => {
  res.status(404).json({ ok: false, error: 'Endpoint no encontrado' });
});

// ── Start ────────────────────────────────────────────────────────
app.listen(PORT, () => {
  console.log(`✅ Bol$illo Lleno API corriendo en puerto ${PORT}`);
  console.log(`   ANTHROPIC_API_KEY: ${process.env.ANTHROPIC_API_KEY ? '✅ configurada' : '❌ FALTA'}`);
  console.log(`   FIREBASE_URL:      ${process.env.FIREBASE_URL      ? '✅ configurada' : '⚠️  no configurada'}`);
});
