var CHUNK = 65536;
var SHARE_CODE = null;
var peer = null;
var conn = null;
var fileToSend = null;
var fileBuf = null;
var recvChunks = [];

var ui = {};

'status,stepMode,dropZone,fileInput,stepFileInfo,fileName,fileSize,shareBtn,stepCode,codeDisplay,qrContainer,stepRecv,codeInput,recvBtn,progressWrap,progressFill,progressText,stepDone,recvName,recvSize,recvDownload,shareAgain'.split(',').forEach(function(k){ui[k]=document.getElementById(k)});

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
}

ui.shareBtn.onclick=function(){
  if(!fileToSend)return;
  ui.shareBtn.disabled=true;
  ui.shareBtn.textContent='Starting...';
  show(ui.progressWrap);
  ui.progressText.textContent='Connecting...';
  msg('Creating secure connection...','info');

  peer=new Peer();

  peer.on('open',function(id){
    SHARE_CODE=id;
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
      hide(ui.stepCode);
      show(ui.progressWrap);
      ui.progressText.textContent='Connected! Sending...';
      sendFile();
    });
  });

  peer.on('error',function(e){
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
        ui.progressFill.style.width='100%';
        ui.progressText.textContent='Sent!';
        msg('File sent successfully!','ok');
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
  hide(ui.stepMode);
  show(ui.progressWrap);
  ui.progressText.textContent='Connecting...';
  msg('Connecting to '+code+'...','info');

  peer=new Peer();

  peer.on('open',function(){
    conn=peer.connect(code,{reliable:true});
    recvChunks=[];

    var timeout=setTimeout(function(){
      if(!conn||!conn.open){
        msg('Connection timed out. Check the code.','err');
        hide(ui.progressWrap);
        show(ui.stepMode);
        if(peer)peer.destroy();
      }
    },30000);

    conn.on('open',function(){
      clearTimeout(timeout);
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
    if(e.type==='peer-unavailable'){
      msg('Code not found. Check the code and try again.','err');
    }else{
      msg('Error: '+e.type,'err');
    }
    hide(ui.progressWrap);
    show(ui.stepMode);
  });
}

function finishRecv(meta){
  if(recvChunks.length===0){msg('No data received','err');return}
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
}

// ---- Init ----

(function(){
  var hash=location.hash.replace(/^#/,'').trim();
  if(hash){
    SHARE_CODE=hash;
    startReceive(hash);
  }else{
    show(ui.stepMode);
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

ui.shareAgain.onclick=function(){
  location.hash='';
  location.reload();
};

// Tab switching
document.getElementById('tabShare').onclick=function(){
  document.getElementById('tabShare').classList.add('active');
  document.getElementById('tabRecv').classList.remove('active');
  show(document.getElementById('panelShare'));
  hide(document.getElementById('panelRecv'));
};
document.getElementById('tabRecv').onclick=function(){
  document.getElementById('tabRecv').classList.add('active');
  document.getElementById('tabShare').classList.remove('active');
  show(document.getElementById('panelRecv'));
  hide(document.getElementById('panelShare'));
};

// Cancel share
document.getElementById('cancelShare').onclick=function(){
  if(peer){peer.destroy();peer=null}
  conn=null;
  SHARE_CODE=null;
  location.hash='';
  location.reload();
};
