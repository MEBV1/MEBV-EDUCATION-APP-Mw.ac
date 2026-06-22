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