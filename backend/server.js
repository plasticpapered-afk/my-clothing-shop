const express = require("express");
const helmet = require("helmet");
const { Pool } = require("pg");

const app = express();
const port = process.env.PORT || 3000;

app.use(helmet());
app.use(express.json({ limit: "20kb" }));

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
      service: "Frontier Garment API",
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

app.get("/", (req, res) => {
  res.json({
    message: "Frontier Garment API",
    health: "/health"
  });
});

app.listen(port, "0.0.0.0", () => {
  console.log(`Frontier Garment API listening on ${port}`);
});
