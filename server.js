#!/usr/bin/env node
'use strict';

/**
 * Zero-dependency static server + /v1/* reverse proxy for the MOSS API.
 * Official API (https://api.mosi.cn) does not allow browser CORS,
 * so this process both serves the test page and forwards API calls.
 *
 *   MOSS_API_KEY=... node server.js
 *
 * The key may also be sent by the page as Authorization: Bearer <key>.
 * This server never logs or writes the key, and never serves dotfiles.
 */

const http = require('http');
const https = require('https');
const fs = require('fs');
const path = require('path');
const { URL } = require('url');

const PORT = Number(process.env.PORT || 8787);
const HOST = process.env.HOST || '0.0.0.0';
const UPSTREAM = (process.env.MOSS_API_ORIGIN || 'https://api.mosi.cn').replace(/\/+$/, '');
const ROOT = __dirname;
const ENV_KEY = process.env.MOSS_API_KEY || '';

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.ico': 'image/x-icon',
  '.md': 'text/plain; charset=utf-8',
  '.map': 'application/json',
};

const HOP_BY_HOP = new Set([
  'connection',
  'keep-alive',
  'proxy-authenticate',
  'proxy-authorization',
  'te',
  'trailers',
  'transfer-encoding',
  'upgrade',
  'host',
]);

function send(res, status, headers, body) {
  res.writeHead(status, headers);
  res.end(body);
}

function corsHeaders(req) {
  const origin = req.headers.origin;
  return {
    'Access-Control-Allow-Origin': origin || '*',
    'Access-Control-Allow-Methods': 'GET,POST,PUT,PATCH,DELETE,OPTIONS',
    'Access-Control-Allow-Headers':
      req.headers['access-control-request-headers'] ||
      'Authorization,Content-Type,Accept',
    'Access-Control-Expose-Headers': 'Content-Type,X-Request-Id,X-Trace-Id',
    'Access-Control-Max-Age': '86400',
  };
}

function serveStatic(req, res, pathname) {
  if (pathname === '/') pathname = '/index.html';
  let rel;
  try {
    rel = decodeURIComponent(pathname);
  } catch {
    send(res, 400, { 'Content-Type': 'text/plain; charset=utf-8' }, 'Bad Request');
    return;
  }
  const file = path.normalize(path.join(ROOT, rel));
  if (!file.startsWith(ROOT + path.sep) && file !== ROOT) {
    send(res, 403, { 'Content-Type': 'text/plain; charset=utf-8' }, 'Forbidden');
    return;
  }
  const base = path.basename(file);
  if (base.startsWith('.') || base === 'node_modules') {
    send(res, 404, { 'Content-Type': 'text/plain; charset=utf-8' }, 'Not Found');
    return;
  }
  fs.stat(file, (err, st) => {
    if (err || !st.isFile()) {
      send(res, 404, { 'Content-Type': 'text/plain; charset=utf-8' }, 'Not Found');
      return;
    }
    const ext = path.extname(file).toLowerCase();
    const headers = {
      'Content-Type': MIME[ext] || 'application/octet-stream',
      'Cache-Control': 'no-cache',
    };
    if (req.method === 'HEAD') {
      res.writeHead(200, headers);
      res.end();
      return;
    }
    res.writeHead(200, headers);
    fs.createReadStream(file).pipe(res);
  });
}

function proxyV1(req, res) {
  const target = new URL(req.url, UPSTREAM + '/');
  if (!target.pathname.startsWith('/v1/')) {
    send(res, 404, { 'Content-Type': 'text/plain; charset=utf-8' }, 'Not Found');
    return;
  }

  const headers = {};
  for (const [k, v] of Object.entries(req.headers)) {
    if (HOP_BY_HOP.has(k.toLowerCase())) continue;
    headers[k] = v;
  }
  headers.host = target.host;

  const auth = headers.authorization || headers.Authorization;
  if (!auth && ENV_KEY) {
    headers.authorization = 'Bearer ' + ENV_KEY;
  }

  const isHttps = target.protocol === 'https:';
  const lib = isHttps ? https : http;
  const preq = lib.request(
    {
      protocol: target.protocol,
      hostname: target.hostname,
      port: target.port || (isHttps ? 443 : 80),
      path: target.pathname + target.search,
      method: req.method,
      headers,
      timeout: 15 * 60 * 1000,
    },
    (pres) => {
      const out = { ...corsHeaders(req) };
      for (const [k, v] of Object.entries(pres.headers)) {
        const key = k.toLowerCase();
        if (
          HOP_BY_HOP.has(key) ||
          key.startsWith('access-control-')
        ) {
          continue;
        }
        out[k] = v;
      }
      res.writeHead(pres.statusCode || 502, out);
      pres.pipe(res);
    }
  );

  preq.on('timeout', () => {
    preq.destroy(new Error('upstream timeout'));
  });
  preq.on('error', (err) => {
    if (!res.headersSent) {
      send(
        res,
        502,
        {
          'Content-Type': 'application/json; charset=utf-8',
          ...corsHeaders(req),
        },
        JSON.stringify({
          error: {
            message: '代理上游请求失败: ' + err.message,
            type: 'proxy_error',
          },
        })
      );
    } else {
      res.destroy();
    }
  });
  req.pipe(preq);
}

const server = http.createServer((req, res) => {
  let url;
  try {
    url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
  } catch {
    send(res, 400, { 'Content-Type': 'text/plain; charset=utf-8' }, 'Bad Request');
    return;
  }

  if (req.method === 'OPTIONS') {
    res.writeHead(204, corsHeaders(req));
    res.end();
    return;
  }

  if (url.pathname === '/health') {
    send(
      res,
      200,
      {
        'Content-Type': 'application/json; charset=utf-8',
        ...corsHeaders(req),
      },
      JSON.stringify({
        ok: true,
        upstream: UPSTREAM,
        hasEnvKey: Boolean(ENV_KEY),
      })
    );
    return;
  }

  if (url.pathname.startsWith('/v1/')) {
    proxyV1(req, res);
    return;
  }

  if (req.method !== 'GET' && req.method !== 'HEAD') {
    send(res, 405, { 'Content-Type': 'text/plain; charset=utf-8' }, 'Method Not Allowed');
    return;
  }

  serveStatic(req, res, url.pathname);
});

server.timeout = 16 * 60 * 1000;
server.listen(PORT, HOST, () => {
  const displayHost = HOST === '0.0.0.0' ? '127.0.0.1' : HOST;
  console.log(`MOSS 模型测试页: http://${displayHost}:${PORT}  (listen ${HOST}:${PORT})`);
  console.log(`上游 API: ${UPSTREAM}`);
  console.log(
    ENV_KEY
      ? '已从环境变量读取 MOSS_API_KEY（不会打印密钥）'
      : '未设置 MOSS_API_KEY，请在页面中填写'
  );
});
