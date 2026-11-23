/**
 * VyaparX ERP - Firebase client auth + Django RBAC bridge.
 * Passwords and Firebase ID tokens are never stored by this file.
 */

(function (global) {
  "use strict";

  const API_BASE = "https://vyparx-manufacturing-erp.onrender.com";
  const SESSION_KEY = "vyparx_secure_session";
  const USER_CACHE_KEY = "vyparx_company_users_cache";

  const FIREBASE_APP =
    "https://www.gstatic.com/firebasejs/10.12.4/firebase-app-compat.js";
  const FIREBASE_AUTH =
    "https://www.gstatic.com/firebasejs/10.12.4/firebase-auth-compat.js";

  const ROLES = {
    ADMIN: "Admin",
    CRM: "CRM",
    SALES: "Sales",
    PURCHASE: "Purchase",
    INVENTORY: "Inventory",
    PRODUCTION: "Production",
    QUALITY_CONTROL: "Quality Control",
    TRANSPORT: "Transport",
    EMPLOYEE_MANAGEMENT: "Employee Management",
    ACCOUNTING_FINANCE: "Accounting & Finance",
  };

  const ROLE_DASHBOARDS = {
    [ROLES.ADMIN]: "admin.html",
    [ROLES.CRM]: "CRM.html",
    [ROLES.SALES]: "sales.html",
    [ROLES.PURCHASE]: "purchese.html",
    [ROLES.INVENTORY]: "inventory.html",
    [ROLES.PRODUCTION]: "producation.html",
    [ROLES.QUALITY_CONTROL]: "producation.html",
    [ROLES.TRANSPORT]: "transport.html",
    [ROLES.EMPLOYEE_MANAGEMENT]: "admin.html",
    [ROLES.ACCOUNTING_FINANCE]: "accounting.html",
  };

  let firebaseAuthPromise = null;
  const scriptPromises = new Map();

  // In-flight de-duplication for module data GETs. When several module
  // screens/bootstraps request the same module at once (dashboard + catalog +
  // custom-fields + quotations), they share ONE request instead of firing 2-4
  // identical Firestore-backed fetches. Results are not cached beyond the
  // in-flight window, so business data is never stale - each new call after
  // completion re-fetches fresh data.
  const _moduleFetchInflight = new Map();

  async function fetchModuleRecordsDeduped(moduleName) {
    const key = String(moduleName || "").toLowerCase();
    if (_moduleFetchInflight.has(key)) return _moduleFetchInflight.get(key);
    const promise = apiFetch(`/api/modules/${encodeURIComponent(key)}/data`, { method: "GET" })
      .then((data) => data.records || [])
      .finally(() => _moduleFetchInflight.delete(key));
    _moduleFetchInflight.set(key, promise);
    return promise;
  }

  function normalizeRole(roleStr) {
    if (!roleStr) return "";

    const clean = String(roleStr).trim().toLowerCase();

    if (clean === "admin") return ROLES.ADMIN;
    if (clean.includes("crm")) return ROLES.CRM;
    if (clean.includes("sales")) return ROLES.SALES;
    if (clean.includes("purchase")) return ROLES.PURCHASE;
    if (clean.includes("inventory")) return ROLES.INVENTORY;
    if (clean.includes("quality") || clean === "qc") {
      return ROLES.QUALITY_CONTROL;
    }
    if (clean.includes("production")) return ROLES.PRODUCTION;
    if (clean.includes("transport")) return ROLES.TRANSPORT;
    if (clean.includes("employee") || clean.includes("hr")) {
      return ROLES.EMPLOYEE_MANAGEMENT;
    }
    if (clean.includes("account") || clean.includes("finance")) {
      return ROLES.ACCOUNTING_FINANCE;
    }

    return String(roleStr).trim();
  }

  function loadScript(src) {
    if (scriptPromises.has(src)) {
      return scriptPromises.get(src);
    }

    const promise = new Promise((resolve, reject) => {
      const existing = Array.from(document.scripts).find(
        (script) => script.src === src
      );

      if (existing && existing.dataset.loaded === "true") {
        resolve();
        return;
      }

      const script = existing || document.createElement("script");

      script.onload = function () {
        script.dataset.loaded = "true";
        resolve();
      };

      script.onerror = function () {
        scriptPromises.delete(src);
        reject(
          new Error(
            "Unable to load Firebase Authentication scripts. Check your internet connection."
          )
        );
      };

      if (!existing) {
        script.src = src;
        document.head.appendChild(script);
      }
    });

    scriptPromises.set(src, promise);
    return promise;
  }

  async function parseResponse(response) {
    const data = await response.json().catch(() => ({}));

    if (!response.ok) {
      const flattenDetails = (value, path = "") => {
        if (Array.isArray(value)) return value.map((item) => flattenDetails(item, path)).filter(Boolean).join("; ");
        if (value && typeof value === "object") return Object.entries(value).map(([key, item]) => flattenDetails(item, path ? `${path}.${key}` : key)).filter(Boolean).join("; ");
        if (value == null || value === "") return "";
        return `${path ? `${path}: ` : ""}${String(value)}`;
      };
      const details = flattenDetails(data.fields || data.detail || data.errors || data.error);
      const message = typeof data.error === "string" ? data.error : "Request failed.";
      const error = new Error(details && details !== message ? `${message} ${details}` : details || message);
      error.status = response.status;
      error.data = data;
      throw error;
    }

    return data;
  }

  async function apiRequest(path, options) {
    let response;
    const requestOptions = options || {};
    const headers = { ...(requestOptions.headers || {}) };
    const isFormData = typeof FormData !== "undefined" && requestOptions.body instanceof FormData;
    if (requestOptions.body != null && !isFormData && !Object.keys(headers).some((key) => key.toLowerCase() === "content-type")) {
      headers["Content-Type"] = "application/json";
    }

    try {
      response = await fetch(`${API_BASE}${path}`, {
        ...requestOptions,
        headers,
      });
    } catch (error) {
      throw new Error(
        "Unable to connect to the VyaparX backend. Check whether Django is running."
      );
    }

    return parseResponse(response);
  }

  async function ensureFirebase() {
    if (firebaseAuthPromise) {
      try {
        return await firebaseAuthPromise;
      } catch (error) {
        firebaseAuthPromise = null;
        throw error;
      }
    }

    firebaseAuthPromise = (async function () {
      if (global.firebase && global.firebase.apps.length) {
        return global.firebase.auth();
      }

      const configData = await apiRequest(
        "/api/auth/firebase-config",
        { method: "GET" }
      );

      if (
        !configData.configured ||
        !configData.config ||
        !configData.config.apiKey ||
        !configData.config.authDomain ||
        !configData.config.projectId ||
        !configData.config.appId
      ) {
        throw new Error(
          "Firebase Web Config is incomplete. Check the backend .env file."
        );
      }

      await loadScript(FIREBASE_APP);
      await loadScript(FIREBASE_AUTH);

      if (!global.firebase.apps.length) {
        global.firebase.initializeApp(configData.config);
      }

      const auth = global.firebase.auth();

      await auth.setPersistence(
        global.firebase.auth.Auth.Persistence.SESSION
      );

      return auth;
    })();

    try {
      return await firebaseAuthPromise;
    } catch (error) {
      firebaseAuthPromise = null;
      throw error;
    }
  }

  async function currentIdToken(forceRefresh) {
    const auth = await ensureFirebase();
    const user = auth.currentUser;

    if (!user) {
      throw new Error("You must sign in again.");
    }

    return user.getIdToken(Boolean(forceRefresh));
  }

  async function apiFetch(path, options) {
    const token = await currentIdToken();

    return apiRequest(path, {
      ...(options || {}),
      headers: {
        Authorization: `Bearer ${token}`,
        ...((options && options.headers) || {}),
      },
    });
  }

  let _meFetchPromise = null;

  function saveSession(user) {
    const session = {
      ...user,
      loggedInAt: new Date().toISOString(),
    };

    sessionStorage.setItem(SESSION_KEY, JSON.stringify(session));
    return session;
  }

  function getCachedUsers() {
    try {
      return JSON.parse(sessionStorage.getItem(USER_CACHE_KEY)) || [];
    } catch (error) {
      return [];
    }
  }

  const Auth = {
    ROLES,
    ROLE_DASHBOARDS,
    normalizeRole,

    async registerCompany(registrationData) {
      if (!registrationData || !registrationData.personal || !registrationData.business) {
        throw new Error("Registration information is incomplete.");
      }
      const personal = registrationData.personal;
      const business = registrationData.business;
      // Django provisions the Firebase email/password identity and commits its
      // company and membership records. Send one normalized contract; never
      // create a second identity in the browser.
      const payload = {
        companyName: business.companyName,
        registeredBusinessName: business.registeredBusinessName || business.companyName,
        gstin: business.gstin || "",
        businessType: business.businessType || "",
        industry: business.industry || "",
        employees: business.employees || "",
        businessLocation: business.businessLocation || "",
        ownerName: personal.fullName,
        email: personal.email,
        phone: `${personal.countryCode || ""}${personal.mobile || ""}`,
        address: personal.address,
        country: personal.country,
        state: personal.state,
        pinCode: personal.pinCode,
        password: personal.adminPassword,
        confirmPassword: personal.confirmPassword,
        requirements: registrationData.requirements || {},
      };
      return apiRequest("/api/auth/register", {
        method: "POST",
        body: JSON.stringify(payload),
      });
    },

    async login(emailInput, passwordInput, selectedRoleInput) {
      if (!emailInput || !passwordInput || !selectedRoleInput) {
        throw new Error(
          "Email, password, and role selection are all required."
        );
      }

      const auth = await ensureFirebase();

      let credential;

      try {
        credential = await auth.signInWithEmailAndPassword(
          emailInput.trim().toLowerCase(),
          passwordInput
        );
      } catch (error) {
        if (error.code === "auth/network-request-failed") {
          throw new Error(
            "Unable to connect to Firebase. Check your internet connection."
          );
        }

        throw new Error("Invalid email or password.");
      }

      try {
        const idToken = await credential.user.getIdToken(true);

        const result = await apiRequest("/api/auth/login", {
          method: "POST",
          headers: {
            Authorization: `Bearer ${idToken}`,
          },
          body: JSON.stringify({
            idToken: idToken,
            role: selectedRoleInput,
          }),
        });

        const session = saveSession(result.user);

        return {
          success: true,
          session: session,
          dashboardUrl:
            result.dashboardUrl ||
            ROLE_DASHBOARDS[normalizeRole(session.role)] ||
            "admin.html",
        };
      } catch (error) {
        await auth.signOut().catch(() => {});
        throw error;
      }
    },

    getCurrentSession() {
      try {
        return JSON.parse(sessionStorage.getItem(SESSION_KEY)) || null;
      } catch (error) {
        return null;
      }
    },

    async refreshSession() {
      // De-duplicated: concurrent refreshSession() callers (page load + focus
      // handlers) share one /api/auth/me request instead of several.
      if (_meFetchPromise) return _meFetchPromise;
      _meFetchPromise = (async () => {
        const data = await apiFetch("/api/auth/me", { method: "GET" });
        return saveSession(data.user);
      })().finally(() => { _meFetchPromise = null; });
      return _meFetchPromise;
    },

    async logout() {
      sessionStorage.removeItem(SESSION_KEY);
      sessionStorage.removeItem(USER_CACHE_KEY);

      try {
        const auth = await ensureFirebase();
        await auth.signOut();
      } catch (error) {
        // Local session is cleared even if Firebase is unavailable.
      }
    },

    getCompanyUsers() {
      return getCachedUsers();
    },

    async refreshCompanyUsers() {
      const data = await apiFetch("/api/admin/users", {
        method: "GET",
      });

      sessionStorage.setItem(
        USER_CACHE_KEY,
        JSON.stringify(data.users || [])
      );

      return data.users || [];
    },

    async createDepartmentUser(userData) {
      const data = await apiFetch("/api/admin/users", {
        method: "POST",
        body: JSON.stringify(userData),
      });

      await this.refreshCompanyUsers();
      return data;
    },

    async updateUser(userId, updates) {
      const data = await apiFetch(
        `/api/admin/users/${encodeURIComponent(userId)}`,
        {
          method: "PUT",
          body: JSON.stringify(updates),
        }
      );

      await this.refreshCompanyUsers();
      return data;
    },

    /** Authenticated company profile (registration record = source of truth). */
    async apiFetchCompany() {
      const data = await apiFetch("/api/admin/company", { method: "GET" });
      return data.company || data;
    },

    async updateCompanyProfile(updates) {
      const data = await apiFetch("/api/admin/company", {
        method: "PUT",
        body: JSON.stringify(updates),
      });
      return data.company || data;
    },

    async assignDepartmentHead(userId, department) {
      return apiFetch("/api/admin/department-heads", {
        method: "POST",
        body: JSON.stringify({ user_id: userId, department }),
      });
    },

    async fetchDepartmentHeads() {
      const data = await apiFetch("/api/admin/department-heads", { method: "GET" });
      return data.heads || [];
    },

    async fetchTasks() {
      const data = await apiFetch("/api/admin/tasks", { method: "GET" });
      return data.tasks || [];
    },

    async createTask(taskData) {
      return apiFetch("/api/admin/tasks", {
        method: "POST",
        body: JSON.stringify(taskData),
      });
    },

    async updateTask(taskId, updates) {
      return apiFetch(`/api/admin/tasks/${encodeURIComponent(taskId)}`, {
        method: "PATCH",
        body: JSON.stringify(updates),
      });
    },

    async deleteTask(taskId) {
      return apiFetch(`/api/admin/tasks/${encodeURIComponent(taskId)}`, {
        method: "DELETE",
      });
    },

    async fetchModuleRecords(moduleName) {
      // De-duplicated concurrent GET: one shared request for the same module.
      return fetchModuleRecordsDeduped(moduleName);
    },

    async saveModuleRecord(moduleName, record) {
      const method = record && record.id ? "PUT" : "POST";
      return apiFetch(`/api/modules/${encodeURIComponent(moduleName)}/data`, {
        method,
        body: JSON.stringify(record || {}),
      });
    },

    // Explicit POST helper for idempotent create workflows with client-known IDs.
    async createModuleRecord(moduleName, record) {
      return apiFetch(`/api/modules/${encodeURIComponent(moduleName)}/data`, {
        method: "POST",
        body: JSON.stringify(record || {}),
      });
    },

    async postWorkflowAction(path, payload) {
      return apiFetch(path, { method: "POST", body: JSON.stringify(payload || {}) });
    },

    async getWorkflowData(path) {
      return apiFetch(path, { method: "GET" });
    },

    async getInventoryPurchaseOrders() {
      const data = await apiFetch("/api/inventory/purchase-orders", { method: "GET" });
      return data.records || [];
    },

    async deleteModuleRecord(moduleName, recordId) {
      return apiFetch(`/api/modules/${encodeURIComponent(moduleName)}/data?id=${encodeURIComponent(recordId)}`, {
        method: "DELETE",
      });
    },

    async uploadFile(file, folder) {
      if (!file) throw new Error("Choose a file to upload.");
      const token = await currentIdToken();
      const form = new FormData();
      form.append("file", file);
      form.append("folder", folder || "documents");
      let response;
      try {
        response = await fetch(`${API_BASE}/api/uploads`, {
          method: "POST",
          headers: { Authorization: `Bearer ${token}` },
          body: form,
        });
      } catch (error) {
        throw new Error("Unable to connect to the file upload service.");
      }
      return parseResponse(response);
    },

    async fetchAlerts() {
      const data = await apiFetch("/api/alerts", { method: "GET" });
      return data.alerts || [];
    },

    async pushAlert(alertData) {
      return apiFetch("/api/alerts", {
        method: "POST",
        body: JSON.stringify(alertData),
      });
    },

    async dismissAlert(alertId) {
      return apiFetch(`/api/alerts/${encodeURIComponent(alertId)}`, {
        method: "PATCH",
        body: JSON.stringify({ dismiss: true }),
      });
    },

    async toggleUserStatus(userId) {
      const users = getCachedUsers();

      const user = users.find(
        (item) => String(item.id) === String(userId)
      );

      const nextStatus =
        user && user.status === "ACTIVE" ? "INACTIVE" : "ACTIVE";

      return this.updateUser(userId, {
        status: nextStatus,
      });
    },

    async sendPasswordReset(email) {
      if (!email || !email.trim()) {
        throw new Error("Please enter your email address.");
      }

      const auth = await ensureFirebase();

      await auth.sendPasswordResetEmail(
        email.trim().toLowerCase()
      );

      return { success: true };
    },

    isAuthorizedForPage(requiredRole, currentSession) {
      if (!currentSession) return false;

      return (
        normalizeRole(currentSession.role) ===
        normalizeRole(requiredRole)
      );
    },
  };

  global.VyaparXAuth = Auth;
})(typeof window !== "undefined" ? window : globalThis);
