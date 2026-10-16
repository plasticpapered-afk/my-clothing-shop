// Live chat assistant for Dust Patrol Cleaning Services.
//
// The assistant needs ONE of these keys (saved on Vercel as an environment variable):
//   GEMINI_API_KEY      - a free key from https://aistudio.google.com/apikey
//   AI_GATEWAY_API_KEY  - a Vercel AI Gateway key
//
// Model names change over time, so instead of trusting a fixed list we ask the
// provider which models this key can actually use and pick the best one.

const geminiChatUrl = "https://generativelanguage.googleapis.com/v1beta/openai/chat/completions";
const geminiModelsUrl = "https://generativelanguage.googleapis.com/v1beta/models";
const gatewayUrl = "https://ai-gateway.vercel.sh/v1/chat/completions";

// Preferred models, best first. Used only if they appear in the key's own list.
const GEMINI_PREFERENCE = [
  "gemini-3.8-flash",
  "gemini-3.6-flash",
  "gemini-3.5-flash-lite",
  "gemini-3.1-flash-lite",
  "gemini-3-flash-preview",
  "gemini-2.5-flash",
  "gemini-2.5-flash-lite"
];

const SYSTEM_PROMPT =
  "You are the Dust Patrol Cleaning Services assistant (KHAR-ECE Consortium, Harare, Zimbabwe). " +
  "Help customers with residential cleaning, commercial cleaning, deep cleaning, window and surface cleaning, and sanitization. " +
  "Every service is currently listed at $50 in USD. " +
  "Customers can pick a service on the website, check out, and pay with EcoCash or InnBucks (a prompt appears on their phone), or choose bank transfer or cash. " +
  "Booking dates are confirmed on WhatsApp. " +
  "Contact: phone and WhatsApp +263 774 502 737, email munashealtawine@gmail.com, website www.kharece.co.zw, based in Harare. " +
  "Only state facts you were given here. Never invent discounts, chemicals, team details or availability: if you do not know something, " +
  "say you are not sure and ask the customer to message the team on WhatsApp. Keep answers friendly, short and specific to Dust Patrol.";

let cachedModels = { key: "", list: [], at: 0 };

function configuredKeys() {
  return {
    gemini: String(process.env.GEMINI_API_KEY || "").trim(),
    gateway: String(process.env.AI_GATEWAY_API_KEY || "").trim()
  };
}

function isConfigured() {
  const keys = configuredKeys();
  return Boolean(keys.gemini || keys.gateway);
}

// Asks Google which models this key may use. Cached for ten minutes.
async function listGeminiModels(apiKey) {
  if (cachedModels.key === apiKey && Date.now() - cachedModels.at < 10 * 60 * 1000) {
    return cachedModels.list;
  }
  const response = await fetch(`${geminiModelsUrl}?pageSize=200`, {
    headers: { "x-goog-api-key": apiKey }
  });
  if (!response.ok) {
    const error = new Error(`Google rejected the key (status ${response.status})`);
    error.status = response.status;
    throw error;
  }
  const data = await response.json();
  const names = (data.models || [])
    .filter((model) => (model.supportedGenerationMethods || []).includes("generateContent"))
    .map((model) => String(model.name || "").replace(/^models\//, ""));
  cachedModels = { key: apiKey, list: names, at: Date.now() };
  return names;
}

function pickGeminiModels(available) {
  const chosen = GEMINI_PREFERENCE.filter((name) => available.includes(name));
  if (process.env.GEMINI_MODEL) chosen.unshift(process.env.GEMINI_MODEL);
  // Last resort: any text "flash" model the key offers.
  for (const name of available) {
    if (/flash/.test(name) && !/(image|tts|live|audio|transcribe|omni|translate)/.test(name) && !chosen.includes(name)) {
      chosen.push(name);
    }
  }
  return chosen;
}

async function askModel(url, apiKey, model, message) {
  const response = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${apiKey}` },
    body: JSON.stringify({
      model,
      temperature: 0.6,
      max_tokens: 400,
      messages: [
        { role: "system", content: SYSTEM_PROMPT },
        { role: "user", content: message }
      ]
    })
  });
  if (response.ok) {
    const data = await response.json();
    const reply = data && data.choices && data.choices[0] && data.choices[0].message
      ? String(data.choices[0].message.content || "").trim()
      : "";
    if (!reply) throw Object.assign(new Error("The assistant returned an empty reply"), { status: 0 });
    return reply;
  }
  throw Object.assign(new Error(`status ${response.status}`), { status: response.status });
}

async function tryProvider(url, apiKey, models, message) {
  let lastStatus = 0;
  for (const model of models) {
    for (let attempt = 0; attempt < 2; attempt++) {
      try {
        return { reply: await askModel(url, apiKey, model, message) };
      } catch (error) {
        lastStatus = error.status || 0;
        if (lastStatus === 429 || lastStatus >= 500) {
          await new Promise((resolve) => setTimeout(resolve, 600));
          continue;
        }
        break; // 400/401/403/404: try the next model
      }
    }
  }
  return { failedStatus: lastStatus };
}

async function generateChatReply(message) {
  const keys = configuredKeys();
  if (!keys.gemini && !keys.gateway) {
    throw new Error("The AI assistant is not configured.");
  }

  const problems = [];

  if (keys.gemini) {
    try {
      const available = await listGeminiModels(keys.gemini);
      const models = pickGeminiModels(available);
      if (models.length) {
        const result = await tryProvider(geminiChatUrl, keys.gemini, models, message);
        if (result.reply) return result.reply;
        problems.push(`Google models failed (status ${result.failedStatus})`);
      } else {
        problems.push("Google lists no usable chat model for this key");
      }
    } catch (error) {
      problems.push(error.message);
      // A key that Google does not know may be a Vercel gateway key saved under the wrong name.
      const result = await tryProvider(gatewayUrl, keys.gemini, [process.env.AI_GATEWAY_MODEL || "google/gemini-2.5-flash"], message).catch(() => ({}));
      if (result.reply) return result.reply;
    }
  }

  if (keys.gateway) {
    const result = await tryProvider(gatewayUrl, keys.gateway, [process.env.AI_GATEWAY_MODEL || "openai/gpt-4o-mini"], message);
    if (result.reply) return result.reply;
    problems.push(`Vercel gateway failed (status ${result.failedStatus})`);
  }

  throw new Error(problems.join("; ") || "No AI model was available");
}

module.exports = { generateChatReply, isConfigured, pickGeminiModels, SYSTEM_PROMPT };
