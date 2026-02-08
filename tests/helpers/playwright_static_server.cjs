const fs = require('node:fs');
const http = require('node:http');
const path = require('node:path');

function mimeTypeFor(filePath) {
  const ext = path.extname(filePath).toLowerCase();
  if (ext === '.html') return 'text/html; charset=utf-8';
  if (ext === '.js' || ext === '.mjs') return 'application/javascript; charset=utf-8';
  if (ext === '.css') return 'text/css; charset=utf-8';
  if (ext === '.json') return 'application/json; charset=utf-8';
  if (ext === '.png') return 'image/png';
  if (ext === '.pdf') return 'application/pdf';
  if (ext === '.svg') return 'image/svg+xml';
  if (ext === '.woff2') return 'font/woff2';
  if (ext === '.woff') return 'font/woff';
  if (ext === '.txt') return 'text/plain; charset=utf-8';
  return 'application/octet-stream';
}

function isWithinRoot(rootDir, filePath) {
  const rel = path.relative(rootDir, filePath);
  return rel === '' || (!rel.startsWith('..') && !path.isAbsolute(rel));
}

function startStaticServer(rootDir) {
  const server = http.createServer((req, res) => {
    try {
      const url = new URL(req.url || '/', 'http://127.0.0.1');
      const pathname = decodeURIComponent(url.pathname);
      const rel = pathname === '/' ? '/latex_lab.html' : pathname;
      const filePath = path.resolve(rootDir, `.${rel}`);

      if (!isWithinRoot(rootDir, filePath)) {
        res.writeHead(403, { 'content-type': 'text/plain; charset=utf-8' });
        res.end('Forbidden');
        return;
      }
      if (!fs.existsSync(filePath) || fs.statSync(filePath).isDirectory()) {
        res.writeHead(404, { 'content-type': 'text/plain; charset=utf-8' });
        res.end('Not Found');
        return;
      }

      res.writeHead(200, {
        'content-type': mimeTypeFor(filePath),
        'cache-control': 'no-cache, no-store, must-revalidate'
      });
      fs.createReadStream(filePath).pipe(res);
    } catch (err) {
      res.writeHead(500, { 'content-type': 'text/plain; charset=utf-8' });
      res.end(String(err && err.message ? err.message : err));
    }
  });

  return new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const addr = server.address();
      resolve({
        server,
        origin: `http://127.0.0.1:${addr.port}`
      });
    });
  });
}

async function closeServer(server) {
  if (!server) return;
  await new Promise((resolve) => {
    server.close(() => resolve());
  });
}

module.exports = {
  mimeTypeFor,
  startStaticServer,
  closeServer
};
