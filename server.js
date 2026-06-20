const http = require('http');
const fs = require('fs');
const path = require('path');
const os = require('os');
const crypto = require('crypto');

const PORT = parseInt(process.env.PORT, 10) || 3000;
const PUBLIC = path.join(__dirname, 'public');
const UPLOADS = path.join(__dirname, 'uploads');

if (!fs.existsSync(UPLOADS)) {
  fs.mkdirSync(UPLOADS);
}

function getLanIp() {
  const ifaces = os.networkInterfaces();
  for (const name of Object.keys(ifaces)) {
    for (const iface of ifaces[name]) {
      if (iface.family === 'IPv4' && !iface.internal) {
        return iface.address;
      }
    }
  }
  return 'localhost';
}

const LAN_IP = getLanIp();

function getServerUrl(port) {
  return 'http://' + LAN_IP + ':' + port;
}

let SERVER_URL = getServerUrl(PORT);

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
};

setInterval(() => {
  const now = Date.now();
  fs.readdir(UPLOADS, (err, files) => {
    if (err) return;
    for (const file of files) {
      const fp = path.join(UPLOADS, file);
      fs.stat(fp, (err, stat) => {
        if (err) return;
        if (now - stat.mtimeMs > 10 * 60 * 1000) {
          fs.unlink(fp, () => {});
        }
      });
    }
  });
}, 10 * 60 * 1000);

function tryListen(server, port) {
  server.listen(port, '0.0.0.0', () => {
    SERVER_URL = getServerUrl(port);
    console.log(SERVER_URL);
  }).on('error', (err) => {
    if (err.code === 'EADDRINUSE') {
      tryListen(server, port + 1);
    } else {
      console.error('Server error:', err);
    }
  });
}

const server = http.createServer((req, res) => {
  const url = req.url.split('?')[0];

  if (url === '/upload' && req.method === 'POST') {
    let body = '';
    req.on('data', c => body += c);
    req.on('end', () => {
      try {
        const info = JSON.parse(body);
        const buf = Buffer.from(info.data, 'base64');
        const id = Date.now().toString(36) + crypto.randomUUID().slice(0, 4);
        const ext = path.extname(info.name) || '';
        const fname = id + ext;
        const fpath = path.join(UPLOADS, fname);

        fs.writeFile(fpath, buf, (err) => {
          if (err) {
            res.writeHead(500);
            res.end('Write failed');
            return;
          }
          const cleanName = info.name.replace(/"/g, '');
          const dlUrl = SERVER_URL + '/dl/' + fname + '/' + encodeURIComponent(cleanName);
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ url: dlUrl, name: cleanName, size: info.size }));
        });
      } catch (e) {
        res.writeHead(400);
        res.end('Invalid upload');
      }
    });
    return;
  }

  if (url.startsWith('/dl/')) {
    const parts = url.split('/');
    const fname = parts[2];
    const fpath = path.join(UPLOADS, fname);

    if (!fpath.startsWith(UPLOADS)) {
      res.writeHead(403);
      res.end();
      return;
    }

    fs.stat(fpath, (err, stat) => {
      if (err) {
        res.writeHead(404);
        res.end('File not found or expired');
        return;
      }
      const displayName = decodeURIComponent(parts.slice(3).join('/') || fname);
      res.writeHead(200, {
        'Content-Type': 'application/octet-stream',
        'Content-Disposition': 'attachment; filename="' + displayName + '"',
        'Content-Length': stat.size,
      });
      fs.createReadStream(fpath).pipe(res);
    });
    return;
  }

  let filePath = url === '/' ? '/index.html' : url;
  const fullPath = path.join(PUBLIC, filePath);
  if (!fullPath.startsWith(PUBLIC)) {
    res.writeHead(403);
    return res.end();
  }

  fs.readFile(fullPath, (err, data) => {
    if (err) {
      res.writeHead(404);
      res.end();
      return;
    }
    const ext = path.extname(filePath);
    if (ext === '.html') {
      data = data.toString().replace('__SERVER_URL__', SERVER_URL);
    }
    res.writeHead(200, { 'Content-Type': MIME[ext] || 'application/octet-stream' });
    res.end(data);
  });
});

tryListen(server, PORT);
