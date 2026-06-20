var CHUNK=65536;
var peer=null,conn=null,file=null,buf=null,code=null,chunks=[];

var $={};
'status,stepDrop,fileInput,stepShare,codeDisplay,qrContainer,copyHint,panelRecv,codeInput,recvBtn,progressWrap,progressFill,progressText,stepDone,recvName,recvSize,recvDownload,shareAgain,cancelShare'.split(',').forEach(function(k){$[k]=document.getElementById(k)});

function show(el){el.classList.remove('hidden')}
function hide(el){el.classList.add('hidden')}

function msg(t,type){
  $.status.textContent=t||'';
  if(!t){$.status.style.display='none';return}
  $.status.style.display='block';
  $.status.className=type||'info';
}
function copy(t){
  navigator.clipboard.writeText(t).catch(function(){});
  $.copyHint.textContent='Copied!';
  setTimeout(function(){$.copyHint.textContent='— tap to copy'},1500);
}
function fmt(b){
  if(!b)return'0 B';
  var k=1024,s=['B','KB','MB','GB'];
  return (b/Math.pow(k,Math.floor(Math.log(b)/Math.log(k)))).toFixed(1)+' '+s[Math.floor(Math.log(b)/Math.log(k))];
}

// ── Share flow ──

$.stepDrop.onclick=function(){$.fileInput.click()};
$.stepDrop.ondragover=function(e){e.preventDefault();$.stepDrop.classList.add('drag-over')};
$.stepDrop.ondragleave=function(){$.stepDrop.classList.remove('drag-over')};
$.stepDrop.ondrop=function(e){e.preventDefault();$.stepDrop.classList.remove('drag-over');if(e.dataTransfer.files.length)startShare(e.dataTransfer.files[0])};
$.fileInput.onchange=function(){if($.fileInput.files.length)startShare($.fileInput.files[0])};

function startShare(f){
  if(f.size>500*1024*1024){msg('File too large (max 500 MB)','err');return}
  file=f;
  msg('Connecting to signaling server...','info');
  hide($.stepDrop);
  show($.progressWrap);
  $.progressText.textContent='Creating secure connection...';

  peer=new Peer();
  peer.on('open',function(id){
    code=id;
    var r=new FileReader();
    r.onload=function(e){
      buf=e.target.result;
      hide($.progressWrap);
      $.codeDisplay.textContent=id;
      show($.stepShare);
      var url=location.origin+location.pathname.replace(/\/+$/,'')+'#'+id;
      $.qrContainer.innerHTML='';
      new QRCode($.qrContainer,{text:url,width:180,height:180,colorDark:'#000',colorLight:'#fff',correctLevel:QRCode.CorrectLevel.M});
      msg('Code generated — waiting for receiver','ok');
    };
    r.readAsArrayBuffer(file);
  });
  peer.on('connection',function(c){
    conn=c;
    conn.on('open',function(){
      hide($.stepShare);
      show($.progressWrap);
      $.progressText.textContent='Connected! Sending...';
      send();
    });
  });
  peer.on('error',function(e){
    msg('Connection failed. Try again.','err');
    reset();
  });
}

function send(){
  var total=Math.ceil(buf.byteLength/CHUNK);
  conn.send(JSON.stringify({type:'meta',name:file.name,size:file.size,total:total}));
  var i=0;
  function next(){
    if(i>=total||conn.readyState!=='open'){
      if(i>=total){conn.send('DONE');done('sent')}
      return;
    }
    var s=i*CHUNK,e=Math.min(s+CHUNK,buf.byteLength);
    conn.send(buf.slice(s,e));
    i++;
    $.progressFill.style.width=Math.round(i/total*100)+'%';
    $.progressText.textContent='Sending... '+i+'/'+total;
    setTimeout(next,1);
  }
  next();
}

// ── Receive flow ──

function startRecv(id){
  hide($.panelRecv);
  show($.progressWrap);
  $.progressText.textContent='Connecting...';
  msg('Looking up code: '+id,'info');

  peer=new Peer();
  peer.on('open',function(){
    conn=peer.connect(id,{reliable:true});
    chunks=[];

    var t=setTimeout(function(){
      if(!conn||!conn.open){
        msg('Timed out. Check the code.','err');
        hide($.progressWrap);
        show($.panelRecv);
        if(peer)peer.destroy();
      }
    },30000);

    var meta=null;
    conn.on('open',function(){
      clearTimeout(t);
      $.progressText.textContent='Connected! Downloading...';
      msg('Receiving file...','info');
    });
    conn.on('data',function(d){
      if(typeof d==='string'){
        if(d==='DONE'&&meta)finish(meta);
        else try{meta=JSON.parse(d);if(meta.type==='meta')$.progressText.textContent='Downloading... 0 / '+meta.total+' chunks'}catch(e){}
        return;
      }
      if(d instanceof ArrayBuffer){
        chunks.push(d);
        var pct=meta?Math.round(chunks.length/meta.total*100):0;
        $.progressFill.style.width=Math.min(95,pct)+'%';
        $.progressText.textContent='Downloading... '+chunks.length+' / '+(meta?meta.total:'?')+' chunks';
        if(meta&&chunks.length===meta.total)finish(meta);
      }
    });
  });
  peer.on('error',function(e){
    msg(e.type==='peer-unavailable'?'Code not found.':'Error connecting.','err');
    hide($.progressWrap);
    show($.panelRecv);
  });
}

function finish(meta){
  if(!chunks.length){msg('No data received','err');return}
  $.progressFill.style.width='100%';
  $.progressText.textContent='Complete!';
  var blob=new Blob(chunks);
  var url=URL.createObjectURL(blob);
  var name=meta?meta.name:'file';
  $.recvName.textContent=name;
  $.recvSize.textContent=fmt(blob.size);
  $.recvDownload.href=url;
  $.recvDownload.download=name;
  hide($.progressWrap);
  show($.stepDone);
  show($.recvDownload);
  msg('File received!','ok');
}

function done(t){
  $.progressFill.style.width='100%';
  $.progressText.textContent='Sent!';
  msg('File sent successfully!','ok');
  if(t==='sent'){
    $.recvName.textContent=file.name;
    $.recvSize.textContent=fmt(file.size);
    hide($.recvDownload);
  }
  show($.stepDone);
}

function reset(){
  file=null;buf=null;
  if(peer){peer.destroy();peer=null}
  conn=null;code=null;chunks=[];
  hide($.stepShare);hide($.stepDone);hide($.progressWrap);
  show($.stepDrop);
  $.codeDisplay.textContent='------';
  $.progressFill.style.width='0%';
  msg('','');
}

// ── Init ──

(function(){
  var h=location.hash.replace(/^#/,'').trim();
  if(h){
    code=h;
    hide($.stepDrop);
    hide($.panelShare);
    show($.panelRecv);
    document.getElementById('tabRecv').classList.add('active');
    document.getElementById('tabShare').classList.remove('active');
    startRecv(h);
  }
  window.addEventListener('hashchange',function(){location.reload()});
})();

// ── UI handlers ──

$.codeDisplay.onclick=function(){if(code)copy(code)};
$.copyHint.onclick=function(){if(code)copy(code)};

$.recvBtn.onclick=function(){
  var v=$.codeInput.value.trim();
  if(v)startRecv(v);
};
$.codeInput.addEventListener('keydown',function(e){
  if(e.key==='Enter')$.recvBtn.click();
});

$.cancelShare.onclick=reset;
$.shareAgain.onclick=function(){reset();document.getElementById('tabShare').click()};

document.getElementById('tabShare').onclick=function(){
  if(peer){peer.destroy();peer=null}
  conn=null;
  document.getElementById('tabShare').classList.add('active');
  document.getElementById('tabRecv').classList.remove('active');
  hide(document.getElementById('panelRecv'));
  show(document.getElementById('panelShare'));
  hide($.progressWrap);hide($.stepDone);
  reset();
};
document.getElementById('tabRecv').onclick=function(){
  if(peer){peer.destroy();peer=null}
  conn=null;
  document.getElementById('tabRecv').classList.add('active');
  document.getElementById('tabShare').classList.remove('active');
  show(document.getElementById('panelRecv'));
  hide(document.getElementById('panelShare'));
  hide($.progressWrap);hide($.stepDone);
};
