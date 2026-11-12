/* Shared IndexedDB mirror used by the page and service worker. */
(function (root) {
  "use strict";

  const DATABASE_NAME = "habitflow-state";
  const DATABASE_VERSION = 1;
  const STORE_NAME = "habits";

  function open() {
    return new Promise((resolve, reject) => {
      const request = root.indexedDB.open(DATABASE_NAME, DATABASE_VERSION);
      request.onupgradeneeded = () => {
        const database = request.result;
        if (!database.objectStoreNames.contains(STORE_NAME)) {
          database.createObjectStore(STORE_NAME, { keyPath: "id" });
        }
      };
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
  }

  function transaction(mode, callback) {
    return open().then(database => new Promise((resolve, reject) => {
      const tx = database.transaction(STORE_NAME, mode);
      const request = callback(tx.objectStore(STORE_NAME));
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
      tx.onabort = () => reject(tx.error);
    }));
  }

  function getAll(userId) {
    return transaction("readonly", store => store.getAll()).then(records =>
      records.filter(record => !userId || record.userId === userId)
    );
  }

  function get(id) {
    return transaction("readonly", store => store.get(id));
  }

  function put(userId, habit) {
    return transaction("readwrite", store => store.put({
      ...habit,
      id: String(habit.id),
      userId,
      updatedAt: habit.updatedAt || Date.now()
    }));
  }

  function putAll(userId, habits) {
    return open().then(database => new Promise((resolve, reject) => {
      const tx = database.transaction(STORE_NAME, "readwrite");
      const store = tx.objectStore(STORE_NAME);
      habits.forEach(habit => store.put({
        ...habit,
        id: String(habit.id),
        userId,
        updatedAt: habit.updatedAt || Date.now()
      }));
      tx.oncomplete = resolve;
      tx.onerror = () => reject(tx.error);
      tx.onabort = () => reject(tx.error);
    }));
  }

  function remove(userId, id) {
    return get(id).then(record => {
      if (!record || record.userId !== userId) return;
      return transaction("readwrite", store => store.delete(id));
    });
  }

  function removeAll(userId) {
    return open().then(database => new Promise((resolve, reject) => {
      const tx = database.transaction(STORE_NAME, "readwrite");
      const store = tx.objectStore(STORE_NAME);
      const request = store.openCursor();
      request.onsuccess = () => {
        const cursor = request.result;
        if (!cursor) return;
        if (cursor.value.userId === userId) cursor.delete();
        cursor.continue();
      };
      tx.oncomplete = resolve;
      tx.onerror = () => reject(tx.error);
      tx.onabort = () => reject(tx.error);
    }));
  }

  root.HabitFlowDB = { getAll, get, put, putAll, remove, removeAll };
})(typeof self !== "undefined" ? self : window);
