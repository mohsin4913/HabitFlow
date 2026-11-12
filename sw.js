importScripts("./habitflow-db.js");

const CACHE_NAME = "habitflow-v4";
const APP_SHELL = [
  "./",
  "./index.html",
  "./auth.html",
  "./style.css",
  "./auth.css",
  "./script.js",
  "./auth.js",
  "./sqlite-client.js",
  "./habitflow-db.js",
  "./icon.svg",
  "./manifest.json",
  "https://fonts.googleapis.com/css2?family=DM+Sans:ital,wght@0,400;0,500;0,600;0,700;1,400&family=Manrope:wght@500;600;700;800&display=swap",
  "https://cdn.jsdelivr.net/npm/sql.js@1.13.0/+esm",
  "https://cdn.jsdelivr.net/npm/sql.js@1.13.0/dist/sql-wasm.js",
  "https://cdn.jsdelivr.net/npm/sql.js@1.13.0/dist/sql-wasm.wasm"
];

self.addEventListener("install", event => {
  event.waitUntil(
    caches.open(CACHE_NAME).then(async cache => {
      await Promise.all(APP_SHELL.map(async asset => {
        try {
          await cache.add(asset);
        } catch (error) {
          console.warn("HabitFlow could not precache", asset, error);
        }
      }));
      await self.skipWaiting();
    })
  );
});

self.addEventListener("activate", event => {
  event.waitUntil(
    caches.keys().then(keys => Promise.all(
      keys.filter(key => key !== CACHE_NAME).map(key => caches.delete(key))
    )).then(() => self.clients.claim())
  );
});

self.addEventListener("fetch", event => {
  if (event.request.method !== "GET") return;
  event.respondWith(
    caches.match(event.request).then(cached => {
      if (cached) return cached;
      return fetch(event.request).then(response => {
        if (response.ok || response.type === "opaque") {
          const copy = response.clone();
          caches.open(CACHE_NAME).then(cache => cache.put(event.request, copy));
        }
        return response;
      }).catch(() => {
        if (event.request.mode === "navigate") return caches.match("./index.html");
        return new Response("Offline", { status: 503, statusText: "Offline" });
      });
    })
  );
});

function todayKey(date = new Date()) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function dateFromKey(key) {
  const [year, month, day] = key.split("-").map(Number);
  return new Date(year, month - 1, day, 12, 0, 0);
}

function shiftDate(date, amount) {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate() + amount, 12, 0, 0);
}

function isScheduled(habit, date) {
  const selectedDays = Array.isArray(habit.selectedDays) ? habit.selectedDays : [];
  const labels = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
  return selectedDays.length === 0 || selectedDays.includes(labels[date.getDay()]);
}

function calculateStreak(habit, referenceKey) {
  const completedDates = new Set(Array.isArray(habit.completedDates) ? habit.completedDates : Object.keys(habit.history || {}));
  let cursor = dateFromKey(referenceKey);
  let streak = 0;
  while (true) {
    const key = todayKey(cursor);
    if (isScheduled(habit, cursor)) {
      if (!completedDates.has(key)) break;
      streak++;
    }
    cursor = shiftDate(cursor, -1);
  }
  return streak;
}

function updateHabitForAction(habit, action) {
  const key = todayKey();
  habit.completedDates = Array.isArray(habit.completedDates) ? habit.completedDates : Object.keys(habit.history || {});
  habit.skippedDates = Array.isArray(habit.skippedDates) ? habit.skippedDates : [];
  if (action === "done") {
    habit.completedDates = [...new Set([...habit.completedDates, key])].sort();
    habit.skippedDates = habit.skippedDates.filter(date => date !== key);
    habit.status = "completed";
    habit.lastCompletedDate = key;
    habit.streak = calculateStreak(habit, key);
    habit.longestStreak = Math.max(Number(habit.longestStreak) || 0, habit.streak);
  } else if (action === "skip") {
    habit.skippedDates = [...new Set([...habit.skippedDates, key])].sort();
    habit.completedDates = habit.completedDates.filter(date => date !== key);
    habit.status = "skipped";
  }
  habit.updatedAt = Date.now();
  return habit;
}

async function focusApp() {
  const clients = await self.clients.matchAll({ type: "window", includeUncontrolled: true });
  const client = clients.find(item => "focus" in item);
  if (client) return client.focus();
  return self.clients.openWindow("./index.html");
}

self.addEventListener("notificationclick", event => {
  const notification = event.notification;
  const data = notification.data || {};
  const action = event.action || "open";
  notification.close();

  event.waitUntil((async () => {
    if (action === "snooze") {
      await new Promise(resolve => setTimeout(resolve, 10 * 60 * 1000));
      await self.registration.showNotification(data.title || "Habit reminder", {
        body: data.body || "Keep your routine going.",
        tag: `habitflow-snooze-${data.id}`,
        requireInteraction: true,
        actions: [
          { action: "done", title: "✅ Done" },
          { action: "snooze", title: "⏰ Snooze" },
          { action: "skip", title: "⏭️ Skip" }
        ],
        data
      });
      return;
    }

    if ((action === "done" || action === "skip") && data.id) {
      const habit = await HabitFlowDB.get(data.id);
      if (habit) await HabitFlowDB.put(habit.userId, updateHabitForAction(habit, action));
      return focusApp();
    }

    return focusApp();
  })());
});
