const test = require("node:test");
const assert = require("node:assert/strict");
const paynow = require("./paynow");

const environmentNames = [
  "PAYNOW_INTEGRATION_ID",
  "PAYNOW_INTEGRATION_KEY"
];
const originalEnvironment = Object.fromEntries(
  environmentNames.map((name) => [name, process.env[name]])
);

function setPaynowCredentials(id, key) {
  if (id === undefined) delete process.env.PAYNOW_INTEGRATION_ID;
  else process.env.PAYNOW_INTEGRATION_ID = id;
  if (key === undefined) delete process.env.PAYNOW_INTEGRATION_KEY;
  else process.env.PAYNOW_INTEGRATION_KEY = key;
}

test.after(() => {
  for (const [name, value] of Object.entries(originalEnvironment)) {
    if (value === undefined) delete process.env[name];
    else process.env[name] = value;
  }
});

test("Paynow requires both configured credentials", () => {
  setPaynowCredentials(undefined, undefined);
  assert.equal(paynow.isConfigured(), false);
  setPaynowCredentials("integration-id", undefined);
  assert.equal(paynow.isConfigured(), false);
  setPaynowCredentials("integration-id", "integration-key");
  assert.equal(paynow.isConfigured(), true);
});

test("treats an unsigned Paynow message as processable but untrusted", () => {
  setPaynowCredentials("integration-id", "integration-key");
  const verdict = paynow.verifyInbound([{ key: "status", value: "Paid" }]);
  assert.equal(verdict.valid, true);
  assert.equal(verdict.signed, false);
  assert.equal(verdict.hasHash, false);
});

test("rejects a Paynow message when the integration key is missing", () => {
  setPaynowCredentials("integration-id", undefined);
  assert.equal(paynow.verifyInbound([{ key: "status", value: "Paid" }]).valid, false);
  const fields = [{ key: "status", value: "Paid" }, { key: "hash", value: paynow.hashValues(["Paid"], "") }];
  const verdict = paynow.verifyInbound(fields);
  assert.equal(verdict.valid, false);
  assert.equal(verdict.hasHash, true);
});

test("accepts a correctly signed Paynow message and rejects a tampered one", () => {
  const key = "test-integration-key";
  setPaynowCredentials("integration-id", key);
  const fields = [
    { key: "reference", value: "IF-2610-0001" },
    { key: "amount", value: "33.00" },
    { key: "status", value: "Awaiting Delivery" }
  ];
  const signed = [
    ...fields,
    { key: "hash", value: paynow.hashValues(fields.map((field) => field.value), key) }
  ];
  assert.equal(paynow.verifyInbound(signed).signed, true);
  assert.equal(
    paynow.verifyInbound(signed.map((field) =>
      field.key === "amount" ? { ...field, value: "0.01" } : field
    )).valid,
    false
  );
});

test("an unsigned error reply surfaces Paynow's own reason instead of a security error", async () => {
  const previousFetch = global.fetch;
  setPaynowCredentials("integration-id", "test-integration-key");
  global.fetch = async () => ({
    text: async () => "status=Error&error=Amount%20too%20low"
  });

  try {
    await assert.rejects(
      paynow.initiateExpress({
        reference: "IF-2610-0001",
        amount: 33,
        description: "Test order",
        phone: "0771234567",
        method: "ecocash",
        resultUrl: "https://example.com/callback",
        returnUrl: "https://example.com/receipt"
      }),
      /Paynow: Amount too low/
    );
  } finally {
    global.fetch = previousFetch;
  }
});

test("an unsigned successful reply still starts the payment", async () => {
  const previousFetch = global.fetch;
  setPaynowCredentials("integration-id", "test-integration-key");
  global.fetch = async () => ({
    text: async () => "status=Ok&pollurl=https%3A%2F%2Fwww.paynow.co.zw%2Fpoll&instructions=Prompt%20sent"
  });

  try {
    const initiated = await paynow.initiateExpress({
      reference: "IF-2610-0001",
      amount: 33,
      description: "Test order",
      phone: "0771234567",
      method: "ecocash",
      resultUrl: "https://example.com/callback",
      returnUrl: "https://example.com/receipt"
    });
    assert.equal(initiated.pollurl, "https://www.paynow.co.zw/poll");
    assert.equal(initiated.instructions, "Prompt sent");
  } finally {
    global.fetch = previousFetch;
  }
});

test("rejects missing, duplicate, or malformed hashes", () => {
  setPaynowCredentials("integration-id", "test-integration-key");
  const fields = [{ key: "status", value: "Paid" }];
  const hash = paynow.hashValues(["Paid"], "test-integration-key");
  assert.equal(paynow.verifyInbound([...fields, { key: "hash", value: hash }, { key: "hash", value: hash }]).valid, false);
  assert.equal(paynow.verifyInbound([...fields, { key: "hash", value: "not-a-hash" }]).valid, false);
});

test("matches only equal, positive amounts to the cent", () => {
  assert.equal(paynow.amountMatches("33.00", 33), true);
  assert.equal(paynow.amountMatches("33.01", 33), false);
  assert.equal(paynow.amountMatches("", 33), false);
  assert.equal(paynow.amountMatches("0.00", 0), false);
  assert.equal(paynow.amountMatches("33.001", 33), false);
});

test("only treats Paynow's Paid status as paid", () => {
  assert.equal(paynow.normalizeStatus("Paid"), "paid");
  // The prompt being sent or reaching the phone is NOT payment.
  for (const status of ["Awaiting Delivery", "Delivered", "Awaiting Redirect", "Created", "Sent"]) {
    assert.equal(paynow.normalizeStatus(status), "pending");
  }
  assert.equal(paynow.normalizeStatus("Cancelled"), "cancelled");
});
