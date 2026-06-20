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
  var ifaces = os.networkInterfaces();
  for (var name in ifaces) {
    for (var i = 0; i < ifaces[name].length; i++) {
      var iface = ifaces[name][i];
      if (iface.family === 'IPv4' && !iface.internal) {
        return iface.address;
      }
    }
  }
  return 'localhost';
}

var LAN_IP = getLanIp();
var SERVER_URL = 'http://' + LAN_IP + ':' + PORT;

var MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8'
};

// Clean up old uploads every 10 minutes
function cleanUploads() {
  var now = Date.now();
  fs.readdir(UPLOADS, function (err, files) {
    if (err) return;
    files.forEach(function (file) {
      var fp = path.join(UPLOADS, file);
      fs.stat(fp, function (err, stat) {
        if (err) return;
        if (now - stat.mtimeMs > 10 * 60 * 1000) {
          fs.unlink(fp, function () {});
        }
      });
    });
  });
}
setInterval(cleanUploads, 10 * 60 * 1000);

http.createServer(function (req, res) {
  var url = req.url.split('?')[0];

  // POST /upload — receive file as JSON { name, data }
  if (url === '/upload' && req.method === 'POST') {
    var body = '';
    req.on('data', function (c) { body += c; });
    req.on('end', function () {
      try {
        var info = JSON.parse(body);
        var buf = Buffer.from(info.data, 'base64');
        var id = Date.now().toString(36) + crypto.randomUUID().slice(0, 4);
        var ext = path.extname(info.name) || '';
        var fname = id + ext;
        var fpath = path.join(UPLOADS, fname);

        fs.writeFile(fpath, buf, function (err) {
          if (err) {
            res.writeHead(500);
            res.end('Write failed');
            return;
          }
          var dlUrl = SERVER_URL + '/dl/' + fname + '/' + encodeURIComponent(info.name);
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ url: dlUrl, name: info.name, size: info.size }));
        });
      } catch (e) {
        res.writeHead(400);
        res.end('Invalid upload');
      }
    });
    return;
  }

  // GET /dl/:id/:name — serve file for download
  if (url.startsWith('/dl/')) {
    var parts = url.split('/');
    var fname = parts[2];
    var fpath = path.join(UPLOADS, fname);

    if (!fpath.startsWith(UPLOADS)) {
      res.writeHead(403);
      res.end();
      return;
    }

    fs.stat(fpath, function (err, stat) {
      if (err) {
        res.writeHead(404);
        res.end('File not found');
        return;
      }
      var displayName = decodeURIComponent(parts.slice(3).join('/') || fname);
      res.writeHead(200, {
        'Content-Type': 'application/octet-stream',
        'Content-Disposition': 'attachment; filename="' + displayName + '"',
        'Content-Length': stat.size
      });
      fs.createReadStream(fpath).pipe(res);
    });
    return;
  }

  // Serve static files
  var filePath = url === '/' ? '/index.html' : url;
  var fullPath = path.join(PUBLIC, filePath);
  if (!fullPath.startsWith(PUBLIC)) {
    res.writeHead(403);
    return res.end();
  }

  fs.readFile(fullPath, function (err, data) {
    if (err) {
      res.writeHead(404);
      res.end();
      return;
    }
    var ext = path.extname(filePath);
    if (ext === '.html') {
      data = data.toString().replace('</head>',
        '<script>window.SERVER_URL="' + SERVER_URL + '";</script></head>');
    }
    res.writeHead(200, { 'Content-Type': MIME[ext] || 'application/octet-stream' });
    res.end(data);
  });
}).on('listening', function () {
  SERVER_URL = 'http://' + LAN_IP + ':' + this.address().port;
  console.log(SERVER_URL);
}).on('error', function (err) {
  if (err.code === 'EADDRINUSE') {
    var newPort = this.address().port + 1;
    console.log('Port ' + (newPort - 1) + ' busy, trying ' + newPort);
    this.listen(newPort, '0.0.0.0');
  } else {
    throw err;
  }
}).listen(PORT, '0.0.0.0');
