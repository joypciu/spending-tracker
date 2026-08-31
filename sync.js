const LedgerSync = (() => {
  const enc = new TextEncoder();
  const dec = new TextDecoder();

  function b64(bytes) {
    let s = "";
    bytes.forEach((b) => {
      s += String.fromCharCode(b);
    });
    return btoa(s);
  }

  function unb64(str) {
    const bin = atob(str);
    const out = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
    return out;
  }

  async function deriveKey(secret, salt) {
    const base = await crypto.subtle.importKey("raw", enc.encode(secret), "PBKDF2", false, ["deriveKey"]);
    return crypto.subtle.deriveKey(
      { name: "PBKDF2", salt, iterations: 120000, hash: "SHA-256" },
      base,
      { name: "AES-GCM", length: 256 },
      false,
      ["encrypt", "decrypt"],
    );
  }

  async function encryptJson(obj, secret) {
    const salt = crypto.getRandomValues(new Uint8Array(16));
    const iv = crypto.getRandomValues(new Uint8Array(12));
    const key = await deriveKey(secret, salt);
    const cipher = await crypto.subtle.encrypt({ name: "AES-GCM", iv }, key, enc.encode(JSON.stringify(obj)));
    return {
      v: 1,
      salt: b64(salt),
      iv: b64(iv),
      ciphertext: b64(new Uint8Array(cipher)),
    };
  }

  async function decryptJson(pack, secret) {
    const salt = unb64(pack.salt);
    const iv = unb64(pack.iv);
    const key = await deriveKey(secret, salt);
    const plain = await crypto.subtle.decrypt({ name: "AES-GCM", iv }, key, unb64(pack.ciphertext));
    return JSON.parse(dec.decode(plain));
  }

  function pickNewer(a, b) {
    if (!a) return b;
    if (!b) return a;
    return (b.updatedAt || 0) >= (a.updatedAt || 0) ? b : a;
  }

  function mergeList(a, b) {
    const map = new Map();
    for (const item of [...(a || []), ...(b || [])]) {
      if (!item || !item.id) continue;
      map.set(item.id, pickNewer(map.get(item.id), item));
    }
    return [...map.values()];
  }

  function fromState(state) {
    return {
      entries: state.entries,
      templates: state.templates,
      monthlyBudget: state.monthlyBudget,
      budgetsByMonth: state.budgetsByMonth,
      dailyCap: state.dailyCap,
      currency: state.currency,
      categoryCaps: state.categoryCaps,
      customCategories: state.customCategories,
      customMethods: state.customMethods,
      recurringSkipped: state.recurringSkipped,
      startingBalances: state.startingBalances,
      metaUpdatedAt: state.metaUpdatedAt || 0,
    };
  }

  function mergeDocs(local, remote) {
    if (!remote) return local;
    const useRemoteMeta = (remote.metaUpdatedAt || 0) > (local.metaUpdatedAt || 0);
    return {
      entries: mergeList(local.entries, remote.entries),
      templates: mergeList(local.templates, remote.templates),
      monthlyBudget: useRemoteMeta ? remote.monthlyBudget : local.monthlyBudget,
      budgetsByMonth: useRemoteMeta
        ? { ...local.budgetsByMonth, ...remote.budgetsByMonth }
        : { ...remote.budgetsByMonth, ...local.budgetsByMonth },
      dailyCap: useRemoteMeta ? remote.dailyCap : local.dailyCap,
      currency: useRemoteMeta ? remote.currency : local.currency,
      categoryCaps: useRemoteMeta
        ? { ...local.categoryCaps, ...remote.categoryCaps }
        : { ...remote.categoryCaps, ...local.categoryCaps },
      customCategories: useRemoteMeta
        ? [...new Set([...(remote.customCategories || []), ...(local.customCategories || [])])]
        : [...new Set([...(local.customCategories || []), ...(remote.customCategories || [])])],
      customMethods: useRemoteMeta
        ? [...new Set([...(remote.customMethods || []), ...(local.customMethods || [])])]
        : [...new Set([...(local.customMethods || []), ...(remote.customMethods || [])])],
      recurringSkipped: useRemoteMeta
        ? { ...(local.recurringSkipped || {}), ...(remote.recurringSkipped || {}) }
        : { ...(remote.recurringSkipped || {}), ...(local.recurringSkipped || {}) },
      startingBalances: useRemoteMeta
        ? { ...(local.startingBalances || {}), ...(remote.startingBalances || {}) }
        : { ...(remote.startingBalances || {}), ...(local.startingBalances || {}) },
      metaUpdatedAt: Math.max(local.metaUpdatedAt || 0, remote.metaUpdatedAt || 0),
    };
  }

  function applyToState(state, doc) {
    state.entries = doc.entries;
    state.templates = doc.templates || [];
    state.monthlyBudget = doc.monthlyBudget ?? state.monthlyBudget;
    state.budgetsByMonth = doc.budgetsByMonth || {};
    state.dailyCap = doc.dailyCap ?? state.dailyCap;
    state.currency = doc.currency || state.currency;
    state.categoryCaps = doc.categoryCaps || {};
    state.customCategories = doc.customCategories || state.customCategories || [];
    state.customMethods = doc.customMethods || state.customMethods || [];
    state.recurringSkipped = doc.recurringSkipped || state.recurringSkipped || {};
    state.startingBalances = doc.startingBalances || state.startingBalances || {};
    state.metaUpdatedAt = doc.metaUpdatedAt || 0;
  }

  return { encryptJson, decryptJson, fromState, mergeDocs, applyToState };
})();
