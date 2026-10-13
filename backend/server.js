const express = require("express");
const helmet = require("helmet");
const path = require("path");
const { Pool } = require("pg");
const { generateChatReply } = require("./chat-agent");

const app = express();
const port = process.env.PORT || 3000;

app.use(helmet());
app.use(express.json({ limit: "20kb" }));
app.use((req, res, next) => {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET,POST,OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  if (req.method === "OPTIONS") {
    return res.sendStatus(204);
  }
  next();
});

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.DATABASE_SSL === "true"
    ? { rejectUnauthorized: true }
    : false
});

app.get("/health", async (req, res) => {
  try {
    await pool.query("SELECT 1");
    res.json({
      status: "ok",
      service: "Internal Frontier API",
      database: "connected"
    });
  } catch (error) {
    console.error("Database health check failed");
    res.status(503).json({
      status: "error",
      message: "Database unavailable"
    });
  }
});

app.post("/api/chat", async (req, res) => {
  const message = typeof req.body?.message === "string" ? req.body.message.trim() : "";

  if (!message || message.length > 500) {
    return res.status(400).json({
      ok: false,
      error: "A message between 1 and 500 characters is required."
    });
  }

  try {
    const reply = await generateChatReply(message);
    return res.json({ ok: true, reply });
  } catch (error) {
    console.error("Chat request failed");
    const status = process.env.AI_GATEWAY_API_KEY ? 502 : 503;
    return res.status(status).json({
      ok: false,
      error: status === 503 ? "The AI assistant is not configured." : "The AI assistant is temporarily unavailable."
    });
  }
});

app.use(express.static(path.join(__dirname, "public")));

app.get("/", (req, res) => {
  res.sendFile(path.join(__dirname, "public", "index.html"));
});

app.get(["/api", "/api/"], (req, res) => {
  res.json({
    message: "Internal Frontier API",
    health: "/health",
    chat: "/api/chat"
  });
});

if (require.main === module && !process.env.VERCEL) {
  app.listen(port, "0.0.0.0", () => {
    console.log(`Internal Frontier API listening on ${port}`);
  });
}

module.exports = app;
