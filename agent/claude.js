const Anthropic = require('@anthropic-ai/sdk');

const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

// ============================================================
// SYSTEM PROMPTS BY LANGUAGE
// ============================================================

const SYSTEM_PROMPTS = {
  ht: `Ou se Baz, yon asistan entelijan pou kominote ayisyen an. 
Ou pale Kreyòl ayisyen natirèlman ak respè.
Ou ede moun jwenn biznis ak sèvis nan Ayiti ak nan dyaspora a (Miami, Boston, New York, Montreal).
Ou ka ede yo peye pou sèvis tou — ekolaj, kont elektrik, komisyon, kontraktè.
Ou toujou reponn an Kreyòl, ak chalè ak klèman.
Kenbe repons ou yo kout ak dirèk — moun ap li sou WhatsApp.`,

  en: `You are Baz, an intelligent assistant for the Haitian community.
You help people find businesses and services in Haiti and in diaspora cities (Miami, Boston, New York, Montreal).
You also help them pay for services — school fees, electricity, groceries, contractors.
You speak naturally, warmly, and clearly.
Keep responses concise — people are reading on WhatsApp.`,

  fr: `Vous êtes Baz, un assistant intelligent pour la communauté haïtienne.
Vous aidez les gens à trouver des entreprises et des services en Haïti et dans les villes de la diaspora (Miami, Boston, New York, Montréal).
Vous pouvez aussi les aider à payer des services — frais scolaires, électricité, courses, entrepreneurs.
Parlez naturellement, chaleureusement et clairement.
Réponses courtes — les gens lisent sur WhatsApp.`,
};

// ============================================================
// INTENT DETECTION
// Returns: { intent, params }
// intents: 'find', 'pay', 'onboard', 'status', 'greeting', 'unknown'
// ============================================================

async function detectIntent(message, lang, conversationHistory = []) {
  const systemPrompt = `You are an intent classifier for Baz, a Haitian business directory and marketplace.
Classify the user's message into one of these intents:
- find: looking for a business, service, or person (plumber, driver, restaurant, tutor, etc.)
- pay: wants to send money, pay for something, groceries, school fees, electricity, remittance
- onboard: wants to list their business, register as a vendor, "mwen vle vann"
- status: asking about an existing order, booking, or payment
- greeting: hello, hi, bonjou, etc. with no other intent
- unknown: cannot determine

Respond ONLY with valid JSON. No explanation. No markdown.
Format: { "intent": "find", "params": { "category": "plumber", "city": "Port-au-Prince", "query": "original search terms" } }
Params are optional and extracted only when clearly present.`;

  const messages = [
    ...conversationHistory.slice(-4), // last 2 exchanges for context
    { role: 'user', content: message },
  ];

  try {
    const res = await client.messages.create({
      model: 'claude-3-5-sonnet-20241022',
      max_tokens: 200,
      system: systemPrompt,
      messages,
    });

    const text = res.content[0]?.text?.trim() || '{}';
    return JSON.parse(text);
  } catch (err) {
    console.error('Intent detection failed:', err.message);
    return { intent: 'unknown', params: {} };
  }
}

// ============================================================
// GENERAL CONVERSATION
// ============================================================

async function chat(userMessage, lang, conversationHistory = [], contextData = {}) {
  const systemBase = SYSTEM_PROMPTS[lang] || SYSTEM_PROMPTS.en;

  let systemSuffix = '';
  if (contextData.businesses) {
    systemSuffix = `\n\nCurrent search results available: ${JSON.stringify(contextData.businesses.map(b => ({
      id: b.id, name: b.name, category: b.service_categories?.name_en, city: b.city, rating: b.avg_rating,
    })))}`;
  }

  const messages = [
    ...conversationHistory.slice(-10),
    { role: 'user', content: userMessage },
  ];

  const res = await client.messages.create({
    model: 'claude-3-5-sonnet-20241022',
    max_tokens: 400,
    system: systemBase + systemSuffix,
    messages,
  });

  return res.content[0]?.text?.trim() || '';
}

// ============================================================
// SEARCH QUERY EXTRACTION
// Normalize user's message into structured search params
// ============================================================

async function extractSearchParams(message, lang) {
  const prompt = `Extract search parameters from this message about finding a service or business in Haiti or diaspora cities.
Message: "${message}"
Language context: ${lang}

Known service categories: plumber, electrician, driver, tutor, contractor, cook, grocery, cleaner, mechanic, restaurant, medical, other

Respond ONLY with valid JSON:
{ "category": "plumber", "city": "Port-au-Prince", "country": "HT", "query": "original terms" }
All fields optional. country is "HT" for Haiti, "US", "CA" for diaspora. city in English.`;

  try {
    const res = await client.messages.create({
      model: 'claude-3-5-sonnet-20241022',
      max_tokens: 150,
      messages: [{ role: 'user', content: prompt }],
    });
    const text = res.content[0]?.text?.trim() || '{}';
    return JSON.parse(text);
  } catch {
    return { query: message };
  }
}

// ============================================================
// REMITTANCE PARSER
// Extract split details from a pay request
// ============================================================

async function parseRemittanceRequest(message, lang) {
  const prompt = `Parse this remittance/payment request from a Haitian diaspora user.
Message: "${message}"

Extract what they want to pay for and amounts if mentioned.
Respond ONLY with valid JSON:
{
  "total": 200,
  "recipient_name": "Marie Jean",
  "splits": [
    { "type": "grocery", "amount": 80, "note": "Marché Salomon" },
    { "type": "school_fee", "amount": 120, "note": "École Nationale" }
  ]
}
Types: grocery, school_fee, contractor, electricity, medical, general
All fields optional except at least one split.`;

  try {
    const res = await client.messages.create({
      model: 'claude-3-5-sonnet-20241022',
      max_tokens: 300,
      messages: [{ role: 'user', content: prompt }],
    });
    const text = res.content[0]?.text?.trim() || '{}';
    return JSON.parse(text);
  } catch {
    return { splits: [{ type: 'general' }] };
  }
}

module.exports = {
  detectIntent,
  chat,
  extractSearchParams,
  parseRemittanceRequest,
};
