(function(){
  if('serviceWorker' in navigator){window.addEventListener('load',function(){navigator.serviceWorker.register('sw.js').catch(function(){})});}
  var bar=document.createElement('div');bar.id='pm-offline';bar.textContent='Sem internet. Algumas funções ficam indisponíveis.';
  function net(){bar.style.display=navigator.onLine?'none':'block'}
  window.addEventListener('online',net);window.addEventListener('offline',net);
  document.addEventListener('DOMContentLoaded',function(){document.body.appendChild(bar);net();
    if(!document.getElementById('btn-login'))return; // botão de instalar só na Central
    var standalone=matchMedia('(display-mode: standalone)').matches||navigator.standalone;if(standalone)return;
    var b=document.createElement('button');b.id='pm-install';b.textContent='INSTALAR APP';document.body.appendChild(b);
    var ev=null;window.addEventListener('beforeinstallprompt',function(e){e.preventDefault();ev=e;b.style.display='block'});
    b.onclick=function(){if(!ev)return;ev.prompt();ev.userChoice.then(function(){b.style.display='none';ev=null})};
    if(/iphone|ipad|ipod/i.test(navigator.userAgent)&&!localStorage.getItem('pm_ios_hint')){
      b.textContent='INSTALAR: COMPARTILHAR > TELA DE INÍCIO';b.style.display='block';
      b.onclick=function(){localStorage.setItem('pm_ios_hint','1');b.style.display='none'};}
  });
})();

// ---- Token de admin nas chamadas POST ao Worker + avisos não bloqueantes ----
(function(){
  var _f=window.fetch.bind(window);
  window.fetch=function(i,o){
    try{var t=sessionStorage.getItem('pm_token'),u=typeof i==='string'?i:i.url;
      if(t&&u.indexOf('workers.dev')>-1&&o&&o.method==='POST'){o=Object.assign({},o);var h=new Headers(o.headers||{});h.set('X-Admin-Token',t);o.headers=h;}}catch(e){}
    return _f(i,o);};
  var timer;
  window.alert=function(m){
    var el=document.getElementById('pm-toast');
    if(!el){el=document.createElement('div');el.id='pm-toast';el.setAttribute('role','status');document.body.appendChild(el);}
    el.textContent=String(m);el.classList.add('on');clearTimeout(timer);timer=setTimeout(function(){el.classList.remove('on')},3200);};
})();
