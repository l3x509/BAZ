const Anthropic = require('@anthropic-ai/sdk');
const { buildKeywordPrompt, slugs } = require('./config/categories');

const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

// ============================================================
// SAFE JSON PARSER
// Strips markdown fences Claude occasionally wraps around JSON
// ============================================================

function safeParseJSON(text, fallback = {}) {
  try {
    const cleaned = text
      .trim()
      .replace(/^```json\s*/i, '')
      .replace(/^```\s*/i, '')
      .replace(/\s*```$/i, '');
    return JSON.parse(cleaned);
  } catch (err) {
    console.error('JSON parse failed. Raw text:', text);
    return fallback;
  }
}

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
  // Category slugs injected dynamically from categories.js
  const categoryList = slugs().join(', ');

  const systemPrompt = `You are an intent classifier for Baz, a Haitian business directory and marketplace.
Classify the user's message into one of these intents:
- find: looking for a business, service, or person (${categoryList})
- pay: wants to send money, pay for something, groceries, school fees, electricity, remittance
- onboard: wants to list their business, register as a vendor, "mwen vle vann"
- status: asking about an existing order, booking, or payment
- greeting: hello, hi, bonjou, etc. with no other intent
- unknown: cannot determine

Respond ONLY with valid JSON. No explanation. No markdown.
Format: { "intent": "find", "params": { "category": "plumber", "city": "Port-au-Prince", "query": "original search terms" } }
Params are optional and extracted only when clearly present.`;

  const messages = [
    ...conversationHistory.slice(-4),
    { role: 'user', content: message },
  ];

  try {
    const res = await client.messages.create({
      model: 'claude-sonnet-4-5',
      max_tokens: 200,
      system: systemPrompt,
      messages,
    });

    const text = res.content[0]?.text?.trim() || '{}';
    return safeParseJSON(text, { intent: 'unknown', params: {} });
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
    model: 'claude-sonnet-4-5',
    max_tokens: 400,
    system: systemBase + systemSuffix,
    messages,
  });

  return res.content[0]?.text?.trim() || '';
}

// ============================================================
// SEARCH QUERY EXTRACTION
// ============================================================

async function extractSearchParams(message, lang) {
  // Full keyword map injected dynamically — Claude can now match
  // "twalèt bouche" → plumber, "malad" → medical, etc.
  const keywordMap = buildKeywordPrompt();

  const prompt = `Extract search parameters from this message about finding a service or business in Haiti or diaspora cities.
Message: "${message}"
Language context: ${lang}

Match the request to one of these categories using the keywords as a guide:
${keywordMap}

Respond ONLY with valid JSON:
{ "category": "plumber", "city": "Port-au-Prince", "country": "HT", "query": "original terms" }
All fields optional. country is "HT" for Haiti, "US", "CA" for diaspora. city in English.`;

  try {
    const res = await client.messages.create({
      model: 'claude-sonnet-4-5',
      max_tokens: 150,
      messages: [{ role: 'user', content: prompt }],
    });
    const text = res.content[0]?.text?.trim() || '{}';
    return safeParseJSON(text, { query: message });
  } catch {
    return { query: message };
  }
}

// ============================================================
// REMITTANCE PARSER
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
      model: 'claude-sonnet-4-5',
      max_tokens: 300,
      messages: [{ role: 'user', content: prompt }],
    });
    const text = res.content[0]?.text?.trim() || '{}';
    return safeParseJSON(text, { splits: [{ type: 'general' }] });
  } catch {
    return { splits: [{ type: 'general' }] };
  }
}

module.exports = {
  detectTopic,
  detectIntent,
  chat,
  extractSearchParams,
  parseRemittanceRequest,
};

// ============================================================
// TOPIC DETECTION (two-step router)
// Smarter than detectIntent — identifies WHAT the message is about
// before deciding what to DO with it.
//
// Returns one of:
//   { type: 'category', category_slug: 'hair_beauty' }
//   { type: 'pay' }
//   { type: 'onboard' }
//   { type: 'status' }
//   { type: 'greeting' }
//   { type: 'unknown' }
// ============================================================

async function detectTopic(message, lang, conversationHistory = []) {
  const keywordMap = buildKeywordPrompt();
  const categoryList = active().map(c => c.slug).join(', ');

  const systemPrompt = `You are a topic classifier for Baz, a Haitian WhatsApp assistant with a marketplace called Vitrin.

First check for these direct intents:
- pay: sending money, remittance, paying bills (electricity, school fees, grocery bill), voye lajan, peye, send money
- onboard: wants to become a vendor or list a business ("mwen vle vann", "sell on baz", "register my business", "vin vandè")
- status: asking about an existing order, payment, booking, or delivery
- greeting: hello, hi, bonjou, bonswa, salut, hey, alo — with NO other intent

If none of the above match, check if the message is about one of these categories:
${keywordMap}

Valid category slugs: ${categoryList}

Rules:
- A single word like "cheve", "manje", or "rad" is a category match, not unknown
- Short or vague messages are usually category searches, not unknown
- Only return unknown if you truly cannot map the message

Respond ONLY with valid JSON. No explanation. No markdown.

For direct intents:
{ "type": "pay" }
{ "type": "onboard" }
{ "type": "status" }
{ "type": "greeting" }
{ "type": "unknown" }

For categories:
{ "type": "category", "category_slug": "hair_beauty" }`;

  const messages = [
    ...conversationHistory.slice(-4),
    { role: 'user', content: message },
  ];

  try {
    const res = await client.messages.create({
      model: 'claude-sonnet-4-5',
      max_tokens: 80,
      system: systemPrompt,
      messages,
    });

    const text = res.content[0]?.text?.trim() || '{}';
    const parsed = safeParseJSON(text, { type: 'unknown' });

    // Validate structure
    if (!parsed.type) return { type: 'unknown' };
    if (parsed.type === 'category' && !parsed.category_slug) return { type: 'unknown' };

    return parsed;
  } catch (err) {
    console.error('Topic detection failed:', err.message);
    return { type: 'unknown' };
  }
}
