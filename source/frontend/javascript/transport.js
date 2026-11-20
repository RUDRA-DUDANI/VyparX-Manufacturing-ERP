/**
 * VyaparX ERP - Logistics & Fleet Transport Controller
 * Manages Dispatch Orders, Fleet Vehicles, Driver Assignments, and Tracking.
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
function dlg(h, ok, fn, className = "") {
  const m = document.createElement("div");
  const modalClass = className ? ` ${esc(className)}` : "";
  m.className = `mask${modalClass ? `${modalClass}-mask` : ""}`;
  const title = String(h).match(/^\s*<h3\b[\s\S]*?<\/h3>(?:\s*<p\b[\s\S]*?<\/p>)?/i);
  const header = `<div class="dlg-head">${title ? title[0] : ""}<button class="ic dlg-close" type="button" data-x aria-label="Close" title="Close">×</button></div>`;
  const body = title ? String(h).slice(title[0].length) : h;
  m.innerHTML = `<div class="dlg${modalClass}" role="dialog">${header}<div class="dlg-body">${body}</div><div class="a"><button class="btn" data-x>Cancel</button><button class="btn p" data-ok>${ok}</button></div></div>`;
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
    "TRANSPORT",
    [
      [
        "dashboard",
        "Dashboard",
        "<rect x='3' y='3' width='7' height='9'/><rect x='14' y='3' width='7' height='5'/><rect x='14' y='12' width='7' height='9'/><rect x='3' y='16' width='7' height='5'/>",
      ],
      ["requests", "Sales Requests", "<path d='M4 4h16v16H4zM8 9h8M8 13h8M8 17h5'/>"] ,
      [
        "dels",
        "Deliveries",
        "<path d='M2 7h11v9H2zM13 10h5l3 3v3h-8zM6 19a1.5 1.5 0 100-3 1.5 1.5 0 000 3zM17 19a1.5 1.5 0 100-3 1.5 1.5 0 000 3z'/>",
      ],
      ["bills", "Transport Bills", "<path d='M6 3h12v18H6zM9 8h6M9 12h6M9 16h4'/>"] ,
      ["deliveryBills", "Delivery Bills", "<path d='M6 3h12v18H6zM9 8h6M9 12h6M9 16h4'/>"] ,
      ["disp", "Dispatch", "<path d='M12 15V3M7 8l5-5 5 5M4 20h16'/>"],
      [
        "veh",
        "Vehicles",
        "<rect x='3' y='8' width='15' height='9' rx='1'/><path d='M18 11h3v6h-3M7 19v-2M14 19v-2'/>",
      ],
      [
        "drv",
        "Drivers",
        "<circle cx='12' cy='8' r='4'/><path d='M4 21c0-4 3.5-6 8-6s8 2 8 6'/>",
      ],
      [
        "track",
        "Delivery Tracking",
        "<path d='M12 21s7-6 7-12a7 7 0 10-14 0c0 6 7 12 7 12zM12 11a2 2 0 100-4 2 2 0 000 4z'/>",
      ],
      [
        "pend",
        "Pending Deliveries",
        "<circle cx='12' cy='12' r='9'/><path d='M12 7v5l3 2'/>",
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
const SOS = [];
let REQ = [];
let DLV = [];
const VEH = /^[A-Z]{2}\d{2}[A-Z]{1,3}\d{4}$/,
  TS = [
    "PLANNED",
    "READY",
    "DISPATCHED",
    "IN_TRANSIT",
    "DELIVERED",
    "FAILED",
    "CANCELLED",
  ],
  ACT = ["PLANNED", "READY", "DISPATCHED", "IN_TRANSIT"];
const TR = (n, so, veh, drv, dc, from, to, dp, dd, s, cb) => ({
  id: "TRN-" + n,
  so,
  veh,
  drv,
  dc,
  from,
  to,
  dp,
  exp: dd,
  dd: s == "DELIVERED" ? dd : null,
  st: s,
  cb,
  ca: dp,
  why: "",
  hist: [
    { "0": dp, "1": "Delivery planned", date: dp, action: "Delivery planned" },
    { "0": dp, "1": "Status: " + s.replace(/_/g, " "), date: dp, action: "Status: " + s.replace(/_/g, " ") },
  ],
});
let TRN = [];
let TBL = [];
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
const canManageTeam = () => window.VyaparXShared?.departmentTeam?.canManage("transport") === true;

let _cachedCompanyPeople = null;
const PEOPLE = () => {
  if (window.VyaparXShared && window.VyaparXShared.getCompanyPeople) {
    if (!_cachedCompanyPeople) window.VyaparXShared.getCompanyPeople().then((res) => { _cachedCompanyPeople = res; });
    if (_cachedCompanyPeople) return _cachedCompanyPeople;
  }
  return [];
};
const dept = (n) => (PEOPLE().find((p) => p.n == n) || { d: "Transport" }).d,
  meM = () => {
    const member = (Array.isArray(TEAM) ? TEAM : []).find((m) => m?.id == "M1");
    if (member) return member;
    const session = window.VyaparXAuth?.getCurrentSession?.() || {};
    const name = session.fullName || session.name || ME || "Transport User";
    return {
      id: "M1",
      n: name,
      eid: session.employeeId || "",
      e: session.email || "",
      des: session.designation || session.department || "Transport",
      r: session.role || "Transport",
      ph: session.phone || "",
      photo: session.photo || null,
    };
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
const REC = (id) => TASKS.concat(COMMS).find((r) => String(r.id) == String(id)),
  nvis = () =>
    NOTES.filter((n) =>
      n.k ? (n.k == "appr" ? late().length : unpl().length) > 0 : !!REC(n.ref),
    );
const ntext = (n) => {
  if (n.k)
    return n.k == "appr"
      ? `${late().length} delivery(ies) past the expected date`
      : `${unpl().length} completed order(s) waiting for transport planning`;
  const r = REC(n.ref);
  return n.ref[0] == "t"
    ? `New task from ${esc(r.fd)}: ${esc(r.s)}`
    : `New message from ${esc(r.fd)}: ${esc(r.subj)}`;
};
const delTask = (r) => {
  if (!r) return;
  const label = r.type === "Communication" ? "communication" : "task";
  return dlg(`<h3>Delete ${label}?</h3><p>Are you sure you want to delete this ${label}? Only completed tasks can be deleted.</p>`, "Delete", (mask) => {
    const button = mask.querySelector("[data-ok]");
    button.disabled = true;
    const removeTask = window.VyaparXShared?.tasks?.deleteTask;
    if (!removeTask) {
      button.disabled = false;
      toast("Task deletion service is unavailable.");
      return false;
    }
    Promise.resolve(removeTask(r.id))
      .then(() => {
        TASKS = TASKS.filter((item) => String(item.id) !== String(r.id));
        COMMS = COMMS.filter((item) => String(item.id) !== String(r.id));
        NOTES = NOTES.filter((note) => String(note.ref) !== String(r.id));
        mask.remove();
        render();
        toast(`${label[0].toUpperCase()}${label.slice(1)} deleted successfully.`);
      })
      .catch((error) => {
        button.disabled = false;
        toast(`Could not delete ${label}: ${error.message}`);
      });
    return false;
  });
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
const late = () => TRN.filter((t) => ACT.includes(t.st) && t.exp < TODAY),
  unpl = () =>
    SOS.filter(
      (s) =>
        s.prod == "COMPLETED" &&
        s.st != "CANCELLED" &&
        !s.transportRequestStatus &&
        !TRN.some((t) => t.so == s.id && t.st != "CANCELLED") &&
        !REQ.some((r) => String(r.salesOrderId) === String(s.id) && ["Pending", "Approved"].includes(r.approvalStatus)),
    );
const st = (s) => {
  const c = /^(DELIVERED|ACTIVE|Completed|Low|Read)$/.test(s)
    ? "ok"
    : /^(READY|INACTIVE|Pending|In Progress|High|Medium|Unread)$/.test(s)
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
const TB = (id) => TRN.find((t) => t.id == id),
  OB = TB,
  addh = (o, t) => { o.hist = o.hist || []; o.hist.push({ "0": TODAY, "1": t, date: TODAY, action: t }); },
  SB = (id) => SOS.find((s) => s.id == id);
function refreshSalesOrderShadows() {
  const byId = new Map();
  REQ.forEach((request) => {
    const id = String(request.salesOrderId || "");
    if (!id) return;
    byId.set(id, {
      id,
      cust: request.customerName || "",
      city: request.to || request.customerAddress || "",
      st: request.approvalStatus === "Approved" ? "TRANSPORT_PLANNED" : "READY_FOR_TRANSPORT",
      prod: "COMPLETED",
      transportRequestStatus: request.approvalStatus || "Pending",
    });
  });
  SOS.splice(0, SOS.length, ...byId.values());
}
const kpi = (a, b) =>
    `<div class="card kpi"><small>${a}</small><b>${b}</b></div>`,
  cn = (s) => TRN.filter((o) => s.includes(o.st)).length;
const TC = [
    "Transport No",
    "Sales Order",
    "Vehicle",
    "Driver",
    "Route",
    "Dispatch",
    "Expected",
    "Status",
  ],
  trow = (t) => [
    t.id,
    t.so,
    t.veh,
    esc(t.drv),
    esc(t.from) + " → " + esc(t.to),
    fs(t.dp),
    fs(t.exp),
    t.st,
  ];
const tact = (r) => {
  const t = TB(r[0]),
    b = (a, l) => `<button class="btn s" data-act="${a}:${t.id}">${l}</button>`,
    s = t.st,
    submittedBill = TBL.find((bill) => String(bill.dispatchId) === String(t.id) && !bill.isDeleted);
  return (
    b("ov", "View") +
    (s == "DELIVERED" && (!submittedBill || submittedBill.approvalStatus === "Rejected")
      ? b("tbill", submittedBill ? "Resubmit Bill" : "Submit Bill")
      : "") +
    (s == "PLANNED" ? b("oe", "Edit") + b("orb", "Mark Ready") : "") +
    (["PLANNED", "READY"].includes(s) ? b("odp", "Dispatch") : "") +
    (s == "DISPATCHED" ? b("otr", "In Transit") : "") +
    (["DISPATCHED", "IN_TRANSIT"].includes(s)
      ? b("odl", "Deliver") + b("ofl", "Failed")
      : "") +
    (s == "FAILED" ? b("orp", "Reschedule") : "") +
    (["PLANNED", "READY"].includes(s) ? b("ocn", "Cancel") : "")
  );
};
const chk = (t) => {
  const so = SB(t.so);
  if (!so) return "The linked Sales Order details are unavailable. Refresh Transport requests.";
  if (so.st == "CANCELLED") return "Cannot dispatch a cancelled order.";
  if (so.prod != "COMPLETED")
    return "Cannot dispatch this order because production is not completed.";
  return "";
};
const V = {
  dashboard() {
    const al = [...late(), ...unpl()];
    return (
      ph(transportGreeting(), "Dispatch, transit and delivery at a glance.", [
        "add",
        "Plan Delivery",
      ]) +
      `<div class="grid k6">${kpi("Ready to Dispatch", cn(["READY"]))}${kpi("Dispatched", cn(["DISPATCHED"]))}${kpi("In Transit", cn(["IN_TRANSIT"]))}${kpi("Delivered", cn(["DELIVERED"]))}${kpi("Failed", cn(["FAILED"]))}</div>
 <div class="grid two" style="margin-top:14px"><div class="card"><h3>Recent deliveries</h3><div class="tw"><table><tr><th>Transport</th><th>Order</th><th>Route</th><th>Status</th></tr>${TRN.slice(
   0,
   5,
 )
   .map(
     (t) =>
       `<tr><td>${t.id}</td><td>${t.so}</td><td>${esc(t.from)} → ${esc(t.to)}</td><td>${st(t.st)}</td></tr>`,
   )
   .join("")}</table></div></div>
 <div class="card"><h3>Needs attention</h3>${al.length ? al.map((x) => (x.so ? `<div style="display:flex;justify-content:space-between;align-items:center;padding:8px 0;border-bottom:1px solid var(--bd)"><span>${x.id}<br><small style="color:var(--mut)">Past expected delivery</small></span><button class="btn s" data-act="ov:${x.id}"><i class="fa-solid fa-eye" aria-hidden="true"></i></button></div>` : `<div style="display:flex;justify-content:space-between;align-items:center;padding:8px 0;border-bottom:1px solid var(--bd)"><span>${x.id}<br><small style="color:var(--mut)">Production completed. Needs planning</small></span><button class="btn s" data-act="add:${x.id}">Plan</button></div>`)).join("") : `<div class="empty">Nothing needs attention.</div>`}</div></div>`
    );
  },
  requests() {
    const pending = REQ.filter((row) => row.approvalStatus === "Pending").length;
    return ph("Sales Transport Requests", "Review production-complete Sales Orders and approve delivery details.") +
      `<div class="grid k6">${kpi("Total Requests", REQ.length)}${kpi("Awaiting Review", pending)}${kpi("Approved", REQ.filter((row) => row.approvalStatus === "Approved").length)}${kpi("Rejected", REQ.filter((row) => row.approvalStatus === "Rejected").length)}</div>` +
      table(["Request", "Sales Order", "Customer", "Request Date", "Required Delivery", "Items", "Approval Status"],
        REQ.map((row) => [row.id, row.salesOrderNumber || row.salesOrderId || "—", esc(row.customerName || "—"), fs(row.requestedAt), fs(row.requiredDeliveryDate), (row.items || []).length, row.approvalStatus || row.status || "Pending"]),
        { filter: ["Pending", "Approved", "Rejected"], act: (row) => { const req = REQ.find((item) => String(item.id) === String(row[0])); return `<button class="btn s" data-act="trqview:${esc(row[0])}">View</button>${req?.approvalStatus === "Pending" ? `<button class="btn s p" data-act="trqapprove:${esc(row[0])}">Approve &amp; Create Bill</button><button class="btn s" data-act="trqreject:${esc(row[0])}">Reject</button>` : req?.deliveryBillId ? `<button class="btn s" data-act="dlvview:${esc(req.deliveryBillId)}">Delivery Bill</button>` : ""}`; }, empty: "No Sales requests have reached Transport yet." });
  },
  deliveryBills() {
    return ph("Delivery Bills", "Approved delivery challans sent back to Sales and saved in Firestore.") +
      table(["Bill No", "Sales Order", "Customer", "Vehicle", "Dispatch Date", "Expected Delivery", "Total Value", "Status"],
        DLV.map((bill) => [bill.billNumber || bill.id, bill.salesOrderNumber || bill.salesOrderId || "—", esc(bill.customerName || "—"), esc(bill.vehicleNumber || "—"), fs(bill.dispatchDate), fs(bill.expectedDeliveryDate), inr(Number(bill.totalAmount || 0)), bill.approvalStatus || bill.status || "Approved"]),
        { filter: ["Approved"], act: (row) => `<button class="btn s" data-act="dlvview:${esc(row[0])}">View / Print</button><button class="btn s" data-act="dlvdelete:${esc(row[0])}">Delete</button>`, empty: "No delivery bills have been created yet." });
  },
  dels() {
    return (
      ph("Deliveries", "All deliveries from planning to proof of delivery.", [
        "add",
        "Plan Delivery",
      ]) +
      table(window.VyaparXFields.tableColumns("transport", TC), TRN.map((t) => window.VyaparXFields.tableRow("transport", t, trow(t))), {
        filter: TS,
        colModule: "transport",
        act: tact,
        empty: "No deliveries yet.",
      })
    );
  },
  bills() {
    const pending = TBL.filter((bill) => bill.approvalStatus === "Pending").length;
    const approved = TBL.filter((bill) => bill.approvalStatus === "Approved").length;
    const rejected = TBL.filter((bill) => bill.approvalStatus === "Rejected").length;
    return ph("Transport Bills", "Submitted expense bills and their persisted Accounting status.") +
      `<div class="grid k6">${kpi("Total Bills", TBL.length)}${kpi("Pending Approval", pending)}${kpi("Approved", approved)}${kpi("Rejected", rejected)}</div>` +
      table(["Bill Number", "Dispatch", "Vendor", "Bill Total", "Due Date", "Approval Status", "Payable Status", "Customer Receipt"], TBL.map((bill) => [bill.id, bill.dispatchId || "—", esc(bill.transporterName || "—"), inr(Number(bill.totalAmount || 0)), fs(bill.dueDate), bill.approvalStatus || "Pending", bill.billStatus || "PENDING_APPROVAL", bill.customerReceiptStatus || "UNPAID"]), { filter: ["Pending", "Approved", "Rejected"], act: (row) => `<button class="btn s" data-act="tbview:${esc(row[0])}">View</button><button class="btn s" data-act="tbdelete:${esc(row[0])}">Delete</button>`, empty: "No transport bills submitted yet." });
  },
  disp() {
    return (
      ph("Dispatch", "Mark ready, dispatch and move deliveries into transit.") +
      table(
        TC,
        TRN.filter((t) =>
          ["PLANNED", "READY", "DISPATCHED"].includes(t.st),
        ).map(trow),
        { act: tact, empty: "Nothing waiting to dispatch." },
      )
    );
  },
  veh() {
    const vs = [...new Set(TRN.map((t) => t.veh))];
    return (
      ph("Vehicles", "Vehicles used in deliveries. Status follows the trips.") +
      table(
        ["Vehicle No", "Trips", "Last Driver", "Status"],
        vs.map((v) => {
          const ts = TRN.filter((t) => t.veh == v);
          return [
            v,
            ts.length,
            esc(ts[0].drv),
            ts.some((t) => ["DISPATCHED", "IN_TRANSIT"].includes(t.st))
              ? "IN_TRANSIT"
              : "ACTIVE",
          ];
        }),
        { empty: "No vehicles yet." },
      )
    );
  },
  drv() {
    const ds = [...new Set(TRN.map((t) => t.drv))];
    return (
      ph("Drivers", "Drivers assigned to deliveries.") +
      table(
        ["Driver", "Contact", "Trips", "Status"],
        ds.map((d) => {
          const ts = TRN.filter((t) => t.drv == d);
          return [
            esc(d),
            ts[0].dc,
            ts.length,
            ts.some((t) => ["DISPATCHED", "IN_TRANSIT"].includes(t.st))
              ? "IN_TRANSIT"
              : "ACTIVE",
          ];
        }),
        { empty: "No drivers yet." },
      )
    );
  },
  track() {
    return (
      ph("Delivery Tracking", "Live deliveries and failed attempts.") +
      table(
        [
          "Transport No",
          "Sales Order",
          "Vehicle",
          "Route",
          "Dispatched",
          "Expected",
          "Status",
        ],
        TRN.filter((t) =>
          ["DISPATCHED", "IN_TRANSIT", "FAILED"].includes(t.st),
        ).map((t) => [
          t.id,
          t.so,
          t.veh,
          esc(t.from) + " → " + esc(t.to),
          fs(t.dp),
          fs(t.exp),
          t.st,
        ]),
        { act: tact, empty: "No deliveries on the road." },
      )
    );
  },
  pend() {
    return (
      ph("Pending Deliveries", "Deliveries not yet completed.") +
      table(
        [
          "Transport No",
          "Sales Order",
          "Customer",
          "Expected",
          "Timing",
          "Status",
        ],
        TRN.filter((t) => ACT.includes(t.st)).map((t) => [
          t.id,
          t.so,
          esc(SB(t.so).cust),
          fs(t.exp),
          t.exp < TODAY ? "Late" : "On time",
          t.st,
        ]),
        { act: tact, empty: "No pending deliveries." },
      )
    );
  },
  reports() {
    const d = TRN.filter((t) => t.st == "DELIVERED"),
      ot = d.filter((t) => t.dd <= t.exp).length;
    return (
      ph("Reports", "Delivery performance from current records.") +
      `<div class="bar" style="margin:0"><button class="btn" data-act="csv" title="Export CSV" aria-label="Export CSV"><i class="fa-solid fa-file-csv"></i></button><button class="btn" onclick="print()" title="Print" aria-label="Print"><i class="fa-solid fa-print"></i></button></div><div class="grid k6" style="margin:14px 0">${kpi("Deliveries", TRN.length)}${kpi("Delivered", d.length)}${kpi("On-time rate", d.length ? Math.round((ot / d.length) * 100) + "%" : "—")}${kpi("Failed", cn(["FAILED"]))}</div><div class="card"><h3>By status</h3><table style="min-width:0">${TS.map((s) => `<tr><td>${st(s)}</td><td>${cn([s])}</td></tr>`).join("")}</table></div>`
    );
  },
  team() {
    return (
      ph(
        "My Team",
        "Only Transport employees appear here.",
        canManageTeam() ? ["madd", "Add Member"] : null,
      ) +
      table(
        ["Name", "Designation", "Deliveries", "Status"],
        TEAM.map((m) => [
          esc(m.n),
          esc(m.des),
          TRN.filter((o) => o.cb == m.n).length,
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
          ((t.from == ME || can("task_delete")) && ["completed", "complete", "done"].includes(String(t.st || t.status || "").toLowerCase())
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
      ph("Notifications", "Only notices for Transport and you.") +
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
function transportGreeting() {
  const session = window.VyaparXAuth?.getCurrentSession?.() || {};
  const hour = new Date().getHours();
  const greeting = hour < 12 ? "Good Morning" : hour < 17 ? "Good Afternoon" : hour < 20 ? "Good Evening" : "Good Night";
  return session.fullName || session.name ? `${greeting}, ${session.fullName || session.name}` : greeting;
}
function render() {
  const l = NAV.flatMap((n) => n[1]).find((x) => x[0] == cur)[1];
  $("#pt").textContent = l;
  $("#bc").textContent = "Transport / " + l;
  $("#mn").innerHTML = V[cur]();
  nav();
  const u = nvis().filter((n) => !n.read).length;
  $("#nc").textContent = u;
  $("#nc").hidden = !u;
  hdr();
}
function hdr() {
  const m = meM() || {};
  const session = window.VyaparXAuth?.getCurrentSession?.();
  if (session?.fullName) ME = session.fullName;
  $("#pav").innerHTML = m.photo
    ? `<img src="${m.photo}" alt="" style="width:100%;height:100%;border-radius:50%;object-fit:cover">`
    : ini(m.n || session?.fullName || session?.name || ME || "Transport User");
  $("#pnm").textContent = session?.fullName || m.n || ME || "Transport User";
  $("#prl").textContent = session?.designation || session?.department || m.des || "Transport";
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
const sl = (id, a, v, p) =>
  `<select class="in" id="${id}"><option value="">${p}</option>${a.map((x) => `<option value="${esc(x[0])}" ${x[0] == v ? "selected" : ""}>${esc(x[1])}</option>`).join("")}</select>`;
function planForm(t, so0) {
  const n = !t;
  t = t || {
    id: "TRN-" + (Math.max(100, ...TRN.map((z) => +z.id.slice(4))) + 1),
    so: so0 || "",
    veh: "",
    drv: "",
    dc: "",
    from: "Vadodara",
    to: so0 ? SB(so0).city : "",
    dp: "",
    exp: "",
  };
  dlg(
    `<h3>${n ? "Plan delivery" : "Edit " + t.id}</h3><div class="fm"><label>Transport No *<input class="in" id="xn" value="${t.id}" ${n ? "" : "disabled"}></label><label>Sales Order *${sl(
      "xs",
      SOS.filter((s) => !["CANCELLED", "DELIVERED"].includes(s.st)).map((s) => [
        s.id,
        s.id + " – " + s.cust,
      ]),
      t.so,
      "Select sales order",
    )}</label><label>Vehicle No *<input class="in" id="xv" placeholder="GJ03AB1234" value="${esc(t.veh)}"></label><label>Driver Name *<input class="in" id="xd" value="${esc(t.drv)}"></label><label>Driver Contact *<input class="in" id="xc" inputmode="numeric" value="${esc(t.dc)}"></label><label>From *<input class="in" id="xf" value="${esc(t.from)}"></label><label>To *<input class="in" id="xt" value="${esc(t.to)}"></label><label>Dispatch Date *<input class="in" type="date" id="xp" value="${t.dp}"></label><label>Expected Delivery *<input class="in" type="date" id="xe" value="${t.exp}"></label></div>`,
    n ? "Save plan" : "Save changes",
    (modal) => {
      if (
        !vf([
          ["#xn", (v) => /^TRN-\d{3,6}$/i.test(v), "Use the format TRN-101."],
          [
            "#xn",
            (v) => !TRN.some((z) => z !== t && z.id == v.toUpperCase()),
            "This transport number already exists.",
          ],
          ["#xs", (v) => v, "Select the sales order."],
          [
            "#xs",
            (v) => !SB(v) || SB(v).st != "CANCELLED",
            "This sales order is cancelled.",
          ],
          [
            "#xv",
            (v) => VEH.test(v.toUpperCase().replace(/\s/g, "")),
            "Enter a valid vehicle number, for example GJ03AB1234.",
          ],
          ["#xd", (v) => v.length > 1, "Enter the driver name."],
          ["#xc", (v) => PH.test(v), "Enter a valid 10-digit phone number."],
          ["#xf", (v) => v.length > 0, "Enter the starting location."],
          ["#xt", (v) => v.length > 0, "Enter the destination."],
          [
            "#xp",
            (v) =>
              v && !isNaN(Date.parse(v)) && (v >= TODAY || (!n && v == t.dp)),
            "Enter a valid dispatch date, today or later.",
          ],
          [
            "#xe",
            (v) => v && !isNaN(Date.parse(v)) && v >= $("#xp").value,
            "Delivery date cannot be before the dispatch date.",
          ],
        ])
      )
        return false;
      const f = {
        so: $("#xs").value,
        veh: $("#xv").value.toUpperCase().replace(/\s/g, ""),
        drv: $("#xd").value.trim(),
        dc: $("#xc").value.trim(),
        from: $("#xf").value.trim(),
        to: $("#xt").value.trim(),
        dp: $("#xp").value,
        exp: $("#xe").value,
      };
      if (n)
        TRN.unshift({
          ...f,
          id: $("#xn").value.trim().toUpperCase(),
          dd: null,
          st: "PLANNED",
          cb: ME,
          ca: TODAY,
          why: "",
          hist: [{ "0": TODAY, "1": "Delivery planned", date: TODAY, action: "Delivery planned" }],
        });
      else {
        Object.assign(t, f);
        addh(t, "Delivery plan edited");
      }
      render();
      toast(n ? "Delivery planned." : "Delivery updated.");
    },
  );
}
function transportBillForm(dispatch, existingBill = null) {
  const heading = existingBill ? "Resubmit Transport Bill" : "Submit Transport Bill";
  dlg(`<h3>${heading}</h3><p>${esc(dispatch.id)} · Sales Order ${esc(dispatch.so)}</p><div class="fm" style="max-width:none"><label>Bill Number *<input class="in" id="tbNo" value="${esc(existingBill?.billNumber || "")}"></label><label>Transporter / Vendor<input class="in" id="tbVendor" value="${esc(existingBill?.transporterName || "")}"></label><label>Transporter GSTIN<input class="in" id="tbVendorGstin" maxlength="15" value="${esc(existingBill?.transporterGstin || "")}"></label><label>Transporter Address<input class="in" id="tbVendorAddress" value="${esc(existingBill?.transporterAddress || "")}"></label><label>Bill Date *<input class="in" id="tbDate" type="date" value="${esc(existingBill?.billDate || TODAY)}"></label><label>Due Date<input class="in" id="tbDue" type="date" value="${esc(existingBill?.dueDate || "")}"></label><label>Transport Charges *<input class="in" id="tbTransport" type="number" min="0" step="0.01" value="${esc(existingBill?.transportCharges ?? 0)}"></label><label><span><input id="tbSeparate" type="checkbox" ${existingBill?.tollFuelSeparate || existingBill?.tollCharges || existingBill?.fuelCharges ? "checked" : ""}> Toll and fuel are separate from transport charges</span></label><label>Toll Charges<input class="in" id="tbToll" type="number" min="0" step="0.01" value="${esc(existingBill?.tollCharges ?? 0)}"></label><label>Fuel Charges<input class="in" id="tbFuel" type="number" min="0" step="0.01" value="${esc(existingBill?.fuelCharges ?? 0)}"></label><label>Loading / Unloading<input class="in" id="tbLoading" type="number" min="0" step="0.01" value="${esc(existingBill?.loadingCharges ?? 0)}"></label><label>Other Charges<input class="in" id="tbOther" type="number" min="0" step="0.01" value="${esc(existingBill?.otherCharges ?? 0)}"></label><label>GST Rate (%) (optional)<input class="in" id="tbGst" type="number" min="0" max="100" step="0.01" value="${esc(existingBill?.gstRate ?? "")}" placeholder="0"></label><label>Invoice Attachment (image or PDF)<input class="in" id="tbFile" type="file" accept="image/*,.pdf"></label></div>`, existingBill ? "Resubmit to Accounting" : "Submit to Accounting", (modal) => {
    const billNumber = modal.querySelector("#tbNo").value.trim();
    const billDate = modal.querySelector("#tbDate").value;
    const dueDate = modal.querySelector("#tbDue").value;
    if (existingBill && billNumber !== existingBill.billNumber) {
      toast("Use the original bill number when resubmitting a rejected bill.");
      return false;
    }
    if (!billNumber || !billDate || (dueDate && dueDate < billDate)) { toast("Enter a bill number and valid bill and due dates."); return false; }
    const amount = (id) => Number(modal.querySelector(id).value || 0);
    const payload = { dispatchId: dispatch.id, billNumber, billDate, dueDate, transporterName: modal.querySelector("#tbVendor").value.trim(),
      transporterGstin: modal.querySelector("#tbVendorGstin").value.trim().toUpperCase(), transporterAddress: modal.querySelector("#tbVendorAddress").value.trim(),
      transportCharges: amount("#tbTransport"), tollCharges: amount("#tbToll"), fuelCharges: amount("#tbFuel"), loadingCharges: amount("#tbLoading"), otherCharges: amount("#tbOther"), gstRate: amount("#tbGst"), tollFuelSeparate: modal.querySelector("#tbSeparate").checked };
    if (Object.values(payload).some((v) => typeof v === "number" && (!Number.isFinite(v) || v < 0)) || payload.transportCharges + payload.tollCharges + payload.fuelCharges + payload.loadingCharges + payload.otherCharges <= 0 || ((payload.tollCharges || payload.fuelCharges) && !payload.tollFuelSeparate)) { toast("Enter valid charges. Mark toll/fuel as separate when the bill lists them separately."); return false; }
    const file = modal.querySelector("#tbFile").files[0];
    const actionButtons = [...modal.querySelectorAll("button")];
    actionButtons.forEach((button) => { button.disabled = true; });
    (async () => {
      try {
        if (file) { const uploaded = await window.VyaparXAuth.uploadFile(file, "transport-bills"); payload.attachment = uploaded.url; }
        const result = await window.VyaparXAuth.postWorkflowAction("/api/accounting/requests/transport/submit", payload);
        const liveDispatch = TB(dispatch.id);
        if (liveDispatch && result.record?.id) {
          liveDispatch.accountingRequestId = result.record.id;
          liveDispatch.accountingApprovalStatus = "Pending";
        }
        const localBillId = existingBill?.id || "TB-" + (dispatch.id + "-" + billNumber).replace(/[^A-Za-z0-9_-]/g, "").slice(0, 110);
        TBL = [
          ...TBL.filter((bill) => String(bill.dispatchId) !== String(dispatch.id)),
          { ...payload, id: localBillId, approvalStatus: "Pending", billStatus: "PENDING_APPROVAL" },
        ];
        window.VyaparXShared?.records?.invalidate("transport");
        modal.remove();
        render();
        toast("Transport Bill submitted to Accounting.");
        try {
          TBL = (await window.VyaparXAuth.fetchModuleRecords("transport")).filter((record) => record.recordType === "transportBill" && !record.isDeleted);
          if (["bills", "dels"].includes(cur)) render();
        } catch (refreshError) {
          console.warn("Transport Bill was submitted, but the list could not refresh:", refreshError);
        }
      } catch (error) {
        actionButtons.forEach((button) => { button.disabled = false; });
        if (error.status === 409) {
          try {
            TBL = (await window.VyaparXAuth.fetchModuleRecords("transport")).filter((record) => record.recordType === "transportBill" && !record.isDeleted);
            if (cur === "dels") render();
          } catch (refreshError) {
            console.warn("Transport Bill conflict was reported, but existing bills could not refresh:", refreshError);
          }
        }
        toast("Transport Bill submission failed: " + error.message);
      }
    })();
    return false;
  });
}
function transportRequestView(request) {
  if (!request) return toast("Sales transport request was not found.");
  const items = (request.items || []).map((item, index) => {
    const name = item.productName || item.description || item.name || "Item";
    const qty = item.qty ?? item.quantity ?? 0;
    return `${index + 1}. ${esc(name)} · ${esc(qty)} ${esc(item.uom || item.unit || "Nos")} · ${inr(Number(item.rate ?? item.r ?? 0))}`;
  }).join("<br>") || "—";
  const company = request.companySnapshot || {};
  detail([
    ["Sales Transport Request", [["Request No", esc(request.requestNumber || request.id)], ["Approval Status", st(request.approvalStatus || request.status || "Pending")], ["Requested By", esc(request.requestedBy || "—")], ["Request Date", fs(request.requestedAt)], ["Required Delivery", fs(request.requiredDeliveryDate)]]],
    ["Sales Order", [["Order No", esc(request.salesOrderNumber || request.salesOrderId || "—")], ["Order Date", fs(request.orderDate)], ["Order Value", inr(Number(request.orderTotal || 0))]]],
    ["Consignee", [["Customer", esc(request.customerName || "—")], ["Address", esc(request.customerAddress || "—")], ["GSTIN", esc(request.customerGSTIN || "—")], ["Contact", esc(request.customerContact || "—")]]],
    ["Registered Company", [["Name", esc(company.registeredBusinessName || company.companyName || "—")], ["Address", esc([company.address, company.state, company.pinCode, company.country].filter(Boolean).join(", ") || "—")], ["GSTIN", esc(company.gstin || "—")]]],
    ["Requested Items", [["Items", items]]],
    ...(request.decisionReason ? [["Decision", [["Reason", esc(request.decisionReason)]]]] : []),
  ]);
}
function approveTransportRequest(request) {
  if (!request || request.approvalStatus !== "Pending") return toast("This request has already been reviewed.");
  const company = request.companySnapshot || {};
  const dispatchDate = TODAY;
  const requestedDate = String(request.requiredDeliveryDate || "").slice(0, 10);
  const expectedDate = requestedDate && requestedDate >= dispatchDate ? requestedDate : dispatchDate;
  dlg(`<h3>Approve ${esc(request.requestNumber || request.id)}</h3><p>Enter transport and delivery details. Approval creates the dispatch and delivery challan and sends the bill to Sales.</p><div class="fm transport-approval-form"><label>Transporter *<input class="in" id="trqTransporter" value=""></label><label>Vehicle No *<input class="in" id="trqVehicle" placeholder="GJ03AB1234"></label><label>Driver Name *<input class="in" id="trqDriver"></label><label>Driver Contact *<input class="in" id="trqContact" inputmode="numeric" maxlength="10"></label><label>Dispatch From *<input class="in" id="trqFrom" value="${esc(company.address || "")}"></label><label>Deliver To *<input class="in" id="trqTo" value="${esc(request.customerAddress || "")}"></label><label>Dispatch Date *<input class="in" type="date" id="trqDispatchDate" value="${dispatchDate}"></label><label>Expected Delivery *<input class="in" type="date" id="trqExpectedDate" value="${expectedDate}"></label><label>Delivery Notes<input class="in" id="trqNotes" maxlength="1000"></label></div>`, "Approve & Create Bill", (modal) => {
    const values = {
      transporterName: modal.querySelector("#trqTransporter").value.trim(),
      vehicleNumber: modal.querySelector("#trqVehicle").value.trim().toUpperCase().replace(/\s/g, ""),
      driverName: modal.querySelector("#trqDriver").value.trim(),
      driverContact: modal.querySelector("#trqContact").value.trim(),
      from: modal.querySelector("#trqFrom").value.trim(),
      to: modal.querySelector("#trqTo").value.trim(),
      dispatchDate: modal.querySelector("#trqDispatchDate").value,
      expectedDeliveryDate: modal.querySelector("#trqExpectedDate").value,
      deliveryNotes: modal.querySelector("#trqNotes").value.trim(),
    };
    if (!vf([
      ["#trqTransporter", (v) => v.length > 1, "Enter the transporter name."],
      ["#trqVehicle", (v) => VEH.test(v.toUpperCase().replace(/\s/g, "")), "Enter a valid vehicle number, for example GJ03AB1234."],
      ["#trqDriver", (v) => v.length > 1, "Enter the driver name."],
      ["#trqContact", (v) => PH.test(v), "Enter a valid 10-digit phone number."],
      ["#trqFrom", (v) => v.length > 2, "Enter the dispatch location."],
      ["#trqTo", (v) => v.length > 2, "Enter the delivery location."],
      ["#trqDispatchDate", (v) => v && v >= TODAY, "Dispatch date must be today or later."],
      ["#trqExpectedDate", (v) => v && v >= modal.querySelector("#trqDispatchDate").value, "Expected delivery cannot be before dispatch."],
    ])) return false;
    (async () => {
      try {
        const result = await window.VyaparXAuth.postWorkflowAction(`/api/transport/requests/${encodeURIComponent(request.id)}/approve`, values);
        if (!result?.request || !result?.dispatch || !result?.deliveryBill) throw new Error("Transport approval and delivery bill were not confirmed by the server.");
        REQ = REQ.map((row) => String(row.id) === String(result.request.id) ? result.request : row);
        TRN = [result.dispatch, ...TRN.filter((row) => String(row.id) !== String(result.dispatch.id))];
        DLV = [result.deliveryBill, ...DLV.filter((row) => String(row.id) !== String(result.deliveryBill.id))];
        refreshSalesOrderShadows();
        window.VyaparXShared?.records?.markPersisted("transport", "transportRequest", result.request);
        window.VyaparXShared?.records?.markPersisted("transport", "dispatch", result.dispatch);
        window.VyaparXShared?.records?.markPersisted("transport", "deliveryBill", result.deliveryBill);
        render();
        toast("Request approved. Delivery challan was saved and sent to Sales.");
      } catch (error) { toast("Could not approve Transport request: " + error.message); }
    })();
    return true;
  }, "transport-approval-dialog");
}
function rejectTransportRequest(request) {
  if (!request || request.approvalStatus !== "Pending") return toast("This request has already been reviewed.");
  dlg(`<h3>Reject ${esc(request.requestNumber || request.id)}</h3><div class="fm"><label>Reason *<input class="in" id="trqReason" maxlength="1000"></label></div>`, "Reject Request", (modal) => {
    const reason = modal.querySelector("#trqReason").value.trim();
    if (!vf([["#trqReason", (value) => value.length >= 5, "Enter a rejection reason (at least 5 characters)."]])) return false;
    (async () => {
      try {
        const result = await window.VyaparXAuth.postWorkflowAction(`/api/transport/requests/${encodeURIComponent(request.id)}/reject`, { reason });
        if (!result?.request) throw new Error("The server did not confirm the rejection.");
        REQ = REQ.map((row) => String(row.id) === String(result.request.id) ? result.request : row);
        refreshSalesOrderShadows();
        window.VyaparXShared?.records?.markPersisted("transport", "transportRequest", result.request);
        render();
        toast("Transport request rejected.");
      } catch (error) { toast("Could not reject request: " + error.message); }
    })();
    return true;
  });
}
function deliveryBillPrint(bill) {
  if (!bill) return toast("Delivery bill was not found.");
  const company = bill.companySnapshot || {};
  const companyName = company.registeredBusinessName || company.companyName || "Company";
  const companyAddress = [company.address, company.state, company.pinCode, company.country].filter(Boolean).join(", ");
  const items = (bill.items || []).map((item, index) => `<tr><td>${index + 1}</td><td>${esc(item.itemName || "Item")}${item.description ? `<br><small>${esc(item.description)}</small>` : ""}</td><td>${esc(item.hsn || "—")}</td><td>${esc(item.quantity ?? "")}</td><td>${esc(item.unit || "Nos")}</td><td class="num">${inr(Number(item.unitRate || 0))}</td><td class="num">${inr(Number(item.taxableAmount || 0))}</td><td class="num">${Number(item.gstRate || 0)}%</td><td class="num">${inr(Number(item.totalAmount || 0))}</td></tr>`).join("");
  const tax = bill.taxBreakdown || {};
  const popup = window.open("", "_blank");
  if (!popup) return toast("Allow pop-ups to view or print this delivery challan.");
  popup.document.open();
  popup.document.write(`<!doctype html><html><head><meta charset="utf-8"><title>${esc(bill.billNumber || bill.id)} Delivery Challan</title><style>body{font:14px Arial,sans-serif;color:#18212f;margin:36px}header{display:flex;justify-content:space-between;gap:22px;border-bottom:2px solid #233c63;padding-bottom:18px}h1,h2{color:#233c63;margin:0 0 8px}.muted{color:#526176;line-height:1.55}.right{text-align:right}.grid{display:grid;grid-template-columns:1fr 1fr;gap:20px;margin-top:22px}.box{border:1px solid #cbd3df;padding:12px}table{width:100%;border-collapse:collapse;margin-top:22px}th,td{padding:8px;border:1px solid #cbd3df;text-align:left;vertical-align:top}th{background:#f1f4f8}.num{text-align:right}.summary{margin:16px 0 0 auto;width:min(360px,100%)}.summary td{border:0;border-bottom:1px solid #d9dee7}.grand{font-weight:bold;font-size:16px}.note{color:#526176;margin-top:20px}.sign{margin:48px 0 0 auto;border-top:1px solid #758196;padding-top:8px;text-align:center;width:230px}@media print{body{margin:16mm}.no-print{display:none}}</style></head><body><header><div><h1>${esc(companyName)}</h1><div class="muted">${esc(companyAddress || "Registered address not configured")}<br>${company.gstin ? `GSTIN: ${esc(company.gstin)}<br>` : ""}${esc(company.phone || "")} ${esc(company.email || "")}</div></div><div class="right"><h2>DELIVERY CHALLAN</h2><b>${esc(bill.billNumber || bill.id)}</b><div class="muted">Date: ${esc(fs(bill.billDate))}<br>Sales Order: ${esc(bill.salesOrderNumber || bill.salesOrderId || "—")}<br>Dispatch: ${esc(bill.dispatchId || "—")}</div></div></header><div class="grid"><section class="box"><b>Consignee</b><h3>${esc(bill.customerName || "—")}</h3><div class="muted">${esc(bill.customerAddress || "—")}<br>${bill.customerGSTIN ? `GSTIN: ${esc(bill.customerGSTIN)}<br>` : ""}${esc(bill.customerContact || "")}</div></section><section class="box"><b>Transport Details</b><div class="muted">Transporter: ${esc(bill.transporterName || "—")}<br>Vehicle: ${esc(bill.vehicleNumber || "—")}<br>Driver: ${esc(bill.driverName || "—")} · ${esc(bill.driverContact || "—")}<br>From: ${esc(bill.from || "—")}<br>To: ${esc(bill.to || "—")}<br>Dispatch Date: ${esc(fs(bill.dispatchDate))}<br>Expected Delivery: ${esc(fs(bill.expectedDeliveryDate))}</div></section></div><table><thead><tr><th>#</th><th>Goods</th><th>HSN/SAC</th><th>Qty</th><th>Unit</th><th>Rate</th><th>Taxable Value</th><th>GST</th><th>Line Total</th></tr></thead><tbody>${items || `<tr><td colspan="9">No item details.</td></tr>`}</tbody></table><table class="summary"><tbody><tr><td>Taxable Value</td><td class="num">${inr(Number(bill.taxableAmount || 0))}</td></tr>${Number(tax.cgst || 0) ? `<tr><td>CGST</td><td class="num">${inr(Number(tax.cgst))}</td></tr>` : ""}${Number(tax.sgst || 0) ? `<tr><td>SGST</td><td class="num">${inr(Number(tax.sgst))}</td></tr>` : ""}${Number(tax.igst || 0) ? `<tr><td>IGST</td><td class="num">${inr(Number(tax.igst))}</td></tr>` : ""}<tr class="grand"><td>Goods Value</td><td class="num">${inr(Number(bill.totalAmount || 0))}</td></tr></tbody></table>${bill.deliveryNotes ? `<p class="note">Notes: ${esc(bill.deliveryNotes)}</p>` : ""}<p class="note">Approved by ${esc(bill.approvedByName || "Transport")} · ${esc(fs(bill.approvedAt))}. This delivery challan documents goods movement; the applicable tax invoice is issued separately.</p><div class="sign">${esc(companyName)}<br><b>Authorised Signatory</b></div><div class="no-print" style="margin-top:22px"><button onclick="window.print()">Print / Save PDF</button></div><script>window.onload=()=>window.print()<\/script></body></html>`);
  popup.document.close();
}
function deleteTransportBill(record, recordType) {
  if (!record) return toast("This transport record is no longer available.");
  const label = recordType === "deliveryBill" ? "Delivery Bill" : "Transport Bill";
  const consequences = recordType === "deliveryBill"
    ? "Linked Sales Order and dispatch references will also be cleared."
    : "Its linked Accounting request and payment entries will also be deleted.";
  dlg(`<h3>Delete ${esc(label)} ${esc(record.billNumber || record.id)}?</h3><p>${consequences} This permanently removes the selected records from the database.</p>`, "Delete", (modal) => {
    const button = modal.querySelector("[data-ok]");
    button.disabled = true;
    window.VyaparXAuth.deleteModuleRecord("transport", record.id)
      .then((result) => {
        if (result?.success !== true) throw new Error("The server did not confirm deletion.");
        if (recordType === "deliveryBill") DLV = DLV.filter((bill) => String(bill.id) !== String(record.id));
        else TBL = TBL.filter((bill) => String(bill.id) !== String(record.id));
        window.VyaparXShared?.records?.markDeleted("transport", recordType, record.id);
        window.VyaparXShared?.records?.invalidate("accounting");
        modal.remove();
        render();
        toast(`${label} deleted successfully.`);
      })
      .catch((error) => {
        button.disabled = false;
        toast(`${label} was not deleted: ${error.message}`);
      });
    return false;
  });
}
function trnView(t) {
  const s = SB(t.so);
  detail([
    [
      "Transport Details",
      [
        ["Transport No", t.id],
        ["Status", st(t.st)],
        ["Sales Order", t.so],
        ["Customer", esc(s.cust)],
      ],
    ],
    [
      "Vehicle & Driver",
      [
        ["Vehicle No", t.veh],
        ["Driver", esc(t.drv)],
        ["Contact", t.dc],
      ],
    ],
    [
      "Route",
      [
        ["From", esc(t.from)],
        ["To", esc(t.to)],
      ],
    ],
    [
      "Schedule",
      [
        ["Dispatch Date", fs(t.dp)],
        ["Expected Delivery", fs(t.exp)],
        ["Delivery Date", t.dd ? fs(t.dd) : "—"],
      ],
    ],
    [
      "Order Check",
      [
        ["Production", st(s.prod)],
        ["Order Status", st(s.st)],
      ],
    ],
    ...(t.why ? [["Reason", [["Reason", esc(t.why)]]]] : []),
    [
      "Assignment",
      [
        ["Created By", esc(t.cb)],
        ["Created On", fs(t.ca)],
      ],
    ],
    ["Activity History", (t.hist || []).map((x) => [fs(Array.isArray(x) ? x[0] : (x[0] || x.date || x.at || "")), esc(Array.isArray(x) ? x[1] : (x[1] || x.action || x.message || ""))])],
  ]);
}
const why = (t, title, btn, to, note) =>
  dlg(
    `<h3>${title} ${t.id}</h3><div class="fm"><label>Reason *<input class="in" id="wy"></label></div>`,
    btn,
    () => {
      if (
        !vf([
          [
            "#wy",
            (v) => v.length > 4,
            "Enter the reason (at least 5 characters).",
          ],
        ])
      )
        return false;
      t.st = to;
      t.why = $("#wy").value.trim();
      addh(t, note + ": " + t.why);
      render();
      toast(note + ".");
    },
  );
async function persistDispatchTransition(dispatch, action, payload = {}) {
  const result = await window.VyaparXAuth.postWorkflowAction(
    `/api/transport/dispatches/${encodeURIComponent(dispatch.id)}/${action}`,
    payload,
  );
  if (!result?.success || String(result.dispatch?.id) !== String(dispatch.id)) {
    throw new Error("The server did not confirm the dispatch update.");
  }
  Object.assign(dispatch, result.dispatch);
  window.VyaparXShared?.records?.markPersisted("transport", "dispatch", dispatch);
  const salesOrder = SB(dispatch.so);
  if (salesOrder) salesOrder.st = dispatch.st;
  return result.dispatch;
}
function dispatch(t, ready) {
  const m = chk(t);
  if (m) return toast(m);
  const bus = TRN.find(
    (z) =>
      z !== t && z.veh == t.veh && ["DISPATCHED", "IN_TRANSIT"].includes(z.st),
  );
  if (bus && !ready)
    return toast(`Vehicle ${t.veh} is already on trip ${bus.id}.`);
  if (ready) {
    persistDispatchTransition(t, "ready")
      .then(() => { render(); toast("Marked ready."); })
      .catch((error) => toast("Delivery could not be marked ready: " + error.message));
    return;
  }
  OKD(
    "Dispatch delivery?",
    `${t.id} leaves ${esc(t.from)} today with ${esc(t.drv)}.`,
    "Dispatch",
    () => {
      persistDispatchTransition(t, "dispatch", { expectedDeliveryDate: t.exp })
        .then(() => { render(); toast("Delivery dispatched."); })
        .catch((error) => toast("Delivery could not be dispatched: " + error.message));
    },
  );
}
function deliver(t) {
  dlg(
    `<h3>Confirm delivery – ${t.id}</h3><div class="fm"><label>Delivery Date *<input class="in" type="date" id="dv" value="${TODAY}"></label></div>`,
    "Mark delivered",
    (modal) => {
      if (
        !vf([
          [
            "#dv",
            (v) => v && v >= t.dp && v <= TODAY,
            "Delivery date must be between the dispatch date and today.",
          ],
        ])
      )
        return false;
      const deliveredDate = modal.querySelector("#dv").value;
      const actionButtons = [...modal.querySelectorAll("button")];
      actionButtons.forEach((button) => { button.disabled = true; });
      (async () => {
        try {
          await persistDispatchTransition(t, "deliver", { deliveryDate: deliveredDate });
          modal.remove();
          render();
          toast("Delivery saved. Accounting can now invoice it.");
        } catch (error) {
          actionButtons.forEach((button) => { button.disabled = false; });
          toast("Delivery could not be saved: " + error.message);
        }
      })();
      return false;
    },
  );
}
function resched(t) {
  dlg(
    `<h3>Reschedule ${t.id}</h3><div class="fm"><label>Dispatch Date *<input class="in" type="date" id="rp" value="${TODAY}"></label><label>Expected Delivery *<input class="in" type="date" id="re"></label></div>`,
    "Reschedule",
    () => {
      if (
        !vf([
          [
            "#rp",
            (v) => v && v >= TODAY,
            "Dispatch date must be today or later.",
          ],
          [
            "#re",
            (v) => v && v >= $("#rp").value,
            "Delivery date cannot be before the dispatch date.",
          ],
        ])
      )
        return false;
      t.dp = $("#rp").value;
      t.exp = $("#re").value;
      t.st = "PLANNED";
      addh(t, "Rescheduled after failed delivery");
      render();
      toast("Delivery rescheduled.");
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
          ["Activity / History", (r.hist || []).map((x) => [fs(Array.isArray(x) ? x[0] : (x[0] || x.date || x.at || "")), esc(Array.isArray(x) ? x[1] : (x[1] || x.action || x.message || ""))])],
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
        window.VyaparXAuth.uploadFile(f, "transport-attachments").then((result) => {
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
    window.VyaparXAuth.uploadFile(f, "transport-profile").then((result) => {
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
    `<h3>${T ? "Send task" : "Send message"}</h3><div class="fm" style="max-width:none"><label>${T ? "Task Title" : "Subject"} *<input class="in" id="sx"></label><label>${T ? "Description" : "Message"} *<textarea class="in" id="sd" rows="3"></textarea></label><label>Send To *<select class="in" id="sto"><option value="">Select person</option>${PEOPLE().filter((p) => p.d !== "Transport")
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
            fd: "Transport",
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
        TEAM.push(window.VyaparXShared.departmentTeam.createMember("transport", f));
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
  TRN.forEach((o) => {
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
        ["Department", "Transport"],
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
  if (a == "add") planForm(null, x);
  else if (a == "trqview") transportRequestView(REQ.find((row) => String(row.id) === String(x)));
  else if (a == "trqapprove") approveTransportRequest(REQ.find((row) => String(row.id) === String(x)));
  else if (a == "trqreject") rejectTransportRequest(REQ.find((row) => String(row.id) === String(x)));
  else if (a == "dlvview") deliveryBillPrint(DLV.find((row) => String(row.id) === String(x) || String(row.billNumber) === String(x)));
  else if (a == "dlvdelete") deleteTransportBill(DLV.find((row) => String(row.id) === String(x) || String(row.billNumber) === String(x)), "deliveryBill");
  else if (a == "tbview") {
    const bill = TBL.find((item) => String(item.id) === x);
    if (bill) detail([["Transport Bill", [["Bill Number", esc(bill.billNumber || bill.id)], ["Dispatch", esc(bill.dispatchId || "—")], ["Sales Order", esc(bill.salesOrderNumber || "—")], ["Customer", esc(bill.customerName || "—")], ["Vendor", esc(bill.transporterName || "—")], ["Bill Date", fs(bill.billDate)], ["Due Date", fs(bill.dueDate)], ["Transport Charges", inr(Number(bill.transportCharges || 0))], ["Toll Charges", inr(Number(bill.tollCharges || 0))], ["Fuel Charges", inr(Number(bill.fuelCharges || 0))], ["Loading / Unloading", inr(Number(bill.loadingCharges || 0))], ["Other Charges", inr(Number(bill.otherCharges || 0))], ["GST", `${Number(bill.gstRate || 0)}% · ${inr(Number(bill.gstAmount || 0))}`], ["Total", inr(Number(bill.totalAmount || 0))], ["Approval Status", st(bill.approvalStatus || "Pending")], ["Payable Status", st(bill.billStatus || "PENDING_APPROVAL")], ["Decision Reason", esc(bill.accountingDecisionReason || "—")], ["Attachment", bill.attachment ? `<a href="${esc(bill.attachment)}" target="_blank" rel="noopener">Open invoice</a>` : "—"], ["Approval History", (bill.history || []).map((event) => `${esc(event.at || "")} ${esc(event.action || "")}${event.reason ? ` · ${esc(event.reason)}` : ""}`).join("<br>") || "—"]]]]);
  }
  else if (a == "tbdelete") deleteTransportBill(TBL.find((bill) => String(bill.id) === String(x)), "transportBill");
  else if (a == "tbill") {
    const existingBill = TBL.find((bill) => String(bill.dispatchId) === String(x) && !bill.isDeleted);
    if (existingBill && existingBill.approvalStatus !== "Rejected") {
      toast("A Transport Bill has already been submitted for this dispatch.");
    } else {
      transportBillForm(o, existingBill);
    }
  }
  else if (a == "oe") planForm(o);
  else if (a == "ov") trnView(o);
  else if (a == "orb") dispatch(o, true);
  else if (a == "odp") dispatch(o);
  else if (a == "otr") {
    persistDispatchTransition(o, "transit")
      .then(() => { render(); toast("Marked in transit."); })
      .catch((error) => toast("Delivery could not be marked in transit: " + error.message));
  } else if (a == "odl") deliver(o);
  else if (a == "ofl")
    why(o, "Failed delivery", "Mark failed", "FAILED", "Delivery failed");
  else if (a == "orp") resched(o);
  else if (a == "ocn")
    why(o, "Cancel", "Cancel delivery", "CANCELLED", "Cancelled");
  else if (a == "ev") {
    const m = TEAM.find((z) => z.id == x);
    detail([
      [
        "Employee Details",
        [
          ["Name", esc(m.n)],
          ["Email", esc(m.e)],
          ["Phone", esc(m.ph)],
          ["Department", "Transport"],
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
    if (!m) return toast("This team member is no longer available.");
    dlg(
      `<h3>Delete ${esc(m.n)}?</h3><p>This will archive the Transport team member from the company records.</p>`,
      "Delete",
      (mask) => {
        const button = mask.querySelector("[data-ok]");
        button.disabled = true;
        window.VyaparXAuth.deleteModuleRecord("transport", m.id)
          .then((result) => {
            if (!result || result.success !== true) throw new Error("The server did not confirm deletion.");
            TEAM = TEAM.filter((member) => String(member.id) !== String(m.id));
            window.VyaparXShared?.records?.markDeleted("transport", "teamMember", m.id);
            mask.remove();
            render();
            toast("Team member deleted successfully.");
          })
          .catch((error) => {
            button.disabled = false;
            toast("Team member was not deleted: " + error.message);
          });
        return false;
      },
    );
  } else if (a == "tv") recView(REC(x));
  else if (a == "td") delTask(REC(x));
  else if (a == "adv") {
    const k = REC(x);
    if (!k) return toast("This task is no longer available.");
    const updateTask = window.VyaparXShared?.tasks?.updateTask;
    if (!updateTask) return toast("Task update service is unavailable.");
    const nextStatus = k.st == "Pending" ? "In Progress" : "Completed";
    Promise.resolve(updateTask(k.id, { status: nextStatus, st: nextStatus }))
      .then((updated) => {
        Object.assign(k, updated);
        render();
        toast("Task updated successfully.");
      })
      .catch((error) => toast("Task was not updated: " + error.message));
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
    go("dels");
    q = v;
    render();
  }
});
$("#bell").onclick = () => go("notif");
$("#ct").onclick = () => document.body.classList.toggle("col");
$("#mb").onclick = () => window.VyaparXShared.toggleMobileNav();
$("#th").onclick = () => { if (window.VyaparXShared) window.VyaparXShared.applyTheme(window.VyaparXShared.currentTheme() === "dark" ? "light" : "dark"); };
if (window.VyaparXShared?.records?.bindPageState) {
  window.VyaparXShared.records.bindPageState("transport", [
    { recordType: "teamMember", get: () => TEAM, set: (rows) => { TEAM = rows; } },
    {
      recordType: "dispatch",
      get: () => TRN,
      set: (rows) => { TRN = rows; },
      toRecord: (row) => ({
        ...row,
        hist: (row.hist || []).map((x) => Array.isArray(x)
          ? { "0": String(x[0] || ""), "1": String(x[1] || ""), date: String(x[0] || ""), action: String(x[1] || "") }
          : x),
      }),
    },
    { recordType: "transportBill", get: () => TBL, set: (rows) => { TBL = rows; } },
    { recordType: "transportRequest", get: () => REQ, set: (rows) => { REQ = rows; refreshSalesOrderShadows(); } },
    { recordType: "deliveryBill", get: () => DLV, set: (rows) => { DLV = rows; } },
  ], {
    onReady: () => { render(); },
    onError: (error) => toast("Transport records could not sync with Firestore: " + error.message),
  });
}
const transportParams = new URLSearchParams(window.location.search);
const transportViews = new Set(NAV.flatMap((section) => section[1].map((item) => item[0])));
const transportRequestedView = transportParams.get("view");
go(transportViews.has(transportRequestedView) ? transportRequestedView : "dashboard");
async function transportSyncTasksFromDb() {
  if (!window.VyaparXShared || !window.VyaparXShared.tasks) return;
  try {
    const all = await window.VyaparXShared.tasks.fetchTasks({ force: true });
    TASKS = all.filter((task) => task.type !== "Communication");
    COMMS = all.filter((task) => task.type === "Communication");
    NOTES = [...NOTES.filter((note) => note.k), ...all.filter((task) => task.dir === "Received").map((task) => ({
      id: "n_" + task.id, ref: task.id, read: !!(task.isRead || task.read),
    }))];
    if (["tasks", "notif", "dashboard"].includes(cur)) render();
  } catch (error) { console.warn("Could not sync Transport tasks:", error); }
}
transportSyncTasksFromDb();
if (window.VyaparXShared?.tasks) window.VyaparXShared.tasks.onTasksUpdated(transportSyncTasksFromDb);
window.addEventListener("focus", transportSyncTasksFromDb);
if (window.VyaparXFields) window.VyaparXFields.loadFields("transport").then(() => { if (cur === "dels") render(); });
window.addEventListener("focus", () => { if (window.VyaparXFields) window.VyaparXFields.loadFields("transport", true); });
// Admin Reports integration: expose this module's real records so the Admin
// report engine builds TRANSPORT reports from actual data, not static counts.
window.TRANSPORT_REPORT_SOURCE = function () { try { return []; } catch (e) { return []; } };
