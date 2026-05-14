# Baz

Haitian diaspora directory and marketplace.
WhatsApp AI agent + website, powered by Supabase.

---

## Structure

```
baz/
├── agent/    — WhatsApp AI agent (Node.js + Express)
├── web/      — Website (coming soon)
└── db/       — Shared database schema (Supabase / PostgreSQL)
```

---

## Agent

The WhatsApp-facing AI assistant. Users can find businesses,
pay for services, and register as vendors — all via chat.

**Stack:** Node.js, Express, Claude API, WhatsApp Business API,
Stripe, Supabase, Whisper (voice transcription)

```bash
cd agent
cp .env.example .env   # fill in all values
npm install
npm run dev
```

**Deploy:** Railway — set root directory to `agent/`

---

## Web

Directory and marketplace website. Shares the same Supabase database.

```bash
cd web
cp .env.example .env
npm install
npm run dev
```

**Deploy:** Railway — set root directory to `web/`

---

## Database

Schema lives in `db/schema.sql`.
Run it once in your Supabase SQL editor to set up all tables.

Shared by both the agent and the website.
