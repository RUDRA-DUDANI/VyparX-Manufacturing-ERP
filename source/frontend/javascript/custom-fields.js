/**
 * VyaparX ERP - Shared custom-column engine (entity-scoped).
 *
 * One reusable mechanism for every module table. Reuses the existing
 * /api/modules/<module>/data persistence used by catalog-shared.js
 * (no new collections, no new backend tables, no new API contracts):
 *
 *  - Definitions: one company-scoped record per module, recordType
 *    "customFields", id "<module>-custom-fields".
 *  - Values: stored on each record under `record.custom.<fieldId>` so they
 *    persist with the record across refreshes and re-logins.
 *
 * Public API (window.VyaparXFields):
 *   ICONS          -> standard action icons (eye/pencil/trash/printer)
 *   iconActions()  -> build standardized icon buttons for a row
 *   loadFields(moduleKey)      -> entity-scoped field definitions
 *   saveFields(moduleKey, f)   -> persist definition changes
 *   openAddColumn(moduleKey)   -> "+ custom column" modal
 *   columnButton(moduleKey)    -> the `+` header button markup
 *   tableColumns(moduleKey, baseCols)   -> base columns + custom labels
 *   tableRow(moduleKey, record, baseRow)-> base row + formatted custom values
 *   formFieldsHtml(moduleKey, record)   -> auto-generated form controls
 *   readFormValues(moduleKey, scope)    -> typed values from the form
 *   validateForm(moduleKey, scope)      -> required/type validation
 *   applyToRecord(moduleKey, record, values) -> merge values into record
 *   customFieldSummary(record)   -> field label/value pairs for detail views
 */
(function (global) {
  "use strict";

  /* ------------------------------------------------------------------ */
  /* Standard action icons (shared library paths, neutral/dark stroke)   */
  /* ------------------------------------------------------------------ */

  const ICON_PATHS = {
    view:
      '<path d="M2 12s3.5-6.5 10-6.5S22 12 22 12s-3.5 6.5-10 6.5S2 12 2 12z"/><circle cx="12" cy="12" r="3"/>',
    edit:
      '<path d="M17 3a2.8 2.8 0 0 1 4 4L7.5 20.5 2 22l1.5-5.5z"/>',
    trash:
      '<path d="M3 6h18M8 6V4a1 1 0 0 1 1-1h6a1 1 0 0 1 1 1v2M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/><path d="M10 11v6M14 11v6"/>',
    print:
      '<path d="M6 9V3h12v6"/><rect x="4" y="9" width="16" height="8" rx="2"/><path d="M6 14h12v7H6z"/>',
    plus:
      '<path d="M12 5v14M5 12h14"/>',
    settings:
      '<circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.7 1.7 0 0 0 .3 1.9l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.9-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1-1.5 1.7 1.7 0 0 0-1.9.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.9 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1 1.7 1.7 0 0 0-.3-1.9l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.9.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.9-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.9V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z"/>',
  };

  function iconSvg(name, size, cls) {
    const p = ICON_PATHS[name] || "";
    return (
      `<svg width="${size || 16}" height="${size || 16}" viewBox="0 0 24 24" fill="none" ` +
      `stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" ` +
      `aria-hidden="true"${cls ? ` class="${cls}"` : ""}>${p}</svg>`
    );
  }

  /**
   * Standardized icon buttons for one table row.
   *   actions: [{ act, title, kind }]
   * kind: "danger" renders the red trash styling; everything else is neutral.
   * The caller keeps its own data-act names and click handlers - only the
   * visual style and accessibility labels are standardized.
   */
  function iconActions(actions, idArg) {
    return (actions || [])
      .filter(Boolean)
      .map((a) => {
        const dangerous = a.kind === "danger";
        return (
          `<button class="vxp-act${dangerous ? " vxp-act-danger" : ""}" data-act="${a.act}:${idArg}" ` +
          `title="${a.title}" aria-label="${a.title}" type="button">` +
          iconSvg(a.kind === "danger" ? "trash" : a.icon || a.kind, 16) +
          `</button>`
        );
      })
      .join("");
  }

  /* ------------------------------------------------------------------ */
  /* Field types                                                        */
  /* ------------------------------------------------------------------ */

  const FIELD_TYPES = [
    ["text", "Text"],
    ["number", "Number"],
    ["date", "Date"],
    ["checkbox", "Checkbox"],
    ["select", "Dropdown"],
    ["file", "File/Link"],
  ];
  // No formula type: no safe formula engine exists in this codebase, so
  // formula fields are intentionally not enabled (per security requirement).

  const TYPE_ORDER = ["text", "number", "date", "checkbox", "select", "file"];

  /* ------------------------------------------------------------------ */
  /* Persistence via the existing /api/modules/<module>/data endpoint    */
  /* ------------------------------------------------------------------ */

  const CACHE = {}; // moduleKey -> { fields, loaded, saving }
  const MODULE_COL = {
    crm: "crm",
    sales: "sales",
    purchase: "purchase",
    inventory: "inventory",
    production: "production",
    transport: "transport",
    accounting: "accounting",
    admin: "admin",
    tasks: "tasks",
    catalog: "catalog",
  };

  function moduleStore(moduleKey) {
    return MODULE_COL[moduleKey] || moduleKey;
  }

  async function loadFields(moduleKey, force) {
    const c = (CACHE[moduleKey] = CACHE[moduleKey] || { fields: [], loaded: false, recordExists: false });
    if (c.loaded && !force) return c.fields;
    if (!global.VyaparXAuth || !global.VyaparXAuth.fetchModuleRecords) return c.fields;
    try {
      const records = await global.VyaparXAuth.fetchModuleRecords(moduleStore(moduleKey));
      const saved = records.find(
        (r) => r.recordType === "customFields" && !r.isDeleted
      );
      c.recordExists = Boolean(saved);
      c.recordId = saved && saved.id || moduleKey + "-custom-fields";
      c.fields = Array.isArray(saved && saved.fields)
        ? saved.fields.filter((f) => f && f.id && f.label)
        : [];
      c.loaded = true;
    } catch (e) {
      console.warn("Custom fields unavailable for " + moduleKey + ":", e.message);
    }
    return c.fields;
  }

  async function saveFields(moduleKey, fields) {
    if (!global.VyaparXAuth || !global.VyaparXAuth.saveModuleRecord || !global.VyaparXAuth.createModuleRecord) {
      throw new Error("Custom field save service is unavailable.");
    }
    const c = (CACHE[moduleKey] = CACHE[moduleKey] || { fields: [], loaded: false, recordExists: false });
    try {
      const store = moduleStore(moduleKey);
      let exists = c.recordExists;
      let id = c.recordId || moduleKey + "-custom-fields";
      if (!c.loaded) {
        const records = await global.VyaparXAuth.fetchModuleRecords(store);
        const saved = records.find((record) => record.recordType === "customFields" && !record.isDeleted);
        exists = Boolean(saved);
        id = saved && saved.id || id;
      }
      const payload = {
        id,
        recordType: "customFields",
        fields: fields,
      };
      const result = exists
        ? await global.VyaparXAuth.saveModuleRecord(store, payload)
        : await global.VyaparXAuth.createModuleRecord(store, payload);
      if (!result || !result.record || !result.record.id) {
        throw new Error("The server did not confirm the custom field changes.");
      }
      c.fields = fields;
      c.loaded = true;
      c.recordExists = true;
      c.recordId = result.record.id;
      global.VyaparXShared?.records?.invalidate(store);
      return result.record;
    } catch (e) {
      console.warn("Could not save custom fields for " + moduleKey + ":", e.message);
      throw e;
    }
  }

  /** Fields visible as table columns for this entity. */
  function fieldsFor(moduleKey) {
    const c = CACHE[moduleKey];
    return c ? c.fields.filter((f) => f.visible !== false) : [];
  }

  function findField(moduleKey, id) {
    return fieldsFor(moduleKey).find((f) => f.id === id);
  }

  /* ------------------------------------------------------------------ */
  /* Form controls                                                       */
  /* ------------------------------------------------------------------ */

  function formControl(f, value) {
    const id = "vxcf-" + f.id;
    const req = f.required ? " *" : "";
    switch (f.type) {
      case "select": {
        const opts = (f.options || [])
          .map(
            (o) =>
              `<option value="${esc(o)}" ${String(value) === String(o) ? "selected" : ""}>${esc(o)}</option>`
          )
          .join("");
        return `<label>${esc(f.label)}${req}<select class="in vxcf-input" id="${id}" data-vxcf="${f.id}"><option value=""></option>${opts}</select></label>`;
      }
      case "checkbox":
        return `<label class="vxcf-check">${esc(f.label)}${req}<input type="checkbox" class="vxcf-input" id="${id}" data-vxcf="${f.id}" ${value === true || value === "true" ? "checked" : ""}></label>`;
      case "date":
        return `<label>${esc(f.label)}${req}<input class="in vxcf-input" id="${id}" data-vxcf="${f.id}" type="date" value="${esc(value ?? "")}"></label>`;
      case "number":
        return `<label>${esc(f.label)}${req}<input class="in vxcf-input" id="${id}" data-vxcf="${f.id}" type="number" step="any" inputmode="decimal" value="${esc(value ?? "")}"></label>`;
      case "file":
        return `<label>${esc(f.label)}${req} <small>(file or link)</small><input class="in vxcf-input" id="${id}" data-vxcf="${f.id}" type="text" placeholder="https://... or file name" value="${esc(value ?? "")}"></label>`;
      default:
        return `<label>${esc(f.label)}${req}<input class="in vxcf-input" id="${id}" data-vxcf="${f.id}" type="text" value="${esc(value ?? "")}"></label>`;
    }
  }

  /** Hidden inputs keep values of fields not currently rendered editable. */
  function hiddenInputs(moduleKey, record) {
    const values = (record && record.custom) || {};
    const rendered = new Set();
    return fieldsFor(moduleKey)
      .map((f) => {
        if (rendered.has(f.id)) return "";
        const v = values[f.id];
        return v == null
          ? ""
          : `<input type="hidden" data-vxcf="${f.id}" value="${esc(v)}">`;
      })
      .join("");
  }

  function formFieldsHtml(moduleKey, record) {
    const values = (record && record.custom) || {};
    const fields = fieldsFor(moduleKey);
    if (!fields.length) return "";
    const controls = fields.map((f) => formControl(f, values[f.id])).join("");
    return (
      `<div class="vxcf-block"><h4 style="margin:0 0 8px;font-size:13px">Custom fields</h4>` +
      `<div class="fm">${controls}</div></div>`
    );
  }

  function readFormValues(scope) {
    const values = {};
    (scope || document)
      .querySelectorAll(".vxcf-input[data-vxcf], [data-vxcf]")
      .forEach((el) => {
        if (el.type === "checkbox") values[el.dataset.vxcf] = el.checked;
        else values[el.dataset.vxcf] = el.value;
      });
    return values;
  }

  function validateForm(moduleKey, scope) {
    const errors = [];
    const values = readFormValues(scope);
    fieldsFor(moduleKey).forEach((f) => {
      const v = values[f.id];
      if (f.required && (v == null || v === "")) {
        errors.push(`${f.label} is required.`);
        return;
      }
      if (v == null || v === "") return;
      if (f.type === "number" && !Number.isFinite(Number(v)))
        errors.push(`${f.label} must be a number.`);
      if (f.type === "date" && isNaN(Date.parse(v)))
        errors.push(`${f.label} must be a valid date.`);
      if (f.type === "select" && f.options && f.options.length && !f.options.includes(v))
        errors.push(`${f.label} must be one of the configured options.`);
    });
    return errors;
  }

  /** Merge typed values into a record under `custom`, preserving unknown keys. */
  function applyToRecord(moduleKey, record, values) {
    if (!record) return record;
    record.custom = Object.assign({}, record.custom || {});
    fieldsFor(moduleKey).forEach((f) => {
      if (Object.prototype.hasOwnProperty.call(values || {}, f.id)) {
        record.custom[f.id] = values[f.id];
      }
    });
    return record;
  }

  /** Merge a record's existing custom values into a form values object. */
  function applyFromRecord(moduleKey, record) {
    return Object.assign({}, (record && record.custom) || {});
  }

  /* ------------------------------------------------------------------ */
  /* Table column + "+" button integration                               */
  /* ------------------------------------------------------------------ */

  function columnButton(moduleKey, label) {
    return (
      `<button class="vxp-colbtn" data-addcol="${moduleKey}" type="button" ` +
      `title="Add custom column" aria-label="Add custom column">` +
      iconSvg("plus", 13) +
      `</button>`
    );
  }

  /** Base columns + custom column labels. */
  function tableColumns(moduleKey, baseCols) {
    return baseCols.concat(fieldsFor(moduleKey).map((f) => f.label));
  }

  /** Base row + custom values formatted for display. */
  function tableRow(moduleKey, record, baseRow) {
    const values = (record && record.custom) || {};
    return baseRow.concat(
      fieldsFor(moduleKey).map((f) => {
        const v = values[f.id];
        if (f.type === "checkbox") return v === true || v === "true" ? "Yes" : "No";
        return esc(v == null || v === "" ? "—" : v);
      })
    );
  }

  /** Summaries for detail views / print documents. */
  function customFieldSummary(record) {
    const values = (record && record.custom) || {};
    return Object.keys(values)
      .filter((k) => values[k] !== "" && values[k] != null)
      .map((k) => {
        const f = findFieldByLabelOrId(record && record.__module, k) ||
          { label: k, type: "text" };
        const v = f.type === "checkbox"
          ? (values[k] === true || values[k] === "true" ? "Yes" : "No")
          : values[k];
        return [f.label || k, v];
      });
  }

  function findFieldByLabelOrId(moduleKey, key) {
    return fieldsFor(moduleKey).find((f) => f.id === key || f.label === key);
  }

  /* ------------------------------------------------------------------ */
  /* Add / edit / delete custom column modal                             */
  /* ------------------------------------------------------------------ */

  function openAddColumn(moduleKey, onDone) {
    if (!global.document) return;
    const fields = CACHE[moduleKey] ? CACHE[moduleKey].fields : [];
    const mask = global.document.createElement("div");
    mask.className = "mask vxp-fields-mask";

    const typeOptions = TYPE_ORDER.map(
      (t) =>
        `<option value="${t}" ${t === "text" ? "selected" : ""}>${FIELD_TYPES.find(([k]) => k === t)[1]}</option>`
    ).join("");

    mask.innerHTML = `<div class="dlg vxp-fields-dlg" role="dialog" aria-modal="true">
      <div class="dlg-head"><div><h3>Add custom column</h3><p>The field is added to this table and automatically appears in the matching Add and Edit forms.</p></div><button class="ic dlg-close" type="button" data-x aria-label="Close" title="Close">×</button></div>
      <div class="dlg-body"><div class="fm" style="margin-top:8px">
        <label>Column name *<input class="in" id="vxcf-name" placeholder="e.g. Industry Type"></label>
        <label>Field type *<select class="in" id="vxcf-type">${typeOptions}</select></label>
        <label id="vxcf-req-wrap" style="display:flex;align-items:center;gap:6px;font-size:12px;color:var(--mut)"><input type="checkbox" id="vxcf-req"> Required</label>
        <div id="vxcf-options-wrap" style="display:none;grid-column:1/-1"><label>Options (one per line)<textarea class="in" id="vxcf-options" rows="3"></textarea></label></div>
      </div></div>
      <div class="a" style="margin-top:12px">
        <button class="btn" data-x>Cancel</button>
        <button class="btn p" id="vxcf-save">Add Column</button>
      </div>
    </div>`;

    global.document.body.append(mask);

    const typeSel = mask.querySelector("#vxcf-type");
    typeSel.addEventListener("change", () => {
      mask.querySelector("#vxcf-options-wrap").style.display =
        typeSel.value === "select" ? "" : "none";
    });

    mask.addEventListener("click", (e) => {
      if (e.target === mask || e.target.closest("[data-x]")) {
        mask.remove();
        return;
      }
      if (e.target.id !== "vxcf-save") return;
      const name = mask.querySelector("#vxcf-name").value.trim();
      if (!name) {
        global.alert("Column name is required.");
        return;
      }
      if (fields.some((f) => f.label.toLowerCase() === name.toLowerCase())) {
        global.alert(`A column named "${name}" already exists in this module.`);
        return;
      }
      const type = typeSel.value;
      let options = [];
      if (type === "select") {
        options = mask
          .querySelector("#vxcf-options")
          .value.split("\n")
          .map((s) => s.trim())
          .filter(Boolean);
        if (!options.length) {
          global.alert("Add at least one dropdown option.");
          return;
        }
      }
      const id =
        "cf_" + name.toLowerCase().replace(/[^a-z0-9]+/g, "_") + "_" + Date.now().toString(36);
      const next = fields.concat([
        {
          id,
          label: name,
          type,
          required: mask.querySelector("#vxcf-req").checked,
          options,
          visible: true,
        },
      ]);
      const saveButton = mask.querySelector("#vxcf-save");
      saveButton.disabled = true;
      saveFields(moduleKey, next).then(() => {
        mask.remove();
        if (typeof onDone === "function") onDone(next);
      }).catch((error) => {
        if (saveButton.isConnected) saveButton.disabled = false;
        global.alert("Custom fields were not saved: " + error.message);
      });
    });
  }

  /** Edit/delete management dialog for existing custom fields. */
  function openManageColumns(moduleKey, onDone) {
    if (!global.document) return;
    const fields = (CACHE[moduleKey] ? CACHE[moduleKey].fields : []).map((f) => ({
      ...f,
      options: [...(f.options || [])],
    }));
    const mask = global.document.createElement("div");
    mask.className = "mask vxp-fields-mask";

    const typeOptions = (sel) =>
      TYPE_ORDER.map(
        (t) =>
          `<option value="${t}" ${t === sel ? "selected" : ""}>${FIELD_TYPES.find(([k]) => k === t)[1]}</option>`
      ).join("");

    const rowHtml = (f) => {
      const opts =
        f.type === "select"
          ? `<div style="grid-column:1/-1;margin-top:4px"><label>Options (one per line)<textarea class="in vxp-m-options" rows="2">${esc((f.options || []).join("\n"))}</textarea></label></div>`
          : "";
      return `<div class="vxp-m-row" data-id="${esc(f.id)}" style="border:1px solid var(--bd);border-radius:10px;padding:10px;margin-bottom:10px">
        <div style="display:grid;grid-template-columns:2fr 1fr auto;gap:10px;align-items:end">
          <label style="font-size:12px;color:var(--mut)">Label<input class="in vxp-m-label" value="${esc(f.label)}"></label>
          <label style="font-size:12px;color:var(--mut)">Type<select class="in vxp-m-type">${typeOptions(f.type)}</select></label>
          <label style="font-size:12px;color:var(--mut);display:flex;gap:6px;align-items:center"><input type="checkbox" class="vxp-m-required" ${f.required ? "checked" : ""}> Required</label>
        </div>
        ${opts}
        <div style="display:flex;justify-content:space-between;margin-top:8px">
          <button type="button" class="btn s vxp-m-del">Delete field</button>
        </div>
      </div>`;
    };

    const render = () => {
      mask.innerHTML = `<div class="dlg vxp-fields-dlg vxp-fields-manage" role="dialog" aria-modal="true">
        <div class="dlg-head"><div><h3>Manage custom fields</h3><p>Edits update the table column, form label and validation. Existing record values are preserved where the type is compatible.</p></div><button class="ic dlg-close" type="button" data-x aria-label="Close" title="Close">×</button></div>
        <div class="dlg-body"><div class="vxp-m-list">${fields.map(rowHtml).join("") || '<p style="color:var(--mut);font-size:12px">No custom fields yet.</p>'}</div></div>
        <div class="a" style="margin-top:12px">
          <button class="btn" data-x>Cancel</button>
          <button class="btn p" id="vxp-m-save">Save changes</button>
        </div>
      </div>`;
    };
    render();
    global.document.body.append(mask);

    let removed = false;
    const close = () => { removed = true; mask.remove(); };

    mask.addEventListener("click", (e) => {
      if (e.target === mask || e.target.closest("[data-x]")) { close(); return; }
      if (removed) return;
      if (e.target.closest(".vxp-m-del")) {
        const row = e.target.closest(".vxp-m-row");
        const idx = fields.findIndex((f) => f.id === row.dataset.id);
        if (idx >= 0 && global.confirm(`Delete custom field "${fields[idx].label}"? It will be removed from this table and its forms. Existing record values are kept in the record data but no longer shown.`)) {
          fields.splice(idx, 1);
          render();
        }
        return;
      }
      if (e.target.id === "vxp-m-save") {
        const seen = new Set();
        const next = [];
        const original = CACHE[moduleKey] ? CACHE[moduleKey].fields : [];
        mask.querySelectorAll(".vxp-m-row").forEach((row) => {
          const id = row.dataset.id;
          const cur = fields.find((f) => f.id === id) || {};
          if (seen.has(id)) return;
          seen.add(id);
          const label = row.querySelector(".vxp-m-label").value.trim();
          if (!label) return;
          const prev = original.find((f) => f.id === id) || {};
          const type = row.querySelector(".vxp-m-type").value;
          if (prev.type && prev.type !== type) {
            const compatible =
              (prev.type === "number" && type === "number") ||
              (prev.type === "text" && type === "text") ||
              (prev.type === "date" && type === "date");
            if (!compatible) {
              global.alert(
                `Changing "${label}" from ${prev.type} to ${type} may make saved values incompatible. Existing values are kept as stored and will display according to the new type.`
              );
            }
          }
          next.push({
            id,
            label,
            type,
            required: row.querySelector(".vxp-m-required").checked,
            options: [...row.querySelectorAll(".vxp-m-options")]
              .map((el) => el.value)
              .join("\n")
              .split("\n")
              .map((s) => s.trim())
              .filter(Boolean),
            visible: prev.visible !== false,
          });
        });
        const saveButton = mask.querySelector("#vxp-m-save");
        saveButton.disabled = true;
        saveFields(moduleKey, next).then(() => {
          close();
          if (typeof onDone === "function") onDone(next);
        }).catch((error) => {
          if (saveButton.isConnected) saveButton.disabled = false;
          global.alert("Custom fields were not saved: " + error.message);
        });
      }
    });
  }

  /* ------------------------------------------------------------------ */
  /* Export                                                              */
  /* ------------------------------------------------------------------ */

  global.VyaparXFields = {
    ICON_PATHS,
    iconSvg,
    iconActions,
    FIELD_TYPES,
    loadFields,
    saveFields,
    openAddColumn,
    openManageColumns,
    columnButton,
    tableColumns,
    tableRow,
    formFieldsHtml,
    readFormValues,
    validateForm,
    applyToRecord,
    applyFromRecord,
    fieldsFor,
    customFieldSummary,
  };
})(typeof window !== "undefined" ? window : globalThis);
