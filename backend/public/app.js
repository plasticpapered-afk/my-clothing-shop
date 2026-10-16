/* Dust Patrol Cleaning Services - storefront script.
   Every feature is started inside its own guard (see "boot" at the bottom), so
   one failing feature can never take the others down, including the live chat. */

"use strict";

const WHATSAPP_NUMBER = "263774502737";
const BAG_KEY = "dust-patrol-booking-bag";
const SERVICE_PRICE = 50;
const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)");

const $ = (id) => document.getElementById(id);
const el = {
  header: $("site-header"), progress: $("progress"),
  bagDrawer: $("bag-drawer"), bagItems: $("bag-items"), bagCount: $("bag-count"),
  openBag: $("open-bag"), closeBag: $("close-bag"), backdrop: $("drawer-backdrop"),
  sendEnquiry: $("send-enquiry"), siteCheckout: $("site-checkout"), bagTotal: $("bag-total-line"),
  toast: $("toast"), grid: $("product-grid"), search: $("product-search"),
  empty: $("empty-results"), count: $("result-count"),
  chatPanel: $("chat-panel"), chatLauncher: $("open-chat"), chatClose: $("close-chat"),
  chatLog: $("chat-log"), chatInput: $("chat-input"), chatForm: $("chat-form")
};

let activeFilter = "all";
let toastTimer = null;
let bag = loadBag();

/* ---------- Helpers ---------- */
function money(value) { return `$${Number(value).toFixed(2)}`; }

function escapeHtml(text) {
  return String(text).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}

function showToast(message) {
  if (!el.toast) return;
  el.toast.textContent = message;
  el.toast.classList.add("is-visible");
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.toast.classList.remove("is-visible"), 2600);
}

/* ---------- Booking bag ---------- */
function loadBag() {
  try {
    const saved = JSON.parse(localStorage.getItem(BAG_KEY) || "[]");
    return Array.isArray(saved) ? saved.filter((i) => i && typeof i.name === "string") : [];
  } catch (error) {
    return [];
  }
}

function saveBag() {
  try { localStorage.setItem(BAG_KEY, JSON.stringify(bag)); } catch (error) { /* private mode */ }
  renderBag();
}

function bagCanCheckout() {
  return bag.length > 0 && bag.every((i) => i.variantId && i.price !== null && i.price !== undefined);
}

function renderBag() {
  if (!el.bagItems) return;
  if (el.bagCount) {
    el.bagCount.textContent = String(bag.length);
    el.bagCount.classList.remove("bump");
    void el.bagCount.offsetWidth;
    el.bagCount.classList.add("bump");
  }
  if (el.sendEnquiry) el.sendEnquiry.disabled = bag.length === 0;
  if (el.siteCheckout) el.siteCheckout.disabled = !bagCanCheckout();
  if (el.bagTotal) {
    if (bagCanCheckout()) {
      el.bagTotal.textContent = `Total: ${money(bag.reduce((sum, i) => sum + Number(i.price), 0))}`;
      el.bagTotal.hidden = false;
    } else {
      el.bagTotal.hidden = true;
    }
  }
  el.bagItems.textContent = "";
  if (!bag.length) {
    const empty = document.createElement("p");
    empty.className = "empty-bag";
    empty.textContent = "Your booking is empty. Add a cleaning service to get started.";
    el.bagItems.append(empty);
    return;
  }
  bag.forEach((item, index) => {
    const row = document.createElement("div");
    row.className = "bag-row";
    const img = document.createElement("img");
    img.className = "bag-thumb";
    img.alt = "";
    if (item.image) img.src = item.image;
    const details = document.createElement("div");
    const name = document.createElement("p");
    name.className = "bag-name";
    name.textContent = item.name;
    const pack = document.createElement("p");
    pack.className = "bag-size";
    pack.textContent = `Package: ${item.size}`;
    const price = document.createElement("p");
    price.className = "bag-price";
    price.textContent = item.price === null || item.price === undefined ? "Price on request" : money(item.price);
    details.append(name, pack, price);
    const remove = document.createElement("button");
    remove.className = "bag-remove";
    remove.type = "button";
    remove.textContent = "Remove";
    remove.addEventListener("click", () => { bag.splice(index, 1); saveBag(); });
    row.append(img, details, remove);
    el.bagItems.append(row);
  });
}

function setDrawerOpen(isOpen) {
  if (!el.bagDrawer) return;
  el.bagDrawer.classList.toggle("is-open", isOpen);
  el.bagDrawer.setAttribute("aria-hidden", String(!isOpen));
  if (el.backdrop) el.backdrop.hidden = !isOpen;
  document.body.style.overflow = isOpen ? "hidden" : "";
}

/* ---------- Services ---------- */
const CATEGORY_LABELS = { residential: "Residential", commercial: "Commercial", deep: "Deep clean", window: "Windows", sanitization: "Sanitization" };
const GLYPHS = { residential: "🏠", commercial: "🏢", deep: "✨", window: "🪟", sanitization: "🛡️" };
// Photos supplied by the owner. Others will be added as they arrive.
const PHOTOS = {
  residential: "images/dp/residential.jpg",
  commercial: "images/dp/commercial.jpg",
  deep: "images/dp/deep-cleaning.jpg"
};

function buildCard(product, index) {
  const article = document.createElement("article");
  article.className = "product reveal";
  article.style.setProperty("--d", `${(index % 3) * 0.08}s`);
  article.dataset.category = product.category;
  article.dataset.name = product.name.toLowerCase();

  const media = document.createElement("div");
  media.className = "product-image";
  const photo = product.image_url || PHOTOS[product.category];
  if (photo) {
    const img = document.createElement("img");
    img.src = photo;
    img.alt = product.name;
    img.loading = "lazy";
    img.addEventListener("error", () => { img.remove(); media.prepend(glyphEl(product.category)); });
    media.append(img);
  } else {
    media.append(glyphEl(product.category));
  }
  const label = document.createElement("span");
  label.className = "product-label";
  label.textContent = product.label || CATEGORY_LABELS[product.category] || "Service";
  media.append(label);
  const badge = document.createElement("span");
  badge.className = "price-badge";
  badge.textContent = product.price === null || product.price === undefined ? "Ask" : money(product.price);
  media.append(badge);

  const info = document.createElement("div");
  info.className = "product-info";
  const cat = document.createElement("span");
  cat.className = "product-category";
  cat.textContent = CATEGORY_LABELS[product.category] || "Service";
  const title = document.createElement("h3");
  title.textContent = product.name;
  const desc = document.createElement("p");
  desc.className = "product-desc";
  desc.textContent = product.description || "";
  const price = document.createElement("p");
  price.className = "product-price";
  price.textContent = product.price === null || product.price === undefined ? "Price on request" : `${money(product.price)} per visit`;

  const actions = document.createElement("div");
  actions.className = "product-actions";
  const select = document.createElement("select");
  select.className = "size-select";
  select.setAttribute("aria-label", `Package for ${product.name}`);
  const first = document.createElement("option");
  first.value = "";
  first.textContent = "Choose package";
  select.append(first);
  (product.variants || []).forEach((variant) => {
    const option = document.createElement("option");
    option.value = String(variant.id);
    option.textContent = [variant.size, variant.colour].filter(Boolean).join(" / ") || "Standard";
    const own = variant.price !== null && variant.price !== undefined ? Number(variant.price) : (product.price !== null && product.price !== undefined ? Number(product.price) : null);
    option.dataset.variantId = String(variant.id);
    option.dataset.price = own === null ? "" : String(own);
    select.append(option);
  });
  const add = document.createElement("button");
  add.className = "add-button";
  add.type = "button";
  add.textContent = "Add";
  add.addEventListener("click", () => {
    if (!select.value) { select.focus(); showToast("Choose a package first."); return; }
    const chosen = select.selectedOptions[0];
    const variantId = chosen && chosen.dataset.variantId ? Number(chosen.dataset.variantId) : null;
    const priceValue = chosen && chosen.dataset.price ? Number(chosen.dataset.price) : null;
    bag.push({
      name: product.name,
      size: chosen.textContent,
      image: media.querySelector("img") ? media.querySelector("img").src : "",
      variantId: Number.isFinite(variantId) ? variantId : null,
      price: priceValue !== null && Number.isFinite(priceValue) ? priceValue : null
    });
    saveBag();
    showToast("Added to your booking.");
    setDrawerOpen(true);
  });
  actions.append(select, add);
  info.append(cat, title, desc, price, actions);
  article.append(media, info);
  attachTilt(article);
  return article;
}

function glyphEl(category) {
  const span = document.createElement("span");
  span.className = "glyph";
  span.textContent = GLYPHS[category] || "✨";
  return span;
}

function filterServices() {
  if (!el.grid) return;
  const query = el.search ? el.search.value.trim().toLowerCase() : "";
  let visible = 0;
  el.grid.querySelectorAll(".product").forEach((card) => {
    const show = (activeFilter === "all" || card.dataset.category === activeFilter) && card.dataset.name.includes(query);
    card.hidden = !show;
    if (show) visible += 1;
  });
  if (el.empty) el.empty.hidden = visible !== 0;
  if (el.count) el.count.textContent = `${visible} ${visible === 1 ? "service" : "services"}`;
}

async function loadServices() {
  if (!el.grid) return;
  try {
    const response = await fetch("/api/products");
    const data = response.ok ? await response.json() : null;
    if (!data || data.ok !== true || !Array.isArray(data.products)) throw new Error("no catalogue");
    el.grid.textContent = "";
    data.products.forEach((product, index) => el.grid.append(buildCard(product, index)));
  } catch (error) {
    el.grid.textContent = "";
    const note = document.createElement("p");
    note.className = "result-meta";
    note.textContent = "Our services could not load just now. Please refresh, or message us on WhatsApp to book.";
    el.grid.append(note);
  }
  observeReveals();
  filterServices();
}

/* ---------- Motion ---------- */
function observeReveals() {
  const targets = document.querySelectorAll(".reveal:not(.is-in)");
  if (reducedMotion.matches || !("IntersectionObserver" in window)) {
    targets.forEach((t) => t.classList.add("is-in"));
    return;
  }
  revealObserver = revealObserver || new IntersectionObserver((entries) => {
    entries.forEach((entry) => {
      if (!entry.isIntersecting) return;
      entry.target.classList.add("is-in");
      revealObserver.unobserve(entry.target);
    });
  }, { threshold: 0.12, rootMargin: "0px 0px -40px 0px" });
  targets.forEach((t) => revealObserver.observe(t));
}
let revealObserver = null;

function attachTilt(card) {
  if (reducedMotion.matches || !window.matchMedia("(hover: hover)").matches) return;
  card.addEventListener("pointermove", (event) => {
    const box = card.getBoundingClientRect();
    const x = (event.clientX - box.left) / box.width - 0.5;
    const y = (event.clientY - box.top) / box.height - 0.5;
    card.style.transform = `perspective(900px) rotateY(${x * 7}deg) rotateX(${-y * 7}deg) translateY(-8px)`;
  });
  card.addEventListener("pointerleave", () => { card.style.transform = ""; });
}

function startTypedText() {
  const target = $("typed");
  if (!target || reducedMotion.matches) return;
  const words = (target.dataset.words || "").split("|").map((w) => w.replace(/&amp;/g, "&")).filter(Boolean);
  if (words.length < 2) return;
  let w = 0, c = words[0].length, deleting = true;
  const tick = () => {
    const word = words[w];
    target.textContent = word.slice(0, c);
    if (deleting) {
      c -= 1;
      if (c < 0) { deleting = false; w = (w + 1) % words.length; c = 0; }
      setTimeout(tick, 38);
    } else {
      c += 1;
      if (c > words[w].length) { deleting = true; c = words[w].length; setTimeout(tick, 1700); return; }
      setTimeout(tick, 75);
    }
  };
  setTimeout(tick, 2600);
}

function startCounters() {
  document.querySelectorAll("[data-count]").forEach((node) => {
    const end = Number(node.dataset.count);
    if (!Number.isFinite(end)) return;
    if (reducedMotion.matches) { node.textContent = String(end); return; }
    const begin = performance.now();
    const step = (now) => {
      const t = Math.min(1, (now - begin) / 1400);
      node.textContent = String(Math.round(end * (1 - Math.pow(1 - t, 3))));
      if (t < 1) requestAnimationFrame(step);
    };
    setTimeout(() => requestAnimationFrame(step), 1100);
  });
}

function startScrollEffects() {
  const onScroll = () => {
    const max = document.documentElement.scrollHeight - window.innerHeight;
    if (el.progress && max > 0) el.progress.style.width = `${Math.min(100, (window.scrollY / max) * 100)}%`;
    if (el.header) el.header.classList.toggle("is-scrolled", window.scrollY > 24);
  };
  window.addEventListener("scroll", onScroll, { passive: true });
  onScroll();

  const links = [...document.querySelectorAll(".nav a")];
  if (!links.length || !("IntersectionObserver" in window)) return;
  const spy = new IntersectionObserver((entries) => {
    entries.forEach((entry) => {
      if (!entry.isIntersecting) return;
      links.forEach((a) => a.classList.toggle("is-active", a.getAttribute("href") === `#${entry.target.id}`));
    });
  }, { rootMargin: "-45% 0px -50% 0px" });
  links.forEach((a) => { const s = document.querySelector(a.getAttribute("href")); if (s) spy.observe(s); });
}

/* ---------- Live chat ---------- */
function setChatOpen(isOpen) {
  if (!el.chatPanel) return;
  el.chatPanel.hidden = !isOpen;
  if (el.chatLauncher) el.chatLauncher.setAttribute("aria-expanded", String(isOpen));
  if (isOpen && el.chatInput) {
    if (!el.chatLog.children.length) {
      addChat("Hi! I'm the Dust Patrol assistant. Ask me about our services, the $50 price, or how to pay with EcoCash and InnBucks.", "bot");
    }
    el.chatInput.focus();
  }
}

function addChat(text, who) {
  const bubble = document.createElement("div");
  bubble.className = `chat-message ${who}`;
  bubble.textContent = text;
  el.chatLog.append(bubble);
  el.chatLog.scrollTop = el.chatLog.scrollHeight;
  return bubble;
}

async function askAssistant(message) {
  const thinking = addChat("Typing…", "bot");
  const fallback = "I couldn't reach our assistant just now. Please message us on WhatsApp at +263 774 502 737 and we'll help right away.";
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const response = await fetch("/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ message })
      });
      const data = await response.json();
      if (!response.ok || !data || data.ok !== true) throw new Error((data && data.error) || "chat failed");
      thinking.textContent = data.reply;
      el.chatLog.scrollTop = el.chatLog.scrollHeight;
      return;
    } catch (error) {
      if (attempt === 0) await new Promise((r) => setTimeout(r, 700));
    }
  }
  thinking.textContent = fallback;
}

function startChat() {
  if (!el.chatLauncher || !el.chatForm) return;
  el.chatLauncher.addEventListener("click", () => setChatOpen(el.chatPanel.hidden));
  if (el.chatClose) el.chatClose.addEventListener("click", () => setChatOpen(false));
  el.chatForm.addEventListener("submit", (event) => {
    event.preventDefault();
    const message = el.chatInput.value.trim();
    if (!message) return;
    addChat(message, "user");
    el.chatInput.value = "";
    askAssistant(message);
  });
}

/* ---------- Checkout ---------- */
const overlay = document.createElement("div");
overlay.className = "checkout-overlay";
overlay.hidden = true;
let pollTimer = null;

function stopPolling() { if (pollTimer) { clearInterval(pollTimer); pollTimer = null; } }
function closeCheckout() { stopPolling(); overlay.hidden = true; overlay.textContent = ""; }

function openCheckout() {
  if (!bagCanCheckout()) { showToast("Choose a package for each service first."); return; }
  renderCheckoutForm();
  overlay.hidden = false;
}

async function renderCheckoutForm() {
  const total = bag.reduce((sum, i) => sum + Number(i.price), 0);
  overlay.textContent = "";
  const card = document.createElement("div");
  card.className = "checkout-card";
  card.innerHTML = `
    <button class="checkout-close" id="checkout-close" type="button" aria-label="Close checkout">✕</button>
    <h2>Checkout</h2>
    <p class="checkout-sub">Book now. You get a reference and a receipt straight away.</p>
    <p class="checkout-summary">${bag.length} ${bag.length === 1 ? "service" : "services"} · Total <strong>${money(total)}</strong></p>
    <div class="checkout-error" id="checkout-error"></div>
    <form id="checkout-form">
      <label class="checkout-field"><span>Your name</span><input name="name" required maxlength="80" autocomplete="name"></label>
      <label class="checkout-field"><span>Phone (WhatsApp)</span><input name="phone" required maxlength="30" inputmode="tel" autocomplete="tel" placeholder="e.g. 0771234567"></label>
      <label class="checkout-field"><span>Where should we clean? (area, optional)</span><input name="location" maxlength="120" placeholder="e.g. Avondale, Harare"></label>
      <fieldset class="checkout-methods">
        <legend>How would you like to pay?</legend>
        <label class="method-option"><input type="radio" name="payment_method" value="ecocash" checked><span><b>EcoCash</b><small>A PIN prompt appears on your phone</small></span></label>
        <label class="method-option"><input type="radio" name="payment_method" value="innbucks"><span><b>InnBucks</b><small>Approve with a code in the InnBucks app</small></span></label>
        <label class="method-option"><input type="radio" name="payment_method" value="cash"><span><b>Cash</b><small>Pay on the day of the clean</small></span></label>
        <label class="method-option"><input type="radio" name="payment_method" value="bank_transfer"><span><b>Bank transfer</b><small>Account details sent on WhatsApp</small></span></label>
      </fieldset>
      <label class="checkout-field" id="ecocash-number-field"><span>EcoCash number (gets the PIN prompt)</span><input name="ecocash_phone" maxlength="20" inputmode="tel" placeholder="e.g. 0771234567"></label>
      <label class="checkout-field" id="innbucks-number-field" hidden><span>InnBucks number</span><input name="innbucks_phone" maxlength="20" inputmode="tel" placeholder="e.g. 0771234567"></label>
      <label class="checkout-field" id="payment-email-field"><span>Email address (needed for EcoCash / InnBucks)</span><input name="payment_email" type="email" maxlength="120" placeholder="you@example.com"></label>
      <p class="checkout-error" id="availability-note" hidden></p>
      <button class="checkout-primary" type="submit">Place booking</button>
    </form>`;
  overlay.append(card);

  const form = card.querySelector("#checkout-form");
  const ecoField = card.querySelector("#ecocash-number-field");
  const innField = card.querySelector("#innbucks-number-field");
  const emailField = card.querySelector("#payment-email-field");
  const note = card.querySelector("#availability-note");
  const refresh = () => {
    const chosen = form.elements.payment_method.value;
    ecoField.hidden = chosen !== "ecocash";
    innField.hidden = chosen !== "innbucks";
    emailField.hidden = chosen !== "ecocash" && chosen !== "innbucks";
  };
  form.querySelectorAll("input[name=payment_method]").forEach((r) => r.addEventListener("change", refresh));
  refresh();
  card.querySelector("#checkout-close").addEventListener("click", closeCheckout);

  try {
    const availability = await (await fetch("/api/payments/availability")).json();
    if (!availability || availability.online !== true) {
      form.querySelectorAll("input[name=payment_method]").forEach((r) => {
        if (r.value === "ecocash" || r.value === "innbucks") { r.disabled = true; r.closest(".method-option").style.opacity = ".45"; }
      });
      form.querySelector('input[value="cash"]').checked = true;
      refresh();
      note.textContent = "EcoCash and InnBucks are unavailable right now. You can still book and pay by cash or bank transfer.";
      note.hidden = false;
    }
  } catch (error) { /* keep all options */ }

  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    const errorBox = card.querySelector("#checkout-error");
    errorBox.textContent = "";
    const button = form.querySelector("button[type=submit]");
    button.disabled = true;
    button.textContent = "Placing booking…";
    try {
      const method = form.elements.payment_method.value;
      const response = await fetch("/api/checkout", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: form.elements.name.value.trim(),
          phone: form.elements.phone.value.trim(),
          location: form.elements.location.value.trim(),
          email: form.elements.payment_email.value.trim(),
          payment_method: method,
          mobile_phone: method === "ecocash" ? form.elements.ecocash_phone.value.trim() : form.elements.innbucks_phone.value.trim(),
          items: bag.map((i) => ({ variant_id: i.variantId, quantity: 1 }))
        })
      });
      const data = await response.json();
      if (!response.ok || !data || data.ok !== true) throw new Error((data && data.error) || "Checkout is not available right now.");
      if (data.paynow && data.paynow.started && data.status_url) {
        bag = []; saveBag();
        window.location.href = data.status_url;
        return;
      }
      renderCheckoutDone(data.order, data.paynow, data.receipt_url);
      bag = []; saveBag(); setDrawerOpen(false);
    } catch (error) {
      errorBox.textContent = error.message;
      button.disabled = false;
      button.textContent = "Place booking";
    }
  });
}

function renderCheckoutDone(order, paynow, receiptUrl) {
  const names = { ecocash: "EcoCash", innbucks: "InnBucks", cash: "cash", bank_transfer: "bank transfer" };
  const failedOnline = paynow && paynow.started === false;
  const text = `Hi Dust Patrol, I just placed booking ${order.reference} (${money(order.total)}). I chose ${names[order.payment_method] || "my payment method"}.`;
  overlay.textContent = "";
  const card = document.createElement("div");
  card.className = "checkout-card";
  card.innerHTML = `
    <button class="checkout-close" id="checkout-close" type="button" aria-label="Close">✕</button>
    <h2>Booking placed ✓</h2>
    <p class="checkout-sub">Keep this reference. It is your proof of booking.</p>
    <p class="checkout-reference">${escapeHtml(order.reference)}</p>
    <p class="checkout-summary">Total <strong>${money(order.total)}</strong> · ${escapeHtml(names[order.payment_method] || "")}</p>
    ${failedOnline ? `<div class="checkout-warning">Online payment did not start: ${escapeHtml(paynow.error || "Paynow is not reachable right now")}. Your booking is saved. Please confirm on WhatsApp and we will sort it out.</div>` : ""}
    <a class="checkout-primary" href="https://wa.me/${WHATSAPP_NUMBER}?text=${encodeURIComponent(text)}" target="_blank" rel="noopener noreferrer">Confirm on WhatsApp</a>
    ${receiptUrl ? `<p class="checkout-note"><a class="checkout-link" href="${escapeHtml(receiptUrl)}">View your receipt</a></p>` : ""}`;
  overlay.append(card);
  card.querySelector("#checkout-close").addEventListener("click", closeCheckout);
}

/* ---------- Enquiry on WhatsApp ---------- */
function sendWhatsAppEnquiry() {
  if (!bag.length) return;
  const lines = bag.map((i) => `- ${i.name} (${i.size})${i.price !== null && i.price !== undefined ? ` - ${money(i.price)}` : ""}`).join("\n");
  const priced = bag.every((i) => i.price !== null && i.price !== undefined);
  const total = priced ? money(bag.reduce((s, i) => s + Number(i.price), 0)) : "to be confirmed";
  const message = `Hi Dust Patrol, I'd like to book:\n${lines}\nTotal: ${total}. Please confirm availability and your earliest date. Thank you!`;
  window.open(`https://wa.me/${WHATSAPP_NUMBER}?text=${encodeURIComponent(message)}`, "_blank", "noopener,noreferrer");
}

/* ---------- Boot: each feature is isolated ---------- */
function boot(name, fn) {
  try { fn(); } catch (error) { console.error(`Dust Patrol: "${name}" failed to start`, error); }
}

function startControls() {
  document.body.append(overlay);
  document.querySelectorAll(".filter-button").forEach((button) => {
    button.addEventListener("click", () => {
      activeFilter = button.dataset.filter;
      document.querySelectorAll(".filter-button").forEach((b) => b.setAttribute("aria-pressed", String(b === button)));
      filterServices();
    });
  });
  if (el.search) el.search.addEventListener("input", filterServices);
  if (el.openBag) el.openBag.addEventListener("click", () => setDrawerOpen(true));
  if (el.closeBag) el.closeBag.addEventListener("click", () => setDrawerOpen(false));
  if (el.backdrop) el.backdrop.addEventListener("click", () => setDrawerOpen(false));
  if (el.siteCheckout) el.siteCheckout.addEventListener("click", openCheckout);
  if (el.sendEnquiry) el.sendEnquiry.addEventListener("click", sendWhatsAppEnquiry);
  document.addEventListener("keydown", (event) => {
    if (event.key !== "Escape") return;
    setDrawerOpen(false);
    if (el.chatPanel && !el.chatPanel.hidden) setChatOpen(false);
    if (!overlay.hidden) closeCheckout();
  });
}

boot("chat", startChat);
boot("controls", startControls);
boot("bag", renderBag);
boot("scroll effects", startScrollEffects);
boot("typed text", startTypedText);
boot("counters", startCounters);
boot("reveals", observeReveals);
boot("services", loadServices);
