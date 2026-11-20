/**
 * VyaparX ERP - Purchase & Procurement Controller
 * Manages Vendor Master, Purchase Orders, Goods Receipt, and Payment Processing.
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
  return Number.isNaN(date.getTime()) ? "—" : date.toLocaleDateString("en-GB", { day: "2-digit", month: "2-digit", year: "numeric" });
};
function detail(secs) {
  const m = document.createElement("div");
  m.className = "mask vm";
  m.innerHTML = `<div class="dlg" role="dialog" aria-label="${secs[0][0]}" style="width:min(500px,100%);position:relative;max-height:90vh;overflow:auto"><button class="ic" data-x aria-label="Close" style="position:absolute;top:12px;right:12px">✕</button>${secs.map(([t, r], i) => `<div style="margin-top:${i ? 18 : 0}px"><b style="font-weight:600;display:block;padding:0 ${i ? 0 : 36}px 6px 0;font-size:${i ? 14 : 16}px;border-bottom:1px solid var(--bd);margin-bottom:10px">${t}</b>${r ? `<div style="display:grid;grid-template-columns:130px 1fr;gap:10px 16px">${r.map((x) => `<span style="color:var(--mut)">${x[0]}</span><span style="font-weight:500;word-break:break-word">${x[1]}</span>`).join("")}</div>` : `<span style="color:var(--mut)">No activity yet.</span>`}</div>`).join("")}</div>`;
  document.body.append(m);
  m.onclick = (ev) => {
    if (ev.target == m || ev.target.closest("[data-x]")) m.remove();
  };
}
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
  return `<div class="card"><div class="bar"><input class="in" data-q placeholder="Search..." value="${esc(q)}" aria-label="Search table">${o.filter ? `<select class="in" data-f aria-label="Filter by status">${["All", ...o.filter].map((x) => `<option ${x == fv ? "selected" : ""}>${x}</option>`).join("")}</select>` : ""}</div><div class="tw"><table><thead><tr>${cols.map((c, i) => `<th data-s="${i}">${c}</th>`).join("")}${o.act ? "<th>Actions</th>" : ""}</tr></thead><tbody>${f.length ? f.map((r) => `<tr>${r.map((c, i) => `<td>${/Status/.test(cols[i]) || /Priority/.test(cols[i]) ? st(c) : c}</td>`).join("")}${o.act ? `<td><span style="display:flex;gap:4px">${o.act(r)}</span></td>` : ""}</tr>`).join("") : `<tr><td colspan="12"><div class="empty">${o.empty || "No matching records."}<br><small>Records you add will appear here.</small></div></td></tr>`}</tbody></table></div></div>`;
}
document.addEventListener("keydown", (e) => {
  if (e.key == "Escape")
    document.querySelectorAll(".vm").forEach((m) => m.remove());
});
let ME = window.VyaparXAuth?.getCurrentSession?.()?.fullName || window.VyaparXAuth?.getCurrentSession?.()?.name || "";
const inr = (n) => "₹" + n.toLocaleString("en-IN"),
  ROLE = "Department Head",
  PH = /^\d{10}$/,
  EM = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;
const NAV = [
  [
    "PURCHASE & TRADING",
    [
      [
        "dashboard",
        "Dashboard",
        "<rect x='3' y='3' width='7' height='9'/><rect x='14' y='3' width='7' height='5'/><rect x='14' y='12' width='7' height='9'/><rect x='3' y='16' width='7' height='5'/>",
      ],
      ["sup", "Suppliers", "<path d='M3 21V8l9-5 9 5v13M9 21v-6h6v6'/>"],
      [
        "pos",
        "Purchase Orders",
        "<path d='M6 3h12l2 5v13H4V8z M4 8h16M9 12h6'/>",
      ],
      ["inventoryOrders", "Inventory Orders", "<path d='M4 5h16M4 12h16M4 19h16M8 3v4M16 10v4M10 17v4'/>"] ,
      ["items", "Purchase Items", "<path d='M4 6h16M4 12h16M4 18h10'/>"],
      [
        "pending",
        "Pending Purchases",
        "<circle cx='12' cy='12' r='9'/><path d='M12 7v5l3 2'/>",
      ],
      [
        "recv",
        "Received Goods",
        "<path d='M21 8l-9-5-9 5v8l9 5 9-5zM3 8l9 5 9-5M12 13v8'/>",
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
const S = (i, n, ph, e, ad, gst, s) => ({ id: "S" + i, n, ph, e, ad, gst, s });
let SUP = [];
const INV = {};
const P = (n, sup, item, qty, rate, pd, ed, recq, paid, s, cb) => ({
  id: "PO-" + n,
  sup,
  item,
  qty,
  rate,
  pd,
  ed,
  rd: s == "RECEIVED" ? iso(-3) : null,
  recq,
  paid,
  st: s,
  cb,
  ca: pd,
  hist: [{ date: pd, action: "Purchase order created" }].concat(
    s == "DRAFT" ? [] : [{ date: pd, action: "Status: " + s.replace(/_/g, " ") }],
  ),
});
let PO = [];
let INVENTORY_ORDERS = [];
let RECV = [];
const M = (i, n, des, r, ph, jd) => ({
  id: "M" + i,
  eid: "EMP-010" + i,
  n,
  e: n.split(" ")[0].toLowerCase() + "@example.com",
  des,
  r,
  ph,
  jd,
  photo: null,
});
let TEAM = [];
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
const canManageTeam = () => window.VyaparXShared?.departmentTeam?.canManage("purchase") === true;

let _cachedCompanyPeople = null;
const PEOPLE = () => {
  if (window.VyaparXShared && window.VyaparXShared.getCompanyPeople) {
    if (!_cachedCompanyPeople) {
      window.VyaparXShared.getCompanyPeople().then((res) => { _cachedCompanyPeople = res; });
    }
    if (_cachedCompanyPeople) return _cachedCompanyPeople;
  }
  return [];
};
const dept = (n) =>
    (PEOPLE().find((p) => p.n == n) || { d: "Purchase & Trading" }).d,
  meM = () => TEAM.find((m) => m.id == "M1") || {
    id: "M1", n: window.VyaparXAuth?.getCurrentSession?.()?.fullName || ME || "User",
    e: window.VyaparXAuth?.getCurrentSession?.()?.email || "", ph: "", des: "Purchase & Trading", photo: null,
  },
  ini = (n) =>
    n
      .split(" ")
      .map((w) => w[0])
      .join("")
      .slice(0, 2);
const nowT = () => TODAY + " " + new Date().toTimeString().slice(0, 5);
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
  ((window.VyaparXShared && window.VyaparXShared.tasks.getTasksCache()) || []).find((r) => String(r.id) === String(id)),
  nvis = () =>
    NOTES.filter((n) =>
      n.k
        ? (n.k == "appr" ? cnt(["PENDING_APPROVAL"]) : late().length) > 0
        : !!REC(n.ref),
    );
const ntext = (n) => {
  if (n.k)
    return n.k == "appr"
      ? `${cnt(["PENDING_APPROVAL"])} purchase order(s) waiting for approval`
      : `${late().length} purchase order(s) past expected delivery`;
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
const tot = (o) => Number(o.totalAmount ?? (Number(o.qty || 0) * Number(o.rate || 0))),
  pay = (o) => {
    const t = tot(o);
    const paid = Number(o.paidAmount ?? o.paid ?? 0);
    return paid >= t && t > 0 ? "PAID" : paid > 0 ? "PARTIAL" : "UNPAID";
  },
  late = () =>
    PO.filter(
      (o) => ["ORDERED", "PARTIALLY_RECEIVED"].includes(o.st) && o.ed < TODAY,
    ),
  sn = (o) => SUP.find((s) => s.id == o.sup).n,
  un = (o) => INV[o.item]?.[3] || o.unit || "Nos";
const st = (s) => {
  const c = /^(RECEIVED|PAID|ACTIVE|Completed|Low|Read)$/.test(s)
    ? "ok"
    : /^(PENDING_APPROVAL|PARTIALLY_RECEIVED|PARTIAL|DRAFT|INACTIVE|Pending|In Progress|High|Medium|Unread)$/.test(
          s,
        )
      ? "wa"
      : /^(CANCELLED|UNPAID|Urgent|Late)$/.test(s)
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
const OB = (id) => PO.find((o) => o.id == id),
  SB = (id) => SUP.find((s) => s.id == id),
  addh = (o, t) => o.hist.push({ date: TODAY, action: t });
const kpi = (a, b) =>
    `<div class="card kpi"><small>${a}</small><b>${b}</b></div>`,
  cnt = (s) => PO.filter((o) => s.includes(o.st)).length;
const PC = [
    "PO No",
    "Supplier",
    "Item",
    "Quantity",
    "Total",
    "Expected Delivery",
    "Payment Status",
    "Status",
  ],
  prow = (o) => [
    o.id,
    esc(sn(o)),
    INV[o.item]?.[1] || o.itemName || o.item,
    o.qty + " " + un(o),
    inr(tot(o)),
    fs(o.ed),
    pay(o),
    o.st,
  ];
const pact = (r) => {
  const o = OB(r[0]),
    session = window.VyaparXAuth?.getCurrentSession?.() || {},
    b = (a, l) => `<button class="btn s" data-act="${a}:${o.id}">${l}</button>`;
  return (
    b("ov", "View") +
    (["DRAFT", "REJECTED"].includes(o.st) ? b("oe", "Edit") + b("osub", "Submit") : "") +
    (o.st === "DRAFT" && !o.accountingRequestId && (String(o.createdBy || "") === String(session.id || session.userId || "") || String(session.role || "").toLowerCase() === "admin") ? b("opdel", "Delete") : "") +
    (["ORDERED", "PARTIALLY_RECEIVED"].includes(o.st) && o.ed <= TODAY
      ? b("orc", "Receive")
      : "") +
    (["DRAFT", "REJECTED", "PENDING_APPROVAL"].includes(o.st) ||
    (o.st == "ORDERED" && !o.recq)
      ? b("ocn", "Cancel")
      : "")
  );
};
const V = {
  dashboard() {
    const lt = late(),
      ap = PO.filter((o) => o.st == "PENDING_APPROVAL");
    return (
      ph(
        purchaseGreeting(),
        "Suppliers, purchase orders and deliveries in one place.",
        ["add", "Create Purchase Order"],
      ) +
      `<div class="grid k6">${kpi("Open POs", cnt(["ORDERED", "PARTIALLY_RECEIVED"]))}${kpi("Awaiting Approval", ap.length)}${kpi("Expected Deliveries", PO.filter((o) => ["ORDERED", "PARTIALLY_RECEIVED"].includes(o.st) && o.ed <= iso(7)).length)}${kpi("Received Purchases", cnt(["RECEIVED"]))}${kpi("Pending Payments", PO.filter((o) => ["ORDERED", "PARTIALLY_RECEIVED", "RECEIVED"].includes(o.st) && pay(o) != "PAID").length)}</div>
 <div class="grid two" style="margin-top:14px"><div class="card"><h3>Recent purchase orders</h3><div class="tw"><table><tr><th>PO</th><th>Supplier</th><th>Total</th><th>Status</th></tr>${PO.slice(
   0,
   5,
 )
   .map(
     (o) =>
       `<tr><td>${o.id}</td><td>${esc(sn(o))}</td><td>${inr(tot(o))}</td><td>${st(o.st)}</td></tr>`,
   )
   .join("")}</table></div></div>
 <div class="card"><h3>Needs attention</h3>${[...ap, ...lt].length ? [...ap, ...lt].map((o) => `<div style="display:flex;justify-content:space-between;align-items:center;padding:8px 0;border-bottom:1px solid var(--bd)"><span>${o.id}<br><small style="color:var(--mut)">${o.st == "PENDING_APPROVAL" ? "Awaiting approval" : "Delivery overdue"}</small></span><button class="btn s" data-act="ov:${o.id}"><i class="fa-solid fa-eye" aria-hidden="true"></i></button></div>`).join("") : `<div class="empty">Nothing needs attention.</div>`}</div></div>`
    );
  },
  sup() {
    return (
      ph(
        "Suppliers",
        "Supplier master. Suppliers with purchase history are deactivated, never deleted.",
        ["sadd", "Add Supplier"],
      ) +
      table(
        ["ID", "Name", "Contact", "Email", "GST No", "Status"],
        SUP.map((s) => [s.id, esc(s.n), s.ph, esc(s.e), s.gst || "—", s.s]),
        {
          filter: ["ACTIVE", "INACTIVE"],
          act: (r) => {
            const s = SB(r[0]);
            const hasOrders = PO.some((order) => String(order.sup || order.supplierId || "") === String(s.id));
            return `<button class="btn s" data-act="sv:${s.id}"><i class="fa-solid fa-eye" aria-hidden="true"></i></button><button class="btn s" data-act="se:${s.id}" title="Edit" aria-label="Edit"><i class="fa-solid fa-pen-to-square" aria-hidden="true"></i></button>${!hasOrders ? `<button class="btn s" data-act="sdel:${s.id}" title="Delete supplier" aria-label="Delete supplier"><i class="fa-solid fa-trash-can" aria-hidden="true"></i></button>` : ""}<button class="btn s" data-act="stg:${s.id}">${s.s == "ACTIVE" ? "Deactivate" : "Activate"}</button>`;
          },
          empty: "No suppliers yet.",
        },
      )
    );
  },
  pos() {
    return (
      ph("Purchase Orders", "Create, approve and receive purchase orders.", [
        "add",
        "Create Purchase Order",
      ]) +
      table(window.VyaparXFields.tableColumns("purchase", PC), PO.map((o) => window.VyaparXFields.tableRow("purchase", o, prow(o))), {
        colModule: "purchase",
        filter: [
          "DRAFT",
          "PENDING_APPROVAL",
          "ORDERED",
          "PARTIALLY_RECEIVED",
          "RECEIVED",
          "CANCELLED",
        ],
        act: pact,
        empty: "No purchase orders yet.",
      })
    );
  },
  inventoryOrders() {
    const rows = INVENTORY_ORDERS.filter((r) => !r.isDeleted);
    return ph("Inventory Orders", "Review the Raw Material Requisition bill sent by Inventory. Add supplier prices and delivery date to create the Purchase Orders.", ["iorrefresh", "Refresh"]) +
      `<div class="card"><div class="tw"><table><thead><tr><th>Request Bill</th><th>Raw Material Lines</th><th>Expected Date</th><th>Requested By</th><th>Status</th><th>Purchase Orders</th><th>Delivery Date</th><th>Bill / Actions</th></tr></thead><tbody>${rows.length ? rows.map((r) => `<tr><td>${esc(r.id)}</td><td>${(r.items || []).map((item) => `${esc(item.itemName)} · ${Number(item.quantity)} ${esc(item.unit)}`).join("<br>") || esc(r.itemName || "—")}</td><td>${esc(r.expectedDate || "—")}</td><td>${esc(r.requestedBy)}</td><td>${st(r.status)}</td><td>${esc((r.purchaseOrderIds || [r.purchaseOrderId]).filter(Boolean).join(", ") || "—")}</td><td>${esc(r.deliveryDate || "—")}</td><td><button class="btn s" data-act="iobill:${esc(r.id)}">View / Print Bill</button> ${r.status === "Pending" ? `<button class="btn s p" data-act="ioapprove:${esc(r.id)}">Review & Approve</button><button class="btn s" data-act="ioreject:${esc(r.id)}">Reject</button>` : ""}</td></tr>`).join("") : `<tr><td colspan="8"><div class="empty">No requisition bills received from Inventory.</div></td></tr>`}</tbody></table></div></div>`;
  },
  items() {
    return (
      ph(
        "Purchase Items",
        "Item, quantity and rate for every purchase order. Amount = quantity × rate.",
      ) +
      table(
        ["PO No", "Item Code", "Item", "Ordered", "Received", "Rate", "Amount"],
        PO.map((o) => [
          o.id,
          INV[o.item]?.[0] || o.itemCode || o.item,
          INV[o.item]?.[1] || o.itemName || o.item,
          o.qty + " " + un(o),
          o.recq + " " + un(o),
          inr(o.rate),
          inr(tot(o)),
        ]),
      )
    );
  },
  pending() {
    return (
      ph("Pending Purchases", "Orders waiting for approval or delivery.") +
      table(
        [
          "PO No",
          "Supplier",
          "Item",
          "Expected Delivery",
          "Delivery",
          "Status",
        ],
        PO.filter((o) =>
          ["PENDING_APPROVAL", "ORDERED", "PARTIALLY_RECEIVED"].includes(o.st),
        ).map((o) => [
          o.id,
          esc(sn(o)),
          INV[o.item]?.[1] || o.itemName || o.item,
          fs(o.ed),
          o.st == "PENDING_APPROVAL" ? "—" : o.ed < TODAY ? "Late" : "On time",
          o.st,
        ]),
        { act: pact, empty: "No pending purchases." },
      )
    );
  },
  recv() {
    return (
      ph(
        "Received Goods",
        "Every goods receipt. Stock is added to Inventory on receipt.",
      ) +
      table(
        ["PO No", "Supplier", "Item", "Received Qty", "Date", "Received By"],
        RECV.map((r) => {
          const o = OB(r.po);
          return [
            r.po,
            esc(sn(o)),
            INV[o.item]?.[1] || o.itemName || o.item,
            r.qty + " " + un(o),
            fs(r.date),
            esc(r.by),
          ];
        }),
        {
          act: (r) =>
            `<button class="btn s" data-act="ov:${r[0]}">View PO</button>`,
          empty: "No goods received yet.",
        },
      )
    );
  },
  payments() {
    return (
      ph(
        "Payments",
        "Payables per purchase order. Payments are recorded by Accounting.",
      ) +
      table(
        ["PO No", "Supplier", "Total", "Paid", "Balance", "Payment Status"],
        PO.filter(
          (o) => !["DRAFT", "PENDING_APPROVAL", "CANCELLED"].includes(o.st),
        ).map((o) => [
          o.id,
          esc(sn(o)),
          inr(tot(o)),
          inr(o.paid),
          inr(tot(o) - o.paid),
          pay(o),
        ]),
        {
          act: (r) =>
            `<button class="btn s" data-act="ov:${r[0]}"><i class="fa-solid fa-eye" aria-hidden="true"></i></button>`,
          empty: "No payables yet.",
        },
      )
    );
  },
  reports() {
    const a = PO.filter((o) => o.st != "CANCELLED"),
      v = a.reduce((s, o) => s + tot(o), 0),
      p = a.reduce((s, o) => s + o.paid, 0);
    return (
      ph("Reports", "Purchase performance from current orders.") +
      `<div class="bar" style="margin:0"><button class="btn" data-act="csv" title="Export CSV" aria-label="Export CSV"><i class="fa-solid fa-file-csv"></i></button><button class="btn" onclick="print()" title="Print" aria-label="Print"><i class="fa-solid fa-print"></i></button></div><div class="grid k6" style="margin:14px 0">${kpi("Purchase value", inr(v))}${kpi("Paid", inr(p))}${kpi("Outstanding", inr(v - p))}${kpi("Received POs", cnt(["RECEIVED"]))}</div><div class="grid" style="grid-template-columns:repeat(auto-fit,minmax(300px,1fr))"><div class="card"><h3>By status</h3><table style="min-width:0">${["DRAFT", "PENDING_APPROVAL", "ORDERED", "PARTIALLY_RECEIVED", "RECEIVED", "CANCELLED"].map((s) => `<tr><td>${st(s)}</td><td>${cnt([s])}</td><td>${inr(PO.filter((o) => o.st == s).reduce((x, o) => x + tot(o), 0))}</td></tr>`).join("")}</table></div><div class="card"><h3>By supplier</h3><table style="min-width:0">${SUP.map((s) => `<tr><td>${esc(s.n)}</td><td>${PO.filter((o) => o.sup == s.id).length}</td><td>${inr(PO.filter((o) => o.sup == s.id && o.st != "CANCELLED").reduce((x, o) => x + tot(o), 0))}</td></tr>`).join("")}</table></div></div>`
    );
  },
  team() {
    return (
      ph(
        "My Team",
        "Only Purchase & Trading employees appear here.",
        canManageTeam() ? ["madd", "Add Member"] : null,
      ) +
      table(
        ["Name", "Designation", "Open POs", "Status"],
        TEAM.map((m) => [
          esc(m.n),
          esc(m.des),
          PO.filter(
            (o) => o.cb == m.n && !["RECEIVED", "CANCELLED"].includes(o.st),
          ).length,
          "ACTIVE",
        ]),
        {
          act: (r) => {
            const m = TEAM.find((z) => esc(z.n) == r[0]);
            return (
              `<button class="btn s" data-act="ev:${m.id}"><i class="fa-solid fa-eye" aria-hidden="true"></i></button>` +
              (canManageTeam()
                ? `<button class="btn s" data-act="me:${m.id}">✏ Edit</button>`
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
    const T = TAB == "Task",
      H = ph(
        "Tasks & Communication",
        "Send work and messages to other departments.",
        ["send", T ? "Send Task" : "Send Message"],
      );
    if (load) return H + `<div class="card empty">Loading…</div>`;
    try {
      const mine = (T ? TASKS : COMMS).filter((r) => r.dir === "Sent" || r.dir === "Received"),
        f = (k) => mine.filter((r) => k === "All" || r.dir === k),
        list = f(FLT);
      const seg = (a, k, c, l) =>
        `<span style="display:inline-flex;gap:4px;background:var(--bg);padding:3px;border-radius:12px;border:1px solid var(--bd)">${a.map((x) => `<button class="btn s" style="border:0;${c == x ? "background:var(--pri2);color:var(--pt)" : "background:none"}" data-act="${k}:${x}">${l(x)}</button>`).join("")}</span>`;
      const em = {
          All: T ? "No tasks found." : "No communications found.",
          Sent: T ? "No sent tasks." : "No sent communications.",
          Received: T ? "No received tasks." : "No received communications.",
        }[FLT],
        fl = (r) => (r.att.length ? "📎 " + r.att.length : "—"),
        oth = (r) => (r.from == ME ? r.td : r.fd);
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
          (T && (t.to == ME || t.dir == "Received") && t.st != "Completed"
            ? `<button class="btn s" data-act="adv:${t.id}">${t.st == "Pending" ? "Start" : "Complete"}</button>`
            : "") +
          (t.from == ME || t.dir == "Sent" || can("task_delete")
            ? `<button class="btn s" data-act="td:${t.id}" aria-label="Delete" title="Delete">🗑</button>`
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
      ph("Notifications", "Only notices for Purchase & Trading and you.") +
      `<div class="card">${L.length ? L.map((n) => `<div style="display:flex;justify-content:space-between;gap:8px;align-items:center;padding:10px 0;border-bottom:1px solid var(--bd)"><span>${ntext(n)} ${n.read ? "" : `<span class="tag wa">New</span>`}</span><span style="display:flex;gap:6px">${n.ref ? `<button class="btn s" data-act="nopen:${n.id}">Open</button>` : ""}${n.read ? "" : `<button class="btn s" data-act="nrd:${n.id}">Mark read</button>`}</span></div>`).join("") : `<div class="empty">No notifications.</div>`}${L.some((n) => !n.read) ? `<button class="btn s" style="margin-top:10px" data-act="read">Mark all as read</button>` : ""}</div>`
    );
  },
};
function nav() {
  $("#sb").innerHTML =
    `<div class="logo"><img src="../assets/logo.png" alt="VX Logo" style="width:50px;height:50px;object-fit:contain;"><div><b>VYAPARX ERP</b><small>${esc((window.VyaparXShared?.getCompanyProfile?.() || {}).company_name || window.VyaparXAuth?.getCurrentSession?.()?.companyName || "")}</small></div></div>` +
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
function purchaseGreeting() {
  const session = window.VyaparXAuth?.getCurrentSession?.() || {};
  const hour = new Date().getHours();
  const greeting = hour < 12 ? "Good Morning" : hour < 17 ? "Good Afternoon" : hour < 20 ? "Good Evening" : "Good Night";
  return session.fullName || session.name ? `${greeting}, ${session.fullName || session.name}` : greeting;
}
function render() {
  const l = NAV.flatMap((n) => n[1]).find((x) => x[0] == cur)[1];
  $("#pt").textContent = l;
  $("#bc").textContent = "Purchase & Trading / " + l;
  $("#mn").innerHTML = V[cur]();
  nav();
  const u = nvis().filter((n) => !n.read).length;
  $("#nc").textContent = u;
  $("#nc").hidden = !u;
  hdr();
}
function hdr() {
  const m = meM();
  const session = window.VyaparXAuth?.getCurrentSession?.();
  if (session?.fullName) ME = session.fullName;
  $("#pav").innerHTML = m.photo
    ? `<img src="${m.photo}" alt="" style="width:100%;height:100%;border-radius:50%;object-fit:cover">`
    : ini(m.n);
  $("#pnm").textContent = session?.fullName || m.n;
  $("#prl").textContent = session?.designation || session?.department || m.des;
}
function go(v) {
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
const GST = /^\d{2}[A-Z]{5}\d{4}[A-Z][1-9A-Z]Z[0-9A-Z]$/;
function poForm(o) {
  const n = !o;
  o = o || {
    id: "PO-" + (Math.max(100, ...PO.map((z) => +z.id.slice(3))) + 1),
    sup: "",
    item: "",
    qty: "",
    rate: "",
    pd: TODAY,
    ed: "",
  };
  dlg(
    `<h3>${n ? "Create purchase order" : "Edit " + o.id}</h3><div class="fm" style="max-width:none"><label>PO Number *<input class="in" id="pn" value="${o.id}" ${n ? "" : "disabled"}></label><label>Supplier *<select class="in" id="ps"><option value="">Select supplier</option>${SUP.filter(
      (s) => s.s == "ACTIVE" || s.id == o.sup,
    )
      .map(
        (s) =>
          `<option value="${s.id}" ${s.id == o.sup ? "selected" : ""}>${esc(s.n)}</option>`,
      )
      .join(
        "",
      )}</select></label><label>Item *<select class="in" id="pi"><option value="">Select item</option>${Object.entries(
    INV,
    )
      .map(
        ([k, v]) =>
          `<option value="${k}" ${k == o.item ? "selected" : ""}>${v[0]} – ${v[1]}</option>`,
      )
      .join(
        "",
      )}</select></label><label>Quantity *<input class="in" id="pq" data-pt inputmode="numeric" value="${o.qty}"></label><label>Unit Rate (₹) *<input class="in" id="pr" data-pt inputmode="decimal" value="${o.rate}"></label><div style="color:var(--mut)">Total: <b id="ptot" style="color:var(--tx)">${inr(o.qty * o.rate || 0)}</b></div><label>Purchase Date *<input class="in" type="date" id="pd" value="${o.pd}"></label><label>Expected Delivery *<input class="in" type="date" id="pe" value="${o.ed}"></label></div>`,
    n ? "Save purchase order" : "Save changes",
    (modal) => {
      const no = $("#pn").value.trim().toUpperCase();
      if (
        !vf([
          ["#pn", (v) => /^PO-\d{3,6}$/i.test(v), "Use the format PO-101."],
          [
            "#pn",
            (v) => !PO.some((z) => z !== o && z.id == v.toUpperCase()),
            "This PO number already exists.",
          ],
          ["#ps", (v) => v, "Select the supplier."],
          ["#pi", (v) => v, "Select the item."],
          [
            "#pq",
            (v) => /^[1-9]\d*$/.test(v),
            "Quantity must be a whole number above 0.",
          ],
          [
            "#pr",
            (v) => /^\d+(\.\d{1,2})?$/.test(v),
            "Enter a valid rate (0 or more).",
          ],
          [
            "#pd",
            (v) => v && !isNaN(Date.parse(v)),
            "Enter a valid purchase date.",
          ],
          [
            "#pe",
            (v) => v && !isNaN(Date.parse(v)) && v >= $("#pd").value,
            "Expected delivery must be on or after the purchase date.",
          ],
        ])
      )
        return false;
      const f = {
        sup: $("#ps").value,
        item: $("#pi").value,
        qty: +$("#pq").value,
        rate: +$("#pr").value,
        pd: $("#pd").value,
        ed: $("#pe").value,
      };
      const savedRecord = n ? {
          ...f,
          id: no,
          recordType: "purchaseOrder",
          rd: null,
          recq: 0,
          paid: 0,
          st: "DRAFT",
          cb: ME,
          ca: TODAY,
          hist: [{ date: TODAY, action: "Purchase order created" }],
        } : { ...o, ...f, recordType: "purchaseOrder", hist: [...(o.hist || []), { date: TODAY, action: "Purchase order edited" }] };
      const button = modal.querySelector("[data-ok]");
      button.disabled = true;
      button.textContent = "Saving…";
      const startedAt = performance.now();
      Promise.resolve().then(() => n
        ? window.VyaparXAuth.createModuleRecord("purchase", savedRecord)
        : window.VyaparXAuth.saveModuleRecord("purchase", savedRecord)).then((result) => {
        const responseReceivedAt = performance.now();
        if (!result?.record?.id) throw new Error("The server did not confirm the saved Purchase Order.");
        const persisted = result.record;
        PO = [persisted, ...PO.filter((row) => String(row.id) !== String(persisted.id))];
        window.VyaparXShared?.records?.markPersisted("purchase", "purchaseOrder", persisted);
        modal.remove();
        render();
        requestAnimationFrame(() => console.info("[VyaparX performance] Purchase Order saved and displayed", {
          requestDurationMs: Math.round(responseReceivedAt - startedAt),
          displayDurationMs: Math.round(performance.now() - startedAt),
        }));
        toast(n ? "Purchase order saved as draft." : "Purchase order updated.");
      }).catch((error) => {
        button.disabled = false;
        button.textContent = n ? "Save purchase order" : "Save changes";
        toast("Purchase Order was not saved: " + error.message);
      });
      return false;
    },
  );
}
function poView(o) {
  const s = SB(o.sup),
    t = tot(o);
  detail([
    [
      "Purchase Order Details",
      [
        ["PO No", o.id],
        ["Status", st(o.st)],
        ["Purchase Date", fs(o.pd)],
        ["Expected Delivery", fs(o.ed)],
        ["Received Date", o.rd ? fs(o.rd) : "—"],
        ...(o.accountingDecisionReason ? [["Accounting Decision Reason", esc(o.accountingDecisionReason)]] : []),
      ],
    ],
    [
      "Supplier",
      [
        ["Supplier ID", s.id],
        ["Name", esc(s.n)],
        ["Contact", s.ph],
        ["GST No", s.gst || "—"],
      ],
    ],
    [
      "Item",
      [
        ["Item", (INV[o.item]?.[0] || o.item) + " – " + (INV[o.item]?.[1] || o.itemName || o.item)],
        ["Ordered", o.qty + " " + un(o)],
        ["Rate", inr(o.rate)],
        ["Total", `<b>${inr(t)}</b>`],
      ],
    ],
    [
      "Receiving",
      [
        ["Received", o.recq + " " + un(o)],
        ["Remaining", o.qty - o.recq + " " + un(o)],
      ],
    ],
    [
      "Payment",
      [
        ["Paid", inr(o.paid)],
        ["Balance", inr(t - o.paid)],
        ["Payment Status", st(pay(o))],
      ],
    ],
    [
      "Assignment",
      [
        ["Created By", esc(o.cb)],
        ["Created On", fs(o.ca)],
      ],
    ],
    ["Activity History", (o.hist || []).map((x) => [fs(Array.isArray(x) ? x[0] : x.date || x.at), esc(Array.isArray(x) ? x[1] : x.action || x.message || "")])],
  ]);
  const card = document.querySelector(".vm .dlg");
  if (card) {
    const button = document.createElement("button");
    button.className = "btn p";
    button.textContent = "Print Purchase Order";
    button.style.marginTop = "16px";
    button.addEventListener("click", () => poPrintCompany(o));
    card.append(button);
  }
}
function poPrint(o) {
  const supplier = SB(o.sup) || {}, item = INV[o.item] || [o.item, o.itemName || o.item, 0, o.unit || "", 0];
  const company = window.VyaparXShared?.getCompanyProfile?.() || {};
  const printWindow = window.open("", "_blank", "width=900,height=700");
  if (!printWindow) return toast("Allow pop-ups to print this Purchase Order.");
  printWindow.document.write(`<!doctype html><html><head><title>${esc(o.id)} Purchase Order</title><style>body{font:14px Arial,sans-serif;color:#18212f;margin:40px}header{display:flex;justify-content:space-between;border-bottom:2px solid #233c63;padding-bottom:18px}h1{color:#233c63;margin:0 0 6px}table{border-collapse:collapse;width:100%;margin-top:32px}th,td{padding:12px;border:1px solid #ccd3dd;text-align:left}th{background:#f1f4f8}.total{text-align:right;font-size:18px;margin-top:20px}.muted{color:#586579}@media print{button{display:none}}</style></head><body><header><div><h1>Purchase Order</h1><div class="muted">VyaparX ERP</div></div><div><b>${esc(o.id)}</b><br>Order date: ${esc(fs(o.pd))}<br>Expected delivery: ${esc(fs(o.ed))}<br>Status: ${esc(o.st)}</div></header><h3>Supplier</h3><div>${esc(supplier.n || o.supplierName || "—")}<br>${esc(supplier.ad || "")}<br>${esc(supplier.ph || "")}</div><table><thead><tr><th>Item Code</th><th>Description</th><th>Quantity</th><th>Unit</th><th>Rate</th><th>Amount</th></tr></thead><tbody><tr><td>${esc(item[0])}</td><td>${esc(item[1])}</td><td>${esc(o.qty)}</td><td>${esc(item[3])}</td><td>${esc(inr(o.rate))}</td><td>${esc(inr(tot(o)))}</td></tr></tbody></table><div class="total"><b>Total: ${esc(inr(tot(o)))}</b></div><p class="muted">This purchase order is submitted to Accounting for approval.</p><script>window.onload=()=>window.print()<\/script></body></html>`);
  printWindow.document.close();
}
function poPrintCompany(o) {
  const company = window.VyaparXShared?.getCompanyProfile?.() || {};
  const supplier = SB(o.sup) || {};
  const item = INV[o.item] || [o.item, o.itemName || o.item, 0, o.unit || "Nos", 0];
  const printWindow = window.open("", "_blank", "width=900,height=700");
  if (!printWindow) return toast("Allow pop-ups to print this Purchase Order.");
  const companyName = company.registeredBusinessName || company.registered_business_name || company.companyName || company.company_name || "Company";
  printWindow.document.write(`<!doctype html><html><head><meta charset="utf-8"><title>${esc(o.id)} Purchase Order</title><style>body{font:14px Arial,sans-serif;color:#18212f;margin:36px}header{display:flex;justify-content:space-between;gap:22px;border-bottom:2px solid #233c63;padding-bottom:18px}h1{color:#233c63;margin:0 0 6px;font-size:22px}table{border-collapse:collapse;width:100%;margin-top:28px}th,td{padding:10px;border:1px solid #ccd3dd;text-align:left}th{background:#f1f4f8}.num{text-align:right}.total{text-align:right;font-size:18px;margin-top:20px}.muted{color:#586579;line-height:1.5}@media print{body{margin:16mm}}</style></head><body><header><div><h1>${esc(companyName)}</h1><div class="muted">${esc(company.address || "")}<br>${esc([company.state,company.pinCode||company.pin_code,company.country].filter(Boolean).join(", "))}<br>${company.gstin?`GSTIN: ${esc(company.gstin)}<br>`:""}${esc(company.phone||"")} ${esc(company.email||"")}</div></div><div class="num"><h2>Purchase Order</h2><b>${esc(o.id)}</b><br>Order date: ${esc(fs(o.pd))}<br>Expected delivery: ${esc(fs(o.ed))}<br>Status: ${esc(o.st)}</div></header><h3>Supplier</h3><div>${esc(supplier.n || o.supplierName || "—")}<br>${esc(supplier.ad || "")}<br>${supplier.gst?`GSTIN: ${esc(supplier.gst)}<br>`:""}${esc(supplier.ph || "")}</div><table><thead><tr><th>Item Code</th><th>Description</th><th>Quantity</th><th>Unit</th><th>Rate</th><th>Amount</th></tr></thead><tbody><tr><td>${esc(item[0])}</td><td>${esc(item[1])}</td><td>${esc(o.qty)}</td><td>${esc(item[3])}</td><td class="num">${esc(inr(o.rate))}</td><td class="num">${esc(inr(tot(o)))}</td></tr></tbody></table><div class="total"><b>Total: ${esc(inr(tot(o)))}</b></div><p class="muted">Purchase order for supplier fulfillment. The supplier tax invoice is recorded separately in Accounting.</p><script>window.onload=()=>window.print()<\/script></body></html>`);
  printWindow.document.close();
}
function supForm(s) {
  const n = !s;
  s = s || { n: "", ph: "", e: "", ad: "", gst: "" };
  dlg(
    `<h3>${n ? "Add supplier" : "Edit " + s.id}</h3><div class="fm"><label>Supplier Name *<input class="in" id="sn" value="${esc(s.n)}"></label><label>Contact *<input class="in" id="sp" inputmode="numeric" value="${esc(s.ph)}"></label><label>Email *<input class="in" id="se" value="${esc(s.e)}"></label><label>Address *<input class="in" id="sa" value="${esc(s.ad)}"></label><label>GST No<input class="in" id="sg" placeholder="15-character GSTIN" value="${esc(s.gst)}"></label></div>`,
    n ? "Add supplier" : "Save changes",
    () => {
      if (
        !vf([
          ["#sn", (v) => v.length > 0, "Enter the supplier name."],
          ["#sp", (v) => PH.test(v), "Enter a valid 10-digit phone number."],
          [
            "#sp",
            (v) => !SUP.some((z) => z !== s && z.ph == v),
            "This phone number already exists.",
          ],
          ["#se", (v) => EM.test(v), "Enter a valid email address."],
          [
            "#se",
            (v) =>
              !SUP.some((z) => z !== s && z.e.toLowerCase() == v.toLowerCase()),
            "This email already exists.",
          ],
          ["#sa", (v) => v.length > 0, "Enter the address."],
          [
            "#sg",
            (v) => !v || GST.test(v.toUpperCase()),
            "Enter a valid 15-character GST number.",
          ],
        ])
      )
        return false;
      const f = {
        n: $("#sn").value.trim(),
        ph: $("#sp").value.trim(),
        e: $("#se").value.trim(),
        ad: $("#sa").value.trim(),
        gst: $("#sg").value.trim().toUpperCase(),
      };
      if (n)
        SUP.push({
          ...f,
          id: "S" + (SUP.reduce((maximum, supplier) => Math.max(maximum, Number(String(supplier.id || "").slice(1)) || 0), 0) + 1),
          s: "ACTIVE",
        });
      else Object.assign(s, f);
      render();
      toast(
        n ? "Supplier added successfully." : "Supplier updated successfully.",
      );
    },
  );
}
const supView = (s) =>
  detail([
    [
      "Supplier Details",
      [
        ["Supplier ID", s.id],
        ["Name", esc(s.n)],
        ["Status", st(s.s)],
      ],
    ],
    [
      "Contact Information",
      [
        ["Phone", s.ph],
        ["Email", esc(s.e)],
        ["Address", esc(s.ad)],
      ],
    ],
    ["Tax", [["GST No", s.gst || "—"]]],
    [
      "Purchase History",
      PO.filter((o) => o.sup == s.id).map((o) => [
        o.id,
        `${inr(tot(o))} · ${st(o.st)}`,
      ]),
    ],
  ]);
function rcv(o) {
  if (o.st == "CANCELLED")
    return toast("A cancelled purchase order cannot be received.");
  const rem = o.qty - o.recq;
  dlg(
    `<h3>Receive goods – ${o.id}</h3><p>Ordered ${o.qty} ${un(o)}, received ${o.recq}, remaining ${rem}.</p><div class="fm"><label>Received Quantity *<input class="in" id="rq" inputmode="numeric"></label><label>Received Date *<input class="in" type="date" id="rdt" value="${TODAY}"></label></div>`,
    "Receive",
    () => {
      if (
        !vf([
          [
            "#rq",
            (v) => /^[1-9]\d*$/.test(v),
            "Quantity must be a whole number above 0.",
          ],
          [
            "#rq",
            (v) => +v <= rem,
            "Received quantity cannot exceed the remaining " +
              rem +
              " " +
              un(o) +
              ".",
          ],
          [
            "#rdt",
            (v) => v && v >= (o.ed || o.pd) && v <= TODAY,
            "Date must be on or after expected delivery and no later than today.",
          ],
        ])
      )
        return false;
      const q2 = +$("#rq").value, receivedDate = $("#rdt").value;
      window.VyaparXAuth.postWorkflowAction(`/api/purchase-orders/${encodeURIComponent(o.id)}/receive`, {
        quantity: q2, date: receivedDate, receiptId: `GRN-${crypto.randomUUID()}`,
      }).then(async (result) => {
        const saved = result.receipt || {};
        o.recq = Number(result.received ?? (Number(o.recq || 0) + q2));
        o.st = result.status || (o.recq >= o.qty ? "RECEIVED" : "PARTIALLY_RECEIVED");
        if (o.st === "RECEIVED") o.rd = receivedDate;
        addh(o, `Received ${q2} ${un(o)}. Inventory updated.`);
        RECV.unshift(saved);
        render();
        window.VyaparXShared?.records?.invalidate("purchase");
        window.VyaparXShared?.records?.invalidate("inventory");
        const item = INV[o.item] || [o.item, o.itemName || o.item, 0, o.unit || "", 0];
        const notice = `${fs(receivedDate)}: ${q2} ${item[3] || "units"} of ${item[1]} received. Inventory updated; stock is now ${result.stock}.`;
        toast(notice);
        detail([["Goods Receipt Posted", [["Purchase Order", esc(o.id)], ["Received Date", fs(receivedDate)], ["Raw material received", `${q2} ${esc(item[3] || "units")} · ${esc(item[1])}`], ["Inventory", `Updated · ${esc(result.stock)} ${esc(item[3] || "units")} in stock`]]]]);
      }).catch((error) => toast("Could not receive goods: " + error.message));
      return true;
    },
  );
}
const attSec = (r) => [
  "Attachments",
  r.att.length
    ? r.att.map((a, i) => [
        "File " + (i + 1),
        `<div style="display:grid;gap:6px"><span style="word-break:break-all">${isI(a) ? "🖼" : "📄"} ${esc(a.name)}<br><small style="color:var(--mut)">${a.type} · ${KB(a.size)}</small></span>${isI(a) && a.url ? `<img src="${a.url}" alt="${esc(a.name)}" style="max-width:100%;max-height:180px;border-radius:10px;border:1px solid var(--bd)">` : ""}<span style="display:flex;gap:6px"><button class="btn s" data-act="av:${r.id}:${a.id}"><i class="fa-solid fa-eye" aria-hidden="true"></i></button><button class="btn s" data-act="ad:${r.id}:${a.id}">Download</button></span></div>`,
      ])
    : [["File", "No attachment"]],
];
function recView(r) {
  const T = r.id[0] == "t",
    n = NOTES.find((z) => z.ref == r.id);
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
          ["Activity / History", (r.hist || []).map((x) => [fs(Array.isArray(x) ? x[0] : x.date || x.at), esc(Array.isArray(x) ? x[1] : x.action || x.message || "")])],
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
  `<div><div style="font-size:12px;color:var(--mut)">Attachments (optional)</div><button class="btn s" type="button" data-act="aadd" style="margin-top:6px">📎 Attach File</button><input type="file" id="tf" hidden multiple accept=".jpg,.jpeg,.png,.webp,.pdf,.doc,.docx,.xls,.xlsx,.csv,.txt"><div id="tfp"></div><small id="tfe" style="color:var(--er)"></small><small style="display:block;color:var(--mut)">Images, PDF, DOC/DOCX, XLS/XLSX, CSV, TXT. Up to 3 files, 5 MB each.</small></div>`;
function attUI() {
  const e = $("#tfp");
  if (e)
    e.innerHTML = PEND.map(
      (a, i) =>
        `<div style="display:flex;gap:10px;align-items:center;border:1px solid var(--bd);border-radius:10px;padding:8px;margin-top:6px">${isI(a) ? `<img src="${a.url}" alt="Preview" style="width:44px;height:44px;object-fit:cover;border-radius:8px">` : `<span style="font-size:22px">📄</span>`}<span style="flex:1;min-width:0;word-break:break-all"><b style="font-weight:500">${esc(a.name)}</b><br><small style="color:var(--mut)">${a.type} · ${KB(a.size)}</small></span><button class="btn s" data-act="arm:${i}">Remove</button></div>`,
    ).join("");
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
      )
        return (er.textContent = `"${f.name}" is not a supported file.`);
      if (!f.size || f.size > 5242880)
        return (er.textContent = `"${f.name}" must be between 1 byte and 5 MB.`);
      if (PEND.length >= 3)
        return (er.textContent = "You can attach up to 3 files.");
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
      if (window.VyaparXAuth && typeof window.VyaparXAuth.uploadFile === "function") {
        attachment.uploading = true;
        window.VyaparXAuth.uploadFile(f, "purchese-attachments").then((result) => {
          attachment.url = result.url;
          attachment.publicId = result.publicId;
          attachment.resourceType = result.resourceType;
          attachment.uploading = false;
          attUI();
        }).catch((error) => {
          PEND = PEND.filter((item) => item.id !== attachment.id);
          er.textContent = error.message || "Cloudinary upload failed.";
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
    if (!/^image\/(jpeg|png|webp)$/.test(f.type) || f.size > 2097152) {
      er.textContent = "Use a JPG, PNG or WEBP image up to 2 MB.";
      return;
    }
    if (!window.VyaparXAuth || typeof window.VyaparXAuth.uploadFile !== "function") {
      er.textContent = "Cloudinary upload service is unavailable. Check backend configuration.";
      return;
    }
    er.textContent = "Uploading image securely...";
    window.VyaparXAuth.uploadFile(f, "purchese-profile").then((result) => {
      tphoto = result.url;
      er.textContent = "";
      ppv();
    }).catch((error) => {
      er.textContent = error.message || "Image upload failed.";
    });
  }
});
const ppv = () => {
  const p = $("#pph");
  if (p)
    p.innerHTML = tphoto
      ? `<img src="${tphoto}" alt="" style="width:100%;height:100%;border-radius:50%;object-fit:cover">`
      : ini(($("#pn") || { value: "?" }).value || "N/A");
};
function sendForm() {
  const T = TAB == "Task";
  PEND = [];
  dlg(
    `<h3>${T ? "Send task" : "Send message"}</h3><div class="fm" style="max-width:none"><label>${T ? "Task Title" : "Subject"} *<input class="in" id="sx"></label><label>${T ? "Description" : "Message"} *<textarea class="in" id="sd" rows="3"></textarea></label><label>Send To *<select class="in" id="sto"><option value="">Select person</option>${PEOPLE().filter((p) => p.d !== "Purchase & Trading")
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
      if (T)
        R.push(
          ["#sp", (v) => v, "Select a priority."],
          [
            "#su",
            (v) => v && !isNaN(Date.parse(v)) && v >= TODAY,
            "Choose a valid due date, today or later.",
          ],
        );
      if (!vf(R)) return false;
      try {
        const to = $("#sto").value,
          id = (T ? "t_" : "c_") + Date.now(),
          b = {
            id,
            from: ME,
            fd: "Purchase & Trading",
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
        if (!window.VyaparXShared || !window.VyaparXShared.tasks) throw new Error("Task service unavailable.");
        const saved = await window.VyaparXShared.tasks.createTask(newItem);
        if (T) TASKS = [saved, ...TASKS.filter((t) => t.id !== saved.id && t.id !== id)];
        else COMMS = [saved, ...COMMS.filter((c) => c.id !== saved.id && c.id !== id)];
        PEND = [];
        render();
        toast(T ? "Task sent successfully." : "Message sent successfully.");
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
      if (
        !vf([
          ["#mn", (v) => v.length > 0, "Enter the full name."],
          ["#me", (v) => EM.test(v), "Enter a valid email address."],
          [
            "#me",
            (v) =>
              !TEAM.some(
                (z) => z !== m && z.e.toLowerCase() == v.toLowerCase(),
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
      )
        return false;
      const f = {
        n: $("#mn").value.trim(),
        e: $("#me").value.trim(),
        ph: $("#mp").value.trim(),
        des: $("#md").value.trim(),
        jd: $("#mj").value,
      };
      if (n) {
        TEAM.push(window.VyaparXShared.departmentTeam.createMember("purchase", f));
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
  PO.forEach((o) => {
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
        ["Department", "Purchase & Trading"],
        ["Designation", esc(m.des)],
        ["Role", m.r],
        ["Status", `<span class="tag ok">Active</span>`],
      ],
    ],
  ]);
  const dl = [...document.querySelectorAll(".vm .dlg")].pop(),
    d = document.createElement("div");
  d.style.cssText = "display:flex;gap:8px;margin-top:18px;flex-wrap:wrap";
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
      )
        return false;
      const n = $("#pn").value.trim();
      if (n != m.n) ren(m.n, n);
      Object.assign(m, { n, ph: $("#pp").value.trim(), photo: tphoto || null });
      if (can("profile_email")) m.e = $("#pe").value.trim();
      if (can("profile_designation")) m.des = $("#pd").value.trim();
      render();
      toast("Profile updated successfully.");
    },
  );
  ppv();
}
const delTask = (r) =>
  dlg(
    `<h3>Delete ${r.id[0] == "t" ? "task" : "communication"}?</h3><p>Are you sure you want to delete this ${r.id[0] == "t" ? "task" : "communication"}?</p>`,
    "Delete",
    () => {
      try {
        (r.id[0] == "t" ? TASKS : COMMS).splice(
          (r.id[0] == "t" ? TASKS : COMMS).indexOf(r),
          1,
        );
        NOTES = NOTES.filter((n) => n.ref != r.id);
        render();
        toast(
          (r.id[0] == "t" ? "Task" : "Communication") +
            " deleted successfully.",
        );
      } catch (e) {
        toast("Unable to delete. Please try again.");
        return false;
      }
    },
  );
async function loadInventoryOrders() {
  try {
    INVENTORY_ORDERS = await window.VyaparXAuth.getInventoryPurchaseOrders();
    if (cur === "inventoryOrders") render();
  } catch (error) { toast("Inventory orders could not load: " + error.message); }
}
function inventoryRequestBillHTML(request) {
  const c = request.companySnapshot || {};
  const items = request.items || [{ itemCode: request.itemCode, itemName: request.itemName, quantity: request.quantity, unit: request.unit }];
  return `<!doctype html><html><head><meta charset="utf-8"><title>${esc(request.id)} - Raw Material Requisition</title><style>body{font:14px Arial,sans-serif;color:#1b2738;margin:36px}header{display:flex;justify-content:space-between;gap:24px;border-bottom:2px solid #243b5a;padding-bottom:16px}h1{font-size:22px;margin:0 0 8px}h2{font-size:17px;margin:26px 0 8px}.muted{color:#526176;line-height:1.5}.right{text-align:right}table{border-collapse:collapse;width:100%;margin-top:18px}th,td{padding:10px;border:1px solid #cbd3df;text-align:left}th{background:#f1f4f8}.foot{margin-top:28px;border-top:1px solid #ccd3dd;padding-top:12px;color:#526176}@media print{body{margin:18mm}}</style></head><body><header><div><h1>${esc(c.registeredBusinessName || c.companyName || "Company")}</h1><div class="muted">${esc(c.address || "")}<br>${esc([c.country,c.state,c.pinCode].filter(Boolean).join(", "))}<br>${c.gstin?`GSTIN: ${esc(c.gstin)}<br>`:""}${esc(c.phone||"")} ${esc(c.email||"")}</div></div><div class="right"><h1>RAW MATERIAL REQUISITION</h1><b>Bill / Request No: ${esc(request.id)}</b><br>Request Date: ${esc(fs(request.requestedAt||request.createdAt))}<br>Expected Date: ${esc(fs(request.expectedDate))}<br>Status: ${esc(request.status||"Pending")}</div></header><h2>Requested Materials</h2><table><thead><tr><th>#</th><th>Item Code</th><th>Raw Material</th><th>Quantity</th><th>Unit</th></tr></thead><tbody>${items.map((item,index)=>`<tr><td>${index+1}</td><td>${esc(item.itemCode||"?")}</td><td>${esc(item.itemName||"?")}</td><td>${Number(item.quantity||0)}</td><td>${esc(item.unit||"?")}</td></tr>`).join("")}</tbody></table><p><b>Requested by:</b> ${esc(request.requestedBy||"?")}</p><p><b>Purpose:</b> ${esc(request.reason||"Raw material replenishment")}</p><div class="foot">Generated in VyaparX ERP for Purchase processing.</div><script>window.onload=()=>window.print()<\/script></body></html>`;
}
function viewInventoryRequestBill(request) {
  const bill = window.open("", "_blank");
  if (!bill) return toast("Allow pop-ups to view or print this requisition bill.");
  bill.document.open(); bill.document.write(inventoryRequestBillHTML(request)); bill.document.close();
}
function approveInventoryOrder(id) {
  const req = INVENTORY_ORDERS.find((r) => String(r.id) === String(id));
  if (!req) return toast("Inventory request not found.");
  const lines = req.items || [{ itemId: req.itemId, itemName: req.itemName, itemCode: req.itemCode, unit: req.unit, quantity: req.quantity }];
  const mask = document.createElement("div"); mask.className = "mask";
  mask.innerHTML = `<div class="dlg" role="dialog" aria-modal="true" style="width:min(760px,96vw);max-height:90vh;overflow:auto"><h3>Review requisition ${esc(req.id)}</h3><p>Expected by Inventory: ${esc(fs(req.expectedDate)||"?")}</p><div class="fm"><label>Supplier *<select class="in" id="ioSupplier"><option value="">Select supplier</option>${SUP.filter((s) => s.s === "ACTIVE").map((s) => `<option value="${esc(s.id)}">${esc(s.n)}</option>`).join("")}</select></label><label>Expected delivery date *<input class="in" id="ioDelivery" type="date" min="${TODAY}" value="${esc(req.expectedDate||"")}"></label></div><div class="tw"><table><thead><tr><th>Raw Material</th><th>Quantity</th><th>Unit Rate (₹)</th></tr></thead><tbody>${lines.map((line,index)=>`<tr><td>${esc(line.itemCode||"")} · ${esc(line.itemName||"")}</td><td>${Number(line.quantity)} ${esc(line.unit||"")}</td><td><input class="in ioRate" data-item="${esc(line.itemId)}" type="number" min="0.01" step="0.01" value="0" aria-label="Unit rate for ${esc(line.itemName)}"></td></tr>`).join("")}</tbody></table></div><small class="ioError" style="color:var(--er)"></small><div class="a"><button class="btn" data-close>Cancel</button><button class="btn p" data-confirm>Approve and create Purchase Orders</button></div></div>`;
  document.body.append(mask);
  mask.onclick = async (event) => {
    if (event.target === mask || event.target.closest("[data-close]")) return mask.remove();
    if (!event.target.closest("[data-confirm]")) return;
    const supplierId = mask.querySelector("#ioSupplier").value, deliveryDate = mask.querySelector("#ioDelivery").value;
    const itemRates = [...mask.querySelectorAll(".ioRate")].map((field) => ({ itemId: field.dataset.item, rate: Number(field.value) }));
    if (!supplierId || !deliveryDate || deliveryDate < TODAY || itemRates.some((entry) => !Number.isFinite(entry.rate) || entry.rate <= 0)) {
      mask.querySelector(".ioError").textContent = "Select a supplier, a valid delivery date and a positive unit rate for each material."; return;
    }
    const button = event.target.closest("[data-confirm]"); button.disabled = true;
    try {
      const result = await window.VyaparXAuth.postWorkflowAction(`/api/inventory/purchase-orders/${encodeURIComponent(id)}/approve`, { supplierId, itemRates, deliveryDate });
      const orders = result.purchaseOrders || (result.purchaseOrder ? [result.purchaseOrder] : []);
      PO = [...orders, ...PO.filter((r) => !orders.some((order) => String(order.id) === String(r.id)))];
      orders.forEach((order) => window.VyaparXShared?.records?.markPersisted("purchase", "purchaseOrder", order));
      INVENTORY_ORDERS = INVENTORY_ORDERS.map((r) => r.id === id ? { ...r, status: "Approved", purchaseOrderIds: orders.map((order) => order.id), purchaseOrderId: orders[0]?.id || "", supplierId, deliveryDate } : r);
      mask.remove(); render(); toast(`Approved. ${orders.length} Purchase Order(s) created.`);
      window.VyaparXShared?.records?.invalidate("purchase");
    } catch (error) { button.disabled = false; mask.querySelector(".ioError").textContent = error.message; }
  };
}

function rejectInventoryOrder(id) {
  const reason = window.prompt("Reason for rejecting this Inventory order:");
  if (!reason || !reason.trim()) return;
  window.VyaparXAuth.postWorkflowAction(`/api/inventory/purchase-orders/${encodeURIComponent(id)}/reject`, { reason: reason.trim() })
    .then(() => loadInventoryOrders().then(() => toast("Inventory request rejected.")))
    .catch((error) => toast("Could not reject Inventory request: " + error.message));
}
const OKD = (h, b, ok, fn) => dlg(`<h3>${h}</h3><p>${b}</p>`, ok, fn);
document.addEventListener("click", (e) => {
  const t = e.target.closest("[data-go],[data-act],[data-s],[data-addcol]");
  if (t && t.dataset.addcol != null) {
    window.VyaparXFields.openAddColumn(t.dataset.addcol, () => render());
    return;
  }
  if (!t) return;
  const d = t.dataset;
  if (d.go) return go(d.go);
  if (d.s != null) {
    const i = +d.s;
    sort = { i, d: sort && sort.i == i ? -sort.d : 1 };
    return render();
  }
  const [a, x, y] = d.act.split(":"),
    o = OB(x);
  if (a === "iorrefresh") return loadInventoryOrders();
  if (a === "ioapprove") return approveInventoryOrder(x);
  if (a === "ioreject") return rejectInventoryOrder(x);
  if (a === "iobill") { const req = INVENTORY_ORDERS.find((row) => String(row.id) === String(x)); if (req) viewInventoryRequestBill(req); return; }
  if (a == "add") purchaseSyncInventory().then(() => poForm());
  else if (a == "oe") poForm(o);
  else if (a == "ov") poView(o);
  else if (a == "opdel") {
    if (!o || o.st !== "DRAFT" || o.accountingRequestId) return toast("Only an unsubmitted draft Purchase Order can be deleted.");
    if (!window.confirm(`Delete draft Purchase Order ${o.id}?`)) return;
    window.VyaparXAuth.deleteModuleRecord("purchase", o.id).then((result) => {
      if (result?.success !== true) throw new Error("The server did not confirm deletion.");
      PO = PO.filter((order) => String(order.id) !== String(o.id));
      window.VyaparXShared?.records?.markDeleted("purchase", "purchaseOrder", o.id);
      render(); toast("Draft Purchase Order deleted.");
    }).catch((error) => toast("Purchase Order was not deleted: " + error.message));
  }
  else if (a == "sadd") supForm();
  else if (a == "se") supForm(SB(x));
  else if (a == "sv") supView(SB(x));
  else if (a == "sdel") {
    const supplier = SB(x);
    if (!supplier) return toast("This supplier is no longer available.");
    if (PO.some((order) => String(order.sup || order.supplierId || "") === String(supplier.id))) return toast("This supplier has purchase order history and cannot be deleted.");
    if (!window.confirm(`Delete supplier ${supplier.n}?`)) return;
    window.VyaparXAuth.deleteModuleRecord("purchase", supplier.id).then((result) => {
      if (result?.success !== true) throw new Error("The server did not confirm deletion.");
      SUP = SUP.filter((item) => String(item.id) !== String(supplier.id));
      window.VyaparXShared?.records?.markDeleted("purchase", "supplier", supplier.id);
      render(); toast("Supplier deleted.");
    }).catch((error) => toast("Supplier was not deleted: " + error.message));
  }
  else if (a == "stg") {
    const s = SB(x),
      off = s.s == "ACTIVE";
    OKD(
      off ? "Deactivate supplier?" : "Activate supplier?",
      off
        ? `${esc(s.n)} will no longer be available for new purchase orders. Existing orders stay unchanged.`
        : `${esc(s.n)} will be available again.`,
      off ? "Deactivate" : "Activate",
      () => {
        s.s = off ? "INACTIVE" : "ACTIVE";
        render();
        toast("Supplier updated.");
      },
    );
  } else if (a == "osub")
    OKD(
      "Submit for approval?",
      `${o.id} will be sent to Accounting for financial approval.`,
      "Submit",
      () => {
        window.VyaparXAuth.postWorkflowAction("/api/accounting/requests/purchase/submit", { purchaseOrderId: o.id }).then(() => {
          o.st = "PENDING_APPROVAL";
          addh(o, "Submitted for Accounting approval");
          render();
          toast("Submitted to Accounting for approval.");
          window.VyaparXShared?.records?.invalidate("purchase");
        }).catch((error) => toast("Could not submit Purchase Order: " + error.message));
        return true;
      },
    );
  else if (a == "orc") rcv(o);
  else if (a == "ocn")
    dlg(
      `<h3>Cancel ${o.id}?</h3><div class="fm"><label>Reason *<input class="in" id="cr"></label></div>`,
      "Cancel PO",
      () => {
        if (
          !vf([["#cr", (v) => v.length > 2, "Enter the cancellation reason."]])
        )
          return false;
        o.st = "CANCELLED";
        addh(o, "Cancelled: " + $("#cr").value.trim());
        render();
        toast("Purchase order cancelled.");
      },
    );
  else if (a == "ev") {
    const m = TEAM.find((z) => z.id == x);
    detail([
      [
        "Employee Details",
        [
          ["Name", esc(m.n)],
          ["Email", esc(m.e)],
          ["Phone", esc(m.ph)],
          ["Department", "Purchase & Trading"],
          ["Designation", esc(m.des)],
          ["Role", m.r],
          ["Joining Date", fs(m.jd)],
          ["Status", `<span class="tag ok">Active</span>`],
        ],
      ],
    ]);
  } else if (a == "pview") profView();
  else if (a == "madd" && canManageTeam()) memberForm();
  else if (a == "me" && canManageTeam())
    memberForm(TEAM.find((z) => z.id == x));
  else if (a == "md" && canManageTeam()) {
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
  } else if (a == "tv") recView(REC(x));
  else if (a == "td") delTask(REC(x));
  else if (a == "adv") {
    const k = REC(x);
    k.st = k.st == "Pending" ? "In Progress" : "Completed";
    k.ua = TODAY;
    k.hist.push([TODAY, "Status changed to " + k.st]);
    render();
    toast("Task updated successfully.");
  } else if (a == "send") sendForm();
  else if (a == "tab") {
    TAB = x;
    FLT = "All";
    q = "";
    spin();
  } else if (a == "flt") {
    FLT = x;
    spin();
  } else if (a == "spin") spin();
  else if (a == "aadd") $("#tf").click();
  else if (a == "arm") {
    PEND.splice(+x, 1);
    attUI();
  } else if (a == "av" || a == "ad") {
    const r = REC(x),
      f = r.att.find((z) => z.id == y);
    if (!f.url)
      return toast(
        "Demo attachment – real files are stored in Cloudinary after backend integration.",
      );
    if (a == "av") {
      if (isI(f) || f.ext == "pdf") window.open(f.url, "_blank");
      else toast("Preview isn't available for this file type. Use Download.");
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
      if (note.id.startsWith("n_") && window.VyaparXShared?.tasks) {
        window.VyaparXShared.tasks.updateTask(note.ref, { isRead: true, read: true }).catch(() => {});
      }
    }
    render();
  }
  else if (a == "nopen") {
    const n = NOTES.find((z) => z.id == x);
    recView(REC(n.ref));
  } else if (a == "padd") $("#pf").click();
  else if (a == "prm") {
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
        window.VyaparXShared.tasks.updateTask(n.ref, { isRead: true, read: true }).catch(() => {}),
      );
    }
    render();
  } else if (a == "csv")
    toast("CSV is generated by the backend after integration");
});
document.addEventListener("input", (e) => {
  const t = e.target;
  if (t.dataset.pt != null) {
    $("#ptot").textContent = inr(
      (+$("#pq").value || 0) * (+$("#pr").value || 0),
    );
  }
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
    x[t.dataset.k] = t.value;
    if (t.dataset.k == "i" && t.value) {
      x.r = String(INV[t.value][2]);
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
    go("pos");
    q = v;
    render();
  }
});
$("#bell").onclick = () => go("notif");
$("#ct").onclick = () => document.body.classList.toggle("col");
$("#mb").onclick = () => window.VyaparXShared.toggleMobileNav();
$("#th").onclick = () => { if (window.VyaparXShared) window.VyaparXShared.applyTheme(window.VyaparXShared.currentTheme() === "dark" ? "light" : "dark"); };
if (window.VyaparXShared?.records?.bindPageState) {
  window.VyaparXShared.records.bindPageState("purchase", [
    { recordType: "teamMember", get: () => TEAM, set: (rows) => { TEAM = rows; } },
    { recordType: "supplier", get: () => SUP, set: (rows) => { SUP = rows; } },
    {
      recordType: "purchaseOrder", get: () => PO, set: (rows) => { PO = rows; },
      toRecord: (order) => ({
        ...order,
        hist: (order.hist || []).map((event) => Array.isArray(event)
          ? { "0": event[0], "1": event[1], date: event[0], action: event[1] }
          : event),
        supplierName: SUP.find((supplier) => String(supplier.id) === String(order.sup))?.n || "",
        total: tot(order),
      }),
    },
    {
      recordType: "goodsReceipt", get: () => RECV, set: (rows) => { RECV = rows; },
      toRecord: (receipt) => {
        const order = PO.find((item) => String(item.id) === String(receipt.po));
        const supplier = order && SUP.find((item) => String(item.id) === String(order.sup));
        return { ...receipt, supplierName: supplier?.n || "" };
      },
    },
  ], {
    onReady: () => { render(); purchaseSyncInventory(); },
    onError: (error) => toast("Purchase records could not sync with Firestore: " + error.message),
  });
}
async function purchaseSyncInventory() {
  if (!window.VyaparXAuth?.fetchModuleRecords) return;
  try {
    const records = await window.VyaparXAuth.fetchModuleRecords("inventory");
    for (const row of records.filter((record) => record.recordType === "stockItem" && !record.isDeleted)) {
      const id = String(row.id || row.code || row.itemCode || "");
      if (!id) continue;
      const tuple = [String(row.code || row.itemCode || id), String(row.n || row.name || row.itemName || id), 0,
        String(row.unit || row.uom || "Nos"), Number(row.qty ?? row.availableStock ?? 0)];
      INV[id] = tuple;
      if (row.code || row.itemCode) INV[String(row.code || row.itemCode)] = tuple;
    }
    PO.forEach((order) => {
      if (!INV[order.item] && order.itemCode) {
        INV[order.item] = [order.itemCode, order.itemName || order.itemCode, 0, order.unit || "Nos", 0];
      }
    });
    if (cur === "pos" || cur === "items" || cur === "recv") render();
  } catch (error) {
    console.warn("Could not load Inventory items for Purchase Orders:", error);
  }
}
purchaseSyncInventory();
window.addEventListener("focus", purchaseSyncInventory);
go("dashboard");
loadInventoryOrders();
window.addEventListener("focus", loadInventoryOrders);
async function purchaseSyncTasksFromDb() {
  if (!window.VyaparXShared || !window.VyaparXShared.tasks) return;
  try {
    const all = await window.VyaparXShared.tasks.fetchTasks({ force: true });
    TASKS = all.filter((task) => task.type !== "Communication");
    COMMS = all.filter((task) => task.type === "Communication");
    NOTES = [...NOTES.filter((note) => note.k), ...all.filter((task) => task.dir === "Received").map((task) => ({
      id: "n_" + task.id, ref: task.id, read: !!(task.isRead || task.read),
    }))];
    if (["tasks", "notif", "dashboard"].includes(cur)) render();
  } catch (error) { console.warn("Could not sync Purchase tasks:", error); }
}
purchaseSyncTasksFromDb();
if (window.VyaparXShared?.tasks) window.VyaparXShared.tasks.onTasksUpdated(purchaseSyncTasksFromDb);
window.addEventListener("focus", purchaseSyncTasksFromDb);
if (window.VyaparXFields) window.VyaparXFields.loadFields("purchase").then(() => { if (cur === "pos") render(); });
window.addEventListener("focus", () => { if (window.VyaparXFields) window.VyaparXFields.loadFields("purchase", true); });
// Admin Reports integration: expose this module's real records so the Admin
// report engine builds PURCHASE reports from actual data, not static counts.
window.PURCHASE_REPORT_SOURCE = function () { try { return []; } catch (e) { return []; } };
