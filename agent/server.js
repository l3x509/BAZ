require('dotenv').config();
const express = require('express');
const { handleWebhook, verifyWebhook } = require('./src/webhook');

const app = express();
const PORT = process.env.PORT || 3000;

app.use(express.json());

// Health check — Railway uses this
app.get('/', (req, res) => {
  res.json({ status: 'ok', service: 'baz-agent', ts: new Date().toISOString() });
});

// Meta webhook verification (GET)
app.get('/webhook', verifyWebhook);

// Incoming WhatsApp messages (POST)
app.post('/webhook', handleWebhook);

app.listen(PORT, () => {
  console.log(`Baz agent running on port ${PORT}`);
});
