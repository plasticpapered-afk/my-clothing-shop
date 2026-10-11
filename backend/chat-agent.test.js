const test = require('node:test');
const assert = require('node:assert/strict');
const { generateChatReply } = require('./chat-agent');

test('greets the shopper warmly', () => {
  const reply = generateChatReply('hello there');
  assert.match(reply, /hello|hi/i);
});

test('suggests a product when the shopper asks about tracksuits', () => {
  const reply = generateChatReply('Do you have a white tracksuit?');
  assert.match(reply, /white.*tracksuit|tracksuit.*white/i);
});

test('points shoppers to WhatsApp when they ask about pricing', () => {
  const reply = generateChatReply('What is the price of the jersey?');
  assert.match(reply, /WhatsApp|price/i);
});
