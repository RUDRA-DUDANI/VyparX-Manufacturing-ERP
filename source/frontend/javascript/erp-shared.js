/**
 * VyaparX ERP - Shared runtime helpers used by every dashboard module.
 *
 * - Light theme default with persisted dark-mode preference (localStorage).
 * - Sun/moon theme toggle wired to every #th button.
 * - Authenticated company profile fetched from the backend (single source of
 *   truth for the company name, sidebar, and document headers).
 */
(function (global) {
  "use strict";

  const THEME_KEY = "vyparx_theme";
  const COMPANY_CACHE_KEY = "vyparx_company_profile";

  function dateParts(value) {
    if (value == null || value === "") return null;
    if (value && typeof value.toDate === "function") {
      try { return dateParts(value.toDate()); } catch (e) { return null; }
    }
    if (typeof value === "object" && !(value instanceof Date)) {
      const seconds = value.seconds ?? value._seconds;
      if (Number.isFinite(Number(seconds))) return dateParts(new Date(Number(seconds) * 1000));
    }
    if (value instanceof Date || typeof value === "number") {
      const date = value instanceof Date ? value : new Date(value);
      if (Number.isNaN(date.getTime())) return null;
      return [date.getFullYear(), date.getMonth() + 1, date.getDate()];
    }
    const input = String(value).trim();
    if (!input || input === "—" || input === "-") return null;
    let match = input.match(/^(\d{4})[-/](\d{1,2})[-/](\d{1,2})(?:$|[T\s])/);
    if (match) return validDateParts(+match[1], +match[2], +match[3]);
    match = input.match(/^(\d{1,2})[/.\-](\d{1,2})[/.\-](\d{2,4})$/);
    if (match) {
      let year = +match[3];
      if (year < 100) year += year < 50 ? 2000 : 1900;
      return validDateParts(year, +match[2], +match[1]);
    }
    match = input.match(/^(\d{1,2})[-\s]([A-Za-z]{3,})[-,\s]+(\d{4})$/);
    if (match) {
      const month = ["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"]
        .indexOf(match[2].slice(0, 3).toLowerCase()) + 1;
      return validDateParts(+match[3], month, +match[1]);
    }
    const parsed = new Date(input);
    if (Number.isNaN(parsed.getTime())) return null;
    return [parsed.getFullYear(), parsed.getMonth() + 1, parsed.getDate()];
  }

  function validDateParts(year, month, day) {
    const date = new Date(Date.UTC(year, month - 1, day));
    return date.getUTCFullYear() === year && date.getUTCMonth() + 1 === month && date.getUTCDate() === day
      ? [year, month, day] : null;
  }

  function dateKey(value) {
    const parts = dateParts(value);
    return parts ? `${String(parts[0]).padStart(4, "0")}-${String(parts[1]).padStart(2, "0")}-${String(parts[2]).padStart(2, "0")}` : "";
  }

  function dateSortKey(value) {
    const key = dateKey(value);
    return key ? Date.parse(`${key}T00:00:00Z`) : null;
  }

  function formatDate(value) {
    const parts = dateParts(value);
    if (!parts) return "—";
    const months = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
    return `${String(parts[2]).padStart(2, "0")}-${months[parts[1] - 1]}-${String(parts[0]).padStart(4, "0")}`;
  }

  function sortRowsByDate(rows, index, direction) {
    const multiplier = Number(direction) < 0 ? -1 : 1;
    return [...rows].sort((left, right) => {
      const a = dateSortKey(left[index]);
      const b = dateSortKey(right[index]);
      if (a == null && b == null) return 0;
      if (a == null) return 1;
      if (b == null) return -1;
      return (a - b) * multiplier;
    });
  }

  function companyCacheKey() {
    const session = global.VyaparXAuth && global.VyaparXAuth.getCurrentSession();
    const companyId = session && session.companyId;
    return companyId ? COMPANY_CACHE_KEY + ":" + String(companyId) : COMPANY_CACHE_KEY + ":unscoped";
  }

  function applyTheme(theme) {
    const t = theme === "dark" ? "dark" : "light";
    document.documentElement.dataset.theme = t;
    try {
      localStorage.setItem(themeStorageKey(), t);
      // Keep the legacy key as a write-only mirror for older integrations.
      localStorage.setItem(THEME_KEY, t);
    } catch (e) {
      /* storage unavailable - theme simply won't persist */
    }
    updateToggleIcon();
  }

  function currentTheme() {
    return document.documentElement.dataset.theme === "dark" ? "dark" : "light";
  }

  function updateToggleIcon() {
    const btn = document.getElementById("th");
    if (!btn) return;
    const dark = currentTheme() === "dark";
    // Sun icon on light theme (click -> dark), moon icon on dark theme.
    btn.innerHTML = dark
      ? '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M21 12.8A9 9 0 1 1 11.2 3a7 7 0 0 0 9.8 9.8z"/></svg>'
      : '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4"/></svg>';
    btn.setAttribute("aria-label", dark ? "Switch to light mode" : "Switch to dark mode");
    btn.title = dark ? "Light mode" : "Dark mode";
  }

  function initTheme() {
    let stored = null;
    try {
      stored = localStorage.getItem(themeStorageKey());
    } catch (e) { }
    // Default is light; explicit dark choice is preserved across refresh.
    applyTheme(stored === "dark" ? "dark" : "light");
  }

  // Keep appearance preferences separate when several employees share a device.
  function themeStorageKey() {
    const session = global.VyaparXAuth && global.VyaparXAuth.getCurrentSession();
    const accountId = session && (session.userId || session.id || session.email);
    return accountId ? THEME_KEY + ":" + encodeURIComponent(String(accountId)) : THEME_KEY + ":guest";
  }

  function bindToggle() {
    const btn = document.getElementById("th");
    if (!btn || btn.dataset.vxpBound === "1") return;
    btn.dataset.vxpBound = "1";
    // Older module controllers assign an onclick toggle too; clear it so one
    // user click cannot switch the theme twice and return to its old value.
    btn.onclick = null;
    btn.addEventListener("click", function () {
      applyTheme(currentTheme() === "dark" ? "light" : "dark");
    });
    updateToggleIcon();
  }

  function cacheCompany() {
    try {
      return JSON.parse(sessionStorage.getItem(companyCacheKey())) || null;
    } catch (e) {
      return null;
    }
  }

  function applyCompanyToDom(profile) {
    if (!profile) return;
    const name = profile.company_name || profile.companyName || "";
    if (!name) return;
    document.querySelectorAll(".logo small").forEach(function (el) {
      el.textContent = name;
    });
    document.title = document.title.replace(/– .*$/, "– " + name);
  }

  /** Refresh the signed-in employee identity separately from company identity. */
  async function loadEmployeeProfile() {
    if (!global.VyaparXAuth) return null;
    let session = global.VyaparXAuth.getCurrentSession();
    try {
      session = await global.VyaparXAuth.refreshSession();
    } catch (error) {
      console.warn("Employee profile refresh unavailable:", error.message);
    }
    if (!session) return null;

    const name = session.fullName || session.name || "";
    const designation = session.designation || session.headDepartment || session.department || session.role || "";
    const nameNode = document.getElementById("pnm") || document.getElementById("employee-name");
    const roleNode = document.getElementById("prl") || document.getElementById("employee-role");
    const avatar = document.getElementById("pav") || document.getElementById("employee-avatar");
    if (nameNode && name) nameNode.textContent = name;
    if (roleNode && designation) roleNode.textContent = designation;
    if (avatar && name && !avatar.querySelector("img")) {
      const initials = name.split(/\s+/).map((part) => part[0]).join("").slice(0, 2).toUpperCase();
      if (avatar.textContent !== initials) avatar.textContent = initials;
    }
    return session;
  }

  function bindEmployeeProfileRefresh() {
    // Module renderers may repaint their headers; reapply the authenticated identity.
    const header = document.querySelector("header");
    if (!header || typeof MutationObserver === "undefined") return;
    let scheduled = false;
    new MutationObserver(function () {
      if (scheduled) return;
      scheduled = true;
      Promise.resolve().then(function () {
        scheduled = false;
        const session = global.VyaparXAuth && global.VyaparXAuth.getCurrentSession();
        if (!session) return;
        const name = session.fullName || session.name || "";
        const designation = session.designation || session.department || session.headDepartment || session.role || "";
        const nameNode = document.getElementById("pnm") || document.getElementById("employee-name");
        const roleNode = document.getElementById("prl") || document.getElementById("employee-role");
        const avatar = document.getElementById("pav") || document.getElementById("employee-avatar");
        if (nameNode && name && nameNode.textContent !== name) nameNode.textContent = name;
        if (roleNode && designation && roleNode.textContent !== designation) roleNode.textContent = designation;
        if (avatar && name && !avatar.querySelector("img")) {
          const initials = name.split(/\s+/).map((part) => part[0]).join("").slice(0, 2).toUpperCase();
          if (avatar.textContent !== initials) avatar.textContent = initials;
        }
      });
    }).observe(header, { childList: true, characterData: true, subtree: true });
  }

  /**
   * Fetch the authenticated company's registered profile from the backend.
   * Falls back to the cached copy when the backend is unreachable.
   */
  async function loadCompanyProfile(force) {
    if (!force) {
      const cached = cacheCompany();
      if (cached) {
        applyCompanyToDom(cached);
      }
    }
    if (!global.VyaparXAuth || !global.VyaparXAuth.apiFetchCompany) return cacheCompany();
    try {
      const profile = await global.VyaparXAuth.apiFetchCompany();
      sessionStorage.setItem(companyCacheKey(), JSON.stringify(profile));
      applyCompanyToDom(profile);
      return profile;
    } catch (e) {
      console.warn("Company profile unavailable:", e.message);
      return cacheCompany();
    }
  }

  /* ========================================================================
   * VYAPARX ERP - CROSS-MODULE TASK & RECORD LIVE SYNCHRONIZATION ENGINE
   * ======================================================================== */
  const TASK_CACHE_TTL = 10000; // 10 seconds cache unless forced
  const RECORD_CACHE_TTL = 15000; // 15 seconds cache unless forced
  let _cachedTasks = null;
  let _lastTaskFetchTime = 0;
  let _taskFetchPromise = null;
  let _taskSubmitting = false;

  const _recordCache = new Map();
  const _recordFetchPromises = new Map();
  const _recordPageStates = new Map();

  const _taskListeners = new Set();
  const _recordListeners = new Set();

  // Multi-tab real-time broadcast channel
  let _broadcastChannel = null;
  try {
    if (typeof BroadcastChannel !== "undefined") {
      _broadcastChannel = new BroadcastChannel("vyparx_live_sync");
      _broadcastChannel.onmessage = function (event) {
        if (!event || !event.data) return;
        if (event.data.type === "tasks_updated") {
          _cachedTasks = null;
          _lastTaskFetchTime = 0;
          _notifyTaskListeners();
        } else if (event.data.type === "records_updated") {
          if (event.data.module) _recordCache.delete(event.data.module);
          else _recordCache.clear();
          _notifyRecordListeners(event.data.module);
        }
      };
    }
  } catch (e) {
    /* BroadcastChannel unsupported or restricted */
  }

  // Cross-tab storage event fallback
  try {
    global.addEventListener("storage", function (e) {
      if (e.key === "vyparx_tasks_sync_trigger") {
        _cachedTasks = null;
        _lastTaskFetchTime = 0;
        _notifyTaskListeners();
      } else if (e.key === "vyparx_records_sync_trigger") {
        _recordCache.clear();
        _notifyRecordListeners();
      }
    });
  } catch (e) {}

  function _broadcastTaskChange() {
    try {
      if (_broadcastChannel) _broadcastChannel.postMessage({ type: "tasks_updated", time: Date.now() });
      localStorage.setItem("vyparx_tasks_sync_trigger", String(Date.now()));
    } catch (e) {}
    _notifyTaskListeners();
  }

  function _broadcastRecordChange(moduleName) {
    try {
      if (_broadcastChannel) _broadcastChannel.postMessage({ type: "records_updated", module: moduleName, time: Date.now() });
      localStorage.setItem("vyparx_records_sync_trigger", String(Date.now()));
    } catch (e) {}
    _notifyRecordListeners(moduleName);
  }

  function _notifyTaskListeners() {
    _taskListeners.forEach(function (cb) {
      try { cb(); } catch (err) { console.error("Task listener error:", err); }
    });
  }

  function _notifyRecordListeners(moduleName) {
    _recordListeners.forEach(function (cb) {
      try { cb(moduleName); } catch (err) { console.error("Record listener error:", err); }
    });
  }

  function normalizeTask(rawTask) {
    if (!rawTask) return null;
    const session = global.VyaparXAuth && global.VyaparXAuth.getCurrentSession();
    const myName = String((session && (session.fullName || session.name)) || "").trim().toLowerCase();
    const myUid = String((session && (session.userId || session.id)) || "").trim();
    const myDept = String((session && (session.department || session.headDepartment || session.role)) || "").trim().toLowerCase();

    const title = rawTask.title || rawTask.s || rawTask.subj || rawTask.subject || "";
    const desc = rawTask.description || rawTask.desc || rawTask.msg || rawTask.message || "";
    const priority = rawTask.priority || rawTask.p || "Medium";
    const due = rawTask.dueDate || rawTask.due || "";
    const status = rawTask.status || rawTask.st || "Pending";
    const to = rawTask.to || rawTask.assignedTo || "";
    const from = rawTask.from || rawTask.createdByName || "Admin";
    const td = rawTask.department || rawTask.td || rawTask.targetDepartment || "";
    const fd = rawTask.createdDepartment || rawTask.fd || "Administration";
    const type = rawTask.type || (rawTask.subj || rawTask.msg ? "Communication" : "Task");
    const comments = Array.isArray(rawTask.comments) ? rawTask.comments : [];
    const att = Array.isArray(rawTask.att) ? rawTask.att : (Array.isArray(rawTask.attachments) ? rawTask.attachments : (rawTask.att ? [rawTask.att] : []));
    const today = dateKey(new Date());
    const hist = Array.isArray(rawTask.hist) ? rawTask.hist : (Array.isArray(rawTask.history) ? rawTask.history : [[due || today, `${type} created`]]);
    const isRead = Boolean(rawTask.isRead || rawTask.read);

    // Direction calculation
    const senderMatch = (myUid && String(rawTask.createdBy || "") === myUid) ||
                        (myName && String(from).trim().toLowerCase() === myName);
    const dir = rawTask.dir || (senderMatch ? "Sent" : "Received");

    return {
      ...rawTask,
      id: String(rawTask.id || ""),
      title: title,
      s: title,
      subj: title,
      description: desc,
      desc: desc,
      msg: desc,
      priority: priority,
      p: priority,
      dueDate: due,
      due: due,
      status: status,
      st: status,
      to: to,
      assignedTo: to,
      from: from,
      createdByName: from,
      department: td,
      td: td,
      createdDepartment: fd,
      fd: fd,
      type: type,
      att: att,
      attachments: att,
      hist: hist,
      history: hist,
      comments: comments,
      read: isRead,
      isRead: isRead,
      dir: dir,
      ca: rawTask.ca || (rawTask.createdAt ? String(rawTask.createdAt).slice(0, 10) : today),
      ua: rawTask.ua || (rawTask.updatedAt ? String(rawTask.updatedAt).slice(0, 10) : today),
    };
  }

  const Tasks = {
    async fetchTasks(options) {
      const force = Boolean(options && options.force);
      const now = Date.now();
      if (!force && _cachedTasks && (now - _lastTaskFetchTime < TASK_CACHE_TTL)) {
        return _cachedTasks;
      }
      if (_taskFetchPromise) return _taskFetchPromise;

      if (!global.VyaparXAuth || !global.VyaparXAuth.fetchTasks) {
        return _cachedTasks || [];
      }

      _taskFetchPromise = (async function () {
        try {
          const list = await global.VyaparXAuth.fetchTasks();
          _cachedTasks = (list || []).map(normalizeTask).filter(Boolean);
          _lastTaskFetchTime = Date.now();
          return _cachedTasks;
        } catch (err) {
          console.warn("VyaparXShared: fetchTasks failed:", err.message);
          return _cachedTasks || [];
        } finally {
          _taskFetchPromise = null;
        }
      })();

      return _taskFetchPromise;
    },

    getTasksCache() {
      return _cachedTasks || [];
    },

    async createTask(taskData) {
      if (_taskSubmitting) {
        throw new Error("Task creation already in progress. Please wait.");
      }
      if (!global.VyaparXAuth || !global.VyaparXAuth.createTask) {
        throw new Error("Task service unavailable.");
      }
      _taskSubmitting = true;
      try {
        const res = await global.VyaparXAuth.createTask(taskData);
        const created = normalizeTask((res && res.task) || { ...taskData, id: (res && res.id) || ("t_" + Date.now()) });
        if (_cachedTasks) {
          _cachedTasks = [created, ..._cachedTasks.filter((t) => t.id !== created.id)];
        }
        _broadcastTaskChange();
        return created;
      } finally {
        _taskSubmitting = false;
      }
    },

    async updateTask(taskId, updates) {
      if (!taskId) throw new Error("Task ID is required.");
      if (!global.VyaparXAuth || !global.VyaparXAuth.updateTask) {
        throw new Error("Task update service unavailable.");
      }
      const res = await global.VyaparXAuth.updateTask(taskId, updates);
      const updated = normalizeTask((res && res.task) || { id: taskId, ...updates });
      if (_cachedTasks) {
        _cachedTasks = _cachedTasks.map((t) => (t.id === taskId ? { ...t, ...updated } : t));
      }
      _broadcastTaskChange();
      return updated;
    },

    async deleteTask(taskId) {
      if (!taskId) throw new Error("Task ID is required.");
      if (!global.VyaparXAuth || !global.VyaparXAuth.deleteTask) {
        throw new Error("Task deletion service unavailable.");
      }
      await global.VyaparXAuth.deleteTask(taskId);
      if (_cachedTasks) {
        _cachedTasks = _cachedTasks.filter((t) => t.id !== taskId);
      }
      _broadcastTaskChange();
      return true;
    },

    async addComment(taskId, commentText) {
      return this.updateTask(taskId, { comment: commentText });
    },

    onTasksUpdated(callback) {
      if (typeof callback === "function") {
        _taskListeners.add(callback);
        return () => _taskListeners.delete(callback);
      }
      return () => {};
    },
  };

  const Records = {
    markPersisted(moduleName, recordType, row) {
      const key = String(moduleName || "").toLowerCase();
      const pageState = _recordPageStates.get(key);
      if (!pageState || !row || !row.id) return false;
      const binding = pageState.bindings.find((item) => item.recordType === recordType);
      if (!binding) return false;
      const payload = pageState.payloadFor(binding, row);
      const stateKey = pageState.stateKey(binding, payload.id);
      pageState.base.set(stateKey, pageState.signature(payload));
      pageState.retry.delete(stateKey);
      _recordCache.delete(key);
      _broadcastRecordChange(key);
      return true;
    },

    markDeleted(moduleName, recordType, recordId) {
      const key = String(moduleName || "").toLowerCase();
      const pageState = _recordPageStates.get(key);
      if (!pageState || !recordId) return false;
      const stateKey = `${recordType}:${String(recordId)}`;
      pageState.base.delete(stateKey);
      pageState.retry.delete(stateKey);
      _recordCache.delete(key);
      _broadcastRecordChange(key);
      return true;
    },

    async bindPageState(moduleName, bindings, options) {
      const key = String(moduleName || "").toLowerCase();
      const config = options || {};
      const api = global.VyaparXAuth;
      const base = new Map();
      const retry = new Map();
      const notified = new Set();
      let ready = false;
      let disposed = false;
      let busy = false;
      let timer = null;
      let requestId = 0;

      const stable = (value) => {
        if (Array.isArray(value)) return value.map(stable);
        if (value && typeof value === "object") {
          return Object.keys(value).sort().reduce((result, name) => {
            if (value[name] !== undefined) result[name] = stable(value[name]);
            return result;
          }, {});
        }
        return value;
      };
      const signature = (value) => JSON.stringify(stable(value));
      const stateKey = (binding, id) => `${binding.recordType}:${String(id)}`;
      const payloadFor = (binding, value) => {
        const payload = binding.toRecord
          ? binding.toRecord(value)
          : { ...value };
        payload.id = String(value.id ?? payload.id ?? "");
        payload.recordType = binding.recordType;
        if (value.st !== undefined) payload.status = value.st;
        else if (payload.status === undefined && value.status !== undefined) payload.status = value.status;
        if (value.date || value.ca || value.createdAt || value.od || value.dp) {
          payload.date = value.date || value.ca || value.createdAt || value.od || value.dp;
        }
        if (value.n || value.name) payload.name = value.n || value.name;
        if (!payload.number && payload.id) payload.number = payload.id;
        if (payload.total == null && value.qty != null && value.rate != null) {
          payload.total = Number(value.qty || 0) * Number(value.rate || 0);
        }
        delete payload.companyId;
        delete payload.module;
        delete payload.createdBy;
        delete payload.updatedAt;
        return payload;
      };
      const pageState = { base, retry, bindings: bindings || [], payloadFor, stateKey, signature };
      _recordPageStates.set(key, pageState);
      const reportError = (error, id) => {
        const errorKey = String(id || key);
        if (notified.has(errorKey)) return;
        notified.add(errorKey);
        console.error(`VyaparX ${key} record sync failed:`, error);
        if (typeof config.onError === "function") {
          try { config.onError(error); } catch (callbackError) {
            console.error(`VyaparX ${key}   record error callback failed:`, callbackError);
          }
        }
      };
      const notify = (name) => {
        if (typeof config[name] !== "function") return;
        try { config[name](); } catch (error) {
          console.error(`VyaparX ${key} record ${name} callback failed:`, error);
        }
      };
      const identifyMissing = (binding, rows) => {
        rows.forEach((row) => {
          if (!row || typeof row !== "object") return;
          if (!row.id) {
            requestId += 1;
            row.id = `VX-${binding.recordType}-${Date.now()}-${requestId}`;
          }
        });
        return rows;
      };
      const mapCurrent = (binding) => {
        const rows = binding.get();
        if (!Array.isArray(rows)) return [];
        identifyMissing(binding, rows);
        return rows.filter((row) => row && typeof row === "object")
          .map((row) => ({ row, payload: payloadFor(binding, row) }))
          .filter(({ payload }) => payload.id);
      };

      // Never present bundled demo arrays as company data while the initial
      // company-scoped Firestore read is in progress.
      (bindings || []).forEach((binding) => binding.set([]));
      if (!api || typeof api.fetchModuleRecords !== "function") {
        reportError(new Error("Authenticated Firestore record service is unavailable."));
        if (_recordPageStates.get(key) === pageState) _recordPageStates.delete(key);
        return { ready: false, dispose() {} };
      }

      const seedFromServer = async () => {
        if (disposed || busy) return false;
        busy = true;
        try {
          const records = await api.fetchModuleRecords(key);
          base.clear();
          (bindings || []).forEach((binding) => {
            const serverRows = records.filter((record) =>
              record && record.recordType === binding.recordType && !record.isDeleted,
            ).map((record) => binding.fromRecord
              ? binding.fromRecord({ ...record })
              : { ...record });
            const rows = [...serverRows];
            // Do not resurrect browser demo or stale local rows that are not in
            // the company-scoped Firestore result. Only server rows are trusted.
            binding.set(rows);
            serverRows.forEach((row) => {
              const payload = payloadFor(binding, row);
              base.set(stateKey(binding, payload.id), signature(payload));
            });
          });
          ready = true;
          retry.clear();
          notified.clear();
          notify("onReady");
          return true;
        } catch (error) {
          reportError(error);
          return false;
        } finally {
          busy = false;
        }
      };

      const syncChanges = async () => {
        if (!ready || disposed || busy || global.document?.visibilityState === "hidden") return false;
        busy = true;
        let allSynced = true;
        let changed = false;
        try {
          const seen = new Set();
          const pending = [];
          (bindings || []).forEach((binding) => {
            mapCurrent(binding).forEach(({ row, payload }) => {
              const k = stateKey(binding, payload.id);
              seen.add(k);
              const nextSignature = signature(payload);
              if (base.get(k) === nextSignature) return;
              const attemptAt = retry.get(k) || 0;
              if (Date.now() < attemptAt) {
                allSynced = false;
                return;
              }
              pending.push({ binding, row, payload, k, nextSignature, exists: base.has(k) });
            });
          });

          const changes = pending.map(async (change) => {
            try {
              const result = change.exists
                ? await api.saveModuleRecord(key, change.payload)
                : await api.createModuleRecord(key, change.payload);
              if (!result || result.success === false || !result.record) {
                throw new Error("The server did not confirm the saved record.");
              }
              Object.assign(change.row, result.record);
              base.set(change.k, signature(payloadFor(change.binding, change.row)));
              retry.delete(change.k);
              notified.delete(change.k);
              changed = true;
            } catch (error) {
              allSynced = false;
              const previous = retry.get(change.k) || 0;
              const delay = previous > Date.now()
                ? Math.min(Math.max((previous - Date.now()) * 2, 1000), 30000)
                : 1000;
              retry.set(change.k, Date.now() + delay);
              reportError(error, change.k);
            }
          });

          const deletions = [];
          base.forEach((_, k) => {
            if (seen.has(k)) return;
            const attemptAt = retry.get(k) || 0;
            if (Date.now() < attemptAt) {
              allSynced = false;
              return;
            }
            const separator = k.indexOf(":");
            const recordId = k.slice(separator + 1);
            deletions.push((async () => {
              try {
                await api.deleteModuleRecord(key, recordId);
                base.delete(k);
                retry.delete(k);
                notified.delete(k);
                changed = true;
              } catch (error) {
                allSynced = false;
                retry.set(k, Date.now() + 2000);
                reportError(error, k);
              }
            })());
          });
          await Promise.all([...changes, ...deletions]);
          if (changed) {
            _recordCache.delete(key);
            _broadcastRecordChange(key);
            notify("onChange");
          }
          return allSynced;
        } finally {
          busy = false;
        }
      };

      let refreshTimer = null;
      let initialRetryTimer = null;
      const startWatch = () => {
        if (disposed || !ready || timer) return;
        timer = global.setTimeout(tick, 350);
        global.addEventListener("focus", refresh);
        refreshTimer = global.setInterval(() => {
          if (global.document?.visibilityState === "visible") refresh();
        }, 30000);
      };
      const tick = async () => {
        timer = null;
        await syncChanges();
        if (!disposed) timer = global.setTimeout(tick, 650);
      };
      const refresh = async () => {
        if (!ready) {
          if (await seedFromServer()) {
            global.removeEventListener("focus", refresh);
            if (initialRetryTimer) global.clearInterval(initialRetryTimer);
            initialRetryTimer = null;
            startWatch();
          }
          return;
        }
        if (await syncChanges()) await seedFromServer();
      };
      const firstReadSucceeded = await seedFromServer();
      if (firstReadSucceeded) {
        startWatch();
      } else {
        // Retry the initial read on focus and periodically. Writes remain
        // disabled until an authenticated server snapshot has been loaded.
        global.addEventListener("focus", refresh);
        initialRetryTimer = global.setInterval(refresh, 5000);
      }
      return {
        get ready() { return ready; },
        dispose() {
          disposed = true;
          if (_recordPageStates.get(key) === pageState) _recordPageStates.delete(key);
          if (timer) global.clearTimeout(timer);
          if (refreshTimer) global.clearInterval(refreshTimer);
          if (initialRetryTimer) global.clearInterval(initialRetryTimer);
          global.removeEventListener("focus", refresh);
        },
      };
    },

    async fetchRecords(moduleName, options) {
      const force = Boolean(options && options.force);
      const key = String(moduleName || "").toLowerCase();
      const now = Date.now();
      const cached = _recordCache.get(key);
      if (!force && cached && (now - cached.time < RECORD_CACHE_TTL)) {
        return cached.data;
      }

      if (_recordFetchPromises.has(key)) {
        return _recordFetchPromises.get(key);
      }

      if (!global.VyaparXAuth || !global.VyaparXAuth.fetchModuleRecords) {
        return cached ? cached.data : [];
      }

      const promise = (async function () {
        try {
          const records = await global.VyaparXAuth.fetchModuleRecords(key);
          const cleanRecords = (records || []).filter((r) => r && !r.isDeleted);
          _recordCache.set(key, { data: cleanRecords, time: Date.now() });
          return cleanRecords;
        } catch (err) {
          console.warn(`VyaparXShared: fetchRecords(${key}) failed:`, err.message);
          return cached ? cached.data : [];
        } finally {
          _recordFetchPromises.delete(key);
        }
      })();

      _recordFetchPromises.set(key, promise);
      return promise;
    },

    async saveRecord(moduleName, record) {
      const key = String(moduleName || "").toLowerCase();
      if (!global.VyaparXAuth || !global.VyaparXAuth.saveModuleRecord) {
        throw new Error("Record service unavailable.");
      }
      const res = await global.VyaparXAuth.saveModuleRecord(key, record);
      const saved = (res && res.record) || record;
      _recordCache.delete(key);
      _broadcastRecordChange(key);
      return saved;
    },

    async deleteRecord(moduleName, recordId) {
      const key = String(moduleName || "").toLowerCase();
      if (!global.VyaparXAuth || !global.VyaparXAuth.deleteModuleRecord) {
        throw new Error("Record deletion service unavailable.");
      }
      await global.VyaparXAuth.deleteModuleRecord(key, recordId);
      _recordCache.delete(key);
      _broadcastRecordChange(key);
      return true;
    },

    invalidate(moduleName) {
      if (moduleName) _recordCache.delete(String(moduleName).toLowerCase());
      else _recordCache.clear();
    },

    onRecordsUpdated(callback) {
      if (typeof callback === "function") {
        _recordListeners.add(callback);
        return () => _recordListeners.delete(callback);
      }
      return () => {};
    },
  };

  let _companyPeopleCache = null;
  let _companyPeopleFetchedAt = 0;
  let _companyPeoplePromise = null;
  async function getCompanyPeople(options) {
    const force = Boolean(options && options.force);
    if (!force && _companyPeopleCache && Date.now() - _companyPeopleFetchedAt < 30000) {
      return _companyPeopleCache;
    }
    if (_companyPeoplePromise) return _companyPeoplePromise;
    _companyPeoplePromise = (async function () {
      try {
        if (!global.VyaparXAuth) return [];
        let users = global.VyaparXAuth.getCompanyUsers();
        if (!users || !users.length || force) {
          users = await global.VyaparXAuth.refreshCompanyUsers();
        }
        _companyPeopleCache = (users || [])
          .filter((u) => (u.status === "ACTIVE" || u.isActive !== false) && u.headDepartment)
          .map((u) => ({
            n: u.fullName || u.name || u.email,
            d: u.headDepartment,
            e: u.email || "",
            id: u.id || u.userId || "",
          }));
        _companyPeopleFetchedAt = Date.now();
        return _companyPeopleCache;
      } catch (e) {
        return _companyPeopleCache || [];
      } finally {
        _companyPeoplePromise = null;
      }
    })();
    return _companyPeoplePromise;
  }

  function debounce(fn, delayMs) {
    let timer = null;
    return function (...args) {
      if (timer) clearTimeout(timer);
      timer = setTimeout(() => {
        timer = null;
        fn.apply(this, args);
      }, delayMs || 250);
    };
  }

  function toggleMobileNav(force) {
    const open = typeof force === "boolean"
      ? force
      : !document.body.classList.contains("open");
    document.body.classList.toggle("open", open);
    document.body.style.overflow = open && global.matchMedia("(max-width: 1024px)").matches ? "hidden" : "";
    const button = document.getElementById("mb");
    if (button) button.setAttribute("aria-expanded", open ? "true" : "false");
    return open;
  }

  const departmentTeam = {
    canManage(moduleName) {
      const session = global.VyaparXAuth?.getCurrentSession?.() || {};
      if (String(session.role || "").toLowerCase() === "admin") return true;
      const normalize = (value) => String(value || "").toLowerCase().replace(/[^a-z0-9]/g, "");
      const aliases = {
        crm: ["crm"], sales: ["salesorder", "sales"], purchase: ["purchasetrading", "purchase"],
        inventory: ["inventory"], production: ["production"], transport: ["transport"],
        accounting: ["accounting", "accountingfinance", "finance"],
      };
      return (aliases[String(moduleName || "").toLowerCase()] || []).includes(normalize(session.headDepartment));
    },
    createMember(moduleName, fields) {
      const session = global.VyaparXAuth?.getCurrentSession?.() || {};
      const key = String(moduleName || "").toLowerCase();
      const departments = {
        crm: "CRM", sales: "Sales Order", purchase: "Purchase & Trading", inventory: "Inventory",
        production: "Production", transport: "Transport", accounting: "Accounting",
      };
      const id = `TM-${global.crypto?.randomUUID?.() || `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`}`;
      return {
        id, eid: id, recordType: "teamMember", departmentKey: key, department: departments[key] || key,
        departmentHeadId: String(session.id || session.userId || ""),
        departmentHeadName: session.fullName || session.name || "", r: "Employee", status: "ACTIVE", isActive: true,
        photo: null, ...fields,
      };
    },
  };

  initTheme();
  document.addEventListener("DOMContentLoaded", function () {
    bindToggle();
    bindEmployeeProfileRefresh();
    loadCompanyProfile();
    loadEmployeeProfile();
    const menuButton = document.getElementById("mb");
    if (menuButton) menuButton.setAttribute("aria-expanded", "false");
    document.addEventListener("click", function (event) {
      if (!document.body.classList.contains("open")) return;
      if (event.target === document.body || event.target.closest("aside .nav, aside a")) {
        toggleMobileNav(false);
      }
    });
    document.addEventListener("keydown", function (event) {
      if (event.key === "Escape" && document.body.classList.contains("open")) {
        toggleMobileNav(false);
        document.getElementById("mb")?.focus();
      }
    });
    global.addEventListener("resize", function () {
      if (!global.matchMedia("(max-width: 1024px)").matches) toggleMobileNav(false);
    });
    global.addEventListener("focus", loadEmployeeProfile);
    // Preload company tasks in background for instant responsiveness
    if (global.VyaparXAuth && global.VyaparXAuth.getCurrentSession()) {
      Tasks.fetchTasks().catch(() => {});
      getCompanyPeople().catch(() => {});
    }
  });

  global.VyaparXShared = {
    formatDate: formatDate,
    dateKey: dateKey,
    dateSortKey: dateSortKey,
    sortRowsByDate: sortRowsByDate,
    applyTheme: applyTheme,
    currentTheme: currentTheme,
    initTheme: initTheme,
    bindToggle: bindToggle,
    toggleMobileNav: toggleMobileNav,
    loadCompanyProfile: loadCompanyProfile,
    loadEmployeeProfile: loadEmployeeProfile,
    getCompanyProfile: cacheCompany,
    tasks: Tasks,
    records: Records,
    departmentTeam: departmentTeam,
    getCompanyPeople: getCompanyPeople,
    debounce: debounce,
  };
})(typeof window !== "undefined" ? window : globalThis);
