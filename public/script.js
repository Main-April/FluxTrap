var CHUNK_SIZE = 65536;
var STUN = { urls: 'stun:stun.l.google.com:19302' };
var CONN_TIMEOUT = 120000;

var ui = {};
var state = {
  mode: 'idle',
  pc: null, dc: null,
  file: null, fileBuf: null,
  encKey: null,
  recvChunks: [],
  recvMeta: null,
  pendingSend: null
};

var els = 'dropZone,fileInput,browseBtn,stepSelect,stepSend,stepQR,msgArea,qrContainer,progressWrap,progressFill,progressText,stepDone,recvCard,recvName,recvSize,recvDownload,shareAgain,fileName,fileSize,cameraWrap,camera,cameraClose,codeInput,codeApply,scanBtn,manualBtn,manualWrap,cancelBtn,qrHint,sendInfo,sendBtn'.split(',');

els.forEach(function (k) { ui[k] = document.getElementById(k); });

function fmtSize(b) {
  if (!b) return '0 B';
  var k = 1024, s = ['B', 'KB', 'MB', 'GB'];
  var i = Math.floor(Math.log(b) / Math.log(k));
  return parseFloat((b / Math.pow(k, i)).toFixed(1)) + ' ' + s[i];
}

function show(el) { el.classList.remove('hidden'); }
function hide(el) { el.classList.add('hidden'); }

function msg(text, type) {
  ui.msgArea.className = 'msg ' + (type || 'msg-info');
  ui.msgArea.textContent = text;
  show(ui.msgArea);
}

function msgOk(text) { msg(text, 'msg-ok'); }
function msgErr(text) { msg(text, 'msg-err'); }
function msgWarn(text) { msg(text, 'msg-warn'); }

function makeQR(text) {
  ui.qrContainer.innerHTML = '';
  new QRCode(ui.qrContainer, {
    text: text, width: 190, height: 190,
    colorDark: '#000', colorLight: '#fff',
    correctLevel: QRCode.CorrectLevel.L
  });
}

// ---- Encryption ----

async function generateKey() {
  return await crypto.subtle.generateKey({ name: 'AES-GCM', length: 256 }, true, ['encrypt', 'decrypt']);
}

async function exportKey(key) {
  return new Uint8Array(await crypto.subtle.exportKey('raw', key));
}

async function importKey(raw) {
  return await crypto.subtle.importKey('raw', raw, { name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt']);
}

async function encryptChunk(data, key) {
  var iv = crypto.getRandomValues(new Uint8Array(12));
  var enc = await crypto.subtle.encrypt({ name: 'AES-GCM', iv: iv }, key, data);
  var pkt = new Uint8Array(12 + enc.byteLength);
  pkt.set(iv, 0);
  pkt.set(new Uint8Array(enc), 12);
  return pkt;
}

async function decryptChunk(pkt, key) {
  var iv = pkt.slice(0, 12);
  var data = pkt.slice(12);
  return await crypto.subtle.decrypt({ name: 'AES-GCM', iv: iv }, key, data);
}

// ---- Sender flow ----

function selectFile(file) {
  if (file.size > 500 * 1024 * 1024) {
    alert('File too large (max 500 MB)');
    return;
  }
  state.file = file;
  ui.fileName.textContent = file.name;
  ui.fileSize.textContent = fmtSize(file.size);
  hide(ui.stepSelect);
  show(ui.stepSend);
  hide(ui.stepQR);
  hide(ui.stepDone);
  hide(ui.progressWrap);
  hide(ui.msgArea);
  state.mode = 'selected';
}

async function startShare() {
  if (!state.file) return;
  state.mode = 'sender-offer';
  ui.sendBtn.disabled = true;
  ui.sendBtn.textContent = 'Preparing...';
  msg('Generating encryption key...', 'msg-info');
  show(ui.progressWrap);
  ui.progressFill.style.width = '0%';
  ui.progressText.textContent = 'Preparing...';

  try {
    state.encKey = await generateKey();
    var rawKey = await exportKey(state.encKey);
    msg('Creating secure connection...', 'msg-info');

    state.pc = new RTCPeerConnection({ iceServers: [STUN] });
    state.dc = state.pc.createDataChannel('wishare', { ordered: true });
    state.dc.binaryType = 'arraybuffer';

    state.dc.onopen = function () {
      transferFile();
    };

    state.dc.onclose = function () {
      if (state.mode === 'sender-transfer' || state.mode === 'sender-offer') {
        msgErr('Connection closed unexpectedly');
      }
    };

    state.pc.oniceconnectionstatechange = function () {
      if (state.pc.iceConnectionState === 'disconnected' || state.pc.iceConnectionState === 'failed') {
        msgErr('Connection lost');
      }
      if (state.pc.iceConnectionState === 'connected') {
        msgOk('Connected! Sending...');
      }
    };

    var reader = new FileReader();
    reader.onload = async function (e) {
      state.fileBuf = e.target.result;
      state.pendingSend = {
        buf: state.fileBuf,
        total: Math.ceil(state.fileBuf.byteLength / CHUNK_SIZE)
      };

      var offer = await state.pc.createOffer();
      await state.pc.setLocalDescription(offer);
      await waitIceComplete(state.pc);

      var offerData = {
        sdp: state.pc.localDescription,
        key: Array.from(rawKey),
        name: state.file.name,
        size: state.file.size,
        chunks: state.pendingSend.total
      };
      var offerB64 = btoa(JSON.stringify(offerData));
      var url = location.origin + location.pathname.replace(/\/+$/, '') + '?o=' + encodeURIComponent(offerB64);

      hide(ui.stepSend);
      hide(ui.progressWrap);
      show(ui.stepQR);
      ui.qrHint.innerHTML = '<strong>Step 1:</strong> Receiver scans this QR code<br><small style="color:#555">Then scan the answer QR code shown on their screen</small>';

      makeQR(url);

      msg('Share this QR code with the receiver. After they scan it, scan their answer code.', 'msg-info');
      show(ui.scanBtn);
      hide(ui.manualBtn);
      state.mode = 'sender-offer';
    };
    reader.readAsArrayBuffer(state.file);
  } catch (e) {
    msgErr('Error: ' + e.message);
    ui.sendBtn.disabled = false;
    ui.sendBtn.textContent = 'Generate QR Code';
  }
}

function waitIceComplete(pc) {
  return new Promise(function (resolve) {
    if (pc.iceGatheringState === 'complete') resolve();
    else pc.onicegatheringstatechange = function () {
      if (pc.iceGatheringState === 'complete') resolve();
    };
  });
}

async function transferFile() {
  state.mode = 'sender-transfer';
  hide(ui.stepQR);
  show(ui.progressWrap);
  ui.progressFill.style.width = '0%';

  var p = state.pendingSend;
  if (!p || !state.dc || state.dc.readyState !== 'open') return;

  var idx = 0;
  var key = state.encKey;

  function next() {
    if (idx >= p.total || state.dc.readyState !== 'open') {
      if (idx >= p.total) {
        ui.progressFill.style.width = '100%';
        ui.progressText.textContent = 'Sent!';
        msgOk('File sent successfully!');
        showDone('sent');
      }
      return;
    }
    var start = idx * CHUNK_SIZE;
    var end = Math.min(start + CHUNK_SIZE, p.buf.byteLength);
    var raw = new Uint8Array(p.buf.slice(start, end));

    encryptChunk(raw, key).then(function (encrypted) {
      state.dc.send(encrypted.buffer);
      var pct = Math.round((idx + 1) / p.total * 100);
      ui.progressFill.style.width = pct + '%';
      ui.progressText.textContent = 'Sending... ' + pct + '% (' + fmtSize(end) + ' / ' + fmtSize(p.buf.byteLength) + ')';
      idx++;
      setTimeout(next, 1);
    }).catch(function (e) {
      msgErr('Encryption error');
    });
  }
  next();
}

// ---- Receiver flow ----

async function handleOffer(offerB64) {
  state.mode = 'receiver-offer';

  try {
    var offerData = JSON.parse(atob(offerB64));
    var rawKey = new Uint8Array(offerData.key);
    state.encKey = await importKey(rawKey);
    state.recvMeta = { name: offerData.name, size: offerData.size, total: offerData.chunks };
    state.recvChunks = [];

    hide(ui.stepSelect);
    show(ui.stepQR);
    show(ui.stepSend);
    hide(ui.stepDone);
    hide(ui.progressWrap);
    hide(ui.scanBtn);
    hide(ui.manualBtn);
    hide(ui.sendInfo);
    hide(ui.sendBtn);
    ui.fileName.textContent = offerData.name;
    ui.fileSize.textContent = fmtSize(offerData.size);

    msg('Connecting...', 'msg-info');

    state.pc = new RTCPeerConnection({ iceServers: [STUN] });

    state.pc.ondatachannel = function (e) {
      state.dc = e.channel;
      state.dc.binaryType = 'arraybuffer';

      state.dc.onmessage = function (e) {
        if (e.data instanceof ArrayBuffer) {
          state.recvChunks.push(new Uint8Array(e.data));
          var pct = Math.round(state.recvChunks.length / state.recvMeta.total * 100);
          ui.progressFill.style.width = Math.min(95, pct) + '%';
          ui.progressText.textContent = 'Receiving... ' + pct + '% (' + state.recvChunks.length + ' / ' + state.recvMeta.total + ' chunks)';

          if (state.recvChunks.length === state.recvMeta.total) {
            finishReceive();
          }
        }
      };

      state.dc.onopen = function () {
        hide(ui.stepQR);
        hide(ui.stepSend);
        show(ui.progressWrap);
        msgOk('Connected! Receiving file...');
        state.mode = 'receiver-transfer';
      };
    };

    state.pc.oniceconnectionstatechange = function () {
      if (state.pc.iceConnectionState === 'disconnected' || state.pc.iceConnectionState === 'failed') {
        msgErr('Connection lost');
      }
    };

    var offer = new RTCSessionDescription(offerData.sdp);
    await state.pc.setRemoteDescription(offer);
    var answer = await state.pc.createAnswer();
    await state.pc.setLocalDescription(answer);
    await waitIceComplete(state.pc);

    var answerB64 = btoa(JSON.stringify(state.pc.localDescription));
    var url = location.origin + location.pathname.replace(/\/+$/, '') + '?a=' + encodeURIComponent(answerB64);
    makeQR(url);
    ui.qrHint.innerHTML = '<strong>Step 2:</strong> Show this QR code to the sender to scan<br><small style="color:#555">Or share this code: <code style="color:#6c5ce7;font-size:0.75rem;word-break:break-all">' + answerB64 + '</code></small>';
    msg('Show this QR code on your screen. The sender will scan it or paste the code below.', 'msg-info');

  } catch (e) {
    msgErr('Failed to connect: ' + e.message);
  }
}

async function finishReceive() {
  hide(ui.progressWrap);
  ui.progressFill.style.width = '100%';
  ui.progressText.textContent = 'Decrypting...';

  try {
    var decrypted = [];
    for (var i = 0; i < state.recvChunks.length; i++) {
      var d = await decryptChunk(state.recvChunks[i], state.encKey);
      decrypted.push(d);
    }

    var blob = new Blob(decrypted);
    var url = URL.createObjectURL(blob);
    ui.recvName.textContent = state.recvMeta.name;
    ui.recvSize.textContent = fmtSize(state.recvMeta.size);
    ui.recvDownload.href = url;
    ui.recvDownload.download = state.recvMeta.name;
    show(ui.stepDone);
    msgOk('File received and decrypted!');
    state.mode = 'done';
  } catch (e) {
    msgErr('Decryption failed. The file may be corrupted.');
  }
}

// ---- Answer scanner ----

function showScanner() {
  show(ui.cameraWrap);
  hide(ui.manualBtn);
  hide(ui.scanBtn);
  msg('Point your camera at the receiver\'s QR code', 'msg-info');

  if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
    showManualInput();
    return;
  }

  var stream = null;

  navigator.mediaDevices.getUserMedia({ video: { facingMode: 'environment' } })
    .then(function (s) {
      stream = s;
      ui.camera.srcObject = s;
      scanLoop();
    })
    .catch(function () {
      showManualInput();
    });

  function scanLoop() {
    if (!stream || !stream.active) return;
    if ('BarcodeDetector' in window) {
      try {
        var detector = new BarcodeDetector({ formats: ['qr_code'] });
        detector.detect(ui.camera).then(function (codes) {
          if (codes.length > 0) {
            var data = codes[0].rawValue;
            var m = data.match(/[?&]a=([^&]+)/);
            if (m) {
              var ans = decodeURIComponent(m[1]);
              applyAnswer(ans);
              if (stream) { stream.getTracks().forEach(function (t) { t.stop(); }); }
              hide(ui.cameraWrap);
              return;
            }
          }
          if (stream && stream.active) requestAnimationFrame(scanLoop);
        }).catch(function () {
          if (stream && stream.active) requestAnimationFrame(scanLoop);
        });
      } catch (e) {
        if (stream && stream.active) requestAnimationFrame(scanLoop);
      }
    } else {
      showManualInput();
    }
  }

  ui.cameraClose.onclick = function () {
    if (stream) { stream.getTracks().forEach(function (t) { t.stop(); }); }
    hide(ui.cameraWrap);
    show(ui.scanBtn);
  };
}

function showManualInput() {
  hide(ui.cameraWrap);
  hide(ui.scanBtn);
  hide(ui.manualBtn);
  show(ui.manualWrap);
  msg('Paste the answer code from the receiver\'s screen:', 'msg-warn');
}

function applyAnswer(answerB64) {
  try {
    var sdp = JSON.parse(atob(answerB64));
    state.pc.setRemoteDescription(new RTCSessionDescription(sdp));
    msgOk('Connected! Transfer starting...');
  } catch (e) {
    msgErr('Invalid answer code');
  }
}

function applyManualCode() {
  var code = ui.codeInput.value.trim();
  if (code) applyAnswer(code);
}

// ---- UI ----

function showDone(type) {
  show(ui.stepDone);
  if (type === 'sent') {
    ui.recvName.textContent = state.file.name;
    ui.recvSize.textContent = fmtSize(state.file.size);
    hide(ui.recvDownload);
  }
}

function resetAll() {
  if (state.pc) { state.pc.close(); state.pc = null; }
  state.dc = null;
  state.file = null;
  state.fileBuf = null;
  state.encKey = null;
  state.recvChunks = [];
  state.recvMeta = null;
  state.pendingSend = null;
  state.mode = 'idle';
  hide(ui.stepSend);
  hide(ui.stepQR);
  hide(ui.stepDone);
  hide(ui.progressWrap);
  hide(ui.cameraWrap);
  hide(ui.msgArea);
  show(ui.stepSelect);
}

// ---- Init ----

(function () {
  var params = new URLSearchParams(location.search);
  var offer = params.get('o');
  var answer = params.get('a');

  if (offer) {
    handleOffer(offer);
  } else {
    show(ui.stepSelect);
  }
})();

// ---- Event listeners ----

ui.dropZone.onclick = function () { ui.fileInput.click(); };
ui.dropZone.ondragover = function (e) { e.preventDefault(); ui.dropZone.classList.add('drag-over'); };
ui.dropZone.ondragleave = function () { ui.dropZone.classList.remove('drag-over'); };
ui.dropZone.ondrop = function (e) {
  e.preventDefault();
  ui.dropZone.classList.remove('drag-over');
  if (e.dataTransfer.files.length) selectFile(e.dataTransfer.files[0]);
};
ui.fileInput.onchange = function () {
  if (ui.fileInput.files.length) selectFile(ui.fileInput.files[0]);
};
ui.sendBtn.onclick = startShare;
ui.scanBtn.onclick = showScanner;
ui.manualBtn.onclick = showManualInput;
ui.codeApply.onclick = applyManualCode;
ui.cameraClose.onclick = function () {
  hide(ui.cameraWrap);
  show(ui.scanBtn);
};
ui.shareAgain.onclick = resetAll;
ui.cancelBtn.onclick = resetAll;
