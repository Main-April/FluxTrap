// ─────────────────────────────────────────────
//  FluxTrap — script principal
//  Optimisations vitesse + support dossiers P2P
// ─────────────────────────────────────────────

// Chunk de 1 Mo — optimal pour WebRTC DataChannel
var CHUNK = 1048576;

// Seuil de backpressure : on n'envoie plus si le buffer dépasse 4 Mo
var BUFFER_HIGH = 4 * 1024 * 1024;
// On reprend quand le buffer redescend sous 512 Ko
var BUFFER_LOW  = 512 * 1024;

// État global
var SHARE_CODE   = null;
var peer         = null;
var conn         = null;
var sendQueue    = [];   // [{file, path}]
var sendQueueIdx = 0;
var recvChunks   = [];
var recvFiles    = [];
var historyEntries = [];

var STORAGE_KEY = 'fluxtrap-history';
var STATS_KEY   = 'fluxtrap-stats';

// ── Helpers ──────────────────────────────────

function escHtml(s){
  return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}

function fmtSize(b){
  if(!b)return '0 o';
  var k=1024, s=['o','Ko','Mo','Go'];
  var i=Math.floor(Math.log(b)/Math.log(k));
  return parseFloat((b/Math.pow(k,i)).toFixed(1))+' '+s[i];
}

function fmtSpeed(bps){
  if(bps<1024)return Math.round(bps)+' o/s';
  if(bps<1048576)return (bps/1024).toFixed(0)+' Ko/s';
  return (bps/1048576).toFixed(1)+' Mo/s';
}

function genCode(){
  var s='', chars='ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  for(var i=0;i<8;i++) s+=chars[Math.random()*chars.length|0];
  return s;
}

function getFileIcon(type){
  if(!type) return 'fa-regular fa-file';
  if(type.startsWith('image/'))  return 'fa-regular fa-file-image';
  if(type.startsWith('video/'))  return 'fa-regular fa-file-video';
  if(type.startsWith('audio/'))  return 'fa-regular fa-file-audio';
  if(type.startsWith('text/'))   return 'fa-regular fa-file-lines';
  if(type.includes('pdf'))       return 'fa-regular fa-file-pdf';
  if(type.includes('zip')||type.includes('rar')||type.includes('tar')||type.includes('7z')) return 'fa-regular fa-file-zipper';
  if(type.includes('sheet')||type.includes('excel')||type.includes('csv')) return 'fa-regular fa-file-excel';
  return 'fa-regular fa-file';
}

function guessMimeFromName(name){
  var ext=(name||'').split('.').pop().toLowerCase();
  var map={
    jpg:'image/jpeg',jpeg:'image/jpeg',png:'image/png',gif:'image/gif',
    webp:'image/webp',svg:'image/svg+xml',
    mp4:'video/mp4',webm:'video/webm',mov:'video/quicktime',
    mp3:'audio/mpeg',wav:'audio/wav',ogg:'audio/ogg',
    pdf:'application/pdf',
    txt:'text/plain',md:'text/markdown',json:'application/json',csv:'text/csv'
  };
  return map[ext]||'';
}

function getPreviewKind(type){
  if(!type) return null;
  if(type.startsWith('image/')) return 'image';
  if(type.startsWith('video/')) return 'video';
  if(type.startsWith('audio/')) return 'audio';
  if(type==='application/pdf') return 'pdf';
  if(type.startsWith('text/')||type==='application/json') return 'text';
  return null;
}

// ── Toast ─────────────────────────────────────

function showToast(msg, level){
  level = level||'info';
  var icons = {info:'fa-solid fa-circle-info', ok:'fa-solid fa-circle-check', warn:'fa-solid fa-circle-exclamation'};
  var c = document.getElementById('toastContainer');
  if(!c) return;
  var el = document.createElement('div');
  el.className = 'toast '+level;
  el.innerHTML = '<span class="toast-icon"><i class="'+(icons[level]||icons.info)+'"></i></span><span class="toast-msg">'+escHtml(msg)+'</span>';
  c.appendChild(el);
  setTimeout(function(){
    el.classList.add('out');
    setTimeout(function(){if(el.parentNode)el.parentNode.removeChild(el)},300);
  }, 3500);
}

// ── Historique & stats ────────────────────────

function loadStats(){
  try{ return JSON.parse(localStorage.getItem(STATS_KEY))||{uploads:0,files:0,bytes:0}; }catch(e){}
  return {uploads:0,files:0,bytes:0};
}
function saveStats(s){ try{localStorage.setItem(STATS_KEY,JSON.stringify(s))}catch(e){} }
function updateStats(s){
  s=s||loadStats();
  var e=document.getElementById('statUploads'); if(e) e.textContent=s.uploads;
  e=document.getElementById('statFiles');   if(e) e.textContent=s.files;
  e=document.getElementById('statBytes');   if(e) e.textContent=fmtSize(s.bytes);
}

function addHistory(files, size, count){
  var entry={id:Date.now()+'-'+(Math.random()*1e6|0), date:new Date().toISOString(), count:count, size:size, files:files};
  historyEntries=[entry].concat(historyEntries).slice(0,50);
  try{localStorage.setItem(STORAGE_KEY,JSON.stringify(historyEntries))}catch(e){}
  renderHistory();
  var s=loadStats(); s.uploads++; s.files+=count; s.bytes+=size;
  saveStats(s); updateStats(s);
}

function renderHistory(){
  var empty=document.getElementById('historyEmpty');
  var list=document.getElementById('historyList');
  if(historyEntries.length===0){
    if(empty)empty.classList.remove('hidden');
    if(list)list.classList.add('hidden');
    return;
  }
  if(empty)empty.classList.add('hidden');
  if(list)list.classList.remove('hidden');
  var html='';
  historyEntries.forEach(function(h){
    var names=h.files.slice(0,2).map(function(f){return f.name}).join(', ');
    var extra=h.count>2?' + '+(h.count-2)+' autre'+(h.count-2>1?'s':''):'';
    var date=new Date(h.date).toLocaleString(undefined,{day:'2-digit',month:'short',hour:'2-digit',minute:'2-digit'});
    html+='<div class="history-item"><span class="history-icon"><i class="fa-solid fa-file-zipper"></i></span><div class="history-info"><div class="history-name">'+escHtml(names)+escHtml(extra)+'</div><div class="history-meta">'+h.count+' fichier'+(h.count>1?'s':'')+' · '+fmtSize(h.size)+' · '+date+'</div></div><i class="fa-solid fa-chevron-right history-arrow"></i></div>';
  });
  if(list) list.innerHTML=html;
}

// Init historique
(function(){
  try{ var raw=localStorage.getItem(STORAGE_KEY); if(raw) historyEntries=JSON.parse(raw); }catch(e){}
  renderHistory();
  updateStats(loadStats());
})();

document.getElementById('clearHistory').onclick=function(){
  historyEntries=[];
  try{localStorage.removeItem(STORAGE_KEY)}catch(e){}
  renderHistory();
  showToast('Historique effacé','warn');
};

// ── GDPR ─────────────────────────────────────

(function(){
  if(localStorage.getItem('fluxtrap-gdpr')){var b=document.getElementById('gdprBanner');if(b)b.classList.add('hidden')}
})();
var gdprBtn=document.getElementById('gdprAccept');
if(gdprBtn) gdprBtn.onclick=function(){
  try{localStorage.setItem('fluxtrap-gdpr','1')}catch(e){}
  var b=document.getElementById('gdprBanner'); if(b) b.classList.add('hidden');
};

// ── UI refs ───────────────────────────────────

var ui={};
var loadingBar=document.getElementById('loadingBar');
function loading(on){ if(loadingBar) loadingBar.classList.toggle('active',on); }

'status,stepMode,fileInput,stepCode,codeDisplay,qrContainer,codeInput,recvBtn,progressWrap,progressFill,progressText,stepDone,recvName,recvSize,recvDownload,shareAgain,stepCodeBadge,stepCodeSub,filePreview,transferAnim'
  .split(',').forEach(function(k){ ui[k]=document.getElementById(k); });
ui.dropZone=ui.stepMode;

function show(el){ if(el) el.classList.remove('hidden'); }
function hide(el){ if(el) el.classList.add('hidden'); }
function showAnim(on){ if(ui.transferAnim) ui.transferAnim.classList.toggle('hidden',!on); }

function msg(t,type){
  if(!ui.status) return;
  ui.status.className='msg msg-'+(type||'info');
  ui.status.textContent=t;
  if(t) show(ui.status); else hide(ui.status);
}

function makeQR(t){
  if(!ui.qrContainer) return;
  ui.qrContainer.innerHTML='';
  new QRCode(ui.qrContainer,{text:t,width:176,height:176,colorDark:'#000',colorLight:'#fff',correctLevel:QRCode.CorrectLevel.M});
}

// ── Download helper ───────────────────────────

function downloadBlob(blob, name){
  var isIOS=/iPad|iPhone|iPod/.test(navigator.userAgent)||(navigator.platform==='MacIntel'&&navigator.maxTouchPoints>1);
  var a=document.createElement('a');
  a.download=name;
  document.body.appendChild(a);
  function clickURL(url){
    a.href=url; a.click();
    setTimeout(function(){document.body.removeChild(a); if(url.startsWith('blob:'))URL.revokeObjectURL(url);},5000);
  }
  if(isIOS&&blob.size<50*1024*1024){
    var r=new FileReader(); r.onload=function(e){clickURL(e.target.result)}; r.readAsDataURL(blob);
  }else{
    clickURL(URL.createObjectURL(blob));
  }
}

// ── Reset ─────────────────────────────────────

function resetShare(){
  loading(false); showAnim(false);
  sendQueue=[]; sendQueueIdx=0;
  if(peer){peer.destroy();peer=null;}
  conn=null; SHARE_CODE=null;
  recvFiles.forEach(function(f){if(f.url)URL.revokeObjectURL(f.url)});
  recvFiles=[];
  if(window._previewUrls){window._previewUrls.forEach(function(u){URL.revokeObjectURL(u)});window._previewUrls=null;}
  if(ui.filePreview){ui.filePreview.innerHTML='';ui.filePreview.style.display='';}
  hide(ui.stepCode); hide(ui.progressWrap); hide(ui.stepDone);
  show(ui.stepMode);
  if(ui.codeDisplay) ui.codeDisplay.textContent='---';
  msg('','');
}

// ════════════════════════════════════════════════
//  SÉLECTION DE FICHIERS / DOSSIERS
// ════════════════════════════════════════════════

// Lit un FileSystemEntry récursivement → [{file, path}]
function readEntry(entry, basePath){
  return new Promise(function(resolve){
    if(entry.isFile){
      entry.file(function(f){
        resolve([{file:f, path:(basePath?basePath+'/':'')+f.name}]);
      }, function(){ resolve([]); });
    } else if(entry.isDirectory){
      var reader=entry.createReader();
      var results=[];
      var dirPath=(basePath?basePath+'/':'')+entry.name;
      function readAll(){
        reader.readEntries(function(entries){
          if(!entries.length){ resolve(results); return; }
          var pending=entries.length;
          entries.forEach(function(e){
            readEntry(e, dirPath).then(function(items){
              results=results.concat(items);
              if(--pending===0) readAll();
            });
          });
        }, function(){ resolve(results); });
      }
      readAll();
    } else {
      resolve([]);
    }
  });
}

// Extraire les entrées d'un dataTransfer (support dossiers)
function getEntriesFromDrop(dataTransfer){
  var promises=[];
  var items=dataTransfer.items;
  for(var i=0;i<items.length;i++){
    var item=items[i];
    if(item.webkitGetAsEntry){
      var entry=item.webkitGetAsEntry();
      if(entry) promises.push(readEntry(entry,''));
    }
  }
  if(!promises.length){
    // Fallback : items sans API FileSystem
    var files=Array.from(dataTransfer.files);
    return Promise.resolve(files.map(function(f){return {file:f,path:f.name};}));
  }
  return Promise.all(promises).then(function(arrays){
    return [].concat.apply([],arrays);
  });
}

// Valider et lancer l'envoi
function onEntries(entries){
  var valid=[];
  entries.forEach(function(e){
    if(e.file.size>500*1024*1024){ showToast(e.file.name+' trop volumineux (max 500 Mo)','warn'); return; }
    if(e.file.size===0){ showToast(e.file.name+' vide, ignoré','warn'); return; }
    valid.push(e);
  });
  if(!valid.length) return;
  sendQueue=valid;
  sendQueueIdx=0;
  hide(ui.stepMode);
  show(ui.stepCode);
  msg('','');
  showSendFileList(valid, ui.filePreview);
  nextFile();
}

// Depuis input[type=file] standard
function onFiles(files){
  onEntries(Array.from(files).map(function(f){
    // webkitRelativePath si sélection dossier, sinon juste le nom
    var path=f.webkitRelativePath||f.name;
    return {file:f, path:path};
  }));
}

// ── Drop zone events ──────────────────────────

ui.dropZone.ondragover=function(e){ e.preventDefault(); ui.dropZone.classList.add('drag-over'); };
ui.dropZone.ondragleave=function(){ ui.dropZone.classList.remove('drag-over'); };
ui.dropZone.ondrop=function(e){
  e.preventDefault(); ui.dropZone.classList.remove('drag-over');
  getEntriesFromDrop(e.dataTransfer).then(onEntries);
};

// Clic sur la zone → fichiers
ui.dropZone.onclick=function(ev){
  // Éviter de déclencher si clic sur un bouton enfant
  if(ev.target.closest('button')) return;
  if(ui.fileInput) ui.fileInput.click();
};

// Boutons picker
var btnPickFiles=document.getElementById('btnPickFiles');
var btnPickFolder=document.getElementById('btnPickFolder');

if(btnPickFiles) btnPickFiles.onclick=function(e){
  e.stopPropagation();
  if(ui.fileInput) ui.fileInput.click();
};

if(btnPickFolder) btnPickFolder.onclick=function(e){
  e.stopPropagation();
  var inp=document.createElement('input');
  inp.type='file';
  inp.multiple=true;
  inp.setAttribute('webkitdirectory','');
  inp.setAttribute('directory','');
  inp.style.cssText='position:fixed;top:-9999px;left:-9999px;opacity:0;pointer-events:none;';
  document.body.appendChild(inp);
  inp.onchange=function(){
    if(inp.files.length) onFiles(inp.files);
    document.body.removeChild(inp);
  };
  // Annulation sans sélection : nettoyer après focus retour
  window.addEventListener('focus', function cleanup(){
    window.removeEventListener('focus', cleanup);
    setTimeout(function(){ if(inp.parentNode) document.body.removeChild(inp); }, 2000);
  }, {once: true});
  inp.click();
};

// Input fichiers statique
if(ui.fileInput) ui.fileInput.onchange=function(){
  if(ui.fileInput.files.length) onFiles(ui.fileInput.files);
  ui.fileInput.value='';
};

// ── Affichage liste fichiers à envoyer ────────

function showSendFileList(entries, container){
  if(!container) return;
  container.style.display='block';
  var html='<div class="file-tile-grid">';
  for(var i=0;i<entries.length;i++){
    var f=entries[i].file;
    var inner;
    if(f.type&&f.type.startsWith('image/')){
      var thumbUrl=URL.createObjectURL(f);
      if(!window._previewUrls) window._previewUrls=[];
      window._previewUrls.push(thumbUrl);
      inner='<div class="file-tile-img"><img src="'+thumbUrl+'" alt="'+escHtml(f.name)+'"></div>';
    } else {
      inner='<div class="file-tile-icon"><i class="'+getFileIcon(f.type)+'"></i></div>';
    }
    var label=entries[i].path||f.name;
    html+='<div class="file-tile" data-idx="'+i+'">'+inner+'<div class="file-tile-name" title="'+escHtml(label)+'">'+escHtml(f.name)+'</div></div>';
  }
  html+='</div>';
  container.innerHTML=html;
  container.onclick=function(e){
    var tile=e.target.closest('.file-tile');
    if(!tile) return;
    var idx=parseInt(tile.getAttribute('data-idx'),10);
    var f=entries[idx]&&entries[idx].file;
    if(!f||!f.type||!f.type.startsWith('image/')) return;
    var r=new FileReader();
    r.onload=function(ev){
      var overlay=document.createElement('div');
      overlay.className='preview-overlay';
      overlay.innerHTML='<div class="preview-overlay-bg"></div><div class="preview-overlay-media"><button class="preview-overlay-close" style="position:absolute;top:8px;right:8px;z-index:1"><i class="fa-solid fa-xmark"></i></button><img src="'+ev.target.result+'" alt="'+escHtml(f.name)+'" style="max-width:100%;max-height:80vh;border-radius:8px"></div>';
      document.body.appendChild(overlay);
      requestAnimationFrame(function(){overlay.classList.add('active');});
      overlay.onclick=function(ev2){
        if(ev2.target===overlay||ev2.target.closest('.preview-overlay-close')){
          overlay.classList.remove('active');
          setTimeout(function(){if(overlay.parentNode)overlay.parentNode.removeChild(overlay);},300);
        }
      };
    };
    r.readAsDataURL(f);
  };
  updateFileTileCurrent();
}

function updateFileTileCurrent(){
  var tiles=(ui.filePreview||document).querySelectorAll('.file-tile');
  for(var i=0;i<tiles.length;i++){
    tiles[i].classList.toggle('current', i===sendQueueIdx && i<sendQueue.length);
  }
}

// ════════════════════════════════════════════════
//  ENVOI — PEER
// ════════════════════════════════════════════════

function nextFile(){
  if(sendQueueIdx>=sendQueue.length){ showDone('sent'); return; }
  var entry=sendQueue[sendQueueIdx];
  var f=entry.file;
  if(ui.stepCodeBadge) ui.stepCodeBadge.innerHTML='<i class="fa-solid fa-spinner fa-spin"></i> Préparation ('+(sendQueueIdx+1)+'/'+sendQueue.length+')...';
  if(ui.stepCodeSub)   ui.stepCodeSub.textContent=sendQueue.length+' fichier'+(sendQueue.length>1?'s':'')+' · '+f.name;
  if(ui.codeDisplay)   ui.codeDisplay.textContent='---';
  if(ui.qrContainer)   ui.qrContainer.innerHTML='';
  updateFileTileCurrent();
  loading(true);
  startPeer();
}

function startPeer(){
  var code=genCode();
  peer=new Peer(code);
  var expireTimer;
  var connected=false;

  function showCode(){
    SHARE_CODE=code;
    if(ui.codeDisplay) ui.codeDisplay.textContent=code;
    hide(ui.progressWrap); hide(ui.stepDone);
    updateFileTileCurrent();
    if(ui.stepCodeBadge) ui.stepCodeBadge.innerHTML='<i class="fa-solid fa-circle-check"></i> Prêt à partager';
    if(ui.stepCodeSub)   ui.stepCodeSub.textContent='Code : '+code+' — scannez le QR ou partagez le code';
    var url=location.origin+location.pathname.replace(/\/+$/,'')+'#'+code;
    makeQR(url);
    loading(false);
    expireTimer=setTimeout(function(){
      if(!connected){ showToast('Code expiré (15 min)','warn'); resetShare(); }
    }, 15*60*1000);
  }

  function onConnection(c){
    clearTimeout(expireTimer);
    connected=true;
    conn=c;
    conn.on('open',function(){
      loading(true);
      showToast('Destinataire connecté — transfert en cours','ok');
      hide(ui.stepCode); show(ui.progressWrap);
      if(ui.progressText) ui.progressText.textContent='Connecté ! Envoi en cours...';
      sendAllFiles();
    });
    conn.on('data',function(d){
      if(typeof d==='string'&&d==='REFUSE'){
        showToast('Fichier refusé','warn');
        sendQueueIdx++;
        sendNextInQueue();
      }
    });
    conn.on('close',function(){
      showToast('Connexion perdue','warn');
      resetShare();
    });
    conn.on('error',function(e){ showToast('Erreur connexion : '+e.type,'warn'); });
  }

  peer.on('open',function(){ showToast('Code : '+code,'ok'); showCode(); });
  peer.on('connection',function(c){ onConnection(c); });
  peer.on('error',function(e){
    if(e.type==='unavailable-id'){ if(peer)peer.destroy(); peer=null; conn=null; startPeer(); return; }
    loading(false);
    var msgs={
      network:'Erreur réseau — vérifiez votre connexion.',
      'negotiation-failed':'Échec P2P — essayez sur le même réseau WiFi.'
    };
    showToast(msgs[e.type]||('Erreur : '+e.type),'warn');
  });
}

// ── Envoi de tous les fichiers de la queue ────

function sendAllFiles(){
  if(sendQueueIdx>=sendQueue.length){
    try{ conn.send('ALL_DONE'); }catch(e){}
    showToast('Tous les fichiers envoyés !','ok');
    showDone('sent');
    return;
  }
  sendOneFile(sendQueue[sendQueueIdx], function(){
    sendQueueIdx++;
    updateFileTileCurrent();
    sendAllFiles();
  });
}

// ── Envoi d'un fichier en streaming par tranches ──

function sendOneFile(entry, onDone){
  var f=entry.file;
  var path=entry.path||f.name;
  var totalChunks=Math.ceil(f.size/CHUNK)||1;

  // Envoyer le meta avec le chemin relatif
  var meta={type:'meta', name:f.name, path:path, size:f.size, total:totalChunks, mime:f.type||''};
  try{ conn.send(JSON.stringify(meta)); }catch(e){ return; }

  showAnim(true);
  if(ui.progressFill) ui.progressFill.style.width='0%';

  var chunkIdx=0;
  var bytesSent=0;
  var startTime=Date.now();
  var lastTime=startTime;
  var lastBytes=0;

  function updateProgress(){
    var pct=Math.round(chunkIdx/totalChunks*100);
    if(ui.progressFill) ui.progressFill.style.width=pct+'%';
    var now=Date.now();
    var dt=(now-lastTime)/1000;
    if(dt>=0.5){
      var speed=(bytesSent-lastBytes)/dt;
      var remain=f.size-bytesSent;
      var eta=speed>0?Math.ceil(remain/speed):0;
      var etaStr=eta>0?' · ETA '+eta+'s':'';
      if(ui.progressText) ui.progressText.textContent=
        '('+(sendQueueIdx+1)+'/'+sendQueue.length+') '+f.name+
        ' — '+pct+'% — '+fmtSpeed(speed)+etaStr;
      lastTime=now; lastBytes=bytesSent;
    }
  }

  // Lecture par tranche (streaming, pas de chargement total en RAM)
  function sendChunk(){
    if(!conn||!conn.open){ return; }

    // Backpressure : attendre que le buffer se vide
    if(conn.dataChannel && conn.dataChannel.bufferedAmount > BUFFER_HIGH){
      setTimeout(sendChunk, 10);
      return;
    }

    if(chunkIdx>=totalChunks){
      // Tous les chunks envoyés
      try{ conn.send('DONE'); }catch(e){}
      loading(false); showAnim(false);
      if(ui.progressFill) ui.progressFill.style.width='100%';
      showToast(f.name+' envoyé ('+(sendQueueIdx+1)+'/'+sendQueue.length+')','ok');
      addHistory([{name:f.name,size:f.size,type:f.type||''}], f.size, 1);
      if(onDone) onDone();
      return;
    }

    var start=chunkIdx*CHUNK;
    var end=Math.min(start+CHUNK, f.size);
    var slice=f.slice(start, end);

    var reader=new FileReader();
    reader.onload=function(e){
      if(!conn||!conn.open) return;
      var buf=e.target.result;
      try{ conn.send(buf); }catch(err){ showToast('Erreur envoi','warn'); return; }
      bytesSent+=buf.byteLength;
      chunkIdx++;
      updateProgress();

      // Pipeline : on envoie plusieurs chunks d'affilée avant de vérifier le buffer
      if(conn.dataChannel && conn.dataChannel.bufferedAmount > BUFFER_LOW){
        // Buffer un peu chargé, on attend qu'il se vide partiellement
        setTimeout(sendChunk, 5);
      } else {
        // Buffer OK, chunk suivant immédiatement (pas de setTimeout = max débit)
        sendChunk();
      }
    };
    reader.onerror=function(){ showToast('Erreur lecture fichier','warn'); };
    reader.readAsArrayBuffer(slice);
  }

  sendChunk();
}

// (sendNextInQueue conservé pour compatibilité avec l'event REFUSE)
function sendNextInQueue(){
  if(sendQueueIdx>=sendQueue.length){
    try{ conn.send('ALL_DONE'); }catch(e){}
    showDone('sent'); return;
  }
  sendAllFiles();
}

function retryPeer(){
  if(peer) peer.destroy();
  peer=null; conn=null;
  startPeer();
}

function showDone(type){
  show(ui.stepDone);
  loading(false); showAnim(false);
  if(type==='sent'){
    var tot=sendQueue.reduce(function(s,e){return s+e.file.size;},0);
    if(ui.recvName) ui.recvName.textContent=sendQueue.length+' fichier'+(sendQueue.length>1?'s':'')+' envoyé'+(sendQueue.length>1?'s':'');
    if(ui.recvSize) ui.recvSize.textContent=fmtSize(tot);
    hide(ui.recvDownload);
  }
}

// ════════════════════════════════════════════════
//  RÉCEPTION
// ════════════════════════════════════════════════

function startReceive(code){
  hide(document.getElementById('panelRecv'));
  show(ui.progressWrap);
  if(ui.progressText) ui.progressText.textContent='Connexion...';
  loading(true);
  recvFiles.forEach(function(f){if(f.url)URL.revokeObjectURL(f.url);});
  recvFiles=[]; recvChunks=[];

  peer=new Peer();

  peer.on('open',function(){
    conn=peer.connect(code,{reliable:true,serialization:'binary'});
    recvChunks=[];

    var timeout=setTimeout(function(){
      if(!conn||!conn.open){
        loading(false); showAnim(false);
        showToast('Délai dépassé — vérifiez le code','warn');
        hide(ui.progressWrap);
        show(document.getElementById('panelRecv'));
        if(peer) peer.destroy();
      }
    }, 30000);

    conn.on('open',function(){
      clearTimeout(timeout);
      showToast('Connecté à l\'expéditeur','ok');
      if(ui.progressText) ui.progressText.textContent='Réception en cours...';
      showAnim(true);
    });

    conn.on('close',function(){
      if(recvFiles.length>0){
        showRecvList();
        showToast(recvFiles.length+' fichier'+(recvFiles.length>1?'s':'')+' reçu'+(recvFiles.length>1?'s':''),'ok');
      } else {
        loading(false); showAnim(false);
        showToast('Connexion perdue','warn');
        hide(ui.progressWrap);
        show(document.getElementById('panelRecv'));
      }
      if(peer) peer.destroy();
    });

    var recvMeta=null;
    var recvDone=false;
    var pendingBlobs=0;
    var recvBytes=0;
    var recvStart=Date.now();

    function handleBinary(buf){
      if(recvDone) return;
      recvChunks.push(buf);
      recvBytes+=buf.byteLength;
      var total=recvMeta?recvMeta.total:recvChunks.length;
      var pct=Math.round(recvChunks.length/total*100);
      if(ui.progressFill) ui.progressFill.style.width=Math.min(97,pct)+'%';
      var elapsed=(Date.now()-recvStart)/1000||0.001;
      var speed=recvBytes/elapsed;
      var remain=(recvMeta?recvMeta.size:0)-recvBytes;
      var eta=speed>0&&remain>0?Math.ceil(remain/speed):0;
      if(ui.progressText) ui.progressText.textContent=
        (recvMeta?recvMeta.name:'...')+' — '+pct+'% — '+fmtSpeed(speed)+(eta>0?' · ETA '+eta+'s':'');
      if(recvMeta&&recvChunks.length>=recvMeta.total&&pendingBlobs===0){
        recvDone=true; finishRecv(recvMeta);
      }
    }

    conn.on('data',function(data){
      if(typeof data==='string'){
        if(data==='ALL_DONE'){ showRecvList(); return; }
        if(data==='DONE'&&recvMeta&&!recvDone){
          recvDone=true; if(pendingBlobs===0) finishRecv(recvMeta);
        } else {
          try{
            var m=JSON.parse(data);
            if(m&&m.type==='meta'){
              if(m.size>500*1024*1024){
                showToast(m.name+' trop volumineux','warn');
                try{ conn.send('REFUSE'); }catch(e){}
                return;
              }
              recvMeta=m; recvChunks=[]; recvDone=false;
              recvBytes=0; recvStart=Date.now();
              if(ui.progressText) ui.progressText.textContent='Réception de '+m.name+'...';
              if(ui.progressFill) ui.progressFill.style.width='0%';
            }
          }catch(e){}
        }
        return;
      }
      if(data instanceof ArrayBuffer){
        handleBinary(data);
      } else if(ArrayBuffer.isView(data)){
        handleBinary(data.slice().buffer);
      } else if(data instanceof Blob){
        pendingBlobs++;
        var r=new FileReader();
        r.onload=function(e){ pendingBlobs--; handleBinary(e.target.result); };
        r.readAsArrayBuffer(data);
      }
    });
  });

  peer.on('error',function(e){
    loading(false);
    var msgs={
      'peer-unavailable':'Code introuvable — vérifiez le code.',
      network:'Erreur réseau.',
      'negotiation-failed':'Échec P2P — essayez sur le même réseau WiFi.'
    };
    showToast(msgs[e.type]||('Erreur : '+e.type),'warn');
    if(msgs[e.type]) msg(msgs[e.type],'err');
    hide(ui.progressWrap);
    show(document.getElementById('panelRecv'));
  });
}

function finishRecv(meta){
  if(!recvChunks.length){ loading(false); showToast('Aucune donnée reçue','warn'); return; }
  var mime=(meta&&meta.mime)||guessMimeFromName(meta?meta.name:'')||'application/octet-stream';
  var blob=new Blob(recvChunks,{type:mime});
  var url=URL.createObjectURL(blob);
  var name=meta?meta.name:'fichier_recu';
  var path=meta?meta.path:name;
  recvFiles.push({name:name, path:path, size:blob.size, mime:mime, url:url, blob:blob});
  recvChunks=[];
  if(ui.progressFill) ui.progressFill.style.width='100%';
  showToast(name+' reçu','ok');
  showRecvList();
}

// ── Affichage liste fichiers reçus ────────────

function showPreviewModal(kind, url, blob, name){
  var overlay=document.createElement('div');
  overlay.className='preview-overlay';
  var html='<div class="preview-overlay-bg"></div><div class="preview-overlay-media"><button class="preview-overlay-close" style="position:absolute;top:8px;right:8px;z-index:1"><i class="fa-solid fa-xmark"></i></button>';
  if(kind==='image')  html+='<img src="'+url+'" alt="'+escHtml(name)+'" style="max-width:100%;max-height:80vh;border-radius:8px">';
  else if(kind==='video') html+='<video src="'+url+'" controls style="max-width:100%;max-height:75vh;border-radius:8px;width:auto"></video>';
  else if(kind==='audio') html+='<audio src="'+url+'" controls style="width:320px;max-width:100%"></audio>';
  else if(kind==='pdf')   html+='<iframe src="'+url+'"></iframe>';
  else if(kind==='text')  html+='<pre></pre>';
  html+='<button class="btn primary small preview-dl-btn" style="width:100%;justify-content:center;margin-top:10px"><i class="fa-solid fa-download"></i> Télécharger</button></div>';
  overlay.innerHTML=html;
  document.body.appendChild(overlay);
  requestAnimationFrame(function(){overlay.classList.add('active');});
  overlay.onclick=function(e){
    if(e.target===overlay||e.target.closest('.preview-overlay-close')){
      overlay.classList.remove('active');
      setTimeout(function(){if(overlay.parentNode)overlay.parentNode.removeChild(overlay);},300);
    }
  };
  var dlBtn=overlay.querySelector('.preview-dl-btn');
  if(dlBtn) dlBtn.onclick=function(){downloadBlob(blob,name);};
  if(kind==='text'){
    var pre=overlay.querySelector('pre');
    if(pre) blob.slice(0,20000).text()
      .then(function(t){pre.textContent=t+(blob.size>20000?'\n\n… (aperçu tronqué)':'');})
      .catch(function(){pre.textContent='Aperçu indisponible.';});
  }
}

function showRecvList(){
  if(!ui.recvName||!ui.recvSize) return;
  loading(false);
  var totalSize=recvFiles.reduce(function(s,f){return s+f.size;},0);
  ui.recvName.textContent=recvFiles.length+' fichier'+(recvFiles.length>1?'s':'')+' reçu'+(recvFiles.length>1?'s':'');
  ui.recvSize.textContent=fmtSize(totalSize);

  var html='';
  for(var i=0;i<recvFiles.length;i++){
    var f=recvFiles[i];
    var pk=getPreviewKind(f.mime);
    // Afficher le chemin relatif si dossier
    var label=f.path&&f.path!==f.name?f.path:f.name;
    html+='<div class="recv-file">'+
      '<span class="recv-file-icon"><i class="'+getFileIcon(f.mime)+'"></i></span>'+
      '<span class="recv-file-name" title="'+escHtml(label)+'">'+escHtml(label)+'</span>'+
      '<span class="recv-file-size">'+fmtSize(f.size)+'</span>'+
      (pk?'<button class="recv-file-preview" data-idx="'+i+'" title="Aperçu"><i class="fa-solid fa-eye"></i></button>':'')+
      '<button class="recv-file-dl" data-idx="'+i+'" title="Télécharger"><i class="fa-solid fa-download"></i></button>'+
      '</div>';
  }
  var box=document.getElementById('recvFileList');
  if(box){
    box.innerHTML=html;
    box.onclick=function(e){
      var dl=e.target.closest('.recv-file-dl');
      if(dl){ var idx=parseInt(dl.getAttribute('data-idx'),10); var f=recvFiles[idx]; if(f) downloadBlob(f.blob,f.name); return; }
      var btn=e.target.closest('.recv-file-preview');
      if(!btn) return;
      var idx=parseInt(btn.getAttribute('data-idx'),10);
      var f=recvFiles[idx]; if(!f) return;
      var kind=getPreviewKind(f.mime);
      if(kind) showPreviewModal(kind,f.url,f.blob,f.name);
    };
  }

  if(recvFiles.length===1){
    var last=recvFiles[0];
    if(ui.recvDownload){
      ui.recvDownload.href=last.url;
      ui.recvDownload.download=last.name;
      ui.recvDownload.innerHTML='<i class="fa-solid fa-download"></i> Télécharger';
      ui.recvDownload.onclick=function(e){ e.preventDefault(); downloadBlob(last.blob,last.name); };
    }
    show(ui.recvDownload);
  } else {
    hide(ui.recvDownload);
  }

  showAnim(false);
  hide(ui.progressWrap);
  show(ui.stepDone);
  msg('','');
}

// ════════════════════════════════════════════════
//  INITIALISATION
// ════════════════════════════════════════════════

(function(){
  var hash=location.hash.replace(/^#/,'').trim();
  if(hash){
    SHARE_CODE=hash;
    hide(document.getElementById('panelShare'));
    show(document.getElementById('panelRecv'));
    var tr=document.getElementById('tabRecv'); if(tr) tr.classList.add('active');
    var ts=document.getElementById('tabShare'); if(ts) ts.classList.remove('active');
    startReceive(hash);
  } else {
    show(ui.stepMode);
    hide(document.getElementById('panelRecv'));
  }
  window.addEventListener('hashchange',function(){location.reload();});
})();

// ── Interactions UI ───────────────────────────

if(ui.codeDisplay) ui.codeDisplay.onclick=function(){
  if(!SHARE_CODE) return;
  navigator.clipboard.writeText(SHARE_CODE).catch(function(){});
  var old=ui.codeDisplay.textContent;
  ui.codeDisplay.textContent='Copié !';
  setTimeout(function(){if(ui.codeDisplay)ui.codeDisplay.textContent=old;},1500);
};

if(ui.recvBtn) ui.recvBtn.onclick=function(){
  var code=ui.codeInput.value.trim(); if(code) startReceive(code);
};

if(ui.codeInput){
  ui.codeInput.addEventListener('keydown',function(e){
    if(e.key==='Enter'&&ui.codeInput.value.trim()) if(ui.recvBtn) ui.recvBtn.click();
  });
  ui.codeInput.addEventListener('input',function(){
    this.value=this.value.toUpperCase().replace(/[^A-Z0-9]/g,'').slice(0,8);
  });
}

if(ui.shareAgain) ui.shareAgain.onclick=function(){var t=document.getElementById('tabShare');if(t)t.click();};

var tabShare=document.getElementById('tabShare');
var tabRecv=document.getElementById('tabRecv');
if(tabShare) tabShare.onclick=function(){
  if(peer){peer.destroy();peer=null;} conn=null;
  tabShare.classList.add('active');
  if(tabRecv) tabRecv.classList.remove('active');
  show(document.getElementById('panelShare'));
  hide(document.getElementById('panelRecv'));
  hide(ui.progressWrap); hide(ui.stepDone);
  resetShare();
};
if(tabRecv) tabRecv.onclick=function(){
  if(peer){peer.destroy();peer=null;} conn=null;
  tabRecv.classList.add('active');
  if(tabShare) tabShare.classList.remove('active');
  show(document.getElementById('panelRecv'));
  hide(document.getElementById('panelShare'));
  hide(ui.progressWrap); hide(ui.stepDone);
};

var cancelBtn=document.getElementById('cancelShare');
if(cancelBtn) cancelBtn.onclick=function(){resetShare();};

// Boutons nav / hero
var navSendBtn=document.getElementById('navSendBtn');
if(navSendBtn) navSendBtn.onclick=function(e){
  e.preventDefault();
  var t=document.getElementById('tabShare'); if(t) t.click();
  setTimeout(function(){var el=document.getElementById('upload');if(el)el.scrollIntoView({behavior:'smooth'});},50);
};

var heroSendBtn=document.getElementById('heroSendBtn');
if(heroSendBtn) heroSendBtn.onclick=function(e){
  e.preventDefault();
  var t=document.getElementById('tabShare'); if(t) t.click();
  setTimeout(function(){var el=document.getElementById('upload');if(el)el.scrollIntoView({behavior:'smooth'});},50);
};

var heroRecvBtn=document.getElementById('heroRecvBtn');
if(heroRecvBtn) heroRecvBtn.onclick=function(e){
  e.preventDefault();
  var t=document.getElementById('tabRecv'); if(t) t.click();
  setTimeout(function(){var el=document.getElementById('upload');if(el)el.scrollIntoView({behavior:'smooth'});},50);
};

// Preview lightbox (images dans stepCode)
document.addEventListener('click',function(e){
  var img=e.target.closest('.file-preview-img.clickable');
  if(!img) return;
  var url=img.getAttribute('data-url'); if(!url) return;
  var overlay=document.createElement('div');
  overlay.className='preview-overlay';
  overlay.innerHTML='<div class="preview-overlay-bg"></div><div class="preview-overlay-content"><button class="preview-overlay-close"><i class="fa-solid fa-xmark"></i></button><img src="'+url+'" alt="Aperçu"></div>';
  document.body.appendChild(overlay);
  requestAnimationFrame(function(){overlay.classList.add('active');});
  overlay.onclick=function(e){
    if(e.target===overlay||e.target.closest('.preview-overlay-close')){
      overlay.classList.remove('active');
      setTimeout(function(){if(overlay.parentNode)overlay.parentNode.removeChild(overlay);},300);
    }
  };
});
