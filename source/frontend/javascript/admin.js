/**

 * VyaparX ERP - Administration Controller

 * Manages Role-Based Access Control (RBAC), Permissions, and System Announcements.

 */



const $ = (s) => document.querySelector(s);

const MODS = [

  "CRM",

  "Sales Order",

  "Purchase & Trading",

  "Production",

  "Inventory",

  "Transport",

  "Accounting",

];

const PERMS = [

  "View",

  "Create",

  "Edit",

  "Delete",

  "Approve",

  "Export",

  "Reports",

];

const ic = (p) =>

  `<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">${p}</svg>`;

const esc = (s) =>

  String(s).replace(

    /[&<>"]/g,

    (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c],

  );

const NAV = [

  [

    "dashboard",

    "Dashboard",

    "<rect x='3' y='3' width='7' height='9'/><rect x='14' y='3' width='7' height='5'/><rect x='14' y='12' width='7' height='9'/><rect x='3' y='16' width='7' height='5'/>",

  ],

  ["catalog", "Product Catalog", "<path d='M4 5h16v14H4zM8 9h8M8 13h5'/>"] ,

  [

    "roles",

    "Role & Permission",

    "<path d='M12 3l8 3v6c0 5-3.5 8-8 9-4.5-1-8-4-8-9V6z'/>",

  ],

  ["reports", "Reports", "<path d='M4 20V10M10 20V4M16 20v-7M22 20H2'/>"],

  [

    "ann",

    "Announcements",

    "<path d='M3 11v3h4l8 5V6L7 11zM18 9c1.5 1 1.5 5 0 6'/>",

  ],

];


const TT = { profile: "Profile Settings" };

// Users are loaded from the VyaparX database (company memberships).
// No demo data: until the backend responds the list is simply empty.

let USERS = [];
let ADMIN_CATALOG = [];
// Shared CRM quotations, loaded from the tenant-scoped quotations API (same
// records CRM and Sales use). Empty until the backend responds - no mock data.
let ADMIN_QUOTES = [];

async function syncCatalogFromDb() {
  if (!window.VyaparXAuth?.fetchModuleRecords) return;
  try {
    const records = await window.VyaparXAuth.fetchModuleRecords("catalog");
    ADMIN_CATALOG = records.filter((item) => item.recordType === "product" && !item.isDeleted);
    // Keep the custom-field definitions in sync with the same catalog records.
    if (window.VyaparXCatalog) {
      const saved = records.find((r) => r.recordType === "customFields" && !r.isDeleted);
      if (saved && Array.isArray(saved.fields)) {
        window.VyaparXCatalog.loadFields(true);
      }
    }
    if (cur === "catalog") render();
  } catch (error) {
    toast("Could not load the product catalog: " + error.message);
  }
}

function catalogEditor(product = {}) {
  const fields = [
    ["name", "Product name *", product.name || "", "text"],
    ["code", "Product code", product.code || "", "text"],
    ["description", "Description / product details", product.description || "", "text"],
    ["unit", "Unit of measure", product.unit || "Nos", "text"],
    ["hsn", "HSN / SAC", product.hsn || "", "text"],
    ["rate", "Selling price (₹) *", product.rate ?? 0, "number"],
    ["gst", "GST (%) *", product.gst ?? 0, "number"],
    ["discount", "Default discount (%)", product.discount ?? 0, "number"],
  ];
  const customHtml = window.VyaparXCatalog ? window.VyaparXCatalog.customInputsHtml(product) : "";
  const html = `<div class="fm">${fields.map(([id, label, value, type]) => `<label>${label}<input class="in" id="cat-${id}" type="${type}" ${type === "number" ? 'min="0" step="0.01"' : ""} value="${esc(value)}"></label>`).join("")}${customHtml}<label><input id="cat-active" type="checkbox" ${product.isActive === false ? "" : "checked"}> Active in CRM quotations</label></div>`;
  dlg(`<h3>${product.id ? "Edit catalog product" : "Add catalog product"}</h3>${html}`, "Save product", (mask) => {
    const record = {
      ...(product.id ? { id: product.id } : {}), recordType: "product",
      name: mask.querySelector("#cat-name").value.trim(), code: mask.querySelector("#cat-code").value.trim(),
      description: mask.querySelector("#cat-description").value.trim(), unit: mask.querySelector("#cat-unit").value.trim() || "Nos",
      hsn: mask.querySelector("#cat-hsn").value.trim(), rate: Number(mask.querySelector("#cat-rate").value),
      gst: Number(mask.querySelector("#cat-gst").value), discount: Number(mask.querySelector("#cat-discount").value),
      isActive: mask.querySelector("#cat-active").checked,
    };
    if (!record.name || [record.rate, record.gst, record.discount].some((value) => !Number.isFinite(value)) || record.rate < 0 || record.gst < 0 || record.gst > 100 || record.discount < 0 || record.discount > 100) {
      toast("Enter a product name, non-negative price, and GST/discount between 0 and 100."); return false;
    }
    if (window.VyaparXCatalog) {
      const missing = window.VyaparXCatalog.validateRequired(mask);
      if (missing.length) { toast("Required custom fields: " + missing.join(", ")); return false; }
      window.VyaparXCatalog.applyCustomValues(record, mask);
    }
    const submit = mask.querySelector("[data-ok]");
    if (submit.disabled) return false;
    submit.disabled = true;
    window.VyaparXAuth.saveModuleRecord("catalog", record).then(syncCatalogFromDb).then(render)
      .then(() => { syncDashboardFromDb(); toast("Product catalog saved."); })
      .catch((error) => toast("Product was not saved: " + error.message))
      .finally(() => { if (submit.isConnected) submit.disabled = false; });
  });
}

async function syncUsersFromDb() {
  if (typeof window !== "undefined" && window.VyaparXAuth) {
    try {
      const session = window.VyaparXAuth.getCurrentSession();
      if (session && session.companyId) {
        const dbUsers = window.VyaparXAuth.refreshCompanyUsers
          ? await window.VyaparXAuth.refreshCompanyUsers()
          : window.VyaparXAuth.getCompanyUsers(session.companyId);

        if (dbUsers) {
          USERS = dbUsers.map((u) => ({
            id: u.id,
            n: u.fullName,
            e: u.email,
            r: u.role,
            d: u.department || u.role,
            hd: u.headDepartment || "",
            m: u.role === "Admin" ? [...MODS] : [u.department || u.role],
            s: u.status || "ACTIVE",
          }));
        }
      }
    } catch (e) {
      console.warn("Could not sync users from VyaparXAuth:", e);
    }
  }
}

syncUsersFromDb().then(() => {
  if (typeof render === "function") render();
});

// The department head is stored on the membership record (head_department),
// persisted by POST /api/admin/department-heads.
const head = (d) => USERS.find((u) => u.hd == d && u.s == "ACTIVE");

async function assign(d, u) {
  if (!window.VyaparXAuth || !u.id) {
    toast("User record is not saved in the database yet");
    return false;
  }
  try {
    await window.VyaparXAuth.assignDepartmentHead(u.id, d);
    await syncUsersFromDb();
    return true;
  } catch (err) {
    toast(err.message || "Could not save the department head");
    return false; // previous valid state is retained on failure
  }
}

let ID = 1;

// Tasks are persisted in the backend (Task model) and loaded per company.
let ITEMS = [];

async function syncTasksFromDb() {
  if (window.VyaparXShared && window.VyaparXShared.tasks) {
    try {
      const dbTasks = await window.VyaparXShared.tasks.fetchTasks({ force: true });
      ITEMS = dbTasks.map((t) => ({
        id: t.id,
        d: t.department || t.td || "Administration",
        t: t.title || t.s || "",
        ds: t.description || t.desc || "",
        p: t.priority || t.p || "Medium",
        due: t.dueDate || t.due || "—",
        s: t.status || t.st || "Pending",
        type: t.type || "Task",
        read: !!(t.isRead || t.read),
      }));
      return;
    } catch (e) {
      console.warn("Could not load tasks from VyaparXShared:", e);
    }
  }
  if (!window.VyaparXAuth || !window.VyaparXAuth.fetchTasks) return;
  try {
    const dbTasks = await window.VyaparXAuth.fetchTasks();
    ITEMS = dbTasks.map((t) => ({
      id: t.id,
      d: t.department,
      t: t.title,
      ds: t.description || "",
      p: t.priority || "Medium",
      due: t.dueDate || "—",
      s: t.status || "Pending",
      type: t.type || "Task",
      read: !!t.isRead,
    }));
  } catch (e) {
    console.warn("Could not load tasks from the database:", e);
  }
}

const P = {};

MODS.forEach((m) => (P[m] = PERMS.map((p) => p != "Delete")));

const st = (s) =>

  `<span class="tag ${/^(ACTIVE|Active|Completed|Sent|Low|OK)$/.test(s) ? "ok" : /^(Pending|In Progress|Draft|INACTIVE|Medium|High|Pending head)$/.test(s) ? "wa" : /^(Overdue|Urgent|Cancelled)$/.test(s) ? "er" : ""}">${s}</span>`;

const empty = (t) =>

  `<div class="empty">${t}<br><small>Matching records will appear here.</small></div>`;

const ph = (t, d) =>

  `<div class="ph"><div><h2>${t}</h2><p>${d}</p></div></div>`;

let cur = "dashboard",

  q = "",

  fv = "All",

  sort = null,

  load = false,

  tab = "All",

  tf = { m: "All", p: "All", s: "All" };

function table(cols, rows, o = {}) {
  const dateCols = cols.map((label, index) => /date|follow.?up|due|valid until|^created$|created at|created on|^joined$|joined date|^dispatch$|^expected$/i.test(String(label).replace(/<[^>]*>/g, " ").trim()) ? index : -1).filter((index) => index >= 0);
  const dateCol = dateCols[0] ?? -1;

  let f = rows.filter(

    (r) =>

      r.join(" ").toLowerCase().includes(q.toLowerCase()) &&

      (fv == "All" || r.includes(fv)),

  );

  if (sort) {
    if (dateCols.includes(sort.i) && window.VyaparXShared?.sortRowsByDate) f = window.VyaparXShared.sortRowsByDate(f, sort.i, sort.d);
    else f = [...f].sort((a, b) => String(a[sort.i]).localeCompare(String(b[sort.i]), 0, { numeric: true }) * sort.d);
  } else if (dateCol >= 0 && window.VyaparXShared?.sortRowsByDate) f = window.VyaparXShared.sortRowsByDate(f, dateCol);
  if (dateCol >= 0 && window.VyaparXShared?.formatDate) f = f.map((row) => row.map((value, index) => dateCols.includes(index) ? window.VyaparXShared.formatDate(value) : value));

  return `<div class="card"><div class="bar"><input class="in" data-q placeholder="Search..." value="${esc(q)}" aria-label="Search table">${o.filter ? `<select class="in" data-f aria-label="Filter">${["All", ...o.filter].map((x) => `<option ${x == fv ? "selected" : ""}>${x}</option>`).join("")}</select>` : ""}</div>

 <div class="tw"><table><thead><tr>${cols.map((c, i) => `<th data-s="${i}">${c}</th>`).join("")}${o.act ? "<th>Actions</th>" : ""}</tr></thead><tbody>${f.length ? f.map((r) => `<tr>${r.map((c, i) => `<td>${/Status|Priority/.test(cols[i]) ? st(c) : c}</td>`).join("")}${o.act ? `<td><span style="display:flex;gap:4px">${o.act(r)}</span></td>` : ""}</tr>`).join("") : `<tr><td colspan="9">${empty("No matching records.")}</td></tr>`}</tbody></table></div></div>`;

}

// Report types available per department. Populated from the modules that are
// actually implemented; the department selector drives both the report type
// and status options. There is no separate Module dropdown.
const REP = {

  CRM: {
    types: ["Lead Report", "Follow-up Report", "Customer Report", "Quotation Report"],
    statuses: ["New", "Contacted", "Follow Up", "Quotation", "Converted", "Lost", "Closed", "Accepted", "Rejected"],
  },

  "Sales Order": {
    types: ["Sales Order Report", "Order Status Report", "Sales Invoice Report"],
    statuses: ["Draft", "Confirmed", "Awaiting Materials", "In Production", "Ready for Dispatch", "Partially Delivered", "Delivered", "Cancelled"],
  },

  "Purchase & Trading": {
    types: ["Purchase Order Report", "Goods Receipt Report", "Supplier Report"],
    statuses: ["Pending", "Received", "Completed", "Cancelled"],
  },

  Production: {
    types: ["Work Order Report", "Production Output Report", "Material Receipt Report", "Material Consumption Report", "QC Report"],
    statuses: ["Pending", "In Progress", "Completed", "Blocked", "QC Failed"],
  },

  Inventory: {
    types: ["Stock Summary", "Low Stock Report", "Out-of-Stock Report", "Stock Movement Report"],
    statuses: ["In Stock", "Low Stock", "Out of Stock"],
  },

  Transport: {
    types: ["Dispatch Report", "Delivery Report", "Vehicle/Driver Assignment Report"],
    statuses: ["Scheduled", "In Transit", "Delivered", "Overdue", "Cancelled"],
  },

  Accounting: {
    types: ["Invoice Report", "Payment Report", "Outstanding Receivables", "Outstanding Payables"],
    statuses: ["Paid", "Unpaid", "Partially Paid", "Overdue"],
  },

  "Employee Management": {
    types: ["Employee Report", "Attendance Report", "Payroll Report"],
    statuses: ["Active", "Inactive", "Present", "Absent", "On Leave"],
  },
};

const RD = { m: "CRM", t: "", d: "All", f: "", to: "", s: "All", u: "All" };

let rd = { ...RD },

  ra = { ...RD };

// Real report rows come from the modules' in-page data collections (which are
// themselves loaded from the backend). A report is generated from these
// records — never from static/demo counts.
const adminDateKey = (value) => window.VyaparXShared?.dateKey ? window.VyaparXShared.dateKey(value) : String(value || "").slice(0, 10);
const adminDateFmt = (value) => window.VyaparXShared?.formatDate ? window.VyaparXShared.formatDate(value) : String(value || "—");
const compareAdminDateValues = (left, right) => {
  const a = window.VyaparXShared?.dateSortKey?.(left);
  const b = window.VyaparXShared?.dateSortKey?.(right);
  if (a == null && b == null) return 0;
  if (a == null) return 1;
  if (b == null) return -1;
  return a - b;
};
const adminQuoteStatusLabel = (value) => {
  const status = String(value || "Pending").trim();
  const normalized = status.toLowerCase();
  if (["accepted", "approved"].includes(normalized)) return "Approved";
  if (["draft", "pending approval", "sent", "pending"].includes(normalized)) return "Pending";
  return status;
};
function collectReportRows() {
  const rows = [];
  const push = (type, ref, user, dept, date, status, amount) =>
    rows.push([type, ref, user, dept, adminDateKey(date), status, amount]);

  const dashRecords = (key) => (ADMIN_DASH_DATA && ADMIN_DASH_DATA[key]) || [];

  if (ADMIN_DASH_DATA) {
    const today = adminDateKey(new Date());
    const title = (value) => String(value || "").toLowerCase().replace(/_/g, " ")
      .replace(/\b\w/g, (letter) => letter.toUpperCase());
    const money = (value) => {
      if (value == null || value === "") return "";
      const numeric = Number(value);
      return Number.isFinite(numeric)
        ? numeric > 0 ? "₹" + numeric.toLocaleString("en-IN", { maximumFractionDigits: 2 }) : ""
        : String(value);
    };
    const amount = (record) => record.total ?? record.amount ?? record.value ??
      (Number(record.qty || record.quantity || 0) * Number(record.rate || record.unitPrice || 0));
    const dateOf = (record) => record.date || record.createdAt || record.ca || record.od || record.dp || "";
    const row = (type, record, dept, status, value) => push(
      type, record.number || record.ref || record.code || record.id || "—",
      record.user || record.cb || record.customerName || record.supplierName || "—",
      dept, dateOf(record), status, money(value ?? amount(record)),
    );

    dashRecords("crm").forEach((record) => {
      const customer = String(record.type || "").toLowerCase() === "customer";
      const status = title(record.status || record.st || "New");
      const type = customer ? "Customer Report" : /follow/i.test(status) ? "Follow-up Report" : "Lead Report";
      row(type, record, "CRM", status, record.value || record.qa);
    });
    (ADMIN_QUOTES || []).forEach((record) => row(
      "Quotation Report", record, "CRM", title(adminQuoteStatusLabel(record.status)), record.total,
    ));

    dashRecords("sales").filter((record) => record.recordType === "salesOrder").forEach((record) => {
      const statuses = { DRAFT: "Draft", PENDING_APPROVAL: "Draft", CONFIRMED: "Confirmed", ADVANCE_PENDING: "Draft", IN_PRODUCTION: "In Production", READY: "Ready for Dispatch", DISPATCHED: "Ready for Dispatch", DELIVERED: "Delivered", COMPLETED: "Delivered", CANCELLED: "Cancelled" };
      row("Sales Order Report", record, "Sales Order", statuses[String(record.status || "DRAFT").toUpperCase()] || title(record.status), record.total);
    });

    dashRecords("purchase").forEach((record) => {
      if (record.recordType === "purchaseOrder") {
        const status = record.status === "RECEIVED" ? "Received" : record.status === "CANCELLED" ? "Cancelled" : "Pending";
        row("Purchase Order Report", record, "Purchase & Trading", status, record.total);
      } else if (record.recordType === "goodsReceipt") {
        row("Goods Receipt Report", record, "Purchase & Trading", "Received", record.qty || record.quantity);
      } else if (record.recordType === "supplier") {
        row("Supplier Report", record, "Purchase & Trading", title(record.status || record.s || "Active"), "");
      }
    });

    dashRecords("inventory").forEach((record) => {
      if (record.recordType === "stockItem") {
        const rawStatus = String(record.status || (Number(record.qty || 0) <= Number(record.reorderLevel || record.ro || 0) ? "LOW_STOCK" : "IN_STOCK")).toUpperCase();
        const status = ({ IN_STOCK: "In Stock", LOW_STOCK: "Low Stock", OUT_OF_STOCK: "Out of Stock" })[rawStatus] || title(rawStatus);
        const type = status === "Out of Stock" ? "Out-of-Stock Report" : status === "Low Stock" ? "Low Stock Report" : "Stock Summary";
        row(type, record, "Inventory", status, `${record.qty ?? 0} ${record.unit || ""}`);
      } else if (record.recordType === "stockMovement" || record.recordType === "stockAdjustment") {
        row("Stock Movement Report", record, "Inventory", title(record.t || record.status || "Updated"), record.qty || record.d || "");
      }
    });

    dashRecords("production").forEach((record) => {
      if (record.recordType === "workOrder") {
        let status = title(record.status || "Pending");
        if (status === "Pending Material") status = "Blocked";
        row("Work Order Report", record, "Production", status, record.prod || record.qty);
        if (record.qc) row("QC Report", record, "Production", title(record.qc), record.prod || record.qty);
      } else if (record.recordType === "materialConsumption") {
        row("Material Consumption Report", record, "Production", "Completed", record.qty);
      } else if (record.recordType === "materialReceipt") {
        row("Material Receipt Report", record, "Production", "Received", record.recq || record.qty);
      } else if (record.recordType === "damageRecord") {
        row("QC Report", record, "Production", title(record.action || "Pending"), record.qty);
      }
    });

    dashRecords("transport").filter((record) => record.recordType === "dispatch").forEach((record) => {
        const statuses = { PLANNED: "Scheduled", IN_TRANSIT: "In Transit", DELIVERED: "Delivered", CANCELLED: "Cancelled" };
        let status = statuses[String(record.status || "PLANNED").toUpperCase()] || title(record.status);
      const due = record.deliveryDate || record.exp;
      if (due && due < today && !/delivered|cancelled/i.test(status)) status = "Overdue";
      const type = status === "Delivered" ? "Delivery Report" : "Dispatch Report";
      row(type, record, "Transport", status, "");
    });

    dashRecords("accounting").filter((record) => record.recordType === "accountingEntry").forEach((record) => {
      const entryType = String(record.type || "").toUpperCase();
      const value = Number(record.amount || 0);
      const paid = Number(record.paid || 0);
      const payStatus = paid >= value && value > 0 ? "Paid" : paid > 0 ? "Partially Paid" : "Unpaid";
      if (entryType === "INVOICE") {
        const payable = String(record.ref || "").startsWith("PO-");
        row(payable ? "Outstanding Payables" : "Outstanding Receivables", record, "Accounting", payStatus, Math.max(0, value - paid));
        row("Invoice Report", record, "Accounting", payStatus, value);
      } else if (["RECEIPT", "PAYMENT"].includes(entryType)) {
        row("Payment Report", record, "Accounting", "Paid", value);
      }
    });

    if (ra.m === "Employee Management") {
      (USERS || []).forEach((user) => row("Employee Report", {
        ...user, id: user.id || user.email, date: user.createdAt, status: user.status || "ACTIVE",
      }, user.department || user.role || "Employee Management", title(user.status || "Active"), ""));
    }
    return rows;
  }

  // The authenticated admin report collector above already added records
  // from every module. Keep the legacy fallback only before that company
  // snapshot exists so fetched rows are not appended a second time.
  if (!ADMIN_DASH_DATA && ra.m === "CRM") {
    if (window.CRM_REPORT_SOURCE) {
      (window.CRM_REPORT_SOURCE() || []).forEach((x) =>
        push("CRM Record", x.ref || "—", x.user || "—", "CRM", x.date || "", x.status || "", x.amount || "₹0"),
      );
    } else {
      dashRecords("crm").forEach((x) =>
        push("CRM Lead", x.number || x.name || x.company || x.id || "—", x.assignedTo || x.createdBy || "—", "CRM", x.createdAt || "", x.status || "Open", x.value ? "₹" + Number(x.value).toLocaleString("en-IN") : "₹0"),
      );
      (ADMIN_QUOTES || []).forEach((q) =>
        push("Quotation", q.number || q.id || "—", q.clientName || q.createdByName || "—", "CRM", q.date || q.createdAt || "", adminQuoteStatusLabel(q.status), q.total ? "₹" + Number(q.total).toLocaleString("en-IN") : "₹0"),
      );
    }
  }
  if (!ADMIN_DASH_DATA && ra.m === "Inventory") {
    if (window.INVENTORY_REPORT_SOURCE) {
      (window.INVENTORY_REPORT_SOURCE() || []).forEach((x) =>
        push(x.type || "Stock", x.ref || x.code || "—", x.user || "—", "Inventory", x.date || "", x.status || "", x.amount || ""),
      );
    } else {
      dashRecords("inventory").forEach((x) =>
        push(x.recordType || "Stock Item", x.code || x.id || "—", x.by || "—", "Inventory", x.date || x.createdAt || "", x.status || (x.qty <= (x.ro || 0) ? "LOW_STOCK" : "IN_STOCK"), x.qty != null ? `${x.qty} ${x.unit || ""}` : ""),
      );
    }
  }
  if (!ADMIN_DASH_DATA && ra.m === "Accounting") {
    if (window.ACCOUNTING_REPORT_SOURCE) {
      (window.ACCOUNTING_REPORT_SOURCE() || []).forEach((x) =>
        push(x.type || "Invoice", x.ref || "—", x.user || "—", "Accounting", x.date || "", x.status || "", x.amount || "₹0"),
      );
    } else {
      dashRecords("accounting").forEach((x) =>
        push(x.type || "Invoice", x.ref || x.inv || x.id || "—", x.cb || x.user || "—", "Accounting", x.date || x.createdAt || "", x.status || x.st || "POSTED", x.amount ? "₹" + Number(x.amount).toLocaleString("en-IN") : "₹0"),
      );
    }
  }
  if (!ADMIN_DASH_DATA && ra.m === "Transport") {
    if (window.TRANSPORT_REPORT_SOURCE) {
      (window.TRANSPORT_REPORT_SOURCE() || []).forEach((x) =>
        push(x.type || "Dispatch", x.ref || "—", x.user || "—", "Transport", x.date || "", x.status || "", x.amount || ""),
      );
    } else {
      dashRecords("transport").forEach((x) =>
        push(x.type || "Dispatch", x.ref || x.orderId || x.id || "—", x.driver || x.user || "—", "Transport", x.date || x.dispatchDate || x.createdAt || "", x.status || x.st || "DELIVERED", x.vehicleNo || ""),
      );
    }
  }
  if (!ADMIN_DASH_DATA && ra.m === "Sales Order") {
    if (window.SALES_REPORT_SOURCE) {
      (window.SALES_REPORT_SOURCE() || []).forEach((x) =>
        push(x.type || "Order", x.ref || "—", x.user || "—", "Sales Order", x.date || "", x.status || "", x.amount || "₹0"),
      );
    } else {
      dashRecords("sales").forEach((x) =>
        push(x.recordType || "Sales Order", x.number || x.id || "—", x.customer || x.clientName || "—", "Sales Order", x.date || x.orderDate || x.createdAt || "", x.status || "Confirmed", x.total ? "₹" + Number(x.total).toLocaleString("en-IN") : "₹0"),
      );
    }
  }
  if (!ADMIN_DASH_DATA && ra.m === "Purchase & Trading") {
    if (window.PURCHASE_REPORT_SOURCE) {
      (window.PURCHASE_REPORT_SOURCE() || []).forEach((x) =>
        push(x.type || "PO", x.ref || "—", x.user || "—", "Purchase & Trading", x.date || "", x.status || "", x.amount || "₹0"),
      );
    } else {
      dashRecords("purchase").forEach((x) =>
        push(x.type || "Purchase Order", x.number || x.id || "—", x.supplier || "—", "Purchase & Trading", x.date || x.orderDate || x.createdAt || "", x.status || "Approved", x.total ? "₹" + Number(x.total).toLocaleString("en-IN") : "₹0"),
      );
    }
  }
  if (!ADMIN_DASH_DATA && ra.m === "Production") {
    if (window.PRODUCTION_REPORT_SOURCE) {
      (window.PRODUCTION_REPORT_SOURCE() || []).forEach((x) =>
        push(x.type || "Work Order", x.ref || "—", x.user || "—", "Production", x.date || "", x.status || "", x.amount || ""),
      );
    } else {
      dashRecords("production").forEach((x) =>
        push(x.type || "Work Order", x.number || x.id || "—", x.supervisor || x.user || "—", "Production", x.date || x.createdAt || "", x.status || "IN_PROGRESS", x.qty ? `${x.qty} units` : ""),
      );
    }
  }
  if (!ADMIN_DASH_DATA && ra.m === "Employee Management") {
    if (window.EMPLOYEE_REPORT_SOURCE) {
      (window.EMPLOYEE_REPORT_SOURCE() || []).forEach((x) =>
        push(x.type || "Employee", x.ref || "—", x.user || "—", "Employee Management", x.date || "", x.status || "", x.amount || ""),
      );
    } else {
      (USERS || []).forEach((u) =>
        push("Employee", u.fullName || u.email, u.email, u.department || u.role, u.createdAt || "", u.status || "ACTIVE", u.role),
      );
    }
  }
  return rows;
}

function repRows(all) {
  const out = collectReportRows();
  return out.filter(

    (r) =>

      (ra.m == "All" || r[3] == ra.m) &&

      (ra.d == "All" || r[3] == ra.d) &&

      (ra.s == "All" || r[5] == ra.s) &&

      (ra.u == "All" || r[2] == ra.u) &&

      (!ra.f || r[4] >= ra.f) &&

      (!ra.to || r[4] <= ra.to) &&

      (!ra.t || r[0] === ra.t) &&

      (all || tab == "All" || r[0] == tab),

  );
}

const sel = (k, o, v, att) =>

  `<select class="in" ${att}="${k}">${o.map((x) => `<option ${x == v ? "selected" : ""}>${x}</option>`).join("")}</select>`;

const V = {

  dashboard() {
    const active = USERS.filter((u) => u.s === "ACTIVE").length;
    const pendingTasks = ITEMS.filter((i) => i.type === "Task" && i.s !== "Completed").length;
    const overdue = ITEMS.filter((i) => i.s === "Overdue").length;
    const heads = MODS.filter((m) => head(m)).length;
    const recent = Object.entries(ADMIN_DASH_DATA || {}).flatMap(([moduleName, records]) =>
      (records || []).filter((record) => !record.isDeleted).slice(0, 1).map((record) => ["▧", record.name || record.number || record.id || moduleName, record.updatedAt || record.createdAt || "", record.status || "", "info"])
    ).slice(0, 6);
    const money = (n) => "₹" + Number(n).toLocaleString("en-IN");
    const activeRecords = (key) => (ADMIN_DASH_DATA?.[key] || []).filter((record) => !record.isDeleted);
    const salesOrders = activeRecords("sales").filter((record) => record.recordType === "salesOrder");
    const purchaseOrders = activeRecords("purchase").filter((record) => record.recordType === "purchaseOrder");
    const inventoryRecords = activeRecords("inventory");
    const alerts = inventoryRecords.filter((record) => Number(record.qty || 0) <= Number(record.reorderLevel || record.ro || 0)).length;
    return ph("Dashboard", "Your business at a glance — operations, inventory and cash health.") + `
      <section class="dash-banner"><div>Company overview · Values are loaded from your authorized records.</div></section>
      <div class="dash-alert"><span class="alert-icon">!</span><span><b>${loading ? "…" : 0} receivables</b> <small>· Review outstanding customer balances</small></span><button data-go="reports" class="dash-link">Review ↗</button></div>

      <section class="dash-kpis">
        <button class="dash-kpi" data-go="reports"><span class="dash-kpi-top">Sales orders <span>↗</span></span><strong>${loading ? "…" : salesOrders.length}</strong><small>Open · <em>${loading ? "…" : overdue} overdue</em></small></button>
        <button class="dash-kpi" data-go="reports"><span class="dash-kpi-top">Purchase orders <span>↗</span></span><strong>${loading ? "…" : purchaseOrders.length}</strong><small>Pending · <em>—</em></small></button>
        <button class="dash-kpi" data-go="reports"><span class="dash-kpi-top">Stock alerts <span>↗</span></span><strong>${loading ? "…" : alerts}</strong><small>Low or reorder</small></button>
        <button class="dash-kpi" data-go="reports"><span class="dash-kpi-top">Cash flow <span>↗</span></span><strong class="positive">—</strong><small>Available from accounting records</small></button>
      </section>

      <section class="dash-main-grid">
        <article class="dash-panel work-panel">
          <div class="dash-panel-head"><h3>Work orders</h3><button class="dash-link" data-go="reports">View all ↗</button></div>
          <div class="dash-mini-stats">
            <div><small>Open</small><b>5</b><span>₹7,64,757</span></div>
            <div><small>Blocked stock</small><b>12 items</b><span>across 5 WOs</span></div>
          </div>
          <div class="work-list">
            ${recent.slice(0,4).map((r,i)=>`<button class="work-row" data-go="reports"><span class="work-status">ACTIVE</span><span class="work-name">${r[1]}</span><span class="work-percent">${[20,25,33,0][i]}%</span><span class="work-value">${["₹1,75,840","₹2,42,500","₹1,61,618","₹1,84,000"][i]}</span></button>`).join("")}
          </div>
        </article>

        <article class="dash-panel dispatch-panel">
          <div class="dash-panel-head"><h3>Dispatch</h3><button class="dash-link" data-go="reports">View all ↗</button></div>
          <div class="dispatch-stats">
            <div><small>Today</small><b>0</b><span>nothing today</span></div>
            <div><small>Delayed</small><b>0</b><span>all on schedule</span></div>
            <div><small>Upcoming</small><b>0</b><span>scheduled ahead</span></div>
          </div>
          <p class="dash-muted">No scheduled dispatches.</p>
          <button class="dash-action-link" data-go="ann">＋ Create dispatch task</button>
        </article>

        <article class="dash-panel inventory-panel">
          <div class="dash-panel-head"><h3>Inventory health</h3><button class="dash-link" data-go="reports">View all ↗</button></div>
          <div class="inventory-summary"><div><small>Blocking WIP</small><b>12 items</b><span>₹7,64,757 of WIP</span></div><div><small>Low stock</small><b>0</b></div></div>
          <div class="dash-subtitle">VALUE BY CATEGORY</div>
          <div class="stock-bar-row"><span>Material</span><div class="stock-track"><i style="width:93%"></i></div><b>93%</b></div>
          <div class="stock-bar-row"><span>Product</span><div class="stock-track"><i style="width:7%"></i></div><b>7%</b></div>
        </article>

        <article class="dash-panel chart-panel">
          <div class="dash-panel-head"><h3>Dispatch vs Production vs Consumption <small>Last 30 days</small></h3><button class="dash-link" data-go="reports">View all ↗</button></div>
          <div class="chart-legend"><span><i class="legend-blue"></i>Production</span><span><i class="legend-orange"></i>Consumption</span><span><i class="legend-green"></i>Dispatch</span></div>
          <div class="dash-chart">
            <div class="chart-ylabels"><span>₹3,60,000</span><span>₹2,70,000</span><span>₹1,80,000</span><span>₹90,000</span><span>₹0</span></div>
            <svg viewBox="0 0 900 175" preserveAspectRatio="none" role="img" aria-label="Production and consumption trend chart">
              <g class="chart-grid"><path d="M0 12H900 M0 48H900 M0 84H900 M0 120H900 M0 156H900"/></g>
              <path class="chart-area-blue" d="M0 156 L485 156 C500 156 510 20 530 20 S555 156 575 156 L900 156 Z"/>
              <path class="chart-line-blue" d="M0 156 L485 156 C500 156 510 20 530 20 S555 156 575 156 L900 156"/>
              <path class="chart-line-orange" d="M0 156 L400 156 C412 156 420 90 435 90 S455 156 470 156 L620 156 C630 156 638 144 650 144 S665 156 680 156 L740 156 C750 156 758 151 768 151 S782 156 795 156 L900 156"/>
              <path class="chart-line-green" d="M0 156 L900 156"/>
            </svg>
          </div>
          <div class="chart-xlabels"><span>12 Sep</span><span>15 Sep</span><span>18 Sep</span><span>21 Sep</span><span>24 Sep</span><span>27 Sep</span><span>30 Sep</span><span>03 Oct</span><span>06 Oct</span><span>09 Oct</span><span>11 Oct</span></div>
        </article>

        <article class="dash-panel cash-panel">
          <div class="dash-panel-head"><h3>Cash health</h3><button class="dash-link" data-go="reports">View all ↗</button></div>
          ${[
            ["Receivables","₹7,34,689",""],
            ["Payables","₹3,16,312",""],
            ["Cash Flow · MTD","₹1,20,817","In ₹5.5L · Out ₹4.3L"],
            ["Sales · MTD","₹0","0 invoices"],
            ["Purchases · MTD","₹1,31,688","1 bills"]
          ].map(r=>`<div class="cash-row"><span>${r[0]}</span><div><b>${r[1]}</b>${r[2]?`<small>${r[2]}</small>`:""}</div></div>`).join("")}
        </article>

              <article class="dash-panel quick-panel"><div class="dash-panel-head"><h3>Quick Actions</h3></div><div class="quick-grid"><button class="quick-action" data-go="ann"><span class="quick-icon orange"><i class="fa-solid fa-list-check" aria-hidden="true"></i></span><span>Create task</span></button><button class="quick-action" data-open="producation.html?view=orders&action=create"><span class="quick-icon purple"><i class="fa-solid fa-industry" aria-hidden="true"></i></span><span>New work order</span></button><button class="quick-action" data-open="transport.html?view=disp"><span class="quick-icon purple"><i class="fa-solid fa-truck-fast" aria-hidden="true"></i></span><span>Dispatch queue</span></button><button class="quick-action" data-open="inventory.html?view=items"><span class="quick-icon green"><i class="fa-solid fa-boxes-stacked" aria-hidden="true"></i></span><span>Inventory items</span></button><button class="quick-action" data-open="CRM.html?view=customers"><span class="quick-icon slate"><i class="fa-solid fa-user-group" aria-hidden="true"></i></span><span>CRM customers</span></button><button class="quick-action" data-open="accounting.html?view=inv&action=create"><span class="quick-icon blue"><i class="fa-solid fa-file-invoice-dollar" aria-hidden="true"></i></span><span>New invoice</span></button><button class="quick-action" data-go="catalog"><span class="quick-icon slate"><i class="fa-solid fa-tags" aria-hidden="true"></i></span><span>Product catalog</span></button><button class="quick-action" data-go="roles"><span class="quick-icon slate"><i class="fa-solid fa-users-gear" aria-hidden="true"></i></span><span>Manage employees</span></button></div></article>
      <article class="dash-panel activity-panel">
          <div class="dash-panel-head"><h3>Recent activity</h3><button class="dash-link" data-go="reports">View all ↗</button></div>
          <div class="recent-list">${recent.map((r,i)=>`<button class="recent-row" data-go="${i===2?'roles':'reports'}"><span class="recent-icon ${i===2?'violet':''}">${r[0]}</span><span class="recent-title">${r[1]}<small>${r[2]}</small></span><span class="status-pill ${r[4]}">${r[3]}</span><span class="recent-arrow">›</span></button>`).join("")}</div>
        </article>
      </section>
    `;
  },
  roles() {

    syncUsersFromDb();

    return (

      ph(

        "Role & Permission",

        "Assign roles, departments and module access. Users with history are deactivated, never deleted.",

      ) +

      `<div style="display:flex;justify-content:space-between;align-items:center;margin:0 0 14px;flex-wrap:wrap;gap:10px"><h3 style="margin:0">Department Heads</h3><button class="btn p" data-act="create_dept_user">+ Create Department User</button></div>` +

      `<div class="grid k3" style="margin-bottom:14px">${MODS.map(

        (m) => {

          const h = head(m);

          return `<div class="card mod"><div style="display:flex;justify-content:space-between"><b style="font-weight:600">${m}</b>${st(h ? "Active" : "Pending head")}</div><div class="r">Head<b>${h ? esc(h.n) : "—"}</b></div><button class="btn s" data-act="head:${m}">${h ? "Change head" : "Assign head"}</button></div>`;

        },

      ).join("")}</div>` +

      table(

        window.VyaparXFields.tableColumns("admin", ["Name", "Email", "Role", "Department", "Module Access", "Status"]),

        USERS.map((u) => window.VyaparXFields.tableRow("admin", u, [

          esc(u.n),

          esc(u.e),

          u.r,

          u.d,

          u.m.length == MODS.length

            ? "All modules"

            : u.m.join(", ") || "No access",

          u.s,

        ])),

        {

          colModule: "admin",

          filter: ["ACTIVE", "INACTIVE"],

          act: (r) => {

            const a = r[1];

            return `<button class="btn s" data-act="view:${a}"><i class="fa-solid fa-eye" aria-hidden="true"></i></button><button class="btn s" data-act="edit:${a}" title="Edit" aria-label="Edit"><i class="fa-solid fa-pen-to-square" aria-hidden="true"></i></button><button class="btn s" data-act="role:${a}">Change Role</button><button class="btn s" data-act="pw:${a}">Change Password</button><button class="btn s" data-act="toggle:${a}">${r[5] == "ACTIVE" ? "Deactivate" : "Activate"}</button>`;

          },

        },

      ) +

      `<div class="card" style="margin-top:14px"><h3>Permission matrix</h3><div class="tw"><table class="mx"><tr><th>Module</th>${PERMS.map((p) => `<th>${p}</th>`).join("")}</tr>${MODS.map((m) => `<tr><td>${m}</td>${PERMS.map((p, i) => `<td><input type="checkbox" data-p="${m}:${i}" ${P[m][i] ? "checked" : ""} aria-label="${m} ${p}"></td>`).join("")}</tr>`).join("")}</table></div><button class="btn p" style="margin-top:10px" data-act="save">Save permissions</button></div>`

    );

  },

  reports() {

    const draftCfg = REP[rd.m] || { types: [], statuses: [] };
    const appliedCfg = REP[ra.m] || { types: [], statuses: [] };

    const all = repRows(true),

      tiles = (ra.t ? [ra.t] : appliedCfg.types)

        .map(

          (s) =>

            `<button class="card kpi btn" style="text-align:left;${tab == s ? "border-color:var(--pri)" : ""}" data-act="tab:${s}"><small>${s}</small><b>${all.filter((r) => r[0] == s).length}</b></button>`,

        )

        .join("");

    const f = (l, c) =>

      `<label style="font-size:12px;color:var(--mut);display:grid;gap:4px">${l}${c}</label>`;

    const reportTypeOptions = ["All", ...draftCfg.types].map(

      (x) => `<option value="${x}" ${rd.t == x || (x == "All" && !rd.t) ? "selected" : ""}>${x}</option>`,

    ).join("");

    const statusOptions = ["All", ...draftCfg.statuses].map(

      (x) => `<option ${x == rd.s ? "selected" : ""}>${x}</option>`,

    ).join("");

    const userOptions = ["All", ...USERS.map((u) => u.n)].map(

      (x) => `<option value="${x}" ${rd.u == x ? "selected" : ""}>${x}</option>`,

    ).join("");

    return (

      ph("Reports", "Generate department-wise reports from live records.") +

      `<div class="card" style="margin-bottom:14px"><div class="grid k6">${f("Department", sel("m", Object.keys(REP), rd.m, "data-r"))}${f("Report Type", `<select class="in" data-r="t" id="rt">${reportTypeOptions}</select>`)}${f("Date From", `<input class="in" type="date" data-r="f" value="${rd.f}">`)}${f("Date To", `<input class="in" type="date" data-r="to" value="${rd.to}">`)}${f("Status", `<select class="in" data-r="s">${statusOptions}</select>`)}${f("User", `<select class="in" data-r="u">${userOptions}</select>`)}</div>

 <div class="bar" style="margin:12px 0 0"><button class="btn p" data-act="rapply">Apply filters</button><button class="btn" data-act="rreset">Reset</button><button class="btn" data-act="csv" title="Export CSV" aria-label="Export CSV"><i class="fa-solid fa-file-csv"></i></button><button class="btn" data-act="pdf" title="Export PDF" aria-label="Export PDF"><i class="fa-solid fa-print"></i></button></div></div>` +

      (load || ADMIN_DASH_LOADING

        ? `<div class="card empty">Loading live company records…</div>`

        : (ADMIN_DASH_ERROR ? `<div class="card empty">Some company records could not be loaded. Report rows may be incomplete; refresh after the connection is restored.</div>` : "") +
          `<div class="grid k6" style="margin-bottom:14px">${tiles}</div>` +

          table(

            [

              "Type",

              "Reference",

              "User",

              "Department",

              "Date",

              "Status",

              "Amount",

            ],

            repRows(false),

            {},

          ))

    );

  },

  ann() {

    const f = (l, c) => `<label>${l}${c}</label>`;

    return (

      ph(

        "Announcements",

        "Send a notice, task or announcement to a department.",

      ) +

      `<div class="card fm" style="max-width:none;margin-bottom:14px;grid-template-columns:repeat(auto-fit,minmax(240px,1fr))">${f("Title", `<input class="in" id="at" placeholder="Verify Customer Payment">`)}${f("Department", sel("d", ["All Departments", ...MODS], "All Departments", "id"))}${f("Type", sel("y", ["Notice", "Task", "Announcement", "Important Message"], "Task", "id"))}${f("Priority", sel("p", ["Low", "Medium", "High", "Urgent"], "Medium", "id"))}${f("Due Date", `<input class="in" type="date" id="au">`)}${f("Status", `<input class="in" value="Draft until sent" disabled>`)}<label style="grid-column:1/-1">Description<textarea class="in" id="ad" rows="3" placeholder="What should the department do?"></textarea></label><div style="display:flex;gap:8px;grid-column:1/-1"><button class="btn p" data-act="send">Send</button><button class="btn" data-act="draft">Save Draft</button><button class="btn" data-act="cancel">Cancel</button></div></div>` +

      `<h3 style="margin:0 0 10px">Sent items</h3>` +

      table(

        ["Type", "Title", "Department", "Priority", "Due", "Status"],

        ITEMS.map((i) => [i.type, esc(i.t), i.d, i.p, i.due, i.s]),

        {

          filter: ["Task", "Notice", "Announcement", "Important Message"],

          act: (r) => {

            const task = ITEMS.find((i) => esc(i.t) == r[1]);

            return `<button class="btn s" data-act="tkview:${task ? task.id : ""}"><i class="fa-solid fa-eye" aria-hidden="true"></i></button>${task && task.s == "Completed" ? `<button class="btn s" data-act="tkdel:${task.id}"><i class="fa-solid fa-trash-can" aria-hidden="true"></i></button>` : ""}`;

          },

        },

      )

    );

  },

  quotations() {
    const rows = [...ADMIN_QUOTES].sort((left, right) => {
      const a = window.VyaparXShared?.dateSortKey?.(left.date);
      const b = window.VyaparXShared?.dateSortKey?.(right.date);
      if (a == null && b == null) return 0;
      if (a == null) return 1;
      if (b == null) return -1;
      return a - b;
    });
    return ph("Quotations", "Company quotations created in CRM and shared with Sales.") +
      `<div class="card"><div class="tw"><table><thead><tr>
      <th>Quotation</th><th>Customer</th><th>Date</th><th>Valid Until</th><th>Total</th><th>Status</th>
      </tr></thead><tbody>${rows.length ? rows.map((quote) => `<tr>
      <td>${esc(quote.number || "")}</td><td>${esc(quote.clientName || "")}</td>
      <td>${adminDateFmt(quote.date)}</td><td>${adminDateFmt(quote.validUntil)}</td>
      <td>₹${Number(quote.total || 0).toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</td>
      <td>${esc(adminQuoteStatusLabel(quote.status))}</td></tr>`).join("") :
      '<tr><td colspan="6"><div class="empty">No quotations available for this company.</div></td></tr>'}
      </tbody></table></div></div>`;
  },

  catalog() {
    const canConfigure = (window.VyaparXAuth?.getCurrentSession?.() || {}).role === "Admin";
    return ph("Product Catalog", "Company products and quotation defaults: price, GST, discount, unit, and HSN/SAC.") +
      `<div class="bar"><button class="btn p" data-act="catadd">＋ Add product</button><button class="btn" data-act="catprint" title="Print" aria-label="Print"><i class="fa-solid fa-print"></i> Print Catalog</button>${canConfigure ? '<button class="btn" data-act="catfields">⚙ Manage Fields</button>' : ""}</div><div class="card"><div class="tw"><table><thead><tr><th>Product</th><th>Code</th><th>Details</th><th>Unit</th><th>HSN/SAC</th><th>Price</th><th>GST</th><th>Discount</th><th>Status</th><th>Actions</th></tr></thead><tbody>${ADMIN_CATALOG.length ? ADMIN_CATALOG.map((product) => `<tr><td>${esc(product.name || "")}</td><td>${esc(product.code || "—")}</td><td>${esc(product.description || "—")}</td><td>${esc(product.unit || "Nos")}</td><td>${esc(product.hsn || "—")}</td><td>₹${Number(product.rate || 0).toLocaleString("en-IN", {minimumFractionDigits: 2})}</td><td>${Number(product.gst || 0)}%</td><td>${Number(product.discount || 0)}%</td><td>${product.isActive === false ? "Inactive" : "Active"}</td><td><button class="btn s" data-act="catedit:${esc(product.id)}" title="Edit" aria-label="Edit"><i class="fa-solid fa-pen-to-square" aria-hidden="true"></i></button> <button class="btn s" data-act="catdelete:${esc(product.id)}"><i class="fa-solid fa-trash-can" aria-hidden="true"></i></button></td></tr>`).join("") : '<tr><td colspan="10"><div class="empty">No catalog products yet. Add the products your factory makes.</div></td></tr>'}</tbody></table></div></div>`;
  },

  profile() {

    const session = window.VyaparXAuth ? window.VyaparXAuth.getCurrentSession() : null;

    const co = window.VyaparXShared ? window.VyaparXShared.getCompanyProfile() : null;

    const v = (k, fallback = "") => (co && co[k]) || fallback;

    const gstin = co && co.gstin ? co.gstin : "";

    return (

      ph(

        "Profile Settings",

        "Company and account details entered during registration. Admins can update them here.",

      ) +

      `<div class="card fm"><h3 style="margin:0 0 4px">Company details</h3><small style="color:var(--mut);margin-bottom:8px;display:block">Populated from your company registration record.</small><label>Registered Company Name<input class="in" id="cf_name" value="${esc(co ? co.company_name || "" : session && session.companyName || "")}"></label><label>Registered Business Name<input class="in" id="cf_rname" value="${esc(co ? co.registered_business_name || "" : "")}"></label><label>GSTIN<input class="in" id="cf_gstin" maxlength="15" placeholder="15-character GSTIN (optional)" value="${esc(gstin)}"></label><label>Registered Email<input class="in" value="${esc(co ? co.email || "" : "")}" disabled></label><label>Phone<input class="in" id="cf_phone" value="${esc(co ? co.phone || "" : "")}"></label><label>Address<input class="in" id="cf_address" value="${esc(co ? co.address || "" : "")}"></label><div style="display:grid;grid-template-columns:1fr 1fr;gap:10px"><label>State<input class="in" id="cf_state" value="${esc(co ? co.state || "" : "")}"></label><label>Pin Code<input class="in" id="cf_pin" value="${esc(co ? co.pin_code || "" : "")}"></label></div><div style="display:grid;grid-template-columns:1fr 1fr;gap:10px"><label>Business Type<input class="in" id="cf_btype" value="${esc(co ? co.business_type || "" : "")}"></label><label>Industry<input class="in" id="cf_industry" value="${esc(co ? co.industry || "" : "")}"></label></div><h3 style="margin:14px 0 4px">Account</h3><label>Name<input class="in" value="${esc(session ? session.fullName : "")}" disabled></label><label>Email<input class="in" value="${esc(session ? session.email : "")}" disabled></label><label>Role<input class="in" value="${esc(session ? session.role : "Admin")}" disabled></label><button class="btn p" data-act="savecompany">Save changes</button></div>`

    );

  },

};

// Dashboard summaries use records returned for the authenticated company.
const ADMIN_MODULE_KEYS = [
  ["crm", "CRM records", "reports"],
  ["sales", "Sales records", "reports"],
  ["purchase", "Purchase records", "reports"],
  ["inventory", "Inventory records", "reports"],
  ["production", "Production records", "reports"],
  ["transport", "Transport records", "reports"],
  ["accounting", "Accounting records", "reports"],
];
let ADMIN_DASH_DATA = null;
let ADMIN_DASH_LOADING = true;
let ADMIN_DASH_ERROR = false;
let ADMIN_DASH_SYNCING = false;
let ADMIN_DASH_READY = new Set();

// Coalesce overlapping dashboard syncs. go('dashboard')/focus/interval and
// post-save refreshes all call syncDashboardFromDb(); the in-flight guard
// already exists, and this focuses the quota on ONE full-dashboard pass at a
// time (its 8 module GETs are already deduped per-module at the auth layer).
let _adminDashPromise = null;

async function syncDashboardFromDb() {
  if (ADMIN_DASH_SYNCING) return _adminDashPromise || Promise.resolve();
  if (!window.VyaparXAuth?.fetchModuleRecords) {
    ADMIN_DASH_LOADING = false;
    ADMIN_DASH_DATA = {};
    return Promise.resolve();
  }
  ADMIN_DASH_SYNCING = true;
  _adminDashPromise = (async () => {
  const moduleReads = ADMIN_MODULE_KEYS.map(async ([key]) => [
    key,
    await window.VyaparXAuth.fetchModuleRecords(key),
  ]);
  moduleReads.push(window.VyaparXAuth.fetchModuleRecords("quotations").then((records) => [
    "quotations", records.filter((record) => record.recordType === "quotation" && !record.isDeleted),
  ]));
  const results = await Promise.allSettled(moduleReads);
  const quotationResult = results[ADMIN_MODULE_KEYS.length];
  ADMIN_QUOTES = quotationResult?.status === "fulfilled" ? quotationResult.value[1] : [];
  ADMIN_DASH_DATA = {};
  ADMIN_DASH_READY.clear();
  let failed = quotationResult?.status !== "fulfilled";
  results.forEach((result, index) => {
    if (index >= ADMIN_MODULE_KEYS.length) return;
    if (result.status === "fulfilled") {
      const [key, records] = result.value;
      ADMIN_DASH_DATA[key] = records.filter((record) => !record.isDeleted);
      ADMIN_DASH_READY.add(key);
    } else {
      failed = true;
      ADMIN_DASH_READY.delete(ADMIN_MODULE_KEYS[index][0]);
    }
  });
  ADMIN_DASH_LOADING = false;
  ADMIN_DASH_ERROR = failed;
  ADMIN_DASH_SYNCING = false;
  if (cur === "dashboard" || cur === "reports") render();
  })();
  return _adminDashPromise;
}

// Keep the established dashboard shell while removing sample financial data.
V.dashboard = function () {
  const loading = ADMIN_DASH_LOADING;
  const available = (key) => !loading && ADMIN_DASH_DATA && Object.prototype.hasOwnProperty.call(ADMIN_DASH_DATA, key);
  const value = (key) => loading ? "…" : available(key) ? ADMIN_DASH_DATA[key].length.toLocaleString("en-IN") : "Unavailable";
  const recent = Object.entries(ADMIN_DASH_DATA || {})
    .flatMap(([module, records]) => records.map((record) => ({ ...record, module })))
    .sort((left, right) => compareAdminDateValues(left.updatedAt || left.createdAt, right.updatedAt || right.createdAt))
    .slice(-6);
  const tasks = ITEMS.filter((item) => item.type === "Task" && item.s !== "Completed").length;
  return ph("Dashboard", "Live record totals for your company.") + `
    <section class="dash-kpis">
      ${ADMIN_MODULE_KEYS.slice(0, 4).map(([key, label, route]) => `<button class="dash-kpi" data-go="${route}"><span class="dash-kpi-top">${label}<span>↗</span></span><strong>${value(key)}</strong><small>Records in this module</small></button>`).join("")}
    </section>
    <section class="dash-main-grid">
      <article class="dash-panel work-panel">
        <div class="dash-panel-head"><h3>Module activity</h3><button class="dash-link" data-go="reports">Reports ↗</button></div>
        <div class="work-list">${recent.length ? recent.map((record) => {
          const title = record.number || record.name || record.title || record.id || "Business record";
          const date = record.updatedAt || record.createdAt || "";
          return `<div class="work-row"><span class="work-status">${esc(record.module)}</span><span class="work-name">${esc(title)}</span><span class="work-percent">${esc(record.status || "Updated")}</span><span class="work-value">${esc(adminDateFmt(date))}</span></div>`;
        }).join("") : `<div class="empty">${loading ? "Loading company records…" : "No recent business records."}</div>`}</div>
      </article>
      <article class="dash-panel dispatch-panel">
        <div class="dash-panel-head"><h3>Work queue</h3><button class="dash-link" data-go="ann">Tasks ↗</button></div>
        <div class="dispatch-stats"><div><small>Open tasks</small><b>${loading ? "…" : tasks}</b></div><div><small>Quotations</small><b>${loading ? "…" : ADMIN_QUOTES.length}</b></div></div>
        <button class="dash-action-link" data-go="quotations">Review quotations</button>
      </article>
      <article class="dash-panel quick-panel">
        <div class="dash-panel-head"><h3>Quick actions</h3></div>
        <div class="quick-grid">
          <button class="quick-action" data-go="ann"><span class="quick-icon orange">＋</span><span>Create task</span></button>
          <button class="quick-action" data-go="quotations"><span class="quick-icon blue">▤</span><span>View quotations</span></button>
          <button class="quick-action" data-go="roles"><span class="quick-icon slate">♙</span><span>Manage employees</span></button>
          <button class="quick-action" data-go="reports"><span class="quick-icon green">▥</span><span>Open reports</span></button>
        </div>
      </article>
    </section>`;
};

// Live dashboard command centre. Each dashboard control opens the module that
// owns the record, while the figures themselves are calculated from the
// tenant-scoped records loaded above.
const ADMIN_MODULE_ROUTES = {
  crm: "CRM.html?view=customers", sales: "sales.html?view=orders",
  purchase: "purchese.html?view=orders", inventory: "inventory.html?view=items",
  production: "producation.html?view=orders", transport: "transport.html?view=dels",
  accounting: "accounting.html?view=reports",
};
const adminMoney = (value) => `₹${Number(value || 0).toLocaleString("en-IN", { maximumFractionDigits: 2 })}`;
const adminRecordValue = (record) => {
  for (const key of ["total", "grandTotal", "amount", "netAmount", "value", "rate"]) {
    const value = Number(record && record[key]);
    if (Number.isFinite(value) && value > 0) return value;
  }
  const quantity = Number(record && (record.qty || record.quantity || 0));
  const rate = Number(record && (record.rate || record.unitPrice || 0));
  return Number.isFinite(quantity * rate) ? quantity * rate : 0;
};
const adminOpen = (label, url) => `<button class="dash-link" data-open="${url}">${label} <span>↗</span></button>`;
let ADMIN_CHART_RANGE = "30";
let ADMIN_CHART_START = "";
let ADMIN_CHART_END = "";
const ADMIN_CHART_VISIBLE = new Set(["production", "consumption", "dispatch"]);
const ADMIN_CHART_SERIES = {
  production: { label: "Production", color: "blue", module: "production", route: "producation.html?view=orders" },
  consumption: { label: "Consumption", color: "orange", module: "inventory", route: "inventory.html?view=hist" },
  dispatch: { label: "Dispatch", color: "green", module: "transport", route: "transport.html?view=disp" },
};
const adminChartDateKeys = () => {
  const today = adminDateKey(new Date());
  const [year, month, day] = today.split("-").map(Number);
  let start;
  let end = today;
  if (ADMIN_CHART_RANGE === "month") start = `${year}-${String(month).padStart(2, "0")}-01`;
  else if (ADMIN_CHART_RANGE === "custom") {
    start = ADMIN_CHART_START || adminChartOffset(today, -29);
    end = ADMIN_CHART_END || today;
    if (start > end) [start, end] = [end, start];
  } else start = adminChartOffset(today, -(Number(ADMIN_CHART_RANGE || 30) - 1));
  const keys = [];
  for (let cursor = start; cursor <= end; cursor = adminChartOffset(cursor, 1)) keys.push(cursor);
  return keys;
};
function adminChartOffset(key, days) {
  const [year, month, day] = String(key).split("-").map(Number);
  return new Date(Date.UTC(year, month - 1, day + days)).toISOString().slice(0, 10);
}
function adminChartDate(record, series) {
  const fields = series === "production"
    ? ["actualStartAt", "completedAt", "updatedAt", "productionOrderDate", "start", "date", "createdAt", "ca"]
    : series === "consumption" ? ["date", "movementDate", "createdAt", "updatedAt", "ca"]
      : ["dp", "dispatchDate", "date", "createdAt", "ca"];
  for (const field of fields) {
    const date = adminDateKey(record?.[field]);
    if (/^\d{4}-\d{2}-\d{2}$/.test(date)) return date;
  }
  return "";
}
function adminChartUnique(rows) {
  const seen = new Set();
  return rows.filter((row) => {
    const key = String(row?.id || "");
    if (!key) return true;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}
function adminChartModel() {
  const dates = adminChartDateKeys();
  const first = dates[0] || "";
  const last = dates[dates.length - 1] || "";
  const salesOrders = new Map(adminChartUnique((ADMIN_DASH_DATA?.sales || []).filter((row) => row.recordType === "salesOrder"))
    .map((row) => [String(row.id), row]));
  const allProduction = adminChartUnique((ADMIN_DASH_DATA?.production || []).filter((row) => row.recordType === "workOrder" && !row.isDeleted));
  const allConsumption = adminChartUnique((ADMIN_DASH_DATA?.inventory || []).filter((row) => {
    if (row.recordType !== "stockMovement" || row.isDeleted) return false;
    const direction = String(row.direction || row.type || row.t || row.movementType || "").toUpperCase();
    return ["OUT", "ISSUE", "CONSUMPTION"].includes(direction);
  }));
  const allDispatch = adminChartUnique((ADMIN_DASH_DATA?.transport || []).filter((row) => row.recordType === "dispatch" && !row.isDeleted))
    .sort((a, b) => adminChartDate(a, "dispatch").localeCompare(adminChartDate(b, "dispatch")) || String(a.id).localeCompare(String(b.id)));
  const source = { production: allProduction, consumption: allConsumption, dispatch: allDispatch };
  const values = {};
  const records = {};
  const seenFallbackSales = new Set();
  for (const key of Object.keys(ADMIN_CHART_SERIES)) {
    values[key] = Object.fromEntries(dates.map((date) => [date, 0]));
    records[key] = Object.fromEntries(dates.map((date) => [date, []]));
    for (const record of source[key]) {
      const date = adminChartDate(record, key);
      if (!date || date < first || date > last) continue;
      let quantity = 0;
      let derived = false;
      if (key === "production") quantity = Number(record.prod ?? record.producedQuantity ?? 0);
      else if (key === "consumption") quantity = Math.abs(Number(record.qty ?? record.quantity ?? 0));
      else {
        const ownQuantity = Number(record.qty ?? record.quantity);
        if (Number.isFinite(ownQuantity) && ownQuantity > 0) quantity = ownQuantity;
        else {
          const salesId = String(record.salesOrderId || record.so || "");
          const order = salesOrders.get(salesId);
          if (order && !seenFallbackSales.has(salesId)) {
            quantity = (Array.isArray(order.items) ? order.items : []).reduce((sum, item) => sum + Math.max(0, Number(item.quantity ?? item.qty ?? 0) || 0), 0);
            derived = true;
            seenFallbackSales.add(salesId);
          }
        }
      }
      if (!Number.isFinite(quantity) || quantity < 0) quantity = 0;
      const unit = String(record.unit || record.uom || record.unitOfMeasure || "units");
      const event = { record, date, quantity, unit, derived };
      values[key][date] += quantity;
      records[key][date].push(event);
    }
  }
  return { dates, values, records, first, last };
}
function adminChartPath(values, maximum) {
  const points = values.map((value, index) => ({
    x: values.length > 1 ? 18 + (index * 864) / (values.length - 1) : 450,
    y: maximum ? 164 - (Math.max(0, value) / maximum) * 142 : 164,
  }));
  if (points.length < 3) return points.map((point, index) => `${index ? "L" : "M"}${point.x.toFixed(1)} ${point.y.toFixed(1)}`).join(" ");
  return points.reduce((path, point, index) => {
    if (!index) return `M${point.x.toFixed(1)} ${point.y.toFixed(1)}`;
    const previous = points[index - 1];
    const middle = (previous.x + point.x) / 2;
    return `${path} Q${middle.toFixed(1)} ${previous.y.toFixed(1)} ${middle.toFixed(1)} ${((previous.y + point.y) / 2).toFixed(1)} T${point.x.toFixed(1)} ${point.y.toFixed(1)}`;
  }, "");
}
function adminChartShowDetails(seriesKey, date) {
  const chart = adminChartModel();
  const series = ADMIN_CHART_SERIES[seriesKey];
  const entries = chart.records[seriesKey]?.[date] || [];
  const total = entries.reduce((sum, entry) => sum + entry.quantity, 0);
  const unitTotals = entries.reduce((result, entry) => {
    result[entry.unit] = (result[entry.unit] || 0) + entry.quantity;
    return result;
  }, {});
  const totalText = Object.entries(unitTotals).length > 1
    ? Object.entries(unitTotals).map(([unit, quantity]) => `${quantity.toLocaleString("en-IN")} ${unit}`).join(" · ")
    : `${total.toLocaleString("en-IN")} ${entries[0]?.unit || "units"}`;
  const field = (record, keys) => {
    for (const key of keys) if (record?.[key] != null && String(record[key]).trim()) return String(record[key]);
    return "—";
  };
  const rows = entries.map(({ record, quantity, unit, derived }) => {
    const relatedOrder = seriesKey === "dispatch"
      ? (ADMIN_DASH_DATA?.sales || []).find((order) => String(order.id) === String(record.salesOrderId || record.so || ""))
      : null;
    const recordNumber = field(record, ["number", "productionOrderNo", "dispatchNumber", "id"]);
    const recordItem = field(record, ["productName", "itemName", "materialName", "item", "itemCode", "itemId"]);
    const item = recordItem !== "—" ? recordItem : (Array.isArray(relatedOrder?.items) ? relatedOrder.items
      .map((line) => line.productName || line.itemName || line.description || line.itemCode || line.productCode || "")
      .filter(Boolean).join(", ") : "") || "—";
    const customer = field(record, ["customerName", "supplierName", "vendorName"])
      .replace(/^—$/, field(relatedOrder, ["customerName", "customer", "cust"]));
    const type = field(record, ["direction", "type", "t", "movementType"]);
    const status = field(record, ["status", "st"]);
    const reference = field(record, ["ref", "salesOrderNumber", "salesOrderId", "productionOrderId", "transportRequestId"]);
    const dateField = adminChartDate(record, seriesKey);
    const viewUrl = series.route;
    const metricNote = derived ? " · from linked Sales Order" : "";
    return `<tr><td>${esc(recordNumber)}</td><td>${esc(item)}</td><td>${esc(customer)}</td><td>${esc(type)}</td><td>${quantity.toLocaleString("en-IN")} ${esc(unit)}${metricNote}</td><td>${esc(status)}</td><td>${esc(reference)}</td><td>${esc(adminDateFmt(dateField))}</td><td><button class="btn s" type="button" data-open="${esc(viewUrl)}">View</button></td></tr>`;
  }).join("");
  const mask = document.createElement("div");
  mask.className = "mask admin-chart-detail-mask";
  mask.innerHTML = `<section class="admin-chart-detail" role="dialog" aria-modal="true" aria-labelledby="adminChartDetailTitle"><header><div><h3 id="adminChartDetailTitle">${esc(series.label)} details</h3><p>${esc(adminDateFmt(date))} · Total: ${esc(totalText)} · ${entries.length} related record${entries.length === 1 ? "" : "s"}</p></div><button class="ic" type="button" data-chart-close aria-label="Close">×</button></header><div class="admin-chart-detail-table"><table><thead><tr><th>Record no.</th><th>Item / product</th><th>Customer / supplier</th><th>Type</th><th>Quantity</th><th>Status</th><th>Reference</th><th>Date</th><th>Action</th></tr></thead><tbody>${rows || `<tr><td colspan="9" class="empty">No related records for this date.</td></tr>`}</tbody></table></div><footer><button class="btn" type="button" data-chart-close>Close</button></footer></section>`;
  mask.addEventListener("click", (event) => {
    if (event.target === mask || event.target.closest("[data-chart-close]")) mask.remove();
  });
  document.body.append(mask);
}

V.dashboard = function () {
  const loading = ADMIN_DASH_LOADING;
  const records = (key) => (ADMIN_DASH_DATA && ADMIN_DASH_DATA[key]) || [];
  const count = (key) => {
    if (loading) return "...";
    const type = { sales: "salesOrder", purchase: "purchaseOrder", inventory: "stockItem" }[key];
    return records(key).filter((record) => !type || record.recordType === type)
      .length.toLocaleString("en-IN");
  };
  const unavailable = (key) => !loading && !ADMIN_DASH_READY.has(key);
  const inventory = records("inventory");
  const production = records("production").filter((record) => record.recordType === "workOrder");
  const transport = records("transport").filter((record) => record.recordType === "dispatch");
  const accounting = records("accounting").filter((record) => record.recordType === "accountingEntry");
  const lowStock = inventory.filter((record) => {
    if (record.recordType && record.recordType !== "stockItem") return false;
    const quantity = Number(record.qty ?? record.quantity);
    const reorder = Number(record.reorderLevel ?? record.reorder ?? record.ro);
    return Number.isFinite(quantity) && Number.isFinite(reorder) && quantity <= reorder;
  });
  const workOrders = production.filter((record) => !/completed|cancelled|closed/i.test(String(record.status || "")));
  const todayKey = adminDateKey(new Date());
  const delayed = transport.filter((record) => {
    const dueDate = adminDateKey(record.deliveryDate || record.exp || "");
    return /delay|late|overdue/i.test(String(record.status || "")) ||
      (dueDate && dueDate < todayKey && !/delivered|cancelled/i.test(String(record.status || "")));
  });
  const isPurchaseInvoice = (record) => String(record.ref || "").toUpperCase().startsWith("PO-");
  const receivables = accounting.filter((record) =>
    String(record.type || "").toUpperCase() === "INVOICE" && !isPurchaseInvoice(record),
  )
    .reduce((sum, record) => sum + Math.max(0, adminRecordValue(record) - Number(record.paid || record.received || 0)), 0);
  const payables = accounting.filter((record) =>
    (String(record.type || "").toUpperCase() === "INVOICE" && isPurchaseInvoice(record)) ||
    /payable|purchase|bill/i.test(String(record.type || "")),
  )
    .reduce((sum, record) => sum + Math.max(0, adminRecordValue(record) - Number(record.paid || 0)), 0);
  const cashIn = accounting.filter((record) => /receipt|income/i.test(String(record.type || "")))
    .reduce((sum, record) => sum + adminRecordValue(record), 0);
  const cashOut = accounting.filter((record) => /payment|expense/i.test(String(record.type || "")))
    .reduce((sum, record) => sum + adminRecordValue(record), 0);
  const recent = Object.entries(ADMIN_DASH_DATA || {}).flatMap(([module, list]) => list.map((record) => ({ ...record, module })))
    .sort((a, b) => compareAdminDateValues(a.updatedAt || a.createdAt, b.updatedAt || b.createdAt)).slice(-6);
  const chart = adminChartModel();
  const dates = chart.dates;
  const productionSeries = dates.map((date) => chart.values.production[date] || 0);
  const consumptionSeries = dates.map((date) => chart.values.consumption[date] || 0);
  const dispatchSeries = dates.map((date) => chart.values.dispatch[date] || 0);
  const maximum = Math.max(1, ...productionSeries, ...consumptionSeries, ...dispatchSeries);
  const chartSeries = [
    ["production", productionSeries], ["consumption", consumptionSeries], ["dispatch", dispatchSeries],
  ];
  const chartTotal = (key) => {
    const byUnit = {};
    for (const date of dates) for (const entry of chart.records[key][date] || []) {
      byUnit[entry.unit] = (byUnit[entry.unit] || 0) + entry.quantity;
    }
    const totals = Object.entries(byUnit);
    return totals.length ? totals.map(([unit, value]) => `${value.toLocaleString("en-IN")} ${unit}`).join(" · ") : "0 units";
  };
  const chartCircles = (key, values) => values.map((value, index) => {
    const x = values.length > 1 ? 18 + (index * 864) / (values.length - 1) : 450;
    const y = maximum ? 164 - (Math.max(0, value) / maximum) * 142 : 164;
    const date = dates[index];
    const units = [...new Set((chart.records[key][date] || []).map((entry) => entry.unit))];
    const unitLabel = units.length ? units.join(" / ") : "units";
    const label = `${ADMIN_CHART_SERIES[key].label}, ${adminDateFmt(date)}: ${value.toLocaleString("en-IN")} ${unitLabel}`;
    return `<circle class="chart-point chart-point-${ADMIN_CHART_SERIES[key].color}" cx="${x.toFixed(1)}" cy="${y.toFixed(1)}" r="4.5" tabindex="0" role="button" data-chart-point="${key}" data-chart-date="${date}" data-chart-value="${value}" data-chart-unit="${esc(unitLabel)}" aria-label="${esc(label)}"><title>${esc(label)}</title></circle>`;
  }).join("");
  const yLabels = [1, .75, .5, .25, 0].map((factor) => Math.round(maximum * factor).toLocaleString("en-IN"));
  const labelStride = Math.max(1, Math.ceil(dates.length / 7));
  const openTasks = ITEMS.filter((item) => item.type === "Task" && item.s !== "Completed").length;
  const stockItemCount = records("inventory").filter((record) => record.recordType === "stockItem").length;
  const healthyShare = stockItemCount ? Math.round(((stockItemCount - lowStock.length) / stockItemCount) * 100) : 0;

  return ph("Dashboard", loading ? "Loading live company records..." : "Live operations, inventory and cash health for your company.") + `
    <section class="dash-kpis">
      <button class="dash-kpi" data-open="sales.html?view=orders"><span class="dash-kpi-top">Sales orders <span>↗</span></span><strong>${unavailable("sales") ? "Unavailable" : count("sales")}</strong><small>Sales Order records</small></button>
      <button class="dash-kpi" data-open="purchese.html?view=orders"><span class="dash-kpi-top">Purchase orders <span>↗</span></span><strong>${unavailable("purchase") ? "Unavailable" : count("purchase")}</strong><small>Purchase & Trading records</small></button>
      <button class="dash-kpi" data-open="inventory.html?view=items&filter=low-stock"><span class="dash-kpi-top">Stock alerts <span>↗</span></span><strong>${loading ? "..." : unavailable("inventory") ? "Unavailable" : lowStock.length}</strong><small>Items at or below reorder level</small></button>
      <button class="dash-kpi" data-open="accounting.html?view=reports"><span class="dash-kpi-top">Cash flow <span>↗</span></span><strong class="${cashIn - cashOut >= 0 ? "positive" : ""}">${loading ? "..." : unavailable("accounting") ? "Unavailable" : adminMoney(cashIn - cashOut)}</strong><small>In ${unavailable("accounting") ? "—" : adminMoney(cashIn)} · Out ${unavailable("accounting") ? "—" : adminMoney(cashOut)}</small></button>
    </section>
    <section class="dash-main-grid">
      <article class="dash-panel work-panel"><div class="dash-panel-head"><h3>Work orders</h3>${adminOpen("View all", "producation.html?view=orders")}</div><div class="dash-mini-stats"><div><small>Open</small><b>${loading ? "..." : unavailable("production") ? "Unavailable" : workOrders.length}</b><span>${unavailable("production") ? "Unavailable" : adminMoney(workOrders.reduce((sum, record) => sum + adminRecordValue(record), 0))}</span></div><div><small>Blocked stock</small><b>${loading ? "..." : lowStock.length} items</b><span>at or below reorder level</span></div></div><div class="work-list">${workOrders.slice(0, 4).map((record) => `<button class="work-row" data-open="producation.html?view=orders&id=${encodeURIComponent(record.id || "")}"><span class="work-status">${esc(record.status || "Open")}</span><span class="work-name">${esc(record.name || record.number || record.id || "Work order")}</span><span class="work-percent">${esc(String(record.progress ?? "-"))}</span><span class="work-value">${adminMoney(adminRecordValue(record))}</span></button>`).join("") || `<div class="empty">${loading ? "Loading work orders..." : "No open work orders."}</div>`}</div></article>
      <article class="dash-panel dispatch-panel"><div class="dash-panel-head"><h3>Dispatch</h3>${adminOpen("View all", "transport.html?view=dels")}</div><div class="dispatch-stats"><div><small>Today</small><b>${loading ? "..." : unavailable("transport") ? "Unavailable" : transport.filter((record) => adminDateKey(record.deliveryDate || record.exp || record.date || "") === dates[6]).length}</b><span>scheduled today</span></div><div><small>Delayed</small><b>${loading ? "..." : unavailable("transport") ? "Unavailable" : delayed.length}</b><span>need attention</span></div><div><small>Upcoming</small><b>${loading ? "..." : unavailable("transport") ? "Unavailable" : transport.filter((record) => !/delivered|cancelled/i.test(String(record.status || ""))).length}</b><span>open dispatches</span></div></div><button class="dash-action-link" data-open="transport.html?view=disp">Open dispatches</button></article>
      <article class="dash-panel inventory-panel"><div class="dash-panel-head"><h3>Inventory health</h3>${adminOpen("View all", "inventory.html?view=items")}</div><div class="inventory-summary"><div><small>Tracked items</small><b>${unavailable("inventory") ? "Unavailable" : count("inventory")}</b><span>company inventory records</span></div><div><small>Low stock</small><b>${loading ? "..." : unavailable("inventory") ? "Unavailable" : lowStock.length}</b><span>needs replenishment</span></div></div><div class="dash-subtitle">CATALOG & STOCK POSITION</div><div class="stock-bar-row"><span>Catalog products</span><div class="stock-track"><i style="width:${ADMIN_CATALOG.length ? Math.min(100, ADMIN_CATALOG.length * 5) : 0}%"></i></div><b>${ADMIN_CATALOG.length}</b></div><div class="stock-bar-row"><span>Healthy</span><div class="stock-track"><i style="width:${healthyShare}%"></i></div><b>${healthyShare}%</b></div><div class="stock-bar-row"><span>Low stock</span><div class="stock-track"><i style="width:${100 - healthyShare}%"></i></div><b>${100 - healthyShare}%</b></div></article>
      <article class="dash-panel chart-panel">
        <div class="dash-panel-head"><div><h3>Operations trend <small>Quantity · native units</small></h3><small class="chart-period">${dates.length ? `${adminDateFmt(dates[0])} – ${adminDateFmt(dates[dates.length - 1])}` : "Choose a date range"}</small></div>${adminOpen("Open reports", `producation.html?view=reports&start=${chart.first}&end=${chart.last}`)}</div>
        <div class="chart-controls"><label>Date range<select class="in" data-chart-range aria-label="Chart date range"><option value="7" ${ADMIN_CHART_RANGE === "7" ? "selected" : ""}>Last 7 days</option><option value="30" ${ADMIN_CHART_RANGE === "30" ? "selected" : ""}>Last 30 days</option><option value="90" ${ADMIN_CHART_RANGE === "90" ? "selected" : ""}>Last 90 days</option><option value="month" ${ADMIN_CHART_RANGE === "month" ? "selected" : ""}>This month</option><option value="custom" ${ADMIN_CHART_RANGE === "custom" ? "selected" : ""}>Custom range</option></select></label>${ADMIN_CHART_RANGE === "custom" ? `<label>From<input class="in" type="date" data-chart-start value="${esc(ADMIN_CHART_START || chart.first)}"></label><label>To<input class="in" type="date" data-chart-end value="${esc(ADMIN_CHART_END || chart.last)}"></label>` : ""}</div>
        <div class="chart-legend" role="group" aria-label="Toggle chart series">${Object.entries(ADMIN_CHART_SERIES).map(([key, series]) => `<button type="button" class="chart-legend-button ${ADMIN_CHART_VISIBLE.has(key) ? "active" : ""}" data-chart-legend="${key}" aria-pressed="${ADMIN_CHART_VISIBLE.has(key)}"><i class="legend-${series.color}"></i>${series.label}</button>`).join("")}</div>
        ${loading ? `<div class="chart-state">Loading chart data…</div>` : ["production", "inventory", "transport"].some(unavailable) ? `<div class="chart-state">Chart data could not be loaded for every required module. <button class="btn s" type="button" data-chart-retry>Retry</button></div>` : dates.length ? `${chartSeries.every(([, values]) => values.every((value) => value === 0)) ? `<div class="chart-state chart-empty-note">No activity was recorded in this date range. The chart shows zero values.</div>` : ""}<div class="chart-summary">${Object.entries(ADMIN_CHART_SERIES).map(([key, series]) => `<div><span class="chart-summary-dot legend-${series.color}"></span><span>${series.label}</span><b>${chartTotal(key)}</b></div>`).join("")}</div><div class="dash-chart-wrap"><div class="dash-chart"><div class="chart-ylabels">${yLabels.map((label) => `<span>${label}</span>`).join("")}</div><div class="chart-svg-scroll" style="--chart-days:${dates.length};--chart-width:${Math.max(760, dates.length * 12)}px"><svg viewBox="0 0 900 180" preserveAspectRatio="none" role="img" aria-label="Daily dispatch, production and material consumption quantities"><g class="chart-grid"><path d="M0 22H900 M0 57H900 M0 92H900 M0 127H900 M0 162H900"/></g>${chartSeries.map(([key, values]) => `<g class="chart-series ${ADMIN_CHART_VISIBLE.has(key) ? "" : "is-hidden"}" data-chart-series="${key}"><path class="chart-line-${ADMIN_CHART_SERIES[key].color}" d="${adminChartPath(values, maximum)}"/>${chartCircles(key, values)}</g>`).join("")}</svg><div class="chart-tooltip" role="status" hidden></div><div class="chart-xlabels">${dates.map((date, index) => `<span>${index % labelStride ? "" : esc(adminDateFmt(date))}</span>`).join("")}</div></div></div></div>` : `<div class="chart-state">No dates in this range. Choose a date range that includes activity.</div>`}
        <p class="chart-footnote">Values are quantities in each record’s stored unit. Hover or tap a point for details; click a legend label to toggle its series.</p>
      </article>
      <article class="dash-panel cash-panel"><div class="dash-panel-head"><h3>Cash health</h3>${adminOpen("View all", "accounting.html?view=reports")}</div>${[["Receivables", receivables, ""], ["Payables", payables, ""], ["Cash flow", cashIn - cashOut, `In ${adminMoney(cashIn)} · Out ${adminMoney(cashOut)}`], ["Accounting records", accounting.length, "company-wide"]].map(([label, amount, note]) => `<div class="cash-row"><span>${label}</span><div><b>${loading ? "..." : unavailable("accounting") ? "Unavailable" : (label === "Accounting records" ? Number(amount).toLocaleString("en-IN") : adminMoney(amount))}</b>${note ? `<small>${note}</small>` : ""}</div></div>`).join("")}</article>
            <article class="dash-panel quick-panel"><div class="dash-panel-head"><h3>Quick Actions</h3></div><div class="quick-grid"><button class="quick-action" data-go="ann"><span class="quick-icon orange"><i class="fa-solid fa-list-check" aria-hidden="true"></i></span><span>Create task</span></button><button class="quick-action" data-open="producation.html?view=orders&action=create"><span class="quick-icon purple"><i class="fa-solid fa-industry" aria-hidden="true"></i></span><span>New work order</span></button><button class="quick-action" data-open="transport.html?view=disp"><span class="quick-icon purple"><i class="fa-solid fa-truck-fast" aria-hidden="true"></i></span><span>Dispatch queue</span></button><button class="quick-action" data-open="inventory.html?view=items"><span class="quick-icon green"><i class="fa-solid fa-boxes-stacked" aria-hidden="true"></i></span><span>Inventory items</span></button><button class="quick-action" data-open="CRM.html?view=customers"><span class="quick-icon slate"><i class="fa-solid fa-user-group" aria-hidden="true"></i></span><span>CRM customers</span></button><button class="quick-action" data-open="accounting.html?view=inv&action=create"><span class="quick-icon blue"><i class="fa-solid fa-file-invoice-dollar" aria-hidden="true"></i></span><span>New invoice</span></button><button class="quick-action" data-go="catalog"><span class="quick-icon slate"><i class="fa-solid fa-tags" aria-hidden="true"></i></span><span>Product catalog</span></button><button class="quick-action" data-go="roles"><span class="quick-icon slate"><i class="fa-solid fa-users-gear" aria-hidden="true"></i></span><span>Manage employees</span></button></div></article>
      <article class="dash-panel activity-panel"><div class="dash-panel-head"><h3>Recent activity</h3>${adminOpen("View all", "reports")}</div><div class="recent-list">${recent.map((record) => ADMIN_MODULE_ROUTES[record.module] ? `<button class="recent-row" data-open="${ADMIN_MODULE_ROUTES[record.module]}&id=${encodeURIComponent(record.id || "")}"><span class="recent-icon">▧</span><span class="recent-title">${esc(record.name || record.title || record.number || record.id || "Business record")}<small>${esc(record.module)}</small></span><span class="status-pill">${esc(record.status || "Updated")}</span><span class="recent-arrow">›</span></button>` : "").join("") || `<div class="empty">${loading ? "Loading activity..." : "No recent business activity."}</div>`}</div></article>
    </section>`;
};

function nav() {

  const co = window.VyaparXShared ? window.VyaparXShared.getCompanyProfile() : null;

  const companyName = (co && (co.company_name || co.companyName)) || (window.VyaparXAuth && window.VyaparXAuth.getCurrentSession() || {}).companyName || "";

  

$("#sb").innerHTML =
  `<div class="logo"><img src="../assets/logo.png" alt="VX Logo" style="width:50px;height:50px;object-fit:contain;"><div><b>VYAPARX ERP</b><small id="co-name">${esc(companyName)}</small></div></div>` +
  NAV.map(
    ([id, l, p]) =>
      `<button class="nav ${id == cur ? "on" : ""}" data-go="${id}" title="${l}">${ic(p)}<span>${l}</span></button>`,
  ).join("");


}

function render() {

  const l = (NAV.find((x) => x[0] == cur) || [0, TT[cur]])[1];

  if (cur === "catalog" && !ADMIN_CATALOG.length) syncCatalogFromDb();

  $("#pt").textContent = l;

  $("#bc").textContent = "Admin / " + l;

  $("#mn").innerHTML = V[cur]();

  nav();

  badge();

}

function go(v) {

  cur = v;

  if (v === "catalog") syncCatalogFromDb();
  if (v === "dashboard" || v === "reports") syncDashboardFromDb();

  q = "";

  fv = "All";

  sort = null;

  tab = "All";

  render();

  document.body.classList.remove("open");

}

function badge() {

  const n = ITEMS.filter((i) => i.type == "Task" && !i.read).length;

  $("#tc").textContent = n;

  $("#tc").hidden = !n;

}

function tp() {

  const L = ITEMS.filter(

    (i) =>

      i.type == "Task" &&

      (tf.m == "All" || i.d == tf.m) &&

      (tf.p == "All" || i.p == tf.p) &&

      (tf.s == "All" || i.s == tf.s),

  );

  const lb = { m: "All modules", p: "All priorities", s: "All statuses" };

  const s = (k, o) =>

    `<select class="in" data-tf="${k}" aria-label="${lb[k]}">${["All", ...o].map((x) => `<option value="${x}" ${tf[k] == x ? "selected" : ""}>${x == "All" ? lb[k] : x}</option>`).join("")}</select>`;

  $("#tp").innerHTML =

    `<section style="display:flex;justify-content:space-between;align-items:center"><b>Tasks</b><button class="btn s" data-act="readall">Mark all as read</button></section><section style="display:grid;grid-template-columns:repeat(3,1fr);gap:6px;margin-top:8px">${s("m", MODS)}${s("p", ["Low", "Medium", "High", "Urgent"])}${s("s", ["Pending", "In Progress", "Completed", "Overdue"])}</section>` +

    (L.length

      ? L.map(

          (i) =>

            `<section class="tk ${i.read ? "" : "u"}"><span style="display:flex;justify-content:space-between"><b>${i.d}</b>${st(i.s)}</span><b style="font-weight:500">${esc(i.t)}</b><p>${esc(i.ds)}</p><span style="display:flex;gap:6px;align-items:center">${st(i.p)}<small style="color:var(--mut)">Due: ${adminDateFmt(i.due)}</small></span><span style="display:flex;gap:6px;flex-wrap:wrap"><button class="btn s" data-act="tkview:${i.id}"><i class="fa-solid fa-eye" aria-hidden="true"></i></button>${i.read ? "" : `<button class="btn s" data-act="tkread:${i.id}">Mark as read</button>`}<button class="btn s" data-act="tkopen:${i.id}">Open full task</button></span></section>`,

        ).join("")

      : `<section class="empty">No tasks match these filters.</section>`);

}

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

function pwDlg(n, email) {

  dlg(

    `<h3>Change password</h3><p>${esc(n)} will sign in with the new password. It is stored as a secure cryptographic hash, never as plain text.</p><div class="fm"><label>New password<input class="in" type="password" id="p1" placeholder="Min 8 characters"></label><label>Confirm password<input class="in" type="password" id="p2" placeholder="Repeat password"></label></div>`,

    "Update password",

    () => {

      const a = $("#p1").value;

      if (a.length < 8) {

        toast("Use 8+ characters for password");

        return false;

      }

      if (a != $("#p2").value) {

        toast("Passwords do not match");

        return false;

      }

      const u = USERS.find((x) => x.e === email || x.n === n);

      if (u && u.id && window.VyaparXAuth) {

        window.VyaparXAuth.updateUser(u.id, { password: a })

          .then(() => toast("Password updated securely in database"))

          .catch((err) => toast(err.message));

      } else {

        toast("Password updated");

      }

    },

  );

}

const UB = (a) => USERS.find((u) => esc(u.e) == a);

document.addEventListener("click", (e) => {

  if (!e.target.closest("#tb,#tp")) $("#tp").hidden = true;

  if (!e.target.closest("#pb,#pp")) $("#pp").hidden = true;

  const t = e.target.closest("[data-go],[data-open],[data-act],[data-s],[data-addcol],[data-chart-point],[data-chart-legend],[data-chart-retry]");

  if (!t) return;

  if (t.dataset.addcol != null) {
    window.VyaparXFields.openAddColumn(t.dataset.addcol, () => render());
    return;
  }

  const d = t.dataset;

  if (d.chartPoint) {
    adminChartShowDetails(d.chartPoint, d.chartDate);
    return;
  }

  if (d.chartLegend) {
    if (ADMIN_CHART_VISIBLE.has(d.chartLegend)) ADMIN_CHART_VISIBLE.delete(d.chartLegend);
    else ADMIN_CHART_VISIBLE.add(d.chartLegend);
    render();
    return;
  }

  if (d.chartRetry != null) {
    ADMIN_DASH_LOADING = true;
    render();
    syncDashboardFromDb();
    return;
  }

  if (d.open) {
    window.location.assign(d.open);
    return;
  }

  if (d.go) return go(d.go);

  if (d.s != null) {

    const i = +d.s;

    sort = { i, d: sort && sort.i == i ? -sort.d : 1 };

    return render();

  }

  const [a, x] = d.act.split(":"),

    u = UB(x),

    it = ITEMS.find((i) => i.id == x);

  if (a === "catadd") return catalogEditor();
  if (a === "catprint") {
    if (!ADMIN_CATALOG.length) return toast("Add catalog products before printing.");
    if (window.VyaparXCatalog) {
      window.VyaparXCatalog.loadFields().then(() => window.VyaparXCatalog.printCatalog(ADMIN_CATALOG));
    }
    return;
  }
  if (a === "catfields") {
    if (!window.VyaparXCatalog) return;
    window.VyaparXCatalog.loadFields().then(() => window.VyaparXCatalog.manageFields(document.body, () => render()));
    return;
  }
  if (a === "catedit") {
    const product = ADMIN_CATALOG.find((item) => String(item.id) === x);
    if (product) catalogEditor(product);
    return;
  }
  if (a === "catdelete") {
    const product = ADMIN_CATALOG.find((item) => String(item.id) === x);
    if (!product) return;
    return dlg(`<h3>Delete catalog product?</h3><p>${esc(product.name)} will be removed from future CRM quotations. Existing transaction history is retained.</p>`, "Delete product", (mask) => {
      const submit = mask.querySelector("[data-ok]");
      if (submit.disabled) return false;
      submit.disabled = true;
      window.VyaparXAuth.deleteModuleRecord("catalog", product.id).then(syncCatalogFromDb).then(render)
        .then(() => { syncDashboardFromDb(); toast("Product removed from the catalog."); })
        .catch((error) => toast("Product was not deleted: " + error.message))
        .finally(() => { if (submit.isConnected) submit.disabled = false; });
    });
  }

  if (a == "view")

    dlg(

      `<h3>${esc(u.n)}</h3><p>${esc(u.e)}<br>Role: ${u.r}<br>Department: ${u.d}<br>Access: ${u.m.length == MODS.length ? "All modules" : u.m.join(", ") || "No access"}<br>Status: ${u.s}</p>`,

      "Close",

      () => true,

    );

  else if (a == "edit")

    dlg(

      `<h3>Edit user</h3><div class="fm"><label>Name<input class="in" id="en" value="${esc(u.n)}"></label><label>Email<input class="in" id="ee" value="${esc(u.e)}"></label><label>Department<select class="in" id="ed">${["—", ...MODS].map((m) => `<option ${m == u.d ? "selected" : ""}>${m}</option>`).join("")}</select></label><div style="font-size:12px;color:var(--mut)">Module access</div><div style="display:flex;flex-wrap:wrap;gap:6px 12px">${MODS.map((m) => `<span><input type="checkbox" class="em" value="${m}" ${u.m.includes(m) ? "checked" : ""}> ${m}</span>`).join("")}</div></div>`,

      "Save changes",

      () => {

        const n = $("#en").value.trim(),

          m = $("#ee").value.trim();

        if (

          !n ||

          !/^\S+@\S+\.\S+$/.test(m) ||

          USERS.some((o) => o !== u && o.e == m)

        ) {

          toast("Enter a name and a unique, valid email");

          return false;

        }

        u.n = n;

        u.e = m;

        u.d = $("#ed").value;

        u.m = [...document.querySelectorAll(".em:checked")].map((c) => c.value);

        render();

        toast("User updated");

      },

    );

  else if (a == "create_dept_user") {

    dlg(

      `<h3>Create Department User</h3>

       <p style="color:var(--mut);font-size:12px;margin:2px 0 14px">Only Admin can create users. Each user receives their own secure login credentials.</p>

       <div class="fm">

         <label>Employee Full Name *

           <input class="in" id="cu_name" placeholder="Full Name" required>

         </label>

         <label>Email Address *

           <input class="in" id="cu_email" type="email" placeholder="name@company.com" required>

         </label>

         <label>Temporary Password *

           <input class="in" id="cu_pw" type="text" value="User@${Math.floor(1000 + Math.random() * 9000)}" placeholder="Min 8 characters" required>

         </label>

         <label>Assigned Department / Role *

           <select class="in" id="cu_role">

             <option value="Admin">1. Admin</option>

             <option value="CRM" selected>2. CRM</option>

             <option value="Sales">3. Sales</option>

             <option value="Purchase">4. Purchase</option>

             <option value="Inventory">5. Inventory</option>

             <option value="Production">6. Production</option>

             <option value="Quality Control">7. Quality Control</option>

             <option value="Transport">8. Transport</option>

             <option value="Employee Management">9. Employee Management</option>

             <option value="Accounting & Finance">10. Accounting & Finance</option>

           </select>

         </label>

         <label>Account Status *

           <select class="in" id="cu_status">

             <option value="ACTIVE" selected>Active</option>

             <option value="INACTIVE">Inactive</option>

           </select>

         </label>

       </div>`,

      "Create User",

      () => {

        const name = $("#cu_name").value.trim();

        const email = $("#cu_email").value.trim().toLowerCase();

        const pw = $("#cu_pw").value;

        const role = $("#cu_role").value;

        const status = $("#cu_status").value;



        if (!name || !email || !pw || !role) {

          toast("Please fill all required fields.");

          return false;

        }

        if (!/^\S+@\S+\.\S+$/.test(email)) {

          toast("Please enter a valid email address.");

          return false;

        }

        if (pw.length < 8) {

          toast("Password must be at least 8 characters.");

          return false;

        }



        window.VyaparXAuth.createDepartmentUser({

          fullName: name,

          email: email,

          password: pw,

          role: role,

          department: role,

          status: status,

        })

          .then(() => syncUsersFromDb())

          .then(() => {


            render();

            toast(`Department user created! Credentials: ${email}`);

          })

          .catch((err) => {

            toast(err.message || "Failed to create user.");

          });

      },

    );

  } else if (a == "role")

    dlg(

      `<h3>Change role</h3><p style="color:var(--mut);font-size:12px;margin:2px 0 10px">Current role: <b>${esc(u.r)}</b>${u.d ? ` · Current department: <b>${esc(u.d)}</b>` : ""}</p><div class="fm"><label>Assigned Role<select class="in" id="rr">${Object.values(window.VyaparXAuth ? window.VyaparXAuth.ROLES : {}).map((r) => `<option ${r == u.r ? "selected" : ""}>${r}</option>`).join("")}</select></label><label>Department<select class="in" id="rq">${[u.d].filter(Boolean).map((m) => `<option ${m == u.d ? "selected" : ""}>${m}</option>`).join("")}</select></label><small style="color:var(--mut)">The department list updates to match the selected role; incompatible combinations are rejected by the backend.</small></div>`,

      "Save role",

      () => {

        const r = $("#rr").value;

        const d = $("#rq").value;

        if (r == u.r && d == u.d) {

          toast("No changes to save");

          return false;

        }

        if (window.VyaparXAuth && u.id) {

          window.VyaparXAuth.updateUser(u.id, { role: r, department: d })

            .then(() => syncUsersFromDb())

            .then(() => {


              render();

              toast("Role updated in database. The user's access changes on their next sign-in.");

            })

            .catch((err) => toast(err.message));

        } else {

          toast("This user is not saved in the database yet");

          return false;

        }

      },

    );

  else if (a == "pw") pwDlg(u.n, u.e);

  else if (a == "toggle") {

    if (u.r == "Admin") return toast("The Admin account cannot be deactivated");

    const off = u.s == "ACTIVE";

    dlg(

      `<h3>${off ? "Deactivate" : "Activate"} user?</h3><p>${off ? `${esc(u.n)} will lose access immediately. Their records stay unchanged.` : `${esc(u.n)} will be able to sign in again.`}</p>`,

      off ? "Deactivate" : "Activate",

      () => {

        if (window.VyaparXAuth && u.id) {

          window.VyaparXAuth.toggleUserStatus(u.id)

            .then(() => syncUsersFromDb())

            .then(() => {


              render();

              toast("User " + (off ? "deactivated" : "activated"));

            })

            .catch((err) => toast(err.message));

        } else {

          u.s = off ? "INACTIVE" : "ACTIVE";

          render();

          toast("User " + (off ? "deactivated" : "activated"));

        }

      },

    );

  } else if (a == "head")

    dlg(

      `<h3>${esc(x)} head</h3><p>The previous head loses the head assignment. Existing records stay linked to their original creators and the new head continues on the same data.</p><select class="in" id="hs">${USERS.filter(

        (o) => o.s == "ACTIVE" && o.r != "Admin" && o.id,

      )

        .map((o, i) => `<option value="${esc(o.e)}">${esc(o.n)} (${esc(o.r)})</option>`)

        .join("")}</select>`,

      "Save head",

      async () => {

        const target = UB($("#hs").value);

        if (!target || !target.id) {

          toast("No eligible saved user selected");

          return false;

        }

        const ok = await assign(x, target);

        if (!ok) return false; // failure keeps the previous valid state

        render();

        toast(`Department head updated: ${target.n}`);

      },

    );

  else if (a == "tkview")

    dlg(

      `<h3>${esc(it.t)}</h3><p>${it.d}<br>${esc(it.ds)}<br>Priority: ${it.p}<br>Due: ${adminDateFmt(it.due)}<br>Status: ${it.s}</p>`,

      "Close",

      () => true,

    );

  else if (a == "tkread") {

    it.read = true;

    tp();

    badge();

  } else if (a == "tkopen") {

    it.read = true;

    $("#tp").hidden = true;

    go("ann");

  } else if (a == "readall") {

    ITEMS.forEach((i) => (i.read = true));

    tp();

    badge();

  } else if (a == "tab") {

    tab = tab == x ? "All" : x;

    render();

  } else if (a == "rapply" || a == "rgen") {

    ra = { ...rd };

    tab = "All";

    // Validate the date range before generating.

    if (ra.f && ra.to && ra.f > ra.to) {

      toast("Date From must be earlier than or equal to Date To");

      return;

    }

    load = true;

    render();

    setTimeout(() => {

      load = false;

      render();

      const n = repRows(false).length;

      if (a == "rgen") toast(`Report generated: ${n} record(s)`);

    }, 450);

  } else if (a == "rreset") {

    rd = { ...RD };

    ra = { ...RD };

    tab = "All";

    render();

  } else if (a == "csv") {

    const rows = repRows(false).map((row) => row.map((value, index) => index === 4 ? adminDateFmt(value) : value));

    if (!rows.length) return toast("No records match the current filters");

    const head = ["Type", "Reference", "User", "Department", "Date", "Status", "Amount"];

    const csv = [head, ...rows]

      .map((r) => r.map((c) => `"${String(c).replace(/"/g, '""')}"`).join(","))

      .join("\n");

    const blob = new Blob(["\ufeff" + csv], { type: "text/csv;charset=utf-8" });

    const link = document.createElement("a");

    link.href = URL.createObjectURL(blob);

    link.download = `vyaparx-${ra.m.toLowerCase().replace(/[^a-z]+/g, "-")}-report-${adminDateKey(new Date())}.csv`;

    link.click();

    URL.revokeObjectURL(link.href);

    toast(`Exported ${rows.length} record(s) to CSV`);

  } else if (a == "pdf") print();

  else if (a == "send" || a == "draft") {

    const ti = $("#at").value.trim(),

      ds = $("#ad").value.trim(),

      ty = $("#y").value,

      du = $("#au").value;

    if (!ti || !ds) return toast("Add a title and a description");

    if (

      ty == "Task" &&

      a == "send" &&

      (!du || du < adminDateKey(new Date()))

    )

      return toast("Choose a due date that is today or later");

    window.VyaparXAuth.createTask({

      title: ti,

      description: ds,

      type: ty,

      priority: $("#p").value,

      department: $("#d").value,

      dueDate: du || null,

      status: a == "send" ? (ty == "Task" ? "Pending" : "Completed") : "Pending",

    })

      .then(() => syncTasksFromDb())

      .then(() => {

        render();

        toast(a == "send" ? `${ty} sent to ${$("#d").value}` : "Draft saved");

      })

      .catch((err) => toast(err.message || "Could not save the task"));

  } else if (a == "tkdel") {

    // Restricted to completed tasks; requires explicit confirmation.

    if (!it || it.s !== "Completed")

      return toast("Only completed tasks can be deleted");

    dlg(

      `<h3>Delete completed task?</h3><p>Are you sure you want to delete this completed task? This action cannot be undone.</p><p style="color:var(--mut);font-size:12px"><b>${esc(it.t)}</b></p>`,

      "Delete task",

      () => {

        window.VyaparXAuth.deleteTask(it.id)

          .then(() => syncTasksFromDb())

          .then(() => {

            render();

            toast("Completed task deleted");

          })

          .catch((err) => toast(err.message || "Could not delete the task"));

      },

    );

  } else if (a == "savecompany") {

    const gstin = $("#cf_gstin").value.trim().toUpperCase();

    if (gstin && !/^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z][1-9A-Z]Z[0-9A-Z]$/.test(gstin)) {

      toast("Enter a valid 15-character GSTIN (e.g. 24ABCDE1234F1Z5)");

      return;

    }

    window.VyaparXAuth
      .updateCompanyProfile({

        company_name: $("#cf_name").value.trim(),

        registered_business_name: $("#cf_rname").value.trim(),

        gstin: gstin,

        phone: $("#cf_phone").value.trim(),

        address: $("#cf_address").value.trim(),

        state: $("#cf_state").value.trim(),

        pin_code: $("#cf_pin").value.trim(),

        business_type: $("#cf_btype").value.trim(),

        industry: $("#cf_industry").value.trim(),

      })

      .then(() => window.VyaparXShared.loadCompanyProfile(true))

      .then(() => {

        const s = window.VyaparXAuth.getCurrentSession();

        const prof = window.VyaparXShared.getCompanyProfile();

        if (s && prof && prof.company_name) {

          s.companyName = prof.company_name;

          sessionStorage.setItem("vyparx_secure_session", JSON.stringify(s));

        }

        render();

        toast("Company details saved");

      })

      .catch((err) => toast(err.message || "Could not save company details"));

  } else if (a == "cancel") {

    const dirty = $("#at").value || $("#ad").value;

    dirty

      ? dlg(

          "<h3>Discard this message?</h3><p>Your unsaved changes will be lost.</p>",

          "Discard",

          () => render(),

        )

      : render();

  } else if (a == "pm") {

    $("#pp").hidden = true;

    x == "pw" ? pwDlg("Admin") : go("profile");

  } else if (a == "logout")

    dlg(

      "<h3>Log out?</h3><p>You will return to the login page.</p>",

      "Log out",

      () => {

        Promise.resolve(window.VyaparXAuth && window.VyaparXAuth.logout())
          .finally(() => {
            window.location.href = "loginpage.html";
          });

      },

    );

  else if (a == "save") toast("Saved");

});

document.addEventListener("change", (event) => {
  const target = event.target;
  if (target.matches("[data-chart-range]")) {
    ADMIN_CHART_RANGE = target.value;
    if (target.value === "custom") {
      const today = adminDateKey(new Date());
      ADMIN_CHART_END = ADMIN_CHART_END || today;
      ADMIN_CHART_START = ADMIN_CHART_START || adminChartOffset(today, -29);
    }
    render();
  } else if (target.matches("[data-chart-start]")) {
    ADMIN_CHART_START = target.value;
    render();
  } else if (target.matches("[data-chart-end]")) {
    ADMIN_CHART_END = target.value;
    render();
  }
});

document.addEventListener("pointermove", (event) => {
  const point = event.target.closest?.("[data-chart-point]");
  const chart = point?.closest(".chart-svg-scroll");
  if (!point || !chart) return;
  const tooltip = chart.querySelector(".chart-tooltip");
  const series = ADMIN_CHART_SERIES[point.dataset.chartPoint];
  tooltip.textContent = `${series.label} · ${adminDateFmt(point.dataset.chartDate)} · ${Number(point.dataset.chartValue || 0).toLocaleString("en-IN")} ${point.dataset.chartUnit || "units"}`;
  const bounds = chart.getBoundingClientRect();
  tooltip.style.left = `${Math.max(8, Math.min(event.clientX - bounds.left + 12, bounds.width - 230))}px`;
  tooltip.style.top = `${Math.max(8, event.clientY - bounds.top - 42)}px`;
  tooltip.hidden = false;
});

document.addEventListener("pointerout", (event) => {
  if (!event.target.closest?.("[data-chart-point]")) return;
  const chart = event.target.closest(".chart-svg-scroll");
  if (chart && !event.relatedTarget?.closest?.("[data-chart-point]")) chart.querySelector(".chart-tooltip")?.setAttribute("hidden", "");
});

document.addEventListener("input", (e) => {

  const t = e.target;

  // Change Role dialog: the department options follow the selected role so

  // incompatible role/department combinations can never be submitted.

  if (t.id == "rr") {

    const map = {

      Admin: ["Administration"],

      CRM: ["CRM"],

      Sales: ["Sales Order"],

      Purchase: ["Purchase & Trading"],

      Inventory: ["Inventory"],

      Production: ["Production"],

      "Quality Control": ["Production"],

      Transport: ["Transport"],

      "Employee Management": ["Administration"],

      "Accounting & Finance": ["Accounting"],

    };

    const opts = map[t.value] || [];

    const rq = $("#rq");

    if (rq) rq.innerHTML = opts.map((o) => `<option>${o}</option>`).join("");

  }

  if (t.dataset.q != null) {

    q = t.value;

    const p = t.selectionStart;

    render();

    const n = $("[data-q]");

    n.focus();

    n.setSelectionRange(p, p);

  }

  if (t.dataset.p) {

    const [m, i] = t.dataset.p.split(":");

    P[m][i] = t.checked;

  }

});

document.addEventListener("change", (e) => {

  const t = e.target;

  if (t.dataset.f != null) {

    fv = t.value;

    render();

  }

  if (t.dataset.r) {

    rd[t.dataset.r] = t.value;

    // Keep edits as draft filters. The table changes only after one click on
    // Apply filters, so users can set every field before a report reload.
    if (t.dataset.r == "m") {

      rd.t = "";

      rd.s = "All";
      // Refresh only the dependent dropdown options for the new department.
      render();
    }

  }

  if (t.dataset.tf) {

    tf[t.dataset.tf] = t.value;

    tp();

  }

});

$("#tb").onclick = () => {

  $("#pp").hidden = true;

  tp();

  $("#tp").hidden = !$("#tp").hidden;

};

$("#pb").onclick = () => {

  $("#tp").hidden = true;

  $("#pp").hidden = !$("#pp").hidden;

};

$("#ct").onclick = () => document.body.classList.toggle("col");

$("#mb").onclick = () => window.VyaparXShared.toggleMobileNav();

$("#th").onclick = () => { if (window.VyaparXShared) window.VyaparXShared.applyTheme(window.VyaparXShared.currentTheme() === "dark" ? "light" : "dark"); };

go("dashboard");
if (window.VyaparXFields) window.VyaparXFields.loadFields("admin").then(() => { if (cur === "roles") render(); });
syncCatalogFromDb();
syncDashboardFromDb();
window.addEventListener("focus", syncCatalogFromDb);
window.addEventListener("focus", syncDashboardFromDb);
window.setInterval(() => {
  if (document.visibilityState === "visible" && ["dashboard", "reports"].includes(cur)) syncDashboardFromDb();
}, 30000);



// Show only the registered company name in the Admin header profile area.
(async () => {
  try {
    if (window.VyaparXShared) {
      await window.VyaparXShared.loadCompanyProfile(true);
    }
    const session = window.VyaparXAuth && window.VyaparXAuth.getCurrentSession();
    const profile = window.VyaparXShared && window.VyaparXShared.getCompanyProfile();
    const companyName = (profile && (profile.company_name || profile.companyName)) ||
      (session && session.companyName) || "";
    const pb = $("#pb");
    if (pb) {
      const name = pb.querySelector("b");
      const subtitle = pb.querySelector(".profile-text .bc");
      const avatar = pb.querySelector(".av");
      if (name) name.textContent = companyName;
      if (subtitle) subtitle.hidden = true;
      if (avatar) {
        avatar.textContent = companyName.split(/\s+/).filter(Boolean).slice(0, 2)
          .map((part) => part[0]).join("").toUpperCase() || "C";
      }
    }
    render();
    await syncTasksFromDb();
    badge();
    if (cur === "ann" || cur === "dashboard") render();

    if (window.VyaparXShared && window.VyaparXShared.tasks) {
      window.VyaparXShared.tasks.onTasksUpdated(async () => {
        await syncTasksFromDb();
        badge();
        if (cur === "ann" || cur === "dashboard") render();
      });
    }
    if (window.VyaparXShared && window.VyaparXShared.records) {
      window.VyaparXShared.records.onRecordsUpdated(async () => {
        await syncDashboardFromDb();
      });
    }
  } catch (e) {}
})();
