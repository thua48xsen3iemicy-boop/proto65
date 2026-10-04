const q=s=>document.querySelector(s);
const STAGES=[{id:'program',n:'Программист'},{id:'sys',n:'Сисадмин'},{id:'sec',n:'Защита'}];
const PIN_KEY='p65.pin';
const socket=io({path:new URL('socket.io',location.href).pathname});
let state=null, clockOffset=0, shownSessionId;

function serverNow(){return Date.now()+clockOffset}
function esc(s){return String(s).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]))}
function fmt(sec){sec=Math.max(0,Math.round(sec));return String(Math.floor(sec/60)).padStart(2,'0')+':'+String(sec%60).padStart(2,'0')}
function fmtDate(ms){return new Date(ms).toLocaleString('ru-RU',{day:'numeric',month:'long',year:'numeric',hour:'2-digit',minute:'2-digit'})}
function fmtClock(ms){return new Date(ms).toLocaleTimeString('ru-RU',{hour:'2-digit',minute:'2-digit'})}
function call(event,data){return new Promise(resolve=>socket.emit(event,data,res=>{if(res&&res.error)alert(res.error);resolve(res||{})}))}

/* ---------- вход ---------- */
async function auth(pin){
  q('#pinSubmit').disabled=true;
  const res=await new Promise(r=>socket.emit('admin:auth',{pin},r));
  q('#pinSubmit').disabled=false;
  if(res.error){
    q('#pinError').textContent=res.error;
    try{sessionStorage.removeItem(PIN_KEY)}catch(e){}
    q('#pinScreen').classList.remove('hidden');q('#adminMain').classList.add('hidden');
    return
  }
  try{sessionStorage.setItem(PIN_KEY,pin)}catch(e){}
  q('#pinError').textContent='';q('#pinInput').value='';
  q('#pinScreen').classList.add('hidden');q('#adminMain').classList.remove('hidden');
  loadHistory();
}
q('#pinForm').onsubmit=e=>{e.preventDefault();auth(q('#pinInput').value.trim())};

/* ---------- таблица результатов ---------- */
const PHASES={locked:'Ждёт обучения',tutorial:'Обучение',ready:'Готов',playing:'Играет',finished:'Прошёл игру'};
const IDLE_MS=90*1000; // столько без действий — подсвечиваем, что ученик, возможно, застрял
// Статус, полоска прогресса и что ученик делает прямо сейчас.
function statusCell(p){
  const n=STAGES.findIndex(s=>s.id===p.stage)+1;
  const text=p.phase==='finished'?PHASES.finished:PHASES[p.phase]+' · этап '+n;
  let h='<span class="status '+p.phase+'">'+text+'</span>';
  if(p.phase==='tutorial'||p.phase==='playing'){
    const pr=p.progress||{pct:0,detail:'',at:0};
    const detail=pr.detail||(p.phase==='tutorial'?'Читает обучение':'Начинает этап');
    h+='<div class="progress"><div class="progress-bar"><div style="width:'+pr.pct+'%"></div></div><span>'+pr.pct+'%</span></div>'+
      '<span class="sub">'+esc(detail)+'</span><span class="idle" data-at="'+pr.at+'"></span>';
  }
  return h;
}
function stageCell(r,live){
  if(!r)return '<span class="sub">—</span>';
  const extra='<span class="sub">штраф +'+r.penalty+' с · ошибок '+r.errors+'</span>';
  if(r.status==='playing'){
    if(!live)return '<span class="stopped">прерван</span>'+extra;
    return '<span class="t live" data-start="'+r.startedAt+'" data-penalty="'+r.penalty+'"></span>'+extra;
  }
  const t='<span class="t">'+fmt(r.timeSec)+'</span>';
  return r.status==='stopped'?'<span class="stopped">не завершил</span> · '+t+extra:t+extra;
}
function places(list){
  const ranked=list.filter(p=>p.totalSec!=null).sort((a,b)=>a.totalSec-b.totalSec);
  const m={};ranked.forEach((p,i)=>m[p.id]=i+1);return m;
}
function renderTable(table,list,live){
  const place=places(list);
  const medal=n=>n===1?'🥇':n===2?'🥈':n===3?'🥉':n;
  const rows=live?list:[...list].sort((a,b)=>(place[a.id]||1e9)-(place[b.id]||1e9)||a.joinedAt-b.joinedAt);
  let h='<thead><tr><th>Участник</th>'+(live?'<th>Статус</th>':'')+STAGES.map(s=>'<th>'+s.n+'</th>').join('')+'<th>Итого</th><th>Место</th>'+(live?'<th></th>':'')+'</tr></thead><tbody>';
  if(!rows.length)h+='<tr><td class="empty" colspan="9">Пока никого нет</td></tr>';
  for(const p of rows){
    h+='<tr><td><div class="who">'+(live?'<span class="dot'+(p.online?' on':'')+'" title="'+(p.online?'на связи':'не в сети')+'"></span>':'')+
      '<img src="images/heroes/'+esc(p.hero)+'.webp" alt="">'+esc(p.name)+'</div></td>'+
      (live?'<td>'+statusCell(p)+'</td>':'')+
      STAGES.map(s=>'<td>'+stageCell(p.results[s.id],live)+'</td>').join('')+
      '<td class="t">'+(p.totalSec!=null?fmt(p.totalSec):'—')+'</td>'+
      '<td class="place">'+(place[p.id]?medal(place[p.id]):'')+'</td>'+
      (live?'<td><button class="icon-btn" data-remove="'+p.id+'" title="Убрать участника">✕</button></td>':'')+'</tr>';
  }
  table.innerHTML=h+'</tbody>';
  tick();
}
// Живое время у тех, кто сейчас играет (фактическое время + штрафы), и сколько ученик бездействует.
function tick(){
  document.querySelectorAll('.t.live').forEach(el=>{
    const ms=serverNow()-Number(el.dataset.start);
    el.textContent=ms<0?'отсчёт…':'▶ '+fmt(ms/1000+Number(el.dataset.penalty));
  });
  document.querySelectorAll('.idle').forEach(el=>{
    const ms=serverNow()-Number(el.dataset.at);
    el.textContent=Number(el.dataset.at)&&ms>IDLE_MS?'нет действий '+Math.floor(ms/60000)+' мин '+String(Math.floor(ms/1000)%60).padStart(2,'0')+' с':'';
  });
}
setInterval(tick,1000);

/* ---------- активный сеанс ---------- */
function render(){
  const s=state.session;
  q('#noSession').classList.toggle('hidden',!!s);
  q('#activeSession').classList.toggle('hidden',!s);
  q('#sessionBadge').textContent=s?'СЕАНС ИДЁТ':'НЕТ СЕАНСА';
  q('#sessionBadge').classList.toggle('ok',!!s);
  if((s&&s.id)!==shownSessionId){shownSessionId=s&&s.id;loadHistory()}
  if(!s)return;
  const ps=s.participants;
  q('#sessionTitleView').textContent=s.title.toUpperCase();
  q('#sessionMeta').textContent='начат '+fmtClock(s.createdAt);
  q('#countBadge').textContent=ps.length+' чел.';
  q('#stageGrid').innerHTML=STAGES.map((st,i)=>{
    const at=ph=>ps.filter(p=>p.stage===st.id&&p.phase===ph).length;
    const passed=ps.filter(p=>p.results[st.id]&&p.results[st.id].status!=='playing').length;
    const ready=at('ready'),playing=at('playing'),waiting=at('locked'),open=!!s.open[st.id];
    return '<div class="stage-card"><h3><span>'+(i+1)+'</span> · '+st.n.toUpperCase()+'</h3>'+
      '<div class="stage-counts"><div><b>'+waiting+'</b><small>ждут</small></div><div><b>'+at('tutorial')+'</b><small>обучение</small></div><div class="ready"><b>'+ready+'</b><small>готовы</small></div>'+
      '<div class="playing"><b>'+playing+'</b><small>играют</small></div><div><b>'+passed+'</b><small>прошли</small></div></div>'+
      '<button class="btn orange" data-open="'+st.id+'"'+(open?' disabled':'')+'>'+(open?'✓ ОБУЧЕНИЕ ОТКРЫТО':'📖 ОТКРЫТЬ ОБУЧЕНИЕ'+(waiting?' · '+waiting:''))+'</button>'+
      '<button class="btn cyan" data-start="'+st.id+'"'+(ready?'':' disabled')+'>▶ ЗАПУСТИТЬ ЗАДАНИЕ'+(ready?' · '+ready:'')+'</button>'+
      '<button class="btn" data-stop="'+st.id+'"'+(playing?'':' disabled')+'>■ ЗАВЕРШИТЬ ЭТАП</button></div>';
  }).join('');
  const done=ps.filter(p=>p.phase==='finished').length;
  q('#finalBtn').disabled=!!s.finalAt;
  q('#finalInfo').textContent=s.finalAt?'Сигнал отправлен в '+fmtClock(s.finalAt)+'. Кто дойдёт до финала позже, тоже увидит союзника.':'Прошли игру: '+done+' из '+ps.length+'.';
  renderTable(q('#liveTable'),ps,true);
}

q('#createForm').onsubmit=async e=>{e.preventDefault();const r=await call('admin:createSession',{title:q('#sessionTitle').value});if(r.ok)q('#sessionTitle').value=''};
q('#endSession').onclick=()=>{if(confirm('Завершить сеанс? Участники увидят экран «Сеанс завершён», результаты сохранятся в истории.'))call('admin:endSession')};
q('#finalBtn').onclick=()=>call('admin:final');
q('#stageGrid').onclick=e=>{
  const b=e.target.closest('button');if(!b)return;
  if(b.dataset.open)call('admin:openTutorial',{stage:b.dataset.open});
  if(b.dataset.start)call('admin:startStage',{stage:b.dataset.start});
  if(b.dataset.stop&&confirm('Завершить этап? Кто ещё играет, получит отметку «не завершил» и перейдёт дальше.'))call('admin:stopStage',{stage:b.dataset.stop});
};
q('#liveTable').onclick=e=>{
  const b=e.target.closest('[data-remove]');if(!b)return;
  const p=state.session.participants.find(x=>x.id===b.dataset.remove);
  if(p&&confirm('Убрать участника «'+p.name+'» из сеанса? Его результаты будут удалены.'))call('admin:removeParticipant',{id:p.id});
};

/* ---------- история ---------- */
async function loadHistory(){
  const r=await new Promise(res=>socket.emit('admin:sessions',{},res));
  if(!r||!r.sessions)return;
  const list=r.sessions.filter(s=>s.endedAt);
  q('#historyList').innerHTML=list.length?list.map(s=>'<button data-id="'+s.id+'"><span><b>'+esc(s.title)+'</b><br><small>'+fmtDate(s.createdAt)+'</small></span><small>'+s.count+' чел. →</small></button>').join(''):'<p class="muted">Завершённых сеансов пока нет.</p>';
}
q('#refreshHistory').onclick=loadHistory;
q('#historyList').onclick=async e=>{
  const b=e.target.closest('button[data-id]');if(!b)return;
  const r=await call('admin:session',{id:b.dataset.id});if(!r.session)return;
  q('#historyTitle').textContent=r.session.title.toUpperCase()+' · '+fmtDate(r.session.createdAt);
  renderTable(q('#historyTable'),r.session.participants,false);
  q('#historyModal').classList.remove('hidden');
};
q('#historyClose').onclick=()=>q('#historyModal').classList.add('hidden');

/* ---------- связь ---------- */
socket.on('connect',()=>{
  q('#netStatus').classList.add('hidden');
  let pin=null;try{pin=sessionStorage.getItem(PIN_KEY)}catch(e){}
  if(pin)auth(pin);
});
socket.on('disconnect',()=>q('#netStatus').classList.remove('hidden'));
socket.on('admin:state',st=>{state=st;clockOffset=st.now-Date.now();render()});
