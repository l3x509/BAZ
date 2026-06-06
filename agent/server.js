require('dotenv').config();
const express                                    = require('express');
const { handleWebhook, validateTwilioSignature } = require('./webhook');
const { handleVendorRegister }                   = require('./handlers/vendor-register');
const { handleSubmit: handleEventSubmit, handleExtract: handleEventExtract } = require('./handlers/events');

const app  = express();
const PORT = process.env.PORT || 3000;

// ── SECURITY HEADERS ──────────────────────────────────────────
app.use((req, res, next) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-XSS-Protection', '1; mode=block');
  res.setHeader('Referrer-Policy', 'no-referrer');
  next();
});

// ── REQUEST LOGGING ───────────────────────────────────────────
app.use((req, res, next) => {
  if (req.path === '/') return next();
  const start = Date.now();
  res.on('finish', () => {
    console.log(
      `[${new Date().toISOString()}] ${req.method} ${req.path} ${res.statusCode} ${Date.now() - start}ms`
    );
  });
  next();
});

// ── RATE LIMITING ─────────────────────────────────────────────
const _rl = new Map();
function rateLimit(max, windowMs) {
  return (req, res, next) => {
    const key = ((req.headers['x-forwarded-for'] || req.ip || 'unknown')
      .split(',')[0]).trim();
    const now = Date.now();
    const r   = _rl.get(key) || { n: 0, reset: now + windowMs };
    if (now > r.reset) { r.n = 0; r.reset = now + windowMs; }
    r.n++;
    _rl.set(key, r);
    if (r.n > max) {
      console.warn(`[rate-limit] ${key} — ${r.n} requests in window`);
      return req.path === '/webhook'
        ? res.status(429).type('text/xml').send('<Response></Response>')
        : res.status(429).json({ error: 'Too many requests' });
    }
    next();
  };
}
setInterval(() => {
  const now = Date.now();
  for (const [k, v] of _rl) if (now > v.reset) _rl.delete(k);
}, 10 * 60 * 1000).unref();

// ── BODY PARSERS ──────────────────────────────────────────────
app.use(express.urlencoded({ extended: false }));
app.use(express.json());
app.use('/admin', require('./directory'));

// ── CORS ──────────────────────────────────────────────────────
const ALLOWED_ORIGINS = ['https://bazht.com', 'https://www.bazht.com'];
app.use((req, res, next) => {
  const origin = req.headers.origin;
  if (ALLOWED_ORIGINS.includes(origin)) {
    res.setHeader('Access-Control-Allow-Origin', origin);
    res.setHeader('Vary', 'Origin');
  }
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.sendStatus(200);
  next();
});

// ── ROUTES ────────────────────────────────────────────────────

app.get('/', (req, res) => {
  res.json({ status: 'ok', service: 'baz-agent', ts: new Date().toISOString() });
});

app.post('/webhook', validateTwilioSignature, rateLimit(30, 60_000), handleWebhook);

app.post('/vendor/register', rateLimit(5, 60_000), handleVendorRegister);

app.post('/events/submit',  rateLimit(20, 60_000), handleEventSubmit);
app.post('/events/extract', rateLimit(15, 60_000), handleEventExtract);

app.use('/admin', require('./analytics'));

// ── GLOBAL ERROR HANDLER ──────────────────────────────────────
app.use((err, req, res, next) => {
  console.error('[server] Unhandled error:', err.message, err.stack);
  if (req.path === '/webhook') {
    return res.status(500).type('text/xml').send('<Response></Response>');
  }
  res.status(500).json({ error: 'Internal server error' });
});

// ── PROCESS RESILIENCE ────────────────────────────────────────
process.on('uncaughtException', err => {
  console.error('[server] Uncaught exception:', err.message, err.stack);
});
process.on('unhandledRejection', reason => {
  console.error('[server] Unhandled rejection:', reason);
});

// ── START ─────────────────────────────────────────────────────
const server = app.listen(PORT, () => {
  console.log(`[server] Baz agent running on port ${PORT}`);
});

process.on('SIGTERM', () => {
  console.log('[server] SIGTERM — shutting down gracefully');
  server.close(() => {
    console.log('[server] Server closed');
    process.exit(0);
  });
});
