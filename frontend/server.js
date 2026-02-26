import { createServer } from 'http';
import { createReadStream, existsSync, statSync } from 'fs';
import { extname, join, normalize, resolve } from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = resolve(__filename, '..');
const distRoot = join(__dirname, 'dist');
const port = Number(process.env.PORT || 5174);
const host = process.env.HOST || '0.0.0.0';

const contentTypes = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.mjs': 'application/javascript; charset=utf-8',
  '.wasm': 'application/wasm',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.ico': 'image/x-icon',
  '.txt': 'text/plain; charset=utf-8',
};

function setCommonHeaders(res) {
  // Keep static responses lean; strict cross-origin isolation blocks Sandpack iframe rendering.
}

function resolveRequestFilePath(urlPath) {
  const decoded = decodeURIComponent(urlPath.split('?')[0]);
  const normalized = normalize(decoded).replace(/^(\.\.(\/|\\|$))+/, '');
  const requested = normalized === '/' ? '/index.html' : normalized;
  const fullPath = join(distRoot, requested);
  const safePath = resolve(fullPath);
  if (!safePath.startsWith(resolve(distRoot))) {
    return null;
  }
  return safePath;
}

function serveFile(res, absolutePath) {
  const ext = extname(absolutePath).toLowerCase();
  const contentType = contentTypes[ext] || 'application/octet-stream';
  setCommonHeaders(res);
  res.setHeader('Content-Type', contentType);

  const stream = createReadStream(absolutePath);
  stream.on('error', () => {
    res.statusCode = 500;
    res.end('Internal Server Error');
  });
  stream.pipe(res);
}

const server = createServer((req, res) => {
  const urlPath = req.url || '/';
  const filePath = resolveRequestFilePath(urlPath);
  if (!filePath) {
    setCommonHeaders(res);
    res.statusCode = 403;
    res.end('Forbidden');
    return;
  }

  if (existsSync(filePath) && statSync(filePath).isFile()) {
    serveFile(res, filePath);
    return;
  }

  const fallback = join(distRoot, 'index.html');
  if (existsSync(fallback)) {
    serveFile(res, fallback);
    return;
  }

  setCommonHeaders(res);
  res.statusCode = 404;
  res.end('Not Found');
});

server.listen(port, host, () => {
  console.log(`Frontend static server running at http://${host}:${port}`);
});
