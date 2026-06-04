'use strict';

// ============================================================
// utils/normalize.js
// Shared text normalization for Baz.
// Used in router.js (keyword/city lookups) and db.js (queries).
// Also used by sync-categories.js to pre-normalize DB keywords.
//
// What it does:
//   1. NFD decomposition — splits accented chars into base + mark
//   2. Strip combining diacritics — removes the accent marks
//   3. Lowercase
//   4. Collapse whitespace
//
// Examples:
//   normalize('Solèy')        → 'soley'
//   normalize('kwafiè')       → 'kwafie'
//   normalize('Pétion-Ville') → 'petion-ville'
//   normalize('  MANJE  ')    → 'manje'
//   normalize('sèvis')        → 'sevis'
//   normalize('evènman')      → 'evenman'
//   normalize(null)           → ''
// ============================================================

function normalize(text) {
  if (!text || typeof text !== 'string') return '';
  return text
    .normalize('NFD')                // decompose: è → e + U+0300 (combining grave)
    .replace(/[\u0300-\u036f]/g, '') // strip all combining diacritical marks
    .toLowerCase()
    .replace(/\s+/g, ' ')           // collapse multiple spaces
    .trim();
}

// ── normalizeMap ─────────────────────────────────────────────
// Pre-normalizes a key→value map so lookups work with or without
// diacritics. Used to build normalized versions of KEYWORD_MAP
// and KNOWN_CITIES at startup.
//
// Example:
//   normalizeMap({ 'kwafiè': 'hair_beauty' })
//   → { 'kwafie': 'hair_beauty' }
function normalizeMap(map) {
  const out = {};
  for (const [key, val] of Object.entries(map)) {
    out[normalize(key)] = val;
  }
  return out;
}

// ── normalizeList ─────────────────────────────────────────────
// Pre-normalizes an array of strings.
// Used to build normalized KNOWN_CITIES for extractCity().
function normalizeList(list) {
  return list.map(normalize);
}

module.exports = { normalize, normalizeMap, normalizeList };
