const productCatalog = {
  'silent wars graphic tee': 'Silent Wars Graphic Tee',
  'black frontier tracksuit': 'Black Frontier Tracksuit',
  'white frontier tracksuit': 'White Frontier Tracksuit',
  'frontier jersey': 'Frontier Jersey'
};

function normalizeText(value) {
  return String(value || '').trim().toLowerCase();
}

function generateChatReply(message) {
  const text = normalizeText(message);

  if (!text) {
    return 'Hi! I can help with the collection, sizing, and next steps. Want to browse the current line or ask about pricing?';
  }

  if (/\b(hi|hello|hey|good morning|good afternoon|good evening)\b/.test(text)) {
    return 'Hi! Welcome to Internal Frontier. We carry the Silent Wars Graphic Tee, Black Frontier Tracksuit, White Frontier Tracksuit, and Frontier Jersey. Want help choosing a piece?';
  }

  if (/white.*tracksuit|tracksuit.*white/.test(text)) {
    return 'The White Frontier Tracksuit is one of our current favourites. It is available in sizes XS–XXL and is a great match if you want a clean, confident everyday look. I can also help you send it straight to WhatsApp for pricing and availability.';
  }

  if (/black.*tracksuit|tracksuit.*black/.test(text)) {
    return 'The Black Frontier Tracksuit is available in the current line and fits the understated, everyday style direction behind Internal Frontier. If you want, I can help you prepare a quick WhatsApp enquiry for pricing and availability.';
  }

  if (/silent wars|graphic tee|tee/.test(text)) {
    return 'The Silent Wars Graphic Tee is a standout staple from the current collection. It works well for an easy everyday fit and can be paired with either of the Frontier tracksuits. Want me to suggest a full outfit?';
  }

  if (/frontier jersey|jersey/.test(text)) {
    return 'The Frontier Jersey is part of the current collection and is a solid choice if you want a street-ready, performance feel. For exact pricing and stock, the fastest option is a WhatsApp message.';
  }

  if (/price|pricing|cost|how much|budget/.test(text)) {
    return 'Our pieces are priced on request so we can confirm the latest stock and fit details. The quickest next step is to send us a WhatsApp message and we’ll reply with pricing and availability.';
  }

  if (/size|fit|sizing|measurement/.test(text)) {
    return 'We carry sizes XS through XXL across the collection. For the best fit guidance, tell me which item you want and I can suggest the right size range, then you can send the enquiry on WhatsApp.';
  }

  if (/shipping|delivery|availability|stock|in stock|available/.test(text)) {
    return 'Availability changes with the current line, so the fastest and most accurate way to confirm is by WhatsApp. We can tell you what is available and the best next step without guessing.';
  }

  if (/collection|shop|tops|tracksuits|jerseys|look/.test(text)) {
    return 'Right now the current collection includes the Silent Wars Graphic Tee, Black Frontier Tracksuit, White Frontier Tracksuit, and Frontier Jersey. If you want a recommendation, tell me your vibe: clean, relaxed, sporty, or statement.';
  }

  if (/(thank you|thanks|bye|goodbye)/.test(text)) {
    return 'My pleasure. We’re here whenever you want to browse the collection or send a WhatsApp enquiry.';
  }

  const productName = Object.entries(productCatalog).find(([key]) => text.includes(key));
  if (productName) {
    return `The ${productName[1]} is part of the current line. For exact pricing and availability, send us a WhatsApp message and we’ll confirm the latest details for you.`;
  }

  return 'I can help with product recommendations, sizing, and the current collection. For pricing and availability, the quickest route is WhatsApp and we’ll confirm the exact details for you.';
}

module.exports = { generateChatReply, productCatalog };
