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
// Claude sometimes returns multiple JSON blocks when given conversation
// history. We strip all fences, then try from the LAST valid JSON
// object backwards — the last one is Claude's final answer.
function safeParseJSON(text, fallback = {}) {
  if (!text) return fallback;

  // Step 1: Remove ALL markdown fence markers globally
  const cleaned = text
    .replace(/```json/gi, '')
    .replace(/```/g, '')
    .trim();

  // Step 2: Try parsing the full cleaned text directly
  try { return JSON.parse(cleaned); } catch {}

  // Step 3: Find all complete {...} objects, try from LAST to FIRST
  // Last match = Claude's most recent/correct answer
  const matches = [...cleaned.matchAll(/\{[^{}]*\}/g)];
  for (let i = matches.length - 1; i >= 0; i--) {
    try { return JSON.parse(matches[i][0]); } catch {}
  }

  // Step 4: Try greedy match for nested objects
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
Vous pouvez aussi les aider à envoyer de l'argent et payer des services.
Parlez naturellement, chaleureusement et clairement.
Réponses courtes — les gens lisent sur WhatsApp.`,
};

// ── DETECT TOPIC ──────────────────────────────────────────────
// Single call: returns intent type + category + location.
// NOTE: We intentionally do NOT pass conversationHistory here.
// Passing history caused Claude to generate one JSON response per
// history message, flooding output and cutting off the real answer.
// Topic detection only needs the current message.

async function detectTopic(message, lang) {
  const systemPrompt = `You are a classifier for Baz, a Haitian WhatsApp assistant.

Classify this single message. Respond with ONE JSON object only. No markdown. No code fences. No explanation.

STEP 1 — Check direct intents first:
- pay: sending money, remittance, voye lajan, school fees, electricity bill
- onboard: wants to list a business or sell ("mwen vle vann", "sell on baz", "vin vandè")
- status: asking about an existing order, payment, or delivery
- greeting: hello, hi, bonjou, bonswa, salut, alo — with NO other intent

STEP 2 — If none match, identify category:
${keywordPrompt()}

Valid slugs: ${categoryList()}

STEP 3 — Extract location if mentioned:
- city in English, country as "HT"/"US"/"CA"/"FR", null if not mentioned

Single word messages like "cheve", "manje", "rad", "hair", "food" are ALWAYS category matches.

Respond with exactly ONE of these — nothing else:
{"type":"pay"}
{"type":"onboard"}
{"type":"status"}
{"type":"greeting"}
{"type":"unknown"}
{"type":"category","category_slug":"hair_beauty","city":null,"country":null}`;

  try {
    const res = await client.messages.create({
      model:       'claude-sonnet-4-5',
      max_tokens:  150,
      temperature: 0,
      system:      systemPrompt,
      messages:    [{ role: 'user', content: message }],
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
    systemSuffix = `\n\nSearch results:\n${JSON.stringify(summary)}`;
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
  const prompt = `Parse this remittance request. Respond with ONE JSON object only. No markdown. No code fences.
Message: "${message}"

{"total":200,"recipient_name":"Marie Jean","splits":[{"type":"grocery","amount":80,"note":"Marché Salomon"},{"type":"school_fee","amount":120,"note":"École Nationale"}]}

Split types: grocery, school_fee, contractor, electricity, medical, general`;

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

module.exports = { detectTopic, chat, parseRemittanceRequest };
