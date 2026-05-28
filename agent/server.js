require('dotenv').config();
const express                                    = require('express');
const { handleWebhook, validateTwilioSignature } = require('./webhook');
const { handleVendorRegister }                   = require('./handlers/vendor-register');

const app  = express();
const PORT = process.env.PORT || 3000;

// ── BODY PARSERS ──────────────────────────────────────────────
// urlencoded required for Twilio (form-encoded payloads)
// json required for /vendor/register (JSON from bazht.com)
app.use(express.urlencoded({ extended: false }));
app.use(express.json());

// ── CORS ──────────────────────────────────────────────────────
// Allows bazht.com to POST to /vendor/register
// Webhook is excluded — Twilio doesn't send an Origin header
const ALLOWED_ORIGINS = [
  'https://bazht.com',
  'https://www.bazht.com',
];

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

// Health check — Railway uses this to confirm the service is running
app.get('/', (req, res) => {
  res.json({
    status:  'ok',
    service: 'baz-agent',
    ts:      new Date().toISOString(),
  });
});

// Incoming WhatsApp messages from Twilio
// validateTwilioSignature rejects anything not from Twilio's servers
app.post('/webhook', handleWebhook);

// Vendor registration from bazht.com/vendor.html
app.post('/vendor/register', handleVendorRegister);

// ── START ─────────────────────────────────────────────────────
app.listen(PORT, () => {
  console.log(`Baz agent running on port ${PORT}`);
});
