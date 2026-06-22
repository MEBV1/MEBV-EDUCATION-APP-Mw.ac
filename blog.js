// blog.js
// Blog article browsing, featured posts, and comment system

let blogPosts = [];
let currentPost = null;

window.loadBlogPosts = async function() {
  window.showLoading("Loading blog posts...");
  try {
    const searchTerm = document.getElementById("blog-search")?.value || "";
    const category = document.getElementById("blog-category")?.value || "all";
    blogPosts = await fetchBlogPosts(searchTerm, category);
    renderFeaturedArticles(blogPosts.filter((post) => post.featured));
    renderBlogPosts(blogPosts);
  } finally {
    window.hideLoading();
  }
}

window.addEventListener("DOMContentLoaded", () => {
  document.getElementById("blog-search")?.addEventListener("input", debounce(window.loadBlogPosts, 300));
  document.getElementById("blog-category")?.addEventListener("change", window.loadBlogPosts);
  window.loadBlogPosts();
});

async function fetchBlogPosts(searchTerm = "", category = "all") {
  if (!window.supabaseClient) return [];

  try {
    let query = window.supabaseClient
      .from("blog_posts")
      .select("*")
      .order("published_at", { ascending: false });

    if (category && category !== "all") {
      query = query.eq("category", category);
    }
    if (searchTerm.trim()) {
      const q = searchTerm.trim();
      query = query.or(`title.ilike.%${q}%,excerpt.ilike.%${q}%,category.ilike.%${q}%`);
    }

    const { data, error } = await query;
    if (error) throw error;
    return data || [];
  } catch (error) {
    console.error("Unable to fetch blog posts:", error);
    return [];
  }
}

function renderFeaturedArticles(posts) {
  const container = document.getElementById("featured-articles");
  if (!container) return;
  container.innerHTML = "";
  if (!posts || posts.length === 0) {
    container.innerHTML = `<p style="color: var(--text-muted);">No featured articles available.</p>`;
    return;
  }

  posts.slice(0, 3).forEach((post) => {
    const card = document.createElement("article");
    card.className = "card";
    card.innerHTML = `
      <div class="card-img-wrapper">
        <img src="${post.featured_image || 'LOGO.png'}" alt="${escapeHtml(post.title)}" class="card-img">
      </div>
      <div class="card-content">
        <p class="book-card-meta">${escapeHtml(post.category || 'News')}</p>
        <h3 class="card-title">${escapeHtml(post.title)}</h3>
        <p class="card-description">${escapeHtml(post.excerpt || 'Article summary is not available.')}</p>
        <a class="btn btn-outline btn-sm btn-block" href="#" onclick="openArticle('${post.id}')">Read More</a>
      </div>
    `;
    container.appendChild(card);
  });
}

function renderBlogPosts(posts) {
  const container = document.getElementById("blog-posts");
  if (!container) return;
  container.innerHTML = "";
  if (!posts || posts.length === 0) {
    container.innerHTML = `<p style="color: var(--text-muted);">No stories match your search right now.</p>`;
    return;
  }

  posts.forEach((post) => {
    const card = document.createElement("article");
    card.className = "card";
    card.innerHTML = `
      <div class="card-content">
        <p class="book-card-meta">${escapeHtml(post.category || 'Article')}</p>
        <h3 class="card-title">${escapeHtml(post.title)}</h3>
        <p class="card-description">${escapeHtml(post.excerpt || '')}</p>
        <div class="card-footer" style="gap: 1rem; flex-wrap: wrap;">
          <button type="button" class="btn btn-outline btn-sm" onclick="openArticle('${post.id}')">Read Article</button>
          <span style="font-size: 0.9rem; color: var(--text-muted);"><span id="blog-views-${post.id}">${post.views_count || 0}</span> views</span>
        </div>
      </div>
    `;
    container.appendChild(card);
  });
}

async function openArticle(postId) {
  const post = blogPosts.find((entry) => entry.id === postId);
  if (!post) return;
  currentPost = post;

  document.getElementById("article-title").textContent = post.title;
  document.getElementById("article-meta").textContent = `${post.category || 'General'} • ${new Date(post.published_at || Date.now()).toLocaleDateString()}`;
  document.getElementById("article-body").innerHTML = `
    <p style="color: var(--text-secondary); line-height: 1.8;">${escapeHtml(post.content || post.excerpt || 'No full article content available.')}</p>
  `;
  document.getElementById("comments-section").innerHTML = `
    <div style="margin-bottom: 1.5rem;">
      <h3 style="font-size: 1.1rem; margin-bottom: 0.75rem;">Comments</h3>
      <div id="comments-list" style="display: grid; gap: 1rem;"></div>
    </div>
  `;
  document.getElementById("comment-form")?.reset();
  document.getElementById("article-modal").classList.add("active");
  await incrementArticleViews(post.id);
  loadArticleComments(post.id);
}

function closeArticleModal() {
  document.getElementById("article-modal").classList.remove("active");
}

document.addEventListener("submit", async (event) => {
  if (event.target && event.target.id === "comment-form") {
    event.preventDefault();
    await submitComment();
  }
});

async function loadArticleComments(postId) {
  if (!window.supabaseClient) return;

  try {
    const { data, error } = await window.supabaseClient
      .from("blog_comments")
      .select("*")
      .eq("post_id", postId)
      .order("created_at", { ascending: false });
    if (error) throw error;
    renderComments(data || []);
  } catch (error) {
    console.error("Unable to load comments:", error);
    renderComments([]);
  }
}

function renderComments(comments) {
  const list = document.getElementById("comments-list");
  if (!list) return;
  list.innerHTML = "";
  if (!comments || comments.length === 0) {
    list.innerHTML = `<p style="color: var(--text-muted);">No comments yet. Share your thoughts below.</p>`;
    return;
  }

  comments.forEach((comment) => {
    const item = document.createElement("div");
    item.style.border = "1px solid var(--border-color)";
    item.style.borderRadius = "var(--border-radius-md)";
    item.style.padding = "1rem";
    item.innerHTML = `
      <strong>${escapeHtml(comment.name || 'Guest')}</strong>
      <p style="margin: 0.25rem 0; color: var(--text-secondary);">${escapeHtml(comment.message)}</p>
      <span style="font-size: 0.8rem; color: var(--text-muted);">${new Date(comment.created_at || Date.now()).toLocaleDateString()}</span>
    `;
    list.appendChild(item);
  });
}

async function submitComment() {
  if (!currentPost) return;

  const name = document.getElementById("comment-name").value.trim();
  const message = document.getElementById("comment-message").value.trim();

  if (!name || !message) {
    window.showError("Please provide your name and comment.");
    return;
  }

  window.showLoading("Submitting your comment...");
  try {
    if (window.supabaseClient) {
      const { error } = await window.supabaseClient
        .from("blog_comments")
        .insert([{ post_id: currentPost.id, name: name, message: message, created_at: new Date().toISOString() }]);
      if (error) throw error;
    }
    window.showSuccess("Comment posted successfully.");
    document.getElementById("comment-form").reset();
    loadArticleComments(currentPost.id);
  } catch (error) {
    console.error("Unable to submit comment:", error);
    window.showError("Could not post comment right now. Try again later.");
  } finally {
    window.hideLoading();
  }
}

async function incrementArticleViews(postId) {
  if (!window.supabaseClient || !postId) return;

  const countEl = document.getElementById(`blog-views-${postId}`);
  const currentCount = countEl ? parseInt(countEl.textContent) : 0;

  // Optimistic UI Update & DB Save
  window.incrementCounter("blog_posts", "views_count", postId, currentCount, (newVal) => {
    if (countEl) countEl.textContent = newVal;
  });
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
