// Staff authentication for the back office.
// Stateless signed cookies (HMAC), bcrypt password hashing. Works on
// serverless hosting where in-memory sessions are not reliable.

const crypto = require("crypto");
const bcrypt = require("bcryptjs");

const SECRET = process.env.SESSION_SECRET || "internal-frontier-dev-secret";
const TOKEN_TTL_SECONDS = 60 * 60 * 12; // 12 hours
const COOKIE_NAME = "if_admin";
const secureCookies = Boolean(process.env.VERCEL) || process.env.NODE_ENV === "production";

function sign(payload) {
  return crypto.createHmac("sha256", SECRET).update(payload).digest("base64url");
}

function createToken(staffId) {
  const payload = Buffer.from(
    JSON.stringify({ sub: staffId, exp: Date.now() + TOKEN_TTL_SECONDS * 1000 })
  ).toString("base64url");
  return `${payload}.${sign(payload)}`;
}

function verifyToken(token) {
  if (typeof token !== "string") return null;
  const dot = token.indexOf(".");
  if (dot === -1) return null;
  const payload = token.slice(0, dot);
  const signature = token.slice(dot + 1);
  const expected = Buffer.from(sign(payload));
  const actual = Buffer.from(signature);
  if (expected.length !== actual.length || !crypto.timingSafeEqual(expected, actual)) return null;
  let data;
  try {
    data = JSON.parse(Buffer.from(payload, "base64url").toString("utf8"));
  } catch (_) {
    return null;
  }
  if (!data || typeof data.sub !== "number" || typeof data.exp !== "number") return null;
  if (Date.now() > data.exp) return null;
  return data.sub;
}

function getStaffIdFromRequest(req) {
  const cookies = req.headers.cookie || "";
  const match = cookies.split(";").map((part) => part.trim()).find((part) => part.startsWith(`${COOKIE_NAME}=`));
  if (!match) return null;
  return verifyToken(decodeURIComponent(match.slice(COOKIE_NAME.length + 1)));
}

function setAuthCookie(res, token) {
  const parts = [
    `${COOKIE_NAME}=${encodeURIComponent(token)}`,
    "Path=/",
    "HttpOnly",
    "SameSite=Lax",
    `Max-Age=${TOKEN_TTL_SECONDS}`
  ];
  if (secureCookies) parts.push("Secure");
  res.setHeader("Set-Cookie", parts.join("; "));
}

function clearAuthCookie(res) {
  const parts = [`${COOKIE_NAME}=`, "Path=/", "HttpOnly", "SameSite=Lax", "Max-Age=0"];
  if (secureCookies) parts.push("Secure");
  res.setHeader("Set-Cookie", parts.join("; "));
}

function hashPassword(password) {
  return bcrypt.hash(password, 10);
}

function verifyPassword(password, hash) {
  return bcrypt.compare(password, hash);
}

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function validPassword(password) {
  return typeof password === "string" && password.length >= 8 && password.length <= 100;
}

// A short private token so receipts can only be opened with their link.
function receiptToken(reference) {
  return crypto
    .createHmac("sha256", SECRET)
    .update(`receipt:${reference}`)
    .digest("hex")
    .slice(0, 16);
}

module.exports = {
  receiptToken,
  createToken,
  setAuthCookie,
  clearAuthCookie,
  getStaffIdFromRequest,
  hashPassword,
  verifyPassword,
  validPassword,
  EMAIL_PATTERN
};
