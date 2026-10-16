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
app.use("/api/payments/paynow/callback", express.urlencoded({ extended: false, limit: "20kb" }));
app.use("/api/admin/upload", express.json({ limit: "5mb" }));
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
      service: "Dust Patrol API",
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

// Product photos uploaded from staff devices.
app.get("/api/media/:id", async (req, res) => {
  try {
    const id = Number.parseInt(req.params.id, 10);
    if (!Number.isInteger(id) || id < 1 || id > 1000000000) return res.status(404).end();
    const { rows } = await db.query("SELECT mime, data FROM media WHERE id = $1", [id]);
    if (!rows[0]) return res.status(404).end();
    res.setHeader("Content-Type", rows[0].mime);
    res.setHeader("Cache-Control", "public, max-age=31536000, immutable");
    res.send(Buffer.from(rows[0].data, "base64"));
  } catch (error) {
    res.status(404).end();
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

// Printable receipts. Each receipt link carries a private token so
// order references alone cannot be used to read other people's orders.
const { receiptToken } = require("./auth");

function receiptHtml(order, items) {
  const paid = order.payment_status === "paid";
  const methodLabels = { ecocash: "EcoCash", innbucks: "InnBucks", cash: "Cash on delivery", bank_transfer: "Bank transfer", other: "Other" };
  const method = methodLabels[order.payment_method] || "Other";
  const rows = items.map((item) => `
      <tr><td>${item.product_name}${item.size || item.colour ? ` <span class="dim">(${[item.size, item.colour].filter(Boolean).join(" / ")})</span>` : ""}</td>
      <td class="num">${item.quantity}</td>
      <td class="num">$${Number(item.unit_price).toFixed(2)}</td>
      <td class="num">$${(Number(item.unit_price) * item.quantity).toFixed(2)}</td></tr>`).join("");
  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<meta name="robots" content="noindex">
<title>Receipt ${order.reference} | Dust Patrol</title>
<link rel="icon" href="/favicon.svg" type="image/svg+xml">
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600&family=Sora:wght@600;700;800&display=swap" rel="stylesheet">
<link rel="stylesheet" href="/pages.css">
</head>
<body>
<div class="sheet">
  <div class="brand">DUST PATROL</div>
  <p class="tagline">KHAR-ECE Consortium · Official receipt</p>
  <h1>Receipt</h1>
  <p class="ref">Reference ${order.reference} · ${new Date(order.created_at).toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric" })}</p>
  <table>
    <thead><tr><th>Item</th><th class="num">Qty</th><th class="num">Unit</th><th class="num">Total</th></tr></thead>
    <tbody>${rows}
      <tr class="total-row"><td>Total (USD)</td><td></td><td></td><td class="num">$${Number(order.total).toFixed(2)}</td></tr>
    </tbody>
  </table>
  <p>Payment method: <strong>${method}</strong></p>
  <span class="status ${paid ? "paid" : "unpaid"}">${paid ? "Paid" : "Payment pending"}</span>
  <p class="thanks">Thank you for choosing Dust Patrol Cleaning Services. Keep this receipt as proof of your booking. For anything about your booking, message us on WhatsApp.</p>
  <button class="print-btn" type="button" id="print-btn">Print / save as PDF</button>
</div>
<script src="/receipt.js"></script>
</body>
</html>`;
}

app.get("/receipt/:reference", async (req, res) => {
  try {
    const reference = String(req.params.reference || "").slice(0, 40);
    const token = String(req.query.t || "");
    if (!reference || token !== receiptToken(reference)) {
      return res.status(404).send("Receipt not found.");
    }
    const found = await db.query("SELECT * FROM orders WHERE reference = $1", [reference]);
    const order = found.rows[0];
    if (!order) return res.status(404).send("Receipt not found.");
    const items = await db.query("SELECT * FROM order_items WHERE order_id = $1 ORDER BY id", [order.id]);
    res.setHeader("Content-Type", "text/html; charset=utf-8");
    res.send(receiptHtml(order, items.rows));
  } catch (error) {
    console.error("Receipt error:", error.message);
    res.status(404).send("Receipt not found.");
  }
});

// Payment status page: the customer's own page showing whether their
// EcoCash / InnBucks payment is pending, approved or cancelled. Kept live
// by polling, and offers a "send the prompt again" button for weak signal.
const { receiptToken: statusToken } = require("./auth");

function statusHtml(order) {
  const methodLabels = { ecocash: "EcoCash", innbucks: "InnBucks", cash: "Cash on delivery", bank_transfer: "Bank transfer", other: "Other" };
  const method = methodLabels[order.payment_method] || "Other";
  const online = order.payment_method === "ecocash" || order.payment_method === "innbucks";
  const statusOrder = order.payment_status === "paid" ? "paid" : order.payment_status;
  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<meta name="robots" content="noindex">
<title>Booking ${order.reference} | Dust Patrol</title>
<link rel="icon" href="/favicon.svg" type="image/svg+xml">
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600&family=Sora:wght@600;700;800&display=swap" rel="stylesheet">
<link rel="stylesheet" href="/pages.css">
</head>
<body>
<div class="sheet">
  <a class="brand" href="/">DUST PATROL</a>
  <p class="tagline">KHAR-ECE Consortium</p>
  <h1>Payment status</h1>
  <p class="ref">Order ${order.reference}</p>
  <p class="summary">Total <strong>$${Number(order.total).toFixed(2)}</strong> · paying by <strong>${method}</strong></p>
  <span class="badge ${statusOrder === "paid" ? "approved" : statusOrder === "unpaid" ? "pending" : "cancelled"}" id="status-badge">
    ${statusOrder === "paid" ? "✓ Payment approved" : statusOrder === "unpaid" ? "⏳ Payment pending" : "Payment " + statusOrder}
  </span>
  <div class="error-box" id="error-box"></div>
  <p class="instructions" id="instructions"></p>
  <p class="code" id="auth-code" hidden></p>
  <p class="expiry" id="auth-expiry" hidden></p>
  <a class="btn" id="innbucks-open" hidden href="#">Open in InnBucks app</a>
  <button class="btn light" id="retry-btn" hidden type="button">I didn't get the prompt — send it again</button>
  <a class="btn light" id="whatsapp-btn" target="_blank" rel="noopener noreferrer" href="#">Message us on WhatsApp</a>
  <a class="btn light" id="receipt-link" href="/receipt/${order.reference}?t=${statusToken(order.reference)}">View receipt</a>
  <p class="note" id="poll-note">This page updates itself.</p>
</div>
<script src="/status.js"
  data-reference="${order.reference}"
  data-method="${order.payment_method}"
  data-online="${online ? "true" : "false"}"
  data-total="${Number(order.total).toFixed(2)}"></script>
</body>
</html>`;
}

app.get("/status/:reference", async (req, res) => {
  try {
    const reference = String(req.params.reference || "").slice(0, 40);
    const token = String(req.query.t || "");
    if (!reference || token !== statusToken(reference)) {
      return res.status(404).send("Order not found.");
    }
    const found = await db.query("SELECT * FROM orders WHERE reference = $1", [reference]);
    const order = found.rows[0];
    if (!order) return res.status(404).send("Order not found.");
    res.setHeader("Content-Type", "text/html; charset=utf-8");
    res.send(statusHtml(order));
  } catch (error) {
    console.error("Status page error:", error.message);
    res.status(404).send("Order not found.");
  }
});

// Back office API and page.
app.use(adminRouter);

app.get(["/api", "/api/"], (req, res) => {
  res.json({
    message: "Dust Patrol API",
    health: "/health",
    chat: "/api/chat",
    products: "/api/products",
    admin: "/admin"
  });
});

if (require.main === module && !process.env.VERCEL) {
  app.listen(port, "0.0.0.0", () => {
    console.log(`Dust Patrol API listening on ${port}`);
  });
}

module.exports = app;
