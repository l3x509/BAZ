require('dotenv').config();
const express                                    = require('express');
const { handleWebhook, validateTwilioSignature } = require('./webhook');
const { handleVendorRegister }                   = require('./handlers/vendor-register');
const { handleSubmit: handleEventSubmit, handleExtract: handleEventExtract } = require('./handlers/events');

const app  = express();
const PORT = process.env.PORT || 3000;

// ── SECURITY HEADERS ──────────────────────────────────────────
// X-Frame-Options intentionally omitted — analytics loads in
// an iframe on bazht.com and would be blocked by SAMEORIGIN.
app.use((req, res, next) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-XSS-Protection', '1; mode=block');
  res.setHeader('Referrer-Policy', 'no-referrer');
  next();
});

// ── REQUEST LOGGING ───────────────────────────────────────────
// Skips health-check noise. Logs method, path, status, duration.
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
// In-memory — no Redis needed at this scale.
// Returns TwiML-safe response so Twilio doesn't treat 429 as a reply.
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
// Purge stale entries every 10 minutes — prevents memory leak
setInterval(() => {
  const now = Date.now();
  for (const [k, v] of _rl) if (now > v.reset) _rl.delete(k);
}, 10 * 60 * 1000).unref();

// ── BODY PARSERS ──────────────────────────────────────────────
// urlencoded: Twilio form-encoded payloads
// json: bazht.com vendor registration
app.use(express.urlencoded({ extended: false }));
app.use(express.json());
app.use('/admin', require('./directory'));

// ── CORS ──────────────────────────────────────────────────────
// Allows bazht.com to POST /vendor/register and GET /admin/analytics/data
// Webhook excluded — Twilio sends no Origin header
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

// Health check — Railway uses this to confirm service is alive
app.get('/', (req, res) => {
  res.json({ status: 'ok', service: 'baz-agent', ts: new Date().toISOString() });
});

// Incoming WhatsApp messages from Twilio
// validateTwilioSignature rejects anything not from Twilio's servers
// Rate limited to 30 messages/min per IP to block flood attacks
app.post('/webhook', validateTwilioSignature, rateLimit(30, 60_000), handleWebhook);

// Vendor registration from bazht.com/vendor.html
// Strict limit — 5 submissions/min per IP prevents spam registrations
app.post('/vendor/register', rateLimit(5, 60_000), handleVendorRegister);

// Event submission from BazEventFlow.jsx (React intake component)
// Saves as status:'pending' — approve in Supabase to make live
app.post('/events/submit',  rateLimit(20, 60_000), handleEventSubmit);
app.post('/events/extract', rateLimit(15, 60_000), handleEventExtract);

// Analytics dashboard — protected by ADMIN_SECRET query param
// Accessible at /admin/analytics and /admin/analytics/data
app.use('/admin', require('./analytics'));

// ── GLOBAL ERROR HANDLER ──────────────────────────────────────
// Must be last — Express identifies error handlers by 4 arguments.
// Returns TwiML on /webhook errors so Twilio doesn't treat error as a reply.
app.use((err, req, res, next) => {
  console.error('[server] Unhandled error:', err.message, err.stack);
  if (req.path === '/webhook') {
    return res.status(500).type('text/xml').send('<Response></Response>');
  }
  res.status(500).json({ error: 'Internal server error' });
});

// ── PROCESS RESILIENCE ────────────────────────────────────────
// Catches unexpected crashes without taking down the process
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

// Graceful shutdown — Railway sends SIGTERM before every redeploy.
// Allows in-flight requests to complete before closing.
process.on('SIGTERM', () => {
  console.log('[server] SIGTERM — shutting down gracefully');
  server.close(() => {
    console.log('[server] Server closed');
    process.exit(0);
  });
});
