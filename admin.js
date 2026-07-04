// admin.js
// Final production version using Google Drive's native thumbnail engine

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

// Start logic when DOM is ready
window.addEventListener("DOMContentLoaded", initAdminDashboard);

async function initAdminDashboard() {
  if (!window.supabaseClient) { window.location.href = "index.html"; return; }
  try {
    const { data: { session } } = await window.supabaseClient.auth.getSession();
    if (!session || !session.user) { window.location.href = "index.html"; return; }
    
    // Check for admin roles
    const { data: profile } = await window.supabaseClient.from("profiles").select("role").eq("id", session.user.id).single();
    if (!profile || !["admin", "super_admin", "content_manager"].includes(profile.role)) {
        window.location.href = "index.html";
        return;
    }

    setupAdminNavigation();
    loadSectionData("overview");
  } catch (error) { window.location.href = "index.html"; }
}

/**
 * PRODUCTION GOOGLE DRIVE THUMBNAIL LOGIC
 * Extracts ID and constructs URL. sz=w1000 provides high resolution.
 */
function getGdriveNativeThumbnail(driveUrl) {
    if (!driveUrl) return null;
    const match = driveUrl.match(/[-\w]{25,}/);
    if (!match) return null;
    return `https://drive.google.com/thumbnail?id=${match[0]}&sz=w1000`;
}

/**
 * Handle initial book creation
 */
async function submitBookForm(form) {
    const title = form.title.value.trim();
    const author = form.author.value.trim();
    const category = form.category.value;
    const rawDownloadUrl = form.download_url.value.trim();
    const featured = form.featured.checked;

    if (!title || !rawDownloadUrl) {
        window.showError("Please fill out Title and Link.");
        return;
    }

    window.showLoading("Saving to library...");
    try {
        // Construct clean preview and direct download links
        const coverUrl = getGdriveNativeThumbnail(rawDownloadUrl);
        const normalizedDownloadUrl = window.convertGoogleDriveLink(rawDownloadUrl);

        const { error } = await window.supabaseClient
            .from("books")
            .insert([{
                title, 
                author, 
                category, 
                featured,
                download_url: normalizedDownloadUrl,
                cover_url: coverUrl, // Auto-saved string URL
                description: "Educational Material"
            }]);

        if (error) throw error;

        window.showSuccess("Book saved with native first-page cover!");
        closeAdminModal();
        loadSectionData("books");
    } catch (err) {
        window.showError("Failed to save book: " + err.message);
    } finally {
        window.hideLoading();
    }
}

/**
 * Refresh thumbnail for existing items
 */
async function regenBookThumbnail(bookId, driveUrl) {
    const coverUrl = getGdriveNativeThumbnail(driveUrl);
    if (!coverUrl) {
        window.showError("Invalid ID in file link.");
        return;
    }
    
    window.showLoading("Linking native thumbnail...");
    const { error } = await window.supabaseClient
        .from("books")
        .update({ cover_url: coverUrl })
        .eq("id", bookId);

    if (!error) {
        window.showSuccess("Cover synced with Google successfully.");
        loadSectionData("books");
    } else {
        window.showError("Update failed.");
    }
    window.hideLoading();
}

/**
 * Navigation and Data Section Logic
 */
async function loadSectionData(section) {
    const main = document.getElementById("admin-main-content");
    if (!main) return;
    if (section === "overview") return loadAdminOverview();
    
    window.showLoading("Loading data...");
    try {
        if (section === "books") {
            const { data: records } = await window.supabaseClient.from("books").select("*").order("created_at", { ascending: false });
            let content = `
                <div class="card" style="padding:1.5rem; margin-bottom:1.5rem; display:flex; justify-content:space-between; align-items:center;">
                    <h2 class="card-title">Curriculum Materials</h2>
                    <button class="btn btn-primary" onclick="showCreateForm('books')">+ New Book</button>
                </div>`;
            if (records && records.length > 0) {
                const rows = records.map(r => `
                    <tr>
                        <td style="display:flex; align-items:center; gap:10px;">
                            <img src="${r.cover_url || 'LOGO.png'}" 
                                 style="width:30px; height:45px; border-radius:3px; object-fit:cover; border:1px solid var(--border-color);" 
                                 onerror="this.src='LOGO.png'">
                            <span>${escapeHtml(r.title)}</span>
                        </td>
                        <td>${r.category}</td>
                        <td style="white-space:nowrap;">
                            <button class="btn btn-outline btn-sm" onclick="regenBookThumbnail('${r.id}','${r.download_url}')">🔄 Sync Cover</button>
                            <button class="btn btn-accent btn-sm" onclick="deleteAdminRecord('books','${r.id}')">Delete</button>
                        </td>
                    </tr>`).join("");
                content += `<div class="admin-table-wrapper"><table class="admin-table"><thead><tr><th>Material</th><th>Level</th><th>Actions</th></tr></thead><tbody>${rows}</tbody></table></div>`;
            } else { content += "<p>Library is empty.</p>"; }
            main.innerHTML = content;
        } else {
            // Existing logic for other tables
            const table = {videos:"videos", lessons:"lessons", vacancies:"vacancies", services:"services", advertisements:"advertisements", audit:"audit_logs", users:"profiles"}[section] || section;
            const { data } = await window.supabaseClient.from(table).select("*").order("created_at", { ascending: false }).limit(50);
            renderStandardTable(ADMIN_SECTIONS[section], data, section);
        }
    } finally { window.hideLoading(); }
}

/**
 * Rendering Support
 */
function renderStandardTable(title, records, section) {
    const main = document.getElementById("admin-main-content");
    let content = `<div class="card" style="padding:1.5rem; margin-bottom:1rem; display:flex; justify-content:space-between; align-items:center;">
        <h2 class="card-title">${title}</h2><button class="btn btn-primary" onclick="showCreateForm('${section}')">+ Add New</button>
    </div>`;
    if (records?.length > 0) {
        const rows = records.map(r => `<tr><td>${escapeHtml(r.title || r.name || r.id)}</td><td><button class="btn btn-accent btn-sm" onclick="deleteAdminRecord('${section}','${r.id}')">Delete</button></td></tr>`).join("");
        content += `<div class="admin-table-wrapper"><table class="admin-table"><thead><tr><th>Identity</th><th>Action</th></tr></thead><tbody>${rows}</tbody></table></div>`;
    } else { content += "<p>No data recorded.</p>"; }
    main.innerHTML = content;
}

/**
 * FORM HANDLING
 */
function showCreateForm(contentType) {
  const modal = document.getElementById("admin-modal");
  const body = document.getElementById("admin-modal-body");
  const title = document.getElementById("admin-modal-title");
  title.textContent = "New " + contentType.slice(0,-1).toUpperCase();

  if (contentType === "books") {
      body.innerHTML = `
        <form id="bk-f" style="display:flex; flex-direction:column; gap:1rem;">
            <input name="title" required placeholder="Book Title" class="form-control">
            <input name="author" placeholder="Author" class="form-control">
            <select name="category" class="form-control">
                <option value="MSCE">MSCE</option><option value="JCE">JCE</option><option value="Primary">Primary</option><option value="Past Papers">Past Papers</option>
            </select>
            <input name="download_url" required placeholder="Public G-Drive Link" class="form-control">
            <label style="display:flex; align-items:center; gap:8px;"><input type="checkbox" name="featured"> Highlight in homepage</label>
            <button class="btn btn-primary">Save to Library</button>
        </form>`;
      document.getElementById("bk-f").onsubmit = (e) => { e.preventDefault(); submitBookForm(e.target); };
  } else {
      body.innerHTML = `<form id="gen-f" style="display:flex; flex-direction:column; gap:1rem;"><input name="title" required placeholder="Title" class="form-control"><textarea name="description" placeholder="Short description" class="form-control"></textarea><button class="btn btn-primary">Post Content</button></form>`;
      document.getElementById("gen-f").onsubmit = async (e) => {
          e.preventDefault();
          const d = Object.fromEntries(new FormData(e.target).entries());
          await window.supabaseClient.from(contentType === 'blog' ? 'blog_posts' : contentType).insert([d]);
          window.showSuccess("Posted successfully.");
          closeAdminModal();
          loadSectionData(contentType);
      };
  }
  modal.classList.add("active");
}

function setupAdminNavigation() {
    document.querySelectorAll(".admin-nav-item").forEach(item => {
        item.onclick = () => {
            document.querySelectorAll(".admin-nav-item").forEach(i => i.classList.remove("active"));
            item.classList.add("active");
            loadSectionData(item.dataset.section);
        };
    });
}

// SHARED UTILITIES
async function loadAdminOverview() {
    const tables = ["books", "videos", "lessons", "vacancies", "payments"];
    const counts = await Promise.all(tables.map(async t => {
        const { count } = await window.supabaseClient.from(t).select("id", { count: "exact", head: true });
        return count || 0;
    }));
    document.getElementById("admin-main-content").innerHTML = `
      <div class="card" style="padding:1.5rem; margin-bottom:2rem;"><h2>Administrative Summary</h2><p>Overview of stored content.</p></div>
      <div class="grid-layout">${tables.map((n, i) => `<div class="card" style="padding:1.5rem;"><p style="font-size:0.8rem; font-weight:800; color:var(--text-muted);">${n.toUpperCase()}</p><h1>${counts[i]}</h1></div>`).join("")}</div>`;
}

function escapeHtml(s) { return String(s || "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;"); }
function closeAdminModal() { document.getElementById("admin-modal").classList.remove("active"); }
async function deleteAdminRecord(sec, id) { 
    if(confirm("Permanently delete?")) { 
        await window.supabaseClient.from(sec==='books'?'books':sec).delete().eq("id",id); 
        loadSectionData(sec); 
    } 
}