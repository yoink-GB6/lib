// pages/articles.js
// 文章页面：支持标签筛选、全文查看和编辑管理

import { supaClient, setSyncStatus, dbError } from './supabase-client.js';
import { isEditor, onAuthChange } from './auth.js';
import { showToast, escHtml, confirmDialog } from './ui.js';

const TABLE = 'articles';
const MAX_CHARS = 20000;

let items = [];
let tags = [];
let selectedTags = [];
let searchKeyword = '';
let selectedAuthor = '';
let sortBy = 'desc'; // newest first by default for articles
let editItemId = null;
let realtimeCh = null;
let pageContainer = null;

export async function mount(container) {
  pageContainer = container;
  container.innerHTML = buildHTML();
  bindControls(container);
  onAuthChange(() => updateArticlesUI(container));
  updateSortButton(container);
  updateArticlesUI(container);
  await fetchAll();
  subscribeRealtime();
}

export function unmount() {
  realtimeCh && supaClient.removeChannel(realtimeCh);
}

function buildHTML() {
  return `
<div class="lib-layout">
  <div class="lib-main">
    <div class="arc-grid" id="arc-grid"></div>
  </div>

  <button id="arc-expand" class="expand-btn-float" title="展开筛选">◀</button>

  <div class="lib-panel" id="arc-panel">
    <div class="lib-panel-hdr" id="arc-panel-toggle">
      <span>📝 搜索 & 筛选</span>
      <span id="arc-panel-chevron">▶</span>
    </div>
    <div class="lib-panel-body">
      <div style="display:flex;gap:6px;margin-bottom:14px">
        <button class="btn bn" id="arc-sort-btn" style="flex:1;font-size:12px">🕐 新→旧</button>
        <button class="btn bp" id="arc-add-btn" style="display:none;font-size:12px;padding:6px 12px">＋ 新建</button>
      </div>

      <div style="margin-bottom:16px">
        <input id="arc-search-input" type="text" placeholder="搜索标题或内容..."
          autocomplete="off"
          style="width:100%;padding:8px 12px;border:1px solid var(--border);border-radius:6px;background:var(--bg);color:var(--text);font-size:13px"/>
      </div>

      <div style="margin-bottom:16px;position:relative">
        <input id="arc-author-input" type="text" placeholder="输入作者名筛选..."
          autocomplete="off"
          style="width:100%;padding:8px 12px;border:1px solid var(--border);border-radius:6px;background:var(--bg);color:var(--text);font-size:13px"/>
        <button id="arc-author-clear"
          style="position:absolute;right:8px;top:50%;transform:translateY(-50%);background:none;border:none;color:#889;cursor:pointer;font-size:16px;padding:4px;display:none"
          title="清除作者筛选">✕</button>
      </div>

      <div style="font-size:12px;color:#889;margin-bottom:12px;line-height:1.6">
        点击标签进行筛选。选中多个标签时，显示<b>同时包含</b>所有选中标签的文章。
      </div>
      <div id="arc-tag-list" class="lib-tag-list"></div>
    </div>
  </div>
</div>

<!-- Edit / New modal -->
<div id="arc-modal" class="tl-modal-overlay">
  <div class="tl-modal" style="max-width:680px" onmousedown="event.stopPropagation()">
    <h2 id="arc-modal-title" style="color:var(--accent)">新建文章</h2>

    <label>标题</label>
    <input id="arc-title" type="text" placeholder="文章标题..." autocomplete="off" style="margin-bottom:12px;font-size:15px;font-weight:600"/>

    <label>正文</label>
    <div id="arc-char-count" style="font-size:11px;color:#889;text-align:right;margin-bottom:4px">0 / 20000</div>
    <textarea id="arc-body" rows="16" placeholder="在此输入文章内容（最多 20000 字）..."
      style="margin-bottom:12px;font-family:inherit;resize:vertical;line-height:1.8"></textarea>

    <label>作者（可选）</label>
    <input id="arc-author" type="text" placeholder="作者名..." autocomplete="off" style="margin-bottom:12px"/>

    <label>背景图片（可选）</label>
    <input id="arc-bg-url" type="hidden"/>
    <div id="arc-bg-preview-wrap" style="margin-bottom:8px;display:none;position:relative">
      <img id="arc-bg-preview-img" style="width:100%;max-height:120px;object-fit:cover;border-radius:8px;border:1px solid var(--border)"/>
      <button id="arc-bg-clear-btn" style="position:absolute;top:6px;right:6px;background:rgba(0,0,0,.6);border:1px solid #555;color:#fff;width:24px;height:24px;border-radius:50%;cursor:pointer;font-size:14px;display:flex;align-items:center;justify-content:center">✕</button>
    </div>
    <div style="display:flex;gap:8px;margin-bottom:16px">
      <button class="btn bn" id="arc-bg-gallery-btn" style="flex:1;font-size:12px">🖼 从图库选择</button>
      <button class="btn bn" id="arc-bg-upload-btn" style="flex:1;font-size:12px">📁 上传新图片</button>
      <input id="arc-bg-file-input" type="file" accept="image/*" style="display:none"/>
    </div>

    <label>标签</label>
    <div id="arc-tag-picker" class="lib-tag-picker" style="margin-bottom:8px"></div>
    <div style="display:flex;gap:8px;margin-bottom:16px">
      <input id="arc-new-tag" type="text" placeholder="新增标签..." autocomplete="off"
        style="flex:1;padding:8px 12px;border:1px solid var(--border);border-radius:6px;background:var(--bg);color:var(--text);font-size:13px"/>
      <button class="btn bn" id="arc-add-tag-btn" style="padding:8px 14px">＋</button>
    </div>

    <div style="display:flex;gap:8px;justify-content:flex-end">
      <button class="btn br" id="arc-delete-btn" style="display:none;margin-right:auto">🗑 删除</button>
      <button class="btn bn" id="arc-cancel-btn">取消</button>
      <button class="btn bp" id="arc-save-btn">保存</button>
    </div>
  </div>
</div>

<!-- Read modal (full article view) -->
<div id="arc-read-modal" class="tl-modal-overlay">
  <div class="tl-modal arc-read-tl" onmousedown="event.stopPropagation()">
    <div style="display:flex;align-items:flex-start;justify-content:space-between;margin-bottom:6px;gap:12px">
      <h2 id="arc-read-title" style="font-size:18px;font-weight:700;color:var(--text);margin:0;flex:1;line-height:1.4"></h2>
      <button id="arc-read-close" style="background:none;border:none;color:#889;cursor:pointer;font-size:22px;padding:0;flex-shrink:0;line-height:1">✕</button>
    </div>
    <div id="arc-read-meta" style="font-size:12px;color:#889;margin-bottom:20px;display:flex;gap:12px;flex-wrap:wrap"></div>
    <div id="arc-read-body" class="arc-read-body"></div>
    <div id="arc-read-actions" style="display:flex;gap:8px;justify-content:flex-end;margin-top:20px;padding-top:14px;border-top:1px solid var(--border)"></div>
  </div>
</div>

<!-- Gallery picker modal -->
<div id="arc-gallery-picker" class="tl-modal-overlay">
  <div class="tl-modal" style="max-width:700px" onmousedown="event.stopPropagation()">
    <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:14px">
      <h2 style="color:var(--accent);margin:0">选择背景图片</h2>
      <button id="arc-gallery-picker-close" style="background:none;border:none;color:#889;cursor:pointer;font-size:22px;padding:0;line-height:1">✕</button>
    </div>
    <div id="arc-gallery-picker-grid"
      style="display:grid;grid-template-columns:repeat(auto-fill,minmax(120px,1fr));gap:10px;max-height:420px;overflow-y:auto;padding:2px"></div>
  </div>
</div>

<!-- Bg filter sliders (fixed overlay, shown when reading with bg image) -->
<div id="arc-read-sliders" style="display:none;position:fixed;bottom:24px;left:50%;transform:translateX(-50%);
  background:rgba(0,0,0,.65);backdrop-filter:blur(12px);border:1px solid rgba(255,255,255,.12);
  border-radius:12px;padding:10px 18px;gap:20px;align-items:center;z-index:10001;white-space:nowrap">
  <label style="font-size:11px;color:#aaa;display:flex;align-items:center;gap:8px">
    ☀️ <input id="arc-brightness" type="range" min="0" max="100" value="40" style="width:110px;accent-color:var(--accent)"/>
  </label>
  <label style="font-size:11px;color:#aaa;display:flex;align-items:center;gap:8px">
    🌫️ <input id="arc-blur" type="range" min="0" max="20" value="0" style="width:110px;accent-color:var(--accent)"/>
  </label>
</div>
`;
}

function bindControls(container) {
  // Sort
  container.querySelector('#arc-sort-btn').addEventListener('click', () => {
    sortBy = sortBy === 'desc' ? 'asc' : 'desc';
    updateSortButton(container);
    renderGrid(container);
  });

  // Add
  container.querySelector('#arc-add-btn').addEventListener('click', () => openModal(null, container));

  // Panel toggle
  function togglePanel() {
    const panel = container.querySelector('#arc-panel');
    const chevron = container.querySelector('#arc-panel-chevron');
    const expandBtn = container.querySelector('#arc-expand');
    const collapsed = panel.classList.toggle('collapsed');
    chevron.textContent = collapsed ? '◀' : '▶';
    if (expandBtn) expandBtn.classList.toggle('show', collapsed);
  }
  container.querySelector('#arc-panel-toggle')?.addEventListener('click', togglePanel);
  container.querySelector('#arc-expand')?.addEventListener('click', togglePanel);

  // Search
  container.querySelector('#arc-search-input').addEventListener('input', e => {
    searchKeyword = e.target.value.toLowerCase();
    renderGrid(container);
  });

  // Author filter
  const authorInput = container.querySelector('#arc-author-input');
  const authorClear = container.querySelector('#arc-author-clear');
  authorInput.addEventListener('input', e => {
    selectedAuthor = e.target.value.trim();
    authorClear.style.display = selectedAuthor ? '' : 'none';
    renderGrid(container);
  });
  authorClear.addEventListener('click', () => {
    selectedAuthor = ''; authorInput.value = '';
    authorClear.style.display = 'none';
    renderGrid(container);
  });

  // Char count
  container.querySelector('#arc-body').addEventListener('input', e => {
    const len = e.target.value.length;
    const display = container.querySelector('#arc-char-count');
    display.textContent = `${len.toLocaleString()} / ${MAX_CHARS.toLocaleString()}`;
    display.style.color = len > MAX_CHARS ? 'var(--red)' : '#889';
  });

  // Modal
  container.querySelector('#arc-cancel-btn').addEventListener('click', () => closeModal(container));

  // Bg image controls
  container.querySelector('#arc-bg-gallery-btn').addEventListener('click', () => openGalleryPicker(container));
  container.querySelector('#arc-bg-upload-btn').addEventListener('click', () => container.querySelector('#arc-bg-file-input').click());
  container.querySelector('#arc-bg-file-input').addEventListener('change', async e => {
    const file = e.target.files[0];
    if (!file) return;
    showToast('上传中...');
    try {
      const ext = file.name.split('.').pop();
      const path = `${Date.now()}_${Math.random().toString(36).slice(2)}.${ext}`;
      const { error: upErr } = await supaClient.storage.from('gallery').upload(path, file, { cacheControl: '3600', upsert: false });
      if (upErr) throw upErr;
      const { data } = supaClient.storage.from('gallery').getPublicUrl(path);
      await supaClient.from('gallery_items').insert({ title: '', description: '', author: 'unknown', tags_json: '[]', image_url: data.publicUrl, storage_path: path });
      container.querySelector('#arc-bg-url').value = data.publicUrl;
      updateBgPreview(container, data.publicUrl);
      showToast('已上传并设为背景图');
    } catch(err) { dbError('上传背景图', err); }
  });
  container.querySelector('#arc-bg-clear-btn').addEventListener('click', () => {
    container.querySelector('#arc-bg-url').value = '';
    updateBgPreview(container, '');
  });
  container.querySelector('#arc-gallery-picker-close').addEventListener('click', () => {
    container.querySelector('#arc-gallery-picker').classList.remove('show');
  });
  container.querySelector('#arc-gallery-picker').addEventListener('mousedown', e => {
    if (e.target === container.querySelector('#arc-gallery-picker')) container.querySelector('#arc-gallery-picker').classList.remove('show');
  });
  container.querySelector('#arc-modal').addEventListener('mousedown', e => {
    if (e.target === container.querySelector('#arc-modal')) closeModal(container);
  });
  container.querySelector('#arc-save-btn').addEventListener('click', () => saveItem(container));
  container.querySelector('#arc-delete-btn').addEventListener('click', () => deleteFromModal(container));
  container.querySelector('#arc-add-tag-btn').addEventListener('click', () => addNewTag(container));
  container.querySelector('#arc-new-tag').addEventListener('keydown', e => {
    if (e.key === 'Enter') { e.preventDefault(); addNewTag(container); }
  });

  // Read modal
  container.querySelector('#arc-read-close').addEventListener('click', () => closeReadModal(container));
  container.querySelector('#arc-read-modal').addEventListener('mousedown', e => {
    if (e.target === container.querySelector('#arc-read-modal')) closeReadModal(container);
  });
  container.querySelector('#arc-brightness').addEventListener('input', () => {
    applyBgFilters(container, +container.querySelector('#arc-brightness').value, +container.querySelector('#arc-blur').value);
  });
  container.querySelector('#arc-blur').addEventListener('input', () => {
    applyBgFilters(container, +container.querySelector('#arc-brightness').value, +container.querySelector('#arc-blur').value);
  });
}

async function fetchAll() {
  setSyncStatus('syncing');
  try {
    const { data, error } = await supaClient.from(TABLE).select('*');
    if (error) throw error;
    items = (data || []).map(r => ({
      id: r.id,
      title: r.title || '',
      body: r.body || '',
      author: r.author || '',
      tags: JSON.parse(r.tags_json || '[]'),
      bgImageUrl: r.bg_image_url || '',
      createdAt: r.created_at,
      updatedAt: r.updated_at,
    }));
    const tagSet = new Set();
    items.forEach(item => item.tags.forEach(t => tagSet.add(t)));
    tags = Array.from(tagSet).sort();
    if (pageContainer) {
      renderTagList(pageContainer.querySelector('#arc-tag-list'));
      renderGrid(pageContainer);
    }
    setSyncStatus('ok');
  } catch(e) { dbError('加载文章', e); }
}

function sortItems() {
  items.sort((a, b) => sortBy === 'desc'
    ? new Date(b.createdAt) - new Date(a.createdAt)
    : new Date(a.createdAt) - new Date(b.createdAt)
  );
}

function renderTagList(tagListEl) {
  if (!tagListEl) return;
  selectedTags = selectedTags.filter(t => tags.includes(t));
  if (!tags.length) {
    tagListEl.innerHTML = '<div style="color:var(--muted);font-size:12px;padding:8px 0">暂无标签</div>';
    return;
  }
  const editable = isEditor();
  tagListEl.innerHTML = tags.map(tag => {
    const selected = selectedTags.includes(tag);
    const count = items.filter(i => i.tags.includes(tag)).length;
    const actionBtns = editable
      ? `<div class="lib-tag-actions">
          <button class="lib-tag-action-btn arc-tag-edit" data-tag="${escHtml(tag)}" title="重命名">✏️</button>
          <button class="lib-tag-action-btn arc-tag-delete" data-tag="${escHtml(tag)}" title="删除">🗑️</button>
         </div>` : '';
    return `<div class="lib-tag-filter ${selected ? 'selected' : ''}" data-tag="${escHtml(tag)}">
      <div class="lib-tag-main">
        <span class="lib-tag-name">${escHtml(tag)}</span>
        <span class="lib-tag-count">(${count})</span>
      </div>
      ${actionBtns}
    </div>`;
  }).join('');

  tagListEl.querySelectorAll('.lib-tag-filter').forEach(el => {
    el.querySelector('.lib-tag-main')?.addEventListener('click', e => {
      e.stopPropagation();
      const tag = el.dataset.tag;
      if (selectedTags.includes(tag)) selectedTags = selectedTags.filter(t => t !== tag);
      else selectedTags.push(tag);
      renderTagList(tagListEl);
      renderGrid(pageContainer);
    });
    el.querySelector('.arc-tag-edit')?.addEventListener('click', e => { e.stopPropagation(); renameTag(el.dataset.tag, tagListEl); });
    el.querySelector('.arc-tag-delete')?.addEventListener('click', e => { e.stopPropagation(); deleteTag(el.dataset.tag, tagListEl); });
  });
}

function renderGrid(container) {
  const grid = container.querySelector('#arc-grid');
  if (!grid) return;
  sortItems();

  let filtered = [...items];
  if (searchKeyword) filtered = filtered.filter(item =>
    item.title.toLowerCase().includes(searchKeyword) ||
    item.body.toLowerCase().includes(searchKeyword)
  );
  if (selectedAuthor) filtered = filtered.filter(item =>
    item.author.toLowerCase().includes(selectedAuthor.toLowerCase())
  );
  if (selectedTags.length) filtered = filtered.filter(item =>
    selectedTags.every(t => item.tags.includes(t))
  );

  if (!filtered.length) {
    grid.innerHTML = `<div class="lib-empty">暂无文章</div>`;
    return;
  }

  const editor = isEditor();
  grid.innerHTML = filtered.map(item => {
    const tagsHtml = item.tags.map(t => `<span class="lib-item-tag">${escHtml(t)}</span>`).join('');
    const preview = item.body.length > 120 ? item.body.slice(0, 120) + '…' : item.body;
    const wordCount = item.body.length;
    const date = new Date(item.createdAt).toLocaleDateString('zh-CN', { year: 'numeric', month: 'short', day: 'numeric' });
    const authorHtml = item.author && item.author !== 'unknown'
      ? `<span>by ${escHtml(item.author)}</span>` : '';
    return `<div class="arc-item ${editor ? 'arc-item-editor' : ''}" data-id="${item.id}">
      <div class="arc-item-title">${escHtml(item.title || '（无标题）')}</div>
      <div class="arc-item-preview">${escHtml(preview)}</div>
      ${tagsHtml ? `<div class="lib-item-tags" style="margin-bottom:8px">${tagsHtml}</div>` : ''}
      <div class="arc-item-meta">
        <span>${date}</span>
        <span>${wordCount.toLocaleString()} 字</span>
        ${authorHtml}
      </div>
    </div>`;
  }).join('');

  grid.querySelectorAll('.arc-item').forEach(el => {
    el.addEventListener('click', () => {
      const item = items.find(i => i.id == el.dataset.id);
      if (!item) return;
      openReadModal(item, container);
    });
  });
}

function openReadModal(item, container) {
  const modal = container.querySelector('#arc-read-modal');
  const inner = modal.querySelector('.tl-modal.arc-read-tl');

  // Background image set directly on inner; ::before pseudo renders it via CSS
  if (item.bgImageUrl) {
    inner.style.setProperty('--arc-bg-img', `url('${item.bgImageUrl}')`);
    inner.dataset.hasBg = '1';
    // Ensure dark overlay div exists inside inner
    let overlay = inner.querySelector('.arc-filter-overlay');
    if (!overlay) {
      overlay = document.createElement('div');
      overlay.className = 'arc-filter-overlay';
      inner.insertBefore(overlay, inner.firstChild);
    }
    overlay.style.background = 'rgba(0,0,0,0)';
  } else {
    inner.style.removeProperty('--arc-bg-img');
    delete inner.dataset.hasBg;
  }

  container.querySelector('#arc-read-title').textContent = item.title || '（无标题）';
  const date = new Date(item.createdAt).toLocaleDateString('zh-CN', { year: 'numeric', month: 'long', day: 'numeric' });
  const meta = [];
  if (item.author && item.author !== 'unknown') meta.push(`<span>✍️ ${escHtml(item.author)}</span>`);
  meta.push(`<span>📅 ${date}</span>`);
  meta.push(`<span>📝 ${item.body.length.toLocaleString()} 字</span>`);
  if (item.tags.length) meta.push(item.tags.map(t => `<span class="lib-item-tag">${escHtml(t)}</span>`).join(''));
  container.querySelector('#arc-read-meta').innerHTML = meta.join('');
  container.querySelector('#arc-read-body').innerHTML = renderMarkdown(item.body);

  // Sliders
  const sliders = container.querySelector('#arc-read-sliders');
  if (item.bgImageUrl) {
    sliders.style.display = 'flex';
    container.querySelector('#arc-brightness').value = 100;
    container.querySelector('#arc-blur').value = 0;
    inner.dataset.hasBg = '1';
    applyBgFilters(container, 100, 0);
  } else {
    sliders.style.display = 'none';
  }

  // Actions
  const actions = container.querySelector('#arc-read-actions');
  actions.innerHTML = '';
  if (isEditor()) {
    const editBtn = document.createElement('button');
    editBtn.className = 'btn bn';
    editBtn.textContent = '✏️ 编辑';
    editBtn.addEventListener('click', () => { closeReadModal(container); openModal(item, container); });
    actions.appendChild(editBtn);
  }

  modal.classList.add('show');
}

function applyBgFilters(container, brightness, blur) {
  const modal = container.querySelector('#arc-read-modal');
  const inner = modal.querySelector('.tl-modal.arc-read-tl');
  if (!inner || !inner.dataset.hasBg) return;
  // blur via CSS variable → ::before filter
  inner.style.setProperty('--arc-blur', blur + 'px');
  // darkness via overlay div
  const overlay = inner.querySelector('.arc-filter-overlay');
  if (overlay) {
    const darkOpacity = ((100 - brightness) / 100 * 0.85).toFixed(2);
    overlay.style.background = `rgba(0,0,0,${darkOpacity})`;
  }
}

function closeReadModal(container) {
  const modal = container.querySelector('#arc-read-modal');
  modal.classList.remove('show');
  const inner = modal.querySelector('.tl-modal.arc-read-tl');
  if (inner) {
    inner.style.removeProperty('--arc-bg-img');
    inner.style.removeProperty('--arc-blur');
    delete inner.dataset.hasBg;
    const overlay = inner.querySelector('.arc-filter-overlay');
    if (overlay) overlay.style.background = '';
  }
  container.querySelector('#arc-read-sliders').style.display = 'none';
}

function openModal(item, container) {
  editItemId = item ? item.id : null;
  container.querySelector('#arc-modal-title').textContent = item ? '编辑文章' : '新建文章';
  container.querySelector('#arc-title').value = item?.title || '';
  container.querySelector('#arc-body').value = item?.body || '';
  container.querySelector('#arc-author').value = item?.author || '';
  container.querySelector('#arc-bg-url').value = item?.bgImageUrl || '';
  updateBgPreview(container, item?.bgImageUrl || '');

  // Update char count
  const len = (item?.body || '').length;
  container.querySelector('#arc-char-count').textContent = `${len.toLocaleString()} / ${MAX_CHARS.toLocaleString()}`;

  const delBtn = container.querySelector('#arc-delete-btn');
  delBtn.style.display = item ? '' : 'none';

  renderTagPicker(container, item?.tags || []);
  container.querySelector('#arc-modal').classList.add('show');
  setTimeout(() => container.querySelector('#arc-title').focus(), 60);
}

function closeModal(container) {
  container.querySelector('#arc-modal').classList.remove('show');
  editItemId = null;
}

function renderTagPicker(container, selectedItemTags) {
  const picker = container.querySelector('#arc-tag-picker');
  if (!tags.length && !selectedItemTags.length) {
    picker.innerHTML = '<div style="color:var(--muted);font-size:12px;padding:4px 0">暂无标签，请先添加</div>';
    return;
  }
  const allTags = Array.from(new Set([...tags, ...selectedItemTags])).sort();
  picker.innerHTML = allTags.map(tag => `
    <label class="lib-tag-checkbox">
      <input type="checkbox" value="${escHtml(tag)}" ${selectedItemTags.includes(tag) ? 'checked' : ''}/>
      <span>${escHtml(tag)}</span>
    </label>`).join('');
}

function addNewTag(container) {
  const input = container.querySelector('#arc-new-tag');
  const newTag = input.value.trim();
  if (!newTag) return;
  if (!tags.includes(newTag)) tags.push(newTag);
  input.value = '';
  const picker = container.querySelector('#arc-tag-picker');
  const current = Array.from(picker.querySelectorAll('input[type="checkbox"]:checked')).map(cb => cb.value);
  renderTagPicker(container, [...current, newTag]);
}

async function saveItem(container) {
  const title = container.querySelector('#arc-title').value.trim();
  const body = container.querySelector('#arc-body').value;
  const author = container.querySelector('#arc-author').value.trim();
  const selectedItemTags = Array.from(container.querySelectorAll('#arc-tag-picker input[type="checkbox"]:checked')).map(cb => cb.value);

  if (!title && !body) { showToast('请输入标题或内容'); return; }
  if (body.length > MAX_CHARS) { showToast(`文章超过 ${MAX_CHARS.toLocaleString()} 字限制`); return; }

  const savingId = editItemId;
  closeModal(container);
  setSyncStatus('syncing');
  try {
    const bgImageUrl = container.querySelector('#arc-bg-url').value.trim();
    const row = { title, body, author: author || 'unknown', tags_json: JSON.stringify(selectedItemTags), bg_image_url: bgImageUrl };
    if (savingId) {
      const { error } = await supaClient.from(TABLE).update(row).eq('id', savingId);
      if (error) throw error;
      showToast('已更新');
    } else {
      const { error } = await supaClient.from(TABLE).insert(row);
      if (error) throw error;
      showToast('已创建');
    }
    await fetchAll();
    setSyncStatus('ok');
  } catch(e) { dbError('保存文章', e); }
}

async function deleteFromModal(container) {
  const id = editItemId;
  const item = items.find(i => i.id == id);
  if (!item) return;
  const ok = await confirmDialog(`确认删除文章「${item.title || '（无标题）'}」？此操作不可撤销。`);
  if (!ok) return;
  closeModal(container);
  setSyncStatus('syncing');
  try {
    const { error } = await supaClient.from(TABLE).delete().eq('id', id);
    if (error) throw error;
    showToast('已删除');
    await fetchAll();
    setSyncStatus('ok');
  } catch(e) { dbError('删除文章', e); }
}

function subscribeRealtime() {
  realtimeCh = supaClient.channel('articles-changes')
    .on('postgres_changes', { event: '*', schema: 'public', table: TABLE }, () => fetchAll())
    .subscribe();
}

async function renameTag(oldTag, tagListEl) {
  const newTag = prompt(`重命名标签 "${oldTag}" 为：`, oldTag);
  if (!newTag || newTag === oldTag) return;
  setSyncStatus('syncing');
  try {
    for (const item of items.filter(i => i.tags.includes(oldTag)))
      await supaClient.from(TABLE).update({ tags_json: JSON.stringify(item.tags.map(t => t === oldTag ? newTag : t)) }).eq('id', item.id);
    await fetchAll();
    setSyncStatus('ok');
  } catch(e) { dbError('重命名标签', e); }
}

async function deleteTag(tag, tagListEl) {
  const ok = await confirmDialog(`确认删除标签 "${tag}"？将从所有文章中移除。`);
  if (!ok) return;
  setSyncStatus('syncing');
  try {
    for (const item of items.filter(i => i.tags.includes(tag)))
      await supaClient.from(TABLE).update({ tags_json: JSON.stringify(item.tags.filter(t => t !== tag)) }).eq('id', item.id);
    selectedTags = selectedTags.filter(t => t !== tag);
    await fetchAll();
    setSyncStatus('ok');
  } catch(e) { dbError('删除标签', e); }
}

function updateBgPreview(container, url) {
  const wrap = container.querySelector('#arc-bg-preview-wrap');
  if (url) {
    container.querySelector('#arc-bg-preview-img').src = url;
    wrap.style.display = '';
  } else {
    container.querySelector('#arc-bg-preview-img').src = '';
    wrap.style.display = 'none';
  }
}

async function openGalleryPicker(container) {
  const grid = container.querySelector('#arc-gallery-picker-grid');
  grid.innerHTML = '<div style="color:#889;font-size:13px;padding:20px;grid-column:1/-1;text-align:center">加载中...</div>';
  container.querySelector('#arc-gallery-picker').classList.add('show');
  try {
    const { data, error } = await supaClient.from('gallery_items').select('id,image_url,title,tags_json').order('created_at', { ascending: false });
    if (error) throw error;
    const bgImages = (data || []).filter(img => {
      try { return JSON.parse(img.tags_json || '[]').includes('background'); } catch { return false; }
    });
    if (!bgImages.length) {
      grid.innerHTML = '<div style="color:#889;font-size:13px;padding:20px;grid-column:1/-1;text-align:center">图库中暂无标签为「background」的图片</div>';
      return;
    }
    grid.innerHTML = bgImages.map(img => `
      <div class="arc-pick-item" data-url="${escHtml(img.image_url)}"
        style="cursor:pointer;border-radius:8px;overflow:hidden;border:2px solid transparent;transition:border-color .15s;aspect-ratio:1;background:#111">
        <img src="${escHtml(img.image_url)}" style="width:100%;height:100%;object-fit:cover" loading="lazy"/>
      </div>`).join('');
    grid.querySelectorAll('.arc-pick-item').forEach(el => {
      el.addEventListener('click', () => {
        container.querySelector('#arc-bg-url').value = el.dataset.url;
        updateBgPreview(container, el.dataset.url);
        container.querySelector('#arc-gallery-picker').classList.remove('show');
      });
      el.addEventListener('mouseenter', () => el.style.borderColor = 'var(--accent)');
      el.addEventListener('mouseleave', () => el.style.borderColor = 'transparent');
    });
  } catch(e) { dbError('加载图库', e); }
}

function updateSortButton(container) {
  const btn = container.querySelector('#arc-sort-btn');
  if (!btn) return;
  btn.textContent = sortBy === 'desc' ? '🕐 新→旧' : '🕐 旧→新';
}

function updateArticlesUI(container) {
  const addBtn = container.querySelector('#arc-add-btn');
  if (addBtn) addBtn.style.display = isEditor() ? '' : 'none';
  renderTagList(container.querySelector('#arc-tag-list'));
  renderGrid(container);
}

// ── Markdown renderer ──────────────────────────────
function renderMarkdown(raw) {
  const lines = raw.split('\n');
  const out = [];
  let i = 0;

  // Inline: bold, italic, code, links, strikethrough, hr within text
  function inlineHtml(text) {
    // Allow passthrough of raw HTML tags (user-supplied)
    return text
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      // restore allowed html tags after escaping (basic allowlist)
      .replace(/&lt;(\/?(b|i|u|s|em|strong|mark|sub|sup|br|span|a|code|small|del|ins)[^&]*)&gt;/gi, '<$1>')
      // code span (before bold/italic to avoid conflicts)
      .replace(/`([^`]+)`/g, '<code class="arc-inline-code">$1</code>')
      // bold+italic
      .replace(/\*\*\*(.+?)\*\*\*/g, '<strong><em>$1</em></strong>')
      // bold
      .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
      .replace(/__(.+?)__/g, '<strong>$1</strong>')
      // italic
      .replace(/\*([^*\n]+?)\*/g, '<em>$1</em>')
      .replace(/_([^_\n]+?)_/g, '<em>$1</em>')
      // strikethrough
      .replace(/~~(.+?)~~/g, '<del>$1</del>')
      // links [text](url)
      .replace(/\[([^\]]+)\]\((https?:\/\/[^\)]+)\)/g, '<a href="$2" target="_blank" rel="noopener" class="arc-link">$1</a>')
      // bare urls
      .replace(/(^|[\s])((https?:\/\/)[^\s<]+)/g, '$1<a href="$2" target="_blank" rel="noopener" class="arc-link">$2</a>');
  }

  function flushPara(buf) {
    if (!buf.length) return;
    out.push(`<p class="arc-para">${inlineHtml(buf.join('\n'))}</p>`);
  }

  let paraBuf = [];
  let inCodeBlock = false;
  let codeLang = '';
  let codeBuf = [];

  while (i < lines.length) {
    const line = lines[i];

    // Fenced code block
    if (/^```/.test(line)) {
      if (!inCodeBlock) {
        flushPara(paraBuf); paraBuf = [];
        codeLang = line.slice(3).trim();
        inCodeBlock = true; codeBuf = [];
      } else {
        const langClass = codeLang ? ` class="language-${escHtml(codeLang)}"` : '';
        out.push(`<pre class="arc-code-block"><code${langClass}>${codeBuf.map(l => escHtml(l)).join('\n')}</code></pre>`);
        inCodeBlock = false; codeLang = ''; codeBuf = [];
      }
      i++; continue;
    }
    if (inCodeBlock) { codeBuf.push(line); i++; continue; }

    // Heading
    const hm = line.match(/^(#{1,6})\s+(.+)$/);
    if (hm) {
      flushPara(paraBuf); paraBuf = [];
      const lvl = hm[1].length;
      out.push(`<h${lvl} class="arc-h${lvl}">${inlineHtml(hm[2])}</h${lvl}>`);
      i++; continue;
    }

    // Horizontal rule
    if (/^(-{3,}|\*{3,}|_{3,})$/.test(line.trim())) {
      flushPara(paraBuf); paraBuf = [];
      out.push('<hr class="arc-hr"/>');
      i++; continue;
    }

    // Blockquote
    if (/^>\s?/.test(line)) {
      flushPara(paraBuf); paraBuf = [];
      const qlines = [];
      while (i < lines.length && /^>\s?/.test(lines[i])) {
        qlines.push(lines[i].replace(/^>\s?/, ''));
        i++;
      }
      out.push(`<blockquote class="arc-blockquote">${inlineHtml(qlines.join('\n'))}</blockquote>`);
      continue;
    }

    // Unordered list
    if (/^[-*+]\s/.test(line)) {
      flushPara(paraBuf); paraBuf = [];
      out.push('<ul class="arc-ul">');
      while (i < lines.length && /^[-*+]\s/.test(lines[i])) {
        out.push(`<li>${inlineHtml(lines[i].replace(/^[-*+]\s/, ''))}</li>`);
        i++;
      }
      out.push('</ul>'); continue;
    }

    // Ordered list
    if (/^\d+\.\s/.test(line)) {
      flushPara(paraBuf); paraBuf = [];
      out.push('<ol class="arc-ol">');
      while (i < lines.length && /^\d+\.\s/.test(lines[i])) {
        out.push(`<li>${inlineHtml(lines[i].replace(/^\d+\.\s/, ''))}</li>`);
        i++;
      }
      out.push('</ol>'); continue;
    }

    // Blank line = paragraph break
    if (line.trim() === '') {
      flushPara(paraBuf); paraBuf = [];
      i++; continue;
    }

    // Normal line → accumulate into paragraph
    paraBuf.push(line);
    i++;
  }

  if (inCodeBlock) {
    out.push(`<pre class="arc-code-block"><code>${codeBuf.map(l => escHtml(l)).join('\n')}</code></pre>`);
  }
  flushPara(paraBuf);
  return out.join('\n');
}
