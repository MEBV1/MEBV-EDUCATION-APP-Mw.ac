// services.js
// Service catalogue and inquiry form functionality

let servicesCatalog = [];

window.loadServices = async function() {
  window.showLoading("Loading service catalogue...");
  try {
    servicesCatalog = await fetchServices();
    renderServices(servicesCatalog);
    populateServiceOptions(servicesCatalog);
  } finally {
    window.hideLoading();
  }
}

window.addEventListener("DOMContentLoaded", () => {
  window.loadServices();
  document.getElementById("service-request-form")?.addEventListener("submit", submitServiceRequest);
});

async function fetchServices() {
  if (!window.supabaseClient) return [];

  try {
    const { data, error } = await window.supabaseClient
      .from("services")
      .select("*")
      .order("created_at", { ascending: true });
    if (error) throw error;
    return data || [];
  } catch (error) {
    console.error("Unable to load services:", error);
    return [];
  }
}

function renderServices(services) {
  const list = document.getElementById("services-list");
  if (!list) return;
  list.innerHTML = "";
  if (!services || services.length === 0) {
    list.innerHTML = `<p style="color: var(--text-muted);">There are no services available currently.</p>`;
    return;
  }

  services.forEach((service) => {
    const card = document.createElement("article");
    card.className = "card";
    card.innerHTML = `
      <div class="card-content">
        <div style="display: flex; justify-content: space-between; align-items: center; gap: 1rem; margin-bottom: 0.75rem;">
          <h3 class="card-title" style="margin: 0;">${escapeHtml(service.name)}</h3>
          <span class="card-badge">${escapeHtml(service.category || 'Service')}</span>
        </div>
        <p class="card-description">${escapeHtml(service.description || 'Description coming soon.')}</p>
        <div style="display: flex; flex-direction: column; gap: 0.5rem; margin-top: auto;">
          <div style="display: flex; justify-content: space-between; align-items: center; gap: 0.75rem;">
            <span style="font-weight: 700; color: var(--text-primary);">${service.price ? 'MWK ' + escapeHtml(service.price) : 'Price on request'}</span>
            <button type="button" class="btn btn-outline btn-sm" onclick="selectService('${escapeHtml(service.name)}', '${service.id}')">Request</button>
          </div>
          <span style="font-size: 0.85rem; color: var(--text-muted);"><span id="service-views-${service.id}">${service.views_count || 0}</span> views</span>
        </div>
      </div>
    `;
    list.appendChild(card);
  });
}

function populateServiceOptions(services) {
  const select = document.getElementById("service-choice");
  if (!select) return;
  const existingValues = new Set(Array.from(select.options).map((option) => option.value));
  services.forEach((service) => {
    if (!existingValues.has(service.name)) {
      const option = document.createElement("option");
      option.value = service.name;
      option.textContent = service.name;
      select.appendChild(option);
      existingValues.add(service.name);
    }
  });
}

function selectService(name, serviceId) {
  const select = document.getElementById("service-choice");
  if (!select) return;
  select.value = name;
  document.getElementById("service-name")?.focus();
  window.showSuccess(`Selected service: ${name}`);
  if (serviceId) trackServiceView(serviceId);
}

async function trackServiceView(serviceId) {
  if (!window.supabaseClient || !serviceId) return;

  const countEl = document.getElementById(`service-views-${serviceId}`);
  const currentCount = countEl ? parseInt(countEl.textContent) : 0;

  // Optimistic UI Update & DB Save
  window.incrementCounter("services", "views_count", serviceId, currentCount, (newVal) => {
    if (countEl) countEl.textContent = newVal;
  });
}

async function submitServiceRequest(event) {
  event.preventDefault();
  const name = document.getElementById("service-name").value.trim();
  const email = document.getElementById("service-email").value.trim();
  const service = document.getElementById("service-choice").value;
  const message = document.getElementById("service-message").value.trim();

  if (!name || !email || !service || !message) {
    window.showError("Please fill in all request fields.");
    return;
  }

  window.showLoading("Submitting your request...");
  try {
    if (window.supabaseClient) {
      const { error } = await window.supabaseClient
        .from("service_requests")
        .insert([{ full_name: name, email: email, service_requested: service, message: message, created_at: new Date().toISOString() }]);
      if (error) throw error;
    }
    window.showSuccess("Service request sent successfully. Thank you.");
    document.getElementById("service-request-form").reset();
  } catch (error) {
    console.error("Service request failed:", error);
    window.showError("Unable to submit request now. Please try again later.");
  } finally {
    window.hideLoading();
  }
}

function escapeHtml(value) {
  return String(value || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/\"/g, "&quot;")
    .replace(/'/g, "&#039;");
}
