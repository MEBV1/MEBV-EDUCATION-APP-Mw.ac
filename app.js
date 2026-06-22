// app.js
// Global application system for Malawi Education Books and Vacancies
// Implements Global Splash, Toast, Theme Toggle, Responsive Navigation, and Session updates

document.addEventListener("DOMContentLoaded", () => {
  // 1. Inject Global Splash Screen, Toasts, and hidden admin modal HTML dynamically.
  injectGlobalUI();

  // 2. Initialize Core Systems
  initTheme();
  initMobileMenu();
  initHiddenAdminShortcut();
  syncGlobalSessionUI();
  initFloatingAds();
  initRealtimeSubscriptions();
});

/**
 * Real-time Database Subscriptions
 * Ensures that newly published content appears without manual refresh.
 */
function initRealtimeSubscriptions() {
  if (!window.supabaseClient) return;

  // Listen for changes in key content tables
  window.supabaseClient
    .channel('public-content-updates')
    .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'advertisements' }, (payload) => {
      console.log('New advertisement published:', payload.new);
      if (typeof window.initFloatingAds === 'function') window.initFloatingAds();
    })
    .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'blog_posts' }, (payload) => {
      console.log('New blog post published:', payload.new);
      if (typeof window.loadBlogPosts === 'function') window.loadBlogPosts();
    })
    .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'services' }, (payload) => {
      console.log('New service published:', payload.new);
      if (typeof window.loadServices === 'function') window.loadServices();
    })
    .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'books' }, (payload) => {
      if (payload.new.featured !== payload.old.featured) {
        console.log('Book featured status changed:', payload.new);
        if (typeof window.loadFeaturedBooks === 'function') window.loadFeaturedBooks();
        if (typeof window.loadBooks === 'function') window.loadBooks();
      }
    })
    .subscribe();
}

/**
 * Injects required system overlays for loading, toasts, hidden admin modal, and alerts.
 * This guarantees uniform behavior across every HTML template.
 */
function injectGlobalUI() {
  // Splash Overlay DOM
  if (!document.getElementById("global-splash-overlay")) {
    const splash = document.createElement("div");
    splash.id = "global-splash-overlay";
    splash.className = "splash-overlay";
    splash.innerHTML = `
      <div class="splash-container">
        <img src="LOGO.png" alt="Malawi Education" id="global-splash-logo" class="splash-logo pulsing">
        <div id="global-splash-spinner" class="splash-spinner"></div>
        <div id="global-splash-message" class="splash-message">Loading...</div>
        <div class="splash-progress-container" id="global-splash-progress-wrap">
          <div class="splash-progress-bar" id="global-splash-progress-bar"></div>
        </div>
      </div>
    `;
    document.body.appendChild(splash);
  }

  // Toast Notifications Container DOM
  if (!document.getElementById("global-toast-container")) {
    const toasts = document.createElement("div");
    toasts.id = "global-toast-container";
    toasts.className = "toast-container";
    document.body.appendChild(toasts);
  }

  // Hidden Admin Modal - Create with login form
  if (!document.getElementById("hidden-admin-modal-overlay")) {
    const modal = document.createElement("div");
    modal.id = "hidden-admin-modal-overlay";
    modal.className = "modal-overlay";
    modal.innerHTML = `
      <div class="modal-box">
        <button class="modal-close-btn" id="hidden-admin-modal-close" type="button">&times;</button>
        <div class="modal-header">
          <h2 class="modal-title">Administrator Login</h2>
        </div>
        <div class="modal-body" id="hidden-admin-modal-body">
          <form id="hidden-admin-form" style="display: flex; flex-direction: column; gap: 1rem;">
            <div class="form-group">
              <label for="hidden-admin-email" style="display: block; margin-bottom: 0.5rem; font-weight: 600;">Email</label>
              <input type="email" id="hidden-admin-email" placeholder="admin@example.com" required style="width: 100%; padding: 0.75rem; border: 1px solid var(--border-color); border-radius: var(--border-radius); background-color: var(--bg-primary); color: var(--text-primary); font-size: 1rem;">
            </div>
            <div class="form-group">
              <label for="hidden-admin-password" style="display: block; margin-bottom: 0.5rem; font-weight: 600;">Password</label>
              <input type="password" id="hidden-admin-password" placeholder="Password" required style="width: 100%; padding: 0.75rem; border: 1px solid var(--border-color); border-radius: var(--border-radius); background-color: var(--bg-primary); color: var(--text-primary); font-size: 1rem;">
            </div>
            <div style="font-size: 0.85rem; text-align: center; margin-top: 0.5rem;">
              <a href="#" style="color: var(--color-primary); text-decoration: none;">Forgot Password?</a>
            </div>
          </form>
        </div>
        <div class="modal-footer">
          <button class="btn btn-outline btn-sm" type="button" id="hidden-admin-cancel-btn">Cancel</button>
          <button class="btn btn-primary btn-sm" type="button" id="hidden-admin-login-btn">Login</button>
        </div>
      </div>
    `;
    document.body.appendChild(modal);
    console.log("[Admin Modal] Modal inserted into DOM");

    modal.addEventListener("click", (event) => {
      if (event.target === modal) hideHiddenAdminModal();
    });
  }
}

/**
 * Global Splash: Show screen
 * @param {string} message - Message to display
 */
window.showLoading = function(message = "Processing request...") {
  const overlay = document.getElementById("global-splash-overlay");
  const msgEl = document.getElementById("global-splash-message");
  const progressWrap = document.getElementById("global-splash-progress-wrap");
  const progressFill = document.getElementById("global-splash-progress-bar");
  
  if (overlay && msgEl) {
    msgEl.textContent = message;
    progressWrap.style.display = "none"; // Hide progress unless custom value is supplied later
    progressFill.style.width = "0%";
    overlay.classList.add("active");
  }
};

/**
 * Global Splash: Hide screen
 */
window.hideLoading = function() {
  const overlay = document.getElementById("global-splash-overlay");
  if (overlay) {
    overlay.classList.remove("active");
  }
};

/**
 * Custom Toast Notifications with automatic cleanup
 * @param {string} message - Message text
 * @param {string} type - 'info' | 'success' | 'error' | 'warning'
 */
window.showToast = function(message, type = "info") {
  const container = document.getElementById("global-toast-container");
  if (!container) return;

  const toast = document.createElement("div");
  toast.className = `toast toast-${type}`;
  
  let icon = "🔔";
  if (type === "success") icon = "✅";
  if (type === "error") icon = "❌";
  if (type === "warning") icon = "⚠️";

  toast.innerHTML = `
    <div class="toast-content">
      <span class="toast-icon">${icon}</span>
      <span>${message}</span>
    </div>
    <button class="toast-close" onclick="this.parentElement.remove()">&times;</button>
  `;

  container.appendChild(toast);

  // Trigger animation next frame
  requestAnimationFrame(() => {
    toast.classList.add("show");
  });

  // Automatically remove toast after 4.5 seconds
  setTimeout(() => {
    toast.classList.remove("show");
    setTimeout(() => {
      toast.remove();
    }, 350);
  }, 4500);
};

// Friendly shortcut helpers for clean UI feedback
window.showSuccess = function(message) {
  window.showToast(message, "success");
};

window.showError = function(message) {
  window.showToast(message, "error");
};

/**
 * Optimistic Database Increment Helper
 * @param {string} table - Table name
 * @param {string} column - Column to increment
 * @param {string} id - Record ID
 * @param {number} currentVal - Current UI value
 * @param {Function} updateUICallback - Callback to update the DOM
 */
window.incrementCounter = async function(table, column, id, currentVal, updateUICallback) {
  if (!window.supabaseClient || !id) return;

  // 1. Optimistic Update
  const newVal = (currentVal || 0) + 1;
  updateUICallback(newVal);

  try {
    // 2. Save to Supabase
    const { error } = await window.supabaseClient.rpc('increment_counter', {
      table_name: table,
      column_name: column,
      row_id: id
    });

    // If RPC is not available, fallback to manual update
    if (error && error.message.includes("function") && error.message.includes("does not exist")) {
      const { error: updateErr } = await window.supabaseClient
        .from(table)
        .update({ [column]: newVal })
        .eq("id", id);
      if (updateErr) throw updateErr;
    } else if (error) {
      throw error;
    }
  } catch (err) {
    console.warn(`Counter update failed for ${table}.${column}:`, err);
    // 3. Rollback UI on failure
    updateUICallback(currentVal);
  }
};

/**
 * Manage Light/Dark Theme Preference
 */
function initTheme() {
  const themeToggleBtn = document.getElementById("theme-toggle-btn");
  const storedTheme = localStorage.getItem("theme");
  const prefersDark = window.matchMedia("(prefers-color-scheme: dark)").matches;

  if (storedTheme === "dark" || (!storedTheme && prefersDark)) {
    document.body.classList.add("dark-mode");
    updateThemeToggleButton(true);
  } else {
    document.body.classList.remove("dark-mode");
    updateThemeToggleButton(false);
  }

  if (themeToggleBtn) {
    themeToggleBtn.addEventListener("click", () => {
      const isDark = document.body.classList.toggle("dark-mode");
      localStorage.setItem("theme", isDark ? "dark" : "light");
      updateThemeToggleButton(isDark);
    });
  }
}

function updateThemeToggleButton(isDark) {
  const iconSpan = document.querySelector("#theme-toggle-btn span");
  if (iconSpan) {
    iconSpan.textContent = isDark ? "☀️" : "🌙";
  }
}

/**
 * Handle Responsive Navigation Drawer Menu
 */
function initMobileMenu() {
  const menuBtn = document.getElementById("mobile-menu-btn");
  const navLinks = document.getElementById("nav-links");

  if (menuBtn && navLinks) {
    menuBtn.addEventListener("click", () => {
      navLinks.classList.toggle("active");
      menuBtn.textContent = navLinks.classList.contains("active") ? "✕" : "☰";
    });

    // Close menu when clicking outside
    document.addEventListener("click", (e) => {
      if (!menuBtn.contains(e.target) && !navLinks.contains(e.target) && navLinks.classList.contains("active")) {
        navLinks.classList.remove("active");
        menuBtn.textContent = "☰";
      }
    });
  }
}

function initHiddenAdminShortcut() {
  console.log("[Keyboard Listener] Keyboard listener loaded");

  // Track keys using physical codes for consistency across layouts
  const pressedKeys = new Set();
  let shortcutTimer = null;

  const isAdminComboActive = () => {
    const hasControl = pressedKeys.has("ControlLeft") || pressedKeys.has("ControlRight");
    const hasShift = pressedKeys.has("ShiftLeft") || pressedKeys.has("ShiftRight");
    const hasA = pressedKeys.has("KeyA");
    return hasControl && hasShift && hasA;
  };

  // Global keyboard down handler
  document.addEventListener("keydown", (event) => {
    // Ignore if typing in form fields
    if (event.target && ["INPUT", "TEXTAREA", "SELECT"].includes(event.target.tagName)) {
      return;
    }

    pressedKeys.add(event.code);
    if (event.code === "ControlLeft" || event.code === "ControlRight") {
      console.log("[Keyboard Listener] CTRL detected");
    }
    if (event.code === "ShiftLeft" || event.code === "ShiftRight") {
      console.log("[Keyboard Listener] SHIFT detected");
    }
    if (event.code === "KeyA") {
      console.log("[Keyboard Listener] A detected");
    }

    if (event.code === "KeyA" && event.ctrlKey && event.shiftKey) {
      event.preventDefault();
      event.stopPropagation();
    }

    if (isAdminComboActive() && !shortcutTimer) {
      console.log("[Keyboard Listener] Admin shortcut started");
      window.showToast("Hold Ctrl + Shift + A for 4 seconds to access admin panel.", "info");

      shortcutTimer = setTimeout(() => {
        shortcutTimer = null;
        if (!isAdminComboActive()) {
          console.log("[Keyboard Listener] Admin shortcut cancelled before completion");
          return;
        }
        console.log("[Keyboard Listener] Admin shortcut completed");
        console.log("FORCED MODAL TEST");
        console.log("Opening admin login modal");
        showHiddenAdminModal();
      }, 4000);
    }
  });

  // Global keyboard up handler
  document.addEventListener("keyup", (event) => {
    pressedKeys.delete(event.code);

    if (!isAdminComboActive() && shortcutTimer) {
      clearTimeout(shortcutTimer);
      shortcutTimer = null;
      console.log("[Keyboard Listener] Admin shortcut cancelled");
    }
  });

  // Clear shortcut if window loses focus
  window.addEventListener("blur", () => {
    pressedKeys.clear();
    if (shortcutTimer) {
      clearTimeout(shortcutTimer);
      shortcutTimer = null;
      console.log("[Keyboard Listener] Admin shortcut cancelled due to blur");
    }
  });

  // Attach button event listeners
  const loginBtn = document.getElementById("hidden-admin-login-btn");
  const cancelBtn = document.getElementById("hidden-admin-cancel-btn");
  const closeBtn = document.getElementById("hidden-admin-modal-close");

  if (loginBtn) loginBtn.addEventListener("click", attemptHiddenAdminLogin);
  if (cancelBtn) cancelBtn.addEventListener("click", hideHiddenAdminModal);
  if (closeBtn) closeBtn.addEventListener("click", hideHiddenAdminModal);
}

function showHiddenAdminModal() {
  let overlay = document.getElementById("hidden-admin-modal-overlay");
  if (!overlay) {
    console.warn("[Admin Modal] Overlay missing, reinjecting hidden admin modal.");
    injectGlobalUI();
    overlay = document.getElementById("hidden-admin-modal-overlay");
  }
  if (!overlay) {
    console.error("[Admin Modal] Failed to create hidden admin modal.");
    return;
  }

  // Clear form fields
  const emailInput = document.getElementById("hidden-admin-email");
  const passwordInput = document.getElementById("hidden-admin-password");
  
  if (emailInput) emailInput.value = "";
  if (passwordInput) passwordInput.value = "";
  
  // Show modal
  overlay.style.zIndex = "2000";
  overlay.style.display = "flex";
  overlay.style.visibility = "visible";
  overlay.style.opacity = "1";
  overlay.classList.add("active");
  console.log("[Admin Modal] Modal display activated");
  console.log("[Admin Modal] Modal inserted into DOM");

  if (emailInput) {
    emailInput.focus();
  }
  console.log("[Admin Modal] Modal displayed to user");
}

/**
 * Safely hides the hidden admin modal and clears sensitive fields.
 */
function hideHiddenAdminModal() {
  const overlay = document.getElementById("hidden-admin-modal-overlay");
  if (!overlay) return;

  // Reset visibility/display styles used in showHiddenAdminModal
  overlay.style.display = "none";
  overlay.style.visibility = "hidden";
  overlay.style.opacity = "0";
  overlay.classList.remove("active");

  // Clear form fields for security
  const emailInput = document.getElementById("hidden-admin-email");
  const passwordInput = document.getElementById("hidden-admin-password");
  if (emailInput) emailInput.value = "";
  if (passwordInput) passwordInput.value = "";

  console.log("[Admin Modal] Modal hidden and fields cleared");
}

window.showAuthModal = function() {
  const modal = document.getElementById("hidden-admin-modal-overlay");
  if (!modal) return;
  
  document.getElementById("hidden-admin-modal-title").textContent = "User Login / Register";
  document.getElementById("hidden-admin-modal-body").innerHTML = `
    <div style="display: flex; flex-direction: column; gap: 1rem;">
      <p style="color: var(--text-secondary); text-align: center;">Please log in or register to access premium content.</p>
      <form id="user-auth-form" style="display: flex; flex-direction: column; gap: 1rem;">
        <div class="form-group">
          <label style="display: block; margin-bottom: 0.5rem; font-weight: 600;">Email</label>
          <input type="email" name="email" required class="form-control" placeholder="your@email.com">
        </div>
        <div class="form-group">
          <label style="display: block; margin-bottom: 0.5rem; font-weight: 600;">Password</label>
          <input type="password" name="password" required class="form-control" placeholder="••••••••">
        </div>
        <div style="display: flex; gap: 1rem;">
          <button type="submit" data-action="login" class="btn btn-primary btn-block">Login</button>
          <button type="submit" data-action="register" class="btn btn-outline btn-block">Register</button>
        </div>
      </form>
    </div>
  `;
  
  modal.classList.add("active");
  
  const form = document.getElementById("user-auth-form");
  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    const action = e.submitter.getAttribute("data-action");
    const email = form.email.value;
    const password = form.password.value;
    
    window.showLoading(action === "login" ? "Logging in..." : "Registering...");
    try {
      const { data, error } = action === "login" 
        ? await window.supabaseClient.auth.signInWithPassword({ email, password })
        : await window.supabaseClient.auth.signUp({ email, password });
        
      if (error) throw error;
      
      window.showSuccess(action === "login" ? "Welcome back!" : "Account created! Please check your email.");
      modal.classList.remove("active");
      location.reload();
    } catch (err) {
      window.showError(err.message);
    } finally {
      window.hideLoading();
    }
  });
};

async function attemptHiddenAdminLogin() {
  console.log("[Admin Login] Admin login button clicked");
  const emailInput = document.getElementById("hidden-admin-email");
  const passwordInput = document.getElementById("hidden-admin-password");

  if (!emailInput || !passwordInput) {
    window.showError("Login form is not available.");
    return;
  }

  const email = emailInput.value.trim();
  const password = passwordInput.value.trim();
  console.log("[Admin Login] Email submitted", { email });

  if (!email || !password) {
    window.showError("Please enter both email and password.");
    return;
  }

  if (!window.supabaseClient) {
    window.showError("Unable to connect to authentication service.");
    return;
  }

  window.showLoading("Signing in as administrator...");
  try {
    console.log("[Admin Login] Attempting login");
    const { data: signInData, error: signInError } = await window.supabaseClient.auth.signInWithPassword({
      email,
      password
    });

    if (signInError) {
      console.error("[Admin Login] Login failed", signInError);
      window.showError(signInError.message || "Invalid email or password.");
      return;
    }

    const user = signInData?.user || null;
    if (!user || !user.id) {
      console.error("[Admin Login] Login failed");
      window.showError("Invalid email or password.");
      return;
    }

    console.log("[Admin Login] Login successful");
    hideHiddenAdminModal();
    console.log("[Admin Login] Redirecting to admin.html");
    window.location.href = "admin.html";
  } catch (error) {
    console.error("[Admin Login] Login failed", error);
    window.showError(error?.message || "Authentication failed. Please try again.");
  } finally {
    window.hideLoading();
  }
}

function getHiddenAdminFailureHistory() {
  try {
    const data = localStorage.getItem("hiddenAdminFailureHistory");
    if (!data) return [];
    return JSON.parse(data).filter((timestamp) => Number.isFinite(timestamp));
  } catch {
    return [];
  }
}

function saveHiddenAdminFailureHistory(failures) {
  localStorage.setItem("hiddenAdminFailureHistory", JSON.stringify(failures));
}

function recordHiddenAdminFailure(details = "unauthorized_attempt") {
  const now = Date.now();
  const failures = getHiddenAdminFailureHistory().filter((timestamp) => now - timestamp <= 10 * 60 * 1000);
  failures.push(now);
  saveHiddenAdminFailureHistory(failures);
}

/**
 * Dynamically synchronize authentication related navbar items
 * Shows appropriate Login/Register or Profile/Logout options based on supabase user availability.
 */
async function syncGlobalSessionUI() {
  // Give supabase SDK library small window of time to register if present
  setTimeout(async () => {
    if (!window.supabaseClient) return;

    try {
      const { data: { session } } = await window.supabaseClient.auth.getSession();
      const authActionsArea = document.getElementById("header-auth-actions");

      if (!authActionsArea) return;

      if (session && session.user) {
        // User logged in
        authActionsArea.innerHTML = `
          <a href="profile.html" class="btn btn-outline btn-sm">Profile</a>
          <button id="logout-header-btn" class="btn btn-primary btn-sm">Logout</button>
        `;

        // Add dynamic logout action listener
        document.getElementById("logout-header-btn").addEventListener("click", async () => {
          window.showLoading("Logging out...");
          try {
            await window.supabaseClient.auth.signOut();
            window.showSuccess("Logged out successfully");
            setTimeout(() => {
              window.location.href = "index.html";
            }, 1000);
          } catch (err) {
            window.showError("Failed to logout elegantly");
          } finally {
            window.hideLoading();
          }
        });

        // Do not expose an admin link via the public navigation.
        // Admin users will use the hidden keyboard shortcut instead.
        const navLinksContainer = document.getElementById("nav-links");
        if (navLinksContainer) {
          const adminLink = document.getElementById("admin-nav-item-link");
          if (adminLink) adminLink.remove();
        }

      } else {
        // No user session
        authActionsArea.innerHTML = `
          <a href="login.html" class="btn btn-text btn-sm">Login</a>
          <a href="register.html" class="btn btn-primary btn-sm">Join</a>
        `;
      }
    } catch (err) {
      console.warn("Global session UI sync failed:", err);
    }
  }, 200);
}

/**
 * Initialize Floating Advertisements with rotation and premium UI
 */
let adRotationInterval = null;
let adRestoreTimeout = null;
let currentAdIndex = 0;
let activeAds = [];

window.initFloatingAds = async function() {
  console.log("[ADS] Loading advertisements");
  if (!window.supabaseClient) {
    console.error("[ADS] Supabase client not found");
    return;
  }

  try {
    const { data: ads, error } = await window.supabaseClient
      .from("advertisements")
      .select("*")
      .eq("status", "active")
      .order("created_at", { ascending: false });

    if (error) {
      console.error("[ADS] Database query error:", error.message);
      return;
    }

    if (!ads || ads.length === 0) {
      console.warn("[ADS] No active advertisements found in public.advertisements");
      return;
    }

    // Cache advertisements in memory
    activeAds = ads;
    console.log(`[ADS] Advertisements found: ${activeAds.length}`);
    
    // Clear existing ad if any
    const existingAd = document.querySelector(".floating-ad-container");
    if (existingAd) existingAd.remove();

    // Check if ad is currently hidden via sessionStorage
    const hiddenUntil = sessionStorage.getItem('ad_hidden_until');
    const now = Date.now();

    if (hiddenUntil && now < parseInt(hiddenUntil)) {
      const remaining = parseInt(hiddenUntil) - now;
      console.log(`[ADS] Advertisement currently hidden. Restoring in ${Math.round(remaining/1000)}s`);
      
      if (adRestoreTimeout) clearTimeout(adRestoreTimeout);
      adRestoreTimeout = setTimeout(() => {
        console.log("[ADS] Advertisement restored");
        console.log("[ADS] Rotation resumed");
        renderAd(activeAds[currentAdIndex]);
        startAdRotation();
        sessionStorage.removeItem('ad_hidden');
        sessionStorage.removeItem('ad_hidden_until');
      }, remaining);
      
      renderBannerAds(); // Banners are not affected by the 60s timer
      return;
    }

    renderAd(activeAds[currentAdIndex]);
    startAdRotation();
    renderBannerAds();

  } catch (err) {
    console.error("[ADS] Critical failure loading ads:", err);
  }
};

function renderAd(ad) {
  if (!ad) return;

  // Don't render if hidden period hasn't expired
  const hiddenUntil = sessionStorage.getItem('ad_hidden_until');
  if (hiddenUntil && Date.now() < parseInt(hiddenUntil)) return;

  console.log(`[ADS] Rendering advertisement: ${ad.title}`);

  let adEl = document.querySelector(".floating-ad-container");
  if (!adEl) {
    adEl = document.createElement("div");
    adEl.className = "floating-ad-container";
    document.body.appendChild(adEl);
  }

  // Check if ad is "NEW" (within last 48 hours)
  const isNew = (new Date() - new Date(ad.created_at)) < (48 * 60 * 60 * 1000);

  adEl.innerHTML = `
    <div class="ad-controls">
      <button class="ad-btn" onclick="toggleAdMinimize(this)" title="Minimize">_</button>
      <button class="ad-btn" onclick="dismissAd('${ad.id}')" title="Close">&times;</button>
    </div>
    <div class="ad-content-wrapper ad-content-fade">
      ${isNew ? '<div class="ad-new-badge">New</div>' : ''}
      <a href="${ad.link_url || '#'}" target="_blank" onclick="trackAdClick('${ad.id}')" style="text-decoration: none; color: inherit; display: block;">
        ${ad.image_url ? `<img src="${ad.image_url}" style="width: 100%; height: 180px; object-fit: cover; border-bottom: 1px solid rgba(255,255,255,0.1);">` : ''}
        <div style="padding: 1.5rem;">
          <div style="font-size: 0.65rem; font-weight: 800; text-transform: uppercase; color: var(--color-primary); margin-bottom: 0.6rem; letter-spacing: 0.1em;">Featured Announcement</div>
          <h4 style="margin: 0 0 0.5rem 0; font-size: 1.25rem; font-weight: 800; line-height: 1.2; color: var(--text-primary);">${ad.title}</h4>
          <p style="margin: 0 0 1.25rem 0; font-size: 0.9rem; color: var(--text-secondary); line-height: 1.6; display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; overflow: hidden;">${ad.description || ''}</p>
          
          <div style="display: flex; align-items: center; justify-content: space-between; gap: 1rem;">
            <div class="ad-learn-more-btn">Learn More &rarr;</div>
            <span style="font-size: 0.7rem; color: var(--text-muted); font-weight: 500;">
              <span id="ad-impressions-${ad.id}">${ad.impressions_count || 0}</span> views
            </span>
          </div>
        </div>
      </a>
      
      ${activeAds.length > 1 ? `
        <div class="ad-nav-controls">
          <button class="ad-btn" onclick="prevAd(event)" title="Previous Ad" style="width: 24px; height: 24px; font-size: 10px;">&lt;</button>
          <span style="font-size: 0.65rem; color: var(--text-muted); font-weight: 700; min-width: 30px; text-align: center;">${currentAdIndex + 1} / ${activeAds.length}</span>
          <button class="ad-btn" onclick="nextAd(event)" title="Next Ad" style="width: 24px; height: 24px; font-size: 10px;">&gt;</button>
        </div>
      ` : ''}
    </div>
  `;

  trackAdImpression(ad.id);
}

function startAdRotation() {
  if (adRotationInterval) clearInterval(adRotationInterval);
  if (activeAds.length <= 1) return;

  adRotationInterval = setInterval(() => {
    nextAd();
  }, 30000); // Rotate every 30 seconds
}

window.nextAd = function(e) {
  if (e) e.preventDefault();
  currentAdIndex = (currentAdIndex + 1) % activeAds.length;
  renderAd(activeAds[currentAdIndex]);
  // Reset timer on manual navigation
  startAdRotation();
};

window.prevAd = function(e) {
  if (e) e.preventDefault();
  currentAdIndex = (currentAdIndex - 1 + activeAds.length) % activeAds.length;
  renderAd(activeAds[currentAdIndex]);
  // Reset timer on manual navigation
  startAdRotation();
};

window.toggleAdMinimize = function(btn) {
  const container = btn.closest(".floating-ad-container");
  container.classList.toggle("minimized");
  btn.textContent = container.classList.contains("minimized") ? "□" : "_";
};

window.dismissAd = function(adId) {
  console.log("[ADS] Advertisement closed");
  const container = document.querySelector(".floating-ad-container");
  if (container) {
    container.style.opacity = "0";
    container.style.transform = "translateX(50px) scale(0.95)";
    setTimeout(() => container.remove(), 500);
  }

  // Set hidden period for 60 seconds
  const hideFor = 60000;
  const until = Date.now() + hideFor;
  sessionStorage.setItem('ad_hidden', 'true');
  sessionStorage.setItem('ad_hidden_until', until.toString());
  console.log("[ADS] Hidden for 60 seconds");

  if (adRotationInterval) clearInterval(adRotationInterval);

  // Set timeout to restore ad automatically
  if (adRestoreTimeout) clearTimeout(adRestoreTimeout);
  adRestoreTimeout = setTimeout(() => {
    console.log("[ADS] Advertisement restored");
    console.log("[ADS] Rotation resumed");
    sessionStorage.removeItem('ad_hidden');
    sessionStorage.removeItem('ad_hidden_until');
    renderAd(activeAds[currentAdIndex]);
    startAdRotation();
  }, hideFor);
};

function renderBannerAds() {
  const topBanners = document.querySelectorAll(".ad-banner-top");
  const footerBanners = document.querySelectorAll(".ad-banner-footer");
  
  if (activeAds.length === 0) return;

  const renderTo = (containers, ad) => {
    containers.forEach(container => {
      container.innerHTML = `
        <div class="ad-banner-section">
          <span class="ad-banner-label">Advertisement</span>
          <div class="ad-banner-content">
            <a href="${ad.link_url || '#'}" target="_blank" onclick="trackAdClick('${ad.id}')" style="text-decoration: none; color: inherit; display: flex; align-items: center; gap: 1.5rem; text-align: left; max-width: 800px;">
              ${ad.image_url ? `<img src="${ad.image_url}" style="width: 120px; height: 80px; object-fit: cover; border-radius: var(--border-radius-md);">` : ''}
              <div>
                <h4 style="margin: 0 0 0.25rem 0; font-size: 1.1rem;">${ad.title}</h4>
                <p style="margin: 0; font-size: 0.9rem; color: var(--text-secondary);">${ad.description || ''}</p>
              </div>
            </a>
          </div>
        </div>
      `;
    });
  };

  if (topBanners.length > 0) renderTo(topBanners, activeAds[0]);
  if (footerBanners.length > 0) renderTo(footerBanners, activeAds[activeAds.length > 1 ? 1 : 0]);
}

window.trackAdClick = async function(adId) {
  if (!window.supabaseClient) return;
  // Implement click tracking if a column exists, or just log
  console.log(`[ADS] Click tracked for ad: ${adId}`);
  window.incrementCounter("advertisements", "clicks_count", adId, 0, () => {});
};

/**
 * Track Advertisement Impression
 */
async function trackAdImpression(adId) {
  if (!window.supabaseClient || !adId) return;

  const countEl = document.getElementById(`ad-impressions-${adId}`);
  const currentCount = countEl ? parseInt(countEl.textContent) : 0;

  // Optimistic UI Update & DB Save
  window.incrementCounter("advertisements", "impressions_count", adId, currentCount, (newVal) => {
    if (countEl) countEl.textContent = newVal;
  });
}