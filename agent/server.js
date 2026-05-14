require('dotenv').config();
const express        = require('express');
const { handleWebhook } = require('./webhook');

const app  = express();
const PORT = process.env.PORT || 3000;

// Required for Twilio — sends form-encoded bodies, not JSON
app.use(express.urlencoded({ extended: false }));
app.use(express.json());

// Health check — Railway uses this
app.get('/', (req, res) => {
  res.json({ status: 'ok', service: 'baz-agent', ts: new Date().toISOString() });
});

// Incoming WhatsApp messages from Twilio (POST)
app.post('/webhook', handleWebhook);

app.listen(PORT, () => {
  console.log(`Baz agent running on port ${PORT}`);
});
