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

let adminAuthStateListenerRegistered = false;

function logAdminSession(session, label = "Session check") {
    console.info("[AUTH DEBUG] " + label, {
        userId: session?.user?.id || null,
        sessionExists: Boolean(session),
        accessTokenExists: Boolean(session?.access_token),
        sessionExpires: session?.expires_at ? new Date(session.expires_at * 1000).toISOString() : null
    });
}

function waitForAdminSession() {
    return new Promise(async resolve => {
        let settled = false;
        const finish = session => {
            if (settled) return;
            settled = true;
            resolve(session || null);
        };

        const { data } = await window.supabaseClient.auth.getSession();
        logAdminSession(data.session, "Session check");
        if (data.session) return finish(data.session);

        const timeout = setTimeout(() => finish(null), 2500);
        const { data: subscription } = window.supabaseClient.auth.onAuthStateChange((event, session) => {
            console.info("[AUTH DEBUG] Auth event:", event);
            logAdminSession(session, "Auth event session");
            if (event === "INITIAL_SESSION" || event === "SIGNED_IN" || event === "TOKEN_REFRESHED") {
                clearTimeout(timeout);
                finish(session);
            }
        });
    });
}

async function initAdminDashboard() {
    if (!window.supabaseClient) {
        console.warn("[AUTH DEBUG] Logout triggered by: Supabase client unavailable");
        window.location.href = "index.html";
        return;
    }

    if (!adminAuthStateListenerRegistered) {
        adminAuthStateListenerRegistered = true;
        window.supabaseClient.auth.onAuthStateChange((event, session) => {
            console.info("[AUTH DEBUG] Auth event:", event);
            logAdminSession(session, "Auth state change");
            if (event === "SIGNED_OUT") console.warn("[AUTH DEBUG] Logout triggered by: Supabase SIGNED_OUT event");
        });
    }

  try {
        const session = await waitForAdminSession();
        if (!session || !session.user) {
            console.warn("[AUTH DEBUG] Logout triggered by: no session after initial-session wait");
            window.showError("Your session could not be restored. Please log in again.");
            return;
        }
    
    // Check for admin roles
        const { data: profile, error: profileError } = await window.supabaseClient.from("profiles").select("role").eq("id", session.user.id).single();
        console.info("[AUTH DEBUG] Admin profile:", { userId: session.user.id, profile, error: profileError?.message || null });
        if (profileError) {
                window.showError("Admin profile check failed: " + profileError.message);
                return;
        }
    if (!profile || !["admin", "super_admin", "content_manager"].includes(profile.role)) {
                console.warn("[AUTH DEBUG] Logout triggered by: authenticated user lacks an admin role", { userId: session.user.id });
        window.location.href = "index.html";
        return;
    }

    setupAdminNavigation();
    loadSectionData("overview");
    } catch (error) {
        console.error("[AUTH DEBUG] Admin initialization failed:", error);
        window.showError("Admin authentication check failed: " + (error.message || "unknown error"));
    }
}

async function syncBookCoverRecord(bookId) {
    const { data, error } = await window.supabaseClient.functions.invoke("sync-book-cover", {
        body: { bookId }
    });
    if (error) {
        let message = error.message || "Book cover synchronization failed.";
        if (error.context && typeof error.context.clone === "function") {
            const responseBody = await error.context.clone().json().catch(() => null);
            if (responseBody?.error) message = responseBody.error;
        }
        throw new Error(message);
    }
    if (!data?.success) throw new Error(data?.error || "Book cover synchronization failed.");
    return data;
}

let bookCoverSyncRunning = false;

async function syncAllBookCovers(button) {
    if (bookCoverSyncRunning) return;
    if (!window.confirm("Sync cover pages for all uploaded books now?")) return;

    bookCoverSyncRunning = true;
    if (button) button.disabled = true;

    const counts = { total: 0, synced: 0, alreadyValid: 0, failed: [] };
    try {
        const books = [];
        const pageSize = 200;
        for (let offset = 0; ; offset += pageSize) {
            const { data: page, error } = await window.supabaseClient
                .from("books")
                .select("id,title")
                .order("created_at", { ascending: true })
                .range(offset, offset + pageSize - 1);
            if (error) throw error;
            books.push(...(page || []));
            if (!page || page.length < pageSize) break;
        }

        counts.total = books.length;
        for (let index = 0; index < counts.total; index += 1) {
            const book = books[index];
            window.showLoading(`Syncing book covers... ${index + 1} / ${counts.total}`);
            try {
                const result = await syncBookCoverRecord(book.id);
                if (result.status === "already_valid") counts.alreadyValid += 1;
                else counts.synced += 1;
            } catch (error) {
                console.error("[BOOK COVER SYNC] Book failed:", book.id, error);
                counts.failed.push(`${book.title || "Untitled book"} — ${error.message || "Preview could not be generated"}`);
            }
        }

        const message = counts.failed.length
            ? `Book cover sync completed with warnings. ${counts.synced} of ${counts.total} books updated, ${counts.failed.length} could not be processed.`
            : `Book covers synced successfully. ${counts.synced} of ${counts.total} books updated.`;
        if (counts.failed.length) {
            window.showError(message);
        } else {
            window.showSuccess(message);
        }
        window.alert(`Cover Sync Complete\n${message}\nTotal: ${counts.total}\nSynced: ${counts.synced}\nAlready valid: ${counts.alreadyValid}\nFailed: ${counts.failed.length}${counts.failed.length ? `\n\nFailed books:\n${counts.failed.map(name => `- ${name}`).join("\n")}` : ""}`);
        await loadSectionData("books");
    } catch (error) {
        console.error("[BOOK COVER SYNC] Could not complete synchronization:", error);
        window.showError(`Book cover synchronization could not start: ${error.message || "Unknown error"}`);
    } finally {
        window.hideLoading();
        bookCoverSyncRunning = false;
        if (button) button.disabled = false;
    }
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
        // Normalize the stored link; the server generates the persistent preview after insert.
        const normalizedDownloadUrl = window.convertGoogleDriveLink(rawDownloadUrl);

        const { data: inserted, error } = await window.supabaseClient
            .from("books")
            .insert([{
                title, 
                author, 
                category, 
                featured,
                download_url: normalizedDownloadUrl,
                cover_url: null,
                description: "Educational Material"
            }])
            .select("id");

        if (error) throw error;
        if (inserted?.[0]?.id) {
            try {
                await syncBookCoverRecord(inserted[0].id);
            } catch (coverError) {
                console.error("[BOOK COVER SYNC] New book preview failed:", inserted[0].id, coverError);
            }
        }

        window.showSuccess("Book saved successfully.");
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
    window.showLoading("Syncing first-page preview...");
    try {
        const result = await syncBookCoverRecord(bookId);
        window.showSuccess(result.status === "already_valid" ? "Book already has a valid cover preview." : "First-page preview synced successfully.");
        loadSectionData("books");
    } catch (error) {
        window.showError(error.message || "Book cover synchronization failed.");
    } finally {
        window.hideLoading();
    }
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
                    <div style="display:flex;gap:.75rem;flex-wrap:wrap;">
                        <button class="btn btn-outline" onclick="syncAllBookCovers(this)">SYNC ALL BOOK COVERS</button>
                        <button class="btn btn-primary" onclick="showCreateForm('books')">+ New Book</button>
                    </div>
                </div>`;
            if (records && records.length > 0) {
                const rows = records.map(r => `
                    <tr>
                        <td style="display:flex; align-items:center; gap:10px;">
                            ${r.cover_url
                              ? `<img src="${r.cover_url}" alt="Book first-page preview"
                                     style="width:30px; height:45px; border-radius:3px; object-fit:contain; background:var(--bg-tertiary); border:1px solid var(--border-color);"
                                     onerror="this.onerror=null;this.parentElement.textContent='Preview unavailable'">`
                              : `<span style="font-size:.7rem;color:var(--muted-text,#666);">Preview unavailable</span>`}
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
/**
 * FORM ENHANCEMENT ENGINE v5.0
 * Implements professional grouped forms with advanced validation and YouTube automation.
 */

// Override general content creation UI
window.showGeneralForm = window.showCreateForm = function(type) {
    const modal = document.getElementById("admin-modal");
    const body = document.getElementById("admin-modal-body");
    const title = document.getElementById("admin-modal-title");
    title.textContent = "New Content: " + ADMIN_SECTIONS[type];
    
    // Automatic Section Layout Logic
    let html = `<form id="master-admin-form" style="display:grid; gap:1.5rem; max-height: 80vh; overflow-y: auto; padding-right: 0.5rem;">`;

    // Internal UI Switcher
    if (type === 'books' || type === 'Books') {
        html += renderBookFormUI();
    } else if (type === 'videos' || type === 'Videos') {
        html += renderVideoFormUI();
    } else if (type === 'lessons' || type === 'Python Lessons') {
        html += renderPythonFormUI();
    } else if (type === 'vacancies' || type === 'Vacancies') {
        html += renderVacancyFormUI();
    } else if (type === 'services' || type === 'Services') {
        html += renderServiceFormUI();
    } else if (type === 'blog' || type === 'Blog Posts') {
        html += renderBlogFormUI();
    } else if (type === 'advertisements' || type === 'Advertisements') {
        html += renderAdFormUI();
    } else {
        html += `<div class="form-group"><input name="title" required placeholder="Title" class="form-control"></div>`;
    }

    html += `
        <div style="position: sticky; bottom: 0; background: var(--bg-secondary); padding: 1rem 0; display:flex; gap:1rem;">
            <button type="button" class="btn btn-outline" style="flex:1" onclick="closeAdminModal()">Discard</button>
            <button type="submit" class="btn btn-primary" style="flex:2">Publish Content</button>
        </div>
    </form>`;

    body.innerHTML = html;
    modal.classList.add("active");

    const form = document.getElementById("master-admin-form");
    form.onsubmit = async (e) => {
        e.preventDefault();
        await handleMasterSubmission(type, new FormData(e.target));
    };
};

// ==========================================
// INDIVIDUAL FORM GENERATORS
// ==========================================

function renderBookFormUI() {
    return `
        <fieldset style="border:none; padding:0; display:grid; gap:1rem;">
            <legend style="font-weight:800; margin-bottom:0.5rem; color:var(--color-primary);">Basic Info</legend>
            <input name="title" placeholder="Book Title *" required class="form-control">
            <input name="author" placeholder="Author Name" class="form-control">
            <select name="category" class="form-control" required>
                <option value="">-- Select Level --</option>
                <option value="Primary">Primary</option><option value="JCE">JCE</option>
                <option value="MSCE">MSCE</option><option value="Nursing">Nursing</option><option value="Past Papers">Past Papers</option>
            </select>
        </fieldset>
        <fieldset style="border:none; padding:0; display:grid; grid-template-columns:1fr 1fr; gap:1rem;">
            <input name="subject" placeholder="Subject" class="form-control">
            <input name="educational_level" placeholder="Class/Standard (e.g. Form 1)" class="form-control">
            <input name="publisher" placeholder="Publisher" class="form-control">
            <input name="isbn" placeholder="ISBN" class="form-control">
            <input name="year_published" type="number" placeholder="Year" class="form-control">
            <input name="edition" placeholder="Edition" class="form-control">
            <input name="language" placeholder="Language (Default English)" class="form-control">
        </fieldset>
        <fieldset style="border:none; padding:0; display:grid; gap:1rem;">
            <input name="download_url" placeholder="Google Drive Share Link *" required class="form-control">
            <div style="display:flex; gap:1rem;">
                <label><input type="checkbox" name="featured"> Featured</label>
                <label><input type="checkbox" name="is_active" checked> Published</label>
            </div>
        </fieldset>`;
}

function renderVideoFormUI() {
    return `
        <input name="title" required placeholder="Lecture Title" class="form-control">
        <div style="display:grid; grid-template-columns:1fr 1fr; gap:1rem;">
            <select name="category" class="form-control" required>
                <option value="Mathematics">Mathematics</option><option value="Science">Science</option>
                <option value="ICT">ICT</option><option value="Business">Business</option>
            </select>
            <input name="subject" placeholder="Subject" class="form-control">
            <input name="teacher" placeholder="Teacher Name" class="form-control">
            <input name="educational_level" placeholder="Level" class="form-control">
        </div>
        <input name="video_url" required placeholder="YouTube URL (https://www.youtube.com/watch?v=...)" class="form-control">
        <textarea name="description" placeholder="Topic Description" class="form-control" rows="3"></textarea>
        <label><input type="checkbox" name="featured"> Pin to Highlights</label>`;
}

function renderPythonFormUI() {
    return `
        <div style="display:grid; grid-template-columns: 80px 1fr; gap:1rem;">
            <input name="lesson_number" type="number" placeholder="No." class="form-control" required>
            <input name="title" required placeholder="Lesson Name" class="form-control">
        </div>
        <div style="display:grid; grid-template-columns:1fr 1fr; gap:1rem;">
            <input name="module" placeholder="Module/Chapter Name" class="form-control">
            <select name="difficulty" class="form-control"><option>Beginner</option><option>Intermediate</option><option>Advanced</option></select>
            <input name="duration" placeholder="Estimated Duration" class="form-control">
            <label><input type="checkbox" name="premium"> Premium Account Needed</label>
        </div>
        <input name="video_url" required placeholder="YouTube Video URL" class="form-control">
        <textarea name="objectives" placeholder="Learning Objectives (One per line)" class="form-control"></textarea>
        <textarea name="exercise" placeholder="Practical Task / Challenge" class="form-control"></textarea>`;
}

function renderVacancyFormUI() {
    return `
        <input name="title" required placeholder="Position Title" class="form-control">
        <input name="company" required placeholder="Organization/Institution" class="form-control">
        <div style="display:grid; grid-template-columns:1fr 1fr; gap:1rem;">
            <input name="location" placeholder="Work Location" class="form-control">
            <select name="employment_type" class="form-control">
                <option>Full-time</option><option>Part-time</option><option>Contract</option><option>NGO Attachment</option>
            </select>
            <input name="salary" placeholder="Remuneration / Pay Scale" class="form-control">
            <input name="deadline" placeholder="Deadline Date" class="form-control">
        </div>
        <input name="qualification" placeholder="Min. Qualification Required" class="form-control">
        <input name="apply_link" placeholder="Direct Link / Website to apply" class="form-control">
        <input name="contact_email" type="email" placeholder="Application Email" class="form-control">
        <textarea name="description" placeholder="Full Job Description" class="form-control" rows="5"></textarea>`;
}

function renderServiceFormUI() {
    return `
        <input name="name" required placeholder="Service Name" class="form-control">
        <input name="category" placeholder="Service Category" class="form-control">
        <input name="price" placeholder="Fee (MWK / On request)" class="form-control">
        <div style="display:grid; grid-template-columns:1fr 1fr; gap:1rem;">
            <input name="contact_phone" placeholder="Phone" class="form-control">
            <input name="whatsapp_number" placeholder="WhatsApp (e.g. +265...)" class="form-control">
            <input name="email" placeholder="Inquiry Email" class="form-control">
            <input name="website" placeholder="Service Website URL" class="form-control">
        </div>
        <textarea name="description" required placeholder="Short Summary" class="form-control" rows="2"></textarea>
        <textarea name="full_description" placeholder="Full Terms and Features" class="form-control" rows="4"></textarea>`;
}

function renderBlogFormUI() {
    return `
        <input name="title" required placeholder="Post Title" class="form-control">
        <input name="category" placeholder="Category" class="form-control">
        <input name="author_name" placeholder="Author" class="form-control">
        <input name="featured_image" placeholder="Image Link" class="form-control">
        <input name="tags" placeholder="Tags (Separate with commas)" class="form-control">
        <textarea name="excerpt" placeholder="Short Teaser / Summary" class="form-control" rows="2"></textarea>
        <textarea name="content" required placeholder="Write Full Content Here..." class="form-control" rows="10"></textarea>`;
}

function renderAdFormUI() {
    return `
        <input name="title" required placeholder="Campaign Header" class="form-control">
        <input name="company_name" placeholder="Organization" class="form-control">
        <input name="image_url" placeholder="Ad Image Link (Publicly hosted URL)" class="form-control" required>
        <div style="display:grid; grid-template-columns:1fr 1fr; gap:1rem;">
            <input name="link_url" placeholder="Link URL (Website)" class="form-control">
            <input name="whatsapp_link" placeholder="WhatsApp Chat URL" class="form-control">
            <input name="phone_number" placeholder="Inquiry Phone" class="form-control">
            <input name="display_priority" type="number" value="1" placeholder="Display Priority (Rank)" class="form-control">
        </div>
        <div style="display:grid; grid-template-columns:1fr 1fr; gap:0.5rem; font-size:0.8rem;">
            <label>Run Start Date: <input name="start_date" type="date" class="form-control"></label>
            <label>Expiry Date: <input name="expires_at" type="date" class="form-control"></label>
        </div>
        <textarea name="description" placeholder="Ad Message" class="form-control"></textarea>`;
}

// ==========================================
// AUTOMATED HANDLERS
// ==========================================

async function handleMasterSubmission(type, formData) {
    const table = {
        'books': 'books', 'videos': 'videos', 'lessons': 'lessons', 
        'vacancies': 'vacancies', 'services': 'services', 
        'blog': 'blog_posts', 'advertisements': 'advertisements'
    }[type.toLowerCase()] || type;

    const data = Object.fromEntries(formData.entries());
    
    // Formatted Automatic Fixes
    if(formData.get("is_active") === null) data.is_active = true;
    if(formData.get("featured") === null) data.featured = false;

    // VALIDATION RULES
    if (!data.title && !data.name) return window.showError("Required fields missing");

    // Email validation
    const emailFields = ["contact_email", "email"];
    for (let f of emailFields) {
        if(data[f] && !data[f].match(/^[^\s@]+@[^\s@]+\.[^\s@]+$/)) return window.showError(`Invalid email address: ${data[f]}`);
    }

    // VIDEO / PYTHON: YT AUTOMATION
    if (data.video_url) {
        const vidId = (function(url) {
            const match = url.match(/^.*(youtu.be\/|v\/|u\/\w\/|embed\/|watch\?v=|&v=)([^#&?]*).*/);
            return (match && match[2].length === 11) ? match[2] : null;
        })(data.video_url);

        if (!vidId) return window.showError("Link must be a valid YouTube address.");
        
        // Auto-thumbnail and standard storage
        data.thumbnail_url = `https://img.youtube.com/vi/${vidId}/maxresdefault.jpg`;
    }

    // BOOKS: G-DRIVE AUTOMATION
    if (type === 'books') {
        data.description = "DOWNLOAD BOOKS FOR FREE FROM MEBV PLATFORM";
        // Native Thumbnail trigger from previous implementation
        if (typeof window.getSmartCover === 'function') {
            data.cover_url = window.getSmartCover({download_url: data.download_url});
        }
    }

    window.showLoading("Finalizing content and sync...");
    try {
        const { error } = await window.supabaseClient.from(table).insert([data]);
        if (error) throw error;
        
        window.showSuccess("Database successfully updated.");
        closeAdminModal();
        loadSectionData(type);
    } catch (err) {
        window.showError("Submission failed: " + err.message);
    } finally {
        window.hideLoading();
    }
}

// Automated Google Drive book workflow. This intentionally overrides only the
// book form; all other admin forms continue using the existing implementation.
(function () {
    const metadataFunctionUrl = `${SUPABASE_URL}/functions/v1/extract-book-metadata`;
    let extractionSequence = 0;

    function driveThumbnail(url) {
        const match = String(url || "").match(/[-\w]{25,}/);
        return match ? `https://drive.google.com/thumbnail?id=${match[0]}&sz=w1600` : "";
    }

    async function extractBookMetadata(form) {
        const link = form.elements.download_url.value.trim();
        if (!link) return;

        const sequence = ++extractionSequence;
        const status = form.querySelector("[data-book-extraction-status]");
        const button = form.querySelector("button[type=submit]");
        status.textContent = "Reading book information...";
        if (button) button.disabled = true;

        try {
            const { data: { session } } = await window.supabaseClient.auth.getSession();
            if (!session) throw new Error("Your administrator session has expired.");

            const result = await fetch(metadataFunctionUrl, {
                method: "POST",
                headers: {
                    "Content-Type": "application/json",
                    "Authorization": `Bearer ${session.access_token}`
                },
                body: JSON.stringify({ download_url: link })
            });
            const payload = await result.json();
            if (!result.ok) throw new Error(payload.error || "Book information could not be read.");
            if (sequence !== extractionSequence) return;

            const metadata = payload.metadata || {};
            Object.keys(metadata).forEach(name => {
                const field = form.elements[name];
                if (field && metadata[name] !== null && metadata[name] !== undefined && metadata[name] !== "") {
                    field.value = metadata[name];
                }
            });

            form.dataset.coverUrl = payload.cover_url || driveThumbnail(link);
            const preview = form.querySelector("[data-book-preview]");
            preview.src = form.dataset.coverUrl;
            preview.hidden = false;
            status.textContent = "Book information detected. Review it before saving.";
        } catch (error) {
            status.textContent = error.message || "Book information could not be read.";
        } finally {
            if (button) button.disabled = false;
        }
    }

    function categoryForLevel(level) {
        const value = String(level || "").toUpperCase();
        if (value.includes("MSCE") || value.includes("FORM")) return "MSCE";
        if (value.includes("JCE")) return "JCE";
        if (value.includes("STANDARD")) return "Primary";
        return "Other";
    }

    async function saveBook(form) {
        const link = form.elements.download_url.value.trim();
        const title = form.elements.title.value.trim();
        if (!link) return window.showError("Paste a Google Drive PDF link.");
        if (!title) return window.showError("Enter a book title before saving.");

        const year = form.elements.year_published.value.trim();
        const record = {
            title,
            author: form.elements.author.value.trim() || "Not detected",
            category: categoryForLevel(form.elements.educational_level.value),
            subject: form.elements.subject.value.trim() || null,
            educational_level: form.elements.educational_level.value.trim() || null,
            publisher: form.elements.publisher.value.trim() || "Not detected",
            isbn: form.elements.isbn.value.trim() || "Not detected",
            year_published: year ? Number(year) : null,
            edition: form.elements.edition.value.trim() || "Not detected",
            language: form.elements.language.value.trim() || "English",
            download_url: link,
            cover_url: null,
            featured: form.elements.featured.checked,
            is_active: form.elements.is_active.checked,
            description: "DOWNLOAD BOOKS FOR FREE FROM MEBV PLATFORM"
        };

        window.showLoading("Saving to library...");
        try {
            const { data: inserted, error } = await window.supabaseClient.from("books").insert([record]).select("id");
            if (error) throw error;
            if (inserted?.[0]?.id) {
                try {
                    await syncBookCoverRecord(inserted[0].id);
                    window.showSuccess("Book saved successfully.");
                } catch (coverError) {
                    console.error("[BOOK COVER SYNC] New book preview failed:", inserted[0].id, coverError);
                    window.showSuccess("Book saved, but its first-page preview could not be generated. Use SYNC ALL BOOK COVERS to retry.");
                }
            } else {
                window.showSuccess("Book saved successfully.");
            }
            closeAdminModal();
            loadSectionData("books");
        } catch (error) {
            window.showError("Submission failed: " + error.message);
        } finally {
            window.hideLoading();
        }
    }

    const previousShowCreateForm = window.showCreateForm;
    window.showCreateForm = function (type) {
        if (String(type).toLowerCase() !== "books") return previousShowCreateForm(type);

        const modal = document.getElementById("admin-modal");
        const body = document.getElementById("admin-modal-body");
        document.getElementById("admin-modal-title").textContent = "New Book";
        body.innerHTML = `
            <form id="automated-book-form" style="display:grid;gap:1rem;max-height:80vh;overflow-y:auto;" data-cover-url="">
                <input name="title" placeholder="Book Title" class="form-control">
                <input name="author" placeholder="Author" class="form-control">
                <input name="subject" placeholder="Subject" class="form-control">
                <input name="educational_level" placeholder="Class/Standard" class="form-control">
                <input name="publisher" placeholder="Publisher" class="form-control">
                <input name="isbn" placeholder="ISBN" class="form-control">
                <input name="year_published" type="number" min="1000" max="2100" placeholder="Year" class="form-control">
                <input name="edition" placeholder="Edition" class="form-control">
                <input name="language" value="English" placeholder="Language" class="form-control">
                <input name="download_url" required placeholder="Paste Google Drive PDF link" class="form-control">
                <div data-book-extraction-status aria-live="polite" style="font-size:.85rem;min-height:1.2rem;"></div>
                <img data-book-preview hidden alt="First page preview" style="width:100%;max-height:360px;object-fit:contain;border:1px solid var(--border-color);">
                <div style="display:flex;gap:1rem;flex-wrap:wrap;">
                    <label><input type="checkbox" name="featured"> Featured</label>
                    <label><input type="checkbox" name="is_active" checked> Active</label>
                </div>
                <button class="btn btn-primary" type="submit">Save to Library</button>
            </form>`;
        modal.classList.add("active");

        const form = document.getElementById("automated-book-form");
        const link = form.elements.download_url;
        let timer;
        link.addEventListener("input", () => {
            clearTimeout(timer);
            timer = setTimeout(() => extractBookMetadata(form), 500);
        });
        link.addEventListener("paste", () => setTimeout(() => extractBookMetadata(form), 0));
        form.addEventListener("submit", event => {
            event.preventDefault();
            saveBook(form);
        });
    };

    // Existing books are displayed without background extraction. Metadata is
    // requested only after the administrator intentionally enters a new link.
})();

// Multi-format book workflow. This final override preserves the existing admin
// forms while replacing only the books form behavior.
(function () {
    const endpoint = `${SUPABASE_URL}/functions/v1/extract-book-metadata`;
    let requestNumber = 0;

    function looksLikeDocumentLink(value) {
        try {
            const url = new URL(value);
            return /(^|\.)drive\.google\.com$|(^|\.)docs\.google\.com$/.test(url.hostname);
        } catch (_) {
            return false;
        }
    }

    function previewFor(url) {
        const id = String(url || "").match(/[-\w]{25,}/)?.[0];
        return id ? `https://drive.google.com/thumbnail?id=${id}&sz=w1600` : "";
    }

    function fileIdFor(url) {
        return String(url || "").match(/(?:\/file\/d\/|\/document\/d\/|\/presentation\/d\/|\/spreadsheets\/d\/|[?&]id=)([-\w]{15,})/)?.[1] || "";
    }

    async function adminAccessToken() {
        const current = await window.supabaseClient.auth.getSession();
        const session = current.data.session;
        if (session?.access_token && (!session.expires_at || session.expires_at * 1000 > Date.now() + 30000)) {
            return session.access_token;
        }
        const refreshed = await window.supabaseClient.auth.refreshSession();
        if (refreshed.error || !refreshed.data.session) throw new Error("Your administrator session has expired. Please log in again.");
        return refreshed.data.session.access_token;
    }

    async function readMetadata(form) {
        const link = form.elements.download_url.value.trim();
        const status = form.querySelector("[data-book-extraction-status]");
        const button = form.querySelector("button[type=submit]");
        if (!looksLikeDocumentLink(link)) {
            status.textContent = "Paste a Google Drive, Docs, Slides, or Sheets link.";
            return;
        }

        const currentRequest = ++requestNumber;
        status.textContent = "Reading book information...";
        if (button) button.disabled = true;

        try {
            const accessToken = await adminAccessToken();
            const response = await fetch(endpoint, {
                method: "POST",
                headers: {
                    "Content-Type": "application/json",
                    "Authorization": `Bearer ${accessToken}`
                },
                body: JSON.stringify({
                    driveUrl: link,
                    fileId: fileIdFor(link),
                    level: form.elements.educational_level.value
                })
            });
            const payload = await response.json();
            if (!response.ok) {
                const messages = {
                    400: "The Google Drive link request is invalid.",
                    401: "Your administrator session is invalid or expired. Please log in again.",
                    403: "Your account does not have permission to extract book information.",
                    404: "Google Drive file could not be accessed. Make sure the file is shared appropriately.",
                    429: "Too many extraction requests. Please wait and try again.",
                    415: "This document type is not supported for automatic extraction. You can still save the book and enter metadata manually.",
                    500: "The document server could not extract book information."
                };
                throw new Error(messages[response.status] || payload.error || "Book information could not be read.");
            }
            if (currentRequest !== requestNumber) return;

            Object.entries(payload.metadata || {}).forEach(([name, value]) => {
                const field = form.elements[name];
                // Educational Level is administrator-controlled and authoritative.
                if (name !== "educational_level" && field && value !== null && value !== "") field.value = value;
            });
            form.dataset.coverUrl = payload.cover_url || previewFor(link);
            const preview = form.querySelector("[data-book-preview]");
            preview.src = form.dataset.coverUrl || "";
            preview.hidden = !form.dataset.coverUrl;
            status.textContent = `Detected ${payload.extension || "document"} (${payload.mime_type || "unknown type"}). Review before saving.`;
        } catch (error) {
            status.textContent = error.message || "Book information could not be read.";
            form.dataset.extractionFailed = "true";
        } finally {
            if (button) button.disabled = false;
        }
    }

    async function pasteDriveLink(form) {
        const status = form.querySelector("[data-book-extraction-status]");
        try {
            if (!navigator.clipboard || !navigator.clipboard.readText) throw new Error("Clipboard access is unavailable in this browser.");
            const value = (await navigator.clipboard.readText()).trim();
            if (!looksLikeDocumentLink(value)) throw new Error("Clipboard does not contain a Google Drive, Docs, Slides, or Sheets link.");
            form.elements.download_url.value = value;
            form.elements.download_url.dispatchEvent(new Event("input", { bubbles: true }));
        } catch (error) {
            status.textContent = error.message;
        }
    }

    function categoryFor(level) {
        const value = String(level || "").toUpperCase();
        if (value.includes("MSCE") || value.includes("FORM")) return "MSCE";
        if (value.includes("JCE")) return "JCE";
        if (value.includes("STANDARD")) return "Primary";
        return "Other";
    }

    async function saveBook(form) {
        const link = form.elements.download_url.value.trim();
        const title = form.elements.title.value.trim() || "Google Drive document";
        if (!link) return window.showError("Paste a Google Drive document link.");

        const year = form.elements.year_published.value.trim();
        const record = {
            title,
            author: form.elements.author.value.trim() || "Not detected",
            category: categoryFor(form.elements.educational_level.value),
            subject: form.elements.subject.value.trim() || null,
            educational_level: form.elements.educational_level.value.trim() || null,
            publisher: form.elements.publisher.value.trim() || "Not detected",
            isbn: form.elements.isbn.value.trim() || "Not detected",
            year_published: year ? Number(year) : null,
            edition: form.elements.edition.value.trim() || "Not detected",
            language: form.elements.language.value.trim() || "English",
            download_url: link,
            cover_url: null,
            featured: form.elements.featured.checked,
            is_active: form.elements.is_active.checked,
            description: "DOWNLOAD BOOKS FOR FREE FROM MEBV PLATFORM"
        };

        window.showLoading("Saving to library...");
        try {
            const { data: inserted, error } = await window.supabaseClient.from("books").insert([record]).select("id");
            if (error) throw error;
            if (inserted?.[0]?.id) {
                try {
                    await syncBookCoverRecord(inserted[0].id);
                } catch (coverError) {
                    console.error("[BOOK COVER SYNC] New book preview failed:", inserted[0].id, coverError);
                }
            }
            const status = form.querySelector("[data-book-extraction-status]");
            if (form.dataset.extractionFailed === "true") {
                window.showSuccess("Book saved, but automatic information extraction could not be completed.");
            } else {
                window.showSuccess("Book saved successfully.");
            }
            closeAdminModal();
            loadSectionData("books");
        } catch (error) {
            window.showError("Submission failed: " + error.message);
        } finally {
            window.hideLoading();
        }
    }

    const previousBookForm = window.showCreateForm;
    window.showCreateForm = function (type) {
        if (String(type).toLowerCase() !== "books") return previousBookForm(type);
        const modal = document.getElementById("admin-modal");
        const body = document.getElementById("admin-modal-body");
        document.getElementById("admin-modal-title").textContent = "New Book";
        body.innerHTML = `
            <form id="multi-format-book-form" style="display:grid;gap:1rem;max-height:80vh;overflow-y:auto;" data-cover-url="">
                <input name="title" placeholder="Book Title" class="form-control">
                <input name="author" placeholder="Author" class="form-control">
                <input name="subject" placeholder="Subject" class="form-control">
                <label>Educational Level<select name="educational_level" class="form-control">
                    <option value="">Select Educational Level</option><option>Standard 1</option><option>Standard 2</option><option>Standard 3</option><option>Standard 4</option><option>Standard 5</option><option>Standard 6</option><option>Standard 7</option><option>Standard 8</option><option>JCE</option><option>Form 1</option><option>Form 2</option><option>Form 3</option><option>Form 4</option><option>MSCE</option>
                </select></label>
                <input name="publisher" placeholder="Publisher" class="form-control">
                <input name="isbn" placeholder="ISBN" class="form-control">
                <input name="year_published" type="number" min="1000" max="2100" placeholder="Year" class="form-control">
                <input name="edition" placeholder="Edition" class="form-control">
                <input name="language" value="English" placeholder="Language" class="form-control">
                <label>Google Drive Link<div style="display:flex;gap:.5rem;align-items:center;"><input name="download_url" required placeholder="Paste Google Drive document link" class="form-control"><button type="button" class="btn btn-outline" data-paste-drive title="Read clipboard">📋 Paste Google Drive Link</button></div></label>
                <div data-book-extraction-status aria-live="polite" style="font-size:.85rem;min-height:1.2rem;"></div>
                <img data-book-preview hidden alt="Document preview" style="width:100%;max-height:360px;object-fit:contain;border:1px solid var(--border-color);">
                <div style="display:flex;gap:1rem;flex-wrap:wrap;"><label><input type="checkbox" name="featured"> Featured</label><label><input type="checkbox" name="is_active" checked> Active</label></div>
                <button class="btn btn-primary" type="submit">Save &amp; Publish</button>
            </form>`;
        modal.classList.add("active");

        const form = document.getElementById("multi-format-book-form");
        const link = form.elements.download_url;
        let timer;
        form.querySelector("[data-paste-drive]").addEventListener("click", () => pasteDriveLink(form));
        link.addEventListener("input", () => { clearTimeout(timer); timer = setTimeout(() => readMetadata(form), 450); });
        form.addEventListener("submit", event => { event.preventDefault(); saveBook(form); });
    };

})();

(function () {
    const endpoint = `${SUPABASE_URL}/functions/v1/extract-book-metadata`;

    function parseFolderId(value) {
        if (!value || typeof value !== "string") return "";
        const match = value.match(/(?:\/drive\/folders\/|[?&]id=)([-\w]{10,})/i);
        if (match && match[1]) return match[1];
        const bareMatch = value.match(/^[A-Za-z0-9_-]{10,}$/);
        return bareMatch ? bareMatch[0] : "";
    }

    function looksLikeFolderLink(value) {
        try {
            const url = new URL(value);
            const host = url.hostname.toLowerCase();
            return (host === "drive.google.com" || host.endsWith(".drive.google.com")) && /\/drive\/folders\//i.test(url.pathname);
        } catch (_) {
            return false;
        }
    }

    function categoryFor(level) {
        const value = String(level || "").toUpperCase();
        if (value.includes("MSCE") || value.includes("FORM")) return "MSCE";
        if (value.includes("JCE")) return "JCE";
        if (value.includes("STANDARD")) return "Primary";
        return "Other";
    }

    async function adminAccessToken() {
        const current = await window.supabaseClient.auth.getSession();
        const session = current.data.session;
        if (session?.access_token && (!session.expires_at || session.expires_at * 1000 > Date.now() + 30000)) {
            return session.access_token;
        }
        const refreshed = await window.supabaseClient.auth.refreshSession();
        if (refreshed.error || !refreshed.data.session) throw new Error("Your administrator session has expired. Please log in again.");
        return refreshed.data.session.access_token;
    }

    function syncFolderBookValue(form, index, key, value) {
        const rows = JSON.parse(form.dataset.folderBooks || "[]");
        if (!rows[index]) return;
        rows[index][key] = value;
        form.dataset.folderBooks = JSON.stringify(rows);
    }

    function renderFolderReview(form, books, defaultLevel) {
        const review = form.querySelector("[data-folder-review]");
        if (!review) return;

        review.innerHTML = (books || []).map((book, index) => {
            const driveUrl = escapeHtml(String(book.download_url || book.google_drive_url || "").trim());
            const title = escapeHtml(String(book.title || "").trim() || "Untitled document");
            const author = escapeHtml(String(book.author || "Not detected"));
            const subject = escapeHtml(String(book.subject || "Not detected"));
            const level = escapeHtml(String(book.educational_level || defaultLevel || "").trim() || defaultLevel || "");
            const publisher = escapeHtml(String(book.publisher || "Not detected"));
            const isbn = escapeHtml(String(book.isbn || "Not detected"));
            const year = escapeHtml(String(book.year_published || "").trim() || "");
            const edition = escapeHtml(String(book.edition || "Not detected"));
            const language = escapeHtml(String(book.language || "English"));
            const cover = book.cover_url || "";

            return `
                <div style="border:1px solid var(--border-color); border-radius:12px; padding:1rem; display:grid; gap:.75rem; background:rgba(255,255,255,.02);">
                    <div style="display:flex; gap:1rem; align-items:center;">
                        ${cover
                          ? `<img src="${escapeHtml(cover)}" alt="First-page preview" style="width:60px;height:88px;object-fit:contain;background:var(--bg-tertiary);border-radius:10px;border:1px solid var(--border-color);" onerror="this.onerror=null;this.style.visibility='hidden'">`
                          : `<div style="width:60px;height:88px;display:grid;place-items:center;text-align:center;font-size:.65rem;color:var(--muted-text,#666);background:var(--bg-tertiary);border:1px solid var(--border-color);border-radius:10px;">Preview unavailable</div>`}
                        <div style="flex:1; min-width:0;">
                            <div style="font-weight:700; margin-bottom:.25rem;">${title}</div>
                            <div style="font-size:.8rem; color:var(--muted-text, #666); word-break:break-all;">${driveUrl || "No Google Drive URL"}</div>
                        </div>
                    </div>
                    <div style="display:grid; grid-template-columns:repeat(auto-fit,minmax(160px,1fr)); gap:.75rem;">
                        <label style="display:grid; gap:.25rem; font-size:.8rem;">Title<input data-index="${index}" data-key="title" value="${escapeHtml(String(book.title || ""))}" class="form-control" /></label>
                        <label style="display:grid; gap:.25rem; font-size:.8rem;">Author<input data-index="${index}" data-key="author" value="${author}" class="form-control" /></label>
                        <label style="display:grid; gap:.25rem; font-size:.8rem;">Subject<input data-index="${index}" data-key="subject" value="${subject}" class="form-control" /></label>
                        <label style="display:grid; gap:.25rem; font-size:.8rem;">Level<input data-index="${index}" data-key="educational_level" value="${level}" class="form-control" /></label>
                        <label style="display:grid; gap:.25rem; font-size:.8rem;">Publisher<input data-index="${index}" data-key="publisher" value="${publisher}" class="form-control" /></label>
                        <label style="display:grid; gap:.25rem; font-size:.8rem;">ISBN<input data-index="${index}" data-key="isbn" value="${isbn}" class="form-control" /></label>
                        <label style="display:grid; gap:.25rem; font-size:.8rem;">Year<input data-index="${index}" data-key="year_published" value="${year}" class="form-control" /></label>
                        <label style="display:grid; gap:.25rem; font-size:.8rem;">Edition<input data-index="${index}" data-key="edition" value="${edition}" class="form-control" /></label>
                        <label style="display:grid; gap:.25rem; font-size:.8rem;">Language<input data-index="${index}" data-key="language" value="${language}" class="form-control" /></label>
                    </div>
                </div>`;
        }).join("");

        review.querySelectorAll("input[data-key]").forEach(field => {
            field.addEventListener("input", event => {
                const target = event.target;
                syncFolderBookValue(form, Number(target.dataset.index), target.dataset.key, target.value);
            });
        });
    }

    async function scanFolder(form) {
        const folderUrl = form.elements.folder_url.value.trim();
        const level = form.elements.educational_level.value.trim();
        const status = form.querySelector("[data-folder-status]");
        const button = form.querySelector("[data-scan-folder]");

        if (!folderUrl) return window.showError("Paste a Google Drive folder link before scanning.");
        if (!looksLikeFolderLink(folderUrl) && !parseFolderId(folderUrl)) return window.showError("Use a valid Google Drive folder link, for example: https://drive.google.com/drive/folders/FOLDER_ID");

        status.textContent = "Scanning folder for supported books...";
        button.disabled = true;

        try {
            const { data, error } = await window.supabaseClient.functions.invoke("scan-drive-folder", {
                body: {
                    folderUrl,
                    folderId: parseFolderId(folderUrl),
                    level
                }
            });

            if (error) throw new Error(error.message || "Folder scan failed.");

            const files = Array.isArray(data?.files) ? data.files : [];
            const supported = files.filter(file => file && file.supported);
            if (!supported.length) throw new Error("No supported documents were found in that folder.");

            const normalised = supported.map(file => ({
                id: file.id,
                title: String(file.name || "Untitled document").replace(/\.[^.]+$/, ""),
                educational_level: String(level || "").trim(),
                language: "English",
                author: "Not detected",
                subject: "Not detected",
                publisher: "Not detected",
                isbn: "Not detected",
                edition: "Not detected",
                year_published: "",
                download_url: String(file.webContentLink || file.webViewLink || "").trim(),
                google_drive_url: String(file.webViewLink || file.webContentLink || "").trim(),
                cover_url: "",
                file_name: String(file.name || "Untitled document")
            }));

            form.dataset.folderBooks = JSON.stringify(normalised);
            renderFolderReview(form, normalised, level || "");
            status.textContent = `Found ${supported.length} supported document${supported.length === 1 ? "" : "s"}. Review and save below.`;
            if ((data?.unsupportedCount || 0) > 0) {
                status.textContent += ` ${data.unsupportedCount} unsupported file${data.unsupportedCount === 1 ? "" : "s"} were skipped.`;
            }
        } catch (error) {
            status.textContent = error.message || "Folder scan could not complete.";
        } finally {
            button.disabled = false;
        }
    }

    async function saveFolderBooks(form) {
        const records = JSON.parse(form.dataset.folderBooks || "[]");
        if (!records.length) return window.showError("Scan a folder first so there are books to upload.");

        const prepared = records.map((book) => {
            const fileUrl = String(book.download_url || book.google_drive_url || "").trim();
            const title = String(book.title || "").trim() || "Google Drive document";
            const level = String(book.educational_level || form.elements.educational_level.value || "").trim();
            return {
                title,
                author: String(book.author || "Not detected").trim() || "Not detected",
                category: categoryFor(level),
                subject: String(book.subject || "Not detected").trim() || "Not detected",
                educational_level: level || null,
                publisher: String(book.publisher || "Not detected").trim() || "Not detected",
                isbn: String(book.isbn || "Not detected").trim() || "Not detected",
                year_published: Number(String(book.year_published || "").trim()) || null,
                edition: String(book.edition || "Not detected").trim() || "Not detected",
                language: String(book.language || "English").trim() || "English",
                download_url: fileUrl,
                cover_url: null,
                featured: false,
                is_active: true,
                description: "DOWNLOAD BOOKS FOR FREE FROM MEBV PLATFORM"
            };
        });

        window.showLoading("Saving all books...");
        try {
            const { data: inserted, error } = await window.supabaseClient.from("books").insert(prepared).select("id,title");
            if (error) throw error;
            const failed = [];
            for (let index = 0; index < (inserted || []).length; index += 1) {
                const book = inserted[index];
                window.showLoading(`Generating first-page previews... ${index + 1} / ${inserted.length}`);
                try {
                    await syncBookCoverRecord(book.id);
                } catch (coverError) {
                    console.error("[BOOK COVER SYNC] New book preview failed:", book.id, coverError);
                    failed.push(`${book.title || "Untitled book"} — ${coverError.message || "Preview could not be generated"}`);
                }
            }
            if (failed.length) {
                window.showSuccess(`${prepared.length} books saved. ${failed.length} previews could not be generated; use SYNC ALL BOOK COVERS to retry.`);
                window.alert(`Book upload completed with preview warnings:\n${failed.map(name => `- ${name}`).join("\n")}`);
            } else {
                window.showSuccess(`${prepared.length} books saved successfully.`);
            }
            closeAdminModal();
            loadSectionData("books");
        } catch (error) {
            window.showError("One or more books could not be saved: " + error.message);
        } finally {
            window.hideLoading();
        }
    }
    async function saveSingleBook(form) {
        const link = form.elements.download_url.value.trim();
        const title = form.elements.title.value.trim() || "Google Drive document";
        if (!link) return window.showError("Paste a Google Drive document link.");

        const level = form.elements.educational_level_single.value.trim();
        const year = form.elements.year_published.value.trim();
        const record = {
            title,
            author: form.elements.author.value.trim() || "Not detected",
            category: categoryFor(level),
            subject: form.elements.subject.value.trim() || "Not detected",
            educational_level: level || null,
            publisher: form.elements.publisher.value.trim() || "Not detected",
            isbn: form.elements.isbn.value.trim() || "Not detected",
            year_published: year ? Number(year) : null,
            edition: form.elements.edition.value.trim() || "Not detected",
            language: form.elements.language.value.trim() || "English",
            download_url: link,
            cover_url: null,
            featured: form.elements.featured.checked,
            is_active: form.elements.is_active.checked,
            description: "DOWNLOAD BOOKS FOR FREE FROM MEBV PLATFORM"
        };

        window.showLoading("Saving to library...");
        try {
            const { data: inserted, error } = await window.supabaseClient.from("books").insert([record]).select("id").single();
            if (error) throw error;
            let coverWarning = "";
            try {
                await syncBookCoverRecord(inserted.id);
            } catch (coverError) {
                console.error("[BOOK COVER SYNC] New book preview failed:", inserted.id, coverError);
                coverWarning = " Its first-page preview could not be generated; you can retry with SYNC ALL BOOK COVERS.";
            }
            window.showSuccess(`Book saved successfully.${coverWarning}`);
            closeAdminModal();
            loadSectionData("books");
        } catch (error) {
            window.showError("Submission failed: " + error.message);
        } finally {
            window.hideLoading();
        }
    }

    const previousBooksForm = window.showCreateForm;
    window.showCreateForm = function (type) {
        if (String(type).toLowerCase() !== "books") return previousBooksForm(type);

        const modal = document.getElementById("admin-modal");
        const body = document.getElementById("admin-modal-body");
        document.getElementById("admin-modal-title").textContent = "Bulk Book Upload";
        body.innerHTML = `
            <form id="folder-book-form" style="display:grid; gap:1rem; max-height:80vh; overflow-y:auto;" data-folder-books="[]">
                <div style="border:1px solid var(--border-color); border-radius:12px; padding:1rem; display:grid; gap:1rem;">
                    <label style="display:grid; gap:.5rem; font-weight:600;">Google Drive Folder
                        <input name="folder_url" class="form-control" placeholder="https://drive.google.com/drive/folders/FOLDER_ID" />
                    </label>
                    <label style="display:grid; gap:.5rem; font-weight:600;">Level
                        <select name="educational_level" class="form-control">
                            <option value="">Select level</option>
                            <option>Standard 1</option><option>Standard 2</option><option>Standard 3</option><option>Standard 4</option><option>Standard 5</option><option>Standard 6</option><option>Standard 7</option><option>Standard 8</option>
                            <option>JCE</option><option>Form 1</option><option>Form 2</option><option>Form 3</option><option>Form 4</option><option>MSCE</option>
                        </select>
                    </label>
                    <button type="button" class="btn btn-primary" data-scan-folder>Scan Folder</button>
                    <div data-folder-status aria-live="polite" style="font-size:.85rem; min-height:1.2rem; color:var(--muted-text, #666);">Paste a folder link and choose the class level to begin.</div>
                    <div data-folder-review style="display:grid; gap:1rem;"></div>
                    <button type="button" class="btn btn-accent" data-save-folder-books>Save &amp; Upload All</button>
                </div>

                <div style="border-top:1px solid var(--border-color); padding-top:1rem; display:grid; gap:1rem;">
                    <h3 style="margin:0; font-size:1rem;">Single Book Fallback</h3>
                    <input name="title" placeholder="Book Title" class="form-control">
                    <input name="author" placeholder="Author" class="form-control">
                    <input name="subject" placeholder="Subject" class="form-control">
                    <label>Educational Level<select name="educational_level_single" class="form-control">
                        <option value="">Select Educational Level</option><option>Standard 1</option><option>Standard 2</option><option>Standard 3</option><option>Standard 4</option><option>Standard 5</option><option>Standard 6</option><option>Standard 7</option><option>Standard 8</option><option>JCE</option><option>Form 1</option><option>Form 2</option><option>Form 3</option><option>Form 4</option><option>MSCE</option>
                    </select></label>
                    <input name="publisher" placeholder="Publisher" class="form-control">
                    <input name="isbn" placeholder="ISBN" class="form-control">
                    <input name="year_published" type="number" min="1000" max="2100" placeholder="Year" class="form-control">
                    <input name="edition" placeholder="Edition" class="form-control">
                    <input name="language" value="English" placeholder="Language" class="form-control">
                    <input name="download_url" placeholder="Paste Google Drive document link" class="form-control">
                    <div style="display:flex;gap:1rem;flex-wrap:wrap;"><label><input type="checkbox" name="featured"> Featured</label><label><input type="checkbox" name="is_active" checked> Active</label></div>
                    <button type="submit" class="btn btn-primary">Save &amp; Publish</button>
                </div>
            </form>`;

        modal.classList.add("active");
        const form = document.getElementById("folder-book-form");
        form.querySelector("[data-scan-folder]").addEventListener("click", () => scanFolder(form));
        form.querySelector("[data-save-folder-books]").addEventListener("click", () => saveFolderBooks(form));
        form.addEventListener("submit", event => {
            event.preventDefault();
            const folderBooks = JSON.parse(form.dataset.folderBooks || "[]");
            if (folderBooks.length && form.querySelector("[data-folder-review]").children.length) {
                saveFolderBooks(form);
                return;
            }
            saveSingleBook(form);
        });
    };
})();