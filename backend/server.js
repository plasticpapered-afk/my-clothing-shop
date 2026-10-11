const express = require("express");
const helmet = require("helmet");
const path = require("path");
const { Pool } = require("pg");
const { generateChatReply } = require("./chat-agent");

const app = express();
const port = process.env.PORT || 3000;
const storefrontRoot = path.join(__dirname, "..");

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

app.post("/api/chat", (req, res) => {
  const message = typeof req.body?.message === "string" ? req.body.message.trim() : "";

  if (!message) {
    return res.status(400).json({
      ok: false,
      error: "A message is required."
    });
  }

  return res.json({
    ok: true,
    reply: generateChatReply(message)
  });
});

app.use(express.static(storefrontRoot, { index: false }));

app.get("/", (req, res) => {
  res.sendFile(path.join(storefrontRoot, "index.html"));
});

app.get("/api", (req, res) => {
  res.json({
    message: "Internal Frontier API",
    health: "/health",
    chat: "/api/chat"
  });
});

app.listen(port, "0.0.0.0", () => {
  console.log(`Internal Frontier API listening on ${port}`);
});
