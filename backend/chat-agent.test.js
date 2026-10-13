const test = require('node:test');
const assert = require('node:assert/strict');
const { generateChatReply } = require('./chat-agent');

test('sends chat to Vercel AI Gateway with the server-side key', async () => {
  const previousKey = process.env.AI_GATEWAY_API_KEY;
  const previousFetch = global.fetch;
  process.env.AI_GATEWAY_API_KEY = 'test-key';
  let request;
  global.fetch = async (url, options) => {
    request = { url, options };
    return {
      ok: true,
      json: async () => ({ choices: [{ message: { content: 'Hello from the assistant.' } }] })
    };
  };

  try {
    const reply = await generateChatReply('hello');
    assert.equal(reply, 'Hello from the assistant.');
    assert.equal(request.url, 'https://ai-gateway.vercel.sh/v1/chat/completions');
    assert.equal(request.options.headers.Authorization, 'Bearer test-key');
    assert.equal(JSON.parse(request.options.body).model, 'openai/gpt-4o-mini');
  } finally {
    global.fetch = previousFetch;
    if (previousKey === undefined) delete process.env.AI_GATEWAY_API_KEY;
    else process.env.AI_GATEWAY_API_KEY = previousKey;
  }
});

test('requires an API key without making a request', async () => {
  const previousKey = process.env.AI_GATEWAY_API_KEY;
  delete process.env.AI_GATEWAY_API_KEY;

  try {
    await assert.rejects(generateChatReply('hello'), /AI_GATEWAY_API_KEY is not configured/);
  } finally {
    if (previousKey !== undefined) process.env.AI_GATEWAY_API_KEY = previousKey;
  }
});
