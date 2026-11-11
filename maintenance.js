(function () {
  // Africa/Blantyre is UTC+02:00 and does not observe daylight saving time.
  const DEADLINE = Date.parse("2026-12-08T00:00:00+02:00");

  if (Date.now() >= DEADLINE) return;

  const root = document.documentElement;
  root.classList.add("maintenance-active");

  function showMaintenanceScreen() {
    if (Date.now() >= DEADLINE) {
      root.classList.remove("maintenance-active");
      return;
    }

    const overlay = document.createElement("section");
    overlay.className = "maintenance-overlay";
    overlay.setAttribute("role", "dialog");
    overlay.setAttribute("aria-modal", "true");
    overlay.setAttribute("aria-labelledby", "maintenance-title");
    overlay.innerHTML = `
      <div class="maintenance-content">
        <div class="maintenance-brand">
          <img src="LOGO.png" alt="" class="maintenance-logo">
          <span>MALAWI EDUCATION BOOKS &amp; VACANCIES</span>
        </div>
        <div class="maintenance-card">
          <div class="maintenance-status"><span></span> TEMPORARILY UNAVAILABLE</div>
          <h1 id="maintenance-title">MEBV IS UNDER MAINTENANCE</h1>
          <p class="maintenance-message">
            We’re making improvements to the platform. MEBV is temporarily undergoing
            maintenance and will be back as soon as the maintenance period is over.
            Thank you for your patience.
          </p>
          <div class="maintenance-countdown" aria-label="Time remaining until maintenance ends" aria-live="off">
            <div class="maintenance-time-unit"><span data-maintenance-unit="days">00</span><small>DAYS</small></div>
            <span class="maintenance-separator">:</span>
            <div class="maintenance-time-unit"><span data-maintenance-unit="hours">00</span><small>HOURS</small></div>
            <span class="maintenance-separator">:</span>
            <div class="maintenance-time-unit"><span data-maintenance-unit="minutes">00</span><small>MINUTES</small></div>
            <span class="maintenance-separator">:</span>
            <div class="maintenance-time-unit"><span data-maintenance-unit="seconds">00</span><small>SECONDS</small></div>
            <span class="maintenance-separator">:</span>
            <div class="maintenance-time-unit maintenance-milliseconds"><span data-maintenance-unit="milliseconds">000</span><small>MILLISECONDS</small></div>
          </div>
          <div class="maintenance-return">
            <span class="maintenance-return-icon" aria-hidden="true">↻</span>
            <span>We expect to be back by <strong>8 December 2026</strong> <span class="maintenance-timezone">(Malawi time)</span></span>
          </div>
          <div class="maintenance-groups">
            <h2>JOIN OUR WHATSAPP GROUPS</h2>
            <p>Stay connected and keep up with the latest updates.</p>
            <div class="maintenance-group-buttons">
              <a href="https://chat.whatsapp.com/CrPPBABXjKg5Yech9Kjtax?s=cl&amp;p=a&amp;iam=2" target="_blank" rel="noopener noreferrer">JOIN GROUP 1 <span aria-hidden="true">↗</span></a>
              <a href="https://chat.whatsapp.com/HlCcuSKAjtaF07zzbTSUVy?s=cl&amp;p=a&amp;iam=2" target="_blank" rel="noopener noreferrer">JOIN GROUP 2 <span aria-hidden="true">↗</span></a>
              <a href="https://chat.whatsapp.com/JNwphsqH4mOEMyr0U9dXo6?s=cl&amp;p=a&amp;iam=2" target="_blank" rel="noopener noreferrer">JOIN GROUP 3 <span aria-hidden="true">↗</span></a>
            </div>
          </div>
        </div>
        <p class="maintenance-footer">Thank you for being part of the MEBV community.</p>
      </div>
    `;

    const inertSiblings = Array.from(document.body.children).filter(function (child) {
      return !child.inert;
    });
    inertSiblings.forEach(function (child) {
      child.inert = true;
    });
    document.body.appendChild(overlay);

    let animationFrame;
    let deadlineTimer;

    function restoreWebsite() {
      root.classList.remove("maintenance-active");
      overlay.remove();
      inertSiblings.forEach(function (child) {
        child.inert = false;
      });
      cancelAnimationFrame(animationFrame);
      clearTimeout(deadlineTimer);
    }

    function updateCountdown() {
      const currentTime = Date.now();
      const remaining = Math.max(0, DEADLINE - currentTime);
      if (remaining <= 0) {
        restoreWebsite();
        return;
      }

      const units = {
        days: Math.floor(remaining / 86400000),
        hours: Math.floor((remaining % 86400000) / 3600000),
        minutes: Math.floor((remaining % 3600000) / 60000),
        seconds: Math.floor((remaining % 60000) / 1000)
      };
      units.milliseconds = remaining % 1000;

      Object.keys(units).forEach(function (unit) {
        const digits = unit === "milliseconds" ? 3 : 2;
        const value = String(units[unit]).padStart(digits, "0");
        overlay.querySelector('[data-maintenance-unit="' + unit + '"]').textContent = value;
      });

      animationFrame = requestAnimationFrame(updateCountdown);
    }

    function checkDeadline() {
      const remaining = DEADLINE - Date.now();
      if (remaining <= 0) {
        restoreWebsite();
      } else {
        deadlineTimer = setTimeout(checkDeadline, Math.min(remaining, 2147483647));
      }
    }

    updateCountdown();
    checkDeadline();
  }

  document.addEventListener("DOMContentLoaded", showMaintenanceScreen, { once: true });
})();
