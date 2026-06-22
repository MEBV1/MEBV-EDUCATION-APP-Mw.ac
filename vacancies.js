// vacancies.js
// Vacancy search, details, save and view tracking for Malawi Education Books and Vacancies

let vacancyItems = [];
let currentVacancy = null;

window.addEventListener("DOMContentLoaded", () => {
  document.getElementById("vacancy-search")?.addEventListener("input", debounce(loadVacancies, 300));
  document.getElementById("vacancy-category")?.addEventListener("change", loadVacancies);
  document.getElementById("vacancy-location")?.addEventListener("change", loadVacancies);
  loadVacancies();
  handleInitialQuery();
});

async function loadVacancies() {
  window.showLoading("Loading vacancies...");
  try {
    const searchTerm = document.getElementById("vacancy-search")?.value || "";
    const category = document.getElementById("vacancy-category")?.value || "all";
    const location = document.getElementById("vacancy-location")?.value || "all";
    vacancyItems = await fetchVacancies(searchTerm, category, location);
    renderVacancyCards(vacancyItems);
  } finally {
    window.hideLoading();
  }
}

async function fetchVacancies(searchTerm = "", category = "all", location = "all") {
  if (!window.supabaseClient) return [];

  try {
    let query = window.supabaseClient
      .from("vacancies")
      .select("*")
      .order("created_at", { ascending: false });

    if (category && category !== "all") {
      query = query.eq("category", category);
    }
    if (location && location !== "all") {
      query = query.ilike("location", `%${location}%`);
    }
    if (searchTerm.trim()) {
      const q = searchTerm.trim();
      query = query.or(`title.ilike.%${q}%,company.ilike.%${q}%,description.ilike.%${q}%,location.ilike.%${q}%`);
    }

    const { data, error } = await query;
    if (error) throw error;
    return data || [];
  } catch (error) {
    console.error("Failed to fetch vacancies:", error);
    return [];
  }
}

function renderVacancyCards(vacancies) {
  const list = document.getElementById("vacancies-list");
  if (!list) return;
  list.innerHTML = "";
  if (!vacancies || vacancies.length === 0) {
    list.innerHTML = `<p style="color: var(--text-muted);">No matching vacancies were found. Try a broader search or different filters.</p>`;
    return;
  }

  vacancies.forEach((vacancy) => {
    const card = document.createElement("article");
    card.className = "card vacancy-card";
    card.innerHTML = `
      <div class="card-content">
        <div class="vacancy-meta">
          <span class="meta-item">${escapeHtml(vacancy.company || 'Unknown employer')}</span>
          <span class="meta-item">${escapeHtml(vacancy.location || 'Location not specified')}</span>
        </div>
        <h3 class="card-title">${escapeHtml(vacancy.title)}</h3>
        <p class="card-description">${escapeHtml(vacancy.description?.slice(0, 120) || 'No description available.')}</p>
        <div class="vacancy-meta" style="margin-top: 1rem;">
          <span class="meta-item">Type: ${escapeHtml(vacancy.employment_type || 'N/A')}</span>
          <span class="meta-item">Deadline: ${escapeHtml(vacancy.deadline || 'Open until filled')}</span>
        </div>
        <div class="card-footer" style="padding-top: 1rem; gap: 0.75rem; flex-wrap: wrap;">
          <button type="button" class="btn btn-outline btn-sm" onclick="openVacancyDetails('${vacancy.id}')">View Details</button>
          <span style="font-size: 0.9rem; color: var(--text-muted);"><span id="vacancy-views-${vacancy.id}">${vacancy.views_count || 0}</span> views</span>
        </div>
      </div>
    `;
    list.appendChild(card);
  });
}

async function openVacancyDetails(vacancyId) {
  const vacancy = vacancyItems.find((item) => item.id === vacancyId);
  if (!vacancy) return;
  currentVacancy = vacancy;
  document.getElementById("vacancy-modal-title").textContent = vacancy.title;
  document.getElementById("vacancy-modal-meta").textContent = `${vacancy.company || 'Employer'} • ${vacancy.location || 'Location not specified'}`;
  document.getElementById("vacancy-modal-body").innerHTML = `
    <p style="color: var(--text-secondary); margin-bottom: 1rem;">${escapeHtml(vacancy.description || 'No full description available.')}</p>
    <div class="vacancy-meta" style="gap: 1.5rem; margin-bottom: 1rem;">
      <span class="meta-item">Salary: ${escapeHtml(vacancy.salary || 'Not specified')}</span>
      <span class="meta-item">Category: ${escapeHtml(vacancy.category || 'General')}</span>
      <span class="meta-item">Deadline: ${escapeHtml(vacancy.deadline || 'Open until filled')}</span>
    </div>
  `;
  const applyLink = document.getElementById("vacancy-apply-link");
  applyLink.href = vacancy.apply_link || "#";
  applyLink.onclick = (event) => {
    if (!vacancy.apply_link) {
      event.preventDefault();
      window.showError("Application link is not available.");
    }
  };
  document.getElementById("vacancy-save-btn").onclick = saveCurrentVacancy;
  document.getElementById("vacancy-modal").classList.add("active");
  trackVacancyView(vacancy.id);
}

function closeVacancyModal() {
  document.getElementById("vacancy-modal").classList.remove("active");
}

async function saveCurrentVacancy() {
  if (!currentVacancy) return;
  if (!window.supabaseClient) {
    window.showError("Service is unavailable right now.");
    return;
  }

  window.showLoading("Saving vacancy...");
  try {
    const { data: { session } } = await window.supabaseClient.auth.getSession();
    const userId = session?.user?.id;
    if (!userId) {
      window.showError("Please login to save vacancies.");
      return;
    }

    const { error } = await window.supabaseClient
      .from("saved_vacancies")
      .upsert({ user_id: userId, vacancy_id: currentVacancy.id, saved_at: new Date().toISOString() }, { onConflict: ["user_id", "vacancy_id"] });
    if (error) throw error;
    window.showSuccess("Vacancy saved successfully.");
  } catch (error) {
    console.error("Failed to save vacancy:", error);
    window.showError("Could not save the vacancy. Please try again.");
  } finally {
    window.hideLoading();
  }
}

async function trackVacancyView(vacancyId) {
  if (!window.supabaseClient || !vacancyId) return;

  const countEl = document.getElementById(`vacancy-views-${vacancyId}`);
  const currentCount = countEl ? parseInt(countEl.textContent) : 0;

  // Optimistic UI Update & DB Save
  window.incrementCounter("vacancies", "views_count", vacancyId, currentCount, (newVal) => {
    if (countEl) countEl.textContent = newVal;
  });
}

function handleInitialQuery() {
  const params = new URLSearchParams(window.location.search);
  const vacancyId = params.get("id");
  if (vacancyId) {
    const check = setInterval(() => {
      if (vacancyItems.length > 0) {
        const vacancy = vacancyItems.find((item) => item.id === vacancyId);
        if (vacancy) {
          openVacancyDetails(vacancyId);
          clearInterval(check);
        }
      }
    }, 200);
    setTimeout(() => clearInterval(check), 3000);
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

function debounce(fn, delay) {
  let timer;
  return (...args) => {
    clearTimeout(timer);
    timer = setTimeout(() => fn(...args), delay);
  };
}
