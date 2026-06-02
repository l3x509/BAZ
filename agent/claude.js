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
function safeParseJSON(text, fallback = {}) {
  if (!text) return fallback;
  const cleaned = text.replace(/```json/gi, '').replace(/```/g, '').trim();
  try { return JSON.parse(cleaned); } catch {}
  const matches = [...cleaned.matchAll(/\{[^{}]*\}/g)];
  for (let i = matches.length - 1; i >= 0; i--) {
    try { return JSON.parse(matches[i][0]); } catch {}
  }
  try {
    const match = cleaned.match(/\{[\s\S]*\}/);
    if (match) return JSON.parse(match[0]);
  } catch {}
  console.error('[claude] JSON parse failed. Raw:', text?.slice(0, 200));
  return fallback;
}

// ── SIMPLE LANGUAGE DETECTOR ──────────────────────────────────
// Fast heuristic — no API call needed.
// Returns 'ht', 'fr', 'en', or null if uncertain.
function detectLang(text) {
  const t = text.toLowerCase();
  const htWords = ['mwen', 'nou ', ' yo ', ' ak ', ' pa ', ' ki ', ' se ', ' pou ', 'bonjou', 'bonswa', 'mèsi', 'kijan', 'nenpòt', 'bezwen'];
  const frWords = ['bonjour', 'bonsoir', 'merci', ' je ', ' tu ', ' vous ', ' nous ', "c'est", 'comment', 'pourquoi', "qu'est", 'aussi', 'trouver'];
  const htScore = htWords.filter(w => t.includes(w)).length;
  const frScore = frWords.filter(w => t.includes(w)).length;
  if (htScore >= 2) return 'ht';
  if (frScore >= 2) return 'fr';
  if (htScore >= 1 && frScore === 0) return 'ht';
  if (frScore >= 1 && htScore === 0) return 'fr';
  return null;
}

// ── SYSTEM PROMPTS ────────────────────────────────────────────
const SYSTEM_PROMPTS = {
  ht: `Ou se Baz, yon asistan ayisyen sou WhatsApp.
Ou pale Kreyòl natirèlman. Reponn kout — moun ap li sou telefòn.
Ou ede moun jwenn biznis, voye lajan, ak achte/vann sou Vitrin.`,
  en: `You are Baz, a Haitian community assistant on WhatsApp.
Speak naturally and concisely — people read on their phones.
Help users find businesses, send money, and buy/sell on Vitrin.`,
  fr: `Vous êtes Baz, un assistant haïtien sur WhatsApp.
Parlez naturellement et brièvement — les gens lisent sur téléphone.
Aidez à trouver des entreprises, envoyer de l'argent et acheter/vendre sur Vitrin.`,
};

// ── DETECT TOPIC ──────────────────────────────────────────────
// Returns intent + category + location + detected language.
// Does NOT receive conversationHistory — avoids multi-block JSON output.
async function detectTopic(message, currentLang) {
  // Quick heuristic language detection first (no API call)
  const detectedLang = detectLang(message);

  const systemPrompt = `You are a classifier for Baz, a Haitian WhatsApp assistant.

Classify this message. Return ONE JSON object only. No markdown. No explanation.

STEP 1 — Direct intents:
- pay: voye lajan, send money, remittance, school fees, electricity
- onboard: mwen vle vann, sell on baz, vin vandè, register business
- status: order status, payment status, delivery update
- greeting: hello/hi/bonjou/bonswa/salut/alo with NO other intent

STEP 2 — Category match using keywords:
${keywordPrompt()}

Valid slugs: ${categoryList()}

STEP 3 — Extract if mentioned:
- city: English name or null
- country: "HT"/"US"/"CA"/"FR" or null
- lang: detected language "ht"/"en"/"fr" (what language is the message written in?)

Single words like "cheve","manje","rad","hair","food","beauty" are ALWAYS category matches.

Return exactly one of:
{"type":"greeting","lang":"en"}
{"type":"pay","lang":"ht"}
{"type":"onboard","lang":"ht"}
{"type":"status","lang":"en"}
{"type":"unknown","lang":"en"}
{"type":"category","category_slug":"hair_beauty","city":null,"country":null,"lang":"ht"}`;

  try {
    const res = await client.messages.create({
      model:       'claude-sonnet-4-5',
      max_tokens:  120,
      temperature: 0,
      system:      systemPrompt,
      messages:    [{ role: 'user', content: message }],
    });

    const text   = res.content[0]?.text?.trim() || '{}';
    const parsed = safeParseJSON(text, { type: 'unknown', lang: detectedLang || currentLang });

    if (!parsed.type) return { type: 'unknown', lang: currentLang };
    if (parsed.type === 'category' && !parsed.category_slug) return { type: 'unknown', lang: currentLang };

    // Merge heuristic detection with Claude's detection
    parsed.lang = detectedLang || parsed.lang || currentLang;
    return parsed;

  } catch (err) {
    console.error('[claude] detectTopic failed:', err.message);
    return { type: 'unknown', lang: currentLang };
  }
}

// ── CHAT ──────────────────────────────────────────────────────
async function chat(userMessage, lang, conversationHistory = [], contextData = {}) {
  const systemBase = SYSTEM_PROMPTS[lang] || SYSTEM_PROMPTS.en;
  let systemSuffix = '';
  if (contextData.businesses?.length) {
    const summary = contextData.businesses.map(b => ({
      id: b.id, name: b.name,
      category: b.service_categories?.name_en,
      city: b.city, rating: b.avg_rating,
    }));
    systemSuffix = `\n\nSearch results:\n${JSON.stringify(summary)}`;
  }
  const messages = [
    ...conversationHistory.slice(-10),
    { role: 'user', content: userMessage },
  ];
  try {
    const res = await client.messages.create({
      model: 'claude-sonnet-4-5', max_tokens: 400,
      system: systemBase + systemSuffix, messages,
    });
    return res.content[0]?.text?.trim() || '';
  } catch (err) {
    console.error('[claude] chat failed:', err.message);
    return '';
  }
}

// ── PARSE REMITTANCE ──────────────────────────────────────────
async function parseRemittanceRequest(message, lang) {
  const prompt = `Parse this remittance request. ONE JSON object only. No markdown.
Message: "${message}"
{"total":200,"recipient_name":"Marie Jean","splits":[{"type":"grocery","amount":80,"note":"Marché Salomon"}]}
Split types: grocery, school_fee, contractor, electricity, medical, general`;
  try {
    const res = await client.messages.create({
      model: 'claude-sonnet-4-5', max_tokens: 300, temperature: 0,
      messages: [{ role: 'user', content: prompt }],
    });
    const text = res.content[0]?.text?.trim() || '{}';
    return safeParseJSON(text, { splits: [{ type: 'general' }] });
  } catch {
    return { splits: [{ type: 'general' }] };
  }
}

module.exports = { detectTopic, chat, parseRemittanceRequest };
