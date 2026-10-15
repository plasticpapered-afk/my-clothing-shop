// Back office API. All endpoints live under /api/admin/... and are protected
// by staff auth except setup/login/logout. The router also serves the admin
// single page app at /admin.

const express = require("express");
const path = require("path");
const db = require("./db");
const paynow = require("./paynow");
const { receiptToken } = require("./auth");
const {
  createToken,
  setAuthCookie,
  clearAuthCookie,
  getStaffIdFromRequest,
  hashPassword,
  verifyPassword,
  validPassword,
  EMAIL_PATTERN
} = require("./auth");

const router = express.Router();

const CATEGORY_OPTIONS = ["tops", "sets", "jerseys", "accessories"];
const ORDER_STATUSES = ["new", "confirmed", "dispatched", "delivered", "cancelled"];
const NEXT_STATUS = {
  new: ["confirmed", "cancelled"],
  confirmed: ["dispatched", "cancelled"],
  dispatched: ["delivered", "cancelled"],
  delivered: [],
  cancelled: ["new"]
};
const PAYMENT_METHODS = ["ecocash", "innbucks", "cash", "bank_transfer", "other"];

function bad(res, message) {
  return res.status(400).json({ ok: false, error: message });
}

function text(value) {
  return typeof value === "string" ? value.trim() : "";
}

function money(value) {
  if (value === null || value === undefined || value === "") return null;
  const amount = Number(value);
  if (!Number.isFinite(amount) || amount < 0 || amount > 100000000) return undefined; // invalid
  return Math.round(amount * 100) / 100;
}

function int(value, fallback = 0) {
  const parsed = Number.parseInt(value, 10);
  return Number.isInteger(parsed) ? parsed : fallback;
}

async function audit(action, staffId, details, client) {
  const run = client || db;
  try {
    await run.query(
      "INSERT INTO audit_log (staff_id, action, details) VALUES ($1, $2, $3)",
      [staffId, action, typeof details === "string" ? details : JSON.stringify(details) || ""]
    );
  } catch (error) {
    console.error("Audit write failed", error.message);
  }
}

async function requireDatabase(req, res, next) {
  if (!db.isConfigured()) {
    return res.status(503).json({ ok: false, error: "The back office needs DATABASE_URL to be configured.", code: "no_database" });
  }
  try {
    await db.ensureSchema();
    next();
  } catch (error) {
    console.error("Schema init failed:", error.message);
    return res.status(503).json({ ok: false, error: "The back office database is not reachable.", code: "database_unreachable" });
  }
}

async function requireStaff(req, res, next) {
  const id = getStaffIdFromRequest(req);
  if (!id) return res.status(401).json({ ok: false, error: "Please sign in.", code: "unauthenticated" });
  try {
    const { rows } = await db.query(
      "SELECT id, email, name, role, active FROM staff WHERE id = $1",
      [id]
    );
    const staff = rows[0];
    if (!staff || !staff.active) return res.status(401).json({ ok: false, error: "Please sign in.", code: "unauthenticated" });
    req.staff = staff;
    next();
  } catch (error) {
    next(error);
  }
}

function requireAdmin(req, res, next) {
  if (req.staff.role !== "admin") {
    return res.status(403).json({ ok: false, error: "Only an administrator can do that." });
  }
  next();
}

function requestBaseUrl(req) {
  const host = String(req.headers.host || "");
  const local = host.startsWith("127.0.0.1") || host.startsWith("localhost");
  return `${local ? "http" : "https"}://${host}`;
}

// Applies a status update from Paynow (webhook or manual poll) to an order.
// Fully idempotent: recording the same paid status twice never double-counts.
async function applyPaynowUpdate(reference, update) {
  const found = await db.query("SELECT * FROM orders WHERE reference = $1", [String(reference || "")]);
  const order = found.rows[0];
  if (!order) return { ok: false, error: "Order not found." };
  const state = paynow.normalizeStatus(update.status);

  if (state === "paid" && update.signed === false) {
    console.warn("Ignored an unsigned paid confirmation for order", order.reference);
    return { ok: true, state: "pending" };
  }
  if (state === "paid") {
    if (!paynow.MOBILE_METHODS.includes(order.payment_method)) {
      return { ok: false, error: "This order is not a Paynow mobile-money order." };
    }
    if (!paynow.amountMatches(update.amount, order.total)) {
      return { ok: false, error: "Paynow's confirmed amount does not match the order total." };
    }
    const paymentRef = String(update.paynowreference || "").trim();
    if (!paymentRef) {
      return { ok: false, error: "Paynow's confirmation is missing its transaction reference." };
    }

    await db.withTransaction(async (client) => {
      const existing = await client.query(
        "SELECT id FROM payments WHERE order_id = $1 AND reference = $2",
        [order.id, paymentRef]
      );
      if (existing.rows.length === 0) {
        await client.query(
          "INSERT INTO payments (order_id, method, reference, amount, recorded_by) VALUES ($1, $2, $3, $4, NULL)",
          [order.id, order.payment_method || "other", paymentRef, order.total]
        );
      }
      await client.query(
        "UPDATE orders SET payment_status = 'paid', paynow_reference = $1, paynow_status = $2, updated_at = now() WHERE id = $3",
        [update.paynowreference || order.paynow_reference, update.status, order.id]
      );
      await client.query("INSERT INTO audit_log (staff_id, action, details) VALUES (NULL, $1, $2)", [
        "paynow_update",
        `order ${order.reference}: online payment confirmed (${update.status})`
      ]);
    });
    return { ok: true, state: "paid" };
  }

  await db.query(
    "UPDATE orders SET paynow_reference = $1, paynow_status = $2, updated_at = now() WHERE id = $3",
    [update.paynowreference || order.paynow_reference, update.status, order.id]
  );
  return { ok: true, state };
}

function staffView(staff) {
  return { id: staff.id, email: staff.email, name: staff.name, role: staff.role, active: staff.active };
}

// ---------- Session ----------

router.get("/api/admin/me", requireDatabase, async (req, res) => {
  const id = getStaffIdFromRequest(req);
  if (!id) {
    const { rows } = await db.query("SELECT COUNT(*)::int AS count FROM staff");
    return res.json({ ok: true, status: rows[0].count === 0 ? "setup_required" : "login" });
  }
  const { rows } = await db.query("SELECT id, email, name, role, active FROM staff WHERE id = $1", [id]);
  const staff = rows[0];
  if (!staff || !staff.active) return res.json({ ok: true, status: "login" });
  res.json({ ok: true, status: "ok", staff: staffView(staff) });
});

router.post("/api/admin/setup", requireDatabase, async (req, res) => {
  const { rows } = await db.query("SELECT COUNT(*)::int AS count FROM staff");
  if (rows[0].count > 0) {
    return bad(res, "The back office is already set up. Please sign in instead.");
  }
  const name = text(req.body && req.body.name);
  const email = text(req.body && req.body.email).toLowerCase();
  const password = req.body && req.body.password;
  if (name.length < 2) return bad(res, "Enter your name.");
  if (!EMAIL_PATTERN.test(email)) return bad(res, "Enter a valid email address.");
  if (!validPassword(password)) return bad(res, "Choose a password of at least 8 characters.");
  const passwordHash = await hashPassword(password);
  const inserted = await db.query(
    "INSERT INTO staff (email, name, password_hash, role) VALUES ($1, $2, $3, 'admin') RETURNING id",
    [email, name, passwordHash]
  );
  await audit("setup", inserted.rows[0].id, `First administrator ${email} created`);
  setAuthCookie(res, createToken(inserted.rows[0].id));
  res.json({ ok: true, staff: { id: inserted.rows[0].id, name, email, role: "admin", active: true } });
});

router.post("/api/admin/login", requireDatabase, async (req, res) => {
  const email = text(req.body && req.body.email).toLowerCase();
  const password = req.body && req.body.password;
  if (!email || !password) return bad(res, "Enter your email and password.");
  const { rows } = await db.query("SELECT * FROM staff WHERE email = $1", [email]);
  const staff = rows[0];
  if (!staff || !staff.active || !(await verifyPassword(password, staff.password_hash))) {
    await audit("login_failed", null, `Failed sign-in for ${email}`);
    return res.status(401).json({ ok: false, error: "Email or password is incorrect." });
  }
  await audit("login", staff.id, `${email} signed in`);
  setAuthCookie(res, createToken(staff.id));
  res.json({ ok: true, staff: staffView(staff) });
});

router.post("/api/admin/logout", (req, res) => {
  clearAuthCookie(res);
  res.json({ ok: true });
});

// ---------- Dashboard ----------

router.get("/api/admin/stats", requireDatabase, requireStaff, async (req, res) => {
  const [productCount, variantTotals, orderCounts, revenue, recentOrders, lowStock] = await Promise.all([
    db.query("SELECT COUNT(*)::int AS count FROM products WHERE active"),
    db.query("SELECT COALESCE(SUM(stock), 0)::int AS stock, COUNT(*)::int AS variants FROM product_variants WHERE active"),
    db.query("SELECT status, COUNT(*)::int AS count FROM orders GROUP BY status"),
    db.query("SELECT COALESCE(SUM(total), 0)::numeric AS revenue FROM orders WHERE payment_status = 'paid'"),
    db.query(
      `SELECT o.id, o.reference, o.customer_name, o.customer_phone, o.status, o.payment_status, o.total,
              (SELECT COUNT(*)::int FROM order_items i WHERE i.order_id = o.id) AS item_count
       FROM orders o ORDER BY o.created_at DESC LIMIT 8`
    ),
    db.query(
      `SELECT v.id, v.size, v.colour, v.stock, p.name AS product_name, p.id AS product_id
       FROM product_variants v JOIN products p ON p.id = v.product_id
       WHERE v.active AND p.active AND v.stock <= 2
       ORDER BY v.stock ASC, p.name LIMIT 8`
    )
  ]);

  const statusCounts = {};
  for (const row of orderCounts.rows) statusCounts[row.status] = row.count;

  res.json({
    ok: true,
    stats: {
      products: productCount.rows[0].count,
      stock: variantTotals.rows[0].stock,
      variants: variantTotals.rows[0].variants,
      orders: statusCounts,
      revenuePaid: Number(revenue.rows[0].revenue || 0),
      paynowConfigured: paynow.isConfigured(),
      recentOrders: recentOrders.rows,
      lowStock: lowStock.rows
    }
  });
});

// ---------- Products ----------

async function productResponse(id) {
  const { rows } = await db.query("SELECT * FROM products WHERE id = $1", [id]);
  const product = rows[0];
  if (!product) return null;
  const variants = await db.query(
    "SELECT id, size, colour, stock, price, active FROM product_variants WHERE product_id = $1 ORDER BY id",
    [id]
  );
  product.variants = variants.rows;
  return product;
}

router.get("/api/admin/products", requireDatabase, requireStaff, async (req, res) => {
  const { rows } = await db.query("SELECT * FROM products ORDER BY position, id");
  const variants = await db.query(
    `SELECT id, product_id, size, colour, stock, price, active FROM product_variants
     ORDER BY product_id, CASE WHEN size = '' THEN 1 ELSE 0 END, id`
  );
  const byProduct = new Map();
  for (const variant of variants.rows) {
    if (!byProduct.has(variant.product_id)) byProduct.set(variant.product_id, []);
    byProduct.get(variant.product_id).push(variant);
  }
  for (const product of rows) {
    product.variants = byProduct.get(product.id) || [];
    product.stock = product.variants.filter((v) => v.active).reduce((sum, v) => sum + v.stock, 0);
  }
  res.json({ ok: true, products: rows });
});

router.post("/api/admin/products", requireDatabase, requireStaff, async (req, res) => {
  const body = req.body || {};
  const name = text(body.name);
  if (name.length < 2) return bad(res, "Give the product a name.");
  const category = CATEGORY_OPTIONS.includes(body.category) ? body.category : "tops";
  const price = money(body.base_price);
  if (price === undefined) return bad(res, "Enter a valid price, or leave it empty for price on request.");
  const inserted = await db.query(
    `INSERT INTO products (name, description, category, label, image_url, base_price, position)
     VALUES ($1, $2, $3, $4, $5, $6, (SELECT COALESCE(MAX(position), 0) + 1 FROM products)) RETURNING id`,
    [name, text(body.description), body.category, text(body.label), text(body.image_url), price]
  );
  const productId = inserted.rows[0].id;
  const sizes = Array.isArray(body.sizes)
    ? body.sizes.map((size) => text(size)).filter(Boolean).slice(0, 30)
    : [];
  for (const size of sizes) {
    await db.query(
      `INSERT INTO product_variants (product_id, size, colour, stock, price)
       VALUES ($1, $2, '', 0, NULL) ON CONFLICT (product_id, size, colour) DO NOTHING`,
      [productId, size]
    );
  }
  await audit("product_created", req.staff.id, `${name} (${productId})`, null);
  res.json({ ok: true, product: await productResponse(productId) });
});

router.put("/api/admin/products/:id", requireDatabase, requireStaff, async (req, res) => {
  const id = int(req.params.id);
  const existing = await db.query("SELECT * FROM products WHERE id = $1", [id]);
  if (!existing.rows[0]) return bad(res, "Product not found.");
  const body = req.body || {};
  const price = money(body.base_price);
  if (price === undefined) return bad(res, "Enter a valid price, or leave it empty for price on request.");
  await db.query(
    `UPDATE products SET name = $1, description = $2, category = $3, label = $4,
     image_url = $5, base_price = $6, active = $7, updated_at = now() WHERE id = $8`,
    [
      text(body.name) || existing.rows[0].name,
      text(body.description),
      body.category && CATEGORY_OPTIONS.includes(body.category) ? body.category : existing.rows[0].category,
      text(body.label),
      text(body.image_url),
      price,
      body.active === false ? false : true,
      id
    ]
  );
  await audit("product_updated", req.staff.id, `product ${id}`, null);
  res.json({ ok: true, product: await productResponse(id) });
});

// Removing a product takes it off the shop but keeps its order history intact.
router.delete("/api/admin/products/:id", requireDatabase, requireStaff, async (req, res) => {
  const id = int(req.params.id);
  await db.query("UPDATE products SET active = false, updated_at = now() WHERE id = $1", [id]);
  await audit("product_removed", req.staff.id, `product ${id}`, null);
  res.json({ ok: true });
});

router.post("/api/admin/products/:id/variants", requireDatabase, requireStaff, async (req, res) => {
  const productId = int(req.params.id);
  const existing = await db.query("SELECT id FROM products WHERE id = $1", [productId]);
  if (!existing.rows[0]) return bad(res, "Product not found.");
  const body = req.body || {};
  const size = text(body.size);
  const colour = text(body.colour);
  if (!size && !colour) return bad(res, "Give the variant a size or a colour.");
  const price = money(body.price);
  if (price === undefined) return bad(res, "Enter a valid variant price, or leave it empty to use the product price.");
  const stock = int(body.stock, 0);
  if (stock < 0 || stock > 100000) return bad(res, "Enter a valid stock count.");
  const upserted = await db.query(
    `INSERT INTO product_variants (product_id, size, colour, stock, price)
     VALUES ($1, $2, $3, $4, $5)
     ON CONFLICT (product_id, size, colour)
     DO UPDATE SET stock = $4, price = $5, active = true
     RETURNING id`,
    [productId, size, colour, stock, price]
  );
  await audit("variant_created", req.staff.id, `variant ${upserted.rows[0].id} for product ${productId}`, null);
  res.json({ ok: true, product: await productResponse(productId) });
});

router.put("/api/admin/variants/:id", requireDatabase, requireStaff, async (req, res) => {
  const id = int(req.params.id);
  const existing = await db.query("SELECT product_id, price FROM product_variants WHERE id = $1", [id]);
  if (!existing.rows[0]) return bad(res, "Variant not found.");
  const body = req.body || {};
  // No price in the request means "keep the current one", so stock-only
  // saves work. An empty value means "use the product price".
  let price;
  if (body.price === undefined) {
    price = existing.rows[0].price === null ? null : Number(existing.rows[0].price);
  } else if (body.price === null || body.price === "") {
    price = null;
  } else {
    price = money(body.price);
    if (price === undefined) return bad(res, "Enter a valid variant price, or leave it empty to use the product price.");
  }
  const stock = int(body.stock, 0);
  if (stock < 0 || stock > 100000) return bad(res, "Enter a valid stock count.");
  await db.query(
    "UPDATE product_variants SET stock = $1, price = $2, active = $3 WHERE id = $4",
    [stock, price, body.active === false ? false : true, id]
  );
  await audit("variant_updated", req.staff.id, `variant ${id}`, null);
  res.json({ ok: true, product: await productResponse(existing.rows[0].product_id) });
});

router.delete("/api/admin/variants/:id", requireDatabase, requireStaff, async (req, res) => {
  const id = int(req.params.id);
  const existing = await db.query("SELECT product_id FROM product_variants WHERE id = $1", [id]);
  if (!existing.rows[0]) return bad(res, "Variant not found.");
  await db.query("UPDATE product_variants SET active = false, stock = 0 WHERE id = $1", [id]);
  await audit("variant_removed", req.staff.id, `variant ${id}`, null);
  res.json({ ok: true, product: await productResponse(existing.rows[0].product_id) });
});

// ---------- Customers ----------

router.get("/api/admin/customers", requireDatabase, requireStaff, async (req, res) => {
  const search = text(req.query.q).toLowerCase();
  const like = `%${search}%`;
  const { rows } = await db.query(
    `SELECT c.*, (SELECT COUNT(*)::int FROM orders o WHERE o.customer_id = c.id) AS order_count,
            (SELECT COALESCE(SUM(o.total), 0)::numeric FROM orders o WHERE o.customer_id = c.id AND o.payment_status = 'paid') AS lifetime_value
     FROM customers c
     WHERE ($1 = '' OR LOWER(c.name) LIKE $1 OR c.phone LIKE $1 OR LOWER(COALESCE(c.email, '')) LIKE $1)
     ORDER BY c.name`,
    [like]
  );
  res.json({ ok: true, customers: rows });
});

router.post("/api/admin/customers", requireDatabase, requireStaff, async (req, res) => {
  const body = req.body || {};
  const name = text(body.name);
  const phone = text(body.phone);
  if (name.length < 2) return bad(res, "Give the customer a name.");
  if (phone.replace(/\D/g, "").length < 6) return bad(res, "Enter a valid phone number.");
  const existing = await db.query("SELECT id FROM customers WHERE phone = $1", [phone]);
  if (existing.rows[0]) return bad(res, "A customer with that phone number already exists.");
  const inserted = await db.query(
    "INSERT INTO customers (name, phone, email, notes) VALUES ($1, $2, $3, $4) RETURNING *",
    [name, phone, text(body.email) || null, text(body.notes)]
  );
  await audit("customer_created", req.staff.id, `${name} (${phone})`, null);
  res.json({ ok: true, customer: inserted.rows[0] });
});

router.put("/api/admin/customers/:id", requireDatabase, requireStaff, async (req, res) => {
  const id = int(req.params.id);
  const existing = await db.query("SELECT * FROM customers WHERE id = $1", [id]);
  if (!existing.rows[0]) return bad(res, "Customer not found.");
  const body = req.body || {};
  const phone = text(body.phone) || existing.rows[0].phone;
  const clash = await db.query("SELECT id FROM customers WHERE phone = $1 AND id <> $2", [phone, id]);
  if (clash.rows[0]) return bad(res, "Another customer already uses that phone number.");
  const updated = await db.query(
    "UPDATE customers SET name = $1, phone = $2, email = $3, notes = $4 WHERE id = $5 RETURNING *",
    [text(body.name) || existing.rows[0].name, phone, text(body.email) || null, text(body.notes), id]
  );
  await audit("customer_updated", req.staff.id, `customer ${id}`, null);
  res.json({ ok: true, customer: updated.rows[0] });
});

// ---------- Orders ----------

function orderRow(row) {
  return {
    ...row,
    total: Number(row.total),
    paid_amount: row.paid_amount === null || row.paid_amount === undefined ? 0 : Number(row.paid_amount),
    item_count: row.item_count === undefined ? undefined : Number(row.item_count)
  };
}

router.get("/api/admin/orders", requireDatabase, requireStaff, async (req, res) => {
  const status = text(req.query.status);
  const search = text(req.query.q).toLowerCase();
  const like = `%${search}%`;
  const { rows } = await db.query(
    `SELECT o.*, (SELECT COUNT(*)::int FROM order_items i WHERE i.order_id = o.id) AS item_count,
            (SELECT COALESCE(SUM(amount), 0)::numeric FROM payments p WHERE p.order_id = o.id) AS paid_amount
     FROM orders o
     WHERE ($1 = '' OR o.status = $1)
       AND ($2 = '' OR LOWER(o.reference) LIKE $2 OR LOWER(o.customer_name) LIKE $2 OR o.customer_phone LIKE $2)
     ORDER BY o.created_at DESC
     LIMIT 200`,
    [ORDER_STATUSES.includes(status) ? status : "", like]
  );
  res.json({ ok: true, orders: rows.map(orderRow) });
});

router.get("/api/admin/orders/:id", requireDatabase, requireStaff, async (req, res) => {
  const id = int(req.params.id);
  const order = await db.query(
    `SELECT o.*, (SELECT COALESCE(SUM(amount), 0)::numeric FROM payments p WHERE p.order_id = o.id) AS paid_amount
     FROM orders o WHERE o.id = $1`,
    [id]
  );
  if (!order.rows[0]) return bad(res, "Order not found.");
  const items = await db.query("SELECT * FROM order_items WHERE order_id = $1 ORDER BY id", [id]);
  const payments = await db.query(
    `SELECT p.*, s.name AS recorded_by_name FROM payments p
     LEFT JOIN staff s ON s.id = p.recorded_by WHERE p.order_id = $1 ORDER BY p.id`,
    [id]
  );
  res.json({
    ok: true,
    order: {
      ...orderRow(order.rows[0]),
      items: items.rows.map((item) => ({ ...item, unit_price: Number(item.unit_price) })),
      payments: payments.rows.map((payment) => ({ ...payment, amount: Number(payment.amount) }))
    }
  });
});

router.post("/api/admin/orders", requireDatabase, requireStaff, async (req, res) => {
  const body = req.body || {};
  const items = Array.isArray(body.items) ? body.items : [];
  if (items.length === 0) return bad(res, "Add at least one item to the order.");

  try {
    const created = await db.withTransaction(async (client) => {
      // 1. Resolve the customer (existing by id, existing by phone, or new).
      let customerId = null;
      let customerName = "";
      let customerPhone = "";
      if (body.customer_id) {
        const found = await client.query("SELECT * FROM customers WHERE id = $1", [int(body.customer_id)]);
        if (!found.rows[0]) throw Object.assign(new Error("Customer not found."), { status: 400 });
        customerId = found.rows[0].id;
        customerName = found.rows[0].name;
        customerPhone = found.rows[0].phone;
      } else {
        customerName = text(body.customer_name);
        customerPhone = text(body.customer_phone);
        if (customerName.length < 2) throw Object.assign(new Error("Give the customer a name."), { status: 400 });
        if (customerPhone.replace(/\D/g, "").length < 6) throw Object.assign(new Error("Enter a valid phone number."), { status: 400 });
        const byPhone = await client.query("SELECT * FROM customers WHERE phone = $1", [customerPhone]);
        if (byPhone.rows[0]) {
          customerId = byPhone.rows[0].id;
          customerName = byPhone.rows[0].name;
        } else {
          const inserted = await client.query(
            "INSERT INTO customers (name, phone) VALUES ($1, $2) RETURNING id",
            [customerName, customerPhone]
          );
          customerId = inserted.rows[0].id;
        }
      }

      // 2. Load variants, validate stock and prices, snapshot names and prices.
      const resolvedItems = [];
      let total = 0;
      for (const item of items) {
        const variantId = int(item.variant_id);
        const quantity = int(item.quantity, 1);
        if (quantity < 1 || quantity > 100) throw Object.assign(new Error("Quantity must be between 1 and 100."), { status: 400 });
        const variant = await client.query(
          `SELECT v.*, p.name AS product_name, p.active AS product_active, COALESCE(v.price, p.base_price) AS resolved_price
           FROM product_variants v JOIN products p ON p.id = v.product_id
           WHERE v.id = $1`,
          [variantId]
        );
        const variantRow = variant.rows[0];
        if (!variantRow || !variantRow.active || !variantRow.product_active) {
          throw Object.assign(new Error("One of the items is no longer available."), { status: 400 });
        }
        let unitPrice = variantRow.resolved_price === null ? null : Number(variantRow.resolved_price);
        if (item.unit_price !== undefined && item.unit_price !== null && item.unit_price !== "") {
          const override = money(item.unit_price);
          if (override === undefined) {
            throw Object.assign(new Error("Enter a valid price for the order item."), { status: 400 });
          }
          unitPrice = override;
        }
        if (unitPrice === null || unitPrice === undefined) {
          throw Object.assign(new Error(`Set a price for ${variantRow.product_name} first.`), { status: 400 });
        }
        if (variantRow.stock < quantity) {
          const label = [variantRow.product_name, variantRow.size, variantRow.colour].filter(Boolean).join(" / ");
          throw Object.assign(new Error(`Not enough stock for ${label}: ${variantRow.stock} left.`), { status: 400 });
        }
        total += unitPrice * quantity;
        resolvedItems.push({ variantRow, variantId, quantity, unitPrice });
      }
      total = Math.round(total * 100) / 100;

      // 3. Create the order with a unique reference.
      const order = await client.query(
        `INSERT INTO orders (reference, customer_id, customer_name, customer_phone, total, notes)
         VALUES ('IF-' || to_char(now(), 'YYMM') || '-' || lpad(nextval('order_ref_seq')::text, 4, '0'),
                 $1, $2, $3, $4, $5)
         RETURNING *`,
        [customerId, customerName, customerPhone, total, text(body.notes)]
      );
      const orderId = order.rows[0].id;

      // 4. Save items and take the stock out of inventory.
      for (const item of resolvedItems) {
        await client.query(
          `INSERT INTO order_items (order_id, product_id, variant_id, product_name, size, colour, quantity, unit_price)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
          [
            orderId,
            item.variantRow.product_id,
            item.variantId,
            item.variantRow.product_name,
            item.variantRow.size,
            item.variantRow.colour,
            item.quantity,
            item.unitPrice
          ]
        );
        await client.query(
          "UPDATE product_variants SET stock = stock - $1 WHERE id = $2 AND stock >= $1",
          [item.quantity, item.variantId]
        );
      }

      await client.query("INSERT INTO audit_log (staff_id, action, details) VALUES ($1, $2, $3)", [
        req.staff.id,
        "order_created",
        `order ${order.rows[0].reference} for ${customerName}`
      ]);
      return order.rows[0];
    });

    res.json({ ok: true, order: orderRow(created) });
  } catch (error) {
    if (error.status) return bad(res, error.message);
    throw error;
  }
});

router.patch("/api/admin/orders/:id/status", requireDatabase, requireStaff, async (req, res) => {
  const id = int(req.params.id);
  const status = text(req.body && req.body.status);
  if (!ORDER_STATUSES.includes(status)) return bad(res, "Unknown order status.");
  const existing = await db.query("SELECT * FROM orders WHERE id = $1", [id]);
  const order = existing.rows[0];
  if (!order) return bad(res, "Order not found.");
  const allowed = NEXT_STATUS[order.status] || [];
  if (status !== order.status && !allowed.includes(status)) {
    return bad(res, `An order that is ${order.status} cannot move to ${status}.`);
  }

  try {
    await db.withTransaction(async (client) => {
      // Cancelling an unshipped order puts reserved stock back.
      if (status === "cancelled" && (order.status === "new" || order.status === "confirmed")) {
        await client.query(
          `UPDATE product_variants v SET stock = v.stock + i.quantity
           FROM order_items i WHERE i.order_id = $1 AND i.variant_id = v.id`,
          [id]
        );
      }
      // Reopening a cancelled order takes the stock out again.
      if (status === "new" && order.status === "cancelled") {
        const conflict = await client.query(
          `SELECT p.name, v.size, v.colour, i.quantity, v.stock
           FROM order_items i
           JOIN product_variants v ON v.id = i.variant_id
           JOIN products p ON p.id = v.product_id
           WHERE i.order_id = $1 AND v.stock < i.quantity`,
          [id]
        );
        if (conflict.rows.length > 0) {
          const first = conflict.rows[0];
          const label = [first.name, first.size, first.colour].filter(Boolean).join(" / ");
          throw Object.assign(new Error(`Not enough stock to reopen: ${label} has ${first.stock} left.`), { status: 400 });
        }
        await client.query(
          `UPDATE product_variants v SET stock = v.stock - i.quantity
           FROM order_items i WHERE i.order_id = $1 AND i.variant_id = v.id`,
          [id]
        );
      }
      await client.query(
        "UPDATE orders SET status = $1, updated_at = now() WHERE id = $2",
        [status, id]
      );
      await client.query("INSERT INTO audit_log (staff_id, action, details) VALUES ($1, $2, $3)", [
        req.staff.id,
        "order_status",
        `order ${order.reference} -> ${status}`
      ]);
    });
    res.json({ ok: true });
  } catch (error) {
    if (error.status) return bad(res, error.message);
    throw error;
  }
});

// Recording a payment is a real money record with a method and reference.
// It cannot be done by simply flipping a status field.
router.post("/api/admin/orders/:id/payments", requireDatabase, requireStaff, async (req, res) => {
  const id = int(req.params.id);
  const body = req.body || {};
  const method = PAYMENT_METHODS.includes(body.method) ? body.method : "other";
  const amount = money(body.amount);
  if (amount === null || amount <= 0) return bad(res, "Enter a valid payment amount.");

  const existing = await db.query("SELECT * FROM orders WHERE id = $1", [id]);
  const order = existing.rows[0];
  if (!order) return bad(res, "Order not found.");

  try {
    await db.withTransaction(async (client) => {
      await client.query(
        "INSERT INTO payments (order_id, method, reference, amount, recorded_by) VALUES ($1, $2, $3, $4, $5)",
        [id, method, text(body.reference), amount, req.staff.id]
      );
      const paid = await client.query(
        "SELECT COALESCE(SUM(amount), 0)::numeric AS paid FROM payments WHERE order_id = $1",
        [id]
      );
      const isFullyPaid = Number(paid.rows[0].paid) >= Number(order.total);
      await client.query(
        "UPDATE orders SET payment_status = $1, updated_at = now() WHERE id = $2",
        [isFullyPaid ? "paid" : "partial", id]
      );
      await client.query("INSERT INTO audit_log (staff_id, action, details) VALUES ($1, $2, $3)", [
        req.staff.id,
        "payment_recorded",
        `order ${order.reference}: $${amount} via ${method}`
      ]);
    });
    res.json({ ok: true });
  } catch (error) {
    if (error.status) return bad(res, error.message);
    throw error;
  }
});

// ---------- Staff ----------

router.get("/api/admin/staff", requireDatabase, requireStaff, requireAdmin, async (req, res) => {
  const { rows } = await db.query("SELECT id, email, name, role, active, created_at FROM staff ORDER BY created_at");
  res.json({ ok: true, staff: rows });
});

router.post("/api/admin/staff", requireDatabase, requireStaff, requireAdmin, async (req, res) => {
  const body = req.body || {};
  const name = text(body.name);
  const email = text(body.email).toLowerCase();
  const role = body.role === "admin" ? "admin" : "staff";
  if (name.length < 2) return bad(res, "Give the staff member a name.");
  if (!EMAIL_PATTERN.test(email)) return bad(res, "Enter a valid email address.");
  if (!validPassword(body.password)) return bad(res, "Choose a password of at least 8 characters.");
  const existing = await db.query("SELECT id FROM staff WHERE email = $1", [email]);
  if (existing.rows[0]) return bad(res, "A staff member with that email already exists.");
  const passwordHash = await hashPassword(body.password);
  const inserted = await db.query(
    "INSERT INTO staff (email, name, password_hash, role) VALUES ($1, $2, $3, $4) RETURNING id, email, name, role, active",
    [email, name, passwordHash, role]
  );
  await audit("staff_created", req.staff.id, `${email} (${role})`, null);
  res.json({ ok: true, staff: inserted.rows[0] });
});

router.put("/api/admin/staff/:id", requireDatabase, requireStaff, requireAdmin, async (req, res) => {
  const id = int(req.params.id);
  const existing = await db.query("SELECT * FROM staff WHERE id = $1", [id]);
  const member = existing.rows[0];
  if (!member) return bad(res, "Staff member not found.");
  const body = req.body || {};
  const updates = [];
  const params = [];

  if (body.role !== undefined) {
    if (id === req.staff.id) return bad(res, "You cannot change your own role.");
    updates.push(`role = $${params.push(body.role === "admin" ? "admin" : "staff")}`);
  }
  if (body.active !== undefined) {
    if (id === req.staff.id) return bad(res, "You cannot deactivate your own account.");
    updates.push(`active = $${params.push(body.active === true)}`);
  }
  if (body.password !== undefined && body.password !== "") {
    if (!validPassword(body.password)) return bad(res, "Choose a password of at least 8 characters.");
    const passwordHash = await hashPassword(body.password);
    updates.push(`password_hash = $${params.push(passwordHash)}`);
  }
  if (updates.length === 0) return bad(res, "Nothing to update.");
  await db.query(`UPDATE staff SET ${updates.join(", ")} WHERE id = $${params.push(id)}`, params);
  await audit("staff_updated", req.staff.id, `${member.email}: ${updates.length} change(s)`, null);
  const updated = await db.query("SELECT id, email, name, role, active FROM staff WHERE id = $1", [id]);
  res.json({ ok: true, staff: updated.rows[0] });
});

// ---------- Photos ----------

const MAX_UPLOAD_BYTES = 3 * 1024 * 1024;
const PHOTO_PATTERN = /^data:(image\/(?:jpeg|png|webp));base64,([A-Za-z0-9+/=]+)$/;

router.post("/api/admin/upload", requireDatabase, requireStaff, async (req, res) => {
  const dataUrl = typeof (req.body && req.body.dataUrl) === "string" ? req.body.dataUrl : "";
  const match = dataUrl.match(PHOTO_PATTERN);
  if (!match) return bad(res, "Please choose a JPG, PNG or WebP photo.");
  const base64 = match[2];
  const bytes = Math.floor((base64.length * 3) / 4);
  if (bytes < 100) return bad(res, "That photo seems to be empty.");
  if (bytes > MAX_UPLOAD_BYTES) return bad(res, "That photo is too big. Please choose a smaller one.");
  const inserted = await db.query(
    "INSERT INTO media (mime, data, created_by) VALUES ($1, $2, $3) RETURNING id",
    [match[1], base64, req.staff.id]
  );
  res.json({ ok: true, url: `/api/media/${inserted.rows[0].id}` });
});

// ---------- Public checkout ----------

// Customers check out on the storefront. The order lands in the back office
// as a new order with the payment method they chose. Money is confirmed by
// staff afterwards, exactly like the enquiry flow.
router.post("/api/checkout", requireDatabase, async (req, res) => {
  const body = req.body || {};
  const name = text(body.name);
  const phone = text(body.phone);
  const location = text(body.location);
  const method = PAYMENT_METHODS.includes(body.payment_method) ? body.payment_method : "other";
  const items = Array.isArray(body.items) ? body.items.slice(0, 20) : [];
  if (name.length < 2) return bad(res, "Please enter your name.");
  if (phone.replace(/\D/g, "").length < 6) return bad(res, "Please enter a valid phone number.");
  if (items.length === 0) return bad(res, "Your bag is empty.");

  const wantsOnlinePayment = paynow.MOBILE_METHODS.includes(method);
  const mobilePhone = wantsOnlinePayment ? paynow.normalisePhone(text(body.mobile_phone) || phone) : null;
  if (wantsOnlinePayment && paynow.isConfigured() && !mobilePhone) {
    return bad(res, "Enter the EcoCash / InnBucks number to charge, like 0771234567.");
  }
  const authEmail = text(body.email);
  if (wantsOnlinePayment && paynow.isConfigured() && !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(authEmail)) {
    return bad(res, "Enter your email address. Paynow requires it for EcoCash / InnBucks payments.");
  }

  try {
    const created = await db.withTransaction(async (client) => {
      const byPhone = await client.query("SELECT id, name, email FROM customers WHERE phone = $1", [phone]);
      let customerId;
      if (byPhone.rows[0]) {
        customerId = byPhone.rows[0].id;
        if (authEmail && !byPhone.rows[0].email) {
          await client.query("UPDATE customers SET email = $1 WHERE id = $2", [authEmail, customerId]);
        }
      } else {
        const inserted = await client.query(
          "INSERT INTO customers (name, phone, email) VALUES ($1, $2, $3) RETURNING id",
          [name, phone, authEmail || null]
        );
        customerId = inserted.rows[0].id;
      }

      const resolvedItems = [];
      let total = 0;
      for (const item of items) {
        const variantId = int(item.variant_id);
        const quantity = int(item.quantity, 1);
        if (!variantId || quantity < 1 || quantity > 100) {
          throw Object.assign(new Error("One of the items in your bag is not valid."), { status: 400 });
        }
        const variant = await client.query(
          `SELECT v.*, p.name AS product_name, p.active AS product_active, COALESCE(v.price, p.base_price) AS price
           FROM product_variants v JOIN products p ON p.id = v.product_id
           WHERE v.id = $1`,
          [variantId]
        );
        const row = variant.rows[0];
        if (!row || !row.active || !row.product_active) {
          throw Object.assign(new Error("Sorry, one of the pieces is no longer available."), { status: 400 });
        }
        if (row.price === null) {
          throw Object.assign(new Error("Some pieces are price on request. Please confirm those on WhatsApp."), { status: 400 });
        }
        if (row.stock < quantity) {
          const label = [row.product_name, row.size, row.colour].filter(Boolean).join(" / ");
          throw Object.assign(new Error(`Only ${row.stock} left of ${label}.`), { status: 400 });
        }
        const unitPrice = Number(row.price);
        total += unitPrice * quantity;
        resolvedItems.push({ row, variantId, quantity, unitPrice });
      }
      total = Math.round(total * 100) / 100;

      const order = await client.query(
        `INSERT INTO orders (reference, customer_id, customer_name, customer_phone, total, notes, payment_method)
         VALUES ('IF-' || to_char(now(), 'YYMM') || '-' || lpad(nextval('order_ref_seq')::text, 4, '0'),
                 $1, $2, $3, $4, $5, $6)
         RETURNING id, reference, total, payment_method`,
        [customerId, name, phone, total, location ? `Delivery: ${location}` : "", method]
      );
      const orderId = order.rows[0].id;

      for (const item of resolvedItems) {
        await client.query(
          `INSERT INTO order_items (order_id, product_id, variant_id, product_name, size, colour, quantity, unit_price)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
          [orderId, item.row.product_id, item.variantId, item.row.product_name, item.row.size, item.row.colour, item.quantity, item.unitPrice]
        );
        await client.query(
          "UPDATE product_variants SET stock = stock - $1 WHERE id = $2 AND stock >= $1",
          [item.quantity, item.variantId]
        );
      }

      await client.query("INSERT INTO audit_log (staff_id, action, details) VALUES (NULL, $1, $2)", [
        "checkout",
        `order ${order.rows[0].reference} placed on the website by ${name} (${method})`
      ]);
      return order.rows[0];
    });

    // EcoCash / InnBucks: start the online payment now so the customer gets
    // the PIN prompt (EcoCash) or authorization code (InnBucks) immediately.
    let paynowResult = null;
    if (wantsOnlinePayment && paynow.isConfigured()) {
      try {
        const baseUrl = requestBaseUrl(req);
        const receiptUrl = `${baseUrl}/receipt/${created.reference}?t=${receiptToken(created.reference)}`;
        const initiated = await paynow.initiateExpress({
          reference: created.reference,
          amount: Number(created.total),
          description: `Internal Frontier order ${created.reference}`,
          authEmail,
          phone: mobilePhone,
          method,
          resultUrl: `${baseUrl}/api/payments/paynow/callback`,
          returnUrl: receiptUrl
        });
        await db.query(
          "UPDATE orders SET paynow_pollurl = $1, paynow_status = $2, paynow_phone = $3 WHERE id = $4",
          [initiated.pollurl, "Initiated", mobilePhone, created.id]
        );
        retryAttempts.set(created.reference, Date.now());
        paynowResult = {
          started: true,
          method,
          phone: mobilePhone,
          instructions: initiated.instructions,
          authorizationcode: initiated.authorizationcode,
          authorizationexpires: initiated.authorizationexpires
        };
      } catch (error) {
        console.error("Paynow initiate failed:", error.message);
        paynowResult = { started: false, error: error.message };
      }
    }

    res.json({
      ok: true,
      order: {
        reference: created.reference,
        total: Number(created.total),
        payment_method: created.payment_method
      },
      paynow: paynowResult,
      paynow_configured: paynow.isConfigured(),
      receipt_url: `/receipt/${created.reference}?t=${receiptToken(created.reference)}`,
      status_url: `/status/${created.reference}?t=${receiptToken(created.reference)}`
    });
  } catch (error) {
    if (error.status) return bad(res, error.message);
    throw error;
  }
});

// ---------- Paynow callbacks ----------

// The storefront asks "has the customer approved the payment yet?"
// We poll Paynow and apply the answer. The customer only sees their own
// order's payment state, nothing else.
router.post("/api/payments/paynow/status", requireDatabase, async (req, res) => {
  const reference = text(req.body && req.body.reference);
  const found = await db.query("SELECT * FROM orders WHERE reference = $1", [reference]);
  const order = found.rows[0];
  if (!order) return bad(res, "Order not found.");
  if (!order.paynow_pollurl) {
    return res.json({ ok: true, status: order.payment_status });
  }
  try {
    const update = await paynow.pollStatus(order.paynow_pollurl);
    const applied = await applyPaynowUpdate(order.reference, update);
    if (!applied.ok) return bad(res, applied.error);
    const fresh = await db.query("SELECT payment_status, paynow_status FROM orders WHERE id = $1", [order.id]);
    res.json({
      ok: true,
      status: fresh.rows[0].payment_status,
      paynow_status: fresh.rows[0].paynow_status
    });
  } catch (error) {
    // A poll failure is not fatal - the customer can try again.
    res.json({ ok: true, status: order.payment_status, error: error.message });
  }
});

// Lets the storefront know if online payments are switched on, so the
// EcoCash / InnBucks options are never offered when they cannot work.
router.get("/api/payments/availability", (req, res) => {
  res.json({ ok: true, online: paynow.isConfigured() });
});

// Sends the payment prompt again. Meant for the customer's status page
// when the first prompt never reached their phone (weak signal happens).
const retryAttempts = new Map();
const retryCooldownMs = () => Number(process.env.PAYNOW_RETRY_COOLDOWN_MS || 20000);

router.post("/api/payments/paynow/retry", requireDatabase, async (req, res) => {
  const reference = text(req.body && req.body.reference);
  const found = await db.query("SELECT * FROM orders WHERE reference = $1", [reference]);
  const order = found.rows[0];
  if (!order) return bad(res, "Order not found.");
  if (!paynow.isConfigured()) return bad(res, "Online payments are not switched on right now.");
  if (!paynow.MOBILE_METHODS.includes(order.payment_method)) {
    return bad(res, "This order is not an online payment order.");
  }
  if (order.payment_status === "paid") return bad(res, "This order is already paid.");
  if (order.status === "cancelled") return bad(res, "This order was cancelled.");

  const cooldown = retryCooldownMs();
  const lastAttempt = retryAttempts.get(reference) || 0;
  if (Date.now() - lastAttempt < cooldown) {
    const seconds = Math.ceil((cooldown - (Date.now() - lastAttempt)) / 1000);
    return bad(res, `Please wait about ${seconds} more seconds before trying again.`);
  }
  retryAttempts.set(reference, Date.now());

  const phone = paynow.normalisePhone(order.paynow_phone) || paynow.normalisePhone(order.customer_phone);
  if (!phone) return bad(res, "This order has no valid mobile money number on file.");
  const emailRow = await db.query(
    "SELECT c.email FROM customers c WHERE c.id = $1",
    [order.customer_id]
  );
  const authEmail = text(emailRow.rows[0] ? emailRow.rows[0].email : "");
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(authEmail)) {
    return bad(res, "This order has no email address on file, which Paynow requires.");
  }

  try {
    const baseUrl = requestBaseUrl(req);
    const initiated = await paynow.initiateExpress({
      reference: order.reference,
      amount: Number(order.total),
      description: `Internal Frontier order ${order.reference}`,
      authEmail,
      phone,
      method: order.payment_method,
      resultUrl: `${baseUrl}/api/payments/paynow/callback`,
      returnUrl: `${baseUrl}/receipt/${order.reference}?t=${receiptToken(order.reference)}`
    });
    await db.query(
      "UPDATE orders SET paynow_pollurl = $1, paynow_status = 'Initiated', paynow_phone = $2, updated_at = now() WHERE id = $3",
      [initiated.pollurl, phone, order.id]
    );
    await db.query("INSERT INTO audit_log (staff_id, action, details) VALUES (NULL, $1, $2)", [
      "paynow_retry",
      `order ${order.reference}: payment prompt resent to ${phone}`
    ]);
    res.json({
      ok: true,
      method: order.payment_method,
      phone,
      instructions: initiated.instructions,
      authorizationcode: initiated.authorizationcode,
      authorizationexpires: initiated.authorizationexpires
    });
  } catch (error) {
    console.error("Paynow retry failed:", error.message);
    bad(res, error.message || "Paynow could not send the prompt again.");
  }
});

// Paynow posts the final payment result here automatically. The message is
// signed with our integration key, so we verify before trusting it.
router.post("/api/payments/paynow/callback", requireDatabase, async (req, res) => {
  if (!paynow.isConfigured()) {
    return res.status(503).send("Paynow is not configured");
  }

  try {
    const pairs = Object.entries(req.body || {}).map(([key, value]) => ({ key: key.toLowerCase(), value: String(value) }));
    const check = paynow.verifyInbound(pairs);
    if (!check.valid) {
      console.warn("Rejected a Paynow callback with a bad hash.");
      return res.status(400).send("Invalid hash");
    }
    const reference = String((req.body && req.body.reference) || "");
    const status = String((req.body && req.body.status) || "");
    const paynowreference = String((req.body && req.body.paynowreference) || "");
    const amount = String((req.body && req.body.amount) || "");
    if (!reference || !status) return res.status(400).send("Missing payment reference or status");
    const applied = await applyPaynowUpdate(reference, { status, amount, paynowreference, signed: check.signed });
    if (!applied.ok) return res.status(400).send(applied.error);
    res.status(200).send("OK");
  } catch (error) {
    console.error("Paynow callback error:", error.message);
    res.status(500).send("Error");
  }
});

// ---------- Receipts ----------

// Staff can open a customer's receipt from the order detail page.
router.get("/api/admin/orders/:id/receipt-url", requireDatabase, requireStaff, async (req, res) => {
  const id = int(req.params.id);
  const found = await db.query("SELECT reference FROM orders WHERE id = $1", [id]);
  if (!found.rows[0]) return bad(res, "Order not found.");
  const reference = found.rows[0].reference;
  res.json({ ok: true, url: `/receipt/${reference}?t=${receiptToken(reference)}` });
});

// ---------- Audit trail ----------

router.get("/api/admin/audit", requireDatabase, requireStaff, requireAdmin, async (req, res) => {
  const { rows } = await db.query(
    `SELECT a.*, s.name AS staff_name FROM audit_log a
     LEFT JOIN staff s ON s.id = a.staff_id
     ORDER BY a.id DESC LIMIT 100`
  );
  res.json({ ok: true, entries: rows });
});

// ---------- Admin page ----------

router.get("/admin", (req, res) => {
  res.sendFile(path.join(__dirname, "public", "admin.html"));
});

module.exports = router;
