
/*
 LightTaskSheet - script.js (Readable Production Build)
 Features:
  - Row object model with metadata
  - Undo stack with Ctrl+Z and toast undo
  - Multi-select (click, Ctrl/Cmd+click, Shift+click)
  - Right-click context menu (macOS style)
  - Hierarchical dynamic numbering (H2)
  - Drag & drop reorder for parent rows (sub-rows move with parent)
  - Prevent dragging sub-rows to other parents
  - Delete/duplicate rows
  - Export JSON / XLSX (basic, text values)
  - Save/Load via /api endpoints with JWT auth (used by index.html)
  - Keyboard shortcuts
  - Clean, commented and modular
*/

/* =======================
   Utilities
   ======================= */
const API = '/api';
const TOKEN_KEY = 'lts_token';
const USER_KEY = 'lts_user';
const PALETTE = ['#ffd8a8','#c6f6d5','#dbeafe','#fde68a','#fbcfe8','#e6e6fa','#d1fae5','#fce7f3'];

function uid(){ return Date.now().toString(36) + '-' + Math.random().toString(36).slice(2,8); }
function nowISO(){ return new Date().toISOString(); }
function fmtLocal(iso){ if(!iso) return ''; try { return new Date(iso).toLocaleString(); } catch(e){ return iso; } }
function clamp(v,min,max){ return Math.max(min, Math.min(max, v)); }

function apiFetch(path, opts={}){
  opts.headers = opts.headers || {};
  if(!opts.headers['Content-Type']) opts.headers['Content-Type']='application/json';
  const token = localStorage.getItem(TOKEN_KEY);
  if(token) opts.headers['Authorization'] = 'Bearer ' + token;
  return fetch(API + path, opts).then(async res => {
    if(res.status === 401){ alert('Auth error — please login again'); doLogout(); throw new Error('unauth'); }
    const json = await res.json().catch(()=>null);
    return Object.assign(res, { json });
  });
}

/* =======================
   Model
   ======================= */
/*
 Row object shape:
 {
   id: string,
   cells: [...],
   sub: boolean,
   parent: string|null,
   collapsed: boolean
 }
*/
let sheet = {
  columns: [ {name:'Timestamp',type:'date',color:PALETTE[2]}, {name:'Task',type:'text',color:PALETTE[0]}, {name:'Notes',type:'text',color:PALETTE[1]} ],
  rows: []
};

function migrateColumnsIfNeeded(){
  if(!sheet.columns) sheet.columns = [];
  if(sheet.columns.length && typeof sheet.columns[0] === 'string'){
    sheet.columns = sheet.columns.map((n,i)=>({ name: n || ('Column '+(i+1)), type:'text', color: PALETTE[i%PALETTE.length] }));
  } else {
    sheet.columns = sheet.columns.map((c,i)=> {
      if(typeof c === 'string') return { name: c, type: 'text', color: PALETTE[i%PALETTE.length] };
      return { name: c.name || ('Column '+(i+1)), type: c.type || 'text', color: c.color || PALETTE[i%PALETTE.length] };
    });
  }
}

function migrateRowsIfNeeded(){
  if(!sheet.rows) sheet.rows = [];
  sheet.rows = sheet.rows.map(r => {
    if(Array.isArray(r)){
      return { id: uid(), cells: r.slice(), sub:false, parent:null, collapsed:false };
    }
    if(typeof r === 'object' && r !== null && r.cells === undefined){
      // convert indexed object shape
      const cells = [];
      for(let i=0;i<1000;i++){
        if(!(i in r)) break;
        cells.push(r[i]);
      }
      return { id: r._id || uid(), cells: cells.length?cells:[], sub: !!r._sub, parent: r._parent || null, collapsed: !!r._collapsed };
    }
    return { id: r.id || uid(), cells: Array.isArray(r.cells)? r.cells.slice() : [], sub: !!r.sub, parent: r.parent || null, collapsed: !!r.collapsed };
  });
}

/* Ensure rows always have same length as columns */
function normalizeRows(){
  for(const r of sheet.rows){
    while(r.cells.length < sheet.columns.length) r.cells.push('');
    while(r.cells.length > sheet.columns.length) r.cells.length = sheet.columns.length;
  }
}

/* =======================
   Persistence
   ======================= */
async function loadSheetForUser(username){
  const res = await apiFetch('/sheet/' + encodeURIComponent(username));
  if(res && res.json && res.json.sheet){
    sheet = res.json.sheet;
    migrateColumnsIfNeeded();
    migrateRowsIfNeeded();
    normalizeRows();
    renderTable();
  } else {
    // no sheet yet: initialize
    if(!sheet.rows.length){
      sheet.rows = [{ id: uid(), cells: [nowISO(), '', ''], sub:false, parent:null, collapsed:false }];
    }
    renderTable();
  }
}

async function saveSheetForUser(username){
  await apiFetch('/sheet/' + encodeURIComponent(username), { method:'POST', body: JSON.stringify({ sheet }) });
  showToast('Saved ✓');
}

/* =======================
   Undo Stack
   ======================= */
const Undo = (function(){
  const stack = []; const LIMIT = 20;
  return {
    push(action){
      stack.push(action);
      if(stack.length > LIMIT) stack.shift();
      updateUndoToast();
    },
    undo(){
      const act = stack.pop();
      if(!act) return;
      if(act.type === 'delete-rows'){
        // restore rows at original indexes
        for(const item of act.items){
          sheet.rows.splice(item.index, 0, item.row);
        }
        normalizeRows();
        renderTable();
      } else if(act.type === 'modify-sheet'){
        sheet = act.prev;
        migrateColumnsIfNeeded(); migrateRowsIfNeeded(); normalizeRows();
        renderTable();
      }
      updateUndoToast();
      showToast('Undone ✓');
    },
    peek(){ return stack.length?stack[stack.length-1]:null; },
    clear(){ stack.length=0; updateUndoToast(); }
  };

  function updateUndoToast(){}
})();

/* =======================
   Selection
   ======================= */
const Selection = (function(){
  let selected = new Set();
  let lastClicked = null;
  function clear(){ selected.clear(); lastClicked=null; renderTable(); }
  function isSelected(id){ return selected.has(id); }
  function toggle(id, shift=false, meta=false){
    if(shift && lastClicked){
      // range select
      const ids = sheet.rows.map(r => r.id);
      const a = ids.indexOf(lastClicked), b = ids.indexOf(id);
      if(a===-1 || b===-1){ selected.add(id); lastClicked = id; renderTable(); return; }
      const from = Math.min(a,b), to = Math.max(a,b);
      for(let i=from;i<=to;i++) selected.add(sheet.rows[i].id);
    } else if(meta){
      if(selected.has(id)) selected.delete(id); else selected.add(id);
      lastClicked = id;
    } else {
      selected.clear(); selected.add(id); lastClicked = id;
    }
    renderTable();
  }
  function get(){ return Array.from(selected); }
  return { clear, isSelected, toggle, get, setFromArray(ids){ selected = new Set(ids); renderTable(); } };
})();

/* =======================
   Rendering
   ======================= */
let tableEl = null;

function renderTable(){
  console.log('renderTable called, sheet.rows.length:', sheet.rows.length);
  if(!tableEl) {
    const container = document.querySelector('main.sheet-card');
    if(!container) {
      console.error('Container main.sheet-card not found');
      return;
    }
    console.log('Creating table element');
    tableEl = document.createElement('table');
    tableEl.className = 'sheet';
    tableEl.id = 'sheetTable';
    container.innerHTML = '';
    container.appendChild(tableEl);
  }
  
  if(!tableEl) {
    console.error('Table element not created');
    return;
  }
  
  migrateColumnsIfNeeded(); migrateRowsIfNeeded(); normalizeRows();

  tableEl.innerHTML = '';
  // thead
  const thead = document.createElement('thead');
  const trh = document.createElement('tr');

  // numbering column header
  const thNum = document.createElement('th'); thNum.className = 'col-number sticky-left';
  thNum.innerHTML = '<div style="display:flex;align-items:center;gap:8px"><strong>#</strong></div>';
  trh.appendChild(thNum);

  // columns
  sheet.columns.forEach((col, ci) => {
    const th = document.createElement('th');
    const header = document.createElement('div'); header.className = 'col-header';
    const title = document.createElement('div'); title.className = 'col-title'; title.textContent = col.name;
    header.appendChild(title);
    const chip = document.createElement('div'); chip.className='color-chip'; chip.style.background = col.color || '#eee';
    chip.title = 'Click to cycle color'; chip.addEventListener('click', ()=> { const idx = PALETTE.indexOf(col.color); col.color = PALETTE[(idx+1+PALETTE.length)%PALETTE.length]; renderTable(); });
    header.appendChild(chip);
    const typeSelect = document.createElement('select'); typeSelect.className='type-select';
    ['text','date','number','tags'].forEach(t=>{ const o=document.createElement('option'); o.value=t; o.textContent=t; if(col.type===t) o.selected=true; typeSelect.appendChild(o); });
    typeSelect.addEventListener('change', ()=> { col.type = typeSelect.value; renderTable(); });
    header.appendChild(typeSelect);

    // header context: right click
    th.appendChild(header);
    th.addEventListener('contextmenu', (e)=> {
      e.preventDefault();
      showHeaderContextMenu(e.clientX, e.clientY, ci);
    });

    trh.appendChild(th);
  });

  const thActions = document.createElement('th'); thActions.textContent = ''; trh.appendChild(thActions);
  thead.appendChild(trh);
  tableEl.appendChild(thead);

  // tbody
  const tbody = document.createElement('tbody');

  // build collapsed map
  const collapsed = {};
  sheet.rows.forEach(r => { if(!r.sub && r.id) collapsed[r.id] = !!r.collapsed; });

  // iterate rows
  for(let i=0;i<sheet.rows.length;i++){
    const row = sheet.rows[i];
    if(row.sub && row.parent && collapsed[row.parent]) continue;

    const tr = document.createElement('tr');
    if(row.sub) tr.classList.add('sub-row');
    if(Selection.isSelected && Selection.isSelected(row.id)){} // noop for API compatibility

    // numbering column
    const tdNum = document.createElement('td'); tdNum.className='col-number sticky-left';
    const numSpan = document.createElement('div'); numSpan.className='num';
    numSpan.innerHTML = '<span class="h-num">'+ computeHierNumber(i) +'</span>';
    // drag handle
    const dragHandle = document.createElement('span'); dragHandle.className='drag-handle'; dragHandle.textContent='⋮';
    numSpan.prepend(dragHandle);
    tdNum.appendChild(numSpan);
    tr.appendChild(tdNum);

    // cells
    for(let ci=0;ci<sheet.columns.length;ci++){
      const col = sheet.columns[ci];
      const td = document.createElement('td');
      const value = (row.cells && (ci in row.cells)) ? row.cells[ci] : '';
      if(ci===0 && col.type === 'date'){
        // First column as timestamp - make it editable
        const inp = document.createElement('input'); inp.type='datetime-local';
        if(value){ try{ const d = new Date(value); const pad=(n)=>String(n).padStart(2,'0'); inp.value = d.getFullYear()+'-'+pad(d.getMonth()+1)+'-'+pad(d.getDate())+'T'+pad(d.getHours())+':'+pad(d.getMinutes()); }catch(e){} }
        inp.addEventListener('change', ()=> row.cells[ci] = inp.value ? new Date(inp.value).toISOString() : '');
        td.appendChild(inp);
      } else {
        if(col.type === 'date'){
          const inp = document.createElement('input'); inp.type='datetime-local';
          if(value){ try{ const d = new Date(value); const pad=(n)=>String(n).padStart(2,'0'); inp.value = d.getFullYear()+'-'+pad(d.getMonth()+1)+'-'+pad(d.getDate())+'T'+pad(d.getHours())+':'+pad(d.getMinutes()); }catch(e){} }
          inp.addEventListener('change', ()=> row.cells[ci] = inp.value ? new Date(inp.value).toISOString() : '');
          td.appendChild(inp);
        } else if(col.type === 'number'){
          const inp = document.createElement('input'); inp.type='number'; inp.value = value !== undefined ? value : '';
          inp.addEventListener('input', ()=> { const n = parseFloat(inp.value); row.cells[ci] = isNaN(n)?'':n; });
          td.appendChild(inp);
        } else if(col.type === 'tags'){
          const wrap = document.createElement('div'); wrap.style.display='flex'; wrap.style.flexWrap='wrap';
          const tags = Array.isArray(value)? value : (value?String(value).split(',').map(s=>s.trim()).filter(Boolean):[]);
          tags.forEach(t=>{ const s = document.createElement('span'); s.className='tag'; s.textContent=t; wrap.appendChild(s); });
          const inp = document.createElement('input'); inp.type='text'; inp.placeholder='tag1,tag2'; inp.style.width='100%';
          inp.addEventListener('change', ()=> { row.cells[ci] = String(inp.value).split(',').map(s=>s.trim()).filter(Boolean); renderTable(); });
          td.appendChild(wrap); td.appendChild(inp);
        } else {
          const span = document.createElement('div'); span.contentEditable = true; span.style.minHeight='24px';
          if(row.sub && ci===1){
            const prefix = document.createElement('span'); prefix.className='sub-prefix'; prefix.textContent='↳ ';
            span.appendChild(prefix);
            const content = document.createElement('span'); content.textContent = value || ''; span.appendChild(content);
            span.addEventListener('input', ()=> { const txt = span.innerText.replace('↳','').trim(); row.cells[ci] = txt; });
          } else {
            span.innerText = value || ''; span.addEventListener('input', ()=> row.cells[ci] = span.innerText);
          }
          td.appendChild(span);
        }
      }
      tr.appendChild(td);
    }

    // actions cell
    const act = document.createElement('td'); act.style.display='flex'; act.style.gap='8px'; act.style.alignItems='center';
    if(!row.sub){
      const collapseBtn = document.createElement('button'); collapseBtn.className='btn ghost'; collapseBtn.style.padding='6px'; collapseBtn.textContent = row.collapsed ? '▸' : '▾';
      collapseBtn.addEventListener('click', ()=> { row.collapsed = !row.collapsed; renderTable(); });
      act.appendChild(collapseBtn);
      const addSub = document.createElement('button'); addSub.className='btn ghost'; addSub.style.padding='6px'; addSub.textContent='+ sub-row';
      addSub.addEventListener('click', ()=> addSubRow(i));
      act.appendChild(addSub);
    } else {
      const small = document.createElement('div'); small.textContent='sub'; small.style.color='#6b7280'; act.appendChild(small);
    }

    // delete button
    const delBtn = document.createElement('button'); delBtn.className='btn ghost'; delBtn.style.padding='6px'; delBtn.textContent='🗑';
    delBtn.addEventListener('click', ()=> deleteRowByIndex(i));
    act.appendChild(delBtn);

    // duplicate
    const dupBtn = document.createElement('button'); dupBtn.className='btn ghost'; dupBtn.style.padding='6px'; dupBtn.textContent='⎘';
    dupBtn.title = 'Duplicate row';
    dupBtn.addEventListener('click', ()=> duplicateRow(i));
    act.appendChild(dupBtn);

    tr.appendChild(act);

    // selection handlers
    tr.addEventListener('click', (e)=> {
      const meta = (navigator.platform.indexOf('Mac')>=0? e.metaKey : e.ctrlKey);
      Selection.toggle(row.id, e.shiftKey, meta);
    });

    // right-click context
    tr.addEventListener('contextmenu', (e)=> {
      e.preventDefault();
      showRowContextMenu(e.clientX, e.clientY, i);
      return false;
    });

    // drag handle init
    dragHandle.addEventListener('mousedown', (ev)=> { startDragRow(ev, i); });

    tbody.appendChild(tr);
  }

  tableEl.appendChild(tbody);
  updateSelectionVisuals();
}

/* =======================
   Numbering (H2 dynamic)
   ======================= */
function computeHierNumber(rowIndex){
  // rebuild numbering by iterating rows and counting parents
  let counter = 0;
  let parentIndexToNumber = {};
  let currIndex = 0;
  for(let i=0;i<sheet.rows.length;i++){
    const r = sheet.rows[i];
    if(r.sub) continue;
    counter++; parentIndexToNumber[r.id] = counter;
  }
  // find row at given flattened index (including subs filtered by collapsed)
  // Instead compute actual visible ordering and then find visible position mapping to hierarchical number
  const visible = [];
  const collapsed = {};
  sheet.rows.forEach(r => { if(!r.sub) collapsed[r.id] = !!r.collapsed; });
  for(let i=0;i<sheet.rows.length;i++){
    const r = sheet.rows[i];
    if(r.sub && r.parent && collapsed[r.parent]) continue;
    visible.push(r);
  }
  // compute numbering along visible
  const numbering = [];
  let pnum = 0; const childCount = {};
  for(const v of visible){
    if(!v.sub){ pnum++; numbering.push(String(pnum)); childCount[v.id]=0; }
    else {
      const parentNum = numbering.length? numbering[numbering.length-1] : '1';
      childCount[v.parent] = (childCount[v.parent] || 0) + 1;
      numbering.push(parentNum + '.' + childCount[v.parent]);
    }
  }
  // now map rowIndex to visible index
  // reconstruct visible index of the original rowIndex
  let vi = -1; let idx = -1;
  const collapsedMap = {}; sheet.rows.forEach(r => { if(!r.sub) collapsedMap[r.id] = !!r.collapsed; });
  for(let i=0;i<sheet.rows.length;i++){
    const r = sheet.rows[i];
    if(r.sub && r.parent && collapsedMap[r.parent]) continue;
    idx++;
    if(i === rowIndex){ vi = idx; break; }
  }
  if(vi === -1) return '';
  return numbering[vi] || (vi+1).toString();
}

/* =======================
   Row operations
   ======================= */
function addRow(){
  console.log('addRow called');
  console.log('sheet.columns.length:', sheet.columns.length);
  const cells = new Array(sheet.columns.length).fill('');
  cells[0] = nowISO();
  const r = { id: uid(), cells, sub:false, parent:null, collapsed:false };
  console.log('New row:', r);
  sheet.rows.push(r);
  console.log('sheet.rows.length:', sheet.rows.length);
  renderTable();
  console.log('renderTable called');
}

function addSubRow(parentIndex){
  const parent = sheet.rows[parentIndex];
  if(!parent) return;
  const cells = new Array(sheet.columns.length).fill('');
  cells[0] = nowISO();
  const s = { id: uid(), cells, sub:true, parent: parent.id, collapsed:false };
  sheet.rows.splice(parentIndex+1,0,s);
  renderTable();
}

function deleteRowByIndex(index){
  const row = sheet.rows[index];
  if(!row) return;
  if(!row.sub){
    if(!confirm('Delete this row and all its sub-rows?')) return;
    // capture items for undo
    const items = [];
    for(let i=0;i<sheet.rows.length;){
      if(sheet.rows[i].id === row.id){
        items.push({ index: i, row: sheet.rows[i] }); sheet.rows.splice(i,1);
        // remove subsequent sub-rows belonging to this parent
        while(i < sheet.rows.length && sheet.rows[i].sub && sheet.rows[i].parent === row.id){
          items.push({ index: i, row: sheet.rows[i] }); sheet.rows.splice(i,1);
        }
      } else i++;
    }
    Undo.push({ type:'delete-rows', items });
  } else {
    if(!confirm('Delete this sub-row?')) return;
    const removed = sheet.rows.splice(index,1);
    Undo.push({ type:'delete-rows', items: [ { index, row: removed[0] } ] });
  }
  renderTable();
}

function duplicateRow(index){
  const row = sheet.rows[index];
  if(!row) return;
  const copy = JSON.parse(JSON.stringify(row));
  copy.id = uid();
  // if parent row, duplicate its sub-rows as well (insert after last sub-row)
  if(!row.sub){
    // find insertion index after the parent's group
    let insertAt = index+1;
    while(insertAt < sheet.rows.length && sheet.rows[insertAt].sub && sheet.rows[insertAt].parent === row.id) insertAt++;
    // push copy of parent
    sheet.rows.splice(insertAt,0, copy );
    // duplicate sub-rows
    let addPos = insertAt+1;
    for(let i=index+1;i<sheet.rows.length;i++){
      const r = sheet.rows[i];
      if(r.sub && r.parent === row.id){
        const c = JSON.parse(JSON.stringify(r)); c.id = uid(); c.parent = copy.id;
        sheet.rows.splice(addPos,0,c); addPos++;
      } else if(!r.sub) break;
    }
  } else {
    // sub-row duplicate
    const c = JSON.parse(JSON.stringify(row)); c.id = uid();
    sheet.rows.splice(index+1,0,c);
  }
  renderTable();
}

/* Multi-delete for selected rows */
function deleteSelected(){
  const selectedIds = Selection.get();
  if(!selectedIds.length) return alert('No rows selected');
  if(!confirm('Delete selected rows and their sub-rows?')) return;
  // collect items for undo; iterate and remove matches
  const items = [];
  for(let i=0;i<sheet.rows.length;){
    if(selectedIds.includes(sheet.rows[i].id)){
      items.push({ index: i, row: sheet.rows[i] });
      const parentId = sheet.rows[i].id;
      sheet.rows.splice(i,1);
      // remove its sub-rows
      while(i < sheet.rows.length && sheet.rows[i].sub && sheet.rows[i].parent === parentId){
        items.push({ index: i, row: sheet.rows[i] }); sheet.rows.splice(i,1);
      }
    } else i++;
  }
  Undo.push({ type:'delete-rows', items });
  Selection.clear();
  renderTable();
}

/* =======================
   Context Menus
   ======================= */
let ctxMenuEl = null;
function ensureContextMenu(){
  if(ctxMenuEl) return ctxMenuEl;
  ctxMenuEl = document.createElement('div'); ctxMenuEl.className = 'context-menu'; document.body.appendChild(ctxMenuEl);
  document.addEventListener('click', ()=> { ctxMenuEl.style.display='none'; });
  return ctxMenuEl;
}

function showRowContextMenu(x,y, rowIndex){
  const menu = ensureContextMenu(); menu.innerHTML = '';
  menu.style.left = x + 'px'; menu.style.top = y + 'px'; menu.style.display = 'block';
  const addItem = (label, cb) => { const it = document.createElement('div'); it.className='item'; it.textContent = label; it.addEventListener('click', ()=>{ cb(); menu.style.display='none'; }); menu.appendChild(it); };
  addItem('Insert Row Above', ()=> insertRowAt(rowIndex));
  addItem('Insert Row Below', ()=> insertRowAt(rowIndex+1));
  const r = sheet.rows[rowIndex];
  if(r && !r.sub) addItem('Insert Sub-row Below', ()=> addSubRow(rowIndex));
  addItem('Duplicate Row', ()=> duplicateRow(rowIndex));
  addItem('Delete Row', ()=> deleteRowByIndex(rowIndex));
  addItem('Delete Selected Rows', ()=> deleteSelected());
  menu.appendChild(Object.assign(document.createElement('div'), { className:'sep' }));
  addItem('Collapse All', ()=> { sheet.rows.forEach(rr=>rr.sub?0:rr.collapsed=true); renderTable(); });
  addItem('Expand All', ()=> { sheet.rows.forEach(rr=>rr.sub?0:rr.collapsed=false); renderTable(); });
}

function showHeaderContextMenu(x,y, colIndex){
  const menu = ensureContextMenu(); menu.innerHTML=''; menu.style.left=x+'px'; menu.style.top=y+'px'; menu.style.display='block';
  const addItem = (label, cb) => { const it = document.createElement('div'); it.className='item'; it.textContent = label; it.addEventListener('click', ()=>{ cb(); menu.style.display='none'; }); menu.appendChild(it); };
  addItem('Insert Column Left', ()=> insertColumnAt(colIndex));
  addItem('Insert Column Right', ()=> insertColumnAt(colIndex+1));
  addItem('Delete Column', ()=> { if(confirm('Delete column?')) deleteColumn(colIndex); });
  addItem('Rename Column', ()=> { const name = prompt('New column name', sheet.columns[colIndex].name); if(name!==null) sheet.columns[colIndex].name = name; renderTable(); });
}

/* =======================
   Column ops
   ======================= */
function insertColumnAt(index){
  const name = prompt('Column name:', 'Column ' + (index+1));
  if(name === null) return;
  const col = { name: name, type:'text', color: pickColorForNewColumn() };
  sheet.columns.splice(index,0,col);
  for(const r of sheet.rows) r.cells.splice(index,0,'');
  renderTable();
}

function deleteColumn(index){
  if(sheet.columns.length <= 1) return alert('Cannot delete all columns');
  sheet.columns.splice(index,1);
  for(const r of sheet.rows) r.cells.splice(index,1);
  renderTable();
}

function pickColorForNewColumn(){
  const used = new Set(sheet.columns.map(c=>c.color));
  for(const p of PALETTE) if(!used.has(p)) return p;
  return PALETTE[Math.floor(Math.random()*PALETTE.length)];
}

/* =======================
   Insert row helper
   ======================= */
function insertRowAt(index){
  const cells = new Array(sheet.columns.length).fill('');
  cells[0] = nowISO();
  const r = { id: uid(), cells, sub:false, parent:null, collapsed:false };
  sheet.rows.splice(index,0,r);
  renderTable();
}

/* =======================
   Drag & Drop (parent rows only)
   ======================= */
let dragState = null;
function startDragRow(ev, sourceIndex){
  // left only
  if(ev.button !== 0) return;
  const sourceRow = sheet.rows[sourceIndex];
  if(!sourceRow) return;
  // don't allow sub-row dragging individually
  if(sourceRow.sub) return;
  ev.preventDefault();
  dragState = { sourceIndex, sourceRow, startY: ev.clientY, placeholder: null };
  document.addEventListener('mousemove', onDragMove);
  document.addEventListener('mouseup', onDragEnd);
  createDragGhost(ev, sourceRow);
}

function createDragGhost(ev, row){
  let ghost = document.getElementById('drag-ghost');
  if(ghost) ghost.remove();
  ghost = document.createElement('div'); ghost.id = 'drag-ghost'; ghost.className = 'drag-ghost';
  ghost.textContent = 'Moving: ' + (row.cells[1] || '(untitled)');
  document.body.appendChild(ghost);
  moveGhost(ev);
}

function moveGhost(ev){
  const ghost = document.getElementById('drag-ghost');
  if(!ghost) return;
  ghost.style.left = (ev.clientX + 12) + 'px';
  ghost.style.top = (ev.clientY + 12) + 'px';
}

function onDragMove(ev){
  if(!dragState) return;
  moveGhost(ev);
  // compute target index by mouse Y over table rows
  const rows = Array.from(document.querySelectorAll('table.sheet tbody tr'));
  let targetIdx = rows.length; // append default
  for(let i=0;i<rows.length;i++){
    const rect = rows[i].getBoundingClientRect();
    if(ev.clientY < rect.top + rect.height/2){ targetIdx = i; break; }
  }
  // highlight placeholder
  showDragPlaceholderAt(targetIdx);
  dragState.targetIndex = targetIdx;
}

function showDragPlaceholderAt(visibleIndex){
  // remove old placeholder
  const existing = document.querySelector('.drag-placeholder');
  if(existing) existing.remove();
  // create placeholder row element mapped to visible index
  const tbody = document.querySelector('table.sheet tbody');
  const rows = Array.from(tbody.children);
  const placeholder = document.createElement('tr'); const td = document.createElement('td'); td.colSpan = sheet.columns.length + 2;
  td.appendChild(Object.assign(document.createElement('div'), { className:'drag-placeholder' }));
  placeholder.appendChild(td);
  if(visibleIndex >= rows.length) tbody.appendChild(placeholder);
  else tbody.insertBefore(placeholder, rows[visibleIndex]);
}

function clearDragPlaceholder(){ const existing = document.querySelector('.drag-placeholder'); if(existing) existing.remove(); const ghost = document.getElementById('drag-ghost'); if(ghost) ghost.remove(); }

function onDragEnd(ev){
  document.removeEventListener('mousemove', onDragMove);
  document.removeEventListener('mouseup', onDragEnd);
  if(!dragState) return;
  const targetVisibleIndex = dragState.targetIndex !== undefined ? dragState.targetIndex : null;
  clearDragPlaceholder();
  const tbodyRows = Array.from(document.querySelectorAll('table.sheet tbody tr'));
  // Map visible index to sheet index
  let mapping = []; const collapsed = {};
  sheet.rows.forEach(r=>{ if(!r.sub) collapsed[r.id] = !!r.collapsed; });
  for(let i=0;i<sheet.rows.length;i++){
    const r = sheet.rows[i];
    if(r.sub && r.parent && collapsed[r.parent]) continue;
    mapping.push(i);
  }
  if(targetVisibleIndex === null) { dragState = null; return; }
  const destSheetIndex = mapping[ clamp(targetVisibleIndex, 0, mapping.length) ];
  // move source parent + its sub-rows to before destSheetIndex
  const srcIndex = dragState.sourceIndex;
  if(srcIndex === undefined || destSheetIndex === undefined){ dragState = null; return; }
  // don't allow dropping into its own group position
  // collect group
  const group = [];
  for(let i = srcIndex; i < sheet.rows.length;){
    group.push(sheet.rows[i]);
    i++;
    if(i < sheet.rows.length && sheet.rows[i].sub && sheet.rows[i].parent === group[0].id) continue;
    // break if next is not sub of this parent
    break;
  }
  // remove group
  const srcStart = srcIndex;
  let srcCount = 1;
  while(srcStart + srcCount < sheet.rows.length && sheet.rows[srcStart + srcCount].sub && sheet.rows[srcStart + srcCount].parent === sheet.rows[srcStart].id) srcCount++;
  const removed = sheet.rows.splice(srcStart, srcCount);
  // compute adjusted destination index after removal
  let adjustedDest = destSheetIndex;
  if(destSheetIndex > srcStart) adjustedDest = destSheetIndex - srcCount;
  // insert
  sheet.rows.splice(adjustedDest, 0, ...removed);
  renderTable();
  dragState = null;
}

/* =======================
   Selection visual update
   ======================= */
function updateSelectionVisuals(){
  const rows = Array.from(document.querySelectorAll('table.sheet tbody tr'));
  rows.forEach((tr, idx) => {
    const sheetIndex = mapVisibleRowToSheetIndex(idx);
    const rowObj = sheet.rows[sheetIndex];
    if(!rowObj) return;
    if(Selection.get().includes(rowObj.id)) tr.classList.add('selected'); else tr.classList.remove('selected');
  });
}

/* Map visible row index to sheet index (accounting collapsed parents) */
function mapVisibleRowToSheetIndex(visibleIdx){
  const collapsed = {};
  sheet.rows.forEach(r=>{ if(!r.sub) collapsed[r.id] = !!r.collapsed; });
  let vi = -1;
  for(let i=0;i<sheet.rows.length;i++){
    const r = sheet.rows[i];
    if(r.sub && r.parent && collapsed[r.parent]) continue;
    vi++;
    if(vi === visibleIdx) return i;
  }
  return null;
}

/* =======================
   Shortcuts & bindings
   ======================= */
window.addEventListener('keydown', (e)=>{
  const meta = (navigator.platform.indexOf('Mac')>=0 ? e.metaKey : e.ctrlKey);
  if(meta && e.key.toLowerCase() === 's'){ e.preventDefault(); onSaveClicked(); }
  if(meta && !e.shiftKey && e.key.toLowerCase() === 'e'){ e.preventDefault(); exportJSON(); }
  if(meta && e.shiftKey && e.key.toLowerCase() === 'e'){ e.preventDefault(); exportXlsx(); }
  if(meta && e.key.toLowerCase() === 'z'){ e.preventDefault(); Undo.undo(); }
  if(meta && e.key.toLowerCase() === 'n' && !e.shiftKey){ e.preventDefault(); addRow(); }
  if(meta && e.shiftKey && e.key.toLowerCase() === 'n'){ e.preventDefault(); insertColumnAt(sheet.columns.length); }
  if(meta && e.shiftKey && e.key.toLowerCase() === 'c'){ e.preventDefault(); sheet.rows.forEach(r=>r.sub?0:r.collapsed=true); renderTable(); }
});

/* =======================
   Export JSON / XLSX
   ======================= */
function exportJSON(){
  const blob = new Blob([JSON.stringify(sheet,null,2)], { type:'application/json' });
  const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = 'sheet.json'; a.click();
}
function exportXlsx(){
  // Reuse simple XML builder from earlier implementations
  function escapeXml(s){ if(s===undefined||s===null) return ''; return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;'); }
  function colLetter(idx){ let s=''; let n=idx+1; while(n>0){ const rem=(n-1)%26; s = String.fromCharCode(65+rem) + s; n = Math.floor((n-1)/26); } return s; }

  function contentTypesXml(){ return `<?xml version="1.0" encoding="UTF-8"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/><Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/><Override PartName="/docProps/core.xml" ContentType="application/vnd.openxmlformats-package.core-properties+xml"/><Override PartName="/docProps/app.xml" ContentType="application/vnd.openxmlformats-officedocument.extended-properties+xml"/><Override PartName="/xl/_rels/workbook.xml.rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/></Types>`; }
  function relsRelsXml(){ return `<?xml version="1.0" encoding="UTF-8"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/><Relationship Id="rId2" Type="http://schemas.openxmlformats.org/package/2006/relationships/metadata/core-properties" Target="docProps/core.xml"/><Relationship Id="rId3" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/extended-properties" Target="docProps/app.xml"/></Relationships>`; }
  function docPropsCoreXml(){ const now=new Date().toISOString(); return `<?xml version="1.0" encoding="UTF-8"?><cp:coreProperties xmlns:cp="http://schemas.openxmlformats.org/package/2006/metadata/core-properties" xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:dcterms="http://purl.org/dc/terms/" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance"><dc:creator></dc:creator><cp:lastModifiedBy></cp:lastModifiedBy><dcterms:created xsi:type="dcterms:W3CDTF">${now}</dcterms:created><dcterms:modified xsi:type="dcterms:W3CDTF">${now}</dcterms:modified></cp:coreProperties>`; }
  function docPropsAppXml(){ return `<?xml version="1.0" encoding="UTF-8"?><Properties xmlns="http://schemas.openxmlformats.org/officeDocument/2006/extended-properties" xmlns:vt="http://schemas.openxmlformats.org/officeDocument/2006/docPropsVTypes"><Application>LightTaskSheet</Application></Properties>`; }
  function xlWorkbookXml(){ return `<?xml version="1.0" encoding="UTF-8"?><workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets><sheet name="Sheet1" sheetId="1" r:id="rId1"/></sheets></workbook>`; }
  function xlWorkbookRelsXml(){ return `<?xml version="1.0" encoding="UTF-8"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/></Relationships>`; }
  function xlStylesXml(){ return `<?xml version="1.0" encoding="UTF-8"?><styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><fonts count="1"><font><sz val="11"/><color rgb="FF000000"/><name val="Calibri"/></font></fonts><fills count="1"><fill><patternFill patternType="none"/></fill></fills><borders count="1"><border/></borders><cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs><cellXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/></cellXfs></styleSheet>`; }

  function xlWorksheetXml(){
    let xml = `<?xml version="1.0" encoding="UTF-8"?><worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetData>`;
    // header
    xml += `<row r="1">`;
    for(let c=0;c<sheet.columns.length;c++) xml += `<c r="${colLetter(c)}1" t="inlineStr"><is><t>${escapeXml(sheet.columns[c].name||'')}</t></is></c>`;
    xml += `</row>`;
    let rr = 2;
    for(const r of sheet.rows){
      xml += `<row r="${rr}">`;
      for(let c=0;c<sheet.columns.length;c++){
        let v = (r.cells && (c in r.cells)) ? r.cells[c] : '';
        if(r.sub && c===1) v = (v ? '↳ ' + v : '↳');
        xml += `<c r="${colLetter(c)}${rr}" t="inlineStr"><is><t>${escapeXml(v===undefined||v===null?'':String(v))}</t></is></c>`;
      }
      xml += `</row>`; rr++;
    }
    xml += `</sheetData></worksheet>`;
    return xml;
  }

  const files = {
    '[Content_Types].xml': contentTypesXml(),
    '_rels/.rels': relsRelsXml(),
    'docProps/core.xml': docPropsCoreXml(),
    'docProps/app.xml': docPropsAppXml(),
    'xl/workbook.xml': xlWorkbookXml(),
    'xl/_rels/workbook.xml.rels': xlWorkbookRelsXml(),
    'xl/worksheets/sheet1.xml': xlWorksheetXml(),
    'xl/styles.xml': xlStylesXml()
  };

  const blob = zipFiles(files);
  const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = 'sheet.xlsx'; a.click();
  setTimeout(()=> URL.revokeObjectURL(a.href), 60000);
}

/* ZIP helper (similar to previous) */
function zipFiles(filesMap){
  const encoder = new TextEncoder();
  const entries = []; let offset=0; const parts=[];
  function le32(n){ return [n & 0xff, (n>>8)&0xff, (n>>16)&0xff, (n>>24)&0xff]; }
  function le16(n){ return [n & 0xff, (n>>8)&0xff]; }
  const crcTable = (function(){ const table = new Uint32Array(256); for(let i=0;i<256;i++){ let c=i; for(let k=0;k<8;k++) c = (c & 1) ? 0xedb88320 ^ (c >>> 1) : (c >>> 1); table[i] = c>>>0; } return table; })();
  function crc32(buf){ let crc = 0 ^ (-1); for(let i=0;i<buf.length;i++) crc = (crc >>> 8) ^ crcTable[(crc ^ buf[i]) & 0xff]; return (crc ^ (-1)) >>> 0; }

  for(const name of Object.keys(filesMap)){
    const filename = name.replace(/\\/g,'/');
    const data = encoder.encode(filesMap[name]); const crc = crc32(data);
    const compressedSize = data.length; const uncompressedSize = data.length;
    const localHeader = new Uint8Array(30 + filename.length); let p=0;
    localHeader.set([0x50,0x4b,0x03,0x04], p); p+=4; localHeader.set(le16(20), p); p+=2; localHeader.set(le16(0), p); p+=2; localHeader.set(le16(0), p); p+=2; localHeader.set(le16(0), p); p+=2; localHeader.set(le16(0), p); p+=2;
    localHeader.set(le32(crc), p); p+=4; localHeader.set(le32(compressedSize), p); p+=4; localHeader.set(le32(uncompressedSize), p); p+=4; localHeader.set(le16(filename.length), p); p+=2; localHeader.set(le16(0), p); p+=2;
    localHeader.set(encoder.encode(filename), p); p+=filename.length;
    parts.push(localHeader); parts.push(data);
    entries.push({ name: filename, crc, compressedSize, uncompressedSize, localHeaderOffset: offset });
    offset += localHeader.length + data.length;
  }

  const centralParts = []; let cdSize = 0;
  for(const e of entries){
    const filenameBytes = new TextEncoder().encode(e.name);
    const cdfh = new Uint8Array(46 + filenameBytes.length); let p=0;
    cdfh.set([0x50,0x4b,0x01,0x02], p); p+=4; cdfh.set(le16(0x033f), p); p+=2; cdfh.set(le16(20), p); p+=2; cdfh.set(le16(0), p); p+=2; cdfh.set(le16(0), p); p+=2; cdfh.set(le16(0), p); p+=2;
    cdfh.set(le32(e.crc), p); p+=4; cdfh.set(le32(e.compressedSize), p); p+=4; cdfh.set(le32(e.uncompressedSize), p); p+=4; cdfh.set(le16(filenameBytes.length), p); p+=2; cdfh.set(le16(0), p); p+=2; cdfh.set(le16(0), p); p+=2;
    cdfh.set(le16(0), p); p+=2; cdfh.set(le16(0), p); p+=2; cdfh.set(le32(0), p); p+=4; cdfh.set(le32(e.localHeaderOffset), p); p+=4; cdfh.set(filenameBytes, p); p+=filenameBytes.length;
    centralParts.push(cdfh); cdSize += cdfh.length;
  }

  const cdOffset = offset; const eocd = new Uint8Array(22); let q=0;
  eocd.set([0x50,0x4b,0x05,0x06], q); q+=4; eocd.set(le16(0), q); q+=2; eocd.set(le16(0), q); q+=2; eocd.set(le16(entries.length), q); q+=2; eocd.set(le16(entries.length), q); q+=2;
  eocd.set(le32(cdSize), q); q+=4; eocd.set(le32(cdOffset), q); q+=4; eocd.set(le16(0), q); q+=2;
  const all = [...parts, ...centralParts, eocd];
  return new Blob(all, { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
}

/* =======================
   Simple UI helpers (toast, modals)
   ======================= */
function showToast(msg='Saved ✓', duration=1800){
  let t = document.getElementById('toast');
  if(!t){ t = document.createElement('div'); t.id='toast'; t.className='toast'; document.body.appendChild(t); }
  t.innerHTML = `<div>${msg}</div>`;
  const btn = document.createElement('button'); btn.className='undo'; btn.textContent='Undo'; btn.addEventListener('click', ()=> { Undo.undo(); t.style.display='none'; });
  t.appendChild(btn);
  t.style.display='flex';
  clearTimeout(t._t); t._t = setTimeout(()=> t.style.display='none', duration);
}

/* =======================
   Save/Load functions
   ======================= */
async function saveSheetForUser(username){
  try {
    const res = await apiFetch(`/sheet/${username}`, {
      method: 'POST',
      body: JSON.stringify({ sheet })
    });
    if(res.ok) {
      showToast('Saved ✓');
    } else {
      throw new Error('Save failed');
    }
  } catch(err) {
    alert('Save error: ' + err.message);
  }
}

async function loadSheetForUser(username){
  try {
    const res = await apiFetch(`/sheet/${username}`);
    if(res.ok && res.json && res.json.sheet) {
      sheet = res.json.sheet || { 
        columns: [ {name:'Timestamp',type:'date',color:PALETTE[2]}, {name:'Task',type:'text',color:PALETTE[0]}, {name:'Notes',type:'text',color:PALETTE[1]} ], 
        rows: [] 
      };
      migrateColumnsIfNeeded(); 
      migrateRowsIfNeeded(); 
      normalizeRows(); 
      renderTable();
    }
  } catch(err) {
    console.error('Load error:', err);
  }
}

/* =======================
   Auth helpers for index.html buttons (expected by UI)
   ======================= */
async function doLogin(u,p){
  const res = await fetch('/api/login', { method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify({ username: u, password: p }) });
  if(!res.ok){ const j=await res.json().catch(()=>({})); throw new Error(j.error||'Login failed'); }
  const j = await res.json();
  localStorage.setItem(TOKEN_KEY, j.token); localStorage.setItem(USER_KEY, j.username);
  await loadSheetForUser(j.username);
}

async function doRegister(u,p){
  const res = await fetch('/api/register', { method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify({ username: u, password: p }) });
  if(!res.ok) throw new Error('Register failed');
  alert('User created — please login.');
}

function doLogout(){
  localStorage.removeItem(TOKEN_KEY); localStorage.removeItem(USER_KEY);
  // reset sheet
  sheet = { columns: [ {name:'Timestamp',type:'date',color:PALETTE[2]}, {name:'Task',type:'text',color:PALETTE[0]}, {name:'Notes',type:'text',color:PALETTE[1]} ], rows: [] };
  renderTable();
}

/* =======================
   Helpers used by index.html bindings
   ======================= */
function onSaveClicked(){
  const user = localStorage.getItem(USER_KEY);
  if(!user) return alert('Login first');
  saveSheetForUser(user);
}

/* =======================
   Initialization
   ======================= */
function initApp(){
  // attach event listeners for top-level buttons that index.html will provide
  document.getElementById('addRowBtn').addEventListener('click', addRow);
  document.getElementById('addColBtn').addEventListener('click', ()=> insertColumnAt(sheet.columns.length));
  document.getElementById('saveBtn').addEventListener('click', onSaveClicked);
  document.getElementById('exportBtn').addEventListener('click', exportJSON);
  document.getElementById('exportXlsBtn').addEventListener('click', exportXlsx);
  document.getElementById('collapseAllBtn').addEventListener('click', ()=> { sheet.rows.forEach(r=>r.sub?0:r.collapsed=true); renderTable(); });
  document.getElementById('expandAllBtn').addEventListener('click', ()=> { sheet.rows.forEach(r=>r.sub?0:r.collapsed=false); renderTable(); });
  document.getElementById('importFile').addEventListener('change', (ev)=> {
    const f = ev.target.files[0]; if(!f) return;
    const fr = new FileReader(); fr.onload = e => {
      try{ const obj = JSON.parse(e.target.result); if(!obj.columns||!obj.rows) throw new Error('invalid'); sheet = obj; migrateColumnsIfNeeded(); migrateRowsIfNeeded(); normalizeRows(); renderTable(); }catch(err){ alert('Import error: '+err.message); }
    }; fr.readAsText(f);
  });
  // auth UI (login/register) expected by index.html
  const loginBtn = document.getElementById('loginBtn');
  const registerBtn = document.getElementById('registerBtn');
  const logoutBtn = document.getElementById('logoutBtn');
  if(loginBtn) loginBtn.addEventListener('click', async ()=> {
    const u = document.getElementById('username').value.trim(), p = document.getElementById('password').value;
    try{ await doLogin(u,p); document.getElementById('username').style.display='none'; document.getElementById('password').style.display='none'; loginBtn.style.display='none'; registerBtn.style.display='none'; logoutBtn.style.display=''; document.getElementById('userTag').style.display='inline-block'; document.getElementById('userTag').textContent = u; }catch(err){ alert(err.message); }
  });
  if(registerBtn) registerBtn.addEventListener('click', async ()=> {
    const u = document.getElementById('username').value.trim(), p = document.getElementById('password').value;
    try{ await doRegister(u,p); }catch(err){ alert(err.message); }
  });
  if(logoutBtn) logoutBtn.addEventListener('click', ()=> { doLogout(); document.getElementById('username').style.display=''; document.getElementById('password').style.display=''; loginBtn.style.display=''; registerBtn.style.display=''; logoutBtn.style.display='none'; document.getElementById('userTag').style.display='none'; });

  // help modal
  const helpBtn = document.getElementById('helpBtn'); const modal = document.getElementById('modal'); const closeModal = document.getElementById('closeModal');
  if(helpBtn) helpBtn.addEventListener('click', ()=> { modal.style.display='flex'; modal.setAttribute('aria-hidden','false'); });
  if(closeModal) closeModal.addEventListener('click', ()=> { modal.style.display='none'; modal.setAttribute('aria-hidden','true'); });

  // initial seed row
  if(!sheet.rows || sheet.rows.length===0) sheet.rows = [{ id: uid(), cells: [ nowISO(), '', '' ], sub:false, parent:null, collapsed:false }];
  renderTable();
}

document.addEventListener('DOMContentLoaded', initApp);

/* Exporting for debugging if needed */
window.LTS = { sheet, renderTable, addRow, addSubRow, deleteRowByIndex, duplicateRow, exportJSON, exportXlsx, computeHierNumber };
