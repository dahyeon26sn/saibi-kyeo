/* 이단 관련 시설 지역별 밀집도 레이어 — 기존 제보 지도(Leaflet) 위에 "얹기만" 합니다.
   기존 제보 마커·제보하기·위치 알림 코드는 건드리지 않고, 별도 레이어/별도 DOM으로 동작합니다.

   데이터: data/heresy-density.json
   - 현대종교가 공개한 '이단 위치 및 주소록'을 시·군·구별 "개수"로만 집계한 파일이에요.
   - 특정 시설·단체를 지목하지 않도록 시설 이름, 단체 이름, 주소는 넣지 않았고,
     지역 위치도 약 5km 단위로 근사했어요. */
(function(){
'use strict';
const SRC_VIEW='https://www.google.com/maps/d/viewer?mid=1gWkHv_Qkwql726xjLd1wFXRl-32Sceo';
const LV=[['밀집',15,'#4C1D95'],['보통',6,'#8B5CF6'],['적음',1,'#C4B5FD']];   // [이름, 최소 개수, 색]
const R_NEAR=15000;                                                        // 내 주변 지역 목록 반경(m)
const esc=s=>String(s==null?'':s).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const $=(s,r)=>(r||document).querySelector(s);
const fmt=m=>m<1000?Math.round(m/10)*10+'m':(m/1000).toFixed(1)+'km';
const hav=(a,b)=>{const dy=(b.lat-a.lat)*110540,dx=(b.lng-a.lng)*111320*Math.cos(a.lat*Math.PI/180);return Math.hypot(dx,dy);};
const lvOf=n=>n>=LV[0][1]?0:n>=LV[1][1]?1:2;
const nameOf=r=>r.sido===r.sgg.replace(/시$/,'')?r.sgg:`${r.sido} ${r.sgg}`;

let map=null,getUser=()=>null,layer=null,all=[],loaded=false;
const S={mode:'all',val:null,on:true};
const MODES=[['all','전체'],['sido','시·도별'],['dens','밀집도']];
const count=(arr,k)=>{const m={};arr.forEach(i=>m[i[k]]=(m[i[k]]||0)+i.n);return Object.entries(m).sort((a,b)=>b[1]-a[1]);};

function visible(){
  const q=(($('#map-q')||{}).value||'').trim();
  return all.filter(r=>{
    if(S.mode==='sido'&&S.val&&r.sido!==S.val)return false;
    if(S.mode==='dens'&&S.val!==null&&r.lv!==S.val)return false;
    return !q||(r.sido+' '+r.sgg).includes(q);
  });
}
function icon(r){
  const s=Math.round(Math.min(56,22+Math.sqrt(r.n)*6));
  return L.divIcon({className:'',iconSize:[s,s],iconAnchor:[s/2,s/2],
    html:`<div class="hzd" style="width:${s}px;height:${s}px;background:${LV[r.lv][2]};color:${r.lv===2?'#3B2475':'#fff'}">${r.n}</div>`});
}
function render(fit){
  if(!map||!loaded)return;
  if(layer)map.removeLayer(layer);
  const vis=visible();
  layer=L.layerGroup();
  vis.forEach(r=>L.marker([r.lat,r.lng],{icon:icon(r),title:`${nameOf(r)} 이단 관련 시설 ${r.n}곳`,zIndexOffset:-500})
    .bindPopup(`<b>${esc(nameOf(r))}</b><br>이단 관련 시설 <b>${r.n}곳</b> · ${LV[r.lv][0]}<br><small style="color:#5C6780">시·군·구 단위 개수예요. 위치는 대략적인 지역 표시예요.</small>`).addTo(layer));
  if(S.on)layer.addTo(map);
  if(fit&&vis.length&&S.mode!=='all')map.fitBounds(L.latLngBounds(vis.map(r=>[r.lat,r.lng])),{padding:[50,50],maxZoom:11});
  list(vis);
}
function list(vis){
  const sec=$('#hz-sec');sec.style.display=S.on?'flex':'none';if(!S.on)return;
  const u=getUser(),q=(($('#map-q')||{}).value||'').trim(),me=u&&{lat:u[0],lng:u[1]};
  if(!me&&!q){
    $('#hz-title').textContent='내 주변 지역 이단 밀집도';
    $('#hz-list').innerHTML='<div class="empty">내 위치를 켜면 가까운 지역의 이단 관련 시설 수를 보여 드려요<br><button class="hz-c" id="hz-loc" style="margin-top:10px;pointer-events:auto">내 위치 찾기</button></div>';
    return;
  }
  let a=vis.map(r=>({r,d:me?hav(me,r):null}));
  if(me&&!q)a=a.filter(x=>x.d<=R_NEAR);
  if(me)a.sort((x,y)=>x.d-y.d);else a.sort((x,y)=>y.r.n-x.r.n);
  $('#hz-title').textContent=q?`검색 결과 ${a.length}개 지역`:`내 주변 15km 지역 ${a.length}곳 · 가까운 순`;
  $('#hz-list').innerHTML=a.length?a.slice(0,15).map(({r,d})=>`<button class="row" data-id="${r.id}"><span class="dot hz" style="color:${LV[r.lv][2]}">●</span><span class="t"><b>${esc(nameOf(r))}</b><span>이단 관련 시설 ${r.n}곳 · ${LV[r.lv][0]}</span></span>${d!=null?`<span class="dist">${fmt(d)}</span>`:''}</button>`).join('')
    :'<div class="empty">내 주변 15km 안에는 집계된 지역이 없어요</div>';
}
function bar(){
  $('#hz-modes').innerHTML=MODES.map(m=>`<button class="hz-c m" data-mode="${m[0]}" aria-pressed="${S.mode===m[0]}">${m[1]}</button>`).join('');
  const chip=(v,t,dot)=>`<button class="hz-c s" data-val="${esc(v)}" aria-pressed="${String(S.val)===String(v)||(v===''&&S.val===null)}">${dot?`<i style="background:${dot}"></i>`:''}${esc(t)}</button>`;
  let h='';
  if(S.mode==='sido')h=chip('','전체')+count(all,'sido').map(([r,n])=>chip(r,`${r} ${n}`)).join('');
  else if(S.mode==='dens')h=chip('','전체')+LV.map((l,i)=>chip(i,l[0],l[2])).join('')+`<span class="hz-note">시·군·구별 ${LV[0][1]}곳↑ 밀집 · ${LV[1][1]}곳↑ 보통</span>`;
  $('#hz-sub').innerHTML=h;
}
function msg(t){$('#hz-sub').innerHTML=`<span class="hz-note">${esc(t)}</span>`;}

function build(){
  const wrap=$('#v-map .mapwrap');wrap.classList.add('hz-has');
  const st=document.createElement('style');st.textContent=`
.hz-has .mapbadge{top:auto;bottom:36px}
.hz-bar{position:absolute;left:0;right:0;top:72px;z-index:500;display:flex;flex-direction:column;gap:6px;pointer-events:none}
.hz-r{display:flex;gap:6px;overflow-x:auto;padding:2px 16px;scrollbar-width:none}.hz-r::-webkit-scrollbar{display:none}
.hz-c{flex:none;pointer-events:auto;border-radius:999px;padding:5px 12px;font-size:13px;font-weight:600;background:var(--bg);border:1.5px solid var(--line);box-shadow:0 1px 6px rgba(0,0,0,.12);white-space:nowrap}
.hz-c[aria-pressed=true]{background:#5B21B6;border-color:#5B21B6;color:#fff}
.hz-c.m[aria-pressed=true]{background:var(--ink);border-color:var(--ink)}
.hz-c.rep[aria-pressed=true]{background:var(--red);border-color:var(--red)}
.hz-c i{display:inline-block;width:10px;height:10px;border-radius:5px;margin-right:6px;border:1.5px solid #fff;vertical-align:-1px}
.hz-note{flex:none;pointer-events:auto;background:rgba(255,255,255,.94);border-radius:10px;padding:4px 10px;font-size:12px;color:var(--sub)}
.hzd{border-radius:50%;font-weight:700;font-size:13px;display:grid;place-items:center;border:3px solid rgba(255,255,255,.9);box-shadow:0 2px 6px rgba(0,0,0,.2);opacity:.85}
.row .dot.hz{background:#EDE7FB;font-size:14px}
.hz-hide-reports .leaflet-marker-icon:has(.cnt){display:none}`;
  document.head.appendChild(st);
  const b=document.createElement('div');b.className='hz-bar';
  b.innerHTML=`<div class="hz-r"><button class="hz-c" data-t="on" aria-pressed="true">이단 밀집도</button><button class="hz-c rep" data-t="rep" aria-pressed="true">사용자 제보</button></div><div class="hz-r" id="hz-modes"></div><div class="hz-r" id="hz-sub"></div>`;
  wrap.appendChild(b);
  const sec=document.createElement('div');sec.className='sec';sec.id='hz-sec';sec.style.cssText='gap:8px;border-top:1px solid var(--line);padding-top:12px';
  sec.innerHTML=`<div class="sec-head"><h2 id="hz-title">이단 밀집도</h2></div><div id="hz-list" style="display:flex;flex-direction:column;gap:8px"></div>
  <p class="muted" style="font-size:12px">출처: 현대종교 공개 지도 '이단 위치 및 주소록'을 시·군·구별 개수로 집계했어요. 특정 시설이나 단체를 지목하지 않도록 이름과 주소는 표시하지 않으며, 시설 수는 그 지역의 위험도나 불법 여부를 뜻하지 않아요. 원자료 기준이라 실제와 다를 수 있어요. <a href="${SRC_VIEW}" target="_blank" rel="noopener">원본 자료</a></p>`;
  $('#v-map .sheet').appendChild(sec);
  b.addEventListener('click',e=>{
    const c=e.target.closest('button');if(!c)return;
    if(c.dataset.t==='on'){S.on=!S.on;c.setAttribute('aria-pressed',S.on);render(false);}
    else if(c.dataset.t==='rep'){const on=c.getAttribute('aria-pressed')!=='true';c.setAttribute('aria-pressed',on);$('#lmap').classList.toggle('hz-hide-reports',!on);}
    else if(c.dataset.mode){S.mode=c.dataset.mode;S.val=null;if(!S.on){S.on=true;$('[data-t=on]',b).setAttribute('aria-pressed',true);}bar();render(true);}
    else if(c.dataset.val!==undefined){const v=c.dataset.val;S.val=v===''?null:(S.mode==='dens'?+v:v);bar();render(true);}
  });
  sec.addEventListener('click',e=>{
    if(e.target.closest('#hz-loc')){const lb=$('#loc-btn');if(lb)lb.click();return;}
    const r=e.target.closest('[data-id]');if(!r)return;const it=all[+r.dataset.id];
    map.setView([it.lat,it.lng],Math.max(map.getZoom(),12));
    $('#v-map .mapwrap').scrollIntoView({block:'nearest',behavior:'smooth'});
  });
  const q=$('#map-q');if(q)q.addEventListener('input',()=>render(false));
}
window.Heresy={
  attach(m,gu){
    if(map||!window.L)return;map=m;getUser=gu||getUser;build();
    msg('이단 밀집도 정보를 불러오는 중이에요…');$('#hz-modes').innerHTML='';
    fetch('data/heresy-density.json').then(r=>{if(!r.ok)throw 0;return r.json();}).then(d=>{
      all=(d.regions||[]).map((r,i)=>Object.assign(r,{id:i,lv:lvOf(r.n)}));
      loaded=true;bar();render(false);
    }).catch(()=>{msg('이단 밀집도 정보를 불러오지 못했어요.');$('#hz-sec').style.display='none';});
  },
  onShow(){if(loaded)render(false);},
  refresh(){if(loaded)render(false);}
};
})();
