/**
 * VyaparX ERP - Sales Order Processing Controller
 * Manages Sales Orders, Customer Invoicing, Delivery Status, and Receipts.
 */

const $ = (s) => document.querySelector(s);
const esc = (s) =>
  String(s ?? "").replace(
    /[&<>"]/g,
    (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c],
  );
const ic = (p) =>
  `<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">${p}</svg>`;
const iso = (n) => {
    const d = new Date();
    d.setDate(d.getDate() + n);
    return window.VyaparXShared?.dateKey ? window.VyaparXShared.dateKey(d) : d.toISOString().slice(0, 10);
  },
  TODAY = iso(0);

function toast(t) {
  const e = $("#toast");
  e.textContent = t;
  e.classList.add("on");
  setTimeout(() => e.classList.remove("on"), 2400);
}

function dlg(h, ok, fn) {
  const m = document.createElement("div");
  m.className = "mask";
  const title = String(h).match(/^\s*<h3\b[\s\S]*?<\/h3>(?:\s*<p\b[\s\S]*?<\/p>)?/i);
  const header = `<div class="dlg-head">${title ? title[0] : ""}<button class="ic dlg-close" type="button" data-x aria-label="Close" title="Close">×</button></div>`;
  const body = title ? String(h).slice(title[0].length) : h;
  m.innerHTML = `<div class="dlg" role="dialog">${header}<div class="dlg-body">${body}</div><div class="a"><button class="btn" data-x>Cancel</button><button class="btn p" data-ok>${ok}</button></div></div>`;
  document.body.append(m);
  m.onclick = (e) => {
    if (e.target == m || e.target.dataset.x != null) m.remove();
    if (e.target.dataset.ok != null && fn(m) !== false) m.remove();
  };
}

const opts = (a, v) =>
  a.map((x) => `<option ${x == v ? "selected" : ""}>${x}</option>`).join("");

const vf = (rules) => {
  document.querySelectorAll(".fe").forEach((x) => x.remove());
  document.querySelectorAll("[aria-invalid]").forEach((x) => {
    x.style.borderColor = "";
    x.removeAttribute("aria-invalid");
  });

  let first = null;

  rules.forEach(([s, ok, m]) => {
    const f = $(s);

    if (!f) return;
    if (f.hasAttribute("aria-invalid") || ok(f.value.trim())) return;

    f.style.borderColor = "var(--er)";
    f.setAttribute("aria-invalid", "true");

    const e = document.createElement("small");
    e.className = "fe";
    e.style.color = "var(--er)";
    e.textContent = m;
    f.after(e);

    first = first || f;
  });

  if (first) first.focus();
  return !first;
};

document.addEventListener("input", (e) => {
  const t = e.target;
  if (t.hasAttribute && t.hasAttribute("aria-invalid")) {
    t.style.borderColor = "";
    t.removeAttribute("aria-invalid");

    const s = t.parentElement.querySelector(".fe");
    if (s) s.remove();
  }
});

const fs = (d) => {
  if (window.VyaparXShared?.formatDate) return window.VyaparXShared.formatDate(d);
  if (!d) return "—";

  const date = new Date(d);

  return Number.isNaN(date.getTime())
    ? "—"
    : date.toLocaleDateString("en-GB", {
        day: "2-digit",
        month: "2-digit",
        year: "numeric",
      });
};

function detail(secs) {
  const m = document.createElement("div");
  m.className = "mask vm";
  m.innerHTML = `<div class="dlg detail-dialog" role="dialog" aria-label="${secs[0][0]}"><button class="ic" data-x aria-label="Close" title="Close" style="position:absolute;top:12px;right:12px;z-index:3;display:inline-flex;align-items:center;justify-content:center;width:32px;height:32px;border:1px solid var(--bd);border-radius:50%;background:var(--card);color:var(--txt);cursor:pointer"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" aria-hidden="true"><path d="M6 6l12 12M18 6L6 18"/></svg></button>${secs.map(([t, r], i) => `<div style="margin-top:${i ? 18 : 0}px"><b style="font-weight:600;display:block;padding:0 ${i ? 0 : 36}px 6px 0;font-size:${i ? 14 : 16}px;border-bottom:1px solid var(--bd);margin-bottom:10px">${t}</b>${r ? `<div style="display:grid;grid-template-columns:130px minmax(0,1fr);gap:10px 16px">${r.map((x) => `<span style="color:var(--mut)">${x[0]}</span><span style="font-weight:500;overflow-wrap:anywhere">${x[1]}</span>`).join("")}</div>` : `<span style="color:var(--mut)">No activity yet.</span>`}</div>`).join("")}</div>`;

  document.body.append(m);

  m.onclick = (ev) => {
    if (ev.target == m || ev.target.closest("[data-x]")) m.remove();
  };
}

function table(cols, rows, o = {}) {
  const dateCols = cols
    .map((label, index) =>
      /date|follow.?up|due|valid until|^created$|created at|created on|^joined$|joined date|^dispatch$|^expected$/i.test(
        String(label).replace(/<[^>]*>/g, " ").trim(),
      )
        ? index
        : -1,
    )
    .filter((index) => index >= 0);

  const dateCol = dateCols[0] ?? -1;

  let f = rows.filter(
    (r) =>
      r.join(" ").toLowerCase().includes(q.toLowerCase()) &&
      (fv == "All" || r.includes(fv)),
  );

  if (sort) {
    if (dateCols.includes(sort.i) && window.VyaparXShared?.sortRowsByDate) {
      f = window.VyaparXShared.sortRowsByDate(f, sort.i, sort.d);
    } else {
      f = [...f].sort(
        (a, b) =>
          String(a[sort.i]).localeCompare(String(b[sort.i]), 0, {
            numeric: true,
          }) * sort.d,
      );
    }
  } else if (dateCol >= 0 && window.VyaparXShared?.sortRowsByDate) {
    f = window.VyaparXShared.sortRowsByDate(f, dateCol);
  }

  if (dateCol >= 0 && window.VyaparXShared?.formatDate) {
    f = f.map((row) =>
      row.map((value, index) =>
        dateCols.includes(index)
          ? window.VyaparXShared.formatDate(value)
          : value,
      ),
    );
  }

  return `<div class="card"><div class="bar"><input class="in" data-q placeholder="Search..." value="${esc(q)}" aria-label="Search table">${o.filter ? `<select class="in" data-f aria-label="Filter by status">${["All", ...o.filter].map((x) => `<option ${x == fv ? "selected" : ""}>${x}</option>`).join("")}</select>` : ""}</div><div class="tw"><table><thead><tr>${cols.map((c, i) => `<th data-s="${i}">${c}</th>`).join("")}${o.act ? `<th>Actions${o.colModule && window.VyaparXFields ? window.VyaparXFields.columnButton(o.colModule) : ""}</th>` : ""}</tr></thead><tbody>${f.length ? f.map((r) => `<tr>${r.map((c, i) => `<td>${/Status/.test(cols[i]) || /Priority/.test(cols[i]) ? st(c) : c}</td>`).join("")}${o.act ? `<td><span style="display:flex;gap:4px">${o.act(r)}</span></td>` : ""}</tr>`).join("") : `<tr><td colspan="12"><div class="empty">${o.empty || "No matching records."}<br><small>Records you add will appear here.</small></div></td></tr>`}</tbody></table></div></div>`;
}

document.addEventListener("keydown", (e) => {
  if (e.key == "Escape")
    document.querySelectorAll(".vm").forEach((m) => m.remove());
});

let ME =
  window.VyaparXAuth?.getCurrentSession?.()?.fullName ||
  window.VyaparXAuth?.getCurrentSession?.()?.name ||
  "";

let ROLE = "Department Head";

const inr = (n) => "\u20B9" + Number(n).toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

const PH = /^\d{10}$/;
const EM = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

const NAV = [
  [
    "SALES ORDER",
    [
      [
        "dashboard",
        "Dashboard",
        "<rect x='3' y='3' width='7' height='9'/><rect x='14' y='3' width='7' height='5'/><rect x='14' y='12' width='7' height='9'/><rect x='3' y='16' width='7' height='5'/>",
      ],
      [
        "orders",
        "Sales Orders",
        "<path d='M6 3h12l2 5v13H4V8z M4 8h16M9 12h6'/>",
      ],
      [
        "quotations",
        "CRM Quotations",
        "<path d='M7 3h8l4 4v14H7zM10 12h6M10 16h6'/>",
      ],
      ["catalog", "Product Catalog", "<path d='M4 5h16v14H4zM8 9h8M8 13h5'/>"],
      ["items", "Order Items", "<path d='M4 6h16M4 12h16M4 18h10'/>"],
      [
        "pending",
        "Pending Orders",
        "<circle cx='12' cy='12' r='9'/><path d='M12 7v5l3 2'/>",
      ],
      [
        "delivery",
        "Delivery Status",
        "<path d='M2 7h11v9H2zM13 10h5l3 3v3h-8zM6 19a1.5 1.5 0 100-3 1.5 1.5 0 000 3zM17 19a1.5 1.5 0 100-3 1.5 1.5 0 000 3z'/>",
      ],
      [
        "payments",
        "Payments",
        "<rect x='3' y='6' width='18' height='12' rx='2'/><path d='M3 10h18'/>",
      ],
      ["reports", "Reports", "<path d='M4 20V10M10 20V4M16 20v-7M22 20H2'/>"],
    ],
  ],
  [
    "COMMON",
    [
      [
        "team",
        "My Team",
        "<circle cx='8' cy='8' r='3'/><circle cx='17' cy='9' r='2.5'/><path d='M2 20c0-3 3-5 6-5s6 2 6 5M15 15c3 0 6 1 7 5'/>",
      ],
      [
        "tasks",
        "Tasks & Communication",
        "<rect x='4' y='4' width='16' height='16' rx='3'/><path d='M8 12l3 3 5-6'/>",
      ],
      [
        "notif",
        "Notifications",
        "<path d='M6 16V11a6 6 0 1112 0v5l2 2H4zM10 21h4'/>",
      ],
    ],
  ],
];

// Business records are loaded from authenticated, company-scoped APIs.
const CUST = {};
const INV = {};

const O = (n, crm, od, dd, adv, rec, s, ps, cb, items) => ({
  id: "SO-" + n,
  crm,
  od,
  dd,
  adv,
  rec,
  st: s,
  ps,
  cb,
  ca: od,
  items,
  hist: [[od, "Order created"]].concat(
    s == "DRAFT" ? [] : [[od, "Status: " + s.replace(/_/g, " ")]],
  ),
});

let ORD = [];

// Sales reads the same tenant-scoped quotation records created by CRM.
let SHARED_QUOTES = [];
let SALES_QUOTES_READY = false;
let SALES_QUOTES_LOADING = false;

let SALES_CUSTOMERS = [];
let SALES_CUSTOMERS_READY = false;
let SALES_CUSTOMER_ERROR = "";

const SALES_DATA_SIGNATURES = new Map();
const SALES_DATA_ERRORS = new Map();

const salesCustomerKey = (id) =>
  String(id || "").startsWith("CRM-")
    ? String(id)
    : "CRM-" + String(id || "");

const salesCustomerIsActive = (record) => {
  const recordType = String(record.recordType || "").toLowerCase();
  const type = String(record.type || "").toLowerCase();
  const status = String(record.status || record.st || "").toLowerCase();

  return (
    !record.isDeleted &&
    record.isActive !== false &&
    record.active !== false &&
    !["inactive", "deactivated", "archived", "deleted"].includes(status) &&
    (recordType === "customer" ||
      ((recordType === "" || recordType === "lead") && type === "customer"))
  );
};

const salesQuoteIsApproved = (quote) =>
  ["approved", "accepted"].includes(
    String(quote?.status || "").trim().toLowerCase(),
  );

const salesQuoteIsPending = (quote) =>
  ["pending", "draft", "pending approval", "sent"].includes(
    String(quote?.status || "").trim().toLowerCase(),
  );

const salesQuoteStatusLabel = (status) => {
  const value = String(status || "Pending").trim();
  const normalized = value.toLowerCase();

  if (["approved", "accepted"].includes(normalized)) return "Approved";
  if (["pending", "draft", "pending approval", "sent"].includes(normalized))
    return "Pending";

  return value;
};

/*
 * FIX 1:
 * These functions must be in the global scope.
 * Do not place them inside appendConvertedOrder().
 */
function salesHistoryForUI(history) {
  if (!Array.isArray(history)) return [];

  return history
    .map((entry) => {
      if (Array.isArray(entry)) {
        return [String(entry[0] ?? ""), String(entry[1] ?? "")];
      }

      if (entry && typeof entry === "object") {
        return [
          String(entry.date || entry.createdAt || ""),
          String(entry.activity || entry.message || ""),
        ];
      }

      return null;
    })
    .filter(Boolean);
}

function salesHistoryForFirestore(history) {
  return salesHistoryForUI(history).map(([date, activity]) => ({
    date,
    activity,
  }));
}

function appendConvertedOrder(order) {
  if (!order) return;

  const normalized = salesOrderFromRecord(order);

  const existingIndex = ORD.findIndex(
    (item) => String(item.id) === String(normalized.id),
  );

  if (existingIndex >= 0) {
    ORD[existingIndex] = normalized;
  } else {
    ORD.push(normalized);
  }
}

let SALES_SHARED_LOADING = null;
let SALES_SHARED_ACTIVE_MODULES = new Set();
const SALES_SHARED_REFRESH_PENDING = new Set();

function salesDataChanged(moduleName, records) {
  const companyId =
    window.VyaparXAuth?.getCurrentSession?.()?.companyId || "current-session";

  const key = `${companyId}:${moduleName}`;
  const signature = JSON.stringify(records || []);

  if (SALES_DATA_SIGNATURES.get(key) === signature) return false;

  SALES_DATA_SIGNATURES.set(key, signature);
  return true;
}

function refreshOpenOrderCustomerOptions() {
  const select = document.querySelector(".mask #oc");
  if (!select) return;

  const selected = select.value;

  const options = new Map(
    SALES_CUSTOMERS.map((customer) => [
      salesCustomerKey(customer.id),
      customer.name,
    ]),
  );

  if (
    select.dataset.keepHistorical === "true" &&
    selected &&
    !options.has(selected)
  ) {
    options.set(selected, CUST[selected] || selected);
  }

  select.disabled =
    !SALES_CUSTOMERS_READY || Boolean(SALES_CUSTOMER_ERROR);

  const placeholder = SALES_CUSTOMER_ERROR
    ? "Could not load CRM customers"
    : options.size
      ? "Select customer"
      : "No active CRM customers available";

  select.innerHTML = `<option value="">${placeholder}</option>${[
    ...options.entries(),
  ]
    .map(
      ([id, name]) =>
        `<option value="${esc(id)}">${esc(id)} – ${esc(name)}</option>`,
    )
    .join("")}`;

  select.value = options.has(selected) ? selected : "";
}

function refreshOpenOrderItemOptions() {
  const modal = document.querySelector(".mask");
  if (!modal) return;

  const products = SALES_CATALOG_ERROR
    ? []
    : SALES_CATALOG.filter(
        (product) => product.isActive !== false && !product.isDeleted,
      );

  modal.querySelectorAll('select[id^="ii"]').forEach((select) => {
    const selected = select.value;
    select.disabled = Boolean(SALES_CATALOG_ERROR);

    select.innerHTML = `<option value="">${
      SALES_CATALOG_ERROR
        ? "Catalog could not be refreshed"
        : products.length
          ? "Select item"
          : "No active products available"
    }</option>${products
      .map(
        (product) =>
          `<option value="${esc(product.id)}">${esc(product.code || "—")} – ${esc(product.name || "")}</option>`,
      )
      .join("")}`;

    if (products.some((product) => String(product.id) === selected)) {
      select.value = selected;
    }
  });
}

async function loadSharedQuotes(
  force = false,
  modules = ["quotations", "crm"],
) {
  const requestedModules = [
    ...new Set(
      (modules || []).map((moduleName) =>
        String(moduleName).toLowerCase(),
      ),
    ),
  ];

  if (
    requestedModules.includes("quotations") &&
    !SALES_QUOTES_READY
  ) {
    SALES_QUOTES_LOADING = true;
    if (cur === "quotations") render();
  }

  if (SALES_SHARED_LOADING) {
    if (
      force ||
      requestedModules.some(
        (moduleName) => !SALES_SHARED_ACTIVE_MODULES.has(moduleName),
      )
    ) {
      requestedModules.forEach((moduleName) =>
        SALES_SHARED_REFRESH_PENDING.add(moduleName),
      );
    }

    return SALES_SHARED_LOADING;
  }

  if (!window.VyaparXAuth?.fetchModuleRecords) {
    const message = "Sales data service is unavailable.";

    if (requestedModules.includes("quotations")) {
      SALES_QUOTES_LOADING = false;
      SALES_DATA_ERRORS.set("quotations", message);
      if (cur === "quotations") render();
    }

    return { errors: { service: message } };
  }

  SALES_SHARED_ACTIVE_MODULES = new Set(requestedModules);

  if (requestedModules.includes("crm")) {
    SALES_CUSTOMERS_READY = false;
    SALES_CUSTOMER_ERROR = "";
    refreshOpenOrderCustomerOptions();
  }

  SALES_SHARED_LOADING = (async () => {
    const responses = await Promise.all(
      requestedModules.map(async (moduleName) => {
        try {
          return {
            moduleName,
            records:
              await window.VyaparXAuth.fetchModuleRecords(moduleName),
          };
        } catch (error) {
          return { moduleName, error };
        }
      }),
    );

    const errors = {};
    let refreshDashboard = false;
    let refreshQuotes = false;

    for (const response of responses) {
      const { moduleName, records, error } = response;

      if (error) {
        errors[moduleName] = error.message || "The request failed.";

        if (moduleName === "quotations") {
          SALES_QUOTES_LOADING = false;
          refreshQuotes = true;
        }

        if (moduleName === "crm") {
          SALES_CUSTOMER_ERROR = errors[moduleName];
          SALES_CUSTOMERS_READY = false;
          refreshOpenOrderCustomerOptions();
        }

        const previousError = SALES_DATA_ERRORS.get(moduleName);

        if (previousError !== errors[moduleName]) {
          const label =
            moduleName === "crm"
              ? "CRM customers"
              : moduleName === "quotations"
                ? "CRM quotations"
                : "Sales Orders";

          toast(`${label} could not be loaded: ${errors[moduleName]}`);
        }

        SALES_DATA_ERRORS.set(moduleName, errors[moduleName]);
        continue;
      }

      SALES_DATA_ERRORS.delete(moduleName);

      if (moduleName === "quotations") {
        const nextQuotes = [
          ...new Map(
            (records || [])
              .filter(
                (record) =>
                  record &&
                  String(record.recordType || "").toLowerCase() ===
                    "quotation" &&
                  !record.isDeleted &&
                  record.id,
              )
              .map((record) => [String(record.id), record]),
          ).values(),
        ];

        SALES_QUOTES_READY = true;
        SALES_QUOTES_LOADING = false;

        if (salesDataChanged(moduleName, nextQuotes)) {
          SHARED_QUOTES = nextQuotes;
          refreshQuotes = true;
        }
      } else if (moduleName === "sales") {
        const nextOrders = (records || []).filter(
          (record) =>
            record.recordType === "salesOrder" && !record.isDeleted,
        );

        if (salesDataChanged(moduleName, nextOrders)) {
          ORD = [];
          nextOrders.forEach(appendConvertedOrder);
          refreshDashboard = true;
        }
      } else if (moduleName === "crm") {
        const nextCustomers = [
          ...new Map(
            (records || [])
              .filter(salesCustomerIsActive)
              .filter((record) => record.id && record.name)
              .map((customer) => [String(customer.id), customer]),
          ).values(),
        ];

        SALES_CUSTOMER_ERROR = "";
        SALES_CUSTOMERS_READY = true;

        if (salesDataChanged(moduleName, nextCustomers)) {
          SALES_CUSTOMERS = nextCustomers;

          SALES_CUSTOMERS.forEach((customer) => {
            CUST[salesCustomerKey(customer.id)] = customer.name;
          });

          refreshDashboard = true;
        }

        refreshOpenOrderCustomerOptions();
      }
    }

    if (
      (refreshQuotes && cur === "quotations") ||
      (refreshDashboard &&
        [
          "dashboard",
          "orders",
          "pending",
          "delivery",
          "payments",
          "items",
          "reports",
        ].includes(cur)) ||
      (refreshDashboard &&
        cur === "quotations" &&
        requestedModules.includes("crm"))
    ) {
      render();
    }

    return { errors };
  })()
    .catch((error) => {
      if (requestedModules.includes("quotations")) {
        SALES_QUOTES_LOADING = false;
        SALES_DATA_ERRORS.set(
          "quotations",
          error.message || "The request failed.",
        );

        if (cur === "quotations") render();
      }

      toast("Sales data could not be refreshed: " + error.message);

      return { errors: { service: error.message } };
    })
    .finally(async () => {
      const refreshAgain = [...SALES_SHARED_REFRESH_PENDING];
      SALES_SHARED_REFRESH_PENDING.clear();
      SALES_SHARED_ACTIVE_MODULES.clear();
      SALES_SHARED_LOADING = null;

      if (refreshAgain.length) {
        await loadSharedQuotes(true, refreshAgain);
      }
    });

  return SALES_SHARED_LOADING;
}

let TEAM = [];
async function loadSalesTeam() { return TEAM; }

const PERMS_ = {
    "Department Head": [
      "team_add",
      "team_edit",
      "team_delete",
      "task_delete",
      "profile_edit",
      "profile_email",
      "profile_designation",
      "profile_delete",
    ],
    Employee: ["profile_edit"],
  },
  can = (a) => PERMS_[ROLE].includes(a);
const canManageTeam = () => window.VyaparXShared?.departmentTeam?.canManage("sales") === true;

let _cachedCompanyPeople = null;

const PEOPLE = () => {
  if (
    window.VyaparXShared &&
    window.VyaparXShared.getCompanyPeople
  ) {
    if (!_cachedCompanyPeople) {
      window.VyaparXShared
        .getCompanyPeople()
        .then((res) => {
          _cachedCompanyPeople = res;
        });
    }

    if (_cachedCompanyPeople) return _cachedCompanyPeople;
  }

  return [];
};

const dept = (n) =>
    (PEOPLE().find((p) => p.n == n) || { d: "Sales Order" }).d,
  meM = () =>
    TEAM.find(
      (m) =>
        String(m.eid) ===
        String(
          window.VyaparXAuth?.getCurrentSession?.()?.id ||
            window.VyaparXAuth?.getCurrentSession?.()?.userId,
        ),
    ) ||
    TEAM[0] || {
      n: window.VyaparXAuth?.getCurrentSession?.()?.fullName || "",
      des: "",
      photo: null,
    },
  ini = (n) =>
    n
      .split(" ")
      .map((w) => w[0])
      .join("")
      .slice(0, 2);

const nowT = () =>
  TODAY + " " + new Date().toTimeString().slice(0, 5);

let TASKS = [];
let COMMS = [];
let NOTES = [];

let TAB = "Task",
  FLT = "All",
  load = false,
  PEND = [],
  tphoto;

const REC = (id) =>
    TASKS.find((r) => String(r.id) === String(id)) ||
    COMMS.find((r) => String(r.id) === String(id)) ||
    (
      (window.VyaparXShared &&
        window.VyaparXShared.tasks.getTasksCache()) ||
      []
    ).find((r) => String(r.id) === String(id)),
  nvis = () =>
    NOTES.filter((n) =>
      n.k
        ? cnt(
            n.k == "appr"
              ? ["PENDING_APPROVAL"]
              : ["ADVANCE_PENDING"],
          ) > 0
        : !!REC(n.ref),
    );

const ntext = (n) => {
  if (n.k)
    return n.k == "appr"
      ? `${cnt(["PENDING_APPROVAL"])} order(s) waiting for approval`
      : `${cnt(["ADVANCE_PENDING"])} order(s) waiting for advance`;

  const r = REC(n.ref);

  return n.ref[0] == "t"
    ? `New task from ${esc(r.fd)}: ${esc(r.s)}`
    : `New message from ${esc(r.fd)}: ${esc(r.subj)}`;
};

const spin = () => {
  load = true;
  render();

  setTimeout(() => {
    load = false;
    render();
  }, 180);
};

const AX = {
    jpg: "Image (JPG)",
    jpeg: "Image (JPEG)",
    png: "Image (PNG)",
    webp: "Image (WEBP)",
    pdf: "PDF",
    doc: "Document (DOC)",
    docx: "Document (DOCX)",
    xls: "Spreadsheet (XLS)",
    xlsx: "Spreadsheet (XLSX)",
    csv: "CSV",
    txt: "Text",
  },
  KB = (n) =>
    n < 1024
      ? n + " B"
      : n < 1048576
        ? Math.round(n / 1024) + " KB"
        : (n / 1048576).toFixed(1) + " MB",
  isI = (a) => /^(jpg|jpeg|png|webp)$/.test(a.ext);

const tot = (o) => o.items.reduce((s, x) => {
  const discount = Math.min(100, Math.max(0, Number(x.discount ?? x.d ?? 0)));
  const gst = Math.max(0, Number(x.gst ?? x.g ?? 0));
  const discounted = Number(x.q || 0) * Number(x.r || 0) * (1 - discount / 100);
  const taxable = o.gstInclusive && gst ? discounted / (1 + gst / 100) : discounted;
  return s + taxable * (1 + gst / 100);
}, 0),
  req = (o) => Math.round((tot(o) * o.adv) / 100),
  pay = (o) => {
    const t = tot(o);
    return o.rec >= t && t > 0
      ? "PAID"
      : o.rec > 0
        ? "PARTIAL"
        : "UNPAID";
  };

const st = (s) => {
  const c =
    /^(DELIVERED|COMPLETED|PAID|CONFIRMED|ACTIVE|Completed|Low|Read)$/.test(
      s,
    )
      ? "ok"
      : /^(PENDING_APPROVAL|ADVANCE_PENDING|PARTIAL|DRAFT|Pending|In Progress|High|Medium|Unread)$/.test(
            s,
          )
        ? "wa"
        : /^(CANCELLED|UNPAID|Urgent)$/.test(s)
          ? "er"
          : "";

  return `<span class="tag ${c}">${s.replace(/_/g, " ")}</span>`;
};

let cur = "dashboard",
  q = "",
  fv = "All",
  sort = null,
  tmp = [];

const ph = (t, d, b) =>
  `<div class="ph"><div><h2>${t}</h2><p>${d}</p></div>${b ? `<button class="btn p" data-act="${b[0]}">${b[1]}</button>` : ""}</div>`;

const OB = (id) => ORD.find((o) => o.id == id),
  TB = (id) => TASKS.find((t) => t.id == id),
  addh = (o, t) => o.hist.push([TODAY, t]);

const OC = [
    "Order No",
    "Customer",
    "Order Date",
    "Delivery Date",
    "Total",
    "Payment Status",
    "Order Status",
  ],
  orow = (o) => [
    o.orderNumber || o.id,
    esc(CUST[o.crm]),
    fs(o.od),
    fs(o.dd),
    inr(tot(o)),
    pay(o),
    o.st,
  ];

const CAN = [
  "DRAFT",
  "PENDING_APPROVAL",
  "CONFIRMED",
  "ADVANCE_PENDING",
];

const oact = (r) => {
  const o = OB(r[0]) || ORD.find((row) => (row.orderNumber || row.id) == r[0]),
    b = (a, l) =>
      `<button class="btn s" data-act="${a}:${o.id}">${l}</button>`;

  return (
    b("ov", "View") +
    (o.st === "READY_FOR_TRANSPORT" && !["Pending", "Approved"].includes(o.transportRequestStatus)
      ? b("notifyTransport", "Notify Transport")
      : o.transportRequestStatus === "Pending"
        ? `<span class="tag wa">Transport notified</span>`
        : "") +
    (o.deliveryBillSnapshot ? b("viewDeliveryBill", "Delivery Bill") : "") +
    (o.st == "DRAFT"
      ? b("oe", "Edit") + b("osub", "Submit")
      : ["Rejected", "Returned"].includes(o.accountingApprovalStatus)
        ? b("oe", "Correct & Resubmit")
        : "") +
    (o.st == "PENDING_APPROVAL" ? b("oap", "Approve") : "") +
    (["CONFIRMED", "ADVANCE_PENDING"].includes(o.st)
      ? o.accountingApprovalStatus === "Approved"
        ? `<span class="tag ok">Production Request released</span>`
        : `<span class="tag wa">Waiting for Accounting</span>`
      : "") +
    (o.st == "IN_PRODUCTION"
      ? o.accountingApprovalStatus === "Approved" && o.prdCode
        ? `<span class="tag">${esc(o.prdCode)}</span>`
        : `<span class="tag wa">Waiting for Accounting</span>`
      : "") +
    (CAN.includes(o.st) ? b("ocn", "Cancel") : "")
  );
};

const kpi = (a, b) =>
    `<div class="card kpi"><small>${a}</small><b>${b}</b></div>`,
  cnt = (s) => ORD.filter((o) => s.includes(o.st)).length;

const V = {
  dashboard() {
    const att = ORD.filter((o) =>
      ["PENDING_APPROVAL", "ADVANCE_PENDING"].includes(o.st),
    );

    return (
      ph(salesGreeting(), "Orders, advances and delivery in one place.", [
        "add",
        "Create Order",
      ]) +
      `<div class="grid k6">${kpi("Total Orders", ORD.length)}${kpi("Awaiting Approval", cnt(["PENDING_APPROVAL"]))}${kpi("Pending Advance", cnt(["ADVANCE_PENDING"]))}${kpi("Confirmed Orders", cnt(["CONFIRMED"]))}${kpi("In Delivery", cnt(["READY", "DISPATCHED"]))}</div>
 <div class="grid two" style="margin-top:14px"><div class="card"><h3>Recent orders</h3><div class="tw"><table><tr><th>Order</th><th>Customer</th><th>Total</th><th>Status</th></tr>${ORD.slice(
   0,
   5,
 )
   .map(
     (o) =>
       `<tr><td>${o.id}</td><td>${esc(CUST[o.crm])}</td><td>${inr(tot(o))}</td><td>${st(o.st)}</td></tr>`,
   )
   .join("")}</table></div></div>
 <div class="card"><h3>Needs attention</h3>${att.length ? att.map((o) => `<div style="display:flex;justify-content:space-between;align-items:center;padding:8px 0;border-bottom:1px solid var(--bd)"><span>${o.id}<br><small style="color:var(--mut)">${st(o.st)}</small></span><button class="btn s" data-act="ov:${o.id}"><i class="fa-solid fa-eye" aria-hidden="true"></i></button></div>`).join("") : `<div class="empty">Nothing needs attention.</div>`}</div></div>`
    );
  },

  orders() {
    return (
      ph("Sales Orders", "Create, approve and send orders to production.", [
        "add",
        "Create Order",
      ]) +
      table(
        window.VyaparXFields.tableColumns("sales", OC),
        ORD.map((o) =>
          window.VyaparXFields.tableRow("sales", o, orow(o)),
        ),
        {
          colModule: "sales",
          filter: [
            "DRAFT",
            "PENDING_APPROVAL",
            "CONFIRMED",
            "ADVANCE_PENDING",
            "IN_PRODUCTION",
            "READY_FOR_TRANSPORT",
            "TRANSPORT_PLANNED",
            "READY",
            "DISPATCHED",
            "DELIVERED",
            "COMPLETED",
            "CANCELLED",
          ],
          act: oact,
          empty: "No orders yet.",
        },
      )
    );
  },

  quotations() {
    const loadError = SALES_DATA_ERRORS.get("quotations") || "";

    const emptyMessage = SALES_QUOTES_LOADING
      ? "Loading CRM quotations…"
      : loadError
        ? `Could not load CRM quotations: ${esc(loadError)}`
        : "No CRM quotations are available to this company.";

    const rows = SHARED_QUOTES.filter(
      (quote) => !quote.isDeleted,
    ).sort((left, right) => {
      const a = window.VyaparXShared?.dateSortKey?.(left.date);
      const b = window.VyaparXShared?.dateSortKey?.(right.date);

      if (a == null && b == null) return 0;
      if (a == null) return 1;
      if (b == null) return -1;

      return a - b;
    });

    return (
      ph(
        "CRM Quotations",
        "Review quotations from CRM using their shared record.",
      ) +
      (loadError && rows.length
        ? `<div class="card"><div class="empty">Could not refresh CRM quotations: ${esc(loadError)}. Showing the last loaded records.</div></div>`
        : "") +
      `<div class="card"><div class="tw"><table><thead><tr>
      <th>Quotation</th><th>Customer</th><th>Date</th><th>Valid Until</th><th>Total</th><th>Status</th><th></th>
      </tr></thead><tbody>${
        rows.length
          ? rows
              .map(
                (quote) => `<tr>
      <td>${esc(quote.number || "")}</td><td>${esc(quote.clientName || "")}</td>
      <td>${fs(quote.date)}</td><td>${fs(quote.validUntil)}</td>
      <td>${inr(Number(quote.total || 0))}</td><td>${st(salesQuoteStatusLabel(quote.status))}</td>
      <td><div style="display:flex;gap:4px"><button class="btn s" data-act="qview:${esc(quote.id)}" title="View quotation" aria-label="View quotation"><i class="fa-solid fa-eye" aria-hidden="true"></i></button>
      ${salesQuoteIsPending(quote) ? `<button class="btn s" data-act="qsend:${esc(quote.id)}">Approve</button><button class="btn s" data-act="qreject:${esc(quote.id)}">Reject</button>` : ""}
      ${
        salesQuoteIsApproved(quote) &&
        !quote.salesOrderId &&
        SALES_CUSTOMERS.some(
          (customer) =>
            String(customer.id) ===
            String(quote.clientId || quote.leadId || ""),
        )
          ? `<button class="btn s" data-act="qconvert:${esc(quote.id)}">Convert to order</button>`
          : ""
      }
      ${
        quote.status !== "Converted" && !quote.salesOrderId
          ? `<button class="btn s" data-act="qdelete:${esc(quote.id)}" title="Delete quotation" aria-label="Delete quotation"><i class="fa-solid fa-trash-can" aria-hidden="true"></i></button>`
          : ""
      }</div></td></tr>`,
              )
              .join("")
          : `<tr><td colspan="7"><div class="empty">${emptyMessage}</div></td></tr>`
      }
      </tbody></table></div></div>`
    );
  },

  catalog() {
    const catalogEmptyMessage = !SALES_CATALOG_READY
      ? "Loading product catalog…"
      : SALES_CATALOG_ERROR
        ? `Could not load the product catalog: ${esc(SALES_CATALOG_ERROR)}`
        : "No catalog products yet. Add the products your factory makes.";

    return (
      ph(
        "Product Catalog",
        "Maintain company product details and the price, GST, and default discount used in CRM quotations.",
      ) +
      `${
        SALES_CATALOG_ERROR && SALES_CATALOG.length
          ? `<div class="card"><div class="empty">Could not refresh the catalog: ${esc(SALES_CATALOG_ERROR)}. Showing the last loaded products.</div></div>`
          : ""
      }<div class="bar"><button class="btn p" data-act="catadd">+ Add product</button><button class="btn" data-act="catprint"><i class="fa-solid fa-print" aria-hidden="true"></i> Print Catalog</button><button class="btn" data-act="catfields">? Manage Fields</button></div><div class="card"><div class="tw"><table><thead><tr><th>Product</th><th>Code</th><th>Details</th><th>Unit</th><th>HSN/SAC</th><th>Price</th><th>GST</th><th>Discount</th><th>Status</th><th>Actions</th></tr></thead><tbody>${
        SALES_CATALOG.length
          ? SALES_CATALOG.map(
              (product) => `<tr><td>${esc(product.name || "")}</td><td>${esc(product.code || "—")}</td><td>${esc(product.description || "—")}</td><td>${esc(product.unit || "Nos")}</td><td>${esc(product.hsn || "—")}</td><td>${inr(Number(product.rate || 0))}</td><td>${Number(product.gst || 0)}%</td><td>${Number(product.discount || 0)}%</td><td>${product.isActive === false ? "Inactive" : "Active"}</td><td><button class="btn s" data-act="catedit:${esc(product.id)}" title="Edit" aria-label="Edit"><i class="fa-solid fa-pen-to-square" aria-hidden="true"></i></button> <button class="btn s" data-act="catdelete:${esc(product.id)}"><i class="fa-solid fa-trash-can" aria-hidden="true"></i></button></td></tr>`,
            ).join("")
          : `<tr><td colspan="10"><div class="empty">${catalogEmptyMessage}</div></td></tr>`
      }</tbody></table></div></div>`
    );
  },

  items() {
    return (
      ph(
        "Order Items",
        "Every line item across all orders. Amount = quantity × rate.",
      ) +
      table(
        ["Order No", "Item Code", "Item", "Quantity", "Rate", "Amount"],
        ORD.flatMap((o) =>
          o.items.map((x) => [
            o.id,
            INV[x.i][0],
            INV[x.i][1],
            x.q + " " + INV[x.i][3],
            inr(x.r),
            inr(x.q * x.r),
          ]),
        ),
      )
    );
  },

  pending() {
    return (
      ph(
        "Pending Orders",
        "Orders waiting for submission, approval or advance.",
      ) +
      table(
        [
          "Order No",
          "Customer",
          "Total",
          "Advance Required",
          "Advance Received",
          "Order Status",
        ],
        ORD.filter((o) =>
          ["DRAFT", "PENDING_APPROVAL", "ADVANCE_PENDING"].includes(
            o.st,
          ),
        ).map((o) => [
          o.id,
          esc(CUST[o.crm]),
          inr(tot(o)),
          inr(req(o)),
          inr(o.rec),
          o.st,
        ]),
        { act: oact, empty: "No pending orders." },
      )
    );
  },

  delivery() {
    return (
      ph(
        "Delivery Status",
        "Production and delivery progress. Production and Transport update these.",
      ) +
      table(
        [
          "Order No",
          "Customer",
          "Delivery Date",
          "Production Status",
          "Order Status",
        ],
        ORD.filter((o) =>
          [
            "IN_PRODUCTION",
            "READY_FOR_TRANSPORT",
            "TRANSPORT_PLANNED",
            "READY",
            "DISPATCHED",
            "DELIVERED",
            "COMPLETED",
          ].includes(o.st),
        ).map((o) => [
          o.id,
          esc(CUST[o.crm]),
          fs(o.dd),
          o.ps,
          o.st,
        ]),
        {
          act: (r) =>
            `<button class="btn s" data-act="ov:${r[0]}"><i class="fa-solid fa-eye" aria-hidden="true"></i></button>`,
          empty: "No orders in delivery yet.",
        },
      )
    );
  },

  payments() {
    return (
      ph(
        "Payments",
        "Advance rules per order. Receipts are recorded by Accounting.",
      ) +
      table(
        [
          "Order No",
          "Customer",
          "Total",
          "Advance %",
          "Required",
          "Received",
          "Payment Status",
        ],
        ORD.filter((o) => o.st != "CANCELLED").map((o) => [
          o.id,
          esc(CUST[o.crm]),
          inr(tot(o)),
          o.adv + "%",
          inr(req(o)),
          inr(o.rec),
          pay(o),
        ]),
        {
          act: (r) =>
            `<button class="btn s" data-act="ov:${r[0]}"><i class="fa-solid fa-eye" aria-hidden="true"></i></button>`,
        },
      )
    );
  },

  reports() {
    const a = ORD.filter((o) => o.st != "CANCELLED");
    const v = a.reduce((s, o) => s + tot(o), 0);
    const r = a.reduce((s, o) => s + o.rec, 0);

    return (
      ph("Reports", "Sales performance from current orders.") +
      `<div class="bar" style="margin:0"><button class="btn" data-act="csv" title="Export CSV" aria-label="Export CSV"><i class="fa-solid fa-file-csv"></i></button><button class="btn" onclick="print()" title="Print" aria-label="Print"><i class="fa-solid fa-print"></i></button></div><div class="grid k6" style="margin:14px 0">${kpi("Order value", inr(v))}${kpi("Received", inr(r))}${kpi("Outstanding", inr(v - r))}${kpi("Delivered", cnt(["DELIVERED", "COMPLETED"]))}</div><div class="card"><h3>By status</h3><table style="min-width:0"><tr><th>Status</th><th>Orders</th><th>Value</th></tr>${["DRAFT", "PENDING_APPROVAL", "CONFIRMED", "ADVANCE_PENDING", "IN_PRODUCTION", "READY", "DISPATCHED", "DELIVERED", "COMPLETED", "CANCELLED"].map((s) => `<tr><td>${st(s)}</td><td>${cnt([s])}</td><td>${inr(ORD.filter((o) => o.st == s).reduce((x, o) => x + tot(o), 0))}</td></tr>`).join("")}</table></div>`
    );
  },

  team() {
    return (
      ph(
        "My Team",
        "Only Sales Order employees appear here.",
        canManageTeam() ? ["madd", "Add Member"] : null,
      ) +
      table(
        ["Name", "Designation", "Open Orders", "Status"],
        TEAM.map((m) => [
          esc(m.n),
          esc(m.des),
          ORD.filter(
            (o) =>
              o.cb == m.n &&
              !["DELIVERED", "COMPLETED", "CANCELLED"].includes(o.st),
          ).length,
          m.status || "ACTIVE",
        ]),
        {
          act: (r) => {
            const m = TEAM.find((z) => esc(z.n) == r[0]);

            return (
              `<button class="btn s" data-act="ev:${m.id}"><i class="fa-solid fa-eye" aria-hidden="true"></i></button>` +
              (canManageTeam()
                ? `<button class="btn s" data-act="me:${m.id}" title="Edit" aria-label="Edit"><i class="fa-solid fa-pen-to-square" aria-hidden="true"></i></button>`
                : "") +
              (canManageTeam() && m.n != ME && m.r != "Department Head"
                ? `<button class="btn s" data-act="md:${m.id}" aria-label="Delete ${esc(m.n)}"><i class="fa-solid fa-trash-can" aria-hidden="true"></i></button>`
                : "")
            );
          },
          empty: "No team members.",
        },
      )
    );
  },

  tasks() {
    const T = TAB == "Task";
    const H = ph(
      "Tasks & Communication",
      "Send work and messages to other departments.",
      ["send", T ? "Send Task" : "Send Message"],
    );

    if (load) return H + `<div class="card empty">Loading…</div>`;

    try {
      const mine = (T ? TASKS : COMMS).filter(
        (r) => r.dir === "Sent" || r.dir === "Received",
      );

      const f = (k) =>
        mine.filter((r) => k === "All" || r.dir === k);

      const list = f(FLT);

      const seg = (a, k, c, l) =>
        `<span style="display:inline-flex;gap:4px;background:var(--bg);padding:3px;border-radius:12px;border:1px solid var(--bd)">${a.map((x) => `<button class="btn s" style="border:0;${c == x ? "background:var(--pri2);color:var(--pt)" : "background:none"}" data-act="${k}:${x}">${l(x)}</button>`).join("")}</span>`;

      const em = {
        All: T ? "No tasks found." : "No communications found.",
        Sent: T ? "No sent tasks." : "No sent communications.",
        Received: T ? "No received tasks." : "No received communications.",
      }[FLT];

      const fl = (r) => (r.att.length ? "?? " + r.att.length : "—");
      const oth = (r) => (r.from == ME ? r.td : r.fd);

      const rows = list.map((r) =>
        T
          ? [
              `<button style="border:0;background:none;padding:0;color:var(--pt);font:inherit;text-align:left;cursor:pointer" data-act="tv:${r.id}">${esc(r.s)}</button>`,
              esc(r.desc.length > 40 ? r.desc.slice(0, 40) + "…" : r.desc),
              esc(r.from),
              esc(r.to),
              oth(r),
              r.p,
              r.due,
              r.st,
              fl(r),
              r.ca,
            ]
          : [
              `<button style="border:0;background:none;padding:0;color:var(--pt);font:inherit;text-align:left;cursor:pointer" data-act="tv:${r.id}">${esc(r.subj)}</button>`,
              esc(r.from),
              esc(r.to),
              oth(r),
              fl(r),
              r.ca,
              r.read ? "Read" : "Unread",
            ],
      );

      const act = (r) => {
        const m = r[0].match(/tv:([^"]+)/);
        const t = m ? REC(m[1]) : null;

        if (!t) return "";

        return (
          `<button class="btn s" data-act="tv:${t.id}"><i class="fa-solid fa-eye" aria-hidden="true"></i></button>` +
          (T && t.dir == "Received" && t.st != "Completed"
            ? `<button class="btn s" data-act="adv:${t.id}">${t.st == "Pending" ? "Start" : "Complete"}</button>`
            : "") +
          (t.from == ME || can("task_delete")
            ? `<button class="btn s" data-act="td:${t.id}" aria-label="Delete" title="Delete">??</button>`
            : "")
        );
      };

      return (
        H +
        `<div class="bar" style="justify-content:space-between">${seg(["Task", "Communication"], "tab", TAB, (x) => x)}${seg(["All", "Sent", "Received"], "flt", FLT, (x) => `${x} (${f(x).length})`)}</div>` +
        table(
          T
            ? [
                "Title",
                "Description",
                "Sender",
                "Receiver",
                "Department",
                "Priority",
                "Due",
                "Status",
                "File",
                "Created",
              ]
            : [
                "Subject",
                "Sender",
                "Receiver",
                "Department",
                "File",
                "Date / Time",
                "Status",
              ],
          rows,
          { act, empty: em },
        )
      );
    } catch (e) {
      return (
        H +
        `<div class="card empty">Unable to load records. Please try again.<br><button class="btn s" data-act="spin">Retry</button></div>`
      );
    }
  },

  notif() {
    const L = nvis();

    return (
      ph("Notifications", "Only notices for Sales Order and you.") +
      `<div class="card">${L.length ? L.map((n) => `<div style="display:flex;justify-content:space-between;gap:8px;align-items:center;padding:10px 0;border-bottom:1px solid var(--bd)"><span>${ntext(n)} ${n.read ? "" : `<span class="tag wa">New</span>`}</span><span style="display:flex;gap:6px">${n.ref ? `<button class="btn s" data-act="nopen:${n.id}">Open</button>` : ""}${n.read ? "" : `<button class="btn s" data-act="nrd:${n.id}">Mark read</button>`}</span></div>`).join("") : `<div class="empty">No notifications.</div>`}${L.some((n) => !n.read) ? `<button class="btn s" style="margin-top:10px" data-act="read">Mark all as read</button>` : ""}</div>`
    );
  },
};

function nav() {
  $("#sb").innerHTML =
    `<div class="logo"><img src="../assets/logo.png" alt="VX Logo" style="width:50px;height:50px;object-fit:contain;"><div><b>VYAPARX ERP</b><small>${esc((window.VyaparXShared?.getCompanyProfile?.() || {}).company_name || (window.VyaparXAuth?.getCurrentSession?.() || {}).companyName || "")}</small></div></div>` +
    NAV.map(
      ([s, it]) =>
        `<div class="sec">${s}</div>` +
        it
          .map(
            ([id, l, p]) =>
              `<button class="nav ${id == cur ? "on" : ""}" data-go="${id}" title="${l}">${ic(p)}<span>${l}</span></button>`,
          )
          .join(""),
    ).join("");
}

function salesGreeting() {
  const name =
    window.VyaparXAuth?.getCurrentSession?.()?.fullName ||
    window.VyaparXAuth?.getCurrentSession?.()?.name ||
    "";

  const hour = new Date().getHours();

  const greeting =
    hour < 12
      ? "Good Morning"
      : hour < 17
        ? "Good Afternoon"
        : hour < 20
          ? "Good Evening"
          : "Good Night";

  return name ? `${greeting}, ${name}` : greeting;
}

function render() {
  const l = NAV.flatMap((n) => n[1]).find((x) => x[0] == cur)[1];

  $("#pt").textContent = l;
  $("#bc").textContent = "Sales Order / " + l;
  $("#mn").innerHTML = V[cur]();

  nav();

  const u = nvis().filter((n) => !n.read).length;

  $("#nc").textContent = u;
  $("#nc").hidden = !u;

  hdr();
}

function hdr() {
  const session = window.VyaparXAuth?.getCurrentSession?.();

  const m =
    TEAM.find(
      (member) =>
        String(member.eid) === String(session?.id || session?.userId),
    ) ||
    TEAM[0] || {
      n: session?.fullName || "",
      des: session?.department || "",
      photo: null,
    };

  if (session?.fullName) ME = session.fullName;
  if (session?.role) ROLE = session.role;

  $("#pav").innerHTML = m.photo
    ? `<img src="${m.photo}" alt="" style="width:100%;height:100%;border-radius:50%;object-fit:cover">`
    : ini(session?.fullName || m.n);

  $("#pnm").textContent = session?.fullName || m.n;
  $("#prl").textContent =
    session?.designation || session?.department || m.des;
}

function go(v) {
  if (v === "team") {
    loadSalesTeam().then(() => {
      if (cur === "team") render();
    });
  }

  if (v === "quotations") {
    loadSharedQuotes(true, ["quotations"]);
  }

  if (v === "orders") {
    const params = new URLSearchParams(window.location.search);

    if (params.get("action") === "create") {
      cur = "orders";
      q = "";
      fv = "All";
      sort = null;
      render();
      return orderForm();
    }
  }

  if (v == "tasks" && cur != "tasks") {
    cur = v;
    q = "";
    spin();
    return;
  }

  cur = v;
  q = "";
  fv = "All";
  sort = null;

  render();
  document.body.classList.remove("open");
}

const amt = (x) =>
    /^[1-9]\d*$/.test(x.q) && /^\d+(\.\d{1,2})?$/.test(x.r)
      ? +x.q * +x.r
      : 0,
  tt = () => {
    $("#tot").textContent = inr(tmp.reduce((s, x) => s + amt(x), 0));
  };

function itemsUI() {
  const activeProducts = SALES_CATALOG.filter(
    (product) => product.isActive !== false && !product.isDeleted,
  );

  $("#its").innerHTML = tmp
    .map(
      (x, i) =>
        `<div style="display:flex;gap:6px;flex-wrap:wrap;margin-bottom:8px;align-items:flex-start"><label style="flex:2;min-width:150px"><select class="in" id="ii${i}" data-k="i" data-i="${i}" aria-label="Item"><option value="">${activeProducts.length ? "Select item" : "No active products available"}</option>${activeProducts.map((product) =>
          `<option value="${esc(product.id)}" ${String(product.id) === String(x.i) ? "selected" : ""}>${esc(product.code || "—")} – ${esc(product.name || "")}</option>`,
        )
          .join(
            "",
          )}</select></label><label style="flex:1;min-width:70px"><input class="in" id="iq${i}" data-k="q" data-i="${i}" inputmode="numeric" placeholder="Qty" aria-label="Quantity" value="${esc(x.q)}"></label><label style="flex:1;min-width:90px"><input class="in" id="ir${i}" data-k="r" data-i="${i}" inputmode="decimal" placeholder="Rate" aria-label="Rate" value="${esc(x.r)}"></label><span id="ia${i}" style="min-width:80px;padding:8px 0">${inr(amt(x))}</span>${tmp.length > 1 ? `<button class="btn s" data-act="rmit:${i}" aria-label="Remove item" style="margin-top:4px">?</button>` : ""}</div>`,
    )
    .join("");

  tt();
}

let SALES_ORDER_FORM_LOADING = false;

async function openSalesOrderForm(o) {
  if (SALES_ORDER_FORM_LOADING) return;

  SALES_ORDER_FORM_LOADING = true;
  toast("Loading current CRM customers and catalog products…");

  try {
    const [customerResult, catalogReady] = await Promise.all([
      loadSharedQuotes(SALES_CUSTOMERS_READY, ["crm"]),
      syncSalesCatalog(),
    ]);

    if (customerResult?.errors?.crm || SALES_CUSTOMER_ERROR) {
      throw new Error(
        SALES_CUSTOMER_ERROR || customerResult.errors.crm,
      );
    }

    if (!catalogReady || SALES_CATALOG_ERROR) {
      throw new Error(
        SALES_CATALOG_ERROR || "The product catalog is unavailable.",
      );
    }

    if (cur === "orders") orderForm(o, true);
  } catch (error) {
    toast("Could not open the order form: " + error.message);
  } finally {
    SALES_ORDER_FORM_LOADING = false;
  }
}

function orderForm(o, dependenciesReady = false) {
  const n = !o;

  if (!dependenciesReady) return openSalesOrderForm(o);

  if (!SALES_CUSTOMERS_READY || SALES_CUSTOMER_ERROR) {
    return toast(
      "Current CRM customers could not be verified. Refresh and try again.",
    );
  }

  const params = new URLSearchParams(window.location.search);
  const requestedCustomerId = params.get("customerId");
  const requestedQuoteId = params.get("quotationId");

  const acceptedQuote = requestedQuoteId
    ? SHARED_QUOTES.find(
        (quote) =>
          String(quote.id) === String(requestedQuoteId) &&
          salesQuoteIsApproved(quote),
      )
    : requestedCustomerId &&
      SHARED_QUOTES.find(
        (quote) =>
          String(quote.leadId || quote.clientId) ===
            String(requestedCustomerId) &&
          salesQuoteIsApproved(quote),
      );
  let activeQuote = acceptedQuote || null;

  if (
    n &&
    requestedCustomerId &&
    !SALES_CUSTOMERS.some(
      (customer) =>
        String(customer.id) === String(requestedCustomerId),
    )
  ) {
    return toast(
      "This CRM customer is inactive or unavailable. Refresh CRM before creating an order.",
    );
  }

  if (n && !o && params.get("customerId")) {
    const clientId = params.get("customerId");
    const relatedQuote = activeQuote;

    const customerName =
      SALES_CUSTOMERS.find(
        (customer) => String(customer.id) === String(clientId),
      )?.name ||
      relatedQuote?.clientName ||
      "";

    const customerKey = salesCustomerKey(clientId);
    CUST[customerKey] = customerName;

    const prefilledItems = relatedQuote?.items?.length
      ? relatedQuote.items.map((item) => ({
          i: item.productId || "",
          q: String(item.qty || ""),
          r: String(item.rate || ""),
          discount: Number(item.discount || 0),
          gst: Number(item.gst || 0),
          uom: item.uom || "Nos",
          hsn: item.hsn || "",
          productName: item.productName || "",
          description: item.description || "",
        }))
      : [{ i: "", q: "", r: "" }];

    o = {
      crm: customerKey,
      od: TODAY,
      dd: "",
      adv: 0,
      gstInclusive: !!relatedQuote?.gstInclusive,
      items: prefilledItems,
    };
  }

  tmp = n
    ? (o?.items || [{ i: "", q: "", r: "" }]).map((x) => ({
        ...x,
        i: x.i,
        q: String(x.q),
        r: String(x.r),
      }))
    : o.items.map((x) => ({
        ...x,
        i: x.i,
        q: String(x.q),
        r: String(x.r),
      }));

  o = o || { crm: "", od: TODAY, dd: "", adv: "" };

  let savingOrder = false;

  const newOrderId = n
    ? activeQuote?.id
      ? "SO-Q-" + activeQuote.id
      : "SO-DRAFT-" +
        Date.now() +
        "-" +
        Math.random().toString(36).slice(2, 8)
    : "";

  const orderCustomerOptions = new Map(
    SALES_CUSTOMERS.map((customer) => [
      salesCustomerKey(customer.id),
      customer.name,
    ]),
  );

  if (!n && o.crm && !orderCustomerOptions.has(o.crm)) {
    orderCustomerOptions.set(
      o.crm,
      CUST[o.crm] || o.customerName || o.crm,
    );
  }

  dlg(
    `<h3>${n ? "Create sales order" : "Edit " + o.id}</h3><div class="fm" style="max-width:none"><label>Customer *<select class="in" id="oc" data-keep-historical="${n ? "false" : "true"}"><option value="">${SALES_CUSTOMERS.length ? "Select customer" : "No active CRM customers available"}</option>${[...orderCustomerOptions.entries()]
      .map(
        ([k, v]) =>
          `<option value="${k}" ${k == o.crm ? "selected" : ""}>${k} – ${v}</option>`,
      )
      .join(
        "",
      )}</select></label><label>Order Date *<input class="in" type="date" id="od" value="${o.od}"></label><label>Delivery Date *<input class="in" type="date" id="odd" value="${o.dd}"></label><label>Advance Required (%) *<input class="in" id="oa" inputmode="numeric" placeholder="0 to 100" value="${esc(o.adv)}"></label><div><b style="font-weight:500">Order items *</b><div id="its" style="margin-top:8px"></div><button class="btn s" type="button" data-act="addit">+ Add Item</button><div style="margin-top:8px;color:var(--mut)">Total: <b id="tot" style="color:var(--tx)">${inr(0)}</b></div></div></div>${window.VyaparXFields ? window.VyaparXFields.formFieldsHtml("sales", o) : ""}`,
    n ? "Save order" : "Save changes",
    (mask) => {
      tmp = [
        ...document.querySelectorAll('#its [data-k="i"]'),
      ].map((select, index) => ({
        i: select.value,
        q: $("#iq" + index)?.value ?? "",
        r: $("#ir" + index)?.value ?? "",
      }));

      const R = [
        ["#oc", (v) => v, "Select the customer."],
        [
          "#od",
          (v) => v && !isNaN(Date.parse(v)),
          "Enter a valid order date.",
        ],
        [
          "#odd",
          (v) => v && !isNaN(Date.parse(v)) && v >= $("#od").value,
          "Delivery date must be on or after the order date.",
        ],
        [
          "#oa",
          (v) => /^\d{1,3}$/.test(v) && +v <= 100,
          "Enter a whole number from 0 to 100.",
        ],
      ];

      tmp.forEach((x, i) =>
        R.push(
          ["#ii" + i, (v) => v, "Select an item."],
          [
            "#iq" + i,
            (v) => /^[1-9]\d*$/.test(v),
            "Quantity must be a whole number above 0.",
          ],
          [
            "#ir" + i,
            (v) => /^\d+(\.\d{1,2})?$/.test(v),
            "Enter a valid rate (0 or more).",
          ],
        ),
      );

      if (!vf(R)) return false;

      if (window.VyaparXFields) {
        const ce = window.VyaparXFields.validateForm("sales", document);
        if (ce.length) {
          toast(ce[0]);
          return false;
        }
      }

      const d = tmp.findIndex(
        (x, i) =>
          x.i &&
          tmp.findIndex((y) => y.i == x.i) != i,
      );

      if (d > -1) {
        vf([["#ii" + d, () => false, "This item is already added."]]);
        return false;
      }

      const f = {
        crm: $("#oc").value,

        customerId:
          SALES_CUSTOMERS.find(
            (customer) =>
              salesCustomerKey(customer.id) === $("#oc").value,
          )?.id ||
          (n ? "" : o.customerId || ""),

        customerName:
          SALES_CUSTOMERS.find(
            (customer) =>
              salesCustomerKey(customer.id) === $("#oc").value,
          )?.name ||
          (n
            ? ""
            : o.customerName ||
              CUST[$("#oc").value] ||
              ""),

        od: $("#od").value,
        dd: $("#odd").value,
        adv: +$("#oa").value,

        items: tmp.map((x) => {
          const product = SALES_CATALOG.find(
            (candidate) =>
              String(candidate.id) === String(x.i) &&
              candidate.isActive !== false &&
              !candidate.isDeleted,
          );

          if (!product) {
            throw new Error(
              "Each Sales Order item must come from the active Product Catalog.",
            );
          }

          return {
            i: product.id,
            q: +x.q,
            r: +x.r,
            productName: product.name,
            code: product.code,
            description: product.description,
            uom: x.uom || product.unit || "Nos",
            hsn: x.hsn || product.hsn,
            gst: Number(x.gst ?? product.gst ?? 0),
            discount: Number(x.discount ?? product.discount ?? 0),
          };
        }),

        gstInclusive: activeQuote?.gstInclusive ?? !!o.gstInclusive,

        quotationId: activeQuote?.id || "",
        quotationNumber: activeQuote?.number || "",
      };

      if (window.VyaparXFields) {
        window.VyaparXFields.applyToRecord(
          "sales",
          f,
          window.VyaparXFields.readFormValues(document),
        );
      }

      if (n) {
        if (
          f.quotationId &&
          ORD.some(
            (order) =>
              String(order.quotationId) === String(f.quotationId),
          )
        ) {
          toast("A Sales Order already exists for this quotation.");
          return false;
        }

        const newOrder = {
          ...f,
          id: newOrderId,
          recordType: "salesOrder",
          rec: 0,
          st: "DRAFT",
          ps: "NOT_STARTED",
          cb: ME,
          ca: TODAY,
          hist: [[TODAY, "Order created"]],
        };

        if (savingOrder) return false;
        savingOrder = true;

        const button = mask.querySelector("[data-ok]");
        button.disabled = true;
        button.textContent = "Saving…";

        Promise.resolve()
          .then(() => {
            if (!window.VyaparXAuth?.createModuleRecord) {
              throw new Error(
                "Sales Order save service is unavailable.",
              );
            }

            return window.VyaparXAuth.createModuleRecord(
              "sales",
              salesOrderToRecord(newOrder),
            );
          })
          .then((result) => {
            if (!result?.record?.id) {
              throw new Error(
                "The server did not confirm the saved Sales Order.",
              );
            }

            const savedOrder = salesOrderFromRecord(result.record);

            ORD = [
              savedOrder,
              ...ORD.filter(
                (order) =>
                  String(order.id) !== String(savedOrder.id),
              ),
            ];

            window.VyaparXShared?.records?.markPersisted(
              "sales",
              "salesOrder",
              savedOrder,
            );

            mask.remove();
            render();
            toast("Order saved as draft");
          })
          .catch((error) => {
            savingOrder = false;

            if (button.isConnected) {
              button.disabled = false;
              button.textContent = "Save order";
            }

            toast("Order was not saved: " + error.message);
          });

        return false;
      } else {
        const updatedOrder = { ...o, ...f, items: f.items };

        addh(updatedOrder, "Order edited");

        if (savingOrder) return false;
        savingOrder = true;

        const button = mask.querySelector("[data-ok]");
        if (button) {
          button.disabled = true;
          button.textContent = "Saving…";
        }

        Promise.resolve()
          .then(() => {
            if (!window.VyaparXAuth?.saveModuleRecord) {
              throw new Error(
                "Sales Order save service is unavailable.",
              );
            }

            return window.VyaparXAuth.saveModuleRecord(
              "sales",
              salesOrderToRecord(updatedOrder),
            );
          })
          .then((result) => {
            if (!result?.record?.id) {
              throw new Error(
                "The server did not confirm the saved Sales Order.",
              );
            }

            Object.assign(
              updatedOrder,
              salesOrderFromRecord(result.record),
            );

            Object.assign(o, updatedOrder);

            window.VyaparXShared?.records?.markPersisted(
              "sales",
              "salesOrder",
              o,
            );

            mask.remove();
            render();
            toast("Order updated");
          })
          .catch((error) => {
            savingOrder = false;

            if (button && button.isConnected) {
              button.disabled = false;
              button.textContent = "Save changes";
            }

            toast("Order was not updated: " + error.message);
          });

        return false;
      }
    },
  );

  document.querySelectorAll(".dlg").forEach((d) => {
    d.style.width = "min(640px,100%)";
    d.style.maxHeight = "90vh";
    d.style.overflow = "auto";
  });

  const customerSelect = document.querySelector(".mask #oc");
  if (n && customerSelect) {
    customerSelect.addEventListener("change", () => {
      const customer = SALES_CUSTOMERS.find(
        (entry) => salesCustomerKey(entry.id) === customerSelect.value,
      );
      const customerId = String(customer?.id || "");
      const candidates = SHARED_QUOTES.filter(
        (quote) =>
          salesQuoteIsApproved(quote) &&
          String(quote.clientId || quote.leadId || "") === customerId &&
          !quote.salesOrderId &&
          !ORD.some(
            (order) => String(order.quotationId) === String(quote.id),
          ),
      ).sort((a, b) =>
        String(b.createdAt || b.date || "").localeCompare(
          String(a.createdAt || a.date || ""),
        ),
      );

      activeQuote = candidates[0] || null;
      const quoteItems = activeQuote?.items || [];
      tmp = quoteItems.length
        ? quoteItems.map((item) => ({
            i: String(item.productId || item.i || ""),
            q: String(item.qty ?? item.q ?? ""),
            r: String(item.rate ?? item.r ?? ""),
            discount: Number(item.discount || 0),
            gst: Number(item.gst || 0),
            uom: item.uom || "Nos",
            hsn: item.hsn || "",
            productName: item.productName || "",
            description: item.description || "",
          }))
        : [{ i: "", q: "", r: "" }];
      itemsUI();

      if (activeQuote) {
        toast(`Loaded materials and quantities from ${activeQuote.number || "the approved quotation"}.`);
      }
    });
  }

  itemsUI();
}

function salesQuotationBill(quote) {
  const profile = window.VyaparXShared?.getCompanyProfile?.() || {};
  const company = {
    name: profile.registeredBusinessName || profile.registered_business_name || profile.companyName || profile.company_name || quote.unit || "Company",
    address: [profile.address, profile.state, profile.pinCode || profile.pin_code, profile.country].filter(Boolean).join(", "),
    gstin: profile.gstin || profile.gst_number || "",
    phone: profile.phone || "",
    email: profile.email || "",
  };
  const companyGSTState = String(company.gstin).replace(/\W/g, "").slice(0, 2).toUpperCase();
  const customerGSTState = String(quote.clientGst || "").replace(/\W/g, "").slice(0, 2).toUpperCase();
  const intraState = !!companyGSTState && companyGSTState === customerGSTState;
  const taxByRate = new Map();
  const rows = (quote.items || []).map((item, index) => {
    const qty = Number(item.qty || 0);
    const rate = Number(item.rate || 0);
    const discount = Number(item.discount || 0);
    const taxable = Number(item.value ?? qty * rate * (1 - discount / 100));
    const gst = Number(item.gst || 0);
    const tax = taxable * gst / 100;
    const bucket = taxByRate.get(gst) || { taxable: 0, tax: 0 };
    bucket.taxable += taxable;
    bucket.tax += tax;
    taxByRate.set(gst, bucket);
    return `<tr><td>${index + 1}</td><td><b>${esc(item.productName || item.description || "Item")}</b>${item.description ? `<br><small>${esc(item.description)}</small>` : ""}</td><td>${esc(item.hsn || "—")}</td><td>${esc(qty)}</td><td>${esc(item.uom || "Nos")}</td><td class="num">${inr(rate)}</td><td class="num">${discount}%</td><td class="num">${inr(taxable)}</td></tr>`;
  }).join("");
  const taxableTotal = [...taxByRate.values()].reduce((sum, row) => sum + row.taxable, 0);
  const gstTotal = [...taxByRate.values()].reduce((sum, row) => sum + row.tax, 0);
  const taxRows = [...taxByRate.entries()].sort((a, b) => a[0] - b[0]).filter(([rate]) => rate > 0).map(([rate, row]) => intraState
    ? `<tr><td>CGST ${rate / 2}%</td><td class="num">${inr(row.tax / 2)}</td></tr><tr><td>SGST ${rate / 2}%</td><td class="num">${inr(row.tax - row.tax / 2)}</td></tr>`
    : `<tr><td>IGST ${rate}%</td><td class="num">${inr(row.tax)}</td></tr>`).join("");
  const total = Number(quote.total || taxableTotal + gstTotal);
  const bill = window.open("", "_blank");
  if (!bill) return toast("Allow pop-ups to view or print this quotation.");
  bill.document.open();
  bill.document.write(`<!doctype html><html><head><meta charset="utf-8"><title>${esc(quote.number || quote.id)} Quotation</title><style>body{font:14px Arial,sans-serif;color:#18212f;margin:38px}header{display:flex;justify-content:space-between;gap:22px;border-bottom:2px solid #233c63;padding-bottom:18px}.muted{color:#526176;line-height:1.55}h1{font-size:22px;margin:0 0 7px;color:#233c63}h2{margin:0;color:#233c63}.right{text-align:right}table{width:100%;border-collapse:collapse;margin-top:22px}th,td{padding:9px;border:1px solid #cbd3df;text-align:left;vertical-align:top}th{background:#f1f4f8}.num{text-align:right}.summary{margin:18px 0 0 auto;width:min(360px,100%)}.summary td{border:0;border-bottom:1px solid #d9dee7}.grand{font-size:17px;font-weight:bold}.terms{white-space:pre-wrap}.sign{display:flex;justify-content:flex-end;margin-top:48px}.sign div{border-top:1px solid #758196;padding-top:8px;text-align:center;min-width:220px}@media print{body{margin:16mm}.no-print{display:none}}</style></head><body><header><div><h1>${esc(company.name)}</h1><div class="muted">${esc(company.address || "Registered address not configured")}<br>${company.gstin ? `GSTIN: ${esc(company.gstin)}<br>` : ""}${esc(company.phone)} ${company.email ? `· ${esc(company.email)}` : ""}</div></div><div class="right"><h2>QUOTATION</h2><b>${esc(quote.number || quote.id)}</b><div class="muted">Date: ${esc(fs(quote.date))}<br>Valid Until: ${esc(fs(quote.validUntil))}<br>Status: ${esc(salesQuoteStatusLabel(quote.status))}</div></div></header><section style="display:flex;justify-content:space-between;gap:20px;margin-top:22px"><div><small class="muted">QUOTATION FOR</small><h3>${esc(quote.clientName || "")}</h3><div class="muted">${esc(quote.clientAddress || "")}<br>${quote.clientGst ? `GSTIN: ${esc(quote.clientGst)}<br>` : ""}${esc(quote.clientContact || "")} ${quote.clientEmail ? `· ${esc(quote.clientEmail)}` : ""}</div></div><div class="right muted">${quote.notes ? `Notes: ${esc(quote.notes)}` : ""}</div></section><table><thead><tr><th>#</th><th>Product / Description</th><th>HSN/SAC</th><th>Qty</th><th>Unit</th><th>Rate</th><th>Discount</th><th>Taxable Value</th></tr></thead><tbody>${rows || `<tr><td colspan="8">No quotation items.</td></tr>`}</tbody></table><table class="summary"><tbody><tr><td>Taxable Amount</td><td class="num">${inr(taxableTotal)}</td></tr>${taxRows || `<tr><td>GST</td><td class="num">${inr(0)}</td></tr>`}<tr class="grand"><td>Grand Total</td><td class="num">${inr(total)}</td></tr></tbody></table>${quote.terms ? `<section><h3>Terms &amp; Conditions</h3><div class="terms">${esc(quote.terms)}</div></section>` : ""}<div class="sign"><div>${esc(quote.signatory || company.name)}<br><b>Authorised Signatory</b></div></div><p class="muted">Quotation preview. Tax invoice is issued separately against the completed supply.</p><div class="no-print" style="margin-top:24px"><button onclick="window.print()">Print / Save PDF</button></div><script>window.onload=()=>window.print()<\/script></body></html>`);
  bill.document.close();
}

function salesPrintDeliveryBill(bill) {
  if (!bill) return toast("The Transport delivery bill is not available yet.");
  const company = bill.companySnapshot || {};
  const companyName = company.registeredBusinessName || company.companyName || "Company";
  const address = [company.address, company.state, company.pinCode, company.country].filter(Boolean).join(", ");
  const partyAddress = [bill.customerAddress ? esc(bill.customerAddress) : "", bill.customerGSTIN ? `GSTIN: ${esc(bill.customerGSTIN)}` : "", bill.customerContact ? esc(bill.customerContact) : ""].filter(Boolean).join("<br>");
  const rows = (bill.items || []).map((item, index) => `<tr><td>${index + 1}</td><td>${esc(item.itemName || "Item")}${item.description ? `<br><small>${esc(item.description)}</small>` : ""}</td><td>${esc(item.hsn || "—")}</td><td>${esc(item.quantity ?? "")}</td><td>${esc(item.unit || "Nos")}</td><td class="num">${inr(Number(item.unitRate || 0))}</td><td class="num">${inr(Number(item.taxableAmount || 0))}</td><td class="num">${Number(item.gstRate || 0)}%</td><td class="num">${inr(Number(item.totalAmount || 0))}</td></tr>`).join("");
  const tax = bill.taxBreakdown || {};
  const popup = window.open("", "_blank");
  if (!popup) return toast("Allow pop-ups to view or print the Transport delivery bill.");
  popup.document.open();
  popup.document.write(`<!doctype html><html><head><meta charset="utf-8"><title>${esc(bill.billNumber || bill.id)} Delivery Bill</title><style>body{font:14px Arial,sans-serif;color:#18212f;margin:36px}header{display:flex;justify-content:space-between;gap:22px;border-bottom:2px solid #233c63;padding-bottom:18px}h1,h2{color:#233c63;margin:0 0 8px}h1{font-size:22px}.muted{color:#526176;line-height:1.55}.right{text-align:right}.grid{display:grid;grid-template-columns:1fr 1fr;gap:20px;margin-top:22px}.box{border:1px solid #cbd3df;padding:12px}table{width:100%;border-collapse:collapse;margin-top:22px}th,td{padding:8px;border:1px solid #cbd3df;text-align:left;vertical-align:top}th{background:#f1f4f8}.num{text-align:right}.summary{margin:16px 0 0 auto;width:min(360px,100%)}.summary td{border:0;border-bottom:1px solid #d9dee7}.grand{font-size:16px;font-weight:bold}.sign{margin:48px 0 0 auto;border-top:1px solid #758196;padding-top:8px;text-align:center;width:230px}.note{margin-top:22px;color:#526176}@media print{body{margin:16mm}.no-print{display:none}}</style></head><body><header><div><h1>${esc(companyName)}</h1><div class="muted">${esc(address || "Registered address not configured")}<br>${company.gstin ? `GSTIN: ${esc(company.gstin)}<br>` : ""}${esc(company.phone || "")} ${esc(company.email || "")}</div></div><div class="right"><h2>DELIVERY CHALLAN</h2><b>${esc(bill.billNumber || bill.id)}</b><div class="muted">Date: ${esc(fs(bill.billDate))}<br>Sales Order: ${esc(bill.salesOrderNumber || bill.salesOrderId)}<br>Dispatch: ${esc(bill.dispatchId || "—")}</div></div></header><div class="grid"><section class="box"><b>Consignee</b><h3>${esc(bill.customerName || "—")}</h3><div class="muted">${partyAddress}</div></section><section class="box"><b>Transport Details</b><div class="muted">Transporter: ${esc(bill.transporterName || "—")}<br>Vehicle: ${esc(bill.vehicleNumber || "—")}<br>Driver: ${esc(bill.driverName || "—")} · ${esc(bill.driverContact || "—")}<br>From: ${esc(bill.from || "—")}<br>To: ${esc(bill.to || "—")}<br>Dispatch Date: ${esc(fs(bill.dispatchDate))}<br>Expected Delivery: ${esc(fs(bill.expectedDeliveryDate))}</div></section></div><table><thead><tr><th>#</th><th>Goods / Description</th><th>HSN/SAC</th><th>Qty</th><th>Unit</th><th>Rate</th><th>Taxable Value</th><th>GST</th><th>Line Total</th></tr></thead><tbody>${rows || `<tr><td colspan="9">No item details.</td></tr>`}</tbody></table><table class="summary"><tbody><tr><td>Taxable Value</td><td class="num">${inr(Number(bill.taxableAmount || 0))}</td></tr>${Number(bill.discountAmount || 0) ? `<tr><td>Discount</td><td class="num">− ${inr(Number(bill.discountAmount))}</td></tr>` : ""}${Number(tax.cgst || 0) ? `<tr><td>CGST</td><td class="num">${inr(Number(tax.cgst))}</td></tr>` : ""}${Number(tax.sgst || 0) ? `<tr><td>SGST</td><td class="num">${inr(Number(tax.sgst))}</td></tr>` : ""}${Number(tax.igst || 0) ? `<tr><td>IGST</td><td class="num">${inr(Number(tax.igst))}</td></tr>` : ""}<tr class="grand"><td>Goods Value</td><td class="num">${inr(Number(bill.totalAmount || 0))}</td></tr></tbody></table>${bill.deliveryNotes ? `<p class="note">Notes: ${esc(bill.deliveryNotes)}</p>` : ""}<p class="note">Approved by Transport · ${esc(bill.approvedByName || "")} · ${esc(fs(bill.approvedAt))}</p><p class="note">Delivery challan for goods movement. The applicable tax invoice is issued separately.</p><div class="sign">${esc(companyName)}<br><b>Authorised Signatory</b></div><div class="no-print" style="margin-top:22px"><button onclick="window.print()">Print / Save PDF</button></div><script>window.onload=()=>window.print()<\/script></body></html>`);
  popup.document.close();
}

async function notifyTransportOrder(order, button) {
  if (!order || !["READY_FOR_TRANSPORT"].includes(order.st)) return toast("Only a production-complete order can be sent to Transport.");
  if (button) button.disabled = true;
  try {
    const result = await window.VyaparXAuth.postWorkflowAction(`/api/sales/orders/${encodeURIComponent(order.id)}/transport-request`, {});
    if (!result?.request || !result?.salesOrder) throw new Error("Transport request was not confirmed by the server.");
    const savedOrder = salesOrderFromRecord(result.salesOrder);
    ORD = ORD.map((row) => String(row.id) === String(order.id) ? savedOrder : row);
    // The Sales binding serializes its UI-shaped order. Passing the raw API
    // record here would make salesOrderToRecord fall back to DRAFT and later
    // sync that stale status back over the server's transport handoff.
    window.VyaparXShared?.records?.markPersisted("sales", "salesOrder", savedOrder);
    render();
    toast(result.duplicate ? "This order is already with Transport." : "Transport request sent successfully.");
  } catch (error) {
    if (button) button.disabled = false;
    toast("Could not notify Transport: " + error.message);
  }
}

function orderView(o) {
  const t = tot(o);

  detail([
    [
      "Order Details",
      [
        ["Order No", o.orderNumber || o.id],
        ["Status", st(o.st)],
        ["Accounting Approval", st(o.accountingApprovalStatus || "Pending")],
        ["Order Date", fs(o.od)],
        ["Delivery Date", fs(o.dd)],
      ],
    ],
    [
      "Customer",
      [
        ["Customer ID", o.crm],
        ["Name", esc(CUST[o.crm])],
      ],
    ],
    [
      "Order Items",
      [
        ...o.items.map((x) => [
          esc(
            INV[x.i]?.[1] ||
              x.productName ||
              x.description ||
              "Catalog product",
          ),
          `${x.q} ${INV[x.i]?.[3] || x.uom || "Nos"} × ${inr(x.r)} = ${inr(x.q * x.r)}`,
        ]),
        ["Total", `<b>${inr(t)}</b>`],
      ],
    ],
    [
      "Payment",
      [
        ["Advance Required", o.adv + "% (" + inr(req(o)) + ")"],
        ["Advance Received", inr(o.rec)],
        ["Balance", inr(t - o.rec)],
        ["Payment Status", st(pay(o))],
      ],
    ],
    ...(o.accountingRelease ? [[
      "Payment Receipt (Accounting Release)",
      [
        ["Receipt / Voucher No.", esc(o.accountingRelease.voucherNumber || o.accountingRelease.entryId || "—")],
        ["Amount Released", inr(Number(o.accountingRelease.amount || 0))],
        ["Release Date", fs(o.accountingRelease.date)],
        ["Payment Method", esc(o.accountingRelease.method || "—")],
        ["Transaction Ref / UTR", esc(o.accountingRelease.utr || "—")],
        ["Payment Reference / Voucher", esc(o.accountingRelease.voucherRef || "—")],
        ["Status", esc(o.accountingRelease.releaseStatus || "Released")],
        ["Remaining Balance", inr(Number(o.accountingRelease.balanceDue ?? Math.max(0, t - o.rec)))],
        ...(o.accountingRelease.notes ? [["Notes", esc(o.accountingRelease.notes)]] : []),
      ],
    ]] : []),
    ["Production", [["Production Status", st(o.ps)]]],
    ...(o.transportRequestStatus || o.deliveryBillSnapshot ? [["Transport", [["Request", esc(o.transportRequestNumber || o.transportRequestId || "—")], ["Request Status", st(o.transportRequestStatus || "Not sent")], ["Dispatch", esc(o.dispatchId || "—")], ["Delivery Bill", esc(o.deliveryBillNumber || "Awaiting Transport approval")]]]] : []),
    ...(o.accountingDecisionReason ? [["Accounting Decision", [["Reason", esc(o.accountingDecisionReason)]]]] : []),
    [
      "Assignment",
      [
        ["Created By", esc(o.cb)],
        ["Created On", fs(o.ca)],
      ],
    ],
    ["Activity History", o.hist.map((x) => [fs(x[0]), esc(x[1])])],
  ]);
}

const attSec = (r) => [
  "Attachments",
  r.att.length
    ? r.att.map((a, i) => [
        "File " + (i + 1),
        `<div style="display:grid;gap:6px"><span style="word-break:break-all">${isI(a) ? "??" : "??"} ${esc(a.name)}<br><small style="color:var(--mut)">${a.type} • ${KB(a.size)}</small></span>${isI(a) && a.url ? `<img src="${a.url}" alt="${esc(a.name)}" style="max-width:100%;max-height:180px;border-radius:10px;border:1px solid var(--bd)">` : ""}<span style="display:flex;gap:6px"><button class="btn s" data-act="av:${r.id}:${a.id}"><i class="fa-solid fa-eye" aria-hidden="true"></i></button><button class="btn s" data-act="ad:${r.id}:${a.id}">Download</button></span></div>`,
      ])
    : [["File", "No attachment"]],
];

function recView(r) {
  const T = r.id[0] == "t";
  const n = NOTES.find((z) => z.ref == r.id);

  if (r.dir === "Received") {
    if (n) n.read = true;
    if (!T) r.read = true;
    render();
  }

  detail(
    T
      ? [
          [
            "Task Details",
            [
              ["Task Title", esc(r.s)],
              ["From", esc(r.from) + " (" + r.fd + ")"],
              ["To", esc(r.to) + " (" + r.td + ")"],
              ["Priority", st(r.p)],
              ["Due Date", fs(r.due)],
              ["Status", st(r.st)],
              ["Description", esc(r.desc)],
              ["Created On", fs(r.ca)],
              ["Updated On", fs(r.ua)],
            ],
          ],
          attSec(r),
          ["Activity / History", r.hist.map((x) => [fs(x[0]), esc(x[1])])],
        ]
      : [
          [
            "Communication Details",
            [
              ["Subject", esc(r.subj)],
              ["From", esc(r.from) + " (" + r.fd + ")"],
              ["To", esc(r.to) + " (" + r.td + ")"],
              ["Date / Time", fs(r.ca)],
              ["Status", st(r.read ? "Read" : "Unread")],
            ],
          ],
          ["Message", [["Message", esc(r.msg)]]],
          attSec(r),
        ],
  );
}

const attW = () =>
  `<div><div style="font-size:12px;color:var(--mut)">Attachments (optional)</div><button class="btn s" type="button" data-act="aadd" style="margin-top:6px">?? Attach File</button><input type="file" id="tf" hidden multiple accept=".jpg,.jpeg,.png,.webp,.pdf,.doc,.docx,.xls,.xlsx,.csv,.txt"><div id="tfp"></div><small id="tfe" style="color:var(--er)"></small><small style="display:block;color:var(--mut)">Images, PDF, DOC/DOCX, XLS/XLSX, CSV, TXT. Up to 3 files, 5 MB each.</small></div>`;

function attUI() {
  const e = $("#tfp");

  if (e) {
    e.innerHTML = PEND.map(
      (a, i) =>
        `<div style="display:flex;gap:10px;align-items:center;border:1px solid var(--bd);border-radius:10px;padding:8px;margin-top:6px">${isI(a) ? `<img src="${a.url}" alt="Preview" style="width:44px;height:44px;object-fit:cover;border-radius:8px">` : `<span style="font-size:22px">??</span>`}<span style="flex:1;min-width:0;word-break:break-all"><b style="font-weight:500">${esc(a.name)}</b><br><small style="color:var(--mut)">${a.type} • ${KB(a.size)}</small></span><button class="btn s" data-act="arm:${i}">Remove</button></div>`,
    ).join("");
  }
}

document.addEventListener("change", async (e) => {
  const t = e.target;

  if (t.id == "tf") {
    const er = $("#tfe");
    er.textContent = "";

    [...t.files].forEach((f, i) => {
      const ex = f.name.split(".").pop().toLowerCase();

      if (
        !AX[ex] ||
        (/^(jpg|jpeg|png|webp)$/.test(ex) && !/^image\//.test(f.type)) ||
        (ex == "pdf" && f.type && f.type != "application/pdf")
      ) {
        er.textContent = `"${f.name}" is not a supported file.`;
        return;
      }

      if (!f.size || f.size > 5242880) {
        er.textContent = `"${f.name}" must be between 1 byte and 5 MB.`;
        return;
      }

      if (PEND.length >= 3) {
        er.textContent = "You can attach up to 3 files.";
        return;
      }

      const attachment = {
        id: Date.now() + i,
        name: f.name.replace(/[\\\\/]/g, ""),
        type: AX[ex],
        size: f.size,
        url: URL.createObjectURL(f),
        ext: ex,
        uploading: false,
      };

      PEND.push(attachment);

      if (
        window.VyaparXAuth &&
        typeof window.VyaparXAuth.uploadFile === "function"
      ) {
        attachment.uploading = true;

        window.VyaparXAuth.uploadFile(f, "sales-attachments")
          .then((result) => {
            attachment.url = result.url;
            attachment.publicId = result.publicId;
            attachment.resourceType = result.resourceType;
            attachment.uploading = false;
            attUI();
          })
          .catch((error) => {
            PEND = PEND.filter(
              (item) => item.id !== attachment.id,
            );

            er.textContent =
              error.message || "Cloudinary upload failed.";

            attUI();
          });
      }
    });

    t.value = "";
    attUI();
  }

  if (t.id == "pf") {
    const f = t.files[0];
    t.value = "";

    if (!f) return;

    const er = $("#pfe");
    er.textContent = "";

    if (
      !/^image\/(jpeg|png|webp)$/.test(f.type) ||
      f.size > 2097152
    ) {
      er.textContent = "Use a JPG, PNG or WEBP image up to 2 MB.";
      return;
    }

    if (
      !window.VyaparXAuth ||
      typeof window.VyaparXAuth.uploadFile !== "function"
    ) {
      er.textContent =
        "Cloudinary upload service is unavailable. Check backend configuration.";
      return;
    }

    er.textContent = "Uploading image securely...";

    window.VyaparXAuth.uploadFile(f, "sales-profile")
      .then((result) => {
        tphoto = result.url;
        er.textContent = "";
        ppv();
      })
      .catch((error) => {
        er.textContent = error.message || "Image upload failed.";
      });
  }
});

const ppv = () => {
  const p = $("#pph");

  if (p) {
    p.innerHTML = tphoto
      ? `<img src="${tphoto}" alt="" style="width:100%;height:100%;border-radius:50%;object-fit:cover">`
      : ini(($("#pn") || { value: "?" }).value || "?");
  }
};

function sendForm() {
  const T = TAB == "Task";
  PEND = [];

  dlg(
    `<h3>${T ? "Send task" : "Send message"}</h3><div class="fm" style="max-width:none"><label>${T ? "Task Title" : "Subject"} *<input class="in" id="sx"></label><label>${T ? "Description" : "Message"} *<textarea class="in" id="sd" rows="3"></textarea></label><label>Send To *<select class="in" id="sto"><option value="">Select person</option>${PEOPLE().filter((p) => p.d !== "Sales Order")
      .map((p) => `<option value="${esc(p.n)}">${esc(p.n)} – ${p.d}</option>`)
      .join(
        "",
      )}</select></label>${T ? `<label>Priority *<select class="in" id="sp"><option value="">Select priority</option>${opts(["Low", "Medium", "High", "Urgent"])}</select></label><label>Due Date *<input class="in" type="date" id="su"></label>` : ""}${attW()}</div>`,
    T ? "Send Task" : "Send",
    async () => {
      const R = [
        [
          "#sx",
          (v) => v.length > 0,
          T ? "Enter the task title." : "Enter the subject.",
        ],
        [
          "#sd",
          (v) => v.length > 0,
          T ? "Enter a description." : "Enter the message.",
        ],
        ["#sto", (v) => v, "Select who to send this to."],
      ];

      if (T) {
        R.push(
          ["#sp", (v) => v, "Select a priority."],
          [
            "#su",
            (v) => v && !isNaN(Date.parse(v)) && v >= TODAY,
            "Choose a valid due date, today or later.",
          ],
        );
      }

      if (!vf(R)) return false;

      try {
        const to = $("#sto").value;
        const id = (T ? "t_" : "c_") + Date.now();

        const b = {
          id,
          from: ME,
          fd: "Sales Order",
          to,
          td: dept(to),
          att: PEND.slice(),
          ca: T ? TODAY : nowT(),
        };

        let newItem;

        if (T) {
          newItem = {
            ...b,
            type: "Task",
            title: $("#sx").value.trim(),
            s: $("#sx").value.trim(),
            description: $("#sd").value.trim(),
            desc: $("#sd").value.trim(),
            priority: $("#sp").value,
            p: $("#sp").value,
            dueDate: $("#su").value,
            due: $("#su").value,
            status: "Pending",
            st: "Pending",
            ua: TODAY,
            hist: [[TODAY, "Task created"]],
          };
        } else {
          newItem = {
            ...b,
            type: "Communication",
            title: $("#sx").value.trim(),
            subj: $("#sx").value.trim(),
            description: $("#sd").value.trim(),
            msg: $("#sd").value.trim(),
            read: false,
          };
        }

        if (
          !window.VyaparXShared ||
          !window.VyaparXShared.tasks
        ) {
          throw new Error("Task service unavailable.");
        }

        const saved =
          await window.VyaparXShared.tasks.createTask(newItem);

        if (T) {
          TASKS = [
            saved,
            ...TASKS.filter(
              (t) => t.id !== saved.id && t.id !== id,
            ),
          ];
        } else {
          COMMS = [
            saved,
            ...COMMS.filter(
              (c) => c.id !== saved.id && c.id !== id,
            ),
          ];
        }

        PEND = [];
        render();

        toast(
          T
            ? "Task sent successfully."
            : "Message sent successfully.",
        );
      } catch (e) {
        toast(e.message || "Unable to send. Please try again.");
        return false;
      }
    },
  );
}

function memberForm(m) {
  const n = !m;
  m = m || { n: "", e: "", ph: "", des: "", jd: "" };

  dlg(
    `<h3>${n ? "Add team member" : "Edit team member"}</h3><div class="fm"><label>Full name *<input class="in" id="mn" value="${esc(m.n)}"></label><label>Email *<input class="in" id="me" value="${esc(m.e)}"></label><label>Phone *<input class="in" id="mp" inputmode="numeric" value="${esc(m.ph)}"></label><label>Designation *<input class="in" id="md" value="${esc(m.des)}"></label><label>Joining date *<input class="in" type="date" id="mj" value="${m.jd}"></label></div>`,
    n ? "Add member" : "Save changes",
    () => {
      if (!canManageTeam()) return toast("Only the Sales Order Department Head can manage this team."), false;
      if (
        !vf([
          ["#mn", (v) => v.length > 0, "Enter the full name."],
          ["#me", (v) => EM.test(v), "Enter a valid email address."],
          [
            "#me",
            (v) =>
              !TEAM.some(
                (z) =>
                  z !== m &&
                  z.e.toLowerCase() == v.toLowerCase(),
              ),
            "This email already exists.",
          ],
          ["#mp", (v) => PH.test(v), "Enter a valid 10-digit phone number."],
          ["#md", (v) => v.length > 0, "Enter the designation."],
          [
            "#mj",
            (v) => v && v <= TODAY,
            "Enter a valid joining date, not in the future.",
          ],
        ])
      ) {
        return false;
      }

      const f = {
        n: $("#mn").value.trim(),
        e: $("#me").value.trim(),
        ph: $("#mp").value.trim(),
        des: $("#md").value.trim(),
        jd: $("#mj").value,
      };

      if (n) {
        TEAM.push(window.VyaparXShared.departmentTeam.createMember("sales", f));
      } else {
        if (f.n != m.n) ren(m.n, f.n);
        Object.assign(m, f);
      }

      render();

      toast(
        n
          ? "Team member added successfully."
          : "Team member updated successfully.",
      );
    },
  );
}

function ren(a, b) {
  ORD.forEach((o) => {
    if (o.cb == a) o.cb = b;
  });

  [...TASKS, ...COMMS].forEach((r) => {
    if (r.from == a) r.from = b;
    if (r.to == a) r.to = b;
  });

  if (ME == a) ME = b;
}

function profView() {
  const m = meM();

  if (!m?.n) {
    return toast("Your company profile could not be loaded.");
  }

  detail([
    [
      "Profile",
      [
        [
          "Profile Photo",
          `<span class="av" style="width:56px;height:56px;font-size:18px">${m.photo ? `<img src="${m.photo}" alt="" style="width:100%;height:100%;border-radius:50%;object-fit:cover">` : ini(m.n)}</span>`,
        ],
        ["Employee Name", esc(m.n)],
        ["Employee ID", m.eid],
        ["Email", esc(m.e)],
        ["Phone", esc(m.ph)],
        ["Department", "Sales Order"],
        ["Designation", esc(m.des)],
        ["Role", m.r],
        ["Status", `<span class="tag ok">Active</span>`],
      ],
    ],
  ]);

  const dl = [...document.querySelectorAll(".vm .dlg")].pop();
  const d = document.createElement("div");

  d.style.cssText =
    "display:flex;gap:8px;margin-top:18px;flex-wrap:wrap";

  d.innerHTML =
    (can("profile_edit")
      ? `<button class="btn p" data-act="pedit"><i class="fa-solid fa-pen-to-square" aria-hidden="true"></i> Edit Profile</button>`
      : "") +
    (can("profile_delete")
      ? `<button class="btn" data-act="pdel">Delete Profile</button>`
      : "");

  dl.append(d);
}

function profEdit() {
  const m = meM();
  tphoto = m.photo;

  dlg(
    `<h3>Edit profile</h3><div class="fm"><div style="display:flex;gap:12px;align-items:center"><span class="av" id="pph" style="width:56px;height:56px;font-size:18px"></span><span><button class="btn s" type="button" data-act="padd">Upload photo</button> <button class="btn s" type="button" data-act="prm">Remove photo</button><input type="file" id="pf" hidden accept=".jpg,.jpeg,.png,.webp"><small id="pfe" style="display:block;color:var(--er)"></small></span></div><label>Name *<input class="in" id="pn" value="${esc(m.n)}"></label><label>Phone *<input class="in" id="pp" inputmode="numeric" value="${esc(m.ph)}"></label><label>Email *<input class="in" id="pe" value="${esc(m.e)}" ${can("profile_email") ? "" : "disabled"}></label><label>Designation *<input class="in" id="pd" value="${esc(m.des)}" ${can("profile_designation") ? "" : "disabled"}></label></div><p style="color:var(--mut);font-size:12px">Role and permissions are managed by Admin.</p>`,
    "Save changes",
    () => {
      if (
        !vf([
          ["#pn", (v) => v.length > 0, "Enter your name."],
          ["#pp", (v) => PH.test(v), "Enter a valid 10-digit phone number."],
          ["#pe", (v) => EM.test(v), "Enter a valid email address."],
          ["#pd", (v) => v.length > 0, "Enter your designation."],
        ])
      ) {
        return false;
      }

      const n = $("#pn").value.trim();

      if (n != m.n) ren(m.n, n);

      Object.assign(m, {
        n,
        ph: $("#pp").value.trim(),
        photo: tphoto || null,
      });

      if (can("profile_email")) m.e = $("#pe").value.trim();
      if (can("profile_designation")) {
        m.des = $("#pd").value.trim();
      }

      render();
      toast("Profile updated successfully.");
    },
  );

  ppv();
}

const delTask = (r) =>
  dlg(
    `<h3>Delete ${r.type == "Communication" || String(r.id).startsWith("c") ? "communication" : "task"}?</h3><p>Are you sure you want to delete this ${r.type == "Communication" || String(r.id).startsWith("c") ? "communication" : "task"}?</p>`,
    "Delete",
    () => {
      try {
        if (
          window.VyaparXShared &&
          window.VyaparXShared.tasks
        ) {
          window.VyaparXShared.tasks
            .deleteTask(r.id)
            .catch((err) =>
              toast(err.message || "Delete failed"),
            );
        }

        TASKS = TASKS.filter((t) => t.id !== r.id);
        COMMS = COMMS.filter((c) => c.id !== r.id);
        NOTES = NOTES.filter((n) => n.ref != r.id);

        render();

        toast(
          (r.type == "Communication" ||
          String(r.id).startsWith("c")
            ? "Communication"
            : "Task") + " deleted successfully.",
        );
      } catch (e) {
        toast("Unable to delete. Please try again.");
        return false;
      }
    },
  );

const OKD = (h, b, ok, fn) =>
  dlg(`<h3>${h}</h3><p>${b}</p>`, ok, fn);

let SALES_CATALOG = [];
let SALES_CATALOG_READY = false;
let SALES_CATALOG_ERROR = "";
let SALES_CATALOG_LOADING = null;
let SALES_CATALOG_REFRESH_PENDING = false;
let SALES_CATALOG_LAST_FETCHED = 0;
let SALES_CATALOG_COMPANY_ID = "";

async function syncSalesCatalog(force = false) {
  if (!window.VyaparXAuth?.fetchModuleRecords) return false;

  const companyId =
    window.VyaparXAuth?.getCurrentSession?.()?.companyId ||
    "current-session";

  const companyChanged = Boolean(
    SALES_CATALOG_COMPANY_ID &&
      SALES_CATALOG_COMPANY_ID !== companyId,
  );

  if (companyChanged) {
    SALES_CATALOG = [];
    SALES_CATALOG_READY = false;
    SALES_CATALOG_ERROR = "";
    SALES_CATALOG_LAST_FETCHED = 0;

    if (cur === "catalog") render();
  }

  SALES_CATALOG_COMPANY_ID = companyId;

  if (SALES_CATALOG_LOADING) {
    if (force || companyChanged) {
      SALES_CATALOG_REFRESH_PENDING = true;
    }

    return SALES_CATALOG_LOADING;
  }

  const cacheFresh =
    SALES_CATALOG_READY &&
    Date.now() - SALES_CATALOG_LAST_FETCHED < 30000;

  if (cacheFresh && !force) return true;

  if (cur === "catalog" && !SALES_CATALOG_READY) render();

  SALES_CATALOG_LOADING = (async () => {
    try {
      const records =
        await window.VyaparXAuth.fetchModuleRecords("catalog");

      if (
        (window.VyaparXAuth?.getCurrentSession?.()?.companyId ||
          "current-session") !== companyId
      ) {
        SALES_CATALOG_REFRESH_PENDING = true;
        return false;
      }

      const nextCatalog = [
        ...new Map(
          (records || [])
            .filter(
              (item) =>
                item &&
                item.recordType === "product" &&
                !item.isDeleted &&
                item.id,
            )
            .map((item) => [String(item.id), item]),
        ).values(),
      ];

      const changed = salesDataChanged("catalog", nextCatalog);

      SALES_CATALOG = nextCatalog;
      SALES_CATALOG_READY = true;
      SALES_CATALOG_ERROR = "";
      SALES_CATALOG_LAST_FETCHED = Date.now();

      if (window.VyaparXCatalog) {
        await window.VyaparXCatalog.loadFields(false, records);
      }

      refreshOpenOrderItemOptions();

      if (changed && cur === "catalog") render();

      return true;
    } catch (error) {
      if (
        (window.VyaparXAuth?.getCurrentSession?.()?.companyId ||
          "current-session") !== companyId
      ) {
        SALES_CATALOG_REFRESH_PENDING = true;
        return false;
      }

      SALES_CATALOG_ERROR = error.message || "The request failed.";

      refreshOpenOrderItemOptions();

      toast(
        "Could not load the product catalog: " + SALES_CATALOG_ERROR,
      );

      if (cur === "catalog") render();

      return false;
    } finally {
      SALES_CATALOG_LOADING = null;

      const refreshAgain = SALES_CATALOG_REFRESH_PENDING;
      SALES_CATALOG_REFRESH_PENDING = false;

      if (refreshAgain) await syncSalesCatalog(true);
    }
  })();

  return SALES_CATALOG_LOADING;
}

function salesCatalogEditor(product = {}) {
  const fields = [
    ["name", "Product name *", product.name || "", "text"],
    ["code", "Product code", product.code || "", "text"],
    [
      "description",
      "Description / product details",
      product.description || "",
      "text",
    ],
    ["unit", "Unit of measure", product.unit || "Nos", "text"],
    ["hsn", "HSN / SAC", product.hsn || "", "text"],
    ["rate", "Selling price (₹) *", product.rate ?? 0, "number"],
    ["gst", "GST (%) *", product.gst ?? 0, "number"],
    [
      "discount",
      "Default discount (%)",
      product.discount ?? 0,
      "number",
    ],
  ];

  const customHtml = window.VyaparXCatalog
    ? window.VyaparXCatalog.customInputsHtml(product)
    : "";

  const html = `<div class="fm">${fields.map(([id, label, value, type]) => `<label>${label}<input class="in" id="cat-${id}" type="${type}" ${type === "number" ? 'min="0" step="0.01"' : ""} value="${esc(value)}"></label>`).join("")}${customHtml}<label><input id="cat-active" type="checkbox" ${product.isActive === false ? "" : "checked"}> Active in CRM quotations</label></div>`;

  dlg(
    `<h3>${product.id ? "Edit catalog product" : "Add catalog product"}</h3>${html}`,
    "Save product",
    (mask) => {
      const record = {
        ...(product.id ? { id: product.id } : {}),
        recordType: "product",
        name: mask.querySelector("#cat-name").value.trim(),
        code: mask.querySelector("#cat-code").value.trim(),
        description: mask
          .querySelector("#cat-description")
          .value.trim(),
        unit:
          mask.querySelector("#cat-unit").value.trim() || "Nos",
        hsn: mask.querySelector("#cat-hsn").value.trim(),
        rate: Number(mask.querySelector("#cat-rate").value),
        gst: Number(mask.querySelector("#cat-gst").value),
        discount: Number(mask.querySelector("#cat-discount").value),
        isActive: mask.querySelector("#cat-active").checked,
      };

      if (
        !record.name ||
        [record.rate, record.gst, record.discount].some(
          (value) => !Number.isFinite(value),
        )
      ) {
        toast(
          "Enter a product name and valid price, GST, and discount.",
        );
        return false;
      }

      if (window.VyaparXCatalog) {
        const missing =
          window.VyaparXCatalog.validateRequired(mask);

        if (missing.length) {
          toast("Required custom fields: " + missing.join(", "));
          return false;
        }

        window.VyaparXCatalog.applyCustomValues(record, mask);
      }

      const save = window.VyaparXShared?.records?.saveRecord
        ? window.VyaparXShared.records.saveRecord("catalog", record)
        : window.VyaparXAuth
            .saveModuleRecord("catalog", record)
            .then((result) => result.record);

      Promise.resolve(save)
        .then(() => syncSalesCatalog(true))
        .then(render)
        .then(() => toast("Product catalog saved."))
        .catch((error) =>
          toast("Product was not saved: " + error.message),
        );
    },
  );
}

document.addEventListener("click", (e) => {
  const t = e.target.closest(
    "[data-go],[data-act],[data-s],[data-addcol]",
  );

  if (t && t.dataset.addcol != null) {
    window.VyaparXFields.openAddColumn(
      t.dataset.addcol,
      () => render(),
    );
    return;
  }

  if (!t) return;

  const d = t.dataset;

  if (d.go === "quotations") {
    loadSharedQuotes(true, ["quotations"]);
  }

  if (d.go) return go(d.go);

  if (d.s != null) {
    const i = +d.s;
    sort = {
      i,
      d: sort && sort.i == i ? -sort.d : 1,
    };

    return render();
  }

  const [a, x, y] = d.act.split(":");
  const o = OB(x);

  if (a === "catadd") return salesCatalogEditor();

  if (a === "catprint") {
    if (!SALES_CATALOG.length) {
      return toast("Add catalog products before printing.");
    }

    if (window.VyaparXCatalog) {
      window.VyaparXCatalog.loadFields().then(() =>
        window.VyaparXCatalog.printCatalog(SALES_CATALOG),
      );
    }

    return;
  }

  if (a === "catfields") {
    if (!window.VyaparXCatalog) return;

    window.VyaparXCatalog.loadFields().then(() =>
      window.VyaparXCatalog.manageFields(
        document.body,
        () => render(),
      ),
    );

    return;
  } else if (a === "catedit") {
    const product = SALES_CATALOG.find(
      (item) => String(item.id) === x,
    );

    if (product) salesCatalogEditor(product);
  } else if (a === "catdelete") {
    const product = SALES_CATALOG.find(
      (item) => String(item.id) === x,
    );

    if (product) {
      OKD(
        "Delete catalog product?",
        `${product.name} will be removed from future CRM quotations.`,
        "Delete product",
        () => {
          const remove = window.VyaparXShared?.records?.deleteRecord
            ? window.VyaparXShared.records.deleteRecord(
                "catalog",
                product.id,
              )
            : window.VyaparXAuth.deleteModuleRecord(
                "catalog",
                product.id,
              );

          Promise.resolve(remove)
            .then(() => syncSalesCatalog(true))
            .then(render)
            .then(() => toast("Product removed from the catalog."))
            .catch((error) =>
              toast("Product was not deleted: " + error.message),
            );
        },
      );
    }
  } else if (a == "add") {
    orderForm();
  } else if (a == "oe") {
    orderForm(o);
  } else if (a == "ov") {
    orderView(o);
  } else if (a === "notifyTransport") {
    notifyTransportOrder(o, t);
  } else if (a === "viewDeliveryBill") {
    salesPrintDeliveryBill(o?.deliveryBillSnapshot);
  } else if (a == "qview") {
    const quote = SHARED_QUOTES.find(
      (record) => String(record.id) === String(x),
    );

    if (quote) {
      salesQuotationBill(quote);
    }
  } else if (a == "qdelete") {
    const quote = SHARED_QUOTES.find(
      (record) => String(record.id) === String(x),
    );

    if (!quote) {
      return toast("This quotation is no longer available.");
    }

    const confirm = window.confirm(
      `Delete quotation ${quote.number || quote.id}? This follows the company's quotation deletion policy.`,
    );

    if (!confirm) return;

    const button = t;
    button.disabled = true;

    window.VyaparXAuth
      .deleteModuleRecord("quotations", quote.id)
      .then((result) => {
        if (result?.success !== true) {
          throw new Error("The server did not confirm deletion.");
        }

        SHARED_QUOTES = SHARED_QUOTES.filter(
          (record) => String(record.id) !== String(quote.id),
        );

        SALES_DATA_SIGNATURES.delete(
          `${window.VyaparXAuth.getCurrentSession?.()?.companyId || "current-session"}:quotations`,
        );

        render();
        toast("Quotation deleted successfully.");
      })
      .catch((error) => {
        button.disabled = false;
        toast("Quotation was not deleted: " + error.message);
      });
  } else if (a == "qsend" || a == "qreject") {
    const quote = SHARED_QUOTES.find(
      (record) => String(record.id) === String(x),
    );

    if (!quote) {
      return toast("This quotation is no longer available.");
    }

    if (!salesQuoteIsPending(quote)) {
      return toast("Only a pending quotation can be reviewed.");
    }

    const role = window.VyaparXAuth?.getCurrentSession?.()?.role;

    if (role !== "Sales" && role !== "Admin") {
      return toast("You are not authorized to review quotations.");
    }

    const button = t;
    const nextStatus = a === "qreject" ? "Rejected" : "Approved";

    button.disabled = true;

    (async () => {
      try {
        const saved = window.VyaparXShared?.records?.saveRecord
          ? await window.VyaparXShared.records.saveRecord(
              "quotations",
              { id: quote.id, status: nextStatus },
            )
          : (
              await window.VyaparXAuth.saveModuleRecord(
                "quotations",
                { id: quote.id, status: nextStatus },
              )
            ).record;

        if (
          !saved ||
          String(saved.status || "").toLowerCase() !==
            nextStatus.toLowerCase()
        ) {
          throw new Error(
            "The server did not confirm the quotation review.",
          );
        }

        Object.assign(quote, saved);
        render();

        toast(
          nextStatus === "Approved"
            ? "Quotation approved."
            : "Quotation rejected.",
        );
      } catch (error) {
        toast("Quotation was not updated: " + error.message);
      } finally {
        if (button.isConnected) button.disabled = false;
      }
    })();
  } else if (a == "qconvert") {
    const quote = SHARED_QUOTES.find(
      (record) => String(record.id) === String(x),
    );

    if (quote?.status === "Converted" || quote?.salesOrderId) {
      return toast("This quotation already has a Sales Order.");
    }

    if (!quote || !salesQuoteIsApproved(quote)) {
      return toast("Only an approved quotation can be converted.");
    }

    const customerId = quote.clientId || quote.leadId || "";

    if (
      !SALES_CUSTOMERS.some(
        (customer) => String(customer.id) === String(customerId),
      )
    ) {
      return toast(
        "Convert this approved CRM lead to an active customer before creating its Sales Order.",
      );
    }

    const button = t;
    button.disabled = true;

    const salesOrderId = "SO-Q-" + quote.id;

    const order = {
      id: salesOrderId,
      recordType: "salesOrder",
      quotationId: quote.id,
      quotationNumber: quote.number,
      customerId,
      customerName: quote.clientName,
      orderDate: quote.date,
      deliveryDate: quote.validUntil,
      advancePercent: 0,
      gstInclusive: !!quote.gstInclusive,
      items: (quote.items || []).map((item) => ({
        ...item,
        i: item.productId,
        q: Number(item.qty || 0),
        r: Number(item.rate || 0),
      })),
      total: Number(quote.total || 0),
      status: "DRAFT",
      createdAt: new Date().toISOString(),
    };

    (async () => {
      try {
        let created;

        try {
          created = (
            await window.VyaparXAuth.createModuleRecord(
              "sales",
              order,
            )
          )?.record;

          if (!created?.id) {
            throw new Error(
              "The server did not confirm the Sales Order.",
            );
          }
        } catch (createError) {
          if (
            !/already has a Sales Order/i.test(
              createError.message || "",
            )
          ) {
            throw createError;
          }

          created = (
            await window.VyaparXAuth.fetchModuleRecords("sales")
          ).find(
            (record) =>
              record.recordType === "salesOrder" &&
              String(record.quotationId) === String(quote.id),
          );

          if (!created) throw createError;
        }

        const quoteUpdate = {
          id: quote.id,
          status: "Converted",
          salesOrderId: created.id,
        };

        if (window.VyaparXShared?.records?.saveRecord) {
          await window.VyaparXShared.records.saveRecord(
            "quotations",
            quoteUpdate,
          );
        } else {
          await window.VyaparXAuth.saveModuleRecord(
            "quotations",
            quoteUpdate,
          );
        }

        const savedOrder = salesOrderFromRecord(created);

        appendConvertedOrder(savedOrder);

        window.VyaparXShared?.records?.markPersisted(
          "sales",
          "salesOrder",
          savedOrder,
        );

        quote.status = "Converted";
        quote.salesOrderId = created.id;

        render();

        toast(
          `Sales Order ${created.orderNumber || created.id} created from ${quote.number}`,
        );
      } catch (error) {
        toast(
          "Sales Order conversion could not be completed: " +
            error.message,
        );
      } finally {
        if (button.isConnected) button.disabled = false;
      }
    })();
  } else if (a == "addit") {
    tmp.push({ i: "", q: "", r: "" });
    itemsUI();
  } else if (a == "rmit") {
    tmp.splice(+x, 1);
    itemsUI();
  } else if (a == "osub") {
    OKD(
      "Submit for approval?",
      `${o.id} will be sent to the Sales Head for approval.`,
      "Submit",
      () => {
        o.st = "PENDING_APPROVAL";
        addh(o, "Submitted for approval");
        render();
        toast("Submitted for approval");
      },
    );
  } else if (a == "oap") {
    if (o.cb == ME) {
      return toast(
        "You created this order, so another approver must approve it.",
      );
    }

    OKD(
      "Approve order?",
      `${o.id} will be confirmed. If an advance is required, it waits until the advance is received.`,
      "Approve",
      () => {
        o.st =
          req(o) > 0 && o.rec < req(o)
            ? "ADVANCE_PENDING"
            : "CONFIRMED";

        addh(
          o,
          "Approved by " +
            ME +
            ". Status: " +
            o.st.replace(/_/g, " "),
        );

        render();
        toast("Order approved");
      },
    );
  } else if (a == "opr") {
    toast("Production can start after Accounting approves this Sales Order.");
  } else if (a == "oprd") {
    toast("Sales Order is linked to its Accounting approval request. Production is released after Accounting approval.");
  } else if (a == "ocn") {
    dlg(
      `<h3>Cancel ${o.id}?</h3><div class="fm"><label>Reason *<input class="in" id="cr"></label></div>`,
      "Cancel order",
      () => {
        if (
          !vf([
            [
              "#cr",
              (v) => v.length > 2,
              "Enter the cancellation reason.",
            ],
          ])
        ) {
          return false;
        }

        o.st = "CANCELLED";
        addh(o, "Cancelled: " + $("#cr").value.trim());

        render();
        toast("Order cancelled");
      },
    );
  } else if (a == "ev") {
    const m = TEAM.find((z) => z.id == x);

    detail([
      [
        "Employee Details",
        [
          ["Name", esc(m.n)],
          ["Email", esc(m.e)],
          ["Phone", esc(m.ph)],
          ["Department", "Sales Order"],
          ["Designation", esc(m.des)],
          ["Role", m.r],
          ["Joining Date", fs(m.jd)],
          ["Status", `<span class="tag ok">Active</span>`],
        ],
      ],
    ]);
  } else if (a == "pview") {
    profView();
  } else if (a == "madd" && canManageTeam()) {
    memberForm();
  } else if (a == "me" && canManageTeam()) {
    memberForm(TEAM.find((z) => z.id == x));
  } else if (a == "md" && canManageTeam()) {
    const m = TEAM.find((z) => z.id == x);

    dlg(
      `<h3>Delete team member?</h3><p>Are you sure you want to delete this team member?</p>`,
      "Delete",
      () => {
        TEAM = TEAM.filter((z) => z !== m);
        render();
        toast("Team member deleted successfully.");
      },
    );
  } else if (a == "tv") {
    recView(REC(x));
  } else if (a == "td") {
    delTask(REC(x));
  } else if (a == "adv") {
    if (k) {
      const nextSt =
        k.st == "Pending" ? "In Progress" : "Completed";

      k.st = nextSt;
      k.ua = TODAY;
      k.hist.push([TODAY, "Status changed to " + k.st]);

      render();
      toast("Task updated successfully.");

      if (
        window.VyaparXShared &&
        window.VyaparXShared.tasks
      ) {
        window.VyaparXShared.tasks
          .updateTask(k.id, { st: nextSt, status: nextSt })
          .catch((err) =>
            console.warn(
              "Failed to update task status:",
              err,
            ),
          );
      }
    }
  } else if (a == "send") {
    sendForm();
  } else if (a == "tab") {
    TAB = x;
    FLT = "All";
    q = "";
    spin();
  } else if (a == "flt") {
    FLT = x;
    spin();
  } else if (a == "spin") {
    spin();
  } else if (a == "aadd") {
    $("#tf").click();
  } else if (a == "arm") {
    PEND.splice(+x, 1);
    attUI();
  } else if (a == "av" || a == "ad") {
    const r = REC(x);
    const f = r.att.find((z) => z.id == y);

    if (!f.url) {
      return toast(
        "Demo attachment – real files are stored in Cloudinary after backend integration.",
      );
    }

    if (a == "av") {
      if (isI(f) || f.ext == "pdf") {
        window.open(f.url, "_blank");
      } else {
        toast(
          "Preview isn't available for this file type. Use Download.",
        );
      }
    } else {
      const l = document.createElement("a");
      l.href = f.url;
      l.download = f.name;
      l.click();

      toast("Download started.");
    }
  } else if (a == "nrd") {
    const note = NOTES.find((z) => z.id == x);

    if (note) {
      note.read = true;

      if (
        note.id.startsWith("n_") &&
        window.VyaparXShared?.tasks
      ) {
        window.VyaparXShared.tasks
          .updateTask(note.ref, { isRead: true, read: true })
          .catch(() => {});
      }
    }

    render();
  } else if (a == "nopen") {
    const n = NOTES.find((z) => z.id == x);
    recView(REC(n.ref));
  } else if (a == "padd") {
    $("#pf").click();
  } else if (a == "prm") {
    tphoto = null;
    ppv();
  } else if (a == "pedit") {
    document.querySelectorAll(".vm").forEach((m) => m.remove());
    profEdit();
  } else if (a == "pdel") {
    document.querySelectorAll(".vm").forEach((m) => m.remove());

    dlg(
      `<h3>Delete profile?</h3><p>Are you sure you want to delete this profile?</p>`,
      "Delete",
      () => {
        toast(
          "Your own account can't be deleted while signed in. Ask Admin to deactivate it.",
        );
      },
    );
  } else if (a == "read") {
    NOTES.forEach((n) => (n.read = true));

    if (window.VyaparXShared?.tasks) {
      NOTES.filter((n) => n.id.startsWith("n_")).forEach((n) =>
        window.VyaparXShared.tasks
          .updateTask(n.ref, { isRead: true, read: true })
          .catch(() => {}),
      );
    }

    render();
  } else if (a == "csv") {
    toast("CSV is generated by the backend after integration");
  }
});

document.addEventListener("input", (e) => {
  const t = e.target;

  if (t.dataset.q != null) {
    q = t.value;

    const p = t.selectionStart;

    render();

    const n = $("[data-q]");
    n.focus();
    n.setSelectionRange(p, p);
  }

  if (t.dataset.k) {
    const x = tmp[+t.dataset.i];
    if (!x) return;

    if (
      t.dataset.k === "i" &&
      t.value &&
      !SALES_CATALOG.some(
        (item) =>
          String(item.id) === String(t.value) &&
          item.isActive !== false &&
          !item.isDeleted,
      )
    ) {
      toast("Choose an active Product Catalog item.");
      return;
    }

    x[t.dataset.k] = t.value;

    if (t.dataset.k == "i" && t.value) {
      const product = SALES_CATALOG.find(
        (item) => String(item.id) === String(t.value),
      );

      if (
        !product ||
        product.isActive === false ||
        product.isDeleted
      ) {
        x.i = "";
        toast("Choose an active Product Catalog item.");
        itemsUI();
        return;
      }

      x.r = String(product.rate || 0);
      x.discount = Number(product.discount || 0);
      x.gst = Number(product.gst || 0);
      x.uom = product.unit || "Nos";
      x.hsn = product.hsn || "";
      x.productName = product.name || "";
      x.description = product.description || "";
      itemsUI();
    } else {
      $("#ia" + t.dataset.i).textContent = inr(amt(x));
      tt();
    }
  }
});

document.addEventListener("change", (e) => {
  if (e.target.dataset.f != null) {
    fv = e.target.value;
    render();
  }
});

$("#gs").addEventListener("keydown", (e) => {
  if (e.key == "Enter") {
    const v = e.target.value;
    go("orders");
    q = v;
    render();
  }
});

$("#bell").onclick = () => go("notif");
$("#ct").onclick = () => document.body.classList.toggle("col");
$("#mb").onclick = () => window.VyaparXShared.toggleMobileNav();

$("#th").onclick = () => {
  if (window.VyaparXShared) {
    window.VyaparXShared.applyTheme(
      window.VyaparXShared.currentTheme() === "dark"
        ? "light"
        : "dark",
    );
  }
};

/*
 * FIX 2:
 * Normalize the Sales Order record from Firestore/API.
 * The history property belongs inside this return object.
 */
function salesOrderFromRecord(order) {
  const customerKey = salesCustomerKey(
    order.customerId || order.quotationId || order.id || "",
  );

  CUST[customerKey] =
    order.customerName || CUST[customerKey] || "";

  const items = (order.items || []).map((item, index) => {
    const productKey = String(
      item.productId ||
        item.i ||
        `Q-${order.quotationId}-${index + 1}`,
    );

    const productName =
      item.productName ||
      item.description ||
      INV[productKey]?.[1] ||
      "Item";

    INV[productKey] = [
      item.hsn || "",
      productName,
      Number(item.rate ?? item.r ?? 0),
      item.uom || "Nos",
    ];

    return {
      ...item,
      i: productKey,
      q: Number(item.qty ?? item.q ?? 0),
      r: Number(item.rate ?? item.r ?? 0),
      gst: Number(item.gst || 0),
      discount: Number(item.discount || 0),
    };
  });

  return {
    id: String(order.id || ""),
    quotationId: String(order.quotationId || ""),
    quotationNumber: order.quotationNumber || "",
    customerId: order.customerId || "",
    customerName: order.customerName || "",
    crm: customerKey,

    od: String(
      order.orderDate ||
        order.od ||
        order.createdAt ||
        TODAY,
    ).slice(0, 10),

    dd: String(
      order.deliveryDate ||
        order.dd ||
        TODAY,
    ).slice(0, 10),

    adv: Number(order.advancePercent ?? order.adv ?? 0),
    rec: Number(order.received ?? order.rec ?? 0),
    gstInclusive: !!order.gstInclusive,
    paymentStatus: order.paymentStatus || "UNPAID",

    st: order.status || order.st || "DRAFT",
    accountingApprovalStatus: order.accountingApprovalStatus || "Pending",
    accountingDecisionReason: order.accountingDecisionReason || "",
    ps:
      order.productionStatus ||
      order.ps ||
      "NOT_STARTED",

    cb: order.createdByName || order.cb || "",
    ca: order.createdAt || order.ca || TODAY,

    prdCode: order.prdCode || "",
    prdSentAt: order.prdSentAt || "",
    prdSentBy: order.prdSentBy || "",
    transportRequestId: order.transportRequestId || "",
    transportRequestNumber: order.transportRequestNumber || "",
    transportRequestStatus: order.transportRequestStatus || "",
    transportStatus: order.transportStatus || "",
    dispatchId: order.dispatchId || "",
    deliveryBillId: order.deliveryBillId || "",
    deliveryBillNumber: order.deliveryBillNumber || "",
    deliveryBillSnapshot: order.deliveryBillSnapshot || null,

    orderNumber: order.orderNumber || order.id || "",

    // Persisted Accounting release/receipt info shown in the View popup.
    accountingRelease: order.accountingRelease || (order.receiptId ? {
      entryId: order.receiptId,
      voucherNumber: order.receiptNumber || "",
      amount: order.receiptAmount || order.amountReceived || 0,
      date: order.receiptDate || "",
      method: order.receiptMethod || "",
      utr: order.receiptUtr || "",
      voucherRef: order.receiptVoucherRef || "",
      releaseStatus: order.receiptStatus || "Released",
      balanceDue: Number(order.balanceDue ?? 0),
      notes: order.receiptNotes || "",
    } : null),

    // Fix: convert stored history before binding to the UI.
    hist: salesHistoryForUI(
      Array.isArray(order.history)
        ? order.history
        : order.hist,
    ),

    items,
  };
}

function salesOrderToRecord(order) {
  const customerId =
    order.customerId ||
    SALES_CUSTOMERS.find(
      (customer) =>
        salesCustomerKey(customer.id) === String(order.crm || ""),
    )?.id ||
    String(order.crm || "").replace(/^CRM-/, "");

  const customerName =
    order.customerName || CUST[order.crm] || "";

  return {
    id: String(order.id),
    orderNumber: order.orderNumber || String(order.id),
    recordType: "salesOrder",

    quotationId: String(order.quotationId || ""),
    quotationNumber: order.quotationNumber || "",

    customerId,
    customerName,

    orderDate: order.od || order.ca || TODAY,
    deliveryDate: order.dd || TODAY,

    advancePercent: Number(order.adv || 0),
    received: Number(order.rec || 0),
    gstInclusive: !!order.gstInclusive,
    paymentStatus: order.paymentStatus || "UNPAID",

    productionStatus: order.ps || "NOT_STARTED",
    status: order.st || "DRAFT",
    transportRequestId: order.transportRequestId || "",
    transportRequestNumber: order.transportRequestNumber || "",
    transportRequestStatus: order.transportRequestStatus || "",
    transportStatus: order.transportStatus || "",
    dispatchId: order.dispatchId || "",
    deliveryBillId: order.deliveryBillId || "",
    deliveryBillNumber: order.deliveryBillNumber || "",
    deliveryBillSnapshot: order.deliveryBillSnapshot || null,
    items: (order.items || []).map((item) => ({
      productId: item.productId || item.i || "",

      productName:
        item.productName ||
        item.description ||
        INV[item.i]?.[1] ||
        "Item",

      description: item.description || "",
      hsn: item.hsn || INV[item.i]?.[0] || "",
      uom: item.uom || INV[item.i]?.[3] || "Nos",

      qty: Number(item.qty ?? item.q ?? 0),
      rate: Number(item.rate ?? item.r ?? 0),
      gst: Number(item.gst || 0),
      discount: Number(item.discount || 0),
    })),

    total: Number(tot(order) || 0),

    createdAt: order.ca || new Date().toISOString(),
    createdByName: order.cb || "",

    history: salesHistoryForFirestore(order.hist),

    prdCode: order.prdCode || "",
    prdSentAt: order.prdSentAt || "",
    prdSentBy: order.prdSentBy || "",
  };
}

if (window.VyaparXShared?.records?.bindPageState) {
  window.VyaparXShared.records.bindPageState(
    "sales",
    [
      { recordType: "teamMember", get: () => TEAM, set: (rows) => { TEAM = rows; } },
      {
        recordType: "salesOrder",
        get: () => ORD,
        set: (rows) => {
          ORD = rows;
        },
        fromRecord: salesOrderFromRecord,
        toRecord: salesOrderToRecord,
      },
    ],
    {
      onReady: () => {
        if (["dashboard", "orders", "reports", "team"].includes(cur)) {
          render();
        }
      },
      onError: (error) =>
        toast(
          "Sales records could not sync with Firestore: " +
            error.message,
        ),
    },
  );
}

const salesInitialView =
  new URLSearchParams(window.location.search).get("view");

go(
  salesInitialView && V[salesInitialView]
    ? salesInitialView
    : "dashboard",
);

loadSharedQuotes();
syncSalesCatalog();

if (window.VyaparXFields) {
  window.VyaparXFields.loadFields("sales").then(() => {
    if (cur === "orders") render();
  });
}

const SALES_PENDING_RECORD_MODULES = new Set();
let SALES_RECORD_REFRESH_TIMER = null;

function scheduleSalesRecordRefresh(moduleName) {
  const module = String(moduleName || "").toLowerCase();

  if (!module) {
    ["crm", "quotations", "sales", "catalog"].forEach((name) =>
      SALES_PENDING_RECORD_MODULES.add(name),
    );
  } else if (
    ["crm", "quotations", "sales", "catalog"].includes(module)
  ) {
    SALES_PENDING_RECORD_MODULES.add(module);
  }

  if (SALES_RECORD_REFRESH_TIMER) return;

  SALES_RECORD_REFRESH_TIMER = window.setTimeout(() => {
    SALES_RECORD_REFRESH_TIMER = null;

    const modules = [...SALES_PENDING_RECORD_MODULES];
    SALES_PENDING_RECORD_MODULES.clear();

    if (modules.includes("crm")) SALES_CUSTOMERS_READY = false;

    const sharedModules = modules.filter((name) =>
      ["crm", "quotations", "sales"].includes(name),
    );

    if (modules.includes("sales") && window.VyaparXFields) {
      window.VyaparXFields.loadFields("sales", true);
    }

    if (sharedModules.length) {
      loadSharedQuotes(true, sharedModules);
    }

    if (modules.includes("catalog")) {
      syncSalesCatalog(true);
    }
  }, 40);
}

if (window.VyaparXShared?.records?.onRecordsUpdated) {
  window.VyaparXShared.records.onRecordsUpdated(
    scheduleSalesRecordRefresh,
  );
}

window.addEventListener("focus", () => {
  const salesDataViews = [
    "dashboard",
    "orders",
    "pending",
    "delivery",
    "payments",
    "items",
    "reports",
  ];

  if (
    window.VyaparXFields &&
    salesDataViews.includes(cur)
  ) {
    window.VyaparXFields.loadFields("sales", true);
  }

  const modules =
    cur === "quotations"
      ? ["quotations"]
      : salesDataViews.includes(cur)
        ? ["sales"]
        : [];

  if (document.querySelector(".mask #oc")) {
    modules.push("crm");
  }

  if (modules.length) {
    loadSharedQuotes(true, modules);
  }

  if (
    cur === "catalog" ||
    document.querySelector(".mask #oc")
  ) {
    syncSalesCatalog(true);
  }
});

window.setInterval(() => {
  if (document.visibilityState !== "visible") return;

  if (cur === "quotations") {
    loadSharedQuotes(true, ["quotations"]);
  } else if (
    [
      "dashboard",
      "orders",
      "pending",
      "delivery",
      "payments",
      "items",
      "reports",
    ].includes(cur)
  ) {
    const modules = ["sales"];

    if (document.querySelector(".mask #oc")) {
      modules.push("crm");
      syncSalesCatalog(true);
    }

    loadSharedQuotes(true, modules);
  } else if (cur === "catalog") {
    syncSalesCatalog(true);
  }
}, 30000);

// Admin Reports integration: expose this module's real records so the Admin
// report engine builds SALES reports from actual order data, not static counts.
// Converted (Firestore-backed) orders plus in-page orders are both reported.
window.SALES_REPORT_SOURCE = function () {
  try {
    return ORD.map(function (order) {
      return {
        type: "Sales Order",
        ref: order.id || "",
        user: order.cb || "",
        date: order.od || TODAY,
        status: String(order.st || "")
          .replace(/_/g, " ")
          .toLowerCase(),
        amount:
          "?" +
          Number(tot(order) || 0).toLocaleString("en-IN"),
      };
    });
  } catch (e) {
    return [];
  }
};

async function salesSyncTasksFromDb() {
  if (
    window.VyaparXShared &&
    window.VyaparXShared.tasks
  ) {
    try {
      const all =
        await window.VyaparXShared.tasks.fetchTasks();

      if (!Array.isArray(all)) return;

      TASKS = all.filter((t) => t.type !== "Communication");
      COMMS = all.filter((t) => t.type === "Communication");

      NOTES = [
        ...NOTES.filter((note) => note.k),
        ...all
          .filter((task) => task.dir === "Received")
          .map((task) => ({
            id: "n_" + task.id,
            ref: task.id,
            read: !!(task.read || task.isRead),
          })),
      ];

      NOTES = [
        ...NOTES.filter((n) => n.k),
        ...[...TASKS, ...COMMS]
          .filter((t) => t.dir === "Received")
          .map((t) => ({
            id: "n_" + t.id,
            ref: t.id,
            read: !!(t.read || t.isRead),
          })),
      ];

      if (["tasks", "notif", "dashboard"].includes(cur)) {
        render();
      }
    } catch (e) {
      console.warn("Could not sync tasks in Sales:", e);
    }
  }
}

salesSyncTasksFromDb();

if (
  window.VyaparXShared &&
  window.VyaparXShared.tasks
) {
  window.VyaparXShared.tasks.onTasksUpdated(
    salesSyncTasksFromDb,
  );
}
