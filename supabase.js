// supabase.js
// Database configuration and client initialization for Malawi Education Books and Vacancies

const SUPABASE_URL = "https://tengzploljdireajaxwx.supabase.co";
const SUPABASE_ANON_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InRlbmd6cGxvbGpkaXJlYWpheHd4Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODA4MjU5NDgsImV4cCI6MjA5NjQwMTk0OH0.iUE6O2vRUpiG09mWAXQKkQVPjPtBYJnJkhPQgoXkWAo"
// Initialize the Supabase client and expose it globally
let supabaseClientInstance;

try {
  if (typeof window.supabase !== 'undefined') {
    // If supabase CDN script is loaded, initialize client
    supabaseClientInstance = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
      auth: {
        persistSession: true,
        autoRefreshToken: true,
        detectSessionInUrl: true
      }
    });
    window.supabaseClient = supabaseClientInstance;
  } else {
    console.error("Supabase SDK script is missing. Please ensure the CDN script is loaded in your HTML.");
  }
} catch (error) {
  console.error("Failed to initialize Supabase client:", error);
}

function getGoogleDriveFileId(value) {
  if (!value || typeof value !== "string") return "";
  const trimmedUrl = value.trim();
  if (/^[A-Za-z0-9_-]{10,}$/.test(trimmedUrl)) return trimmedUrl;
  try {
    const url = new URL(trimmedUrl);
    if (!["drive.google.com", "docs.google.com", "drive.usercontent.google.com"].includes(url.hostname.toLowerCase())) return "";
    const pathMatch = url.pathname.match(/\/(?:file|document|presentation|spreadsheets)\/d\/([A-Za-z0-9_-]{10,})/i);
    const fileId = pathMatch?.[1] || url.searchParams.get("id") || "";
    return /^[A-Za-z0-9_-]{10,}$/.test(fileId) ? fileId : "";
  } catch {
    return "";
  }
}

/**
 * Convert supported Google Drive/Docs sharing links into direct-download URLs.
 * Google Workspace files use their format-specific export endpoints.
 */
function convertGoogleDriveLink(url) {
  if (!url || typeof url !== "string") return "";
  const trimmedUrl = url.trim();
  const fileId = getGoogleDriveFileId(trimmedUrl);
  if (!fileId) return trimmedUrl;

  let parsedUrl;
  try {
    parsedUrl = new URL(trimmedUrl);
  } catch {
    return trimmedUrl;
  }
  const id = encodeURIComponent(fileId);
  if (parsedUrl.hostname.toLowerCase() === "docs.google.com") {
    if (/\/document\/d\//i.test(parsedUrl.pathname)) {
      return `https://docs.google.com/document/d/${id}/export?format=docx`;
    }
    if (/\/presentation\/d\//i.test(parsedUrl.pathname)) {
      return `https://docs.google.com/presentation/d/${id}/export/pptx`;
    }
    if (/\/spreadsheets\/d\//i.test(parsedUrl.pathname)) {
      return `https://docs.google.com/spreadsheets/d/${id}/export?format=xlsx`;
    }
  }
  return `https://drive.google.com/uc?export=download&id=${id}`;
}

// Export utilities to the global scope
window.getGoogleDriveFileId = getGoogleDriveFileId;
window.convertGoogleDriveLink = convertGoogleDriveLink;
// ==========================================
// ANTI-INSPECTION & TAMPERING DETERRENTS
// ==========================================
(function() {
  // 1. Disable Right-Click (Prevents "Inspect Element")
  document.addEventListener('contextmenu', event => event.preventDefault());

  // 2. Disable Developer Tools Keyboard Shortcuts
  document.addEventListener('keydown', function(e) {
    // Disable F12
    if (e.key === 'F12' || e.keyCode === 123) {
      e.preventDefault();
      return false;
    }
    // Disable Ctrl+Shift+I (Inspect), Ctrl+Shift+J (Console), Ctrl+Shift+C (Elements)
    if (e.ctrlKey && e.shiftKey && (e.key === 'I' || e.key === 'J' || e.key === 'C' || e.keyCode === 73 || e.keyCode === 74 || e.keyCode === 67)) {
      e.preventDefault();
      return false;
    }
    // Disable Ctrl+U (View Source)
    if (e.ctrlKey && (e.key === 'u' || e.key === 'U' || e.keyCode === 85)) {
      e.preventDefault();
      return false;
    }
  });

  // 3. Clear the Console continuously to hinder reading historical logs
  // (Uncomment the line below when you are ready to deploy to production)
  // setInterval(function() { if (window.console && window.console.clear) { window.console.clear(); } }, 1000);

  // 4. Infinite Debugger Loop (Triggers execution pause when DevTools are opened)
  // (Uncomment the lines below when you are ready to deploy to production)
  /*
  setInterval(function() {
    (function() {
      Function("debugger")();
    })();
  }, 1000);
  */
})();
/**
 * RESILIENT INITIALIZATION GUARD
 * Periodically checks for the Supabase SDK if it wasn't ready on page load.
 */
(function initializeSupabaseResiliently() {
    const initClient = () => {
        if (typeof window.supabase !== 'undefined' && !window.supabaseClient) {
            try {
                const client = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
                  auth: {
                    persistSession: true,
                    autoRefreshToken: true,
                    detectSessionInUrl: true
                  }
                });
                window.supabaseClient = client;
                console.log("Supabase Client initialized successfully.");
                // Dispatch a global event so other files know it's safe to query
                window.dispatchEvent(new CustomEvent('supabaseReady'));
            } catch (err) {
                console.error("Critical: Initialization error:", err);
            }
        }
    };

    // Attempt 1: Immediate
    initClient();

    // Attempt 2: If failed, poll every 50ms for up to 5 seconds
    if (!window.supabaseClient) {
        let attempts = 0;
        const interval = setInterval(() => {
            attempts++;
            initClient();
            if (window.supabaseClient || attempts > 100) {
                clearInterval(interval);
                if (!window.supabaseClient) console.error("Supabase SDK failed to load after timeout.");
            }
        }, 50);
    }
})();