import { createReadStream } from 'node:fs';
import { realpath, stat } from 'node:fs/promises';
import path from 'node:path';
import { pipeline } from 'node:stream/promises';

const types = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8', '.json': 'application/json; charset=utf-8',
  '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg',
  '.svg': 'image/svg+xml', '.ico': 'image/x-icon', '.webp': 'image/webp',
  '.woff': 'font/woff', '.woff2': 'font/woff2', '.txt': 'text/plain; charset=utf-8',
};
const inside = (root, target) => {
  const relative = path.relative(root, target);
  return Boolean(relative) && relative !== '..' && !relative.startsWith('..' + path.sep) && !path.isAbsolute(relative);
};

// Only dist is public. Never serve the checkout, private storage or /api via SPA fallback.
export function createStaticSite(directory) {
  const root = path.resolve(directory);
  return async function serve(req, res, url) {
    if (url.pathname === '/api' || url.pathname.startsWith('/api/')) return false;
    const error = (status, message) => {
      res.writeHead(status, { 'Content-Type': 'text/plain; charset=utf-8', 'Cache-Control': 'no-store' });
      res.end(req.method === 'HEAD' ? undefined : message);
      return true;
    };
    if (!['GET', 'HEAD'].includes(req.method)) {
      res.setHeader('Allow', 'GET, HEAD');
      return error(405, 'Method not allowed.');
    }
    let pathname;
    try { pathname = decodeURIComponent(url.pathname); }
    catch { return error(400, 'Invalid URL.'); }
    if (/[\\\0]/.test(pathname) || pathname.split('/').some(part => part.startsWith('.')))
      return error(404, 'Not found.');
    let file = path.resolve(root, '.' + pathname);
    if (file !== root && !inside(root, file)) return error(404, 'Not found.');
    if (!(await stat(file).catch(() => null))?.isFile()) {
      if (path.extname(pathname) || pathname.startsWith('/assets/')) return error(404, 'Not found.');
      file = path.join(root, 'index.html');
    }
    const actual = await realpath(file).catch(() => null);
    const canonicalRoot = await realpath(root).catch(() => null);
    if (!actual || !canonicalRoot || !inside(canonicalRoot, actual)) return error(404, 'Not found.');
    const info = await stat(actual);
    res.writeHead(200, {
      'Content-Type': types[path.extname(actual).toLowerCase()] || 'application/octet-stream',
      'Content-Length': info.size,
      'Cache-Control': pathname.startsWith('/assets/') ? 'public, max-age=31536000, immutable' : 'no-cache',
      'X-Content-Type-Options': 'nosniff', 'X-Frame-Options': 'DENY', 'Referrer-Policy': 'no-referrer',
    });
    if (req.method === 'HEAD') res.end();
    else await pipeline(createReadStream(actual), res);
    return true;
  };
}
