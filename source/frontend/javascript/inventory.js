/**
 * VyaparX ERP - Inventory & Warehouse Management Controller
 * Manages Item Master, Stock In/Out, Stock History, and Threshold Reorders.
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
  if (!d) return "�";
  const date = new Date(d);
  return Number.isNaN(date.getTime()) ? "�" : date.toLocaleDateString("en-GB", { day: "2-digit", month: "2-digit", year: "numeric" });
};
function detail(secs) {
  const m = document.createElement("div");
  m.className = "mask vm";
  m.innerHTML = `<div class="dlg detail-dialog" role="dialog" aria-label="${secs[0][0]}"><button class="ic" data-x aria-label="Close" title="Close" style="position:absolute;top:12px;right:12px;z-index:3;display:inline-flex;align-items:center;justify-content:center;width:32px;height:32px;border-radius:50%;border:1px solid var(--bd);background:var(--card);color:var(--txt);cursor:pointer"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" aria-hidden="true"><path d="M6 6l12 12M18 6L6 18"/></svg></button>${secs.map(([t, r], i) => `<div style="margin-top:${i ? 18 : 0}px"><b style="font-weight:600;display:block;padding:0 ${i ? 0 : 36}px 6px 0;font-size:${i ? 14 : 16}px;border-bottom:1px solid var(--bd);margin-bottom:10px">${t}</b>${r ? `<div style="display:grid;grid-template-columns:130px minmax(0,1fr);gap:10px 16px">${r.map((x) => `<span style="color:var(--mut)">${x[0]}</span><span style="font-weight:500;overflow-wrap:anywhere">${x[1]}</span>`).join("")}</div>` : `<span style="color:var(--mut)">No activity yet.</span>`}</div>`).join("")}</div>`;
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
const inr = (n) => "₹" + Number(n).toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 }),
  ROLE = "Department Head",
  PH = /^\d{10}$/,
  EM = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;
const NAV = [
  [
    "INVENTORY",
    [
      [
        "dashboard",
        "Dashboard",
        "<rect x='3' y='3' width='7' height='9'/><rect x='14' y='3' width='7' height='5'/><rect x='14' y='12' width='7' height='9'/><rect x='3' y='16' width='7' height='5'/>",
      ],
      [
        "items",
        "Items",
        "<path d='M21 8l-9-5-9 5v8l9 5 9-5zM3 8l9 5 9-5M12 13v8'/>",
      ],
      ["planning", "Material Requests", "<path d='M4 5h16M4 12h16M4 19h16M8 3v4M16 10v4M10 17v4'/>"] ,
      ["purchaseOrders", "Purchase Orders", "<path d='M6 3h12l2 5v13H4V8zM4 8h16M9 12h6'/>"] ,
      ["stock", "Stock", "<path d='M4 20V10M10 20V4M16 20v-7M22 20H2'/>"],
      ["sin", "Stock In", "<path d='M12 3v12M7 10l5 5 5-5M4 20h16'/>"],
      ["sout", "Stock Out", "<path d='M12 15V3M7 8l5-5 5 5M4 20h16'/>"],
      ["low", "Low Stock", "<path d='M12 3l10 18H2zM12 10v5M12 18v.5'/>"],
      [
        "hist",
        "Stock History",
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
const UNITS = ["Nos", "Kg", "Roll", "Litre", "Metre", "Box"];
let ITM = [];
let PLAN_REQUESTS = [];
let PURCHASE_REQUESTS = [];
let MR_SEARCH = "", MR_STATUS = "All", MR_PRIORITY = "All", MR_FROM = "", MR_TO = "";
let MOV = [];
let ADJ = [];
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
const canManageTeam = () => window.VyaparXShared?.departmentTeam?.canManage("inventory") === true;

let _cachedCompanyPeople = null;
const PEOPLE = () => {
  if (window.VyaparXShared && window.VyaparXShared.getCompanyPeople) {
    if (!_cachedCompanyPeople) window.VyaparXShared.getCompanyPeople().then((res) => { _cachedCompanyPeople = res; });
    if (_cachedCompanyPeople) return _cachedCompanyPeople;
  }
  return [];
};
const dept = (n) => (PEOPLE().find((p) => p.n == n) || { d: "Inventory" }).d,
  meM = () => {
    const member = TEAM.find((m) => m.id == "M1");
    if (member) return member;
    const session = window.VyaparXAuth?.getCurrentSession?.() || {};
    const name = session.fullName || session.name || ME || "Inventory User";
    return {
      id: "M1",
      n: name,
      eid: session.employeeId || "�",
      e: session.email || "",
      des: session.designation || session.department || "Inventory",
      r: session.role || "Inventory",
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
const REC = (id) => (id[0] == "t" ? TASKS : COMMS).find((r) => r.id == id),
  nvis = () =>
    NOTES.filter((n) =>
      n.k ? (n.k == "appr" ? pendA().length : lowc().length) > 0 : !!REC(n.ref),
    );
const ntext = (n) => {
  if (n.k)
    return n.k == "appr"
      ? `${pendA().length} stock adjustment(s) waiting for approval`
      : `${lowc().length} item(s) at or below reorder level`;
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
const ss = (i) =>
    i.qty == 0 ? "OUT_OF_STOCK" : i.qty <= i.ro ? "LOW_STOCK" : "IN_STOCK",
  lowc = () => ITM.filter((i) => ss(i) != "IN_STOCK"),
  pendA = () => ADJ.filter((a) => a.st == "PENDING_APPROVAL");
const st = (s) => {
  const c = /^(IN_STOCK|APPLIED|ACTIVE|Completed|Low|Read)$/.test(s)
    ? "ok"
    : /^(PENDING_APPROVAL|LOW_STOCK|INACTIVE|Pending|In Progress|High|Medium|Unread)$/.test(
          s,
        )
      ? "wa"
      : /^(OUT_OF_STOCK|REJECTED|Urgent)$/.test(s)
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
const OB = (id) => ITM.find((i) => i.id == id),
  addh = () => 0;
const kpi = (a, b) =>
  `<div class="card kpi"><small>${a}</small><b>${b}</b></div>`;
const IC = ["Code", "Item", "Quantity", "Reorder Level", "Status"],
  irow = (i) => [i.code, esc(i.n), i.qty + " " + i.unit, i.ro, ss(i)],
  IBC = (c) => ITM.find((i) => i.code == c),
  inm = (id) => ITM.find((z) => z.id == id);
const mrow = (m) => {
    const i = inm(m.item);
    return [
      fs(m.date),
      esc(i.n),
      m.t,
      m.qty + " " + i.unit,
      esc(m.ref),
      esc(m.by),
    ];
  },
  MC = ["Date", "Item", "Type", "Quantity", "Reference", "By"];
const iact = (r) => {
  const i = IBC(r[0]),
    b = (a, l) => `<button class="btn s" data-act="${a}:${i.id}">${l}</button>`;
  return (
    b("iv", "View") +
    b("sin", "Stock In") +
    b("sout", "Stock Out") +
    b("sadj", "Adjust")
  );
};
const V = {
  dashboard() {
    const lw = lowc();
    return (
      ph(
        inventoryGreeting(),
        "Stock levels, movements and alerts in one place.",
        ["sin", "Record Stock In"],
      ) +
      `<div class="grid k6">${kpi("Total Items", ITM.length)}${kpi("In Stock", ITM.filter((i) => ss(i) == "IN_STOCK").length)}${kpi("Low Stock", ITM.filter((i) => ss(i) == "LOW_STOCK").length)}${kpi("Out of Stock", ITM.filter((i) => ss(i) == "OUT_OF_STOCK").length)}${kpi("Pending Adjustments", pendA().length)}</div>
 <div class="grid two" style="margin-top:14px"><div class="card"><h3>Recent movements</h3><div class="tw"><table><tr><th>Date</th><th>Item</th><th>Type</th><th>Qty</th></tr>${MOV.slice(
   0,
   5,
 )
   .map((m) => {
     const r = mrow(m);
     return `<tr><td>${r[0]}</td><td>${r[1]}</td><td>${r[2]}</td><td>${r[3]}</td></tr>`;
   })
   .join("")}</table></div></div>
 <div class="card"><h3>Low stock alerts</h3>${lw.length ? lw.map((i) => `<div style="display:flex;justify-content:space-between;align-items:center;padding:8px 0;border-bottom:1px solid var(--bd)"><span>${esc(i.n)}<br><small style="color:var(--mut)">${i.qty} ${i.unit} � reorder at ${i.ro}</small></span>${st(ss(i))}</div>`).join("") : `<div class="empty">All items are above their reorder level.</div>`}</div></div>`
    );
  },
  items() {
    return (
      ph(
        "Items",
        "Item master. Quantity changes only through stock movements.",
        ["iadd", "Add Item"],
      ) +
      table(window.VyaparXFields.tableColumns("inventory", IC), ITM.map((i) => window.VyaparXFields.tableRow("inventory", i, irow(i))), {
        filter: ["IN_STOCK", "LOW_STOCK", "OUT_OF_STOCK"],
        colModule: "inventory",
        act: (r) => {
          const i = IBC(r[0]);
          return `<button class="btn s" data-act="iv:${i.id}"><i class="fa-solid fa-eye" aria-hidden="true"></i></button><button class="btn s" data-act="ie:${i.id}" title="Edit" aria-label="Edit"><i class="fa-solid fa-pen-to-square" aria-hidden="true"></i></button><button class="btn s" data-act="id:${i.id}"><i class="fa-solid fa-trash-can" aria-hidden="true"></i></button>`;
        },
        empty: "No items yet.",
      })
    );
  },
  stock() {
    return (
      ph(
        "Stock",
        "Current stock. LOW STOCK when quantity is at or below the reorder level.",
        ["sadj", "Request Adjustment"],
      ) +
      table(IC, ITM.map(irow), {
        filter: ["IN_STOCK", "LOW_STOCK", "OUT_OF_STOCK"],
        act: iact,
      }) +
      `<h3 style="margin:14px 0 10px">Stock adjustments</h3>` +
      table(
        ["ID", "Item", "Change", "Reason", "Requested By", "Status"],
        ADJ.map((a) => [
          a.id,
          esc(inm(a.item).n),
          (a.d > 0 ? "+" : "") + a.d + " " + inm(a.item).unit,
          esc(a.reason),
          esc(a.by),
          a.st,
        ]),
        {
          act: (r) => {
            const a = ADJ.find((z) => z.id == r[0]);
            return a.st == "PENDING_APPROVAL"
              ? `<button class="btn s" data-act="aap:${a.id}">Approve</button><button class="btn s" data-act="arj:${a.id}">Reject</button>`
              : "";
          },
          empty: "No adjustments yet.",
        },
      )
    );
  },
  sin() {
    return (
      ph("Stock In", "Goods received into stock.", ["sin", "Record Stock In"]) +
      table(MC, MOV.filter((m) => m.t == "IN").map(mrow), {
        empty: "No stock-in records yet.",
      })
    );
  },
  sout() {
    return (
      ph(
        "Stock Out",
        "Goods issued from stock. Stock can never go below zero.",
        ["sout", "Record Stock Out"],
      ) +
      table(MC, MOV.filter((m) => m.t == "OUT").map(mrow), {
        empty: "No stock-out records yet.",
      })
    );
  },
  low() {
    return (
      ph("Low Stock", "Items at or below their reorder level.") +
      table(
        ["Code", "Item", "Quantity", "Reorder Level", "Shortfall", "Status"],
        lowc().map((i) => [
          i.code,
          esc(i.n),
          i.qty + " " + i.unit,
          i.ro,
          Math.max(0, i.ro - i.qty) + " " + i.unit,
          ss(i),
        ]),
        {
          act: (r) => {
            const i = IBC(r[0]);
            return `<button class="btn s" data-act="lnp:${i.id}">Notify Purchase</button><button class="btn s" data-act="sin:${i.id}">Stock In</button>`;
          },
          empty: "No low stock items.",
        },
      )
    );
  },
  hist() {
    return (
      ph("Stock History", "Every stock movement and approved adjustment.") +
      table(MC, MOV.map(mrow), {
        filter: ["IN", "OUT", "ADJUST"],
        empty: "No movements yet.",
      })
    );
  },
  reports() {
    return (
      ph("Reports", "Inventory position from current stock.") +
      `<div class="bar" style="margin:0"><button class="btn" data-act="csv" title="Export CSV" aria-label="Export CSV"><i class="fa-solid fa-file-csv"></i></button><button class="btn" onclick="print()" title="Print" aria-label="Print"><i class="fa-solid fa-print"></i></button></div><div class="grid k6" style="margin:14px 0">${kpi("Total items", ITM.length)}${kpi("Low stock", ITM.filter((i) => ss(i) == "LOW_STOCK").length)}${kpi("Out of stock", ITM.filter((i) => ss(i) == "OUT_OF_STOCK").length)}${kpi("Movements", MOV.length)}</div><div class="grid" style="grid-template-columns:repeat(auto-fit,minmax(300px,1fr))"><div class="card"><h3>By status</h3><table style="min-width:0">${["IN_STOCK", "LOW_STOCK", "OUT_OF_STOCK"].map((s) => `<tr><td>${st(s)}</td><td>${ITM.filter((i) => ss(i) == s).length}</td></tr>`).join("")}</table></div></div>`
    );
  },
  team() {
    return (
      ph(
        "My Team",
        "Only Inventory employees appear here.",
        canManageTeam() ? ["madd", "Add Member"] : null,
      ) +
      table(
        ["Name", "Designation", "Movements", "Status"],
        TEAM.map((m) => [
          esc(m.n),
          esc(m.des),
          MOV.filter((z) => z.by == m.n).length,
          "ACTIVE",
        ]),
        {
          act: (r) => {
            const m = TEAM.find((z) => esc(z.n) == r[0]);
            return (
              `<button class="btn s" data-act="ev:${m.id}"><i class="fa-solid fa-eye" aria-hidden="true"></i></button>` +
              (canManageTeam()
                ? `<button class="btn s" data-act="me:${m.id}">? Edit</button>`
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
    if (load) return H + `<div class="card empty">Loading�</div>`;
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
        fl = (r) => (r.att.length ? "?? " + r.att.length : "�"),
        oth = (r) => (r.from == ME ? r.td : r.fd);
      const rows = list.map((r) =>
        T
          ? [
              `<button style="border:0;background:none;padding:0;color:var(--pt);font:inherit;text-align:left;cursor:pointer" data-act="tv:${r.id}">${esc(r.s)}</button>`,
              esc(r.desc.length > 40 ? r.desc.slice(0, 40) + "�" : r.desc),
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
  planning() {
    const all = PLAN_REQUESTS.filter((p) => !p.isDeleted && p.recordType === "materialPlan");
    const plans = all.filter((p) => {
      const status = p.approvalStatus === "Pending" ? "Pending Inventory Approval" : p.approvalStatus || "Pending Inventory Approval";
      const haystack = [p.materialRequestNo, p.requestCode, p.id, p.productName, p.salesOrderNumber, ...(p.materials || []).flatMap((m) => [m.materialCode, m.materialName])].join(" ").toLowerCase();
      return (!MR_SEARCH || haystack.includes(MR_SEARCH.toLowerCase())) && (MR_STATUS === "All" || status === MR_STATUS) && (MR_PRIORITY === "All" || p.priority === MR_PRIORITY) && (!MR_FROM || (p.planningDate || "") >= MR_FROM) && (!MR_TO || (p.planningDate || "") <= MR_TO);
    });
    const pending = all.filter((p) => !p.approvalStatus || p.approvalStatus === "Pending").length;
    const approved = all.filter((p) => p.approvalStatus === "Approved").length;
    const rejected = all.filter((p) => p.approvalStatus === "Rejected").length;
    const procurement = all.filter((p) => (p.materials || []).some((m) => Number(m.purchaseQuantity || 0) > 0)).length;
    const rows = plans.flatMap((p) => (p.materials || []).length ? p.materials.map((m) => ({ p, m })) : [{ p, m: {} }]);
    return ph("Material Requests", "Production raw material requests awaiting Inventory review.", ["planrefresh", "Refresh"]) +
      `<div class="grid k5">${kpi("Total Requests", all.length)}${kpi("Pending Approval", pending)}${kpi("Approved", approved)}${kpi("Rejected", rejected)}${kpi("Procurement Required", procurement)}</div><div class="bar" style="margin-top:12px"><input class="in" data-mrq placeholder="Search request, product, material or work order" value="${esc(MR_SEARCH)}"><select class="in" data-mrf="status">${["All", "Pending Inventory Approval", "Approved", "Rejected", "Cancelled"].map((v) => `<option ${v === MR_STATUS ? "selected" : ""}>${v}</option>`).join("")}</select><select class="in" data-mrf="priority">${["All", "Low", "Medium", "High", "Urgent"].map((v) => `<option ${v === MR_PRIORITY ? "selected" : ""}>${v}</option>`).join("")}</select><label>From <input class="in" type="date" data-mrf="from" value="${MR_FROM}"></label><label>To <input class="in" type="date" data-mrf="to" value="${MR_TO}"></label></div><div class="card"><div class="tw"><table><thead><tr>${["Request ID", "Production Request / Work Order", "Product", "Raw Material", "Required Qty", "Available Stock", "Shortage", "Unit", "Requested By", "Request Date", "Required Date", "Priority", "Status", "Actions"].map((h) => `<th>${h}</th>`).join("")}</tr></thead><tbody>${rows.length ? rows.map(({ p, m }) => { const status = p.approvalStatus === "Pending" ? "Pending Inventory Approval" : p.approvalStatus || "Pending Inventory Approval"; const pendingRow = status === "Pending Inventory Approval"; return `<tr><td>${esc(p.materialRequestNo || p.id)}</td><td>${esc([p.requestCode || p.productionRequestNo || p.productionRequestId, p.productionOrderNo || p.productionOrderId].filter(Boolean).join(" � ") || "�")}</td><td>${esc(p.productName || "�")}</td><td>${esc(m.materialName || m.materialCode || "�")}</td><td>${Number(m.requiredQty ?? m.requiredQuantity ?? 0)}</td><td>${Number(m.availableStock || 0)}</td><td>${Number(m.shortageQuantity || 0)}</td><td>${esc(m.unit || "�")}</td><td>${esc(p.submittedByName || p.createdByName || "�")}</td><td>${esc(p.planningDate || p.createdAt || "�")}</td><td>${esc(m.requiredByDate || p.materialRequiredByDate || "�")}</td><td>${esc(p.priority || "�")}</td><td>${st(status)}</td><td><span style="display:flex;gap:4px"><button class="btn s" title="View request" data-act="plview:${esc(p.id)}">View</button>${pendingRow ? `<button class="btn s" title="Check latest stock" data-act="plcheck:${esc(p.id)}">Check</button><button class="btn s p" title="Approve" data-act="plapprove:${esc(p.id)}">Approve</button><button class="btn s" title="Reject" data-act="plreject:${esc(p.id)}">Reject</button><button class="btn s" title="Cancel request" data-act="pldelete:${esc(p.id)}">Cancel</button>` : ""}</span></td></tr>`; }).join("") : `<tr><td colspan="14"><div class="empty">${all.length ? "No requests match your filters." : "No Production material requests have been submitted."}</div></td></tr>`}</tbody></table></div></div>`;
  },
  purchaseOrders() {
    const rows = PURCHASE_REQUESTS.filter((r) => !r.isDeleted);
    return ph("Purchase Orders", "Create a Raw Material Requisition bill and send it to Purchase for supplier pricing and approval.", ["prnew", "New Purchase Request"]) +
      `<div class="bar"><button class="btn" data-act="prrefresh">Refresh</button></div><div class="card"><div class="tw"><table><thead><tr><th>Bill / Request</th><th>Raw Materials</th><th>Expected Date</th><th>Requested By</th><th>Status</th><th>Purchase Order</th><th>Delivery Date</th><th>Bill</th></tr></thead><tbody>${rows.length ? rows.map((r) => `<tr><td>${esc(r.id)}</td><td>${(r.items || []).map((item) => `${esc(item.itemName)} � ${Number(item.quantity)} ${esc(item.unit)}`).join("<br>") || esc(r.itemName || "�")}</td><td>${esc(r.expectedDate || "�")}</td><td>${esc(r.requestedBy)}</td><td>${st(r.status)}</td><td>${esc((r.purchaseOrderIds || [r.purchaseOrderId]).filter(Boolean).join(", ") || "�")}</td><td>${esc(r.deliveryDate || "�")}</td><td><button class="btn s" data-act="prbill:${esc(r.id)}">View / Print</button></td></tr>`).join("") : `<tr><td colspan="8"><div class="empty">No purchase requests yet. Create one to send a Raw Material Requisition bill to Purchase.</div></td></tr>`}</tbody></table></div></div>`;
  },
  notif() {
    const L = nvis();
    return (
      ph("Notifications", "Only notices for Inventory and you.") +
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
function inventoryGreeting() {
  const session = window.VyaparXAuth?.getCurrentSession?.() || {};
  const hour = new Date().getHours();
  const greeting = hour < 12 ? "Good Morning" : hour < 17 ? "Good Afternoon" : hour < 20 ? "Good Evening" : "Good Night";
  return session.fullName || session.name ? `${greeting}, ${session.fullName || session.name}` : greeting;
}
function render() {
  const l = NAV.flatMap((n) => n[1]).find((x) => x[0] == cur)[1];
  $("#pt").textContent = l;
  $("#bc").textContent = "Inventory / " + l;
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
  if (v === "planning") loadPlanningRequests();
  document.body.classList.remove("open");
}
const sel2 = (id, a, v, ph2) =>
    `<select class="in" id="${id}"><option value="">${ph2}</option>${a.map((x) => `<option ${x == v ? "selected" : ""}>${esc(x)}</option>`).join("")}</select>`,
  iopts = (v) =>
    `<select class="in" id="mi"><option value="">Select item</option>${ITM.map((i) => `<option value="${i.id}" ${i.id == v ? "selected" : ""}>${i.code} � ${esc(i.n)} (${i.qty} ${i.unit})</option>`).join("")}</select>`;
function itemForm(o) {
  const n = !o;
  o = o || { code: "", n: "", unit: "", qty: "", ro: "" };
  dlg(
    `<h3>${n ? "Add item" : "Edit " + o.code}</h3><div class="fm"><label>Item Code *<input class="in" id="ic" placeholder="ABC-123" value="${esc(o.code)}" ${n ? "" : "disabled"}></label><label>Item Name *<input class="in" id="in" value="${esc(o.n)}"></label><label>Unit *${sel2("iu", UNITS, o.unit, "Select unit")}</label>${n ? `<label>Opening Quantity *<input class="in" id="iq" inputmode="numeric" value="0"></label>` : ""}<label>Reorder Level *<input class="in" id="ir" inputmode="numeric" value="${o.ro}"></label></div>${window.VyaparXFields ? window.VyaparXFields.formFieldsHtml("inventory", o) : ""}`,
    n ? "Add item" : "Save changes",
    () => {
      if (
        !vf([
          [
            "#ic",
            (v) => /^[A-Z]{3}-\d{3}$/.test(v.toUpperCase()),
            "Use the format ABC-123.",
          ],
          [
            "#ic",
            (v) => !ITM.some((z) => z !== o && z.code == v.toUpperCase()),
            "This item code already exists.",
          ],
          ["#in", (v) => v.length > 0, "Enter the item name."],
          ["#iu", (v) => v, "Select the unit."],
          ...(n
            ? [
                [
                  "#iq",
                  (v) => /^\d+$/.test(v),
                  "Quantity must be 0 or a positive whole number.",
                ],
              ]
            : []),
          [
            "#ir",
            (v) => /^\d+$/.test(v),
            "Reorder level must be 0 or a positive whole number.",
          ],
        ])
      )
        return false;
      const f = {
        n: $("#in").value.trim(),
        unit: $("#iu").value,
        ro: +$("#ir").value,
      };
      if (window.VyaparXFields) {
        const ce = window.VyaparXFields.validateForm("inventory", document);
        if (ce.length) { toast(ce[0]); return false; }
        window.VyaparXFields.applyToRecord("inventory", f, window.VyaparXFields.readFormValues(document));
      }
      if (n) {
        const it = {
          ...f,
          id: "I" + (ITM.reduce((maximum, item) => Math.max(maximum, Number(String(item.id || "").slice(1)) || 0), 0) + 1),
          code: $("#ic").value.trim().toUpperCase(),
          qty: +$("#iq").value,
        };
        ITM.push(it);
        if (it.qty)
          MOV.unshift({
            item: it.id,
            t: "IN",
            qty: it.qty,
            ref: "Opening stock",
            date: TODAY,
            by: ME,
          });
      } else Object.assign(o, f);
      render();
      toast(n ? "Item added successfully." : "Item updated successfully.");
    },
  );
}
function itemView(i) {
  detail([
    [
      "Item Details",
      [
        ["Item Code", i.code],
        ["Item Name", esc(i.n)],
        ["Unit", i.unit],
        ["Status", st(ss(i))],
      ],
    ],
    [
      "Stock",
      [
        ["Quantity", i.qty + " " + i.unit],
        ["Reorder Level", i.ro + " " + i.unit],
        ["Shortfall", Math.max(0, i.ro - i.qty) + " " + i.unit],
      ],
    ],
    [
      "Recent Movements",
      MOV.filter((m) => m.item == i.id)
        .slice(0, 8)
        .map((m) => [fs(m.date), `${m.t} ${m.qty} ${i.unit} � ${esc(m.ref)}`]),
    ],
  ]);
}
function delItem(i) {
  if (i.qty > 0 || MOV.some((m) => m.item == i.id))
    return toast("This item has stock history, so it can't be deleted.");
  OKD(
    "Delete item?",
    `${esc(i.n)} will be removed from the item master.`,
    "Delete",
    () => {
      ITM = ITM.filter((z) => z !== i);
      render();
      toast("Item deleted successfully.");
    },
  );
}
function mvForm(t, id) {
  const IN = t == "IN";
  dlg(
    `<h3>Record stock ${IN ? "in" : "out"}</h3><div class="fm"><label>Item *${iopts(id)}</label><label>Quantity *<input class="in" id="mq" inputmode="numeric"></label><label>Date *<input class="in" type="date" id="md" value="${TODAY}"></label><label>${IN ? "Reference (PO / note)" : "Issued To / Reference *"}<input class="in" id="mr"></label></div>`,
    "Save",
    () => {
      const it = () => ITM.find((z) => z.id == $("#mi").value) || { qty: 0 };
      if (
        !vf([
          ["#mi", (v) => v, "Select the item."],
          [
            "#mq",
            (v) => /^[1-9]\d*$/.test(v),
            "Quantity must be a whole number above 0.",
          ],
          [
            "#mq",
            (v) => IN || +v <= it().qty,
            "Cannot issue more than the available " + it().qty + ".",
          ],
          [
            "#md",
            (v) => v && v <= TODAY,
            "Enter a valid date, not in the future.",
          ],
          [
            "#mr",
            (v) => IN || v.length > 1,
            "Enter who the stock is issued to.",
          ],
        ])
      )
        return false;
      const i = it(),
        q2 = +$("#mq").value;
      i.qty += IN ? q2 : -q2;
      MOV.unshift({
        item: i.id,
        t,
        qty: q2,
        ref: $("#mr").value.trim() || "�",
        date: $("#md").value,
        by: ME,
      });
      render();
      toast("Stock updated successfully.");
    },
  );
}
function adjForm(id) {
  dlg(
    `<h3>Request stock adjustment</h3><div class="fm"><label>Item *${iopts(id)}</label><label>Change *${sel2("ad", ["Increase", "Decrease"], "", "Select")}</label><label>Quantity *<input class="in" id="aq" inputmode="numeric"></label><label>Reason *<input class="in" id="ar"></label></div><p style="color:var(--mut);font-size:12px">An adjustment changes stock only after another person approves it.</p>`,
    "Submit request",
    () => {
      const it = () => ITM.find((z) => z.id == $("#mi").value) || { qty: 0 };
      if (
        !vf([
          ["#mi", (v) => v, "Select the item."],
          ["#ad", (v) => v, "Choose increase or decrease."],
          [
            "#aq",
            (v) => /^[1-9]\d*$/.test(v),
            "Quantity must be a whole number above 0.",
          ],
          [
            "#aq",
            (v) => $("#ad").value != "Decrease" || +v <= it().qty,
            "A decrease cannot exceed the available " + it().qty + ".",
          ],
          [
            "#ar",
            (v) => v.length > 4,
            "Enter a reason (at least 5 characters).",
          ],
        ])
      )
        return false;
      ADJ.unshift({
        id: "A" + (Math.max(0, ...ADJ.map((a) => +a.id.slice(1))) + 1),
        item: $("#mi").value,
        d: ($("#ad").value == "Decrease" ? -1 : 1) * +$("#aq").value,
        reason: $("#ar").value.trim(),
        st: "PENDING_APPROVAL",
        by: ME,
        ca: TODAY,
      });
      render();
      toast("Adjustment submitted for approval.");
    },
  );
}
function apprAdj(id) {
  const a = ADJ.find((z) => z.id == id),
    i = inm(a.item);
  if (a.by == ME)
    return toast(
      "You requested this adjustment, so another approver must approve it.",
    );
  if (i.qty + a.d < 0)
    return toast("Cannot apply: stock would become negative.");
  OKD(
    "Approve adjustment?",
    `${esc(i.n)}: ${a.d > 0 ? "+" : ""}${a.d} ${i.unit}. Stock will change from ${i.qty} to ${i.qty + a.d}.`,
    "Approve",
    () => {
      i.qty += a.d;
      a.st = "APPLIED";
      MOV.unshift({
        item: i.id,
        t: "ADJUST",
        qty: Math.abs(a.d),
        ref: `Adjustment ${a.id} (${a.d > 0 ? "+" : "-"})`,
        date: TODAY,
        by: ME,
      });
      render();
      toast("Adjustment applied.");
    },
  );
}
function rejAdj(id) {
  const a = ADJ.find((z) => z.id == id);
  dlg(
    `<h3>Reject adjustment ${a.id}?</h3><div class="fm"><label>Reason *<input class="in" id="rj"></label></div>`,
    "Reject",
    () => {
      if (
        !vf([["#rj", (v) => v.length > 2, "Enter the reason for rejection."]])
      )
        return false;
      a.st = "REJECTED";
      render();
      toast("Adjustment rejected.");
    },
  );
}
function purchaseBillHTML(request) {
  const company = request.companySnapshot || {};
  const lines = request.items || [{ itemCode: request.itemCode, itemName: request.itemName, quantity: request.quantity, unit: request.unit }];
  return `<!doctype html><html><head><meta charset="utf-8"><title>${esc(request.id)} - Raw Material Requisition</title><style>body{font:14px Arial,sans-serif;color:#1b2738;margin:36px}header{display:flex;justify-content:space-between;gap:24px;border-bottom:2px solid #243b5a;padding-bottom:16px}h1{font-size:22px;margin:0 0 8px}h2{font-size:17px;margin:26px 0 8px}.muted{color:#526176;line-height:1.5}.right{text-align:right}table{border-collapse:collapse;width:100%;margin-top:18px}th,td{padding:10px;border:1px solid #cbd3df;text-align:left}th{background:#f1f4f8}.foot{margin-top:28px;border-top:1px solid #ccd3dd;padding-top:12px;color:#526176}@media print{body{margin:18mm}}</style></head><body><header><div><h1>${esc(company.registeredBusinessName || company.companyName || "Company")}</h1><div class="muted">${esc(company.address || "")}<br>${esc([company.country, company.state, company.pinCode].filter(Boolean).join(", "))}<br>${company.gstin ? `GSTIN: ${esc(company.gstin)}<br>` : ""}${esc(company.phone || "")} ${esc(company.email || "")}</div></div><div class="right"><h1>RAW MATERIAL REQUISITION</h1><b>Bill / Request No: ${esc(request.id)}</b><br>Request Date: ${esc(fs(request.requestedAt || request.createdAt))}<br>Expected Date: ${esc(fs(request.expectedDate))}<br>Status: ${esc(request.status || "Pending")}</div></header><h2>Requested Materials</h2><table><thead><tr><th>#</th><th>Item Code</th><th>Raw Material</th><th>Quantity</th><th>Unit</th></tr></thead><tbody>${lines.map((line,index)=>`<tr><td>${index+1}</td><td>${esc(line.itemCode || "N/A")}</td><td>${esc(line.itemName || "N/A")}</td><td>${Number(line.quantity || 0)}</td><td>${esc(line.unit || "N/A")}</td></tr>`).join("")}</tbody></table><p><b>Requested by:</b> ${esc(request.requestedBy || "N/A")}</p><p><b>Purpose:</b> ${esc(request.reason || "Raw material replenishment")}</p><div class="foot">This requisition was generated in VyaparX ERP and sent to Purchase for supplier selection and processing.</div><script>window.onload=()=>window.print()<\/script></body></html>`;
}
function printPurchaseBill(request) {
  const bill = window.open("", "_blank");
  if (!bill) return toast("Allow pop-ups to view or print this requisition bill.");
  bill.document.open(); bill.document.write(purchaseBillHTML(request)); bill.document.close();
}
function purchaseRequestForm(initialItem) {
  const mask = document.createElement("div"); mask.className = "mask vm";
  const options = `<option value="">Select raw material</option>${ITM.map((item) => `<option value="${esc(item.id)}">${esc(item.code)} - ${esc(item.n)} (${esc(item.unit)})</option>`).join("")}`;
  mask.innerHTML = `<div class="dlg" role="dialog" aria-modal="true" style="width:min(900px,96vw);max-height:90vh;overflow:auto"><div style="display:flex;justify-content:space-between;gap:10px"><div><h3>New Raw Material Requisition</h3><p>Create the bill and send it to Purchase for supplier and order processing.</p></div><button class="ic" data-x aria-label="Close">x</button></div><div class="grid two"><label>Expected date *<input class="in" id="prExpected" type="date" min="${TODAY}" value="${iso(7)}"></label><label>Purpose / notes<input class="in" id="prReason" value="Raw material replenishment"></label></div><h4>Raw materials</h4><div class="tw"><table><thead><tr><th>Raw material</th><th>Available</th><th>Quantity required</th><th></th></tr></thead><tbody id="prLines"><tr><td><select class="in prItem">${options}</select></td><td class="prStock">?</td><td><input class="in prQty" type="number" min="0.01" step="any" placeholder="Quantity"></td><td><button class="btn s prRemove" type="button">Remove</button></td></tr></tbody></table></div><div style="display:flex;justify-content:space-between;margin-top:12px"><button class="btn" type="button" data-addline>+ Add material</button><button class="btn p" type="button" data-sendbill>Generate Bill & Send to Purchase</button></div><small class="prError" style="color:var(--er)"></small></div>`;
  document.body.append(mask);
  const bindRow = (row) => {
    row.querySelector(".prItem").addEventListener("change", (event) => {
      const item = ITM.find((entry) => String(entry.id) === String(event.target.value));
      row.querySelector(".prStock").textContent = item ? `${item.qty} ${item.unit}` : "?";
    });
    row.querySelector(".prRemove").onclick = () => { if (mask.querySelectorAll("#prLines tr").length > 1) row.remove(); };
  };
  bindRow(mask.querySelector("#prLines tr"));
  if (initialItem) {
    const row = mask.querySelector("#prLines tr");
    row.querySelector(".prItem").value = initialItem.id;
    row.querySelector(".prItem").dispatchEvent(new Event("change"));
    row.querySelector(".prQty").value = Math.max(1, Number(initialItem.ro || 0) - Number(initialItem.qty || 0));
  }
  mask.onclick = async (event) => {
    if (event.target === mask || event.target.closest("[data-x]")) return mask.remove();
    if (event.target.closest("[data-addline]")) {
      const row = document.createElement("tr"); row.innerHTML = `<td><select class="in prItem">${options}</select></td><td class="prStock">?</td><td><input class="in prQty" type="number" min="0.01" step="any" placeholder="Quantity"></td><td><button class="btn s prRemove" type="button">Remove</button></td>`;
      mask.querySelector("#prLines").append(row); bindRow(row); return;
    }
    if (!event.target.closest("[data-sendbill]")) return;
    const lines = [...mask.querySelectorAll("#prLines tr")].map((row) => ({ itemId: row.querySelector(".prItem").value, quantity: Number(row.querySelector(".prQty").value) }));
    if (!mask.querySelector("#prExpected").value || mask.querySelector("#prExpected").value < TODAY || lines.some((line) => !line.itemId || !Number.isFinite(line.quantity) || line.quantity <= 0)) {
      mask.querySelector(".prError").textContent = "Choose an expected date and a raw material with positive quantity for every row."; return;
    }
    const billWindow = window.open("", "_blank");
    const button = event.target.closest("[data-sendbill]"); button.disabled = true;
    try {
      const result = await window.VyaparXAuth.postWorkflowAction("/api/inventory/purchase-orders", { items: lines, expectedDate: mask.querySelector("#prExpected").value, reason: mask.querySelector("#prReason").value.trim() });
      PURCHASE_REQUESTS.unshift(result.record); mask.remove();
      if (billWindow) { billWindow.document.open(); billWindow.document.write(purchaseBillHTML(result.record)); billWindow.document.close(); }
      if (cur === "purchaseOrders") render();
      toast(`Requisition bill ${result.record.id} sent to Purchase.`);
    } catch (error) { if (billWindow) billWindow.close(); button.disabled = false; mask.querySelector(".prError").textContent = error.message; }
  };
}
async function notifyPurchase(i) { purchaseRequestForm(i); }

async function loadPurchaseRequests() {
  try {
    const result = await window.VyaparXAuth.getInventoryPurchaseOrders();
    PURCHASE_REQUESTS = result || [];
    if (cur === "purchaseOrders") render();
  } catch (error) { toast("Purchase orders could not load: " + error.message); }
}

const attSec = (r) => [
  "Attachments",
  r.att.length
    ? r.att.map((a, i) => [
        "File " + (i + 1),
        `<div style="display:grid;gap:6px"><span style="word-break:break-all">${isI(a) ? "??" : "??"} ${esc(a.name)}<br><small style="color:var(--mut)">${a.type} � ${KB(a.size)}</small></span>${isI(a) && a.url ? `<img src="${a.url}" alt="${esc(a.name)}" style="max-width:100%;max-height:180px;border-radius:10px;border:1px solid var(--bd)">` : ""}<span style="display:flex;gap:6px"><button class="btn s" data-act="av:${r.id}:${a.id}"><i class="fa-solid fa-eye" aria-hidden="true"></i></button><button class="btn s" data-act="ad:${r.id}:${a.id}">Download</button></span></div>`,
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
  `<div><div style="font-size:12px;color:var(--mut)">Attachments (optional)</div><button class="btn s" type="button" data-act="aadd" style="margin-top:6px">?? Attach File</button><input type="file" id="tf" hidden multiple accept=".jpg,.jpeg,.png,.webp,.pdf,.doc,.docx,.xls,.xlsx,.csv,.txt"><div id="tfp"></div><small id="tfe" style="color:var(--er)"></small><small style="display:block;color:var(--mut)">Images, PDF, DOC/DOCX, XLS/XLSX, CSV, TXT. Up to 3 files, 5 MB each.</small></div>`;
function attUI() {
  const e = $("#tfp");
  if (e)
    e.innerHTML = PEND.map(
      (a, i) =>
        `<div style="display:flex;gap:10px;align-items:center;border:1px solid var(--bd);border-radius:10px;padding:8px;margin-top:6px">${isI(a) ? `<img src="${a.url}" alt="Preview" style="width:44px;height:44px;object-fit:cover;border-radius:8px">` : `<span style="font-size:22px">??</span>`}<span style="flex:1;min-width:0;word-break:break-all"><b style="font-weight:500">${esc(a.name)}</b><br><small style="color:var(--mut)">${a.type} � ${KB(a.size)}</small></span><button class="btn s" data-act="arm:${i}">Remove</button></div>`,
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
        window.VyaparXAuth.uploadFile(f, "inventory-attachments").then((result) => {
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
    window.VyaparXAuth.uploadFile(f, "inventory-profile").then((result) => {
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
    `<h3>${T ? "Send task" : "Send message"}</h3><div class="fm" style="max-width:none"><label>${T ? "Task Title" : "Subject"} *<input class="in" id="sx"></label><label>${T ? "Description" : "Message"} *<textarea class="in" id="sd" rows="3"></textarea></label><label>Send To *<select class="in" id="sto"><option value="">Select person</option>${PEOPLE().filter((p) => p.d !== "Inventory")
      .map((p) => `<option value="${esc(p.n)}">${esc(p.n)} � ${p.d}</option>`)
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
            fd: "Inventory",
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
        TEAM.push(window.VyaparXShared.departmentTeam.createMember("inventory", f));
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
  [...MOV, ...ADJ].forEach((o) => {
    if (o.by == a) o.by = b;
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
        ["Department", "Inventory"],
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
async function loadPlanningRequests() {
  try {
    PLAN_REQUESTS = await window.VyaparXAuth.fetchModuleRecords("production");
    if (cur === "planning") render();
  } catch (error) { toast("Planning requests could not load: " + error.message); }
}
function planningDetails(plan, materials = plan.materials || []) {
  const rows = materials.map((m) => [m.materialCode || "�", m.materialName || "�", m.requiredQty ?? m.requiredQuantity ?? 0, m.availableStock || 0, m.reservedStock || 0, m.netAvailableStock || 0, m.expectedIncomingStock || 0, m.shortageQuantity || 0, m.purchaseQuantity || 0, m.unit || "�", m.availabilityStatus || "Unverified"]);
  const modal = document.createElement("div"); modal.className = "mask vm";
  modal.innerHTML = `<div class="dlg" role="dialog" aria-modal="true" style="width:min(1100px,96vw);max-height:90vh;overflow:auto;position:relative"><button class="ic" data-x aria-label="Close" title="Close" style="position:absolute;top:12px;right:12px;display:inline-flex;align-items:center;justify-content:center;width:32px;height:32px;border-radius:50%;border:1px solid var(--bd);background:var(--bg,#fff);cursor:pointer"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" aria-hidden="true"><path d="M6 6l12 12M18 6L6 18"/></svg></button><div style="padding-right:44px"><h3>Material Request ${esc(plan.materialRequestNo || plan.id)}</h3><p>Production Request: ${esc(plan.requestCode || plan.productionRequestId)} � Sales Order: ${esc(plan.salesOrderNumber || "�")} � Product: ${esc(plan.productName || "�")} � Quantity: ${Number(plan.plannedQuantity || 0)} � Approval: ${esc(plan.approvalStatus || "Pending")}</p>${plan.rejectionReason ? `<p><b>Rejection reason:</b> ${esc(plan.rejectionReason)}</p>` : ""}<div class="tw"><table><thead><tr>${["Code", "Material", "Required", "Available", "Reserved", "Net", "Incoming", "Shortage", "Purchase", "Unit", "Status"].map((h) => `<th>${h}</th>`).join("")}</tr></thead><tbody>${rows.map((row) => `<tr>${row.map((v) => `<td>${esc(v)}</td>`).join("")}</tr>`).join("") || `<tr><td colspan="11">No materials on this planning request.</td></tr>`}</tbody></table></div><h4>Request History</h4><div>${(plan.reviewHistory || []).length ? plan.reviewHistory.map((entry) => `<p>${esc(entry.action)} � ${esc(entry.at || "")} ${entry.reason ? `� ${esc(entry.reason)}` : ""}</p>`).join("") : `<p style="color:var(--mut)">No review history.</p>`}</div></div>`;
  document.body.append(modal); modal.onclick = (event) => { if (event.target === modal || event.target.closest("[data-x]")) modal.remove(); };
}
async function planningAction(planId, action) {
  const plan = PLAN_REQUESTS.find((entry) => String(entry.id) === String(planId));
  if (!plan) return toast("Planning request not found.");
  if (action === "plview") return planningDetails(plan);
  if (action === "plreject") return rejectPlanningModal(plan);
  if (action === "pldelete" && !window.confirm("Cancel this pending planning request? It will be retained for audit.")) return;
  const endpointAction = { plcheck: "check", plapprove: "approve", plreject: "reject", pldelete: "delete" }[action];
  if (action === "plapprove" && !window.confirm("Approve this request after the server verifies latest stock?")) return;
  try {
    const result = await window.VyaparXAuth.postWorkflowAction(`/api/production/material-plans/${encodeURIComponent(planId)}/${endpointAction}`, {});
    if (action === "plcheck") { plan.materials = result.materials || []; planningDetails(plan, plan.materials); }
    else { toast(action === "plapprove" ? "Planning approved; Production Request updated." : action === "plreject" ? "Planning rejected." : "Planning request cancelled."); await loadPlanningRequests(); }
  } catch (error) {
    if (error?.data?.materials) planningDetails(plan, error.data.materials);
    toast("Planning action failed: " + error.message);
  }
}
function rejectPlanningModal(plan) {
  const modal = document.createElement("div"); modal.className = "mask vm";
  modal.innerHTML = `<div class="dlg" role="dialog" aria-modal="true" style="width:min(520px,96vw)"><h3>Reject Material Request ${esc(plan.materialRequestNo || plan.id)}?</h3><p>Production will see this reason and can correct and resubmit the request.</p><label>Rejection reason *<textarea class="in" id="mrRejectReason" required maxlength="1000"></textarea></label><small id="mrRejectError" style="color:var(--er)"></small><div class="a"><button class="btn" data-x>Cancel</button><button class="btn p" data-reject-confirm>Reject Request</button></div></div>`;
  document.body.append(modal);
  modal.onclick = async (event) => {
    if (event.target === modal || event.target.closest("[data-x]")) return modal.remove();
    if (!event.target.closest("[data-reject-confirm]")) return;
    const reason = modal.querySelector("#mrRejectReason").value.trim();
    if (!reason) { modal.querySelector("#mrRejectError").textContent = "Please provide a rejection reason."; return; }
    const button = event.target.closest("[data-reject-confirm]"); button.disabled = true;
    try {
      await window.VyaparXAuth.postWorkflowAction(`/api/production/material-plans/${encodeURIComponent(plan.id)}/reject`, { reason });
      modal.remove(); toast("Material Request rejected; Production was updated."); await loadPlanningRequests();
    } catch (error) { button.disabled = false; toast("Rejection failed: " + error.message); }
  };
}
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
  if (a === "planrefresh") return loadPlanningRequests();
  if (a === "prrefresh") return loadPurchaseRequests();
  if (a === "prnew") return purchaseRequestForm();
  if (a === "prbill") { const req = PURCHASE_REQUESTS.find((row) => String(row.id) === String(x)); if (req) printPurchaseBill(req); return; }
  if (["plview", "plcheck", "plapprove", "plreject", "pldelete"].includes(a)) return planningAction(x, a);
  if (a == "iadd") itemForm();
  else if (a == "ie") itemForm(o);
  else if (a == "iv") itemView(o);
  else if (a == "id") delItem(o);
  else if (a == "sin") mvForm("IN", x);
  else if (a == "sout") mvForm("OUT", x);
  else if (a == "sadj") adjForm(x);
  else if (a == "aap") apprAdj(x);
  else if (a == "arj") rejAdj(x);
  else if (a == "lnp") purchaseRequestForm(ITM.find((item) => String(item.id) === String(x)) || o);
  else if (a == "ev") {
    const m = TEAM.find((z) => z.id == x);
    detail([
      [
        "Employee Details",
        [
          ["Name", esc(m.n)],
          ["Email", esc(m.e)],
          ["Phone", esc(m.ph)],
          ["Department", "Inventory"],
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
        "Demo attachment � real files are stored in Cloudinary after backend integration.",
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
  if (t.dataset.mrq != null) {
    MR_SEARCH = t.value;
    const position = t.selectionStart;
    render();
    const search = $(`[data-mrq]`); search?.focus(); search?.setSelectionRange(position, position);
    return;
  }
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
  if (e.target.dataset.mrf) {
    if (e.target.dataset.mrf === "status") MR_STATUS = e.target.value;
    if (e.target.dataset.mrf === "priority") MR_PRIORITY = e.target.value;
    if (e.target.dataset.mrf === "from") MR_FROM = e.target.value;
    if (e.target.dataset.mrf === "to") MR_TO = e.target.value;
    return render();
  }
  if (e.target.dataset.f != null) {
    fv = e.target.value;
    render();
  }
});
$("#gs").addEventListener("keydown", (e) => {
  if (e.key == "Enter") {
    const v = e.target.value;
    go("stock");
    q = v;
    render();
  }
});
$("#bell").onclick = () => go("notif");
$("#ct").onclick = () => document.body.classList.toggle("col");
$("#mb").onclick = () => window.VyaparXShared.toggleMobileNav();
$("#th").onclick = () => { if (window.VyaparXShared) window.VyaparXShared.applyTheme(window.VyaparXShared.currentTheme() === "dark" ? "light" : "dark"); };
if (window.VyaparXShared?.records?.bindPageState) {
  window.VyaparXShared.records.bindPageState("inventory", [
    { recordType: "teamMember", get: () => TEAM, set: (rows) => { TEAM = rows; } },
    {
      recordType: "stockItem", get: () => ITM, set: (rows) => { ITM = rows; },
      toRecord: (item) => ({ ...item, itemName: item.n || item.name || "", reorderLevel: Number(item.ro || 0), status: ss(item) }),
    },
    { recordType: "stockMovement", get: () => MOV, set: (rows) => { MOV = rows; } },
    { recordType: "stockAdjustment", get: () => ADJ, set: (rows) => { ADJ = rows; } },
  ], {
    onReady: () => { render(); },
    onError: (error) => toast("Inventory records could not sync with Firestore: " + error.message),
  });
}
const inventoryParams = new URLSearchParams(window.location.search);
const inventoryViews = new Set(NAV.flatMap((section) => section[1].map((item) => item[0])));
const inventoryRequestedView = inventoryParams.get("view");
go(inventoryViews.has(inventoryRequestedView) ? inventoryRequestedView : "dashboard");
if (inventoryParams.get("filter") === "low-stock" && cur === "items") {
  fv = "LOW_STOCK";
  render();
}
loadPurchaseRequests();
async function inventorySyncTasksFromDb() {
  if (!window.VyaparXShared || !window.VyaparXShared.tasks) return;
  try {
    const all = await window.VyaparXShared.tasks.fetchTasks({ force: true });
    TASKS = all.filter((task) => task.type !== "Communication");
    COMMS = all.filter((task) => task.type === "Communication");
    NOTES = [...NOTES.filter((note) => note.k), ...all.filter((task) => task.dir === "Received").map((task) => ({
      id: "n_" + task.id, ref: task.id, read: !!(task.isRead || task.read),
    }))];
    if (["tasks", "notif", "dashboard"].includes(cur)) render();
  } catch (error) { console.warn("Could not sync Inventory tasks:", error); }
}
inventorySyncTasksFromDb();
if (window.VyaparXShared?.tasks) window.VyaparXShared.tasks.onTasksUpdated(inventorySyncTasksFromDb);
window.addEventListener("focus", inventorySyncTasksFromDb);
window.addEventListener("focus", loadPurchaseRequests);
if (window.VyaparXFields) window.VyaparXFields.loadFields("inventory").then(() => { if (cur === "items") render(); });
window.addEventListener("focus", () => { if (window.VyaparXFields) window.VyaparXFields.loadFields("inventory", true); });
// Admin Reports integration: expose the real stock/movement records so the
// Admin report engine can build Inventory reports from actual data.
window.INVENTORY_REPORT_SOURCE = function () {
  try {
    return ITM.map(function (i) {
      return {
        type: i.qty == 0 ? "Out of Stock" : i.qty <= i.ro ? "Low Stock" : "Stock Summary",
        ref: i.code,
        user: "",
        date: TODAY,
        status: ss(i),
        amount: "",
      };
    }).concat(
      MOV.map(function (m) {
        return { type: "Stock Movement", ref: m.ref || "", user: m.by || "", date: m.date || TODAY, status: m.type || "", amount: "" };
      }),
    );
  } catch (e) {
    return [];
  }
};
