export default async function run(page, ui) {
  await page.evaluate(() => {
    sessionStorage.setItem("vyparx_secure_session", JSON.stringify({
      id: "u1", userId: "u1", fullName: "QA Tester", email: "qa@example.com",
      role: "Admin", department: "Administration",
      companyId: "c1", companyName: "QA Test Polymers", status: "ACTIVE",
      loggedInAt: new Date().toISOString(),
    }));
  });
  await page.goto("http://localhost:8000/html/admin.html");
  await page.waitForTimeout(4000);
  const dash = await page.evaluate(() => ({
    kpis: document.querySelectorAll(".dash-kpi").length,
    panels: document.querySelectorAll(".dash-panel").length,
    quotes: (typeof window.ADMIN_QUOTES !== "undefined") ? window.ADMIN_QUOTES.length : "n/a",
  }));
  // Click the sidebar Product Catalog nav button.
  await page.evaluate(() => document.querySelector('[data-go="catalog"]')?.click());
  await page.waitForTimeout(1500);
  const catalog = await page.evaluate(() => ({
    print: !!document.querySelector('[data-act="catprint"]'),
    fields: !!document.querySelector('[data-act="catfields"]'),
    add: !!document.querySelector('[data-act="catadd"]'),
    rows: document.querySelectorAll("#mn table tbody tr").length,
  }));
  // Open the Manage Fields dialog and save one custom field.
  await page.evaluate(() => document.querySelector('[data-act="catfields"]')?.click());
  await page.waitForTimeout(600);
  const dialog = await page.evaluate(() => ({
    open: !!document.querySelector(".vxp-fields-mask"),
    hasAdd: !!document.querySelector("[data-fadd]"),
    hasSave: !!document.querySelector("[data-fsave]"),
  }));
  if (dialog.open) {
    await page.evaluate(() => document.querySelector("[data-fadd]")?.click());
    await page.waitForTimeout(200);
    await page.evaluate(() => {
      const label = document.querySelector(".vxp-f-label");
      if (label) label.value = "QA Colour";
    });
    await page.evaluate(() => document.querySelector("[data-fsave]")?.click());
    await page.waitForTimeout(1200);
  }
  const saved = await page.evaluate(() => ({
    dialogClosed: !document.querySelector(".vxp-fields-mask"),
    fields: window.VyaparXCatalog ? window.VyaparXCatalog.customFields().map((f) => f.label) : [],
  }));
  return { dash, catalog, dialog, saved };
}
