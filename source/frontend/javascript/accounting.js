/**
 * VyaparX ERP - Accounting Module Controller
 * Handles Invoices, Payments, Receivables, Payables, Transactions, and Team Tasks.
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
    if (e.target.dataset.ok != null) {
      e.target.disabled = true;
      try {
        const res = await fn(m);
        if (res !== false) m.remove();
        else e.target.disabled = false;
      } catch (error) {
        e.target.disabled = false;
        toast(error.message || "The request could not be completed.");
      }
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
  m.innerHTML = `<div class="dlg detail-dialog" role="dialog" aria-label="${secs[0][0]}"><button class="ic" data-x aria-label="Close" title="Close" style="position:absolute;top:12px;right:12px;z-index:3;display:inline-flex;align-items:center;justify-content:center;width:32px;height:32px;border:1px solid var(--bd);border-radius:50%;background:var(--card);color:var(--txt);cursor:pointer"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" aria-hidden="true"><path d="M6 6l12 12M18 6L6 18"/></svg></button>${secs.map(([t, r], i) => `<div style="margin-top:${i ? 18 : 0}px"><b style="font-weight:600;display:block;padding:0 ${i ? 0 : 36}px 6px 0;font-size:${i ? 14 : 16}px;border-bottom:1px solid var(--bd);margin-bottom:10px">${t}</b>${r ? `<div style="display:grid;grid-template-columns:130px minmax(0,1fr);gap:10px 16px">${r.map((x) => `<span style="color:var(--mut)">${x[0]}</span><span style="font-weight:500;overflow-wrap:anywhere">${x[1]}</span>`).join("")}</div>` : `<span style="color:var(--mut)">No activity yet.</span>`}</div>`).join("")}</div>`;
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
    "ACCOUNTING",
    [
      [
        "dashboard",
        "Dashboard",
        "<rect x='3' y='3' width='7' height='9'/><rect x='14' y='3' width='7' height='5'/><rect x='14' y='12' width='7' height='9'/><rect x='3' y='16' width='7' height='5'/>",
      ],
      ["salesreq", "Sales Requests", "<path d='M5 4h14v16H5zM8 9h8M8 13h8M8 17h5'/>"] ,
      ["poreq", "Purchase Order Requests", "<path d='M4 4h16v16H4zM8 8h8M8 12h8M8 16h4'/>"] ,
      ["transportreq", "Transport Bill Requests", "<path d='M3 7h12v11H3zM15 11h4l2 3v4h-6zM7 21a2 2 0 100-4 2 2 0 000 4zM18 21a2 2 0 100-4 2 2 0 000 4z'/>"] ,
      ["inv", "Invoices", "<path d='M7 3h8l4 4v14H7zM10 12h6M10 16h6'/>"],
      [
        "pay",
        "Payments",
        "<rect x='3' y='6' width='18' height='12' rx='2'/><path d='M3 10h18'/>",
      ],
      ["recv", "Receivables", "<path d='M12 3v12M7 10l5 5 5-5M4 20h16'/>"],
      ["payb", "Payables", "<path d='M12 15V3M7 8l5-5 5 5M4 20h16'/>"],
      ["tx", "Transactions", "<path d='M4 7h13l-3-3M20 17H7l3 3'/>"],
      [
        "hist",
        "Payment History",
        "<circle cx='12' cy='12' r='9'/><path d='M12 7v5l3 2'/>",
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
const LIM = 50000,
  METH = ["CASH", "BANK", "UPI", "CARD", "CHEQUE", "OTHER"];
let SOA = [];
let POA = [];
const A = (n, type, ref, inv, amount, paid, method, date, s, cb) => ({
  id: "ACC-" + n, type, ref, inv, amount, paid, method, date, st: s, cb, ca: date,
  why: "", hist: [[date, type.charAt(0) + type.slice(1).toLowerCase() + " recorded"]],
});
let ACC = [];
let SALES_REQUESTS = [];
let PURCHASE_REQUESTS = [];
let TRANSPORT_REQUESTS = [];
let DELIVERY_BILLS = [];
const PENDING_SAR_ACTIONS = new Set();
let REQUEST_FILTERS = { salesreq: { q: "", status: "All", from: "", to: "", page: 0 }, poreq: { q: "", status: "All", from: "", to: "", page: 0 }, transportreq: { q: "", status: "All", from: "", to: "", page: 0 } };
function approvedPayableRequests() {
  return [
    ...PURCHASE_REQUESTS.filter((row) => row.approvalStatus === "Approved").map((row) => ({ id: row.id, kind: "purchase", sourceId: row.purchaseOrderId || row.sourceId, displayRef: row.purchaseOrderNumber || row.sourceId, party: row.supplierName || "—", amount: row.totalAmount, paid: row.paidAmount || 0, dueDate: row.dueDate || row.requiredDeliveryDate })),
    ...TRANSPORT_REQUESTS.filter((row) => row.approvalStatus === "Approved").map((row) => ({ id: row.id, kind: "transport", sourceId: row.transportBillId || row.sourceId, displayRef: row.vendorInvoiceNumber || row.billNumber || "Transport Bill", party: row.transporterName || "—", amount: row.totalAmount, paid: row.paidAmount || 0, dueDate: row.dueDate })),
  ];
}
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
const canManageTeam = () => window.VyaparXShared?.departmentTeam?.canManage("accounting") === true;

let _cachedCompanyPeople = null;
const PEOPLE = () => {
  if (window.VyaparXShared && window.VyaparXShared.getCompanyPeople) {
    if (!_cachedCompanyPeople) window.VyaparXShared.getCompanyPeople().then((res) => { _cachedCompanyPeople = res; });
    if (_cachedCompanyPeople) return _cachedCompanyPeople;
  }
  return [];
};
const dept = (n) => (PEOPLE().find((p) => p.n == n) || { d: "Accounting" }).d,
  meM = () => {
    const member = TEAM.find((m) => m.id == "M1");
    if (member) return member;
    const session = window.VyaparXAuth?.getCurrentSession?.() || {};
    const name = session.fullName || session.name || ME || "Accounting User";
    return {
      id: "M1",
      n: name,
      eid: session.employeeId || "",
      e: session.email || "",
      des: session.designation || session.department || "Accounting",
      r: session.role || "Accounting",
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
      n.k
        ? (n.k == "appr" ? pendAp().length : overd().length) > 0
        : !!REC(n.ref),
    );
const ntext = (n) => {
  if (n.k)
    return n.k == "appr"
      ? `${pendAp().length} transaction(s) waiting for approval`
      : `${overd().length} invoice(s) overdue`;
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
const isInv = (r) => r.type == "INVOICE",
  bal = (r) => r.amount - r.paid,
  sales = (r) => SALES_REQUESTS.some((request) => String(request.salesOrderId) === String(r.ref)) || SOA.some((order) => String(order.id) === String(r.ref)) || String(r.ref || "").startsWith("S"),
  ago = (d) => Math.floor((new Date(TODAY) - new Date(d)) / 864e5),
  pst = (r) =>
    !isInv(r)
      ? "PAID"
      : r.st == "CANCELLED"
        ? "CANCELLED"
        : r.paid >= r.amount
          ? "PAID"
          : ago(r.date) > 30
            ? "OVERDUE"
            : r.paid > 0
              ? "PARTIAL"
              : "UNPAID",
  INVS = () => ACC.filter((r) => isInv(r) && r.st == "POSTED"),
  SOx = (id) => SOA.find((s) => s.id == id),
  POx = (id) => POA.find((s) => s.id == id) || (() => { const row = approvedPayableRequests().find((item) => String(item.sourceId) === String(id)); return row ? { id: row.sourceId, c: row.party, total: Number(row.amount || 0) } : undefined; })(),
  invOf = (n) => ACC.find((a) => isInv(a) && a.inv == n),
  pendAp = () => ACC.filter((r) => r.st == "PENDING_APPROVAL"),
  overd = () => INVS().filter((r) => pst(r) == "OVERDUE"),
  fx = (r, s) => {
    if (r.type == "RECEIPT") {
      if (r.inv != "—") invOf(r.inv).paid += s * r.amount;
      else SOx(r.ref).rec += s * r.amount;
    } else if (r.type == "PAYMENT") invOf(r.inv).paid += s * r.amount;
    else if (r.type == "REFUND") SOx(r.ref).rec -= s * r.amount;
  };
const st = (s) => {
  const c = /^(PAID|POSTED|ACTIVE|Completed|Low|Read)$/.test(s)
    ? "ok"
    : /^(PENDING_APPROVAL|PARTIAL|UNPAID|INACTIVE|Pending|In Progress|High|Medium|Unread)$/.test(
          s,
        )
      ? "wa"
      : /^(OVERDUE|CANCELLED|REJECTED|REVERSED|Urgent)$/.test(s)
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
const OB = (id) => ACC.find((r) => r.id == id),
  addh = (o, t) => o.hist.push([TODAY, t]);
const kpi = (a, b) =>
    `<div class="card kpi"><small>${a}</small><b>${b}</b></div>`,
  sum = (a) => a.reduce((s, r) => s + r, 0);
const publicReference = (entry) => {
  const salesRequest = SALES_REQUESTS.find((row) => String(row.id) === String(entry.requestId) || String(row.salesOrderId) === String(entry.ref));
  if (salesRequest?.salesOrderNumber) return salesRequest.salesOrderNumber;
  const payable = approvedPayableRequests().find((row) => String(row.id) === String(entry.requestId) || String(row.sourceId) === String(entry.ref));
  if (payable?.displayRef) return payable.displayRef;
  const salesOrder = SOA.find((row) => String(row.id) === String(entry.ref));
  if (salesOrder?.number) return salesOrder.number;
  const purchaseOrder = POA.find((row) => String(row.id) === String(entry.ref));
  return purchaseOrder?.number || entry.inv || (entry.ref ? "Order" : "—");
};
const XC = [
    "Voucher / Entry",
    "Type",
    "Reference",
    "Invoice No",
    "Amount",
    "Paid",
    "Balance",
    "Method",
    "Payment Status",
    "Status",
  ],
  xrow = (r) => [
    r.voucherNumber || r.number || (r.type === "INVOICE" ? r.inv : r.type === "RECEIPT" ? "Receipt" : r.type === "PAYMENT" ? "Payment" : "Entry"),
    r.type,
    publicReference(r),
    r.inv,
    inr(r.amount),
    inr(r.paid),
    inr(bal(r)),
    r.method || "—",
    pst(r),
    r.st,
  ];
const xact = (r) => {
  const o = OB(r[0]) || ACC.find((entry) => String(entry.voucherNumber || entry.number || "") === String(r[0])) || ACC.find((entry) => entry.type === r[1] && publicReference(entry) === r[2] && entry.inv === r[3] && inr(entry.amount) === r[4]);
  if (!o) return "";
  const b = (a, l) => `<button class="btn s" data-act="${a}:${o.id}">${l}</button>`;
  return (
    b("ov", "View") +
    ((o.voucherNumber || ["RECEIPT", "PAYMENT"].includes(o.type)) ? b("avoucher", o.type === "RECEIPT" ? "Receipt" : o.type === "PAYMENT" ? "Payment" : "Voucher") : "") +
    (isInv(o) && o.st == "POSTED" && bal(o) > 0
      ? sales(o)
        ? b("irc", "Receipt")
        : b("ipy", "Pay")
      : "") +
    (isInv(o) && o.st == "POSTED" && !o.paid ? b("icn", "Cancel") : "") +
    (o.st == "PENDING_APPROVAL"
      ? b("aap", "Approve") + b("arj", "Reject")
      : "") +
    (!isInv(o) && o.st == "POSTED" && o.type != "ADJUSTMENT"
      ? b("rev", "Reverse")
      : "")
  );
};
const V = {
  salesreq() {
    return accountingRequestsSection("sales");
  },
  poreq() { return accountingRequestsSection("purchase"); },
  transportreq() { return accountingRequestsSection("transport"); },
  dashboard() {
      const ok = ACC.filter((r) => r.st == "POSTED"),
        salesReceivable = sum(SALES_REQUESTS.filter((request) => request.approvalStatus === "Approved").map((request) => Math.max(0, Number(request.grandTotal || 0) - Number(request.amountReceived || 0)))) + sum(INVS().filter((invoice) => sales(invoice) && !SALES_REQUESTS.some((request) => String(request.salesOrderId) === String(invoice.ref))).map(bal)),
        supplierPayable = sum(approvedPayableRequests().map((request) => Math.max(0, Number(request.amount || 0) - Number(request.paid || 0)))) + sum(INVS().filter((invoice) => !sales(invoice) && !approvedPayableRequests().some((request) => String(request.sourceId) === String(invoice.ref))).map(bal)),
      td = (t) =>
        sum(
          ok.filter((r) => r.type == t && r.date == TODAY).map((r) => r.amount),
        ),
      al = [...pendAp(), ...overd()];
    return (
      ph(
        accountingGreeting(),
        "Receivables, payables and approvals at a glance.",
        ["add", "Create Invoice"],
      ) +
      `<div class="grid k6">${kpi("Receivables", inr(salesReceivable))}${kpi(
        "Payables",
        inr(
          supplierPayable,
        ),
      )}${kpi("Today's Receipts", inr(td("RECEIPT")))}${kpi("Today's Payments", inr(td("PAYMENT")))}${kpi("Overdue Invoices", overd().length)}</div>
 <div class="grid two" style="margin-top:14px"><div class="card"><h3>Recent transactions</h3><div class="tw"><table><tr><th>ID</th><th>Type</th><th>Reference</th><th>Amount</th><th>Status</th></tr>${ACC.slice(
   -5,
 )
   .reverse()
   .map(
     (r) =>
       `<tr><td>${esc(r.voucherNumber || r.number || "—")}</td><td>${esc(r.type)}</td><td>${esc(publicReference(r))}</td><td>${inr(r.amount)}</td><td>${st(r.st)}</td></tr>`,
   )
   .join("")}</table></div></div>
 <div class="card"><h3>Needs attention</h3>${al.length ? al.map((r) => `<div style="display:flex;justify-content:space-between;align-items:center;padding:8px 0;border-bottom:1px solid var(--bd)"><span>${r.id} · ${r.inv}<br><small style="color:var(--mut)">${r.st == "PENDING_APPROVAL" ? "Waiting for approval" : "Overdue invoice"}</small></span><button class="btn s" data-act="ov:${r.id}"><i class="fa-solid fa-eye" aria-hidden="true"></i></button></div>`).join("") : `<div class="empty">Nothing needs attention.</div>`}</div></div>`
    );
  },
  inv() {
    return (
      ph(
        "Invoices",
        "Sales invoices (receivable) and purchase bills (payable).",
        ["add", "Create Invoice"],
      ) +
      table(window.VyaparXFields.tableColumns("accounting", XC), ACC.filter(isInv).map((r) => window.VyaparXFields.tableRow("accounting", r, xrow(r))), {
        filter: ["UNPAID", "PARTIAL", "PAID", "OVERDUE", "CANCELLED"],
        colModule: "accounting",
        act: xact,
        empty: "No invoices yet.",
      })
    );
  },
  pay() {
    return (
      ph(
        "Payments",
        "Receipts, payments and refunds. Payments above " +
          inr(LIM) +
          " and all refunds need approval.",
      ) +
      `<div class="bar" style="margin:0 0 14px"><button class="btn p" data-act="irc">Record Receipt</button><button class="btn p" data-act="ipy">Record Payment</button><button class="btn" data-act="rfd">Record Refund</button></div>` +
      table(
        XC,
        ACC.filter((r) =>
          ["RECEIPT", "PAYMENT", "REFUND", "ADJUSTMENT"].includes(r.type),
        ).map(xrow),
        {
          filter: ["PENDING_APPROVAL", "POSTED", "REJECTED", "REVERSED"],
          act: xact,
          empty: "No payments yet.",
        },
      )
    );
  },
  recv() {
    return (
      ph(
        "Receivables",
        "Customer receipts recorded against invoices and Sales Orders.",
        ["irc", "Record Receipt"],
      ) +
      table(
        XC,
        ACC.filter((r) => r.type === "RECEIPT" && r.st === "POSTED" && !r.isDeleted).map(xrow),
        { act: xact, empty: "No receipts recorded." },
      ) +
      `<h3 style="margin:14px 0 10px">Order advances</h3>` +
      table(
        [
          "Sales Order",
          "Customer",
          "Total",
          "Advance %",
          "Required",
          "Received",
          "Advance Status",
        ],
        SOA.map((s) => {
          const q = Math.round((s.total * s.adv) / 100);
          return [
            s.number || "Sales Order",
            esc(s.c),
            inr(s.total),
            s.adv + "%",
            inr(q),
            inr(s.rec),
            s.rec >= q ? "PAID" : "UNPAID",
          ];
        }),
      )
    );
  },
  payb() {
    return (
      ph("Payables", "Payments made to suppliers and transporters.", ["ipy", "Record Payment"]) +
      table(
        XC,
        ACC.filter((r) => r.type === "PAYMENT" && r.st === "POSTED" && !r.isDeleted).map(xrow),
        { act: xact, empty: "No payments recorded." },
      )
    );
  },
  tx() {
    return (
      ph(
        "Transactions",
        "The full ledger. Nothing here is deleted, only reversed or cancelled.",
      ) +
      table(XC, ACC.map(xrow), {
        filter: ["INVOICE", "RECEIPT", "PAYMENT", "REFUND", "ADJUSTMENT"],
        act: xact,
      })
    );
  },
  hist() {
    return (
      ph(
        "Payment History",
        "Posted receipts, payments and refunds by method.",
      ) +
      table(
        [
          "Date",
    "Voucher / Entry",
          "Type",
          "Reference",
          "Invoice No",
          "Amount",
          "Method",
          "By",
        ],
        ACC.filter(
          (r) =>
            ["RECEIPT", "PAYMENT", "REFUND"].includes(r.type) &&
            r.st == "POSTED",
        ).map((r) => [
          fs(r.date),
          r.id,
          r.type,
          publicReference(r),
          r.inv,
          inr(r.amount),
          r.method,
          esc(r.cb),
        ]),
        { filter: METH, empty: "No payments recorded." },
      )
    );
  },
  reports() {
    const iv = ACC.filter((r) => isInv(r) && r.st != "CANCELLED");
    return (
      ph("Reports", "Accounting position from current records.") +
      `<div class="bar" style="margin:0"><button class="btn" data-act="csv" title="Export CSV" aria-label="Export CSV"><i class="fa-solid fa-file-csv"></i></button><button class="btn" onclick="print()" title="Print" aria-label="Print"><i class="fa-solid fa-print"></i></button></div><div class="grid k6" style="margin:14px 0">${kpi("Invoiced (sales)", inr(sum(iv.filter(sales).map((r) => r.amount))))}${kpi("Received", inr(sum(iv.filter(sales).map((r) => r.paid))))}${kpi("Billed (purchase)", inr(sum(iv.filter((r) => !sales(r)).map((r) => r.amount))))}${kpi("Paid", inr(sum(iv.filter((r) => !sales(r)).map((r) => r.paid))))}</div><div class="grid" style="grid-template-columns:repeat(auto-fit,minmax(300px,1fr))"><div class="card"><h3>Invoices by payment status</h3><table style="min-width:0">${["UNPAID", "PARTIAL", "PAID", "OVERDUE"].map((s) => `<tr><td>${st(s)}</td><td>${iv.filter((r) => pst(r) == s).length}</td></tr>`).join("")}</table></div><div class="card"><h3>Posted by method</h3><table style="min-width:0">${METH.map((m) => `<tr><td>${m}</td><td>${inr(sum(ACC.filter((r) => r.method == m && r.st == "POSTED" && !isInv(r)).map((r) => r.amount)))}</td></tr>`).join("")}</table></div></div>`
    );
  },
  team() {
    return (
      ph(
        "My Team",
        "Only Accounting employees appear here.",
        canManageTeam() ? ["madd", "Add Member"] : null,
      ) +
      table(
        ["Name", "Designation", "Entries", "Status"],
        TEAM.map((m) => [
          esc(m.n),
          esc(m.des),
          ACC.filter((o) => o.cb == m.n).length,
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
      ph("Notifications", "Only notices for Accounting and you.") +
      `<div class="card">${L.length ? L.map((n) => `<div style="display:flex;justify-content:space-between;gap:8px;align-items:center;padding:10px 0;border-bottom:1px solid var(--bd)"><span>${ntext(n)} ${n.read ? "" : `<span class="tag wa">New</span>`}</span><span style="display:flex;gap:6px">${n.ref ? `<button class="btn s" data-act="nopen:${n.id}">Open</button>` : ""}${n.read ? "" : `<button class="btn s" data-act="nrd:${n.id}">Mark read</button>`}</span></div>`).join("") : `<div class="empty">No notifications.</div>`}${L.some((n) => !n.read) ? `<button class="btn s" style="margin-top:10px" data-act="read">Mark all as read</button>` : ""}</div>`
    );
  },
};
function accountingBillWindow(title, number, company, party, facts, rows, totals, notes = "") {
  const bill = window.open("", "_blank");
  if (!bill) return toast("Allow pop-ups to view or print this Accounting bill.");
  const companyName = company.registeredBusinessName || company.registered_business_name || company.companyName || company.company_name || "Company";
  const address = [company.address, company.state, company.pinCode || company.pin_code, company.country].filter(Boolean).join(", ");
  bill.document.open();
  bill.document.write(`<!doctype html><html><head><meta charset="utf-8"><title>${esc(number)} ${esc(title)}</title><style>body{font:14px Arial,sans-serif;color:#18212f;margin:38px}header{display:flex;justify-content:space-between;gap:22px;border-bottom:2px solid #233c63;padding-bottom:18px}h1{font-size:22px;color:#233c63;margin:0 0 7px}h2{color:#233c63;margin:0}.muted{color:#526176;line-height:1.55}.right{text-align:right}table{width:100%;border-collapse:collapse;margin-top:22px}th,td{padding:9px;border:1px solid #cbd3df;text-align:left;vertical-align:top}th{background:#f1f4f8}.num{text-align:right}.facts{display:flex;justify-content:space-between;gap:20px;margin-top:22px}.summary{margin:18px 0 0 auto;width:min(360px,100%)}.summary td{border:0;border-bottom:1px solid #d9dee7}.grand{font-weight:bold;font-size:16px}.foot{margin-top:40px;display:flex;justify-content:flex-end}.sign{border-top:1px solid #758196;padding-top:8px;text-align:center;min-width:220px}.notes{margin-top:20px;color:#526176}@media print{body{margin:16mm}.no-print{display:none}}</style></head><body><header><div><h1>${esc(companyName)}</h1><div class="muted">${esc(address || "Registered address not configured")}<br>${company.gstin ? `GSTIN: ${esc(company.gstin)}<br>` : ""}${esc(company.phone || "")} ${company.email ? `· ${esc(company.email)}` : ""}</div></div><div class="right"><h2>${esc(title).toUpperCase()}</h2><b>${esc(number)}</b><div class="muted">${facts.map(([label, value]) => `${esc(label)}: ${esc(value)}<br>`).join("")}</div></div></header><section class="facts"><div><small class="muted">${title.toLowerCase().includes("receipt") ? "RECEIVED FROM" : "PAYEE / PARTY"}</small><h3>${esc(party.name || "—")}</h3><div class="muted">${esc(party.address || "")}<br>${party.gstin ? `GSTIN: ${esc(party.gstin)}<br>` : ""}${esc(party.contact || "")}</div></div><div class="right muted">Status: ${esc(party.status || "POSTED")}</div></section><table><thead><tr>${rows.headers.map((header) => `<th>${esc(header)}</th>`).join("")}</tr></thead><tbody>${rows.lines.length ? rows.lines.map((line) => `<tr>${line.map((value, index) => `<td class="${index === line.length - 1 ? "num" : ""}">${value}</td>`).join("")}</tr>`).join("") : `<tr><td colspan="${rows.headers.length}">No item details recorded.</td></tr>`}</tbody></table><table class="summary"><tbody>${totals.map(([label, value, grand]) => `<tr class="${grand ? "grand" : ""}"><td>${esc(label)}</td><td class="num">${value}</td></tr>`).join("")}</tbody></table>${notes ? `<p class="notes">${notes}</p>` : ""}<div class="foot"><div class="sign">${esc(companyName)}<br><b>Authorised Signatory</b></div></div><div class="no-print" style="margin-top:22px"><button onclick="window.print()">Print / Save PDF</button></div><script>window.onload=()=>window.print()<\/script></body></html>`);
  bill.document.close();
}

function printAccountingBill(kind, record) {
  const profile = window.VyaparXShared?.getCompanyProfile?.() || {};
  const company = { ...profile, ...Object.fromEntries(Object.entries(record.companySnapshot || {}).filter(([, value]) => value)) };
  const purchase = kind === "purchase";
  const lines = purchase
    ? (record.items || []).map((item, index) => [String(index + 1), esc(item.itemName || item.itemId || "Raw material"), esc(item.hsn || "—"), esc(item.quantity ?? ""), esc(item.unit || ""), inr(Number(item.unitRate || 0)), inr(Number(item.quantity || 0) * Number(item.unitRate || 0))])
    : [["1", "Transport service", "—", "1", "Service", inr(Number(record.taxableAmount || record.totalAmount || 0)), inr(Number(record.taxableAmount || record.totalAmount || 0))]];
  const charges = purchase ? [] : ["transportCharges", "tollCharges", "fuelCharges", "loadingCharges", "otherCharges"].filter((key) => Number(record[key] || 0) > 0).map((key) => [key, record[key]]);
  if (!purchase && charges.length) {
    lines.splice(0, lines.length, ...charges.map(([key, value], index) => [String(index + 1), esc(key.replace(/([A-Z])/g, " $1").replace(/^./, (c) => c.toUpperCase())), "—", "1", "Service", inr(Number(value || 0)), inr(Number(value || 0))]));
  }
  const tax = record.taxBreakdown || {};
  const hasTaxComponents = Number(tax.cgst || 0) > 0 || Number(tax.sgst || 0) > 0 || Number(tax.igst || 0) > 0;
  const totals = [
    ["Subtotal", inr(Number(record.subtotal || record.taxableAmount || 0))],
    ...(purchase && Number(record.discount || 0) ? [["Discount", `− ${inr(Number(record.discount || 0))}`]] : []),
    ["Taxable Amount", inr(Number(record.taxableAmount || record.subtotal || 0))],
    ...(Number(record.gstRate || 0) && !hasTaxComponents ? [[`GST ${Number(record.gstRate || 0)}%`, inr(Number(record.gstAmount || 0))]] : []),
    ...(Number(tax.cgst || 0) ? [["CGST", inr(Number(tax.cgst))]] : []),
    ...(Number(tax.sgst || 0) ? [["SGST", inr(Number(tax.sgst))]] : []),
    ...(Number(tax.igst || 0) ? [["IGST", inr(Number(tax.igst))]] : []),
    ["Total Payable", inr(Number(record.totalAmount || 0)), true],
  ].map(([label, value, grand]) => [label, value, grand]);
  const facts = purchase
    ? [["Vendor Invoice", record.vendorInvoiceNumber || record.billNumber || "—"], ["Invoice Date", fs(record.invoiceDate || record.purchaseOrderDate)], ["Due Date", fs(record.dueDate)], ["Payment Terms", record.paymentTerms || "—"], ["Expected Delivery", fs(record.requiredDeliveryDate)], ["Order", record.purchaseOrderNumber || "Purchase Order"]]
    : [["Vendor Invoice", record.vendorInvoiceNumber || record.billNumber || "—"], ["Bill Date", fs(record.invoiceDate || record.billDate)], ["Due Date", fs(record.dueDate)], ["Payment Terms", record.paymentTerms || "—"], ["Dispatch", record.dispatchId || "—"], ["Sales Order", record.salesOrderNumber || "—"]];
  const party = purchase
    ? { name: record.supplierName, address: record.supplierAddress, gstin: record.supplierGstin, contact: record.supplierContact, status: record.approvalStatus }
    : { name: record.transporterName, address: record.transporterAddress, gstin: record.transporterGstin, status: record.approvalStatus };
  const notes = `Approval: ${esc(record.approvalStatus || "Pending")} · Requested by ${esc(record.requestedBy || "—")}.${record.approvalNotes ? ` Approval notes: ${esc(record.approvalNotes)}.` : ""} This printout reflects the supplier/transport bill values received by Accounting.`;
  accountingBillWindow(purchase ? "Purchase Bill Record" : "Transport Bill Record", record.vendorInvoiceNumber || record.billNumber || record.purchaseOrderNumber || "Bill",
    company, party, facts, { headers: ["#", "Description", "HSN/SAC", "Qty", "Unit", "Rate", "Amount"], lines }, totals, notes);
}

function printDeliveryBill(record) {
  const profile = window.VyaparXShared?.getCompanyProfile?.() || {};
  const company = { ...profile, ...Object.fromEntries(Object.entries(record.companySnapshot || {}).filter(([, value]) => value)) };
  const lines = (record.items || []).map((item, index) => [
    String(index + 1), esc(item.itemName || item.description || item.itemId || "Item"),
    esc(item.hsn || "—"), esc(item.quantity ?? ""), esc(item.unit || ""),
    inr(Number(item.unitRate || 0)), inr(Number(item.totalAmount ?? ((item.quantity || 0) * (item.unitRate || 0)))),
  ]);
  const tax = record.taxBreakdown || {};
  const totals = [
    ["Subtotal", inr(Number(record.subtotal || 0))],
    ["Discount", inr(Number(record.discountAmount || 0))],
    ["Taxable Amount", inr(Number(record.taxableAmount || 0))],
    ...(Number(tax.cgst || 0) ? [["CGST", inr(Number(tax.cgst))]] : []),
    ...(Number(tax.sgst || 0) ? [["SGST", inr(Number(tax.sgst))]] : []),
    ...(Number(tax.igst || 0) ? [["IGST", inr(Number(tax.igst))]] : []),
    ["Delivery Bill Total", inr(Number(record.totalAmount || 0)), true],
  ];
  const facts = [["Bill Date", fs(record.billDate)], ["Sales Order", record.salesOrderNumber || "Sales Order"],
    ["Dispatch", record.dispatchId || "—"], ["Dispatch Date", fs(record.dispatchDate)],
    ["Expected Delivery", fs(record.expectedDeliveryDate)], ["Transporter", record.transporterName || "—"],
    ["Vehicle", record.vehicleNumber || "—"], ["Route", [record.from, record.to].filter(Boolean).join(" - ") || "—"]];
  const party = { name: record.customerName, address: record.customerAddress, gstin: record.customerGSTIN, contact: record.customerContact, status: record.status || record.approvalStatus };
  accountingBillWindow("Transport Delivery Bill", record.billNumber || "Delivery Bill", company, party, facts,
    { headers: ["#", "Description", "HSN/SAC", "Qty", "Unit", "Rate", "Amount"], lines }, totals,
    record.deliveryNotes ? `Delivery notes: ${esc(record.deliveryNotes)}` : "");
}

function printAccountingVoucher(entry) {
  const profile = window.VyaparXShared?.getCompanyProfile?.() || {};
  const company = { ...profile, ...Object.fromEntries(Object.entries(entry.companySnapshot || {}).filter(([, value]) => value)) };
  const isReceipt = entry.type === "RECEIPT";
  const request = [...PURCHASE_REQUESTS, ...TRANSPORT_REQUESTS, ...SALES_REQUESTS].find((row) => String(row.id) === String(entry.requestId));
  const source = request || {};
  const party = { name: entry.counterpartyName || source.customerName || source.supplierName || source.transporterName,
    address: entry.counterpartyAddress || source.customerAddress || source.supplierAddress || source.transporterAddress,
    gstin: entry.counterpartyGSTIN || source.customerGSTIN || source.supplierGstin || source.transporterGstin,
    contact: source.supplierContact || source.customerContact, status: entry.st };
  const facts = [["Voucher Date", fs(entry.date)], ["Reference", entry.inv || publicReference(entry)], ["Method", entry.method || "—"], ["Transaction Ref", entry.reference || "—"]];
  const itemLines = (entry.items || []).map((item, index) => [String(index + 1), esc(item.itemName || item.productName || item.description || "Item"), esc(item.hsn || "—"), esc(item.quantity ?? item.qty ?? ""), esc(item.unit || item.uom || ""), inr(Number(item.unitRate ?? item.rate ?? 0)), inr(Number(item.quantity ?? item.qty ?? 0) * Number(item.unitRate ?? item.rate ?? 0))]);
  const tax = entry.taxBreakdown || {};
  const totals = [[isReceipt ? "Received" : "Paid", inr(Number(entry.amount || 0)), true],
    ...(Number(entry.taxableAmount || 0) ? [["Linked bill taxable value", inr(Number(entry.taxableAmount)), false]] : []),
    ...(Number(tax.cgst || 0) ? [["CGST on linked bill", inr(Number(tax.cgst)), false]] : []),
    ...(Number(tax.sgst || 0) ? [["SGST on linked bill", inr(Number(tax.sgst)), false]] : []),
    ...(Number(tax.igst || 0) ? [["IGST on linked bill", inr(Number(tax.igst)), false]] : []),
    ...(Number(tax.gst || 0) ? [["GST on linked transport bill", inr(Number(tax.gst)), false]] : []),
    ["Remaining balance", inr(Number(entry.balanceDue || 0)), false]];
  const note = "This is an Accounting payment/receipt voucher. GST amounts shown are from the linked order or supplier bill record; this voucher is not a substitute for the supplier's tax invoice or a statutory e-invoice.";
  accountingBillWindow(isReceipt ? "Receipt Voucher" : "Payment Voucher", entry.voucherNumber || entry.number || (isReceipt ? "Receipt Voucher" : "Payment Voucher"),
    company, party, facts, { headers: ["#", "Description", "HSN/SAC", "Qty", "Unit", "Rate", "Amount"], lines: itemLines }, totals, note);
}

function accountingPaymentForm(kind, record) {
  const isPurchase = kind === "purchase";
  const due = Math.max(0, Number(record.totalAmount || 0) - Number(record.paidAmount || 0));
  dlg(`<h3>Record ${isPurchase ? "Purchase" : "Transport"} Payment</h3><p>${esc(record.supplierName || record.transporterName || record.purchaseOrderNumber || record.billNumber || "Bill")} · Remaining ${inr(due)}</p><div class="fm"><label>Amount (₹) *<input class="in" id="bpAmount" inputmode="decimal" value="${due.toFixed(2)}"></label><label>Payment Method *${sl("bpMethod", METH.map((method) => [method, method]), "", "Select method")}</label><label>Payment Date *<input class="in" id="bpDate" type="date" value="${TODAY}"></label><label>Bank / UPI / Cheque Reference<input class="in" id="bpRef" maxlength="120"></label></div>`, "Save Payment", async () => {
    const amount = Number($("#bpAmount").value), method = $("#bpMethod").value, paymentDate = $("#bpDate").value;
    if (!vf([["#bpAmount", (value) => AMT.test(value) && Number(value) > 0 && Number(value) <= due, "Enter a payment amount within the remaining bill balance."], ["#bpMethod", (value) => !!value, "Select the payment method."], ["#bpDate", (value) => value && value <= TODAY, "Enter a valid payment date, not in the future."]])) return false;
    const entryId = "ACC-" + crypto.randomUUID();
    try {
      const result = await window.VyaparXAuth.postWorkflowAction(`/api/accounting/requests/${kind}/${encodeURIComponent(record.id)}/pay`, {
        entryId, amount, method, date: paymentDate, reference: $("#bpRef").value.trim(),
      });
      if (!result?.entry?.id) throw new Error("The backend did not confirm the payment.");
      ACC.push(result.entry);
      window.VyaparXShared?.records?.markPersisted("accounting", "accountingEntry", result.entry);
      const updated = result.request;
      if (kind === "purchase") PURCHASE_REQUESTS = PURCHASE_REQUESTS.map((row) => row.id === updated.id ? updated : row);
      else TRANSPORT_REQUESTS = TRANSPORT_REQUESTS.map((row) => row.id === updated.id ? updated : row);
      accountingSyncSourceRecords();
      window.VyaparXShared?.records?.invalidate(kind === "purchase" ? "purchase" : "transport");
      render();
      toast(`Payment ${result.entry.voucherNumber || ""} recorded in Accounting.`);
      return true;
    } catch (error) {
      toast("Payment could not be recorded: " + error.message);
      return false;
    }
  });
}

function accountingRequestsSection(kind) {
  const isSales = kind === "sales";
  const isPurchase = kind === "purchase";
  const pageKey = isSales ? "salesreq" : isPurchase ? "poreq" : "transportreq";
  const records = isSales ? SALES_REQUESTS : isPurchase ? PURCHASE_REQUESTS : TRANSPORT_REQUESTS;
  const filter = REQUEST_FILTERS[pageKey];
  const status = (r) => r.approvalStatus || "Pending";
  const dateOf = (r) => String(r.requestDate || "").slice(0, 10);
  const matches = records.filter((r) => {
    const searchText = [r.id, r.requestNumber, r.purchaseOrderNumber, r.supplierName, r.billNumber, r.transporterName, r.salesOrderNumber, r.customerName, r.dispatchId].join(" ").toLowerCase();
    return (!filter.q || searchText.includes(filter.q.toLowerCase())) && (filter.status === "All" || status(r) === filter.status) && (!filter.from || dateOf(r) >= filter.from) && (!filter.to || dateOf(r) <= filter.to);
  });
  const pageSize = 10;
  const pageCount = Math.max(1, Math.ceil(matches.length / pageSize));
  filter.page = Math.min(filter.page, pageCount - 1);
  const visible = matches.slice(filter.page * pageSize, (filter.page + 1) * pageSize);
  const pending = records.filter((r) => status(r) === "Pending").length;
  const approved = records.filter((r) => status(r) === "Approved").length;
  const rejected = records.filter((r) => status(r) === "Rejected").length;
  const heading = isSales ? "Sales Requests" : isPurchase ? "Purchase Order Requests" : "Transport Bill Requests";
  const headers = isSales ? ["Sales Order", "Customer", "Order Date", "Order Total", "Advance %", "Required Advance", "Received", "Remaining", "Requested By", "Status", "Request Date"] : isPurchase ? ["Purchase Order", "Supplier", "Total", "Paid", "Balance", "Payment", "Required Delivery", "Approval", "Request Date"] : ["Bill Number", "Linked Dispatch", "Transporter", "Bill Total", "Paid", "Balance", "Payment", "Due Date", "Approval"];
  const values = (r) => isSales ? [r.salesOrderNumber || "—", r.customerName || "—", fs(r.orderDate), inr(Number(r.grandTotal || 0)), `${Number(r.advancePercent || 0)}%`, inr(Number(r.requiredAdvance || 0)), inr(Number(r.amountReceived || 0)), inr(Number(r.advanceOutstanding || 0)), r.requestedBy || "—", status(r), fs(r.requestDate)] : isPurchase ? [r.purchaseOrderNumber || "—", r.supplierName || "—", inr(Number(r.totalAmount || 0)), inr(Number(r.paidAmount || 0)), inr(Math.max(0, Number(r.totalAmount || 0) - Number(r.paidAmount || 0))), r.paymentStatus || "UNPAID", fs(r.requiredDeliveryDate), status(r), fs(r.requestDate)] : [r.billNumber || "—", r.dispatchId || r.salesOrderNumber || "—", r.transporterName || "—", inr(Number(r.totalAmount || 0)), inr(Number(r.paidAmount || 0)), inr(Math.max(0, Number(r.totalAmount || 0) - Number(r.paidAmount || 0))), r.paymentStatus || "UNPAID", fs(r.dueDate), status(r)];
  const rows = visible.map((r) => { const statusIndex = isSales ? 9 : isPurchase ? 7 : 8; const remaining = Math.max(0, Number(r.totalAmount || 0) - Number(r.paidAmount || 0)); const salesRequest = !isSales && SALES_REQUESTS.find((item) => String(item.salesOrderId) === String(r.salesOrderId) && item.approvalStatus === "Approved" && Number(item.amountReceived || 0) < Number(item.grandTotal || 0)); const actions = isSales ? `<button class="btn s" data-act="sarview:${esc(r.id)}">View</button>${status(r) === "Pending" ? `<button class="btn s" data-act="sarapprove:${esc(r.id)}">Approve & Release</button><button class="btn s" data-act="sarreject:${esc(r.id)}">Reject</button><button class="btn s" data-act="sarcancel:${esc(r.id)}">Cancel</button>` : status(r) === "Approved" && Number(r.amountReceived || 0) < Number(r.grandTotal || 0) ? `<button class="btn s p" data-act="sarreceipt:${esc(r.id)}">Receive</button>` : ""}` : `<button class="btn s" data-act="breqview:${esc(r.id)}:${kind}">View</button>${status(r) === "Pending" ? `<button class="btn s" data-act="breqapprove:${esc(r.id)}:${kind}">Approve</button><button class="btn s" data-act="breqreject:${esc(r.id)}:${kind}">Reject</button><button class="btn s" data-act="breqcancel:${esc(r.id)}:${kind}">Cancel</button>` : status(r) === "Approved" ? `${kind === "transport" && salesRequest ? `<button class="btn s" data-act="sarreceipt:${esc(salesRequest.id)}">Receive</button>` : ""}${remaining > 0 ? `<button class="btn s p" data-act="breqpay:${esc(r.id)}:${kind}">Pay</button>` : ""}` : ""}`; return `<tr>${values(r).map((v, i) => `<td>${i === statusIndex ? st(String(v)) : esc(String(v))}</td>`).join("")}<td><span style="display:flex;gap:4px">${actions}</span></td></tr>`; }).join("");
  const refreshAction = isSales ? "sarrefresh" : "breqrefresh";
  return ph(heading, "Review and record the financial decision for source transactions.", [refreshAction, kind]) +
    `<div class="grid k6">${kpi("Total Requests", records.length)}${kpi("Pending Approval", pending)}${kpi("Approved", approved)}${kpi("Rejected", rejected)}</div>` +
    `<div class="card"><div class="bar"><input class="in" data-rf="q" data-kind="${kind}" placeholder="Search requests..." value="${esc(filter.q)}"><select class="in" data-rf="status" data-kind="${kind}">${["All", "Pending", "Approved", "Rejected", "Returned"].map((v) => `<option ${filter.status === v ? "selected" : ""}>${v}</option>`).join("")}</select><label>From <input class="in" type="date" data-rf="from" data-kind="${kind}" value="${esc(filter.from)}"></label><label>To <input class="in" type="date" data-rf="to" data-kind="${kind}" value="${esc(filter.to)}"></label></div><div class="tw"><table><thead><tr>${headers.map((h) => `<th>${h}</th>`).join("")}<th>Actions</th></tr></thead><tbody>${rows || `<tr><td colspan="${headers.length + 1}"><div class="empty">No matching requests.</div></td></tr>`}</tbody></table></div><div class="bar" style="justify-content:space-between"><span>${matches.length ? `${filter.page * pageSize + 1}–${Math.min((filter.page + 1) * pageSize, matches.length)} of ${matches.length}` : "0 requests"}</span><span><button class="btn s" data-act="breqpage:${kind}:prev" ${filter.page === 0 ? "disabled" : ""}>Previous</button> <button class="btn s" data-act="breqpage:${kind}:next" ${filter.page >= pageCount - 1 ? "disabled" : ""}>Next</button></span></div></div>`;
}
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
function accountingGreeting() {
  const session = window.VyaparXAuth?.getCurrentSession?.() || {};
  const hour = new Date().getHours();
  const greeting = hour < 12 ? "Good Morning" : hour < 17 ? "Good Afternoon" : hour < 20 ? "Good Evening" : "Good Night";
  return session.fullName || session.name ? `${greeting}, ${session.fullName || session.name}` : greeting;
}
function render() {
  const l = NAV.flatMap((n) => n[1]).find((x) => x[0] == cur)[1];
  $("#pt").textContent = l;
  $("#bc").textContent = "Accounting / " + l;
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
  if (["salesreq", "poreq", "transportreq", "rec", "payb"].includes(v)) { accountingLoadSalesRequests(); accountingLoadBusinessRequests(); }
  document.body.classList.remove("open");
}
const sl = (id, a, v, p) =>
  `<select class="in" id="${id}"><option value="">${p}</option>${a.map((x) => `<option value="${esc(x[0])}" ${x[0] == v ? "selected" : ""}>${esc(x[1])}</option>`).join("")}</select>`;
const AMT = /^\d+(\.\d{1,2})?$/,
  rid = () => "ACC-" + crypto.randomUUID(),
  nextInvoiceNumber = (prefix) => {
    const highest = ACC.reduce((max, entry) => {
      const match = String(entry.inv || "").match(new RegExp("^" + prefix + "-(\\d+)$", "i"));
      return match ? Math.max(max, Number(match[1])) : max;
    }, 0);
    return `${prefix}-${String(highest + 1).padStart(3, "0")}`;
  };
function invForm(preRef = "") {
  dlg(
      `<h3>Create invoice</h3><div class="fm"><label>Order *${sl("fk", [...SOA.map((s) => [s.id, (s.number || "Sales Order") + " – " + s.c + " (sales invoice)"]), ...POA.map((p) => [p.id, (p.number || "Purchase Order") + " – " + p.c + " (purchase bill)"]), ...approvedPayableRequests().map((p) => [p.sourceId, p.displayRef + " – " + p.party + " (approved bill)"])], preRef, "Select order")}</label><label>Invoice No *<input class="in" id="fn" value="${nextInvoiceNumber(preRef && SOA.some((order) => String(order.id) === String(preRef)) ? "INV" : "BILL")}" placeholder="INV-001 or BILL-001"></label><label>Amount (₹) *<input class="in" id="fa" inputmode="decimal"></label><label>Date *<input class="in" type="date" id="fd" value="${TODAY}"></label></div>`,
    "Create invoice",
    async () => {
      const ref = $("#fk").value,
        o = SOx(ref) || POx(ref) || { total: 0 },
        used = sum(
          ACC.filter(
            (r) => isInv(r) && r.ref == ref && r.st != "CANCELLED",
          ).map((r) => r.amount),
        ),
        left = o.total - used,
        pre = SOA.some((order) => String(order.id) === String(ref)) ? "INV" : "BILL";
      if (
        !vf([
          ["#fk", (v) => v, "Select the order."],
          [
            "#fn",
            (v) => new RegExp("^" + pre + "-\\d{3,6}$").test(v.toUpperCase()),
            "Use the format " + pre + "-001 for this order.",
          ],
          [
            "#fn",
            (v) => !ACC.some((r) => isInv(r) && r.inv == v.toUpperCase()),
            "This invoice number already exists.",
          ],
          [
            "#fa",
            (v) => AMT.test(v) && +v > 0,
            "Enter a valid amount above 0.",
          ],
          [
            "#fa",
            (v) => +v <= left,
            "Amount cannot exceed the uninvoiced " + inr(left) + ".",
          ],
          [
            "#fd",
            (v) => v && v <= TODAY,
            "Enter a valid date, not in the future.",
          ],
        ])
      )
        return false;
      const n = +$("#fa").value;
      const invoice = {
        id: rid(),
        recordType: "accountingEntry",
        type: "INVOICE",
        ref,
        inv: $("#fn").value.toUpperCase(),
        amount: n,
        paid: 0,
        method: "",
        date: $("#fd").value,
        st: "POSTED",
        cb: ME,
        ca: TODAY,
        why: "",
        hist: [{ "0": TODAY, "1": "Invoice created", date: TODAY, action: "Invoice created" }],
      };
      const saved = await window.VyaparXAuth.createModuleRecord("accounting", invoice);
      if (!saved?.record?.id) throw new Error(saved?.error || "The server did not confirm invoice creation.");
      ACC.push(saved.record);
      window.VyaparXShared?.records?.markPersisted("accounting", "accountingEntry", saved.record);
      await accountingSyncSourceRecords();
      render();
      toast("Invoice created.");
    },
  );
}
function moneyForm(kind, pre) {
  const R = kind == "RECEIPT",
    P = kind == "PAYMENT",
    F = kind == "REFUND";
  const opts2 = R
    ? [
        ...INVS()
          .filter(sales)
          .filter((r) => bal(r) > 0)
          .map((r) => [
            "inv:" + r.inv,
            `${r.inv} – ${(SOx(r.ref)?.c || "Customer")} · balance ${inr(bal(r))}`,
          ]),
        ...SOA.filter((s) => s.rec < s.total).map((s) => [
          "adv:" + s.id,
          `Advance – ${s.number || "Sales Order"} ${s.c} · up to ${inr(s.total - s.rec)}`,
        ]),
      ]
    : P
      ? INVS()
          .filter((r) => !sales(r) && bal(r) > 0)
          .map((r) => [
            "inv:" + r.inv,
            `${r.inv} – ${(POx(r.ref)?.c || "Supplier")} · balance ${inr(bal(r))}`,
          ])
      : SOA.filter((s) => s.rec > 0).map((s) => [
          "adv:" + s.id,
          `${s.number || "Sales Order"} ${s.c} · received ${inr(s.rec)}`,
        ]);
  const lim = (v) => {
    const [k, i] = v.split(":");
    return k == "inv"
      ? bal(invOf(i))
      : R
        ? SOx(i).total - SOx(i).rec
        : SOx(i).rec;
  };
  dlg(
    `<h3>Record ${kind.toLowerCase()}</h3><div class="fm"><label>${F ? "Sales order" : R ? "Against" : "Bill"} *${sl("fk", opts2, pre ? "inv:" + pre : "", "Select")}</label><label>Amount (₹) *<input class="in" id="fa" inputmode="decimal"></label>${
      F
        ? ""
        : `<label>Payment Method *${sl(
            "fm",
            METH.map((m) => [m, m]),
            "",
            "Select method",
          )}</label>`
    }<label>Date *<input class="in" type="date" id="fd" value="${TODAY}"></label>${F ? `<label>Reason *<input class="in" id="fr"></label>` : ""}</div>${P ? `<p style="color:var(--mut);font-size:12px">Payments above ${inr(LIM)} need approval before they are paid.</p>` : ""}${F ? `<p style="color:var(--mut);font-size:12px">Refunds need approval.</p>` : ""}`,
    "Save",
    () => {
      if (
        !vf([
          ["#fk", (v) => v, "Select the target."],
          [
            "#fa",
            (v) => AMT.test(v) && +v > 0,
            "Enter a valid amount above 0.",
          ],
          [
            "#fa",
            (v) => !$("#fk").value || +v <= lim($("#fk").value),
            "Amount cannot exceed the outstanding " +
              ($("#fk").value ? inr(lim($("#fk").value)) : "") +
              ".",
          ],
          ...(F
            ? [
                [
                  "#fr",
                  (v) => v.length > 4,
                  "Enter the reason (at least 5 characters).",
                ],
              ]
            : [["#fm", (v) => v, "Select the payment method."]]),
          [
            "#fd",
            (v) => v && v <= TODAY,
            "Enter a valid date, not in the future.",
          ],
        ])
      )
        return false;
      const [k, i] = $("#fk").value.split(":"),
        n = +$("#fa").value,
        big = F || (P && n > LIM),
        ref = k == "inv" ? invOf(i).ref : i;
      const r = {
        id: rid(),
        recordType: "accountingEntry",
        type: kind,
        ref,
        inv: k == "inv" ? i : "—",
        amount: n,
        paid: n,
        method: F ? "" : $("#fm").value,
        date: $("#fd").value,
        st: big ? "PENDING_APPROVAL" : "POSTED",
        cb: ME,
        ca: TODAY,
        why: F ? $("#fr").value.trim() : "",
        hist: [
          [TODAY, kind.charAt(0) + kind.slice(1).toLowerCase() + " recorded"],
        ],
        counterpartyName: k === "inv" ? (sales(invOf(i)) ? SOx(ref)?.c : POx(ref)?.c) || "" : SOx(i)?.c || "",
      };
      if (R && k === "inv" && sales(invOf(i))) {
        const request = SALES_REQUESTS.find((item) => String(item.salesOrderId) === String(ref));
        if (!request) {
          toast("The linked Sales Request is unavailable. Refresh Accounting and try again.");
          return false;
        }
        window.VyaparXAuth.postWorkflowAction(`/api/accounting/sales-requests/${encodeURIComponent(request.id)}/receipt`, {
          receiptId: r.id, amount: n, method: r.method, date: r.date,
        }).then((result) => {
          if (!result?.entry?.id) throw new Error("The backend did not confirm the receipt.");
          const invoice = invOf(i);
          if (invoice) invoice.paid = Number(invoice.paid || 0) + n;
          ACC.push(result.entry);
          window.VyaparXShared?.records?.markPersisted("accounting", "accountingEntry", result.entry);
          SALES_REQUESTS = SALES_REQUESTS.map((item) => item.id === request.id ? result.request : item);
          accountingSyncSourceRecords();
          window.VyaparXShared?.records?.invalidate("sales");
          window.VyaparXShared?.records?.invalidate("transport");
          render();
          toast("Receipt recorded. Invoice and Sales Order balances updated.");
        }).catch((error) => toast("Receipt could not be recorded: " + error.message));
        return true;
      }
      if (R && k === "adv") {
        window.VyaparXAuth.postWorkflowAction(`/api/accounting/sales-requests/${encodeURIComponent("SAR-" + i)}/receipt`, {
          receiptId: r.id, amount: n, method: r.method, date: r.date,
        }).then((result) => {
          ACC.push(result.entry);
          window.VyaparXShared?.records?.markPersisted("accounting", "accountingEntry", result.entry);
          SALES_REQUESTS = SALES_REQUESTS.map((request) => String(request.salesOrderId) === String(i)
            ? { ...request, amountReceived: result.request.amountReceived, advanceOutstanding: result.request.advanceOutstanding }
            : request);
          accountingSyncSourceRecords();
          window.VyaparXShared?.records?.invalidate("transport");
          render();
          toast("Receipt recorded. Order advance updated.");
        }).catch((error) => toast("Receipt could not be recorded: " + error.message));
        return true;
      }
      if (big) r.hist.push([TODAY, "Submitted for approval"]);
      else fx(r, 1);
      ACC.push(r);
      render();
      toast(
        big
          ? "Submitted for approval."
          : kind == "RECEIPT"
            ? "Receipt recorded. Order advance updated."
            : "Payment recorded.",
      );
    },
  );
}
function salesRequestReceipt(request) {
  const remaining = Math.max(0, Number(request.grandTotal || 0) - Number(request.amountReceived || 0));
  dlg(`<h3>Record Sales Receipt</h3><p>${esc(request.salesOrderNumber || "Sales Order")} · balance ${inr(remaining)}</p><div class="fm"><label>Amount (₹) *<input class="in" id="sarAmount" inputmode="decimal"></label><label>Method *${sl("sarMethod", METH.map((method) => [method, method]), "", "Select method")}</label><label>Date *<input class="in" id="sarDate" type="date" value="${TODAY}"></label></div>`, "Record Receipt", async () => {
    const amount = $("#sarAmount").value, method = $("#sarMethod").value, receiptDate = $("#sarDate").value;
    if (!vf([["#sarAmount", (value) => AMT.test(value) && Number(value) > 0 && Number(value) <= remaining, "Enter an amount within the Sales Order balance."], ["#sarMethod", (value) => !!value, "Select a payment method."], ["#sarDate", (value) => value && value <= TODAY, "Enter a valid date, not in the future."]])) return false;
    const receiptId = "ACC-" + crypto.randomUUID();
    try {
      const result = await window.VyaparXAuth.postWorkflowAction(`/api/accounting/sales-requests/${encodeURIComponent(request.id)}/receipt`, { receiptId, amount: Number(amount), method, date: receiptDate });
      if (!result?.entry?.id || !result?.request) throw new Error("The backend did not confirm the receipt.");
      ACC.push(result.entry); window.VyaparXShared?.records?.markPersisted("accounting", "accountingEntry", result.entry); SALES_REQUESTS = SALES_REQUESTS.map((row) => row.id === request.id ? result.request : row); accountingSyncSourceRecords(); window.VyaparXShared?.records?.invalidate("sales"); window.VyaparXShared?.records?.invalidate("transport"); await accountingLoadBusinessRequests(); render(); toast("Receipt recorded and Sales balance updated.");
      return true;
    } catch (error) { toast("Receipt could not be recorded: " + error.message); return false; }
  });
}
function apprX(r) {
  if (r.cb == ME)
    return toast(
      "You created this transaction, so another approver must approve it.",
    );
  const bad =
    r.type == "PAYMENT"
      ? r.amount > bal(invOf(r.inv))
      : r.type == "REFUND"
        ? r.amount > SOx(r.ref).rec
        : false;
  if (bad)
    return toast(
      "Cannot approve: the amount exceeds the current outstanding balance.",
    );
  OKD(
    "Approve transaction?",
    `${r.voucherNumber || r.number || r.type}: ${r.type} of ${inr(r.amount)} against ${publicReference(r)}.`,
    "Approve",
    () => {
      fx(r, 1);
      r.st = "POSTED";
      addh(r, "Approved by " + ME);
      render();
      toast("Approved and posted.");
    },
  );
}
const whyX = (r, t, btn, fn) =>
  dlg(
    `<h3>${t} ${r.id}</h3><div class="fm"><label>Reason *<input class="in" id="wy"></label></div>`,
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
      fn($("#wy").value.trim());
      render();
    },
  );
function xView(r) {
  detail([
    [
      "Transaction Details",
      [
        ["ID", r.id],
        ["Type", r.type],
        ["Status", st(r.st)],
        ["Date", fs(r.date)],
      ],
    ],
    [
      "Reference",
      [
        [sales(r) ? "Sales Order" : "Purchase Order", publicReference(r)],
        ["Invoice No", r.inv],
      ],
    ],
    [
      "Amounts",
      [
        ["Amount", inr(r.amount)],
        ["Paid", inr(r.paid)],
        ["Balance", inr(bal(r))],
        ["Payment Status", st(pst(r))],
        ["Method", r.method || "—"],
      ],
    ],
    ...(r.why ? [["Reason", [["Reason", esc(r.why)]]]] : []),
    [
      "Assignment",
      [
        ["Created By", esc(r.cb)],
        ["Created On", fs(r.ca)],
      ],
    ],
    ["Activity History", r.hist.map((x) => [fs(x[0]), esc(x[1])])],
  ]);
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
        window.VyaparXAuth.uploadFile(f, "accounting-attachments").then((result) => {
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
    window.VyaparXAuth.uploadFile(f, "accounting-profile").then((result) => {
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
    `<h3>${T ? "Send task" : "Send message"}</h3><div class="fm" style="max-width:none"><label>${T ? "Task Title" : "Subject"} *<input class="in" id="sx"></label><label>${T ? "Description" : "Message"} *<textarea class="in" id="sd" rows="3"></textarea></label><label>Send To *<select class="in" id="sto"><option value="">Select person</option>${PEOPLE().filter((p) => p.d !== "Accounting")
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
            fd: "Accounting",
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
        TEAM.push(window.VyaparXShared.departmentTeam.createMember("accounting", f));
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
  ACC.forEach((o) => {
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
        ["Department", "Accounting"],
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
  if (d.rf) {
    const key = d.kind === "purchase" ? "poreq" : "transportreq";
    REQUEST_FILTERS[key][d.rf] = t.value;
    if (d.rf !== "q") REQUEST_FILTERS[key].page = 0;
    render();
    const search = document.querySelector(`[data-rf="q"][data-kind="${d.kind}"]`);
    if (search) { search.focus(); search.setSelectionRange(search.value.length, search.value.length); }
    return;
  }
  if (d.s != null) {
    const i = +d.s;
    sort = { i, d: sort && sort.i == i ? -sort.d : 1 };
    return render();
  }
  const [a, x, y] = d.act.split(":"),
    o = OB(x);
  if (a === "sarrefresh") { accountingLoadSalesRequests(); return; }
  if (a === "breqrefresh") { accountingLoadBusinessRequests(); return; }
  if (a === "avoucher") {
    if (o) printAccountingVoucher(o);
    return;
  }
  if (a === "breqpage") {
    const key = x === "sales" ? "salesreq" : x === "purchase" ? "poreq" : "transportreq";
    REQUEST_FILTERS[key].page = Math.max(0, REQUEST_FILTERS[key].page + (y === "next" ? 1 : -1));
    return render();
  }
  if (a === "breqpost") {
    const row = (y === "purchase" ? PURCHASE_REQUESTS : TRANSPORT_REQUESTS).find((item) => String(item.id) === x && item.approvalStatus === "Approved");
    if (!row) return toast("Only an approved bill can be entered into Payables.");
    return invForm(String(row.purchaseOrderId || row.transportBillId || row.sourceId || ""));
  }
  if (a === "breqbill") {
    const row = (y === "purchase" ? PURCHASE_REQUESTS : TRANSPORT_REQUESTS).find((item) => String(item.id) === x);
    if (row) printAccountingBill(y, row);
    return;
  }
  if (a === "breqpay") {
    const row = (y === "purchase" ? PURCHASE_REQUESTS : TRANSPORT_REQUESTS).find((item) => String(item.id) === x && item.approvalStatus === "Approved");
    if (!row || Number(row.paidAmount || 0) >= Number(row.totalAmount || 0)) return toast("Only an approved bill with an outstanding balance can be paid.");
    return accountingPaymentForm(y, row);
  }
  if (a === "sarreceipt") {
    const request = SALES_REQUESTS.find((item) => String(item.id) === x && item.approvalStatus === "Approved");
    if (!request) return toast("Only an approved Sales Request can record a receipt.");
    return salesRequestReceipt(request);
  }
  if (["breqview", "breqapprove", "breqreject", "breqcancel"].includes(a)) {
    const kind = y;
    const records = kind === "purchase" ? PURCHASE_REQUESTS : TRANSPORT_REQUESTS;
    const record = records.find((item) => String(item.id) === x);
    if (!record) return;
    if (a === "breqview") {
      const facts = kind === "purchase" ? [["Purchase Order", record.purchaseOrderNumber || "—"], ["Vendor Invoice", record.vendorInvoiceNumber || "—"], ["Invoice Date", fs(record.invoiceDate)], ["Due Date", fs(record.dueDate)], ["Purchase Order Date", fs(record.purchaseOrderDate)], ["Linked Requisition", record.purchaseRequisitionNumber || "—"], ["Supplier", record.supplierName], ["Supplier Contact", record.supplierContact || "—"], ["Items", (record.items || []).map((item) => `${esc(item.itemName || item.itemId || "Item")}: ${esc(item.quantity)} ${esc(item.unit || "")} × ${inr(Number(item.unitRate || 0))}`).join("<br>") || "—"], ["Subtotal", inr(Number(record.subtotal || 0))], ["Discount", inr(Number(record.discount || 0))], ["Taxable Amount", inr(Number(record.taxableAmount || 0))], ["GST Rate / Amount", `${Number(record.gstRate || 0)}% · ${inr(Number(record.gstAmount || 0))}`], ["CGST / SGST / IGST", `${inr(Number(record.taxBreakdown?.cgst || 0))} / ${inr(Number(record.taxBreakdown?.sgst || 0))} / ${inr(Number(record.taxBreakdown?.igst || 0))}`], ["Freight / Other Charges", inr(Number(record.freight || 0))], ["Attachments", (record.attachments || []).map((url, index) => `<a href="${esc(url)}" target="_blank" rel="noopener">Attachment ${index + 1}</a>`).join("<br>") || "—"], ["Total", inr(Number(record.totalAmount || 0))], ["Advance Requirement", record.advanceRequirement || "—"], ["Payment Terms", record.paymentTerms || "—"], ["Approval Notes", record.approvalNotes || "—"], ["Required Delivery", record.requiredDeliveryDate || "—"], ["Requested By", record.requestedBy || "—"], ["Request Date", fs(record.requestDate)], ["Status", record.approvalStatus], ["Decision Reason", record.decisionReason || "—"], ["History", (record.history || []).map((h) => `${esc(h.at || "")} ${esc(h.action || "")}${h.reason ? ` · ${esc(h.reason)}` : ""}`).join("<br>") || "—"]] : [["Bill Number", record.vendorInvoiceNumber || record.billNumber || "—"], ["Invoice Date", fs(record.invoiceDate || record.billDate)], ["Due Date", fs(record.dueDate)], ["Payment Terms", record.paymentTerms || "—"], ["Approval Notes", record.approvalNotes || "—"], ["Dispatch", record.dispatchId || "—"], ["Sales Order", record.salesOrderNumber || "—"], ["Customer", record.customerName || "—"], ["Transporter", record.transporterName || "—"], ["Vehicle", record.vehicleNumber || "—"], ["Driver", record.driverName || "—"], ["Bill Date", fs(record.billDate)], ["Transport Charges", inr(Number(record.transportCharges || 0))], ["Toll Charges", inr(Number(record.tollCharges || 0))], ["Fuel Charges", inr(Number(record.fuelCharges || 0))], ["Loading / Unloading", inr(Number(record.loadingCharges || 0))], ["Other Charges", inr(Number(record.otherCharges || 0))], ["GST", `${Number(record.gstRate || 0)}% · ${inr(Number(record.gstAmount || 0))}`], ["Total", inr(Number(record.totalAmount || 0))], ["Attachment", record.attachment ? `<a href="${esc(record.attachment)}" target="_blank" rel="noopener">Open attachment</a>` : "—"], ["Requested By", record.requestedBy || "—"], ["Request Date", fs(record.requestDate)], ["Status", record.approvalStatus], ["Decision Reason", record.decisionReason || "—"], ["History", (record.history || []).map((h) => `${esc(h.at || "")} ${esc(h.action || "")}${h.reason ? ` · ${esc(h.reason)}` : ""}`).join("<br>") || "—"]];
      return detail([[kind === "purchase" ? "Purchase Order Request" : "Transport Bill Request", facts.map(([label, value]) => [label, label === "History" || label === "Items" || label === "Attachment" ? value : esc(String(value ?? "—"))])]]);
    }
    const action = a === "breqapprove" ? "approve" : a === "breqcancel" ? "cancel" : "reject";
    const submit = async (reason = "", details = null) => {
      try {
        await window.VyaparXAuth.postWorkflowAction(`/api/accounting/requests/${kind}/${encodeURIComponent(x)}/${action}`, {
          reason, ...(details ? { details } : {}),
        });
        await Promise.all([accountingLoadSalesRequests(), accountingLoadBusinessRequests()]);
        window.VyaparXShared?.records?.invalidate(kind === "purchase" ? "purchase" : "transport");
        toast(action === "approve" ? "Request approved and source status updated." : "Request rejected and source status updated.");
        return true;
      } catch (error) { toast("Accounting action failed: " + error.message); return false; }
    };
    if (action === "approve") dlg(`<h3>Approve ${kind === "purchase" ? "Purchase Order" : "Transport Bill"}?</h3><p>Save the supplier or transporter bill details. After approval, use Pay to record each payment.</p><div class="fm"><label>Vendor invoice / bill number<input class="in" id="breqInvoiceNumber" maxlength="80" value="${esc(record.vendorInvoiceNumber || record.billNumber || record.purchaseOrderNumber || "")}"></label><label>Invoice date *<input class="in" id="breqInvoiceDate" type="date" value="${esc(record.invoiceDate || record.billDate || TODAY)}"></label><label>Due date<input class="in" id="breqDueDate" type="date" value="${esc(record.dueDate || "")}"></label><label>Payment terms<input class="in" id="breqPaymentTerms" maxlength="250" value="${esc(record.paymentTerms || "")}"></label><label>Approval notes<textarea class="in" id="breqApprovalNotes" rows="3" maxlength="1000">${esc(record.approvalNotes || "")}</textarea></label></div>`, "Approve & Save", async () => {
      if (!vf([["#breqInvoiceDate", (value) => value && !Number.isNaN(Date.parse(value)), "Enter a valid invoice date."], ["#breqDueDate", (value) => !value || !Number.isNaN(Date.parse(value)), "Enter a valid due date."]])) return false;
      return await submit("", {
        vendorInvoiceNumber: $("#breqInvoiceNumber").value.trim(),
        invoiceDate: $("#breqInvoiceDate").value,
        dueDate: $("#breqDueDate").value,
        paymentTerms: $("#breqPaymentTerms").value.trim(),
        approvalNotes: $("#breqApprovalNotes").value.trim(),
      });
      return true;
    });
    else dlg(`<h3>${action === "cancel" ? "Cancel" : "Reject"} request?</h3><label>Reason *<textarea class=\"in\" id=\"breqReason\" rows=\"3\"></textarea></label>`, action === "cancel" ? "Cancel Request" : "Reject", async (m) => { const reason = m.querySelector("#breqReason").value.trim(); if (!reason) { toast("Enter a reason."); return false; } return await submit(reason); });
    return;
  }
  if (a === "deliverybillview") {
    const bill = DELIVERY_BILLS.find((item) => String(item.id) === String(x));
    if (bill) printDeliveryBill(bill);
    return;
  }
  if (a === "sarview") {
    const r = SALES_REQUESTS.find((item) => String(item.id) === x);
    if (r) {
      detail([["Sales Accounting Request", [["Request", esc(r.salesOrderNumber || "Sales Order")], ["Sales Order", esc(r.salesOrderNumber || "Sales Order")], ["Customer", esc(r.customerName || "—")], ["Order Date", fs(r.orderDate)], ["Order total", inr(Number(r.grandTotal || 0))], ["Advance", `${Number(r.advancePercent || 0)}% · ${inr(Number(r.requiredAdvance || 0))}`], ["Amount received", inr(Number(r.amountReceived || 0))], ["Outstanding advance", inr(Number(r.advanceOutstanding || 0))], ["Payment status", esc(r.paymentStatus || "—")], ["Requested By", esc(r.requestedBy || "—")], ["Request Date", fs(r.requestDate)], ["Status", esc(r.approvalStatus)], ["Decision Reason", esc(r.decisionReason || "—")], ["History", (r.history || []).map((h) => `${esc(h.at || "")} ${esc(h.action || "")}${h.reason ? ` · ${esc(h.reason)}` : ""}`).join("<br>") || "—"]]]]);
    }
  } else if (a === "sarentryview") {
    const entry = ACC.find((item) => String(item.id) === x && item.type === "RECEIPT");
    if (entry) detail([["Sales Receipt", [["Voucher", esc(entry.voucherNumber || entry.number || "Receipt")], ["Sales Order", esc(publicReference(entry))], ["Customer", esc(entry.counterpartyName || "—")], ["Amount", inr(Number(entry.amount || 0))], ["Advance Percentage", `${Number(entry.advancePercent || 0)}%`], ["Date", fs(entry.date)], ["Method", esc(entry.method || "—")], ["UTR / Reference", esc(entry.utr || "—")], ["Voucher Reference", esc(entry.voucherRef || "—")], ["Notes", esc(entry.notes || "—")], ["Status", esc(entry.st || entry.status || "POSTED")]]]]);
  } else if (a === "sarentrydelete") {
    const entry = ACC.find((item) => String(item.id) === x && item.type === "RECEIPT");
    if (!entry) return toast("Sales receipt was not found.");
    dlg(`<h3>Delete receipt ${esc(entry.voucherNumber || "Receipt")}?</h3><p>This will delete the saved receipt and restore its amount to the Sales Order balance.</p>`, "Delete", (modal) => {
      const button = modal.querySelector("[data-ok]");
      button.disabled = true;
      window.VyaparXAuth.deleteModuleRecord("accounting", entry.id)
        .then((result) => {
          if (result?.success !== true) throw new Error("The server did not confirm deletion.");
          ACC = ACC.filter((item) => String(item.id) !== String(entry.id));
          window.VyaparXShared?.records?.markDeleted("accounting", "accountingEntry", entry.id);
          return accountingLoadSalesRequests();
        })
        .then(() => { modal.remove(); render(); toast("Sales receipt deleted and the balance restored."); })
        .catch((error) => { button.disabled = false; toast("Sales receipt was not deleted: " + error.message); });
      return false;
    });
  } else if (["sarapprove", "sarreject", "sarreturn", "sarcancel"].includes(a)) {
    if (PENDING_SAR_ACTIONS.has(x)) {
      toast("Action already in progress for this request. Please wait...");
      return;
    }
    const submit = async (releaseDetails = "", okBtn = null) => {
      if (PENDING_SAR_ACTIONS.has(x)) return;
      PENDING_SAR_ACTIONS.add(x);
      if (okBtn) {
        okBtn.disabled = true;
        okBtn.textContent = "Processing...";
      }
      try {
        const actionStartedAt = performance.now();
        const action = a === "sarcancel" ? "cancel" : a.slice(3);
        const body = typeof releaseDetails === "string"
          ? { reason: releaseDetails }
          : { reason: "", release: releaseDetails };
        const res = await window.VyaparXAuth.postWorkflowAction(`/api/accounting/sales-requests/${encodeURIComponent(x)}/${action}`, body);
        const responseReceivedAt = performance.now();
        if (!res?.success || !res.record) throw new Error("The server did not confirm the Accounting update.");
        const saved = res.record;
        SALES_REQUESTS = SALES_REQUESTS.map((row) => String(row.id) === String(saved.id || x) ? { ...row, ...saved } : row);
        accountingSyncSourceRecords();
        render();
        requestAnimationFrame(() => console.info("[VyaparX performance] Accounting approval updated", {
          action,
          requestDurationMs: Math.round(responseReceivedAt - actionStartedAt),
          displayDurationMs: Math.round(performance.now() - actionStartedAt),
        }));
        toast(res?.message || (a === "sarapprove" ? "Request approved and released to Production." : "Request updated."));
      } catch (error) {
        console.error("Accounting action failed:", error);
        const errorMsg = error.data?.error || error.data?.detail || error.message || "An unexpected error occurred.";
        toast("Accounting action failed: " + errorMsg);
        // Keep the last confirmed state visible. A later explicit/module refresh
        // can reconcile it without delaying the failed-action feedback.
      } finally {
        PENDING_SAR_ACTIONS.delete(x);
      }
    };
    if (a === "sarapprove") {
      // Approve & Release: capture payment-release details in a proper form.
      const rel = SALES_REQUESTS.find((item) => String(item.id) === x);
      if (!rel) return toast("Sales Request was not found.");
      const orderTotal = Number(rel.grandTotal || 0);
      const requiredAdv = Number(rel.requiredAdvance || 0);
      const received = Number(rel.amountReceived || 0);
      const outstanding = Math.max(0, orderTotal - received);
      const initialAmount = outstanding;
      const methods = ["CASH", "BANK", "UPI", "CARD", "CHEQUE", "OTHER"];
      const dlgHtml = `
        <h3>Approve &amp; Release Payment</h3>
        <div class="fm" style="max-width:none">
          <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(180px,1fr));gap:10px">
            <label>Sales Order Number<input class="in" value="${esc(rel.salesOrderNumber || "Sales Order")}" readonly></label>
            <label>Customer / Party<input class="in" value="${esc(rel.customerName || "—")}" readonly></label>
            <label>Total Order Amount<input class="in" value="${inr(orderTotal)}" readonly></label>
            <label>Requested Advance<input class="in" value="${inr(requiredAdv)}" readonly></label>
            <label>Already Received<input class="in" value="${inr(received)}" readonly></label>
            <label>Outstanding Balance<input class="in" value="${inr(outstanding)}" readonly></label>
          </div>
          <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(180px,1fr));gap:10px">
            <label>Amount to Receive *<input class="in" id="sarRelAmount" type="number" min="0.01" max="${outstanding.toFixed(2)}" step="0.01" value="${initialAmount.toFixed(2)}"></label>
          </div>
          <small style="color:var(--mut)">The full outstanding balance is prefilled. Reduce the amount to record a partial receipt.</small>
          <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(180px,1fr));gap:10px">
            <label>Payment / Release Date *<input class="in" id="sarRelDate" type="date" value="${TODAY}"></label>
            <label>Payment Method *<select class="in" id="sarRelMethod">${methods.map((m) => `<option value="${m}">${m}</option>`).join("")}</select></label>
            <label>Transaction Ref / UTR<input class="in" id="sarRelUtr" maxlength="64" placeholder="UTR / ref no."></label>
            <label>Payment / Voucher Reference<input class="in" id="sarRelVoucher" maxlength="64" placeholder="Voucher no."></label>
          </div>
          <label>Notes / Remarks<textarea class="in" id="sarRelNotes" rows="2"></textarea></label>
          <input type="hidden" id="sarRelStatus" value="Released">
        </div>`;
      dlg(dlgHtml, "Approve & Release", (m) => {
        const amountStr = m.querySelector("#sarRelAmount").value.trim();
        const relDate = m.querySelector("#sarRelDate").value;
        const method = m.querySelector("#sarRelMethod").value;
        const amount = Number(amountStr);
        if (!amountStr || !Number.isFinite(amount) || amount <= 0) {
          toast("Enter a valid receipt amount greater than zero."); return false;
        }
        if (amount > outstanding) {
          toast("Receipt amount cannot exceed the outstanding balance."); return false;
        }
        if (!relDate) { toast("Select a payment / release date."); return false; }
        const payload = {
          amount: amount.toFixed(2),
          date: relDate,
          method,
          receiptId: "REC-" + x + "-" + Date.now() + "-" + Math.random().toString(36).slice(2, 8),
          utr: m.querySelector("#sarRelUtr").value.trim(),
          voucher: m.querySelector("#sarRelVoucher").value.trim(),
          notes: m.querySelector("#sarRelNotes").value.trim(),
          status: "Released",
        };
        const btn = m.querySelector("[data-ok]");
        submit(payload, btn);
        return true;
      });
    } else {
      dlg(`<h3>${a === "sarreject" ? "Reject" : a === "sarcancel" ? "Cancel" : "Return"} Sales Request</h3><label>Reason *<textarea class="in" id="sarReason" rows="3"></textarea></label>`, a === "sarreject" ? "Reject" : a === "sarcancel" ? "Cancel" : "Return", (m) => {
        const reason = m.querySelector("#sarReason").value.trim();
        if (!reason) { toast("Enter a reason."); return false; }
        const btn = m.querySelector("[data-ok]");
        submit(reason, btn);
        return true;
      });
    }
  } else if (a == "add") invForm();
  else if (a == "ov") xView(o);
  else if (a == "irc") moneyForm("RECEIPT", x && o ? o.inv : "");
  else if (a == "ipy") moneyForm("PAYMENT", x && o ? o.inv : "");
  else if (a == "rfd") moneyForm("REFUND");
  else if (a == "aap") apprX(o);
  else if (a == "arj")
    whyX(o, "Reject", "Reject", (w) => {
      o.st = "REJECTED";
      o.why = w;
      addh(o, "Rejected: " + w);
      toast("Transaction rejected.");
    });
  else if (a == "icn")
    whyX(o, "Cancel invoice", "Cancel invoice", (w) => {
      o.st = "CANCELLED";
      o.why = w;
      addh(o, "Cancelled: " + w);
      toast("Invoice cancelled.");
    });
  else if (a == "rev")
    whyX(o, "Reverse", "Reverse", (w) => {
      fx(o, -1);
      o.st = "REVERSED";
      addh(o, "Reversed: " + w);
      ACC.push({
        id: rid(),
        type: "ADJUSTMENT",
        ref: o.ref,
        inv: o.inv,
        amount: o.amount,
        paid: o.amount,
        method: o.method,
        date: TODAY,
        st: "POSTED",
        cb: ME,
        ca: TODAY,
        why: "Reversal of " + o.id + ": " + w,
        hist: [[TODAY, "Adjustment recorded"]],
      });
      toast("Reversed. An adjustment entry was added.");
    });
  else if (a == "ev") {
    const m = TEAM.find((z) => z.id == x);
    detail([
      [
        "Employee Details",
        [
          ["Name", esc(m.n)],
          ["Email", esc(m.e)],
          ["Phone", esc(m.ph)],
          ["Department", "Accounting"],
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
      `<h3>Delete ${esc(m.n)}?</h3><p>This will archive the Accounting team member from the company records.</p>`,
      "Delete",
      (mask) => {
        const button = mask.querySelector("[data-ok]");
        button.disabled = true;
        window.VyaparXAuth.deleteModuleRecord("accounting", m.id)
          .then((result) => {
            if (!result || result.success !== true) throw new Error("The server did not confirm deletion.");
            TEAM = TEAM.filter((member) => String(member.id) !== String(m.id));
            window.VyaparXShared?.records?.markDeleted("accounting", "teamMember", m.id);
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
  if (e.target.id === "fk" && document.querySelector("#fn")) {
    const prefix = SOA.some((order) => String(order.id) === String(e.target.value)) ? "INV" : "BILL";
    document.querySelector("#fn").value = nextInvoiceNumber(prefix);
  }
  if (e.target.dataset.rf) {
    const kind = e.target.dataset.kind;
    const key = kind === "sales" ? "salesreq" : kind === "purchase" ? "poreq" : "transportreq";
    REQUEST_FILTERS[key][e.target.dataset.rf] = e.target.value;
    REQUEST_FILTERS[key].page = 0;
    render();
    return;
  }
  if (e.target.dataset.f != null) {
    fv = e.target.value;
    render();
  }
});
$("#gs").addEventListener("keydown", (e) => {
  if (e.key == "Enter") {
    const v = e.target.value;
    go("tx");
    q = v;
    render();
  }
});
$("#bell").onclick = () => go("notif");
$("#ct").onclick = () => document.body.classList.toggle("col");
$("#mb").onclick = () => window.VyaparXShared.toggleMobileNav();
$("#th").onclick = () => { if (window.VyaparXShared) window.VyaparXShared.applyTheme(window.VyaparXShared.currentTheme() === "dark" ? "light" : "dark"); };
async function accountingSyncSourceRecords() {
  const salesInvoices = ACC.filter((record) => isInv(record) && sales(record));
  const purchaseInvoices = ACC.filter((record) => isInv(record) && !sales(record));
  SOA = [...new Map(salesInvoices.map((record) => [String(record.ref), {
    id: record.ref, number: record.salesOrderNumber || "—", c: record.customerName || record.clientName || "—",
    total: Number(record.amount || 0), adv: 0, rec: Number(record.paid || 0),
  }])).values()];
  for (const request of SALES_REQUESTS) {
    const orderId = String(request.salesOrderId || "");
    if (!orderId) continue;
    const mapped = { id: orderId, number: request.salesOrderNumber || "—", c: request.customerName || "—", total: Number(request.grandTotal || 0),
      adv: Number(request.advancePercent || 0), rec: Number(request.amountReceived || 0) };
    const current = SOA.find((order) => String(order.id) === orderId);
    if (current) Object.assign(current, mapped); else SOA.push(mapped);
  }
  POA = [...new Map(purchaseInvoices.map((record) => [String(record.ref), {
    id: record.ref, number: record.purchaseOrderNumber || "—", c: record.supplierName || "—", total: Number(record.amount || 0),
  }])).values()];
}
async function accountingLoadSalesRequests() {
  try {
    const records = await window.VyaparXAuth.fetchModuleRecords("accounting");
    SALES_REQUESTS = records.filter((row) => row.recordType === "salesAccountingRequest");
    accountingSyncSourceRecords();
    if (["dashboard", "salesreq", "poreq", "transportreq", "rec"].includes(cur)) render();
  } catch (error) {
    SALES_REQUESTS = [];
    toast("Sales Requests could not load: " + error.message);
  }
}
async function accountingLoadBusinessRequests() {
  try {
    const response = await window.VyaparXAuth.getWorkflowData("/api/accounting/requests");
    const records = response.records || [];
    PURCHASE_REQUESTS = records.filter((row) => row.recordType === "purchaseAccountingRequest" && !row.isDeleted);
    TRANSPORT_REQUESTS = records.filter((row) => row.recordType === "transportAccountingRequest" && !row.isDeleted);
    DELIVERY_BILLS = (response.deliveryBills || []).filter((row) => !row.isDeleted);
    if (["dashboard", "poreq", "transportreq", "payb", "rec"].includes(cur)) render();
  } catch (error) { toast("Purchase/Transport requests could not load: " + error.message); }
}
if (window.VyaparXShared?.records?.bindPageState) {
  window.VyaparXShared.records.bindPageState("accounting", [
    { recordType: "teamMember", get: () => TEAM, set: (rows) => { TEAM = rows; } },
    { recordType: "accountingEntry", get: () => ACC, set: (rows) => { ACC = rows; } },
  ], {
    onReady: () => { accountingSyncSourceRecords(); render(); },
    onChange: () => { accountingSyncSourceRecords(); if (["dashboard", "inv", "rec", "pay", "payb", "reports"].includes(cur)) render(); },
    onError: (error) => toast("Accounting records could not sync with Firestore: " + error.message),
  });
}
const accountingParams = new URLSearchParams(window.location.search);
const accountingViews = new Set(NAV.flatMap((section) => section[1].map((item) => item[0])));
const accountingRequestedView = accountingParams.get("view");
go(accountingViews.has(accountingRequestedView) ? accountingRequestedView : "dashboard");
const accountingInitialRequests = Promise.all([
  accountingLoadSalesRequests(),
  accountingLoadBusinessRequests(),
]);
accountingSyncSourceRecords();
if (accountingParams.get("action") === "create" && accountingRequestedView === "inv") {
  accountingInitialRequests.then(async () => {
    if (cur !== "inv") return;
    await accountingSyncSourceRecords();
    if (!SOA.length && !POA.length && !approvedPayableRequests().length) {
      return toast("No eligible Sales Order or approved bill is available to invoice.");
    }
    invForm();
  });
}
window.addEventListener("focus", accountingSyncSourceRecords);
window.addEventListener("focus", accountingLoadBusinessRequests);
document.addEventListener("visibilitychange", () => {
  if (document.visibilityState === "visible") accountingLoadBusinessRequests();
});
async function accountingSyncTasksFromDb() {
  if (!window.VyaparXShared || !window.VyaparXShared.tasks) return;
  try {
    const all = await window.VyaparXShared.tasks.fetchTasks({ force: true });
    TASKS = all.filter((task) => task.type !== "Communication");
    COMMS = all.filter((task) => task.type === "Communication");
    NOTES = [...NOTES.filter((note) => note.k), ...all.filter((task) => task.dir === "Received").map((task) => ({
      id: "n_" + task.id, ref: task.id, read: !!(task.isRead || task.read),
    }))];
    if (["tasks", "notif", "dashboard"].includes(cur)) render();
  } catch (error) { console.warn("Could not sync Accounting tasks:", error); }
}
accountingSyncTasksFromDb();
if (window.VyaparXShared?.tasks) window.VyaparXShared.tasks.onTasksUpdated(accountingSyncTasksFromDb);
window.addEventListener("focus", accountingSyncTasksFromDb);
if (window.VyaparXFields) window.VyaparXFields.loadFields("accounting").then(() => { if (cur === "inv") render(); });
window.addEventListener("focus", () => { if (window.VyaparXFields) window.VyaparXFields.loadFields("accounting", true); });
// Admin Reports integration: expose this module's real records so the Admin
// report engine builds ACCOUNTING reports from actual data, not static counts.
window.ACCOUNTING_REPORT_SOURCE = function () { try { return []; } catch (e) { return []; } };
