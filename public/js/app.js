const q=s=>document.querySelector(s), qa=s=>[...document.querySelectorAll(s)];
const heroes=[
  {id:'iron',n:'Железный кот',img:'images/heroes/iron.webp'},
  {id:'bat',n:'Бэт-кот',img:'images/heroes/bat.webp'},
  {id:'wonder',n:'Чудо-кошка',img:'images/heroes/wonder.webp'},
  {id:'super',n:'Супер-кошка',img:'images/heroes/super.webp'},
  {id:'flash',n:'Флэш-кот',img:'images/heroes/flash.webp'},
  {id:'panther',n:'Пантера-кот',img:'images/heroes/panther.webp'}
];
// Маргарита Евгеньевна: наставница, атака Red Team, обиженная (штрафы и финал)
const FOX_GUIDE='images/mentor-guide.webp';
const FOX_ATTACK='images/mentor-attack.webp';
const FOX_ANGRY='images/mentor-angry.webp';

const STAGES=['program','sys','sec'];
let hero=null;          // объект героя из heroes (картинка, имя)
let me=null;            // участник, как его видит сервер
let screen='';          // что показано: avatar, tutorial:<этап>, wait:<этап>, countdown:<этап>, game:<этап>, comic:<этап>, final, notice
let currentStage=null;
let errors=0, timerId=null, elapsed=0, penaltySeconds=0, stageStartedAt=0, gameOver=false;

function beep(f=440,d=.08,v=.02){try{let A=window.AudioContext||window.webkitAudioContext,x=new A(),o=x.createOscillator(),g=x.createGain();o.frequency.value=f;g.gain.value=v;o.connect(g);g.connect(x.destination);o.start();o.stop(x.currentTime+d);o.onended=()=>x.close()}catch(e){}}

function showFloat(text,x,y){
  let el=document.createElement('div');
  el.className='float-check';
  el.textContent=text;
  el.style.left=(x+window.scrollX)+'px';
  el.style.top=(y+window.scrollY-18)+'px';
  document.body.appendChild(el);
  setTimeout(()=>el.remove(),900);
}
function showBurst(text){
  let o=document.createElement('div');
  o.className='sec-success-burst';
  o.innerHTML='<div class="card">'+text+'</div>';
  document.body.appendChild(o);
  setTimeout(()=>o.remove(),900);
}
function hideAll(){
  ['avatarScreen','progTutorial','sysTutorial','secTutorial','waitScreen','gameShell','finalScreen'].forEach(id=>q('#'+id).classList.add('hidden'));
}
function log(msg,cls='infotxt'){let d=document.createElement('div');d.className=cls;d.textContent='['+new Date().toLocaleTimeString('ru-RU')+'] '+msg;q('#log').prepend(d)}
function stageName(s){return s==='program'?'ПРОГРАММИСТ':s==='sys'?'СИСТЕМНЫЙ АДМИНИСТРАТОР':'ЗАЩИТА ИНФОРМАЦИИ'}
function updateTop(tag){q('#stageTag').textContent=tag}
function updateStatus(progress=0){
  q('#statusStage').textContent=stageName(currentStage||(me&&me.stage)||'program');
  q('#statusTime').textContent=currentStage?formatTime(elapsed+penaltySeconds):'—';
  q('#statusPenalty').textContent='+'+penaltySeconds+' сек';
  q('#statusErrors').textContent=errors;
  q('#statusProgress').textContent=Math.round(progress)+'%';
  q('#statusBar').style.width=Math.max(0,Math.min(100,progress))+'%';
}
function formatTime(s){return String(Math.floor(s/60)).padStart(2,'0')+':'+String(s%60).padStart(2,'0')}
function renderTime(){
  const t=formatTime(elapsed+penaltySeconds);
  q('#timer').textContent=t;q('#statusTime').textContent=t;q('#statusPenalty').textContent='+'+penaltySeconds+' сек';
}
// Время идёт от момента старта, который назначил сервер, поэтому обновление страницы его не сбрасывает.
function startTimer(startedAt){
  clearInterval(timerId);stageStartedAt=startedAt;
  const tick=()=>{elapsed=Math.max(0,Math.floor((serverNow()-stageStartedAt)/1000));renderTime()};
  tick();timerId=setInterval(tick,1000);
}
function addPenalty(sec){
  if(gameOver)return;
  penaltySeconds+=sec;renderTime();
  socket.emit('penalty',{stage:currentStage,seconds:sec});
}
function penalty(title,text,seconds,img=FOX_ANGRY,ms=3600){
  if(gameOver)return;errors++;addPenalty(seconds);updateStatus(currentProgress());
  let p=document.createElement('div');p.className='penalty';
  p.innerHTML='<div class="penalty-card"><img src="'+img+'"><div class="penalty-text"><h2>'+title+'</h2><p>'+text+'</p><div class="minus">− '+seconds+' сек</div></div></div>';
  document.body.appendChild(p);beep(120,.14,.03);setTimeout(()=>p.remove(),ms)
}
function countdown(stage,startedAt,cb){
  const titles={
    program:'МОДУЛЬ 1 · МАРШРУТ К РАБОЧЕМУ ПК',
    sys:'МОДУЛЬ 2 · ПОДКЛЮЧЕНИЕ PC1 К СЕТИ',
    sec:'МОДУЛЬ 3 · RED TEAM-АТАКА'
  };
  const texts={
    program:'Маргарита Евгеньевна запускает модуль программирования. Цель — запрограммировать маршрут котика до PC1.',
    sys:'Маргарита Евгеньевна запускает сетевой модуль. Цель — собрать рабочую топологию и поднять LINK.',
    sec:'Маргарита Евгеньевна переходит в Red Team. Теперь нужно защитить уже восстановленную систему.'
  };
  const left=()=>Math.max(0,Math.ceil((startedAt-serverNow())/1000));
  let o=document.createElement('div');o.className='cine';
  o.innerHTML='<div class="cine-box"><div class="cine-photo"><img src="'+(stage==='sec'?FOX_ATTACK:FOX_GUIDE)+'"></div><div class="cine-text"><div class="tag">'+titles[stage]+'</div><h2>'+texts[stage]+'</h2><div class="countdown" id="cd">'+left()+'</div></div></div>';
  document.body.appendChild(o);let id=setInterval(()=>{const n=left();q('#cd').textContent=n;if(n<=0){clearInterval(id);o.remove();cb()}},200)
}
function currentProgress(){
  if(currentStage==='program')return Math.min(95,progQueue.length*10);
  if(currentStage==='sys')return Math.min(100, sysDoneCount()/5*100);
  if(currentStage==='sec')return secSub===1?secClues.size/3*33:secSub===2?66:88;
  return 0
}
function showAvatar(){
  screen='avatar';hideAll();currentStage=null;hero=null;q('#avatarScreen').classList.remove('hidden');
  qa('.hero-card').forEach(x=>x.classList.remove('sel'));q('#confirmHero').disabled=true;
  q('#miniAvatar').innerHTML='';q('#agentName').textContent='АГЕНТ · НЕ ВЫБРАН';q('#timer').textContent='--:--';updateTop('СТАРТ')
}
function showTutorial(stage){
  screen='tutorial:'+stage;hideAll();currentStage=null;errors=0;q('#timer').textContent='--:--';
  q('#'+(stage==='program'?'progTutorial':stage==='sys'?'sysTutorial':'secTutorial')).classList.remove('hidden');
  updateTop('ОБУЧЕНИЕ · '+stageName(stage))
  if(stage==='program')resetProgTutorial();
  if(stage==='sys')resetSysTutorial();
  if(stage==='sec')resetSecTutorial();
}
function showMessage(title,text,status,icon){
  hideAll();q('#waitScreen').classList.remove('hidden');q('#timer').textContent='--:--';
  q('#waitIcon').textContent=icon;q('#waitTitle').textContent=title;q('#waitText').textContent=text;q('#waitStatus').textContent=status;
}
function showWait(stage){
  screen='wait:'+stage;currentStage=null;updateTop('ГОТОВ · '+stageName(stage));
  showMessage('Готовность отправлена Маргарите Евгеньевне','Жди, пока Маргарита Евгеньевна запустит этап «'+stageName(stage)+'».','ОЖИДАНИЕ КОМАНДЫ МАРГАРИТЫ ЕВГЕНЬЕВНЫ…','✓');
}
function showNotice(title,text,status){
  screen='notice';currentStage=null;updateTop('ОЖИДАНИЕ');showMessage(title,text,status,'⏳');
}
function sendReady(stage){
  showWait(stage);
  socket.emit('ready',{stage},applyState);
}
function startStage(stage,r){
  screen='game:'+stage;currentStage=stage;errors=r.errors;penaltySeconds=r.penalty;hideAll();q('#gameShell').classList.remove('hidden');
  ['progGame','sysGame','secGame'].forEach(id=>q('#'+id).classList.add('hidden'));
  q('#'+(stage==='program'?'progGame':stage==='sys'?'sysGame':'secGame')).classList.remove('hidden');
  q('#log').innerHTML='';updateTop(stageName(stage));gameOver=false;
  if(stage==='program'){resetProgGame();log('Модуль 1: маршрут котика к PC1 запущен.')}
  if(stage==='sys'){resetSysGame();log('Модуль 2: подключение PC1 к сети запущено.')}
  if(stage==='sec'){resetSecGame();log('Red Team начала атаку.','badtxt')}
  startTimer(r.startedAt);updateStatus(0)
}
function finishStage(stage){
  if(gameOver)return;
  gameOver=true;clearInterval(timerId);q('#timer').textContent='--:--';
  screen='comic:'+stage;busy=true; // пока идёт комикс, обновления состояния не перебивают его
  socket.emit('finish',{stage},applyState);
  const next=()=>{busy=false;applyState(lastState)};
  if(stage==='program')showProgramComic(next);
  else if(stage==='sys')showNetworkComic(next);
  else showSecurityVictory(next);
}
function resultText(r){
  if(!r||r.timeSec==null)return '—';
  const t='время: '+formatTime(r.timeSec)+' · штраф +'+r.penalty+' сек · ошибок: '+r.errors;
  return r.status==='stopped'?'не завершён · '+t:t;
}
function showFinal(){
  screen='final';hideAll();q('#finalScreen').classList.remove('hidden');q('#timer').textContent='--:--';updateTop('МИССИЯ ВЫПОЛНЕНА');
  q('#finalProg').textContent=resultText(me.results.program);
  q('#finalSys').textContent=resultText(me.results.sys);
  q('#finalSec').textContent=resultText(me.results.sec);
  q('#finalTotal').textContent=me.totalSec!=null?'Общее время: '+formatTime(me.totalSec):'';
}
function showStopped(cb){
  let o=document.createElement('div');o.className='cine';
  o.innerHTML='<div class="cine-box"><div class="cine-photo"><img src="'+FOX_GUIDE+'"></div><div class="cine-text"><div class="tag">ЭТАП ЗАВЕРШЁН</div><h2>Маргарита Евгеньевна остановила этап</h2><p>Время вышло. Этот этап засчитан как незавершённый — переходим дальше.</p><button class="btn cyan" id="stoppedNext">ДАЛЬШЕ</button></div></div>';
  document.body.appendChild(o);o.querySelector('#stoppedNext').onclick=()=>{o.remove();cb()};
}
function revealAlly(){
  let o=document.createElement('div');o.className='cine';
  o.innerHTML='<div class="cine-box"><div style="font-size:160px;text-align:center">🕷️</div><div class="cine-text"><div class="tag">EXTERNAL CONNECTION DETECTED</div><h2>СОЮЗНИК ПОДКЛЮЧЁН</h2><p>Система восстановлена. Можно запускать физический финал.</p></div></div>';
  document.body.appendChild(o);q('#allyWait').textContent='СОЮЗНИК ПОДКЛЮЧЁН';setTimeout(()=>o.remove(),5000)
}

// 5 кадров на каждый этап; второй кадр этапа «Защита» общий для всех героев.
function comicPanels(h,stage){
  return [1,2,3,4,5].map(i=>stage==='sec'&&i===2?'images/comics/shared/sec-2.webp':'images/comics/'+h.id+'/'+stage+'-'+i+'.webp');
}

function showRealComic(title, stageKey, button, cb){
  const panels=comicPanels(hero,stageKey);
  let o=document.createElement('div');o.className='storyboard-overlay';
  o.innerHTML='<div class="storyboard"><div class="storyboard-head"><h2>'+title+'</h2><div class="story-agent"><img src="'+hero.img+'"><span>'+me.name+'</span></div></div><div class="story-grid" id="storyGrid"></div><button class="btn green story-next" id="storyNext" disabled>'+button+'</button></div>';
  document.body.appendChild(o);
  const grid=o.querySelector('#storyGrid');
  panels.forEach((src,i)=>{
    let d=document.createElement('div');
    d.className='story-cell '+((i===0||i===panels.length-1)?'wide':'');
    d.innerHTML='<img class="comic-art" src="'+src+'">';
    grid.appendChild(d);
  });
  const cells=[...grid.children];
  cells.forEach((c,i)=>setTimeout(()=>c.classList.add('show'),250+i*900));
  const btn=o.querySelector('#storyNext');
  setTimeout(()=>btn.disabled=false,400+cells.length*900);
  btn.onclick=()=>{o.remove();cb&&cb()};
}
function showProgramComic(cb){showRealComic('КОМИКС · МАРШРУТ К PC1','program','ПЕРЕЙТИ К СЕТИ',cb)}
function showNetworkComic(cb){showRealComic('КОМИКС · СЕТЬ ВОССТАНОВЛЕНА','sys','ПЕРЕЙТИ К ЗАЩИТЕ',cb)}
function showSecurityVictory(cb){showRealComic('КОМИКС · RED TEAM ОСТАНОВЛЕНА','sec','ПОКАЗАТЬ ИТОГ',cb)}

/* Hero selection */
heroes.forEach(h=>{let b=document.createElement('button');b.className='hero-card';b.innerHTML='<img src="'+h.img+'"><div class="hero-name">'+h.n+'</div>';b.onclick=()=>{qa('.hero-card').forEach(x=>x.classList.remove('sel'));b.classList.add('sel');hero=h;q('#confirmHero').disabled=false};q('#heroGrid').appendChild(b)});
q('#confirmHero').onclick=()=>{
  q('#confirmHero').disabled=true;
  socket.emit('join',{hero:hero.id},res=>{q('#confirmHero').disabled=false;if(res.error){alert(res.error);return}applyState(res.state)});
};

/* Programmer tutorial */
let trainProgQ=[];
function setTrainHero(){q('#trainProgStart').innerHTML=hero?'<div class="player"><img src="'+hero.img+'"></div>':''}
function resetProgTutorial(){trainProgQ=[];q('#trainProgQueue').innerHTML='';q('#trainProgRun').disabled=true;q('#progReady').disabled=true;q('#trainProgExplain').classList.add('hidden');setTrainHero()}
qa('.train-prog').forEach(b=>b.onclick=()=>{if(trainProgQ.length>=2)return;trainProgQ.push(b.dataset.cmd);q('#trainProgQueue').innerHTML=trainProgQ.map(x=>'<span class="qitem">'+x+'</span>').join('');q('#trainProgRun').disabled=trainProgQ.length!==2});
q('#trainProgRun').onclick=()=>{if(trainProgQ.join('')==='→→'){q('#trainProgExplain').classList.remove('hidden');q('#progReady').disabled=false;beep(800)}else{q('#trainProgQueue').innerHTML='';trainProgQ=[];q('#trainProgRun').disabled=true}};
q('#progReady').onclick=()=>sendReady('program');

/* Programming game */
const blocks=new Set(['0,2','1,0','1,2','1,4','3,1','3,2','3,3']);
let progQueue=[],progPos=[0,0],progRunning=false;
function buildProgBoard(){
  let b=q('#progBoard');b.innerHTML='';
  for(let r=0;r<5;r++)for(let c=0;c<5;c++){let d=document.createElement('div');d.className='cell';d.dataset.pos=r+','+c;if(blocks.has(r+','+c))d.classList.add('block');if(r===4&&c===4){d.classList.add('goal');d.innerHTML='<div class="pc-goal"><div class="pc-goal-monitor"></div><small>РАБОЧИЙ ПК</small><b>PC1</b></div>';}b.appendChild(d)}renderProgPlayer()
}
function renderProgPlayer(){
  qa('#progBoard .player').forEach(x=>x.remove());
  let cell=q('#progBoard [data-pos="'+progPos[0]+','+progPos[1]+'"]');
  if(cell&&!blocks.has(progPos.join(',')))cell.innerHTML+='<div class="player walking"><img src="'+hero.img+'"></div>'
}
function renderProgQueue(badIndex=-1,activeIndex=-1){
  q('#progQueue').innerHTML=progQueue.map((x,i)=>'<span class="qitem '+(i===badIndex?'bad ':'')+(i===activeIndex?'active':'')+'">'+(i+1)+' · '+x+'</span>').join('');
  q('#progSteps').textContent=progQueue.length+' команд';updateStatus(currentProgress())
}
function resetProgGame(){progQueue=[];progPos=[0,0];progRunning=false;buildProgBoard();renderProgQueue();q('#progStepStatus').textContent='Собери программу и нажми «Выполнить».'}
qa('.prog-cmd').forEach(b=>b.onclick=()=>{if(gameOver||progRunning||progQueue.length>=14)return;progQueue.push(b.dataset.cmd);renderProgQueue()});
q('#progUndo').onclick=()=>{if(gameOver||progRunning)return;progQueue.pop();renderProgQueue()};
q('#progClear').onclick=()=>{if(gameOver||progRunning)return;progQueue=[];renderProgQueue()};
q('#progRun').onclick=async()=>{
  if(gameOver||progRunning||!progQueue.length)return;progRunning=true;progPos=[0,0];buildProgBoard();
  const delta={'↑':[-1,0],'↓':[1,0],'←':[0,-1],'→':[0,1]};
  for(let i=0;i<progQueue.length;i++){
    if(gameOver)break;renderProgQueue(-1,i);q('#progStepStatus').textContent='Выполняется команда '+(i+1)+' из '+progQueue.length+'…';await new Promise(r=>setTimeout(r,800));
    let d=delta[progQueue[i]],nr=progPos[0]+d[0],nc=progPos[1]+d[1];
    if(nr<0||nr>4||nc<0||nc>4||blocks.has(nr+','+nc)){
      renderProgQueue(i);penalty('PROGRAM ERROR','Ошибка на команде №'+(i+1)+'. Котик врезался в препятствие. Исправь алгоритм.',5);log('Ошибка алгоритма на команде '+(i+1),'badtxt');progRunning=false;return
    }
    progPos=[nr,nc];buildProgBoard()
  }
  progRunning=false;
  if(progPos[0]===4&&progPos[1]===4){renderProgQueue();q('#progStepStatus').textContent='PROGRAM COMPLETE · PC1 ДОСТИГНУТ';updateStatus(100);log('Котик успешно дошёл до PC1.','oktxt');setTimeout(()=>finishStage('program'),700)}
  else{penalty('PC1 NOT REACHED','Программа закончилась раньше, чем котик дошёл до рабочего ПК. Добавь или исправь команды.',3);q('#progStepStatus').textContent='PC1 не достигнут — исправь программу.';log('PC1 не достигнут.','badtxt')}
};

/* Sysadmin tutorial */
let tutPort=null;
function resetSysTutorial(){tutPort=null;qa('.tut-port').forEach(x=>x.classList.remove('sel','link'));q('#sysTutExplain').classList.add('hidden');q('#sysReady').disabled=true}
qa('.tut-port').forEach(b=>b.onclick=()=>{if(!tutPort){tutPort=b;b.classList.add('sel')}else if(tutPort!==b){tutPort.classList.remove('sel');tutPort.classList.add('link');b.classList.add('link');q('#sysTutExplain').classList.remove('hidden');q('#sysReady').disabled=false;tutPort=null;beep(800)}});
q('#sysReady').onclick=()=>sendReady('sys');

/* Sysadmin game */
let selectedPort=null;
let sysConnections=new Set();
let sysUsedSwitchPorts=new Set();
let sysInternetConnected=false;
let sysUplinkMade=false;
let sysDeviceConnected={pc:false,server:false,ap:false};
const cableColors=['#ff9f32','#58c8ff','#82e6a7','#c48aff','#ffd166'];

function isSwitchPort(p){return /^switch:[1-5]$/.test(p)}
function switchPortId(p){return p.split(':')[1]}
function isLanPort(p){return p==='router:lan1'||p==='router:lan2'}
function isDevicePort(p){return p==='pc:eth'||p==='server:eth'||p==='ap:eth'}
function devName(p){return p.split(':')[0]}
function sysDoneCount(){
  return (sysInternetConnected?1:0)+(sysUplinkMade?1:0)+
    (sysDeviceConnected.pc?1:0)+(sysDeviceConnected.server?1:0)+(sysDeviceConnected.ap?1:0)
}
function areaPort(p){return q('#networkArea [data-p="'+p+'"]')}
function updateSysAlgorithm(){
  const d1=q('#alg1'),d2=q('#alg2'),d3=q('#alg3'),d4=q('#alg4');
  if(!d1||!d2||!d3||!d4)return;
  [d1,d2,d3,d4].forEach(x=>x.classList.remove('done','current'));
  if(sysInternetConnected)d1.classList.add('done');
  if(sysUplinkMade)d2.classList.add('done');
  const devCount=Object.values(sysDeviceConnected).filter(Boolean).length;
  if(devCount===3)d3.classList.add('done');
  d3.innerHTML='<b>3 · ПОДКЛЮЧИ УСТРОЙСТВА</b>PC1, SRV1, AP1: ETH → свободный порт SW1 <strong style="color:var(--c)">('+devCount+'/3)</strong>';
  if(sysDoneCount()===5)d4.classList.add('done');
  if(!sysInternetConnected)d1.classList.add('current');
  else if(!sysUplinkMade)d2.classList.add('current');
  else if(devCount<3)d3.classList.add('current');
  else d4.classList.add('current');
}
function resetSysGame(){
  selectedPort=null;sysConnections=new Set();sysUsedSwitchPorts=new Set();
  sysInternetConnected=false;sysUplinkMade=false;sysDeviceConnected={pc:false,server:false,ap:false};
  qa('#networkArea .main-port').forEach(x=>{x.classList.remove('sel','link','badport','port-ok');x.disabled=false});
  q('#netSvg').innerHTML='';q('#sysLinks').textContent='0 / 5 LINK';updateStatus(0);updateSysAlgorithm()
}
function portCenter(el){
  const ar=q('#networkArea').getBoundingClientRect(),r=el.getBoundingClientRect();
  return [r.left-ar.left+r.width/2,r.top-ar.top+r.height/2]
}
function drawCable(aEl,bEl,color,temp=false){
  if(!aEl||!bEl)return;
  let [x1,y1]=portCenter(aEl),[x2,y2]=portCenter(bEl),svg=q('#netSvg');
  let path=document.createElementNS('http://www.w3.org/2000/svg','path');
  let dx=Math.max(45,Math.abs(x2-x1)*.38);
  path.setAttribute('d',`M ${x1} ${y1} C ${x1+dx} ${y1}, ${x2-dx} ${y2}, ${x2} ${y2}`);
  path.setAttribute('fill','none');path.setAttribute('stroke',color);path.setAttribute('stroke-width','7');
  path.setAttribute('stroke-linecap','round');path.setAttribute('opacity','.95');svg.appendChild(path);
  if(temp)setTimeout(()=>path.remove(),900)
}
function canon(a,b){return [a,b].sort().join('|')}
function markLinked(a,b,color){
  let key=canon(a,b);if(sysConnections.has(key))return false;
  let aEl=areaPort(a),bEl=areaPort(b);if(!aEl||!bEl)return false;
  sysConnections.add(key);aEl.classList.add('link','port-ok');bEl.classList.add('link','port-ok');
  aEl.disabled=true;bEl.disabled=true;drawCable(aEl,bEl,color);return true
}
function failPair(aEl,bEl,a,b){
  drawCable(aEl,bEl,'#ff5265',true);
  aEl.classList.add('badport');bEl.classList.add('badport');
  setTimeout(()=>{aEl.classList.remove('badport');bEl.classList.remove('badport')},750);
  penalty('НЕТ LINK','Эти порты не должны соединяться друг с другом. Смотри на три шага над схемой.',5);
  log('Неверная пара портов: '+a+' ↔ '+b,'badtxt')
}
q('#networkArea').addEventListener('click',e=>{
  const b=e.target.closest('.main-port');if(!b||gameOver||b.disabled)return;
  if(!selectedPort){selectedPort=b;b.classList.add('sel');return}
  if(selectedPort===b){b.classList.remove('sel');selectedPort=null;return}
  const first=selectedPort;first.classList.remove('sel');
  const a=first.dataset.p,bb=b.dataset.p;
  let ok=false,msg='';

  // Интернет ЛИНИЯ <-> R1 WAN
  if((a==='internet:line'&&bb==='router:wan')||(bb==='internet:line'&&a==='router:wan')){
    if(!sysInternetConnected){
      ok=markLinked(a,bb,cableColors[0]);sysInternetConnected=ok;
      msg='Интернет подключён к WAN маршрутизатора.'
    }
  }
  // Любой LAN R1 <-> любой свободный порт SW1
  else if((isLanPort(a)&&isSwitchPort(bb))||(isLanPort(bb)&&isSwitchPort(a))){
    const sw=isSwitchPort(a)?a:bb;
    if(!sysUplinkMade&&!sysUsedSwitchPorts.has(switchPortId(sw))){
      ok=markLinked(a,bb,cableColors[1]);
      if(ok){sysUplinkMade=true;sysUsedSwitchPorts.add(switchPortId(sw));msg='R1 связан с SW1.'}
    }
  }
  // PC1/SRV1/AP1 ETH <-> любой свободный порт SW1
  else if((isDevicePort(a)&&isSwitchPort(bb))||(isDevicePort(bb)&&isSwitchPort(a))){
    const dev=isDevicePort(a)?a:bb,sw=isSwitchPort(a)?a:bb,dn=devName(dev);
    if(!sysDeviceConnected[dn]&&!sysUsedSwitchPorts.has(switchPortId(sw))){
      ok=markLinked(a,bb,cableColors[2+Object.values(sysDeviceConnected).filter(Boolean).length%3]);
      if(ok){sysDeviceConnected[dn]=true;sysUsedSwitchPorts.add(switchPortId(sw));
        msg=(dn==='pc'?'PC1':dn==='server'?'SRV1':'AP1')+' подключён к SW1.'}
    }
  }

  if(ok){
    beep(760);let count=sysDoneCount();q('#sysLinks').textContent=count+' / 5 LINK';
    updateStatus(count/5*100);updateSysAlgorithm();log(msg,'oktxt');showFloat('LINK ✓',b.getBoundingClientRect().left,b.getBoundingClientRect().top);
    if(count===5){log('Сеть полностью собрана.','oktxt');showBurst('СЕТЬ ВОССТАНОВЛЕНА · 5/5 LINK');setTimeout(()=>finishStage('sys'),1200)}
  } else failPair(first,b,a,bb);
  selectedPort=null;
});

/* Security tutorial */
function resetSecTutorial(){q('#secTrainExplain').classList.add('hidden');q('#secReady').disabled=true}
q('#secTrainHot').onclick=()=>{q('#secTrainExplain').classList.remove('hidden');q('#secReady').disabled=false;beep(800)};
q('#secReady').onclick=()=>sendReady('sec');

/* Security game */
let secClues=new Set(),secSub=1,secOrder=[];
const why={
  sender:'<b>Отправитель:</b> в образце <b>sakh-energy.ru</b>, а в письме <b>sakh-enerqy.ru</b>. Одна похожая буква — типичная маскировка.',
  link:'<b>Ссылка:</b> образец ведёт на <b>sakh-energy.ru</b>, а письмо — на отдельный <b>sakh-energy-login.ru</b>.',
  file:'<b>Файл:</b> в образце последнее расширение <b>.pdf</b>, а здесь <b>.exe</b>. Это программа, а не документ.'
};
const secItems=[
{id:'mail',t:'Сотрудник получил фишинговое письмо'},
{id:'site',t:'Переход на поддельный сайт'},
{id:'creds',t:'Ввод логина и пароля на фальшивой странице'},
{id:'login',t:'Вход злоумышленника под чужой учётной записью'},
{id:'update',t:'Плановое обновление антивируса'},
{id:'printer',t:'Замятие бумаги в принтере'}
];
const secCorrect=['mail','site','creds','login'];
function resetSecGame(){
  secClues=new Set();secSub=1;secOrder=[];q('#secStep1').classList.remove('hidden');q('#secStep2').classList.add('hidden');q('#secStep3').classList.add('hidden');q('#secProgress').textContent='Этап 1 / 3';q('#secWhy').innerHTML='<b>Разбор:</b> после правильного клика здесь появится короткое объяснение.';qa('.candidate.found').forEach(x=>x.classList.remove('found'));initSecChain();updateStatus(0)
}
qa('#secMail .clue').forEach(el=>el.onclick=e=>{e.stopPropagation();if(gameOver||secClues.has(el.dataset.clue))return;secClues.add(el.dataset.clue);el.classList.add('found');q('#secWhy').innerHTML=why[el.dataset.clue];beep(760);showFloat('✓', e.clientX, e.clientY);updateStatus(secClues.size/3*33);if(secClues.size===3)setTimeout(()=>{showBurst('УЛИКИ НАЙДЕНЫ');secSub=2;q('#secStep1').classList.add('hidden');q('#secStep2').classList.remove('hidden');q('#secProgress').textContent='Этап 2 / 3';updateStatus(50)},650)});
qa('#secMail .decoy').forEach(el=>el.onclick=()=>{if(gameOver)return;penalty('Ай-ай-ай…','Это не отличие от образца. Пока ты отвлёкся, Red Team получила преимущество.',3);log('Ложная улика.','badtxt')});
function initSecChain(){
  secOrder=[];q('#secCards').innerHTML='';q('#secSlots').innerHTML='';
  [...secItems].sort(()=>Math.random()-.5).forEach(it=>{let b=document.createElement('button');b.className='card';b.textContent=it.t;b.dataset.id=it.id;b.onclick=()=>{if(gameOver||secOrder.includes(it.id))return;secOrder.push(it.id);b.classList.add('used');renderSecChain()};q('#secCards').appendChild(b)});
  for(let i=0;i<4;i++){let s=document.createElement('div');s.className='slot';s.textContent='ШАГ '+(i+1);q('#secSlots').appendChild(s)}q('#secChainCheck').disabled=true
}
function renderSecChain(){qa('#secSlots .slot').forEach((s,i)=>{let it=secItems.find(x=>x.id===secOrder[i]);s.textContent=it?it.t:'ШАГ '+(i+1);s.classList.toggle('fill',!!it)});q('#secChainCheck').disabled=secOrder.length!==4}
q('#secChainReset').onclick=()=>initSecChain();
q('#secChainCheck').onclick=()=>{
  if(gameOver)return;let ok=secOrder.every((x,i)=>x===secCorrect[i]);
  if(ok){showBurst('ЦЕПОЧКА ВОССТАНОВЛЕНА');secSub=3;q('#secStep2').classList.add('hidden');q('#secStep3').classList.remove('hidden');q('#secProgress').textContent='Этап 3 / 3';updateStatus(78);beep(800)}
  else{penalty('Немного не так…','События стоят не в том порядке. Подумай, что должно произойти раньше: кража данных или вход с этими данными?',5);log('Цепочка собрана неверно.','badtxt')}
};
qa('[data-sec-answer]').forEach(b=>b.onclick=()=>{
  if(gameOver)return;
  if(b.dataset.secAnswer==='ok'){b.classList.add('good','flashok');showBurst('АТАКА ОСТАНОВЛЕНА');updateStatus(100);log('Атака остановлена.','oktxt');setTimeout(()=>finishStage('sec'),700)}
  else{b.classList.add('wrong');setTimeout(()=>b.classList.remove('wrong'),600);penalty('Хи-хи 😈','Не то действие. Я всё ещё в системе, поэтому отнимаю у тебя время. Нужна мера, которая сразу отзовёт мой доступ.',10,FOX_ATTACK,4800);log('Неверная мера реагирования.','badtxt')}
});

/* Связь с сервером */
const ID_KEY='p65.participant';
const socket=io({path:new URL('socket.io',location.href).pathname});
let lastState=null, clockOffset=0, busy=false, allyShown=false;

function serverNow(){return Date.now()+clockOffset}
function loadIdentity(){try{return JSON.parse(localStorage.getItem(ID_KEY))||{}}catch(e){return {}}}
function saveIdentity(){try{if(me)localStorage.setItem(ID_KEY,JSON.stringify({id:me.id}))}catch(e){}}
function setAgent(){
  const h=heroes.find(x=>x.id===me.hero);
  if(hero!==h){hero=h;q('#miniAvatar').innerHTML='<img src="'+h.img+'">'}
  q('#agentName').textContent='АГЕНТ · '+me.name.toUpperCase();
}

// Экран всегда выбирается по состоянию с сервера — так обновление страницы возвращает участника туда, где он был.
function applyState(st){
  if(!st||!st.now)return;
  const hadSession=!!(lastState&&lastState.session);
  lastState=st;clockOffset=st.now-Date.now();me=st.me;saveIdentity();
  if(busy)return; // идёт комикс или отсчёт — состояние применится после
  if(screen.startsWith('game:')&&!(me&&me.phase==='playing'&&screen==='game:'+me.stage)){
    gameOver=true;clearInterval(timerId);
    if(me&&st.session){busy=true;screen='stopped';showStopped(()=>{busy=false;applyState(lastState)});return}
  }
  if(!st.session){
    if(hadSession)showNotice('Сеанс завершён','Спасибо за игру! Маргарита Евгеньевна закрыла сеанс.','СЕАНС ЗАВЕРШЁН');
    else showNotice('Сеанс ещё не начат','Подожди, пока Маргарита Евгеньевна запустит сеанс.','ОЖИДАНИЕ СЕАНСА…');
    return
  }
  if(!me){if(screen!=='avatar')showAvatar();return}
  setAgent();
  if(me.phase==='tutorial'){if(screen!=='tutorial:'+me.stage)showTutorial(me.stage);return}
  if(me.phase==='ready'){if(screen!=='wait:'+me.stage)showWait(me.stage);return}
  if(me.phase==='playing'){
    if(screen==='game:'+me.stage)return;
    const stage=me.stage,r=me.results[stage];
    if(r.startedAt-serverNow()>300){busy=true;screen='countdown:'+stage;countdown(stage,r.startedAt,()=>{busy=false;startStage(stage,r);applyState(lastState)})}
    else startStage(stage,r);
    return
  }
  if(screen!=='final')showFinal();
  const fin=!!st.session.finalAt;
  q('#allyWait').textContent=fin?'СОЮЗНИК ПОДКЛЮЧЁН':'ОЖИДАНИЕ ФИНАЛЬНОГО СИГНАЛА…';
  if(fin&&!allyShown){allyShown=true;revealAlly()}
}

socket.on('connect',()=>{q('#netStatus').classList.add('hidden');socket.emit('hello',{participantId:loadIdentity().id},applyState)});
socket.on('disconnect',()=>q('#netStatus').classList.remove('hidden'));
socket.on('state',applyState);
