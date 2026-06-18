const EXAM_SECONDS = 4*60*60;

const $ = id=>document.getElementById(id);
const SKEY = "sec_study_state_v1";
let setIdx = 0;
let Q = [];
let perms = [];
let answers = [];
let filter = "all";
let view = [];
let pos = 0;
let reviewMode = "wrong";

let remaining = EXAM_SECONDS;
let timerId = null;
let running = false;
let startedOnce = false;

function makePerm(){ const p=[0,1,2,3]; for(let i=3;i>0;i--){const j=Math.floor(Math.random()*(i+1));[p[i],p[j]]=[p[j],p[i]];} return p; }
function applyPerm(qsrc,p){ const o=p.map(i=>qsrc.o[i]); const a=p.indexOf(qsrc.a); const r={d:qsrc.d,q:qsrc.q,o:o,a:a,e:qsrc.e}; if(qsrc.oe) r.oe=p.map(i=>qsrc.oe[i]); return r; }

function storageOK(){ try{ const k="__t"; localStorage.setItem(k,"1"); localStorage.removeItem(k); return true; }catch(e){ return false; } }
const PERSIST = storageOK();
function loadState(){ if(!PERSIST) return null; try{ const r=localStorage.getItem(SKEY); return r?JSON.parse(r):null; }catch(e){ return null; } }
function saveState(){
  if(!PERSIST) return;
  try{
    const all=loadState()||{version:1,current:setIdx,sets:{}};
    all.current=setIdx;
    all.sets[setIdx]={perms:perms,answers:answers,remaining:remaining,startedOnce:startedOnce,pos:pos,filter:filter};
    localStorage.setItem(SKEY,JSON.stringify(all));
  }catch(e){}
}
function clearState(){ if(!PERSIST) return; try{ localStorage.removeItem(SKEY); }catch(e){} }

// ---- lazy set loading ----
function _showLoadingMsg(i){
  $("quiz").style.display="none";
  $("resultsView").classList.remove("show");
  $("dashView").classList.remove("show");
  let lm=document.getElementById("_lm");
  if(!lm){
    lm=document.createElement("div"); lm.id="_lm"; lm.className="card";
    lm.style.cssText="text-align:center;padding:40px 0;margin-top:8px";
    const quiz=$("quiz"); quiz.parentNode.insertBefore(lm,quiz);
  }
  lm.style.display="block";
  lm.innerHTML=`<div class="clocklbl" style="font-size:13px;color:var(--muted)">セット ${i+1} を読み込み中...</div>`;
  return lm;
}

function _loadOE(i,cb){
  if(window.ALL_OE && ALL_OE[i]){ cb(); return; }
  const oes=document.createElement("script"); oes.src="set-"+i+"-oe.js";
  oes.onload=cb; oes.onerror=cb; document.head.appendChild(oes);
}

function loadSet(i){
  if(ALL_SETS[i]){ _loadOE(i,()=>{ _mergeOE(i); _doLoadSet(i); }); return; }
  const lm=_showLoadingMsg(i);
  const s=document.createElement("script"); s.src="set-"+i+".js";
  s.onload=()=>{ _loadOE(i,()=>{ _mergeOE(i); lm.style.display="none"; $("quiz").style.display="block"; _doLoadSet(i); }); };
  s.onerror=()=>{ lm.innerHTML=`<div class="clocklbl" style="color:var(--no)">セット ${i+1} の読み込みに失敗しました</div>`; };
  document.head.appendChild(s);
}

function _mergeOE(i){
  if(window.ALL_OE && ALL_OE[i] && ALL_SETS[i]){
    ALL_SETS[i].forEach((q,k)=>{ if(!q.oe) q.oe=ALL_OE[i][k]; });
  }
}

function _doLoadSet(i){
  pauseTimer();
  setIdx=i;
  const st=loadState();
  const ss=st&&st.sets&&st.sets[i];
  if(ss&&ss.perms&&ss.perms.length===ALL_SETS[i].length){
    perms=ss.perms;
    Q=ALL_SETS[i].map((q,k)=>applyPerm(q,perms[k]));
    answers=(ss.answers&&ss.answers.length===Q.length)?ss.answers.slice():new Array(Q.length).fill(null);
    remaining=(typeof ss.remaining==="number")?ss.remaining:EXAM_SECONDS;
    startedOnce=!!ss.startedOnce;
    filter=ss.filter||"all"; pos=ss.pos||0;
    $("tState").textContent=startedOnce?(remaining<=0?"時間切れ":"一時停止"):"未開始";
  }else{
    perms=ALL_SETS[i].map(()=>makePerm());
    Q=ALL_SETS[i].map((q,k)=>applyPerm(q,perms[k]));
    answers=new Array(Q.length).fill(null);
    remaining=EXAM_SECONDS; startedOnce=false; filter="all"; pos=0;
    $("tState").textContent="未開始";
  }
  updateClock();
  buildFilter(); $("filter").value=filter; buildView();
  $("resultsView").classList.remove("show"); $("dashView").classList.remove("show"); $("quiz").style.display="block";
  renderSets(); render(); saveState();
}

// ---- cross-set progress helpers ----
function getSetProgress(i,st){
  const ss=st&&st.sets&&st.sets[i];
  if(!ss||!ss.answers||!ss.perms) return null;
  // Set data not yet loaded: report answered count only, correct is unknown
  if(!ALL_SETS[i]){
    const answered=ss.answers.filter(x=>x!==null).length;
    return {answered, correct:null, total:ss.answers.length};
  }
  const total=ALL_SETS[i].length; let answered=0,correct=0;
  ss.answers.forEach((sel,j)=>{
    if(sel===null) return; answered++;
    if(j<ss.perms.length){ const ci=ss.perms[j].indexOf(ALL_SETS[i][j].a); if(sel===ci) correct++; }
  });
  return {answered,correct,total};
}
function getAllProgress(){
  const st=loadState();
  let totalAnswered=0,totalCorrect=0;
  // Use 125 as fallback question count for unloaded sets
  const totalQ=ALL_SETS.reduce((s,a)=>s+(a?a.length:125),0);
  const domMap={};
  ALL_SETS.forEach((set,i)=>{
    if(!set) return; // skip unloaded sets
    const ss=st&&st.sets&&st.sets[i];
    set.forEach((q,j)=>{
      if(!domMap[q.d]) domMap[q.d]={ok:0,ans:0,total:0};
      domMap[q.d].total++;
      if(!ss||!ss.answers) return;
      const sel=ss.answers[j];
      if(sel===null||sel===undefined) return;
      domMap[q.d].ans++; totalAnswered++;
      if(ss.perms&&j<ss.perms.length){ const ci=ss.perms[j].indexOf(set[j].a); if(sel===ci){domMap[q.d].ok++;totalCorrect++;} }
    });
  });
  return {totalAnswered,totalCorrect,totalQ,domMap};
}
function showDashboard(){
  $("quiz").style.display="none";
  $("resultsView").classList.remove("show");
  $("dashView").classList.add("show");
  window.scrollTo({top:0,behavior:'smooth'});
  renderDashboard();
}
function renderDashboard(){
  const all=getAllProgress();
  const rate=all.totalAnswered?Math.round(all.totalCorrect/all.totalAnswered*100):null;
  $("dash-total").innerHTML=all.totalAnswered+'<span style="font-size:14px;color:var(--muted)">/' +all.totalQ+'</span>';
  $("dash-correct").textContent=all.totalCorrect;
  $("dash-rate").textContent=rate!==null?rate+"%":"—";
  $("dash-rate").style.color=rate===null?"var(--txt)":rate>=70?"var(--ok)":rate>=40?"var(--amber)":"var(--no)";
  const st=loadState();
  const ds=$("dash-sets"); ds.innerHTML="";
  ALL_SETS.forEach((set,i)=>{
    const p=getSetProgress(i,st);
    const pct=(p&&p.answered&&p.correct!==null)?Math.round(p.correct/p.answered*100):null;
    const done=p&&p.answered>0&&p.answered===p.total;
    const col=pct===null?"var(--muted)":pct>=70?"var(--ok)":pct>=40?"var(--amber)":"var(--no)";
    const barW=p?Math.round(p.answered/(p.total||125)*100):0;
    const row=document.createElement("div"); row.className="setrow"+(i===setIdx?" cur":"");
    row.innerHTML=`<span class="sr-name">セット ${i+1}${done?" ✓":""}</span>`
      +`<span class="sr-prog">${p?(p.answered+"/"+(p.total||"?")):"未開始"}</span>`
      +`<span class="sr-bar"><i style="width:${barW}%;background:${col}"></i></span>`
      +`<span class="sr-pct" style="color:${col}">${pct!==null?pct+"%":"—"}</span>`;
    row.onclick=()=>{
      if(i!==setIdx&&running&&!confirm("タイマーが計測中です。セットを切り替えますか？\n（現在の進捗は保存されています）")) return;
      $("dashView").classList.remove("show");
      if(i!==setIdx) loadSet(i); else { $("quiz").style.display="block"; render(); }
    };
    ds.appendChild(row);
  });
  const dd=$("dash-domains"); dd.innerHTML="";
  Object.entries(all.domMap).sort((a,b)=>{
    const pa=a[1].ans?a[1].ok/a[1].ans:1; const pb=b[1].ans?b[1].ok/b[1].ans:1; return pa-pb;
  }).forEach(([d,r])=>{
    const pct=r.ans?Math.round(r.ok/r.ans*100):null;
    const col=pct===null?"var(--muted)":pct>=70?"var(--ok)":pct>=40?"var(--amber)":"var(--no)";
    const row=document.createElement("div"); row.className="domrow";
    row.innerHTML=`<span class="dn">${escapeHtml(d)}</span><span class="db"><i style="width:${pct||0}%;background:${col}"></i></span><span class="ds" style="color:${col};min-width:80px">${r.ok}/${r.ans||0}${pct!==null?" · "+pct+"%":""}</span>`;
    dd.appendChild(row);
  });
}

function renderSets(){
  const c=$("sets"); c.innerHTML="";
  const st=loadState();
  ALL_SETS.forEach((s,i)=>{
    const b=document.createElement("button");
    b.className="setbtn"+(i===setIdx?" active":"");
    const p=getSetProgress(i,st);
    const done=p&&p.answered>0&&p.answered===p.total;
    let label="セット "+(i+1);
    if(p){
      if(done){
        const pct=(p.correct!==null&&p.answered)?Math.round(p.correct/p.answered*100):null;
        label+=" ✓"+(pct!==null?" "+pct+"%":"");
      } else { label+=" · "+p.answered+"/"+(p.total||"?"); }
    }
    b.textContent=label;
    b.onclick=()=>{
      if(i===setIdx) return;
      if(running&&!confirm("タイマーが計測中です。セットを切り替えますか？\n（現在の進捗は保存されています）")) return;
      loadSet(i);
    };
    c.appendChild(b);
  });
}

function buildFilter(){
  const sel=$("filter"); sel.innerHTML="";
  const doms=[]; Q.forEach(q=>{ if(!doms.includes(q.d)) doms.push(q.d); });
  const all=document.createElement("option"); all.value="all"; all.textContent=`全ドメイン (${Q.length})`; sel.appendChild(all);
  doms.forEach(d=>{
    const n=Q.filter(q=>q.d===d).length;
    const o=document.createElement("option"); o.value=d; o.textContent=`${d} (${n})`; sel.appendChild(o);
  });
  sel.onchange=e=>{ filter=e.target.value; pos=0; buildView(); render(); };
}

function buildView(){
  view=Q.map((_,i)=>i).filter(i=> filter==="all" || Q[i].d===filter);
  if(pos>=view.length) pos=0;
}

function escapeHtml(s){ return String(s).replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;"); }

// Allowlist sanitizer: strips everything except <code>, <em>, <strong>, <br> (and their attributes)
function sanitizeHtml(html){
  const ALLOWED=new Set(['CODE','EM','STRONG','BR']);
  const t=document.createElement('template');
  t.innerHTML=html;
  t.content.querySelectorAll('*').forEach(el=>{
    if(!ALLOWED.has(el.tagName)) el.replaceWith(...el.childNodes);
    else [...el.attributes].forEach(a=>el.removeAttribute(a.name));
  });
  const d=document.createElement('div');
  d.appendChild(t.content.cloneNode(true));
  return d.innerHTML;
}

function render(){
  const gi=view[pos]; const q=Q[gi];
  $("qid").textContent="Q"+String(gi+1).padStart(3,"0");
  $("qtag").textContent=q.d;
  $("qtext").innerHTML=sanitizeHtml(q.q);
  const optsEl=$("opts"); optsEl.innerHTML="";
  const keys=["A","B","C","D"]; const chosen=answers[gi];
  q.o.forEach((text,idx)=>{
    const b=document.createElement("button"); b.className="opt"; b.type="button";
    const ksp=document.createElement("span"); ksp.className="key"; ksp.textContent=keys[idx];
    const tsp=document.createElement("span"); tsp.className="opt-label"; tsp.textContent=text;
    b.appendChild(ksp); b.appendChild(tsp);
    if(chosen!==null){
      b.disabled=true;
      if(idx===q.a) b.classList.add("correct"); else if(idx===chosen) b.classList.add("wrong");
      if(q.oe && q.oe[idx]){
        const esp=document.createElement("span"); esp.className="opt-exp"; esp.textContent=q.oe[idx];
        b.appendChild(esp);
      }
    }
    else b.onclick=()=>choose(gi,idx);
    optsEl.appendChild(b);
  });
  const ex=$("explain");
  if(chosen!==null){ $("exptext").textContent=q.e; ex.classList.add("show"); } else ex.classList.remove("show");
  $("navcount").textContent=`${pos+1} / ${view.length}（全${Q.length}問）`;
  updateStats(); updateGrid();
}

function choose(gi,idx){
  if(answers[gi]!==null) return;
  if(!startedOnce){ startTimer(); }
  answers[gi]=idx; saveState(); render();
}

function updateStats(){
  let ans=0,ok=0;
  answers.forEach((sel,i)=>{ if(sel!==null){ans++; if(sel===Q[i].a) ok++;} });
  $("s-ans").innerHTML=ans+'<span style="font-size:14px;color:var(--muted)">/'+Q.length+'</span>';
  $("s-ok").textContent=ok; $("s-no").textContent=ans-ok;
  $("s-rate").textContent=ans?Math.round(ok/ans*100)+"%":"—";
  $("bar").style.width=(ans/Q.length*100)+"%";
}

function updateGrid(){
  const grid=$("grid"); grid.innerHTML="";
  view.forEach((gi,vi)=>{
    const c=document.createElement("div"); c.className="cell"; c.textContent=gi+1;
    const sel=answers[gi];
    if(sel!==null) c.classList.add(sel===Q[gi].a?"ok":"no");
    if(vi===pos) c.classList.add("cur");
    c.onclick=()=>{pos=vi; render();};
    grid.appendChild(c);
  });
}

$("prev").onclick=()=>{ if(pos>0){pos--;render();} };
$("next").onclick=()=>{ if(pos<view.length-1){pos++;render();} };

function fmt(s){ const h=Math.floor(s/3600), m=Math.floor((s%3600)/60), x=s%60; return h+":"+String(m).padStart(2,"0")+":"+String(x).padStart(2,"0"); }
function updateClock(){
  const c=$("clock"); c.textContent=fmt(remaining);
  c.classList.toggle("warn", remaining<=600 && remaining>60);
  c.classList.toggle("danger", remaining<=60);
}
function tick(){
  remaining--; updateClock();
  if(remaining<=0){ pauseTimer(); remaining=0; updateClock(); $("tState").textContent="時間切れ"; saveState(); showResults(true); return; }
  saveState();
}
function startTimer(){
  if(running) return;
  running=true; startedOnce=true; $("tState").textContent="計測中";
  timerId=setInterval(tick,1000); saveState();
}
function pauseTimer(){ running=false; if(timerId){clearInterval(timerId); timerId=null;} if(startedOnce && remaining>0) $("tState").textContent="一時停止"; saveState(); }
$("tStart").onclick=()=>startTimer();
$("tPause").onclick=()=>pauseTimer();
$("tReset").onclick=()=>{ pauseTimer(); remaining=EXAM_SECONDS; startedOnce=false; updateClock(); $("tState").textContent="未開始"; saveState(); };

function elapsedStr(){ const used=EXAM_SECONDS-remaining; return fmt(Math.max(0,used)); }
function domBreakdown(){
  const doms=[]; Q.forEach(q=>{ if(!doms.includes(q.d)) doms.push(q.d); });
  return doms.map(d=>{
    const idxs=Q.map((q,i)=>({q,i})).filter(x=>x.q.d===d).map(x=>x.i);
    let ok=0,ans=0; idxs.forEach(i=>{ if(answers[i]!==null){ans++; if(answers[i]===Q[i].a)ok++;} });
    return {d, ok, total:idxs.length, ans, pct: ans?Math.round(ok/ans*100):0};
  });
}
function showResults(timeUp){
  let ok=0; answers.forEach((s,i)=>{ if(s===Q[i].a) ok++; });
  const ans=answers.filter(x=>x!==null).length;
  $("r-set").textContent="SET "+(setIdx+1);
  $("r-score").textContent=ok; $("r-total").textContent=Q.length;
  let msg;
  if(timeUp) msg=`時間切れで終了。正答率 ${ans?Math.round(ok/ans*100):0}%（解答済 ${ans}問）`;
  else if(ans<Q.length) msg=`未解答 ${Q.length-ans}問あり。正答率 ${ans?Math.round(ok/ans*100):0}%（解答済のみ）`;
  else if(ok>=88) msg="合格圏内の目安(約70%以上)に到達。";
  else msg="あと一歩。弱点ドメインを重点復習しよう（目安は約70%）。";
  $("r-msg").textContent=msg;
  $("r-time").textContent=`使用時間 ${elapsedStr()} / 4:00:00`;
  const ds=$("domStats"); ds.innerHTML="";
  domBreakdown().forEach(r=>{
    const col=r.pct>=70?'var(--ok)':r.pct>=40?'var(--amber)':'var(--no)';
    const row=document.createElement("div"); row.className="domrow";
    row.innerHTML=`<span class="dn">${escapeHtml(r.d)}</span><span class="db"><i style="width:${r.pct}%;background:${col}"></i></span><span class="ds">${r.ok}/${r.total}</span>`;
    ds.appendChild(row);
  });
  $("quiz").style.display="none"; $("dashView").classList.remove("show"); $("resultsView").classList.add("show");
  renderReview();
  window.scrollTo({top:0,behavior:'smooth'});
}
$("toResults").onclick=()=>showResults(false);
$("backToQuiz").onclick=()=>{ $("resultsView").classList.remove("show"); $("quiz").style.display="block"; render(); };
$("toDash").onclick=showDashboard;
$("backFromDash").onclick=()=>{ $("dashView").classList.remove("show"); $("quiz").style.display="block"; render(); };

const KEYS=["A","B","C","D"];

function renderReview(){
  const showAll = reviewMode==="all";
  const c=$("reviewList"); c.innerHTML=""; let n=0;
  Q.forEach((q,i)=>{
    const sel=answers[i]; const correct=(sel===q.a);
    if(!showAll && correct) return;
    n++;
    const cls = sel===null ? "no" : (correct?"ok":"no");
    const mark = sel===null ? "未解答" : (correct?"正解":"不正解");
    const yourAns = sel===null ? "未解答" : (KEYS[sel]+". "+escapeHtml(q.o[sel]));
    const it=document.createElement("div"); it.className="revitem";
    it.innerHTML =
      `<div class="rh"><span class="rb ${cls}">${mark}</span><span class="qid">Q${String(i+1).padStart(3,"0")}</span><span class="tag">${escapeHtml(q.d)}</span></div>`
      + `<div class="rq">${sanitizeHtml(q.q)}</div>`
      + `<div class="ra">あなたの解答: ${yourAns}</div>`
      + `<div class="ra">正解: <b>${KEYS[q.a]}. ${escapeHtml(q.o[q.a])}</b></div>`
      + `<div class="re">${escapeHtml(q.e)}</div>`;
    c.appendChild(it);
  });
  if(n===0){ const p=document.createElement("div"); p.className="sub"; p.style.marginTop="8px"; p.textContent = showAll?"問題がありません。":"不正解・未解答はありません。全問正解です。"; c.appendChild(p); }
  $("revWrong").classList.toggle("on", !showAll);
  $("revAll").classList.toggle("on", showAll);
}
$("revWrong").onclick=()=>{ reviewMode="wrong"; renderReview(); };
$("revAll").onclick=()=>{ reviewMode="all"; renderReview(); };

function reportInnerHTML(){
  let ok=0; answers.forEach((s,i)=>{ if(s===Q[i].a) ok++; });
  const ans=answers.filter(x=>x!==null).length;
  const now=new Date();
  const dstr=now.getFullYear()+"-"+String(now.getMonth()+1).padStart(2,"0")+"-"+String(now.getDate()).padStart(2,"0")+" "+String(now.getHours()).padStart(2,"0")+":"+String(now.getMinutes()).padStart(2,"0");
  const domRows=domBreakdown().map(r=>`<tr><td>${escapeHtml(r.d)}</td><td>${r.ok}/${r.total}</td><td>${r.pct}%</td></tr>`).join("");
  const showAll = reviewMode==="all";
  let items="";
  Q.forEach((q,i)=>{
    const sel=answers[i]; const correct=(sel===q.a);
    if(!showAll && correct) return;
    const mark = sel===null ? "未解答" : (correct?"正解":"不正解");
    const yourAns = sel===null ? "未解答" : (KEYS[sel]+". "+escapeHtml(q.o[sel]));
    items += `<div class="wrongq"><div class="qq"><span class="badge">${mark}</span>Q${String(i+1).padStart(3,"0")} <span class="badge">${escapeHtml(q.d)}</span>${sanitizeHtml(q.q)}</div>`
           + `<div>あなたの解答: ${yourAns}</div>`
           + `<div>正解: ${KEYS[q.a]}. ${escapeHtml(q.o[q.a])}</div>`
           + `<div>解説: ${escapeHtml(q.e)}</div></div>`;
  });
  if(!items) items = showAll ? "<p>問題がありません。</p>" : "<p>不正解・未解答はありません。全問正解です。</p>";
  return `<h2>セキュリティ勉強 模擬試験 結果レポート — セット ${setIdx+1}</h2>`
    + `<div class="meta">日時: ${dstr} ／ 使用時間: ${elapsedStr()} / 4:00:00 ／ スコア: ${ok} / ${Q.length}（解答済 ${ans}問・正答率 ${ans?Math.round(ok/ans*100):0}%）／ 表示範囲: ${showAll?"全問":"不正解・未解答のみ"}</div>`
    + `<table><thead><tr><th>ドメイン</th><th>正解/問題数</th><th>正答率</th></tr></thead><tbody>${domRows}</tbody></table>`
    + `<h3>詳細レビュー（${showAll?"全問":"不正解・未解答"}）</h3>${items}`;
}
$("toPdf").onclick=()=>{ $("printArea").innerHTML=reportInnerHTML(); window.print(); };

function downloadHtml(){
  const css="body{font-family:system-ui,-apple-system,'Hiragino Kaku Gothic ProN','Noto Sans JP',sans-serif;color:#111;max-width:840px;margin:24px auto;padding:0 16px;line-height:1.65}"
    +"h2{margin:0 0 4px;font-size:22px}h3{margin:22px 0 8px}.meta{font-size:12px;color:#444;margin-bottom:14px}"
    +"table{width:100%;border-collapse:collapse;font-size:13px;margin:10px 0}th,td{border:1px solid #ccc;padding:5px 8px;text-align:left}"
    +".wrongq{border:1px solid #ddd;border-radius:8px;padding:9px 12px;margin:9px 0;font-size:13px}.qq{font-weight:600;margin-bottom:4px}"
    +".badge{display:inline-block;border:1px solid #999;border-radius:4px;padding:1px 6px;font-size:11px;margin-right:6px}"
    +"code{font-family:ui-monospace,Menlo,monospace;background:#f2f2f2;border:1px solid #ddd;padding:1px 5px;border-radius:4px;font-size:.9em}";
  const doc="<!DOCTYPE html><html lang=\"ja\"><head><meta charset=\"UTF-8\"><meta name=\"viewport\" content=\"width=device-width, initial-scale=1.0\"><title>セキュリティ勉強 模擬試験 結果レポート</title><style>"+css+"</style></head><body>"+reportInnerHTML()+"</body></html>";
  const blob=new Blob([doc],{type:"text/html;charset=utf-8"});
  const url=URL.createObjectURL(blob);
  const now=new Date(); const ds=now.getFullYear()+String(now.getMonth()+1).padStart(2,"0")+String(now.getDate()).padStart(2,"0")+"_"+String(now.getHours()).padStart(2,"0")+String(now.getMinutes()).padStart(2,"0");
  const a=document.createElement("a");
  a.href=url; a.download="セキュリティ勉強_結果_セット"+(setIdx+1)+"_"+ds+".html";
  document.body.appendChild(a); a.click(); document.body.removeChild(a);
  // Use onafterprint-style cleanup: revoke after a safe delay
  window.addEventListener("focus", function revokeOnce(){ URL.revokeObjectURL(url); window.removeEventListener("focus", revokeOnce); }, {once:true});
  setTimeout(()=>URL.revokeObjectURL(url), 60000);
}
$("toHtml").onclick=downloadHtml;

function resetAnswers(){
  answers=new Array(Q.length).fill(null); filter="all"; pos=0;
  buildFilter(); $("filter").value=filter; buildView();
  $("resultsView").classList.remove("show"); $("dashView").classList.remove("show"); $("quiz").style.display="block"; saveState(); render();
}
$("reset").onclick=resetAnswers; $("reset2").onclick=resetAnswers;
$("clearSave").onclick=()=>{
  clearState(); $("resumeNote").style.display="none";
  perms=ALL_SETS[setIdx].map(()=>makePerm());
  Q=ALL_SETS[setIdx].map((q,k)=>applyPerm(q,perms[k]));
  answers=new Array(Q.length).fill(null);
  pauseTimer(); remaining=EXAM_SECONDS; startedOnce=false; filter="all"; pos=0;
  updateClock(); $("tState").textContent="未開始";
  buildFilter(); $("filter").value=filter; buildView();
  $("resultsView").classList.remove("show"); $("dashView").classList.remove("show"); $("quiz").style.display="block"; render(); saveState();
};
window.addEventListener("beforeunload", saveState);

const _st=loadState();
loadSet(_st&&typeof _st.current==="number"?_st.current:0);
updateClock();
if(_st){ $("resumeNote").style.display="block"; }

// Dark / light mode toggle
(function(){
  const TKEY='_sq_theme';
  const btn=document.getElementById('themeToggle');
  function applyTheme(t){
    if(t==='light'){document.documentElement.setAttribute('data-theme','light');btn.textContent='ダーク';}
    else{document.documentElement.removeAttribute('data-theme');btn.textContent='ライト';}
    localStorage.setItem(TKEY,t);
  }
  btn.onclick=function(){applyTheme(document.documentElement.getAttribute('data-theme')==='light'?'dark':'light');};
  btn.textContent=document.documentElement.getAttribute('data-theme')==='light'?'ダーク':'ライト';
})();

// Password gate: SHA-256 check + brute-force lockout (5 attempts → 30s lock)
(function(){
  const H='39e18a493b913441c12fac89a09f24958e5da0ff6f3300c80c5359f36e3223aa';
  const SK='_sq_v2';
  const MAX_ATTEMPTS=5; const LOCK_MS=30000;
  const ov=document.getElementById('pwOverlay');
  async function sha256hex(s){const b=await crypto.subtle.digest('SHA-256',new TextEncoder().encode(s));return Array.from(new Uint8Array(b)).map(x=>x.toString(16).padStart(2,'0')).join('');}
  if(sessionStorage.getItem(SK)===H){ov.style.display='none';return;}
  const btn=document.getElementById('pwBtn');
  const inp=document.getElementById('pwInput');
  const err=document.getElementById('pwErr');
  let attempts=parseInt(sessionStorage.getItem('_sq_at')||'0');

  function lockRemaining(){
    return Math.max(0, parseInt(sessionStorage.getItem('_sq_lk')||'0') - Date.now());
  }
  function showLockMsg(){
    const s=Math.ceil(lockRemaining()/1000);
    err.textContent=`${s}秒後に再試行できます`;
    err.style.display='block';
  }
  function applyLockState(){
    if(lockRemaining()>0){
      btn.disabled=true; inp.disabled=true; showLockMsg();
      const iv=setInterval(()=>{
        if(lockRemaining()<=0){
          btn.disabled=false; inp.disabled=false;
          err.style.display='none';
          clearInterval(iv);
        } else { showLockMsg(); }
      },1000);
      return true;
    }
    return false;
  }
  applyLockState();

  async function tryLogin(){
    if(applyLockState()) return;
    const r=await sha256hex(inp.value);
    if(r===H){
      sessionStorage.setItem(SK,H);
      sessionStorage.removeItem('_sq_at');
      sessionStorage.removeItem('_sq_lk');
      ov.style.display='none';
    } else {
      attempts++;
      sessionStorage.setItem('_sq_at',String(attempts));
      if(attempts>=MAX_ATTEMPTS){
        sessionStorage.setItem('_sq_lk',String(Date.now()+LOCK_MS));
        sessionStorage.setItem('_sq_at','0');
        attempts=0;
        inp.value='';
        applyLockState();
      } else {
        err.textContent=`パスワードが違います（残り${MAX_ATTEMPTS-attempts}回）`;
        err.style.display='block';
        inp.select();
      }
    }
  }
  btn.onclick=tryLogin;
  inp.addEventListener('keydown',e=>{if(e.key==='Enter')tryLogin();});
})();
