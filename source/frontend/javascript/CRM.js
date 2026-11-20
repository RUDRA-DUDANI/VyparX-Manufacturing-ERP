/**

 * VyaparX ERP - Customer Relationship Management Controller

 * Manages Leads, Customer Records, Quotations, and Follow-up Pipelines.

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

const NAV = [

  [

    "CRM",

    [

      [

        "dashboard",

        "Dashboard",

        "<rect x='3' y='3' width='7' height='9'/><rect x='14' y='3' width='7' height='5'/><rect x='14' y='12' width='7' height='9'/><rect x='3' y='16' width='7' height='5'/>",

      ],

      ["leads", "Leads", "<path d='M3 5h18l-7 8v6l-4 2v-8z'/>"],

      [

        "customers",

        "Customers",

        "<circle cx='9' cy='8' r='4'/><path d='M2 21c0-4 3-6 7-6s7 2 7 6M17 11l2 2 4-4'/>",

      ],

      [

        "follow",

        "Follow-ups",

        "<circle cx='12' cy='12' r='9'/><path d='M12 7v5l3 2'/>",

      ],

      ["quotes", "Quotations", "<path d='M7 3h8l4 4v14H7zM10 12h6M10 16h6'/>"],
      ["catalog", "Product Catalog", "<path d='M4 5h16v14H4zM8 9h8M8 13h5'/>"] ,

      ["acts", "Activities", "<path d='M3 12h4l3-8 4 16 3-8h4'/>"],

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

let TEAM = [];
const canManageTeam = () => window.VyaparXShared?.departmentTeam?.canManage("crm") === true;
async function crmLoadTeam() { return TEAM; }

const SRC = ["Website", "Referral", "Walk-in", "Phone", "Exhibition", "Social Media"];

const NEXT = {

  NEW: ["CONTACTED", "FOLLOW_UP", "LOST", "CLOSED"],

  CONTACTED: ["FOLLOW_UP", "QUOTATION", "LOST", "CLOSED"],

  FOLLOW_UP: ["CONTACTED", "QUOTATION", "LOST", "CLOSED"],

  QUOTATION: ["FOLLOW_UP", "CONVERTED", "LOST", "CLOSED"],

  CONVERTED: ["CLOSED"],

  LOST: ["NEW"],

  CLOSED: [],

};

// Business records are loaded from the authenticated, company-scoped API.
let LEADS = [];
let ACTS = [];
let TASKS = [];

let unread = 3;

const st = (s) => {

  const c = /^(CONVERTED|Completed|Low|ACTIVE)$/.test(s)

    ? "ok"

    : /^(FOLLOW_UP|QUOTATION|Pending|In Progress|High|Medium|INACTIVE)$/.test(s)

      ? "wa"

      : /^(LOST|Overdue|Urgent|Cancelled)$/.test(s)

        ? "er"

        : "";

  return `<span class="tag ${c}">${s.replace("_", " ")}</span>`;

};

const inr = (n) => (n ? "₹" + n.toLocaleString("en-IN") : "—");

const log = (a, r) => {
  ACTS.unshift([window.VyaparXAuth?.getCurrentSession?.()?.fullName || "", a, r, TODAY]);
};

let cur = "dashboard",

  q = "",

  fv = "All",

  sort = null;

const ph = (t, d, b) =>

  `<div class="ph"><div><h2>${t}</h2><p>${d}</p></div>${b ? `<button class="btn p" data-act="${b[0]}">${b[1]}</button>` : ""}</div>`;

const ex = () =>

  `<div class="bar" style="margin:0"><button class="btn" data-act="csv" title="Export CSV" aria-label="Export CSV"><i class="fa-solid fa-file-csv"></i></button><button class="btn" onclick="print()" title="Print" aria-label="Print"><i class="fa-solid fa-print"></i></button></div>`;

function table(cols, rows, o = {}) {

  const dateCols = cols.map((label, index) => /date|follow.?up|due|valid until|^created$|created at|created on|^joined$|joined date|^dispatch$|^expected$/i.test(String(label).replace(/<[^>]*>/g, " ").trim()) ? index : -1).filter((index) => index >= 0);
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
      f = [...f].sort((a, b) => String(a[sort.i]).localeCompare(String(b[sort.i]), 0, { numeric: true }) * sort.d);
    }
  } else if (dateCol >= 0 && window.VyaparXShared?.sortRowsByDate) {
    f = window.VyaparXShared.sortRowsByDate(f, dateCol);
  }
  if (dateCol >= 0 && window.VyaparXShared?.formatDate) {
    f = f.map((row) => row.map((value, index) => dateCols.includes(index) ? window.VyaparXShared.formatDate(value) : value));
  }

  return `<div class="card"><div class="bar"><input class="in" data-q placeholder="Search..." value="${esc(q)}" aria-label="Search table">${o.filter ? `<select class="in" data-f aria-label="Filter by status">${["All", ...o.filter].map((x) => `<option ${x == fv ? "selected" : ""}>${x}</option>`).join("")}</select>` : ""}</div><div class="tw"><table><thead><tr>${cols.map((c, i) => `<th data-s="${i}">${c}</th>`).join("")}${o.act ? `<th>Actions${o.colModule && window.VyaparXFields ? window.VyaparXFields.columnButton(o.colModule) : ""}</th>` : ""}</tr></thead><tbody>${f.length ? f.map((r) => `<tr>${r.map((c, i) => `<td>${/Status/.test(cols[i]) || /Priority/.test(cols[i]) ? st(c) : c}</td>`).join("")}${o.act ? `<td><span style="display:flex;gap:4px">${o.act(r)}</span></td>` : ""}</tr>`).join("") : `<tr><td colspan="12"><div class="empty">${o.empty || "No matching records."}<br><small>Records you add will appear here.</small></div></td></tr>`}</tbody></table></div></div>`;

}

const open = (l) => !["CONVERTED", "LOST", "CLOSED"].includes(l.st);
const crmDisplayId = (l) => l.crmNo || l.id;

const lr = (l) => [

  crmDisplayId(l),

  esc(l.name),

  esc(l.contact),

  l.source,

  esc(l.req),

  l.fu || "—",

  esc(l.by),

  l.st,

];

const LC = [

  "ID",

  "Name",

  "Contact",

  "Source",

  "Requirement",

  "Follow-up",

  "Assigned To",

  "Status",

];

const lact = (r) => {

  const l = LEADS.find((x) => x.id == r[0] || crmDisplayId(x) == r[0]);

  return (

    `<button class="btn s" data-act="view:${l.id}"><i class="fa-solid fa-eye" aria-hidden="true"></i></button>` +

    (l.type == "Lead" && l.st != "CLOSED" && l.st != "LOST"

      ? `<button class="btn s" data-act="edit:${l.id}" title="Edit" aria-label="Edit"><i class="fa-solid fa-pen-to-square" aria-hidden="true"></i></button><button class="btn s" data-act="fu:${l.id}">Follow-up</button><button class="btn s" data-act="qt:${l.id}">Quotation</button>`

      : "") +

    (l.type == "Lead"

      ? `<button class="btn s" data-act="stat:${l.id}">Status</button><button class="btn s" data-act="ldel:${esc(l.id)}" title="Delete lead" aria-label="Delete lead ${esc(l.name)}"><i class="fa-solid fa-trash-can" aria-hidden="true"></i></button>`

      : "") +

    (l.st == "QUOTATION" && crmQuoteIsApproved(crmQuoteForLead(l.id)) && l.type !== "Customer"

      ? `<button class="btn s" data-act="conv:${l.id}">Convert</button>`

      : "")

  );

};

const kpi = (a, b) =>

  `<div class="card kpi"><small>${a}</small><b>${b}</b></div>`;

const V = {

  dashboard() {

    const ls = LEADS.filter((l) => l.type == "Lead"),

      sts = Object.keys(NEXT),

      mx = Math.max(

        1,

        ...sts.map((s) => LEADS.filter((l) => l.st == s).length),

      ),

      td = ls.filter((l) => l.fu == TODAY && open(l));

    return (

      ph(crmGreeting(), "Your CRM pipeline at a glance.", [

        "add",

        "Add Lead",

      ]) +

      `<div class="grid k6">${kpi("New Leads", LEADS.filter((l) => l.st == "NEW").length)}${kpi("Follow-ups Today", td.length)}${kpi("Open Leads", LEADS.filter(open).length)}${kpi("Converted Leads", LEADS.filter((l) => l.st == "CONVERTED").length)}${kpi("Lost Leads", LEADS.filter((l) => l.st == "LOST").length)}</div>

 <div class="grid two" style="margin-top:14px"><div class="card"><h3>Pipeline</h3>${sts

   .map((s) => {

     const n = LEADS.filter((l) => l.st == s).length;

     return `<div style="display:grid;grid-template-columns:110px 1fr 24px;gap:10px;align-items:center;margin:8px 0"><span style="color:var(--mut);font-size:12px">${s.replace("_", " ")}</span><span style="background:var(--bg);border-radius:99px;height:8px"><span style="display:block;height:8px;border-radius:99px;background:var(--pri);width:${(n / mx) * 100}%"></span></span><b style="font-weight:500">${n}</b></div>`;

   })

   .join("")}</div>

 <div class="card"><h3>Follow-ups today</h3>${td.length ? td.map((l) => `<div style="display:flex;justify-content:space-between;padding:8px 0;border-bottom:1px solid var(--bd)"><span>${esc(l.name)}<br><small style="color:var(--mut)">${esc(l.by)}</small></span><button class="btn s" data-act="view:${l.id}"><i class="fa-solid fa-eye" aria-hidden="true"></i></button></div>`).join("") : `<div class="empty">No follow-ups due today.</div>`}</div></div>

 <div class="card" style="margin-top:14px"><h3>Recent activity</h3><div class="tw"><table><tr><th>User</th><th>Activity</th><th>Record</th><th>Time</th></tr>${ACTS.slice(

   0,

   5,

 )

   .map((a) => `<tr>${a.map((c) => `<td>${esc(c)}</td>`).join("")}</tr>`)

   .join("")}</table></div></div>`

    );

  },

  leads() {

    return (

      ph("Leads", "Track every enquiry from first contact to conversion.", [

        "add",

        "Add Lead",

      ]) +

      table(window.VyaparXFields.tableColumns("crm", LC), LEADS.filter((l) => l.type == "Lead").map((l) => window.VyaparXFields.tableRow("crm", l, lr(l))), {

        filter: Object.keys(NEXT),

        colModule: "crm",

        act: lact,

        empty: "No leads yet.",

      })

    );

  },

  customers() {

    return (

      ph(

        "Customers",

        "Converted leads. Open a customer to see their full history.",

      ) +

      table(

        [

          "ID",

          "Name",

          "Contact",

          "Email",

          "Source",

          "Quotation",

          "Amount",

          "Assigned To",

        ],

        LEADS.filter((l) => l.type == "Customer").map((l) => [

          crmDisplayId(l),

          esc(l.name),

          esc(l.contact),

          esc(l.email),

          l.source,

          l.qn || "—",

          inr(l.qa),

          esc(l.by),

        ]),

        {

          act: (r) => {
            const customer = LEADS.find((lead) => crmDisplayId(lead) == r[0]);
            const id = customer?.id || r[0];
            return `<button class="btn s" data-act="view:${esc(id)}" title="View" aria-label="View customer"><i class="fa-solid fa-eye" aria-hidden="true"></i></button><button class="btn s" data-act="edit:${esc(id)}" title="Edit" aria-label="Edit customer"><i class="fa-solid fa-pen-to-square" aria-hidden="true"></i></button><button class="btn s" data-act="ldel:${esc(id)}" title="Delete" aria-label="Delete customer"><i class="fa-solid fa-trash-can" aria-hidden="true"></i></button>`;
          },

          empty: "No customers yet.",

        },

      )

    );

  },

  follow() {

    const o = LEADS.filter((l) => l.type == "Lead" && open(l) && l.fu).sort(

      (a, b) => a.fu.localeCompare(b.fu),

    );

    const g = (l) =>

      l.fu < TODAY ? "Overdue" : l.fu == TODAY ? "Due today" : "Upcoming";

    return (

      ph("Follow-ups", "Overdue, due today and upcoming follow-ups.") +

      `<div class="grid k6" style="margin-bottom:14px">${kpi("Overdue", o.filter((l) => l.fu < TODAY).length)}${kpi("Due today", o.filter((l) => l.fu == TODAY).length)}${kpi("Upcoming", o.filter((l) => l.fu > TODAY).length)}</div>` +

      table(

        [

          "ID",

          "Name",

          "Contact",

          "Follow-up",

          "Assigned To",

          "Status",

          "Timing",

        ],

        o.map((l) => [

          l.id,

          esc(l.name),

          esc(l.contact),

          l.fu,

          esc(l.by),

          l.st,

          g(l),

        ]),

        {

          act: (r) =>

            `<button class="btn s" data-act="fu:${r[0]}">Reschedule</button><button class="btn s" data-act="fv:${r[0]}"><i class="fa-solid fa-eye" aria-hidden="true"></i></button>`,

        },

      )

    );

  },

  quotes() {

    const heading = ph("Quotations", "Pending quotations need Sales approval before their leads can be converted to customers.");
    if (!crmRecordsReady) return heading + `<div class="card"><div class="empty">Loading CRM quotations…</div></div>`;
    const activeQuotes = CRM_QUOTES.filter(crmQuoteIsActive);
    if (crmQuoteLoadError && !CRM_QUOTES.length) return heading + `<div class="card"><div class="empty">Could not load CRM quotations: ${esc(crmQuoteLoadError)}. The list will retry on refresh.</div></div>`;

    return (

      heading +
      (crmQuoteLoadError ? `<div class="card"><div class="empty">Could not refresh quotations: ${esc(crmQuoteLoadError)}. Showing the last loaded records.</div></div>` : "") +

      table(

        [

          "Quotation No",

          "Lead",

          "Date",

          "Valid Until",

          "Customer Type",

          "Amount",

          "Assigned To",

          "Status",

        ],

        activeQuotes.map((quote) => {
          const lead = LEADS.find((item) => String(item.id) === String(quote.leadId || quote.clientId));
          return [quote.number || quote.id, esc(quote.clientName || lead?.name || ""), quote.date || "", quote.validUntil || "", lead?.type || "Lead", inr(Number(quote.total || 0)), esc(crmQuoteAssignedDepartment(quote)), crmQuoteStatusLabel(quote.status)];
        }),

        {

          act: (r) => {

            const quote = activeQuotes.find((item) => String(item.number || item.id) === String(r[0]));
            const l = quote && LEADS.find((item) => String(item.id) === String(quote.leadId || quote.clientId));
            if (!quote) return "";

            return (

              `<button class="btn s" data-act="qpreview:${esc(quote.id)}" title="View quotation" aria-label="View quotation"><i class="fa-solid fa-eye" aria-hidden="true"></i></button>` +

              (!quote.salesOrderId && !["converted", "invoiced"].includes(String(quote.status || "").toLowerCase()) ? `<button class="btn s" data-act="qdel:${esc(quote.id)}" title="Delete quotation" aria-label="Delete quotation"><i class="fa-solid fa-trash-can" aria-hidden="true"></i></button>` : "") +
              (l && crmQuoteIsApproved(quote) && l.type !== "Customer" ? `<button class="btn s" data-act="conv:${l.id}" data-quote-id="${esc(quote.id)}">Convert</button>` : "")

            );

          },

          empty: "No quotations yet.",

        },

      )

    );

  },

  catalog() {
    return ph("Product Catalog", "View the company’s products and their quotation price, GST, default discount, unit, and HSN/SAC.") +
      `<div class="card"><div class="tw"><table><thead><tr><th>Product</th><th>Code</th><th>Details</th><th>Unit</th><th>HSN/SAC</th><th>Price</th><th>GST</th><th>Default discount</th></tr></thead><tbody>${CRM_PRODUCTS.length ? CRM_PRODUCTS.map((product) => `<tr><td>${esc(product.name)}</td><td>${esc(product.code || "—")}</td><td>${esc(product.description || "—")}</td><td>${esc(product.uom || "Nos")}</td><td>${esc(product.hsn || "—")}</td><td>${crmMoney(product.rate)}</td><td>${product.gst}%</td><td>${product.discount}%</td></tr>`).join("") : '<tr><td colspan="8"><div class="empty">The company product catalog is empty.</div></td></tr>'}</tbody></table></div></div>`;
  },

  acts() {

    return (

      ph("Activities", "Everything done in CRM, newest first.") +

      table(

        ["User", "Activity", "Record", "Time"],

        ACTS.map((a) => a.map(esc)),

      )

    );

  },

  reports() {
    const params = (() => { try { return JSON.parse(sessionStorage.getItem("crmReportFilters") || "{}"); } catch (_) { return {}; } })();
    const range = params.range || "30";
    const endDate = params.end || TODAY;
    const startDate = params.start || iso(-(Number(range)-1));
    const dateKey = (value) => window.VyaparXShared?.dateKey ? window.VyaparXShared.dateKey(value) : String(value || "").slice(0, 10);
    const inRange = d => { const key = dateKey(d); return !!key && key >= startDate && key <= endDate; };
    const type = params.type || "all";
    const typeLabel = (value) => ({ all: "CRM Activity Report", leads: "Lead Report", quotes: "Quotation Report", follow: "Follow-up Report" })[value] || "CRM Activity Report";
    const leads = (type === "all" || type === "leads") ? LEADS.filter(l => inRange(l.ca || TODAY)).sort((a, b) => dateKey(a.ca || TODAY).localeCompare(dateKey(b.ca || TODAY))) : [];
    const quotes = (type === "all" || type === "quotes") ? CRM_QUOTES.filter(q => inRange(q.date) && crmQuoteIsActive(q)).sort((a, b) => {
      const left = window.VyaparXShared?.dateSortKey?.(a.date), right = window.VyaparXShared?.dateSortKey?.(b.date);
      if (left == null && right == null) return 0;
      if (left == null) return 1;
      if (right == null) return -1;
      return left - right;
    }) : [];
    const follow = (type === "all" || type === "follow") ? LEADS.filter(l => l.fu && inRange(l.fu) && open(l)).sort((a, b) => dateKey(a.fu).localeCompare(dateKey(b.fu))) : [];
    const converted = leads.filter(l => l.st === "CONVERTED").length;
    const total = quotes.reduce((s,q)=>s+Number(q.total||0),0);
    const kpiCards = `<div class="crm-report-kpis"><div class="crm-report-kpi"><small>Total Leads</small><b>${leads.length}</b></div><div class="crm-report-kpi"><small>Conversion Rate</small><b>${leads.length?Math.round(converted/leads.length*100):0}%</b></div><div class="crm-report-kpi"><small>Quoted Value</small><b>${inr(total)}</b></div><div class="crm-report-kpi"><small>Pending Follow-ups</small><b>${follow.length}</b></div></div>`;
    const leadTable = `<div class="card crm-report-panel"><h3>Lead report</h3><div class="tw"><table><thead><tr><th>Lead ID</th><th>Lead / Customer</th><th>Source</th><th>Status</th><th>Assigned To</th><th>Follow-up</th></tr></thead><tbody>${leads.length?leads.map(l=>`<tr><td>${esc(crmDisplayId(l))}</td><td>${esc(l.name)}</td><td>${esc(l.source)}</td><td>${st(l.st)}</td><td>${esc(l.by)}</td><td>${fs(l.fu)}</td></tr>`).join(""):'<tr><td colspan="6" class="empty">No leads in this date range.</td></tr>'}</tbody></table></div></div>`;
    const quoteTable = `<div class="card crm-report-panel"><h3>Quotation report</h3><div class="tw"><table><thead><tr><th>Quotation No.</th><th>Client</th><th>Products</th><th>Quote Date</th><th>Valid Until</th><th>Amount</th><th>Status</th><th>Action</th></tr></thead><tbody>${quotes.length?quotes.map(q=>`<tr><td>${esc(q.number)}</td><td>${esc(q.clientName)}</td><td>${q.items.length}</td><td>${fs(q.date)}</td><td>${fs(q.validUntil)}</td><td>${crmMoney(q.total)}</td><td>${esc(crmQuoteStatusLabel(q.status))}</td><td><button class="btn s" data-act="qpreview:${esc(q.id)}"><i class="fa-solid fa-eye" aria-hidden="true"></i></button></td></tr>`).join(""):'<tr><td colspan="8" class="empty">No quotations in this date range.</td></tr>'}</tbody></table></div></div>`;
    const followTable = `<div class="card crm-report-panel"><h3>Follow-up report</h3><div class="tw"><table><thead><tr><th>Lead</th><th>Contact</th><th>Follow-up date</th><th>Assigned To</th><th>Timing</th></tr></thead><tbody>${follow.length?follow.map(l=>`<tr><td>${esc(l.name)}</td><td>${esc(l.contact)}</td><td>${fs(l.fu)}</td><td>${esc(l.by)}</td><td>${l.fu<TODAY?st("Overdue"):l.fu===TODAY?st("Pending"):st("Upcoming")}</td></tr>`).join(""):'<tr><td colspan="5" class="empty">No pending follow-ups in this date range.</td></tr>'}</tbody></table></div></div>`;
    return ph("Reports", "CRM performance from current records.") + kpiCards + `<div class="card crm-report-filters"><div class="crm-report-filter-grid"><label>Report type<select class="in" id="crmReportType"><option value="all" ${type==="all"?"selected":""}>All Reports</option><option value="leads" ${type==="leads"?"selected":""}>Lead Report</option><option value="quotes" ${type==="quotes"?"selected":""}>Quotation Report</option><option value="follow" ${type==="follow"?"selected":""}>Follow-up Report</option></select></label><label>Date range<select class="in" id="crmReportRange"><option value="1" ${range==="1"?"selected":""}>Today</option><option value="15" ${range==="15"?"selected":""}>15 days</option><option value="30" ${range==="30"?"selected":""}>30 days</option><option value="90" ${range==="90"?"selected":""}>90 days</option><option value="custom" ${range==="custom"?"selected":""}>Custom range</option></select></label><label>From<input class="in" type="date" id="crmReportStart" value="${esc(params.start||startDate)}"></label><label>To<input class="in" type="date" id="crmReportEnd" value="${esc(params.end||endDate)}"></label></div><div class="crm-report-actions"><button class="btn p" data-act="reportapply">Apply filters</button><button class="btn" data-act="reportcsv" title="Export CSV" aria-label="Export CSV"><i class="fa-solid fa-file-csv"></i></button><button class="btn" data-act="reportprint" title="Print" aria-label="Print"><i class="fa-solid fa-print"></i></button></div></div><section class="crm-report-print-heading"><h2>${esc(typeLabel(type))}</h2><p>VyaparX ERP — ${esc(crmCompany().name || "")}</p><p>Period: ${fs(startDate)} – ${fs(endDate)} — Generated: ${fs(new Date())}</p></section><div id="crmReportWorkspace">${type==="all"?leadTable+quoteTable+followTable:type==="leads"?leadTable:type==="quotes"?quoteTable:followTable}</div>`;
  },
  team() {
    return ph("My Team", "CRM team members managed by the CRM Department Head.", canManageTeam() ? ["madd", "Add Member"] : null) +
      table(["Name", "Designation", "Open Leads", "Status"], TEAM.map((m) => [
        esc(m.n), esc(m.des), LEADS.filter((lead) => lead.by == m.n && open(lead)).length, m.status || "ACTIVE",
      ]), {
        act: (row) => {
          const member = TEAM.find((item) => esc(item.n) === row[0]);
          if (!member) return "";
          return `<button class="btn s" data-act="ev:${esc(member.id)}" title="View" aria-label="View"><i class="fa-solid fa-eye" aria-hidden="true"></i></button>` +
            (canManageTeam() ? `<button class="btn s" data-act="ee:${esc(member.id)}" title="Edit" aria-label="Edit"><i class="fa-solid fa-pen-to-square" aria-hidden="true"></i></button><button class="btn s" data-act="ed:${esc(member.id)}" title="Delete" aria-label="Delete"><i class="fa-solid fa-trash-can" aria-hidden="true"></i></button>` : "");
        }, empty: "No CRM team members. Use Add Member to create the first record.",
      });
  },

  tasks() {

    return (

      ph(

        "Tasks & Communication",

        "Send work to other departments and track what you receive.",

        ["task", "Send Task"],

      ) +

      table(

        ["Direction", "Department", "Subject", "Priority", "Due", "Status"],

        TASKS.map((t) => [

          t.dir,

          t.dept,

          `<button style="border:0;background:none;padding:0;color:var(--pt);font:inherit;text-align:left;cursor:pointer" data-act="tv:${t.id}">${esc(t.s)}</button>`,

          t.p,

          t.due,

          t.st,

        ]),

        {

          filter: ["Pending", "In Progress", "Completed"],

          act: (r) => {
            const m = r[2].match(/tv:([^"]+)/);
            const t = m ? TB(m[1]) : null;
            if (!t) return "";
            return t.dir == "Received" && t.st != "Completed"
              ? `<button class="btn s" data-act="adv:${t.id}">${t.st == "Pending" ? "Start" : "Complete"}</button>`
              : `<button class="btn s" data-act="tv:${t.id}"><i class="fa-solid fa-eye" aria-hidden="true"></i></button>`;
          },

        },

      )

    );

  },

  notif() {
    const incoming = TASKS.filter((task) => task.dir === "Received");
    unread = incoming.filter((task) => !(task.isRead || task.read)).length;
    const n = [
      { text: `${LEADS.filter((l) => l.fu == TODAY && open(l)).length} follow-ups are due today`, read: true },
      ...incoming.map((task) => ({ text: `New task from ${esc(task.fd)}: ${esc(task.s)}`, read: !!(task.isRead || task.read) })),
      { text: "Admin announcement: Quarter-end audit on Monday", read: true },
    ];

    return (

      ph("Notifications", "Only notices for CRM and you.") +

      `<div class="card">${n.map((x) => `<div style="padding:10px 0;border-bottom:1px solid var(--bd)">${x.text} ${x.read ? "" : `<span class="tag wa">New</span>`}</div>`).join("")}${unread ? `<button class="btn s" style="margin-top:10px" data-act="read">Mark all as read</button>` : ""}</div>`

    );

  },

};

function nav() {

  const profile = window.VyaparXShared?.getCompanyProfile?.() || {};
  const session = window.VyaparXAuth?.getCurrentSession?.() || {};
  const companyName = profile.company_name || profile.companyName || session.companyName || "";
  $("#sb").innerHTML =

    `<div class="logo"><img src="../assets/logo.png" alt="VX Logo" style="width:50px;height:50px;object-fit:contain;"><div><b>VYAPARX ERP</b><small>${esc(companyName)}</small></div></div>` +

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

function crmGreeting() {
  const name = window.VyaparXAuth?.getCurrentSession?.()?.fullName || window.VyaparXAuth?.getCurrentSession?.()?.name || "";
  const hour = new Date().getHours();
  const greeting = hour < 12 ? "Good Morning" : hour < 17 ? "Good Afternoon" : hour < 20 ? "Good Evening" : "Good Night";
  return name ? `${greeting}, ${name}` : greeting;
}

function render() {

  const l = NAV.flatMap((n) => n[1]).find((x) => x[0] == cur)[1];

  $("#pt").textContent = l;

  $("#bc").textContent = "CRM / " + l;

  $("#mn").innerHTML = V[cur]();

  nav();
  if (window.VyaparXShared?.getCompanyProfile && !window.VyaparXShared.getCompanyProfile()?.company_name) window.VyaparXShared.loadCompanyProfile();

  $("#nc").textContent = unread;

  $("#nc").hidden = !unread;

}

function go(v) {

  cur = v;

  q = "";

  fv = "All";

  sort = null;

  render();
  if (v === "catalog") crmLoadProducts().then(() => { if (cur === "catalog") render(); });
  if (["leads", "customers", "quotes"].includes(v)) crmLoadTeam().then(() => { if (cur === v) render(); });
  if (["dashboard", "leads", "customers", "quotes", "reports"].includes(v)) crmLoadSharedRecords();
  if (v === "quotes") crmStartApprovedQuoteRefresh();
  else if (crmApprovedQuotePollTimer) {
    clearInterval(crmApprovedQuotePollTimer);
    crmApprovedQuotePollTimer = null;
  }

  document.body.classList.remove("open");

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

  return m;

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

const PH = /^\d{10}$/,

  EM = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

const fs = (d) => {
  if (window.VyaparXShared?.formatDate) return window.VyaparXShared.formatDate(d);
  if (!d) return "—";
  const date = new Date(d);
  return Number.isNaN(date.getTime()) ? "—" : date.toLocaleDateString("en-GB", {
    day: "2-digit", month: "2-digit", year: "numeric",
  });
};
const crmDateKey = (value) => window.VyaparXShared?.dateKey ? window.VyaparXShared.dateKey(value) : String(value || "").slice(0, 10);

function detail(secs) {

  const m = document.createElement("div");

  m.className = "mask vm";

  m.innerHTML = `<div class="dlg" role="dialog" aria-label="${secs[0][0]}" style="width:min(500px,100%);position:relative;max-height:90vh;overflow:auto"><button class="ic" data-x aria-label="Close" style="position:absolute;top:12px;right:12px">×</button>${secs.map(([t, r], i) => `<div style="margin-top:${i ? 18 : 0}px"><b style="font-weight:600;display:block;padding:0 ${i ? 0 : 36}px 6px 0;font-size:${i ? 14 : 16}px;border-bottom:1px solid var(--bd);margin-bottom:10px">${t}</b>${r ? `<div style="display:grid;grid-template-columns:130px 1fr;gap:10px 16px">${r.map((x) => `<span style="color:var(--mut)">${x[0]}</span><span style="font-weight:500;word-break:break-word">${x[1]}</span>`).join("")}</div>` : `<span style="color:var(--mut)">No activity yet.</span>`}</div>`).join("")}</div>`;

  document.body.append(m);

  m.onclick = (ev) => {

    if (ev.target == m || ev.target.closest("[data-x]")) m.remove();

  };

}

function crmMemberForm(member) {
  const isNew = !member;
  const current = member || { n: "", e: "", ph: "", des: "", jd: TODAY };
  dlg(`<h3>${isNew ? "Add CRM team member" : "Edit CRM team member"}</h3><div class="fm"><label>Full name *<input class="in" id="crmMemberName" value="${esc(current.n)}"></label><label>Email *<input class="in" id="crmMemberEmail" type="email" value="${esc(current.e)}"></label><label>Phone *<input class="in" id="crmMemberPhone" inputmode="numeric" value="${esc(current.ph)}"></label><label>Designation *<input class="in" id="crmMemberDesignation" value="${esc(current.des)}"></label><label>Joining date *<input class="in" id="crmMemberDate" type="date" max="${TODAY}" value="${esc(current.jd || TODAY)}"></label></div>`, isNew ? "Add Member" : "Save Changes", () => {
    if (!canManageTeam()) { toast("Only the CRM Department Head can manage CRM team members."); return false; }
    const n = $("#crmMemberName").value.trim(), e = $("#crmMemberEmail").value.trim().toLowerCase(), ph = $("#crmMemberPhone").value.trim(), des = $("#crmMemberDesignation").value.trim(), jd = $("#crmMemberDate").value;
    if (!n || !EM.test(e) || !PH.test(ph) || !des || !jd || jd > TODAY) { toast("Enter a valid name, email, 10-digit phone, designation and joining date."); return false; }
    if (TEAM.some((item) => item !== member && String(item.e || "").toLowerCase() === e)) { toast("This email already exists in the CRM team."); return false; }
    const fields = { n, e, ph, des, jd };
    if (isNew) TEAM.push(window.VyaparXShared.departmentTeam.createMember("crm", fields));
    else Object.assign(member, fields);
    render(); toast(isNew ? "Team member added." : "Team member updated.");
  });
}

const hs = (l) => {

  const a = ACTS.filter((z) => z[2] == l.id);

  return a.length ? a.map((z) => [z[3], esc(z[1])]) : null;

};

const ct = (l) => [

    "Contact Information",

    [

      ["Phone", esc(l.contact)],

      ["Email", esc(l.email)],

    ],

  ],

  asg = (l) => [

    "Assignment",

    [

      ["Assigned To", esc(l.by)],

      ["Created By", esc(l.cb)],

      ["Created On", fs(l.ca)],

    ],

  ];

const leadView = (l) =>

  detail([

    [

      l.type + " Details",

      [

        [l.type + " ID", crmDisplayId(l)],

        ["Type", l.type],

        ["Name", esc(l.name)],

        ["Status", st(l.st)],

      ],

    ],

    ct(l),

    [

      "Lead Information",

      [

        ["Source", l.source],

        ["Requirement", esc(l.req)],

        ["Follow-up", l.fu ? fs(l.fu) : "—"],

        ["Quotation", l.qn ? `${l.qn} (${inr(l.qa)})` : "—"],

      ],

    ],

    asg(l),

    ["Activity History", hs(l)],
  ]);

const qView = (l) => {
  const quote = crmQuoteForQuotationLead(l.id);
  if (quote) return crmQuotePreview(quote);
  return detail([
    ["Quotation Details", [["Quotation No", l.qn], ["Amount", inr(l.qa)], ["Status", st(l.st)]]],

    [

      "Lead Information",

      [

        ["Lead ID", crmDisplayId(l)],

        ["Name", esc(l.name)],

        ["Source", l.source],

        ["Requirement", esc(l.req)],

      ],

    ],

    ct(l),

    asg(l),

    ["Activity History", hs(l)],
  ]);
};

const fView = (l) =>

  detail([

    [

      "Follow-up Details",

      [

        ["Lead ID", crmDisplayId(l)],

        ["Name", esc(l.name)],

        ["Follow-up Date", fs(l.fu)],

        [

          "Timing",

          l.fu < TODAY ? "Overdue" : l.fu == TODAY ? "Due today" : "Upcoming",

        ],

        ["Status", st(l.st)],

      ],

    ],

        ct(l),

        ["Assignment", [["Assigned To", esc(l.by)]]],

        ["Activity History", hs(l)],
      ]);

    function leadForm(l) {

  const n = !l;
  const idempotencyKey = n
    ? `crm-lead-${window.crypto?.randomUUID?.() || `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`}`
    : "";

  l = l || {

    name: "",

    contact: "",

    email: "",

    source: "",

    req: "",

    fu: "",

    by: "",

  };

  const customHtml = window.VyaparXFields

    ? window.VyaparXFields.formFieldsHtml("crm", l)

    : "";

  let saving = false;

  dlg(

    `<h3>${n ? "Add lead" : "Edit " + l.id}</h3><div class="fm"><label>Name *<input class="in" id="fn" value="${esc(l.name)}"></label><label>Contact *<input class="in" id="fc" inputmode="numeric" placeholder="10-digit phone number" value="${esc(l.contact)}"></label><label>Email *<input class="in" id="fe" value="${esc(l.email)}"></label><label>Source *<select class="in" id="fs"><option value="">Select source</option>${opts(SRC, l.source)}</select></label><label>Requirement *<input class="in" id="fr" value="${esc(l.req)}"></label><label>Follow-up date<input class="in" type="date" id="ff" value="${l.fu}"></label><label>Assigned to *<select class="in" id="fa"><option value="">Select employee</option>${opts(TEAM.map((member) => member.n), l.by)}</select></label></div>${customHtml}`,

    n ? "Add lead" : "Save changes",

    (mask) => {

      const c = $("#fc").value.trim(),

        e = $("#fe").value.trim().toLowerCase(),

        dc = LEADS.find((x) => x !== l && x.contact == c),

        de = LEADS.find((x) => x !== l && x.email.toLowerCase() == e);

      const customErrors = window.VyaparXFields

        ? window.VyaparXFields.validateForm("crm", document)

        : [];

      if (

        !vf([

          ["#fn", (v) => v.length > 0, "Enter the lead name."],

          ["#fc", (v) => PH.test(v), "Enter a valid 10-digit phone number."],

          [

            "#fc",

            (v) => !dc,

            "This phone number already exists in " + (dc && dc.id) + ".",

          ],

          ["#fe", (v) => EM.test(v), "Enter a valid email address."],

          [

            "#fe",

            (v) => !de,

            "This email already exists in " + (de && de.id) + ".",

          ],

          ["#fs", (v) => v, "Select the source."],

          ["#fr", (v) => v.length > 0, "Enter the requirement."],

          [

            "#ff",

            (v) =>

              !v ||

              (!isNaN(Date.parse(v)) && (v >= TODAY || (!n && v == l.fu))),

            "Enter a valid date, today or later.",

          ],

          ["#fa", (v) => v, "Select who this lead is assigned to."],

        ])

      )

        return false;

      if (customErrors.length) {

        toast(customErrors[0]);

        return false;

      }

      const v = (i) => $(i).value.trim(),

        o = {

          name: v("#fn"),

          contact: v("#fc"),

          email: v("#fe"),

          source: v("#fs"),

          req: v("#fr"),

          fu: $("#ff").value,

          by: v("#fa"),

        };

      if (window.VyaparXFields)

        window.VyaparXFields.applyToRecord(

          "crm",

          o,

          window.VyaparXFields.readFormValues(document),

        );

      if (n) {
        const newLead = {
          ...o,
          idempotencyKey,
          recordType: "lead",
          type: "Lead",
          qn: "",
          qa: 0,
          st: "NEW",
          cb: window.VyaparXAuth?.getCurrentSession?.()?.fullName || "",
          ca: TODAY,
        };
        const button = mask.querySelector("[data-ok]");
        if (saving) return false;
        saving = true;
        button.disabled = true;
        button.textContent = "Saving…";
        Promise.resolve()
          .then(() => {
            if (!window.VyaparXAuth?.createModuleRecord) throw new Error("CRM save service is unavailable.");
            return window.VyaparXAuth.createModuleRecord("crm", { ...newLead, recordType: "lead" });
          })
          .then((result) => {
            if (!result?.record?.id) throw new Error("The server did not confirm the saved lead.");
            LEADS = [result.record, ...LEADS.filter((lead) => String(lead.id) !== String(result.record.id))];
            window.VyaparXShared?.records?.markPersisted("crm", "lead", result.record);
            log("Added lead", result.record.id);
            mask.remove();
            render();
            toast("Lead added");
          })
          .catch(async (error) => {
            saving = false;
            if (button.isConnected) {
              button.disabled = false;
              button.textContent = "Add lead";
            }
            toast("Lead was not saved: " + error.message);
          });
        return false;
      } else {
        const button = mask.querySelector("[data-ok]");
        if (saving) return false;
        saving = true;
        button.disabled = true;
        button.textContent = "Saving…";
        Promise.resolve()
          .then(() => {
            if (!window.VyaparXAuth?.saveModuleRecord) throw new Error("CRM save service is unavailable.");
            return window.VyaparXAuth.saveModuleRecord("crm", { ...l, ...o, recordType: l.recordType || "lead" });
          })
          .then((result) => {
            if (!result?.record?.id) throw new Error("The server did not confirm the updated lead.");
            Object.assign(l, result.record);
            window.VyaparXShared?.records?.markPersisted("crm", "lead", l);
            const entity = l.type === "Customer" ? "customer" : "lead";
            log("Edited " + entity, l.id);
            mask.remove();
            render();
            toast(entity === "customer" ? "Customer updated" : "Lead updated");
          })
          .catch((error) => {
            saving = false;
            if (button.isConnected) {
              button.disabled = false;
              button.textContent = "Save changes";
            }
            toast("Lead was not updated: " + error.message);
          });
        return false;
      }
      return false;

    },

  );

}

let pend = null;

const TB = (id) => TASKS.find((t) => String(t.id) === String(id)),

  KB = (n) =>

    n < 1024

      ? n + " B"

      : n < 1048576

        ? Math.round(n / 1024) + " KB"

        : (n / 1048576).toFixed(1) + " MB";

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

};

const MT =

  /^(image\/(jpeg|png|webp)|application\/pdf|application\/msword|application\/vnd\.(openxmlformats-officedocument\.(wordprocessingml\.document|spreadsheetml\.sheet)|ms-excel))$/;

const isImg = (a) =>

  a && /^(jpg|jpeg|png|webp)$/.test(a.name.split(".").pop().toLowerCase());

function attUI() {

  const e = $("#tfp");

  if (!e) return;

  e.innerHTML = pend

    ? `<div style="display:flex;gap:10px;align-items:center;border:1px solid var(--bd);border-radius:10px;padding:8px;margin-top:6px">${isImg(pend) ? `<img src="${pend.url}" alt="Preview" style="width:48px;height:48px;object-fit:cover;border-radius:8px">` : `<span style="font-size:24px">📄</span>`}<span style="flex:1;min-width:0;word-break:break-all"><b style="font-weight:500">${esc(pend.name)}</b><br><small style="color:var(--mut)">${pend.type} · ${KB(pend.size)}</small></span><button class="btn s" data-act="arm">Remove</button></div>`

    : "";

}

document.addEventListener("change", (e) => {

  const t = e.target;

  if (t.id != "tf") return;

  const f = t.files[0];

  t.value = "";

  const er = $("#tfe");

  er.textContent = "";

  if (!f) return;

  const ex = f.name.split(".").pop().toLowerCase();

  if (!AX[ex] || (f.type && !MT.test(f.type))) {

    er.textContent =

      "Unsupported file. Use JPG, PNG, WEBP, PDF, DOC, DOCX, XLS or XLSX.";

    return;

  }

  if (!f.size) {

    er.textContent = "This file is empty.";

    return;

  }

  if (f.size > 5242880) {

    er.textContent = "File is too large. Maximum size is 5 MB.";

    return;

  }

  if (pend && pend.url && pend.url.startsWith("blob:")) URL.revokeObjectURL(pend.url);

  pend = {
    name: f.name.replace(/[\\/]/g, ""),
    type: AX[ex],
    size: f.size,
    url: URL.createObjectURL(f),
    uploading: false,
  };
  const pendingAttachment = pend;
  if (window.VyaparXAuth && typeof window.VyaparXAuth.uploadFile === "function") {
    pendingAttachment.uploading = true;
    window.VyaparXAuth.uploadFile(f, "crm-attachments").then((result) => {
      if (pend !== pendingAttachment) return;
      pendingAttachment.url = result.url;
      pendingAttachment.publicId = result.publicId;
      pendingAttachment.resourceType = result.resourceType;
      pendingAttachment.uploading = false;
      attUI();
    }).catch((error) => {
      if (pend === pendingAttachment) {
        pend = null;
        er.textContent = error.message || "Cloudinary upload failed.";
        attUI();
      }
    });
  }

  attUI();

});

function taskForm() {

  pend = null;

  dlg(

    `<h3>Send task</h3><div class="fm"><label>Task Title *<input class="in" id="tt"></label><label>Description *<textarea class="in" id="td" rows="3"></textarea></label><label>Send To Department *<select class="in" id="tdp"><option value="">Select department</option>${opts(["Sales Order", "Purchase & Trading", "Production", "Inventory", "Transport", "Accounting"])}</select></label><label>Priority *<select class="in" id="tpr"><option value="">Select priority</option>${opts(["Low", "Medium", "High", "Urgent"])}</select></label><label>Due Date *<input class="in" type="date" id="tu"></label><div><div style="font-size:12px;color:var(--mut)">Attach File (Optional)</div><button class="btn s" type="button" data-act="aadd" style="margin-top:6px">+ Add Attachment</button><input type="file" id="tf" hidden accept=".jpg,.jpeg,.png,.webp,.pdf,.doc,.docx,.xls,.xlsx"><div id="tfp"></div><small id="tfe" style="color:var(--er)"></small><small style="display:block;color:var(--mut)">JPG, PNG, WEBP, PDF, DOC, DOCX, XLS, XLSX. Max 5 MB.</small></div></div>`,

    "Send Task",

    () => {

      if (

        !vf([

          ["#tt", (x) => x.length > 0, "Enter the task title."],

          ["#td", (x) => x.length > 0, "Enter a description."],

          ["#tdp", (x) => x, "Select a department."],

          ["#tdp", (x) => x != "CRM", "Choose a department other than CRM."],

          ["#tpr", (x) => x, "Select a priority."],

          [

            "#tu",

            (x) => x && !isNaN(Date.parse(x)) && x >= TODAY,

            "Choose a valid due date, today or later.",

          ],

        ])

      )

        return false;

      const dp = $("#tdp").value;
      const taskPayload = {
        id: "t_" + Date.now(),
        dir: "Sent",
        department: dp,
        td: dp,
        title: $("#tt").value.trim(),
        s: $("#tt").value.trim(),
        description: $("#td").value.trim(),
        desc: $("#td").value.trim(),
        priority: $("#tpr").value,
        p: $("#tpr").value,
        dueDate: $("#tu").value,
        due: $("#tu").value,
        status: "Pending",
        st: "Pending",
        att: pend ? [pend] : [],
        ca: TODAY,
        hist: [[TODAY, "Task created"]],
      };

      if (window.VyaparXShared && window.VyaparXShared.tasks) {
        window.VyaparXShared.tasks.createTask(taskPayload)
          .then((saved) => {
            TASKS = [saved || taskPayload, ...TASKS.filter((t) => t.id !== (saved || taskPayload).id)];
            pend = null;
            log("Sent task to " + dp, "—");
            render();
            toast("Task sent successfully");
          })
          .catch((err) => {
            toast(err.message || "Failed to send task");
          });
      } else {
        toast("Task service unavailable. Task was not saved.");
      }
    },

  );

}

function taskView(t) {

  const R = t.dir == "Received",

    a = t.att;

  const at = a

    ? `<div style="display:grid;gap:8px"><span style="display:flex;gap:8px;align-items:center"><span style="font-size:20px">${isImg(a) ? "🖼" : "📄"}</span><span style="word-break:break-all">${esc(a.name)}<br><small style="color:var(--mut)">${a.type} · ${KB(a.size)}</small></span></span>${isImg(a) && a.url ? `<img src="${a.url}" alt="${esc(a.name)}" style="max-width:100%;max-height:200px;border-radius:10px;border:1px solid var(--bd)">` : ""}<span style="display:flex;gap:6px"><button class="btn s" data-act="av:${t.id}"><i class="fa-solid fa-eye" aria-hidden="true"></i></button><button class="btn s" data-act="ad:${t.id}">Download</button></span></div>`

    : "No attachment";

  detail([

    [

      "Task Details",

      [

        ["Task Title", esc(t.s)],

        ["From", R ? esc(t.dept) : "CRM"],

        ["To", R ? "CRM" : esc(t.dept)],

        ["Priority", st(t.p)],

        ["Due Date", fs(t.due)],

        ["Status", st(t.st)],

        ["Description", esc(t.desc || "—")],

        ["Attachment", at],

        ["Created On", fs(t.ca)],

      ],

    ],

    ["Activity / History", t.hist.map((x) => [fs(x[0]), esc(x[1])])],


  ]);
}

const demoF = () =>

  toast(

    "This attachment has no uploaded file. Attachments are stored in Cloudinary after upload.",

  );

function attView(t) {

  const a = t.att;

  if (!a.url) return demoF();

  if (isImg(a) || /\.pdf$/i.test(a.name)) window.open(a.url, "_blank");

  else toast("Preview isn't available for this file type. Use Download.");

}

function attDown(t) {

  const a = t.att;

  if (!a.url) return demoF();

  const l = document.createElement("a");

  l.href = a.url;

  l.download = a.name;

  l.click();

  toast("Download started");

}

const LB = (id) => LEADS.find((l) => l.id == id);


// Targeted quotation enhancement. Existing CRM screens and workflows remain unchanged.
// Quotes and their templates live in the tenant-scoped shared quotations API.
let CRM_QUOTES = [];
let CRM_TERMS = [];
const CRM_LEAD_DELETE_PENDING = new Set();
// Quotations closed by a persisted CRM customer conversion. Kept in this page
// session so a pre-existing converted quotation also leaves the active list.
const CRM_CONVERTED_QUOTE_IDS = new Set();
const CRM_DELETED_LEAD_IDS = new Set();
let crmApprovedQuotePollTimer = null;
let crmApprovedQuotePollRunning = false;
let crmRecordsReady = false;
let crmRecordsLoading = null;
let crmRecordsRefreshPending = false;
let crmQuoteLoadError = "";
let CRM_ACTIVE_PREVIEW = null;
let CRM_QUOTE_LEAD = null;
function crmMergeQuoteLeads() {
  const currentSession = window.VyaparXAuth.getCurrentSession?.() || {};
  const profile = window.VyaparXShared?.getCompanyProfile?.() || {};
  const companyName = profile.company_name || profile.companyName || currentSession.companyName || "";
  CRM_QUOTES.forEach((quote) => {
    const linkedLeadId = quote.leadId || quote.clientId;
    const lead = LEADS.find((item) => String(item.id) === String(linkedLeadId));
    if (lead) {
      Object.assign(lead, { name: quote.clientName || lead.name, contact: quote.clientContact || lead.contact, email: quote.clientEmail || lead.email, qn: quote.number || lead.qn, qa: Number(quote.total || lead.qa || 0), address: quote.clientAddress || lead.address || "", gstin: quote.clientGst || lead.gstin || "", st: lead.type === "Customer" ? "CONVERTED" : String(quote.status || "Pending").toLowerCase() === "rejected" ? "LOST" : "QUOTATION", type: lead.type || "Lead" });
      return;
    }
    if (!linkedLeadId || CRM_DELETED_LEAD_IDS.has(String(linkedLeadId))) return;
    LEADS.push({ id: String(linkedLeadId), name: quote.clientName || "", contact: quote.clientContact || "", email: quote.clientEmail || "", type: "Lead", source: "", req: "", fu: "", qn: quote.number || "", qa: Number(quote.total || 0), by: currentSession.fullName || "", st: String(quote.status || "Pending").toLowerCase() === "rejected" ? "LOST" : "QUOTATION", cb: "", ca: quote.date || "", address: quote.clientAddress || "", gstin: quote.clientGst || "", companyName });
  });
}
async function crmLoadSharedRecords(force = false) {
  if (crmRecordsLoading) {
    if (force) crmRecordsRefreshPending = true;
    return crmRecordsLoading;
  }
  if (!window.VyaparXAuth || typeof window.VyaparXAuth.fetchModuleRecords !== "function") {
    crmQuoteLoadError = "The authenticated quotation service is unavailable.";
    crmRecordsReady = true;
    if (cur === "quotes") render();
    return;
  }
  crmRecordsLoading = (async () => {
    try {
      const [records, crmRecords] = await Promise.all([
        window.VyaparXAuth.fetchModuleRecords("quotations"),
        window.VyaparXAuth.fetchModuleRecords("crm"),
      ]);
      const activeLeads = (crmRecords || []).filter((record) => record && (!record.recordType || String(record.recordType).toLowerCase() === "lead") && !record.isDeleted);
      LEADS = activeLeads;
      CRM_QUOTES = records.filter((record) => String(record.recordType || "").toLowerCase() === "quotation" && !record.isDeleted);
      CRM_TERMS = records.filter((record) => record.recordType === "template" && !record.isDeleted);
      // Rebuild the customer/customer-history list on every refresh so a
      // conversion made without this change stays converted in this session.
      const convertedLeadIds = new Set(activeLeads.filter((lead) => lead.type === "Customer" && lead.convertedQuotationId)
        .map((lead) => String(lead.convertedQuotationId)));
      const closedQuoteIds = new Set([...CRM_CONVERTED_QUOTE_IDS, ...convertedLeadIds]);
      CRM_CONVERTED_QUOTE_IDS.clear();
      closedQuoteIds.forEach((id) => CRM_CONVERTED_QUOTE_IDS.add(id));
      crmQuoteLoadError = "";
      // Sales approvals land on the shared quotation records. Re-render the
      // Quotations view after every refresh so an approval made in Sales shows
      // up in CRM without the user reloading the page.
      if (cur === "quotes") render();
      crmMergeQuoteLeads();
    } catch (error) {
      crmQuoteLoadError = error.message || "The request failed.";
      toast("Shared quotations could not be loaded: " + error.message);
    } finally {
      const firstLoad = !crmRecordsReady;
      const refreshAgain = crmRecordsRefreshPending;
      crmRecordsRefreshPending = false;
      crmRecordsReady = true;
      crmRecordsLoading = null;
      if (firstLoad) {
        crmSyncTasksFromDb();
        crmSyncLeadsFromDb();
      }
      if (firstLoad || cur === "quotes" || cur === "dashboard" || cur === "customers" || cur === "reports") render();
      if (refreshAgain) await crmLoadSharedRecords();
    }
  })();
  return crmRecordsLoading;
}

function crmStartApprovedQuoteRefresh() {
  if (crmApprovedQuotePollTimer || !window.VyaparXAuth?.fetchModuleRecords) return;
  const refresh = async () => {
    if (cur !== "quotes" || crmApprovedQuotePollRunning) return;
    crmApprovedQuotePollRunning = true;
    try {
      const quotes = await window.VyaparXAuth.fetchModuleRecords("quotations");
      const latest = (quotes || []).filter((record) => String(record.recordType || "").toLowerCase() === "quotation" && !record.isDeleted);
      const currentById = new Map(CRM_QUOTES.map((quote) => [String(quote.id), quote]));
      const changed = latest.length !== CRM_QUOTES.length || latest.some((quote) => {
        const current = currentById.get(String(quote.id));
        return !current || String(current.status || "") !== String(quote.status || "");
      });
      CRM_QUOTES = latest;
      if (changed && cur === "quotes") render();
    } catch (error) {
      crmQuoteLoadError = error.message || "The request failed.";
    } finally {
      crmApprovedQuotePollRunning = false;
    }
  };
  refresh();
  crmApprovedQuotePollTimer = setInterval(refresh, 3000);
}

async function crmSyncTasksFromDb() {
  if (window.VyaparXShared && window.VyaparXShared.tasks) {
    try {
      const dbTasks = await window.VyaparXShared.tasks.fetchTasks();
      if (Array.isArray(dbTasks)) {
        TASKS = dbTasks.map((t) => ({
          ...t,
          id: String(t.id),
          dir: t.dir || "Received",
          dept: t.department || t.td || "CRM",
          s: t.title || t.s || "",
          desc: t.description || t.desc || "",
          p: t.priority || t.p || "Medium",
          due: t.dueDate || t.due || TODAY,
          st: t.status || t.st || "Pending",
          att: Array.isArray(t.att) ? t.att[0] : (t.att || null),
          ca: t.ca || TODAY,
          hist: Array.isArray(t.hist) ? t.hist : [[TODAY, "Task created"]],
        }));
        unread = TASKS.filter((task) => task.dir === "Received" && !(task.isRead || task.read)).length;
        if (["tasks", "notif", "dashboard"].includes(cur)) render();
      }
    } catch (e) {
      console.warn("Could not sync tasks in CRM:", e);
    }
  }
}

async function crmSyncLeadsFromDb() {
  if (window.VyaparXAuth?.fetchModuleRecords) {
    try {
      // Conversion visibility must be based on a new company-scoped API read,
      // not the shared record cache that can contain pre-conversion lead data.
      const records = await window.VyaparXAuth.fetchModuleRecords("crm");
      if (Array.isArray(records)) {
        CRM_DELETED_LEAD_IDS.clear();
        records.filter((record) => record && (!record.recordType || record.recordType === "lead") && record.isDeleted).forEach((record) => {
          CRM_DELETED_LEAD_IDS.add(String(record.id));
        });
        const activeLeads = records.filter((record) => record && (!record.recordType || record.recordType === "lead") && !record.isDeleted);
        LEADS = LEADS.filter((lead) => !CRM_DELETED_LEAD_IDS.has(String(lead.id)));
        activeLeads.forEach((r) => {
          const idx = LEADS.findIndex((l) => String(l.id) === String(r.id));
          if (idx >= 0) LEADS[idx] = { ...LEADS[idx], ...r };
          else LEADS.push(r);
        });
        crmMergeQuoteLeads();
        if (cur === "dashboard" || cur === "customers" || cur === "quotes") render();
      }
    } catch (e) {
      console.warn("Could not sync CRM leads:", e);
    }
  }
}

if (window.VyaparXShared && window.VyaparXShared.tasks) {
  window.VyaparXShared.tasks.onTasksUpdated(() => {
    crmSyncTasksFromDb();
  });
}
if (window.VyaparXShared && window.VyaparXShared.records) {
  window.VyaparXShared.records.onRecordsUpdated((mod) => {
    if (!mod || mod === "quotations") crmLoadSharedRecords(true);
    if (!mod || mod === "crm") crmSyncLeadsFromDb();
  });
}

async function crmSaveSharedRecord(record, collection) {
  if (!window.VyaparXAuth || typeof window.VyaparXAuth.saveModuleRecord !== "function") {
    throw new Error("The authenticated quotation service is unavailable.");
  }
  const existing = collection.find((item) => String(item.id) === String(record.id));
  const payload = { ...record, recordType: record.recordType };
  // The API uses an omitted ID for create and a stored ID for update.
  if (!existing) delete payload.id;
  const saved = window.VyaparXShared?.records?.saveRecord
    ? await window.VyaparXShared.records.saveRecord("quotations", payload)
    : (await window.VyaparXAuth.saveModuleRecord("quotations", payload)).record;
  if (!saved || !saved.id) {
    throw new Error("The server did not return the saved quotation record.");
  }
  return saved;
}

// A template selection in the preview updates only the active quotation.
async function crmSaveQuotes() {
  if (!CRM_ACTIVE_PREVIEW) return;
  try {
    const saved = await crmSaveSharedRecord(CRM_ACTIVE_PREVIEW, CRM_QUOTES);
    const index = CRM_QUOTES.findIndex((item) => String(item.id) === String(saved.id));
    if (index >= 0) CRM_QUOTES[index] = saved;
  } catch (error) {
    toast("Quotation settings were not saved: " + error.message);
  }
}
const crmMoney = n => "₹" + (Number(n || 0)).toLocaleString("en-IN", {minimumFractionDigits:2, maximumFractionDigits:2});
// Quotation product options come from the tenant-scoped, read-only CRM catalog API.
let CRM_PRODUCTS = [];
async function crmLoadProducts() {
  if (!window.VyaparXAuth?.fetchModuleRecords) return CRM_PRODUCTS;
  try {
    CRM_PRODUCTS = (await window.VyaparXAuth.fetchModuleRecords("catalog"))
      .filter((product) => product.recordType === "product" && product.isActive !== false && !product.isDeleted)
      .map((product) => ({
        id: String(product.id), name: String(product.name || ""), code: String(product.code || ""),
        uom: String(product.unit || "Nos"), rate: Number(product.rate || 0),
        hsn: String(product.hsn || ""), gst: Number(product.gst || 0), discount: Number(product.discount || 0),
        description: String(product.description || ""),
      }));
  } catch (error) {
    toast("Could not load the company product catalog: " + error.message);
  }
  return CRM_PRODUCTS;
}
function crmProducts() { return CRM_PRODUCTS; }
function crmCompany() {
  const profile = window.VyaparXShared?.getCompanyProfile?.() || {};
  return {
    name: profile.registeredBusinessName || profile.registered_business_name || profile.company_name || profile.companyName || "",
    tradingName: profile.company_name || profile.companyName || "",
    address: [profile.address, profile.state, profile.pinCode || profile.pin_code, profile.country].filter(Boolean).join(", "),
    gst: profile.gstin || profile.gst_number || "",
    phone: profile.phone || "",
    email: profile.email || "",
    country: profile.country || "",
    state: profile.state || "",
    pinCode: profile.pinCode || profile.pin_code || "",
  };
}
function crmClientOptions(selected) {
  const list = [...new Map(LEADS.map(l=>[l.id,l])).values()];
  return '<option value="">Select client</option>' + list.map(l=>`<option value="${esc(l.id)}" ${String(selected||"")===String(l.id)?"selected":""}>${esc(l.name)}${l.contact?' · '+esc(l.contact):''}</option>`).join("");
}
function crmProductOptions(selected) {
  const ps=crmProducts();
  const existing = selected && !ps.some((product) => String(product.id) === String(selected));
  return (existing ? `<option value="${esc(selected)}" selected>Previously selected product (catalog unavailable)</option>` : '<option value="">Select product...</option>') + ps.map(p=>`<option value="${esc(p.id)}" ${String(selected||"")===String(p.id)?"selected":""}>${esc(p.name)}${p.code?' · '+esc(p.code):''}</option>`).join("");
}
// Active quotations only. Once a lead is converted, its quotation is closed
// for the CRM workflow and must not appear in the active Quotations list or
// reopen a duplicate quotation form.
function crmQuoteIsActive(quote) { return !crmQuoteClosedByConversion(quote); }
function crmQuoteClosedByConversion(quote) {
  if (!quote) return false;
  const lead = LEADS.find((item) => String(item.id) === String(quote.leadId || quote.clientId));
  return Boolean((lead && lead.type === "Customer" && String(lead.convertedQuotationId || "") === String(quote.id))
    || CRM_CONVERTED_QUOTE_IDS.has(String(quote.id)));
}
function crmQuoteForLead(id) { return CRM_QUOTES.find(q=>String(q.leadId)===String(id) && crmQuoteIsActive(q)); }
// Customer history lookup: an already-converted customer keeps its quotation
// reference so the record and its details stay retrievable.
function crmQuoteForQuotationLead(id) { return CRM_QUOTES.find(q=>String(q.leadId)===String(id)); }
function crmQuoteAssignedDepartment(quote) {
  if (!quote) return "—";
  const assignedTo = quote.assignedTo;
  const candidates = [
    quote.assignedDepartment,
    quote.assignedToDepartment,
    quote.department,
    quote.targetDepartment,
    quote.assignedDept,
    quote.dept,
    assignedTo && typeof assignedTo === "object"
      ? assignedTo.department || assignedTo.departmentName || assignedTo.label
      : assignedTo,
  ];
  const department = candidates.find((value) => typeof value === "string" && value.trim());
  return department ? department.trim() : "—";
}
function crmQuoteIsApproved(quote) {
  const status = String(quote?.status || "").trim().toLowerCase();
  return ["approved", "accepted"].includes(status) || (status === "converted" && Boolean(quote?.salesOrderId));
}
function crmQuoteStatusLabel(status) {
  const value = String(status || "Pending").trim();
  const normalized = value.toLowerCase();
  if (["approved", "accepted"].includes(normalized)) return "Approved";
  if (["draft", "pending approval", "sent", "pending"].includes(normalized)) return "Pending";
  return value;
}
const CRM_CONVERSION_PENDING = new Set();
async function crmConvertLead(leadId, quotationId) {
  const key = String(leadId || "");
  if (!key || CRM_CONVERSION_PENDING.has(key)) return;
  const lead = LEADS.find((item) => String(item.id) === key);
  if (!lead) return toast("This CRM lead is no longer available.");
  CRM_CONVERSION_PENDING.add(key);
  let conversionDialogOpen = false;
  try {
    const [quotes, crmRecords] = await Promise.all([
      window.VyaparXAuth.fetchModuleRecords("quotations"),
      window.VyaparXAuth.fetchModuleRecords("crm"),
    ]);
    const savedLead = (crmRecords || []).find((record) => String(record.id) === key && !record.isDeleted);
    if (savedLead) Object.assign(lead, savedLead);
    if (lead.type === "Customer") {
      // Never convert a customer twice: the comparison happens before any
      // quotation is picked, so a second click cannot bind a different quote.
      render();
      return toast("This lead is already converted to a customer.");
    }
    const leadQuotes = (quotes || []).filter((record) => record.recordType === "quotation" && !record.isDeleted && String(record.leadId || record.clientId || "") === key);
    // Resolve the exact persisted quotation that supplied this Convert action.
    const quote = leadQuotes.find((record) => String(record.id) === String(quotationId || ""));
    if (!quote) return toast("The linked quotation is not available. Refresh CRM and try again.");
    const quoteIndex = CRM_QUOTES.findIndex((item) => String(item.id) === String(quote.id));
    if (quoteIndex >= 0) CRM_QUOTES[quoteIndex] = quote;
    else CRM_QUOTES.push(quote);
    if (!crmQuoteIsApproved(quote)) {
      const status = crmQuoteStatusLabel(quote.status);
      return toast(status === "Rejected"
        ? "This quotation was rejected. Sales must approve it before conversion."
        : "This quotation is pending Sales approval. Ask Sales to approve it before conversion.");
    }
    const conversionDialog = dlg(
      `<h3>Convert ${esc(lead.name)} to customer?</h3><p>The approved quotation and this CRM lead will remain linked. Customer details will be preserved.</p>`,
      "Convert",
      (mask) => {
        const button = mask.querySelector("[data-ok]");
        if (button.disabled) return false;
        button.disabled = true;
        button.textContent = "Converting…";
        const payload = {
          ...lead,
          id: key,
          recordType: savedLead?.recordType || lead.recordType || "lead",
          type: "Customer",
          st: "CONVERTED",
          convertedQuotationId: quote.id,
          name: quote.clientName || lead.name,
          contact: quote.clientContact || lead.contact || "",
          email: quote.clientEmail || lead.email || "",
          address: quote.clientAddress || lead.address || "",
          gstin: quote.clientGst || lead.gstin || lead.gst || "",
          qn: quote.number || lead.qn || "",
          qa: Number(quote.total ?? lead.qa ?? 0),
        };
        (window.VyaparXShared?.records?.saveRecord
          ? window.VyaparXShared.records.saveRecord("crm", payload)
          : window.VyaparXAuth.saveModuleRecord("crm", payload).then((result) => result.record))
          .then(async (saved) => {
            if (!saved?.id || String(saved.id) !== key || saved.type !== "Customer"
                || String(saved.convertedQuotationId || "") !== String(quote.id)) {
              throw new Error("The server did not confirm the customer conversion.");
            }
            Object.assign(lead, saved);
            // Refresh authoritative module records before declaring success. A
            // failed or stale read keeps the dialog open so the user can retry.
            const refreshedCrmRecords = await window.VyaparXAuth.fetchModuleRecords("crm");
            const persistedCustomer = (refreshedCrmRecords || []).find((record) =>
              String(record.id) === key && !record.isDeleted && record.type === "Customer"
                && String(record.convertedQuotationId || "") === String(quote.id));
            if (!persistedCustomer) throw new Error("The server did not return the saved customer record.");
            Object.assign(lead, persistedCustomer);
            CRM_CONVERTED_QUOTE_IDS.add(String(quote.id));
            // The quotation remains persisted for history; omit it from the active
            // CRM list while keeping the converted customer in the same lead array.
            CRM_QUOTES = CRM_QUOTES.filter((item) => String(item.id) !== String(quote.id));
            const currentLeadIndex = LEADS.findIndex((item) => String(item.id) === key);
            if (currentLeadIndex >= 0) LEADS[currentLeadIndex] = { ...LEADS[currentLeadIndex], ...persistedCustomer };
            window.VyaparXShared?.records?.markPersisted("crm", persistedCustomer.recordType || "lead", persistedCustomer);
            render();
            log("Converted to customer", lead.id);
            mask.remove();
            toast("Lead converted to customer successfully");
            // Refresh the shared quotation source. The customer reference filters
            // the quote from CRM while preserving the database history record.
            crmLoadSharedRecords(true).catch((refreshError) => console.warn("Quotation list refresh failed:", refreshError));
          })
          .catch((error) => {
            button.disabled = false;
            button.textContent = "Convert";
            toast("Customer conversion failed: " + error.message);
          })
          .finally(() => {
            CRM_CONVERSION_PENDING.delete(key);
          });
        return false;
      },
    );
    conversionDialogOpen = true;
    conversionDialog.addEventListener("click", (event) => {
      if (event.target === conversionDialog || event.target.closest("[data-x]")) CRM_CONVERSION_PENDING.delete(key);
    }, true);
    return conversionDialog;
  } catch (error) {
    toast("Approval could not be verified. Refresh CRM and try again: " + error.message);
  } finally {
    if (!conversionDialogOpen) {
      CRM_CONVERSION_PENDING.delete(key);
    }
  }
}
function crmQuoteRows(rows) {
  return rows.map((r,i)=>`<tr data-qrow="${i}"><td><select class="in cq-product" data-row="${i}">${crmProductOptions(r.productId)}</select><input class="in cq-desc" data-row="${i}" placeholder="Description (optional)" value="${esc(r.description||"")}" style="margin-top:5px;font-size:11px"></td><td><input class="in cq-qty" data-row="${i}" type="number" min="0.01" step="any" value="${Number(r.qty||1)}"></td><td><span class="cq-uom">${esc(r.unit||"—")}</span></td><td><input class="in cq-rate" data-row="${i}" type="number" min="0" step="any" value="${Number(r.rate||0)}"></td><td><input class="in cq-disc" data-row="${i}" type="number" min="0" max="100" step="any" value="${Number(r.discount||0)}" aria-label="Discount percent"></td><td><span class="cq-gst">${Number(r.gst||0)}%</span></td><td class="cq-value">${crmMoney((Number(r.qty||0)*Number(r.rate||0))*(1-Number(r.discount||0)/100))}</td><td><button type="button" class="btn s" data-act="qrowdel:${i}" aria-label="Remove row">×</button></td></tr>`).join("");
}
async function crmOpenQuotation(lead) {
  if (!lead) return;
  if (!crmRecordsReady) {
    toast("Please wait while shared quotations load.");
    return;
  }
  if (lead.st === "NEW") { toast("Contact the lead before sending a quotation"); return; }
  await crmLoadProducts();
  // Ensure the document starts with the current authenticated company's profile.
  if (!crmCompany().name && window.VyaparXShared?.loadCompanyProfile) {
    await window.VyaparXShared.loadCompanyProfile(true);
  }
  CRM_QUOTE_LEAD=lead;
  const old=crmQuoteForLead(lead.id);
  const initial=old || {id:"",leadId:lead.id,number:lead.qn||"",date:TODAY,validUntil:iso(29),notes:"",templateId:"",items:[{productId:"",qty:1,uom:"",rate:0,gst:0,discount:0,hsn:""}],status:"Pending"};
  const templates='<option value="">No terms</option>'+CRM_TERMS.map(t=>`<option value="${esc(t.id)}" ${initial.templateId===t.id?'selected':''}>${esc(t.name)}</option>`).join("");
  const mask=document.createElement("div"); mask.className="mask crm-quote-mask";
  mask.innerHTML=`<div class="crm-quote-dialog" role="dialog" aria-modal="true" aria-labelledby="crmQuoteTitle"><div class="crm-q-head"><div><h3 id="crmQuoteTitle">${old?'Edit quotation':'New quotation'}</h3><p>Price an enquiry, then have Sales approve the quotation before converting its lead to a customer.</p></div><button class="ic" data-qclose aria-label="Close">×</button></div><div class="crm-q-body"><div class="crm-q-grid"><label>Unit<input class="in" id="cq-unit" value="${esc(crmCompany().name)}" readonly placeholder="Registered company"></label><label>Client *<select class="in" id="cq-client">${crmClientOptions(lead.id)}</select></label><label>Quote date<input class="in" id="cq-date" type="date" value="${esc(initial.date||TODAY)}"></label><label>Valid until<input class="in" id="cq-valid" type="date" value="${esc(initial.validUntil||iso(29))}"></label></div><label class="crm-q-full">Notes<textarea class="in" id="cq-notes" rows="2" placeholder="Optional note">${esc(initial.notes||"")}</textarea></label><div class="crm-q-section"><div><b>Terms & conditions</b><small>Select a saved template for this quotation.</small></div><button type="button" class="btn" data-act="qtemplates"><i class="fa-solid fa-gear" aria-hidden="true"></i> Manage templates</button></div><select class="in" id="cq-template">${templates}</select><textarea class="in crm-q-terms" id="cq-terms" rows="3" placeholder="Terms & conditions">${esc(initial.terms||((CRM_TERMS.find(t=>t.id===initial.templateId)||{}).terms||""))}</textarea><div class="crm-q-section"><b>Quoted products</b><div class="crm-q-actions"><label class="crm-inline-check"><input type="checkbox" id="cq-gst-inclusive" ${initial.gstInclusive?'checked':''}> GST inclusive</label><button type="button" class="btn" data-act="qrowadd">+ Add row</button></div></div><div class="tw crm-q-table"><table><thead><tr><th>Product</th><th>Qty</th><th>UOM</th><th>Rate (₹)</th><th>Disc. %</th><th>GST</th><th>Value (₹)</th><th></th></tr></thead><tbody id="cq-items">${crmQuoteRows(initial.items&&initial.items.length?initial.items:[{qty:1}])}</tbody></table></div><div class="crm-q-totals"><div><span>Subtotal</span><b id="cq-subtotal">₹0.00</b></div><div><span>GST</span><b id="cq-tax">₹0.00</b></div><div class="grand"><span>Grand total</span><b id="cq-total">₹0.00</b></div></div></div><div class="crm-q-footer"><button class="btn" data-qclose>Cancel</button><button class="btn p" data-act="qsave">${old?'Save changes':'Create quotation'}</button></div></div>`;
  
// FORCE CORRECT QUOTATION MODAL DESIGN
const dialog = mask.querySelector(".crm-quote-dialog");
const head = mask.querySelector(".crm-q-head");
const body = mask.querySelector(".crm-q-body");
const footer = mask.querySelector(".crm-q-footer");

function setImportant(element, styles) {
    if (!element) return;

    Object.entries(styles).forEach(([property, value]) => {
        element.style.setProperty(property, value, "important");
    });
}

// Full-screen dark background
setImportant(mask, {
    position: "fixed",
    inset: "0",
    "z-index": "99999",
    display: "flex",
    "align-items": "center",
    "justify-content": "center",
    padding: "20px",
    "box-sizing": "border-box",
    background: "rgba(15, 23, 42, 0.55)",
    "backdrop-filter": "blur(3px)",
    overflow: "hidden"
});

// Main WHITE dialog box
setImportant(dialog, {
    position: "relative",
    width: "900px",
    "max-width": "95vw",
    height: "auto",
    "max-height": "90vh",
    margin: "auto",
    padding: "24px",
    display: "flex",
    "flex-direction": "column",
    background: "#ffffff",
    color: "#152238",
    border: "1px solid #e5e7eb",
    "border-radius": "16px",
    "box-shadow": "0 24px 80px rgba(15,23,42,0.25)",
    overflow: "hidden"
});

// Header
setImportant(head, {
    "flex-shrink": "0",
    background: "#ffffff",
    color: "#152238",
    padding: "0 0 16px"
});

// Scrollable form body
setImportant(body, {
    flex: "1 1 auto",
    "min-height": "0",
    overflow: "auto",
    padding: "18px 0",
    background: "#ffffff",
    color: "#152238"
});

// Form grid
const grid = dialog.querySelector(".crm-q-grid");

setImportant(grid, {
    display: "grid",
    "grid-template-columns": "repeat(2, minmax(0, 1fr))",
    gap: "16px"
});

// Input fields
dialog.querySelectorAll("input, select, textarea").forEach(input => {
    setImportant(input, {
        "max-width": "100%",
        "box-sizing": "border-box",
        background: "#ffffff",
        color: "#152238"
    });
});

// Footer
setImportant(footer, {
    "flex-shrink": "0",
    background: "#ffffff",
    "border-top": "1px solid #e5e7eb",
    "margin": "0 -24px -24px",
    padding: "14px 24px 20px"
});

// Mobile responsive
if (window.innerWidth <= 600) {
    setImportant(grid, {
        "grid-template-columns": "1fr"
    });
}

  document.body.append(mask);
  mask.addEventListener("click",e=>{if(e.target===mask||e.target.closest("[data-qclose]"))mask.remove();});
  mask.addEventListener("change",e=>{
    if(e.target.id==="cq-template"){const t=CRM_TERMS.find(x=>x.id===e.target.value);$("#cq-terms").value=t?t.terms:"";}
    if(e.target.classList.contains("cq-product")){const p=crmProducts().find(x=>String(x.id)===e.target.value);const row=e.target.closest("tr");if(p){row.querySelector(".cq-uom").textContent=p.unit||"—";row.querySelector(".cq-rate").value=p.rate;row.querySelector(".cq-disc").value=p.discount||0;row.querySelector(".cq-gst").textContent=(p.gst||0)+"%";row.dataset.hsn=p.hsn||"";row.dataset.productName=p.name;row.querySelector(".cq-desc").value=p.description||"";}else{row.querySelector(".cq-uom").textContent="—";row.querySelector(".cq-gst").textContent="0%";}crmQuoteRecalc();}
  });
  mask.addEventListener("input",e=>{if(e.target.matches(".cq-qty,.cq-rate,.cq-disc"))crmQuoteRecalc();});
  mask.addEventListener("click",e=>{const b=e.target.closest("[data-act]");if(!b)return;const [act,arg]=b.dataset.act.split(":");if(act==="qrowadd"){const body=$("#cq-items");body.insertAdjacentHTML("beforeend",crmQuoteRows([{qty:1}]));crmQuoteRecalc();}else if(act==="qrowdel"){const row=b.closest("tr");if(row && $("#cq-items").rows.length>1)row.remove();crmQuoteRecalc();}else if(act==="qtemplates"){mask.remove();crmTemplatesOpen(()=>crmOpenQuotation(lead));}else if(act==="qsave"){crmQuoteSave(lead,initial,mask);}});
  crmQuoteRecalc();
}
function crmQuoteRecalc(){const rows=[...document.querySelectorAll("#cq-items tr")];let sub=0,tax=0;rows.forEach(row=>{const qty=Number(row.querySelector(".cq-qty").value||0),rate=Number(row.querySelector(".cq-rate").value||0),disc=Math.min(100,Math.max(0,Number(row.querySelector(".cq-disc").value||0))),gst=Number((row.querySelector(".cq-gst").textContent||"0").replace("%",""))||0;let base=qty*rate*(1-disc/100),line=base;if($("#cq-gst-inclusive")?.checked){base=base/(1+gst/100);line=qty*rate*(1-disc/100);}sub+=base;tax+=base*gst/100;row.querySelector(".cq-value").textContent=crmMoney(line);});$("#cq-subtotal").textContent=crmMoney(sub);$("#cq-tax").textContent=crmMoney(tax);$("#cq-total").textContent=crmMoney(sub+tax);}
async function crmQuoteSave(lead, old, mask) {
  const button = mask.querySelector('[data-act="qsave"]');
  const client = LEADS.find((item) => String(item.id) === $("#cq-client").value);
  if (!client) return toast("Select a client");
  if (!old.id && CRM_QUOTES.some((quote) => String(quote.leadId) === String(lead.id))) {
    return toast("This lead already has a quotation. Open it to update instead.");
  }

  const items = [...$("#cq-items").rows].map((row) => {
    const product = crmProducts().find(
      (item) => String(item.id) === row.querySelector(".cq-product").value,
    );
    const qty = Number(row.querySelector(".cq-qty").value || 0);
    const rate = Number(row.querySelector(".cq-rate").value || 0);
    const discount = Number(row.querySelector(".cq-disc").value || 0);
    const gst = Number(row.querySelector(".cq-gst").textContent.replace("%", "")) || 0;
    const discountedValue = qty * rate * (1 - discount / 100);
    const taxable = $("#cq-gst-inclusive").checked && gst
      ? discountedValue / (1 + gst / 100)
      : discountedValue;
    return {
      productId: product?.id || "",
      productName: product?.name || row.dataset.productName || row.querySelector(".cq-desc").value || "",
      description: row.querySelector(".cq-desc").value,
      uom: row.querySelector(".cq-uom").textContent,
      hsn: product?.hsn || row.dataset.hsn || "",
      qty,
      rate,
      discount,
      gst,
      value: taxable,
    };
  });
  if (items.some((item) => !item.productName || item.qty <= 0 || item.rate < 0)) {
    return toast("Select a product and enter a valid quantity and rate for every row");
  }

  const total = items.reduce((sum, item) => sum + item.value * (1 + item.gst / 100), 0);
  let number = old.number || lead.qn;
  if (!number) {
    const sequence = Math.max(
      1000,
      ...LEADS.map((item) => Number(String(item.qn || "").replace(/\D/g, "")) || 0),
      ...CRM_QUOTES.map((item) => Number(String(item.number || "").replace(/\D/g, "")) || 0),
    ) + 1;
    number = "QT-" + sequence;
  }
  const template = CRM_TERMS.find((item) => item.id === $("#cq-template").value);
  const quote = {
    ...(old.id ? { id: old.id } : {}),
    recordType: "quotation",
    leadId: lead.id,
    number,
    clientId: client.id,
    clientName: client.name,
    clientContact: client.contact,
    clientEmail: client.email,
    clientAddress: client.address || "",
    clientGst: client.gstin || client.gst || "",
    unit: $("#cq-unit").value,
    date: $("#cq-date").value,
    validUntil: $("#cq-valid").value,
    notes: $("#cq-notes").value,
    templateId: template?.id || "",
    gstInclusive: $("#cq-gst-inclusive").checked,
    terms: $("#cq-terms").value,
    signatory: template?.signatory || "",
    items,
    total,
    status: old.status || "Pending",
    createdAt: old.createdAt || new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };

  button.disabled = true;
  button.textContent = "Saving…";
  try {
    const saved = await crmSaveSharedRecord(quote, CRM_QUOTES);
    const index = CRM_QUOTES.findIndex((item) => String(item.id) === String(saved.id));
    if (index >= 0) CRM_QUOTES[index] = saved;
    else CRM_QUOTES.push(saved);
    lead.qn = saved.number;
    lead.qa = saved.total;
    lead.st = "QUOTATION";
    log((old.id ? "Updated quotation " : "Created quotation ") + saved.number, lead.id);
    mask.remove();
    render();
    toast("Quotation " + saved.number + " saved");
    crmQuotePreview(saved);
  } catch (error) {
    button.disabled = false;
    button.textContent = old.id ? "? Save changes" : "? Create quotation";
    toast("Quotation was not saved: " + error.message);
  }
}
function crmTemplatesOpen(done) {
  const mask = document.createElement("div");
  mask.className = "mask crm-template-mask";
  let selected = CRM_TERMS[0]?.id || "";
  let creating = false;

  function draw() {
    const template = (!creating && CRM_TERMS.find((item) => String(item.id) === String(selected))) || {
      name: "",
      terms: "",
      signatory: "",
    };
    mask.innerHTML = `<div class="crm-template-dialog" role="dialog" aria-modal="true">
      <div class="crm-template-head"><div><h3><i class="fa-solid fa-gear" aria-hidden="true"></i> Quotation templates</h3>
      <p>Save terms and a signatory block for reuse. ${CRM_TERMS.length}/50 used.</p></div>
      <button class="ic" data-tclose aria-label="Close">×</button></div>
      <div class="crm-template-layout"><aside class="crm-template-list">
      <button class="btn" data-tnew>+ New template</button>
      ${CRM_TERMS.length ? CRM_TERMS.map((item) => `<button class="crm-template-item ${String(item.id) === String(selected) ? "on" : ""}" data-tsel="${esc(item.id)}">${esc(item.name)}</button>`).join("") : '<p class="empty">No templates yet.</p>'}
      </aside><div class="crm-template-form">
      <label>Template name *<input class="in" id="ct-name" value="${esc(template.name)}" placeholder="e.g. Standard selling terms"></label>
      <label>Terms and conditions<textarea class="in" id="ct-terms" rows="8" placeholder="Enter terms and conditions">${esc(template.terms)}</textarea></label>
      <label>Signatory block<textarea class="in" id="ct-sign" rows="3" placeholder="Company name\n(Authorised Signatory)">${esc(template.signatory)}</textarea>
      <small>Printed above the authorised signatory line.</small></label></div></div>
      <div class="crm-template-footer"><button class="btn" data-tclose>Close</button>
      ${selected && !creating ? '<button class="btn" data-tdel>Delete template</button>' : '<button class="btn" data-treset>Reset to Default</button>'}
      <button class="btn p" data-tsave>? ${selected && !creating ? "Save changes" : "Create template"}</button></div></div>`;
  }

  draw();
  document.body.append(mask);
  mask.addEventListener("click", async (event) => {
    if (event.target === mask || event.target.closest("[data-tclose]")) {
      mask.remove();
      if (done) done();
      return;
    }
    const button = event.target.closest("[data-tsel],[data-tnew],[data-tsave],[data-tdel],[data-treset]");
    if (!button) return;
    if (button.hasAttribute("data-tsel")) {
      selected = button.dataset.tsel;
      creating = false;
      draw();
      return;
    }
    if (button.hasAttribute("data-tnew")) {
      selected = "";
      creating = true;
      draw();
      return;
    }
    if (button.hasAttribute("data-treset")) {
      if (!confirm("Reset template settings for this quotation?")) return;
      $("#ct-name").value = "";
      $("#ct-terms").value = "";
      $("#ct-sign").value = "";
      return;
    }
    if (button.hasAttribute("data-tdel")) {
      if (!confirm("Delete this quotation template?")) return;
      try {
        await window.VyaparXAuth.deleteModuleRecord("quotations", selected);
        CRM_TERMS = CRM_TERMS.filter((item) => String(item.id) !== String(selected));
        selected = CRM_TERMS[0]?.id || "";
        draw();
      } catch (error) {
        toast("Template was not deleted: " + error.message);
      }
      return;
    }
    const name = $("#ct-name").value.trim();
    if (!name) return toast("Enter a template name");
    if ((!selected || creating) && CRM_TERMS.length >= 50) return toast("Template limit reached");
    const template = {
      ...(!creating && selected ? { id: selected } : {}),
      recordType: "template",
      name,
      terms: $("#ct-terms").value,
      signatory: $("#ct-sign").value,
    };
    button.disabled = true;
    try {
      const saved = await crmSaveSharedRecord(template, CRM_TERMS);
      const index = CRM_TERMS.findIndex((item) => String(item.id) === String(saved.id));
      if (index >= 0) CRM_TERMS[index] = saved;
      else CRM_TERMS.push(saved);
      selected = saved.id;
      toast("Template saved");
      draw();
    } catch (error) {
      button.disabled = false;
      toast("Template was not saved: " + error.message);
    }
  });
}
function crmDateFmt(d) {
  if (window.VyaparXShared?.formatDate) return window.VyaparXShared.formatDate(d);
  if (!d) return "—";
  const dt = new Date(d);
  if (Number.isNaN(dt.getTime())) return String(d);
  const months = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
  return String(dt.getDate()).padStart(2, "0") + "-" + months[dt.getMonth()] + "-" + dt.getFullYear();
}
function crmWords(num) {
  const a = ["", "One", "Two", "Three", "Four", "Five", "Six", "Seven", "Eight", "Nine", "Ten", "Eleven", "Twelve", "Thirteen", "Fourteen", "Fifteen", "Sixteen", "Seventeen", "Eighteen", "Nineteen"];
  const b = ["", "", "Twenty", "Thirty", "Forty", "Fifty", "Sixty", "Seventy", "Eighty", "Ninety"];
  const two = (n) => n < 20 ? a[n] : (b[Math.floor(n / 10)] + (n % 10 ? " " + a[n % 10] : ""));
  const three = (n) => (n > 99 ? a[Math.floor(n / 100)] + " Hundred" + (n % 100 ? " " + two(n % 100) : "") : two(n));
  let n = Math.floor(Math.abs(num));
  if (n === 0) return "Zero Rupees Only";
  let out = "";
  const crore = Math.floor(n / 10000000); n %= 10000000;
  const lakh = Math.floor(n / 100000); n %= 100000;
  const thousand = Math.floor(n / 1000); n %= 1000;
  if (crore) out += three(crore) + " Crore ";
  if (lakh) out += three(lakh) + " Lakh ";
  if (thousand) out += three(thousand) + " Thousand ";
  if (n) out += three(n);
  return out.trim() + " Rupees Only";
}
function crmGstSupplyType(q) {
  const co = (crmCompany().gst || String(q.unit || "")).replace(/[^0-9A-Za-z]/g, "").slice(0, 2).toUpperCase();
  const cl = String(q.clientGst || "").replace(/[^0-9A-Za-z]/g, "").slice(0, 2).toUpperCase();
  return co && cl && co === cl ? "intra" : "inter";
}
function crmQuotePreview(q){
  const c = crmCompany();
  CRM_ACTIVE_PREVIEW = q;
  const mask = document.createElement("div");
  mask.className = "mask crm-preview-mask";
  const taxable = q.items.reduce((s, i) => s + Number(i.value || 0), 0);
  const discountTotal = q.items.reduce((s, i) => s + Number(i.qty || 0) * Number(i.rate || 0) * (Number(i.discount || 0) / 100), 0);
  const supply = crmGstSupplyType(q);
  // GST summary aggregated per applicable rate. Intra-state: CGST + SGST at
  // half the rate each. Inter-state: IGST at the full rate. The two are never
  // applied together on the same taxable value.
  const byRate = {};
  q.items.forEach((i) => {
    const r = Number(i.gst || 0);
    byRate[r] = (byRate[r] || 0) + Number(i.value || 0);
  });
  let cgst = 0, sgst = 0, igst = 0;
  const gstRows = Object.keys(byRate).map(Number).sort((x, y) => x - y).filter(r => r > 0).map((r) => {
    const base = byRate[r];
    if (supply === "intra") {
      const half = base * r / 200;
      cgst += half; sgst += half;
      return { label: "CGST " + r + "%", rate: (r / 2) + "%", amount: half, pair: "SGST " + r + "%", pairRate: (r / 2) + "%", pairAmount: half };
    }
    const full = base * r / 100;
    igst += full;
    return { label: "IGST " + r + "%", rate: r + "%", amount: full };
  });
  const taxTotal = cgst + sgst + igst;
  const unrounded = taxable + taxTotal;
  const grand = Math.round(unrounded * 100) / 100;
  const roundOff = Math.round((grand - unrounded) * 100) / 100;
  const me = window.VyaparXAuth?.getCurrentSession?.();
  const preparedBy = me?.fullName || me?.name || "";
  const status = crmQuoteStatusLabel(q.status || "Pending");
  mask.innerHTML = `<div class="crm-preview-dialog"><div class="crm-preview-top"><div><h3>Quotation</h3><p>Preview the document that will be sent to the client.</p></div><button class="ic" data-pclose>×</button></div><div class="crm-preview-controls"><label>Terms template<select class="in" id="cp-template"><option value="">Saved quotation terms</option>${CRM_TERMS.map(t=>`<option value="${esc(t.id)}" ${t.id===q.templateId?'selected':''}>${esc(t.name)}</option>`).join("")}</select></label><button class="btn" data-pmanage><i class="fa-solid fa-gear" aria-hidden="true"></i> Manage templates</button></div><div class="crm-document-scroll"><article class="crm-document" id="crmDocument"><header class="crm-doc-head"><div><h1>${esc(c.name||q.unit||"Company name not configured")}</h1><p>${esc(c.address)}</p><p>${c.gst?'GSTIN: '+esc(c.gst):''}</p><p>${esc(c.phone)} ${esc(c.email)}</p></div><div class="crm-doc-title"><h2>QUOTATION</h2><b>${esc(q.number)}</b><small>Dated ${crmDateFmt(q.date)}</small></div></header><hr><div class="crm-doc-client"><div><small>QUOTATION FOR</small><h3>${esc(q.clientName)}</h3><p>${esc(q.clientAddress||"")}</p><p>${q.clientGst?'GSTIN: '+esc(q.clientGst):''}</p><p>${esc(q.clientContact||"")} ${esc(q.clientEmail||"")}</p></div><table><tbody><tr><td>QUOTE NO.</td><th>${esc(q.number)}</th></tr><tr><td>QUOTE DATE</td><th>${crmDateFmt(q.date)}</th></tr><tr><td>VALID UNTIL</td><th>${crmDateFmt(q.validUntil)}</th></tr><tr><td>STATUS</td><th>${esc(status)}</th></tr></tbody></table></div><table class="crm-doc-items"><thead><tr><th>Sr. No.</th><th>Product &amp; description</th><th>HSN/SAC</th><th>Qty</th><th>Unit</th><th>Rate (₹)</th><th>Discount (%)</th><th>Taxable Value (₹)</th></tr></thead><tbody>${q.items.map((i,n)=>`<tr><td>${n+1}</td><td><b>${esc(i.productName)}</b><br>${esc(i.description||"")}</td><td>${esc(i.hsn||"—")}</td><td>${i.qty}</td><td>${esc(i.uom||"—")}</td><td class="num">${crmMoney(i.rate)}</td><td class="num">${i.discount}%</td><td class="num">${crmMoney(i.value)}</td></tr>`).join("")}</tbody></table><div class="crm-doc-gst"><h3>GST Summary${supply==='intra'?' (Intra-State – CGST + SGST)':' (Inter-State – IGST)'}</h3><table><thead><tr><th>Tax</th><th>Rate</th><th class="num">Amount (₹)</th></tr></thead><tbody>${gstRows.length?gstRows.map((g)=>g.pair?`<tr><td>${esc(g.label)}</td><td>${esc(g.rate)}</td><td class="num">${crmMoney(g.amount)}</td></tr><tr><td>${esc(g.pair)}</td><td>${esc(g.pairRate)}</td><td class="num">${crmMoney(g.pairAmount)}</td></tr>`:`<tr><td>${esc(g.label)}</td><td>${esc(g.rate)}</td><td class="num">${crmMoney(g.amount)}</td></tr>`).join(""):`<tr><td colspan="3" style="text-align:center;color:#555">No taxable GST items.</td></tr>`}</tbody></table></div><div class="crm-doc-amounts"><div><span>Taxable Amount</span><b>${crmMoney(taxable)}</b></div><div><span>Total Discount</span><b>${crmMoney(discountTotal)}</b></div>${cgst?`<div><span>CGST Total</span><b>${crmMoney(cgst)}</b></div>`:''}${sgst?`<div><span>SGST Total</span><b>${crmMoney(sgst)}</b></div>`:''}${igst?`<div><span>IGST Total</span><b>${crmMoney(igst)}</b></div>`:''}${Math.abs(roundOff)>=0.005?`<div><span>Round Off</span><b>${roundOff>0?'+':''}${crmMoney(roundOff).slice(1)}</b></div>`:''}<div class="grand"><span>Grand Total</span><b>${crmMoney(grand)}</b></div><div class="words"><span>Amount in Words</span><b>${esc(crmWords(grand))}</b></div></div>${q.notes?`<section><h3>Notes</h3><p>${esc(q.notes)}</p></section>`:''}${q.terms?`<section><h3>Terms &amp; Conditions</h3><pre>${esc(q.terms)}</pre></section>`:''}<div class="crm-doc-prepared"><span>Prepared By: <b>${esc(preparedBy||"—")}</b></span><span>${esc(c.name||q.unit||"")}</span></div><div class="crm-doc-sign"><div>${esc(q.signatory||c.name||"")}<br><b>Authorised Signatory</b></div></div></article></div><div class="crm-preview-footer"><button class="btn" data-pclose>Cancel</button><button class="btn p" data-pprint><i class="fa-solid fa-print" aria-hidden="true"></i> Print / Save PDF</button></div></div>`;
  document.body.append(mask);
  mask.addEventListener("click",e=>{if(e.target===mask||e.target.closest("[data-pclose]")){mask.remove();return;}if(e.target.closest("[data-pprint]")){window.print();return;}if(e.target.closest("[data-pmanage]")){mask.remove();crmTemplatesOpen(()=>crmQuotePreview(q));return;}if(e.target.id==="cp-template"){const t=CRM_TERMS.find(x=>x.id===e.target.value);q.templateId=t?t.id:"";q.terms=t?t.terms:q.terms;q.signatory=t?t.signatory:q.signatory;crmSaveQuotes();mask.remove();crmQuotePreview(q);}});}

document.addEventListener("click", (e) => {

  const t = e.target.closest("[data-go],[data-act],[data-s]");

  if (!t) return;

  const d = t.dataset;

  if (d.go) return go(d.go);
  if (d.addcol != null) {
    return window.VyaparXFields.openAddColumn(d.addcol, () => render());
  }
  if (d.act === "managefields") {
    return window.VyaparXFields.openManageColumns(d.actarg || cur, () => render());
  }
  if (d.act && d.act.startsWith("qpreview:")) {
    const quoteId = d.act.slice("qpreview:".length);
    const quote = CRM_QUOTES.find((item) => String(item.id) === String(quoteId));
    if (quote) crmQuotePreview(quote);
    return;
  }
  if (d.act === "reportapply") { const range=$("#crmReportRange").value; const start=$("#crmReportStart").value; const end=$("#crmReportEnd").value; const type=$("#crmReportType").value; const actualEnd=range==="custom"?end:TODAY; const actualStart=range==="custom"?start:range==="1"?TODAY:iso(-(Number(range)-1)); if(!actualStart||!actualEnd||actualStart>actualEnd)return toast("Choose a valid report date range."); sessionStorage.setItem("crmReportFilters",JSON.stringify({range,start:actualStart,end:actualEnd,type})); return render(); }
  if (d.act === "reportcsv") { const filters=JSON.parse(sessionStorage.getItem("crmReportFilters")||"{}"); const start=filters.start||iso(-29), end=filters.end||TODAY, type=filters.type||"all"; const rows=[["Report","Record","Status","Amount","Date"]]; if(type==="all"||type==="leads")LEADS.filter(x=>crmDateKey(x.ca||TODAY)>=start&&crmDateKey(x.ca||TODAY)<=end).forEach(x=>rows.push(["Lead",x.name,x.st,x.qa||"",fs(x.ca)])); if(type==="all"||type==="quotes")CRM_QUOTES.filter(x=>crmDateKey(x.date)>=start&&crmDateKey(x.date)<=end&&crmQuoteIsActive(x)).forEach(x=>rows.push(["Quotation",x.number,x.status,x.total,fs(x.date)])); if(type==="all"||type==="follow")LEADS.filter(x=>crmDateKey(x.fu)>=start&&crmDateKey(x.fu)<=end&&open(x)).forEach(x=>rows.push(["Follow-up",x.name,x.st,"",fs(x.fu)])); const csv=rows.map(r=>r.map(v=>"\""+String(v??"").replace(/\"/g,"\"\"")+"\"").join(",")).join("\r\n"); const a=document.createElement("a");a.href=URL.createObjectURL(new Blob([csv],{type:"text/csv;charset=utf-8;"}));a.download="crm-report.csv";a.click();URL.revokeObjectURL(a.href);return; }
  if (d.act === "reportprint") { document.body.classList.add("crm-report-printing"); const clean=()=>{document.body.classList.remove("crm-report-printing");window.removeEventListener("afterprint",clean);}; window.addEventListener("afterprint",clean); const workspace=$("#crmReportWorkspace"); const images=[...(workspace?.querySelectorAll("img")||[])]; Promise.all(images.map((image)=>image.complete?Promise.resolve():new Promise((resolve)=>{image.addEventListener("load",resolve,{once:true});image.addEventListener("error",resolve,{once:true});}))).then(()=>requestAnimationFrame(()=>requestAnimationFrame(()=>window.print()))); return; }
  if (d.act && d.act.startsWith("ldel:")) {
    const leadId = d.act.slice("ldel:".length);
    const lead = LB(leadId);
    if (!lead || !["Lead", "Customer"].includes(lead.type)) return toast("This CRM record is no longer available.");
    if (CRM_LEAD_DELETE_PENDING.has(String(leadId))) return;
    const isCustomer = lead.type === "Customer";
    return dlg(
      `<h3>${isCustomer ? "Delete customer" : "Delete lead"} ${esc(lead.name)}?</h3><p>This will archive the ${isCustomer ? "customer" : "lead"} using the existing CRM soft-delete policy. Any existing Sales Orders and linked quotations will remain unchanged.</p>`,
      "Confirm Delete",
      (mask) => {
        if (CRM_LEAD_DELETE_PENDING.has(String(leadId))) return false;
        const button = mask.querySelector("[data-ok]");
        CRM_LEAD_DELETE_PENDING.add(String(leadId));
        button.disabled = true;
        button.textContent = "Deleting…";
        window.VyaparXAuth.deleteModuleRecord("crm", leadId)
          .then((result) => {
            if (!result || result.success !== true) throw new Error("The server did not confirm deletion.");
            LEADS = LEADS.filter((item) => String(item.id) !== String(leadId));
            CRM_DELETED_LEAD_IDS.add(String(leadId));
            window.VyaparXShared?.records?.markDeleted("crm", "lead", leadId);
            log(isCustomer ? "Archived customer" : "Deleted lead", leadId);
            mask.remove();
            render();
            toast(isCustomer ? "Customer archived successfully." : "Lead deleted successfully.");
          })
          .catch((error) => {
            button.disabled = false;
            button.textContent = "Confirm Delete";
            toast((isCustomer ? "Customer was not archived: " : "Lead was not deleted: ") + error.message);
          })
          .finally(() => CRM_LEAD_DELETE_PENDING.delete(String(leadId)));
        return false;
      },
    );
  }
  if (d.act && d.act.startsWith("qpreview:")) { const saved=CRM_QUOTES.find(q=>q.id===d.act.split(":")[1]); if(saved)crmQuotePreview(saved);return; }
  if (d.act && d.act.startsWith("qdel:")) {
    const quoteId = d.act.slice("qdel:".length);
    const quote = CRM_QUOTES.find((item) => String(item.id) === String(quoteId)) || crmQuoteForQuotationLead(quoteId);
    const lead = quote && LB(quote.leadId);
    if (!quote) return toast("Quotation is no longer available.");
    if (quote.salesOrderId || ["Converted", "Invoiced"].includes(quote.status)) return toast("This quotation is linked to a finalized transaction and cannot be deleted.");
    return dlg(`<h3>Delete quotation ${esc(quote.number || "") }?</h3><p>This action removes only the quotation. The lead and any separate Sales Order or invoice remain unchanged.</p>`, "Delete quotation", (mask) => {
      const confirmButton = mask.querySelector("[data-ok]");
      if (confirmButton.disabled) return false;
      confirmButton.disabled = true;
      (window.VyaparXShared?.records?.deleteRecord
        ? window.VyaparXShared.records.deleteRecord("quotations", quote.id)
        : window.VyaparXAuth.deleteModuleRecord("quotations", quote.id)).then(() => {
        CRM_QUOTES = CRM_QUOTES.filter((item) => String(item.id) !== String(quote.id));
        if (lead) {
          lead.qn = ""; lead.qa = 0;
          if (String(lead.type || "").toLowerCase() !== "customer" && ["QUOTATION", "QUOTED"].includes(String(lead.st || "").toUpperCase())) lead.st = "FOLLOW_UP";
          window.VyaparXShared?.records?.markPersisted("crm", "lead", lead);
        }
        log("Deleted quotation " + quote.number, lead?.id || quote.leadId || quote.id);
        render(); toast("Quotation deleted successfully.");
      }).catch((error) => { toast("Quotation was not deleted: " + error.message); if (confirmButton.isConnected) confirmButton.disabled = false; });
      return false;
    });
  }

  if (d.s != null) {

    const i = +d.s;

    sort = { i, d: sort && sort.i == i ? -sort.d : 1 };

    return render();

  }

  const [a, x] = d.act.split(":"),

    l = LB(x);

  if (d.act.startsWith("conv:")) return crmConvertLead(x, d.quoteId);

  if (a == "madd" && canManageTeam()) crmMemberForm();

  else if (a == "ev" && cur === "team") {
    const member = TEAM.find((item) => String(item.id) === String(x));
    if (member) detail([["Team Member", [["Name", esc(member.n)], ["Email", esc(member.e)], ["Phone", esc(member.ph)], ["Department", esc(member.department || "CRM")], ["Designation", esc(member.des)], ["Joining Date", fs(member.jd)], ["Status", esc(member.status || "ACTIVE")]]]]);
  }

  else if (a == "ee" && canManageTeam()) crmMemberForm(TEAM.find((item) => String(item.id) === String(x)));

  else if (a == "ed" && canManageTeam()) {
    const member = TEAM.find((item) => String(item.id) === String(x));
    if (!member) return toast("This team member is no longer available.");
    dlg(`<h3>Delete ${esc(member.n)}?</h3><p>This removes the CRM team member from the CRM team list.</p>`, "Delete", (mask) => {
      const button = mask.querySelector("[data-ok]");
      button.disabled = true;
      window.VyaparXAuth.deleteModuleRecord("crm", member.id).then(() => {
        TEAM = TEAM.filter((item) => String(item.id) !== String(member.id));
        window.VyaparXShared?.records?.markDeleted("crm", "teamMember", member.id);
        render(); toast("Team member deleted."); mask.remove();
      }).catch((error) => { button.disabled = false; toast("Team member was not deleted: " + error.message); });
      return false;
    });
  }

  else if (a == "add") leadForm();

  else if (a == "edit") leadForm(l);

  else if (a == "view") leadView(l);

  else if (a == "qv") { const saved=crmQuoteForLead(l.id); if(saved) crmQuotePreview(saved); else qView(l); }

  else if (a == "fv") fView(l);

  else if (a == "fu")

    dlg(

      `<h3>Follow-up for ${esc(l.name)}</h3><div class="fm"><label>Date *<input class="in" type="date" id="fd" value="${l.fu}"></label><label>Note<input class="in" id="fnn"></label></div>`,

      "Save follow-up",

      () => {

        if (

          !vf([

            [

              "#fd",

              (x) => x && !isNaN(Date.parse(x)) && x >= TODAY,

              "Choose a valid date, today or later.",

            ],

          ])

        )

          return false;

        const v = $("#fd").value;

        l.fu = v;

        if (l.st == "NEW" || l.st == "CONTACTED") l.st = "FOLLOW_UP";

        log("Follow-up set for " + v, l.id);

        render();

        toast("Follow-up saved");

      },

    );

  else if (a == "qt") crmOpenQuotation(l);
  else if (a == "qv") { const saved=crmQuoteForLead(l.id); if(saved) crmQuotePreview(saved); else qView(l); }
  else if (a == "stat")

    dlg(

      `<h3>Change status</h3><p>Current: ${l.st.replace("_", " ")}</p>${

        NEXT[l.st].length

          ? `<select class="in" id="ns">${NEXT[l.st]

              .filter((s) => s != "CONVERTED")

              .map((s) => `<option>${s}</option>`)

              .join("")}</select>`

          : "<p>This record is closed. No further changes are allowed.</p>"

      }`,

      "Update status",

      () => {

        const n = $("#ns");

        if (!n) return;

        if (n.value == "QUOTATION" && !l.qn)

          return (toast("Create a quotation first"), false);

        l.st = n.value;

        log("Status changed to " + n.value, l.id);

        render();

        toast("Status updated");

      },

    );

  else if (a == "conv") crmConvertLead(l.id, d.quoteId);

  else if (a == "so") {
    if (l.type !== "Customer") return toast("Convert this lead to a customer after Sales approves its quotation.");
    const quote = crmQuoteForLead(l.id);
    if (!quote && l.qn) return toast("The linked quotation is not available. Refresh CRM before proceeding.");
    if (quote && !crmQuoteIsApproved(quote)) return toast("Sales must approve the quotation before creating a Sales Order.");
    const params = new URLSearchParams({ view: "orders", action: "create", customerId: l.id });
    if (quote) params.set("quotationId", quote.id);
    window.location.assign("sales.html?" + params.toString());
  }

  else if (a == "task") taskForm();

  else if (a == "tv") taskView(TB(x));

  else if (a == "av") attView(TB(x));

  else if (a == "ad") attDown(TB(x));

  else if (a == "aadd") $("#tf").click();

  else if (a == "arm") {

    if (pend) URL.revokeObjectURL(pend.url);

    pend = null;

    attUI();

  } else if (a == "adv") {
    const t = TB(x);
    if (t) {
      const nextSt = t.st == "Pending" ? "In Progress" : "Completed";
      t.st = nextSt;
      t.hist.push([TODAY, "Status changed to " + t.st]);
      render();
      if (window.VyaparXShared && window.VyaparXShared.tasks) {
        window.VyaparXShared.tasks.updateTask(t.id, { st: nextSt, status: nextSt })
          .catch((err) => console.warn("Failed to update task status:", err));
      }
    }

  } else if (a == "read") {

    unread = 0;

    if (window.VyaparXShared?.tasks) {
      TASKS.filter((task) => task.dir === "Received" && !(task.isRead || task.read)).forEach((task) => {
        task.isRead = true;
        task.read = true;
        window.VyaparXShared.tasks.updateTask(task.id, { isRead: true, read: true }).catch(() => {});
      });
    }

    render();

  } else if (a == "csv")

    toast("CSV is generated by the backend after integration");

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

    go("leads");

    q = v;

    render();

  }

});

$("#bell").onclick = () => go("notif");

$("#ct").onclick = () => document.body.classList.toggle("col");

$("#mb").onclick = () => window.VyaparXShared.toggleMobileNav();

$("#th").onclick = () => { if (window.VyaparXShared) window.VyaparXShared.applyTheme(window.VyaparXShared.currentTheme() === "dark" ? "light" : "dark"); };

if (window.VyaparXShared?.records?.bindPageState) {
  window.VyaparXShared.records.bindPageState("crm", [
    { recordType: "lead", get: () => LEADS, set: (rows) => { LEADS = rows; } },
    { recordType: "teamMember", get: () => TEAM, set: (rows) => { TEAM = rows; } },
  ], {
    onReady: () => { crmMergeQuoteLeads(); if (["dashboard", "leads", "customers", "reports", "team"].includes(cur)) render(); },
    onChange: () => { if (["dashboard", "leads", "customers", "reports", "team"].includes(cur)) render(); },
    onError: (error) => toast("CRM records could not sync with Firestore: " + error.message),
  });
}
const crmParams = new URLSearchParams(window.location.search);
const crmViews = new Set(NAV.flatMap((section) => section[1].map((item) => item[0])));
const crmRequestedView = crmParams.get("view");
go(crmViews.has(crmRequestedView) ? crmRequestedView : "dashboard");
// Load company-scoped quotations before enabling quote creation and editing.
crmLoadSharedRecords();
if (window.VyaparXFields) window.VyaparXFields.loadFields("crm").then(() => { if (["leads"].includes(cur)) render(); });
window.addEventListener("focus", () => { if (window.VyaparXFields) window.VyaparXFields.loadFields("crm", true); });
window.addEventListener("focus", () => crmLoadSharedRecords(true));
window.setInterval(() => {
  if (document.visibilityState === "visible" && ["dashboard", "leads", "customers", "quotes", "reports"].includes(cur)) crmLoadSharedRecords(true);
}, 30000);
window.addEventListener("focus", () => { if (cur === "catalog") crmLoadProducts().then(() => render()); });

// Admin Reports integration: expose this module's real records so the Admin
// report engine builds CRM reports from actual data, not static counts.
window.CRM_REPORT_SOURCE = function () { try { return []; } catch (e) { return []; } };

// CRM report source: real lead/quotation records from this module's data.
window.CRM_REPORT_SOURCE = function () {
  try {
    var rows = [];
    (typeof LEADS !== "undefined" ? LEADS : []).forEach(function (l) {
      rows.push({
        type: l.st === "QUOTATION" ? "Quotation Report" : l.st === "FOLLOW_UP" ? "Follow-up Report" : "Lead Report",
        ref: l.id || "",
        user: l.own || "",
        date: l.cd || TODAY,
        status: (l.st || "").replace("_", " ").toLowerCase(),
        amount: l.val ? crmMoney(Number(l.val)) : "",
      });
    });
    return rows;
  } catch (e) {
    return [];
  }
};

// Record customer responses explicitly so Sales only converts accepted quotes.
const crmQuotePreviewBase = crmQuotePreview;
crmQuotePreview = function (quote) {
  CRM_ACTIVE_PREVIEW = quote;
  crmQuotePreviewBase(quote);
  const previewMask = document.querySelector(".crm-preview-mask");
  previewMask?.addEventListener("click", (event) => {
    // The original preview click handler predates change events for its select.
    if (event.target.id === "cp-template") event.stopPropagation();
  }, true);
  const controls = document.querySelector(".crm-preview-mask .crm-preview-controls");
  if (!controls) return;
  controls.querySelectorAll("#cp-template,[data-pmanage]").forEach((element) => element.remove());
  const readOnlyNotice = document.createElement("p");
  readOnlyNotice.textContent = "Read-only quotation document";
  controls.replaceChildren(readOnlyNotice);
};

document.addEventListener("change", async (event) => {
  if (!CRM_ACTIVE_PREVIEW || !["cp-template", "cp-status"].includes(event.target.id)) return;
  const quote = CRM_ACTIVE_PREVIEW;
  const previous = { templateId: quote.templateId, terms: quote.terms, signatory: quote.signatory, status: quote.status };
  if (event.target.id === "cp-template") {
    const template = CRM_TERMS.find((item) => String(item.id) === event.target.value);
    quote.templateId = template?.id || "";
    quote.terms = template ? template.terms : "";
    quote.signatory = template ? template.signatory : "";
  } else {
    quote.status = event.target.value;
  }
  try {
    const saved = await crmSaveSharedRecord(quote, CRM_QUOTES);
    const index = CRM_QUOTES.findIndex((item) => String(item.id) === String(saved.id));
    if (index >= 0) CRM_QUOTES[index] = saved;
    toast("Quotation updated");
    document.querySelector(".crm-preview-mask")?.remove();
    crmQuotePreview(saved);
  } catch (error) {
    Object.assign(quote, previous);
    event.target.value = event.target.id === "cp-status" ? previous.status : previous.templateId;
    toast("Quotation update failed: " + error.message);
  }
});

