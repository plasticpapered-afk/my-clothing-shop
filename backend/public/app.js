    const whatsappNumber = "263789973632";
    const bagStorageKey = "internal-frontier-inquiry-bag";
    const bagDrawer = document.getElementById("bag-drawer");
    const bagItems = document.getElementById("bag-items");
    const bagCount = document.getElementById("bag-count");
    const sendEnquiry = document.getElementById("send-enquiry");
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
        return Array.isArray(savedBag) ? savedBag.filter((item) => item && typeof item.name === "string" && typeof item.size === "string") : [];
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

    function renderBag() {
      bagCount.textContent = String(inquiryBag.length);
      sendEnquiry.disabled = inquiryBag.length === 0;
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
        details.append(name, size);
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
          inquiryBag.push({
            name: product.dataset.name.replace(/\b\w/g, (letter) => letter.toUpperCase()),
            size: sizeSelect.value,
            image: product.querySelector("img").src
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
      const sizes = [...new Set(product.variants.map((variant) => variant.size || "One size"))];
      sizes.forEach((size) => {
        const option = document.createElement("option");
        option.textContent = size;
        sizeSelect.append(option);
      });
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
      const productLines = inquiryBag.map((item) => `- ${item.name} (size ${item.size})`).join("\n");
      const message = `Hi Internal Frontier, I'd like to ask about these pieces:\n${productLines}\nPlease share pricing and availability. Thank you!`;
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
