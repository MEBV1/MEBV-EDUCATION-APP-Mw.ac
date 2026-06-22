// python.js
// Python Academy lesson browsing, quizzes and progress tracking

let lessonsList = [];
let selectedLesson = null;
let lessonQuizItems = [];
let userProgress = [];

let userSubscription = null;

window.addEventListener("DOMContentLoaded", () => {
  loadLessons();
  checkCertificateParameter();
});

async function loadLessons() {
  window.showLoading("Loading Python lessons...");
  try {
    const { data: { session } } = await window.supabaseClient.auth.getSession();
    if (!session) {
      window.hideLoading();
      showLoginGate();
      return;
    }
    
    // Check for welcome modal acceptance
    if (!localStorage.getItem('mebv_python_welcome_accepted')) {
      window.hideLoading();
      showPythonWelcomeModal();
      return;
    }

    await checkSubscription(session.user.id);
    lessonsList = await fetchLessons();
    
    await loadUserProgress();
    updateProgressSummary();

    // Determine which lesson to show
    const lastLessonId = localStorage.getItem('mebv_python_last_lesson_id');
    const resumeLesson = lessonsList.find(l => l.id === lastLessonId) || lessonsList[0];
    
    if (resumeLesson) {
      selectLesson(resumeLesson);
    }
  } finally {
    window.hideLoading();
  }
}

function showLoginGate() {
  const lessonContainer = document.getElementById("lesson-list");
  const detailWrapper = document.getElementById("lesson-detail");
  if (lessonContainer) {
    lessonContainer.innerHTML = `
      <div class="card" style="padding: 2rem; text-align: center; grid-column: 1 / -1;">
        <h3 style="margin-bottom: 1rem;">Access Restricted</h3>
        <p style="color: var(--text-secondary); margin-bottom: 1.5rem;">Please login or register to access Python Academy.</p>
        <div style="display: flex; gap: 1rem; justify-content: center;">
          <button class="btn btn-primary" onclick="window.showAuthModal()">Login / Register</button>
        </div>
      </div>
    `;
  }
  if (detailWrapper) {
    detailWrapper.innerHTML = `
      <div style="text-align: center; padding: 3rem 1rem;">
        <p style="color: var(--text-muted);">Content will be displayed after login.</p>
      </div>
    `;
  }
}

function showPythonWelcomeModal() {
  const modal = document.createElement('div');
  modal.className = 'modal-overlay active';
  modal.id = 'python-welcome-modal';
  modal.innerHTML = `
    <div class="modal-box" style="max-width: 550px;">
      <div class="modal-header">
        <h2 class="modal-title">Python Academy Information</h2>
      </div>
      <div class="modal-body" style="line-height: 1.6;">
        <p style="margin-bottom: 1rem;"><strong>Welcome to the MEBV Python Academy.</strong></p>
        <p style="margin-bottom: 1rem;">On this platform you will learn practical Python programming through structured video lessons, exercises, progress tracking, and guided projects.</p>
        <p style="margin-bottom: 1.5rem;">For theory discussions, notes, announcements, support, and interaction with fellow learners, you must join our official WhatsApp learning community.</p>
        
        <div style="display: flex; flex-direction: column; gap: 1rem;">
          <a href="https://chat.whatsapp.com/J2U1y30ZF1hFdzEITrutDU?mlu=1&s=cl&p=a" target="_blank" class="btn btn-primary btn-block" style="background-color: #25D366; border-color: #25D366; display: flex; align-items: center; justify-content: center; gap: 0.5rem;">
            <span>Join WhatsApp Group</span>
          </a>
          <button class="btn btn-outline btn-block" onclick="acceptPythonWelcome()">Continue Learning</button>
        </div>
      </div>
    </div>
  `;
  document.body.appendChild(modal);
}

window.acceptPythonWelcome = function() {
  localStorage.setItem('mebv_python_welcome_accepted', 'true');
  const modal = document.getElementById('python-welcome-modal');
  if (modal) modal.remove();
  loadLessons();
};

async function checkSubscription(userId) {
  try {
    const { data, error } = await window.supabaseClient
      .from("subscriptions")
      .select("*")
      .eq("user_id", userId)
      .eq("status", "active")
      .gt("end_date", new Date().toISOString())
      .maybeSingle();
    
    if (data) {
      userSubscription = data;
    }
  } catch (error) {
    console.error("Subscription check failed:", error);
  }
}

async function fetchLessons() {
  if (!window.supabaseClient) return [];

  try {
    const { data, error } = await window.supabaseClient
      .from("lessons")
      .select("*")
      .order("position", { ascending: true });
    if (error) throw error;
    return data || [];
  } catch (error) {
    console.error("Failed to fetch lessons:", error);
    return [];
  }
}

function renderLessons(lessons) {
  // Single lesson view: Sidebar list is hidden or simplified
  const lessonContainer = document.getElementById("lesson-list");
  if (!lessonContainer) return;
  
  // Optionally clear or show a very compact list if needed, 
  // but requirements say "Show only ONE lesson/video at a time"
  // We'll keep the sidebar for quick jumping but enforce locking there too.
  lessonContainer.innerHTML = "";
  if (!lessons || lessons.length === 0) {
    lessonContainer.innerHTML = `<p style="color: var(--text-muted);">No Python lessons are available at this time.</p>`;
    return;
  }

  lessons.forEach((lesson, index) => {
    const isFree = index < 3;
    const isLocked = !userSubscription && !isFree;
    const card = document.createElement("article");
    card.className = "card";
    if (isLocked) card.style.opacity = "0.7";

    card.innerHTML = `
      <div class="card-content" style="padding: 1rem;">
        <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 0.5rem;">
          <h3 class="card-title" style="font-size: 0.9rem; margin: 0;">Lesson ${index + 1}: ${escapeHtml(lesson.title)}</h3>
          ${isLocked ? '<span>🔒</span>' : (lesson.premium ? '<span class="card-badge" style="font-size: 0.7rem;">Premium</span>' : '')}
        </div>
        <div style="display: flex; justify-content: space-between; align-items: center;">
          <button type="button" class="btn ${isLocked ? 'btn-secondary' : 'btn-outline'} btn-sm" onclick="selectLessonById('${lesson.id}')">
            ${isLocked ? 'Locked' : 'View'}
          </button>
          <span style="font-size: 0.75rem; color: var(--text-muted);">${isLessonCompleted(lesson.id) ? '✓' : ''}</span>
        </div>
      </div>
    `;
    lessonContainer.appendChild(card);
  });
}

async function selectLessonById(lessonId) {
  const lesson = lessonsList.find((item) => item.id === lessonId);
  if (lesson) {
    const lessonIndex = lessonsList.indexOf(lesson);
    const isFree = lessonIndex < 3;
    const isLocked = !userSubscription && !isFree;

    if (isLocked) {
      showUpgradeModal();
      return;
    }
    selectLesson(lesson);
  }
}

async function selectLesson(lesson) {
  selectedLesson = lesson;
  // Save last viewed lesson locally and persist to progress
  localStorage.setItem('mebv_python_last_lesson_id', lesson.id);
  
  renderLessonDetails(lesson);
  trackLessonView(lesson.id);
  const quizItems = await fetchLessonQuiz(lesson.id);
  lessonQuizItems = quizItems;
  renderLessonQuiz(quizItems);
}

async function trackLessonView(lessonId) {
  if (!window.supabaseClient || !lessonId) return;

  const countEl = document.getElementById(`lesson-views-${lessonId}`);
  const currentCount = countEl ? parseInt(countEl.textContent) : 0;

  // Optimistic UI Update & DB Save
  window.incrementCounter("lessons", "views_count", lessonId, currentCount, (newVal) => {
    if (countEl) countEl.textContent = newVal;
  });
}

function getVideoEmbedUrl(url) {
  if (!url) return "";
  // Restrictive parameters to keep users on platform:
  const params = "modestbranding=1&rel=0&iv_load_policy=3&disablekb=1&controls=1&fs=1&widget_referrer=" + encodeURIComponent(window.location.href);
  
  const videoId = extractYoutubeId(url);

  if (videoId) {
    return `https://www.youtube.com/embed/${videoId}?${params}`;
  }
  return url;
}

function renderLessonDetails(lesson) {
  const detailWrapper = document.getElementById("lesson-detail");
  if (!detailWrapper) return;

  const lessonIndex = lessonsList.findIndex(l => l.id === lesson.id);
  const lessonNumber = lessonIndex + 1;
  const totalLessons = lessonsList.length;
  const isFree = lessonIndex < 3; // First 3 lessons are free (0, 1, 2)
  const isLocked = !userSubscription && !isFree;

  if (isLocked) {
    detailWrapper.innerHTML = `
      <div class="card" style="padding: 3rem 1.5rem; text-align: center;">
        <div style="font-size: 4rem; color: var(--text-muted); margin-bottom: 1.5rem;">🔒</div>
        <h2 style="margin-bottom: 1rem;">Your free plan has ended.</h2>
        <p style="color: var(--text-secondary); margin-bottom: 2rem; max-width: 400px; margin-left: auto; margin-right: auto;">
          Upgrade to Premium to continue learning Python and access Lesson ${lessonNumber} and beyond.
        </p>
        <button class="btn btn-primary btn-lg" onclick="showUpgradeModal()">Upgrade to Premium</button>
      </div>
    `;
    showUpgradeModal();
    return;
  }

  const src = getVideoEmbedUrl(lesson.video_url || "");
  const videoHtml = src ? `
    <div style="margin-bottom: 1.5rem; border-radius: var(--border-radius); overflow: hidden; aspect-ratio: 16/9;">
      <iframe width="100%" height="100%" src="${src}" frameborder="0" allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture" allowfullscreen></iframe>
    </div>
  ` : '';

  detailWrapper.innerHTML = `
    <div style="display: flex; flex-direction: column; gap: 1rem;">
      <div style="display: flex; justify-content: space-between; align-items: flex-start; gap: 1rem;">
        <div>
          <p style="font-size: 0.85rem; color: var(--color-primary); font-weight: 700; text-transform: uppercase; margin-bottom: 0.25rem;">Lesson ${lessonNumber} of ${totalLessons}</p>
          <h3 style="margin-top: 0;">${escapeHtml(lesson.title)}</h3>
          <p style="color: var(--text-secondary);">${escapeHtml(lesson.description || 'No lesson details available.')}</p>
        </div>
        ${lesson.premium ? '<span class="card-badge" style="background-color: rgba(220, 38, 38, 0.12); color: var(--color-accent);">Premium</span>' : ''}
      </div>
      ${videoHtml}
      <p style="font-size: 0.85rem; color: var(--text-muted); text-align: center; margin: -0.5rem 0 1rem 0;">
        Supporting MEBV ensures more free educational content. Please watch and learn through our platform.
      </p>

      <!-- Navigation Section -->
      <div style="display: flex; justify-content: space-between; align-items: center; padding: 1.5rem 0; border-top: 1px solid var(--border-color); border-bottom: 1px solid var(--border-color); margin: 1rem 0;">
        <button class="btn btn-outline" onclick="navigateToLesson(${lessonIndex - 1})" ${lessonIndex === 0 ? 'disabled' : ''}>
          &larr; Previous Lesson
        </button>
        <button class="btn btn-primary" onclick="navigateToLesson(${lessonIndex + 1})" ${lessonIndex === totalLessons - 1 ? 'disabled' : ''}>
          Next Lesson &rarr;
        </button>
      </div>

      <div class="academy-progress-wrapper">
        <div class="progress-info">
          <span>Overall Course Progress</span>
          <span id="lesson-detail-progress-percent">0% Completed</span>
        </div>
        <div class="progress-track">
          <div class="progress-fill" id="lesson-detail-progress-fill" style="width: 0%;"></div>
        </div>
      </div>

      <div>
        <h3 style="font-size: 1.1rem; margin-bottom: 0.75rem;">Lesson Content</h3>
        <p style="color: var(--text-secondary); line-height: 1.75;">${escapeHtml(lesson.content || 'The full lesson text will be shown here once available.')}</p>
      </div>
      <div style="display: flex; justify-content: flex-end; gap: 1rem; flex-wrap: wrap;">
        ${lesson.premium ? '<a class="btn btn-accent btn-sm" href="contact.html">Follow MEBV Updates</a>' : ''}
        <button type="button" class="btn btn-primary btn-sm" onclick="claimLessonCertificate()">Claim Certificate</button>
      </div>
    </div>
  `;
  
  updateProgressSummary(); // Refresh progress display
}

window.navigateToLesson = function(index) {
  if (index >= 0 && index < lessonsList.length) {
    selectLesson(lessonsList[index]);
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }
};

function extractYoutubeId(url) {
  if (!url) return null;
  const regExp = /^.*(youtu.be\/|v\/|u\/\w\/|embed\/|watch\?v=|&v=|shorts\/)([^#&?]*).*/;
  const match = url.match(regExp);
  return (match && match[2].length === 11) ? match[2] : null;
}

function showUpgradeModal() {
  const modal = document.createElement('div');
  modal.className = 'modal-overlay active';
  modal.innerHTML = `
    <div class="modal-box" style="max-width: 500px;">
      <button class="modal-close-btn" onclick="this.closest('.modal-overlay').remove()">&times;</button>
      <div class="modal-header">
        <h2 class="modal-title">Upgrade to Premium</h2>
      </div>
      <div class="modal-body">
        <p style="margin-bottom: 1.5rem;">You are out of the free plan. Upgrade to Premium to continue learning.</p>
        
        <div style="display: flex; flex-direction: column; gap: 0.75rem; margin-bottom: 1.5rem;">
          <div class="card" style="padding: 1rem; cursor: pointer; border: 1px solid var(--border-color);" onclick="selectPlan(this, 'Daily', 5000)">
            <strong>MK 5,000</strong> per day
          </div>
          <div class="card" style="padding: 1rem; cursor: pointer; border: 1px solid var(--border-color);" onclick="selectPlan(this, 'Weekly', 15000)">
            <strong>MK 15,000</strong> per week
          </div>
          <div class="card" style="padding: 1rem; cursor: pointer; border: 1px solid var(--border-color);" onclick="selectPlan(this, 'Monthly', 25000)">
            <strong>MK 25,000</strong> per month
          </div>
          <div class="card" style="padding: 1rem; cursor: pointer; border: 1px solid var(--border-color);" onclick="selectPlan(this, 'Yearly', 60000)">
            <strong>MK 60,000</strong> per year
          </div>
          <div class="card" style="padding: 1rem; cursor: pointer; border: 1px solid var(--border-color);" onclick="selectPlan(this, 'Full Course', 200000)">
            <strong>MK 200,000</strong> Full Course (includes Diploma)
          </div>
        </div>

        <div id="payment-methods" class="hidden">
          <h3 style="font-size: 1rem; margin-bottom: 0.75rem;">Payment Methods</h3>
          <p style="font-size: 0.9rem; margin-bottom: 1rem;">Send payment to any of the following accounts:</p>
          <ul style="font-size: 0.9rem; margin-bottom: 1.5rem; list-style: none; padding: 0;">
            <li style="margin-bottom: 0.5rem;"><strong>TNM Mpamba:</strong> +265897228943 (ABRAHAM MSOFI)</li>
            <li style="margin-bottom: 0.5rem;"><strong>Airtel Money:</strong> +265993984344 (ABRAHAM MSOFI)</li>
            <li style="margin-bottom: 0.5rem;"><strong>National Bank:</strong> 1011288266 (ABRAHAM MSOFI)</li>
          </ul>

          <form id="payment-proof-form">
            <input type="hidden" name="plan" id="selected-plan-input">
            <input type="hidden" name="amount" id="selected-amount-input">
            <div class="form-group">
              <label style="display: block; margin-bottom: 0.5rem; font-weight: 600;">Payment Screenshot</label>
              <input type="file" name="proof" accept="image/*" required class="form-control">
            </div>
            <button type="submit" class="btn btn-primary btn-block">Submit Proof of Payment</button>
          </form>
        </div>
      </div>
    </div>
  `;
  document.body.appendChild(modal);

  const form = modal.querySelector('#payment-proof-form');
  form.addEventListener('submit', handlePaymentSubmit);
}

window.selectPlan = (el, plan, amount) => {
  document.querySelectorAll('.card').forEach(c => c.style.borderColor = 'var(--border-color)');
  el.style.borderColor = 'var(--color-primary)';
  document.getElementById('selected-plan-input').value = plan;
  document.getElementById('selected-amount-input').value = amount;
  document.getElementById('payment-methods').classList.remove('hidden');
};

async function handlePaymentSubmit(e) {
  e.preventDefault();
  const form = e.target;
  const plan = form.plan.value;
  const amount = form.amount.value;
  const proofFile = form.proof.files[0];

  if (!proofFile) {
    window.showError("Please upload payment screenshot.");
    return;
  }

  window.showLoading("Submitting payment proof...");
  try {
    const { data: { session } } = await window.supabaseClient.auth.getSession();
    const user = session.user;

    // In a real app, you'd upload the file to Supabase Storage here
    // For now we'll use a placeholder URL as per instructions to implement logic
    const proofUrl = "proof_placeholder_url"; 

    const { error } = await window.supabaseClient
      .from("payments")
      .insert({
        user_id: user.id,
        amount: amount,
        payment_method: "Mobile Money / Bank",
        description: plan,
        reference: `PAY-${Date.now()}`,
        status: "pending",
        proof_file_path: proofUrl
      });

    if (error) throw error;

    window.showSuccess("Proof submitted! If approval takes longer than 24 hours, please contact us.");
    form.closest('.modal-overlay').remove();
    
    // Add Contact Us button to the success message or page
    const contactBtn = document.createElement('button');
    contactBtn.className = 'btn btn-outline';
    contactBtn.textContent = 'Contact Us';
    contactBtn.onclick = () => window.location.href = 'contact.html';
    document.querySelector('.toast-content')?.appendChild(contactBtn);

  } catch (error) {
    window.showError("Failed to submit payment proof.");
  } finally {
    window.hideLoading();
  }
}

async function fetchLessonQuiz(lessonId) {
  if (!window.supabaseClient || !lessonId) return [];

  try {
    const { data, error } = await window.supabaseClient
      .from("lesson_quizzes")
      .select("*")
      .eq("lesson_id", lessonId)
      .order("position", { ascending: true });
    if (error) throw error;
    return data || [];
  } catch (error) {
    console.warn("Unable to fetch lesson quiz:", error);
    return [];
  }
}

function renderLessonQuiz(quizItems) {
  const detailWrapper = document.getElementById("lesson-detail");
  if (!detailWrapper) return;

  const quizSection = document.createElement("div");
  quizSection.className = "quiz-container";
  if (!quizItems || quizItems.length === 0) {
    quizSection.innerHTML = `<p style="color: var(--text-muted);">This lesson does not have a quiz yet.</p>`;
  } else {
    quizSection.innerHTML = `
      <h3 style="margin-top: 0;">Lesson Quiz</h3>
      <form id="lesson-quiz-form"></form>
    `;
  }

  const existingQuiz = detailWrapper.querySelector(".quiz-container");
  if (existingQuiz) existingQuiz.remove();
  detailWrapper.appendChild(quizSection);

  if (quizItems && quizItems.length > 0) {
    const form = quizSection.querySelector("#lesson-quiz-form");
    quizItems.forEach((item, index) => {
      const question = document.createElement("div");
      question.className = "form-group";
      question.innerHTML = `
        <p class="quiz-question">${escapeHtml(item.question)}</p>
      `;
      const options = item.options || [];
      options.forEach((option, idx) => {
        const label = document.createElement("label");
        label.className = "quiz-option";
        label.innerHTML = `
          <input type="radio" name="quiz-${index}" value="${escapeHtml(option)}" style="display:none;">
          <span>${escapeHtml(option)}</span>
        `;
        label.addEventListener("click", () => {
          const all = form.querySelectorAll(`input[name='quiz-${index}']`);
          all.forEach((radio) => radio.checked = false);
          label.querySelector("input").checked = true;
          label.classList.add("selected");
          Array.from(label.parentElement.children).forEach((sibling) => {
            if (sibling !== label) sibling.classList.remove("selected");
          });
        });
        question.appendChild(label);
      });
      form.appendChild(question);
    });
    const submitButton = document.createElement("button");
    submitButton.type = "submit";
    submitButton.className = "btn btn-secondary";
    submitButton.textContent = "Submit Quiz";
    form.appendChild(submitButton);
    form.addEventListener("submit", handleQuizSubmission);
  }
}

async function handleQuizSubmission(event) {
  event.preventDefault();
  if (!selectedLesson || lessonQuizItems.length === 0) return;

  const form = event.target;
  const answers = lessonQuizItems.map((item, index) => ({
    selected: form.querySelector(`input[name='quiz-${index}']:checked`)?.value,
    correct: item.correct_answer
  }));
  const scored = answers.filter((item) => item.selected && item.selected === item.correct).length;

  if (scored === answers.length) {
    await markLessonComplete(selectedLesson.id);
    window.showSuccess("Excellent! You completed this lesson quiz.");
    updateProgressSummary();
    renderLessonDetails(selectedLesson);
  } else {
    window.showError("Some answers were incorrect. Try again to complete the lesson.");
  }
}

async function loadUserProgress() {
  if (!window.supabaseClient) return;

  try {
    const { data, error } = await window.supabaseClient
      .from("user_progress")
      .select("lesson_id, completed")
      .eq("category", "python");
    if (error) throw error;
    userProgress = data || [];
  } catch (error) {
    console.warn("Unable to load lesson progress:", error);
    const raw = JSON.parse(localStorage.getItem("mebv_python_progress") || "[]");
    userProgress = raw.map((lessonId) => ({ lesson_id: lessonId, completed: true }));
  }
}

function isLessonCompleted(lessonId) {
  return userProgress.some((progress) => progress.lesson_id === lessonId && progress.completed);
}

async function markLessonComplete(lessonId) {
  if (!lessonId) return;

  if (window.supabaseClient) {
    try {
      const { data: { session } } = await window.supabaseClient.auth.getSession();
      const userId = session?.user?.id;
      if (userId) {
        const { error } = await window.supabaseClient
          .from("user_progress")
          .upsert({ user_id: userId, lesson_id: lessonId, completed: true, category: "python", updated_at: new Date().toISOString() }, { onConflict: ["user_id", "lesson_id"] });
        if (error) throw error;
      }
    } catch (error) {
      console.warn("Unable to persist lesson completion:", error);
    }
  }

  if (!isLessonCompleted(lessonId)) {
    userProgress.push({ lesson_id: lessonId, completed: true });
    localStorage.setItem("mebv_python_progress", JSON.stringify(userProgress.map((entry) => entry.lesson_id)));
  }
}

function updateProgressSummary() {
  const total = lessonsList.length;
  const completed = userProgress.filter((item) => item.completed).length;
  const percent = total ? Math.round((completed / total) * 100) : 0;
  
  // Update sidebar/global progress if elements exist
  const globalPercent = document.getElementById("academy-progress-percent");
  const globalBar = document.getElementById("academy-progress-bar");
  if (globalPercent) globalPercent.textContent = `${percent}% Completed`;
  if (globalBar) globalBar.style.width = `${percent}%`;

  // Update lesson detail progress if elements exist
  const detailPercent = document.getElementById("lesson-detail-progress-percent");
  const detailBar = document.getElementById("lesson-detail-progress-fill");
  if (detailPercent) detailPercent.textContent = `${percent}% Completed`;
  if (detailBar) detailBar.style.width = `${percent}%`;

  // Persist percent to user_progress in Supabase if needed
  // (Optional: markLessonComplete already does upsert, but we can log overall here)
}

function checkCertificateParameter() {
  const params = new URLSearchParams(window.location.search);
  if (params.get("action") === "certificate") {
    const certificateSection = document.createElement("div");
    certificateSection.className = "certificate-preview";
    certificateSection.innerHTML = `
      <h2 class="certificate-title">Python Academy Certificate</h2>
      <p>Certificate of completion awarded for mastering the Python Academy curriculum.</p>
      <p style="margin-top: 1rem; color: var(--text-secondary);">Congratulations on your effort. Keep learning and share your achievement with future employers.</p>
    `;
    document.body.insertBefore(certificateSection, document.querySelector("footer"));
  }
}

function claimLessonCertificate() {
  const percentText = document.getElementById("academy-progress-percent").textContent || "0%";
  const percent = Number(percentText.replace(/[^0-9]/g, ""));
  if (percent >= 100) {
    window.showSuccess("Certificate is ready. Scroll down to view it.");
    if (!document.querySelector(".certificate-preview")) {
      checkCertificateParameter();
    }
    window.location.hash = "#";
  } else {
    window.showError("Complete all lessons before claiming the certificate.");
  }
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
