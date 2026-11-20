export default async function run(page, ui) {
  const consoleMsgs = [];
  page.on("console", (m) => consoleMsgs.push(m.type() + ": " + m.text().slice(0, 200)));
  await page.goto("http://localhost:8000/html/admin.html", { waitUntil: "networkidle" });
  await page.waitForTimeout(1500);
  return { consoleMsgs: consoleMsgs.slice(0, 20) };
}
