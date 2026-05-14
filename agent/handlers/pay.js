const db = require('../db');
const wa = require('../whatsapp');
const { parseRemittanceRequest, chat } = require('../claude');
const { emit } = require('../utils/events');
const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY);

// ============================================================
// PAY HANDLER
// User wants to send money or pay for a service
// ============================================================

async function handlePay({ user, conversation, content, lang }) {
  // Parse what they want to pay for
  const parsed = await parseRemittanceRequest(content, lang);

  await db.updateConversation(conversation.id, {
    intent: 'pay',
    context: { ...conversation.context, remittance_draft: parsed },
  });

  // Build a summary to confirm with the user
  const summary = buildRemittanceSummary(parsed, lang);

  const confirmMsg = {
    ht: `${summary}\n\nEske ou vle kontinye?`,
    en: `${summary}\n\nWould you like to proceed?`,
    fr: `${summary}\n\nVoulez-vous continuer?`,
  };

  await wa.sendButtons(user.whatsapp_id, confirmMsg[lang] || confirmMsg.en, [
    { id: 'pay_confirm', title: '✅ Confirm' },
    { id: 'pay_cancel', title: '❌ Cancel' },
  ]);
}

// ============================================================
// PAY CONFIRMED — generate Stripe payment link
// ============================================================

async function handlePayConfirm({ user, conversation, lang }) {
  const draft = conversation.context?.remittance_draft;
  if (!draft) {
    await wa.sendText(user.whatsapp_id, getMsg('no_draft', lang));
    return;
  }

  const total = draft.total || calculateTotal(draft.splits);
  const fee = Math.round(total * 0.04 * 100) / 100; // 4% fee
  const grandTotal = Math.round((total + fee) * 100) / 100;

  try {
    // Create Stripe payment link
    const session = await stripe.paymentLinks.create({
      line_items: [{
        price_data: {
          currency: 'usd',
          product_data: {
            name: `Baz ${draft.recipient_name ? `→ ${draft.recipient_name}` : 'Remittance'}`,
            description: buildSplitDescription(draft.splits),
          },
          unit_amount: Math.round(grandTotal * 100), // cents
        },
        quantity: 1,
      }],
      after_completion: {
        type: 'redirect',
        redirect: { url: `${process.env.BASE_URL}/payment-success` },
      },
      metadata: {
        user_id: user.id,
        conversation_id: conversation.id,
        type: 'remittance',
      },
    });

    // Save to remittances table
    const remittance = await db.createRemittanceRecord({
      senderId: user.id,
      recipientName: draft.recipient_name || 'Recipient',
      totalAmount: total,
      fee,
      splits: draft.splits || [],
      stripePaymentLink: session.url,
    });

    await emit('remittance_initiated', {
      user,
      conversation,
      entityType: 'remittance',
      entityId: remittance?.id,
      payload: { total, fee, split_count: draft.splits?.length },
    });

    const payMsg = {
      ht: `💳 *Total: $${grandTotal} USD* (enkli $${fee} frè)\n\nKlike sou lyen an pou peye an sekirite:\n${session.url}\n\n_Lyen an valid pou 24 èdtan._`,
      en: `💳 *Total: $${grandTotal} USD* (includes $${fee} fee)\n\nClick to pay securely:\n${session.url}\n\n_Link valid for 24 hours._`,
      fr: `💳 *Total: $${grandTotal} USD* (inclut $${fee} de frais)\n\nCliquez pour payer en sécurité:\n${session.url}\n\n_Lien valide 24 heures._`,
    };

    await wa.sendText(user.whatsapp_id, payMsg[lang] || payMsg.en);

  } catch (err) {
    console.error('Stripe payment link failed:', err.message);
    const errMsg = {
      ht: '❌ Gen yon pwoblèm ak peman an. Tanpri eseye ankò.',
      en: '❌ There was a problem creating the payment. Please try again.',
      fr: '❌ Un problème est survenu. Veuillez réessayer.',
    };
    await wa.sendText(user.whatsapp_id, errMsg[lang] || errMsg.en);
  }
}

// ============================================================
// PAY CANCELLED
// ============================================================

async function handlePayCancel({ user, conversation, lang }) {
  await db.updateConversation(conversation.id, {
    context: { ...conversation.context, remittance_draft: null },
  });

  const msg = {
    ht: '👍 Peman an anile. Ou ka kòmanse yon nouvo demann nenpòt ki lè.',
    en: '👍 Payment cancelled. You can start a new request anytime.',
    fr: '👍 Paiement annulé. Vous pouvez en faire un nouveau à tout moment.',
  };
  await wa.sendText(user.whatsapp_id, msg[lang] || msg.en);
}

// ============================================================
// HELPERS
// ============================================================

function buildRemittanceSummary(parsed, lang) {
  const typeLabels = {
    ht: { grocery: 'Komisyon', school_fee: 'Ekolaj', electricity: 'Kouran', contractor: 'Travay', medical: 'Medikal', general: 'Jeneral' },
    en: { grocery: 'Groceries', school_fee: 'School fees', electricity: 'Electricity', contractor: 'Contractor', medical: 'Medical', general: 'General' },
    fr: { grocery: 'Courses', school_fee: 'Frais scolaires', electricity: 'Électricité', contractor: 'Entrepreneur', medical: 'Médical', general: 'Général' },
  };
  const labels = typeLabels[lang] || typeLabels.en;
  const header = { ht: '📋 *Rezime peman*', en: '📋 *Payment Summary*', fr: '📋 *Résumé du paiement*' };
  const recipientLabel = { ht: 'Pou', en: 'To', fr: 'Pour' };

  const lines = [header[lang] || header.en];
  if (parsed.recipient_name) lines.push(`${recipientLabel[lang]}: ${parsed.recipient_name}`);
  if (parsed.splits?.length) {
    parsed.splits.forEach(s => {
      lines.push(`• ${labels[s.type] || s.type}: $${s.amount || '?'}${s.note ? ` (${s.note})` : ''}`);
    });
  }
  const total = parsed.total || calculateTotal(parsed.splits);
  if (total) lines.push(`\n💰 Total: $${total} USD + 4% fee`);
  return lines.join('\n');
}

function buildSplitDescription(splits = []) {
  return splits.map(s => `${s.type}: $${s.amount}`).join(', ') || 'Remittance';
}

function calculateTotal(splits = []) {
  return splits.reduce((sum, s) => sum + (s.amount || 0), 0);
}

function getMsg(key, lang) {
  const msgs = {
    no_draft: {
      ht: 'Mwen pa jwenn detay peman an. Tanpri kòmanse ankò.',
      en: 'Payment details not found. Please start over.',
      fr: 'Détails de paiement introuvables. Veuillez recommencer.',
    },
  };
  return msgs[key]?.[lang] || msgs[key]?.en || '';
}

// Stub — implement when remittances table helper is added to db.js
async function createRemittanceRecord(data) {
  const { createClient } = require('@supabase/supabase-js');
  const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY);
  const { data: record } = await supabase.from('remittances').insert({
    sender_id: data.senderId,
    recipient_name: data.recipientName,
    total_amount: data.totalAmount,
    fee: data.fee,
    splits: data.splits,
    stripe_payment_link: data.stripePaymentLink,
  }).select().single();
  return record;
}

module.exports = { handlePay, handlePayConfirm, handlePayCancel };
