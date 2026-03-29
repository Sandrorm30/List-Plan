// ═══════════════════════════════════════════════════════════════
// app.js — Sheets Viewer (sem localStorage, 100% em memória)
// ═══════════════════════════════════════════════════════════════

const S = { apiUrl: '', token: '', sheets: [], current: null, tab: null, page: 1, search: '' };
let editMode = false;
window._lastTableData = null;

// ── Utilitários
function esc(v) {
  if (v == null) return '';
  return String(v).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}
function setFieldVal(id, val) { const el = document.getElementById(id); if (el) el.value = val || ''; }
function debounce(fn, ms) { let t; return (...a) => { clearTimeout(t); t = setTimeout(() => fn(...a), ms); }; }
const debounceSearch = debounce(v => { S.search = v; S.page = 1; loadTable(); }, 400);

// ── API
function buildUrl(action, params = {}) {
  const u = new URL(S.apiUrl);
  u.searchParams.set('token', S.token);
  u.searchParams.set('action', action);
  Object.entries(params).forEach(([k, v]) => u.searchParams.set(k, v));
  return u.toString();
}
async function api(action, params = {}) {
  if (!S.apiUrl || !S.token) throw new Error('Configure a URL e o token primeiro.');
  const res = await fetch(buildUrl(action, params));
  const json = await res.json();
  if (json.error) throw new Error(json.error);
  return json;
}
async function apiPost(body) {
  if (!S.apiUrl || !S.token) throw new Error('Configure a URL e o token primeiro.');
  const res = await fetch(S.apiUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ ...body, token: S.token }),
  });
  const json = await res.json();
  if (json.error) throw new Error(json.error);
  return json;
}

// ── Status
function setApiStatus(state) {
  const el = document.getElementById('apiStatus');
  if (!el) return;
  const map = { loading: ['Verificando...','badge-muted'], ok: ['Conectado ✓','badge-ok'], error: ['Erro ✗','badge-error'] };
  const [text, cls] = map[state] || map.loading;
  el.textContent = text;
  el.className = `badge ${cls}`;
}

// ── Sidebar
function toggleSidebar() {
  document.getElementById('sidebar').classList.toggle('open');
  document.getElementById('sidebarOverlay')?.classList.toggle('open');
}
function closeSidebar() {
  document.getElementById('sidebar').classList.remove('open');
  document.getElementById('sidebarOverlay')?.classList.remove('open');
}

// ── Nav
function renderNav() {
  const nav = document.getElementById('sheetNav');
  const srch = document.getElementById('sidebarSearch')?.value.toLowerCase() || '';
  const items = S.sheets.filter(s => s.name.toLowerCase().includes(srch));
  if (!items.length) {
    nav.innerHTML = '<p class="nav-empty muted">Nenhuma planilha cadastrada.</p>';
    return;
  }
  nav.innerHTML = items.map(s => `
    <button class="sheet-item ${S.current?.id === s.id ? 'active' : ''}"
            onclick="selectSheet('${s.id}','${esc(s.name)}')">
      📊 ${esc(s.name)}
    </button>`).join('');
}

function filterSidebar(v) { renderNav(); }

async function selectSheet(id, name) {
  S.current = { id, name };
  S.tab = null; S.page = 1; S.search = '';
  editMode = false;
  renderNav();
  document.getElementById('topTitle').textContent = name;
  document.getElementById('topSub').textContent = '';
  document.getElementById('toolbar').style.display = 'none';
  document.getElementById('content').innerHTML = '<div class="welcome"><p class="muted">Carregando abas...</p></div>';
  if (window.innerWidth <= 700) closeSidebar();
  try {
    const data = await api('tabs', { id });
    renderTabs(data.tabs || []);
  } catch(err) {
    document.getElementById('content').innerHTML = `<div class="welcome"><p class="muted">Erro: ${esc(err.message)}</p></div>`;
  }
}

function renderTabs(tabs) {
  const wrap = document.getElementById('tabsList');
  const bar = document.getElementById('tabsBar');
  if (!tabs.length) {
    if (wrap) wrap.innerHTML = '';
    if (bar) bar.style.display = 'none';
    document.getElementById('content').innerHTML = '<div class="welcome"><p class="muted">Nenhuma aba encontrada.</p></div>';
    return;
  }
  if (bar) bar.style.display = 'block';
  if (wrap) wrap.innerHTML = tabs.map(t =>
    `<button class="tab-btn ${S.tab === t ? 'active' : ''}" onclick="selectTab('${esc(t)}')">${esc(t)}</button>`
  ).join('');
  if (!S.tab) selectTab(tabs[0]);
}

async function selectTab(tab) {
  S.tab = tab; S.page = 1; S.search = '';
  editMode = false;
  document.querySelectorAll('.tab-btn').forEach(b => b.classList.toggle('active', b.textContent === tab));
  const searchEl = document.getElementById('tableSearch');
  if (searchEl) searchEl.value = '';
  const editBtn = document.getElementById('editModeBtn');
  if (editBtn) { editBtn.textContent = '✏ Edição: OFF'; editBtn.style.background = ''; editBtn.style.color = ''; }
  document.getElementById('topSub').textContent = tab;
  document.getElementById('toolbar').style.display = 'flex';
  document.getElementById('content').innerHTML = '<div class="welcome"><p class="muted">Carregando dados...</p></div>';
  await loadTable();
}

async function loadTable() {
  try {
    const data = await api('data', { id: S.current.id, tab: S.tab, page: S.page, search: S.search });
    renderTable(data);
    renderPagination(data);
    const rc = document.getElementById('rowCount');
    if (rc) rc.textContent = `${data.total} linha(s)`;
  } catch(err) {
    document.getElementById('content').innerHTML = `<div class="welcome"><p class="muted">Erro: ${esc(err.message)}</p></div>`;
  }
}

function renderTable(data) {
  window._lastTableData = data;
  const content = document.getElementById('content');
  if (!data || !data.headers || !data.headers.length) {
    content.innerHTML = '<div class="welcome"><p class="muted">Esta aba está vazia.</p></div>';
    return;
  }
  const ths = data.headers.map(h => `<th title="${esc(h)}">${esc(h)}</th>`).join('');
  const pageOffset = ((data.page || 1) - 1) * 50;
  const trs = data.rows.map((row, ri) => {
    const sheetRow = pageOffset + ri + 2;
    const tds = row.map((c, ci) => editMode
      ? `<td><span class="cell-view" onclick="startEdit(this,${sheetRow},${ci+1})">${esc(c)}</span></td>`
      : `<td title="${esc(c)}">${esc(c)}</td>`
    ).join('');
    return `<tr>${tds}</tr>`;
  }).join('');
  const empty = `<tr><td colspan="${data.headers.length}" style="text-align:center;opacity:.5">Nenhum resultado.</td></tr>`;
  content.innerHTML = `<div class="table-wrap"><table><thead><tr>${ths}</tr></thead><tbody>${trs || empty}</tbody></table></div>`;
}

function renderPagination(data) {
  const html = data.pages <= 1 ? '' : `
    <button class="btn-page" ${data.page<=1?'disabled':''} onclick="changePage(${data.page-1})">‹</button>
    <span class="page-info">${data.page} / ${data.pages}</span>
    <button class="btn-page" ${data.page>=data.pages?'disabled':''} onclick="changePage(${data.page+1})">›</button>`;
  ['paginationTop','paginationBot'].forEach(id => { const el = document.getElementById(id); if (el) el.innerHTML = html; });
}
function changePage(p) { S.page = p; loadTable(); }

// ── Lista
async function loadList() {
  setApiStatus('loading');
  try {
    const data = await api('list');
    S.sheets = data.spreadsheets || [];
    renderNav();
    setApiStatus('ok');
  } catch(err) { setApiStatus('error'); }
}

// ── Modais (compatível com index.html)
function openModal(id)  { const m = document.getElementById(id); if (m) m.style.display = 'flex'; }
function closeModal(id) { const m = document.getElementById(id); if (m) m.style.display = 'none'; }

function openAddModal()   { openModal('addModal'); setTimeout(() => document.getElementById('addId')?.focus(), 50); }
function openSettings()   {
  setFieldVal('cfgUrl',   S.apiUrl);
  setFieldVal('cfgToken', S.token);
  openModal('settingsModal');
}

function saveSettings() {
  const urlEl   = document.getElementById('cfgUrl');
  const tokenEl = document.getElementById('cfgToken');
  
  if (!urlEl || !tokenEl) { alert('Campos não encontrados no HTML.'); return; }
  
  const url   = urlEl.value.trim();
  const token = tokenEl.value.trim();
  
  if (!url || !token) { alert('Preencha a URL e o token.'); return; }
  
  S.apiUrl = url;
  S.token  = token;
  
  closeModal('settingsModal');
  loadList();
}

async function confirmAdd() {
  const id   = document.getElementById('addId')?.value.trim();
  const name = document.getElementById('addName')?.value.trim();
  const err  = document.getElementById('addError');
  if (!id) { if (err) { err.textContent = 'Informe o ID da planilha.'; err.style.display = 'block'; } return; }
  if (err) err.style.display = 'none';
  const btn = document.getElementById('addConfirmBtn');
  if (btn) btn.disabled = true;
  try {
    await apiPost({ action: 'addSheet', id, name });
    closeModal('addModal');
    if (document.getElementById('addId'))   document.getElementById('addId').value   = '';
    if (document.getElementById('addName')) document.getElementById('addName').value = '';
    await loadList();
  } catch(e) {
    if (err) { err.textContent = 'Erro: ' + e.message; err.style.display = 'block'; }
  } finally { if (btn) btn.disabled = false; }
}

// ── Edição inline
function toggleEditMode() {
  editMode = !editMode;
  const btn = document.getElementById('editModeBtn');
  if (!btn) return;
  btn.textContent      = editMode ? '✏ Edição: ON'  : '✏ Edição: OFF';
  btn.style.background = editMode ? 'var(--accent)'  : '';
  btn.style.color      = editMode ? '#000'           : '';
  if (window._lastTableData) renderTable(window._lastTableData);
}

function startEdit(span, sheetRow, sheetCol) {
  if (span.querySelector('input')) return;
  const original = span.textContent;
  span.innerHTML = `<input class="cell-input" value="${esc(original)}"/>`;
  const input = span.querySelector('input');
  input.focus(); input.select();
  input.addEventListener('keydown', async e => {
    if (e.key === 'Enter')  await commitEdit(span, sheetRow, sheetCol, input.value, original);
    if (e.key === 'Escape') cancelEdit(span, original);
  });
  input.addEventListener('blur', async () => { if (span.querySelector('input')) await commitEdit(span, sheetRow, sheetCol, input.value, original); });
}
async function commitEdit(span, sheetRow, sheetCol, newValue, original) {
  span.innerHTML = `<span style="opacity:.5">${esc(newValue)}</span>`;
  try {
    await apiPost({ action: 'updateCell', id: S.current.id, tab: S.tab, row: sheetRow, col: sheetCol, value: newValue });
    span.innerHTML = esc(newValue);
  } catch(e) { alert('Erro ao salvar: ' + e.message); span.innerHTML = esc(original); }
}
function cancelEdit(span, original) { span.innerHTML = esc(original); }

// ── Exportar CSV
function exportCSV() {
  if (!S.current || !S.tab) { alert('Selecione uma aba primeiro.'); return; }
  const data = window._lastTableData;
  if (!data || !data.headers.length) { alert('Sem dados para exportar.'); return; }
  const rows = [data.headers, ...data.rows];
  const csv  = rows.map(r => r.map(c => `"${String(c??'').replace(/"/g,'""')}"`).join(',')).join('\n');
  const blob = new Blob(['\uFEFF' + csv], { type: 'text/csv;charset=utf-8;' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = `${S.current.name}_${S.tab}.csv`;
  a.click();
  URL.revokeObjectURL(a.href);
}

// ── Exportar PDF
function exportPDF() {
  if (!S.current || !S.tab) { alert('Selecione uma aba primeiro.'); return; }
  const data = window._lastTableData;
  if (!data || !data.headers.length) { alert('Sem dados para exportar.'); return; }
  const title = `${S.current.name} — ${S.tab}`;
  const date  = new Date().toLocaleString('pt-BR');
  const tHead = data.headers.map(h => `<th>${esc(h)}</th>`).join('');
  const tBody = data.rows.map(r => `<tr>${r.map(c => `<td>${esc(c??'')}</td>`).join('')}</tr>`).join('');
  const win = window.open('', '_blank');
  win.document.write(`<!doctype html><html><head><meta charset="utf-8"/><title>${title}</title>
    <style>body{font-family:Arial,sans-serif;font-size:12px;margin:24px}
    table{width:100%;border-collapse:collapse}th{background:#1a73e8;color:#fff;padding:7px 10px;text-align:left;font-size:11px}
    td{padding:6px 10px;border-bottom:1px solid #ddd}tr:nth-child(even)td{background:#f5f7fa}
    @media print{body{margin:0}}</style></head><body>
    <h2 style="font-size:16px;margin-bottom:4px">${title}</h2>
    <p style="color:#666;font-size:11px;margin-bottom:16px">Gerado em ${date} · ${data.total} linha(s)</p>
    <table><thead><tr>${tHead}</tr></thead><tbody>${tBody}</tbody></table>
    <script>window.onload=()=>window.print()<\/script></body></html>`);
  win.document.close();
}

// ── Init
document.addEventListener('DOMContentLoaded', () => {
  closeSidebar();
  setApiStatus('error');
  // Abre automaticamente o modal de configurações
  openSettings();
});