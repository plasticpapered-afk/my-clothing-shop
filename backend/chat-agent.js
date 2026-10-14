const geminiUrl = "https://generativelanguage.googleapis.com/v1beta/openai/chat/completions";
const gatewayUrl = "https://ai-gateway.vercel.sh/v1/chat/completions";

// Prefer the free Gemini key; fall back to the Vercel AI Gateway key if that is what is set.
function getProvider() {
  if (process.env.GEMINI_API_KEY) {
    return {
      url: geminiUrl,
      apiKey: process.env.GEMINI_API_KEY,
      models: process.env.GEMINI_MODEL
        ? [process.env.GEMINI_MODEL]
        : ["gemini-3.8-flash", "gemini-flash-latest", "gemini-3.1-flash-lite", "gemini-2.5-flash"]
    };
  }
  if (process.env.AI_GATEWAY_API_KEY) {
    return {
      url: gatewayUrl,
      apiKey: process.env.AI_GATEWAY_API_KEY,
      models: [process.env.AI_GATEWAY_MODEL || "openai/gpt-4o-mini"]
    };
  }
  return null;
}

async function generateChatReply(message) {
  const provider = getProvider();
  if (!provider) {
    throw new Error("AI_GATEWAY_API_KEY is not configured");
  }

  const models = provider.models;
  let lastStatus = 0;

  for (const model of models) {
    for (let attempt = 0; attempt < 2; attempt++) {
      const response = await fetch(provider.url, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${provider.apiKey}`
        },
        body: JSON.stringify({
          model,
          temperature: 0.7,
          messages: [
            {
              role: "system",
              content: "You are the Internal Frontier shopping assistant. Help customers with the current collection, sizing, styling, and WhatsApp enquiries. Keep answers friendly, concise, and brand-specific to Internal Frontier. The collection includes the Silent Wars Graphic Tee, Black Frontier Tracksuit, White Frontier Tracksuit, and Frontier Jersey. Only state facts you were given here. Never invent colours, sizes, prices, materials, stock levels, or delivery details: if you do not know something, say you are not sure and ask the customer to message the team on WhatsApp. Encourage customers to message on WhatsApp for exact pricing and stock confirmation."
            },
            { role: "user", content: message }
          ]
        })
      });

      if (response.ok) {
        const data = await response.json();
        const reply = data?.choices?.[0]?.message?.content?.trim();
        if (reply) return reply;
        throw new Error("The AI assistant returned an empty reply");
      }

      lastStatus = response.status;
      // 404 = model does not exist for this key; try the next model.
      if (response.status === 404) break;
      // 429/500/503 = busy or rate limited; wait briefly and retry this model.
      if (response.status === 429 || response.status >= 500) {
        await new Promise((resolve) => setTimeout(resolve, 700));
        continue;
      }
      throw new Error(`AI request failed with status ${response.status}`);
    }
  }

  throw new Error(`No AI model was available (status ${lastStatus})`);
}

module.exports = { generateChatReply };
