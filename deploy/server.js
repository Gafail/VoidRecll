#!/usr/bin/env node
/**
 * Static file server for the LXC host.
 *
 * The app itself is a static site - no server-side logic, no database, all
 * progress lives in the browser's localStorage. This exists only because the
 * host runs every app as a Node process behind nginx, bound to 127.0.0.1.
 *
 * It serves the files sitting next to it, which is the deployed build
 * (npm run build) copied into /srv/apps/voidrecll/current.
 *
 *   PORT   the port to listen on (default 8080)
 *   HOST   the address to bind (default 127.0.0.1 - loopback only, so the
 *          app is reachable through nginx and never directly)
 */

const http = require("http");
const fs = require("fs");
const path = require("path");

const PORT = Number(process.env.PORT || 8080);
const HOST = process.env.HOST || "127.0.0.1";
const ROOT = __dirname;

const TYPES = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".webmanifest": "application/manifest+json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".ico": "image/x-icon",
  ".woff2": "font/woff2",
  ".txt": "text/plain; charset=utf-8",
};

// These change with every deploy, so the browser must revalidate them rather
// than serve a stale copy. Everything else is content-addressed by deploy
// date and can sit in the cache a little longer.
const REVALIDATE = new Set([".html", ".js", ".css", ".json", ".webmanifest"]);

function contentType(ext) {
  return TYPES[ext] || "application/octet-stream";
}

/** Resolves a request path to a file inside ROOT, or null if it escapes. */
function resolveFile(pathname) {
  let decoded;
  try {
    decoded = decodeURIComponent(pathname);
  } catch {
    return null;
  }

  const rel = path
    .normalize(decoded)
    .replace(/^(\.\.[/\\])+/, "")
    .replace(/^[/\\]+/, "");

  const full = path.join(ROOT, rel);
  // Belt and braces: the normalised path must still be inside ROOT.
  if (full !== ROOT && !full.startsWith(ROOT + path.sep)) return null;
  return full;
}

function send(res, status, body, headers = {}) {
  res.writeHead(status, { "Content-Type": "text/plain; charset=utf-8", ...headers });
  res.end(body);
}

const server = http.createServer((req, res) => {
  if (req.method !== "GET" && req.method !== "HEAD") {
    send(res, 405, "Method Not Allowed", { Allow: "GET, HEAD" });
    return;
  }

  // WHATWG URL rather than the deprecated url.parse().
  const pathname = new URL(req.url, `http://${req.headers.host || "localhost"}`).pathname;
  let file = resolveFile(pathname);

  if (!file) {
    send(res, 400, "Bad Request");
    return;
  }

  // A directory request falls back to its index.html.
  if (pathname.endsWith("/")) {
    file = path.join(file, "index.html");
  }

  fs.stat(file, (err, stat) => {
    if (err || !stat.isFile()) {
      send(res, 404, "Not Found");
      return;
    }

    const ext = path.extname(file).toLowerCase();
    const etag = `W/"${stat.size.toString(16)}-${stat.mtimeMs.toString(16)}"`;

    const headers = {
      "Content-Type": contentType(ext),
      ETag: etag,
      "Last-Modified": stat.mtime.toUTCString(),
      "Cache-Control": REVALIDATE.has(ext)
        ? "no-cache"
        : "public, max-age=3600",
      "X-Content-Type-Options": "nosniff",
    };

    // The service worker must be allowed to control the whole origin.
    if (path.basename(file) === "sw.js") {
      headers["Service-Worker-Allowed"] = "/";
    }

    if (req.headers["if-none-match"] === etag) {
      res.writeHead(304, headers);
      res.end();
      return;
    }

    headers["Content-Length"] = stat.size;
    res.writeHead(200, headers);

    if (req.method === "HEAD") {
      res.end();
      return;
    }

    const stream = fs.createReadStream(file);
    stream.on("error", () => res.destroy());
    stream.pipe(res);
  });
});

server.listen(PORT, HOST, () => {
  console.log(`VoidRecll serving ${ROOT} on http://${HOST}:${PORT}`);
});

// The systemd template stops the app with SIGTERM and waits for a graceful
// exit, so close the listener rather than dropping live connections.
for (const signal of ["SIGTERM", "SIGINT"]) {
  process.on(signal, () => {
    server.close(() => process.exit(0));
    // Do not hang forever on a stuck keep-alive connection.
    setTimeout(() => process.exit(0), 5000).unref();
  });
}
