/**
 * VyaparX ERP - Shared Product Catalog helpers.
 *
 * Used by both the Admin module (admin.js) and the Sales module (sales.js):
 *  - window.VyaparXCatalog.printCatalog()   -> professional A4 price-list print/PDF
 *  - window.VyaparXCatalog.manageFields()   -> custom product field configuration
 *  - window.VyaparXCatalog.customFields()   -> list of configured custom fields
 *  - window.VyaparXCatalog.customInput()    -> form inputs for a product editor
 *  - window.VyaparXCatalog.readCustomValues() / applyCustomValues()
 *
 * Custom field definitions are persisted as one company-scoped Firestore record
 * in the existing "catalog" module (recordType "customFields") via the standard
 * /api/modules/catalog/data API - no new collection, no new backend table.
 * Custom values are stored on each product record under the `custom` key and
 * never overwrite the standard product fields.
 */
(function (global) {
  "use strict";

  const FIELD_TYPES = [
    ["text", "Text"],
    ["number", "Number"],
    ["decimal", "Decimal"],
    ["select", "Dropdown (select)"],
    ["date", "Date"],
    ["checkbox", "Checkbox"],
    ["textarea", "Multiline description"],
  ];

  function esc(s) {
    return String(s ?? "").replace(/[&<>"]/g, (c) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&quot;", '"': "&quot;" })[c]
    );
  }

  /* ------------------------------------------------------------------ */
  /* Custom field definitions (persisted on one catalog record)          */
  /* ------------------------------------------------------------------ */

  let FIELDS = [];
  let loaded = false;
  let savePromise = null;
  let customFieldRecordExists = false;
  let customFieldRecordId = "product-custom-fields";

  async function loadFields(force, suppliedRecords) {
    const hasSuppliedRecords = Array.isArray(suppliedRecords);
    if (loaded && !force && !hasSuppliedRecords) return FIELDS;
    if (!hasSuppliedRecords && !global.VyaparXAuth?.fetchModuleRecords) return FIELDS;
    try {
      const records = hasSuppliedRecords ? suppliedRecords : await global.VyaparXAuth.fetchModuleRecords("catalog");
      const saved = records.find(
        (r) => r.recordType === "customFields" && !r.isDeleted
      );
      customFieldRecordExists = Boolean(saved);
      customFieldRecordId = saved && saved.id || "product-custom-fields";
      FIELDS = Array.isArray(saved?.fields)
        ? saved.fields.filter((f) => f && f.id && f.label)
        : [];
      loaded = true;
    } catch (e) {
      console.warn("Custom product fields unavailable:", e.message);
    }
    return FIELDS;
  }

  async function persistFields() {
    if (!global.VyaparXAuth?.saveModuleRecord || !global.VyaparXAuth?.createModuleRecord) {
      throw new Error("Product custom field save service is unavailable.");
    }
    const record = {
      id: customFieldRecordId,
      recordType: "customFields",
      fields: FIELDS,
    };
    if (savePromise) await savePromise.catch(() => { });
    savePromise = (async () => {
      let exists = customFieldRecordExists;
      if (!loaded) {
        const records = await global.VyaparXAuth.fetchModuleRecords("catalog");
        const saved = records.find((item) => item.recordType === "customFields" && !item.isDeleted);
        exists = Boolean(saved);
        if (saved?.id) record.id = saved.id;
      }
      const result = exists
        ? await global.VyaparXAuth.saveModuleRecord("catalog", record)
        : await global.VyaparXAuth.createModuleRecord("catalog", record);
      if (!result?.record?.id) throw new Error("The server did not confirm the product custom field changes.");
      customFieldRecordExists = true;
      customFieldRecordId = result.record.id;
      global.VyaparXShared?.records?.invalidate("catalog");
      return result.record;
    })().catch((error) => {
      console.warn("Could not save custom fields:", error.message);
      throw error;
    }).finally(() => { savePromise = null; });
    await savePromise;
  }

  /** Displayed order: Text, Number, Decimal, Dropdown, Date, Checkbox, Multiline. */
  const TYPE_ORDER = ["text", "number", "decimal", "select", "date", "checkbox", "textarea"];

  function manageFields(container, onDone) {
    const dlg = global.document.createElement("div");
    dlg.className = "mask vxp-fields-mask";
    const draft = FIELDS.map((f) => ({ ...f, options: [...(f.options || [])] }));

    const typeOptions = (sel) =>
      TYPE_ORDER.map(
        (t) => `<option value="${t}" ${t === sel ? "selected" : ""}>${FIELD_TYPES.find(([k]) => k === t)[1]}</option>`
      ).join("");

    const rowHtml = (f) => {
      const rows =
        f.type === "select"
          ? `<div class="fm" style="grid-column:1/-1;margin-top:4px"><label>Options (one per line)<textarea class="in vxp-f-options" rows="3">${esc((f.options || []).join("\n"))}</textarea></label></div>`
          : f.type === "checkbox"
            ? ""
            : `<div class="fm" style="grid-column:1/-1;margin-top:4px"><label>Default value<input class="in vxp-f-default" type="${f.type === "date" ? "date" : f.type === "number" || f.type === "decimal" ? "number" : "text"}" step="0.01" value="${esc(f.defaultValue ?? "")}"></label></div>`;
      return `<div class="vxp-field-row" data-id="${esc(f.id)}" style="border:1px solid var(--bd);border-radius:10px;padding:10px;margin-bottom:10px">
        <div style="display:grid;grid-template-columns:2fr 1fr auto auto;gap:10px;align-items:end">
          <label style="font-size:12px;color:var(--mut)">Label<input class="in vxp-f-label" value="${esc(f.label)}"></label>
          <label style="font-size:12px;color:var(--mut)">Type<select class="in vxp-f-type">${typeOptions(f.type)}</select></label>
          <label style="font-size:12px;color:var(--mut);display:flex;gap:6px;align-items:center"><input type="checkbox" class="vxp-f-required" ${f.required ? "checked" : ""}> Required</label>
          <label style="font-size:12px;color:var(--mut);display:flex;gap:6px;align-items:center"><input type="checkbox" class="vxp-f-visible" ${f.visible !== false ? "checked" : ""}> In catalog print</label>
        </div>
        ${rows}
        <div style="display:flex;justify-content:space-between;margin-top:8px">
          <button type="button" class="btn s" data-fdel>Delete field</button>
        </div>
      </div>`;
    };

    const render = () => {
      dlg.innerHTML = `<div class="dlg vxp-fields-dlg vxp-fields-product" role="dialog" aria-modal="true">
        <div class="dlg-head"><div><h3>Manage product fields</h3><p>Add the extra product details your business needs (for example Colour, Size, Brand or Minimum Order Quantity). Definitions are shared by Admin and Sales and saved to your company catalog.</p></div><button class="ic dlg-close" type="button" data-x aria-label="Close" title="Close">&times;</button></div>
        <div class="dlg-body"><div class="vxp-fields-list">${draft.map(rowHtml).join("") || '<p style="color:var(--mut);font-size:12px">No custom fields yet.</p>'}</div>
        <button type="button" class="btn" data-fadd style="margin-bottom:12px">＋ Add field</button>
        </div>
        <div class="a"><button class="btn" data-x>Cancel</button><button class="btn p" data-fsave>Save fields</button></div>
      </div>`;
    };
    render();

    global.document.body.append(dlg);
    let removed = false;
    const close = () => { removed = true; dlg.remove(); };
    dlg.addEventListener("click", (event) => {
      if (event.target === dlg || event.target.dataset.x != null) close();
      return;
    });
    dlg.addEventListener("click", (event) => {
      const t = event.target.closest("[data-fadd],[data-fdel],[data-fsave]");
      if (!t || removed) return;
      if (t.dataset.fadd != null) {
        const used = new Set(draft.map((f) => f.id));
        const base = "field_" + Date.now().toString(36);
        let id = base, n = 2;
        while (used.has(id)) id = base + "_" + n++;
        draft.push({ id, label: "New field", type: "text", required: false, visible: true, options: [], defaultValue: "" });
        render();
      } else if (t.dataset.fdel != null) {
        const row = t.closest(".vxp-field-row");
        const index = draft.findIndex((f) => f.id === row.dataset.id);
        if (index >= 0 && global.confirm(`Delete custom field "${draft[index].label}"? Saved product values for this field are kept in the product record but will no longer be shown or editable.`)) {
          draft.splice(index, 1);
          render();
        }
      } else if (t.dataset.fsave != null) {
        // Re-read the draft from the DOM so unsaved typed labels are preserved.
        const seen = new Set();
        const next = [];
        dlg.querySelectorAll(".vxp-field-row").forEach((row) => {
          const id = row.dataset.id;
          const cur = draft.find((f) => f.id === id) || {};
          if (seen.has(id)) return;
          seen.add(id);
          const label = row.querySelector(".vxp-f-label").value.trim();
          if (!label) return;
          const type = row.querySelector(".vxp-f-type").value;
          const options = [...row.querySelectorAll(".vxp-f-options")]
            .map((el) => el.value)
            .join("\n").split("\n").map((s) => s.trim()).filter(Boolean);
          const defaultValue = row.querySelector(".vxp-f-default")?.value ?? "";
          next.push({
            id, label, type,
            required: row.querySelector(".vxp-f-required").checked,
            visible: row.querySelector(".vxp-f-visible").checked,
            options: type === "select" ? options : [],
            defaultValue: type === "checkbox" ? defaultValue === "true" || defaultValue === "on" : defaultValue,
          });
        });
        if (!next.length) {
          global.alert("Add at least one custom field with a label before saving.");
          return;
        }
        const previousFields = FIELDS;
        const saveButton = dlg.querySelector("[data-fsave]");
        FIELDS = next;
        saveButton.disabled = true;
        persistFields().then(() => {
          loaded = true;
          close();
          if (typeof onDone === "function") onDone();
        }).catch((error) => {
          FIELDS = previousFields;
          if (saveButton.isConnected) saveButton.disabled = false;
          global.alert("Product custom fields were not saved: " + error.message);
        });
      }
    });
  }

  /* ------------------------------------------------------------------ */
  /* Product editor inputs                                               */
  /* ------------------------------------------------------------------ */

  function customInput(field, value) {
    const id = "cf-" + field.id;
    const req = field.required ? ' required' : "";
    const label = `${esc(field.label)}${field.required ? " *" : ""}`;
    if (field.type === "select") {
      return `<label>${label}<select class="in" data-cf="${esc(field.id)}" id="${id}"><option value="">—</option>${(field.options || []).map((o) => `<option ${String(value ?? "") === o ? "selected" : ""}>${esc(o)}</option>`).join("")}</select></label>`;
    }
    if (field.type === "textarea") {
      return `<label style="grid-column:1/-1">${label}<textarea class="in" data-cf="${esc(field.id)}" id="${id}" rows="2">${esc(value ?? field.defaultValue ?? "")}</textarea></label>`;
    }
    if (field.type === "checkbox") {
      const checked = value === true || value === "true" || (value == null && field.defaultValue === true);
      return `<label style="display:flex;gap:6px;align-items:center"><input type="checkbox" data-cf="${esc(field.id)}" id="${id}" ${checked ? "checked" : ""}> ${label}</label>`;
    }
    const type = field.type === "number" ? "number" : field.type === "decimal" ? "number" : field.type === "date" ? "date" : "text";
    const step = field.type === "decimal" ? ' step="0.01"' : "";
    return `<label>${label}<input class="in" data-cf="${esc(field.id)}" id="${id}" type="${type}"${step} value="${esc(value ?? field.defaultValue ?? "")}"${req}></label>`;
  }

  function customInputsHtml(product) {
    return FIELDS.map((f) => customInput(f, product?.custom?.[f.id])).join("");
  }

  function readCustomValues(scope) {
    const values = {};
    scope.querySelectorAll("[data-cf]").forEach((el) => {
      values[el.dataset.cf] = el.type === "checkbox" ? el.checked : el.value;
    });
    return values;
  }

  function applyCustomValues(record, scope) {
    const values = readCustomValues(scope);
    // Never touch standard product attributes - only the custom map changes.
    record.custom = { ...(record.custom || {}), ...values };
    return record;
  }

  function validateRequired(scope) {
    const values = readCustomValues(scope);
    return FIELDS.filter((f) => f.required && (values[f.id] === "" || values[f.id] == null))
      .map((f) => f.label);
  }

  /* ------------------------------------------------------------------ */
  /* Professional A4 catalog print                                       */
  /* ------------------------------------------------------------------ */

  const money = (n) =>
    "₹" + Number(n || 0).toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

  function offerPrice(product) {
    const rate = Number(product.rate ?? 0);
    const discount = Number(product.discount ?? 0);
    if (!Number.isFinite(rate) || !Number.isFinite(discount) || rate < 0 || discount < 0 || discount > 100) return null;
    return rate * (1 - discount / 100);
  }

  function companyInfo() {
    const p = (global.VyaparXShared && global.VyaparXShared.getCompanyProfile()) || {};
    return {
      name: p.company_name || p.companyName || "",
      trade: p.registered_business_name || p.registeredBusinessName || "",
      gstin: p.gstin || "",
      phone: p.phone || "",
      email: p.email || "",
      address: p.address || "",
      state: p.state || "",
      pin: p.pin_code || p.pinCode || "",
      country: p.country || "India",
      type: p.business_type || p.businessType || "",
      industry: p.industry || "",
      intro: p.introduction || p.about || "",
    };
  }

  const DEFAULT_TERMS = [
    "All prices are in Indian Rupees (INR) unless stated otherwise.",
    "Prices are exclusive of GST unless explicitly stated as inclusive; applicable GST is charged separately at the prevailing rate.",
    "Prices are valid at the time of printing and may be revised without prior notice; confirm current pricing before ordering.",
    "Delivery charges, packing and freight are extra and billed at actuals unless agreed in writing.",
    "Payment terms follow the agreed purchase terms; default is advance or on delivery.",
  ];

  function printCatalog(products) {
    const list = (products || []).filter((p) => p && !p.isDeleted && p.recordType !== "customFields");
    const co = companyInfo();
    const visibleFields = FIELDS.filter((f) => f.visible !== false);
    const when = global.VyaparXShared?.formatDate ? global.VyaparXShared.formatDate(new Date()) : new Date().toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" });

    const rows = list.map((product) => {
      const offer = offerPrice(product);
      const custom = visibleFields
        .map((f) => {
          const raw = product.custom?.[f.id];
          const value = f.type === "checkbox" ? (raw === true || raw === "true" ? "Yes" : "No") : raw ?? "";
          return value !== "" && value != null ? `${esc(f.label)}: ${esc(value)}` : "";
        })
        .filter(Boolean);
      return `<tr>
        <td><span class="pc-code">${esc(product.code || "—")}</span></td>
        <td><b>${esc(product.name || "")}</b>${custom.length ? `<div class="cattr">${custom.join(" · ")}</div>` : ""}</td>
        <td>${esc(product.description || "—")}</td>
        <td>${esc(product.unit || "Nos")}</td>
        <td class="price">${offer == null ? "—" : money(product.rate)}</td>
        <td class="disc">${Number(product.discount || 0)}%</td>
        <td class="offer">${offer == null ? "—" : `${money(offer)} <small>/ ${esc(product.unit || "Nos")}</small>`}</td>
      </tr>`;
    }).join("");

    const header = `<header class="pc-head">
      <div class="pc-brand">
        ${co.name ? `<h1>${esc(co.name)}</h1>` : ""}
        ${co.trade && co.trade !== co.name ? `<div class="pc-trade">${esc(co.trade)}</div>` : ""}
        ${co.intro ? `<p class="pc-intro">${esc(co.intro)}</p>` : ""}
        <div class="pc-contact">
          ${co.address ? `<div>${esc(co.address)}${co.state || co.pin ? `, ${esc(co.state)} ${esc(co.pin)}` : ""}${co.country ? `, ${esc(co.country)}` : ""}</div>` : ""}
          <div>${[co.phone, co.email, co.gstin && `GSTIN: ${co.gstin}`].filter(Boolean).map(esc).join(" · ")}</div>
        </div>
      </div>
      <div class="pc-doc">
        <div class="pc-doc-title">PRODUCT CATALOG<br>PRODUCT PRICE LIST</div>
        <div class="pc-doc-meta">Printed: ${esc(when)}</div>
      </div>
    </header>
    <div class="pc-divider"></div>`;

    const terms = `<section class="pc-terms">
      <h2>Terms &amp; Conditions</h2>
      <ul>${DEFAULT_TERMS.map((t) => `<li>${esc(t)}</li>`).join("")}</ul>
    </section>
    <footer class="pc-foot">Company product price list · ${esc(co.name || "VyaparX ERP")} · Page <span class="pageno"></span></footer>`;

    const html = `<!doctype html><html><head><meta charset="utf-8"><title>${esc(co.name || "Product Catalog")} — Product Catalog</title>
<style>
  @page { size: A4 portrait; margin: 15mm 15mm 18mm 15mm; }
  * { box-sizing: border-box; }
  body { font-family: "Segoe UI", Arial, sans-serif; color: #1e293b; margin: 0; font-size: 12px; }
  .pc-head { display: flex; justify-content: space-between; gap: 16px; align-items: flex-start; }
  .pc-brand h1 { color: #0c3aa8; font-size: 22px; margin: 0 0 2px; letter-spacing: .3px; }
  .pc-trade { color: #334155; font-size: 12px; }
  .pc-intro { color: #475569; font-size: 10.5px; margin: 4px 0 6px; max-width: 115mm; }
  .pc-contact { color: #475569; font-size: 10px; line-height: 1.5; }
  .pc-doc { text-align: right; }
  .pc-doc-title { color: #0c3aa8; font-size: 15px; font-weight: 700; letter-spacing: 1px; line-height: 1.5; }
  .pc-doc-meta { color: #64748b; font-size: 9.5px; margin-top: 4px; }
  .pc-divider { height: 3px; background: #2f8bff; margin: 10px 0 12px; border-radius: 2px; }
  table.pc-table { width: 100%; border-collapse: collapse; }
  .pc-table th { background: #eef2f7; color: #0c3aa8; text-align: left; padding: 7px 8px; font-size: 10.5px; text-transform: uppercase; letter-spacing: .4px; border-bottom: 2px solid #c7d6ef; }
  .pc-table td { padding: 6px 8px; border-bottom: 1px solid #e2e8f0; vertical-align: top; font-size: 11px; }
  .pc-table tr { page-break-inside: avoid; }
  thead { display: table-header-group; }
  .pc-table td:nth-child(1) { white-space: nowrap; }
  .pc-code { display: inline-block; background: #f1f5f9; border: 1px solid #dbe3ee; border-radius: 4px; padding: 1px 6px; font-size: 10px; color: #334155; font-family: Consolas, monospace; }
  .price { color: #1d4ed8; white-space: nowrap; }
  .disc { color: #dc2626; white-space: nowrap; }
  .offer { color: #15803d; font-weight: 600; white-space: nowrap; }
  .offer small { color: #475569; font-weight: 400; }
  .cattr { color: #64748b; font-size: 9.5px; margin-top: 2px; }
  .pc-terms { background: #f4f6fa; border-left: 4px solid #2f8bff; padding: 10px 14px; margin-top: 18px; page-break-inside: avoid; }
  .pc-terms h2 { color: #0c3aa8; font-size: 12px; margin: 0 0 6px; }
  .pc-terms ul { margin: 0; padding-left: 16px; }
  .pc-terms li { color: #475569; font-size: 10px; margin-bottom: 3px; }
  .pc-foot { color: #94a3b8; font-size: 9px; margin-top: 12px; text-align: center; }
  .pc-empty { color: #64748b; padding: 24px 0; text-align: center; }
</style></head><body>
${header}
${rows ? `<table class="pc-table"><thead><tr><th>Product Code</th><th>Product Name</th><th>Details</th><th>Unit</th><th>Price</th><th>Discount</th><th>Offer Price</th></tr></thead><tbody>${rows}</tbody></table>` : `<div class="pc-empty">No catalog products are available to print.</div>`}
${terms}
<script>window.addEventListener("load", function(){ setTimeout(function(){ window.print(); }, 300); });</script>
</body></html>`;

    const win = global.open("", "_blank", "width=900,height=700");
    if (!win) {
      global.alert("Allow pop-ups to print the product catalog, or save it as PDF from the print dialog.");
      return;
    }
    win.document.open();
    win.document.write(html);
    win.document.close();
  }

  global.VyaparXCatalog = {
    FIELD_TYPES,
    loadFields,
    manageFields,
    customFields: () => FIELDS,
    customInputsHtml,
    customInput,
    readCustomValues,
    applyCustomValues,
    validateRequired,
    printCatalog,
    offerPrice,
    companyInfo,
  };
})(typeof window !== "undefined" ? window : globalThis);
