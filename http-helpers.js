// Tiny zero-dependency HTTP router + static file server, so this app has
// NO npm dependencies at all (nothing to `npm install`, nothing that can
// fail to fetch from the registry).
const fs = require('fs');
const path = require('path');

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
};

function compilePattern(pattern) {
  const paramNames = [];
  const regexStr = pattern
    .split('/')
    .map((segment) => {
      if (segment.startsWith(':')) {
        paramNames.push(segment.slice(1));
        return '([^/]+)';
      }
      return segment.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    })
    .join('/');
  return { regex: new RegExp(`^${regexStr}$`), paramNames };
}

function createRouter() {
  const routes = [];
  const add = (method) => (pattern, handler) => {
    routes.push({ method, ...compilePattern(pattern), handler });
  };
  return {
    get: add('GET'),
    post: add('POST'),
    patch: add('PATCH'),
    delete: add('DELETE'),
    match(method, pathname) {
      for (const r of routes) {
        if (r.method !== method) continue;
        const m = r.regex.exec(pathname);
        if (m) {
          const params = {};
          r.paramNames.forEach((name, i) => { params[name] = decodeURIComponent(m[i + 1]); });
          return { handler: r.handler, params };
        }
      }
      return null;
    },
  };
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let raw = '';
    req.on('data', (chunk) => { raw += chunk; });
    req.on('end', () => {
      if (!raw) return resolve({});
      try { resolve(JSON.parse(raw)); } catch (e) { reject(e); }
    });
    req.on('error', reject);
  });
}

function serveStatic(publicDir) {
  return function (req, res, pathname) {
    let rel = pathname === '/' ? '/index.html' : pathname;
    const filePath = path.join(publicDir, rel);
    if (!filePath.startsWith(publicDir)) { res.writeHead(403); res.end('forbidden'); return true; }
    if (!fs.existsSync(filePath) || fs.statSync(filePath).isDirectory()) return false;
    const ext = path.extname(filePath);
    res.writeHead(200, { 'content-type': MIME[ext] || 'application/octet-stream' });
    fs.createReadStream(filePath).pipe(res);
    return true;
  };
}

module.exports = { createRouter, readBody, serveStatic };
