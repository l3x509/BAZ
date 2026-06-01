// ============================================================
// BAZ + VITRIN — CLAUDE API
// ============================================================

'use strict';

const Anthropic = require('@anthropic-ai/sdk');
const {
  active,
  buildKeywordPrompt: _buildKeywordPrompt,
  slugs,
} = require('./config/categories');

const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

// ── MEMOIZED PROMPTS ──────────────────────────────────────────
let _keywordCache = null;
const keywordPrompt = () => {
  if (!_keywordCache) _keywordCache = _buildKeywordPrompt();
  return _keywordCache;
};

let _slugCache = null;
const categoryList = () => {
  if (!_slugCache) _slugCache = slugs().join(', ');
  return _slugCache;
};

// ── SAFE JSON PARSER ──────────────────────────────────────────
// Handles Claude occasionally wrapping JSON in markdown fences
// or returning multiple fence blocks concatenated.
function safeParseJSON(text, fallback = {}) {
  if (!text) return fallback;

  // Step 1: Remove ALL markdown fence markers globally
  const cleaned = text
    .replace(/```json/gi, '')
    .replace(/```/g, '')
    .trim();

  // Step 2: Try parsing the cleaned text directly
  try { return JSON.parse(cleaned); } catch {}

  // Step 3: Extract the first complete {...} JSON object found
  try {
    const match = cleaned.match(/\{[\s\S]*\}/);
    if (match) return JSON.parse(match[0]);
  } catch {}

  console.error('[claude] JSON parse failed. Raw:', text?.slice(0, 200));
  return fallback;
}

// ── SYSTEM PROMPTS ────────────────────────────────────────────
const SYSTEM_PROMPTS = {
  ht: `Ou se Baz, yon asistan entelijan pou kominote ayisyen an.
Ou pale Kreyòl ayisyen natirèlman ak respè.
Ou ede moun jwenn biznis ak sèvis nan Ayiti ak nan dyaspora a (Miami, Boston, New York, Montreal).
Ou ka ede yo voye lajan ak peye pou sèvis tou — ekolaj, kont elektrik, komisyon, kontraktè.
Ou toujou reponn an Kreyòl, ak chalè ak klèman.
Kenbe repons ou yo kout ak dirèk — moun ap li sou WhatsApp.`,

  en: `You are Baz, an intelligent assistant for the Haitian community.
You help people find businesses and services in Haiti and in diaspora cities (Miami, Boston, New York, Montreal).
You also help them send money and pay for services — school fees, electricity, groceries, contractors.
Speak naturally, warmly, and clearly.
Keep responses concise — people are reading on WhatsApp.`,

  fr: `Vous êtes Baz, un assistant intelligent pour la communauté haïtienne.
Vous aidez les gens à trouver des entreprises et des services en Haïti et dans les villes de la diaspora.
Vous pouvez aussi les aider à envoyer de l'argent et payer des services — frais scolaires, électricité, courses, entrepreneurs.
Parlez naturellement, chaleureusement et clairement.
Réponses courtes — les gens lisent sur WhatsApp.`,
};

// ── DETECT TOPIC ──────────────────────────────────────────────
// Single Claude call: returns intent type + category + location.
// Replaces the old detectIntent + extractSearchParams two-call pattern.
//
// Returns one of:
//   { type: 'category', category_slug: 'hair_beauty', city: null, country: null }
//   { type: 'pay' }
//   { type: 'onboard' }
//   { type: 'status' }
//   { type: 'greeting' }
//   { type: 'unknown' }

async function detectTopic(message, lang, conversationHistory = []) {
  const systemPrompt = `You are a classifier for Baz, a Haitian WhatsApp assistant.

STEP 1 — Check for direct intents first:
- pay: sending money, remittance, voye lajan, school fees, electricity bill, diaspora payment to Haiti
- onboard: wants to list a business or sell ("mwen vle vann", "sell on baz", "vin vandè", "register my business")
- status: asking about an existing order, payment, booking, or delivery
- greeting: hello, hi, bonjou, bonswa, salut, alo — with NO other intent

STEP 2 — If none match, identify the category from this keyword map:
${keywordPrompt()}

Valid slugs: ${categoryList()}

STEP 3 — If category found, also extract location if mentioned:
- city: in English (e.g. "Boston", "Port-au-Prince", "Miami")
- country: "HT" for Haiti, "US", "CA", "FR" for diaspora
- Leave city/country null if not mentioned

Rules:
- A single word like "cheve", "manje", "rad" is always a category match
- Short or vague messages → category match, not unknown
- Only return unknown if truly unclassifiable

Respond ONLY with valid JSON. No markdown. No explanation. No code fences.

Direct intents:
{ "type": "pay" }
{ "type": "onboard" }
{ "type": "status" }
{ "type": "greeting" }
{ "type": "unknown" }

Category:
{ "type": "category", "category_slug": "hair_beauty", "city": null, "country": null }
{ "type": "category", "category_slug": "plumber", "city": "Boston", "country": "US" }`;

  const messages = [
    ...conversationHistory.slice(-4),
    { role: 'user', content: message },
  ];

  try {
    const res = await client.messages.create({
      model:       'claude-sonnet-4-5',
      max_tokens:  300,
      temperature: 0,
      system:      systemPrompt,
      messages,
    });

    const text   = res.content[0]?.text?.trim() || '{}';
    const parsed = safeParseJSON(text, { type: 'unknown' });

    if (!parsed.type)                                         return { type: 'unknown' };
    if (parsed.type === 'category' && !parsed.category_slug) return { type: 'unknown' };

    return parsed;
  } catch (err) {
    console.error('[claude] detectTopic failed:', err.message);
    return { type: 'unknown' };
  }
}

// ── CHAT ──────────────────────────────────────────────────────
async function chat(userMessage, lang, conversationHistory = [], contextData = {}) {
  const systemBase = SYSTEM_PROMPTS[lang] || SYSTEM_PROMPTS.en;

  let systemSuffix = '';
  if (contextData.businesses?.length) {
    const summary = contextData.businesses.map(b => ({
      id:       b.id,
      name:     b.name,
      category: b.service_categories?.name_en,
      city:     b.city,
      rating:   b.avg_rating,
    }));
    systemSuffix = `\n\nSearch results to reference:\n${JSON.stringify(summary)}`;
  }

  const messages = [
    ...conversationHistory.slice(-10),
    { role: 'user', content: userMessage },
  ];

  try {
    const res = await client.messages.create({
      model:      'claude-sonnet-4-5',
      max_tokens: 400,
      system:     systemBase + systemSuffix,
      messages,
    });
    return res.content[0]?.text?.trim() || '';
  } catch (err) {
    console.error('[claude] chat failed:', err.message);
    return '';
  }
}

// ── PARSE REMITTANCE REQUEST ──────────────────────────────────
async function parseRemittanceRequest(message, lang) {
  const prompt = `Parse this remittance or payment request from a Haitian diaspora user.
Message: "${message}"

Respond ONLY with valid JSON. No markdown. No code fences.
{
  "total": 200,
  "recipient_name": "Marie Jean",
  "splits": [
    { "type": "grocery",    "amount": 80,  "note": "Marché Salomon" },
    { "type": "school_fee", "amount": 120, "note": "École Nationale" }
  ]
}

Split types: grocery, school_fee, contractor, electricity, medical, general
All fields optional. At least one split required.`;

  try {
    const res = await client.messages.create({
      model:       'claude-sonnet-4-5',
      max_tokens:  300,
      temperature: 0,
      messages:    [{ role: 'user', content: prompt }],
    });
    const text = res.content[0]?.text?.trim() || '{}';
    return safeParseJSON(text, { splits: [{ type: 'general' }] });
  } catch {
    return { splits: [{ type: 'general' }] };
  }
}

module.exports = {
  detectTopic,
  chat,
  parseRemittanceRequest,
};
