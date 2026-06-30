"use strict";

export function loadLocalState(key, fallback = null) {
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return fallback;
    const parsed = JSON.parse(raw);
    return parsed == null ? fallback : parsed;
  } catch {
    return fallback;
  }
}

export function saveLocalState(key, value) {
  try {
    localStorage.setItem(key, JSON.stringify(value));
    return true;
  } catch {
    return false;
  }
}

export function removeLocalState(key) {
  try {
    localStorage.removeItem(key);
  } catch {
    /* localStorage 不可用时忽略 */
  }
}

export function createLocalState(key, fallback = null) {
  return {
    load() {
      return loadLocalState(key, fallback);
    },
    save(value) {
      return saveLocalState(key, value);
    },
    remove() {
      removeLocalState(key);
    },
  };
}

const DB_NAME = "image-studio-persistence";
const DB_VERSION = 1;
const STORE_NAME = "records";

let dbPromise = null;

function openDb() {
  if (!("indexedDB" in window)) {
    return Promise.reject(new Error("当前浏览器不支持 IndexedDB"));
  }
  if (dbPromise) return dbPromise;
  dbPromise = new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        db.createObjectStore(STORE_NAME, { keyPath: "key" });
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error || new Error("打开 IndexedDB 失败"));
  });
  return dbPromise;
}

function withStore(mode, callback) {
  return openDb().then((db) => new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, mode);
    const store = tx.objectStore(STORE_NAME);
    let result;
    try {
      result = callback(store);
    } catch (error) {
      reject(error);
      return;
    }
    tx.oncomplete = () => resolve(result);
    tx.onerror = () => reject(tx.error || new Error("IndexedDB 事务失败"));
    tx.onabort = () => reject(tx.error || new Error("IndexedDB 事务中止"));
  }));
}

export async function getDbRecord(key) {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, "readonly");
    const req = tx.objectStore(STORE_NAME).get(key);
    req.onsuccess = () => resolve(req.result?.value ?? null);
    req.onerror = () => reject(req.error || new Error("读取 IndexedDB 失败"));
  });
}

export function putDbRecord(key, value) {
  return withStore("readwrite", (store) => {
    store.put({ key, value, updatedAt: Date.now() });
  });
}

export function deleteDbRecord(key) {
  return withStore("readwrite", (store) => {
    store.delete(key);
  });
}
