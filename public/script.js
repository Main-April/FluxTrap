var ui = {};
var els = 'status,dropZone,fileInput,browseBtn,stepSelect,stepUpload,stepQR,stepDone,fileName,fileSize,progressWrap,progressFill,progressText,shareBtn,qrContainer,qrHint,dlLink,recvProgress,recvFill,recvText,recvCard,recvName,recvSize,recvDownload,shareAgain'.split(',');

els.forEach(function (k) { ui[k] = document.getElementById(k); });

function show(el) { el.classList.remove('hidden'); }
function hide(el) { el.classList.add('hidden'); }

function setStatus(text, type) {
  ui.status.className = 'msg msg-' + (type || 'info');
  ui.status.textContent = text;
  show(ui.status);
}

function fmtSize(b) {
  if (!b) return '0 B';
  var k = 1024, s = ['B', 'KB', 'MB', 'GB'];
  return parseFloat((b / Math.pow(k, Math.floor(Math.log(b) / Math.log(k)))).toFixed(1)) + ' ' + s[Math.floor(Math.log(b) / Math.log(k))];
}

function makeQR(text) {
  ui.qrContainer.innerHTML = '';
  new QRCode(ui.qrContainer, { text: text, width: 190, height: 190, colorDark: '#000', colorLight: '#fff', correctLevel: QRCode.CorrectLevel.M });
}

// ---- AES Encryption ----

async function encryptFile(file) {
  var key = await crypto.subtle.generateKey({ name: 'AES-GCM', length: 256 }, true, ['encrypt']);
  var rawKey = new Uint8Array(await crypto.subtle.exportKey('raw', key));
  var buf = await file.arrayBuffer();
  var iv = crypto.getRandomValues(new Uint8Array(12));
  var enc = await crypto.subtle.encrypt({ name: 'AES-GCM', iv: iv }, key, buf);
  var pkt = new Uint8Array(12 + enc.byteLength);
  pkt.set(iv, 0);
  pkt.set(new Uint8Array(enc), 12);
  return { encrypted: pkt, key: rawKey };
}

function keyToB64(key) {
  return btoa(String.fromCharCode.apply(null, key));
}

// ---- Sender ----

function selectFile(file) {
  if (file.size > 500 * 1024 * 1024) { alert('File too large (max 500 MB)'); return; }
  ui.fileName.textContent = file.name;
  ui.fileSize.textContent = fmtSize(file.size);
  hide(ui.stepSelect);
  show(ui.stepUpload);
  hide(ui.stepQR);
  hide(ui.stepDone);
  hide(ui.progressWrap);
  ui.shareBtn.textContent = 'Encrypt & Generate QR Code';
  ui.shareBtn.disabled = false;
  ui.shareBtn._file = file;
}

async function startUpload() {
  var file = ui.shareBtn._file;
  if (!file) return;
  ui.shareBtn.disabled = true;
  ui.shareBtn.textContent = 'Encrypting...';
  show(ui.progressWrap);
  ui.progressFill.style.width = '0%';
  ui.progressText.textContent = 'Encrypting...';
  hide(ui.status);

  try {
    var result = await encryptFile(file);
    var encrypted = result.encrypted;
    var keyB64 = keyToB64(result.key);
    var blob = new Blob([encrypted], { type: 'application/octet-stream' });

    ui.progressText.textContent = 'Uploading...';
    var fd = new FormData();
    fd.append('file', blob, file.name + '.enc');

    var xhr = new XMLHttpRequest();
    xhr.upload.onprogress = function (e) {
      if (e.lengthComputable) ui.progressFill.style.width = Math.min(90, e.loaded / e.total * 100) + '%';
    };
    xhr.onload = function () {
      try {
        var r = JSON.parse(xhr.responseText);
        if (r.status === 'success' && r.data && r.data.url) {
          var dlUrl = r.data.url.replace('tmpfiles.org/', 'tmpfiles.org/dl/');
          var base = location.origin + location.pathname.replace(/\/+$/, '');
          var qr = base + '#dl=' + encodeURIComponent(dlUrl) + '&key=' + encodeURIComponent(keyB64);
          ui.progressFill.style.width = '100%';
          ui.progressText.textContent = 'Done!';
          showQR(qr);
        } else { fail('Upload failed'); }
      } catch (e) { fail('Upload failed'); }
    };
    xhr.onerror = function () { fail('Network error'); };
    xhr.open('POST', 'https://tmpfiles.org/api/v1/upload');
    xhr.send(fd);
  } catch (e) { fail('Encryption error'); }

  function fail(msg) { setStatus(msg, 'err'); ui.shareBtn.disabled = false; ui.shareBtn.textContent = 'Try Again'; }
}

function showQR(qrContent) {
  hide(ui.stepUpload);
  hide(ui.progressWrap);
  show(ui.stepQR);
  makeQR(qrContent);
  ui.dlLink.href = qrContent;
  show(ui.dlLink);
  setStatus('File encrypted & uploaded. Share the QR code!', 'ok');
}

// ---- Receiver ----

function handleShare(hash) {
  var p = new URLSearchParams(hash.replace(/^#/, ''));
  var dlUrl = p.get('dl');
  var keyB64 = p.get('key');
  if (!dlUrl || !keyB64) return false;

  hide(ui.stepSelect);
  hide(ui.stepUpload);
  hide(ui.stepQR);
  show(ui.stepDone);
  hide(ui.recvCard);
  show(ui.recvProgress);
  ui.recvText.textContent = 'Downloading...';
  setStatus('Downloading encrypted file...', 'info');

  var key = new Uint8Array(atob(keyB64).split('').map(function (c) { return c.charCodeAt(0); }));

  fetch(dlUrl).then(function (r) {
    if (!r.ok) throw new Error('Download failed (' + r.status + ')');
    return r.arrayBuffer();
  }).then(async function (encBuf) {
    ui.recvFill.style.width = '50%';
    ui.recvText.textContent = 'Decrypting...';
    var iv = new Uint8Array(encBuf.slice(0, 12));
    var data = encBuf.slice(12);
    var ck = await crypto.subtle.importKey('raw', key, { name: 'AES-GCM', length: 256 }, false, ['decrypt']);
    var dec = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: iv }, ck, data);
    ui.recvFill.style.width = '100%';
    ui.recvText.textContent = 'Ready!';
    var blob = new Blob([dec]);
    var url = URL.createObjectURL(blob);
    ui.recvDownload.href = url;
    ui.recvDownload.download = 'received_file';
    ui.recvName.textContent = 'received_file';
    ui.recvSize.textContent = fmtSize(blob.size);
    hide(ui.recvProgress);
    show(ui.recvCard);
    setStatus('File decrypted! Tap Download to save.', 'ok');
  }).catch(function (e) {
    ui.recvText.textContent = 'Failed';
    setStatus('Error: ' + e.message, 'err');
  });

  return true;
}

// ---- Init ----

(function () {
  if (!handleShare(location.hash)) show(ui.stepSelect);
  window.addEventListener('hashchange', function () { location.reload(); });
})();

// ---- Events ----

ui.dropZone.onclick = function () { ui.fileInput.click(); };
ui.dropZone.ondragover = function (e) { e.preventDefault(); ui.dropZone.classList.add('drag-over'); };
ui.dropZone.ondragleave = function () { ui.dropZone.classList.remove('drag-over'); };
ui.dropZone.ondrop = function (e) {
  e.preventDefault(); ui.dropZone.classList.remove('drag-over');
  if (e.dataTransfer.files.length) selectFile(e.dataTransfer.files[0]);
};
ui.fileInput.onchange = function () {
  if (ui.fileInput.files.length) selectFile(ui.fileInput.files[0]);
};
ui.shareBtn.onclick = startUpload;
ui.shareAgain.onclick = function () { location.hash = ''; location.reload(); };
