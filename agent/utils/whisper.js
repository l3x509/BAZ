const axios = require('axios');
const FormData = require('form-data');
const OpenAI = require('openai');

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

// ============================================================
// DOWNLOAD MEDIA FROM META
// ============================================================

async function downloadMedia(mediaId) {
  // Step 1: Get the media URL
  const urlRes = await axios.get(
    `https://graph.facebook.com/v19.0/${mediaId}`,
    { headers: { Authorization: `Bearer ${process.env.META_ACCESS_TOKEN}` } }
  );

  const mediaUrl = urlRes.data.url;

  // Step 2: Download the actual file as buffer
  const fileRes = await axios.get(mediaUrl, {
    headers: { Authorization: `Bearer ${process.env.META_ACCESS_TOKEN}` },
    responseType: 'arraybuffer',
  });

  return {
    buffer: Buffer.from(fileRes.data),
    contentType: fileRes.headers['content-type'] || 'audio/ogg',
  };
}

// ============================================================
// TRANSCRIBE AUDIO VIA WHISPER
// ============================================================

async function transcribeAudio(mediaId) {
  try {
    const { buffer, contentType } = await downloadMedia(mediaId);

    // Determine file extension from content type
    const ext = contentType.includes('ogg') ? 'ogg'
      : contentType.includes('mp4') ? 'mp4'
      : contentType.includes('mpeg') ? 'mp3'
      : 'ogg';

    const form = new FormData();
    form.append('file', buffer, { filename: `audio.${ext}`, contentType });
    form.append('model', 'whisper-1');
    // Hint: Haitian Creole, English, French
    form.append('language', 'fr'); // Whisper uses 'fr' as closest to Creole; works well

    const transcription = await openai.audio.transcriptions.create({
      file: new File([buffer], `audio.${ext}`, { type: contentType }),
      model: 'whisper-1',
    });

    return transcription.text?.trim() || '';
  } catch (err) {
    console.error('Whisper transcription failed:', err.message);
    return ''; // Return empty — router will handle gracefully
  }
}

module.exports = { transcribeAudio };
