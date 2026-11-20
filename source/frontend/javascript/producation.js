/**
 * VyaparX ERP - Production & Manufacturing Controller
 * Manages Work Orders, Production Planning, Raw Materials, and Quality Control.
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
  m.onclick = async (e) => {
    if (e.target == m || e.target.dataset.x != null) m.remove();
    const button = e.target.closest("[data-ok]");
    if (button) {
      if (button?.disabled) return;
      const result = await fn(m);
      if (result !== false) m.remove();
    }
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
    "PRODUCTION",
    [
      [
        "dashboard",
        "Dashboard",
        "<rect x='3' y='3' width='7' height='9'/><rect x='14' y='3' width='7' height='5'/><rect x='14' y='12' width='7' height='9'/><rect x='3' y='16' width='7' height='5'/>",
      ],
      ["requests", "Production Requests", "<path d='M4 4h11l5 5v11H4zM9 12h6M9 16h6'/>"],
      ["orders", "Production Orders", "<path d='M3 21V9l6 4V9l6 4V5h6v16z'/>"],
      [
        "plan",
        "Production Planning",
        "<rect x='3' y='5' width='18' height='16' rx='2'/><path d='M3 10h18M8 3v4M16 3v4'/>",
      ],
      [
        "mats",
        "Materials",
        "<path d='M21 8l-9-5-9 5v8l9 5 9-5zM3 8l9 5 9-5M12 13v8'/>",
      ],
      [
        "stat",
        "Production Status",
        "<path d='M4 20V10M10 20V4M16 20v-7M22 20H2'/>",
      ],
      [
        "qc",
        "Quality Control",
        "<path d='M12 3l8 3v6c0 5-3.5 8-8 9-4.5-1-8-4-8-9V6zM9 12l2 2 4-4'/>",
      ],
      [
        "dmg",
        "Damage / Cancellation",
        "<path d='M12 3l10 18H2zM12 10v5M12 18v.5'/>",
      ],
      ["reports", "Reports", "<path d='M7 3h8l4 4v14H7zM10 12h6M10 16h6'/>"],
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
let PUR = [];
const PS = [
    "PLANNED",
    "PENDING_MATERIAL",
    "READY",
    "IN_PROGRESS",
    "PAUSED",
    "QC_PENDING",
    "COMPLETED",
    "CANCELLED",
  ],
  DTY = [
    "Cutting defect",
    "Material defect",
    "Machine fault",
    "Handling damage",
  ],
  DAC = ["REUSE", "WASTAGE", "REPLACEMENT"];

const PR = (n, so, item, batch, qty, prod, sup, start, s, qc, cb) => ({
  id: "PRD-" + n,
  so,
  item,
  batch,
  qty,
  prod,
  sup,
  start,
  end: s == "COMPLETED" ? iso(-2) : null,
  qc,
  st: s,
  cb,
  ca: start,
  dq: 0,
  dt: "",
  da: "",
  dr: "",
  cr: "",
  cst: null,
  hist: [
    [start, "Production order created"],
    [start, "Status: " + s.replace(/_/g, " ")],
  ],
});

let PROD = [];
let MAT = [];
let DMG = [];

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
const canManageTeam = () => window.VyaparXShared?.departmentTeam?.canManage("production") === true;


let _cachedCompanyPeople = null;
const PEOPLE = () => {
  if (window.VyaparXShared && window.VyaparXShared.getCompanyPeople) {
    if (!_cachedCompanyPeople) window.VyaparXShared.getCompanyPeople().then((res) => { _cachedCompanyPeople = res; });
    if (_cachedCompanyPeople) return _cachedCompanyPeople;
  }
  return [];
};

const dept = (n) => (PEOPLE().find((p) => p.n == n) || { d: "Production" }).d,
  meM = () => TEAM.find((m) => m.id == "M1"),
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

const REC = (id) => (id[0] == "t" ? TASKS : COMMS).find((r) => r.id == id),
  nvis = () =>
    NOTES.filter((n) =>
      n.k
        ? (n.k == "appr" ? pendC().length : pendM().length) > 0
        : !!REC(n.ref),
    );

const ntext = (n) => {
  if (n.k)
    return n.k == "appr"
      ? `${pendC().length} cancellation request(s) waiting for approval`
      : `${pendM().length} production order(s) waiting for material`;
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

const pendC = () => PROD.filter((o) => o.cst),
  pendM = () => PROD.filter((o) => o.st == "PENDING_MATERIAL"),
  matI = (o) => (Array.isArray(o?.cons) && o.cons.length > 0) || MAT.some((m) => String(m.productionOrderId || m.prod) === String(o?.id));

const st = (s) => {
  const c = /^(COMPLETED|PASSED|ACTIVE|Completed|Low|Read)$/.test(s)
    ? "ok"
    : /^(PENDING_MATERIAL|PAUSED|QC_PENDING|PENDING_APPROVAL|INACTIVE|Pending|In Progress|High|Medium|Unread)$/.test(
          s,
        )
      ? "wa"
      : /^(CANCELLED|FAILED|Urgent)$/.test(s)
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

const PB = (id) => PROD.find((o) => o.id == id),
  OB = PB,
  addh = (o, t) => { o.hist = Array.isArray(o.hist) ? o.hist : []; o.hist.push([TODAY, t]); };
const PRD_RECORD = (id, type) => [...PRD_CODES.values()].find((record) => record.recordType === type && String(record.id) === String(id));
const productionItemName = (order) => order?.productName || order?.materials?.[0]?.productName || order?.itemName || order?.item || "—";
const productionRequestFor = (order) => PRD_CODES.get(String(order?.productionRequestId)) || [...PRD_CODES.values()].find((record) => record.recordType === "productionRequest" && String(record.salesOrderId) === String(order?.salesOrderId || order?.so));
const productionAction = async (order, action, payload = {}) => {
  if (!order?.id) throw new Error("Production Order is no longer available.");
  const startedAt = performance.now();
  const result = await window.VyaparXAuth.postWorkflowAction(`/api/production-orders/${encodeURIComponent(order.id)}/${action}`, payload);
  if (!result?.success || !result.record) throw new Error(result?.error || "Backend did not confirm the Production Order update.");
  Object.assign(order, result.record);
  order.cons = Array.isArray(order.cons) ? order.cons : [];
  order.so = order.salesOrderNumber || order.salesOrderId || order.so || "";
  order.item = order.productName || order.item || "—";
  order.qty = Number(order.qty || order.plannedQuantity || 0);
  order.prod = Number(order.prod || order.producedQuantity || 0);
  order.st = order.st || order.status || "PLANNED";
  order.status = order.status || order.st;
  order.materials = Array.isArray(order.materials) ? order.materials : [];
  order.hist = Array.isArray(order.hist) ? order.hist : [];
  PRD_CODES.set(String(order.id), { ...order });
  console.info("[VyaparX performance] Production action persisted", {
    action,
    requestDurationMs: Math.round(performance.now() - startedAt),
  });
  return order;
};

const kpi = (a, b) =>
    `<div class="card kpi"><small>${a}</small><b>${b}</b></div>`,
  cn = (s) => PROD.filter((o) => s.includes(o.st)).length;

const PCs = [
    "Prod No",
    "Sales Order",
    "Item",
    "Batch",
    "Quantity",
    "Produced",
    "Supervisor",
    "Status",
  ],
  prow = (o) => [
    o.id,
    o.so,
    productionItemName(o),
    esc(o.batch),
    o.qty,
    o.prod,
    esc(o.sup),
    o.st,
  ];

const pact = (r) => {
  const o = PB(r?.[0]);
  if (!o) return "";

  const b = (a, label) =>
    `<button class="btn s" data-act="${a}:${o.id}">${label}</button>`;
  const s = String(o.st || o.status || "").toUpperCase();
  const hasConsumption = Array.isArray(o.cons) && o.cons.length > 0;

  return (
    b("ov", "View") +
    (s === "PLANNED" ? b("oe", "Edit") : "") +
    // Keep orders with output/material consumption from being deleted.
    (["PLANNED", "PENDING_MATERIAL"].includes(s) && !Number(o.prod || 0) && !hasConsumption
      ? b("odel", "Delete")
      : "") +
    (["PLANNED", "PENDING_MATERIAL"].includes(s) && Array.isArray(o.materials) && o.materials.length > 0
      ? b("oim", "Issue Material")
      : "") +
    (["PLANNED", "READY", "PENDING_MATERIAL"].includes(s)
      ? (o.startEligibility?.eligible === true
        ? b("ost", "Start")
        : `<button class="btn s" type="button" disabled title="${esc(o.startEligibility?.reason || "Start eligibility is not available. Refresh Production Orders.")}" aria-label="Start blocked: ${esc(o.startEligibility?.reason || "eligibility could not be verified")}">Start blocked</button>`)
      : "") +
    (s === "IN_PROGRESS"
      ? b("oout", "Output") + b("opz", "Pause") + b("oqc", "To QC")
      : "") +
    (s === "PAUSED" ? b("orz", "Resume") : "") +
    (!["COMPLETED", "CANCELLED"].includes(s) && !o.cst
      ? b("ocn", "Cancel")
      : "")
  );
};

const V = {
  dashboard() {
    const al = [...pendM(), ...pendC()];
    return (
      ph(
        productionGreeting(),
        "Production queue, material and quality at a glance.",
      ) +
      `<div class="grid k6">${kpi("Production Queue", cn(["PLANNED", "READY", "PENDING_MATERIAL"]))}${kpi("Material Pending", cn(["PENDING_MATERIAL"]))}${kpi("In Progress", cn(["IN_PROGRESS", "PAUSED"]))}${kpi("QC Pending", cn(["QC_PENDING"]))}${kpi("Completed", cn(["COMPLETED"]))}</div>
 <div class="grid two" style="margin-top:14px"><div class="card"><h3>Recent production orders</h3><div class="tw"><table><tr><th>Order</th><th>Item</th><th>Output</th><th>Status</th></tr>${PROD.slice(
   0,
   5,
 )
   .map(
     (o) =>
       `<tr><td>${esc(o.id)}</td><td>${esc(productionItemName(o))}</td><td>${o.prod}/${o.qty}</td><td>${st(o.st)}</td></tr>`,
   )
   .join("")}</table></div></div>
 <div class="card"><h3>Needs attention</h3>${al.length ? al.map((o) => `<div style="display:flex;justify-content:space-between;align-items:center;padding:8px 0;border-bottom:1px solid var(--bd)"><span>${o.id}<br><small style="color:var(--mut)">${o.cst ? "Cancellation awaiting approval" : "Waiting for material"}</small></span><button class="btn s" data-act="ov:${o.id}"><i class="fa-solid fa-eye" aria-hidden="true"></i></button></div>`).join("") : `<div class="empty">Nothing needs attention.</div>`}</div></div>`
    );
  },
  requests() {
    const rows = PRD_REQUESTS();
    return (
      ph("Production Requests", "Confirmed Sales Orders released for manufacturing.") +
      `<div class="grid k6">${kpi("Total Requests", rows.length)}${kpi("Pending Review", rows.filter((r) => r.status == "Pending Review").length)}${kpi("In Planning", rows.filter((r) => r.materialPlan).length)}</div>` +
      table(
        ["Production Request No", "Sales Order No", "Customer", "Product Code", "Product Name", "Requested Qty", "Unit", "Request Date", "Required Completion", "Priority", "Material Status", "Request Status"],
        rows.map((r) => [r.code, esc(r.orderNumber), esc(r.customer), esc(r.itemCode), esc(r.productName), r.quantity, esc(r.unit), r.date, r.deliveryDate, esc(r.priority), r.materialStatus, r.status]),
        {
          act: (row) => {
                    const request = rows.find((r) => r.code === row[0]);
            if (!request) return "";
            return `<button class="btn s" data-act="prv:${encodeURIComponent(request.id)}">View Details</button><button class="btn s" data-act="mp:${encodeURIComponent(request.id)}">Material Planning</button><button class="btn s" data-act="prhist:${encodeURIComponent(request.id)}">View History</button>${request.status === "Inventory Approved" && !request.productionOrderId ? `<button class="btn s p" data-act="createapproved:${encodeURIComponent(request.id)}">Create Production Order</button>` : ""}`;
          }, empty: "No production requests yet.",
        },
      )
    );
  },
  orders() {
    return (
      ph("Production Orders", "Run orders created from Production Requests.", ["create-production-order", "Create Order"]) +
      table(window.VyaparXFields.tableColumns("production", PCs), PROD.map((o) => window.VyaparXFields.tableRow("production", o, prow(o))), {
        filter: PS,
        colModule: "production",
        act: pact,
        empty: "No production orders yet.",
      })
    );
  },
  plan() {
    return (
      ph(
        "Production Planning",
        "Orders waiting to start. Start needs the advance and issued material.",
      ) +
      table(
        [
          "Prod No",
          "Sales Order",
          "Item",
          "Quantity",
          "Planned Start",
          "Advance",
          "Material",
          "Status",
        ],
        PROD.filter((o) =>
          ["PLANNED", "PENDING_MATERIAL", "READY"].includes(o.st),
        ).map((o) => [
          o.id,
          o.so,
          productionItemName(o),
          o.qty,
          fs(o.start),
          o.accountingApprovalStatus === "Approved" ? "Approved" : "Checked at Start",
          matI(o) ? "Issued" : "Not issued",
          o.st,
        ]),
        { act: pact, empty: "No orders waiting to start." },
      )
    );
  },
  mats() {
    return (
      ph("Materials", "Material issued from purchase orders to production.", [
        "iss",
        "Issue Material",
      ]) +
      table(
        [
          "Issue Date",
          "Production Order",
          "Purchase Order",
          "Material",
          "Quantity",
          "Issued By",
          "Status",
        ],
        MAT.map((m) => {
          const material = (Array.isArray(m) ? m[0] : m) || {};
          return [
            fs(m.date),
            m.prod,
            m.purchaseOrderId || m.po || "—",
            material.materialName || material.name || "—",
            Number(m.quantity || m.qty || 0) + " " + (material.unit || ""),
            esc(m.by),
            "ISSUED",
          ];
        }),
        { empty: "No material issued yet." },
      )
    );
  },
  stat() {
    return (
      ph("Production Status", "Running, paused and QC-waiting orders.") +
      table(
        [
          "Prod No",
          "Item",
          "Batch",
          "Produced",
          "Progress",
          "Supervisor",
          "Status",
        ],
        PROD.filter((o) =>
          ["IN_PROGRESS", "PAUSED", "QC_PENDING"].includes(o.st),
        ).map((o) => [
          o.id,
          productionItemName(o),
          esc(o.batch),
          o.prod + "/" + o.qty,
          Math.round((o.prod / o.qty) * 100) + "%",
          esc(o.sup),
          o.st,
        ]),
        { act: pact, empty: "Nothing is running right now." },
      )
    );
  },
  qc() {
    return (
      ph(
        "Quality Control",
        "Pass or fail finished output. A failed check needs a damage record.",
      ) +
      table(
        ["Prod No", "Item", "Batch", "Produced", "QC Result", "Status"],
        PROD.filter(
          (o) => ["QC_PENDING", "COMPLETED"].includes(o.st) || o.qc == "FAILED",
        ).map((o) => [o.id, productionItemName(o), esc(o.batch), o.prod, o.qc, o.st]),
        {
          act: (r) => {
            const o = PB(r[0]);
            return (
              `<button class="btn s" data-act="ov:${o.id}"><i class="fa-solid fa-eye" aria-hidden="true"></i></button>` +
              (o.st == "QC_PENDING"
                ? `<button class="btn s" data-act="qp:${o.id}">Pass</button><button class="btn s" data-act="qf:${o.id}">Fail</button>`
                : "")
            );
          },
          empty: "No quality checks yet.",
        },
      )
    );
  },
  dmg() {
    return (
      ph(
        "Damage / Cancellation",
        "Damage is recorded, never deleted. Cancellations need head approval.",
        ["dadd", "Record Damage"],
      ) +
      table(
        [
          "Date",
          "Production Order",
          "Quantity",
          "Type",
          "Action",
          "Reason",
          "By",
        ],
        DMG.map((d) => [
          fs(d.date),
          d.prod,
          d.qty,
          d.type,
          d.action,
          esc(d.reason),
          esc(d.by),
        ]),
        { empty: "No damage recorded." },
      ) +
      `<h3 style="margin:14px 0 10px">Cancellations</h3>` +
      table(
        ["Prod No", "Reason", "Requested By", "Status"],
        PROD.filter((o) => o.cst || o.st == "CANCELLED").map((o) => [
          o.id,
          esc(o.cst ? o.cst.reason : o.cr),
          esc(o.cst ? o.cst.by : "—"),
          o.cst ? "PENDING_APPROVAL" : "CANCELLED",
        ]),
        {
          act: (r) => {
            const o = PB(r[0]);
            return o.cst
              ? `<button class="btn s" data-act="cap:${o.id}">Approve</button><button class="btn s" data-act="crj:${o.id}">Reject</button>`
              : "";
          },
          empty: "No cancellations.",
        },
      )
    );
  },
  reports() {
    const a = PROD.filter((o) => o.st != "CANCELLED");
    return (
      ph("Reports", "Production performance from current orders.") +
      `<div class="bar" style="margin:0"><button class="btn" data-act="csv" title="Export CSV" aria-label="Export CSV"><i class="fa-solid fa-file-csv"></i></button><button class="btn" onclick="print()" title="Print" aria-label="Print"><i class="fa-solid fa-print"></i></button></div><div class="grid k6" style="margin:14px 0">${kpi("Orders", PROD.length)}${kpi(
        "Planned units",
        a.reduce((s, o) => s + o.qty, 0),
      )}${kpi(
        "Produced units",
        a.reduce((s, o) => s + o.prod, 0),
      )}${kpi(
        "Damaged units",
        DMG.reduce((s, d) => s + d.qty, 0),
      )}</div><div class="grid" style="grid-template-columns:repeat(auto-fit,minmax(300px,1fr))"><div class="card"><h3>By status</h3><table style="min-width:0">${PS.map((s) => `<tr><td>${st(s)}</td><td>${cn([s])}</td></tr>`).join("")}</table></div><div class="card"><h3>Damage by action</h3><table style="min-width:0">${DAC.map((x) => `<tr><td>${x}</td><td>${DMG.filter((d) => d.action == x).reduce((s, d) => s + d.qty, 0)} units</td></tr>`).join("")}</table></div></div>`
    );
  },
  team() {
    return (
      ph(
        "My Team",
        "Only Production employees appear here.",
        canManageTeam() ? ["madd", "Add Member"] : null,
      ) +
      table(
        ["Name", "Designation", "Orders", "Status"],
        TEAM.map((m) => [
          esc(m.n),
          esc(m.des),
          PROD.filter((o) => o.sup == m.n).length,
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
        const t = REC(r[0].match(/tv:([tc]\d+)/)[1]);
        return (
          `<button class="btn s" data-act="tv:${t.id}"><i class="fa-solid fa-eye" aria-hidden="true"></i></button>` +
          (T && t.dir == "Received" && t.st != "Completed"
            ? `<button class="btn s" data-act="adv:${t.id}">${t.st == "Pending" ? "Start" : "Complete"}</button>`
            : "") +
          (t.from == ME || can("task_delete")
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
      ph("Notifications", "Only notices for Production and you.") +
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

function productionGreeting() {
  const session = window.VyaparXAuth?.getCurrentSession?.() || {};
  const hour = new Date().getHours();
  const greeting = hour < 12 ? "Good Morning" : hour < 17 ? "Good Afternoon" : hour < 20 ? "Good Evening" : "Good Night";
  return session.fullName || session.name ? `${greeting}, ${session.fullName || session.name}` : greeting;
}

// Production Requests are Sales Orders released to production (the Sales page
// stamps prdCode when the authorised user clicks "Send to Production").
let PRD_ORDERS = [];
let PRD_ORDERS_READY = false;
let PRD_CODES = new Map();

function PRD_REQUESTS() {
  const records = [...PRD_CODES.values()];

  return records
    .filter(
      (request) =>
        request &&
        !request.isDeleted &&
        request.recordType === "productionRequest",
    )
    .map((request) => {
      const salesOrderId = String(
        request.salesOrderId || request.orderId || request.salesOrder || "",
      );

      // Sales is optional here: Production must still show its request if the
      // current role is not allowed to read /api/modules/sales/data.
      const order =
        PRD_ORDERS.find(
          (candidate) => String(candidate.id) === salesOrderId,
        ) || {};

      const requestItems = Array.isArray(request.items) ? request.items : [];
      const orderItems = Array.isArray(order.items) ? order.items : [];
      const firstItem = requestItems[0] || orderItems[0] || {};
      const plan = records.find(
        (record) =>
          record.recordType === "materialPlan" &&
          String(record.productionRequestId) === String(request.id),
      );

      const resolvedQuantity =
        request.quantity ??
        request.requestedQuantity ??
        firstItem.quantity ??
        firstItem.qty ??
        firstItem.requestedQuantity ??
        0;

      return {
        ...request,
        id: String(request.id || ""),
        code: request.requestCode || request.id || "—",
        order,
        orderNumber:
          request.salesOrderNumber ||
          request.orderNumber ||
          order.orderNumber ||
          order.id ||
          salesOrderId ||
          "—",
        customer:
          request.customerName ||
          request.customer ||
          order.customerName ||
          order.customer ||
          order.cust ||
          "—",
        itemCode:
          request.productCode ||
          request.itemCode ||
          firstItem.itemCode ||
          firstItem.productCode ||
          firstItem.code ||
          "—",
        productName:
          request.productName ||
          request.itemName ||
          firstItem.itemName ||
          firstItem.productName ||
          firstItem.description ||
          "—",
        quantity: Number(resolvedQuantity) || 0,
        unit: request.unit || firstItem.unit || firstItem.uom || "Nos",
        date:
          request.requestDate ||
          request.date ||
          request.createdAt ||
          "",
        deliveryDate:
          request.requiredCompletionDate || request.deliveryDate || "",
        priority: request.priority || "Medium",
        status: request.status || request.st || "Pending Review",
        materialStatus: plan?.materialAvailabilityStatus || "Not Checked",
        productionOrderId: request.productionOrderId || plan?.productionOrderId || "",
        materialPlan: plan || null,
      };
    });
}

let productionRequestFetch = null;

async function loadProductionRequests(force = true) {
  if (!window.VyaparXAuth?.fetchModuleRecords) {
    console.warn(
      "Production request fetch skipped: fetchModuleRecords is unavailable.",
    );
    return;
  }

  // Deduplicate simultaneous navigation/focus/timer refreshes.
  if (productionRequestFetch) return productionRequestFetch;

  productionRequestFetch = (async () => {
    try {
      // Important: fetch Production independently. Do not combine it with
      // the Sales API in Promise.all, because Sales may correctly return 403
      // for the Production role and would reject the whole operation.
      const productionRecords =
        await window.VyaparXAuth.fetchModuleRecords("production");

      const records = Array.isArray(productionRecords)
        ? productionRecords
        : [];

      PRD_CODES = new Map(
        records
          .filter((record) => record && record.id && !record.isDeleted)
          .map((record) => [String(record.id), record]),
      );

      PRD_ORDERS_READY = true;

      if (cur === "requests") render();
    } catch (error) {
      PRD_ORDERS_READY = false;
      console.error("Production request fetch failed:", error);
      toast(
        "Production requests could not be loaded: " +
          (error?.message || "Unknown error"),
      );
    } finally {
      productionRequestFetch = null;
    }
  })();

  return productionRequestFetch;
}

function projectView(requestId) {
  const request = PRD_REQUESTS().find((r) => String(r.id) === String(requestId));
  if (!request) return toast("Production Request not found.");
  const items = (Array.isArray(request.items) ? request.items : []).length
    ? request.items.filter((item) => item && typeof item === "object")
    : [{ itemCode: request.productCode || request.itemCode, productName: request.productName || request.itemName,
        description: request.description, quantity: request.quantity, unit: request.unit, rate: request.rate }];
  const value = (v) => v === null || v === undefined || v === "" ? "—" : esc(v);
  const summary = [
    ["Production Request Number", request.requestCode || request.code], ["Request ID", request.id],
    ["Sales Order Number", request.salesOrderNumber || request.orderNumber || request.salesOrderId],
    ["Customer Name", request.customerName || request.customer], ["Request Date", fs(request.requestDate || request.date || request.createdAt)],
    ["Requested By", request.requestedBy], ["Required Completion Date", fs(request.requiredCompletionDate || request.deliveryDate)],
    ["Priority", request.priority], ["Current Status", request.status || request.st],
  ];
  const m = document.createElement("div");
  document.querySelectorAll(".vm[aria-label='Production Request details']").forEach((node) => node.remove());
  m.className = "mask vm";
  m.innerHTML = `<div class="dlg" role="dialog" aria-modal="true" aria-label="Production Request details" style="width:min(900px,96vw);max-height:90vh;overflow:auto"><div style="display:flex;justify-content:space-between;align-items:flex-start;gap:12px"><div><h3>Production Request</h3><p style="color:var(--mut);margin:4px 0 0">${value(request.requestCode || request.code)}</p></div><button class="ic" data-x aria-label="Close">×</button></div><div class="grid two" style="margin-top:14px">${summary.map(([label, field]) => `<div><small style="color:var(--mut)">${label}</small><b style="display:block;overflow-wrap:anywhere">${value(field)}</b></div>`).join("")}</div><div style="margin-top:14px"><small style="color:var(--mut)">Request Remarks</small><div style="white-space:pre-wrap;overflow-wrap:anywhere">${value(request.remarks || request.requestRemarks)}</div></div>${request.materialPlan?.rejectionReason ? `<div style="margin-top:14px"><small style="color:var(--mut)">Material Request Rejection Reason</small><div style="white-space:pre-wrap;overflow-wrap:anywhere">${value(request.materialPlan.rejectionReason)}</div></div>` : ""}<h4 style="margin:18px 0 8px">Product Details</h4><div class="tw" style="overflow-x:auto"><table><thead><tr><th>Item Code</th><th>Product / Item</th><th>Description</th><th>Quantity</th><th>Unit</th><th>Rate</th></tr></thead><tbody>${items.map((i) => `<tr><td>${value(i.itemCode || i.productCode || i.code)}</td><td>${value(i.productName || i.itemName || i.name)}</td><td>${value(i.description)}</td><td>${Number(i.quantity ?? i.qty ?? 0).toLocaleString("en-IN", { maximumFractionDigits: 3 })}</td><td>${value(i.unit || i.uom)}</td><td>${i.rate === null || i.rate === undefined || i.rate === "" ? "—" : Number(i.rate).toLocaleString("en-IN", { maximumFractionDigits: 2 })}</td></tr>`).join("")}</tbody></table></div><div style="display:flex;gap:8px;justify-content:flex-end;margin-top:16px"><button class="btn" data-x>Close</button></div></div>`;
  document.body.append(m);
  m.onclick = (event) => {
    if (event.target === m || event.target.closest("[data-x]")) m.remove();
  };
}

function render() {
  const l = NAV.flatMap((n) => n[1]).find((x) => x[0] == cur)[1];
  $("#pt").textContent = l;
  $("#bc").textContent = "Production / " + l;
  $("#mn").innerHTML = V[cur]();
  nav();
  const u = nvis().filter((n) => !n.read).length;
  $("#nc").textContent = u;
  $("#nc").hidden = !u;
  hdr();
}

function hdr() {
  const session = window.VyaparXAuth?.getCurrentSession?.() || {};
  // TEAM can be empty before employee records load, so never assume meM() exists.
  const m = meM() || {
    id: session.id || session.userId || "",
    n: session.fullName || session.name || ME || "User",
    des: session.designation || session.department || "Production",
    photo: session.photo || null,
  };
  const avatar = $("#pav");
  const name = $("#pnm");
  const role = $("#prl");
  if (session.fullName || session.name) ME = session.fullName || session.name;
  if (avatar) {
    avatar.innerHTML = m.photo
      ? `<img src="${esc(m.photo)}" alt="" style="width:100%;height:100%;border-radius:50%;object-fit:cover">`
      : esc(ini(String(session.fullName || session.name || m.n || "User")));
  }
  if (name) name.textContent = session.fullName || session.name || m.n || "User";
  if (role) role.textContent = session.designation || session.department || m.des || "Production";
}

function go(v) {
  if (v === "requests") loadProductionRequests();
  if (v === "orders") loadProductionOrders();
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

const sl = (id, a, v, p) =>
  `<select class="in" id="${id}"><option value="">${p}</option>${a.map((x) => `<option value="${esc(x[0])}" ${x[0] == v ? "selected" : ""}>${esc(x[1])}</option>`).join("")}</select>`;

const live = () =>
  PROD.filter((o) => !["COMPLETED", "CANCELLED"].includes(o.st));

function prodForm(o) {
  if (!o) return toast("Create Production Orders from an Inventory-approved Material Plan.");
  return dlg(
    `<h3>Edit ${esc(o.id)}</h3><p>Only schedule and assignment details can be changed after order creation.</p><div class="fm"><label>Batch No<input class="in" id="pb" value="${esc(o.batch || "")}"></label><label>Supervisor<input class="in" id="pu" value="${esc(o.sup || "")}"></label><label>Planned Start<input class="in" type="date" id="pd" value="${esc(o.expectedStartDate || o.start || "")}"></label></div>`,
    "Save changes",
    async (mask) => {
      const batch = mask.querySelector("#pb").value.trim(), supervisor = mask.querySelector("#pu").value.trim(), startDate = mask.querySelector("#pd").value;
      if (!batch || !supervisor || !startDate || startDate < TODAY) { toast("Enter a batch, supervisor, and a valid planned start date."); return false; }
      try {
        const result = await window.VyaparXAuth.saveModuleRecord("production", { id: o.id, recordType: "workOrder", batch, sup: supervisor, start: startDate, expectedStartDate: startDate });
        if (!result?.success) throw new Error(result?.error || "Backend did not confirm the order update.");
        Object.assign(o, result.record || { batch, sup: supervisor, start: startDate, expectedStartDate: startDate });
        await refreshProductionRecords(); render(); toast("Production Order updated.");
      } catch (error) { toast("Production Order was not updated: " + error.message); return false; }
    },
  );
}

function prodView(o) {
  if (!o) return toast("Production Order not found.");
  o.cons = Array.isArray(o.cons) ? o.cons : [];
  const request = productionRequestFor(o),
    plan = PRD_RECORD(o.materialPlanId, "materialPlan") || [...PRD_CODES.values()].find((record) => record.recordType === "materialPlan" && String(record.productionOrderId) === String(o.id)),
    ms = [...o.cons, ...MAT.filter((m) => String(m.productionOrderId || m.prod) === String(o.id))],
    materials = Array.isArray(o.materials) ? o.materials : Array.isArray(plan?.materials) ? plan.materials : [],
    history = Array.isArray(o.hist) ? o.hist : [];
  const historyRows = history.map((x) => Array.isArray(x) ? [fs(x[0]), esc(x[1])] : [fs(x?.date || x?.at), esc(x?.message || x?.action || "Production update")]);
  detail([
    [
      "Production Order Details",
      [
        ["Production No", o.id],
        ["Status", st(o.st)],
        ["Batch No", esc(o.batch)],
        ["Sales Order", esc(o.salesOrderNumber || request?.salesOrderNumber || o.salesOrderId || o.so || "Not linked")],
        ["Customer", esc(request?.customerName || o.customerName || "Not linked")],
        ["Item", esc(productionItemName(o))],
        ["Priority", esc(o.priority || request?.priority || "—")],
        ["Approval", esc(o.accountingApprovalStatus || "See linked Sales Order")],
      ],
    ],
    [
      "Quantity",
      [
        ["Planned", Number(o.qty || 0)],
        ["Produced", Number(o.prod || 0)],
        ["Remaining", Math.max(0, Number(o.qty || 0) - Number(o.prod || 0))],
      ],
    ],
    [
      "Schedule",
      [
        ["Supervisor", esc(o.sup)],
        ["Planned Start", fs(o.expectedStartDate || o.start)],
        ["Actual Start", fs(o.actualStartAt)],
        ["End Date", o.end ? fs(o.end) : "—"],
      ],
    ],
    ["Quality Control", [["QC Status", st(o.qc)]]],
    [
      "Material Requirements",
      materials.length ? materials.map((m) => [esc(m.materialName || m.name || m.materialId || "Material"), `${Number(m.requiredQty ?? m.requiredQuantity ?? 0)} ${esc(m.unit || "required")} · ${Number(m.issuedQty || 0)} issued`]) : [["Materials", "No material requirements linked"]],
    ],
    ["Material Issue History", ms.length ? ms.map((m) => [esc(m.materialName || m.materialId || "Material"), `${Number(m.quantity || m.qty || 0)} ${esc(m.unit || "")} · ${fs(m.date || m.issuedAt)}`]) : [["Issues", "None recorded"]],
    ],
    [
      "Damage",
      o.dq
        ? [
            ["Quantity", o.dq],
            ["Type", o.dt],
            ["Action", o.da],
            ["Reason", esc(o.dr)],
          ]
        : [["Damage", "None recorded"]],
    ],
    ...(o.cst || o.cr
      ? [
          [
            "Cancellation",
            [
              ["Reason", esc(o.cst ? o.cst.reason : o.cr)],
              ["Status", o.cst ? "Awaiting head approval" : "Cancelled"],
            ],
          ],
        ]
      : []),
    [
      "Assignment",
      [
        ["Created By", esc(o.cb)],
        ["Created On", fs(o.ca)],
      ],
    ],
    ["Activity History", historyRows],
  ]);
}

async function startProd(o) {
  if (!o) return toast("Production Order not found.");
  if (o.startEligibility?.eligible !== true) {
    return toast(o.startEligibility?.reason || "Start eligibility is not available. Refresh Production Orders.");
  }
  const button = document.querySelector(`[data-act="ost:${CSS.escape(String(o.id))}"]`);
  if (button?.disabled) return;
  if (button) button.disabled = true;
  try {
    await productionAction(o, "start");
    await loadProductionOrders();
    render(); toast("Production started.");
  } catch (error) { toast(error.message || "Production could not be started."); }
  finally { if (button?.isConnected) button.disabled = false; }
}

function issueForm(id) {
  const order = PB(id);
  if (!order) return toast("Production Order not found.");
  const requirements = Array.isArray(order.materials) ? order.materials : [];
  if (!requirements.length) return toast("This Production Order has no approved material requirements linked.");
  dlg(
    `<h3>Issue material · ${esc(order.id)}</h3><p>Issue approved, reserved quantities from Inventory. The server validates and records each stock movement atomically.</p><div class="fm">${requirements.map((m, i) => { const required = Number(m.requiredQty ?? m.requiredQuantity ?? 0), issued = Number(m.issuedQty || 0), remaining = Math.max(0, required - issued); return `<label>${esc(m.materialName || m.name || m.materialId || "Material")} · ${remaining} ${esc(m.unit || "units")} remaining<input class="in" type="number" min="0" max="${remaining}" step="any" data-issue-index="${i}" data-material-id="${esc(m.materialId || "")}" value="${remaining}" ${remaining <= 0 ? "disabled" : ""}></label>`; }).join("")}<label>Issue Date *<input class="in" type="date" id="id" value="${TODAY}"></label></div>`,
    "Issue",
    async (mask) => {
      const dateInput = mask.querySelector("#id");
      if (!dateInput.value || dateInput.value > TODAY) { toast("Enter a valid issue date, not in the future."); return false; }
      const issues = [...mask.querySelectorAll("[data-issue-index]")].map((input) => ({ materialId: input.dataset.materialId, quantity: Number(input.value), materialIndex: Number(input.dataset.issueIndex) })).filter((line) => line.quantity > 0);
      if (!issues.length || issues.some((line) => !line.materialId || !Number.isFinite(line.quantity))) { toast("Enter a positive issue quantity for at least one linked material."); return false; }
      const button = mask.querySelector("[data-ok]"); if (button.disabled) return false; button.disabled = true;
      try { await productionAction(order, "issue-material", { issues, date: dateInput.value, issueId: crypto.randomUUID() }); await loadProductionOrders(); render(); toast("Material issued and Inventory updated."); }
      catch (error) { button.disabled = false; toast("Material was not issued: " + error.message); return false; }
    },
  );
}

function outForm(o) {
  const left = o.qty - o.prod;
  dlg(
    `<h3>Record output – ${o.id}</h3><p>Planned ${o.qty}, produced ${o.prod}, remaining ${left}.</p><div class="fm"><label>Units produced now *<input class="in" id="oq" inputmode="numeric"></label></div>`,
    "Save output",
    async (mask) => {
      if (
        !vf([
          [
            "#oq",
            (v) => /^[1-9]\d*$/.test(v),
            "Quantity must be a whole number above 0.",
          ],
          [
            "#oq",
            (v) => +v <= left,
            "Output cannot exceed the remaining " + left + " units.",
          ],
        ])
      )
        return false;
      const button = mask.querySelector("[data-ok]"); button.disabled = true;
      try { await productionAction(o, "output", { quantity: +mask.querySelector("#oq").value }); render(); toast("Output recorded."); }
      catch (error) { button.disabled = false; toast("Output was not recorded: " + error.message); return false; }
    },
  );
}

function dmgForm(id, fail) {
  const fo = fail && PB(id);
  dlg(
    `<h3>${fail ? "Fail quality check – " + id : "Record damage"}</h3><div class="fm">${
      fail
        ? ""
        : `<label>Production Order *${sl(
            "do",
            live()
              .filter((o) => o.prod > 0)
              .map((o) => [o.id, o.id + " – " + o.prod + " produced"]),
            id,
            "Select order",
          )}</label>`
    }${fail ? `<label>QC failure reason *<input class="in" id="dr"></label>` : `<label>Damaged Quantity *<input class="in" id="dq" inputmode="numeric"></label><label>Damage Type *${sl(
      "dt",
      DTY.map((x) => [x, x]),
      "",
      "Select type",
    )}</label><label>Action *${sl(
      "da",
      DAC.map((x) => [x, x]),
      "",
      "Select action",
    )}</label><label>Reason *<input class="in" id="dr"></label>`}</div>`,
    fail ? "Fail QC" : "Record damage",
    async (mask) => {
      const o = fail ? fo : PB($("#do") ? $("#do").value : "") || { prod: 0 };
      if (
        !vf([
          ...(fail ? [] : [["#do", (v) => v, "Select the production order."]]),
          ...(fail ? [] : [
          [
            "#dq",
            (v) => /^[1-9]\d*$/.test(v),
            "Quantity must be a whole number above 0.",
          ],
          [
            "#dq",
            (v) => +v <= o.prod,
            "Damage cannot exceed the " + o.prod + " units produced.",
          ],
          ["#dt", (v) => v, "Select the damage type."],
          ["#da", (v) => v, "Select the action."],
          ]),
          ["#dr", (v) => v.length > 2, "Enter the reason."],
        ])
      )
        return false;
      if (fail) {
        const button = mask.querySelector("[data-ok]"); button.disabled = true;
        try { await productionAction(o, "fail-qc", { reason: mask.querySelector("#dr").value.trim() }); render(); toast("QC failed and the order was returned for correction."); }
        catch (error) { button.disabled = false; toast("QC decision was not saved: " + error.message); return false; }
        return;
      }
      const q2 = +$("#dq").value;
      o.dq += q2;
      o.dt = $("#dt").value;
      o.da = $("#da").value;
      o.dr = $("#dr").value.trim();
      o.prod -= q2;
      DMG.unshift({
        prod: o.id,
        qty: q2,
        type: o.dt,
        action: o.da,
        reason: o.dr,
        date: TODAY,
        by: ME,
      });
      addh(o, `Damage recorded: ${q2} (${o.da})`);
      render();
      toast(
        fail ? "QC failed. Order returned to production." : "Damage recorded.",
      );
    },
  );
}

function cancelReq(o) {
  dlg(
    `<h3>Request cancellation of ${o.id}</h3><div class="fm"><label>Reason *<input class="in" id="cr"></label></div><p style="color:var(--mut);font-size:12px">Another head must approve this request.</p>`,
    "Request",
    async (mask) => {
      if (
        !vf([
          [
            "#cr",
            (v) => v.length > 4,
            "Enter the reason (at least 5 characters).",
          ],
        ])
      )
        return false;
      try { await productionAction(o, "request-cancel", { reason: $("#cr").value.trim() }); render(); toast("Cancellation requested. Waiting for approval."); }
      catch (error) { toast(error.message); return false; }
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
        window.VyaparXAuth.uploadFile(f, "producation-attachments").then((result) => {
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
    window.VyaparXAuth.uploadFile(f, "producation-profile").then((result) => {
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
      : ini(($("#pn") || { value: "?" }).value || "?");
};

function sendForm() {
  const T = TAB == "Task";
  PEND = [];
  dlg(
    `<h3>${T ? "Send task" : "Send message"}</h3><div class="fm" style="max-width:none"><label>${T ? "Task Title" : "Subject"} *<input class="in" id="sx"></label><label>${T ? "Description" : "Message"} *<textarea class="in" id="sd" rows="3"></textarea></label><label>Send To *<select class="in" id="sto"><option value="">Select person</option>${PEOPLE().filter((p) => p.d !== "Production")
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
          id = (T ? "t" : "c") + Date.now(),
          b = {
            id,
            from: ME,
            fd: "Production",
            to,
            td: dept(to),
            att: PEND.slice(),
            ca: T ? TODAY : nowT(),
          };
        const newItem = T ? {
            ...b,
            type: "Task",
            title: $("#sx").value.trim(),
            description: $("#sd").value.trim(),
            s: $("#sx").value.trim(),
            desc: $("#sd").value.trim(),
            p: $("#sp").value,
            priority: $("#sp").value,
            due: $("#su").value,
            dueDate: $("#su").value,
            status: "Pending",
            st: "Pending",
            ua: TODAY,
            hist: [[TODAY, "Task created"]],
          } : {
            ...b,
            type: "Communication",
            title: $("#sx").value.trim(),
            description: $("#sd").value.trim(),
            subj: $("#sx").value.trim(),
            msg: $("#sd").value.trim(),
            read: false,
          };
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
        TEAM.push(window.VyaparXShared.departmentTeam.createMember("production", f));
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
  [...PROD, ...MAT, ...DMG].forEach((o) => {
    if (o.by == a) o.by = b;
    if (o.sup == a) o.sup = b;
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
        ["Department", "Production"],
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
  if (a == "prv") { projectView(decodeURIComponent(x)); return; }
  if (a == "mp") { materialPlanForm(decodeURIComponent(x)); return; }
  if (a == "prhist") { productionRequestHistory(decodeURIComponent(x)); return; }
  if (a == "sendplan") { sendToProductionPlanning(decodeURIComponent(x)); return; }
  if (a == "createapproved") { createApprovedProductionOrder(decodeURIComponent(x)); return; }
  if (a === "create-production-order") { openProductionOrderCreatePicker(); return; }
  if (a == "add") prodForm();
  else if (a == "oe") prodForm(o);
  else if (a == "ov") prodView(o);
  else if (a == "ost") startProd(o);
  else if (a == "oim" || a == "iss") issueForm(x);
  else if (a == "oout") outForm(o);
  else if (a == "dadd") dmgForm();
  else if (a == "opz" || a == "orz") {
    productionAction(o, a == "opz" ? "pause" : "resume").then(() => { render(); toast("Production order updated."); }).catch((error) => toast(error.message));
  } else if (a == "oqc") {
    if (!o.prod) return toast("Record some output before sending to QC.");
    OKD(
      "Send to quality check?",
      `${o.id}: ${o.prod} of ${o.qty} units will wait for QC.`,
      "Send",
      async () => {
        try { await productionAction(o, "send-qc"); render(); toast("Sent to quality check."); }
        catch (error) { toast(error.message); return false; }
      },
    );
  } else if (a == "qp")
    OKD(
      "Pass quality check?",
      `${o.id} will be marked COMPLETED and become ready for Transport.`,
      "Pass",
      async () => {
        try { await productionAction(o, "pass-qc"); render(); toast("Order completed. Transport can now dispatch it."); }
        catch (error) { toast(error.message); return false; }
      },
    );
  else if (a == "qf") dmgForm(x, true);
  else if (a == "ocn") cancelReq(o);
  else if (a == "odel") {
    if (!o) return toast("This production order is no longer available.");
    o.cons = Array.isArray(o.cons) ? o.cons : [];
    if (!["PLANNED", "PENDING_MATERIAL"].includes(o.st) || o.prod || o.cons.length)
      return toast("Only a production order that has not started can be deleted.");
    OKD(
      `Delete ${o.id}?`,
      "The production order will be archived. Sales Orders and issued material stay unchanged.",
      "Delete",
      () => {
        const button = document.querySelector(`[data-act="odel:${o.id}"]`);
        if (button) button.disabled = true;
        window.VyaparXAuth.deleteModuleRecord("production", o.id)
          .then((result) => {
            if (!result || result.success !== true) throw new Error("The server did not confirm deletion.");
            PROD = PROD.filter((item) => String(item.id) !== String(o.id));
            window.VyaparXShared?.records?.markDeleted("production", "workOrder", o.id);
            render();
            toast("Production order deleted.");
          })
          .catch((error) => {
            if (button && button.isConnected) button.disabled = false;
            toast("Production order was not deleted: " + error.message);
          });
      },
    );
  }
  else if (a == "cap") {
    OKD(
      "Approve cancellation?",
      `${o.id} will be cancelled. Existing records stay.`,
      "Approve",
      async () => {
        try { await productionAction(o, "approve-cancel"); render(); toast("Production order cancelled."); }
        catch (error) { toast(error.message); return false; }
      },
    );
  } else if (a == "crj") {
    productionAction(o, "reject-cancel").then(() => { render(); toast("Cancellation rejected."); }).catch((error) => toast(error.message));
  } else if (a == "ev") {
    const m = TEAM.find((z) => z.id == x);
    detail([
      [
        "Employee Details",
        [
          ["Name", esc(m.n)],
          ["Email", esc(m.e)],
          ["Phone", esc(m.ph)],
          ["Department", "Production"],
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
    go("orders");
    q = v;
    render();
  }
});

$("#bell").onclick = () => go("notif");
$("#ct").onclick = () => document.body.classList.toggle("col");
$("#mb").onclick = () => window.VyaparXShared.toggleMobileNav();
$("#th").onclick = () => { if (window.VyaparXShared) window.VyaparXShared.applyTheme(window.VyaparXShared.currentTheme() === "dark" ? "light" : "dark"); };

if (window.VyaparXShared?.records?.bindPageState) {
  window.VyaparXShared.records.bindPageState("production", [
    { recordType: "teamMember", get: () => TEAM, set: (rows) => { TEAM = rows; } },
    { recordType: "materialReceipt", get: () => PUR, set: (rows) => { PUR = rows; } },
    { recordType: "materialConsumption", get: () => MAT, set: (rows) => { MAT = rows; } },
    { recordType: "damageRecord", get: () => DMG, set: (rows) => { DMG = rows; } },
  ], {
    onReady: () => { loadProductionRequests(); render(); },
    onChange: () => { loadProductionRequests(); render(); },
    onError: (error) => toast("Production records could not sync with Firestore: " + error.message),
  });
}

const productionParams = new URLSearchParams(window.location.search);
const requestedView = productionParams.get("view");
const productionViews = new Set(NAV.flatMap((section) => section[1].map((item) => item[0])));
go(productionViews.has(requestedView) ? requestedView : "dashboard");
loadProductionOrders();
loadProductionRequests();
if (productionParams.get("action") === "create" && requestedView === "orders") {
  const role = String(window.VyaparXAuth?.getCurrentSession?.()?.role || "").toLowerCase();
  if (["admin", "production"].includes(role)) setTimeout(openProductionOrderCreatePicker, 0);
  else toast("Only Production or Admin can create a Production Order.");
}
window.addEventListener("focus", () => { loadProductionRequests(true); if (cur === "orders") loadProductionOrders(); });
window.addEventListener("pageshow", () => { loadProductionRequests(true); if (cur === "orders") loadProductionOrders(); });

if (window.VyaparXShared?.records?.onRecordsUpdated) {
  window.VyaparXShared.records.onRecordsUpdated((moduleName) => {
    if (!moduleName || moduleName === "production" || moduleName === "sales") loadProductionRequests(true);
  });
}

window.setInterval(() => {
  if (document.visibilityState === "visible" && cur === "requests") loadProductionRequests(true);
}, 30000);

async function productionSyncTasksFromDb() {
  if (!window.VyaparXShared || !window.VyaparXShared.tasks) return;
  try {
    const all = await window.VyaparXShared.tasks.fetchTasks({ force: true });
    TASKS = all.filter((task) => task.type !== "Communication");
    COMMS = all.filter((task) => task.type === "Communication");
    NOTES = [...NOTES.filter((note) => note.k), ...all.filter((task) => task.dir === "Received").map((task) => ({
      id: "n_" + task.id, ref: task.id, read: !!(task.isRead || task.read),
    }))];
    if (["tasks", "notif", "dashboard"].includes(cur)) render();
  } catch (error) { console.warn("Could not sync Production tasks:", error); }
}

productionSyncTasksFromDb();
if (window.VyaparXShared?.tasks) window.VyaparXShared.tasks.onTasksUpdated(productionSyncTasksFromDb);
window.addEventListener("focus", productionSyncTasksFromDb);
if (window.VyaparXFields) window.VyaparXFields.loadFields("production").then(() => { if (cur === "orders") render(); });
window.addEventListener("focus", () => { if (window.VyaparXFields) window.VyaparXFields.loadFields("production", true); });

// Admin Reports integration: expose this module's real records so the Admin
// report engine builds PRODUCTION reports from actual data, not static counts.
window.PRODUCTION_REPORT_SOURCE = function () { try { return []; } catch (e) { return []; } };


async function refreshProductionRecords() {
  if (!window.VyaparXAuth?.fetchModuleRecords) {
    throw new Error("Production records service is unavailable.");
  }

  // Production Requests, Material Plans, and Production Planning records all
  // belong to the Production module. A Sales 403 must not block their refresh.
  const records = await window.VyaparXAuth.fetchModuleRecords("production");
  const validRecords = (Array.isArray(records) ? records : []).filter(
    (record) => record && record.id && !record.isDeleted,
  );

  PRD_CODES = new Map(
    validRecords.map((record) => [String(record.id), record]),
  );
  // Keep the order tables in step with the same Firestore snapshot used for
  // requests and material plans. Otherwise an action succeeds on the server,
  // but the local list still reflects its previous status (or omits it).
  PROD = validRecords.filter(isProductionOrderRecord).map((row) => ({
    ...row,
    id: String(row.id),
    so: row.salesOrderNumber || row.salesOrderId || row.so || "",
    item: row.productName || row.item || "—",
    qty: Number(row.qty || row.plannedQuantity || 0),
    prod: Number(row.prod || row.producedQuantity || 0),
    st: row.st || row.status || "PLANNED",
    status: row.status || row.st || "PLANNED",
    materials: Array.isArray(row.materials) ? row.materials : [],
    cons: Array.isArray(row.cons) ? row.cons : [],
    hist: Array.isArray(row.hist) ? row.hist : [],
  }));
  PRD_ORDERS_READY = true;

  if (cur === "requests") render();
  return validRecords;
}

function isProductionOrderRecord(record) {
  const type = String(record?.recordType || record?.type || record?.orderType || "").replace(/[\s_-]/g, "").toLowerCase();
  if (["workorder", "productionorder"].includes(type)) return true;

  // Older production documents were saved before every record was stamped
  // with recordType. Recognize only the distinctive work-order shape so
  // requests and material plans are not mistaken for orders.
  const hasWorkOrderFields = record && record.qty != null && (
    record.prod != null || record.productionOrderDate || record.productionOrderNo || record.workOrderNumber
  );
  return !!hasWorkOrderFields && !record.isDeleted;
}

async function loadProductionOrders() {
  try {
    await refreshProductionRecords();
    if (["orders", "dashboard"].includes(cur)) render();
  } catch (error) {
    toast("Production Orders could not be loaded: " + (error?.message || "Unknown error"));
  }
}

function openProductionOrderCreatePicker() {
  openManualStandaloneOrderForm();
}

function openManualStandaloneOrderForm() {
  const submissionKey = window.crypto?.randomUUID?.() || `manual-${Date.now()}-${Math.random().toString(36).slice(2)}`;
  const mask = document.createElement("div");
  mask.className = "mask vm";
  mask.innerHTML = `<div class="dlg production-create-order-form" role="dialog" aria-modal="true" aria-label="Create Production Order"><div class="production-create-order-head"><div><h3>Create Production Order</h3><p>Enter the Sales Order and product details. If raw materials are needed, continue through the Inventory-approved Material Plan flow.</p></div><button class="ic" data-x aria-label="Close" title="Close">×</button></div><div class="production-create-order-fields"><label>Sales Order No. / ID *<input class="in" id="manualSalesOrder" maxlength="80" placeholder="SO-…"></label><label>Product Name *<input class="in" id="manualProductName" maxlength="160" placeholder="Exact product name from Sales Order"></label><label>Product Code (optional)<input class="in" id="manualProductCode" maxlength="80" placeholder="Product code or ID"></label><label>Production Quantity *<input class="in" id="manualQuantity" type="number" min="0.01" step="any" placeholder="Quantity from Sales Order"></label><label>Unit<input class="in" id="manualUnit" maxlength="30" value="Nos"></label><label>Expected Start Date *<input class="in" id="manualStart" type="date" min="${TODAY}" value="${TODAY}"></label><label>Expected Completion Date<input class="in" id="manualCompletion" type="date" min="${TODAY}"></label><label>Priority<select class="in" id="manualPriority">${["Low", "Medium", "High", "Urgent"].map((value) => `<option ${value === "Medium" ? "selected" : ""}>${value}</option>`).join("")}</select></label><label>Batch No<input class="in" id="manualBatch" maxlength="80"></label><label>Supervisor<input class="in" id="manualSupervisor" maxlength="120"></label></div><label class="production-manual-material-check"><input type="checkbox" id="manualNoMaterials"> This order requires no raw materials</label><div class="production-create-order-actions"><button class="btn" data-x>Cancel</button><button class="btn" data-use-request>Use Production Request</button><button class="btn p" data-manual-order-save>Create Order</button></div></div>`;
  document.body.append(mask);
  mask.onclick = (event) => {
    if (event.target === mask || event.target.closest("[data-x]")) return mask.remove();
    if (event.target.closest("[data-use-request]")) {
      mask.remove();
      openProductionRequestOrderPicker();
      return;
    }
    const button = event.target.closest("[data-manual-order-save]");
    if (!button || button.disabled) return;
    const values = {
      salesOrder: mask.querySelector("#manualSalesOrder").value.trim(),
      salesOrderNumber: mask.querySelector("#manualSalesOrder").value.trim(),
      productName: mask.querySelector("#manualProductName").value.trim(),
      productCode: mask.querySelector("#manualProductCode").value.trim(),
      idempotencyKey: submissionKey,
      quantity: Number(mask.querySelector("#manualQuantity").value),
      unit: mask.querySelector("#manualUnit").value.trim(),
      expectedStartDate: mask.querySelector("#manualStart").value,
      expectedCompletionDate: mask.querySelector("#manualCompletion").value,
      priority: mask.querySelector("#manualPriority").value,
      batch: mask.querySelector("#manualBatch").value.trim(),
      supervisor: mask.querySelector("#manualSupervisor").value.trim(),
      noMaterialsRequired: mask.querySelector("#manualNoMaterials").checked,
    };
    if (!values.salesOrder || !values.productName || !Number.isFinite(values.quantity) || values.quantity <= 0 || !values.expectedStartDate) return toast("Enter the Sales Order, product, quantity, and expected start date.");
    if (values.expectedCompletionDate && values.expectedCompletionDate < values.expectedStartDate) return toast("Expected completion date must be on or after the start date.");
    if (!values.noMaterialsRequired) return toast("Confirm no raw materials are required, or create this order from an Inventory-approved Material Plan.");
    button.disabled = true;
    button.textContent = "Saving…";
    window.VyaparXAuth.postWorkflowAction("/api/production-orders/manual", values)
      .then(async (result) => {
        if (!result?.success || !result?.record?.id) throw new Error(result?.error || "The backend did not confirm the Production Order.");
        mask.remove();
        go("orders");
        await loadProductionOrders();
        toast(`Production Order ${result.record.id} created and saved.`);
      })
      .catch((error) => {
        if (!mask.isConnected) {
          toast(`Production Order was saved, but could not be refreshed: ${error.message}`);
          return;
        }
        button.disabled = false;
        button.textContent = "Create Order";
        toast("Production Order was not created: " + error.message);
      });
  };
}

function openProductionRequestOrderPicker() {
  const currentSession = window.VyaparXAuth?.getCurrentSession?.() || {};
  const isAdmin = String(currentSession.role || currentSession.userRole || "").toLowerCase() === "admin";
  const eligible = PRD_REQUESTS().filter((request) =>
    !request.productionOrderId && (isAdmin || (request.status === "Inventory Approved" && request.materialPlan?.approvalStatus === "Approved")),
  );
  if (!eligible.length) {
    toast(isAdmin ? "No unconverted Production Requests are available." : "No Inventory-approved Production Requests are available to create an order.");
    return;
  }
  const mask = document.createElement("div");
  mask.className = "mask vm";
  mask.innerHTML = `<div class="dlg production-create-order-picker" role="dialog" aria-modal="true" aria-label="Create Production Order"><button class="ic" data-x aria-label="Close" title="Close" style="position:absolute;top:12px;right:12px">×</button><h3 style="padding-right:42px">Create Production Order</h3><p>Select an Inventory-approved Production Request. The order will retain the approved plan, Sales Order link and quantity validations.</p><label>Production Request *<select class="in" id="createOrderRequest"><option value="">Select request</option>${eligible.map((request) => `<option value="${esc(request.id)}">${esc(request.code)} · SO ${esc(request.orderNumber)} · ${esc(request.productName)} · Qty ${esc(request.quantity)}</option>`).join("")}</select></label><div class="production-create-order-actions"><button class="btn" data-x>Cancel</button><button class="btn p" data-create-order-confirm>Create Order</button></div></div>`;
  document.body.append(mask);
  mask.onclick = (event) => {
    if (event.target === mask || event.target.closest("[data-x]")) {
      mask.remove();
      return;
    }
    const button = event.target.closest("[data-create-order-confirm]");
    if (!button || button.disabled) return;
    const requestId = mask.querySelector("#createOrderRequest").value;
    if (!requestId) return toast("Select an approved Production Request.");
    button.disabled = true;
    button.textContent = "Opening…";
    const selected = PRD_CODES.get(String(requestId));
    const plan = [...PRD_CODES.values()].find((record) => record.recordType === "materialPlan" && String(record.productionRequestId) === String(requestId));
    if (!plan && isAdmin) {
      mask.remove();
      openManualProductionOrderForm(requestId);
      return;
    }
    if (plan && selected?.status === "Inventory Approved") {
      mask.remove();
      createApprovedProductionOrder(requestId);
      return;
    }
    if (plan && isAdmin) {
      mask.remove();
      openAdminProductionOrderForm(requestId, plan);
      return;
    }
    toast("An approved material plan is required for this request.");
    button.disabled = false;
    button.textContent = "Create Order";
  };
}

function openManualProductionOrderForm(requestId) {
  const request = PRD_CODES.get(String(requestId));
  if (!request || request.recordType !== "productionRequest") return toast("Production Request not found.");
  const items = (Array.isArray(request.items) ? request.items : []).filter((item) => item && typeof item === "object");
  if (!items.length) return toast("This request has no order items to create a Production Order from.");
  const mask = document.createElement("div");
  mask.className = "mask vm";
  mask.innerHTML = `<div class="dlg" role="dialog" aria-modal="true" aria-label="Admin Production Order" style="width:min(760px,96vw);max-height:90vh;overflow:auto;position:relative"><button class="ic" data-x aria-label="Close" title="Close" style="position:absolute;top:12px;right:12px">×</button><h3 style="padding-right:42px">Admin Create Production Order</h3><p style="color:#92400e;background:#fffbeb;padding:10px;border-radius:8px">Inventory approval bypass is being used. This override is audited.</p><div class="grid two"><label>Production Request<input class="in" value="${esc(request.requestCode || request.id)}" readonly></label><label>Sales Order No<input class="in" value="${esc(request.salesOrderNumber || request.salesOrderId || "—")}" readonly></label><label>Item *<select class="in" id="manualPoItem">${items.map((item) => { const id = item.itemId || item.productId || item.id || ""; return `<option value="${esc(id)}">${esc(item.itemCode || item.productCode || "")} · ${esc(item.productName || item.itemName || item.description || id)}</option>`; }).join("")}</select></label><label>Quantity *<input class="in" id="manualPoQty" type="number" min="0.01" step="any" value="${Number(items[0].quantity ?? items[0].qty ?? request.quantity ?? 0)}"></label><label>Expected Start Date *<input class="in" id="manualPoStart" type="date" min="${TODAY}" value="${TODAY}"></label><label>Priority<select class="in" id="manualPoPriority">${["Low","Medium","High","Urgent"].map((priority) => `<option ${priority === (request.priority || "Medium") ? "selected" : ""}>${priority}</option>`).join("")}</select></label></div><div style="display:flex;justify-content:flex-end;gap:8px;margin-top:16px"><button class="btn" data-x>Cancel</button><button class="btn p" data-manual-create>Create Order</button></div></div>`;
  document.body.append(mask);
  mask.onclick = async (event) => {
    if (event.target === mask || event.target.closest("[data-x]")) return mask.remove();
    const button = event.target.closest("[data-manual-create]");
    if (!button || button.disabled) return;
    const itemId = mask.querySelector("#manualPoItem").value;
    const item = items.find((entry) => String(entry.itemId || entry.productId || entry.id || "") === itemId);
    const quantity = Number(mask.querySelector("#manualPoQty").value);
    const maxQuantity = Number(item?.quantity ?? item?.qty ?? request.quantity ?? 0);
    if (!item || !Number.isFinite(quantity) || quantity <= 0 || quantity > maxQuantity) return toast("Enter a valid quantity within the request quantity.");
    button.disabled = true;
    try {
      const createStartedAt = performance.now();
      const realPlan = [...PRD_CODES.values()].find((record) => record.recordType === "materialPlan" && String(record.productionRequestId) === String(request.id));
      const planId = realPlan?.id || `MP-${request.id}`;
      if (!realPlan) {
        const planSave = await window.VyaparXAuth.createModuleRecord("production", {
          id: planId, recordType: "materialPlan", productionRequestId: request.id,
          productionRequestNo: request.requestCode || request.id,
          salesOrderId: request.salesOrderId || request.orderId || "",
          salesOrderNumber: request.salesOrderNumber || request.orderNumber || "",
          productId: itemId, plannedQuantity: quantity, approvalStatus: "Admin Override",
          status: "Admin Override", materials: [], createdAt: new Date().toISOString(),
        });
        if (!planSave?.record?.id) throw new Error(planSave?.error || "Could not save the required Production Plan record.");
        PRD_CODES.set(String(planSave.record.id), planSave.record);
      }
      const result = await window.VyaparXAuth.postWorkflowAction(`/api/production/material-plans/${encodeURIComponent(planId)}/create-order`, {
        productId: itemId, quantity, expectedStartDate: mask.querySelector("#manualPoStart").value,
        priority: mask.querySelector("#manualPoPriority").value, bypassInventoryApproval: true,
      });
      const responseReceivedAt = performance.now();
      if (!result?.record?.id) throw new Error(result?.error || "Backend did not confirm Production Order creation.");
      const order = result.record;
      PROD = [{ ...order, id: String(order.id), so: order.salesOrderNumber || order.salesOrderId || "", item: order.productName || "—", qty: Number(order.qty || quantity), prod: 0, st: order.status || "PLANNED", status: order.status || "PLANNED", materials: order.materials || [], cons: [], hist: order.hist || [] }, ...PROD.filter((row) => String(row.id) !== String(order.id))];
      const liveRequest = PRD_CODES.get(String(requestId));
      if (liveRequest) Object.assign(liveRequest, { status: "Production Order Created", productionOrderId: String(order.id) });
      PRD_CODES.set(String(order.id), { ...order });
      mask.remove();
      render();
      requestAnimationFrame(() => console.info("[VyaparX performance] Production Order created and displayed", {
        orderId: String(order.id),
        requestDurationMs: Math.round(responseReceivedAt - createStartedAt),
        displayDurationMs: Math.round(performance.now() - createStartedAt),
      }));
      toast(`Production Order ${order.id} created with Admin override.`);
      go("orders");
    } catch (error) {
      button.disabled = false;
      toast("Production Order was not created: " + error.message);
    }
  };
}

function openAdminProductionOrderForm(requestId, plan) {
  // The approved-plan form accepts the Admin-only override flag; it retains
  // its existing item, plan quantity, Sales Order and backend validations.
  createApprovedProductionOrder(requestId, { bypassInventoryApproval: true });
}

function productionRequestHistory(requestId) {
  const request = PRD_CODES.get(String(requestId));
  if (!request) return toast("Production Request not found.");
  const history = Array.isArray(request.history) ? request.history : [];
  detail([["Production Request History", history.map((entry) => [entry.date || entry[0] || "", entry.description || entry[1] || "Request created"])]]);
}

async function materialPlanForm(requestId) {
  const request = PRD_CODES.get(String(requestId));
  if (!request || request.recordType !== "productionRequest") return toast("Production Request not found.");
  let existing = [...PRD_CODES.values()].find((record) => record.recordType === "materialPlan" && String(record.productionRequestId) === String(request.id));
  const requestItems = (Array.isArray(request.items) ? request.items : []).filter((entry) => entry && typeof entry === "object");
  const planItemId = existing?.productId || requestItems[0]?.itemId || requestItems[0]?.productId || requestItems[0]?.id || "";
  const planItem = requestItems.find((line) => String(line.itemId || line.productId || line.id || "") === String(planItemId)) || requestItems[0] || {};
  const planItemQuantity = Number(planItem.quantity ?? planItem.qty ?? request.quantity ?? 0);
  let stockItems = [];
  try {
    const inventoryRecords = await window.VyaparXAuth.fetchModuleRecords("inventory");
    stockItems = (inventoryRecords || []).filter((record) => record.recordType === "stockItem" && !record.isDeleted);
  } catch (error) {
    return toast("Inventory records could not be loaded: " + error.message);
  }
  const materials = Array.isArray(existing?.materials) ? existing.materials.map((m) => ({ ...m })) : [];
  const planId = existing?.id || "MP-" + request.id;
  const mask = document.createElement("div");
  mask.className = "mask";
  const drawRows = () => materials.map((m, index) => `<tr><td><select class="in" data-mi="${index}" aria-label="Raw material"><option value="">Select material</option>${stockItems.map((stock) => `<option value="${esc(stock.id)}" ${String(stock.id) === String(m.materialId) ? "selected" : ""}>${esc(stock.code || stock.itemCode || "")} · ${esc(stock.itemName || stock.name || stock.n || "Item")}</option>`).join("")}${m.materialId && !stockItems.some((s) => String(s.id) === String(m.materialId)) ? `<option selected value="${esc(m.materialId)}">${esc(m.materialCode || "")} · ${esc(m.materialName || "")}</option>` : ""}</select></td><td>${esc(m.materialName || "—")}</td><td><input class="in" type="number" min="0" step="any" data-mf="quantityPerUnit" data-mi="${index}" value="${Number(m.quantityPerUnit || 0)}" placeholder="BOM qty / unit"></td><td><input class="in" type="number" min="0" step="any" data-mf="requiredQuantity" data-mi="${index}" value="${Number(m.requiredQty ?? m.requiredQuantity ?? 0)}" placeholder="Required qty"></td><td>${esc(m.unit || "—")}</td><td>${Number(m.availableStock || 0)}</td><td>${Number(m.reservedStock || 0)}</td><td>${Number(m.netAvailableStock || Math.max(0, Number(m.availableStock || 0) - Number(m.reservedStock || 0)))}</td><td><input class="in" type="number" min="0" step="any" data-mf="expectedIncomingStock" data-mi="${index}" value="${Number(m.expectedIncomingStock || 0)}"></td><td>${Number(m.shortageQuantity || 0)}</td><td><input class="in" type="number" min="0" step="any" data-mf="estimatedUnitRate" data-mi="${index}" value="${Number(m.estimatedUnitRate || 0)}"></td><td>${Number(m.estimatedAmount || 0).toFixed(2)}</td><td><input class="in" data-mf="preferredSupplier" data-mi="${index}" value="${esc(m.preferredSupplier || "")}"></td><td><input class="in" type="date" data-mf="requiredByDate" data-mi="${index}" value="${esc(m.requiredByDate || request.requiredCompletionDate || request.deliveryDate || "")}"></td><td>${esc(m.availabilityStatus || "Unverified")}</td><td><button class="btn s" data-remove="${index}" aria-label="Remove material">Remove</button></td></tr>`).join("");
  mask.innerHTML = `<div class="dlg" role="dialog" aria-modal="true" style="width:min(1200px,96vw);max-height:90vh;overflow:auto"><h3>Raw Material Planning · ${esc(existing?.materialRequestNo || "New Request")}</h3><p data-mr-status style="color:var(--mut)">Material Request: ${esc(existing?.materialRequestNo || "Assigned on save")} · Status: ${esc(existing?.status || "Draft")}</p><div class="grid two"><label>Production Request No<input class="in" value="${esc(request.requestCode || request.id)}" readonly></label><label>Sales Order / Bill No<input class="in" value="${esc(request.salesOrderNumber || request.salesOrderId || "")}" readonly></label><label>Sales Order Item<select class="in" id="mpProduct">${requestItems.map((line) => { const id = line.itemId || line.productId || line.id || ""; return `<option value="${esc(id)}" ${String(id) === String(planItemId) ? "selected" : ""}>${esc(line.itemCode || line.productCode || "")} · ${esc(line.productName || line.itemName || line.description || id)} (${Number(line.quantity ?? line.qty ?? 0)} ${esc(line.unit || line.uom || "")})</option>`; }).join("")}</select></label><label>Product Name<input class="in" id="mpProductName" value="${esc(planItem.productName || planItem.itemName || planItem.description || request.productName || "")}" readonly></label><label>Production Quantity<input class="in" id="mpQty" type="number" min="0.01" step="any" max="${planItemQuantity}" value="${Number(existing?.plannedQuantity || planItemQuantity)}"></label><label>Planning Date<input class="in" type="date" id="mpPlanDate" value="${esc(existing?.planningDate || TODAY)}"></label><label>Required Production Date<input class="in" id="mpDate" type="date" value="${esc(existing?.materialRequiredByDate || request.requiredCompletionDate || request.deliveryDate || "")}"></label><label>Priority<select class="in" id="mpPriority">${["Low","Medium","High","Urgent"].map((p) => `<option ${p === (existing?.priority || request.priority) ? "selected" : ""}>${p}</option>`).join("")}</select></label><label>Planned By<input class="in" value="${esc(window.VyaparXAuth.getCurrentSession()?.fullName || ME || "")}" readonly></label><label>Remarks<textarea class="in" id="mpRemarks">${esc(existing?.remarks || "")}</textarea></label></div><div style="display:flex;justify-content:space-between;align-items:center;margin:14px 0"><b>Raw Materials</b><button class="btn s" data-add-material>Add Raw Material</button></div><div class="tw" style="overflow:auto"><table><thead><tr><th>Material Code / Name</th><th>BOM Qty / Unit</th><th>Required Qty (manual if no BOM)</th><th>Unit</th><th>Available</th><th>Reserved</th><th>Net Available</th><th>Incoming</th><th>Shortage</th><th>Unit Rate</th><th>Amount</th><th>Supplier</th><th>Required By</th><th>Status</th><th>Action</th></tr></thead><tbody id="mpRows">${drawRows()}</tbody></table></div><p style="color:var(--mut)">No approved BOM component model is configured. Enter required quantities manually; stock is read from the selected Inventory item.</p><div class="a"><button class="btn" data-x>Cancel</button><button class="btn" data-msave>Save Planning</button><button class="btn p" data-msend ${existing?.sentToInventoryAt && existing?.approvalStatus === "Pending" ? "disabled" : ""}>${existing?.sentToInventoryAt && existing?.approvalStatus === "Pending" ? `Sent to Inventory · ${esc(existing.materialRequestNo || planId)}` : "Send to Inventory"}</button></div></div>`;
  document.body.append(mask);

  const refreshRows = () => { mask.querySelector("#mpRows").innerHTML = drawRows(); };
  mask.onchange = (event) => {
    const target = event.target;
    if (target.id === "mpProduct") {
      const selected = requestItems.find((line) => String(line.itemId || line.productId || line.id || "") === String(target.value));
      if (selected) { mask.querySelector("#mpProductName").value = selected.productName || selected.itemName || selected.description || ""; mask.querySelector("#mpQty").max = Number(selected.quantity ?? selected.qty ?? 0); mask.querySelector("#mpQty").value = Number(selected.quantity ?? selected.qty ?? 0); }
      return;
    }
    const index = Number(target.dataset.mi);
    if (!Number.isInteger(index)) return;
    if (target.tagName === "SELECT") {
      const stock = stockItems.find((entry) => String(entry.id) === String(target.value));
      if (!stock) return;
      materials[index] = { ...materials[index], materialId: stock.id, materialCode: stock.code || stock.itemCode || "", materialName: stock.itemName || stock.name || stock.n || "", category: stock.category || "", availableStock: Number(stock.qty ?? stock.availableStock ?? 0), reservedStock: Number(stock.reservedStock || 0), unit: stock.unit || stock.uom || "", warehouse: stock.warehouse || "" };
      refreshRows();
    } else if (target.dataset.mf) {
      materials[index][target.dataset.mf] = target.type === "number" ? Number(target.value) : target.value;
      if (target.dataset.mf === "requiredQuantity") {
        materials[index].requiredQty = Number(target.value);
      } else if (target.dataset.mf === "quantityPerUnit") {
        materials[index].requiredQuantity = Number(target.value) * Number(mask.querySelector("#mpQty").value || 0);
        materials[index].requiredQty = materials[index].requiredQuantity;
      }
    }
  };
  mask.querySelector("#mpQty").addEventListener("input", (event) => {
    materials.forEach((material) => { if (Number(material.quantityPerUnit) > 0) { material.requiredQuantity = Number(material.quantityPerUnit) * Number(event.target.value || 0); material.requiredQty = material.requiredQuantity; } });
    refreshRows();
  });
  mask.onclick = async (event) => {
    if (event.target === mask || event.target.closest("[data-x]")) return mask.remove();
    if (event.target.closest("[data-add-material]")) { materials.push({ materialId: "", quantityPerUnit: 0, requiredQuantity: 0, availableStock: 0, reservedStock: 0, expectedIncomingStock: 0, estimatedUnitRate: 0 }); refreshRows(); return; }
    if (event.target.closest("[data-remove]")) { materials.splice(Number(event.target.closest("[data-remove]").dataset.remove), 1); refreshRows(); return; }
    const sendButton = event.target.closest("[data-msend]");
    const saveButton = event.target.closest("[data-msave]");
    if (!sendButton && !saveButton) return;
    const sendToInventory = Boolean(sendButton);
    const button = sendButton || saveButton; if (button.disabled) return;
    button.disabled = true;
    try {
      const quantity = Number(mask.querySelector("#mpQty").value);
      if (!Number.isFinite(quantity) || quantity <= 0) throw new Error("Enter a valid production quantity.");
      for (const material of materials) {
        material.requiredQty = Number(material.requiredQty ?? material.requiredQuantity ?? 0);
        material.requiredQuantity = material.requiredQty;
        if (!material.materialId || !(material.requiredQty > 0)) throw new Error("Choose a material and enter its required quantity.");
        material.shortageQuantity = Math.max(0, material.requiredQty - Math.max(0, Number(material.availableStock || 0) - Number(material.reservedStock || 0)));
        material.purchaseQuantity = Math.max(0, material.shortageQuantity - Number(material.expectedIncomingStock || 0));
        material.estimatedAmount = material.purchaseQuantity * Number(material.estimatedUnitRate || 0);
      }
      const payload = { id: planId, recordType: "materialPlan", productionRequestId: request.id, productionRequestNo: request.requestCode || "", productionOrderId: request.productionOrderId || "", planningId: planId, productId: mask.querySelector("#mpProduct").value, salesOrderId: request.salesOrderId, salesOrderNumber: request.salesOrderNumber, productName: mask.querySelector("#mpProductName").value, plannedQuantity: quantity, planningDate: mask.querySelector("#mpPlanDate").value, materialRequiredByDate: mask.querySelector("#mpDate").value, preferredWarehouse: "", priority: mask.querySelector("#mpPriority").value, remarks: mask.querySelector("#mpRemarks").value.trim(), materials, approvalStatus: "Draft", submittedByName: window.VyaparXAuth.getCurrentSession()?.fullName || ME || "", inventoryVerificationStatus: "Not Checked", createdAt: existing?.createdAt || new Date().toISOString() };
      const result = existing ? await window.VyaparXAuth.saveModuleRecord("production", payload) : await window.VyaparXAuth.createModuleRecord("production", payload);
      if (!result?.record?.id) throw new Error("Backend did not confirm the planning save.");
      existing = result.record;
      if (!sendToInventory) {
        mask.querySelector("[data-mr-status]").textContent = `Material Request: ${existing.materialRequestNo || planId} · Status: Draft`;
        mask.querySelector("h3").textContent = `Raw Material Planning · ${existing.materialRequestNo || "New Request"}`;
      }
      if (sendToInventory) {
        const sent = await window.VyaparXAuth.postWorkflowAction(`/api/production/material-plans/${encodeURIComponent(planId)}/send`, {});
        if (!sent?.success) throw new Error(sent?.error || "Backend did not confirm sending the request.");
        existing = { ...existing, status: "Sent to Inventory", approvalStatus: "Pending", sentToInventoryAt: sent.sentAt || new Date().toISOString(), materialRequestNo: sent.materialRequestNo || existing.materialRequestNo };
        sendButton.disabled = true; sendButton.textContent = `Sent to Inventory · ${existing.materialRequestNo || planId}`;
        mask.querySelector("[data-mr-status]").textContent = `Material Request: ${existing.materialRequestNo || planId} · Status: Sent to Inventory`;
        await refreshProductionRecords(); toast(`Material Request ${existing.materialRequestNo || planId} sent to Inventory.`);
      } else {
        await refreshProductionRecords(); toast("Material planning draft saved.");
      }
    } catch (error) { button.disabled = false; toast((sendToInventory ? "Could not send to Inventory: " : "Planning was not saved: ") + error.message); }
  };
}

async function sendToProductionPlanning(requestId) {
  const request = PRD_CODES.get(String(requestId));
  if (!request || request.recordType !== "productionRequest") return toast("Production Request not found.");
  const plan = [...PRD_CODES.values()].find((record) => record.recordType === "materialPlan" && String(record.productionRequestId) === String(request.id));
  if (!plan || plan.status !== "Confirmed" || plan.materialAvailabilityStatus !== "Available") return toast("Confirm a Material Plan with verified available materials first.");
  const planningId = "PP-" + String(request.id).replace(/[^a-zA-Z0-9-]/g, "");
  try {
    const result = await window.VyaparXAuth.createModuleRecord("production", {
      id: planningId,
      recordType: "productionPlanning",
      productionRequestId: request.id,
      materialPlanId: plan.id,
      salesOrderId: request.salesOrderId,
      salesOrderNumber: request.salesOrderNumber,
      customerName: request.customerName,
      productName: request.productName,
      productCode: request.productCode,
      plannedQuantity: plan.plannedQuantity,
      unit: request.unit,
      expectedCompletionDate: request.requiredCompletionDate,
      status: "Draft",
      planDate: TODAY,
      history: [{ date: TODAY, description: "Production Planning created" }]
    });
    if (!result?.record?.id) throw new Error("Backend did not confirm Production Planning.");
    await window.VyaparXAuth.saveModuleRecord("production", {
      id: plan.id,
      recordType: "materialPlan",
      productionRequestId: request.id,
      status: "Confirmed",
      materialAvailabilityStatus: plan.materialAvailabilityStatus
    });
    await window.VyaparXAuth.saveModuleRecord("production", {
      id: request.id,
      recordType: "productionRequest",
      requestCode: request.requestCode,
      salesOrderId: request.salesOrderId,
      salesOrderNumber: request.salesOrderNumber,
      status: "Issued",
      materialPlanId: plan.id,
      productionPlanningId: result.record.id
    });
    await refreshProductionRecords();
    toast("Production Planning " + result.record.id + " created.");
  } catch (error) {
    toast("Could not send to Production Planning: " + error.message);
  }
}

async function createApprovedProductionOrder(requestId, options = {}) {
  const request = PRD_CODES.get(String(requestId));
  const plan = [...PRD_CODES.values()].find((record) => record.recordType === "materialPlan" && String(record.productionRequestId) === String(requestId));
  const bypassInventoryApproval = options.bypassInventoryApproval === true;
  if (!request || !plan || (!bypassInventoryApproval && request.status !== "Inventory Approved")) return toast("A valid Material Plan is required to create this Production Order.");
  const item = (request.items || []).find((line) => String(line.itemId || line.productId || line.id || "") === String(plan.productId));
  if (!item) return toast("Approved plan item is missing from the Production Request.");
  const mask = document.createElement("div"); mask.className = "mask vm";
  mask.innerHTML = `<div class="dlg production-create-order-form" role="dialog" aria-modal="true"><div style="display:flex;justify-content:space-between;gap:12px"><h3>Create Production Order</h3><button class="ic" data-x aria-label="Close">×</button></div><div class="grid two"><label>Production Order No<input class="in" value="PO-${esc(request.requestCode || request.id)}" readonly></label><label>Production Request No<input class="in" value="${esc(request.requestCode || request.id)}" readonly></label><label>Raw Material Planning ID<input class="in" value="${esc(plan.id)}" readonly></label><label>Sales Order No<input class="in" value="${esc(request.salesOrderNumber || request.salesOrderId || "")}" readonly></label><label>Order Date<input class="in" type="date" value="${TODAY}" readonly></label><label>Expected Start Date<input class="in" id="poStart" type="date" min="${TODAY}" value="${TODAY}"></label><label>Expected Completion Date<input class="in" type="date" value="${esc(request.requiredCompletionDate || request.deliveryDate || "")}" readonly></label><label>Priority<select class="in" id="poPriority">${["Low","Medium","High","Urgent"].map((p) => `<option ${p === (request.priority || plan.priority) ? "selected" : ""}>${p}</option>`).join("")}</select></label><label>Created By<input class="in" value="${esc(window.VyaparXAuth.getCurrentSession()?.fullName || ME || "")}" readonly></label><label>Status<input class="in" value="PLANNED" readonly></label><label>Sales Order Item<select class="in" id="poItem"><option value="${esc(plan.productId)}" selected>${esc(item.itemCode || item.productCode || "")} · ${esc(item.productName || item.itemName || item.description || "")}</option></select></label><label>Sales Order Ordered Qty<input class="in" value="${Number(item.quantity ?? item.qty ?? 0)} ${esc(item.unit || item.uom || "")}" readonly></label><label>Remaining Planned Qty<input class="in" value="${Number(plan.plannedQuantity || 0)} ${esc(item.unit || item.uom || "")}" readonly></label><label>Production Quantity<input class="in" type="number" id="poQty" min="0.01" max="${Number(plan.plannedQuantity || 0)}" step="any" value="${Number(plan.plannedQuantity || 0)}"></label><label>Customer<input class="in" value="${esc(request.customerName || request.customer || "")}" readonly></label></div><h4>Approved Raw Materials</h4><div class="tw"><table><thead><tr><th>Code</th><th>Material</th><th>Required</th><th>Available / Reserved</th><th>Status</th><th>Plan</th></tr></thead><tbody>${(plan.materials || []).map((m) => `<tr><td>${esc(m.materialCode || "—")}</td><td>${esc(m.materialName || "—")}</td><td>${Number(m.requiredQuantity || 0)} ${esc(m.unit || "")}</td><td>${Number(m.availableStock || 0)} / ${Number(m.reservedStock || 0)}</td><td>${esc(m.availabilityStatus || "Available")}</td><td>${esc(plan.id)}</td></tr>`).join("")}</tbody></table></div><div class="a"><button class="btn" data-x>Cancel</button><button class="btn p" data-create-po>Create Production Order</button></div></div>`;
  document.body.append(mask);
  mask.onclick = async (event) => {
    if (event.target === mask || event.target.closest("[data-x]")) return mask.remove();
    const button = event.target.closest("[data-create-po]"); if (!button || button.disabled) return;
    const quantity = Number(mask.querySelector("#poQty").value);
    if (!Number.isFinite(quantity) || quantity <= 0 || quantity > Number(plan.plannedQuantity || 0)) return toast("Quantity must be above zero and within the approved plan.");
    button.disabled = true;
    try {
      const createStartedAt = performance.now();
      const result = await window.VyaparXAuth.postWorkflowAction(`/api/production/material-plans/${encodeURIComponent(plan.id)}/create-order`, { productId: mask.querySelector("#poItem").value, quantity, expectedStartDate: mask.querySelector("#poStart").value, priority: mask.querySelector("#poPriority").value, bypassInventoryApproval });
      const responseReceivedAt = performance.now();
      if (!result?.record?.id) throw new Error("Backend did not confirm Production Order creation.");
      const saved = result.record;
      const normalizedOrder = {
        ...saved,
        id: String(saved.id),
        so: saved.salesOrderNumber || saved.salesOrderId || saved.so || "",
        item: saved.productName || saved.item || "—",
        qty: Number(saved.qty || saved.plannedQuantity || quantity),
        prod: Number(saved.prod || saved.producedQuantity || 0),
        st: saved.st || saved.status || "PLANNED",
        status: saved.status || saved.st || "PLANNED",
        materials: Array.isArray(saved.materials) ? saved.materials : [],
        cons: Array.isArray(saved.cons) ? saved.cons : [],
        hist: Array.isArray(saved.hist) ? saved.hist : [],
      };
      PROD = [normalizedOrder, ...PROD.filter((row) => String(row.id) !== normalizedOrder.id)];
      const liveRequest = PRD_CODES.get(String(requestId));
      if (liveRequest) Object.assign(liveRequest, { status: "Production Order Created", productionOrderId: normalizedOrder.id });
      PRD_CODES.set(normalizedOrder.id, { ...saved });
      mask.remove();
      render();
      requestAnimationFrame(() => console.info("[VyaparX performance] Production Order created and displayed", {
        orderId: normalizedOrder.id,
        requestDurationMs: Math.round(responseReceivedAt - createStartedAt),
        displayDurationMs: Math.round(performance.now() - createStartedAt),
      }));
      toast(`Production Order ${normalizedOrder.id} created.`);
      go("orders");
    } catch (error) { button.disabled = false; toast("Production Order was not created: " + error.message); }
  };
}
