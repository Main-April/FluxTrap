var CHUNK = 262144;
var SHARE_CODE = null;
var peer = null;
var conn = null;
var sendQueue = [];
var sendQueueIdx = 0;
var sendFileBuf = null;
var recvChunks = [];
var recvFiles = [];
var historyEntries = [];
var STORAGE_KEY = 'wishare-history';
var STATS_KEY = 'wishare-stats';

function showToast(msg, level){
  level = level || 'info';
  var icons = {info:'fa-solid fa-circle-info',ok:'fa-solid fa-circle-check',warn:'fa-solid fa-circle-exclamation'};
  var icon = icons[level] || icons.info;
  var c = document.getElementById('toastContainer');
  if(!c)return;
  var el = document.createElement('div');
  el.className = 'toast ' + level;
  el.innerHTML = '<span class="toast-icon"><i class="' + icon + '"></i></span><span class="toast-msg">' + escHtml(msg) + '</span>';
  c.appendChild(el);
  setTimeout(function(){el.classList.add('out');setTimeout(function(){if(el.parentNode)el.parentNode.removeChild(el)},300)},3500);
}

function addHistory(files, size, count){
  var entry = {id:Date.now()+'-'+(Math.random()*1e6|0), date:new Date().toISOString(), count:count, size:size, files:files};
  historyEntries = [entry].concat(historyEntries).slice(0,50);
  try{localStorage.setItem(STORAGE_KEY, JSON.stringify(historyEntries))}catch(e){}
  renderHistory();
  var s=loadStats();
  s.uploads++;s.files+=count;s.bytes+=size;
  saveStats(s);
  updateStats(s);
}

function renderHistory(){
  var empty = document.getElementById('historyEmpty');
  var list = document.getElementById('historyList');
  if(historyEntries.length===0){
    if(empty)empty.classList.remove('hidden');
    if(list)list.classList.add('hidden');
    return;
  }
  if(empty)empty.classList.add('hidden');
  if(list)list.classList.remove('hidden');
  var html = '';
  historyEntries.forEach(function(h){
    var names = h.files.slice(0,2).map(function(f){return f.name}).join(', ');
    var extra = h.count > 2 ? ' + ' + (h.count-2) + ' autre' + (h.count-2 > 1 ? 's' : '') : '';
    var date = new Date(h.date).toLocaleString(undefined,{day:'2-digit',month:'short',hour:'2-digit',minute:'2-digit'});
    html += '<div class="history-item"><span class="history-icon"><i class="fa-solid fa-file-zipper"></i></span><div class="history-info"><div class="history-name">'+escHtml(names)+escHtml(extra)+'</div><div class="history-meta">'+h.count+' fichier'+(h.count>1?'s':'')+' · '+fmtSize(h.size)+' · '+date+'</div></div><i class="fa-solid fa-chevron-right history-arrow"></i></div>';
  });
  if(list)list.innerHTML = html;
}

function escHtml(s){return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;')}

function loadStats(){
  try{return JSON.parse(localStorage.getItem(STATS_KEY))||{uploads:0,files:0,bytes:0}}catch(e){}
  return {uploads:0,files:0,bytes:0};
}
function saveStats(s){
  try{localStorage.setItem(STATS_KEY,JSON.stringify(s))}catch(e){}
}
function updateStats(s){
  s=s||loadStats();
  var el = document.getElementById('statUploads');if(el)el.textContent = s.uploads;
  el = document.getElementById('statFiles');if(el)el.textContent = s.files;
  el = document.getElementById('statBytes');if(el)el.textContent = fmtSize(s.bytes);
}

document.getElementById('clearHistory').onclick=function(){
  historyEntries = [];
  try{localStorage.removeItem(STORAGE_KEY)}catch(e){}
  renderHistory();
  showToast('Historique effacé','warn');
};

(function(){
  try{
    var raw = localStorage.getItem(STORAGE_KEY);
    if(raw) historyEntries = JSON.parse(raw);
  }catch(e){}
  renderHistory();
  updateStats(loadStats());
})();

(function(){
  if(localStorage.getItem('wishare-gdpr')){var b=document.getElementById('gdprBanner');if(b)b.classList.add('hidden')}
})();
var gdprBtn=document.getElementById('gdprAccept');
if(gdprBtn)gdprBtn.onclick=function(){
  try{localStorage.setItem('wishare-gdpr','1')}catch(e){}
  var b=document.getElementById('gdprBanner');if(b)b.classList.add('hidden');
};

var ui = {};
var loadingBar=document.getElementById('loadingBar');
function loading(on){if(loadingBar)loadingBar.classList.toggle('active',on)}

var ids = 'status,stepMode,fileInput,stepCode,codeDisplay,qrContainer,codeInput,recvBtn,progressWrap,progressFill,progressText,stepDone,recvName,recvSize,recvDownload,shareAgain,stepCodeBadge,stepCodeSub,filePreview,transferAnim';
ids.split(',').forEach(function(k){ui[k]=document.getElementById(k)});
ui.dropZone=ui.stepMode;

function show(el){if(el)el.classList.remove('hidden')}
function hide(el){if(el)el.classList.add('hidden')}
function showAnim(on){
  if(ui.transferAnim)ui.transferAnim.classList.toggle('hidden',!on);
}

function msg(t,type){
  if(!ui.status)return;
  ui.status.className='msg msg-'+(type||'info');
  ui.status.textContent=t;
  show(ui.status);
}

function downloadBlob(blob, name){
  var isIOS = /iPad|iPhone|iPod/.test(navigator.userAgent) || (navigator.platform==='MacIntel' && navigator.maxTouchPoints>1);
  var a=document.createElement('a');
  a.download=name;
  document.body.appendChild(a);
  function clickURL(url){
    a.href=url;
    a.click();
    setTimeout(function(){document.body.removeChild(a);if(url.startsWith('blob:'))URL.revokeObjectURL(url)},5000);
  }
  if(isIOS && blob.size<50*1024*1024){
    var r=new FileReader();
    r.onload=function(e){clickURL(e.target.result)};
    r.readAsDataURL(blob);
  }else{
    clickURL(URL.createObjectURL(blob));
  }
}

function fmtSize(b){
  if(!b)return'0 o';
  var k=1024,s=['o','Ko','Mo','Go'];
  return parseFloat((b/Math.pow(k,Math.floor(Math.log(b)/Math.log(k)))).toFixed(1))+' '+s[Math.floor(Math.log(b)/Math.log(k))];
}

function genCode(){
  var s='',chars='ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  for(var i=0;i<8;i++)s+=chars[Math.random()*chars.length|0];
  return s;
}

function makeQR(t){
  if(!ui.qrContainer)return;
  ui.qrContainer.innerHTML='';
  new QRCode(ui.qrContainer,{text:t,width:180,height:180,colorDark:'#000',colorLight:'#fff',correctLevel:QRCode.CorrectLevel.M});
}

function getFileIcon(type){
  if(!type)return 'fa-regular fa-file';
  if(type.startsWith('image/'))return 'fa-regular fa-file-image';
  if(type.startsWith('video/'))return 'fa-regular fa-file-video';
  if(type.startsWith('audio/'))return 'fa-regular fa-file-audio';
  if(type.startsWith('text/'))return 'fa-regular fa-file-lines';
  if(type.includes('pdf'))return 'fa-regular fa-file-pdf';
  if(type.includes('zip')||type.includes('rar')||type.includes('tar')||type.includes('7z'))return 'fa-regular fa-file-zipper';
  if(type.includes('sheet')||type.includes('excel')||type.includes('csv'))return 'fa-regular fa-file-excel';
  return 'fa-regular fa-file';
}

function showFilePreview(file, container){
  if(!container)return;
  container.innerHTML='';
  if(file.type&&file.type.startsWith('image/')){
    var r=new FileReader();
    r.onload=function(e){
      container.innerHTML='<div class="file-preview-img clickable" data-url="'+e.target.result+'"><img src="'+e.target.result+'" alt="'+escHtml(file.name)+'"></div>';
    };
    r.readAsDataURL(file);
  }else{
    container.innerHTML='<div class="file-preview-icon"><i class="'+getFileIcon(file.type)+'"></i></div>';
  }
}

function resetShare(){
  loading(false);showAnim(false);
  sendQueue=[];sendQueueIdx=0;sendFileBuf=null;
  if(peer){peer.destroy();peer=null}
  conn=null;
  SHARE_CODE=null;
  recvFiles.forEach(function(f){if(f.url)URL.revokeObjectURL(f.url)});
  recvFiles=[];
  if(window._previewUrls){window._previewUrls.forEach(function(u){URL.revokeObjectURL(u)});window._previewUrls=null}
  if(ui.filePreview){ui.filePreview.innerHTML='';ui.filePreview.style.display=''}
  hide(ui.stepCode);
  hide(ui.progressWrap);
  hide(ui.stepDone);
  show(ui.stepMode);
  if(ui.codeDisplay)ui.codeDisplay.textContent='---';
  msg('','');
  hide(ui.status);
}

// ---- Envoi ----

ui.dropZone.onclick=function(){if(ui.fileInput)ui.fileInput.click()};
ui.dropZone.ondragover=function(e){e.preventDefault();ui.dropZone.classList.add('drag-over')};
ui.dropZone.ondragleave=function(){ui.dropZone.classList.remove('drag-over')};
ui.dropZone.ondrop=function(e){
  e.preventDefault();ui.dropZone.classList.remove('drag-over');
  if(e.dataTransfer.files.length)onFiles(Array.from(e.dataTransfer.files));
};
ui.fileInput.onchange=function(){
  if(ui.fileInput.files.length)onFiles(Array.from(ui.fileInput.files));
};

function showSendFileList(files,container){
  if(!container)return;
  container.style.display='block';
  var html='<div class="file-tile-grid">';
  for(var i=0;i<files.length;i++){
    var f=files[i];
    var inner;
    if(f.type&&f.type.startsWith('image/')){
      var thumbUrl=URL.createObjectURL(f);
      if(!window._previewUrls)window._previewUrls=[];
      window._previewUrls.push(thumbUrl);
      inner='<div class="file-tile-img"><img src="'+thumbUrl+'" alt="'+escHtml(f.name)+'"></div>';
    }else{
      inner='<div class="file-tile-icon"><i class="'+getFileIcon(f.type)+'"></i></div>';
    }
    html+='<div class="file-tile" data-idx="'+i+'">'+inner+'<div class="file-tile-name">'+escHtml(f.name)+'</div></div>';
  }
  html+='</div>';
  container.innerHTML=html;
  container.onclick=function(e){
    var tile=e.target.closest('.file-tile');
    if(!tile)return;
    var idx=parseInt(tile.getAttribute('data-idx'),10);
    var f=files[idx];
    if(!f)return;
    if(f.type&&f.type.startsWith('image/')){
      var r=new FileReader();
      r.onload=function(ev){
        var overlay=document.createElement('div');
        overlay.className='preview-overlay';
        overlay.innerHTML='<div class="preview-overlay-bg"></div><div class="preview-overlay-media"><button class="preview-overlay-close" style="position:absolute;top:8px;right:8px;z-index:1"><i class="fa-solid fa-xmark"></i></button><img src="'+ev.target.result+'" alt="'+escHtml(f.name)+'" style="max-width:100%;max-height:80vh;border-radius:8px"></div>';
        document.body.appendChild(overlay);
        requestAnimationFrame(function(){overlay.classList.add('active')});
        overlay.onclick=function(ev2){
          if(ev2.target===overlay||ev2.target.closest('.preview-overlay-close')){overlay.classList.remove('active');setTimeout(function(){if(overlay.parentNode)overlay.parentNode.removeChild(overlay)},300)}
        };
      };
      r.readAsDataURL(f);
    }
  };
  updateFileTileCurrent();
}

function updateFileTileCurrent(){
  var tiles=(ui.filePreview||document).querySelectorAll('.file-tile');
  for(var i=0;i<tiles.length;i++){
    tiles[i].classList.toggle('current',i===sendQueueIdx&&i<sendQueue.length);
  }
}

function onFiles(files){
  var valid=[];
  for(var i=0;i<files.length;i++){
    var f=files[i];
    if(f.size>500*1024*1024){showToast(f.name+' trop volumineux (max 500 Mo)','warn');continue}
    if(f.size===0){showToast(f.name+' vide, ignoré','warn');continue}
    valid.push(f);
  }
  if(valid.length===0)return;
  sendQueue=valid;
  sendQueueIdx=0;
  hide(ui.stepMode);
  show(ui.stepCode);
  msg('','');
  hide(ui.status);
  showSendFileList(valid, ui.filePreview);
  nextFile();
}

function nextFile(){
  if(sendQueueIdx>=sendQueue.length){
    showToast('Tous les fichiers envoyés !','ok');
    showDone('sent');
    return;
  }
  var f=sendQueue[sendQueueIdx];
  if(ui.stepCodeBadge)ui.stepCodeBadge.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> Lecture ('+(sendQueueIdx+1)+'/'+sendQueue.length+')...';
  if(ui.stepCodeSub)ui.stepCodeSub.textContent = sendQueue.length+' fichier'+(sendQueue.length>1?'s':'')+' · en cours : '+f.name;
  if(ui.codeDisplay)ui.codeDisplay.textContent='---';
  if(ui.qrContainer)ui.qrContainer.innerHTML = '';
  updateFileTileCurrent();
  loading(true);
  var reader=new FileReader();
  reader.onload=function(e){
    sendFileBuf=new Uint8Array(e.target.result);
    showToast(f.name+' ('+fmtSize(sendFileBuf.length)+') — '+(sendQueueIdx+1)+'/'+sendQueue.length,'ok');
    startPeer();
  };
  reader.readAsArrayBuffer(f);
}

function startPeer(){
  var code=genCode();
    peer=new Peer(code);
  var expireTimer;
  var connected=false;

  function showCode(){
    SHARE_CODE=code;
    if(ui.codeDisplay)ui.codeDisplay.textContent=code;
    hide(ui.progressWrap);
    hide(ui.stepDone);
    updateFileTileCurrent();
    if(ui.stepCodeBadge)ui.stepCodeBadge.innerHTML = '<i class="fa-solid fa-circle-check"></i> Prêt à partager';
    if(ui.stepCodeSub)ui.stepCodeSub.textContent = 'Code : ' + code + ' — scannez le QR ou partagez le code';
    var url=location.origin+location.pathname.replace(/\/+$/,'')+'#'+code;
    makeQR(url);
    loading(false);

    expireTimer=setTimeout(function(){
      if(!connected){
        showToast('Code expiré (15 min)','warn');
        msg('Le code a expiré. Réessayez.','err');
        resetShare();
      }
    },15*60*1000);
  }

  function onConnection(c){
    clearTimeout(expireTimer);
    connected=true;
    conn=c;
    conn.on('open',function(){
      console.log('[WiShare][send] conn open, conn.open=',conn.open,'reliable=',conn.reliable,'serialization=',conn.serialization);
      loading(true);
      showToast('Destinataire connecté — transfert en cours','ok');
      hide(ui.stepCode);
      show(ui.progressWrap);
      if(ui.progressText)ui.progressText.textContent='Connecté ! Envoi en cours...';
      sendFile();
    });
    conn.on('data',function(d){
      if(typeof d==='string'&&d==='REFUSE'){
        showToast('Fichier refusé par le destinataire','warn');
        sendQueueIdx++;
        setTimeout(function(){sendNextInQueue()},100);
      }
    });
    conn.on('close',function(){
      if(sendQueue.length===0)return;
      showToast('Connexion perdue','warn');
      msg('Connexion interrompue.','err');
      resetShare();
    });
    conn.on('error',function(e){
      showToast('Erreur de connexion : '+e.type,'warn');
    });
  }

  peer.on('open',function(){
    console.log('[WiShare][send] peer open, id=',peer.id);
    showToast('Code : '+code,'ok');
    showCode();
  });
  peer.on('connection',function(c){
    console.log('[WiShare][send] incoming connection from', c.peer);
    onConnection(c);
  });
  peer.on('error',function(e){
    console.error('[WiShare][send] peer error:', e.type, e);
    if(e.type==='unavailable-id'){retryPeer();return}
    loading(false);
    if(e.type==='network'){
      showToast('Erreur réseau — impossible de joindre le serveur de signalement. Vérifiez votre connexion.','warn');
      msg('Erreur réseau. Vérifiez votre connexion internet et réessayez.','err');
    }else if(e.type==='negotiation-failed'){
      showToast('Échec de connexion — les deux appareils n\'ont pas pu établir de liaison. Essayez sur un autre réseau ou avec un autre moyen.','warn');
      msg('Échec de connexion PeerJS. Ce problème arrive souvent entre un réseau mobile et un réseau d\'entreprise. Essayez sur un réseau domestique ou partagé.','err');
    }else{
      showToast('Erreur : '+e.type,'warn');
    }
  });
}

function sendFile(){
  var f=sendQueue[sendQueueIdx];
  if(!f)return;
  var total=Math.ceil(sendFileBuf.length/CHUNK);
  var meta={type:'meta',name:f.name,size:f.size,total:total,mime:f.type||''};
  conn.send(JSON.stringify(meta));
  showAnim(true);

  var idx=0;
  function next(){
    if(idx>=total||!conn.open){
      if(idx>=total){
        try{conn.send('DONE')}catch(e){}
        loading(false);
        showAnim(false);
        if(ui.progressFill)ui.progressFill.style.width='100%';
        if(ui.progressText)ui.progressText.textContent='Envoyé : '+f.name;
        showToast(f.name+' envoyé ('+(sendQueueIdx+1)+'/'+sendQueue.length+')','ok');
        addHistory([{name:f.name,size:f.size,type:f.type||''}], f.size, 1);
        sendQueueIdx++;
        setTimeout(function(){sendNextInQueue()},100);
      }
      return;
    }
    if(conn.dataChannel && conn.dataChannel.bufferedAmount > 524288){
      setTimeout(next,5);
      return;
    }
    var s=idx*CHUNK,e=Math.min(s+CHUNK,sendFileBuf.length);
    try{conn.send(sendFileBuf.slice(s,e).buffer)}catch(err){showToast('Erreur d\'envoi','warn');return}
    idx++;
    if(ui.progressFill)ui.progressFill.style.width=Math.round(idx/total*100)+'%';
    if(ui.progressText)ui.progressText.textContent='('+(sendQueueIdx+1)+'/'+sendQueue.length+') Envoi... '+idx+'/'+total;
    if(idx%8===0){setTimeout(next,0)}else{next()}
  }
  next();
}

function sendNextInQueue(){
  if(sendQueueIdx>=sendQueue.length){
    try{conn.send('ALL_DONE')}catch(e){}
    showToast('Tous les fichiers envoyés !','ok');
    showDone('sent');
    return;
  }
  loading(true);
  var f=sendQueue[sendQueueIdx];
  if(ui.progressText)ui.progressText.textContent='Préparation de ' + f.name + '...';
  updateFileTileCurrent();
  var reader=new FileReader();
  reader.onload=function(e){
    sendFileBuf=new Uint8Array(e.target.result);
    sendFile();
  };
  reader.readAsArrayBuffer(f);
}

function retryPeer(){
  if(peer)peer.destroy();
  peer=null;conn=null;
  startPeer();
}

function showDone(type){
  show(ui.stepDone);
  if(type==='sent'){
    var tot=sendQueue.reduce(function(s,f){return s+f.size},0);
    if(ui.recvName)ui.recvName.textContent=sendQueue.length+' fichier'+(sendQueue.length>1?'s':'')+' envoyé'+(sendQueue.length>1?'s':'');
    if(ui.recvSize)ui.recvSize.textContent=fmtSize(tot);
    hide(ui.recvDownload);
  }
}

// ---- Réception ----

function startReceive(code){
  hide(document.getElementById('panelRecv'));
  show(ui.progressWrap);
  if(ui.progressText)ui.progressText.textContent='Connexion...';
  msg('Connexion à '+code+'...','info');
  loading(true);
  recvFiles.forEach(function(f){if(f.url)URL.revokeObjectURL(f.url)});
  recvFiles=[];
  recvChunks=[];

  peer=new Peer();

  peer.on('open',function(){
    console.log('[WiShare][recv] peer open, id=',peer.id,'-> connecting to', code);
    conn=peer.connect(code,{reliable:true,serialization:'binary'});
    recvChunks=[];

    var timeout=setTimeout(function(){
      if(!conn||!conn.open){
        console.warn('[WiShare][recv] timeout 30s, conn.open=',conn&&conn.open);
        loading(false);showAnim(false);
        showToast('Délai dépassé pour le code : '+code,'warn');
        msg('Délai de connexion dépassé. Vérifiez le code.','err');
        hide(ui.progressWrap);
        show(document.getElementById('panelRecv'));
        if(peer)peer.destroy();
      }
    },30000);

    conn.on('open',function(){
      console.log('[WiShare][recv] conn open, conn.open=',conn.open,'serialization=',conn.serialization);
      clearTimeout(timeout);
      showToast('Connecté à l\'expéditeur — réception en cours','ok');
      if(ui.progressText)ui.progressText.textContent='Connecté ! Réception...';
      msg('Réception du fichier...','info');
      showAnim(true);
    });
    conn.on('close',function(){
      if(recvFiles.length>0){
        showRecvList();
        showToast(recvFiles.length+' fichier'+(recvFiles.length>1?'s':'')+' reçu'+(recvFiles.length>1?'s':''),'ok');
      }else{
        loading(false);showAnim(false);
        showToast('Connexion perdue (expéditeur déconnecté)','warn');
        msg('Connexion perdue — l\'expéditeur a peut-être expiré.','err');
        hide(ui.progressWrap);
        show(document.getElementById('panelRecv'));
      }
      if(peer)peer.destroy();
    });

    var recvMeta=null;
    var recvDone=false;
    var pendingBlobs=0;

    function handleBinary(buf){
      if(recvDone)return;
      recvChunks.push(buf);
      var total=recvMeta?recvMeta.total:recvChunks.length;
      var pct=Math.round(recvChunks.length/total*100);
      if(ui.progressFill)ui.progressFill.style.width=Math.min(95,pct)+'%';
      if(ui.progressText)ui.progressText.textContent='Réception... '+recvChunks.length+' / '+(recvMeta?recvMeta.total:'?')+' paquets';
      if(recvMeta&&recvChunks.length>=recvMeta.total&&pendingBlobs===0){
        recvDone=true;finishRecv(recvMeta);
      }
    }

    conn.on('data',function(data){
      if(typeof data==='string'){
        if(data==='ALL_DONE'){
          showRecvList();
          return;
        }
        if(data==='DONE'&&recvMeta&&!recvDone){
          recvDone=true;if(pendingBlobs===0)finishRecv(recvMeta);
        }else{
          try{var m=JSON.parse(data);if(m&&m.type==='meta'){
            if(m.size>500*1024*1024){
              showToast(m.name+' trop volumineux (max 500 Mo)','warn');recvMeta=null;
              if(conn)try{conn.send('REFUSE')}catch(e){}
              return;
            }
            recvMeta=m;recvChunks=[];recvDone=false;
            var idx=recvFiles.length+1;
            if(ui.progressText)ui.progressText.textContent='['+idx+'/?) '+m.name+' 0/'+m.total;
          }}catch(e){}
        }
        return;
      }
      if(data instanceof ArrayBuffer){
        handleBinary(data);
      }else if(ArrayBuffer.isView(data)){
        handleBinary(data.slice().buffer);
      }else if(data instanceof Blob){
        pendingBlobs++;
        var r=new FileReader();
        r.onload=function(e){pendingBlobs--;handleBinary(e.target.result)};
        r.readAsArrayBuffer(data);
      }
    });
  });

  peer.on('error',function(e){
    console.error('[WiShare][recv] peer error:', e.type, e);
    loading(false);
    if(e.type==='peer-unavailable'){
      showToast('Code introuvable','warn');
      msg('Code introuvable. Vérifiez le code et réessayez.','err');
    }else if(e.type==='network'){
      showToast('Erreur réseau — impossible de joindre le pair','warn');
      msg('Erreur réseau. Vérifiez que l\'expéditeur est en ligne.','err');
    }else if(e.type==='negotiation-failed'){
      showToast('Échec de connexion — impossible de joindre l\'expéditeur directement. Essayez sur un autre réseau.','warn');
      msg('Échec de connexion (negotiation-failed). Le pare-feu ou le NAT bloque la liaison. Essayez de partager depuis un autre réseau (ex: tous les deux en WiFi domestique).','err');
    }else{
      showToast('Erreur : '+e.type,'warn');
      msg('Erreur: '+e.type,'err');
    }
    hide(ui.progressWrap);
    show(document.getElementById('panelRecv'));
  });
}

function guessMimeFromName(name){
  var ext=(name||'').split('.').pop().toLowerCase();
  var map={jpg:'image/jpeg',jpeg:'image/jpeg',png:'image/png',gif:'image/gif',webp:'image/webp',svg:'image/svg+xml',
    mp4:'video/mp4',webm:'video/webm',mov:'video/quicktime',
    mp3:'audio/mpeg',wav:'audio/wav',ogg:'audio/ogg',
    pdf:'application/pdf',
    txt:'text/plain',md:'text/markdown',json:'application/json',csv:'text/csv'};
  return map[ext]||'';
}

function getPreviewKind(type){
  if(!type)return null;
  if(type.startsWith('image/'))return 'image';
  if(type.startsWith('video/'))return 'video';
  if(type.startsWith('audio/'))return 'audio';
  if(type==='application/pdf')return 'pdf';
  if(type.startsWith('text/')||type==='application/json')return 'text';
  return null;
}

function showPreviewModal(kind, url, blob, name){
  var overlay=document.createElement('div');
  overlay.className='preview-overlay';
  var html='<div class="preview-overlay-bg"></div><div class="preview-overlay-media"><button class="preview-overlay-close" style="position:absolute;top:8px;right:8px;z-index:1"><i class="fa-solid fa-xmark"></i></button>';
  if(kind==='image'){
    html+='<img src="'+url+'" alt="'+escHtml(name)+'" style="max-width:100%;max-height:80vh;border-radius:8px">';
  }else if(kind==='video'){
    html+='<video src="'+url+'" controls style="max-width:100%;max-height:75vh;border-radius:8px;width:auto"></video>';
  }else if(kind==='audio'){
    html+='<audio src="'+url+'" controls style="width:320px;max-width:100%"></audio>';
  }else if(kind==='pdf'){
    html+='<iframe src="'+url+'"></iframe>';
  }else if(kind==='text'){
    html+='<pre></pre>';
  }
  html+='<button class="btn primary small preview-dl-btn" style="width:100%;justify-content:center"><i class="fa-solid fa-download"></i> Télécharger</button></div>';
  overlay.innerHTML=html;
  document.body.appendChild(overlay);
  requestAnimationFrame(function(){overlay.classList.add('active')});
  overlay.onclick=function(e){
    if(e.target===overlay||e.target.closest('.preview-overlay-close')){overlay.classList.remove('active');setTimeout(function(){if(overlay.parentNode)overlay.parentNode.removeChild(overlay)},300)}
  };
  var dlBtn=overlay.querySelector('.preview-dl-btn');
  if(dlBtn)dlBtn.onclick=function(){downloadBlob(blob,name)};
  if(kind==='text'){
    var pre=overlay.querySelector('pre');
    if(pre)blob.slice(0,20000).text().then(function(t){pre.textContent=t+(blob.size>20000?'\n\n… (aperçu tronqué)':'')}).catch(function(){pre.textContent='Aperçu indisponible.'});
  }
}

function finishRecv(meta){
  if(recvChunks.length===0){loading(false);showToast('Aucune donnée reçue','warn');return}
  var mime=(meta&&meta.mime)||guessMimeFromName(meta?meta.name:'')||'application/octet-stream';
  var blob=new Blob(recvChunks,{type:mime});
  var url=URL.createObjectURL(blob);
  var name=meta?meta.name:'fichier_recu';
  recvFiles.push({name:name,size:blob.size,mime:mime,url:url,blob:blob});
  recvChunks=[];
  if(ui.progressFill)ui.progressFill.style.width='100%';
  var idx=recvFiles.length;
  if(ui.progressText)ui.progressText.textContent='['+idx+'/?] '+name+' reçu !';
  showToast(name+' reçu ('+idx+' fichier'+(idx>1?'s':'')+')','ok');
  showRecvList();
}

function showRecvList(){
  if(!ui.recvName||!ui.recvSize)return;
  loading(false);
  var totalSize=recvFiles.reduce(function(s,f){return s+f.size},0);
  ui.recvName.textContent=recvFiles.length+' fichier'+(recvFiles.length>1?'s':'')+' reçu'+(recvFiles.length>1?'s':'');
  ui.recvSize.textContent=fmtSize(totalSize);
  var html='';
  for(var i=0;i<recvFiles.length;i++){
    var f=recvFiles[i];
    var pk=getPreviewKind(f.mime);
    html+='<div class="recv-file"><span class="recv-file-icon"><i class="'+getFileIcon(f.mime)+'"></i></span><span class="recv-file-name">'+escHtml(f.name)+'</span><span class="recv-file-size">'+fmtSize(f.size)+'</span>'+(pk?'<button class="recv-file-preview" data-idx="'+i+'" title="Aperçu"><i class="fa-solid fa-eye"></i></button>':'')+'<button class="recv-file-dl" data-idx="'+i+'" title="Télécharger"><i class="fa-solid fa-download"></i></button></div>';
  }
  var box=document.getElementById('recvFileList');
  if(box){
    box.innerHTML=html;
    box.onclick=function(e){
      var dl=e.target.closest('.recv-file-dl');
      if(dl){
        var idx=parseInt(dl.getAttribute('data-idx'),10);
        var f=recvFiles[idx];
        if(f)downloadBlob(f.blob,f.name);
        return;
      }
      var btn=e.target.closest('.recv-file-preview');
      if(!btn)return;
      var idx=parseInt(btn.getAttribute('data-idx'),10);
      var f=recvFiles[idx];
      if(!f)return;
      var kind=getPreviewKind(f.mime);
      if(kind)showPreviewModal(kind, f.url, f.blob, f.name);
    };
  }
  if(recvFiles.length===1){
    var last=recvFiles[0];
    if(ui.recvDownload){ui.recvDownload.href=last.url;ui.recvDownload.download=last.name;ui.recvDownload.innerHTML='<i class="fa-solid fa-download"></i> Télécharger'}
    show(ui.recvDownload);
  }else{
    hide(ui.recvDownload);
  }
  showAnim(false);
  hide(ui.progressWrap);
  show(ui.stepDone);
  msg('','');
  hide(ui.status);
}

// ---- Initialisation ----

(function(){
  var hash=location.hash.replace(/^#/,'').trim();
  if(hash){
    SHARE_CODE=hash;
    if(document.getElementById('panelShare'))hide(document.getElementById('panelShare'));
    if(document.getElementById('panelRecv'))show(document.getElementById('panelRecv'));
    var tr=document.getElementById('tabRecv');if(tr)tr.classList.add('active');
    var ts=document.getElementById('tabShare');if(ts)ts.classList.remove('active');
    startReceive(hash);
  }else{
    show(ui.stepMode);
    if(document.getElementById('panelRecv'))hide(document.getElementById('panelRecv'));
  }
  window.addEventListener('hashchange',function(){location.reload()});
})();

// ---- UI ----

if(ui.recvDownload)ui.recvDownload.onclick=function(e){
  e.preventDefault();
  if(recvFiles.length===1)downloadBlob(recvFiles[0].blob,recvFiles[0].name);
};

if(ui.codeDisplay)ui.codeDisplay.onclick=function(){
  if(SHARE_CODE){
    navigator.clipboard.writeText(SHARE_CODE).catch(function(){});
    var old=ui.codeDisplay.textContent;
    ui.codeDisplay.textContent='Copié !';
    setTimeout(function(){if(ui.codeDisplay)ui.codeDisplay.textContent=old},1500);
  }
};

if(ui.recvBtn)ui.recvBtn.onclick=function(){
  var code=ui.codeInput.value.trim();
  if(code)startReceive(code);
};

if(ui.codeInput){
  ui.codeInput.addEventListener('keydown',function(e){
    if(e.key==='Enter'&&ui.codeInput.value.trim()){
      if(ui.recvBtn)ui.recvBtn.click();
    }
  });
  ui.codeInput.addEventListener('input',function(){
    this.value=this.value.toUpperCase().replace(/[^A-Z0-9]/g,'').slice(0,8);
  });
}

if(ui.shareAgain)ui.shareAgain.onclick=function(){var t=document.getElementById('tabShare');if(t)t.click()};

var tabShare=document.getElementById('tabShare');
var tabRecv=document.getElementById('tabRecv');
if(tabShare)tabShare.onclick=function(){
  if(peer){peer.destroy();peer=null}
  conn=null;
  if(tabShare)tabShare.classList.add('active');
  if(tabRecv)tabRecv.classList.remove('active');
  if(document.getElementById('panelShare'))show(document.getElementById('panelShare'));
  if(document.getElementById('panelRecv'))hide(document.getElementById('panelRecv'));
  hide(ui.progressWrap);
  hide(ui.stepDone);
  resetShare();
};
if(tabRecv)tabRecv.onclick=function(){
  if(peer){peer.destroy();peer=null}
  conn=null;
  if(tabRecv)tabRecv.classList.add('active');
  if(tabShare)tabShare.classList.remove('active');
  if(document.getElementById('panelRecv'))show(document.getElementById('panelRecv'));
  if(document.getElementById('panelShare'))hide(document.getElementById('panelShare'));
  hide(ui.progressWrap);
  hide(ui.stepDone);
};

var cancelBtn=document.getElementById('cancelShare');
if(cancelBtn)cancelBtn.onclick=function(){resetShare()};

// Preview lightbox
document.addEventListener('click',function(e){
  var img=e.target.closest('.file-preview-img.clickable');
  if(!img)return;
  var url=img.getAttribute('data-url');
  if(!url)return;
  var overlay=document.createElement('div');
  overlay.className='preview-overlay';
  overlay.innerHTML='<div class="preview-overlay-bg"></div><div class="preview-overlay-content"><button class="preview-overlay-close"><i class="fa-solid fa-xmark"></i></button><img src="'+url+'" alt="Aperçu"></div>';
  document.body.appendChild(overlay);
  requestAnimationFrame(function(){overlay.classList.add('active')});
  overlay.onclick=function(e){
    if(e.target===overlay||e.target.closest('.preview-overlay-close')){overlay.classList.remove('active');setTimeout(function(){if(overlay.parentNode)overlay.parentNode.removeChild(overlay)},300)}
  };
});