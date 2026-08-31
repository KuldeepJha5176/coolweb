// Minimal static file server with HTTP Range support (needed so the browser can
// stream/seek the mp4). No dependencies — plain Node http + fs.
const http = require('http');
const fs = require('fs');
const path = require('path');

const ROOT = __dirname;
const PORT = process.env.PORT || 5173;

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.mp4': 'video/mp4',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.svg': 'image/svg+xml',
  '.json': 'application/json',
};

http.createServer((req, res) => {
  try {
    const urlPath = decodeURIComponent(req.url.split('?')[0]);
    let rel = urlPath === '/' ? '/index.html' : urlPath;
    const filePath = path.join(ROOT, path.normalize(rel));

    // Prevent path traversal outside ROOT.
    if (!filePath.startsWith(ROOT)) {
      res.writeHead(403).end('Forbidden');
      return;
    }

    fs.stat(filePath, (err, stat) => {
      if (err || !stat.isFile()) {
        res.writeHead(404).end('Not found');
        return;
      }

      const type = MIME[path.extname(filePath).toLowerCase()] || 'application/octet-stream';
      const range = req.headers.range;

      if (range) {
        const m = /bytes=(\d*)-(\d*)/.exec(range);
        let start = m && m[1] ? parseInt(m[1], 10) : 0;
        let end = m && m[2] ? parseInt(m[2], 10) : stat.size - 1;
        if (isNaN(start)) start = 0;
        if (isNaN(end) || end >= stat.size) end = stat.size - 1;
        if (start > end) { start = 0; end = stat.size - 1; }

        res.writeHead(206, {
          'Content-Range': `bytes ${start}-${end}/${stat.size}`,
          'Accept-Ranges': 'bytes',
          'Content-Length': end - start + 1,
          'Content-Type': type,
        });
        fs.createReadStream(filePath, { start, end }).pipe(res);
      } else {
        res.writeHead(200, {
          'Content-Length': stat.size,
          'Content-Type': type,
          'Accept-Ranges': 'bytes',
          'Cache-Control': 'no-cache',
        });
        fs.createReadStream(filePath).pipe(res);
      }
    });
  } catch (e) {
    res.writeHead(500).end('Server error');
  }
}).listen(PORT, () => {
  console.log(`serving ${ROOT} on http://localhost:${PORT}`);
});
