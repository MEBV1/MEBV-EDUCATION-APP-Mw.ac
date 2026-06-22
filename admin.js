// admin.js
// Admin dashboard controls and data management for Malawi Education Books and Vacancies

const ADMIN_SECTIONS = {
  overview: "Overview",
  books: "Books",
  videos: "Videos",
  lessons: "Python Lessons",
  vacancies: "Vacancies",
  services: "Services",
  blog: "Blog Posts",
  advertisements: "Advertisements",
  users: "Users",
  payments: "Payments",
  audit: "Audit Logs"
};

async function getSessionDetails() {
  if (!window.supabaseClient) {
    console.warn("[Admin Dashboard] Supabase client unavailable for session validation.");
    return { session: null, user: null };
  }

  const { data: { session }, error } = await window.supabaseClient.auth.getSession();
  if (error) {
    console.warn("[Admin Dashboard] Failed to read current session:", error);
  }

  const user = session?.user || null;
  console.log("[Admin Dashboard] Current session:", session);
  console.log("[Admin Dashboard] Current user:", user);

  return { session, user };
}

window.addEventListener("DOMContentLoaded", initAdminDashboard);

async function initAdminDashboard() {
  if (!window.supabaseClient) {
    window.location.href = "index.html";
    return;
  }

  try {
    const { data: { session } } = await window.supabaseClient.auth.getSession();
    if (!session || !session.user) {
      window.location.href = "index.html";
      return;
    }

    setupAdminNavigation();
    loadAdminOverview();
  } catch (error) {
    console.error("Admin initialization failed:", error);
    window.location.href = "index.html";
  }
}

function setupAdminNavigation() {
  const navItems = document.querySelectorAll(".admin-nav-item");
  navItems.forEach((item) => {
    item.addEventListener("click", () => {
      navItems.forEach((nav) => nav.classList.remove("active"));
      item.classList.add("active");
      const section = item.getAttribute("data-section");
      if (section === "overview") {
        loadAdminOverview();
      } else {
        loadSectionData(section);
      }
    });
  });
}

async function loadAdminOverview() {
  const main = document.getElementById("admin-main-content");
  if (!main) return;
  window.showLoading("Loading admin overview...");
  try {
    const counts = await Promise.all([
      fetchTableCount("books"),
      fetchTableCount("videos"),
      fetchTableCount("lessons"),
      fetchTableCount("vacancies"),
      fetchTableCount("services"),
      fetchTableCount("blog_posts"),
      fetchTableCount("advertisements"),
      fetchTableCount("profiles"),
      fetchTableCount("payments"),
      fetchTableCount("audit_logs")
    ]);

    main.innerHTML = `
      <div class="card" style="padding: 1.5rem; margin-bottom: 1.5rem;">
        <h2 class="card-title">Administrator Dashboard</h2>
        <p style="color: var(--text-secondary);">Use the sidebar to manage content, users, and system data. Click any section to add new items or edit existing ones.</p>
      </div>
      <div class="grid-layout" style="margin-top: 0;">
        ${renderSummaryCard("Books", counts[0])}
        ${renderSummaryCard("Videos", counts[1])}
        ${renderSummaryCard("Python Lessons", counts[2])}
        ${renderSummaryCard("Vacancies", counts[3])}
        ${renderSummaryCard("Services", counts[4])}
        ${renderSummaryCard("Blog Posts", counts[5])}
        ${renderSummaryCard("Advertisements", counts[6])}
        ${renderSummaryCard("Users", counts[7])}
        ${renderSummaryCard("Payments", counts[8])}
        ${renderSummaryCard("Audit Logs", counts[9])}
      </div>
    `;
  } finally {
    window.hideLoading();
  }
}

function renderSummaryCard(label, count) {
  return `
    <article class="card" style="padding: 1.5rem; min-height: 170px; display: flex; flex-direction: column; justify-content: space-between;">
      <div>
        <p style="font-weight: 700; color: var(--text-secondary); margin-bottom: 0.75rem;">${escapeHtml(label)}</p>
        <p style="font-size: 2.5rem; font-weight: 800; color: var(--color-primary);">${count}</p>
      </div>
    </article>
  `;
}

async function loadSectionData(section) {
  const main = document.getElementById("admin-main-content");
  if (!main) return;
  window.showLoading(`Loading ${ADMIN_SECTIONS[section]}...`);
  try {
    switch (section) {
      case "overview":
        return loadAdminOverview();
      case "books":
        return loadBooksSection();
      case "videos":
        return loadVideosSection();
      case "lessons":
        return loadLessonsSection();
      case "vacancies":
        return loadVacanciesSection();
      case "services":
        return loadServicesSection();
      case "blog":
        return loadBlogSection();
      case "advertisements":
        return loadAdvertisementsSection();
      case "users":
        return renderAdminTable("Users", ["Name", "Phone", "Role", "Registered"], await fetchTableRecords("profiles"), ["full_name", "phone", "role", "created_at"]);
      case "payments":
        return renderAdminTable("Payments", ["Reference", "Amount", "Status", "Date"], await fetchTableRecords("payments"), ["reference", "amount", "status", "created_at"]);
      case "audit":
        return renderAdminTable("Audit Logs", ["Event", "User", "When", "Details"], await fetchTableRecords("audit_logs"), ["event", "user_id", "created_at", "details"]);
      case "payments":
        return loadPaymentsSection();
      default:
        main.innerHTML = `<p style="color: var(--text-muted);">Unknown admin section.</p>`;
    }
  } finally {
    window.hideLoading();
  }
}

async function loadPaymentsSection() {
  const records = await fetchTableRecords("payments");
  const main = document.getElementById("admin-main-content");
  
  let content = `
    <div class="card" style="padding: 1.5rem; margin-bottom: 1.5rem;">
      <h2 class="card-title">Payment Approvals</h2>
      <p style="color: var(--text-secondary);">Review and approve student premium subscriptions.</p>
    </div>
  `;
  
  if (records && records.length > 0) {
    const columns = ["User ID", "Amount", "Method", "Status", "Date"];
    const keys = ["user_id", "amount", "payment_method", "status", "created_at"];
    const rowsHtml = records.map((record) => {
      const values = keys.map((key) => formatValue(record[key])).join("</td><td>");
      return `
        <tr>
          <td>${values}</td>
          <td>
            <button type="button" class="btn btn-primary btn-sm" onclick="approvePayment('${record.id}', '${record.user_id}', '${record.description}')">Approve</button>
            <button type="button" class="btn btn-outline btn-sm" onclick="rejectPayment('${record.id}')">Reject</button>
            <button type="button" class="btn btn-accent btn-sm" onclick="deleteAdminRecord('payments', '${record.id}')">Delete</button>
          </td>
        </tr>
      `;
    }).join("");
    
    content += `
      <div class="admin-table-wrapper">
        <table class="admin-table">
          <thead>
            <tr>
              ${columns.map((col) => `<th>${escapeHtml(col)}</th>`).join("")}
              <th>Actions</th>
            </tr>
          </thead>
          <tbody>${rowsHtml}</tbody>
        </table>
      </div>
    `;
  } else {
    content += `<div class="card" style="padding: 1.5rem;"><p style="color: var(--text-secondary);">No payments pending review.</p></div>`;
  }
  
  main.innerHTML = content;
}

async function approvePayment(paymentId, userId, plan) {
  const endDate = prompt("Enter subscription end date (YYYY-MM-DD):", new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString().split('T')[0]);
  if (!endDate) return;

  window.showLoading("Approving payment...");
  try {
    // 1. Update payment status
    await window.supabaseClient
      .from("payments")
      .update({ status: "verified", verified_at: new Date().toISOString() })
      .eq("id", paymentId);

    // 2. Create/Update subscription
    await window.supabaseClient
      .from("subscriptions")
      .upsert({
        user_id: userId,
        plan: plan || "Premium",
        start_date: new Date().toISOString(),
        end_date: new Date(endDate).toISOString(),
        status: "active"
      }, { onConflict: ["user_id"] });

    window.showSuccess("Payment approved and subscription activated.");
    loadPaymentsSection();
  } catch (error) {
    window.showError("Failed to approve payment.");
  } finally {
    window.hideLoading();
  }
}

async function rejectPayment(paymentId) {
  if (!confirm("Are you sure you want to reject this payment?")) return;
  window.showLoading("Rejecting...");
  try {
    await window.supabaseClient
      .from("payments")
      .update({ status: "failed" })
      .eq("id", paymentId);
    window.showSuccess("Payment rejected.");
    loadPaymentsSection();
  } catch (error) {
    window.showError("Failed to reject payment.");
  } finally {
    window.hideLoading();
  }
}

async function loadBooksSection() {
  const records = await fetchTableRecords("books");
  const main = document.getElementById("admin-main-content");
  
  let content = `
    <div class="card" style="padding: 1.5rem; margin-bottom: 1.5rem;">
      <div style="display: flex; justify-content: space-between; align-items: center;">
        <div>
          <h2 class="card-title">Books</h2>
          <p style="color: var(--text-secondary);">Manage educational books in your library.</p>
        </div>
        <button type="button" class="btn btn-primary" onclick="showCreateForm('books')">+ Add Book</button>
      </div>
    </div>
  `;
  
  if (records && records.length > 0) {
    const columns = ["Title", "Author", "Category", "Downloads", "Featured"];
    const keys = ["title", "author", "category", "downloads_count", "featured"];
    const rowsHtml = records.map((record) => {
      const values = keys.map((key) => formatValue(record[key])).join("</td><td>");
      return `
        <tr>
          <td>${values}</td>
          <td>
            <button type="button" class="btn btn-outline btn-sm" onclick="viewAdminItem('Books', '${record.id}')">View</button>
            <button type="button" class="btn btn-accent btn-sm" onclick="deleteAdminRecord('books', '${record.id}')">Delete</button>
          </td>
        </tr>
      `;
    }).join("");
    
    content += `
      <div class="admin-table-wrapper">
        <table class="admin-table">
          <thead>
            <tr>
              ${columns.map((col) => `<th>${escapeHtml(col)}</th>`).join("")}
              <th>Actions</th>
            </tr>
          </thead>
          <tbody>${rowsHtml}</tbody>
        </table>
      </div>
    `;
  } else {
    content += `<div class="card" style="padding: 1.5rem;"><p style="color: var(--text-secondary);">No books found. Click "Add Book" to create one.</p></div>`;
  }
  
  main.innerHTML = content;
}

async function loadVideosSection() {
  const records = await fetchTableRecords("videos");
  const main = document.getElementById("admin-main-content");
  
  let content = `
    <div class="card" style="padding: 1.5rem; margin-bottom: 1.5rem;">
      <div style="display: flex; justify-content: space-between; align-items: center;">
        <div>
          <h2 class="card-title">Videos</h2>
          <p style="color: var(--text-secondary);">Manage educational videos.</p>
        </div>
        <button type="button" class="btn btn-primary" onclick="showCreateForm('videos')">+ Add Video</button>
      </div>
    </div>
  `;
  
  if (records && records.length > 0) {
    const columns = ["Title", "Category", "Views", "Published"];
    const keys = ["title", "category", "views_count", "published_at"];
    const rowsHtml = records.map((record) => {
      const values = keys.map((key) => formatValue(record[key])).join("</td><td>");
      return `
        <tr>
          <td>${values}</td>
          <td>
            <button type="button" class="btn btn-outline btn-sm" onclick="viewAdminItem('Videos', '${record.id}')">View</button>
            <button type="button" class="btn btn-accent btn-sm" onclick="deleteAdminRecord('videos', '${record.id}')">Delete</button>
          </td>
        </tr>
      `;
    }).join("");
    
    content += `
      <div class="admin-table-wrapper">
        <table class="admin-table">
          <thead>
            <tr>
              ${columns.map((col) => `<th>${escapeHtml(col)}</th>`).join("")}
              <th>Actions</th>
            </tr>
          </thead>
          <tbody>${rowsHtml}</tbody>
        </table>
      </div>
    `;
  } else {
    content += `<div class="card" style="padding: 1.5rem;"><p style="color: var(--text-secondary);">No videos found. Click "Add Video" to create one.</p></div>`;
  }
  
  main.innerHTML = content;
}

async function loadLessonsSection() {
  const records = await fetchTableRecords("lessons");
  const main = document.getElementById("admin-main-content");
  
  let content = `
    <div class="card" style="padding: 1.5rem; margin-bottom: 1.5rem;">
      <div style="display: flex; justify-content: space-between; align-items: center;">
        <div>
          <h2 class="card-title">Python Lessons</h2>
          <p style="color: var(--text-secondary);">Manage Python programming lessons.</p>
        </div>
        <button type="button" class="btn btn-primary" onclick="showCreateForm('lessons')">+ Add Lesson</button>
      </div>
    </div>
  `;
  
  if (records && records.length > 0) {
    const columns = ["Title", "Premium", "Level", "Updated"];
    const keys = ["title", "premium", "level", "updated_at"];
    const rowsHtml = records.map((record) => {
      const values = keys.map((key) => formatValue(record[key])).join("</td><td>");
      return `
        <tr>
          <td>${values}</td>
          <td>
            <button type="button" class="btn btn-outline btn-sm" onclick="viewAdminItem('Python Lessons', '${record.id}')">View</button>
            <button type="button" class="btn btn-accent btn-sm" onclick="deleteAdminRecord('lessons', '${record.id}')">Delete</button>
          </td>
        </tr>
      `;
    }).join("");
    
    content += `
      <div class="admin-table-wrapper">
        <table class="admin-table">
          <thead>
            <tr>
              ${columns.map((col) => `<th>${escapeHtml(col)}</th>`).join("")}
              <th>Actions</th>
            </tr>
          </thead>
          <tbody>${rowsHtml}</tbody>
        </table>
      </div>
    `;
  } else {
    content += `<div class="card" style="padding: 1.5rem;"><p style="color: var(--text-secondary);">No lessons found. Click "Add Lesson" to create one.</p></div>`;
  }
  
  main.innerHTML = content;
}

async function loadVacanciesSection() {
  const records = await fetchTableRecords("vacancies");
  const main = document.getElementById("admin-main-content");
  
  let content = `
    <div class="card" style="padding: 1.5rem; margin-bottom: 1.5rem;">
      <div style="display: flex; justify-content: space-between; align-items: center;">
        <div>
          <h2 class="card-title">Vacancies</h2>
          <p style="color: var(--text-secondary);">Manage job vacancies.</p>
        </div>
        <button type="button" class="btn btn-primary" onclick="showCreateForm('vacancies')">+ Add Vacancy</button>
      </div>
    </div>
  `;
  
  if (records && records.length > 0) {
    const columns = ["Title", "Company", "Location", "Views", "Deadline"];
    const keys = ["title", "company", "location", "views_count", "deadline"];
    const rowsHtml = records.map((record) => {
      const values = keys.map((key) => formatValue(record[key])).join("</td><td>");
      return `
        <tr>
          <td>${values}</td>
          <td>
            <button type="button" class="btn btn-outline btn-sm" onclick="viewAdminItem('Vacancies', '${record.id}')">View</button>
            <button type="button" class="btn btn-accent btn-sm" onclick="deleteAdminRecord('vacancies', '${record.id}')">Delete</button>
          </td>
        </tr>
      `;
    }).join("");
    
    content += `
      <div class="admin-table-wrapper">
        <table class="admin-table">
          <thead>
            <tr>
              ${columns.map((col) => `<th>${escapeHtml(col)}</th>`).join("")}
              <th>Actions</th>
            </tr>
          </thead>
          <tbody>${rowsHtml}</tbody>
        </table>
      </div>
    `;
  } else {
    content += `<div class="card" style="padding: 1.5rem;"><p style="color: var(--text-secondary);">No vacancies found. Click "Add Vacancy" to create one.</p></div>`;
  }
  
  main.innerHTML = content;
}

async function loadServicesSection() {
  const records = await fetchTableRecords("services");
  const main = document.getElementById("admin-main-content");
  
  let content = `
    <div class="card" style="padding: 1.5rem; margin-bottom: 1.5rem;">
      <div style="display: flex; justify-content: space-between; align-items: center;">
        <div>
          <h2 class="card-title">Services</h2>
          <p style="color: var(--text-secondary);">Manage available services.</p>
        </div>
        <button type="button" class="btn btn-primary" onclick="showCreateForm('services')">+ Add Service</button>
      </div>
    </div>
  `;
  
  if (records && records.length > 0) {
    const columns = ["Service", "Category", "Price", "Created"];
    const keys = ["name", "category", "price", "created_at"];
    const rowsHtml = records.map((record) => {
      const values = keys.map((key) => formatValue(record[key])).join("</td><td>");
      return `
        <tr>
          <td>${values}</td>
          <td>
            <button type="button" class="btn btn-outline btn-sm" onclick="viewAdminItem('Services', '${record.id}')">View</button>
            <button type="button" class="btn btn-accent btn-sm" onclick="deleteAdminRecord('services', '${record.id}')">Delete</button>
          </td>
        </tr>
      `;
    }).join("");
    
    content += `
      <div class="admin-table-wrapper">
        <table class="admin-table">
          <thead>
            <tr>
              ${columns.map((col) => `<th>${escapeHtml(col)}</th>`).join("")}
              <th>Actions</th>
            </tr>
          </thead>
          <tbody>${rowsHtml}</tbody>
        </table>
      </div>
    `;
  } else {
    content += `<div class="card" style="padding: 1.5rem;"><p style="color: var(--text-secondary);">No services found. Click "Add Service" to create one.</p></div>`;
  }
  
  main.innerHTML = content;
}

async function loadBlogSection() {
  const records = await fetchTableRecords("blog_posts");
  const main = document.getElementById("admin-main-content");
  
  let content = `
    <div class="card" style="padding: 1.5rem; margin-bottom: 1.5rem;">
      <div style="display: flex; justify-content: space-between; align-items: center;">
        <div>
          <h2 class="card-title">Blog Posts</h2>
          <p style="color: var(--text-secondary);">Manage blog articles.</p>
        </div>
        <button type="button" class="btn btn-primary" onclick="showCreateForm('blog')">+ Add Post</button>
      </div>
    </div>
  `;
  
  if (records && records.length > 0) {
    const columns = ["Title", "Category", "Views", "Published"];
    const keys = ["title", "category", "views_count", "published_at"];
    const rowsHtml = records.map((record) => {
      const values = keys.map((key) => formatValue(record[key])).join("</td><td>");
      return `
        <tr>
          <td>${values}</td>
          <td>
            <button type="button" class="btn btn-outline btn-sm" onclick="viewAdminItem('Blog Posts', '${record.id}')">View</button>
            <button type="button" class="btn btn-accent btn-sm" onclick="deleteAdminRecord('blog_posts', '${record.id}')">Delete</button>
          </td>
        </tr>
      `;
    }).join("");
    
    content += `
      <div class="admin-table-wrapper">
        <table class="admin-table">
          <thead>
            <tr>
              ${columns.map((col) => `<th>${escapeHtml(col)}</th>`).join("")}
              <th>Actions</th>
            </tr>
          </thead>
          <tbody>${rowsHtml}</tbody>
        </table>
      </div>
    `;
  } else {
    content += `<div class="card" style="padding: 1.5rem;"><p style="color: var(--text-secondary);">No blog posts found. Click "Add Post" to create one.</p></div>`;
  }
  
  main.innerHTML = content;
}

async function loadAdvertisementsSection() {
  const records = await fetchTableRecords("advertisements");
  const main = document.getElementById("admin-main-content");
  
  let content = `
    <div class="card" style="padding: 1.5rem; margin-bottom: 1.5rem;">
      <div style="display: flex; justify-content: space-between; align-items: center;">
        <div>
          <h2 class="card-title">Advertisements</h2>
          <p style="color: var(--text-secondary);">Manage advertisement campaigns.</p>
        </div>
        <button type="button" class="btn btn-primary" onclick="showCreateForm('advertisements')">+ Add Ad</button>
      </div>
    </div>
  `;
  
  if (records && records.length > 0) {
    const columns = ["Title", "Status", "Expires", "Created"];
    const keys = ["title", "status", "expires_at", "created_at"];
    const rowsHtml = records.map((record) => {
      const values = keys.map((key) => formatValue(record[key])).join("</td><td>");
      return `
        <tr>
          <td>${values}</td>
          <td>
            <button type="button" class="btn btn-outline btn-sm" onclick="viewAdminItem('Advertisements', '${record.id}')">View</button>
            <button type="button" class="btn btn-accent btn-sm" onclick="deleteAdminRecord('advertisements', '${record.id}')">Delete</button>
          </td>
        </tr>
      `;
    }).join("");
    
    content += `
      <div class="admin-table-wrapper">
        <table class="admin-table">
          <thead>
            <tr>
              ${columns.map((col) => `<th>${escapeHtml(col)}</th>`).join("")}
              <th>Actions</th>
            </tr>
          </thead>
          <tbody>${rowsHtml}</tbody>
        </table>
      </div>
    `;
  } else {
    content += `<div class="card" style="padding: 1.5rem;"><p style="color: var(--text-secondary);">No advertisements found. Click "Add Ad" to create one.</p></div>`;
  }
  
  main.innerHTML = content;
}

function showCreateForm(contentType) {
  const modal = document.getElementById("admin-modal");
  const title = document.getElementById("admin-modal-title");
  const body = document.getElementById("admin-modal-body");
  
  let formHtml;
  if (contentType === "books") {
    formHtml = `
      <form id="admin-create-form" style="display: flex; flex-direction: column; gap: 1rem;">
        <div class="form-group">
          <label style="display: block; margin-bottom: 0.5rem; font-weight: 600;">Book Title</label>
          <input type="text" name="title" placeholder="Enter book title" required style="width: 100%; padding: 0.75rem; border: 1px solid var(--border-color); border-radius: var(--border-radius); background-color: var(--bg-primary); color: var(--text-primary);">
        </div>
        <div class="form-group">
          <label style="display: block; margin-bottom: 0.5rem; font-weight: 600;">Author</label>
          <input type="text" name="author" placeholder="Enter author name" required style="width: 100%; padding: 0.75rem; border: 1px solid var(--border-color); border-radius: var(--border-radius); background-color: var(--bg-primary); color: var(--text-primary);">
        </div>
        <div class="form-group">
          <label style="display: block; margin-bottom: 0.5rem; font-weight: 600;">Category</label>
          <select name="category" required style="width: 100%; padding: 0.75rem; border: 1px solid var(--border-color); border-radius: var(--border-radius); background-color: var(--bg-primary); color: var(--text-primary);">
            <option value="MSCE">MSCE</option>
            <option value="JCE">JCE</option>
            <option value="Primary">Primary</option>
            <option value="Nursing">Nursing</option>
            <option value="Novels">Novels</option>
            <option value="Past Papers">Past Papers</option>
            <option value="Other">Other</option>
          </select>
        </div>
        <div class="form-group">
          <label style="display: block; margin-bottom: 0.5rem; font-weight: 600;">Google Drive Link</label>
          <input type="url" name="download_url" placeholder="https://drive.google.com/file/d/..." required style="width: 100%; padding: 0.75rem; border: 1px solid var(--border-color); border-radius: var(--border-radius); background-color: var(--bg-primary); color: var(--text-primary);">
        </div>
        <div class="form-group">
          <label style="display: block; margin-bottom: 0.5rem; font-weight: 600;">Cover Image URL</label>
          <input type="url" name="cover_url" placeholder="Optional cover image URL" style="width: 100%; padding: 0.75rem; border: 1px solid var(--border-color); border-radius: var(--border-radius); background-color: var(--bg-primary); color: var(--text-primary);">
        </div>
        <div class="form-group" style="display: flex; align-items: center; gap: 0.5rem;">
          <input type="checkbox" name="featured" id="featured-check">
          <label for="featured-check" style="font-weight: 600;">Featured Book</label>
        </div>
        <div style="display: flex; gap: 1rem; flex-wrap: wrap;">
          <button type="button" class="btn btn-outline" onclick="closeAdminModal()">Cancel</button>
          <button type="submit" class="btn btn-primary">Create Book</button>
        </div>
      </form>
    `;
  } else if (contentType === "videos") {
    formHtml = `
      <form id="admin-create-form" style="display: flex; flex-direction: column; gap: 1rem;">
        <div class="form-group">
          <label style="display: block; margin-bottom: 0.5rem; font-weight: 600;">Video Title</label>
          <input type="text" name="title" placeholder="Enter video title" required style="width: 100%; padding: 0.75rem; border: 1px solid var(--border-color); border-radius: var(--border-radius); background-color: var(--bg-primary); color: var(--text-primary);">
        </div>
        <div class="form-group">
          <label style="display: block; margin-bottom: 0.5rem; font-weight: 600;">Category</label>
          <select name="category" required style="width: 100%; padding: 0.75rem; border: 1px solid var(--border-color); border-radius: var(--border-radius); background-color: var(--bg-primary); color: var(--text-primary);">
            <option value="Mathematics">Mathematics</option>
            <option value="Science">Science</option>
            <option value="ICT">ICT</option>
            <option value="Business">Business</option>
            <option value="Exam Preparation">Exam Preparation</option>
            <option value="Other">Other</option>
          </select>
        </div>
        <div class="form-group">
          <label style="display: block; margin-bottom: 0.5rem; font-weight: 600;">Video URL</label>
          <input type="url" name="video_url" placeholder="Paste YouTube link" required style="width: 100%; padding: 0.75rem; border: 1px solid var(--border-color); border-radius: var(--border-radius); background-color: var(--bg-primary); color: var(--text-primary);">
        </div>
        <div class="form-group">
          <label style="display: block; margin-bottom: 0.5rem; font-weight: 600;">Thumbnail URL</label>
          <input type="url" name="thumbnail_url" placeholder="Optional image URL" style="width: 100%; padding: 0.75rem; border: 1px solid var(--border-color); border-radius: var(--border-radius); background-color: var(--bg-primary); color: var(--text-primary);">
        </div>
        <div class="form-group">
          <label style="display: block; margin-bottom: 0.5rem; font-weight: 600;">Description</label>
          <textarea name="description" placeholder="Enter video description" style="width: 100%; padding: 0.75rem; border: 1px solid var(--border-color); border-radius: var(--border-radius); background-color: var(--bg-primary); color: var(--text-primary); min-height: 100px;"></textarea>
        </div>
        <div style="display: flex; gap: 1rem;">
          <button type="button" class="btn btn-outline" onclick="closeAdminModal()">Cancel</button>
          <button type="submit" class="btn btn-primary">Create Video</button>
        </div>
      </form>
    `;
  } else if (contentType === "lessons") {
    formHtml = `
      <form id="admin-create-form" style="display: flex; flex-direction: column; gap: 1rem;">
        <div class="form-group">
          <label style="display: block; margin-bottom: 0.5rem; font-weight: 600;">Lesson Title</label>
          <input type="text" name="title" placeholder="Enter lesson title" required style="width: 100%; padding: 0.75rem; border: 1px solid var(--border-color); border-radius: var(--border-radius); background-color: var(--bg-primary); color: var(--text-primary);">
        </div>
        <div class="form-group">
          <label style="display: block; margin-bottom: 0.5rem; font-weight: 600;">Level</label>
          <select name="level" style="width: 100%; padding: 0.75rem; border: 1px solid var(--border-color); border-radius: var(--border-radius); background-color: var(--bg-primary); color: var(--text-primary);">
            <option value="Beginner">Beginner</option>
            <option value="Intermediate">Intermediate</option>
            <option value="Advanced">Advanced</option>
          </select>
        </div>
        <div class="form-group">
          <label style="display: block; margin-bottom: 0.5rem; font-weight: 600;">Position (Order)</label>
          <input type="number" name="position" value="1" style="width: 100%; padding: 0.75rem; border: 1px solid var(--border-color); border-radius: var(--border-radius); background-color: var(--bg-primary); color: var(--text-primary);">
        </div>
        <div class="form-group" style="display: flex; align-items: center; gap: 0.5rem;">
          <input type="checkbox" name="premium" id="premium-check">
          <label for="premium-check" style="font-weight: 600;">Premium Lesson</label>
        </div>
        <div class="form-group">
          <label style="display: block; margin-bottom: 0.5rem; font-weight: 600;">YouTube Video URL</label>
          <input type="url" name="video_url" placeholder="Paste YouTube link" style="width: 100%; padding: 0.75rem; border: 1px solid var(--border-color); border-radius: var(--border-radius); background-color: var(--bg-primary); color: var(--text-primary);">
        </div>
        <div class="form-group">
          <label style="display: block; margin-bottom: 0.5rem; font-weight: 600;">Summary</label>
          <textarea name="summary" placeholder="Short summary" style="width: 100%; padding: 0.75rem; border: 1px solid var(--border-color); border-radius: var(--border-radius); background-color: var(--bg-primary); color: var(--text-primary); min-height: 80px;"></textarea>
        </div>
        <div class="form-group">
          <label style="display: block; margin-bottom: 0.5rem; font-weight: 600;">Content (Markdown/HTML)</label>
          <textarea name="content" placeholder="Full lesson content" style="width: 100%; padding: 0.75rem; border: 1px solid var(--border-color); border-radius: var(--border-radius); background-color: var(--bg-primary); color: var(--text-primary); min-height: 150px;"></textarea>
        </div>
        <div style="display: flex; gap: 1rem;">
          <button type="button" class="btn btn-outline" onclick="closeAdminModal()">Cancel</button>
          <button type="submit" class="btn btn-primary">Create Lesson</button>
        </div>
      </form>
    `;
  } else if (contentType === "vacancies") {
    formHtml = `
      <form id="admin-create-form" style="display: flex; flex-direction: column; gap: 1rem;">
        <div class="form-group">
          <label style="display: block; margin-bottom: 0.5rem; font-weight: 600;">Job Title</label>
          <input type="text" name="title" placeholder="e.g. Secondary School Teacher" required style="width: 100%; padding: 0.75rem; border: 1px solid var(--border-color); border-radius: var(--border-radius); background-color: var(--bg-primary); color: var(--text-primary);">
        </div>
        <div class="form-group">
          <label style="display: block; margin-bottom: 0.5rem; font-weight: 600;">Company / Institution</label>
          <input type="text" name="company" placeholder="Organization name" required style="width: 100%; padding: 0.75rem; border: 1px solid var(--border-color); border-radius: var(--border-radius); background-color: var(--bg-primary); color: var(--text-primary);">
        </div>
        <div class="form-group">
          <label style="display: block; margin-bottom: 0.5rem; font-weight: 600;">Category</label>
          <select name="category" required style="width: 100%; padding: 0.75rem; border: 1px solid var(--border-color); border-radius: var(--border-radius); background-color: var(--bg-primary); color: var(--text-primary);">
            <option value="Teaching">Teaching</option>
            <option value="Administration">Administration</option>
            <option value="NGO">NGO</option>
            <option value="Professional">Professional</option>
            <option value="Other">Other</option>
          </select>
        </div>
        <div class="form-group">
          <label style="display: block; margin-bottom: 0.5rem; font-weight: 600;">Location</label>
          <input type="text" name="location" placeholder="e.g. Lilongwe" style="width: 100%; padding: 0.75rem; border: 1px solid var(--border-color); border-radius: var(--border-radius); background-color: var(--bg-primary); color: var(--text-primary);">
        </div>
        <div class="form-group">
          <label style="display: block; margin-bottom: 0.5rem; font-weight: 600;">Deadline</label>
          <input type="text" name="deadline" placeholder="e.g. 30 June 2026" style="width: 100%; padding: 0.75rem; border: 1px solid var(--border-color); border-radius: var(--border-radius); background-color: var(--bg-primary); color: var(--text-primary);">
        </div>
        <div class="form-group">
          <label style="display: block; margin-bottom: 0.5rem; font-weight: 600;">Apply Link / Email</label>
          <input type="text" name="apply_link" placeholder="URL or email address" style="width: 100%; padding: 0.75rem; border: 1px solid var(--border-color); border-radius: var(--border-radius); background-color: var(--bg-primary); color: var(--text-primary);">
        </div>
        <div class="form-group">
          <label style="display: block; margin-bottom: 0.5rem; font-weight: 600;">Job Description</label>
          <textarea name="description" placeholder="Enter full details" style="width: 100%; padding: 0.75rem; border: 1px solid var(--border-color); border-radius: var(--border-radius); background-color: var(--bg-primary); color: var(--text-primary); min-height: 120px;"></textarea>
        </div>
        <div style="display: flex; gap: 1rem;">
          <button type="button" class="btn btn-outline" onclick="closeAdminModal()">Cancel</button>
          <button type="submit" class="btn btn-primary">Post Vacancy</button>
        </div>
      </form>
    `;
  } else if (contentType === "services") {
    formHtml = `
      <form id="admin-create-form" style="display: flex; flex-direction: column; gap: 1rem;">
        <div class="form-group">
          <label style="display: block; margin-bottom: 0.5rem; font-weight: 600;">Service Name</label>
          <input type="text" name="name" placeholder="Service title" required style="width: 100%; padding: 0.75rem; border: 1px solid var(--border-color); border-radius: var(--border-radius); background-color: var(--bg-primary); color: var(--text-primary);">
        </div>
        <div class="form-group">
          <label style="display: block; margin-bottom: 0.5rem; font-weight: 600;">Category</label>
          <input type="text" name="category" placeholder="e.g. Academic" style="width: 100%; padding: 0.75rem; border: 1px solid var(--border-color); border-radius: var(--border-radius); background-color: var(--bg-primary); color: var(--text-primary);">
        </div>
        <div class="form-group">
          <label style="display: block; margin-bottom: 0.5rem; font-weight: 600;">Price / Fee</label>
          <input type="text" name="price" placeholder="e.g. MK 5,000" style="width: 100%; padding: 0.75rem; border: 1px solid var(--border-color); border-radius: var(--border-radius); background-color: var(--bg-primary); color: var(--text-primary);">
        </div>
        <div class="form-group">
          <label style="display: block; margin-bottom: 0.5rem; font-weight: 600;">Description</label>
          <textarea name="description" placeholder="What is included?" style="width: 100%; padding: 0.75rem; border: 1px solid var(--border-color); border-radius: var(--border-radius); background-color: var(--bg-primary); color: var(--text-primary); min-height: 100px;"></textarea>
        </div>
        <div style="display: flex; gap: 1rem;">
          <button type="button" class="btn btn-outline" onclick="closeAdminModal()">Cancel</button>
          <button type="submit" class="btn btn-primary">Create Service</button>
        </div>
      </form>
    `;
  } else if (contentType === "blog") {
    formHtml = `
      <form id="admin-create-form" style="display: flex; flex-direction: column; gap: 1rem;">
        <div class="form-group">
          <label style="display: block; margin-bottom: 0.5rem; font-weight: 600;">Post Title</label>
          <input type="text" name="title" placeholder="Blog title" required style="width: 100%; padding: 0.75rem; border: 1px solid var(--border-color); border-radius: var(--border-radius); background-color: var(--bg-primary); color: var(--text-primary);">
        </div>
        <div class="form-group">
          <label style="display: block; margin-bottom: 0.5rem; font-weight: 600;">Category</label>
          <input type="text" name="category" placeholder="e.g. News" style="width: 100%; padding: 0.75rem; border: 1px solid var(--border-color); border-radius: var(--border-radius); background-color: var(--bg-primary); color: var(--text-primary);">
        </div>
        <div class="form-group">
          <label style="display: block; margin-bottom: 0.5rem; font-weight: 600;">Featured Image URL</label>
          <input type="url" name="featured_image" placeholder="Image URL" style="width: 100%; padding: 0.75rem; border: 1px solid var(--border-color); border-radius: var(--border-radius); background-color: var(--bg-primary); color: var(--text-primary);">
        </div>
        <div class="form-group">
          <label style="display: block; margin-bottom: 0.5rem; font-weight: 600;">Excerpt (Short Summary)</label>
          <textarea name="excerpt" placeholder="Brief intro" style="width: 100%; padding: 0.75rem; border: 1px solid var(--border-color); border-radius: var(--border-radius); background-color: var(--bg-primary); color: var(--text-primary); min-height: 80px;"></textarea>
        </div>
        <div class="form-group">
          <label style="display: block; margin-bottom: 0.5rem; font-weight: 600;">Content (Full Post)</label>
          <textarea name="content" placeholder="Write your post here" style="width: 100%; padding: 0.75rem; border: 1px solid var(--border-color); border-radius: var(--border-radius); background-color: var(--bg-primary); color: var(--text-primary); min-height: 200px;"></textarea>
        </div>
        <div style="display: flex; gap: 1rem;">
          <button type="button" class="btn btn-outline" onclick="closeAdminModal()">Cancel</button>
          <button type="submit" class="btn btn-primary">Publish Post</button>
        </div>
      </form>
    `;
  } else if (contentType === "advertisements") {
    formHtml = `
      <form id="admin-create-form" style="display: flex; flex-direction: column; gap: 1rem;">
        <div class="form-group">
          <label style="display: block; margin-bottom: 0.5rem; font-weight: 600;">Ad Title</label>
          <input type="text" name="title" placeholder="Campaign name" required style="width: 100%; padding: 0.75rem; border: 1px solid var(--border-color); border-radius: var(--border-radius); background-color: var(--bg-primary); color: var(--text-primary);">
        </div>
        <div class="form-group">
          <label style="display: block; margin-bottom: 0.5rem; font-weight: 600;">Image URL</label>
          <input type="url" name="image_url" placeholder="Ad image URL" style="width: 100%; padding: 0.75rem; border: 1px solid var(--border-color); border-radius: var(--border-radius); background-color: var(--bg-primary); color: var(--text-primary);">
        </div>
        <div class="form-group">
          <label style="display: block; margin-bottom: 0.5rem; font-weight: 600;">Link URL</label>
          <input type="url" name="link_url" placeholder="Destination URL" style="width: 100%; padding: 0.75rem; border: 1px solid var(--border-color); border-radius: var(--border-radius); background-color: var(--bg-primary); color: var(--text-primary);">
        </div>
        <div class="form-group">
          <label style="display: block; margin-bottom: 0.5rem; font-weight: 600;">Expiry Date</label>
          <input type="date" name="expires_at" style="width: 100%; padding: 0.75rem; border: 1px solid var(--border-color); border-radius: var(--border-radius); background-color: var(--bg-primary); color: var(--text-primary);">
        </div>
        <div class="form-group">
          <label style="display: block; margin-bottom: 0.5rem; font-weight: 600;">Description</label>
          <textarea name="description" placeholder="Ad details" style="width: 100%; padding: 0.75rem; border: 1px solid var(--border-color); border-radius: var(--border-radius); background-color: var(--bg-primary); color: var(--text-primary); min-height: 80px;"></textarea>
        </div>
        <div style="display: flex; gap: 1rem;">
          <button type="button" class="btn btn-outline" onclick="closeAdminModal()">Cancel</button>
          <button type="submit" class="btn btn-primary">Create Ad</button>
        </div>
      </form>
    `;
  } else {
    formHtml = `
      <form id="admin-create-form" style="display: flex; flex-direction: column; gap: 1rem;">
        <div class="form-group">
          <label style="display: block; margin-bottom: 0.5rem; font-weight: 600;">Title / Name</label>
          <input type="text" name="title" placeholder="Enter title" required style="width: 100%; padding: 0.75rem; border: 1px solid var(--border-color); border-radius: var(--border-radius); background-color: var(--bg-primary); color: var(--text-primary);">
        </div>
        <div class="form-group">
          <label style="display: block; margin-bottom: 0.5rem; font-weight: 600;">Description</label>
          <textarea name="description" placeholder="Enter description" style="width: 100%; padding: 0.75rem; border: 1px solid var(--border-color); border-radius: var(--border-radius); background-color: var(--bg-primary); color: var(--text-primary); min-height: 120px;"></textarea>
        </div>
        <div style="display: flex; gap: 1rem;">
          <button type="button" class="btn btn-outline" onclick="closeAdminModal()">Cancel</button>
          <button type="submit" class="btn btn-primary">Create</button>
        </div>
      </form>
    `;
  }

  title.textContent = `Add New ${contentType.charAt(0).toUpperCase() + contentType.slice(1, -1)}`;
  body.innerHTML = formHtml;
  modal.classList.add("active");
  
  const form = document.getElementById("admin-create-form");
  if (form) {
    form.addEventListener("submit", (e) => {
      e.preventDefault();
      if (contentType === "books") {
        submitBookForm(e.target);
      } else {
        const formData = new FormData(e.target);
        const payload = Object.fromEntries(formData.entries());
        
        // Content type to table mapping
        const tableMap = {
          videos: "videos",
          lessons: "lessons",
          vacancies: "vacancies",
          services: "services",
          blog: "blog_posts",
          advertisements: "advertisements"
        };

        const tableName = tableMap[contentType] || contentType;

        // Handle special field types
        if (contentType === "lessons") {
          payload.premium = e.target.premium.checked;
          payload.position = parseInt(payload.position) || 1;
          
          const videoId = extractYoutubeId(payload.video_url);
          if (videoId) {
            payload.thumbnail_url = getYoutubeThumbnail(videoId);
          }
        }

        if (contentType === "blog") {
          payload.status = 'published'; // Live publication
        }

        submitAdminRecord(tableName, payload);
      }
    });
  }
}

async function submitBookForm(form) {
  if (!window.supabaseClient) {
    window.showError("Unable to save the book because the database client is unavailable.");
    return;
  }

  const title = form.title.value.trim();
  const author = form.author.value.trim();
  const category = form.category.value;
  const downloadUrl = form.download_url.value.trim();
  const coverUrl = form.cover_url.value.trim();
  const featured = form.featured.checked;

  if (!title || !author || !category || !downloadUrl) {
    window.showError("Title, author, category, and Google Drive link are required.");
    return;
  }

  const normalizedDownloadUrl = window.convertGoogleDriveLink(downloadUrl);
  const bookPayload = {
    title,
    author,
    category,
    description: "DOWNLOAD BOOKS FOR FREE FROM MEBV PLATFORM",
    download_url: normalizedDownloadUrl,
    cover_url: coverUrl || null,
    featured: featured,
    downloads_count: 0,
    average_rating: 0
  };

  const { session, user } = await getSessionDetails();
  if (!session || !user) {
    window.showError("Administrator login required before uploading.");
    console.warn("[Admin Dashboard] Create book blocked because no authenticated session exists.");
    return;
  }

  window.showLoading("Saving new book...");
  try {
    const { data, error } = await window.supabaseClient
      .from("books")
      .insert([bookPayload])
      .select()
      .single();

    if (error) throw error;

    window.showSuccess("Book successfully created.");
    closeAdminModal();
    await loadBooksSection();

    if (data && data.id) {
      window.showToast("The book is now available in the library and its preview details are generated.", "success");
    }
  } catch (err) {
    console.error("Failed to create book:", err);
    window.showError(err.message || "Could not save the book. Please try again.");
  } finally {
    window.hideLoading();
  }
}

/**
 * Reusable function to insert a record into a specific database table.
 * 
 * @param {string} tableName - The Supabase table name to insert into
 * @param {Object} payload - The data to be inserted
 */
async function submitAdminRecord(tableName, payload) {
  if (!window.supabaseClient) {
    window.showError("Unable to save because the database client is unavailable.");
    return;
  }

  const { session, user } = await getSessionDetails();
  if (!session || !user) {
    window.showError("Administrator login required before saving.");
    console.warn(`[Admin Dashboard] Create record in ${tableName} blocked because no authenticated session exists.`);
    return;
  }

  window.showLoading(`Saving to ${tableName}...`);
  console.log(`[Admin Dashboard] Table Name: ${tableName}`);
  console.log(`[Admin Dashboard] Payload:`, payload);

  try {
    const { data, error } = await window.supabaseClient
      .from(tableName)
      .insert([payload])
      .select()
      .single();

    if (error) {
      console.error(`[Admin Dashboard] Insert Error for ${tableName}:`, error);
      throw error;
    }

    console.log(`[Admin Dashboard] Insert Result for ${tableName}:`, data);
    window.showSuccess("Record successfully created.");
    closeAdminModal();
    
    // Refresh current active section to show new data
    const activeSection = document.querySelector(".admin-nav-item.active")?.getAttribute("data-section") || "overview";
    loadSectionData(activeSection);

    // Global Event for Live Publication (if other windows are open, they won't see it without realtime, but for this user's current session, it's enough)
    // However, if we want "Automatic reload", we can trigger a reload or just ensure the state is fresh.
    // The user specifically mentioned "Automatic reload after successful insert" and "Update DOM immediately".
    if (["blog_posts", "services", "advertisements", "books"].includes(tableName)) {
      window.showToast("Content published live! Updating view...", "success");
    }

  } catch (err) {
    console.error(`[Admin Dashboard] Failed to create record in ${tableName}:`, err);
    window.showError(err.message || "Could not save the data. Please try again.");
  } finally {
    window.hideLoading();
  }
}

async function renderAdminTable(title, columns, records, keys) {
  const main = document.getElementById("admin-main-content");
  if (!main) return;

  if (!records || records.length === 0) {
    main.innerHTML = `
      <div class="card" style="padding: 2rem;">
        <h2 class="card-title">${escapeHtml(title)}</h2>
        <p style="color: var(--text-secondary);">No records were found for this section.</p>
      </div>
    `;
    return;
  }

  const rowsHtml = records.map((record) => {
    const values = keys.map((key) => formatValue(record[key])).join("</td><td>");
    return `
      <tr>
        <td>${values}</td>
        <td>
          <button type="button" class="btn btn-outline btn-sm" onclick="viewAdminItem('${escapeHtml(title)}', '${record.id}')">View</button>
          <button type="button" class="btn btn-accent btn-sm" onclick="deleteAdminRecord('${escapeHtml(getTableName(title))}', '${record.id}')">Delete</button>
        </td>
      </tr>
    `;
  }).join("");

  main.innerHTML = `
    <div class="card" style="padding: 1.5rem; margin-bottom: 1.5rem;">
      <h2 class="card-title">${escapeHtml(title)}</h2>
      <p style="color: var(--text-secondary);">Manage and review records for ${escapeHtml(title.toLowerCase())}.</p>
    </div>
    <div class="admin-table-wrapper">
      <table class="admin-table">
        <thead>
          <tr>
            ${columns.map((col) => `<th>${escapeHtml(col)}</th>`).join("")}
            <th>Actions</th>
          </tr>
        </thead>
        <tbody>
          ${rowsHtml}
        </tbody>
      </table>
    </div>
  `;
}

async function fetchTableCount(tableName) {
  if (!window.supabaseClient) return 0;
  try {
    const { count, error } = await window.supabaseClient
      .from(tableName)
      .select("id", { count: "exact", head: true });
    if (error) throw error;
    return count || 0;
  } catch (error) {
    return 0;
  }
}

async function fetchTableRecords(tableName) {
  if (!window.supabaseClient) return [];
  try {
    const { data, error } = await window.supabaseClient
      .from(tableName)
      .select("*")
      .order("created_at", { ascending: false })
      .limit(200);
    if (error) throw error;
    return data || [];
  } catch (error) {
    console.warn(`Unable to fetch records from ${tableName}:`, error);
    return [];
  }
}

function renderAdminTable(title, columns, records, keys) {
  const main = document.getElementById("admin-main-content");
  if (!main) return;

  if (!records || records.length === 0) {
    main.innerHTML = `
      <div class="card" style="padding: 2rem;">
        <h2 class="card-title">${escapeHtml(title)}</h2>
        <p style="color: var(--text-secondary);">No records were found for this section.</p>
      </div>
    `;
    return;
  }

  const rowsHtml = records.map((record) => {
    const values = keys.map((key) => formatValue(record[key])).join("</td><td>");
    return `
      <tr>
        <td>${values}</td>
        <td>
          <button type="button" class="btn btn-outline btn-sm" onclick="viewAdminItem('${escapeHtml(title)}', '${record.id}')">View</button>
          <button type="button" class="btn btn-accent btn-sm" onclick="deleteAdminRecord('${escapeHtml(getTableName(title))}', '${record.id}')">Delete</button>
        </td>
      </tr>
    `;
  }).join("");

  main.innerHTML = `
    <div class="card" style="padding: 1.5rem; margin-bottom: 1.5rem;">
      <h2 class="card-title">${escapeHtml(title)}</h2>
      <p style="color: var(--text-secondary);">Manage and review records for ${escapeHtml(title.toLowerCase())}.</p>
    </div>
    <div class="admin-table-wrapper">
      <table class="admin-table">
        <thead>
          <tr>
            ${columns.map((col) => `<th>${escapeHtml(col)}</th>`).join("")}
            <th>Actions</th>
          </tr>
        </thead>
        <tbody>
          ${rowsHtml}
        </tbody>
      </table>
    </div>
  `;
}

function getTableName(sectionTitle) {
  const map = {
    "Overview": "overview",
    "Books": "books",
    "Videos": "videos",
    "Python Lessons": "lessons",
    "Vacancies": "vacancies",
    "Services": "services",
    "Blog Posts": "blog_posts",
    "Advertisements": "advertisements",
    "Users": "profiles",
    "Payments": "payments",
    "Audit Logs": "audit_logs"
  };
  return map[sectionTitle] || sectionTitle.toLowerCase().replace(/\s+/g, "_");
}

function extractYoutubeId(url) {
  if (!url) return null;
  const regExp = /^.*(youtu.be\/|v\/|u\/\w\/|embed\/|watch\?v=|&v=|shorts\/)([^#&?]*).*/;
  const match = url.match(regExp);
  return (match && match[2].length === 11) ? match[2] : null;
}

function getYoutubeThumbnail(videoId) {
  return videoId ? `https://img.youtube.com/vi/${videoId}/maxresdefault.jpg` : null;
}

function formatValue(value) {
  if (value === null || value === undefined) return "-";
  if (typeof value === "boolean") return value ? "Yes" : "No";
  if (typeof value === "string" && value.length > 50) return escapeHtml(value.slice(0, 50)) + "...";
  return escapeHtml(String(value));
}

async function viewAdminItem(section, recordId) {
  if (!recordId) return;
  const table = getTableName(section);
  const record = await fetchSingleRecord(table, recordId);
  if (!record) {
    window.showError("Unable to load record details.");
    return;
  }
  const bodyHtml = Object.entries(record).map(([key, value]) => `
    <p style="margin-bottom: 0.75rem;"><strong>${escapeHtml(key)}:</strong> ${escapeHtml(String(value || 'N/A'))}</p>
  `).join("");
  document.getElementById("admin-modal-title").textContent = `${section} details`;
  document.getElementById("admin-modal-body").innerHTML = bodyHtml;
  document.getElementById("admin-modal").classList.add("active");
}

async function fetchSingleRecord(table, recordId) {
  if (!window.supabaseClient) return null;
  try {
    const { data, error } = await window.supabaseClient
      .from(table)
      .select("*")
      .eq("id", recordId)
      .single();
    if (error) throw error;
    return data;
  } catch (error) {
    console.warn(`Unable to fetch record ${recordId} from ${table}:`, error);
    return null;
  }
}

async function deleteAdminRecord(table, recordId) {
  if (!window.supabaseClient || !table || !recordId) return;

  const { session, user } = await getSessionDetails();
  if (!session || !user) {
    window.showError("Administrator login required before deleting records.");
    console.warn("[Admin Dashboard] Delete operation blocked because no authenticated session exists.");
    return;
  }

  window.showLoading("Removing record...");
  try {
    const { error } = await window.supabaseClient
      .from(table)
      .delete()
      .eq("id", recordId);
    if (error) throw error;
    window.showSuccess("Record deleted successfully.");
    const activeSection = document.querySelector(".admin-nav-item.active")?.getAttribute("data-section") || "overview";
    loadSectionData(activeSection);
  } catch (error) {
    console.error("Unable to delete record:", error);
    window.showError("Could not delete the record. Try again later.");
  } finally {
    window.hideLoading();
  }
}

function closeAdminModal() {
  document.getElementById("admin-modal").classList.remove("active");
}

function escapeHtml(value) {
  return String(value || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/\"/g, "&quot;")
    .replace(/'/g, "&#039;");
}
// ==========================================
// SECURE OVERRIDE: Do not modify above code.
// ==========================================

// Re-declaring initAdminDashboard at the bottom overrides the original to enforce role checking.
async function initAdminDashboard() {
  if (!window.supabaseClient) {
    window.location.href = "index.html";
    return;
  }

  try {
    const { data: { session } } = await window.supabaseClient.auth.getSession();
    if (!session || !session.user) {
      window.location.href = "index.html";
      return;
    }

    // SECURE ROLE CHECK: Fetch user profile to verify they have the admin role
    const { data: profile, error: profileError } = await window.supabaseClient
      .from("profiles")
      .select("role")
      .eq("id", session.user.id)
      .single();

    if (profileError || !profile || profile.role !== "admin") {
      console.warn("[Admin Dashboard] Unauthorized access attempt blocked.");
      window.location.href = "index.html";
      return;
    }

    // Call the original navigation and loading setups defined earlier in your admin.js
    setupAdminNavigation();
    loadAdminOverview();
  } catch (error) {
    console.error("Admin initialization failed:", error);
    window.location.href = "index.html";
  }
}
