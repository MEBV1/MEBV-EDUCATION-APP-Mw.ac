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

const freeDownloadVisitorKey = "mebv_free_download_visitor_id";
const activeBookDownloads = new Map();

function getFreeDownloadVisitorId() {
  let visitorId = localStorage.getItem(freeDownloadVisitorKey);
  if (!visitorId) {
    visitorId = crypto.randomUUID();
    localStorage.setItem(freeDownloadVisitorKey, visitorId);
  }
  return visitorId;
}

function getDownloadFilename(response, fallback) {
  const disposition = response.headers.get("content-disposition") || "";
  const encoded = disposition.match(/filename\*=UTF-8''([^;]+)/i)?.[1];
  if (encoded) {
    try {
      return decodeURIComponent(encoded);
    } catch {
      return fallback;
    }
  }
  return disposition.match(/filename="?([^";]+)"?/i)?.[1] || fallback;
}

async function updateBookDownloadCount(bookId) {
  const { data, error } = await window.supabaseClient
    .from("books")
    .select("downloads_count")
    .eq("id", bookId)
    .maybeSingle();
  if (error) {
    console.error("[BOOK DOWNLOAD] Could not refresh download count:", error);
    return;
  }
  document.querySelectorAll(
    `#book-downloads-${bookId}, [data-download-count-for="${bookId}"]`
  ).forEach((element) => {
    const count = Number(data?.downloads_count) || 0;
    element.textContent = element.classList.contains("mebv-counts")
      ? `${count} Downloads`
      : String(count);
  });
}

async function downloadBookFile(bookId) {
  if (activeBookDownloads.has(bookId)) return activeBookDownloads.get(bookId);
  const request = (async () => {
    if (!window.supabaseClient || !bookId) {
      throw new Error("The download service is not available.");
    }

    const { data: { session } } = await window.supabaseClient.auth.getSession();
    const visitorId = session?.user ? null : getFreeDownloadVisitorId();
    const requestId = crypto.randomUUID();
    const endpoint = `${window.supabaseClient.supabaseUrl}/functions/v1/download-book`;
    const headers = {
      "Content-Type": "application/json",
      "apikey": window.supabaseClient.supabaseKey,
      "Authorization": `Bearer ${session?.access_token || window.supabaseClient.supabaseKey}`
    };
    let reservationMade = false;
    const postAction = (action) => fetch(endpoint, {
      method: "POST",
      headers,
      body: JSON.stringify({ action, bookId, visitorId, requestId })
    });

    try {
      const response = await postAction("download");
      if (!response.ok) {
        const result = await response.json().catch(() => null);
        if (response.status === 429 && result?.code === "FREE_DOWNLOAD_LIMIT_REACHED") {
          window.showAuthModal("download-limit");
          return false;
        }
        throw new Error(result?.error || `Download failed (HTTP ${response.status}).`);
      }
      reservationMade = true;
      if (response.headers.get("x-download-request-id") !== requestId) {
        throw new Error("The download response did not match this request.");
      }

      const file = await response.blob();
      if (!file.size) throw new Error("The download service returned an empty file.");
      const objectUrl = URL.createObjectURL(file);
      const link = document.createElement("a");
      link.href = objectUrl;
      link.download = getDownloadFilename(response, `book-${bookId}`);
      link.hidden = true;
      document.body.appendChild(link);
      link.click();
      link.remove();
      window.setTimeout(() => URL.revokeObjectURL(objectUrl), 60_000);

      let completionResponse;
      for (let attempt = 0; attempt < 2; attempt += 1) {
        try {
          completionResponse = await postAction("complete");
          if (completionResponse.ok) break;
        } catch (error) {
          if (attempt === 1) throw error;
        }
      }
      if (!completionResponse?.ok) {
        const result = await completionResponse?.json().catch(() => null);
        throw new Error(result?.error || "The downloaded file could not be recorded.");
      }

      await updateBookDownloadCount(bookId);
      window.showToast("Your download is ready.", "success");
      return true;
    } catch (error) {
      if (reservationMade) {
        await postAction("fail").catch((releaseError) => {
          console.error("[BOOK DOWNLOAD] Could not release failed download:", releaseError);
        });
      }
      throw error;
    }
  })();

  activeBookDownloads.set(bookId, request);
  try {
    return await request;
  } catch (error) {
    console.error("[BOOK DOWNLOAD] Download failed:", error);
    window.showError(error.message || "The book could not be downloaded.");
    return false;
  } finally {
    activeBookDownloads.delete(bookId);
    window.dispatchEvent(new CustomEvent("mebv:book-download-settled"));
  }
}

window.downloadBookFile = downloadBookFile;
window.trackDownload = (bookId) => downloadBookFile(bookId);
window.hasActiveBookDownload = () => activeBookDownloads.size > 0;

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

function getProfessionalPreview(book) {
  const coverUrl = String(book?.cover_url || "").trim();
  if (!coverUrl ||
    /^(?:unavailable|failed|preview_unavailable|cover_failed|cover_unavailable)$/i.test(coverUrl) ||
    /(?:^|\/)(?:logo|icon)\.(?:png|jpe?g|webp)(?:$|[?#])/i.test(coverUrl) ||
    /drive\.google\.com\/thumbnail\?/i.test(coverUrl)) return "";
  try {
    const url = new URL(coverUrl);
    if (!["http:", "https:"].includes(url.protocol)) return "";
  } catch {
    return "";
  }
  return coverUrl.replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/'/g, "&#39;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

function getBookPreviewStatus(book) {
  const coverUrl = String(book?.cover_url || "").trim();
  if (/(?:^|\/)(?:logo|icon)\.(?:png|jpe?g|webp)(?:$|[?#])/i.test(coverUrl)) {
    return "The saved cover URL points to a site icon, not a book preview.";
  }
  if (/drive\.google\.com\/thumbnail\?/i.test(coverUrl)) {
    return "The saved Drive thumbnail is not a book cover. Use the first-page sync or the download option.";
  }
  if (coverUrl && !getProfessionalPreview(book)) {
    return "The saved cover URL is invalid. Try the download option to open the original file.";
  }

  const sourceUrls = [book?.drive_url, book?.download_url]
    .map(value => String(value || "").trim())
    .filter(Boolean);
  if (!sourceUrls.length) return "No source file link is saved for this book.";
  if (typeof window.getGoogleDriveFileId === "function" &&
    !sourceUrls.some(sourceUrl => window.getGoogleDriveFileId(sourceUrl))) {
    return "The saved link does not identify a supported Google Drive file. Downloads may fail.";
  }
  return "A first-page preview has not been generated. Use Download Book to open the source file.";
}

function escapeBookPreviewText(value) {
  return String(value || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

window.renderBookCoverPreview = function(book, alt, variant = "card") {
  const isCard = variant === "card";
  const className = isCard ? "card-img book-cover-image" : "book-cover-modal-image";
  const statusClass = isCard ? "book-preview-status book-preview-status--card" : "book-preview-status book-preview-status--modal";
  const style = isCard ? "" : ' style="width:120px;aspect-ratio:3/4;object-fit:contain;background:var(--bg-tertiary);border-radius:var(--border-radius-md);"';
  const coverUrl = getProfessionalPreview(book);
  if (!coverUrl) {
    return `<div class="${statusClass}" role="status"${style}>${escapeBookPreviewText(getBookPreviewStatus(book))}</div>`;
  }
  return `<img src="${coverUrl}" alt="${escapeBookPreviewText(alt)}" class="${className}" data-preview-variant="${variant}" onerror="window.handleBookCoverPreviewError(this)"${style}>`;
};

window.handleBookCoverPreviewError = function(image) {
  const isCard = image.dataset.previewVariant === "card";
  const fallback = document.createElement("div");
  fallback.className = isCard ? "book-preview-status book-preview-status--card" : "book-preview-status book-preview-status--modal";
  fallback.setAttribute("role", "status");
  fallback.textContent = "The saved cover image could not be loaded. Try Download Book; the source link is unchanged.";
  if (!isCard) {
    fallback.style.cssText = "width:120px;aspect-ratio:3/4;display:grid;place-items:center;padding:.5rem;text-align:center;background:var(--bg-tertiary);border-radius:var(--border-radius-md);";
  }
  image.replaceWith(fallback);
};
window.getBookCoverPreview = getProfessionalPreview;
window.getBookPreviewStatus = getBookPreviewStatus;

/**
 * Handle card download events with direct integration to analytics.
 */
window.executeQuickDownload = function(event, bookId) {
    if(event) event.stopPropagation(); // Stop details modal from opening
    window.downloadBookFile(bookId);
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