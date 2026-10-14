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
        const matchesSearch = product.dataset.name.includes(query);
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

      try {
        const response = await fetch("/api/chat", {
          method: "POST",
          headers: {
            "Content-Type": "application/json"
          },
          body: JSON.stringify({ message })
        });

        const data = await response.json();
        if (!response.ok || !data || data.ok !== true) {
          throw new Error((data && data.error) || "Chat request failed");
        }

        if (status) status.textContent = "AI assistant online";
        appendChatMessage(data.reply, "assistant");
      } catch (error) {
        if (status) status.textContent = "AI assistant unavailable";
        appendChatMessage("Thanks for reaching out. For the quickest answer, send us a WhatsApp message and we’ll confirm the details for you.", "assistant");
      }
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
    filterProducts();
    setupScrollReveals();
    } catch (setupError) {
      console.error("Shop setup error:", setupError);
    }
