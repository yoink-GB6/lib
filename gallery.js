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

// Lightbox zoom/pan state
let lbScale = 1;
let lbDragging = false;
let lbDragStart = { x: 0, y: 0 };
let lbTranslate = { x: 0, y: 0 };
let lbLastTranslate = { x: 0, y: 0 };

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
  <div class="lib-main">
    <div class="gal-grid" id="gal-grid"></div>
  </div>

  <button id="gal-expand" class="expand-btn-float" title="展开筛选">◀</button>

  <div class="lib-panel" id="gal-panel">
    <div class="lib-panel-hdr" id="gal-panel-toggle">
      <span>🖼 搜索 & 筛选</span>
      <span id="gal-panel-chevron">▶</span>
    </div>
    <div class="lib-panel-body">
      <div style="display:flex;gap:6px;margin-bottom:14px">
        <button class="btn bn" id="gal-sort-btn" style="flex:1;font-size:12px">🕐 旧→新</button>
        <button class="btn bp" id="gal-add-btn" style="display:none;font-size:12px;padding:6px 12px">＋ 新建</button>
      </div>
      <div style="margin-bottom:16px">
        <input id="gal-search-input" type="text" placeholder="搜索标题/描述..."
          autocomplete="off"
          style="width:100%;padding:8px 12px;border:1px solid var(--border);border-radius:6px;background:var(--bg);color:var(--text);font-size:13px"/>
      </div>
      <div style="margin-bottom:16px;position:relative">
        <input id="gal-author-input" type="text" placeholder="输入作者名筛选..."
          autocomplete="off"
          style="width:100%;padding:8px 12px;border:1px solid var(--border);border-radius:6px;background:var(--bg);color:var(--text);font-size:13px"/>
        <button id="gal-author-clear"
          style="position:absolute;right:8px;top:50%;transform:translateY(-50%);background:none;border:none;color:#889;cursor:pointer;font-size:16px;padding:4px;display:none"
          title="清除作者筛选">✕</button>
      </div>
      <div style="font-size:12px;color:#889;margin-bottom:12px;line-height:1.6">
        点击标签进行筛选。选中多个标签时，显示<b>同时包含</b>所有选中标签的图片。
      </div>
      <div id="gal-tag-list" class="lib-tag-list"></div>
    </div>
  </div>
</div>

<!-- Edit / New modal -->
<div id="gal-modal" class="tl-modal-overlay">
  <div class="tl-modal" style="max-width:520px" onmousedown="event.stopPropagation()">
    <h2 id="gal-modal-title" style="color:var(--accent)">新建</h2>

    <div id="gal-preview-wrap" style="margin-bottom:12px;text-align:center;display:none">
      <img id="gal-preview-img" style="max-width:100%;max-height:200px;border-radius:8px;border:1px solid var(--border)"/>
    </div>

    <div id="gal-upload-mode" style="margin-bottom:14px">
      <div style="display:flex;gap:8px;margin-bottom:10px">
        <button id="gal-mode-file" class="btn bp" style="flex:1;font-size:13px;display:flex;align-items:center;justify-content:center;gap:6px;padding:8px 0">
          <span style="font-size:16px">📁</span><span>上传文件</span>
        </button>
        <button id="gal-mode-link" class="btn bn" style="flex:1;font-size:13px;display:flex;align-items:center;justify-content:center;gap:6px;padding:8px 0">
          <span style="font-size:16px">🔗</span><span>图片链接</span>
        </button>
      </div>
      <div id="gal-file-wrap" style="margin-bottom:4px">
        <input id="gal-file-input" type="file" accept="image/*"
          style="width:100%;padding:8px;border:1px solid var(--border);border-radius:6px;background:var(--bg);color:var(--text);font-size:13px;cursor:pointer"/>
      </div>
      <div id="gal-link-wrap" style="display:none;margin-bottom:4px">
        <input id="gal-link-input" type="url" placeholder="https://..."
          autocomplete="off"
          style="width:100%;padding:8px 12px;border:1px solid var(--border);border-radius:6px;background:var(--bg);color:var(--text);font-size:13px"/>
      </div>
    </div>

    <label>标题（可选）</label>
    <input id="gal-title" type="text" placeholder="图片标题..." autocomplete="off" style="margin-bottom:12px"/>

    <label>描述（可选）</label>
    <textarea id="gal-desc" rows="3" placeholder="图片描述..." style="margin-bottom:12px;font-family:inherit;resize:vertical"></textarea>

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
      <button class="btn bd" id="gal-delete-btn" style="display:none;margin-right:auto">🗑 删除</button>
      <button class="btn bn" id="gal-cancel-btn">取消</button>
      <button class="btn bp" id="gal-save-btn">保存</button>
    </div>
  </div>
</div>

<!-- Lightbox -->
<div id="gal-lightbox" class="tl-modal-overlay" style="background:rgba(0,0,0,0.92)">
  <div id="gal-lb-wrap" style="position:relative;width:100%;height:100%;display:flex;align-items:center;justify-content:center;overflow:hidden">
    <img id="gal-lightbox-img"
      style="max-width:90vw;max-height:88vh;object-fit:contain;border-radius:6px;cursor:default;user-select:none;touch-action:none;transform-origin:center center"/>
    <div id="gal-lightbox-info" style="position:absolute;bottom:18px;left:50%;transform:translateX(-50%);color:#ddd;font-size:13px;text-align:center;max-width:70vw;pointer-events:none;text-shadow:0 1px 4px #000a"></div>
    <div style="position:absolute;bottom:18px;right:20px;color:#555;font-size:11px;pointer-events:none">滚轮 / 双指缩放</div>
    <button id="gal-lightbox-close" style="position:absolute;top:16px;right:16px;background:rgba(0,0,0,.55);border:1px solid #555;color:#fff;width:34px;height:34px;border-radius:50%;cursor:pointer;font-size:18px;display:flex;align-items:center;justify-content:center;z-index:2">✕</button>
    <div style="position:absolute;top:16px;left:50%;transform:translateX(-50%);display:flex;gap:8px;z-index:2">
      <button id="gal-lb-zout" style="background:rgba(0,0,0,.55);border:1px solid #555;color:#fff;width:32px;height:32px;border-radius:8px;cursor:pointer;font-size:20px;display:flex;align-items:center;justify-content:center;line-height:1">−</button>
      <button id="gal-lb-reset" style="background:rgba(0,0,0,.55);border:1px solid #555;color:#ccc;width:52px;height:32px;border-radius:8px;cursor:pointer;font-size:11px;display:flex;align-items:center;justify-content:center">100%</button>
      <button id="gal-lb-zin" style="background:rgba(0,0,0,.55);border:1px solid #555;color:#fff;width:32px;height:32px;border-radius:8px;cursor:pointer;font-size:20px;display:flex;align-items:center;justify-content:center;line-height:1">＋</button>
    </div>
  </div>
</div>
`;
}

function bindControls(container) {
  container.querySelector('#gal-sort-btn').addEventListener('click', () => {
    sortBy = sortBy === 'asc' ? 'desc' : 'asc';
    updateSortButton(container);
    renderGrid(container);
  });

  container.querySelector('#gal-add-btn').addEventListener('click', () => openModal(null, container));

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

  container.querySelector('#gal-search-input').addEventListener('input', e => {
    searchKeyword = e.target.value.toLowerCase();
    renderGrid(container);
  });

  const authorInput = container.querySelector('#gal-author-input');
  const authorClear = container.querySelector('#gal-author-clear');
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

  container.querySelector('#gal-file-input').addEventListener('change', e => {
    const file = e.target.files[0];
    if (!file) return;
    const previewWrap = container.querySelector('#gal-preview-wrap');
    const previewImg = container.querySelector('#gal-preview-img');
    previewImg.src = URL.createObjectURL(file);
    previewWrap.style.display = '';
  });

  container.querySelector('#gal-mode-file')?.addEventListener('click', () => switchUploadMode(container, 'file'));
  container.querySelector('#gal-mode-link')?.addEventListener('click', () => switchUploadMode(container, 'link'));

  container.querySelector('#gal-cancel-btn').addEventListener('click', () => closeModal(container));
  container.querySelector('#gal-modal').addEventListener('mousedown', e => {
    if (e.target === container.querySelector('#gal-modal')) closeModal(container);
  });
  container.querySelector('#gal-save-btn').addEventListener('click', () => saveItem(container));
  container.querySelector('#gal-delete-btn').addEventListener('click', () => deleteFromModal(container));
  container.querySelector('#gal-add-tag-btn').addEventListener('click', () => addNewTag(container));
  container.querySelector('#gal-new-tag').addEventListener('keydown', e => {
    if (e.key === 'Enter') { e.preventDefault(); addNewTag(container); }
  });

  // Lightbox
  container.querySelector('#gal-lightbox-close').addEventListener('click', () => closeLightbox(container));
  container.querySelector('#gal-lightbox').addEventListener('mousedown', e => {
    if (e.target === container.querySelector('#gal-lightbox') ||
        e.target === container.querySelector('#gal-lb-wrap')) closeLightbox(container);
  });
  container.querySelector('#gal-lb-zin').addEventListener('click', () => setLbScale(container, lbScale * 1.3));
  container.querySelector('#gal-lb-zout').addEventListener('click', () => setLbScale(container, lbScale / 1.3));
  container.querySelector('#gal-lb-reset').addEventListener('click', () => resetLbTransform(container));

  container.querySelector('#gal-lightbox').addEventListener('wheel', e => {
    e.preventDefault();
    setLbScale(container, lbScale * (e.deltaY < 0 ? 1.15 : 1 / 1.15));
  }, { passive: false });

  const img = container.querySelector('#gal-lightbox-img');
  img.addEventListener('mousedown', e => {
    if (lbScale <= 1) return;
    lbDragging = true;
    lbDragStart = { x: e.clientX - lbLastTranslate.x, y: e.clientY - lbLastTranslate.y };
    img.style.cursor = 'grabbing';
    e.preventDefault();
  });
  document.addEventListener('mousemove', e => {
    if (!lbDragging) return;
    lbTranslate = { x: e.clientX - lbDragStart.x, y: e.clientY - lbDragStart.y };
    applyLbTransform(container);
  });
  document.addEventListener('mouseup', () => {
    if (!lbDragging) return;
    lbDragging = false;
    lbLastTranslate = { ...lbTranslate };
    img.style.cursor = lbScale > 1 ? 'grab' : 'default';
  });

  // Touch: pinch-to-zoom + single-finger pan
  let lastTouchDist = 0;
  let lastTouchMid = { x: 0, y: 0 };
  let touchPanStart = { x: 0, y: 0 };
  let touchPanning = false;

  img.addEventListener('touchstart', e => {
    if (e.touches.length === 2) {
      touchPanning = false;
      lastTouchDist = Math.hypot(
        e.touches[0].clientX - e.touches[1].clientX,
        e.touches[0].clientY - e.touches[1].clientY
      );
      lastTouchMid = {
        x: (e.touches[0].clientX + e.touches[1].clientX) / 2,
        y: (e.touches[0].clientY + e.touches[1].clientY) / 2
      };
    } else if (e.touches.length === 1 && lbScale > 1) {
      touchPanning = true;
      touchPanStart = {
        x: e.touches[0].clientX - lbLastTranslate.x,
        y: e.touches[0].clientY - lbLastTranslate.y
      };
    }
  }, { passive: true });

  img.addEventListener('touchmove', e => {
    e.preventDefault();
    if (e.touches.length === 2) {
      touchPanning = false;
      const dist = Math.hypot(
        e.touches[0].clientX - e.touches[1].clientX,
        e.touches[0].clientY - e.touches[1].clientY
      );
      if (lastTouchDist) setLbScale(container, lbScale * (dist / lastTouchDist));
      lastTouchDist = dist;
    } else if (e.touches.length === 1 && touchPanning && lbScale > 1) {
      lbTranslate = {
        x: e.touches[0].clientX - touchPanStart.x,
        y: e.touches[0].clientY - touchPanStart.y
      };
      applyLbTransform(container);
    }
  }, { passive: false });

  img.addEventListener('touchend', e => {
    if (e.touches.length === 0 && touchPanning) {
      lbLastTranslate = { ...lbTranslate };
      touchPanning = false;
    }
    if (e.touches.length < 2) lastTouchDist = 0;
  }, { passive: true });
}

function setLbScale(container, scale) {
  lbScale = Math.min(Math.max(scale, 0.5), 5);
  if (lbScale <= 1) { lbTranslate = { x: 0, y: 0 }; lbLastTranslate = { x: 0, y: 0 }; }
  const img = container.querySelector('#gal-lightbox-img');
  if (img) img.style.cursor = lbScale > 1 ? 'grab' : 'default';
  const btn = container.querySelector('#gal-lb-reset');
  if (btn) btn.textContent = Math.round(lbScale * 100) + '%';
  applyLbTransform(container);
}

function applyLbTransform(container) {
  const img = container.querySelector('#gal-lightbox-img');
  if (img) img.style.transform = `scale(${lbScale}) translate(${lbTranslate.x / lbScale}px, ${lbTranslate.y / lbScale}px)`;
}

function resetLbTransform(container) {
  lbScale = 1; lbTranslate = { x: 0, y: 0 }; lbLastTranslate = { x: 0, y: 0 };
  applyLbTransform(container);
  const btn = container.querySelector('#gal-lb-reset');
  if (btn) btn.textContent = '100%';
  const img = container.querySelector('#gal-lightbox-img');
  if (img) img.style.cursor = 'default';
}

async function fetchAll() {
  setSyncStatus('syncing');
  try {
    const { data, error } = await supaClient.from(TABLE).select('*');
    if (error) throw error;
    items = data.map(r => ({
      id: r.id, title: r.title || '', description: r.description || '',
      author: r.author || '', tags: JSON.parse(r.tags_json || '[]'),
      imageUrl: r.image_url, storagePath: r.storage_path, createdAt: r.created_at,
    }));
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
    : new Date(b.createdAt) - new Date(a.createdAt));
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
          <button class="lib-tag-action-btn lib-tag-edit" data-tag="${escHtml(tag)}" title="重命名">✏️</button>
          <button class="lib-tag-action-btn lib-tag-delete" data-tag="${escHtml(tag)}" title="删除">🗑️</button>
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
    el.querySelector('.lib-tag-edit')?.addEventListener('click', e => { e.stopPropagation(); renameTag(el.dataset.tag, tagListEl); });
    el.querySelector('.lib-tag-delete')?.addEventListener('click', e => { e.stopPropagation(); deleteTag(el.dataset.tag, tagListEl); });
  });
}

function renderGrid(container) {
  const grid = container.querySelector('#gal-grid');
  if (!grid) return;
  sortItems();

  let filtered = [...items];
  if (searchKeyword) filtered = filtered.filter(item =>
    item.title.toLowerCase().includes(searchKeyword) || item.description.toLowerCase().includes(searchKeyword));
  if (selectedAuthor) filtered = filtered.filter(item =>
    item.author.toLowerCase().includes(selectedAuthor.toLowerCase()));
  if (selectedTags.length) filtered = filtered.filter(item =>
    selectedTags.every(t => item.tags.includes(t)));

  if (!filtered.length) {
    grid.innerHTML = `<div style="color:#556;font-size:14px;grid-column:1/-1;padding:40px;text-align:center">暂无图片</div>`;
    return;
  }

  const editor = isEditor();
  grid.innerHTML = filtered.map(item => {
    const tagsHtml = item.tags.map(t => `<span class="lib-item-tag">${escHtml(t)}</span>`).join('');
    const titleHtml = item.title ? `<div class="gal-item-title">${escHtml(item.title)}</div>` : '';
    const editOverlay = editor
      ? `<div class="gal-edit-overlay"><span>✏️ 编辑</span></div>` : '';
    return `<div class="gal-item" data-id="${item.id}">
      <div class="gal-item-img-wrap">
        <img class="gal-item-img" src="${escHtml(item.imageUrl)}" loading="lazy" alt="${escHtml(item.title || '')}"/>
        ${editOverlay}
      </div>
      ${titleHtml}
      ${tagsHtml ? `<div class="lib-item-tags" style="padding:0 8px 6px">${tagsHtml}</div>` : ''}
    </div>`;
  }).join('');

  grid.querySelectorAll('.gal-item').forEach(el => {
    el.addEventListener('click', () => {
      const item = items.find(i => i.id == el.dataset.id);
      if (!item) return;
      if (isEditor()) openModal(item, container);
      else openLightbox(item, container);
    });
  });
}

function openLightbox(item, container) {
  resetLbTransform(container);
  container.querySelector('#gal-lightbox-img').src = item.imageUrl;
  const info = [];
  if (item.title) info.push(`<b>${escHtml(item.title)}</b>`);
  if (item.description) info.push(escHtml(item.description));
  container.querySelector('#gal-lightbox-info').innerHTML = info.join('<br>');
  container.querySelector('#gal-lightbox').classList.add('show');
}

function closeLightbox(container) {
  container.querySelector('#gal-lightbox').classList.remove('show');
  resetLbTransform(container);
}

function openModal(item, container) {
  editItemId = item ? item.id : null;
  const isEdit = !!item;
  container.querySelector('#gal-modal-title').textContent = isEdit ? '编辑图片' : '新建';
  container.querySelector('#gal-title').value = item?.title || '';
  container.querySelector('#gal-desc').value = item?.description || '';
  container.querySelector('#gal-author').value = item?.author || '';

  const uploadMode = container.querySelector('#gal-upload-mode');
  if (uploadMode) uploadMode.style.display = isEdit ? 'none' : '';
  if (!isEdit) switchUploadMode(container, 'file');

  const delBtn = container.querySelector('#gal-delete-btn');
  if (delBtn) delBtn.style.display = isEdit ? '' : 'none';

  const previewWrap = container.querySelector('#gal-preview-wrap');
  const previewImg = container.querySelector('#gal-preview-img');
  if (item) {
    previewImg.src = item.imageUrl;
    previewWrap.style.display = '';
  } else {
    previewImg.src = ''; previewWrap.style.display = 'none';
    container.querySelector('#gal-file-input').value = '';
    const li = container.querySelector('#gal-link-input');
    if (li) li.value = '';
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
  const fw = container.querySelector('#gal-file-wrap');
  const lw = container.querySelector('#gal-link-wrap');
  const bf = container.querySelector('#gal-mode-file');
  const bl = container.querySelector('#gal-mode-link');
  if (mode === 'file') {
    fw.style.display = ''; lw.style.display = 'none';
    bf.className = 'btn bp'; bl.className = 'btn bn';
  } else {
    fw.style.display = 'none'; lw.style.display = '';
    bf.className = 'btn bn'; bl.className = 'btn bp';
  }
}

function renderTagPicker(container, selectedItemTags) {
  const picker = container.querySelector('#gal-tag-picker');
  picker.innerHTML = tags.map(tag => `
    <label style="display:inline-flex;align-items:center;gap:4px;margin:0 6px 6px 0;cursor:pointer;font-size:13px">
      <input type="checkbox" value="${escHtml(tag)}" ${selectedItemTags.includes(tag) ? 'checked' : ''}/>
      ${escHtml(tag)}
    </label>`).join('');
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
  const selectedItemTags = Array.from(container.querySelectorAll('#gal-tag-picker input[type="checkbox"]:checked')).map(cb => cb.value);
  const savingId = editItemId;
  closeModal(container);
  setSyncStatus('syncing');
  try {
    if (savingId) {
      const { error } = await supaClient.from(TABLE).update({
        title, description, author: author || 'unknown', tags_json: JSON.stringify(selectedItemTags),
      }).eq('id', savingId);
      if (error) throw error;
      showToast('已更新');
    } else {
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
        const { error: upErr } = await supaClient.storage.from(BUCKET).upload(storagePath, file, { cacheControl: '3600', upsert: false });
        if (upErr) throw upErr;
        const { data: urlData } = supaClient.storage.from(BUCKET).getPublicUrl(storagePath);
        imageUrl = urlData.publicUrl;
      }
      const { error } = await supaClient.from(TABLE).insert({
        title, description, author: author || 'unknown',
        tags_json: JSON.stringify(selectedItemTags), image_url: imageUrl, storage_path: storagePath,
      });
      if (error) throw error;
      showToast(mode === 'link' ? '已添加' : '已上传');
    }
    await fetchAll();
    setSyncStatus('ok');
  } catch(e) { dbError('保存图片', e); }
}

async function deleteFromModal(container) {
  const id = editItemId;
  const item = items.find(i => i.id == id);
  if (!item) return;
  closeModal(container);
  await deleteItem(id, item.storagePath, container);
}

async function deleteItem(id, storagePath, container) {
  const ok = await confirmDialog('确认删除这张图片？此操作不可撤销。');
  if (!ok) return;
  setSyncStatus('syncing');
  try {
    if (storagePath) await supaClient.storage.from(BUCKET).remove([storagePath]);
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
    for (const item of items.filter(i => i.tags.includes(oldTag)))
      await supaClient.from(TABLE).update({ tags_json: JSON.stringify(item.tags.map(t => t === oldTag ? newTag : t)) }).eq('id', item.id);
    await fetchAll();
    setSyncStatus('ok');
  } catch(e) { dbError('重命名标签', e); }
}

async function deleteTag(tag, tagListEl) {
  const ok = await confirmDialog(`确认删除标签 "${tag}"？将从所有图片中移除。`);
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

function updateSortButton(container) {
  const btn = container.querySelector('#gal-sort-btn');
  if (!btn) return;
  btn.textContent = sortBy === 'asc' ? '🕐 旧→新' : '🕐 新→旧';
}

function updateGalleryUI(container) {
  const addBtn = container.querySelector('#gal-add-btn');
  if (addBtn) addBtn.style.display = isEditor() ? '' : 'none';
  renderTagList(container.querySelector('#gal-tag-list'));
  renderGrid(container);
}
