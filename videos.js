// videos.js
// Video library and progress tracking for Malawi Education Books and Vacancies

let videoCollection = [];
let selectedVideo = null;

window.addEventListener("DOMContentLoaded", () => {
  const searchInput = document.getElementById("video-search");
  const categorySelect = document.getElementById("video-category");

  if (searchInput) {
    searchInput.addEventListener("input", debounce(loadVideos, 300));
  }

  if (categorySelect) {
    categorySelect.addEventListener("change", loadVideos);
  }

  loadVideos();
});

async function loadVideos() {
  window.showLoading("Loading video library...");
  try {
    const searchTerm = document.getElementById("video-search")?.value || "";
    const category = document.getElementById("video-category")?.value || "all";

    videoCollection = await fetchVideos(searchTerm, category);
    renderVideoPlaylist(videoCollection);
    if (!selectedVideo && videoCollection.length > 0) selectedVideo = videoCollection[0];
    renderCurrentVideo(selectedVideo);
    updateProgressSummary();
  } finally {
    window.hideLoading();
  }
}

async function fetchVideos(searchTerm = "", category = "all") {
  if (!window.supabaseClient) return [];

  try {
    let query = window.supabaseClient
      .from("videos")
      .select("*")
      .order("created_at", { ascending: false });

    if (category && category !== "all") {
      query = query.eq("category", category);
    }

    if (searchTerm.trim()) {
      const q = searchTerm.trim();
      query = query.or(`title.ilike.%${q}%,description.ilike.%${q}%,category.ilike.%${q}%`);
    }

    const { data, error } = await query;
    if (error) throw error;
    return data || [];
  } catch (err) {
    console.error("Failed to fetch videos:", err);
    return [];
  }
}

function renderVideoPlaylist(videos) {
  const playlist = document.getElementById("video-playlist");
  if (!playlist) return;
  playlist.innerHTML = "";

  if (!videos || videos.length === 0) {
    playlist.innerHTML = `<p style="color: var(--text-muted); padding: 1rem;">No videos are available at this time.</p>`;
    return;
  }

  videos.forEach((video) => {
    const item = document.createElement("button");
    item.type = "button";
    item.className = "playlist-item";
    if (selectedVideo && selectedVideo.id === video.id) {
      item.classList.add("active");
    }
    item.innerHTML = `
      <img src="${video.thumbnail_url || 'LOGO.png'}" alt="${escapeHtml(video.title)} thumbnail" class="playlist-item-thumbnail">
      <div class="playlist-item-content">
        <h3 class="playlist-item-title">${escapeHtml(video.title)}</h3>
        <p style="font-size: 0.8rem; color: var(--text-muted);">${escapeHtml(video.category || 'General')}</p>
        <p style="font-size: 0.8rem; color: var(--text-muted); margin-top: 0.35rem;"><span id="video-views-${video.id}">${video.views_count || 0}</span> views</p>
      </div>
    `;
    item.addEventListener("click", () => {
      selectedVideo = video;
      renderVideoPlaylist(videos);
      renderCurrentVideo(video);
      trackVideoView(video.id);
    });
    playlist.appendChild(item);
  });
}

function renderCurrentVideo(video) {
  if (!video) {
    document.getElementById("video-player-frame").src = "";
    document.getElementById("current-video-title").textContent = "Select a video from the playlist.";
    document.getElementById("current-video-description").textContent = "";
    return;
  }

  const player = document.getElementById("video-player-frame");
  const src = getVideoEmbedUrl(video.video_url || "");
  player.src = src;
  document.getElementById("current-video-title").textContent = video.title;
  document.getElementById("current-video-description").textContent = video.description || "No description available.";
  
  // Add platform support notice if not present
  let notice = document.getElementById("platform-video-notice");
  if (!notice) {
    notice = document.createElement("p");
    notice.id = "platform-video-notice";
    notice.style.fontSize = "0.85rem";
    notice.style.color = "var(--text-muted)";
    notice.style.marginTop = "1rem";
    notice.style.textAlign = "center";
    notice.textContent = "Supporting MEBV ensures more free educational content. Please watch and learn through our platform.";
    player.parentElement.appendChild(notice);
  }

  saveVideoProgress(video.id);
}

function getVideoEmbedUrl(url) {
  if (!url) return "";
  // Restrictive parameters to keep users on platform:
  // modestbranding=1 (hide logo), rel=0 (related from same channel), 
  // iv_load_policy=3 (hide annotations), disablekb=1 (disable shortcuts),
  // controls=1 (keep controls but restrict branding), fs=1 (allow fullscreen)
  const params = "modestbranding=1&rel=0&iv_load_policy=3&disablekb=1&controls=1&fs=1&widget_referrer=" + encodeURIComponent(window.location.href);
  
  const videoId = extractYoutubeId(url);

  if (videoId) {
    return `https://www.youtube.com/embed/${videoId}?${params}`;
  }
  return url;
}

function extractYoutubeId(url) {
  if (!url) return null;
  const regExp = /^.*(youtu.be\/|v\/|u\/\w\/|embed\/|watch\?v=|&v=|shorts\/)([^#&?]*).*/;
  const match = url.match(regExp);
  return (match && match[2].length === 11) ? match[2] : null;
}

async function trackVideoView(videoId) {
  if (!window.supabaseClient || !videoId) return;

  const countEl = document.getElementById(`video-views-${videoId}`);
  const currentCount = countEl ? parseInt(countEl.textContent) : 0;

  // Optimistic UI Update & DB Save
  window.incrementCounter("videos", "views_count", videoId, currentCount, (newVal) => {
    if (countEl) countEl.textContent = newVal;
  });

  try {
    await window.supabaseClient
      .from("video_views")
      .insert([{ video_id: videoId, viewed_at: new Date().toISOString() }]);
  } catch (err) {
    console.warn("Unable to log video view event:", err);
  }
}

async function saveVideoProgress(videoId) {
  if (!videoId) return;

  const progressKey = "mebv_video_progress";
  const saved = JSON.parse(localStorage.getItem(progressKey) || "[]");
  if (!saved.includes(videoId)) {
    saved.push(videoId);
    localStorage.setItem(progressKey, JSON.stringify(saved));
  }

  if (window.supabaseClient) {
    try {
      const { data: { session } } = await window.supabaseClient.auth.getSession();
      const userId = session?.user?.id;
      if (!userId) return;
      const { error } = await window.supabaseClient
        .from("video_progress")
        .upsert({ user_id: userId, video_id: videoId, completed_at: new Date().toISOString() }, { onConflict: ["user_id", "video_id"] });
      if (error) throw error;
    } catch (err) {
      console.warn("Unable to save video progress:", err);
    }
  }

  updateProgressSummary();
}

function updateProgressSummary() {
  const progressKey = "mebv_video_progress";
  const watchedIds = JSON.parse(localStorage.getItem(progressKey) || "[]");
  const total = videoCollection.length;
  const watched = watchedIds.filter((id) => videoCollection.some((video) => video.id === id)).length;
  const percent = total ? Math.round((watched / total) * 100) : 0;
  document.getElementById("video-progress-percent").textContent = `${percent}% Completed`;
  document.getElementById("video-progress-bar").style.width = `${percent}%`;
}

function escapeHtml(value) {
  return String(value || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

function debounce(fn, delay) {
  let timer;
  return (...args) => {
    clearTimeout(timer);
    timer = setTimeout(() => fn(...args), delay);
  };
}
