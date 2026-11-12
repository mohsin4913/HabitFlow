import initSqlJs from "https://cdn.jsdelivr.net/npm/sql.js@1.13.0/+esm";

const DATABASE_NAME = "habitflow-sqlite";
const DATABASE_STORE = "databases";
const DATABASE_KEY = "main";
const SESSION_KEY = "habitflow-session";

let databasePromise;

function makeId() {
  if (window.crypto && typeof window.crypto.randomUUID === "function") {
    return window.crypto.randomUUID();
  }
  return `${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

function openDatabaseStore() {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DATABASE_NAME, 1);
    request.onupgradeneeded = () => request.result.createObjectStore(DATABASE_STORE);
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

async function loadDatabaseBytes() {
  const store = await openDatabaseStore();
  return new Promise((resolve, reject) => {
    const request = store.transaction(DATABASE_STORE, "readonly")
      .objectStore(DATABASE_STORE)
      .get(DATABASE_KEY);
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

async function saveDatabase(db) {
  const store = await openDatabaseStore();
  return new Promise((resolve, reject) => {
    const transaction = store.transaction(DATABASE_STORE, "readwrite");
    transaction.objectStore(DATABASE_STORE).put(db.export(), DATABASE_KEY);
    transaction.oncomplete = resolve;
    transaction.onerror = () => reject(transaction.error);
  });
}

async function getDatabase() {
  if (!databasePromise) {
    databasePromise = (async () => {
      const SQL = await initSqlJs({
        locateFile: file => `https://cdn.jsdelivr.net/npm/sql.js@1.13.0/dist/${file}`
      });
      const bytes = await loadDatabaseBytes();
      const db = bytes ? new SQL.Database(bytes) : new SQL.Database();
      db.run(`
        CREATE TABLE IF NOT EXISTS users (
          id TEXT PRIMARY KEY,
          full_name TEXT NOT NULL,
          username TEXT NOT NULL UNIQUE,
          email TEXT NOT NULL UNIQUE,
          password_hash TEXT NOT NULL,
          password_salt TEXT NOT NULL
        );
        CREATE TABLE IF NOT EXISTS habits (
          id TEXT PRIMARY KEY,
          user_id TEXT NOT NULL,
          habit_name TEXT NOT NULL,
          description TEXT,
          category TEXT,
          icon TEXT,
          reminder_time TEXT,
          selected_days TEXT NOT NULL DEFAULT '[]',
          is_active INTEGER NOT NULL DEFAULT 1,
          created_at TEXT NOT NULL,
          updated_at TEXT NOT NULL,
          completed_dates TEXT NOT NULL DEFAULT '[]',
          skipped_dates TEXT NOT NULL DEFAULT '[]',
          FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
        );
        CREATE TABLE IF NOT EXISTS habit_completions (
          habit_id TEXT NOT NULL,
          user_id TEXT NOT NULL,
          completed_on TEXT NOT NULL,
          PRIMARY KEY (habit_id, completed_on),
          FOREIGN KEY (habit_id) REFERENCES habits(id) ON DELETE CASCADE
        );
      `);
      try { db.run("ALTER TABLE habits ADD COLUMN completed_dates TEXT NOT NULL DEFAULT '[]'"); } catch (_) {}
      try { db.run("ALTER TABLE habits ADD COLUMN skipped_dates TEXT NOT NULL DEFAULT '[]'"); } catch (_) {}
      await saveDatabase(db);
      return db;
    })();
  }
  return databasePromise;
}

function one(db, sql, parameters = {}) {
  const result = db.exec(sql, parameters)[0];
  if (!result || !result.values.length) return null;
  return Object.fromEntries(result.columns.map((column, index) => [column, result.values[0][index]]));
}

function all(db, sql, parameters = {}) {
  const result = db.exec(sql, parameters)[0];
  if (!result) return [];
  return result.values.map(row => Object.fromEntries(
    result.columns.map((column, index) => [column, row[index]])
  ));
}

async function hashPassword(password, salt) {
  const data = new TextEncoder().encode(`${salt}:${password}`);
  const digest = await crypto.subtle.digest("SHA-256", data);
  return Array.from(new Uint8Array(digest), byte => byte.toString(16).padStart(2, "0")).join("");
}

function userFromRow(row) {
  if (!row) return null;
  return {
    id: row.id,
    email: row.email,
    profile: { full_name: row.full_name, username: row.username }
  };
}

export async function registerUser({ fullName, username, email, password }) {
  const normalizedFullName = fullName.trim().replace(/\s+/g, " ");
  const normalizedUsername = username.trim().toLowerCase();
  const normalizedEmail = email.trim().toLowerCase();
  if (!/^[\p{L}]+(?:[ '-][\p{L}]+)*$/u.test(normalizedFullName) ||
      normalizedFullName.length < 2 || normalizedFullName.length > 80) {
    throw new Error("Full name must contain only letters, spaces, apostrophes, or hyphens.");
  }
  if (!/^[a-z0-9_]{3,30}$/.test(normalizedUsername)) {
    throw new Error("Username must be 3–30 letters, numbers, or underscores.");
  }
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(normalizedEmail)) {
    throw new Error("Enter a valid email address.");
  }
  if (!/^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)\S{8,128}$/.test(password)) {
    throw new Error("Password must be 8–128 characters with uppercase, lowercase, and a number.");
  }

  const db = await getDatabase();
  if (one(db, "SELECT id FROM users WHERE username = $username OR email = $email", {
    $username: normalizedUsername, $email: normalizedEmail
  })) {
    throw new Error("That username or email is already registered.");
  }
  const salt = makeId();
  db.run(
    "INSERT INTO users (id, full_name, username, email, password_hash, password_salt) VALUES ($id, $fullName, $username, $email, $hash, $salt)",
    {
      $id: makeId(), $fullName: normalizedFullName, $username: normalizedUsername,
      $email: normalizedEmail, $hash: await hashPassword(password, salt), $salt: salt
    }
  );
  await saveDatabase(db);
  return loginUser(normalizedUsername, password);
}

export async function loginUser(username, password) {
  const db = await getDatabase();
  const row = one(db, "SELECT * FROM users WHERE username = $username", {
    $username: username.trim().toLowerCase()
  });
  if (!row || await hashPassword(password, row.password_salt) !== row.password_hash) {
    throw new Error("Invalid username or password.");
  }
  localStorage.setItem(SESSION_KEY, row.id);
  return { user: userFromRow(row) };
}

export async function logoutUser() {
  localStorage.removeItem(SESSION_KEY);
  window.location.href = "auth.html";
}

export async function checkSession() {
  const id = localStorage.getItem(SESSION_KEY);
  if (!id) return null;
  const db = await getDatabase();
  const user = userFromRow(one(db, "SELECT id, full_name, username, email FROM users WHERE id = $id", { $id: id }));
  if (!user) localStorage.removeItem(SESSION_KEY);
  return user;
}

export async function loadHabits(userId) {
  const db = await getDatabase();
  const rows = all(db, "SELECT * FROM habits WHERE user_id = $userId ORDER BY created_at", { $userId: userId });
  const completions = all(db, "SELECT habit_id, completed_on FROM habit_completions WHERE user_id = $userId", { $userId: userId });
  const historyByHabit = {};
  completions.forEach(completion => {
    historyByHabit[completion.habit_id] = historyByHabit[completion.habit_id] || {};
    historyByHabit[completion.habit_id][completion.completed_on] = true;
  });
  return rows.map(habit => ({
    id: String(habit.id),
    name: String(habit.habit_name),
    target: habit.description || "",
    icon: habit.icon || "📚",
    category: habit.category || "Personal growth",
    reminderTime: habit.reminder_time || "",
    selectedDays: JSON.parse(habit.selected_days || "[]"),
    isActive: habit.is_active !== 0,
    createdAt: String(habit.created_at),
    completedDates: JSON.parse(habit.completed_dates || JSON.stringify(Object.keys(historyByHabit[habit.id] || {}))),
    skippedDates: JSON.parse(habit.skipped_dates || "[]"),
    history: historyByHabit[habit.id] || {}
  }));
}

export async function saveHabits(userId, habits) {
  const db = await getDatabase();
  db.run("DELETE FROM habits WHERE user_id = $userId", { $userId: userId });
  db.run("DELETE FROM habit_completions WHERE user_id = $userId", { $userId: userId });
  habits.forEach(habit => {
    db.run(
      `INSERT INTO habits
      (id, user_id, habit_name, description, category, icon, reminder_time, selected_days, is_active, created_at, updated_at, completed_dates, skipped_dates)
      VALUES ($id, $userId, $name, $target, $category, $icon, $reminderTime, $selectedDays, $isActive, $createdAt, $updatedAt, $completedDates, $skippedDates)`,
      {
        $id: habit.id, $userId: userId, $name: habit.name, $target: habit.target || "",
        $category: habit.category || "Personal growth", $icon: habit.icon || "📚",
        $reminderTime: habit.reminderTime || null, $selectedDays: JSON.stringify(habit.selectedDays || []),
        $isActive: habit.isActive === false ? 0 : 1, $createdAt: habit.createdAt,
        $updatedAt: new Date().toISOString(),
        $completedDates: JSON.stringify(habit.completedDates || Object.keys(habit.history || {})),
        $skippedDates: JSON.stringify(habit.skippedDates || [])
      }
    );
    Object.keys(habit.history || {}).filter(key => habit.history[key]).forEach(date => {
      db.run(
        "INSERT INTO habit_completions (habit_id, user_id, completed_on) VALUES ($habitId, $userId, $date)",
        { $habitId: habit.id, $userId: userId, $date: date }
      );
    });
  });
  await saveDatabase(db);
}

export async function clearUserHabits(userId) {
  const db = await getDatabase();
  db.run("DELETE FROM habits WHERE user_id = $userId", { $userId: userId });
  await saveDatabase(db);
}
