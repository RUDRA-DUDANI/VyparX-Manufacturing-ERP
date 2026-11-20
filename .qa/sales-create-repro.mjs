// Throwaway reproduction: drives the real Sales page with stubbed auth and
// route-level API mocks, fills the Create Sales Order form, saves, and reports
// the exact error the UI shows.
export default async function run(page) {
  const stub = "window.firebase={apps:[],initializeApp(){},auth:Object.assign(()=>({currentUser:{getIdToken:async()=>'qa'},setPersistence:async()=>{},onAuthStateChanged:()=>()=>{},signOut:async()=>{}}),{Auth:{Persistence:{SESSION:'s',LOCAL:'l',NONE:'n'}}})};";
  const state = { posted: null, toasts: [] };

  await page.route(/\/__qa-fb\.js$/, (r) => r.fulfill({ status: 200, contentType: "application/javascript", body: stub }));
  await page.route(/\/html\/sales\.html$/, async (r) => {
    const res = await r.fetch();
    const html = (await res.text()).replace("<head>", '<head><script src="/__qa-fb.js"></script>');
    await r.fulfill({ response: res, body: html });
  });
  await page.route(/\/api\/auth\/firebase-config/, (r) => r.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ configured: true, config: { apiKey: "q", authDomain: "q", projectId: "q", appId: "q" } }) }));
  await page.route(/\/api\/auth\/me/, (r) => r.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ user: { id: "qa", role: "Sales", fullName: "QA Sales", email: "qa@example.com", companyId: "c1", companyName: "QA Co", status: "ACTIVE" } }) }));
  await page.route(/\/api\/modules\/([a-z]+)\/data/, async (r) => {
    // Only intercept API calls; never an HTML document that happens to match.
    const resourceType = r.request().resourceType();
    if (resourceType !== "xhr" && resourceType !== "fetch") return r.continue();
    const url = r.request().url();
    const module = url.match(/\/api\/modules\/([a-z]+)\/data/)[1];
    const method = r.request().method();
    const body = r.request().postDataJSON?.() || {};
    if (method === "POST") state.posted = { module, body };
    const records = module === "crm"
      ? [{ id: "cust-1", recordType: "lead", type: "Customer", name: "Alpha Traders", contact: "9876500001", email: "a@example.com" }]
      : module === "catalog"
        ? [{ id: "prod-pp", recordType: "product", name: "PP", code: "PP", unit: "kg", rate: 100, gst: 18, isActive: true }]
        : module === "sales" ? [] : [];
    return r.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ success: true, record: body, records }) });
  });

  // The driver owns the first navigation; use the page's own navigation so the
  // session set below survives into the Sales page.
  await page.route(/\/html\/landing\.html$/, async (r) => {
    const res = await r.fetch();
    const html = (await res.text()).replace(
      "<head>",
      `<head><script>sessionStorage.setItem("vyparx_secure_session", ${JSON.stringify(JSON.stringify({ id: "qa", role: "Sales", fullName: "QA Sales", email: "qa@example.com", companyId: "c1", companyName: "QA Co", status: "ACTIVE" }))});</script>`,
    );
    await r.fulfill({ response: res, body: html });
  });
  await page.goto("http://localhost:3000/html/landing.html");
  await page.evaluate(() => { window.location.href = "/html/sales.html?view=orders&action=create"; });
  await page.waitForSelector("#oc", { timeout: 20000 });
  await page.selectOption("#oc", { index: 1 });
  await page.fill("#od", "2026-10-19");
  await page.fill("#odd", "2026-10-25");
  await page.fill("#oa", "10");
  await page.evaluate(() => {
    const sel = document.querySelector("#ii0");
    if (sel) sel.value = sel.options[1].value;
    document.querySelector("#iq0").value = "5";
    document.querySelector("#ir0").value = "100";
  });
  await page.click("[data-ok]");
  await page.waitForTimeout(1500);
  return {
    toast: await page.evaluate(() => document.querySelector("#toast")?.textContent || ""),
    posted: state.posted,
    dialogOpen: await page.evaluate(() => Boolean(document.querySelector(".mask"))),
  };
}
