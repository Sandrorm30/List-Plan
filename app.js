// ═══════════════════════════════════════════════════════════════
// app.js — Sheets Viewer  (versão completa com edição, CSV e PDF)
// ═══════════════════════════════════════════════════════════════

// ── Estado global
const S = {
  apiUrl:  '',
  token:   '',
  sheets:  [],
  current: null,
  tab:     null,
  page:    1,
  search:  '',
};

let editMode = false;
window._lastTableData = null;

// ── Utilitários
function esc(v) {
  if (v === null || v === undefined) return '';
  return String(v)
    .replace(/&/g,'&amp;')
    .replace(/</g,'&lt;')
    .replace(/>/g,'&gt;')
    .replace(/"/g,'&quot;');
}

function setFieldVal(id, val) {
  const el = document.getElementById(id);
  if (el) el.value = val || '';
}

function debounce(fn, ms) {
  let t;
  return (...args) => { clearTimeout(t); t = setTimeout(() => fn(...args), ms); };
}

const debounceSearch = debounce(v => {
  S.search = v; S.page = 1; loadTable();
}, 400);

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
  const res  = await fetch(buildUrl(action, params));
  const json = await res.json();
  if (json.error) throw new Error(json.error);
  return json;
}

async function apiPost(body) {
  if (!S.apiUrl || !S.token) throw new Error('Configure a URL e o token primeiro.');
  const res  = await fetch(S.apiUrl, {
    method:  'POST',
    headers: { 'Content-Type': 'application/json' },
    body:    JSON.stringify({ ...body, token: S.token }),
  });
  const json = await res.json();
  if (json.error) throw new Error(json.error);
  return json;
}

// ── Status
function setApiStatus(state) {
  const el  = document.getElementById('apiStatus');
  if (!el) return;
  const map = {
    loading: ['Verificando...', 'badge-muted'],
    ok:      ['Conectado ✓',    'badge-ok'],
    error:   ['Erro ✗',         'badge-error'],
  };
  const [text, cls] = map[state] || map.loading;
  el.textContent = text;
  el.className   = `badge ${cls}`;
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

// ── Navegação
function renderNav() {
  const nav   = document.getElementById('navList');
  const srch  = document.getElementById('sidebarSearch')?.value.toLowerCase() || '';
  const items = S.sheets.filter(s => s.name.toLowerCase().includes(srch));

  if (!items.length) {
    nav.innerHTML = '<li class="nav-empty">Nenhuma planilha encontrada.</li>';
    return;
  }

  nav.innerHTML = items.map(s => `
    <li>
      <button class="nav-item ${S.current?.id === s.id ? 'active' : ''}"
              onclick="selectSheet('${s.id}','${esc(s.name)}')">
        <span class="nav-icon">📊</span>
        <span class="nav-label">${esc(s.name)}</span>
      </button>
    </li>`).join('');
}

async function selectSheet(id, name) {
  S.current = { id, name };
  S.tab     = null;
  S.page    = 1;
  S.search  = '';
  editMode  = false;
  renderNav();
  document.getElementById('topTitle').textContent      = name;
  document.getElementById('topSub').textContent        = '';
  document.getElementById('toolbar').style.display     = 'none';
  document.getElementById('content').innerHTML         =
    '<div class="welcome"><p class="muted">Carregando abas...</p></div>';
  if (window.innerWidth <= 700) closeSidebar();
  try {
    const data = await api('tabs', { id });
    renderTabs(data.tabs || []);
  } catch (err) {
    document.getElementById('content').innerHTML =
      `<div class="welcome"><p class="muted">Erro: ${esc(err.message)}</p></div>`;
  }
}

function renderTabs(tabs) {
  const wrap = document.getElementById('tabsWrap');
  if (!tabs.length) {
    wrap.innerHTML = '';
    document.getElementById('content').innerHTML =
      '<div class="welcome"><p class="muted">Nenhuma aba encontrada.</p></div>';
    return;
  }
  wrap.innerHTML = tabs.map(t =>
    `<button class="tab-btn ${S.tab === t ? 'active' : ''}"
             onclick="selectTab('${esc(t)}')">${esc(t)}</button>`
  ).join('');
  if (!S.tab) selectTab(tabs[0]);
}

async function selectTab(tab) {
  S.tab    = tab;
  S.page   = 1;
  S.search = '';
  editMode = false;
  document.querySelectorAll('.tab-btn').forEach(b =>
    b.classList.toggle('active', b.textContent === tab)
  );
  const searchEl = document.getElementById('tableSearch');
  if (searchEl) searchEl.value = '';
  const editBtn = document.getElementById('editModeBtn');
  if (editBtn) {
    editBtn.textContent      = '✏ Edição: OFF';
    editBtn.style.background = '';
    editBtn.style.color      = '';
  }
  document.getElementById('topSub').textContent    = tab;
  document.getElementById('toolbar').style.display = 'flex';
  document.getElementById('content').innerHTML     =
    '<div class="welcome"><p class="muted">Carregando dados...</p></div>';
  await loadTable();
}

async function loadTable() {
  try {
    const data = await api('data', {
      id: S.current.id, tab: S.tab, page: S.page, search: S.search
    });
    renderTable(data);
    renderPagination(data);
    const rc = document.getElementById('rowCount');
    if (rc) rc.textContent = `${data.total} linha(s)`;
  } catch (err) {
    document.getElementById('content').innerHTML =
      `<div class="welcome"><p class="muted">Erro: ${esc(err.message)}</p></div>`;
  }
}

// ── Tabela (com suporte a modo de edição)
function renderTable(data) {
  window._lastTableData = data;
  const content = document.getElementById('content');
  if (!data || !data.headers || !data.headers.length) {
    content.innerHTML = '<div class="welcome"><p class="muted">Esta aba está vazia.</p></div>';
    return;
  }
  const ths        = data.headers.map(h => `<th title="${esc(h)}">${esc(h)}</th>`).join('');
  const pageOffset = ((data.page || 1) - 1) * 50;
  const trs = data.rows.map((row, ri) => {
    const sheetRow = pageOffset + ri + 2;
    const tds = row.map((c, ci) => editMode
      ? `<td><span class="cell-view" onclick="startEdit(this,${sheetRow},${ci + 1})">${esc(c)}</span></td>`
      : `<td title="${esc(c)}">${esc(c)}</td>`
    ).join('');
    return `<tr>${tds}</tr>`;
  }).join('');
  const empty = `<tr><td colspan="${data.headers.length}"
    style="text-align:center;color:var(--muted)">Nenhum resultado.</td></tr>`;
  content.innerHTML = `
    <div class="table-wrap">
      <table>
        <thead><tr>${ths}</tr></thead>
        <tbody>${trs || empty}</tbody>
      </table>
    </div>`;
}

// ── Paginação
function renderPagination(data) {
  const html = data.pages <= 1 ? '' : `
    <button class="btn-page" ${data.page <= 1 ? 'disabled' : ''}
            onclick="changePage(${data.page - 1})">‹</button>
    <span class="page-info">${data.page} / ${data.pages}</span>
    <button class="btn-page" ${data.page >= data.pages ? 'disabled' : ''}
            onclick="changePage(${data.page + 1})">›</button>`;
  ['paginationTop','paginationBot'].forEach(id => {
    const el = document.getElementById(id);
    if (el) el.innerHTML = html;
  });
}

function changePage(p) { S.page = p; loadTable(); }

// ── Lista de planilhas
async function loadList() {
  setApiStatus('loading');
  try {
    const data = await api('list');
    S.sheets = data.spreadsheets || [];
    renderNav();
    setApiStatus('ok');
  } catch (err) { setApiStatus('error'); }
}

// ── Adicionar planilha
function openAddSheet() {
  document.getElementById('addSheetModal').style.display = 'flex';
  document.getElementById('newSheetUrl').focus();
}

function closeAddSheet() {
  document.getElementById('addSheetModal').style.display = 'none';
  document.getElementById('newSheetUrl').value  = '';
  document.getElementById('newSheetName').value = '';
}

async function confirmAddSheet() {
  const url  = document.getElementById('newSheetUrl').value.trim();
  const name = document.getElementById('newSheetName').value.trim();
  if (!url) { alert('Informe a URL da planilha.'); return; }
  try {
    await apiPost({ action: 'addSheet', url, name });
    closeAddSheet();
    await loadList();
  } catch (err) { alert('Erro ao adicionar: ' + err.message); }
}

// ── Configurações
function openSettings() {
  const m = document.getElementById('settingsModal');
  if (m) m.style.display = 'flex';
  setFieldVal('cfgUrl',   S.apiUrl);
  setFieldVal('cfgToken', S.token);
}
function closeSettings() { document.getElementById('settingsModal').style.display = 'none'; }

function saveSettings() {
  const url   = document.getElementById('cfgUrl').value.trim();
  const token = document.getElementById('cfgToken').value.trim();
  if (!url || !token) { alert('Preencha URL e token.'); return; }
  S.apiUrl = url;
  S.token  = token;
  try {
    localStorage.setItem('SV_URL',   url);
    localStorage.setItem('SV_TOKEN', token);
  } catch(e) { /* localStorage bloqueado — usa só memória */ }
  closeSettings();
  loadList();
}

// ── Modo de Edição
function toggleEditMode() {
  editMode = !editMode;
  const btn = document.getElementById('editModeBtn');
  if (!btn) return;
  if (editMode) {
    btn.textContent      = '✏ Edição: ON';
    btn.style.background = 'var(--accent)';
    btn.style.color      = '#000';
  } else {
    btn.textContent      = '✏ Edição: OFF';
    btn.style.background = '';
    btn.style.color      = '';
  }
  if (window._lastTableData) renderTable(window._lastTableData);
}

function startEdit(span, sheetRow, sheetCol) {
  if (span.querySelector('input')) return;
  const original = span.textContent;
  span.innerHTML = `<input class="cell-input" value="${esc(original)}" />`;
  const input = span.querySelector('input');
  input.focus(); input.select();
  input.addEventListener('keydown', async e => {
    if (e.key === 'Enter')  await commitEdit(span, sheetRow, sheetCol, input.value, original);
    if (e.key === 'Escape') cancelEdit(span, original);
  });
  input.addEventListener('blur', async () => {
    if (span.querySelector('input'))
      await commitEdit(span, sheetRow, sheetCol, input.value, original);
  });
}

async function commitEdit(span, sheetRow, sheetCol, newValue, original) {
  span.innerHTML = `<span style="opacity:.5">${esc(newValue)}</span>`;
  try {
    await apiPost({ action: 'updateCell', id: S.current.id, tab: S.tab,
                    row: sheetRow, col: sheetCol, value: newValue });
    span.innerHTML = esc(newValue);
  } catch (err) {
    alert('Erro ao salvar: ' + err.message);
    span.innerHTML = esc(original);
  }
}

function cancelEdit(span, original) { span.innerHTML = esc(original); }

// ── Exportar CSV
function exportCSV() {
  if (!S.current || !S.tab) { alert('Selecione uma aba primeiro.'); return; }
  const data = window._lastTableData;
  if (!data || !data.headers.length) { alert('Sem dados para exportar.'); return; }
  const rows = [data.headers, ...data.rows];
  const csv  = rows.map(r =>
    r.map(c => `"${String(c == null ? '' : c).replace(/"/g,'""')}"`).join(',')
  ).join('\n');
  const blob = new Blob(['\uFEFF' + csv], { type: 'text/csv;charset=utf-8;' });
  const url  = URL.createObjectURL(blob);
  const a    = document.createElement('a');
  a.href = url; a.download = `${S.current.name}_${S.tab}.csv`; a.click();
  URL.revokeObjectURL(url);
}

// ── Exportar PDF
function exportPDF() {
  if (!S.current || !S.tab) { alert('Selecione uma aba primeiro.'); return; }
  const data = window._lastTableData;
  if (!data || !data.headers.length) { alert('Sem dados para exportar.'); return; }
  const title = `${S.current.name} — ${S.tab}`;
  const date  = new Date().toLocaleString('pt-BR');
  const tHead = data.headers.map(h => `<th>${esc(h)}</th>`).join('');
  const tBody = data.rows.map(r =>
    `<tr>${r.map(c => `<td>${esc(c == null ? '' : c)}</td>`).join('')}</tr>`
  ).join('');
  const win = window.open('', '_blank');
  win.document.write(`<!doctype html><html><head><meta charset="utf-8"/>
    <title>${title}</title>
    <style>
      body{font-family:Arial,sans-serif;font-size:12px;margin:24px;color:#111}
      h2{font-size:16px;margin-bottom:4px}
      p{color:#666;font-size:11px;margin-bottom:16px}
      table{width:100%;border-collapse:collapse}
      th{background:#1a73e8;color:#fff;padding:7px 10px;text-align:left;
         font-size:11px;text-transform:uppercase}
      td{padding:6px 10px;border-bottom:1px solid #ddd;font-size:12px}
      tr:nth-child(even) td{background:#f5f7fa}
      @media print{body{margin:0}}
    </style></head><body>
    <h2>${title}</h2>
    <p>Gerado em ${date} · ${data.total} linha(s) · Página ${data.page} de ${data.pages}</p>
    <table><thead><tr>${tHead}</tr></thead><tbody>${tBody}</tbody></table>
    <script>window.onload=()=>{window.print();}<\/script>
  </body></html>`);
  win.document.close();
}

// ── Inicialização
document.addEventListener('DOMContentLoaded', () => {
  // Tenta ler do localStorage com fallback seguro
  try {
    S.apiUrl = localStorage.getItem('SV_URL')   || '';
    S.token  = localStorage.getItem('SV_TOKEN') || '';
  } catch(e) {
    S.apiUrl = '';
    S.token  = '';
  }

  setFieldVal('cfgUrl',   S.apiUrl);
  setFieldVal('cfgToken', S.token);
  closeSidebar();

  if (!S.apiUrl || !S.token) {
    // Sem configuração → abre modal de settings automaticamente
    openSettings();
    setApiStatus('error');
  } else {
    loadList();
  }
});

// ── Aliases de compatibilidade com o index.html
function openAddModal()          { openAddSheet(); }
function closeModal(id)          { 
  const el = document.getElementById(id);
  if (el) el.style.display = 'none';
}
function filterSidebar(v)        { renderNav(); }
function confirmAdd() {
  const id   = document.getElementById('addId')?.value.trim();
  const name = document.getElementById('addName')?.value.trim();
  const err  = document.getElementById('addError');
  if (!id) {
    if (err) { err.textContent = 'Informe o ID da planilha.'; err.style.display = 'block'; }
    return;
  }
  if (err) err.style.display = 'none';
  const btn = document.getElementById('addConfirmBtn');
  if (btn) btn.disabled = true;
  apiPost({ action: 'addSheet', id, name })
    .then(() => {
      closeModal('addModal');
      if (document.getElementById('addId'))   document.getElementById('addId').value   = '';
      if (document.getElementById('addName')) document.getElementById('addName').value = '';
      loadList();
    })
    .catch(e => {
      if (err) { err.textContent = 'Erro: ' + e.message; err.style.display = 'block'; }
    })
    .finally(() => { if (btn) btn.disabled = false; });
}