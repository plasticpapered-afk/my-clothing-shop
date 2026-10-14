const express = require("express");
const helmet = require("helmet");
const path = require("path");
const db = require("./db");
const adminRouter = require("./admin");
const { generateChatReply } = require("./chat-agent");

const app = express();
const port = process.env.PORT || 3000;

// Same security defaults as before, plus permission to load product images
// hosted over HTTPS (for back office images that live outside this app).
app.use(
  helmet({
    contentSecurityPolicy: {
      directives: {
        ...helmet.contentSecurityPolicy.getDefaultDirectives(),
        "img-src": ["'self'", "data:", "https:"]
      }
    }
  })
);
app.use(express.json({ limit: "20kb" }));
app.use((req, res, next) => {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET,POST,OPTIONS,PATCH,PUT,DELETE");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  if (req.method === "OPTIONS") {
    return res.sendStatus(204);
  }
  next();
});

app.get("/health", async (req, res) => {
  try {
    await db.query("SELECT 1");
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

// Public product catalogue used by the storefront. The storefront keeps its
// built-in products as a fallback when this endpoint is unavailable.
app.get("/api/products", async (req, res) => {
  if (!db.isConfigured()) {
    return res.status(503).json({ ok: false, error: "Catalogue is not available." });
  }
  try {
    await db.ensureSchema();
    const products = await db.query(
      "SELECT id, name, description, category, label, image_url, base_price, position FROM products WHERE active ORDER BY position, id"
    );
    const variants = await db.query(
      `SELECT v.id, v.product_id, v.size, v.colour, v.price, v.active
       FROM product_variants v
       JOIN products p ON p.id = v.product_id
       WHERE p.active AND v.active
       ORDER BY v.id`
    );
    const byProduct = new Map();
    for (const variant of variants.rows) {
      if (!byProduct.has(variant.product_id)) byProduct.set(variant.product_id, []);
      byProduct.get(variant.product_id).push(variant);
    }
    res.json({
      ok: true,
      products: products.rows.map((product) => ({
        id: product.id,
        name: product.name,
        description: product.description,
        category: product.category,
        label: product.label,
        image_url: product.image_url,
        position: product.position,
        price: product.base_price === null ? null : Number(product.base_price),
        variants: (byProduct.get(product.id) || []).map((variant) => ({
          id: variant.id,
          size: variant.size,
          colour: variant.colour,
          price: variant.price === null ? null : Number(variant.price)
        }))
      }))
    });
  } catch (error) {
    console.error("Catalogue request failed:", error.message);
    res.status(503).json({ ok: false, error: "Catalogue is not available." });
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
    const status = (process.env.GEMINI_API_KEY || process.env.AI_GATEWAY_API_KEY) ? 502 : 503;
    return res.status(status).json({
      ok: false,
      error: status === 503 ? "The AI assistant is not configured." : `The AI assistant is temporarily unavailable. (${(error && error.message) || "unknown error"})`
    });
  }
});

app.use(express.static(path.join(__dirname, "public")));

app.get("/", (req, res) => {
  res.sendFile(path.join(__dirname, "public", "index.html"));
});

// Back office API and page.
app.use(adminRouter);

app.get(["/api", "/api/"], (req, res) => {
  res.json({
    message: "Internal Frontier API",
    health: "/health",
    chat: "/api/chat",
    products: "/api/products",
    admin: "/admin"
  });
});

if (require.main === module && !process.env.VERCEL) {
  app.listen(port, "0.0.0.0", () => {
    console.log(`Internal Frontier API listening on ${port}`);
  });
}

module.exports = app;
