const test = require("node:test");
const assert = require("node:assert/strict");
const { generateChatReply, pickGeminiModels, SYSTEM_PROMPT } = require("./chat-agent");

const names = ["GEMINI_API_KEY", "AI_GATEWAY_API_KEY", "GEMINI_MODEL", "AI_GATEWAY_MODEL"];
const saved = Object.fromEntries(names.map((name) => [name, process.env[name]]));
const savedFetch = global.fetch;

function reset() {
  for (const name of names) delete process.env[name];
  global.fetch = savedFetch;
}

test.afterEach(reset);
test.after(() => {
  for (const [name, value] of Object.entries(saved)) {
    if (value === undefined) delete process.env[name];
    else process.env[name] = value;
  }
  global.fetch = savedFetch;
});

const ok = (body) => ({ ok: true, status: 200, json: async () => body });
const fail = (status) => ({ ok: false, status, json: async () => ({}) });
const reply = (text) => ok({ choices: [{ message: { content: text } }] });

test("sends chat to the Vercel AI Gateway when only that key is set", async () => {
  reset();
  process.env.AI_GATEWAY_API_KEY = "gateway-key";
  let request;
  global.fetch = async (url, options) => {
    request = { url, options };
    return reply("Hello from the gateway.");
  };
  assert.equal(await generateChatReply("hello"), "Hello from the gateway.");
  assert.equal(request.url, "https://ai-gateway.vercel.sh/v1/chat/completions");
  assert.equal(request.options.headers.Authorization, "Bearer gateway-key");
});

test("says clearly when no key is configured, without calling out", async () => {
  reset();
  global.fetch = async () => { throw new Error("must not be called"); };
  await assert.rejects(generateChatReply("hello"), /not configured/);
});

test("asks Google which models the key can use instead of guessing names", async () => {
  reset();
  process.env.GEMINI_API_KEY = "gem-key-1";
  const calls = [];
  global.fetch = async (url, options) => {
    calls.push(String(url));
    if (String(url).includes("/v1beta/models")) {
      return ok({ models: [
        { name: "models/gemini-3.8-flash", supportedGenerationMethods: ["generateContent"] },
        { name: "models/gemini-3.8-flash-tts", supportedGenerationMethods: ["generateContent"] }
      ] });
    }
    assert.equal(JSON.parse(options.body).model, "gemini-3.8-flash");
    return reply("Hi from Gemini.");
  };
  assert.equal(await generateChatReply("hello"), "Hi from Gemini.");
  assert.ok(calls[0].includes("/v1beta/models"), "model list requested first");
});

test("falls through to the next model when one answers 404", async () => {
  reset();
  process.env.GEMINI_API_KEY = "gem-key-2";
  global.fetch = async (url, options) => {
    if (String(url).includes("/v1beta/models")) {
      return ok({ models: [
        { name: "models/gemini-3.8-flash", supportedGenerationMethods: ["generateContent"] },
        { name: "models/gemini-3.6-flash", supportedGenerationMethods: ["generateContent"] }
      ] });
    }
    return JSON.parse(options.body).model === "gemini-3.8-flash" ? fail(404) : reply("Second model works.");
  };
  assert.equal(await generateChatReply("hello"), "Second model works.");
});

test("never picks voice, image or speech models for chat", () => {
  const picked = pickGeminiModels([
    "gemini-3.8-flash-tts", "gemini-3.1-flash-live-preview", "gemini-3.1-flash-image", "gemini-3.5-flash-lite"
  ]);
  assert.deepEqual(picked, ["gemini-3.5-flash-lite"]);
});

test("the assistant knows the $50 price and the new domain", () => {
  assert.match(SYSTEM_PROMPT, /\$50/);
  assert.match(SYSTEM_PROMPT, /kharece\.co\.zw/);
});
