/**
 * Bol$illo Lleno — Servidor Railway
 * 
 * Variables de entorno en Railway (Settings → Variables):
 *   ANTHROPIC_API_KEY  →  sk-ant-api03-...
 *   PORT               →  Railway lo asigna solo, no lo configures
 */

const express = require('express');
const app     = express();
const PORT    = process.env.PORT || 8080;

app.use(express.json({ limit: '5mb' }));

// CORS — necesario para que el admin (GitHub Pages) pueda llamar aquí
app.use((req, res, next) => {
  res.setHeader('Access-Control-Allow-Origin',  '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(204).end();
  next();
});

// Raíz
app.get('/', (req, res) => {
  res.json({ ok: true, nombre: 'Bol$illo Lleno Bot', version: '3.0' });
});

// Health check — el admin prueba conexión aquí
app.get('/health', (req, res) => {
  res.json({
    ok:            true,
    anthropic_key: process.env.ANTHROPIC_API_KEY ? '✅ configurada' : '❌ FALTA',
    ts:            new Date().toISOString(),
  });
});

// Proxy a Anthropic — el admin envía los mensajes aquí
// Railway reenvía a Anthropic con la API key del servidor (nunca expuesta al browser)
app.post('/api/claude', async (req, res) => {
  const apiKey = process.env.ANTHROPIC_API_KEY;

  if (!apiKey) {
    return res.status(500).json({
      ok: false,
      error: 'ANTHROPIC_API_KEY no configurada en Railway Variables',
    });
  }

  const { messages, system, max_tokens } = req.body;

  if (!Array.isArray(messages) || !messages.length) {
    return res.status(400).json({ ok: false, error: 'Falta "messages"' });
  }

  const msgs = messages
    .filter(m => m?.role && String(m.content || '').trim())
    .map(m => ({ role: m.role, content: String(m.content) }));

  if (!msgs.length) {
    return res.status(400).json({ ok: false, error: 'Mensajes vacíos' });
  }

  try {
    const payload = {
      model:      'claude-haiku-4-5-20251001',
      max_tokens: max_tokens || 400,
      messages:   msgs,
    };
    if (system) payload.system = system;

    const r = await fetch('https://api.anthropic.com/v1/messages', {
      method:  'POST',
      headers: {
        'Content-Type':      'application/json',
        'x-api-key':         apiKey,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify(payload),
    });

    const data = await r.json();

    if (!r.ok) {
      console.error('Anthropic error:', r.status, data?.error?.message);
      return res.status(r.status).json({
        ok:    false,
        error: data?.error?.message || 'Error Anthropic ' + r.status,
      });
    }

    res.json({ ok: true, text: data?.content?.[0]?.text || '' });

  } catch (err) {
    console.error('Error /api/claude:', err.message);
    res.status(500).json({ ok: false, error: err.message });
  }
});

app.listen(PORT, () => {
  console.log(`✅ Puerto ${PORT} — API key: ${process.env.ANTHROPIC_API_KEY ? 'OK' : 'FALTA'}`);
});
