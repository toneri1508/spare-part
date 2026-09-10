/* ===== render-overview.js (tu dong tach tu main.js, khong doi logic) ===== */
import { safeSet } from './data.js';
import { closeModal, tagCardHTML } from './item-card.js';
import { stopXuatScan, toggleXuatCamera } from './scanner.js';
import { S } from './state.js';
import { escapeHtml, fmtTime, lineName, statusOf, toast, totalQty, uid, userName, whName } from './utils.js';

export function renderOverview(c){
  const items=S.items;
  if(!items.length){
    c.innerHTML = `<div class="panel"><div class="empty">
      <div class="big">Chưa có vật tư nào</div>
      Thêm spare part bằng cách quét mã ở tab <b>Nhập kho</b>, hoặc nhập hàng loạt qua <b>Nhập kho → Nhập từ Excel</b>.
    </div></div>`;
    return;
  }
  const lowItems=items.filter(i=>statusOf(i)!=='green').sort((a,b)=>(totalQty(a)-a.min)-(totalQty(b)-b.min));
  const totalUnits=items.reduce((a,i)=>a+totalQty(i),0);

  let html = `<div class="panel xuat-quick">
    <h2 class="section-title">⚡ Xuất kho nhanh</h2>
    <div class="scan-box">
      <input id="xuatSearch" placeholder="Nhập mã, tên hoặc nhóm vật tư…" autocomplete="off"/>
      <button class="btn" id="xuatCamBtn">📷 Quét QR</button>
    </div>
    <div id="xuatCameraWrap"><video id="xuatCamVideo" playsinline muted></video><canvas id="xuatCamCanvas" style="display:none;"></canvas>
      <div class="hint">Đưa mã QR trên tem kho vào khung hình.</div></div>
    <div id="xuatSuggest"></div>
  </div>`;

  html += `<div class="stat-strip">
    <div class="stat-card"><div class="num">${items.length}</div><div class="lbl">Mã spare part</div></div>
    <div class="stat-card"><div class="num">${totalUnits}</div><div class="lbl">Tổng tồn kho</div></div>
    <div class="stat-card ${lowItems.length?'warn':''}"><div class="num">${lowItems.length}</div><div class="lbl">Cảnh báo tồn thấp</div></div>
  </div>`;

  html += `<div class="panel"><h2 class="section-title">Cảnh báo tồn thấp toàn hệ thống <span class="count">${lowItems.length}</span></h2>`;
  if(!lowItems.length){
    html += `<div class="empty"><div class="big">Không có cảnh báo</div>Tất cả spare part đang trên mức tồn tối thiểu.</div>`;
  } else {
    html += `<div class="tag-grid">` + lowItems.map(i=>tagCardHTML(i)).join('') + `</div>`;
  }
  html += `</div>`;
  c.innerHTML = html;

  document.getElementById('xuatSearch').addEventListener('input',e=>renderXuatSuggestions(e.target.value));
  document.getElementById('xuatCamBtn').addEventListener('click',toggleXuatCamera);
}

/* ================= XUẤT KHO NHANH (Tổng quan) ================= */

export function renderXuatSuggestions(term){
  const box=document.getElementById('xuatSuggest'); if(!box) return;
  const q=term.trim().toLowerCase();
  if(!q){ box.innerHTML=''; return; }
  const matches=S.items.filter(i=>
    i.code.toLowerCase().includes(q) || i.name.toLowerCase().includes(q) || (i.group||'').toLowerCase().includes(q)
  ).slice(0,6);
  if(!matches.length){ box.innerHTML='<div class="xuat-suggest-empty">Không tìm thấy vật tư phù hợp.</div>'; return; }
  box.innerHTML = matches.map(i=>{
    const st=statusOf(i);
    const badge = st==='green'?'badge-green':st==='amber'?'badge-amber':'badge-red';
    return `<div class="xuat-suggest-item" data-id="${i.id}">
      <div class="xsi-main"><div class="xsi-name">${i.name}</div><div class="xsi-meta">${i.code} · ${i.group||'Chưa phân nhóm'}</div></div>
      <span class="badge ${badge}">${totalQty(i)} ${i.unit}</span>
    </div>`;
  }).join('');
  box.querySelectorAll('.xuat-suggest-item').forEach(el=>{
    el.addEventListener('click',()=>{
      const item=S.items.find(x=>x.id===el.dataset.id);
      const inp=document.getElementById('xuatSearch'); if(inp) inp.value='';
      box.innerHTML='';
      if(item) openXuatModal(item);
    });
  });
}

export function openXuatModal(item){
  stopXuatScan();
  const stocksEntries = Object.entries(item.stocks||{}).filter(([,q])=>q>0);
  const total = totalQty(item);
  const st = statusOf(item);
  const statusClass = total<=0 ? 'bad' : (st==='amber' ? 'warn' : 'ok');
  const bigLabel = total<=0 ? '⛔ HẾT HÀNG' : (st==='amber' ? '⚠ CÒN HÀNG — SẮP HẾT' : '✅ CÒN HÀNG — ĐỦ');

  let html = `<h3>Xuất kho</h3>
    <div class="muted" style="font-size:12.5px;margin-bottom:10px;">${item.code} — ${item.name}</div>
    ${item.detail?`<div class="item-detail-text" style="margin-bottom:10px;padding-top:0;border-top:none;">${escapeHtml(item.detail)}</div>`:''}
    <div class="xuat-status ${statusClass}">
      <div class="big-badge">${bigLabel}</div>
      <div class="sub">Tổng tồn hiện tại: <b>${total} ${item.unit}</b> · Mức tối thiểu: ${item.min} ${item.unit}</div>
      ${stocksEntries.length? `<div class="xuat-wh-breakdown">${stocksEntries.map(([wid,q])=>`<div><span>${whName(wid)}</span><b>${q} ${item.unit}</b></div>`).join('')}</div>` : ''}
    </div>`;

  if(total<=0){
    const lastXuat = S.tx.find(t=>t.itemId===item.id && t.type==='xuat');
    html += `<div class="xuat-last"><b>Lần xuất gần nhất</b><br/>${
      lastXuat ? `${fmtTime(lastXuat.ts)} · ${userName(lastXuat.userId,lastXuat.rawUser)} · ${lastXuat.qty} ${item.unit} · ${whName(lastXuat.whId)}${lastXuat.lineId?' → '+lineName(lastXuat.lineId):''}`
        : 'Chưa có lịch sử xuất kho cho vật tư này.'
    }</div>
    <button class="btn btn-block" onclick="closeModal()">Đóng</button>`;
  } else {
    html += `
    <div class="row2">
      <div class="field"><label class="field-label">Kho xuất</label>
        <select id="xmWh">${stocksEntries.map(([wid,q])=>`<option value="${wid}">${whName(wid)} (còn ${q})</option>`).join('')}</select>
      </div>
      <div class="field"><label class="field-label">Dây chuyền nhận</label>
        <select id="xmLine">${S.meta.lines.map(l=>`<option value="${l.id}">${l.name}</option>`).join('')}</select>
      </div>
    </div>
    <div class="row2">
      <div class="field"><label class="field-label">Số lượng</label>
        <div class="qty-input-wrap">
          <button id="xmQtyMinus" type="button">−</button>
          <input id="xmQty" type="number" min="1" value="1"/>
          <button id="xmQtyPlus" type="button">+</button>
        </div>
      </div>
      <div class="field"><label class="field-label">Lý do (không bắt buộc)</label><input id="xmNote" placeholder="VD: thay thế lỗi định kỳ"/></div>
    </div>
    <button class="btn btn-primary btn-block" id="xmConfirm" style="padding:12px;font-size:14.5px;">Xác nhận xuất kho</button>`;
  }

  document.getElementById('modalContent').innerHTML = html;
  document.getElementById('modalContent').classList.add('wide');
  document.getElementById('modalBg').classList.add('on');

  if(total>0){
    const qtyInp=document.getElementById('xmQty');
    document.getElementById('xmQtyMinus').addEventListener('click',()=>{qtyInp.value=Math.max(1,(parseInt(qtyInp.value)||1)-1);});
    document.getElementById('xmQtyPlus').addEventListener('click',()=>{qtyInp.value=(parseInt(qtyInp.value)||1)+1;});
    document.getElementById('xmConfirm').addEventListener('click',async ()=>{
      const whId=document.getElementById('xmWh').value;
      const lineId=document.getElementById('xmLine').value;
      const qty=Math.max(1,parseInt(qtyInp.value)||1);
      const current=item.stocks[whId]||0;
      if(qty>current){
        if(!confirm('Kho "'+whName(whId)+'" chỉ còn '+current+' '+item.unit+'. Vẫn tiếp tục xuất '+qty+'?')) return;
      }
      item.stocks[whId]=current-qty;
      const txEntry={id:uid('tx'),ts:Date.now(),userId:S.currentUser.id,itemId:item.id,type:'xuat',
        qty:qty, whId:whId, lineId:lineId, note:(document.getElementById('xmNote')||{}).value||''};
      S.tx.unshift(txEntry);
      if(S.tx.length>1000) S.tx=S.tx.slice(0,1000);
      await Promise.all([safeSet('sp_items',S.items), safeSet('sp_tx',S.tx)]);
      closeModal();
      toast('✅ Đã xuất '+qty+' '+item.unit+' · '+item.code+' · '+whName(whId)+' · còn lại '+item.stocks[whId]);
      if(S.activeTab==='overview') renderOverview(document.getElementById('tabContent'));
    });
  }
}
