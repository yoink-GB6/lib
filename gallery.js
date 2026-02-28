// pages/gallery.js
// 图库页面：支持标签筛选、图片上传和权限管理

import { supaClient, setSyncStatus, dbError } from './supabase-client.js';
import { isEditor, onAuthChange } from './auth.js';
import { showToast, escHtml, confirmDialog } from './ui.js';

const TABLE = 'gallery_items';
const BUCKET = 'gallery';

let items = [];
let tags = [];
let selectedTags = [];
let searchKeyword = '';
let selectedAuthor = '';
let sortBy = 'asc';
let editItemId = null;
let realtimeCh = null;
let pageContainer = null;

export async function mount(container) {
  pageContainer = container;
  container.innerHTML = buildHTML();
  bindControls(container);
  onAuthChange(() => updateGalleryUI(container));
  updateSortButton(container);
  updateGalleryUI(container);
  await fetchAll();
  subscribeRealtime();
}

export function unmount() {
  realtimeCh && supaClient.removeChannel(realtimeCh);
}

function buildHTML() {
  return `
<div class="lib-layout">
  <!-- Main content area -->
  <div class="lib-main">
    <div class="gal-grid" id="gal-grid"></div>
  </div>

  <!-- Floating expand button -->
  <button id="gal-expand" class="expand-btn-float" title="展开筛选">◀</button>

  <!-- Right sidebar -->
  <div class="lib-panel" id="gal-panel">
    <div class="lib-panel-hdr" id="gal-panel-toggle">
      <span>🖼 搜索 & 筛选</span>
      <span id="gal-panel-chevron">▶</span>
    </div>
    <div class="lib-panel-body">
      <!-- Sort + Add row -->
      <div style="display:flex;gap:6px;margin-bottom:14px">
        <button class="btn bn" id="gal-sort-btn" style="flex:1;font-size:12px">🕐 旧→新</button>
        <button class="btn bp" id="gal-add-btn" style="display:none;font-size:12px;padding:6px 12px">＋ 新建</button>
      </div>

      <!-- Search -->
      <div style="margin-bottom:16px">
        <input id="gal-search-input" type="text" placeholder="搜索标题/描述..."
          autocomplete="off"
          style="width:100%;padding:8px 12px;border:1px solid var(--border);border-radius:6px;background:var(--bg);color:var(--text);font-size:13px"/>
      </div>

      <!-- Author filter -->
      <div style="margin-bottom:16px;position:relative">
        <input id="gal-author-input" type="text" placeholder="输入作者名筛选..."
          autocomplete="off"
          style="width:100%;padding:8px 12px;border:1px solid var(--border);border-radius:6px;background:var(--bg);color:var(--text);font-size:13px"/>
        <button id="gal-author-clear"
          style="position:absolute;right:8px;top:50%;transform:translateY(-50%);background:none;border:none;color:#889;cursor:pointer;font-size:16px;padding:4px;display:none"
          title="清除作者筛选">✕</button>
      </div>

      <!-- Tag hint -->
      <div style="font-size:12px;color:#889;margin-bottom:12px;line-height:1.6">
        点击标签进行筛选。选中多个标签时，显示<b>同时包含</b>所有选中标签的图片。
      </div>
      <div id="gal-tag-list" class="lib-tag-list"></div>
    </div>
  </div>
</div>

<!-- Upload/Edit modal -->
<div id="gal-modal" class="tl-modal-overlay">
  <div class="tl-modal" style="max-width:520px" onmousedown="event.stopPropagation()">
    <h2 id="gal-modal-title">上传图片</h2>

    <!-- Image preview -->
    <div id="gal-preview-wrap" style="margin-bottom:12px;text-align:center;display:none">
      <img id="gal-preview-img" style="max-width:100%;max-height:240px;border-radius:8px;border:1px solid var(--border)"/>
    </div>

    <!-- Upload mode selector (new items only) -->
    <div id="gal-upload-mode" style="margin-bottom:14px">
      <div style="display:flex;gap:8px;margin-bottom:12px">
        <button id="gal-mode-file" class="btn bp" style="flex:1;font-size:13px;display:flex;align-items:center;justify-content:center;gap:6px;padding:8px 0">
          <span style="font-size:16px">📁</span><span>上传文件</span>
        </button>
        <button id="gal-mode-link" class="btn bn" style="flex:1;font-size:13px;display:flex;align-items:center;justify-content:center;gap:6px;padding:8px 0">
          <span style="font-size:16px">🔗</span><span>图片链接</span>
        </button>
      </div>
      <!-- File input -->
      <div id="gal-file-wrap" style="margin-bottom:4px">
        <input id="gal-file-input" type="file" accept="image/*"
          style="width:100%;padding:8px;border:1px solid var(--border);border-radius:6px;background:var(--bg);color:var(--text);font-size:13px;cursor:pointer"/>
      </div>
      <!-- Link input -->
      <div id="gal-link-wrap" style="display:none;margin-bottom:4px">
        <input id="gal-link-input" type="url" placeholder="https://..."
          autocomplete="off"
          style="width:100%;padding:8px 12px;border:1px solid var(--border);border-radius:6px;background:var(--bg);color:var(--text);font-size:13px"/>
      </div>
    </div>

    <label>标题（可选）</label>
    <input id="gal-title" type="text" placeholder="图片标题..." autocomplete="off" style="margin-bottom:12px"/>

    <label>描述（可选）</label>
    <textarea id="gal-desc" rows="3" placeholder="图片描述..." style="margin-bottom:12px;font-family:inherit"></textarea>

    <label>作者</label>
    <input id="gal-author" type="text" placeholder="作者名..." autocomplete="off" style="margin-bottom:12px"/>

    <label>标签</label>
    <div id="gal-tag-picker" style="margin-bottom:8px"></div>
    <div style="display:flex;gap:8px;margin-bottom:16px">
      <input id="gal-new-tag" type="text" placeholder="新增标签..." autocomplete="off"
        style="flex:1;padding:8px 12px;border:1px solid var(--border);border-radius:6px;background:var(--bg);color:var(--text);font-size:13px"/>
      <button class="btn bn" id="gal-add-tag-btn" style="padding:8px 14px">＋</button>
    </div>

    <div style="display:flex;gap:8px;justify-content:flex-end">
      <button class="btn bn" id="gal-cancel-btn">取消</button>
      <button class="btn bp" id="gal-save-btn">保存</button>
    </div>
  </div>
</div>

<!-- Lightbox -->
<div id="gal-lightbox" class="tl-modal-overlay" style="background:rgba(0,0,0,0.85)">
  <div style="position:relative;max-width:90vw;max-height:90vh;display:flex;flex-direction:column;align-items:center" onmousedown="event.stopPropagation()">
    <img id="gal-lightbox-img" style="max-width:90vw;max-height:80vh;object-fit:contain;border-radius:8px"/>
    <div id="gal-lightbox-info" style="margin-top:12px;color:#ccc;font-size:13px;text-align:center;max-width:600px"></div>
    <div id="gal-lightbox-actions" style="display:flex;gap:8px;margin-top:10px"></div>
    <button id="gal-lightbox-close" style="position:absolute;top:-16px;right:-16px;background:#333;border:none;color:#fff;width:32px;height:32px;border-radius:50%;cursor:pointer;font-size:18px;display:flex;align-items:center;justify-content:center">✕</button>
  </div>
</div>
`;
}

function bindControls(container) {
  // Sort
  container.querySelector('#gal-sort-btn').addEventListener('click', () => {
    sortBy = sortBy === 'asc' ? 'desc' : 'asc';
    updateSortButton(container);
    renderGrid(container);
  });

  // Add/upload button
  container.querySelector('#gal-add-btn').addEventListener('click', () => openModal(null, container));

  // Panel toggle
  function togglePanel() {
    const panel = container.querySelector('#gal-panel');
    const chevron = container.querySelector('#gal-panel-chevron');
    const expandBtn = container.querySelector('#gal-expand');
    const collapsed = panel.classList.toggle('collapsed');
    chevron.textContent = collapsed ? '◀' : '▶';
    if (expandBtn) expandBtn.classList.toggle('show', collapsed);
  }
  container.querySelector('#gal-panel-toggle')?.addEventListener('click', togglePanel);
  container.querySelector('#gal-expand')?.addEventListener('click', togglePanel);

  // Search
  container.querySelector('#gal-search-input').addEventListener('input', e => {
    searchKeyword = e.target.value.toLowerCase();
    renderGrid(container);
  });

  // Author filter
  const authorInput = container.querySelector('#gal-author-input');
  const authorClear = container.querySelector('#gal-author-clear');
  authorInput.addEventListener('input', e => {
    selectedAuthor = e.target.value.trim();
    authorClear.style.display = selectedAuthor ? '' : 'none';
    renderGrid(container);
  });
  authorClear.addEventListener('click', () => {
    selectedAuthor = '';
    authorInput.value = '';
    authorClear.style.display = 'none';
    renderGrid(container);
  });

  // File input preview
  container.querySelector('#gal-file-input').addEventListener('change', e => {
    const file = e.target.files[0];
    if (!file) return;
    const url = URL.createObjectURL(file);
    const previewWrap = container.querySelector('#gal-preview-wrap');
    const previewImg = container.querySelector('#gal-preview-img');
    previewImg.src = url;
    previewWrap.style.display = '';
  });

  // Upload mode toggle inside modal
  container.querySelector('#gal-mode-file')?.addEventListener('click', () => switchUploadMode(container, 'file'));
  container.querySelector('#gal-mode-link')?.addEventListener('click', () => switchUploadMode(container, 'link'));

  // Modal controls
  container.querySelector('#gal-cancel-btn').addEventListener('click', () => closeModal(container));
  container.querySelector('#gal-modal').addEventListener('mousedown', e => {
    if (e.target === container.querySelector('#gal-modal')) closeModal(container);
  });
  container.querySelector('#gal-save-btn').addEventListener('click', () => saveItem(container));
  container.querySelector('#gal-add-tag-btn').addEventListener('click', () => addNewTag(container));
  container.querySelector('#gal-new-tag').addEventListener('keydown', e => {
    if (e.key === 'Enter') { e.preventDefault(); addNewTag(container); }
  });

  // Lightbox close
  container.querySelector('#gal-lightbox-close').addEventListener('click', () => closeLightbox(container));
  container.querySelector('#gal-lightbox').addEventListener('mousedown', e => {
    if (e.target === container.querySelector('#gal-lightbox')) closeLightbox(container);
  });
}

async function fetchAll() {
  setSyncStatus('syncing');
  try {
    const { data, error } = await supaClient.from(TABLE).select('*');
    if (error) throw error;
    items = data.map(r => ({
      id: r.id,
      title: r.title || '',
      description: r.description || '',
      author: r.author || '',
      tags: JSON.parse(r.tags_json || '[]'),
      imageUrl: r.image_url,
      storagePath: r.storage_path,
      createdAt: r.created_at,
    }));
    // Collect all tags
    const tagSet = new Set();
    items.forEach(item => item.tags.forEach(t => tagSet.add(t)));
    tags = Array.from(tagSet).sort();
    if (pageContainer) {
      renderTagList(pageContainer.querySelector('#gal-tag-list'));
      renderGrid(pageContainer);
    }
    setSyncStatus('ok');
  } catch(e) { dbError('加载图库', e); }
}

function sortItems() {
  items.sort((a, b) => sortBy === 'asc'
    ? new Date(a.createdAt) - new Date(b.createdAt)
    : new Date(b.createdAt) - new Date(a.createdAt)
  );
}

function renderTagList(tagListEl) {
  if (!tagListEl) return;
  if (!tags.length) { tagListEl.innerHTML = '<div style="color:#556;font-size:12px">暂无标签</div>'; return; }
  tagListEl.innerHTML = tags.map(tag => {
    const active = selectedTags.includes(tag) ? 'active' : '';
    const actions = isEditor() ? `
      <span class="lib-tag-action" data-action="rename" data-tag="${escHtml(tag)}" title="重命名">✏️</span>
      <span class="lib-tag-action" data-action="delete" data-tag="${escHtml(tag)}" title="删除">🗑</span>` : '';
    return `<div class="lib-tag-item ${active}" data-tag="${escHtml(tag)}">
      <span class="lib-tag-label">${escHtml(tag)}</span>
      ${actions}
    </div>`;
  }).join('');

  tagListEl.querySelectorAll('.lib-tag-item').forEach(el => {
    el.querySelector('.lib-tag-label')?.addEventListener('click', () => {
      const tag = el.dataset.tag;
      if (selectedTags.includes(tag)) selectedTags = selectedTags.filter(t => t !== tag);
      else selectedTags.push(tag);
      renderTagList(tagListEl);
      renderGrid(pageContainer);
    });
    el.querySelector('[data-action="rename"]')?.addEventListener('click', e => {
      e.stopPropagation();
      renameTag(el.dataset.tag, tagListEl);
    });
    el.querySelector('[data-action="delete"]')?.addEventListener('click', e => {
      e.stopPropagation();
      deleteTag(el.dataset.tag, tagListEl);
    });
  });
}

function renderGrid(container) {
  const grid = container.querySelector('#gal-grid');
  if (!grid) return;
  sortItems();

  let filtered = [...items];
  if (searchKeyword) filtered = filtered.filter(item =>
    item.title.toLowerCase().includes(searchKeyword) ||
    item.description.toLowerCase().includes(searchKeyword)
  );
  if (selectedAuthor) filtered = filtered.filter(item =>
    item.author.toLowerCase().includes(selectedAuthor.toLowerCase())
  );
  if (selectedTags.length) filtered = filtered.filter(item =>
    selectedTags.every(t => item.tags.includes(t))
  );

  if (!filtered.length) {
    grid.innerHTML = `<div style="color:#556;font-size:14px;grid-column:1/-1;padding:40px;text-align:center">暂无图片</div>`;
    return;
  }

  grid.innerHTML = filtered.map(item => {
    const tagsHtml = item.tags.map(t => `<span class="lib-item-tag">${escHtml(t)}</span>`).join('');
    const titleHtml = item.title ? `<div class="gal-item-title">${escHtml(item.title)}</div>` : '';
    const authorHtml = item.author ? `<div class="lib-item-author">by ${escHtml(item.author)}</div>` : '';
    return `<div class="gal-item" data-id="${item.id}">
      <div class="gal-item-img-wrap">
        <img class="gal-item-img" src="${escHtml(item.imageUrl)}" loading="lazy" alt="${escHtml(item.title || '')}"/>
      </div>
      ${titleHtml}
      ${tagsHtml ? `<div class="lib-item-tags" style="padding:0 8px 4px">${tagsHtml}</div>` : ''}
      ${authorHtml ? `<div style="padding:0 8px 8px">${authorHtml}</div>` : ''}
    </div>`;
  }).join('');

  grid.querySelectorAll('.gal-item').forEach(el => {
    el.addEventListener('click', () => {
      const item = items.find(i => i.id == el.dataset.id);
      if (item) openLightbox(item, container);
    });
  });
}

function openLightbox(item, container) {
  const lb = container.querySelector('#gal-lightbox');
  container.querySelector('#gal-lightbox-img').src = item.imageUrl;
  const info = [];
  if (item.title) info.push(`<b>${escHtml(item.title)}</b>`);
  if (item.description) info.push(escHtml(item.description));
  if (item.author) info.push(`by ${escHtml(item.author)}`);
  container.querySelector('#gal-lightbox-info').innerHTML = info.join('<br>');

  const actions = container.querySelector('#gal-lightbox-actions');
  actions.innerHTML = `<a class="btn bn" href="${escHtml(item.imageUrl)}" download target="_blank" style="font-size:12px">⬇ 下载</a>`;
  if (isEditor()) {
    actions.innerHTML += `
      <button class="btn bn" id="lb-edit-btn" style="font-size:12px">✏️ 编辑</button>
      <button class="btn bd" id="lb-del-btn" style="font-size:12px">🗑 删除</button>`;
    actions.querySelector('#lb-edit-btn')?.addEventListener('click', () => {
      closeLightbox(container);
      openModal(item, container);
    });
    actions.querySelector('#lb-del-btn')?.addEventListener('click', async () => {
      closeLightbox(container);
      await deleteItem(item.id, item.storagePath, container);
    });
  }
  lb.classList.add('show');
}

function closeLightbox(container) {
  container.querySelector('#gal-lightbox').classList.remove('show');
}

function openModal(item, container) {
  editItemId = item ? item.id : null;
  const isEdit = !!item;
  container.querySelector('#gal-modal-title').textContent = isEdit ? '编辑图片信息' : '新建';
  container.querySelector('#gal-title').value = item?.title || '';
  container.querySelector('#gal-desc').value = item?.description || '';
  container.querySelector('#gal-author').value = item?.author || '';

  // Show/hide upload mode selector
  const uploadMode = container.querySelector('#gal-upload-mode');
  if (uploadMode) uploadMode.style.display = isEdit ? 'none' : '';

  // Default to file mode for new items
  if (!isEdit) switchUploadMode(container, 'file');

  // Preview
  const previewWrap = container.querySelector('#gal-preview-wrap');
  const previewImg = container.querySelector('#gal-preview-img');
  if (item) {
    previewImg.src = item.imageUrl;
    previewWrap.style.display = '';
  } else {
    previewImg.src = '';
    previewWrap.style.display = 'none';
    container.querySelector('#gal-file-input').value = '';
    const linkInput = container.querySelector('#gal-link-input');
    if (linkInput) linkInput.value = '';
  }

  renderTagPicker(container, item?.tags || []);
  container.querySelector('#gal-modal').classList.add('show');
}

function closeModal(container) {
  container.querySelector('#gal-modal').classList.remove('show');
  editItemId = null;
}

function switchUploadMode(container, mode) {
  container.querySelector('#gal-modal').dataset.mode = mode;
  const fileWrap = container.querySelector('#gal-file-wrap');
  const linkWrap = container.querySelector('#gal-link-wrap');
  const btnFile = container.querySelector('#gal-mode-file');
  const btnLink = container.querySelector('#gal-mode-link');
  if (mode === 'file') {
    fileWrap.style.display = '';
    linkWrap.style.display = 'none';
    btnFile.className = 'btn bp';
    btnLink.className = 'btn bn';
  } else {
    fileWrap.style.display = 'none';
    linkWrap.style.display = '';
    btnFile.className = 'btn bn';
    btnLink.className = 'btn bp';
  }
}

function renderTagPicker(container, selectedItemTags) {
  const picker = container.querySelector('#gal-tag-picker');
  picker.innerHTML = tags.map(tag => {
    const active = selectedItemTags.includes(tag) ? 'active' : '';
    return `
      <div class="lib-tag-item ${active}" data-tag="${escHtml(tag)}">
        <span class="lib-tag-label">${escHtml(tag)}</span>
      </div>`;
  }).join('');

  picker.querySelectorAll('.lib-tag-item').forEach(el => {
    el.addEventListener('click', () => {
      el.classList.toggle('active');
    });
  });
}


function addNewTag(container) {
  const input = container.querySelector('#gal-new-tag');
  const newTag = input.value.trim();
  if (!newTag) return;
  if (!tags.includes(newTag)) tags.push(newTag);
  input.value = '';
  const picker = container.querySelector('#gal-tag-picker');
  const current = Array.from(picker.querySelectorAll('input[type="checkbox"]:checked')).map(cb => cb.value);
  renderTagPicker(container, [...current, newTag]);
}

async function saveItem(container) {
  const title = container.querySelector('#gal-title').value.trim();
  const description = container.querySelector('#gal-desc').value.trim();
  const author = container.querySelector('#gal-author').value.trim();
  const selectedItemTags = Array.from(container.querySelectorAll('#gal-tag-picker input[type="checkbox"]:checked'))
    .map(cb => cb.value);
  const savingId = editItemId;

  closeModal(container);
  setSyncStatus('syncing');

  try {
    if (savingId) {
      // Edit: only update metadata, not image
      const { error } = await supaClient.from(TABLE).update({
        title, description,
        author: author || 'unknown',
        tags_json: JSON.stringify(selectedItemTags),
      }).eq('id', savingId);
      if (error) throw error;
      showToast('已更新');
    } else {
      // New: upload file or use link
      const mode = container.querySelector('#gal-modal').dataset.mode || 'file';
      let imageUrl = '', storagePath = '';

      if (mode === 'link') {
        imageUrl = container.querySelector('#gal-link-input').value.trim();
        if (!imageUrl) { showToast('请输入图片链接'); setSyncStatus('ok'); return; }
      } else {
        const file = container.querySelector('#gal-file-input').files[0];
        if (!file) { showToast('请选择图片文件'); setSyncStatus('ok'); return; }
        const ext = file.name.split('.').pop();
        storagePath = `${Date.now()}_${Math.random().toString(36).slice(2)}.${ext}`;
        const { error: upErr } = await supaClient.storage.from(BUCKET).upload(storagePath, file, {
          cacheControl: '3600', upsert: false
        });
        if (upErr) throw upErr;
        const { data: urlData } = supaClient.storage.from(BUCKET).getPublicUrl(storagePath);
        imageUrl = urlData.publicUrl;
      }

      const { error } = await supaClient.from(TABLE).insert({
        title, description,
        author: author || 'unknown',
        tags_json: JSON.stringify(selectedItemTags),
        image_url: imageUrl,
        storage_path: storagePath,
      });
      if (error) throw error;
      showToast(mode === 'link' ? '已添加' : '已上传');
    }

    await fetchAll();
    setSyncStatus('ok');
  } catch(e) { dbError('保存图片', e); }
}

async function deleteItem(id, storagePath, container) {
  const ok = await confirmDialog('确认删除这张图片？此操作不可撤销。');
  if (!ok) return;
  setSyncStatus('syncing');
  try {
    if (storagePath) {
      await supaClient.storage.from(BUCKET).remove([storagePath]);
    }
    const { error } = await supaClient.from(TABLE).delete().eq('id', id);
    if (error) throw error;
    showToast('已删除');
    await fetchAll();
    setSyncStatus('ok');
  } catch(e) { dbError('删除图片', e); }
}

function subscribeRealtime() {
  realtimeCh = supaClient.channel('gallery-changes')
    .on('postgres_changes', { event: '*', schema: 'public', table: TABLE }, () => fetchAll())
    .subscribe();
}

async function renameTag(oldTag, tagListEl) {
  const newTag = prompt(`重命名标签 "${oldTag}" 为：`, oldTag);
  if (!newTag || newTag === oldTag) return;
  setSyncStatus('syncing');
  try {
    const toUpdate = items.filter(item => item.tags.includes(oldTag));
    for (const item of toUpdate) {
      const newTags = item.tags.map(t => t === oldTag ? newTag : t);
      await supaClient.from(TABLE).update({ tags_json: JSON.stringify(newTags) }).eq('id', item.id);
    }
    await fetchAll();
    setSyncStatus('ok');
  } catch(e) { dbError('重命名标签', e); }
}

async function deleteTag(tag, tagListEl) {
  const ok = await confirmDialog(`确认删除标签 "${tag}"？将从所有图片中移除。`);
  if (!ok) return;
  setSyncStatus('syncing');
  try {
    const toUpdate = items.filter(item => item.tags.includes(tag));
    for (const item of toUpdate) {
      const newTags = item.tags.filter(t => t !== tag);
      await supaClient.from(TABLE).update({ tags_json: JSON.stringify(newTags) }).eq('id', item.id);
    }
    selectedTags = selectedTags.filter(t => t !== tag);
    await fetchAll();
    setSyncStatus('ok');
  } catch(e) { dbError('删除标签', e); }
}

function updateSortButton(container) {
  const btn = container.querySelector('#gal-sort-btn');
  if (!btn) return;
  btn.textContent = sortBy === 'asc' ? '🕐 旧→新' : '🕐 新→旧';
  btn.title = sortBy === 'asc' ? '当前：旧→新，点击切换' : '当前：新→旧，点击切换';
}

function updateGalleryUI(container) {
  const addBtn = container.querySelector('#gal-add-btn');
  if (addBtn) addBtn.style.display = isEditor() ? '' : 'none';
}
