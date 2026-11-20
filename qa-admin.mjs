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
  const base = await page.evaluate(() => ({
    shared: !!window.VyaparXShared,
    theme: document.documentElement.dataset.theme,
  }));
  await page.click("#th");
  await page.waitForTimeout(200);
  const after = await page.evaluate(() => ({
    theme: document.documentElement.dataset.theme,
    stored: localStorage.getItem("vyparx_theme"),
    aria: document.getElementById("th").getAttribute("aria-label"),
  }));
  await page.reload();
  await page.waitForTimeout(3000);
  const persisted = await page.evaluate(() => document.documentElement.dataset.theme);
  await page.evaluate(() => window.VyaparXShared && window.VyaparXShared.applyTheme("light"));
  await page.click('[data-go="reports"]');
  await page.waitForTimeout(500);
  const reports = await page.evaluate(() => {
    const types = [...((document.querySelector('[data-r="t"]') || { options: [] }).options)].map((o) => o.textContent);
    const statuses = [...((document.querySelector('[data-r="s"]') || { options: [] }).options)].map((o) => o.textContent);
    return { types, statuses };
  });
  await page.selectOption('[data-r="m"]', "Inventory");
  await page.waitForTimeout(400);
  const inv = await page.evaluate(() => ({
    types: [...((document.querySelector('[data-r="t"]') || { options: [] }).options)].map((o) => o.textContent),
    statuses: [...((document.querySelector('[data-r="s"]') || { options: [] }).options)].map((o) => o.textContent),
  }));
  await page.click("#pb");
  await page.waitForTimeout(200);
  await page.click('[data-act="pm:set"]');
  await page.waitForTimeout(500);
  const profile = await page.evaluate(() => ({
    gstin: !!document.getElementById("cf_gstin"),
    company: (document.getElementById("cf_name") || {}).value,
  }));
  return { base, after, persisted, reports, inv, profile };
}
