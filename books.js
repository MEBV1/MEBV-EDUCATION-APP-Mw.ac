// books.js
// Book Catalog & Resource download management logic for Malawi Education Books and Vacancies

/**
 * Fetch books from Supabase database based on filter queries
 * 
 * @param {string} searchTerm - Search keywords (title/author)
 * @param {string} category - Category filter values (MSCE Books, JCE Books, etc.)
 * @returns {Array} List of book records matching queries
 */
async function fetchBooks(searchTerm = "", category = "all") {
  if (!window.supabaseClient) {
    console.error("Database connection missing");
    return [];
  }

  try {
    let query = window.supabaseClient
      .from("books")
      .select("*")
      .order("created_at", { ascending: false });

    // Filter by Category if specific value selected
    if (category && category !== "all") {
      query = query.eq("category", category);
    }

    // Filter by search terms matching either title, author or description
    if (searchTerm && searchTerm.trim() !== "") {
      const sanitized = searchTerm.trim();
      query = query.or(`title.ilike.%${sanitized}%,author.ilike.%${sanitized}%,description.ilike.%${sanitized}%`);
    }

    const { data, error } = await query;
    if (error) throw error;
    return data || [];
  } catch (err) {
    console.error("Failed to query educational book catalog:", err);
    window.showToast("Could not retrieve books list.", "error");
    return [];
  }
}

/**
 * Query individual book meta details along with its submitted reviews
 * 
 * @param {string} bookId - Book UUID record identifier
 */
async function fetchBookDetails(bookId) {
  if (!window.supabaseClient || !bookId) return null;

  try {
    // 1) Fetch the book record first (no nested relations)
    const { data: book, error: bookErr } = await window.supabaseClient
      .from("books")
      .select("*")
      .eq("id", bookId)
      .single();

    if (bookErr) {
      console.error("Book query error for book ID:", bookId, bookErr);
      return null;
    }

    // 2) Attempt to fetch reviews separately. Failures here must NOT block the book display.
    let reviews = [];
    try {
      const { data: revData, error: revErr } = await window.supabaseClient
        .from("book_reviews")
        .select(`id, rating, comment, created_at, user_id`)
        .eq("book_id", bookId)
        .order("created_at", { ascending: false });

      if (revErr) throw revErr;

      if (revData && revData.length > 0) {
        // Fetch profile names for reviewer user_ids
        const userIds = Array.from(new Set(revData.map(r => r.user_id).filter(Boolean)));
        let profilesMap = {};

        if (userIds.length > 0) {
          const { data: profilesData, error: profilesErr } = await window.supabaseClient
            .from("profiles")
            .select("id, full_name")
            .in("id", userIds);

          if (profilesErr) {
            console.error("Profiles query error while resolving reviewer names for book ID:", bookId, profilesErr);
          } else if (profilesData) {
            profilesMap = profilesData.reduce((m, p) => { m[p.id] = p.full_name; return m; }, {});
          }
        }

        reviews = revData.map(r => ({
          id: r.id,
          rating: r.rating,
          comment: r.comment,
          created_at: r.created_at,
          // emulate previous nested shape: profiles.full_name when available
          profiles: { full_name: profilesMap[r.user_id] || "Anonymous User" }
        }));
      }
    } catch (revFetchErr) {
      // Ensure review load failures are logged but do not prevent book display
      console.error("Review query error for book ID:", bookId, revFetchErr);
      reviews = [];
    }

    // Attach reviews array to returned book object under the same property name as before
    const result = Object.assign({}, book, { book_reviews: reviews });
    return result;
  } catch (err) {
    console.error("Failed to load details for book ID:", bookId, err);
    return null;
  }
}

/**
 * Safely log a resource download event to monitor analytics
 * and update download metrics counters
 * 
 * @param {string} bookId - Book UUID identifier
 */
async function trackDownload(bookId) {
  console.log("[Analytics] Download button clicked");
  
  if (!window.supabaseClient || !bookId) return;

  // Duplicate protection using sessionStorage
  const sessionKey = `downloaded_book_${bookId}`;
  const alreadyCounted = sessionStorage.getItem(sessionKey) === "true";
  
  if (!alreadyCounted) {
    const countEl = document.getElementById(`book-downloads-${bookId}`);
    const currentCount = countEl ? parseInt(countEl.textContent) : 0;

    // Optimistic UI Update & DB Save
    window.incrementCounter("books", "downloads_count", bookId, currentCount, (newVal) => {
      if (countEl) countEl.textContent = newVal;
    });
    
    // Mark as counted in session
    sessionStorage.setItem(sessionKey, "true");
    console.log("[Analytics] Download counted");

    try {
      // Register user profile event detail inside downloads analytics logging table
      const { data: { session } } = await window.supabaseClient.auth.getSession();
      const userId = session && session.user ? session.user.id : null;

      await window.supabaseClient
        .from("book_downloads")
        .insert([
          {
            book_id: bookId,
            user_id: userId,
            downloaded_at: new Date().toISOString()
          }
        ]);
    } catch (err) {
      console.warn("Analytics logger deferred download record registration:", err);
    }
  } else {
    console.log("[Analytics] Download already counted in this session");
  }
  
  console.log("[Analytics] Download started");
}

/**
 * Submit user assessment/review details for a curriculum book
 * 
 * @param {string} bookId - Target Book ID
 * @param {number} rating - Choice between 1 and 5 stars
 * @param {string} comment - Helpful feedback thoughts
 */
async function submitReview(bookId, rating, comment) {
  if (!window.supabaseClient) {
    window.showToast("Cannot write review. Platform is currently offline.", "error");
    return null;
  }

  window.showLoading("Submitting your review evaluation...");

  try {
    // 1. Verify active user session
    const { data: { session } } = await window.supabaseClient.auth.getSession();
    if (!session || !session.user) {
      window.showToast("You must be logged in to rate or review materials.", "warning");
      return null;
    }

    // 2. Submit rating review entry
    const { data, error } = await window.supabaseClient
      .from("book_reviews")
      .insert([
        {
          book_id: bookId,
          user_id: session.user.id,
          rating: parseInt(rating),
          comment: comment.trim(),
          created_at: new Date().toISOString()
        }
      ])
      .select();

    if (error) {
      // Handle policy violations or unique index constraints (e.g. 1 review per user per book)
      if (error.code === "23505") {
        throw new Error("You have already submitted an review for this book.");
      }
      throw error;
    }

    window.showToast("Review submitted successfully!", "success");
    return data[0] || null;
  } catch (err) {
    window.showToast(err.message || "Failed to save your book review feedback.", "error");
    console.error("Submission error:", err);
    return null;
  } finally {
    window.hideLoading();
  }
}

// Attach functions globally to avoid import resolution errors in plain html files
window.fetchBooks = fetchBooks;
window.fetchBookDetails = fetchBookDetails;
window.trackDownload = trackDownload;
window.submitReview = submitReview;
/* --- DYNAMIC RENDERING OVERRIDES: APPLIES TO ALL OLD & NEW DATA --- */

/**
 * Intelligent Cover Extractor.
 * Runs instantly during UI rendering. It checks if an existing book 
 * has a G-Drive link and pulls a High-Res (1000px) thumbnail 
 * for the first page regardless of how long ago it was uploaded.
 */
function getProfessionalPreview(book) {
  const gLink = book.download_url || "";
  const fileIdMatch = gLink.match(/[-\w]{25,}/);
  
  if (fileIdMatch) {
    // Force native high-quality thumbnail (1000px width)
    return `https://drive.google.com/thumbnail?id=${fileIdMatch[0]}&sz=w1000`;
  }
  // Use existing cover if specifically provided, else site logo
  return book.cover_url || 'LOGO.png';
}

/**
 * Handle card download events with direct integration to analytics.
 */
window.executeQuickDownload = function(event, bookId, downloadUrl) {
    if(event) event.stopPropagation(); // Stop details modal from opening
    if (!downloadUrl || downloadUrl === "#") {
        window.showToast("File link not found", "error");
        return;
    }
    window.showToast("Preparing your file...", "success");
    // Directly invoke your existing counter and analytics logic
    window.trackDownload(bookId);
    window.open(downloadUrl, '_blank');
};

/**
 * Generic star rendering utility to fix inconsistencies in the list
 */
function renderDynamicStars(val) {
    const r = Math.round(val || 0);
    return Array.from({length: 5}).map((_, i) => i < r ? '★' : '☆').join('');
}
/**
 * DATABASE INITIALIZATION WRAPPER
 * Prevents premature calls to .from() before client creation.
 */
async function safeExecute(task) {
    if (window.supabaseClient) {
        return task();
    }
    return new Promise((resolve) => {
        window.addEventListener('supabaseReady', async () => {
            const result = await task();
            resolve(result);
        }, { once: true });
    });
}

// Override global fetch functions to wait for initialization automatically
const originalFetchBooks = window.fetchBooks;
window.fetchBooks = function(...args) {
    return safeExecute(() => originalFetchBooks(...args));
};

const originalLoadBooks = window.loadBooks;
window.loadBooks = function(...args) {
    return safeExecute(() => originalLoadBooks(...args));
};
/**
 * RE-IMPLEMENTATION: Atomic Download Tracker with Cooldown
 * This replaces the previous trackDownload behavior with professional-grade accuracy.
 */
(function() {
    // Persistent memory to handle the 5-second per-book cooldown
    const activeCooldowns = new Set();

    window.trackDownload = async function(bookId) {
        if (!bookId || !window.supabaseClient) return;

        // 1. Check for Duplicate Counting (5-second logic)
        if (activeCooldowns.has(bookId)) {
            console.log("[Analytics] Cooldown active for book:", bookId);
            return; 
        }

        // Add to cooldown set
        activeCooldowns.add(bookId);
        setTimeout(() => activeCooldowns.delete(bookId), 5000);

        try {
            // Get user if logged in
            const { data: { session } } = await window.supabaseClient.auth.getSession();
            const userId = session?.user?.id || null;

            // 2. Perform ATOMIC update on server side
            const { error } = await window.supabaseClient.rpc('increment_book_download_atomic', {
                target_book_id: bookId,
                current_user_id: userId
            });

            if (error) throw error;

            // 3. IMMEDIATE UI UPDATE (No refresh)
            // This selects all elements displaying downloads for this book ID
            const uiSelectors = [
                `#book-downloads-${bookId}`,             // Matches old cards
                `[data-download-count-for="${bookId}"]`   // Universal data attribute
            ];

            uiSelectors.forEach(selector => {
                const elements = document.querySelectorAll(selector);
                elements.forEach(el => {
                    let currentVal = parseInt(el.textContent.replace(/[^0-9]/g, "")) || 0;
                    // Directly increment by exactly 1
                    const newVal = currentVal + 1;
                    
                    // Update text while preserving strings like " Downloads" or " DLs"
                    if (el.classList.contains('mebv-counts')) {
                        el.textContent = `${newVal} Downloads`;
                    } else {
                        el.textContent = newVal;
                    }
                });
            });

        } catch (err) {
            console.error("[Analytics Error] Download count failed:", err);
            // Optional: Show error only if it's a real failure, not just a block
        }
    };
})();