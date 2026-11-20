/**
 * VyaparX ERP - legacy static compatibility server.
 *
 * Authentication and authorization now live in the Django REST backend in this
 * directory. This file intentionally does not implement login, registration,
 * users, roles, sessions, or password handling.
 */

const http = require("http");
const fs = require("fs");
const path = require("path");

const PORT = process.env.PORT || 3000;
const FRONTEND_DIR = path.join(__dirname, "..", "frontend");

const MIME_TYPES = {
  ".html": "text/html",
  ".css": "text/css",
  ".js": "application/javascript",
  ".json": "application/json",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".svg": "image/svg+xml",
};

function sendJson(res, statusCode, data) {
  res.writeHead(statusCode, {
    "Content-Type": "application/json",
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "GET, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type, Authorization",
  });
  res.end(JSON.stringify(data));
}

const server = http.createServer((req, res) => {
  const parsedUrl = new URL(req.url, `http://${req.headers.host || "localhost"}`);
  const pathname = parsedUrl.pathname;

  if (req.method === "OPTIONS") {
    res.writeHead(204, {
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": "GET, OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type, Authorization",
    });
    res.end();
    return;
  }

  if (pathname.startsWith("/api/")) {
    sendJson(res, 410, {
      error: "Legacy Node auth API is disabled. Run the Django backend with `python manage.py runserver`.",
    });
    return;
  }

  let filePath = path.join(FRONTEND_DIR, pathname);
  if (pathname === "/" || pathname === "/html/" || pathname === "/html") {
    filePath = path.join(FRONTEND_DIR, "html", "landing.html");
  } else if (!path.extname(pathname)) {
    filePath = path.join(FRONTEND_DIR, "html", `${pathname}.html`);
  }

  fs.stat(filePath, (err, stats) => {
    if (err || !stats.isFile()) {
      res.writeHead(404, { "Content-Type": "text/plain" });
      res.end("404 Not Found");
      return;
    }

    const ext = path.extname(filePath).toLowerCase();
    const contentType = MIME_TYPES[ext] || "application/octet-stream";
    res.writeHead(200, { "Content-Type": contentType });
    fs.createReadStream(filePath).pipe(res);
  });
});

if (require.main === module) {
  server.listen(PORT, () => {
    console.log(`VyaparX static compatibility server running on http://localhost:${PORT}`);
    console.log("Use the Django backend for /api routes.");
  });
}

module.exports = { server };
