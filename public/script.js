// ─────────────────────────────────────────────
//  FluxTrap — script principal
// ─────────────────────────────────────────────

var CHUNK       = 1048576;       // 1 Mo par chunk
var BUFFER_HIGH = 4 * 1024 * 1024;
var BUFFER_LOW  = 512 * 1024;

var SHARE_CODE     = null;
var peer           = null;
var conn           = null;
var sendQueue      = [];   // [{file, path}]
var sendQueueIdx   = 0;
var recvChunks     = [];
var recvFiles      = [];   // [{name,path,size,mime,url,blob}]
var historyEntries = [];

var STORAGE_KEY = 'fluxtrap-history';
var STATS_KEY   = 'fluxtrap-stats';

// ══════════════════════════════════════════════
//  HELPERS
// ══════════════════════════════════════════════

function escHtml(s){
  return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}
function fmtSize(b){
  if(!b) return '0 o';
  var k=1024, u=['o','Ko','Mo','Go'];
  var i=Math.floor(Math.log(b)/Math.log(k));
  return parseFloat((b/Math.pow(k,i)).toFixed(1))+' '+u[i];
}
function fmtSpeed(bps){
  if(bps<1024) return Math.round(bps)+' o/s';
  if(bps<1048576) return (bps/1024).toFixed(0)+' Ko/s';
  return (bps/1048576).toFixed(1)+' Mo/s';
}
function genCode(){
  var s='', c='ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  for(var i=0;i<8;i++) s+=c[Math.random()*c.length|0];
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
function guessMime(name){
  var ext=(name||'').split('.').pop().toLowerCase();
  var m={jpg:'image/jpeg',jpeg:'image/jpeg',png:'image/png',gif:'image/gif',webp:'image/webp',svg:'image/svg+xml',
    mp4:'video/mp4',webm:'video/webm',mov:'video/quicktime',mp3:'audio/mpeg',wav:'audio/wav',ogg:'audio/ogg',
    pdf:'application/pdf',txt:'text/plain',md:'text/markdown',json:'application/json',csv:'text/csv'};
  return m[ext]||'';
}
function getPreviewKind(type){
  if(!type) return null;
  if(type.startsWith('image/')) return 'image';
  if(type.startsWith('video/')) return 'video';
  if(type.startsWith('audio/')) return 'audio';
  if(type==='application/pdf')  return 'pdf';
  if(type.startsWith('text/')||type==='application/json') return 'text';
  return null;
}

// ══════════════════════════════════════════════
//  TOAST (limité : une seule notif à la fois par groupe)
// ══════════════════════════════════════════════

var _toastThrottle={};
function showToast(msg, level, throttleKey){
  level=level||'info';
  // Throttle optionnel : évite de spammer la même notif
  if(throttleKey){
    if(_toastThrottle[throttleKey]) return;
    _toastThrottle[throttleKey]=setTimeout(function(){delete _toastThrottle[throttleKey];},3000);
  }
  var icons={info:'fa-solid fa-circle-info',ok:'fa-solid fa-circle-check',warn:'fa-solid fa-circle-exclamation'};
  var c=document.getElementById('toastContainer'); if(!c) return;
  var el=document.createElement('div');
  el.className='toast '+level;
  el.innerHTML='<span class="toast-icon"><i class="'+(icons[level]||icons.info)+'"></i></span><span class="toast-msg">'+escHtml(msg)+'</span>';
  c.appendChild(el);
  setTimeout(function(){el.classList.add('out');setTimeout(function(){if(el.parentNode)el.parentNode.removeChild(el);},300);},3500);
}

// ══════════════════════════════════════════════
//  STATS & HISTORIQUE
// ══════════════════════════════════════════════

function loadStats(){ try{return JSON.parse(localStorage.getItem(STATS_KEY))||{uploads:0,files:0,bytes:0};}catch(e){} return{uploads:0,files:0,bytes:0}; }
function saveStats(s){ try{localStorage.setItem(STATS_KEY,JSON.stringify(s));}catch(e){} }
function updateStats(s){
  s=s||loadStats();
  var e=document.getElementById('statUploads'); if(e) e.textContent=s.uploads;
  e=document.getElementById('statFiles');      if(e) e.textContent=s.files;
  e=document.getElementById('statBytes');      if(e) e.textContent=fmtSize(s.bytes);
}
function addHistory(files,size,count){
  var entry={id:Date.now()+'-'+(Math.random()*1e6|0),date:new Date().toISOString(),count:count,size:size,files:files};
  historyEntries=[entry].concat(historyEntries).slice(0,50);
  try{localStorage.setItem(STORAGE_KEY,JSON.stringify(historyEntries));}catch(e){}
  renderHistory();
  var s=loadStats(); s.uploads++; s.files+=count; s.bytes+=size;
  saveStats(s); updateStats(s);
}
function renderHistory(){
  var empty=document.getElementById('historyEmpty'), list=document.getElementById('historyList');
  if(historyEntries.length===0){ if(empty)empty.classList.remove('hidden'); if(list)list.classList.add('hidden'); return; }
  if(empty)empty.classList.add('hidden'); if(list)list.classList.remove('hidden');
  var html='';
  historyEntries.forEach(function(h){
    var names=h.files.slice(0,2).map(function(f){return f.name;}).join(', ');
    var extra=h.count>2?' + '+(h.count-2)+' autre'+(h.count-2>1?'s':''):'';
    var date=new Date(h.date).toLocaleString(undefined,{day:'2-digit',month:'short',hour:'2-digit',minute:'2-digit'});
    html+='<div class="history-item"><span class="history-icon"><i class="fa-solid fa-file-zipper"></i></span><div class="history-info"><div class="history-name">'+escHtml(names)+escHtml(extra)+'</div><div class="history-meta">'+h.count+' fichier'+(h.count>1?'s':'')+' · '+fmtSize(h.size)+' · '+date+'</div></div><i class="fa-solid fa-chevron-right history-arrow"></i></div>';
  });
  if(list) list.innerHTML=html;
}
(function(){
  try{ var r=localStorage.getItem(STORAGE_KEY); if(r) historyEntries=JSON.parse(r); }catch(e){}
  renderHistory(); updateStats(loadStats());
})();
document.getElementById('clearHistory').onclick=function(){
  historyEntries=[]; try{localStorage.removeItem(STORAGE_KEY);}catch(e){} renderHistory(); showToast('Historique effacé','warn');
};

// GDPR
(function(){
  if(localStorage.getItem('fluxtrap-gdpr')){ var b=document.getElementById('gdprBanner'); if(b)b.classList.add('hidden'); }
})();
var gdprBtn=document.getElementById('gdprAccept');
if(gdprBtn) gdprBtn.onclick=function(){
  try{localStorage.setItem('fluxtrap-gdpr','1');}catch(e){}
  var b=document.getElementById('gdprBanner'); if(b)b.classList.add('hidden');
};

// ══════════════════════════════════════════════
//  UI REFS
// ══════════════════════════════════════════════

var ui={};
var loadingBar=document.getElementById('loadingBar');
function loading(on){ if(loadingBar) loadingBar.classList.toggle('active',on); }

'status,stepMode,fileInput,stepCode,codeDisplay,qrContainer,codeInput,recvBtn,progressWrap,progressFill,progressText,progressStats,stepDone,recvName,recvSize,recvDownload,shareAgain,stepCodeBadge,stepCodeSub,filePreview,transferAnim'
  .split(',').forEach(function(k){ ui[k]=document.getElementById(k); });
ui.dropZone=ui.stepMode;

function show(el){ if(el) el.classList.remove('hidden'); }
function hide(el){ if(el) el.classList.add('hidden'); }
function showAnim(on, mode){
  if(ui.transferAnim) ui.transferAnim.classList.toggle('hidden',!on);
  if(on){
    // mode 'send' : laptop → mobile  |  mode 'recv' : mobile → laptop
    var left=document.getElementById('transferLeft');
    var right=document.getElementById('transferRight');
    var track=document.getElementById('transferTrack');
    if(left&&right&&track){
      if(mode==='recv'){
        left.innerHTML='<i class="fa-solid fa-mobile-screen"></i>';
        right.innerHTML='<i class="fa-solid fa-laptop"></i>';
        track.classList.add('recv-mode');
      } else {
        left.innerHTML='<i class="fa-solid fa-laptop"></i>';
        right.innerHTML='<i class="fa-solid fa-mobile-screen"></i>';
        track.classList.remove('recv-mode');
      }
    }
  }
}
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

// ══════════════════════════════════════════════
//  DOWNLOAD — fix mobile définitif
//  Sur mobile, on n'utilise pas e.preventDefault()
//  et on crée le lien/clic de façon synchrone
// ══════════════════════════════════════════════

// Crée une blob URL et la retourne (à utiliser dans les href des <a>)
function makeBlobUrl(blob){
  return URL.createObjectURL(blob);
}

// Téléchargement programmatique — uniquement pour desktop/Android
// Sur iOS, on utilise de vrais <a href download> dans le DOM (voir renderRecvTree)
function downloadBlob(blob, name){
  var url=URL.createObjectURL(blob);
  var a=document.createElement('a');
  a.href=url; a.download=name; a.style.display='none';
  document.body.appendChild(a);
  a.click();
  setTimeout(function(){document.body.removeChild(a);URL.revokeObjectURL(url);},5000);
}

// ══════════════════════════════════════════════
//  RESET
// ══════════════════════════════════════════════

function resetShare(){
  loading(false); showAnim(false);
  sendQueue=[]; sendQueueIdx=0;
  if(peer){ peer.destroy(); peer=null; }
  conn=null; SHARE_CODE=null;
  recvFiles.forEach(function(f){if(f.url) URL.revokeObjectURL(f.url);});
  recvFiles=[];
  if(window._previewUrls){ window._previewUrls.forEach(function(u){URL.revokeObjectURL(u);}); window._previewUrls=null; }
  if(ui.filePreview){ ui.filePreview.innerHTML=''; ui.filePreview.style.display=''; }
  hide(ui.stepCode); hide(ui.progressWrap); hide(ui.stepDone);
  show(ui.stepMode);
  if(ui.codeDisplay) ui.codeDisplay.textContent='---';
  msg('','');
}

// ══════════════════════════════════════════════
//  ARBORESCENCE — construction du tree
// ══════════════════════════════════════════════

// Construit un objet tree à partir d'un tableau [{file,path}]
// tree = { _files:[], _dirs:{ nomDossier: <tree> } }
function buildTree(entries){
  var root={_files:[],_dirs:{}};
  entries.forEach(function(e){
    var parts=e.path.split('/').filter(Boolean);
    if(parts.length<=1){
      // fichier à la racine
      root._files.push(e);
    } else {
      // dans un dossier
      var node=root;
      for(var i=0;i<parts.length-1;i++){
        var seg=parts[i];
        if(!node._dirs[seg]) node._dirs[seg]={_files:[],_dirs:{}};
        node=node._dirs[seg];
      }
      node._files.push(e);
    }
  });
  return root;
}

// Rend le tree en HTML côté envoyeur
function renderSendTree(node, depth){
  depth=depth||0;
  var html='';
  // Dossiers
  Object.keys(node._dirs).sort().forEach(function(dirName){
    var child=node._dirs[dirName];
    var count=countTreeFiles(child);
    var uid='sd-'+Math.random().toString(36).slice(2);
    html+='<div class="tree-item tree-dir">';
    html+='<div class="tree-row" data-toggle="'+uid+'">';
    html+='<i class="fa-solid fa-chevron-right tree-chevron"></i>';
    html+='<i class="fa-solid fa-folder tree-folder-icon"></i>';
    html+='<span class="tree-name">'+escHtml(dirName)+'</span>';
    html+='<span class="tree-count">'+count+' fichier'+(count>1?'s':'')+'</span>';
    html+='</div>';
    html+='<div class="tree-children hidden" id="'+uid+'">';
    html+=renderSendTree(child, depth+1);
    html+='</div></div>';
  });
  // Fichiers
  node._files.forEach(function(e){
    var f=e.file;
    var active=sendQueue.indexOf(e)===sendQueueIdx?'tree-active':'';
    html+='<div class="tree-item tree-file '+active+'" data-entry-path="'+escHtml(e.path)+'">';
    html+='<div class="tree-row">';
    html+='<span class="tree-file-indent"></span>';
    html+='<i class="'+getFileIcon(f.type)+' tree-file-icon"></i>';
    html+='<span class="tree-name">'+escHtml(f.name)+'</span>';
    html+='<span class="tree-count">'+fmtSize(f.size)+'</span>';
    html+='</div></div>';
  });
  return html;
}

function countTreeFiles(node){
  var n=node._files.length;
  Object.keys(node._dirs).forEach(function(k){ n+=countTreeFiles(node._dirs[k]); });
  return n;
}

// Rend le tree en HTML côté receveur
// Les boutons DL sont de vrais <a href=blob: download> — seule solution fiable sur iOS
function renderRecvTree(node, depth){
  depth=depth||0;
  var html='';
  Object.keys(node._dirs).sort().forEach(function(dirName){
    var child=node._dirs[dirName];
    var count=countTreeFiles(child);
    var uid='rd-'+Math.random().toString(36).slice(2);
    html+='<div class="tree-item tree-dir">';
    html+='<div class="tree-row" data-toggle="'+uid+'">';
    html+='<i class="fa-solid fa-chevron-right tree-chevron"></i>';
    html+='<i class="fa-solid fa-folder tree-folder-icon"></i>';
    html+='<span class="tree-name">'+escHtml(dirName)+'</span>';
    html+='<span class="tree-count">'+count+' fichier'+(count>1?'s':'')+'</span>';
    html+='</div>';
    html+='<div class="tree-children hidden" id="'+uid+'">';
    html+=renderRecvTree(child, depth+1);
    html+='</div></div>';
  });
  node._files.forEach(function(f){
    var pk=getPreviewKind(f.mime);
    var idx=recvFiles.indexOf(f);
    // Blob URL créée à la volée et intégrée dans le href — fonctionne sur iOS Safari + Chrome
    var blobUrl=makeBlobUrl(f.blob);
    html+='<div class="tree-item tree-file">';
    html+='<div class="tree-row">';
    html+='<span class="tree-file-indent"></span>';
    html+='<i class="'+getFileIcon(f.mime)+' tree-file-icon"></i>';
    html+='<span class="tree-name">'+escHtml(f.name)+'</span>';
    html+='<span class="tree-count">'+fmtSize(f.size)+'</span>';
    html+='<span class="tree-actions">';
    if(pk) html+='<button class="recv-file-preview" data-idx="'+idx+'" title="Aperçu"><i class="fa-solid fa-eye"></i></button>';
    html+='<a class="recv-file-dl" href="'+escHtml(blobUrl)+'" download="'+escHtml(f.name)+'" title="Télécharger"><i class="fa-solid fa-download"></i></a>';
    html+='</span>';
    html+='</div></div>';
  });
  return html;
}

// Active les toggles d'un container
function bindTreeToggles(container){
  // Gère click ET touchend pour mobile
  // _tapped évite le double-déclenchement touch → click
  var _tapped=false;

  function toggleRow(e){
    var row=e.target.closest('[data-toggle]');
    if(!row) return;
    // Ne pas interférer avec les boutons d'action
    if(e.target.closest('button')) return;
    e.preventDefault();
    var uid=row.getAttribute('data-toggle');
    var children=document.getElementById(uid);
    if(!children) return;
    var open=!children.classList.contains('hidden');
    children.classList.toggle('hidden',open);
    var chev=row.querySelector('.tree-chevron');
    if(chev) chev.classList.toggle('open',!open);
    var folderIcon=row.querySelector('.tree-folder-icon');
    if(folderIcon){
      folderIcon.className=(open?'fa-solid fa-folder':'fa-solid fa-folder-open')+' tree-folder-icon';
    }
  }

  container.addEventListener('touchend',function(e){
    var row=e.target.closest('[data-toggle]');
    if(!row||e.target.closest('button')) return;
    _tapped=true;
    toggleRow(e);
    setTimeout(function(){_tapped=false;},400);
  },{passive:false});

  container.addEventListener('click',function(e){
    if(_tapped) return; // déjà géré par touchend
    toggleRow(e);
  });
}

// ══════════════════════════════════════════════
//  AFFICHAGE ENVOYEUR — tree
// ══════════════════════════════════════════════

var _sendTree=null;

function showSendTree(entries, container){
  if(!container) return;
  container.style.display='block';
  _sendTree=buildTree(entries);
  var html='<div class="file-tree">'+renderSendTree(_sendTree,0)+'</div>';
  container.innerHTML=html;
  bindTreeToggles(container);
}

function updateSendTreeActive(){
  if(!ui.filePreview) return;
  var current=sendQueue[sendQueueIdx];
  ui.filePreview.querySelectorAll('.tree-file').forEach(function(el){
    var p=el.getAttribute('data-entry-path');
    el.classList.toggle('tree-active', current&&p===current.path);
  });
}

// ══════════════════════════════════════════════
//  SÉLECTION FICHIERS / DOSSIERS
// ══════════════════════════════════════════════

function readEntry(entry, basePath){
  return new Promise(function(resolve){
    if(entry.isFile){
      entry.file(function(f){ resolve([{file:f,path:(basePath?basePath+'/':'')+f.name}]); }, function(){resolve([]);});
    } else if(entry.isDirectory){
      var reader=entry.createReader();
      var results=[];
      var dirPath=(basePath?basePath+'/':'')+entry.name;
      function readAll(){
        reader.readEntries(function(entries){
          if(!entries.length){ resolve(results); return; }
          var pending=entries.length;
          entries.forEach(function(e){
            readEntry(e,dirPath).then(function(items){ results=results.concat(items); if(--pending===0) readAll(); });
          });
        }, function(){resolve(results);});
      }
      readAll();
    } else { resolve([]); }
  });
}

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
    return Promise.resolve(Array.from(dataTransfer.files).map(function(f){return{file:f,path:f.name};}));
  }
  return Promise.all(promises).then(function(arrs){ return[].concat.apply([],arrs); });
}

function onEntries(entries){
  var valid=[];
  entries.forEach(function(e){
    if(e.file.size>500*1024*1024){ showToast(e.file.name+' trop volumineux (max 500 Mo)','warn'); return; }
    if(e.file.size===0){ showToast(e.file.name+' vide, ignoré','warn'); return; }
    valid.push(e);
  });
  if(!valid.length) return;
  sendQueue=valid; sendQueueIdx=0;
  hide(ui.stepMode); show(ui.stepCode);
  msg('','');
  showSendTree(valid, ui.filePreview);
  nextFile();
}

function onFiles(files){
  onEntries(Array.from(files).map(function(f){
    return{file:f, path:f.webkitRelativePath||f.name};
  }));
}

// ── Drop zone events ──────────────────────────

ui.dropZone.ondragover=function(e){ e.preventDefault(); ui.dropZone.classList.add('drag-over'); };
ui.dropZone.ondragleave=function(){ ui.dropZone.classList.remove('drag-over'); };
ui.dropZone.ondrop=function(e){ e.preventDefault(); ui.dropZone.classList.remove('drag-over'); getEntriesFromDrop(e.dataTransfer).then(onEntries); };
ui.dropZone.onclick=function(ev){ if(ev.target.closest('button')) return; if(ui.fileInput) ui.fileInput.click(); };

var btnPickFiles=document.getElementById('btnPickFiles');
var btnPickFolder=document.getElementById('btnPickFolder');

if(btnPickFiles) btnPickFiles.onclick=function(e){
  e.stopPropagation(); if(ui.fileInput) ui.fileInput.click();
};
if(btnPickFolder) btnPickFolder.onclick=function(e){
  e.stopPropagation();
  var inp=document.createElement('input');
  inp.type='file'; inp.multiple=true;
  inp.setAttribute('webkitdirectory',''); inp.setAttribute('directory','');
  inp.style.cssText='position:fixed;top:-9999px;left:-9999px;opacity:0;pointer-events:none;';
  document.body.appendChild(inp);
  inp.onchange=function(){ if(inp.files.length) onFiles(inp.files); if(inp.parentNode) document.body.removeChild(inp); };
  window.addEventListener('focus',function cleanup(){ window.removeEventListener('focus',cleanup); setTimeout(function(){if(inp.parentNode)document.body.removeChild(inp);},2000); },{once:true});
  inp.click();
};
if(ui.fileInput) ui.fileInput.onchange=function(){ if(ui.fileInput.files.length) onFiles(ui.fileInput.files); ui.fileInput.value=''; };

// ══════════════════════════════════════════════
//  ENVOI — PEER + STREAMING
// ══════════════════════════════════════════════

function nextFile(){
  if(sendQueueIdx>=sendQueue.length){ showDone('sent'); return; }
  var f=sendQueue[sendQueueIdx].file;
  if(ui.stepCodeBadge) ui.stepCodeBadge.innerHTML='<i class="fa-solid fa-spinner fa-spin"></i> Préparation ('+(sendQueueIdx+1)+'/'+sendQueue.length+')...';
  if(ui.stepCodeSub)   ui.stepCodeSub.textContent=f.name+' · '+fmtSize(f.size);
  if(ui.codeDisplay)   ui.codeDisplay.textContent='---';
  if(ui.qrContainer)   ui.qrContainer.innerHTML='';
  updateSendTreeActive();
  loading(true);
  startPeer();
}

function startPeer(){
  var code=genCode();
  peer=new Peer(code);
  var expireTimer, connected=false;

  function showCode(){
    SHARE_CODE=code;
    if(ui.codeDisplay) ui.codeDisplay.textContent=code;
    hide(ui.progressWrap); hide(ui.stepDone);
    if(ui.stepCodeBadge) ui.stepCodeBadge.innerHTML='<i class="fa-solid fa-circle-check"></i> Prêt à partager';
    if(ui.stepCodeSub)   ui.stepCodeSub.textContent='Code : '+code+' — scannez le QR ou partagez le code';
    makeQR(location.origin+location.pathname.replace(/\/+$/,'')+'#'+code);
    loading(false);
    expireTimer=setTimeout(function(){ if(!connected){ showToast('Code expiré (15 min)','warn'); resetShare(); } },15*60*1000);
  }

  function onConnection(c){
    clearTimeout(expireTimer); connected=true; conn=c;
    conn.on('open',function(){
      loading(true);
      showToast('Destinataire connecté','ok');
      hide(ui.stepCode); show(ui.progressWrap);
      if(ui.progressText) ui.progressText.textContent='Envoi en cours...';
      showAnim(true,'send');
      sendAllFiles();
    });
    conn.on('data',function(d){ if(typeof d==='string'&&d==='REFUSE'){ sendQueueIdx++; sendAllFiles(); } });
    conn.on('close',function(){ showToast('Connexion perdue','warn'); resetShare(); });
    conn.on('error',function(e){ showToast('Erreur : '+e.type,'warn'); });
  }

  peer.on('open',function(){ showToast('Code : '+code,'ok'); showCode(); });
  peer.on('connection',function(c){ onConnection(c); });
  peer.on('error',function(e){
    if(e.type==='unavailable-id'){ if(peer)peer.destroy(); peer=null; conn=null; startPeer(); return; }
    loading(false);
    showToast({network:'Erreur réseau.','negotiation-failed':'Échec P2P — même réseau requis.'}[e.type]||('Erreur : '+e.type),'warn');
  });
}

// Détermine le dossier racine d'une entrée (premier segment du path)
function getRootFolder(entry){
  var parts=entry.path.split('/').filter(Boolean);
  return parts.length>1?parts[0]:null;
}

function sendAllFiles(){
  if(sendQueueIdx>=sendQueue.length){
    try{ conn.send('ALL_DONE'); }catch(e){}
    showToast('Transfert terminé — '+sendQueue.length+' fichier'+(sendQueue.length>1?'s':'')+' envoyé'+(sendQueue.length>1?'s':''),'ok');
    showDone('sent');
    return;
  }
  sendOneFile(sendQueue[sendQueueIdx], function(){
    sendQueueIdx++;
    updateSendTreeActive();
    sendAllFiles();
  });
}

function sendOneFile(entry, onDone){
  var f=entry.file;
  var path=entry.path||f.name;
  var totalChunks=Math.ceil(f.size/CHUNK)||1;
  var meta={type:'meta',name:f.name,path:path,size:f.size,total:totalChunks,mime:f.type||''};
  try{ conn.send(JSON.stringify(meta)); }catch(e){ return; }

  var chunkIdx=0, bytesSent=0, tStart=Date.now(), tLast=tStart, bLast=0;

  function updateProgress(){
    var pct=Math.round(chunkIdx/totalChunks*100);
    if(ui.progressFill) ui.progressFill.style.width=pct+'%';
    var now=Date.now(), dt=(now-tLast)/1000;
    if(dt>=0.4){
      var spd=(bytesSent-bLast)/dt;
      var eta=spd>0?Math.ceil((f.size-bytesSent)/spd):0;
      if(ui.progressText) ui.progressText.textContent='('+(sendQueueIdx+1)+'/'+sendQueue.length+') '+f.name;
      if(ui.progressStats) ui.progressStats.textContent=pct+'% · '+fmtSpeed(spd)+(eta>0?' · '+eta+'s':'');
      tLast=now; bLast=bytesSent;
    }
  }

  function sendChunk(){
    if(!conn||!conn.open) return;
    if(conn.dataChannel&&conn.dataChannel.bufferedAmount>BUFFER_HIGH){ setTimeout(sendChunk,10); return; }
    if(chunkIdx>=totalChunks){
      try{ conn.send('DONE'); }catch(e){}
      if(ui.progressFill) ui.progressFill.style.width='100%';
      // Notif seulement si fichier isolé (pas dans un dossier) ou dernier fichier d'un dossier
      var root=getRootFolder(entry);
      if(!root){
        showToast(f.name+' envoyé','ok','send-done');
      }
      addHistory([{name:f.name,size:f.size,type:f.type||''}],f.size,1);
      if(onDone) onDone();
      return;
    }
    var start=chunkIdx*CHUNK, end=Math.min(start+CHUNK,f.size);
    var reader=new FileReader();
    reader.onload=function(ev){
      if(!conn||!conn.open) return;
      var buf=ev.target.result;
      try{ conn.send(buf); }catch(err){ showToast('Erreur envoi','warn'); return; }
      bytesSent+=buf.byteLength; chunkIdx++;
      updateProgress();
      if(conn.dataChannel&&conn.dataChannel.bufferedAmount>BUFFER_LOW){ setTimeout(sendChunk,5); }
      else{ sendChunk(); }
    };
    reader.onerror=function(){ showToast('Erreur lecture','warn'); };
    reader.readAsArrayBuffer(f.slice(start,end));
  }
  sendChunk();
}

function showDone(type){
  show(ui.stepDone); loading(false); showAnim(false);
  if(type==='sent'){
    var n=sendQueue.length;
    var tot=sendQueue.reduce(function(s,e){return s+e.file.size;},0);
    if(ui.recvName) ui.recvName.textContent=n+' fichier'+(n>1?'s':'')+' envoyé'+(n>1?'s':'');
    if(ui.recvSize) ui.recvSize.textContent=fmtSize(tot);
    hide(ui.recvDownload);
    // Notification de fin côté envoyeur
    showToast(n+' fichier'+(n>1?'s':'')+' envoyé'+(n>1?'s':', ')+' ('+fmtSize(tot)+')','ok');
    // Arborescence côté envoyeur dans stepDone
    var box=document.getElementById('recvFileList');
    if(box&&_sendTree){
      box.innerHTML='<div class="file-tree recv-tree">'+renderSendTree(_sendTree,0)+'</div>';
      bindTreeToggles(box);
    }
  }
}

// ══════════════════════════════════════════════
//  RÉCEPTION
// ══════════════════════════════════════════════

function startReceive(code){
  hide(document.getElementById('panelRecv'));
  show(ui.progressWrap);
  if(ui.progressText) ui.progressText.textContent='Connexion...';
  if(ui.progressStats) ui.progressStats.textContent='';
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
        hide(ui.progressWrap); show(document.getElementById('panelRecv'));
        if(peer) peer.destroy();
      }
    },30000);

    conn.on('open',function(){
      clearTimeout(timeout);
      showToast('Connecté à l\'expéditeur','ok');
      if(ui.progressText) ui.progressText.textContent='Réception en cours...';
      showAnim(true,'recv');
    });

    conn.on('close',function(){
      if(recvFiles.length>0){
        showRecvListWithToast();
      } else {
        loading(false); showAnim(false);
        showToast('Connexion perdue','warn');
        hide(ui.progressWrap); show(document.getElementById('panelRecv'));
      }
      if(peer) peer.destroy();
    });

    var recvMeta=null, recvDone=false, pendingBlobs=0;
    var recvBytes=0, recvStart=Date.now();

    function handleBinary(buf){
      if(recvDone) return;
      recvChunks.push(buf); recvBytes+=buf.byteLength;
      var total=recvMeta?recvMeta.total:recvChunks.length;
      var pct=Math.round(recvChunks.length/total*100);
      if(ui.progressFill) ui.progressFill.style.width=Math.min(97,pct)+'%';
      var elapsed=(Date.now()-recvStart)/1000||0.001;
      var spd=recvBytes/elapsed;
      var eta=spd>0&&recvMeta?Math.ceil((recvMeta.size-recvBytes)/spd):0;
      if(ui.progressText) ui.progressText.textContent=recvMeta?recvMeta.name:'...';
      if(ui.progressStats) ui.progressStats.textContent=pct+'% · '+fmtSpeed(spd)+(eta>0?' · '+eta+'s':'');
      if(recvMeta&&recvChunks.length>=recvMeta.total&&pendingBlobs===0){ recvDone=true; finishRecv(recvMeta); }
    }

    conn.on('data',function(data){
      if(typeof data==='string'){
        if(data==='ALL_DONE'){ showRecvListWithToast(); return; }
        if(data==='DONE'&&recvMeta&&!recvDone){ recvDone=true; if(pendingBlobs===0) finishRecv(recvMeta); }
        else{
          try{
            var m=JSON.parse(data);
            if(m&&m.type==='meta'){
              if(m.size>500*1024*1024){ showToast(m.name+' trop volumineux','warn'); try{conn.send('REFUSE');}catch(e){} return; }
              recvMeta=m; recvChunks=[]; recvDone=false; recvBytes=0; recvStart=Date.now();
              if(ui.progressText) ui.progressText.textContent=m.name;
              if(ui.progressFill) ui.progressFill.style.width='0%';
              if(ui.progressStats) ui.progressStats.textContent='';
            }
          }catch(e){}
        }
        return;
      }
      if(data instanceof ArrayBuffer){ handleBinary(data); }
      else if(ArrayBuffer.isView(data)){ handleBinary(data.slice().buffer); }
      else if(data instanceof Blob){
        pendingBlobs++;
        var r=new FileReader(); r.onload=function(e){ pendingBlobs--; handleBinary(e.target.result); }; r.readAsArrayBuffer(data);
      }
    });
  });

  peer.on('error',function(e){
    loading(false);
    var msgs={'peer-unavailable':'Code introuvable.',network:'Erreur réseau.','negotiation-failed':'Échec P2P.'};
    showToast(msgs[e.type]||('Erreur : '+e.type),'warn');
    hide(ui.progressWrap); show(document.getElementById('panelRecv'));
  });
}

function finishRecv(meta){
  if(!recvChunks.length){ loading(false); showToast('Aucune donnée reçue','warn'); return; }
  var mime=(meta&&meta.mime)||guessMime(meta?meta.name:'')||'application/octet-stream';
  var blob=new Blob(recvChunks,{type:mime});
  var url=URL.createObjectURL(blob);
  var name=meta?meta.name:'fichier_recu';
  var path=meta?meta.path:name;
  recvFiles.push({name:name,path:path,size:blob.size,mime:mime,url:url,blob:blob});
  recvChunks=[];
  if(ui.progressFill) ui.progressFill.style.width='100%';
  // Mettre à jour la liste au fur et à mesure (sans toast par fichier)
  showRecvList();
}

// ══════════════════════════════════════════════
//  AFFICHAGE RECEVEUR — tree
// ══════════════════════════════════════════════

function buildRecvTree(files){
  var root={_files:[],_dirs:{}};
  files.forEach(function(f){
    var parts=f.path.split('/').filter(Boolean);
    if(parts.length<=1){ root._files.push(f); }
    else{
      var node=root;
      for(var i=0;i<parts.length-1;i++){
        var seg=parts[i];
        if(!node._dirs[seg]) node._dirs[seg]={_files:[],_dirs:{}};
        node=node._dirs[seg];
      }
      node._files.push(f);
    }
  });
  return root;
}

// renderRecvTreeNode est un alias de renderRecvTree (même logique, même structure)
function renderRecvTreeNode(node){ return renderRecvTree(node, 0); }

function countRecvTreeFiles(node){
  var n=node._files.length;
  Object.keys(node._dirs).forEach(function(k){ n+=countRecvTreeFiles(node._dirs[k]); });
  return n;
}

function showPreviewModal(kind,url,blob,name){
  var overlay=document.createElement('div');
  overlay.className='preview-overlay';
  var html='<div class="preview-overlay-bg"></div><div class="preview-overlay-media"><button class="preview-overlay-close" style="position:absolute;top:8px;right:8px;z-index:1"><i class="fa-solid fa-xmark"></i></button>';
  if(kind==='image')      html+='<img src="'+url+'" alt="'+escHtml(name)+'" style="max-width:100%;max-height:80vh;border-radius:8px">';
  else if(kind==='video') html+='<video src="'+url+'" controls style="max-width:100%;max-height:75vh;border-radius:8px;width:auto"></video>';
  else if(kind==='audio') html+='<audio src="'+url+'" controls style="width:320px;max-width:100%"></audio>';
  else if(kind==='pdf')   html+='<iframe src="'+url+'"></iframe>';
  else if(kind==='text')  html+='<pre></pre>';
  html+='<button class="btn primary small preview-dl-btn" style="width:100%;justify-content:center;margin-top:10px"><i class="fa-solid fa-download"></i> Télécharger</button></div>';
  overlay.innerHTML=html;
  document.body.appendChild(overlay);
  requestAnimationFrame(function(){overlay.classList.add('active');});
  overlay.onclick=function(e){ if(e.target===overlay||e.target.closest('.preview-overlay-close')){ overlay.classList.remove('active'); setTimeout(function(){if(overlay.parentNode)overlay.parentNode.removeChild(overlay);},300); } };
  var dlBtn=overlay.querySelector('.preview-dl-btn');
  if(dlBtn) dlBtn.onclick=function(){ downloadBlob(blob,name); };
  if(kind==='text'){ var pre=overlay.querySelector('pre'); if(pre) blob.slice(0,20000).text().then(function(t){pre.textContent=t+(blob.size>20000?'\n\n…(tronqué)':'');}).catch(function(){pre.textContent='Aperçu indisponible.';}); }
}

function showRecvListWithToast(){
  // Notification de fin de réception
  var n=recvFiles.length;
  var tot=recvFiles.reduce(function(s,f){return s+f.size;},0);
  var hasFolders=recvFiles.some(function(f){return f.path&&f.path.indexOf('/')!==-1;});
  if(hasFolders){
    var roots={};
    recvFiles.forEach(function(f){
      var seg=f.path&&f.path.split('/').filter(Boolean);
      if(seg&&seg.length>1) roots[seg[0]]=true;
    });
    var rootNames=Object.keys(roots);
    showToast((rootNames.length===1?'"'+rootNames[0]+'" reçu':rootNames.length+' dossiers reçus')+' · '+fmtSize(tot),'ok');
  } else {
    showToast(n+' fichier'+(n>1?'s':'')+' reçu'+(n>1?'s':'')+' · '+fmtSize(tot),'ok');
  }
  showRecvList();
}

function showRecvList(){
  if(!ui.recvName||!ui.recvSize) return;
  loading(false);
  var totalSize=recvFiles.reduce(function(s,f){return s+f.size;},0);
  var n=recvFiles.length;
  ui.recvName.textContent=n+' fichier'+(n>1?'s':'')+' reçu'+(n>1?'s':'');
  ui.recvSize.textContent=fmtSize(totalSize);

  var tree=buildRecvTree(recvFiles);
  var box=document.getElementById('recvFileList');
  if(box){
    box.innerHTML='<div class="file-tree recv-tree">'+renderRecvTreeNode(tree)+'</div>';
    bindTreeToggles(box);

    // Handler actions (dl / aperçu) — défini une seule fois via cloneNode
    var newBox=box.cloneNode(true);
    box.parentNode.replaceChild(newBox,box);
    box=newBox;
    // Remettre les toggles sur le nouveau nœud
    bindTreeToggles(box);

    function handleAction(e){
      var dl=e.target.closest('.recv-file-dl');
      if(dl){
        e.preventDefault(); e.stopPropagation();
        var idx=parseInt(dl.getAttribute('data-idx'),10);
        var f=recvFiles[idx]; if(f) downloadBlob(f.blob,f.name);
        return;
      }
      var pv=e.target.closest('.recv-file-preview');
      if(pv){
        e.preventDefault(); e.stopPropagation();
        var idx=parseInt(pv.getAttribute('data-idx'),10);
        var f=recvFiles[idx]; if(!f) return;
        var k=getPreviewKind(f.mime); if(k) showPreviewModal(k,f.url,f.blob,f.name);
      }
    }
    box.addEventListener('click', handleAction);
    box.addEventListener('touchend', handleAction, {passive:false});
  }

  // Bouton télécharger tout (1 seul fichier)
  // Vrai <a href=blob: download> — aucun JS, fonctionne sur iOS Safari + Chrome
  if(n===1){
    var last=recvFiles[0];
    if(ui.recvDownload){
      var blobUrl=makeBlobUrl(last.blob);
      ui.recvDownload.href=blobUrl;
      ui.recvDownload.download=last.name;
      ui.recvDownload.innerHTML='<i class="fa-solid fa-download"></i> Télécharger';
      // Révoquer l'URL après usage
      ui.recvDownload.onclick=function(){
        setTimeout(function(){URL.revokeObjectURL(blobUrl);},10000);
      };
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

// ══════════════════════════════════════════════
//  INITIALISATION
// ══════════════════════════════════════════════

(function(){
  var hash=location.hash.replace(/^#/,'').trim();
  if(hash){
    SHARE_CODE=hash;
    hide(document.getElementById('panelShare')); show(document.getElementById('panelRecv'));
    var tr=document.getElementById('tabRecv'); if(tr) tr.classList.add('active');
    var ts=document.getElementById('tabShare'); if(ts) ts.classList.remove('active');
    startReceive(hash);
  } else {
    show(ui.stepMode); hide(document.getElementById('panelRecv'));
  }
  window.addEventListener('hashchange',function(){location.reload();});
})();

// ── Interactions UI ───────────────────────────

if(ui.codeDisplay) ui.codeDisplay.onclick=function(){
  if(!SHARE_CODE) return;
  navigator.clipboard.writeText(SHARE_CODE).catch(function(){});
  var old=ui.codeDisplay.textContent;
  ui.codeDisplay.textContent='Copié !';
  setTimeout(function(){if(ui.codeDisplay) ui.codeDisplay.textContent=old;},1500);
};

if(ui.recvBtn) ui.recvBtn.onclick=function(){ var c=ui.codeInput.value.trim(); if(c) startReceive(c); };
if(ui.codeInput){
  ui.codeInput.addEventListener('keydown',function(e){ if(e.key==='Enter'&&ui.codeInput.value.trim()) if(ui.recvBtn) ui.recvBtn.click(); });
  ui.codeInput.addEventListener('input',function(){ this.value=this.value.toUpperCase().replace(/[^A-Z0-9]/g,'').slice(0,8); });
}

if(ui.shareAgain) ui.shareAgain.onclick=function(){ var t=document.getElementById('tabShare'); if(t) t.click(); };

var tabShare=document.getElementById('tabShare'), tabRecv=document.getElementById('tabRecv');
if(tabShare) tabShare.onclick=function(){
  if(peer){peer.destroy();peer=null;} conn=null;
  tabShare.classList.add('active'); if(tabRecv) tabRecv.classList.remove('active');
  show(document.getElementById('panelShare')); hide(document.getElementById('panelRecv'));
  hide(ui.progressWrap); hide(ui.stepDone); resetShare();
};
if(tabRecv) tabRecv.onclick=function(){
  if(peer){peer.destroy();peer=null;} conn=null;
  tabRecv.classList.add('active'); if(tabShare) tabShare.classList.remove('active');
  show(document.getElementById('panelRecv')); hide(document.getElementById('panelShare'));
  hide(ui.progressWrap); hide(ui.stepDone);
};

var cancelBtn=document.getElementById('cancelShare');
if(cancelBtn) cancelBtn.onclick=function(){resetShare();};

['navSendBtn','heroSendBtn'].forEach(function(id){
  var el=document.getElementById(id);
  if(el) el.onclick=function(e){ e.preventDefault(); var t=document.getElementById('tabShare'); if(t) t.click(); setTimeout(function(){var el=document.getElementById('upload');if(el)el.scrollIntoView({behavior:'smooth'});},50); };
});
var heroRecvBtn=document.getElementById('heroRecvBtn');
if(heroRecvBtn) heroRecvBtn.onclick=function(e){ e.preventDefault(); var t=document.getElementById('tabRecv'); if(t) t.click(); setTimeout(function(){var el=document.getElementById('upload');if(el)el.scrollIntoView({behavior:'smooth'});},50); };
