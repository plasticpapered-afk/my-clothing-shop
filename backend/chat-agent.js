const gatewayUrl = "https://ai-gateway.vercel.sh/v1/chat/completions";

async function generateChatReply(message) {
  const apiKey = process.env.AI_GATEWAY_API_KEY;
  if (!apiKey) {
    throw new Error("AI_GATEWAY_API_KEY is not configured");
  }

  const response = await fetch(gatewayUrl, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`
    },
    body: JSON.stringify({
      model: process.env.AI_GATEWAY_MODEL || "openai/gpt-4o-mini",
      temperature: 0.7,
      messages: [
        {
          role: "system",
          content: "You are the Internal Frontier shopping assistant. Help customers with the current collection, sizing, styling, and WhatsApp enquiries. Keep answers friendly, concise, and brand-specific to Internal Frontier. The collection includes the Silent Wars Graphic Tee, Black Frontier Tracksuit, White Frontier Tracksuit, and Frontier Jersey. Encourage customers to message on WhatsApp for exact pricing and stock confirmation."
        },
        { role: "user", content: message }
      ]
    })
  });

  if (!response.ok) {
    throw new Error(`AI Gateway request failed with status ${response.status}`);
  }

  const data = await response.json();
  const reply = data?.choices?.[0]?.message?.content?.trim();
  if (!reply) {
    throw new Error("AI Gateway returned an empty reply");
  }

  return reply;
}

module.exports = { generateChatReply };
