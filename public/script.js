var CHUNK = 65536;
var SHARE_CODE = null;
var peer = null;
var conn = null;
var fileToSend = null;
var fileBuf = null;
var recvChunks = [];
var recvBlob = null;
var recvBlobName = '';
var recvBlobUrl = null;
var historyEntries = [];
var STORAGE_KEY = 'wishare-history';

function showToast(msg, level){
  level = level || 'info';
  var icons = {info:'fa-solid fa-circle-info',ok:'fa-solid fa-circle-check',warn:'fa-solid fa-circle-exclamation'};
  var icon = icons[level] || icons.info;
  var c = document.getElementById('toastContainer');
  if(!c)return;
  var el = document.createElement('div');
  el.className = 'toast ' + level;
  el.innerHTML = '<span class="toast-icon"><i class="' + icon + '"></i></span><span class="toast-msg">' + msg + '</span>';
  c.appendChild(el);
  setTimeout(function(){el.classList.add('out');setTimeout(function(){if(el.parentNode)el.parentNode.removeChild(el)},300)},3500);
}

function addHistory(files, size, count){
  var entry = {id:Date.now()+'-'+(Math.random()*1e6|0), date:new Date().toISOString(), count:count, size:size, files:files};
  historyEntries = [entry].concat(historyEntries).slice(0,50);
  try{localStorage.setItem(STORAGE_KEY, JSON.stringify(historyEntries))}catch(e){}
  renderHistory();
  updateStats();
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

function updateStats(){
  var totalUploads = historyEntries.length;
  var totalFiles = historyEntries.reduce(function(s,h){return s+h.count},0);
  var totalBytes = historyEntries.reduce(function(s,h){return s+h.size},0);
  var el = document.getElementById('statUploads');if(el)el.textContent = totalUploads;
  el = document.getElementById('statFiles');if(el)el.textContent = totalFiles;
  el = document.getElementById('statBytes');if(el)el.textContent = fmtSize(totalBytes);
}

document.getElementById('clearHistory').onclick=function(){
  historyEntries = [];
  try{localStorage.removeItem(STORAGE_KEY)}catch(e){}
  renderHistory();
  updateStats();
  showToast('Historique effacé','warn');
};

(function(){
  try{
    var raw = localStorage.getItem(STORAGE_KEY);
    if(raw) historyEntries = JSON.parse(raw);
  }catch(e){}
  renderHistory();
  updateStats();
  showToast('WiShare prêt','ok');
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

var ids = 'status,stepMode,fileInput,stepCode,codeDisplay,qrContainer,codeInput,recvBtn,progressWrap,progressFill,progressText,stepDone,recvName,recvSize,recvDownload,shareAgain,stepCodeBadge,stepCodeSub,filePreview,recvPreviewBtn,recvPreviewBox';
ids.split(',').forEach(function(k){ui[k]=document.getElementById(k)});
ui.dropZone=ui.stepMode;

function show(el){if(el)el.classList.remove('hidden')}
function hide(el){if(el)el.classList.add('hidden')}

function msg(t,type){
  if(!ui.status)return;
  ui.status.className='msg msg-'+(type||'info');
  ui.status.textContent=t;
  show(ui.status);
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
      container.innerHTML='<div class="file-preview-img"><img src="'+e.target.result+'" alt="'+escHtml(file.name)+'"></div>';
    };
    r.readAsDataURL(file);
  }else{
    container.innerHTML='<div class="file-preview-icon"><i class="'+getFileIcon(file.type)+'"></i></div>';
  }
}

function resetShare(){
  loading(false);
  fileToSend=null;fileBuf=null;
  if(peer){peer.destroy();peer=null}
  conn=null;
  SHARE_CODE=null;
  if(recvBlobUrl){URL.revokeObjectURL(recvBlobUrl);recvBlobUrl=null}
  recvBlob=null;recvBlobName='';
  if(ui.recvPreviewBox){hide(ui.recvPreviewBox);ui.recvPreviewBox.innerHTML=''}
  if(ui.recvPreviewBtn)hide(ui.recvPreviewBtn);
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
  if(e.dataTransfer.files.length)onFile(e.dataTransfer.files[0]);
};
ui.fileInput.onchange=function(){
  if(ui.fileInput.files.length)onFile(ui.fileInput.files[0]);
};

function onFile(f){
  if(f.size>500*1024*1024){showToast('Fichier trop volumineux (max 500 Mo)','warn');return}
  fileToSend=f;
  hide(ui.stepMode);
  show(ui.stepCode);
  if(ui.stepCodeBadge)ui.stepCodeBadge.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> Préparation...';
  if(ui.stepCodeSub)ui.stepCodeSub.textContent = 'Lecture de ' + f.name + '...';
  if(ui.codeDisplay)ui.codeDisplay.textContent = '---';
  if(ui.qrContainer)ui.qrContainer.innerHTML = '';
  showFilePreview(f, ui.filePreview);
  msg('','');
  hide(ui.status);

  loading(true);
  var reader=new FileReader();
  reader.onload=function(e){
    fileBuf=new Uint8Array(e.target.result);
    showToast('Fichier chargé : '+f.name+' ('+fmtSize(fileBuf.length)+')','ok');
    startPeer();
  };
  reader.readAsArrayBuffer(fileToSend);
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
    conn.on('close',function(){
      console.warn('[WiShare][send] conn closed');
      if(!fileToSend)return;
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
  var total=Math.ceil(fileBuf.length/CHUNK);
  var meta={type:'meta',name:fileToSend.name,size:fileToSend.size,total:total,mime:fileToSend.type||''};
  console.log('[WiShare][send] sendFile start, total chunks=',total,'conn.open=',conn.open);
  conn.send(JSON.stringify(meta));

  var idx=0;
  function next(){
    if(idx>=total||!conn.open){
      if(idx>=total){
        try{conn.send('DONE')}catch(e){}
        loading(false);
        if(ui.progressFill)ui.progressFill.style.width='100%';
        if(ui.progressText)ui.progressText.textContent='Envoyé !';
        showToast('Fichier envoyé : '+fileToSend.name,'ok');
        addHistory([{name:fileToSend.name,size:fileToSend.size,type:fileToSend.type}], fileToSend.size, 1);
        showDone('sent');
      }else{
        console.warn('[WiShare][send] abandon à idx=',idx,'/',total,'conn.open=',conn.open);
      }
      return;
    }
    var s=idx*CHUNK,e=Math.min(s+CHUNK,fileBuf.length);
    try{conn.send(fileBuf.slice(s,e).buffer)}catch(err){console.error('[WiShare][send] erreur send chunk',idx,err);showToast('Erreur d\'envoi','warn');return}
    idx++;
    if(idx<=3||idx===total)console.log('[WiShare][send] chunk',idx,'/',total,'envoyé');
    if(ui.progressFill)ui.progressFill.style.width=Math.round(idx/total*100)+'%';
    if(ui.progressText)ui.progressText.textContent='Envoi... '+idx+'/'+total;
    setTimeout(next,10);
  }
  next();
}

function showDone(type){
  show(ui.stepDone);
  if(type==='sent'){
    if(ui.recvName)ui.recvName.textContent=fileToSend.name;
    if(ui.recvSize)ui.recvSize.textContent=fmtSize(fileToSend.size);
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
  if(recvBlobUrl){URL.revokeObjectURL(recvBlobUrl);recvBlobUrl=null}
  recvBlob=null;recvBlobName='';
  if(ui.recvPreviewBox){hide(ui.recvPreviewBox);ui.recvPreviewBox.innerHTML=''}
  if(ui.recvPreviewBtn)hide(ui.recvPreviewBtn);

  peer=new Peer();

  peer.on('open',function(){
    console.log('[WiShare][recv] peer open, id=',peer.id,'-> connecting to', code);
    conn=peer.connect(code,{reliable:true,serialization:'binary'});
    recvChunks=[];

    var timeout=setTimeout(function(){
      if(!conn||!conn.open){
        console.warn('[WiShare][recv] timeout 30s, conn.open=',conn&&conn.open);
        loading(false);
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
    });
    conn.on('close',function(){
      console.warn('[WiShare][recv] conn closed, chunks reçus=',recvChunks.length);
      loading(false);
      showToast('Connexion perdue (expéditeur déconnecté)','warn');
      msg('Connexion perdue — l\'expéditeur a peut-être expiré.','err');
      hide(ui.progressWrap);
      show(document.getElementById('panelRecv'));
      if(peer)peer.destroy();
    });

    var recvMeta=null;
    var pendingBlobs=0;

    function handleBinary(buf){
      recvChunks.push(buf);
      var total=recvMeta?recvMeta.total:recvChunks.length;
      var pct=Math.round(recvChunks.length/total*100);
      if(ui.progressFill)ui.progressFill.style.width=Math.min(95,pct)+'%';
      if(ui.progressText)ui.progressText.textContent='Réception... '+recvChunks.length+' / '+(recvMeta?recvMeta.total:'?')+' paquets';
      if(recvMeta&&recvChunks.length>=recvMeta.total&&pendingBlobs===0){
        finishRecv(recvMeta);
      }
    }

    conn.on('data',function(data){
      console.log('[WiShare][recv] data reçu, type=', typeof data, data instanceof ArrayBuffer?'ArrayBuffer':(ArrayBuffer.isView(data)?'TypedArray':(data instanceof Blob?'Blob':typeof data)), data && data.byteLength!==undefined?data.byteLength:(data&&data.size!==undefined?data.size:''));
      if(typeof data==='string'){
        if(data==='DONE'&&recvMeta){
          if(pendingBlobs===0)finishRecv(recvMeta);
        }else{
          try{var m=JSON.parse(data);if(m&&m.type==='meta'){recvMeta=m;if(ui.progressText)ui.progressText.textContent='Réception... 0 / '+m.total+' paquets';}}catch(e){}
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

function setupPreview(mime, url, blob, name){
  var kind=getPreviewKind(mime);
  if(!kind||!ui.recvPreviewBtn){
    if(ui.recvPreviewBtn)hide(ui.recvPreviewBtn);
    if(ui.recvPreviewBox){hide(ui.recvPreviewBox);ui.recvPreviewBox.innerHTML='';}
    return;
  }
  show(ui.recvPreviewBtn);
  var opened=false;
  ui.recvPreviewBtn.onclick=function(){
    if(opened){
      hide(ui.recvPreviewBox);
      ui.recvPreviewBtn.innerHTML='<i class="fa-solid fa-eye"></i> Aperçu';
      opened=false;
      return;
    }
    renderPreview(kind, url, blob, name);
    show(ui.recvPreviewBox);
    ui.recvPreviewBtn.innerHTML='<i class="fa-solid fa-eye-slash"></i> Masquer';
    opened=true;
  };
}

function renderPreview(kind, url, blob, name){
  if(!ui.recvPreviewBox)return;
  var box=ui.recvPreviewBox;
  var common='max-width:100%;border-radius:12px;display:block;margin:0 auto';
  if(kind==='image'){
    box.innerHTML='<img src="'+url+'" alt="'+escHtml(name)+'" style="'+common+'">';
  }else if(kind==='video'){
    box.innerHTML='<video src="'+url+'" controls style="'+common+';max-height:420px;width:100%"></video>';
  }else if(kind==='audio'){
    box.innerHTML='<audio src="'+url+'" controls style="width:100%"></audio>';
  }else if(kind==='pdf'){
    box.innerHTML='<iframe src="'+url+'" style="width:100%;height:480px;border:0;border-radius:12px;background:#fff"></iframe>';
  }else if(kind==='text'){
    box.innerHTML='<pre style="max-height:320px;overflow:auto;white-space:pre-wrap;word-break:break-word;font-size:13px;padding:12px;border-radius:12px;background:rgba(127,127,127,.08)"></pre>';
    var pre=box.querySelector('pre');
    blob.slice(0,20000).text().then(function(t){
      pre.textContent=t+(blob.size>20000?'\n\n… (aperçu tronqué)':'');
    }).catch(function(){pre.textContent='Aperçu indisponible.'});
  }
}

function shareOrDownload(e){
  if(!recvBlob)return;
  if(navigator.share && navigator.canShare){
    try{
      var file=new File([recvBlob], recvBlobName, {type:recvBlob.type||'application/octet-stream'});
      if(navigator.canShare({files:[file]})){
        e.preventDefault();
        navigator.share({files:[file], title:recvBlobName}).catch(function(){});
        return;
      }
    }catch(err){console.warn('[WiShare][recv] navigator.share indisponible, fallback lien direct',err)}
  }
  // sinon on laisse le comportement natif de <a download> faire son travail (desktop / Android Chrome)
}

function finishRecv(meta){
  if(recvChunks.length===0){loading(false);showToast('Aucune donnée reçue','warn');return}
  loading(false);
  if(ui.progressFill)ui.progressFill.style.width='100%';
  if(ui.progressText)ui.progressText.textContent='Terminé !';
  var mime=(meta&&meta.mime)||guessMimeFromName(meta?meta.name:'')||'application/octet-stream';
  var blob=new Blob(recvChunks,{type:mime});
  if(recvBlobUrl)URL.revokeObjectURL(recvBlobUrl);
  var url=URL.createObjectURL(blob);
  var name=meta?meta.name:'fichier_recu';
  recvBlob=blob;recvBlobName=name;recvBlobUrl=url;
  if(ui.recvName)ui.recvName.textContent=name;
  if(ui.recvSize)ui.recvSize.textContent=fmtSize(blob.size);
  if(ui.recvDownload){ui.recvDownload.href=url;ui.recvDownload.download=name}
  setupPreview(mime, url, blob, name);
  hide(ui.progressWrap);
  show(ui.stepDone);
  show(ui.recvDownload);
  showToast('Fichier reçu : '+name,'ok');
  msg('Fichier reçu !','ok');
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

if(ui.recvDownload)ui.recvDownload.addEventListener('click', shareOrDownload);

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