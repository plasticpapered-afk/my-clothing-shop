// Database layer for the Dust Patrol back office.
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
ALTER TABLE orders ADD COLUMN IF NOT EXISTS paynow_pollurl text NOT NULL DEFAULT '';
ALTER TABLE orders ADD COLUMN IF NOT EXISTS paynow_reference text NOT NULL DEFAULT '';
ALTER TABLE orders ADD COLUMN IF NOT EXISTS paynow_status text NOT NULL DEFAULT '';
ALTER TABLE orders ADD COLUMN IF NOT EXISTS paynow_phone text NOT NULL DEFAULT '';

CREATE INDEX IF NOT EXISTS order_items_order_id_idx ON order_items (order_id);
CREATE INDEX IF NOT EXISTS payments_order_id_idx ON payments (order_id);
CREATE INDEX IF NOT EXISTS product_variants_product_id_idx ON product_variants (product_id);
CREATE INDEX IF NOT EXISTS orders_status_idx ON orders (status);
`;

// Seed catalogue mirrors the pieces already on the storefront so the first
// deploy does not show an empty shop.
// Every service is listed at the same launch price (USD).
const SERVICE_PRICE = 50;

// Photos supplied by the owner. Services without a photo yet show a tidy icon.
const SEED_PRODUCTS = [
  {
    name: "Residential Cleaning",
    category: "residential",
    label: "Home visit",
    description: "A cleaner home, a healthier you. Regular or one-off cleaning for houses and apartments.",
    image_url: "images/dp/residential.jpg",
    packages: ["1 bedroom", "2 bedrooms", "3 bedrooms", "4+ bedrooms"],
    position: 1
  },
  {
    name: "Commercial Cleaning",
    category: "commercial",
    label: "Workspace",
    description: "Clean workspaces, greater productivity. Offices, shops and common areas.",
    image_url: "images/dp/commercial.jpg",
    packages: ["Small office", "Medium office", "Large premises"],
    position: 2
  },
  {
    name: "Deep Cleaning",
    category: "deep",
    label: "Deep clean",
    description: "Beyond the surface, for a fresher space. Kitchens, bathrooms, appliances and hard-to-reach spots.",
    image_url: "images/dp/deep-cleaning.jpg",
    packages: ["Standard deep clean", "Move-in / move-out", "Post-construction"],
    position: 3
  },
  {
    name: "Window & Surface Cleaning",
    category: "window",
    label: "Streak-free",
    description: "Streak-free. Spotless. Interior and exterior windows, glass and surfaces.",
    image_url: "",
    packages: ["Up to 10 windows", "10 to 20 windows", "Full premises"],
    position: 4
  },
  {
    name: "Sanitization & Disinfection",
    category: "sanitization",
    label: "Healthier spaces",
    description: "Healthier spaces, safer lives. Sanitizing and disinfection for homes and offices.",
    image_url: "",
    packages: ["Home treatment", "Office treatment"],
    position: 5
  }
];

// Runs on every start and is safe to repeat: it never duplicates a service,
// never touches orders, and never overwrites a photo or price the owner changed
// later in the back office (it only fills in what is still empty).
async function syncServiceCatalogue() {
  const keep = SEED_PRODUCTS.map((product) => product.name);

  // Switch off only the retired clothing categories. Anything else the
  // owner adds in the back office is theirs and is left alone.
  await query(
    "UPDATE products SET active = false WHERE COALESCE(category, '') IN ('tops', 'sets', 'jerseys', 'accessories') AND active"
  );

  // Two server instances starting at the same moment can both decide to
  // insert the same service. Remove the doubles (they are brand new, never
  // ordered) and then let unique indexes make it impossible to recur.
  await query(
    `DELETE FROM product_variants WHERE product_id IN (
       SELECT id FROM products WHERE name = ANY($1::text[])
       AND id NOT IN (SELECT MIN(id) FROM products WHERE name = ANY($1::text[]) GROUP BY name)
     )`,
    [keep]
  );
  await query(
    `DELETE FROM products WHERE name = ANY($1::text[])
     AND id NOT IN (SELECT MIN(id) FROM products WHERE name = ANY($1::text[]) GROUP BY name)`,
    [keep]
  );
  await query("CREATE UNIQUE INDEX IF NOT EXISTS products_name_key ON products (name)");
  await query("CREATE UNIQUE INDEX IF NOT EXISTS product_variants_slot_key ON product_variants (product_id, size, COALESCE(colour, ''))");

  for (const product of SEED_PRODUCTS) {
    const upserted = await query(
      `INSERT INTO products (name, description, category, label, image_url, base_price, position)
       VALUES ($1, $2, $3, $4, $5, $6, $7)
       ON CONFLICT (name) DO UPDATE SET
         active = true,
         category = EXCLUDED.category,
         label = EXCLUDED.label,
         description = EXCLUDED.description,
         position = EXCLUDED.position,
         image_url = CASE WHEN COALESCE(products.image_url, '') = '' THEN EXCLUDED.image_url ELSE products.image_url END,
         base_price = CASE WHEN products.base_price IS NULL THEN EXCLUDED.base_price ELSE products.base_price END
       RETURNING id`,
      [product.name, product.description, product.category, product.label, product.image_url, SERVICE_PRICE, product.position]
    );
    const productId = upserted.rows[0].id;

    for (const option of product.packages || ["Standard"]) {
      await query(
        `INSERT INTO product_variants (product_id, size, colour, stock, price)
         VALUES ($1, $2, '', 99, $3)
         ON CONFLICT (product_id, size, COALESCE(colour, '')) DO UPDATE SET active = true`,
        [productId, option, SERVICE_PRICE]
      );
    }
    // Retire package options that are no longer offered (old clothing sizes, etc).
    await query(
      "UPDATE product_variants SET active = false WHERE product_id = $1 AND NOT (size = ANY($2::text[]))",
      [productId, product.packages || ["Standard"]]
    );
  }
}

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
      await syncServiceCatalogue();
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
