    const whatsappNumber = "263789973632";
    const bagStorageKey = "internal-frontier-inquiry-bag";
    const bagDrawer = document.getElementById("bag-drawer");
    const bagItems = document.getElementById("bag-items");
    const bagCount = document.getElementById("bag-count");
    const sendEnquiry = document.getElementById("send-enquiry");
    const siteCheckout = document.getElementById("site-checkout");
    const bagTotalLine = document.getElementById("bag-total-line");
    const drawerBackdrop = document.getElementById("drawer-backdrop");
    const toast = document.getElementById("toast");
    const chatPanel = document.getElementById("chat-panel");
    const chatLauncher = document.getElementById("open-chat");
    const chatLog = document.getElementById("chat-log");
    const chatInput = document.getElementById("chat-input");
    const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)");

    // Chat open/close wired first so no later error can break the chat button
    let activeFilter = "all";
    let toastTimer;
    let inquiryBag = loadBag();

    function loadBag() {
      try {
        const savedBag = JSON.parse(localStorage.getItem(bagStorageKey) || "[]");
        return Array.isArray(savedBag)
          ? savedBag.filter((item) => item && typeof item.name === "string" && typeof item.size === "string")
          : [];
      } catch {
        return [];
      }
    }

    function saveBag() {
      try {
        localStorage.setItem(bagStorageKey, JSON.stringify(inquiryBag));
      } catch {
        showToast("Your bag is available for this visit only.");
      }
      renderBag();
    }

    function showToast(message) {
      toast.textContent = message;
      toast.classList.add("is-visible");
      window.clearTimeout(toastTimer);
      toastTimer = window.setTimeout(() => toast.classList.remove("is-visible"), 2400);
    }

    function bagCanCheckout() {
      return inquiryBag.length > 0 && inquiryBag.every((item) => item.variantId && item.price !== null && item.price !== undefined);
    }

    function renderBag() {
      bagCount.textContent = String(inquiryBag.length);
      sendEnquiry.disabled = inquiryBag.length === 0;
      if (siteCheckout) siteCheckout.disabled = !bagCanCheckout();
      if (bagTotalLine) {
        if (bagCanCheckout()) {
          bagTotalLine.textContent = `Total: $${inquiryBag.reduce((sum, item) => sum + Number(item.price), 0).toFixed(2)}`;
          bagTotalLine.hidden = false;
        } else {
          bagTotalLine.hidden = true;
        }
      }
      bagItems.textContent = "";

      if (!inquiryBag.length) {
        const emptyMessage = document.createElement("p");
        emptyMessage.className = "bag-empty";
        emptyMessage.textContent = "Your enquiry bag is empty. Add a piece from the collection to get started.";
        bagItems.append(emptyMessage);
        return;
      }

      inquiryBag.forEach((item, index) => {
        const row = document.createElement("div");
        row.className = "bag-item";
        const image = document.createElement("img");
        image.src = item.image;
        image.alt = "";
        const details = document.createElement("div");
        const name = document.createElement("h3");
        name.textContent = item.name;
        const size = document.createElement("p");
        size.textContent = `Size: ${item.size}`;
        const price = document.createElement("p");
        price.textContent = item.price === null || item.price === undefined ? "Price on request" : `$${Number(item.price).toFixed(2)}`;
        details.append(name, size, price);
        const remove = document.createElement("button");
        remove.className = "remove-item";
        remove.type = "button";
        remove.textContent = "Remove";
        remove.setAttribute("aria-label", `Remove ${item.name}, size ${item.size}`);
        remove.addEventListener("click", () => {
          inquiryBag.splice(index, 1);
          saveBag();
        });
        row.append(image, details, remove);
        bagItems.append(row);
      });
    }

    function setDrawerOpen(isOpen) {
      bagDrawer.classList.toggle("is-open", isOpen);
      bagDrawer.setAttribute("aria-hidden", String(!isOpen));
      bagDrawer.toggleAttribute("inert", !isOpen);
      drawerBackdrop.hidden = !isOpen;
      document.body.style.overflow = isOpen ? "hidden" : "";
      if (isOpen) document.getElementById("close-bag").focus();
      else document.getElementById("open-bag").focus();
    }

    function filterProducts() {
      const query = document.getElementById("product-search").value.trim().toLowerCase();
      const products = [...document.querySelectorAll(".product")];
      let visibleCount = 0;

      products.forEach((product) => {
        const matchesCategory = activeFilter === "all" || product.dataset.category === activeFilter;
        const matchesSearch = product.dataset.name.toLowerCase().includes(query);
        product.hidden = !matchesCategory || !matchesSearch;
        if (!product.hidden) visibleCount += 1;
      });

      document.getElementById("empty-results").hidden = visibleCount !== 0;
      document.getElementById("result-count").textContent = `${visibleCount} ${visibleCount === 1 ? "piece" : "pieces"}`;
    }

    function setChatOpen(isOpen) {
      chatPanel.hidden = !isOpen;
      chatPanel.setAttribute("aria-hidden", String(!isOpen));
      chatPanel.toggleAttribute("inert", !isOpen);
      chatLauncher.setAttribute("aria-expanded", String(isOpen));
      if (isOpen) chatInput.focus();
      else chatLauncher.focus();
    }

    function appendChatMessage(message, sender) {
      const messageElement = document.createElement("div");
      messageElement.className = `chat-message chat-message-${sender}`;
      messageElement.textContent = message;
      chatLog.append(messageElement);
      chatLog.scrollTop = chatLog.scrollHeight;
    }

    async function respondToChatMessage(message) {
      const status = document.querySelector(".chat-status");
      const fallback = "Thanks for reaching out. For the quickest answer, send us a WhatsApp message and we\u2019ll confirm the details for you.";

      for (let attempt = 0; attempt < 2; attempt++) {
        try {
          const response = await fetch("/api/chat", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ message })
          });
          const data = await response.json();
          if (!response.ok || !data || data.ok !== true) {
            throw new Error((data && data.error) || "Chat request failed");
          }
          if (status) status.textContent = "AI assistant online";
          appendChatMessage(data.reply, "assistant");
          return;
        } catch (error) {
          if (attempt === 0) await new Promise((resolve) => setTimeout(resolve, 800));
        }
      }

      if (status) status.textContent = "AI assistant busy";
      appendChatMessage(fallback, "assistant");
    }

    function setupScrollReveals() {
      if (reducedMotion.matches || !("IntersectionObserver" in window)) return;

      const revealTargets = document.querySelectorAll(".manifesto, .section-top, .shop-controls, .product, .story-image, .story-copy");
      revealTargets.forEach((target, index) => {
        target.classList.add("scroll-reveal");
        if (target.classList.contains("product")) {
          target.style.setProperty("--reveal-delay", `${(index % 3) * 85}ms`);
        }
      });

      document.body.classList.add("motion-enabled");
      const revealObserver = new IntersectionObserver((entries, observer) => {
        entries.forEach((entry) => {
          if (!entry.isIntersecting) return;
          entry.target.classList.add("is-visible");
          observer.unobserve(entry.target);
        });
      }, { threshold: 0.12, rootMargin: "0px 0px -35px 0px" });

      revealTargets.forEach((target) => revealObserver.observe(target));
    }

    const CATEGORY_LABELS = { tops: "Tops", sets: "Tracksuits", jerseys: "Jerseys", accessories: "Accessories", other: "Other" };

    function wireAddButtons() {
      document.querySelectorAll(".add-button").forEach((button) => {
        button.addEventListener("click", () => {
          const product = button.closest(".product");
          const sizeSelect = product.querySelector(".size-select");
          if (!sizeSelect.value) {
            sizeSelect.focus();
            showToast("Choose a size before adding this piece.");
            return;
          }
          const selectedOption = sizeSelect.selectedOptions[0];
          const variantId = selectedOption && selectedOption.dataset.variantId ? Number(selectedOption.dataset.variantId) : null;
          const selectedPrice = selectedOption && selectedOption.dataset.price !== undefined && selectedOption.dataset.price !== "" && selectedOption.dataset.price !== "null"
            ? Number(selectedOption.dataset.price)
            : null;
          inquiryBag.push({
            name: product.dataset.name.replace(/\b\w/g, (letter) => letter.toUpperCase()),
            size: sizeSelect.value,
            image: product.querySelector("img").src,
            variantId: Number.isFinite(variantId) ? variantId : null,
            price: selectedPrice !== null && Number.isFinite(selectedPrice) ? selectedPrice : null
          });
          saveBag();
          showToast("Added to your enquiry bag.");
        });
      });
    }

    function buildProductCard(product, indexInCategory) {
      const article = document.createElement("article");
      article.className = "product";
      article.dataset.category = product.category;
      article.dataset.name = product.name.toLowerCase();

      const image = document.createElement("div");
      image.className = "product-image";
      const img = document.createElement("img");
      img.src = product.image_url || "";
      img.alt = product.name;
      img.loading = "lazy";
      const label = document.createElement("span");
      label.className = "product-label";
      label.textContent = product.label || CATEGORY_LABELS[product.category] || "Shop";
      image.append(img, label);

      const info = document.createElement("div");
      info.className = "product-info";
      const category = document.createElement("span");
      category.className = "product-category";
      category.textContent = `${CATEGORY_LABELS[product.category] || "Shop"} / ${String(indexInCategory + 1).padStart(2, "0")}`;
      const name = document.createElement("h3");
      name.textContent = product.name;
      const price = document.createElement("p");
      price.className = "product-price";
      price.textContent = product.price === null || product.price === undefined ? "Price on request" : `$${Number(product.price).toFixed(2)}`;

      const actions = document.createElement("div");
      actions.className = "product-actions";
      const sizeWrap = document.createElement("label");
      const sizeLabel = document.createElement("span");
      sizeLabel.className = "sr-only";
      sizeLabel.textContent = `Choose size for ${product.name}`;
      const sizeSelect = document.createElement("select");
      sizeSelect.className = "size-select";
      sizeSelect.setAttribute("aria-label", `Size for ${product.name}`);
      const choose = document.createElement("option");
      choose.value = "";
      choose.textContent = "Choose size";
      sizeSelect.append(choose);
      product.variants.forEach((variant) => {
        const option = document.createElement("option");
        option.value = String(variant.id);
        option.textContent = [variant.size, variant.colour].filter(Boolean).join(" / ") || "One size";
        const price = variant.price !== null && variant.price !== undefined
          ? Number(variant.price)
          : (product.price !== null && product.price !== undefined ? Number(product.price) : null);
        option.dataset.variantId = String(variant.id);
        option.dataset.price = price === null ? "" : String(price);
        sizeSelect.append(option);
      });
      if (product.variants.length === 0) {
        const option = document.createElement("option");
        option.textContent = "One size";
        sizeSelect.append(option);
      }
      sizeWrap.append(sizeLabel, sizeSelect);
      const addButton = document.createElement("button");
      addButton.className = "add-button";
      addButton.type = "button";
      addButton.textContent = "Add to enquiry";
      actions.append(sizeWrap, addButton);

      info.append(category, name, price, actions);
      article.append(image, info);
      return article;
    }

    // Loads the live catalogue from the back office. If it is unavailable the
    // shop keeps the pieces built into the page, so it never looks empty.
    async function loadLiveProducts() {
      try {
        const response = await fetch("/api/products");
        if (!response.ok) return;
        const data = await response.json();
        if (!data || data.ok !== true || !Array.isArray(data.products) || data.products.length === 0) return;
        const grid = document.getElementById("product-grid");
        grid.querySelectorAll(".product").forEach((card) => card.remove());
        const counters = {};
        data.products.forEach((product) => {
          counters[product.category] = (counters[product.category] || 0) + 1;
          grid.append(buildProductCard(product, counters[product.category] - 1));
        });
        wireAddButtons();
        setupScrollReveals();
        filterProducts();
      } catch (error) {
        // The built-in products remain on screen.
      }
    }

    // ---------- Website checkout ----------
    // Customers place the order on the site, choose how they want to pay
    // (EcoCash, cash on delivery or bank transfer) and get a reference.
    // Payment is confirmed by the shop on WhatsApp, and staff record the money
    // in the back office.

    const checkoutOverlay = document.createElement("div");
    checkoutOverlay.className = "checkout-overlay";
    checkoutOverlay.id = "checkout-overlay";
    checkoutOverlay.hidden = true;
    document.body.append(checkoutOverlay);

    function closeCheckout() {
      stopPaymentPolling();
      checkoutOverlay.hidden = true;
      checkoutOverlay.textContent = "";
    }

    function openCheckout() {
      if (!bagCanCheckout()) {
        showToast("Some pieces need prices set by the shop. Please enquire on WhatsApp.");
        return;
      }
      renderCheckoutForm();
      checkoutOverlay.hidden = false;
    }

    async function renderCheckoutForm() {
      const total = inquiryBag.reduce((sum, item) => sum + Number(item.price), 0);
      checkoutOverlay.textContent = "";
      const card = document.createElement("div");
      card.className = "checkout-card";
      card.innerHTML = `
        <button class="checkout-close" id="checkout-close" type="button" aria-label="Close checkout">×</button>
        <h2>Checkout</h2>
        <p class="checkout-sub">Place your order now. We confirm payment and delivery on WhatsApp.</p>
        <p class="checkout-summary">${inquiryBag.length} ${inquiryBag.length === 1 ? "piece" : "pieces"} · Total <strong>$${total.toFixed(2)}</strong></p>
        <div class="checkout-error" id="checkout-error"></div>
        <form id="checkout-form">
          <label class="checkout-field"><span>Your name</span><input name="name" required maxlength="80" autocomplete="name"></label>
          <label class="checkout-field"><span>Phone (WhatsApp)</span><input name="phone" required maxlength="30" inputmode="tel" autocomplete="tel" placeholder="e.g. 0771234567"></label>
          <label class="checkout-field"><span>Delivery area (optional)</span><input name="location" maxlength="120" placeholder="e.g. Avondale, Harare"></label>
          <p class="checkout-field" style="margin-bottom:8px"><span>How would you like to pay?</span></p>
          <div class="payment-choices">
            <label class="payment-choice"><input type="radio" name="payment_method" value="ecocash" checked><span><strong>EcoCash</strong><small>Approve with your PIN on your phone</small></span></label>
            <label class="payment-choice"><input type="radio" name="payment_method" value="innbucks"><span><strong>InnBucks</strong><small>Approve with a code in the InnBucks app</small></span></label>
            <label class="payment-choice"><input type="radio" name="payment_method" value="cash"><span><strong>Cash on delivery</strong><small>Pay when your order arrives</small></span></label>
            <label class="payment-choice"><input type="radio" name="payment_method" value="bank_transfer"><span><strong>Bank transfer</strong><small>Account details sent on WhatsApp</small></span></label>
          </div>
          <label class="checkout-field" id="ecocash-number-field" hidden><span>Your EcoCash number (the one that gets the PIN prompt)</span><input name="ecocash_phone" maxlength="20" inputmode="tel" placeholder="e.g. 0771234567"></label>
          <label class="checkout-field" id="innbucks-number-field" hidden><span>Your InnBucks number (the wallet to pay from)</span><input name="innbucks_phone" maxlength="20" inputmode="tel" placeholder="e.g. 0771234567"></label>
          <label class="checkout-field" id="payment-email-field" hidden><span>Your email address (required for EcoCash / InnBucks payments)</span><input name="payment_email" type="email" maxlength="120" placeholder="you@example.com"></label>
          <p class="checkout-error" id="availability-note" hidden></p>
          <button class="checkout-primary" type="submit">Place order</button>
          <button class="checkout-secondary" type="button" id="checkout-cancel">Back to the shop</button>
        </form>`;
      const ecocashField = card.querySelector("#ecocash-number-field");
      const innbucksField = card.querySelector("#innbucks-number-field");
      const emailField = card.querySelector("#payment-email-field");
      const availabilityNote = card.querySelector("#availability-note");
      const form = card.querySelector("#checkout-form");
      const updateMobileField = () => {
        const chosen = form.elements.payment_method.value;
        ecocashField.hidden = chosen !== "ecocash";
        innbucksField.hidden = chosen !== "innbucks";
        emailField.hidden = chosen !== "ecocash" && chosen !== "innbucks";
      };
      [...form.querySelectorAll("input[name=payment_method]")].forEach((radio) => {
        radio.addEventListener("change", updateMobileField);
      });
      updateMobileField();
      // Never offer EcoCash / InnBucks when online payments are switched off,
      // so nobody waits for a prompt that will never come.
      try {
        const availability = await fetch("/api/payments/availability");
        const availabilityData = await availability.json();
        if (!availabilityData || availabilityData.online !== true) {
          const mobileChoices = [...form.querySelectorAll("input[name=payment_method]")].filter((radio) => radio.value === "ecocash" || radio.value === "innbucks");
          mobileChoices.forEach((radio) => {
            radio.disabled = true;
            radio.closest(".payment-choice").style.opacity = "0.45";
          });
          if (form.elements.payment_method.value === "ecocash" || form.elements.payment_method.value === "innbucks") {
            form.querySelector('input[name="payment_method"][value="cash"]').checked = true;
          }
          updateMobileField();
          availabilityNote.textContent = "Online EcoCash / InnBucks payment is temporarily unavailable. You can still order and pay on delivery or by bank transfer.";
          availabilityNote.classList.add("is-visible");
          availabilityNote.hidden = false;
        }
      } catch (error) { /* keep all options; worst case the order still goes through */ }
      checkoutOverlay.append(card);
      card.querySelector("#checkout-close").addEventListener("click", closeCheckout);
      card.querySelector("#checkout-cancel").addEventListener("click", closeCheckout);
      card.querySelector("#checkout-form").addEventListener("submit", async (event) => {
        event.preventDefault();
        const form = event.currentTarget;
        const errorBox = card.querySelector("#checkout-error");
        errorBox.classList.remove("is-visible");
        const button = form.querySelector("button[type=submit]");
        button.disabled = true;
        button.textContent = "Placing order...";
        try {
          const response = await fetch("/api/checkout", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              name: form.elements.name.value.trim(),
              phone: form.elements.phone.value.trim(),
              location: form.elements.location.value.trim(),
          email: form.elements.payment_email ? form.elements.payment_email.value.trim() : "",
              payment_method: form.elements.payment_method.value,
              mobile_phone: form.elements.payment_method.value === "ecocash"
                ? (form.elements.ecocash_phone ? form.elements.ecocash_phone.value.trim() : "")
                : (form.elements.innbucks_phone ? form.elements.innbucks_phone.value.trim() : ""),
              items: inquiryBag.map((item) => ({ variant_id: item.variantId, quantity: 1 }))
            })
          });
          const data = await response.json();
          if (!response.ok || !data || data.ok !== true) {
            throw new Error((data && data.error) || "Checkout is not available right now.");
          }
          const onlineStarted = data.paynow && data.paynow.started;
          if (onlineStarted && data.status_url) {
            window.location.href = data.status_url;
            return;
          }
          renderCheckoutSuccess(data.order, data.paynow, data.receipt_url);
          inquiryBag = [];
          saveBag();
          setDrawerOpen(false);
        } catch (error) {
          errorBox.textContent = error.message;
          errorBox.classList.add("is-visible");
          button.disabled = false;
          button.textContent = "Place order";
        }
      });
    }

    let paymentPollTimer = null;

    function stopPaymentPolling() {
      if (paymentPollTimer) {
        window.clearInterval(paymentPollTimer);
        paymentPollTimer = null;
      }
    }

    function renderCheckoutSuccess(order, paynow, receiptUrl) {
      stopPaymentPolling();
      const methodNames = { ecocash: "EcoCash", innbucks: "InnBucks", cash: "cash on delivery", bank_transfer: "bank transfer", other: "your chosen method" };
      const methodName = methodNames[order.payment_method] || "your chosen method";
      const onlineStarted = paynow && paynow.started;
      checkoutOverlay.textContent = "";
      const card = document.createElement("div");
      card.className = "checkout-card";

      const base = `
        <button class="checkout-close" id="checkout-close" type="button" aria-label="Close checkout">×</button>
        <h2>${onlineStarted ? "Approve the payment" : "Order placed"}</h2>
        <p class="checkout-sub">Keep this reference. It is your proof of the order.</p>
        <p class="checkout-success-ref">${order.reference}</p>
        <p class="checkout-summary">Total <strong>$${order.total.toFixed(2)}</strong> · paying by <strong>${methodName}</strong></p>`;

      if (onlineStarted && order.payment_method === "ecocash") {
        card.innerHTML = `${base}
          <p class="checkout-sub">Check your phone now. EcoCash will ask you to enter your PIN to approve <strong>$${order.total.toFixed(2)}</strong>${paynow.phone ? ` on ${paynow.phone}` : ""}. Leave this page open.</p>
          <p class="checkout-summary" id="payment-status">⏳ Waiting for your approval...</p>
          ${receiptUrl ? `<a class="checkout-secondary" href="${receiptUrl}">View receipt</a>` : ""}
          <button class="checkout-secondary" type="button" id="checkout-done">I'll confirm later</button>`;
        checkoutOverlay.append(card);
        card.querySelector("#checkout-close").addEventListener("click", closeCheckout);
        card.querySelector("#checkout-done").addEventListener("click", closeCheckout);
        startPaymentPolling(order, card, receiptUrl);
        return;
      }

      if (onlineStarted && order.payment_method === "innbucks") {
        card.innerHTML = `${base}
          <p class="checkout-sub">Open the InnBucks app and approve the payment using this code, or tap the button below.</p>
          <p class="checkout-success-ref">${paynow.authorizationcode || ""}</p>
          ${paynow.authorizationexpires ? `<p class="checkout-sub">This code expires ${paynow.authorizationexpires}.</p>` : ""}
          ${paynow.authorizationcode ? `<a class="checkout-primary" style="text-decoration:none" href="com.innbucks.customer://purchase?paymentToken=${paynow.authorizationcode}">Open in InnBucks app</a>` : ""}
          <p class="checkout-summary" id="payment-status">⏳ Waiting for your approval...</p>
          ${receiptUrl ? `<a class="checkout-secondary" href="${receiptUrl}">View receipt</a>` : ""}
          <button class="checkout-secondary" type="button" id="checkout-done">I'll confirm later</button>`;
        checkoutOverlay.append(card);
        card.querySelector("#checkout-close").addEventListener("click", closeCheckout);
        card.querySelector("#checkout-done").addEventListener("click", closeCheckout);
        startPaymentPolling(order, card, receiptUrl);
        return;
      }

      const failedOnline = paynow && paynow.started === false;
      const note = failedOnline
        ? `Online payment did not start: ${(paynow.error || "Paynow is not reachable right now")}. Your order is safe with reference ${order.reference}. Please pay on WhatsApp and we'll sort it out.`
        : `We'll confirm your order on WhatsApp with ${order.payment_method === "bank_transfer" ? "our bank details" : "payment and delivery details"}.`;
      const message = `Hi Internal Frontier, I just placed order ${order.reference} ($${order.total.toFixed(2)}). I chose ${methodName}.`;
      card.innerHTML = `${base}
        <div class="checkout-error ${failedOnline ? "is-visible" : ""}">${failedOnline ? note : ""}</div>
        <p class="checkout-sub">${failedOnline ? "Your order is saved. Pay directly with us on WhatsApp:" : note}</p>
        <a class="checkout-primary" style="text-decoration:none" href="https://wa.me/${whatsappNumber}?text=${encodeURIComponent(message)}" target="_blank" rel="noopener noreferrer">Confirm on WhatsApp</a>
        ${receiptUrl ? `<a class="checkout-secondary" href="${receiptUrl}">View receipt</a>` : ""}
        <button class="checkout-secondary" type="button" id="checkout-done">Done</button>`;
      checkoutOverlay.append(card);
      card.querySelector("#checkout-close").addEventListener("click", closeCheckout);
      card.querySelector("#checkout-done").addEventListener("click", closeCheckout);
    }

    // Asks our site every few seconds whether Paynow has confirmed the
    // customer's payment, and updates the screen the moment it lands.
    function startPaymentPolling(order, card, receiptUrl) {
      let attempts = 0;
      const statusLine = card.querySelector("#payment-status");
      paymentPollTimer = window.setInterval(async () => {
        attempts += 1;
        if (attempts > 40) {
          stopPaymentPolling();
          if (statusLine) statusLine.textContent = "Still waiting on Paynow. Your order is safe - it will update automatically.";
          return;
        }
        try {
          const response = await fetch("/api/payments/paynow/status", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ reference: order.reference })
          });
          const data = await response.json();
          if (!response.ok || !data || data.ok !== true) return;
          if (data.status === "paid") {
            stopPaymentPolling();
            const message = `Hi Internal Frontier, I paid for order ${order.reference} online. Please confirm you received it.`;
            card.innerHTML = `
              <button class="checkout-close" id="checkout-close" type="button" aria-label="Close checkout">×</button>
              <h2>Payment received 🎉</h2>
              <p class="checkout-sub">Thank you! Your payment for ${order.reference} went through.</p>
              <p class="checkout-success-ref">${order.reference}</p>
              <p class="checkout-summary">Total <strong>$${order.total.toFixed(2)}</strong> · <strong>PAID</strong></p>
              ${receiptUrl ? `<a class="checkout-primary" style="text-decoration:none" href="${receiptUrl}">View receipt</a>` : ""}
              <a class="checkout-secondary" href="https://wa.me/${whatsappNumber}?text=${encodeURIComponent(message)}" target="_blank" rel="noopener noreferrer">Message us on WhatsApp</a>
              <button class="checkout-secondary" type="button" id="checkout-done">Done</button>`;
            card.querySelector("#checkout-close").addEventListener("click", closeCheckout);
            card.querySelector("#checkout-done").addEventListener("click", closeCheckout);
          } else if (data.status === "cancelled") {
            stopPaymentPolling();
            if (statusLine) statusLine.textContent = "This payment was cancelled. If that is a surprise, message us on WhatsApp.";
          } else if (statusLine) {
            statusLine.textContent = "⏳ Waiting for your approval...";
          }
        } catch (error) {
          // keep waiting; a network blip is not the customer's problem
        }
      }, 4500);
    }

    try {
    document.querySelectorAll(".filter-button").forEach((button) => {
      button.addEventListener("click", () => {
        activeFilter = button.dataset.filter;
        document.querySelectorAll(".filter-button").forEach((filterButton) => {
          filterButton.setAttribute("aria-pressed", String(filterButton === button));
        });
        filterProducts();
      });
    });

    document.getElementById("product-search").addEventListener("input", filterProducts);
    document.getElementById("open-bag").addEventListener("click", () => setDrawerOpen(true));
    if (siteCheckout) siteCheckout.addEventListener("click", openCheckout);
    document.getElementById("close-bag").addEventListener("click", () => setDrawerOpen(false));
    drawerBackdrop.addEventListener("click", () => setDrawerOpen(false));
    document.addEventListener("keydown", (event) => {
      if (event.key === "Escape" && bagDrawer.classList.contains("is-open")) setDrawerOpen(false);
      if (event.key === "Escape" && !chatPanel.hidden) setChatOpen(false);
    });
    chatLauncher.addEventListener("click", () => setChatOpen(chatPanel.hidden));
    document.getElementById("close-chat").addEventListener("click", () => setChatOpen(false));
    document.getElementById("chat-form").addEventListener("submit", (event) => {
      event.preventDefault();
      const message = chatInput.value.trim();
      if (!message) return;
      appendChatMessage(message, "user");
      chatInput.value = "";
      respondToChatMessage(message);
    });
    sendEnquiry.addEventListener("click", () => {
      if (!inquiryBag.length) return;
      const productLines = inquiryBag.map((item) => {
        let line = `- ${item.name} (size ${item.size})`;
        if (item.price !== null && item.price !== undefined) line += ` - $${Number(item.price).toFixed(2)}`;
        return line;
      }).join("\n");
      const allPriced = inquiryBag.every((item) => item.price !== null && item.price !== undefined);
      const total = allPriced ? `$${inquiryBag.reduce((sum, item) => sum + Number(item.price), 0).toFixed(2)}` : "to be confirmed";
      const message = `Hi Internal Frontier, I'd like to ask about these pieces:\n${productLines}\nTotal: ${total}. Please confirm availability. Thank you!`;
      window.open(`https://wa.me/${whatsappNumber}?text=${encodeURIComponent(message)}`, "_blank", "noopener,noreferrer");
      // Message is on its way to WhatsApp: empty the bag and go back to zero
      inquiryBag = [];
      saveBag();
      setDrawerOpen(false);
      showToast("Enquiry sent to WhatsApp. Your bag is clear.");
    });

    renderBag();
    wireAddButtons();
    filterProducts();
    setupScrollReveals();
    loadLiveProducts();
    } catch (setupError) {
      console.error("Shop setup error:", setupError);
    }
