// Paynow Zimbabwe integration (Express Checkout).
// Lets customers pay with EcoCash (PIN prompt on their phone) or InnBucks
// (authorization code / app approval). Amounts are USD.
//
// Environment variables:
//   PAYNOW_INTEGRATION_ID  - from Paynow, "Receive Payment Links" area
//   PAYNOW_INTEGRATION_KEY - the secret key for that link (never share it)
//   PAYNOW_URL             - internal/testing override, do not set in production
//
// API reference: https://developers.paynow.co.zw/docs/paynow/express_checkout_transactions/

const crypto = require("crypto");

const MOBILE_METHODS = ["ecocash", "innbucks"];
const METHOD_LABELS = { ecocash: "EcoCash", innbucks: "InnBucks" };

function isConfigured() {
  return Boolean(integrationId() && integrationKey());
}

function baseUrl() {
  return process.env.PAYNOW_URL || "https://www.paynow.co.zw";
}

function integrationId() {
  return String(process.env.PAYNOW_INTEGRATION_ID || "");
}

function integrationKey() {
  return String(process.env.PAYNOW_INTEGRATION_KEY || "");
}

// Paynow hash: join the raw values in message order (excluding "hash"),
// append the integration key, SHA512, uppercase hex.
function hashValues(values, key) {
  const concat = values.map((value) => (value === null || value === undefined ? "" : String(value))).join("") + key;
  return crypto.createHash("sha512").update(concat, "utf8").digest("hex").toUpperCase();
}

// Parses a Paynow url-encoded reply while keeping the field order,
// which is required to verify the hash.
function parseUrlEncoded(text) {
  const pairs = [];
  for (const [key, value] of new URLSearchParams(String(text)).entries()) {
    pairs.push({ key: key.toLowerCase(), value });
  }
  return pairs;
}

// Verifies an inbound message from Paynow.
function verifyInbound(pairs) {
  const key = integrationKey();
  if (!key.trim() || !Array.isArray(pairs)) return false;

  const hashPairs = pairs.filter((pair) => String(pair.key || "").toLowerCase() === "hash");
  if (hashPairs.length !== 1) return false;

  const suppliedHash = String(hashPairs[0].value || "");
  if (!/^[a-f0-9]{128}$/i.test(suppliedHash)) return false;

  const values = pairs
    .filter((pair) => String(pair.key || "").toLowerCase() !== "hash")
    .map((pair) => pair.value);
  const expectedHash = hashValues(values, key);
  const suppliedBytes = Buffer.from(suppliedHash, "hex");
  const expectedBytes = Buffer.from(expectedHash, "hex");
  return suppliedBytes.length === expectedBytes.length && crypto.timingSafeEqual(suppliedBytes, expectedBytes);
}

function amountMatches(actual, expected) {
  function toCents(value) {
    if (typeof value !== "number" && typeof value !== "string") return null;
    const match = String(value).trim().match(/^(\d+)(?:\.(\d{1,2}))?$/);
    if (!match) return null;
    const cents = Number(match[1]) * 100 + Number((match[2] || "").padEnd(2, "0"));
    return Number.isSafeInteger(cents) ? cents : null;
  }

  const actualCents = toCents(actual);
  const expectedCents = toCents(expected);
  return actualCents !== null && actualCents > 0 && actualCents === expectedCents;
}

async function postForm(url, fields) {
  const response = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams(fields).toString()
  });
  return response.text();
}

// Starts an Express Checkout (mobile money) transaction. For EcoCash the
// customer gets a PIN prompt on their phone; for InnBucks they get an
// authorization code to approve in the InnBucks app.
async function initiateExpress({ reference, amount, description, phone, method, resultUrl, returnUrl }) {
  const fields = {
    id: integrationId(),
    reference: String(reference),
    amount: Number(amount).toFixed(2),
    additionalinfo: String(description),
    returnurl: String(returnUrl),
    resulturl: String(resultUrl),
    status: "Message",
    method: String(method),
    phone: String(phone)
  };
  fields.hash = hashValues(Object.values(fields), integrationKey());

  const text = await postForm(`${baseUrl()}/interface/remotetransaction`, fields);
  const pairs = parseUrlEncoded(text);
  const map = {};
  for (const pair of pairs) map[pair.key] = pair.value;

  if (!verifyInbound(pairs)) {
    throw new Error("Paynow's reply failed its security check.");
  }
  if ((map.status || "").toLowerCase() !== "ok") {
    throw new Error(map.error || "Paynow could not start the payment.");
  }
  return {
    pollurl: map.pollurl || "",
    instructions: map.instructions || "",
    authorizationcode: map.authorizationcode || "",
    authorizationexpires: map.authorizationexpires || ""
  };
}

// Polls Paynow for the current status of a transaction.
async function pollStatus(pollUrl) {
  if (!pollUrl) throw new Error("No Paynow transaction to check.");
  const text = await postForm(pollUrl, {});
  const pairs = parseUrlEncoded(text);
  const map = {};
  for (const pair of pairs) map[pair.key] = pair.value;
  if (!verifyInbound(pairs)) {
    throw new Error("Paynow status failed its security check.");
  }
  return {
    status: (map.status || "").toLowerCase(),
    paynowreference: map.paynowreference || "",
    amount: map.amount || "",
    pollurl: map.pollurl || pollUrl
  };
}

// Maps Paynow's status text onto our simple payment states.
function normalizeStatus(status) {
  const value = String(status || "").toLowerCase();
  // Only "Paid" means the money has actually arrived. "Awaiting Delivery"
  // means Paynow is sending the PIN prompt to the customer's phone, and
  // "Delivered" means the prompt reached the phone - the customer may not
  // have entered their PIN at all, so these must stay "pending".
  if (value === "paid") return "paid";
  if (value === "cancelled") return "cancelled";
  return "pending"; // awaiting delivery, delivered, created, sent, etc.
}

// Turns any Zimbabwean number format into the local 07xxxxxxxx form
// Paynow expects for mobile money.
function normalisePhone(raw) {
  const digits = String(raw || "").replace(/\D/g, "");
  if (!digits) return null;
  if (digits.startsWith("263")) {
    const local = "0" + digits.slice(3);
    return local.length >= 10 ? local.slice(0, 11) : local;
  }
  if (digits.startsWith("0")) return digits.slice(0, 11);
  if (digits.length === 9 && (digits.startsWith("7") || digits.startsWith("8"))) return "0" + digits;
  return null;
}

module.exports = {
  MOBILE_METHODS,
  METHOD_LABELS,
  isConfigured,
  initiateExpress,
  pollStatus,
  normalizeStatus,
  normalisePhone,
  hashValues,
  verifyInbound,
  amountMatches,
  integrationKey
};
