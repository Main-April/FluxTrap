var CHUNK = 65536;
var SHARE_CODE = null;
var peer = null;
var conn = null;
var fileToSend = null;
var fileBuf = null;
var recvChunks = [];
var logs = [];
var historyEntries = [];
var logCount = 0;
var STORAGE_KEY = 'wishare-history';

function pushLog(level, msg){
  var id = Date.now() + '-' + (Math.random()*1e6|0);
  var ts = new Date().toLocaleTimeString([],{hour:'2-digit',minute:'2-digit',second:'2-digit'});
  logs = [{id:id,ts:ts,level:level,msg:msg}].concat(logs).slice(0,30);
  renderLogs();
}

function renderLogs(){
  var list = document.getElementById('logList');
  document.getElementById('logCount').textContent = logs.length + ' events';
  if(logs.length===0){
    list.innerHTML = '<div class="empty"><i class="fa-regular fa-folder-open" style="font-size:1.4rem;display:block;margin-bottom:8px;color:rgba(183,122,255,0.4)"></i>No events yet...</div>';
    return;
  }
  var html = '';
  logs.forEach(function(l){
    html += '<div class="log-item"><span class="log-time">'+l.ts+'</span><span class="log-level '+l.level+'">'+l.level+'</span><span class="log-msg">'+l.msg+'</span></div>';
  });
  list.innerHTML = html;
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
    empty.classList.remove('hidden');
    list.classList.add('hidden');
    return;
  }
  empty.classList.add('hidden');
  list.classList.remove('hidden');
  var html = '';
  historyEntries.forEach(function(h){
    var names = h.files.slice(0,2).map(function(f){return f.name}).join(', ');
    var extra = h.count > 2 ? ' + ' + (h.count-2) + ' more' : '';
    var date = new Date(h.date).toLocaleString(undefined,{day:'2-digit',month:'short',hour:'2-digit',minute:'2-digit'});
    html += '<div class="history-item"><span class="history-icon"><i class="fa-solid fa-file-zipper"></i></span><div class="history-info"><div class="history-name">'+escHtml(names)+escHtml(extra)+'</div><div class="history-meta">'+h.count+' file'+(h.count>1?'s':'')+' · '+fmtSize(h.size)+' · '+date+'</div></div><i class="fa-solid fa-chevron-right history-arrow"></i></div>';
  });
  list.innerHTML = html;
}

function escHtml(s){return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;')}

function updateStats(){
  var totalUploads = historyEntries.length;
  var totalFiles = historyEntries.reduce(function(s,h){return s+h.count},0);
  var totalBytes = historyEntries.reduce(function(s,h){return s+h.size},0);
  document.getElementById('statUploads').textContent = totalUploads;
  document.getElementById('statFiles').textContent = totalFiles;
  document.getElementById('statBytes').textContent = fmtSize(totalBytes);
}

document.getElementById('clearHistory').onclick=function(){
  historyEntries = [];
  try{localStorage.removeItem(STORAGE_KEY)}catch(e){}
  renderHistory();
  updateStats();
  pushLog('warn','History cleared');
};

(function(){
  try{
    var raw = localStorage.getItem(STORAGE_KEY);
    if(raw) historyEntries = JSON.parse(raw);
  }catch(e){}
  renderHistory();
  updateStats();
  pushLog('info','Session started — ready to share');
})();

var ui = {};
var loadingBar=document.getElementById('loadingBar');
function loading(on){loadingBar.classList.toggle('active',on)}

'status,stepMode,fileInput,stepFileInfo,fileName,fileSize,shareBtn,stepCode,codeDisplay,qrContainer,codeInput,recvBtn,progressWrap,progressFill,progressText,stepDone,recvName,recvSize,recvDownload,shareAgain'.split(',').forEach(function(k){ui[k]=document.getElementById(k)});
ui.dropZone=ui.stepMode;

function show(el){el.classList.remove('hidden')}
function hide(el){el.classList.add('hidden')}

function msg(t,type){
  ui.status.className='msg msg-'+(type||'info');
  ui.status.textContent=t;
  show(ui.status);
}

function fmtSize(b){
  if(!b)return'0 B';
  var k=1024,s=['B','KB','MB','GB'];
  return parseFloat((b/Math.pow(k,Math.floor(Math.log(b)/Math.log(k)))).toFixed(1))+' '+s[Math.floor(Math.log(b)/Math.log(k))];
}

function makeQR(t){
  ui.qrContainer.innerHTML='';
  new QRCode(ui.qrContainer,{text:t,width:180,height:180,colorDark:'#000',colorLight:'#fff',correctLevel:QRCode.CorrectLevel.M});
}

function genCode(){
  return Math.random().toString(36).slice(2,8).toUpperCase();
}

function resetShare(){
  loading(false);
  fileToSend=null;fileBuf=null;
  if(peer){peer.destroy();peer=null}
  conn=null;
  SHARE_CODE=null;
  hide(ui.stepFileInfo);
  hide(ui.stepCode);
  hide(ui.progressWrap);
  hide(ui.stepDone);
  show(ui.stepMode);
  ui.shareBtn.disabled=false;
  ui.shareBtn.textContent='Share';
  ui.codeDisplay.textContent='---';
  msg('','');
  hide(ui.status);
}

document.getElementById('backBtn').onclick=resetShare;

// ---- Sender ----

ui.dropZone.onclick=function(){ui.fileInput.click()};
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
  if(f.size>500*1024*1024){alert('File too large (max 500 MB)');return}
  fileToSend=f;
  ui.fileName.textContent=f.name;
  ui.fileSize.textContent=fmtSize(f.size);
  hide(ui.dropZone);
  show(ui.stepFileInfo);
  hide(ui.stepCode);
  hide(ui.stepDone);
  hide(ui.progressWrap);
  msg('','');
  hide(ui.status);
  pushLog('info','File selected: '+f.name+' ('+fmtSize(f.size)+')');
}

ui.shareBtn.onclick=function(){
  if(!fileToSend)return;
  ui.shareBtn.disabled=true;
  ui.shareBtn.textContent='Starting...';
  show(ui.progressWrap);
  ui.progressText.textContent='Connecting...';
  msg('Creating secure connection...','info');

  loading(true);
  pushLog('info','Creating secure connection...');

  peer=new Peer();

  peer.on('open',function(id){
    SHARE_CODE=id;
    loading(false);
    pushLog('ok','Peer ID: '+id+' — waiting for receiver');
    var reader=new FileReader();
    reader.onload=function(e){
      fileBuf=e.target.result;
      ui.codeDisplay.textContent=id;
      hide(ui.stepFileInfo);
      hide(ui.progressWrap);
      show(ui.stepCode);

      var url=location.origin+location.pathname.replace(/\/+$/,'')+'#'+id;
      makeQR(url);
      msg('Share this code, or scan the QR code','ok');
    };
    reader.readAsArrayBuffer(fileToSend);
  });

  peer.on('connection',function(c){
    conn=c;
    conn.on('open',function(){
      loading(true);
      pushLog('ok','Receiver connected — starting transfer');
      hide(ui.stepCode);
      show(ui.progressWrap);
      ui.progressText.textContent='Connected! Sending...';
      sendFile();
    });
  });

  peer.on('error',function(e){
    loading(false);
    msg('Connection error. Try again.','err');
    ui.shareBtn.disabled=false;
    ui.shareBtn.textContent='Share';
  });
};

function sendFile(){
  var total=Math.ceil(fileBuf.byteLength/CHUNK);
  var meta={type:'meta',name:fileToSend.name,size:fileToSend.size,total:total};
  conn.send(JSON.stringify(meta));

  var idx=0;
  function next(){
    if(idx>=total||conn.readyState!=='open'){
      if(idx>=total){
        conn.send('DONE');
        loading(false);
        ui.progressFill.style.width='100%';
        ui.progressText.textContent='Sent!';
        msg('File sent successfully!','ok');
        pushLog('ok','Sent '+fileToSend.name+' ('+fmtSize(fileToSend.size)+')');
        addHistory([{name:fileToSend.name,size:fileToSend.size,type:fileToSend.type}], fileToSend.size, 1);
        showDone('sent');
      }
      return;
    }
    var s=idx*CHUNK,e=Math.min(s+CHUNK,fileBuf.byteLength);
    conn.send(fileBuf.slice(s,e));
    idx++;
    ui.progressFill.style.width=Math.round(idx/total*100)+'%';
    ui.progressText.textContent='Sending... '+idx+'/'+total;
    setTimeout(next,1);
  }
  next();
}

function showDone(type){
  show(ui.stepDone);
  if(type==='sent'){
    ui.recvName.textContent=fileToSend.name;
    ui.recvSize.textContent=fmtSize(fileToSend.size);
    hide(ui.recvDownload);
  }
}

// ---- Receiver ----

function startReceive(code){
  hide(document.getElementById('panelRecv'));
  show(ui.progressWrap);
  ui.progressText.textContent='Connecting...';
  msg('Connecting to '+code+'...','info');
  loading(true);

  peer=new Peer();

  peer.on('open',function(){
    pushLog('info','Connecting to peer: '+code);
    conn=peer.connect(code,{reliable:true});
    recvChunks=[];

    var timeout=setTimeout(function(){
      if(!conn||!conn.open){
        loading(false);
        msg('Connection timed out. Check the code.','err');
        pushLog('warn','Connection timed out for code: '+code);
        hide(ui.progressWrap);
        show(document.getElementById('panelRecv'));
        if(peer)peer.destroy();
      }
    },30000);

    conn.on('open',function(){
      clearTimeout(timeout);
      pushLog('ok','Connected to sender — receiving file');
      ui.progressText.textContent='Connected! Receiving...';
      msg('Receiving file...','info');
    });

    var recvMeta=null;

    conn.on('data',function(data){
      if(typeof data==='string'){
        if(data==='DONE'&&recvMeta){
          finishRecv(recvMeta);
        }else{
          try{recvMeta=JSON.parse(data);if(recvMeta.type==='meta')ui.progressText.textContent='Receiving... 0 / '+recvMeta.total+' chunks'}catch(e){}
        }
        return;
      }
      if(data instanceof ArrayBuffer){
        recvChunks.push(data);
        var total=recvMeta?recvMeta.total:recvChunks.length;
        var pct=Math.round(recvChunks.length/total*100);
        ui.progressFill.style.width=Math.min(95,pct)+'%';
        ui.progressText.textContent='Receiving... '+recvChunks.length+' / '+(recvMeta?recvMeta.total:'?')+' chunks';

        if(recvMeta&&recvChunks.length===recvMeta.total){
          finishRecv(recvMeta);
        }
      }
    });
  });

  peer.on('error',function(e){
    loading(false);
    if(e.type==='peer-unavailable'){
      msg('Code not found. Check the code and try again.','err');
    }else{
      msg('Error: '+e.type,'err');
    }
    hide(ui.progressWrap);
    show(document.getElementById('panelRecv'));
  });
}

function finishRecv(meta){
  if(recvChunks.length===0){loading(false);msg('No data received','err');return}
  loading(false);
  ui.progressFill.style.width='100%';
  ui.progressText.textContent='Complete!';
  var blob=new Blob(recvChunks);
  var url=URL.createObjectURL(blob);
  var name=meta?meta.name:'received_file';
  ui.recvName.textContent=name;
  ui.recvSize.textContent=fmtSize(blob.size);
  ui.recvDownload.href=url;
  ui.recvDownload.download=name;
  hide(ui.progressWrap);
  show(ui.stepDone);
  show(ui.recvDownload);
  msg('File received!','ok');
  pushLog('ok','Received '+name+' ('+fmtSize(blob.size)+')');
}

// ---- Init ----

(function(){
  var hash=location.hash.replace(/^#/,'').trim();
  if(hash){
    SHARE_CODE=hash;
    hide(document.getElementById('panelShare'));
    show(document.getElementById('panelRecv'));
    document.getElementById('tabRecv').classList.add('active');
    document.getElementById('tabShare').classList.remove('active');
    startReceive(hash);
  }else{
    show(ui.stepMode);
    hide(document.getElementById('panelRecv'));
  }
  window.addEventListener('hashchange',function(){location.reload()});
})();

// ---- UI ----

ui.codeDisplay.onclick=function(){
  if(SHARE_CODE){
    navigator.clipboard.writeText(SHARE_CODE).catch(function(){});
    var old=ui.codeDisplay.textContent;
    ui.codeDisplay.textContent='Copied!';
    setTimeout(function(){ui.codeDisplay.textContent=old},1500);
  }
};

ui.recvBtn.onclick=function(){
  var code=ui.codeInput.value.trim();
  if(code)startReceive(code);
};

ui.codeInput.addEventListener('keydown',function(e){
  if(e.key==='Enter'&&ui.codeInput.value.trim()){
    ui.recvBtn.click();
  }
});

ui.shareAgain.onclick=function(){document.getElementById('tabShare').click()};

// Tab switching
document.getElementById('tabShare').onclick=function(){
  if(peer){peer.destroy();peer=null}
  conn=null;
  document.getElementById('tabShare').classList.add('active');
  document.getElementById('tabRecv').classList.remove('active');
  show(document.getElementById('panelShare'));
  hide(document.getElementById('panelRecv'));
  hide(ui.progressWrap);
  hide(ui.stepDone);
  resetShare();
};
document.getElementById('tabRecv').onclick=function(){
  if(peer){peer.destroy();peer=null}
  conn=null;
  document.getElementById('tabRecv').classList.add('active');
  document.getElementById('tabShare').classList.remove('active');
  show(document.getElementById('panelRecv'));
  hide(document.getElementById('panelShare'));
  hide(ui.progressWrap);
  hide(ui.stepDone);
};

// Cancel share
document.getElementById('cancelShare').onclick=function(){
  resetShare();
};
