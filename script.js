/* HabitFlow | Daily Habit Tracker
 * College Project: Front-End Development Using JavaScript
 * Pure Vanilla JavaScript (No Frameworks, No Backend, No External Libraries)
 */
import { logoutUser } from "./auth.js";
import { checkSession, clearUserHabits, loadHabits as loadStoredHabits, saveHabits as saveStoredHabits } from "./sqlite-client.js";

(() => {
  "use strict";

  // Storage Keys
  const THEME_KEY = "habitflow-theme-v1";
  const NOTIFICATION_SENT_KEY = "habitflow-notifications-v1";
  const LOCAL_HABITS_KEY = "habitflow-habits-v1";
  const DISPLAY_NAME_KEY = "habitflow-display-name";
  const REPORTS_KEY = "habitflow-reports-v1";
  const REPORT_RETENTION_DAYS = 14;
  const DAY_LABELS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

  // Shorthand DOM query selectors
  const $ = (selector) => document.querySelector(selector);
  const $$ = (selector) => document.querySelectorAll(selector);
  const localHabitsKey = () => `${LOCAL_HABITS_KEY}:${currentUser?.id || "guest"}`;

  // --- Date Utilities ---
  // Returns 'YYYY-MM-DD' in local time
  const todayKey = (date = new Date()) => {
    const y = date.getFullYear();
    const m = String(date.getMonth() + 1).padStart(2, "0");
    const d = String(date.getDate()).padStart(2, "0");
    return `${y}-${m}-${d}`;
  };

  // Parses 'YYYY-MM-DD' into a Date set at 12:00:00 (midday) to prevent daylight-saving shifts
  const dateFromKey = (key) => {
    const [y, m, d] = key.split("-").map(Number);
    return new Date(y, m - 1, d, 12, 0, 0);
  };

  // Shifts a date by a given number of days at midday
  const shiftDate = (date, amount) => {
    const copy = new Date(date.getFullYear(), date.getMonth(), date.getDate() + amount, 12, 0, 0);
    return copy;
  };

  const INDIA_TIME_ZONE = "Asia/Kolkata";
  const indiaFormatter = new Intl.DateTimeFormat("en-IN", {
    timeZone: INDIA_TIME_ZONE,
    weekday: "short",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23"
  });

  function indiaNowParts(date = new Date()) {
    const parts = Object.fromEntries(indiaFormatter.formatToParts(date)
      .filter(part => part.type !== "literal")
      .map(part => [part.type, part.value]));
    return {
      year: Number(parts.year), month: Number(parts.month), day: Number(parts.day),
      hour: Number(parts.hour), minute: Number(parts.minute), weekday: parts.weekday,
      key: `${parts.year}-${parts.month}-${parts.day}`
    };
  }

  function indiaCandidateTimestamp(date, reminderTime) {
    const [hour, minute] = reminderTime.split(":").map(Number);
    return Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate(), hour, minute) - (5 * 60 + 30) * 60000;
  }

  // Unique ID generator compatible with file:// protocol and secure contexts
  const makeId = () => {
    try {
      if (window.crypto && typeof crypto.randomUUID === "function") {
        return crypto.randomUUID();
      }
    } catch (_) {}
    const random = Array.from({ length: 32 }, () => Math.floor(Math.random() * 16).toString(16)).join("");
    return `${random.slice(0, 8)}-${random.slice(8, 12)}-4${random.slice(13, 16)}-${(8 + Math.floor(Math.random() * 4)).toString(16)}${random.slice(17, 20)}-${random.slice(20, 32)}`;
  };

  // Inspirational quotes
  const quotes = [
    "Progress, not perfection.",
    "A better you, one habit at a time.",
    "Discipline today, a brighter tomorrow.",
    "Small steps every day lead to big changes.",
    "Consistency is what transforms average into excellence.",
    "Your future is created by what you do today."
  ];

  function completedDatesFor(habit) {
    const dates = Array.isArray(habit.completedDates) ? habit.completedDates : [];
    const legacyDates = Object.keys(habit.history || {}).filter(key => habit.history[key] === true);
    return [...new Set([...dates, ...legacyDates])].sort();
  }

  function skippedDatesFor(habit) {
    return [...new Set(Array.isArray(habit.skippedDates) ? habit.skippedDates : [])].sort();
  }

  // --- State Loading & Persistence ---
  async function loadHabits() {
    try {
      if (!currentUser) {
        window.location.href = "auth.html";
        return [];
      }
      const storedHabits = await loadStoredHabits(currentUser.id);
      const mirroredHabits = await HabitFlowDB.getAll(currentUser.id);
      const mirroredById = new Map(mirroredHabits.map(record => [record.id, record]));
      const mergedHabits = storedHabits.map(habit => {
        const mirrored = mirroredById.get(habit.id);
        const merged = mirrored && Number(mirrored.updatedAt) > 0
          ? { ...habit, ...mirrored }
          : habit;
        const today = todayKey();
        return {
          ...merged,
          status: wasCompleted(merged, today)
            ? "completed"
            : skippedDatesFor(merged).includes(today) ? "skipped" : "pending"
        };
      });
      try {
        localStorage.setItem(localHabitsKey(), JSON.stringify(mergedHabits));
      } catch (_) {}
      return mergedHabits;
    } catch (error) {
      console.error("Could not load habits from SQLite:", error);
      showToast("Could not load your habits.");
      return [];
    }
  }

  // Application State
  let habits = [];
  let currentUser = null;
  let currentFilter = "all";
  let selectedIcon = "🏃";
  let editingHabitId = null;
  let toastTimer = null;
  let reminderTimer = null;
  const reminderTimeouts = new Map();
  const remindersInFlight = new Set();

  // Save current habits and completion state to SQLite
  async function saveHabits() {
    try {
      if (!currentUser) throw new Error("No authenticated user");
      habits.forEach(habit => {
        habit.completedDates = completedDatesFor(habit);
        habit.skippedDates = skippedDatesFor(habit);
        habit.history = Object.fromEntries(habit.completedDates.map(date => [date, true]));
        habit.streak = getStreak(habit);
        habit.longestStreak = getLongestStreak(habit);
        habit.lastCompletedDate = habit.completedDates.at(-1) || null;
        habit.updatedAt = habit.updatedAt || Date.now();
      });
      await saveStoredHabits(currentUser.id, habits);
      const mirrored = await HabitFlowDB.getAll(currentUser.id);
      const activeIds = new Set(habits.map(habit => String(habit.id)));
      await Promise.all(mirrored
        .filter(record => !activeIds.has(String(record.id)))
        .map(record => HabitFlowDB.remove(currentUser.id, record.id)));
      await HabitFlowDB.putAll(currentUser.id, habits);
      try {
        localStorage.setItem(localHabitsKey(), JSON.stringify(habits));
      } catch (_) {}
    } catch (error) {
      console.error("Failed to save habits to SQLite:", error);
      showToast("Your change could not be saved.");
    }
  }

  // --- Core Business Logic ---
  // Check if habit was completed on a given date key
  function wasCompleted(habit, key = todayKey()) {
    return completedDatesFor(habit).includes(key);
  }

  function isScheduledOnDate(habit, date) {
    const selectedDays = Array.isArray(habit.selectedDays) ? habit.selectedDays : [];
    return selectedDays.length === 0 || selectedDays.includes(DAY_LABELS[date.getDay()]);
  }

  function isScheduledOnKey(habit, key) {
    return isScheduledOnDate(habit, dateFromKey(key));
  }

  function previousScheduledKey(habit, key) {
    let date = shiftDate(dateFromKey(key), -1);
    while (!isScheduledOnDate(habit, date)) date = shiftDate(date, -1);
    return todayKey(date);
  }

  // Calculate a streak using only scheduled days. A scheduled day that is
  // missed breaks the run; non-scheduled days are ignored.
  function getStreak(habit, referenceDate = new Date()) {
    let cursor = todayKey(referenceDate);
    if (!isScheduledOnKey(habit, cursor) || !wasCompleted(habit, cursor)) {
      cursor = previousScheduledKey(habit, cursor);
    }
    if (!wasCompleted(habit, cursor)) return 0;
    let streak = 0;
    while (wasCompleted(habit, cursor)) {
      streak++;
      cursor = previousScheduledKey(habit, cursor);
    }
    return streak;
  }

  function getLongestStreak(habit) {
    const dates = completedDatesFor(habit)
      .filter(key => key <= todayKey())
      .sort();

    if (dates.length === 0) return 0;

    let best = 0;
    let currentRun = 0;
    let cursor = dateFromKey(dates[0]);
    const lastDate = dateFromKey(dates[dates.length - 1]);
    while (cursor <= lastDate) {
      const key = todayKey(cursor);
      if (isScheduledOnDate(habit, cursor)) {
        if (wasCompleted(habit, key)) currentRun++;
        else currentRun = 0;
        best = Math.max(best, currentRun);
      }
      cursor = shiftDate(cursor, 1);
    }
    return best;
  }

  // Compute stats for a specific day key
  function dailyStats(key = todayKey()) {
    // A habit is considered part of the routine if created on/before key,
    // or if it has an entry on that key, or if it's currently active
    const eligible = habits.filter(h =>
      h.isActive !== false &&
      (!h.createdAt || String(h.createdAt).slice(0, 10) <= key) &&
      isScheduledOnKey(h, key)
    );
    const list = eligible;
    const done = list.filter(h => wasCompleted(h, key)).length;
    const total = list.length;
    const percent = total > 0 ? Math.round((done / total) * 100) : 0;
    return { total, done, percent };
  }

  // String escaping helper to prevent XSS
  function escapeHtml(value) {
    return String(value ?? "").replace(/[&<>"']/g, ch => ({
      "&": "&amp;",
      "<": "&lt;",
      ">": "&gt;",
      '"': "&quot;",
      "'": "&#39;"
    })[ch]);
  }

  // --- UI Rendering ---

  // Update header labels, date, and greeting
  function renderHeader() {
    const now = new Date();
    const dateFormatted = new Intl.DateTimeFormat(undefined, {
      weekday: "long",
      month: "long",
      day: "numeric",
      year: "numeric"
    }).format(now);

    const shortDate = new Intl.DateTimeFormat(undefined, {
      weekday: "short",
      day: "numeric",
      month: "short"
    }).format(now);

    const hour = now.getHours();
    let timeGreeting = "Good day";
    if (hour >= 5 && hour < 12) timeGreeting = "Good Morning";
    else if (hour >= 12 && hour < 17) timeGreeting = "Good Afternoon";
    else timeGreeting = "Good Evening";

    let savedDisplayName = "";
    try { savedDisplayName = localStorage.getItem(`${DISPLAY_NAME_KEY}:${currentUser?.id}`) || ""; } catch (_) {}
    const displayName = savedDisplayName || currentUser?.profile?.full_name || currentUser?.user_metadata?.full_name || currentUser?.profile?.username || "there";
    const greetingHeading = $("#greetingHeading");
    if (greetingHeading) {
      greetingHeading.innerHTML = `${timeGreeting}, <span>${escapeHtml(displayName)}!</span>`;
    }
    const username = currentUser?.profile?.username || currentUser?.user_metadata?.username || "";
    const sidebarName = $("#sidebarUserName");
    const sidebarTagline = $("#sidebarUserTagline");
    const initials = String(displayName).trim().split(/\s+/).map(part => part[0]).join("").slice(0, 2).toUpperCase();
    if (sidebarName) sidebarName.textContent = username ? `@${username}` : displayName;
    if (sidebarTagline) sidebarTagline.textContent = username ? displayName : "Personal dashboard";
    ["#sidebarAvatarInitials", "#topbarAvatarInitials"].forEach(selector => {
      const avatar = $(selector);
      if (avatar) avatar.textContent = initials || "HF";
    });
    const settingsAvatar = $("#settingsAvatarInitials");
    const settingsName = $("#settingsDisplayName");
    const settingsUsername = $("#settingsUsername");
    const settingsInput = $("#settingsNameInput");
    if (settingsAvatar) settingsAvatar.textContent = initials || "HF";
    if (settingsName) settingsName.textContent = displayName;
    if (settingsUsername) settingsUsername.textContent = username ? `@${username}` : "Signed in locally";
    if (settingsInput && document.activeElement !== settingsInput) settingsInput.value = displayName === "there" ? "" : displayName;

    const dateLabel = $("#dateLabel");
    if (dateLabel) dateLabel.textContent = dateFormatted.toUpperCase();

    const datePillText = $("#datePillText");
    if (datePillText) datePillText.textContent = shortDate;

    // Daily quote
    const quoteEl = $("#dailyQuote");
    if (quoteEl) {
      const dayIndex = now.getDate() % quotes.length;
      quoteEl.textContent = quotes[dayIndex];
    }
  }

  // Render top metrics and summary cards
  function renderSummary() {
    const stats = dailyStats();
    const percent = stats.percent;

    // Daily Progress text
    $("#progressPercent").textContent = `${percent}%`;
    $("#completedCount").textContent = `${stats.done} of ${stats.total} habits completed`;
    $("#progressBar").style.width = `${percent}%`;

    // SVG Circular Progress Ring (circumference = 2 * PI * 35 ≈ 220)
    const ringFill = $("#progressRingFill");
    const ringText = $("#ringPercentText");
    if (ringFill && ringText) {
      const circumference = 220;
      const offset = circumference - (circumference * percent) / 100;
      ringFill.style.strokeDashoffset = offset;
      ringText.textContent = `${percent}%`;
    }

    // Dynamic encouraging caption
    let caption = "Let's get started";
    let badgeText = "Active";
    if (stats.total === 0) {
      caption = "Add your first habit";
      badgeText = "No habits";
    } else if (percent === 100) {
      caption = "All done! Amazing work! 🎉";
      badgeText = "Complete";
    } else if (percent >= 75) {
      caption = "Almost there, finish strong! 💪";
      badgeText = "75% Done";
    } else if (percent >= 50) {
      caption = "Over halfway through! 🚀";
      badgeText = "Halfway";
    } else if (stats.done > 0) {
      caption = "Keep the momentum going!";
      badgeText = "In Progress";
    }

    $("#progressCaption").textContent = caption;
    $("#progressStatusBadge").textContent = badgeText;

    // Streaks
    const currentStreaks = habits.map(h => getStreak(h));
    const bestStreakValue = currentStreaks.length ? Math.max(...currentStreaks) : 0;
    $("#bestStreak").textContent = bestStreakValue;

    // Highlight which habit holds the best streak
    const bestHabit = habits.find(h => getStreak(h) === bestStreakValue && bestStreakValue > 0);
    const bestHabitLabel = $("#bestStreakHabitName");
    if (bestHabitLabel) {
      bestHabitLabel.textContent = bestHabit
        ? `Best streak: ${bestHabit.name}`
        : "Best active habit streak";
    }

    const longestStreaks = habits.map(h => getLongestStreak(h));
    const longestStreakValue = longestStreaks.length ? Math.max(...longestStreaks) : 0;
    $("#longestStreak").textContent = longestStreakValue;
    const cardLongestStreak = $("#cardLongestStreak");
    if (cardLongestStreak) cardLongestStreak.textContent = longestStreakValue;

    // Quick Stats & Consistency
    $("#totalHabitsStat").textContent = habits.filter(h => h.isActive !== false).length;
    $("#completedTodayStat").textContent = stats.done;
    $("#successRateStat").textContent = `${percent}%`;

    // Total check-ins (all-time completions sum)
    let totalCompletions = 0;
    habits.forEach(h => {
      totalCompletions += completedDatesFor(h).length;
    });
    $("#totalCompletions").textContent = totalCompletions;

    // Perfect days count (days where 100% of habits were completed)
    const uniqueDates = new Set();
    habits.forEach(h => {
      completedDatesFor(h).forEach(key => uniqueDates.add(key));
    });

    let perfectDaysCount = 0;
    for (const key of uniqueDates) {
      const dStat = dailyStats(key);
      if (dStat.total > 0 && dStat.done === dStat.total) {
        perfectDaysCount++;
      }
    }
    $("#perfectDays").textContent = perfectDaysCount;
    const breakdown = $("#habitStreakBreakdown");
    if (breakdown) {
      breakdown.innerHTML = habits.length
        ? habits.map(habit => `<div class="habit-streak-row"><span>${escapeHtml(habit.name)}</span><strong>${getLongestStreak(habit)} days</strong></div>`).join("")
        : `<p class="metric-note">Add habits to see personal bests.</p>`;
    }
  }

  // Render habit items in the main routine panel
  function renderHabits() {
    const list = $("#habitList");
    const empty = $("#emptyState");
    const totalCount = habits.length;
    const completedCount = habits.filter(h => wasCompleted(h)).length;
    const skippedCount = habits.filter(h => !wasCompleted(h) && h.status === "skipped").length;
    const pendingCount = totalCount - completedCount - skippedCount;

    // Update filter count badges
    $("#habitBadge").textContent = totalCount;
    $("#allFilterCount").textContent = totalCount;
    $("#pendingFilterCount").textContent = pendingCount;
    $("#completedFilterCount").textContent = completedCount;
    $("#skippedFilterCount").textContent = skippedCount;

    // Filter visible habits
    const visible = habits.filter(h => {
      const done = wasCompleted(h);
      if (currentFilter === "pending") return !done && h.status !== "skipped";
      if (currentFilter === "completed") return done;
      if (currentFilter === "skipped") return !done && h.status === "skipped";
      return true;
    });

    if (visible.length === 0) {
      list.innerHTML = "";
      empty.hidden = false;
      const heading = $("#emptyHeading");
      const paragraph = $("#emptyParagraph");
      const actionBtn = $("#emptyActionBtn");

      if (totalCount === 0) {
        heading.textContent = "Your routine starts here";
        paragraph.textContent = "Add a habit you want to build, then check it off as you complete it each day.";
        actionBtn.textContent = "＋ Create your first habit";
        actionBtn.onclick = () => openDialog();
      } else if (currentFilter === "completed") {
        heading.textContent = "No completed habits yet";
        paragraph.textContent = "Check off habits from your to-do list and they will appear here.";
        actionBtn.textContent = "Show all habits";
        actionBtn.onclick = () => setFilter("all");
      } else if (currentFilter === "pending") {
        heading.textContent = "All caught up for today! 🎉";
        paragraph.textContent = "You have completed every habit in your routine today. Fantastic consistency!";
        actionBtn.textContent = "View all habits";
        actionBtn.onclick = () => setFilter("all");
      } else if (currentFilter === "skipped") {
        heading.textContent = "No skipped habits today";
        paragraph.textContent = "Skipped reminders will appear here without extending your streak.";
        actionBtn.textContent = "Show all habits";
        actionBtn.onclick = () => setFilter("all");
      }
    } else {
      empty.hidden = true;
      list.innerHTML = visible.map(habit => {
        const done = wasCompleted(habit);
        const skipped = !done && habit.status === "skipped";
        const streak = getStreak(habit);
        const targetText = habit.target ? escapeHtml(habit.target) : "";
        const categoryText = escapeHtml(habit.category || "Personal growth");
        const scheduleText = habit.selectedDays?.length ? ` · ${escapeHtml(habit.selectedDays.join(", "))}` : "";
        const reminderText = habit.reminderTime ? ` · 🕒 ${escapeHtml(habit.reminderTime)}` : "";

        return `
          <article class="habit-item ${done ? "is-complete" : ""}" data-habit-id="${escapeHtml(habit.id)}">
            <div class="habit-emoji" aria-hidden="true">${escapeHtml(habit.icon || "📚")}</div>
            <div class="habit-copy">
              <h3>${escapeHtml(habit.name)}</h3>
              ${targetText ? `<span class="habit-desc">${targetText}</span>` : ""}
              <div class="habit-meta">
                <span class="habit-category-badge">${categoryText}</span>
                <span class="habit-status-pill">${scheduleText}${reminderText}</span>
                <span class="habit-streak-badge">🔥 ${streak} day${streak === 1 ? "" : "s"}</span>
                <span class="habit-status-pill">· ${done ? "Completed today ✓" : skipped ? "Skipped today" : "Pending today"}</span>
              </div>
            </div>
            <div class="habit-actions">
              <button 
                class="complete-button" 
                data-action="toggle" 
                aria-label="${done ? "Mark incomplete" : "Mark complete"}: ${escapeHtml(habit.name)}" 
                aria-pressed="${done}"
                title="${done ? "Mark incomplete" : "Mark complete"}"
              >${done ? "✓" : ""}</button>
              <button 
                class="action-icon-button edit-action" 
                data-action="edit" 
                aria-label="Edit ${escapeHtml(habit.name)}" 
                title="Edit habit"
              >✎</button>
              <button 
                class="action-icon-button delete-action" 
                data-action="delete" 
                aria-label="Delete ${escapeHtml(habit.name)}" 
                title="Delete habit"
              >×</button>
            </div>
          </article>
        `;
      }).join("");
    }

    // Panel bottom remaining text
    const remainingTextEl = $("#remainingText");
    if (remainingTextEl) {
      if (totalCount === 0) {
        remainingTextEl.textContent = "No habits created yet";
      } else if (pendingCount === 0) {
        remainingTextEl.textContent = "All done! Great work!";
      } else {
        remainingTextEl.textContent = `${pendingCount} habit${pendingCount === 1 ? "" : "s"} left today`;
      }
    }
  }

  // Render seven-day completion chart
  function renderWeeklyChart() {
    const chart = $("#weeklyChart");
    if (!chart) return;

    const today = new Date();
    const days = [];

    // Past 6 days + today = 7 days
    for (let offset = -6; offset <= 0; offset++) {
      const d = shiftDate(today, offset);
      const key = todayKey(d);
      const stat = dailyStats(key);
      const isToday = offset === 0;
      days.push({
        date: d,
        key,
        isToday,
        percent: stat.percent,
        done: stat.done,
        total: stat.total
      });
    }

    chart.innerHTML = days.map(day => {
      const dayName = new Intl.DateTimeFormat(undefined, { weekday: "short" }).format(day.date);
      const dateNum = new Intl.DateTimeFormat(undefined, { day: "numeric", month: "short" }).format(day.date);
      const hasHabits = day.total > 0;
      const barHeight = hasHabits ? Math.max(day.percent, 6) : 6;
      const tooltip = `${dayName}, ${dateNum}: ${day.done}/${day.total} completed (${day.percent}%)`;

      return `
        <div class="chart-day ${day.isToday ? "today" : ""}" tabindex="0" aria-label="${escapeHtml(tooltip)}">
          <div class="chart-tooltip">${escapeHtml(tooltip)}</div>
          <span class="chart-value">${hasHabits ? `${day.percent}%` : "0%"}</span>
          <div class="chart-bar-wrap">
            <div 
              class="chart-bar ${day.percent > 0 ? "has-value" : ""}" 
              style="height: ${barHeight}%;"
            ></div>
          </div>
          <span class="chart-day-label">${escapeHtml(dayName)}</span>
          <span class="chart-date-sub">${escapeHtml(dateNum.split(" ")[0])}</span>
        </div>
      `;
    }).join("");

    // Calculate 7-day average
    const daysWithData = days.filter(d => d.total > 0);
    const average = daysWithData.length
      ? Math.round(daysWithData.reduce((sum, d) => sum + d.percent, 0) / daysWithData.length)
      : 0;
    $("#weeklyAverage").textContent = `${average}% avg.`;
  }

  // Full dashboard re-render
  function render() {
    renderHeader();
    renderSummary();
    renderHabits();
    renderWeeklyChart();
  }

  // Set active habit filter
  function setFilter(filter) {
    currentFilter = filter;
    $$(".filter-chip").forEach(chip => {
      const isActive = chip.dataset.filter === filter;
      chip.classList.toggle("active", isActive);
      chip.setAttribute("aria-selected", isActive);
    });
    renderHabits();
  }

  // Toast notification
  function showToast(message) {
    const toast = $("#toast");
    if (!toast) return;
    toast.textContent = message;
    toast.classList.add("show");
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => {
      toast.classList.remove("show");
    }, 2400);
  }

  function getNotificationState() {
    try {
      const key = `${NOTIFICATION_SENT_KEY}:${currentUser?.id || "guest"}`;
      return JSON.parse(localStorage.getItem(key) || "{}");
    } catch (_) {
      return {};
    }
  }

  function rememberNotification(key) {
    try {
      const state = getNotificationState();
      state[key] = Date.now();
      const cutoff = Date.now() - 7 * 86400000;
      Object.keys(state).forEach(item => {
        if (state[item] < cutoff) delete state[item];
      });
      const storageKey = `${NOTIFICATION_SENT_KEY}:${currentUser?.id || "guest"}`;
      localStorage.setItem(storageKey, JSON.stringify(state));
    } catch (_) {
      // Notification deduplication remains in-memory/browser-session safe.
    }
  }

  function setNotificationStatus(message) {
    const status = $("#notificationStatus");
    if (status) status.textContent = message;
  }

  function clearReminderTimeout(habitId) {
    const timeout = reminderTimeouts.get(habitId);
    if (timeout) clearTimeout(timeout);
    reminderTimeouts.delete(habitId);
  }

  async function fireReminder(habitId, dateKey) {
    const habit = habits.find(item => item.id === habitId);
    if (!habit || !currentUser || !("Notification" in window) || Notification.permission !== "granted") return;
    if (wasCompleted(habit, dateKey) || skippedDatesFor(habit).includes(dateKey)) return;
    const key = `${dateKey}:${habit.id}`;
    if (getNotificationState()[key] || remindersInFlight.has(key)) return;
    remindersInFlight.add(key);
    try {
      const registration = await navigator.serviceWorker.ready;
      await registration.showNotification(`Habit reminder: ${habit.name}`, {
        body: habit.target || "Keep your routine going.",
        tag: key,
        requireInteraction: true,
        actions: [
          { action: "done", title: "✅ Done" },
          { action: "snooze", title: "⏰ Snooze (10m)" },
          { action: "skip", title: "⏭️ Skip" }
        ],
        data: { id: habit.id, title: `Habit reminder: ${habit.name}`, body: habit.target || "Keep your routine going." }
      });
      rememberNotification(key);
      habit.snoozedUntil = null;
    } catch (error) {
      console.error("Could not show habit reminder:", error);
    } finally {
      remindersInFlight.delete(key);
    }
    scheduleReminder(habit);
  }

  function scheduleReminder(habit) {
    clearReminderTimeout(habit.id);
    if (habit.isActive === false || !habit.reminderTime || !/^\d{2}:\d{2}$/.test(habit.reminderTime)) return;
    const now = Date.now();
    if (Number(habit.snoozedUntil) > now) {
      const timeout = window.setTimeout(() => void fireReminder(habit.id, indiaNowParts().key), Number(habit.snoozedUntil) - now);
      reminderTimeouts.set(habit.id, timeout);
      return;
    }
    const current = indiaNowParts();
    for (let offset = 0; offset <= 7; offset++) {
      const candidateDate = new Date(Date.UTC(current.year, current.month - 1, current.day + offset, 12));
      const candidateKey = `${candidateDate.getUTCFullYear()}-${String(candidateDate.getUTCMonth() + 1).padStart(2, "0")}-${String(candidateDate.getUTCDate()).padStart(2, "0")}`;
      const candidateDay = DAY_LABELS[candidateDate.getUTCDay()];
      const candidateTime = indiaCandidateTimestamp(candidateDate, habit.reminderTime);
      if (candidateTime <= now || (habit.selectedDays?.length && !habit.selectedDays.includes(candidateDay))) continue;
      if (wasCompleted(habit, candidateKey) || skippedDatesFor(habit).includes(candidateKey)) continue;
      const timeout = window.setTimeout(() => void fireReminder(habit.id, candidateKey), candidateTime - now);
      reminderTimeouts.set(habit.id, timeout);
      return;
    }
  }

  function scheduleAllReminders() {
    reminderTimeouts.forEach((timeout, habitId) => {
      clearTimeout(timeout);
      reminderTimeouts.delete(habitId);
    });
    habits.forEach(scheduleReminder);
  }

  async function registerServiceWorker() {
    if (!("serviceWorker" in navigator)) return null;
    try {
      return await navigator.serviceWorker.register("./sw.js?v=10", { scope: "./" });
    } catch (error) {
      console.error("Service worker registration failed:", error);
      return null;
    }
  }

  async function syncFromIndexedDB() {
    if (!currentUser) return;
    const mirroredHabits = await HabitFlowDB.getAll(currentUser.id);
    if (!mirroredHabits.length) return;
    const mirroredById = new Map(mirroredHabits.map(record => [record.id, record]));
    const changed = habits.some(habit => {
      const mirrored = mirroredById.get(habit.id);
      return mirrored && Number(mirrored.updatedAt) > Number(habit.updatedAt || 0);
    });
    if (!changed) return;
    habits = habits.map(habit => {
      const mirrored = mirroredById.get(habit.id);
      return mirrored && Number(mirrored.updatedAt) > Number(habit.updatedAt || 0)
        ? { ...habit, ...mirrored }
        : habit;
    });
    try {
      localStorage.setItem(localHabitsKey(), JSON.stringify(habits));
    } catch (_) {}
    render();
  }

  async function enableNotifications() {
    if (!("serviceWorker" in navigator)) {
      setNotificationStatus("Service workers are not supported here.");
      showToast("Offline notifications are not supported here.");
      return false;
    }
    if (!("Notification" in window)) {
      setNotificationStatus("Browser notifications are not supported here.");
      showToast("Notifications are not supported by this browser.");
      return false;
    }
    const permission = Notification.permission === "default"
      ? await Notification.requestPermission()
      : Notification.permission;
    if (permission !== "granted") {
      setNotificationStatus("Notifications are blocked. Allow them in browser settings.");
      showToast("Notification permission was not granted.");
      return false;
    }
    setNotificationStatus("Reminders enabled while HabitFlow is open.");
    showToast("Habit reminders enabled.");
    checkReminders();
    return true;
  }

  async function checkReminders() {
    if (!currentUser || !("Notification" in window) || Notification.permission !== "granted") return;
    const now = indiaNowParts();
    const timeKey = `${String(now.hour).padStart(2, "0")}:${String(now.minute).padStart(2, "0")}`;
    habits
      .filter(habit =>
        habit.isActive !== false &&
        habit.reminderTime === timeKey &&
        habit.reminderTime &&
        !wasCompleted(habit, now.key) &&
        !skippedDatesFor(habit).includes(now.key) &&
        (!habit.selectedDays?.length || habit.selectedDays.includes(now.weekday))
      )
      .forEach(habit => void fireReminder(habit.id, now.key));
    scheduleAllReminders();
  }

  function startReminderChecks() {
    clearInterval(reminderTimer);
    scheduleAllReminders();
    reminderTimer = window.setInterval(checkReminders, 20000);
    document.addEventListener("visibilitychange", () => {
      if (!document.hidden) {
        void syncFromIndexedDB().then(scheduleAllReminders);
        void checkReminders();
      }
    });
    window.addEventListener("focus", () => {
      void syncFromIndexedDB().then(scheduleAllReminders);
      void checkReminders();
    });
    void checkReminders();
  }

  // --- Modal Dialog (Add / Edit Habit) ---
  function openDialog(habit = null) {
    const dialog = $("#habitDialog");
    if (!dialog) return;

    editingHabitId = habit ? habit.id : null;
    $("#dialogTitle").textContent = habit ? "Edit habit" : "Add a new habit";
    $("#saveHabitBtn").textContent = habit ? "Update habit" : "Save habit";
    $("#habitName").value = habit ? habit.name : "";
    $("#habitTarget").value = habit ? (habit.target || "") : "";
    $("#habitCategory").value = habit ? habit.category : "Health & fitness";
    $("#habitReminder").value = habit ? (habit.reminderTime || "") : "";
    $$("#habitDays input").forEach(input => {
      input.checked = Boolean(habit?.selectedDays?.includes(input.value));
    });

    selectedIcon = habit ? (habit.icon || "🏃") : "🏃";
    $$(".icon-choice").forEach(btn => {
      btn.classList.toggle("selected", btn.dataset.icon === selectedIcon);
    });

    dialog.showModal();
    setTimeout(() => {
      $("#habitName").focus();
    }, 60);
  }

  function closeDialog() {
    const dialog = $("#habitDialog");
    if (dialog && dialog.open) {
      dialog.close();
    }
    $("#habitForm").reset();
    editingHabitId = null;
  }

  // --- Theme Toggle Logic ---
  function updateThemeButtons() {
    const isDark = document.documentElement.dataset.theme === "dark";
    const label = isDark ? "Switch to light mode" : "Switch to dark mode";
    const icon = isDark ? "☼" : "☾";

    ["#themeToggle", "#themeToggleSide"].forEach(sel => {
      const btn = $(sel);
      if (btn) {
        btn.textContent = icon;
        btn.title = label;
        btn.setAttribute("aria-label", label);
      }
    });

    const meta = $('meta[name="theme-color"]');
    if (meta) {
      meta.content = isDark ? "#0e101a" : "#f5f7fb";
    }
  }

  function toggleTheme() {
    const current = document.documentElement.dataset.theme;
    const next = current === "dark" ? "light" : "dark";
    document.documentElement.dataset.theme = next;
    try {
      localStorage.setItem(THEME_KEY, next);
    } catch (_) {}
    updateThemeButtons();
    showToast(`Switched to ${next} mode`);
  }

  function initTheme() {
    let savedTheme = "light";
    try {
      savedTheme = localStorage.getItem(THEME_KEY);
    } catch (_) {}

    if (!savedTheme) {
      const prefersDark = window.matchMedia && window.matchMedia("(prefers-color-scheme: dark)").matches;
      savedTheme = prefersDark ? "dark" : "light";
    }

    document.documentElement.dataset.theme = savedTheme;
    updateThemeButtons();
  }

  function navigateToView(view) {
    const labels = { overview: "Overview", habits: "My habits", insights: "Weekly progress", stats: "Statistics", settings: "Profile & settings" };
    const targetId = view === "overview" ? "overview" : view;
    const target = document.getElementById(targetId);
    if (!target) return;
    $$(".nav-link").forEach(link => {
      const active = link.dataset.nav === view;
      link.classList.toggle("active", active);
      link.setAttribute("aria-current", active ? "page" : "false");
    });
    const breadcrumb = $(".breadcrumb strong");
    if (breadcrumb) breadcrumb.textContent = labels[view] || "Overview";
    if (view === "habits") setFilter("all");
    target.scrollIntoView({ behavior: "smooth", block: "start" });
    const mobileNav = $("#mobileNav");
    const menuButton = $("#mobileMenuBtn");
    if (mobileNav) mobileNav.hidden = true;
    if (menuButton) menuButton.setAttribute("aria-expanded", "false");
  }

  function reportStorageKey() {
    return `${REPORTS_KEY}:${currentUser?.id || "guest"}`;
  }

  function reportSnapshot() {
    const today = new Date();
    const displayName = currentUser?.profile?.full_name || currentUser?.profile?.username || "HabitFlow member";
    const stats = dailyStats();
    const currentStreak = habits.length ? Math.max(...habits.map(habit => getStreak(habit))) : 0;
    const longestStreak = habits.length ? Math.max(...habits.map(getLongestStreak)) : 0;
    const totalCompletions = habits.reduce((sum, habit) => sum + completedDatesFor(habit).length, 0);
    const totalSkips = habits.reduce((sum, habit) => sum + skippedDatesFor(habit).length, 0);
    const weekStart = shiftDate(today, -6);
    const newThisWeek = habits.filter(habit => String(habit.createdAt || "").slice(0, 10) >= todayKey(weekStart)).length;
    const rows = [];
    for (let offset = -6; offset <= 0; offset++) {
      const date = shiftDate(today, offset);
      const key = todayKey(date);
      const completed = habits.filter(habit => completedDatesFor(habit).includes(key)).map(habit => habit.name);
      const skipped = habits.filter(habit => skippedDatesFor(habit).includes(key)).map(habit => habit.name);
      const added = habits.filter(habit => String(habit.createdAt || "").slice(0, 10) === key).map(habit => habit.name);
      rows.push({ date: key, weekday: new Intl.DateTimeFormat(undefined, { weekday: "long" }).format(date), completed, skipped, added });
    }
    const performance = habits.map(habit => ({
      name: habit.name,
      created: String(habit.createdAt || "").slice(0, 10) || "-",
      currentStreak: getStreak(habit),
      longestStreak: getLongestStreak(habit),
      completed: completedDatesFor(habit).length,
      skipped: skippedDatesFor(habit).length
    }));
    return {
      displayName,
      email: currentUser?.email || "",
      generatedAt: today.toISOString(),
      metrics: { habits: habits.length, completionRate: stats.percent, currentStreak, longestStreak, totalCompletions, totalSkips, newThisWeek },
      rows,
      performance
    };
  }

  function validReport(report) {
    return report && typeof report.id === "string" && report.userId === currentUser?.id &&
      Number.isFinite(Date.parse(report.createdAt)) && Number.isFinite(Date.parse(report.expiresAt)) &&
      report.data && Array.isArray(report.data.rows) && Array.isArray(report.data.performance);
  }

  function loadReports() {
    const now = Date.now();
    try {
      const reports = JSON.parse(localStorage.getItem(reportStorageKey()) || "[]");
      if (!Array.isArray(reports)) throw new Error("Saved reports are corrupted.");
      const valid = reports.filter(validReport).filter(report => Date.parse(report.expiresAt) > now);
      if (valid.length !== reports.length) localStorage.setItem(reportStorageKey(), JSON.stringify(valid));
      return valid.sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt));
    } catch (error) {
      console.error("Could not load saved reports:", error);
      showToast("Saved reports are unavailable or corrupted.");
      return [];
    }
  }

  function saveReport(data) {
    const report = {
      id: makeId(),
      userId: currentUser.id,
      createdAt: new Date().toISOString(),
      expiresAt: new Date(Date.now() + REPORT_RETENTION_DAYS * 86400000).toISOString(),
      data
    };
    const reports = [report, ...loadReports()];
    try {
      localStorage.setItem(reportStorageKey(), JSON.stringify(reports));
    } catch (error) {
      console.error("Could not save report:", error);
      showToast("Report could not be saved because browser storage is full.");
      return null;
    }
    return report;
  }

  function pdfText(value) {
    return String(value ?? "").replace(/[^\x20-\x7E]/g, "?").replace(/[\\()]/g, "\\$&");
  }

  function createPdf(report) {
    const { data } = report;
    const lines = [
      "HabitFlow - Weekly activity report",
      `User: ${data.displayName}`,
      `Email: ${data.email}`,
      `Generated: ${new Date(data.generatedAt).toLocaleString()}`,
      "",
      `Total habits: ${data.metrics.habits}`,
      `Completion rate: ${data.metrics.completionRate}%`,
      `Current streak: ${data.metrics.currentStreak}`,
      `Longest streak: ${data.metrics.longestStreak}`,
      `Total completions: ${data.metrics.totalCompletions}`,
      `Total skips: ${data.metrics.totalSkips}`,
      `New this week: ${data.metrics.newThisWeek}`,
      "",
      "7-day breakdown"
    ];
    data.rows.forEach(row => lines.push(`${row.date} (${row.weekday}) | Completed: ${row.completed.join(", ") || "-"} | Skipped: ${row.skipped.join(", ") || "-"} | Added: ${row.added.join(", ") || "-"}`));
    lines.push("", "All-time habit performance");
    data.performance.forEach(item => lines.push(`${item.name} | Created: ${item.created} | Current: ${item.currentStreak} | Longest: ${item.longestStreak} | Done: ${item.completed} | Skipped: ${item.skipped}`));
    const visibleLines = lines.slice(0, 52);
    const stream = ["BT", "/F1 10 Tf", "50 760 Td"];
    visibleLines.forEach((line, index) => {
      if (index) stream.push("0 -14 Td");
      stream.push(`(${pdfText(line)}) Tj`);
    });
    stream.push("ET");
    const objects = [
      "<< /Type /Catalog /Pages 2 0 R >>",
      "<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
      "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>",
      "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>",
      `<< /Length ${stream.join("\n").length} >>\nstream\n${stream.join("\n")}\nendstream`
    ];
    let pdf = "%PDF-1.4\n";
    const offsets = [0];
    objects.forEach((object, index) => {
      offsets.push(pdf.length);
      pdf += `${index + 1} 0 obj\n${object}\nendobj\n`;
    });
    const xrefOffset = pdf.length;
    pdf += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
    offsets.slice(1).forEach(offset => { pdf += `${String(offset).padStart(10, "0")} 00000 n \n`; });
    pdf += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xrefOffset}\n%%EOF`;
    return new Blob([pdf], { type: "application/pdf" });
  }

  function downloadReportFile(report) {
    if (!validReport(report)) {
      showToast("This saved report is missing or corrupted.");
      return;
    }
    const url = URL.createObjectURL(createPdf(report));
    const link = document.createElement("a");
    link.href = url;
    link.download = `habitflow-report-${report.createdAt.slice(0, 10)}.pdf`;
    document.body.appendChild(link);
    link.click();
    window.setTimeout(() => {
      link.remove();
      URL.revokeObjectURL(url);
    }, 1000);
  }

  function renderSavedReports() {
    const container = $("#savedReports");
    if (!container) return;
    const reports = loadReports();
    if (!reports.length) {
      container.textContent = "No saved reports. Reports are kept for 14 days.";
      return;
    }
    container.innerHTML = `<strong>Saved reports</strong>${reports.map(report => `
      <div class="saved-report-row">
        <span>${escapeHtml(new Date(report.createdAt).toLocaleString())} (expires ${escapeHtml(new Date(report.expiresAt).toLocaleDateString())})</span>
        <button type="button" class="link-btn saved-report-download" data-report-id="${escapeHtml(report.id)}">Download</button>
      </div>`).join("")}`;
  }

  function downloadCurrentReport() {
    const report = saveReport(reportSnapshot());
    if (!report) return;
    downloadReportFile(report);
    renderSavedReports();
    showToast("PDF report downloaded and saved for 14 days.");
  }

  function printReport() {
    const report = saveReport(reportSnapshot());
    if (!report) return;
    downloadReportFile(report);
    renderSavedReports();
  }

  async function handleLogout() {
    try { await logoutUser(); } catch (error) { console.error("Logout failed:", error); showToast("Could not sign out. Please try again."); }
  }

  // --- Event Listeners Setup ---

  // Habit list interactions (Complete toggle, Edit, Delete)
  $("#habitList").addEventListener("click", async event => {
    const button = event.target.closest("button[data-action]");
    if (!button) return;

    const item = button.closest("[data-habit-id]");
    const habitId = item?.dataset.habitId;
    const habit = habits.find(h => h.id === habitId);
    if (!habit) return;

    const action = button.dataset.action;

    if (action === "toggle") {
      const today = todayKey();
      const nextCompleted = !wasCompleted(habit, today);
      habit.completedDates = completedDatesFor(habit).filter(date => date !== today);
      if (nextCompleted) habit.completedDates.push(today);
      habit.history = Object.fromEntries(habit.completedDates.map(date => [date, true]));
      habit.skippedDates = skippedDatesFor(habit).filter(date => date !== today);
      habit.status = nextCompleted ? "completed" : "pending";
      habit.updatedAt = Date.now();
      render();
      try {
        await saveHabits();
        scheduleAllReminders();
      } catch (error) {
        habit.completedDates = completedDatesFor(habit).filter(date => date !== today);
        if (!nextCompleted) habit.completedDates.push(today);
        console.error("Failed to update completion:", error);
        render();
        showToast("Completion could not be saved.");
        return;
      }
      const status = nextCompleted ? "Habit completed! 🎉" : "Completion undone";
      showToast(status);
    } else if (action === "edit") {
      openDialog(habit);
    } else if (action === "delete") {
      const confirmed = window.confirm(`Delete "${habit.name}" and all of its recorded history?`);
      if (confirmed) {
        habits = habits.filter(h => h.id !== habit.id);
        void HabitFlowDB.remove(currentUser.id, habit.id);
        void saveHabits().then(scheduleAllReminders);
        render();
        showToast("Habit deleted");
      }
    }
  });

  // Filter chips
  $$(".filter-chip").forEach(chip => {
    chip.addEventListener("click", () => {
      setFilter(chip.dataset.filter);
    });
  });

  // Add habit triggers
  $("#addHabitTop")?.addEventListener("click", () => openDialog());
  $("#addHabitInline")?.addEventListener("click", () => openDialog());

  // Dialog controls
  $("#closeDialog")?.addEventListener("click", closeDialog);
  $("#cancelDialog")?.addEventListener("click", closeDialog);

  // Icon picker selection
  $("#iconPicker")?.addEventListener("click", event => {
    const choice = event.target.closest(".icon-choice");
    if (!choice) return;
    selectedIcon = choice.dataset.icon;
    $$(".icon-choice").forEach(btn => {
      btn.classList.toggle("selected", btn === choice);
    });
  });

  // Form submit handler
  $("#habitForm")?.addEventListener("submit", event => {
    event.preventDefault();
    const nameInput = $("#habitName");
    const name = nameInput.value.trim();
    if (!name) {
      nameInput.focus();
      return;
    }

    const target = $("#habitTarget").value.trim();
    const category = $("#habitCategory").value;
    const selectedDays = Array.from($("#habitDays").querySelectorAll("input:checked"))
      .map(input => input.value);

    if (editingHabitId) {
      const habit = habits.find(h => h.id === editingHabitId);
      if (habit) {
        habit.name = name;
        habit.target = target;
        habit.icon = selectedIcon;
        habit.category = category;
        habit.selectedDays = selectedDays;
        habit.reminderTime = $("#habitReminder").value;
        habit.updatedAt = Date.now();
        showToast("Habit updated successfully!");
      }
    } else {
      const newHabit = {
        id: makeId(),
        name,
        target,
        icon: selectedIcon,
        category,
        reminderTime: $("#habitReminder").value,
        selectedDays,
        isActive: true,
        createdAt: new Date().toISOString(),
        updatedAt: Date.now(),
        completedDates: [],
        skippedDates: [],
        history: {}
      };
      habits.unshift(newHabit);
      showToast("New habit added to routine!");
    }

    void saveHabits().then(scheduleAllReminders);
    closeDialog();
    setFilter("all");
    render();
  });

  // Dialog light-dismiss (clicking outside modal dialog box)
  // Uses bounding client rect to prevent accidental closes on dialog padding or selection drags
  const dialogEl = $("#habitDialog");
  if (dialogEl) {
    let pressedOutside = false;
    const isOutside = (e) => {
      const rect = dialogEl.getBoundingClientRect();
      return (
        e.clientX < rect.left ||
        e.clientX > rect.right ||
        e.clientY < rect.top ||
        e.clientY > rect.bottom
      );
    };

    dialogEl.addEventListener("pointerdown", e => {
      pressedOutside = isOutside(e);
    });

    dialogEl.addEventListener("pointerup", e => {
      if (pressedOutside && isOutside(e)) {
        closeDialog();
      }
      pressedOutside = false;
    });

    dialogEl.addEventListener("cancel", event => {
      event.preventDefault();
      closeDialog();
    });
  }

  // Theme toggle buttons
  $("#themeToggle")?.addEventListener("click", toggleTheme);
  $("#themeToggleSide")?.addEventListener("click", toggleTheme);

  // Clear all data helper
  $("#clearDataBtn")?.addEventListener("click", () => {
    const confirmed = window.confirm("Are you sure you want to delete ALL habits and history? This cannot be undone.");
    if (confirmed) {
      habits = [];
      void HabitFlowDB.removeAll(currentUser.id);
      clearUserHabits(currentUser.id).catch(error => {
        console.error("Failed to clear habits from SQLite:", error);
        showToast("Could not clear your habits.");
      });
      setFilter("all");
      render();
      showToast("All habits cleared.");
    }
  });

  ["#logoutBtn", "#sidebarLogoutBtn", "#topbarLogoutBtn"].forEach(selector => $(selector)?.addEventListener("click", handleLogout));

  $("#mobileMenuBtn")?.addEventListener("click", () => {
    const mobileNav = $("#mobileNav");
    const button = $("#mobileMenuBtn");
    const open = mobileNav.hidden;
    mobileNav.hidden = !open;
    button.setAttribute("aria-expanded", String(open));
  });

  $("#settingsNameForm")?.addEventListener("submit", event => {
    event.preventDefault();
    const value = $("#settingsNameInput").value.trim();
    if (!value) return;
    localStorage.setItem(`${DISPLAY_NAME_KEY}:${currentUser.id}`, value);
    renderHeader();
    showToast("Display name updated");
  });

  $("#exportDataBtn")?.addEventListener("click", () => {
    const blob = new Blob([JSON.stringify({ exportedAt: new Date().toISOString(), habits }, null, 2)], { type: "application/json" });
    const link = document.createElement("a");
    link.href = URL.createObjectURL(blob);
    link.download = "habitflow-data.json";
    link.click();
    URL.revokeObjectURL(link.href);
  });

  $("#settingsClearDataBtn")?.addEventListener("click", () => $("#clearDataBtn")?.click());
  $("#downloadReportBtn")?.addEventListener("click", printReport);
  $("#savedReports")?.addEventListener("click", event => {
    const button = event.target.closest(".saved-report-download");
    if (!button) return;
    const report = loadReports().find(item => item.id === button.dataset.reportId);
    if (!report) {
      renderSavedReports();
      showToast("That report has expired or is unavailable.");
      return;
    }
    downloadReportFile(report);
    showToast("Saved report downloaded.");
  });

  $("#notificationBtn")?.addEventListener("click", () => void enableNotifications());

  $$(".nav-link").forEach(link => {
    link.addEventListener("click", event => {
      event.preventDefault();
      navigateToView(link.dataset.nav);
    });
  });

  async function initialize() {
    initTheme();
    const user = await checkSession();
    if (!user) {
      window.location.href = "auth.html";
      return;
    }
    currentUser = user;
    habits = await loadHabits();
    render();
    renderSavedReports();
    await registerServiceWorker();
    navigator.serviceWorker.addEventListener("message", event => {
      if (event.data?.type === "habitflow-refresh") {
        void syncFromIndexedDB().then(scheduleAllReminders);
      }
    });
    document.addEventListener("visibilitychange", () => {
      if (!document.hidden) void syncFromIndexedDB();
    });
    startReminderChecks();
  }

  void initialize();
})();
