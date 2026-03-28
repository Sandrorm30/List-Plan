const S = { apiUrl:'', token:'', sheets:[], current:null, tab:null, page:1, search:'', searchTimer:null };

document.addEventListener('DOMContentLoaded', () => {
  S.apiUrl = localStorage.getItem('SV_URL')   || '';
  S.token  = localStorage.getItem('SV_TOKEN') || '';
  setFieldVal('cfgUrl',   S.apiUrl);
  setFieldVal('cfgToken', S.token);
  if (!S.apiUrl || !S.token) { openSettings(); } else { loadList(); }
});

async function loadList() {
  setApiStatus('loading');
  try {
    const data = await api('list');
    S.sheets = data.spreadsheets || [];
    renderNav();
    setApiStatus('ok');
  } catch (err) { setApiStatus('error'); openSettings(); }
}

function renderNav(filter) {
  const nav  = document.getElementById('sheetNav');
  const list = filter ? S.sheets.filter(s => s.name.toLowerCase().includes(filter.toLowerCase())) : S.sheets;
  if (!list.length) { nav.innerHTML = '<p class="nav-empty muted">Nenhuma planilha.</p>'; return; }
  nav.innerHTML = list.map(s => `
    <div class="nav-item ${S.current?.id===s.id?'active':''}" onclick="selectSheet('${s.id}','${esc(s.name)}')">
      <div class="nav-item-label">
        <div class="nav-icon"></div>
        <span title="${esc(s.name)}">${esc(s.name)}</span>
      </div>
      <button class="nav-del" onclick="event.stopPropagation();removeSheet('${s.id}')" title="Remover">✕</button>
    </div>`).join('');
}

function filterSidebar(val) { renderNav(val); }

async function selectSheet(id, name) {
  S.current = { id, name }; S.tab = null; S.page = 1; S.search = '';
  setTopTitle(name, 'Carregando abas...');
  renderNav();
  showLoading();
  document.getElementById('tabsBar').style.display = 'none';
  document.getElementById('toolbar').style.display = 'none';
  try {
    const data = await api('tabs', { id });
    renderTabs(data.tabs);
    setTopTitle(data.name, `${data.tabs.length} aba(s)`);
    document.getElementById('tabsBar').style.display = '';
    if (data.tabs.length > 0) { selectTab(data.tabs[0].name); }
    else { showMessage('Esta planilha não tem abas com dados.'); }
  } catch (err) { showMessage('Erro: ' + err.message, true); }
  closeSidebar();
}

function renderTabs(tabs) {
  document.getElementById('tabsList').innerHTML = tabs.map(t => `
    <button class="tab-btn" id="tab-${cssId(t.name)}" onclick="selectTab('${esc(t.name)}')">
      ${esc(t.name)} <span style="color:var(--muted);font-size:11px;margin-left:4px">(${t.rows})</span>
    </button>`).join('');
}

async function selectTab(tabName) {
  S.tab = tabName; S.page = 1; S.search = '';
  setFieldVal('tableSearch', '');
  document.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));
  const btn = document.getElementById('tab-' + cssId(tabName));
  if (btn) btn.classList.add('active');
  document.getElementById('toolbar').style.display = '';
  await loadData();
}

async function loadData() {
  showLoading();
  try {
    const data = await api('data', { id:S.current.id, tab:S.tab, page:S.page, search:S.search });
    renderTable(data);
    document.getElementById('rowCount').textContent = `${data.total} linha(s)` + (S.search ? ` para "${S.search}"` : '');
    renderPagination(data.page, data.pages);
  } catch (err) { showMessage('Erro: ' + err.message, true); }
}

function renderTable(data) {
  const content = document.getElementById('content');
  if (!data.headers.length) { content.innerHTML = '<div class="welcome"><p class="muted">Esta aba está vazia.</p></div>'; return; }
  const ths = data.headers.map(h => `<th title="${esc(h)}">${esc(h)}</th>`).join('');
  const trs = data.rows.map(row => `<tr>${row.map(c => `<td title="${esc(c)}">${esc(c)}</td>`).join('')}</tr>`).join('');
  content.innerHTML = `<div class="table-wrap"><table><thead><tr>${ths}</tr></thead><tbody>${trs||`<tr><td colspan="${data.headers.length}" style="text-align:center;color:var(--muted)">Nenhum resultado.</td></tr>`}</tbody></table></div>`;
}

function renderPagination(current, total) {
  const el = document.getElementById('paginationTop');
  if (total <= 1) { el.innerHTML = ''; return; }
  let html = `<button class="page-btn" onclick="goPage(${current-1})" ${current<=1?'disabled':''}>‹</button>`;
  paginationRange(current, total).forEach(p => {
    if (p === '...') html += `<span style="color:var(--muted);padding:0 4px">…</span>`;
    else html += `<button class="page-btn ${p===current?'active':''}" onclick="goPage(${p})">${p}</button>`;
  });
  html += `<button class="page-btn" onclick="goPage(${current+1})" ${current>=total?'disabled':''}>›</button>`;
  el.innerHTML = html;
}

function paginationRange(current, total) {
  if (total <= 7) return Array.from({length:total},(_,i)=>i+1);
  const pages = [1];
  if (current > 3) pages.push('...');
  for (let i=Math.max(2,current-1); i<=Math.min(total-1,current+1); i++) pages.push(i);
  if (current < total-2) pages.push('...');
  pages.push(total);
  return pages;
}

function goPage(p) { if (p<1||p>999) return; S.page=p; loadData(); }

function debounceSearch(val) {
  clearTimeout(S.searchTimer);
  S.searchTimer = setTimeout(() => { S.search=val; S.page=1; loadData(); }, 500);
}

function openAddModal() { openModal('addModal'); }

async function confirmAdd() {
  const id  = document.getElementById('addId').value.trim();
  const name= document.getElementById('addName').value.trim();
  const btn = document.getElementById('addConfirmBtn');
  if (!id) { showAddError('Informe o ID.'); return; }
  btn.disabled=true; btn.textContent='Adicionando...';
  document.getElementById('addError').style.display='none';
  try {
    const data = await apiPost({ action:'addSpreadsheet', id, name });
    S.sheets.push({ id:data.id, name:data.name });
    renderNav();
    closeModal('addModal');
    document.getElementById('addId').value='';
    document.getElementById('addName').value='';
    selectSheet(data.id, data.name);
  } catch (e) { showAddError(e.message); }
  finally { btn.disabled=false; btn.textContent='Adicionar'; }
}

function showAddError(msg) { const el=document.getElementById('addError'); el.textContent=msg; el.style.display='block'; }

async function removeSheet(id) {
  const s = S.sheets.find(x=>x.id===id);
  if (!confirm(`Remover "${s?.name||id}"?`)) return;
  try {
    await apiPost({ action:'removeSpreadsheet', id });
    S.sheets = S.sheets.filter(x=>x.id!==id);
    if (S.current?.id===id) {
      S.current=null; S.tab=null;
      document.getElementById('tabsBar').style.display='none';
      document.getElementById('toolbar').style.display='none';
      setTopTitle('Selecione uma planilha','');
      showWelcome();
    }
    renderNav();
  } catch (e) { alert('Erro: '+e.message); }
}

function openSettings() { openModal('settingsModal'); setFieldVal('cfgUrl',S.apiUrl); setFieldVal('cfgToken',S.token); }

function saveSettings() {
  S.apiUrl = document.getElementById('cfgUrl').value.trim();
  S.token  = document.getElementById('cfgToken').value.trim();
  localStorage.setItem('SV_URL',S.apiUrl);
  localStorage.setItem('SV_TOKEN',S.token);
  document.getElementById('cfgStatus').textContent='Salvo!';
  setTimeout(()=>{ closeModal('settingsModal'); document.getElementById('cfgStatus').textContent=''; loadList(); },800);
}

async function api(action, params={}) {
  const p = new URLSearchParams({ action, token:S.token, ...params });
  const res = await fetch(`${S.apiUrl}?${p.toString()}`);
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const data = await res.json();
  if (!data.ok) throw new Error(data.error||'Erro desconhecido');
  return data;
}

async function apiPost(body) {
  const res = await fetch(S.apiUrl, {
    method:'POST', headers:{'Content-Type':'text/plain'},
    body: JSON.stringify({...body, token:S.token})
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const data = await res.json();
  if (!data.ok) throw new Error(data.error||'Erro desconhecido');
  return data;
}

function showLoading() { document.getElementById('content').innerHTML='<div class="loading"><div class="spinner"></div></div>'; }
function showMessage(msg,isError) { document.getElementById('content').innerHTML=`<div class="welcome"><p class="${isError?'error-msg':'muted'}">${esc(msg)}</p></div>`; }
function showWelcome() { document.getElementById('content').innerHTML=`<div class="welcome"><svg width="64" height="64" viewBox="0 0 24 24" fill="none"><rect x="2" y="2" width="9" height="9" rx="2.5" fill="#22c55e" opacity=".7"/><rect x="13" y="2" width="9" height="9" rx="2.5" fill="#3b82f6" opacity=".7"/><rect x="2" y="13" width="9" height="9" rx="2.5" fill="#3b82f6" opacity=".7"/><rect x="13" y="13" width="9" height="9" rx="2.5" fill="#22c55e" opacity=".7"/></svg><h2>Bem-vindo ao Sheets Viewer</h2><p class="muted">Selecione uma planilha no menu lateral.</p><button class="btn btn-primary" onclick="openAddModal()">+ Adicionar planilha</button></div>`; }
function setTopTitle(t,s) { document.getElementById('topTitle').textContent=t; document.getElementById('topSub').textContent=s||''; }
function setApiStatus(state) {
  const el=document.getElementById('apiStatus');
  const m={ok:['badge badge-ok','Conectado'],error:['badge badge-error','Offline'],loading:['badge badge-muted','Verificando...']};
  const [cls,txt]=m[state]||m.loading; el.className=cls; el.textContent=txt;
}
function openModal(id)  { document.getElementById(id).classList.add('open'); }
function closeModal(id) { document.getElementById(id).classList.remove('open'); }
function toggleSidebar() {
  document.getElementById('sidebar').classList.toggle('open');
  document.getElementById('sidebarOverlay')?.classList.toggle('open');
}
function closeSidebar() {
  document.getElementById('sidebar').classList.remove('open');
  document.getElementById('sidebarOverlay')?.classList.remove('open');
}
function setFieldVal(id,val){ const el=document.getElementById(id); if(el) el.value=val||''; }
function esc(v){ return String(v??'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;'); }
function cssId(str){ return str.replace(/[^a-zA-Z0-9]/g,'_'); }