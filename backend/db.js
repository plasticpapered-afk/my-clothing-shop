// Database layer for the Internal Frontier back office.
// Uses PostgreSQL via DATABASE_URL. All schema changes are idempotent so the
// app can start against a brand new empty database and set itself up.

const { Pool } = require("pg");

let pool = null;

// Hosted databases (like Neon) add "sslmode=..." to the address. The database
// driver prints a security warning about it, and we already switch on a
// verified secure connection through DATABASE_SSL, so we drop it from the
// address. Security stays exactly the same.
function cleanConnectionString(value) {
  if (!value) return value;
  try {
    const url = new URL(value);
    if (process.env.DATABASE_SSL === "true") {
      url.searchParams.delete("sslmode");
      url.searchParams.delete("channel_binding");
    }
    return url.toString();
  } catch (_) {
    return value;
  }
}

function getPool() {
  if (!pool) {
    pool = new Pool({
      connectionString: cleanConnectionString(process.env.DATABASE_URL),
      ssl: process.env.DATABASE_SSL === "true" ? { rejectUnauthorized: true } : false,
      max: 5,
      idleTimeoutMillis: 30000,
      connectionTimeoutMillis: 10000
    });
  }
  return pool;
}

// Used by tests to substitute an in-memory database.
function _usePoolForTesting(substitute) {
  pool = substitute;
}

const isConfigured = () => Boolean(process.env.DATABASE_URL);

async function query(text, params) {
  return getPool().query(text, params);
}

// Runs fn inside a single database transaction.
async function withTransaction(fn) {
  const client = await getPool().connect();
  let finished = false;
  try {
    await client.query("BEGIN");
    const result = await fn(client);
    await client.query("COMMIT");
    finished = true;
    return result;
  } catch (error) {
    if (!finished) {
      try { await client.query("ROLLBACK"); } catch (_) { /* already broken */ }
    }
    throw error;
  } finally {
    client.release();
  }
}

const SCHEMA_SQL = `
CREATE SEQUENCE IF NOT EXISTS order_ref_seq START 1;

CREATE TABLE IF NOT EXISTS staff (
  id serial PRIMARY KEY,
  email text NOT NULL UNIQUE,
  name text NOT NULL,
  password_hash text NOT NULL,
  role text NOT NULL DEFAULT 'staff',
  active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS customers (
  id serial PRIMARY KEY,
  name text NOT NULL,
  phone text NOT NULL UNIQUE,
  email text,
  notes text,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS products (
  id serial PRIMARY KEY,
  name text NOT NULL,
  description text NOT NULL DEFAULT '',
  category text NOT NULL DEFAULT 'tops',
  label text NOT NULL DEFAULT '',
  image_url text NOT NULL DEFAULT '',
  base_price numeric(10, 2),
  active boolean NOT NULL DEFAULT true,
  position int NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS product_variants (
  id serial PRIMARY KEY,
  product_id int NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  size text NOT NULL DEFAULT '',
  colour text NOT NULL DEFAULT '',
  stock int NOT NULL DEFAULT 0,
  price numeric(10, 2),
  active boolean NOT NULL DEFAULT true,
  UNIQUE (product_id, size, colour)
);

CREATE TABLE IF NOT EXISTS orders (
  id serial PRIMARY KEY,
  reference text NOT NULL UNIQUE,
  customer_id int REFERENCES customers(id),
  customer_name text NOT NULL,
  customer_phone text NOT NULL,
  status text NOT NULL DEFAULT 'new',
  payment_status text NOT NULL DEFAULT 'unpaid',
  total numeric(10, 2) NOT NULL DEFAULT 0,
  notes text NOT NULL DEFAULT '',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS order_items (
  id serial PRIMARY KEY,
  order_id int NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
  product_id int REFERENCES products(id),
  variant_id int REFERENCES product_variants(id),
  product_name text NOT NULL,
  size text NOT NULL DEFAULT '',
  colour text NOT NULL DEFAULT '',
  quantity int NOT NULL DEFAULT 1,
  unit_price numeric(10, 2) NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS payments (
  id serial PRIMARY KEY,
  order_id int NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
  method text NOT NULL DEFAULT 'other',
  reference text NOT NULL DEFAULT '',
  amount numeric(10, 2) NOT NULL,
  recorded_by int REFERENCES staff(id),
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS audit_log (
  id serial PRIMARY KEY,
  staff_id int REFERENCES staff(id),
  action text NOT NULL,
  details text NOT NULL DEFAULT '',
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS media (
  id serial PRIMARY KEY,
  mime text NOT NULL,
  data text NOT NULL,
  created_by int REFERENCES staff(id),
  created_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE orders ADD COLUMN IF NOT EXISTS payment_method text NOT NULL DEFAULT '';

CREATE INDEX IF NOT EXISTS order_items_order_id_idx ON order_items (order_id);
CREATE INDEX IF NOT EXISTS payments_order_id_idx ON payments (order_id);
CREATE INDEX IF NOT EXISTS product_variants_product_id_idx ON product_variants (product_id);
CREATE INDEX IF NOT EXISTS orders_status_idx ON orders (status);
`;

// Seed catalogue mirrors the pieces already on the storefront so the first
// deploy does not show an empty shop.
const SEED_PRODUCTS = [
  {
    name: "Silent Wars Graphic Tee",
    category: "tops",
    label: "Graphic tee",
    index_label: "Tops / 01",
    description: "Expressive everyday staple from the Internal Frontier line.",
    image_url: "images/WhatsApp Image 2026-10-10 at 22.56.42.jpeg",
    position: 1
  },
  {
    name: "Black Frontier Tracksuit",
    category: "sets",
    label: "Tracksuit",
    index_label: "Tracksuits / 01",
    description: "Full tracksuit set in black.",
    image_url: "images/WhatsApp Image 2026-10-10 at 22.56.42 (1).jpeg",
    position: 2
  },
  {
    name: "White Frontier Tracksuit",
    category: "sets",
    label: "Tracksuit",
    index_label: "Tracksuits / 02",
    description: "Full tracksuit set in white.",
    image_url: "images/WhatsApp Image 2026-10-10 at 22.56.41.jpeg",
    position: 3
  },
  {
    name: "Frontier Jersey",
    category: "jerseys",
    label: "Jersey",
    index_label: "Jerseys / 01",
    description: "Signature Internal Frontier jersey.",
    image_url: "images/WhatsApp Image 2026-10-10 at 22.56.39.jpeg",
    position: 4
  }
];

const SEED_SIZES = ["XS", "S", "M", "L", "XL", "XXL"];

let schemaPromise = null;

// Makes sure tables exist. Safe to call on every request; only does real work
// once per server instance.
function ensureSchema() {
  if (!schemaPromise) {
    schemaPromise = (async () => {
      // One statement at a time: some Postgres providers reject
      // multi-statement queries in a single call.
      for (const statement of SCHEMA_SQL.split(";").map((part) => part.trim()).filter(Boolean)) {
        await query(statement);
      }
      const { rows } = await query("SELECT COUNT(*)::int AS count FROM products");
      if (rows[0].count === 0) {
        for (const product of SEED_PRODUCTS) {
          const inserted = await query(
            `INSERT INTO products (name, description, category, label, image_url, position)
             VALUES ($1, $2, $3, $4, $5, $6) RETURNING id`,
            [product.name, product.description, product.category, product.label, product.image_url, product.position]
          );
          const productId = inserted.rows[0].id;
          for (const size of SEED_SIZES) {
            await query(
              `INSERT INTO product_variants (product_id, size, colour, stock)
               VALUES ($1, $2, '', 0)`,
              [productId, size]
            );
          }
        }
      }
    })().catch((error) => {
      schemaPromise = null;
      throw error;
    });
  }
  return schemaPromise;
}

module.exports = {
  query,
  withTransaction,
  ensureSchema,
  isConfigured,
  _usePoolForTesting
};
