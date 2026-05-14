const db = require('../db');
const wa = require('../whatsapp');
const { emit } = require('../utils/events');

// ============================================================
// ONBOARD HANDLER
// Vendor wants to list their business
// This is a multi-step flow managed via conversation state
// ============================================================

const ONBOARD_STEPS = ['name', 'category', 'city', 'phone', 'description', 'confirm'];

async function handleOnboard({ user, conversation, content, lang }) {
  const state = conversation.state || {};
  const step = state.onboard_step || 'name';

  if (step === 'name') {
    await startOnboarding(user, conversation, lang);
    return;
  }

  // Process answer to current step
  await processOnboardStep({ user, conversation, content, step, state, lang });
}

async function startOnboarding(user, conversation, lang) {
  await db.updateConversation(conversation.id, {
    intent: 'onboard',
    state: { onboard_step: 'name', data: {} },
  });

  const msg = {
    ht: `🏪 *Anrejistre biznis ou sou Baz!*\n\nN ap poze ou kèk kesyon senp.\n\n1️⃣ Ki *non biznis* ou a?`,
    en: `🏪 *List your business on Baz!*\n\nWe'll ask you a few simple questions.\n\n1️⃣ What is your *business name*?`,
    fr: `🏪 *Listez votre entreprise sur Baz!*\n\nNous allons vous poser quelques questions simples.\n\n1️⃣ Quel est le *nom de votre entreprise*?`,
  };
  await wa.sendText(user.whatsapp_id, msg[lang] || msg.en);
}

async function processOnboardStep({ user, conversation, content, step, state, lang }) {
  const data = state.data || {};

  // Save current step's answer
  data[step] = content;

  const stepIndex = ONBOARD_STEPS.indexOf(step);
  const nextStep = ONBOARD_STEPS[stepIndex + 1];

  if (step === 'category') {
    // Validate category
    const categories = await db.getCategories();
    const matched = categories.find(c =>
      c.slug.toLowerCase() === content.toLowerCase() ||
      c.name_en.toLowerCase().includes(content.toLowerCase()) ||
      c.name_ht.toLowerCase().includes(content.toLowerCase())
    );
    if (!matched) {
      // Show category list
      await sendCategoryList(user, lang);
      return;
    }
    data.category_id = matched.id;
    data.category_slug = matched.slug;
  }

  if (nextStep && nextStep !== 'confirm') {
    // Ask next question
    await db.updateConversation(conversation.id, {
      state: { onboard_step: nextStep, data },
    });
    await askOnboardQuestion(user, nextStep, lang);
    return;
  }

  if (nextStep === 'confirm') {
    // Show summary and ask to confirm
    await db.updateConversation(conversation.id, {
      state: { onboard_step: 'confirm', data },
    });
    await sendOnboardSummary(user, data, lang);
    return;
  }

  // step === 'confirm' — finalize
  if (content.toLowerCase().includes('yes') || content === 'onboard_confirm' ||
      content.toLowerCase().includes('wi') || content.toLowerCase().includes('oui')) {
    await finalizeOnboarding(user, conversation, data, lang);
  } else {
    const cancelMsg = {
      ht: '👍 Anrejistreman anile. Ou ka rekòmanse nenpòt ki lè.',
      en: '👍 Registration cancelled. You can restart anytime.',
      fr: '👍 Inscription annulée. Vous pouvez recommencer à tout moment.',
    };
    await wa.sendText(user.whatsapp_id, cancelMsg[lang] || cancelMsg.en);
    await db.updateConversation(conversation.id, { state: {}, intent: 'unknown' });
  }
}

async function askOnboardQuestion(user, step, lang) {
  const questions = {
    category: {
      ht: '2️⃣ Ki *kategori* biznis ou a? (plonbye, chofè, pwofesè, restoran, etc.)',
      en: '2️⃣ What *category* is your business? (plumber, driver, tutor, restaurant, etc.)',
      fr: '2️⃣ Quelle est la *catégorie* de votre entreprise? (plombier, chauffeur, tuteur, restaurant, etc.)',
    },
    city: {
      ht: '3️⃣ Ki *vil* ou travay la? (Pòtoprens, Boston, Miami, etc.)',
      en: '3️⃣ What *city* do you operate in? (Port-au-Prince, Boston, Miami, etc.)',
      fr: '3️⃣ Dans quelle *ville* opérez-vous? (Port-au-Prince, Boston, Miami, etc.)',
    },
    phone: {
      ht: '4️⃣ Ki *nimewo telefòn* ou a?',
      en: '4️⃣ What is your *phone number*?',
      fr: '4️⃣ Quel est votre *numéro de téléphone*?',
    },
    description: {
      ht: '5️⃣ Ekri yon ti *deskripsyon* biznis ou a (1-2 fraz):',
      en: '5️⃣ Write a short *description* of your business (1-2 sentences):',
      fr: '5️⃣ Écrivez une courte *description* de votre entreprise (1-2 phrases):',
    },
  };

  const q = questions[step];
  if (q) await wa.sendText(user.whatsapp_id, q[lang] || q.en);
}

async function sendCategoryList(user, lang) {
  const categories = await db.getCategories();
  const header = { ht: 'Chwazi yon kategori:', en: 'Choose a category:', fr: 'Choisissez une catégorie:' };
  const rows = categories.filter(c => c.slug !== 'other').map(c => ({
    id: `cat_${c.slug}`,
    title: (lang === 'ht' ? c.name_ht : lang === 'fr' ? c.name_fr : c.name_en).substring(0, 24),
    description: c.icon || '',
  }));

  await wa.sendList(user.whatsapp_id, header[lang] || header.en, 'Choose', [
    { title: 'Categories', rows },
  ]);
}

async function sendOnboardSummary(user, data, lang) {
  const summary = {
    ht: `📋 *Rezime biznis ou a:*\n\n🏪 Non: ${data.name}\n📂 Kategori: ${data.category_slug}\n📍 Vil: ${data.city}\n📞 Telefòn: ${data.phone}\n📝 ${data.description}\n\nEske tout enfòmasyon yo kòrèk?`,
    en: `📋 *Your business summary:*\n\n🏪 Name: ${data.name}\n📂 Category: ${data.category_slug}\n📍 City: ${data.city}\n📞 Phone: ${data.phone}\n📝 ${data.description}\n\nIs all information correct?`,
    fr: `📋 *Résumé de votre entreprise:*\n\n🏪 Nom: ${data.name}\n📂 Catégorie: ${data.category_slug}\n📍 Ville: ${data.city}\n📞 Téléphone: ${data.phone}\n📝 ${data.description}\n\nToutes les informations sont-elles correctes?`,
  };

  await wa.sendButtons(user.whatsapp_id, summary[lang] || summary.en, [
    { id: 'onboard_confirm', title: '✅ Confirm' },
    { id: 'onboard_cancel', title: '❌ Cancel' },
  ]);
}

async function finalizeOnboarding(user, conversation, data, lang) {
  const { createClient } = require('@supabase/supabase-js');
  const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY);

  const { error } = await supabase.from('businesses').insert({
    owner_id: user.id,
    category_id: data.category_id || null,
    name: data.name,
    description: data.description,
    phone: data.phone,
    whatsapp: user.whatsapp_id,
    city: data.city,
    country: data.city?.toLowerCase().includes('haiti') || data.city?.toLowerCase().includes('ayiti') ? 'HT' : 'US',
    status: 'pending', // requires review before going live
  });

  if (error) {
    const errMsg = {
      ht: '❌ Gen yon erè. Tanpri eseye ankò.',
      en: '❌ Something went wrong. Please try again.',
      fr: '❌ Une erreur est survenue. Veuillez réessayer.',
    };
    await wa.sendText(user.whatsapp_id, errMsg[lang] || errMsg.en);
    return;
  }

  await emit('vendor_onboarded', { user, conversation, payload: { city: data.city } });

  await db.updateUser(user.id, { role: 'vendor' });
  await db.updateConversation(conversation.id, { state: {}, intent: 'unknown' });

  const successMsg = {
    ht: `✅ *Biznis ou anrejistre!*\n\nNou pral revize enfòmasyon yo epi aktive pwofil ou nan 24-48 èdtan.\n\nMèsi dèske ou chwazi Baz! 🇭🇹`,
    en: `✅ *Business registered!*\n\nWe'll review your information and activate your profile within 24-48 hours.\n\nThank you for choosing Baz! 🇭🇹`,
    fr: `✅ *Entreprise enregistrée!*\n\nNous examinerons vos informations et activerons votre profil dans 24-48 heures.\n\nMerci d'avoir choisi Baz! 🇭🇹`,
  };
  await wa.sendText(user.whatsapp_id, successMsg[lang] || successMsg.en);
}

module.exports = { handleOnboard };
