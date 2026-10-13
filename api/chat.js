const { generateChatReply } = require("../backend/chat-agent");

module.exports = async function chatHandler(req, res) {
  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    return res.status(405).json({ ok: false, error: "Method not allowed." });
  }

  const message = typeof req.body?.message === "string" ? req.body.message.trim() : "";
  if (!message || message.length > 500) {
    return res.status(400).json({
      ok: false,
      error: "A message between 1 and 500 characters is required."
    });
  }

  try {
    const reply = await generateChatReply(message);
    return res.status(200).json({ ok: true, reply });
  } catch {
    const status = process.env.AI_GATEWAY_API_KEY ? 502 : 503;
    return res.status(status).json({
      ok: false,
      error: status === 503 ? "The AI assistant is not configured." : "The AI assistant is temporarily unavailable."
    });
  }
};
