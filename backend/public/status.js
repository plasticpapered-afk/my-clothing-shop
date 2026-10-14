// Payment status page: polls for approval and lets the customer ask for a
// fresh payment prompt when the first one never arrived (weak signal etc.).
(function () {
  const script = document.getElementById("status-script") || document.querySelector('script[src="/status.js"]');
  const reference = script ? script.dataset.reference : "";
  const method = script ? script.dataset.method : "";
  const online = script ? script.dataset.online === "true" : false;
  const total = script ? script.dataset.total : "";
  const whatsappNumber = "263789973632";

  const badge = document.getElementById("status-badge");
  const instructions = document.getElementById("instructions");
  const authCode = document.getElementById("auth-code");
  const authExpiry = document.getElementById("auth-expiry");
  const innbucksOpen = document.getElementById("innbucks-open");
  const retryBtn = document.getElementById("retry-btn");
  const whatsappBtn = document.getElementById("whatsapp-btn");
  const pollNote = document.getElementById("poll-note");
  const errorBox = document.getElementById("error-box");

  const waMessage = encodeURIComponent(`Hi Internal Frontier, about order ${reference} ($${total}). `);

  function setError(message) {
    if (!errorBox) return;
    errorBox.textContent = message || "";
    errorBox.classList.toggle("visible", Boolean(message));
  }

  function showInstructions() {
    if (method === "ecocash") {
      instructions.innerHTML = "Check your phone for the EcoCash prompt and enter your PIN to approve $" + total + ". It can take a minute or two, and it works best with a decent signal.";
    } else if (method === "innbucks") {
      instructions.innerHTML = "Open the InnBucks app and approve the payment with this code:";
    } else {
      instructions.innerHTML = "We have your order. Our team will confirm payment and delivery with you on WhatsApp.";
    }
  }

  function showInnbucksCode(code, expires) {
    if (!code) return;
    authCode.textContent = code;
    authCode.hidden = false;
    if (expires) {
      authExpiry.textContent = "This code expires " + expires;
      authExpiry.hidden = false;
    }
    innbucksOpen.href = "com.innbucks.customer://purchase?paymentToken=" + code;
    innbucksOpen.hidden = false;
  }

  function updateBadge(state) {
    if (state === "paid") {
      badge.textContent = "✓ Payment approved";
      badge.className = "badge approved";
      instructions.textContent = "Your payment went through. Thank you! Your receipt is below.";
      authCode.hidden = true;
      authExpiry.hidden = true;
      innbucksOpen.hidden = true;
      retryBtn.hidden = true;
      pollNote.textContent = "All done. You can close this page.";
    } else if (state === "cancelled") {
      badge.textContent = "✗ Payment cancelled";
      badge.className = "badge cancelled";
      instructions.textContent = "This payment was cancelled. You can ask for the prompt again, or message us on WhatsApp.";
      retryBtn.hidden = !online;
    }
  }

  async function poll() {
    try {
      const response = await fetch("/api/payments/paynow/status", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ reference: reference })
      });
      const data = await response.json();
      if (!response.ok || !data || data.ok !== true) return;
      if (data.status === "paid" || data.status === "cancelled") {
        updateBadge(data.status);
      }
    } catch (error) {
      // keep polling quietly
    }
  }

  retryBtn.addEventListener("click", async () => {
    retryBtn.disabled = true;
    retryBtn.textContent = "Sending again...";
    setError("");
    try {
      const response = await fetch("/api/payments/paynow/retry", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ reference: reference })
      });
      const data = await response.json();
      if (!response.ok || !data || data.ok !== true) {
        setError((data && data.error) || "Could not send the prompt again. Please message us on WhatsApp.");
      } else {
        pollNote.textContent = "Prompt sent again. Check your phone.";
        if (method === "innbucks") {
          showInnbucksCode(data.authorizationcode, data.authorizationexpires);
          badge.textContent = "⏳ Payment pending";
          badge.className = "badge pending";
        }
      }
    } catch (error) {
      setError("Network problem. Please check your connection and try again.");
    }
    retryBtn.disabled = false;
    retryBtn.textContent = "I didn't get the prompt — send it again";
  });

  whatsappBtn.href = "https://wa.me/" + whatsappNumber + "?text=" + waMessage;
  showInstructions();
  retryBtn.hidden = !online;
  if (online) {
    window.setInterval(poll, 5000);
    poll();
  }
})();
