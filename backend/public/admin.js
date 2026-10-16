// Dust Patrol back office. Vanilla JS single page app that talks to
// /api/admin/... endpoints. No frameworks, no build step.

const els = {
  authScreen: document.getElementById("auth-screen"),
  authBody: document.getElementById("auth-body"),
  appShell: document.getElementById("app-shell"),
  whoami: document.getElementById("whoami"),
  nav: document.getElementById("admin-nav"),
  toast: document.getElementById("toast")
};

const state = {
  staff: null,
  products: [],
  customers: [],
  orderFilter: "",
  orderSearch: "",
  customerSearch: "",
  productSearch: "",
  editingProduct: null,
  orderDetailId: null,
  newOrder: null
};

const CATEGORY_LABELS = { residential: "Residential", commercial: "Commercial", deep: "Deep clean", window: "Windows", sanitization: "Sanitization" };
const STATUS_LABELS = { new: "New", confirmed: "Scheduled", dispatched: "In progress", delivered: "Completed", cancelled: "Cancelled" };
const STATUS_ACTIONS = {
  new: [["confirmed", "Confirm order"], ["cancelled", "Cancel"]],
  confirmed: [["dispatched", "Mark dispatched"], ["cancelled", "Cancel"]],
  dispatched: [["delivered", "Mark delivered"], ["cancelled", "Cancel"]],
  delivered: [],
  cancelled: [["new", "Reopen"]]
};
const METHOD_LABELS = { ecocash: "EcoCash", innbucks: "InnBucks", cash: "Cash", bank_transfer: "Bank transfer", other: "Other" };
const SIZES = ["XS", "S", "M", "L", "XL", "XXL"];

function escapeHtml(value) {
  return String(value === null || value === undefined ? "" : value)
    .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;").replace(/'/g, "&#39;");
}

function money(value) {
  return value === null || value === undefined ? "Price on request" : `$${Number(value).toFixed(2)}`;
}

function fmtDate(value) {
  if (!value) return "";
  return new Date(value).toLocaleDateString(undefined, { day: "2-digit", month: "short", year: "numeric" });
}

// Shrinks a photo in the browser before uploading so it loads fast on
// phones and never exceeds the upload limit.
function resizePhoto(file, maxSide = 1000) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new Error("Could not read that photo."));
    reader.onload = () => {
      const img = new Image();
      img.onerror = () => reject(new Error("That file is not a valid photo."));
      img.onload = () => {
        const scale = Math.min(1, maxSide / Math.max(img.width, img.height));
        const canvas = document.createElement("canvas");
        canvas.width = Math.max(1, Math.round(img.width * scale));
        canvas.height = Math.max(1, Math.round(img.height * scale));
        canvas.getContext("2d").drawImage(img, 0, 0, canvas.width, canvas.height);
        resolve(canvas.toDataURL("image/jpeg", 0.82));
      };
      img.src = reader.result;
    };
    reader.readAsDataURL(file);
  });
}

let toastTimer;
function showToast(message) {
  els.toast.textContent = message;
  els.toast.classList.add("is-visible");
  window.clearTimeout(toastTimer);
  toastTimer = window.setTimeout(() => els.toast.classList.remove("is-visible"), 2600);
}

async function api(path, options = {}) {
  const response = await fetch(path, {
    credentials: "same-origin",
    headers: { "Content-Type": "application/json" },
    ...options
  });
  let data = {};
  try { data = await response.json(); } catch (_) { /* non-json */ }
  if (response.status === 401 && state.staff) {
    state.staff = null;
    showApp(false);
    renderAuth("login");
    throw new Error(data.error || "Please sign in again.");
  }
  if (!response.ok || data.ok === false) {
    const error = new Error(data.error || `Request failed (${response.status}).`);
    error.code = data.code;
    throw error;
  }
  return data;
}

function formError(container, message) {
  const box = container.querySelector(".form-error");
  if (box) {
    box.textContent = message;
    box.classList.add("is-visible");
  } else {
    showToast(message);
  }
}

function clearFormError(container) {
  const box = container.querySelector(".form-error");
  if (box) box.classList.remove("is-visible");
}

// ---------- Auth screens ----------

function renderAuth(mode, message) {
  els.appShell.hidden = true;
  els.authScreen.hidden = false;
  if (mode === "no-database") {
    els.authBody.innerHTML = `
      <h1>Almost there</h1>
      <p class="hint">The back office needs a database connection before it can start.
      Add a <code>DATABASE_URL</code> environment variable in your hosting settings, then reload this page.
      The storefront keeps working while this is not set up.</p>`;
    return;
  }
  if (mode === "setup") {
    els.authBody.innerHTML = `
      <h1>Create your account</h1>
      <p class="hint">This first account becomes the shop administrator. Use an email and password you will remember.</p>
      <div class="form-error"></div>
      <form id="setup-form">
        <label class="field"><span>Your name</span><input name="name" required maxlength="80" autocomplete="name"></label>
        <label class="field"><span>Email</span><input name="email" type="email" required maxlength="120" autocomplete="username"></label>
        <label class="field"><span>Password (at least 8 characters)</span><input name="password" type="password" required minlength="8" maxlength="100" autocomplete="new-password"></label>
        <button class="btn" type="submit" style="width: 100%">Create admin account</button>
      </form>`;
    document.getElementById("setup-form").addEventListener("submit", async (event) => {
      event.preventDefault();
      clearFormError(els.authBody);
      const form = event.currentTarget;
      const button = form.querySelector("button[type=submit]");
      button.disabled = true;
      try {
        await api("/api/admin/setup", { method: "POST", body: JSON.stringify({
          name: form.elements.name.value, email: form.elements.email.value, password: form.elements.password.value
        }) });
        await boot();
        showToast("Welcome to your back office.");
      } catch (error) {
        formError(els.authBody, error.message);
        button.disabled = false;
      }
    });
    return;
  }
  els.authBody.innerHTML = `
    <h1>Sign in</h1>
    <p class="hint">${message ? escapeHtml(message) : "Staff access only."}</p>
    <div class="form-error"></div>
    <form id="login-form">
      <label class="field"><span>Email</span><input name="email" type="email" required maxlength="120" autocomplete="username"></label>
      <label class="field"><span>Password</span><input name="password" type="password" required maxlength="100" autocomplete="current-password"></label>
      <button class="btn" type="submit" style="width: 100%">Sign in</button>
    </form>`;
  document.getElementById("login-form").addEventListener("submit", async (event) => {
    event.preventDefault();
    clearFormError(els.authBody);
    const form = event.currentTarget;
    const button = form.querySelector("button[type=submit]");
    button.disabled = true;
    try {
      const data = await api("/api/admin/login", { method: "POST", body: JSON.stringify({
        email: form.elements.email.value, password: form.elements.password.value
      }) });
      state.staff = data.staff;
      await boot();
    } catch (error) {
      formError(els.authBody, error.message);
      button.disabled = false;
    }
  });
}

function showApp(visible) {
  els.authScreen.hidden = visible;
  els.appShell.hidden = !visible;
}

// ---------- Navigation ----------

const VIEWS = ["dashboard", "products", "orders", "customers", "staff"];
let currentView = "dashboard";

async function switchView(name) {
  currentView = name;
  VIEWS.forEach((view) => {
    document.getElementById(`view-${view}`).hidden = view !== name;
  });
  [...els.nav.querySelectorAll(".nav-item")].forEach((button) => {
    button.classList.toggle("is-active", button.dataset.view === name);
  });
  const staffTab = els.nav.querySelector('[data-view="staff"]');
  staffTab.style.display = state.staff && state.staff.role === "admin" ? "" : "none";
  try {
    if (name === "dashboard") await renderDashboard();
    if (name === "products") await renderProducts();
    if (name === "orders") {
      if (state.orderDetailId) await renderOrderDetail(state.orderDetailId);
      else await renderOrders();
    }
    if (name === "customers") await renderCustomers();
    if (name === "staff") await renderStaff();
  } catch (error) {
    document.getElementById(`view-${name}`).innerHTML = `<p class="empty">${escapeHtml(error.message)}</p>`;
  }
}

els.nav.addEventListener("click", (event) => {
  const button = event.target.closest(".nav-item");
  if (button) switchView(button.dataset.view);
});

document.getElementById("logout-btn").addEventListener("click", async () => {
  await api("/api/admin/logout", { method: "POST" }).catch(() => {});
  state.staff = null;
  showApp(false);
  renderAuth("login");
});

// ---------- Dashboard ----------

async function renderDashboard() {
  const { stats } = await api("/api/admin/stats");
  const openOrders = (stats.orders.new || 0) + (stats.orders.confirmed || 0) + (stats.orders.dispatched || 0);
  const view = document.getElementById("view-dashboard");
  view.innerHTML = `
    <h2>Dashboard</h2>
    <p class="view-sub">The shop at a glance.</p>
    <div class="stat-grid">
      <div class="stat"><p class="stat-label">Services live on the shop</p><p class="stat-value">${stats.products}</p><p class="stat-note">${stats.variants} packages in the catalogue</p></div>
      <div class="stat"><p class="stat-label">Open capacity</p><p class="stat-value">${stats.stock}</p><p class="stat-note">Across all packages</p></div>
      <div class="stat"><p class="stat-label">Open bookings</p><p class="stat-value">${openOrders}</p><p class="stat-note">New, confirmed or dispatched</p></div>
      <div class="stat"><p class="stat-label">Paid revenue</p><p class="stat-value">$${Number(stats.revenuePaid || 0).toFixed(2)}</p><p class="stat-note">From bookings marked fully paid</p></div>
      <div class="stat"><p class="stat-label">Online payments (Paynow)</p><p class="stat-value">${stats.paynowConfigured ? "Connected" : "Off"}</p><p class="stat-note">${stats.paynowConfigured ? "EcoCash and InnBucks are live" : "Add PAYNOW_INTEGRATION_ID and PAYNOW_INTEGRATION_KEY on Vercel, then redeploy"}</p></div>
    </div>
    <div class="grid-2">
      <div class="card">
        <h3 class="panel-title">Recent bookings</h3>
        ${stats.recentOrders.length === 0
          ? `<p class="empty mt0">No orders yet. They appear here as soon as you take one.</p>`
          : `<div class="table-wrap"><table><thead><tr><th>Reference</th><th>Customer</th><th class="num">Total</th><th>Status</th></tr></thead><tbody>
            ${stats.recentOrders.map((order) => `
              <tr class="clickable" data-order="${order.id}">
                <td>${escapeHtml(order.reference)}</td>
                <td>${escapeHtml(order.customer_name)}</td>
                <td class="num">${money(order.total)}</td>
                <td><span class="badge ${escapeHtml(order.status)}">${STATUS_LABELS[order.status] || escapeHtml(order.status)}</span></td>
              </tr>`).join("")}
            </tbody></table></div>`}
      </div>
      <div class="card">
        <h3 class="panel-title">Low capacity (2 or fewer)</h3>
        ${stats.lowStock.length === 0
          ? `<p class="empty mt0">Nothing is running low.</p>`
          : `<ul class="inline-list">${stats.lowStock.map((item) => `
              <li><span>${escapeHtml(item.product_name)} / ${escapeHtml(item.size)}${item.colour ? " / " + escapeHtml(item.colour) : ""}</span>
              <strong style="color:${item.stock === 0 ? "var(--danger)" : "inherit"}">${item.stock} left</strong></li>`).join("")}</ul>`}
      </div>
    </div>`;
  view.querySelectorAll("[data-order]").forEach((row) => {
    row.addEventListener("click", () => {
      state.orderDetailId = Number(row.dataset.order);
      switchView("orders");
    });
  });
}

// ---------- Products ----------

function productImage(product) {
  return product.image_url
    ? `<img class="img-thumb" src="${escapeHtml(product.image_url)}" alt="" onerror="this.style.visibility='hidden'">`
    : `<span class="img-thumb"></span>`;
}

function variantLabel(variant) {
  return [variant.size, variant.colour].filter(Boolean).join(" / ") || "One size";
}

async function renderProducts() {
  const data = await api("/api/admin/products");
  state.products = data.products;
  const search = state.productSearch.toLowerCase();
  const filtered = state.products.filter((product) =>
    !search || product.name.toLowerCase().includes(search) || (product.label || "").toLowerCase().includes(search)
  );
  const view = document.getElementById("view-products");
  view.innerHTML = `
    <h2>Services</h2>
    <p class="view-sub">Manage the cleaning services on your shop. Capacity is tracked per package.</p>
    <div class="toolbar">
      <label class="field grow" style="margin:0"><span>Search</span><input type="search" id="product-search" value="${escapeHtml(state.productSearch)}" placeholder="Search services"></label>
      <button class="btn" id="add-product">Add service</button>
    </div>
    <div class="table-wrap"><table>
      <thead><tr><th></th><th>Service</th><th>Category</th><th class="num">Price</th><th class="num">Capacity</th><th>Status</th><th></th></tr></thead>
      <tbody>
        ${filtered.length === 0 ? `<tr><td colspan="7" class="empty">No products yet. Add your first piece.</td></tr>` : ""}
        ${filtered.map((product) => `
          <tr>
            <td>${productImage(product)}</td>
            <td><strong>${escapeHtml(product.name)}</strong>${product.label ? `<br><span class="muted small">${escapeHtml(product.label)}</span>` : ""}</td>
            <td>${CATEGORY_LABELS[product.category] || escapeHtml(product.category)}</td>
            <td class="num">${money(product.base_price)}</td>
            <td class="num">${product.stock}</td>
            <td>${product.active ? `<span class="badge confirmed">Live</span>` : `<span class="badge inactive">Hidden</span>`}</td>
            <td><button class="btn small ghost" data-edit="${product.id}">Edit</button></td>
          </tr>`).join("")}
      </tbody>
    </table></div>`;
  view.querySelector("#product-search").addEventListener("input", (event) => {
    state.productSearch = event.target.value;
    renderProducts().catch((error) => showToast(error.message));
  });
  view.querySelector("#add-product").addEventListener("click", () => openProductModal(null));
  view.querySelectorAll("[data-edit]").forEach((button) => {
    button.addEventListener("click", () => {
      const product = state.products.find((p) => p.id === Number(button.dataset.edit));
      openProductModal(product);
    });
  });
}

function openProductModal(product) {
  state.editingProduct = product;
  const isNew = !product;
  const modal = document.createElement("div");
  modal.className = "modal-backdrop";
  const v = product || { name: "", label: "", category: "tops", description: "", image_url: "", base_price: null, active: true, variants: [] };
  modal.innerHTML = `
    <div class="modal">
      <div class="modal-title"><h3>${isNew ? "Add service" : "Edit service"}</h3><button class="icon-close" type="button" aria-label="Close">×</button></div>
      <div class="form-error"></div>
      <form id="product-form">
        <label class="field"><span>Name</span><input name="name" required maxlength="120" value="${escapeHtml(v.name)}"></label>
        <div class="field-row">
          <label class="field"><span>Category</span>
            <select name="category">
              ${Object.keys(CATEGORY_LABELS).map((key) => `<option value="${key}" ${v.category === key ? "selected" : ""}>${CATEGORY_LABELS[key]}</option>`).join("")}
            </select></label>
          <label class="field"><span>Short label (shown on the card)</span><input name="label" maxlength="40" value="${escapeHtml(v.label)}" placeholder="e.g. Home visit"></label>
        </div>
        <label class="field"><span>Price in dollars (leave empty for price on request)</span><input name="base_price" type="number" step="0.01" min="0" placeholder="e.g. 30" value="${v.base_price === null || v.base_price === undefined ? "" : v.base_price}"></label>
        <label class="field"><span>Photo (choose from your device, or paste a link)</span>
          <input name="image_url" id="image-url" maxlength="300" value="${escapeHtml(v.image_url)}" placeholder="Choose a photo below">
          <input type="file" id="photo-file" accept="image/jpeg,image/png,image/webp" capture="environment" style="margin-top:8px">
          <img id="photo-preview" alt="" ${v.image_url ? `src="${escapeHtml(v.image_url)}"` : ""} style="display:${v.image_url ? "block" : "none"};width:90px;height:90px;object-fit:cover;margin-top:8px;border:1px solid var(--line)">
          <p class="small muted" style="margin:6px 0 0">Pick a photo from your phone or computer. It is stored in your database automatically.</p>
        </label>
        <label class="field"><span>Description</span><textarea name="description" maxlength="500">${escapeHtml(v.description)}</textarea></label>
        <label class="checkbox-row"><input type="checkbox" name="active" ${v.active ? "checked" : ""}> Live on the shop</label>

        <h4 class="panel-title" style="margin-top:20px">Packages, options and capacity</h4>
        <div class="table-wrap"><table id="variant-table">
          <thead><tr><th>Package</th><th class="num">Capacity</th><th class="num">Own price</th><th>On</th><th></th></tr></thead>
          <tbody>
            ${(v.variants || []).map((variant) => `
              <tr data-variant="${variant.id}">
                <td>${escapeHtml(variantLabel(variant))}</td>
                <td class="num"><input type="number" min="0" step="1" class="v-stock" value="${variant.stock}" style="width:74px"></td>
                <td class="num"><input type="number" min="0" step="0.01" class="v-price" value="${variant.price === null || variant.price === undefined ? "" : variant.price}" placeholder="Product price" style="width:100px"></td>
                <td><input type="checkbox" class="v-active" ${variant.active ? "checked" : ""}></td>
                <td><button type="button" class="btn small danger v-remove">Remove</button></td>
              </tr>`).join("")}
          </tbody>
        </table></div>

        <div class="field-row" style="margin-top:14px">
          <label class="field" style="margin:0"><span>New size</span>
            <select class="n-size"><option value="">Choose</option>${SIZES.map((s) => `<option>${s}</option>`).join("")}</select></label>
          <label class="field" style="margin:0"><span>Colour (optional)</span><input class="n-colour" maxlength="30" placeholder="e.g. Black"></label>
          <label class="field" style="margin:0"><span>Capacity</span><input type="number" min="0" class="n-stock" value="0"></label>
          <button type="button" class="btn small ghost" id="add-variant" style="align-self:end; margin-bottom:0">Add package</button>
        </div>

        <div class="modal-actions">
          <button type="button" class="btn ghost" data-close>Cancel</button>
          <button type="submit" class="btn">${isNew ? "Add service" : "Save changes"}</button>
        </div>
      </form>
    </div>`;
  document.body.append(modal);
  modal.classList.add("is-open");

  const close = () => { modal.remove(); state.editingProduct = null; };
  modal.querySelector(".icon-close").addEventListener("click", close);
  modal.querySelector("[data-close]").addEventListener("click", close);
  modal.addEventListener("click", (event) => { if (event.target === modal) close(); });

  modal.querySelectorAll(".v-remove").forEach((button) => {
    button.addEventListener("click", async () => {
      const row = button.closest("tr");
      if (isNew) { row.remove(); return; }
      if (!window.confirm("Remove this size from the shop?")) return;
      try {
        await api(`/api/admin/variants/${row.dataset.variant}`, { method: "DELETE" });
        row.remove();
        showToast("Size removed.");
      } catch (error) { showToast(error.message); }
    });
  });

  modal.querySelector("#add-variant").addEventListener("click", async () => {
    const size = modal.querySelector(".n-size").value;
    const colour = modal.querySelector(".n-colour").value.trim();
    const stock = modal.querySelector(".n-stock").value;
    if (!size && !colour) return showToast("Choose a size or enter a colour.");
    const body = { size, colour, stock: Number(stock) || 0 };
    if (isNew) {
      const table = modal.querySelector("#variant-table tbody");
      const row = document.createElement("tr");
      row.dataset.newVariant = "true";
      row.innerHTML = `
        <td>${escapeHtml([size, colour].filter(Boolean).join(" / "))}</td>
        <td class="num"><input type="number" min="0" step="1" class="v-stock" value="${body.stock}" style="width:74px"></td>
        <td class="num"><input type="number" min="0" step="0.01" class="v-price" placeholder="Product price" style="width:100px"></td>
        <td><input type="checkbox" class="v-active" checked></td>
        <td><button type="button" class="btn small danger v-remove">Remove</button></td>`;
      table.append(row);
      row.querySelector(".v-remove").addEventListener("click", () => row.remove());
      modal.querySelector(".n-size").value = "";
      modal.querySelector(".n-colour").value = "";
      modal.querySelector(".n-stock").value = "0";
    } else {
      try {
        const result = await api(`/api/admin/products/${product.id}/variants`, { method: "POST", body: JSON.stringify(body) });
        showToast("Size added.");
        close();
        openProductModal(result.product);
      } catch (error) { showToast(error.message); }
    }
  });

  modal.querySelector("#photo-file").addEventListener("change", async (event) => {
    const file = event.target.files && event.target.files[0];
    if (!file) return;
    showToast("Uploading photo...");
    try {
      const dataUrl = await resizePhoto(file);
      const uploaded = await api("/api/admin/upload", { method: "POST", body: JSON.stringify({ dataUrl }) });
      modal.querySelector("#image-url").value = uploaded.url;
      const preview = modal.querySelector("#photo-preview");
      preview.src = uploaded.url;
      preview.style.display = "block";
      showToast("Photo added. Remember to save the product.");
    } catch (error) {
      showToast(error.message);
    }
  });

  modal.querySelector("#product-form").addEventListener("submit", async (event) => {
    event.preventDefault();
    clearFormError(modal);
    const form = event.currentTarget;
    const payload = {
      name: form.name.value.trim(),
      category: form.category.value,
      label: form.label.value.trim(),
      description: form.description.value.trim(),
      image_url: form.image_url.value.trim(),
      base_price: form.base_price.value === "" ? null : form.base_price.value,
      active: form.active.checked
    };
    const button = form.querySelector("button[type=submit]");
    button.disabled = true;
    try {
      if (isNew) {
        const newSizes = [...modal.querySelectorAll("#variant-table tbody tr[data-new-variant]")].map((row) => ({
          size: row.cells[0].textContent.split(" / ")[0] || "",
          colour: row.cells[0].textContent.split(" / ")[1] || "",
          stock: Number(row.querySelector(".v-stock").value) || 0,
          price: row.querySelector(".v-price").value === "" ? null : Number(row.querySelector(".v-price").value)
        })).filter((variant) => variant.size || variant.colour);
        payload.sizes = newSizes.map((variant) => variant.size).filter(Boolean);
        const created = await api("/api/admin/products", { method: "POST", body: JSON.stringify(payload) });
        const productId = created.product.id;
        for (const variant of newSizes) {
          await api(`/api/admin/products/${productId}/variants`, {
            method: "POST",
            body: JSON.stringify({ size: variant.size, colour: variant.colour, stock: variant.stock, price: variant.price })
          }).catch(() => {});
        }
        showToast("Product added.");
      } else {
        await api(`/api/admin/products/${product.id}`, { method: "PUT", body: JSON.stringify(payload) });
        const rows = [...modal.querySelectorAll("#variant-table tbody tr[data-variant]")];
        for (const row of rows) {
          await api(`/api/admin/variants/${row.dataset.variant}`, {
            method: "PUT",
            body: JSON.stringify({
              stock: Number(row.querySelector(".v-stock").value) || 0,
              price: row.querySelector(".v-price").value === "" ? null : row.querySelector(".v-price").value,
              active: row.querySelector(".v-active").checked
            })
          });
        }
        showToast("Changes saved.");
      }
      close();
      await renderProducts();
    } catch (error) {
      formError(modal, error.message);
      button.disabled = false;
    }
  });
}

// ---------- Orders ----------

async function renderOrders() {
  state.orderDetailId = null;
  const params = new URLSearchParams();
  if (state.orderFilter) params.set("status", state.orderFilter);
  if (state.orderSearch) params.set("q", state.orderSearch);
  const data = await api(`/api/admin/orders?${params.toString()}`);
  const view = document.getElementById("view-orders");
  view.innerHTML = `
    <h2>Bookings</h2>
    <p class="view-sub">Every booking keeps a unique reference. Capacity is reserved when a booking is taken and returns if it is cancelled.</p>
    <div class="toolbar">
      <label class="field" style="margin:0"><span>Status</span>
        <select id="order-filter">
          <option value="">All statuses</option>
          ${Object.keys(STATUS_LABELS).map((key) => `<option value="${key}" ${state.orderFilter === key ? "selected" : ""}>${STATUS_LABELS[key]}</option>`).join("")}
        </select></label>
      <label class="field grow" style="margin:0"><span>Search</span><input type="search" id="order-search" value="${escapeHtml(state.orderSearch)}" placeholder="Reference, customer or phone"></label>
      <button class="btn" id="new-order">New booking</button>
    </div>
    <div class="table-wrap"><table>
      <thead><tr><th>Reference</th><th>Date</th><th>Customer</th><th class="num">Items</th><th class="num">Total</th><th>Payment</th><th>Status</th></tr></thead>
      <tbody>
        ${data.orders.length === 0 ? `<tr><td colspan="7" class="empty">No orders here yet.</td></tr>` : ""}
        ${data.orders.map((order) => `
          <tr class="clickable" data-order="${order.id}">
            <td><strong>${escapeHtml(order.reference)}</strong></td>
            <td>${fmtDate(order.created_at)}</td>
            <td>${escapeHtml(order.customer_name)}<br><span class="muted small">${escapeHtml(order.customer_phone)}</span></td>
            <td class="num">${order.item_count}</td>
            <td class="num">${money(order.total)}</td>
            <td><span class="badge ${escapeHtml(order.payment_status)}">${order.payment_status}</span></td>
            <td><span class="badge ${escapeHtml(order.status)}">${STATUS_LABELS[order.status] || escapeHtml(order.status)}</span></td>
          </tr>`).join("")}
      </tbody>
    </table></div>`;
  view.querySelector("#order-filter").addEventListener("change", (event) => {
    state.orderFilter = event.target.value;
    renderOrders().catch((error) => showToast(error.message));
  });
  view.querySelector("#order-search").addEventListener("input", (event) => {
    state.orderSearch = event.target.value;
    renderOrders().catch((error) => showToast(error.message));
  });
  view.querySelector("#new-order").addEventListener("click", openNewOrderModal);
  view.querySelectorAll("[data-order]").forEach((row) => {
    row.addEventListener("click", () => { state.orderDetailId = Number(row.dataset.order); renderOrderDetail(state.orderDetailId).catch((e) => showToast(e.message)); });
  });
}

async function renderOrderDetail(id) {
  const data = await api(`/api/admin/orders/${id}`);
  const order = data.order;
  const remaining = Math.max(0, order.total - order.paid_amount);
  const view = document.getElementById("view-orders");
  const actions = (STATUS_ACTIONS[order.status] || []).map(([status, label]) =>
    `<button class="btn small ${status === "cancelled" ? "danger" : ""}" data-status="${status}">${label}</button>`
  ).join(" ");
  view.innerHTML = `
    <button class="back-link" id="back-to-orders">← All bookings</button>
    <div class="detail-head">
      <h2>${escapeHtml(order.reference)}</h2>
      <span class="badge ${escapeHtml(order.status)}">${STATUS_LABELS[order.status] || escapeHtml(order.status)}</span>
      <span class="badge ${escapeHtml(order.payment_status)}">${order.payment_status}</span>
    </div>
    <div class="form-error" id="order-error"></div>
    <div class="grid-2">
      <div class="card">
        <h3 class="panel-title">Items</h3>
        <div class="table-wrap"><table>
          <thead><tr><th>Item</th><th class="num">Qty</th><th class="num">Unit price</th><th class="num">Line total</th></tr></thead>
          <tbody>
            ${order.items.map((item) => `
              <tr><td>${escapeHtml(item.product_name)}${item.size || item.colour ? ` <span class="muted small">(${escapeHtml([item.size, item.colour].filter(Boolean).join(" / "))})</span>` : ""}</td>
              <td class="num">${item.quantity}</td><td class="num">${money(item.unit_price)}</td><td class="num">${money(item.unit_price * item.quantity)}</td></tr>`).join("")}
            <tr class="order-total-row"><td>Order total</td><td></td><td></td><td class="num">${money(order.total)}</td></tr>
          </tbody>
        </table></div>
        <h3 class="panel-title" style="margin-top:20px">Move this booking forward</h3>
        <p>${actions || `<span class="muted">Nothing left to do for this order.</span>`}</p>
      </div>
      <div class="card">
        <h3 class="panel-title">Customer</h3>
        <p><strong>${escapeHtml(order.customer_name)}</strong><br>${escapeHtml(order.customer_phone)}</p>
        ${order.payment_method ? `<p class="small"><strong>Customer chose:</strong> ${METHOD_LABELS[order.payment_method] || escapeHtml(order.payment_method)}</p>` : ""}
        ${order.paynow_status ? `<p class="small muted"><strong>Online payment status:</strong> ${escapeHtml(order.paynow_status)}</p>` : ""}
        <p><button class="btn small ghost" id="open-receipt">Open receipt</button></p>
        ${order.notes ? `<p class="small muted">${escapeHtml(order.notes)}</p>` : ""}
        <p class="small muted">Created ${fmtDate(order.created_at)}</p>
        <h3 class="panel-title" style="margin-top:20px">Payments received</h3>
        ${order.payments.length === 0 ? `<p class="muted small mt0">No payments recorded yet.</p>` : `
          <ul class="inline-list">${order.payments.map((payment) => `
            <li><span>${METHOD_LABELS[payment.method] || escapeHtml(payment.method)}${payment.reference ? ` · ${escapeHtml(payment.reference)}` : ""}<br><span class="muted small">${fmtDate(payment.created_at)}${payment.recorded_by_name ? " by " + escapeHtml(payment.recorded_by_name) : " · automatic (Paynow)"}</span></span><strong>${money(payment.amount)}</strong></li>`).join("")}</ul>`}
        <form id="payment-form" style="margin-top:16px">
          <div class="field-row">
            <label class="field" style="margin:0"><span>Method</span>
              <select name="method">
                ${Object.keys(METHOD_LABELS).map((key) => `<option value="${key}">${METHOD_LABELS[key]}</option>`).join("")}
              </select></label>
            <label class="field" style="margin:0"><span>Reference (e.g. EcoCash confirmation)</span><input name="reference" maxlength="100" placeholder="Optional"></label>
          </div>
          <div class="field-row" style="margin-top:10px">
            <label class="field" style="margin:0"><span>Amount</span><input name="amount" type="number" min="0.01" step="0.01" required value="${remaining > 0 ? remaining.toFixed(2) : ""}"></label>
            <button class="btn small" type="submit" style="align-self:end; margin-bottom:0">Record payment</button>
          </div>
          <p class="small muted mt0" style="margin-top:8px">Remaining balance: ${money(remaining)}</p>
        </form>
      </div>
    </div>`;

  view.querySelector("#back-to-orders").addEventListener("click", () => {
    renderOrders().catch((error) => showToast(error.message));
  });
  view.querySelectorAll("[data-status]").forEach((button) => {
    button.addEventListener("click", async () => {
      clearFormError(view);
      if (button.dataset.status === "cancelled" && !window.confirm("Cancel this booking? Reserved capacity goes back.")) return;
      try {
        await api(`/api/admin/orders/${order.id}/status`, { method: "PATCH", body: JSON.stringify({ status: button.dataset.status }) });
        showToast("Order updated.");
        await renderOrderDetail(order.id);
      } catch (error) { formError(view, error.message); }
    });
  });
  view.querySelector("#open-receipt").addEventListener("click", async () => {
    try {
      const data = await api(`/api/admin/orders/${order.id}/receipt-url`);
      window.open(data.url, "_blank", "noopener");
    } catch (error) { showToast(error.message); }
  });
  view.querySelector("#payment-form").addEventListener("submit", async (event) => {
    event.preventDefault();
    const form = event.currentTarget;
    try {
      await api(`/api/admin/orders/${order.id}/payments`, {
        method: "POST",
        body: JSON.stringify({ method: form.method.value, reference: form.reference.value.trim(), amount: form.amount.value })
      });
      showToast("Payment recorded.");
      await renderOrderDetail(order.id);
    } catch (error) { formError(view, error.message); }
  });
}

// ---------- New order modal ----------

async function openNewOrderModal() {
  const [productsData, customersData] = await Promise.all([
    api("/api/admin/products"),
    api("/api/admin/customers?q=")
  ]);
  state.products = productsData.products;
  state.customers = customersData.customers;
  state.newOrder = { items: [], customerId: "", name: "", phone: "", notes: "" };

  const modal = document.createElement("div");
  modal.className = "modal-backdrop";
  modal.innerHTML = `
    <div class="modal" style="max-width:720px">
      <div class="modal-title"><h3>New booking</h3><button class="icon-close" type="button" aria-label="Close">×</button></div>
      <div class="form-error"></div>
      <form id="new-order-form">
        <h4 class="panel-title">Customer</h4>
        <div class="field-row">
          <label class="field"><span>Existing customer</span>
            <select class="no-customer">
              <option value="">New or type-in below</option>
              ${state.customers.map((customer) => `<option value="${customer.id}">${escapeHtml(customer.name)} · ${escapeHtml(customer.phone)}</option>`).join("")}
            </select></label>
          <label class="field"><span>Name (for a new customer)</span><input class="no-name" maxlength="80"></label>
          <label class="field"><span>Phone (WhatsApp number)</span><input class="no-phone" maxlength="30" placeholder="e.g. 263712345678"></label>
        </div>

        <h4 class="panel-title" style="margin-top:18px">Items</h4>
        <div class="field-row">
          <label class="field" style="margin:0"><span>Service</span><select class="no-product">
            <option value="">Choose a product</option>
            ${state.products.filter((p) => p.active).map((p) => `<option value="${p.id}">${escapeHtml(p.name)}${p.base_price === null ? " (price on request)" : ` · $${Number(p.base_price).toFixed(2)}`}</option>`).join("")}
          </select></label>
          <label class="field" style="margin:0"><span>Package / option</span><select class="no-variant"><option value="">Choose a service first</option></select></label>
          <label class="field" style="margin:0"><span>Quantity</span><input type="number" class="no-qty" min="1" value="1" style="width:80px"></label>
          <label class="field" style="margin:0"><span>Unit price</span><input type="number" class="no-price" min="0" step="0.01" placeholder="Auto"></label>
          <button type="button" class="btn small ghost" id="no-add-item" style="align-self:end; margin-bottom:0">Add item</button>
        </div>
        <div class="table-wrap" style="margin-top:12px"><table>
          <thead><tr><th>Item</th><th class="num">Qty</th><th class="num">Unit price</th><th class="num">Total</th><th></th></tr></thead>
          <tbody class="no-items"><tr><td colspan="5" class="empty">No items yet.</td></tr></tbody>
        </table></div>

        <label class="field" style="margin-top:14px"><span>Notes</span><textarea class="no-notes" maxlength="300" placeholder="Delivery details, agreed changes, anything to remember"></textarea></label>
        <div class="modal-actions">
          <button type="button" class="btn ghost" data-close>Cancel</button>
          <button type="submit" class="btn">Create booking</button>
        </div>
      </form>
    </div>`;
  document.body.append(modal);
  modal.classList.add("is-open");
  const close = () => { modal.remove(); state.newOrder = null; };
  modal.querySelector(".icon-close").addEventListener("click", close);
  modal.querySelector("[data-close]").addEventListener("click", close);
  modal.addEventListener("click", (event) => { if (event.target === modal) close(); });

  const productSelect = modal.querySelector(".no-product");
  const variantSelect = modal.querySelector(".no-variant");
  const priceInput = modal.querySelector(".no-price");

  productSelect.addEventListener("change", () => {
    const product = state.products.find((p) => p.id === Number(productSelect.value));
    variantSelect.innerHTML = `<option value="">Choose a package</option>` + (product ? product.variants
      .filter((variant) => variant.active)
      .map((variant) => `<option value="${variant.id}">${escapeHtml(variantLabel(variant))}</option>`).join("") : "");
    if (product && product.base_price !== null) priceInput.value = Number(product.base_price);
    else priceInput.value = "";
  });

  variantSelect.addEventListener("change", () => {
    const product = state.products.find((p) => p.id === Number(productSelect.value));
    const variant = product && product.variants.find((v) => v.id === Number(variantSelect.value));
    if (variant && variant.price !== null) priceInput.value = Number(variant.price);
    else if (variant && product && product.base_price !== null) priceInput.value = Number(product.base_price);
  });

  function refreshItems() {
    const tbody = modal.querySelector(".no-items");
    if (state.newOrder.items.length === 0) {
      tbody.innerHTML = `<tr><td colspan="5" class="empty">No items yet.</td></tr>`;
      return;
    }
    tbody.innerHTML = state.newOrder.items.map((item, index) => `
      <tr><td>${escapeHtml(item.name)} <span class="muted small">(${escapeHtml(item.variantLabel)})</span></td>
      <td class="num">${item.quantity}</td><td class="num">${money(item.unitPrice)}</td><td class="num">${money(item.unitPrice * item.quantity)}</td>
      <td><button type="button" class="btn small danger" data-remove-item="${index}">Remove</button></td></tr>`).join("");
    tbody.querySelectorAll("[data-remove-item]").forEach((button) => {
      button.addEventListener("click", () => {
        state.newOrder.items.splice(Number(button.dataset.removeItem), 1);
        refreshItems();
      });
    });
  }

  modal.querySelector("#no-add-item").addEventListener("click", () => {
    const product = state.products.find((p) => p.id === Number(productSelect.value));
    const variant = product && product.variants.find((v) => v.id === Number(variantSelect.value));
    if (!product || !variant) return showToast("Choose a product and size first.");
    const quantity = Number(modal.querySelector(".no-qty").value) || 1;
    let unitPrice = priceInput.value === "" ? (product.base_price !== null ? Number(product.base_price) : null) : Number(priceInput.value);
    if (variant.price !== null) unitPrice = Number(variant.price);
    if (unitPrice === null || Number.isNaN(unitPrice)) return showToast("This product has no price. Enter a unit price first.");
    state.newOrder.items.push({
      variant_id: variant.id,
      variantLabel: variantLabel(variant),
      name: product.name,
      quantity,
      unitPrice
    });
    refreshItems();
  });

  modal.querySelector("#new-order-form").addEventListener("submit", async (event) => {
    event.preventDefault();
    clearFormError(modal);
    if (state.newOrder.items.length === 0) return formError(modal, "Add at least one item.");
    const body = {
      customer_id: modal.querySelector(".no-customer").value ? Number(modal.querySelector(".no-customer").value) : null,
      customer_name: modal.querySelector(".no-name").value.trim(),
      customer_phone: modal.querySelector(".no-phone").value.trim(),
      notes: modal.querySelector(".no-notes").value.trim(),
      items: state.newOrder.items.map((item) => ({ variant_id: item.variant_id, quantity: item.quantity, unit_price: item.unitPrice }))
    };
    try {
      const data = await api("/api/admin/orders", { method: "POST", body: JSON.stringify(body) });
      showToast(`Order ${data.order.reference} created.`);
      close();
      state.orderDetailId = data.order.id;
      state.orderSearch = data.order.reference;
      await renderOrderDetail(data.order.id);
    } catch (error) {
      formError(modal, error.message);
    }
  });
}

// ---------- Customers ----------

async function renderCustomers() {
  const data = await api(`/api/admin/customers?q=${encodeURIComponent(state.customerSearch)}`);
  const view = document.getElementById("view-customers");
  view.innerHTML = `
    <h2>Customers</h2>
    <p class="view-sub">Everyone who has ordered, with their contact details and history.</p>
    <div class="toolbar">
      <label class="field grow" style="margin:0"><span>Search</span><input type="search" id="customer-search" value="${escapeHtml(state.customerSearch)}" placeholder="Name, phone or email"></label>
      <button class="btn" id="add-customer">Add customer</button>
    </div>
    <div class="table-wrap"><table>
      <thead><tr><th>Name</th><th>Phone</th><th>Email</th><th class="num">Orders</th><th class="num">Paid to date</th><th></th></tr></thead>
      <tbody>
        ${data.customers.length === 0 ? `<tr><td colspan="6" class="empty">No customers yet.</td></tr>` : ""}
        ${data.customers.map((customer) => `
          <tr>
            <td><strong>${escapeHtml(customer.name)}</strong></td>
            <td>${escapeHtml(customer.phone)}</td>
            <td>${escapeHtml(customer.email || "")}</td>
            <td class="num">${customer.order_count}</td>
            <td class="num">${money(customer.lifetime_value)}</td>
            <td><button class="btn small ghost" data-edit-customer="${customer.id}">Edit</button></td>
          </tr>`).join("")}
      </tbody>
    </table></div>`;
  view.querySelector("#customer-search").addEventListener("input", (event) => {
    state.customerSearch = event.target.value;
    renderCustomers().catch((error) => showToast(error.message));
  });
  view.querySelector("#add-customer").addEventListener("click", () => openCustomerModal(null));
  view.querySelectorAll("[data-edit-customer]").forEach((button) => {
    const customer = data.customers.find((c) => c.id === Number(button.dataset.editCustomer));
    button.addEventListener("click", () => openCustomerModal(customer));
  });
}

function openCustomerModal(customer) {
  const modal = document.createElement("div");
  modal.className = "modal-backdrop";
  const isNew = !customer;
  const c = customer || { name: "", phone: "", email: "", notes: "" };
  modal.innerHTML = `
    <div class="modal">
      <div class="modal-title"><h3>${isNew ? "Add customer" : "Edit customer"}</h3><button class="icon-close" type="button" aria-label="Close">×</button></div>
      <div class="form-error"></div>
      <form id="customer-form">
        <label class="field"><span>Name</span><input name="name" required maxlength="80" value="${escapeHtml(c.name)}"></label>
        <div class="field-row">
          <label class="field"><span>Phone (WhatsApp)</span><input name="phone" required maxlength="30" value="${escapeHtml(c.phone)}"></label>
          <label class="field"><span>Email</span><input name="email" type="email" maxlength="120" value="${escapeHtml(c.email || "")}"></label>
        </div>
        <label class="field"><span>Notes</span><textarea name="notes" maxlength="300">${escapeHtml(c.notes || "")}</textarea></label>
        <div class="modal-actions">
          <button type="button" class="btn ghost" data-close>Cancel</button>
          <button type="submit" class="btn">Save</button>
        </div>
      </form>
    </div>`;
  document.body.append(modal);
  modal.classList.add("is-open");
  const close = () => modal.remove();
  modal.querySelector(".icon-close").addEventListener("click", close);
  modal.querySelector("[data-close]").addEventListener("click", close);
  modal.querySelector("#customer-form").addEventListener("submit", async (event) => {
    event.preventDefault();
    clearFormError(modal);
    const form = event.currentTarget;
    const payload = { name: form.elements.name.value.trim(), phone: form.elements.phone.value.trim(), email: form.elements.email.value.trim(), notes: form.elements.notes.value.trim() };
    try {
      if (isNew) await api("/api/admin/customers", { method: "POST", body: JSON.stringify(payload) });
      else await api(`/api/admin/customers/${customer.id}`, { method: "PUT", body: JSON.stringify(payload) });
      showToast("Customer saved.");
      close();
      await renderCustomers();
    } catch (error) { formError(modal, error.message); }
  });
}

// ---------- Staff ----------

async function renderStaff() {
  const view = document.getElementById("view-staff");
  if (state.staff.role !== "admin") {
    view.innerHTML = `<h2>Staff</h2><p class="view-sub">Only an administrator can manage staff accounts.</p>`;
    return;
  }
  const [staffData, auditData] = await Promise.all([api("/api/admin/staff"), api("/api/admin/audit")]);
  view.innerHTML = `
    <h2>Staff</h2>
    <p class="view-sub">Accounts for your team. Admins can do everything; staff can run the shop day to day.</p>
    <div class="toolbar"><button class="btn" id="add-staff">Add staff member</button></div>
    <div class="table-wrap"><table>
      <thead><tr><th>Name</th><th>Email</th><th>Role</th><th>Status</th><th></th></tr></thead>
      <tbody>
        ${staffData.staff.map((member) => `
          <tr>
            <td><strong>${escapeHtml(member.name)}</strong>${member.id === state.staff.id ? ` <span class="small muted">(you)</span>` : ""}</td>
            <td>${escapeHtml(member.email)}</td>
            <td><span class="badge ${member.role}">${member.role}</span></td>
            <td>${member.active ? "Active" : "Off"}</td>
            <td><button class="btn small ghost" data-edit-staff="${member.id}">Edit</button></td>
          </tr>`).join("")}
      </tbody>
    </table></div>
    <div class="card" style="margin-top:22px; max-width:720px">
      <h3 class="panel-title">Recent activity</h3>
      <ul class="inline-list">
        ${auditData.entries.slice(0, 15).map((entry) => `
          <li><span><strong>${escapeHtml(entry.staff_name || "System")}</strong> ${escapeHtml(entry.details || entry.action)}<br><span class="muted small">${fmtDate(entry.created_at)}</span></span></li>`).join("") || `<li class="empty mt0">Nothing recorded yet.</li>`}
      </ul>
    </div>`;
  view.querySelector("#add-staff").addEventListener("click", () => openStaffModal(null));
  view.querySelectorAll("[data-edit-staff]").forEach((button) => {
    const member = staffData.staff.find((s) => s.id === Number(button.dataset.editStaff));
    button.addEventListener("click", () => openStaffModal(member));
  });
}

function openStaffModal(member) {
  const modal = document.createElement("div");
  modal.className = "modal-backdrop";
  const isNew = !member;
  const m = member || { name: "", email: "", role: "staff" };
  modal.innerHTML = `
    <div class="modal">
      <div class="modal-title"><h3>${isNew ? "Add staff member" : "Edit staff member"}</h3><button class="icon-close" type="button" aria-label="Close">×</button></div>
      <div class="form-error"></div>
      <form id="staff-form">
        <label class="field"><span>Name</span><input name="name" required maxlength="80" value="${escapeHtml(m.name)}" ${isNew ? "" : "readonly"}></label>
        <label class="field"><span>Email (used to sign in)</span><input name="email" type="email" required maxlength="120" value="${escapeHtml(m.email)}" ${isNew ? "" : "readonly"}></label>
        <label class="field"><span>${isNew ? "Password (at least 8 characters)" : "New password (leave empty to keep the current one)"}</span>
          <input name="password" type="password" ${isNew ? "required" : ""} minlength="8" maxlength="100" autocomplete="new-password"></label>
        <label class="field"><span>Role</span>
          <select name="role" ${member && member.id === state.staff.id ? "disabled" : ""}>
            <option value="staff" ${m.role === "staff" ? "selected" : ""}>Staff (products, orders, customers)</option>
            <option value="admin" ${m.role === "admin" ? "selected" : ""}>Admin (everything, including staff and payments settings)</option>
          </select></label>
        ${isNew ? "" : `
        <label class="checkbox-row"><input type="checkbox" name="active" ${m.active ? "checked" : ""} ${member.id === state.staff.id ? "disabled" : ""}> Account is active</label>`}
        <div class="modal-actions">
          <button type="button" class="btn ghost" data-close>Cancel</button>
          <button type="submit" class="btn">Save</button>
        </div>
      </form>
    </div>`;
  document.body.append(modal);
  modal.classList.add("is-open");
  const close = () => modal.remove();
  modal.querySelector(".icon-close").addEventListener("click", close);
  modal.querySelector("[data-close]").addEventListener("click", close);
  modal.querySelector("#staff-form").addEventListener("submit", async (event) => {
    event.preventDefault();
    clearFormError(modal);
    const form = event.currentTarget;
    try {
      if (isNew) {
        await api("/api/admin/staff", { method: "POST", body: JSON.stringify({
          name: form.elements.name.value.trim(), email: form.elements.email.value.trim(), password: form.elements.password.value, role: form.elements.role.value
        }) });
      } else {
        const payload = { role: form.role.value, active: form.active.checked };
        if (form.password.value) payload.password = form.password.value;
        await api(`/api/admin/staff/${member.id}`, { method: "PUT", body: JSON.stringify(payload) });
      }
      showToast("Staff member saved.");
      close();
      await renderStaff();
    } catch (error) { formError(modal, error.message); }
  });
}

// ---------- Boot ----------

async function boot() {
  try {
    const data = await api("/api/admin/me");
    if (data.status === "ok") {
      state.staff = data.staff;
      els.whoami.textContent = `${data.staff.name} · ${data.staff.role}`;
      showApp(true);
      await switchView("dashboard");
    } else {
      renderAuth(data.status === "setup_required" ? "setup" : "login");
    }
  } catch (error) {
    showApp(false);
    if (error.code === "no_database" || error.code === "database_unreachable") {
      renderAuth("no-database");
    } else {
      renderAuth("login", error.message);
    }
  }
}

boot().catch((error) => {
  renderAuth("login", error.message);
});
