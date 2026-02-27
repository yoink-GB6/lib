// pages/library.js
// 指令集页面：支持标签筛选和权限管理

import { supaClient, setSyncStatus, dbError } from './supabase-client.js';
import { isEditor, onAuthChange } from './auth.js';
import { showToast, escHtml, confirmDialog } from './ui.js';

let items = [];           // All library items
let tags = [];            // All available tags
let selectedTags = [];    // Currently selected tags for filtering
let searchKeyword = '';   // Search keyword for content filtering
let selectedAuthor = '';  // Selected author for exact match filtering
let sortBy = 'likes';         // Sorting method: 'likes' or 'created'
let editItemId = null;
let realtimeCh = null;
let pageContainer = null; // Store container reference for use in event handlers
let likedItems = new Set(); // Track liked items in current session (resets on page refresh)
let unlockedKeys = new Set(); // Track unlocked privacy keys (resets on page refresh)

// Library-specific edit mode (independent from global edit mode)
let isLibraryEditable = false;
const LIBRARY_PASSWORD = 'y';  // Simple password for library editing

export async function mount(container) {
  pageContainer = container;  // Save container reference
  container.innerHTML = buildHTML();
  bindControls(container);
  
  // Listen to global auth changes
  onAuthChange(() => updateLibraryUI(container));
  
  updateSortButton(container);      // Initialize sort button
  updateLibraryUI(container);       // Initialize library-specific edit UI
  updateUnlockedKeysDisplay(container);  // Initialize privacy status
  await fetchAll();
  subscribeRealtime();
}

export function unmount() {
  realtimeCh && supaClient.removeChannel(realtimeCh);
  
  // Security: Clear decrypted content cache on unmount
  items.forEach(item => {
    if (item.privacyLevel === 'private') {
      delete item.decryptedContent;
    }
  });
  unlockedKeys.clear();
}

function buildHTML() {
  return `
<div class="lib-layout">
  <!-- Main content area -->
  <div class="lib-main">
    <div class="lib-header">
      <h2>📋 指令集</h2>
      <div style="display:flex;gap:8px;align-items:center">
        <button class="btn bn" id="lib-sort-btn" title="切换排序方式">👍 点赞排序</button>
        <button class="btn bn" id="lib-unlock-btn">🔒 解锁指令编辑</button>
        <button class="btn bp" id="lib-add-btn" style="display:none">＋ 新建</button>
      </div>
    </div>
    <div class="lib-grid" id="lib-grid"></div>
  </div>

  <!-- Floating expand button (shows when panel collapsed) -->
  <button id="lib-expand" class="expand-btn-float" title="展开筛选">◀</button>

  <!-- Right sidebar filter panel -->
  <div class="lib-panel">
    <div class="lib-panel-hdr" id="lib-panel-toggle">
      <span>🔍 搜索 & 筛选</span>
      <span id="lib-panel-chevron">◀</span>
    </div>
    <div class="lib-panel-body">
      <!-- Privacy unlock -->
      <div style="margin-bottom:16px">
        <div style="font-size:12px;color:#889;margin-bottom:8px">🔒 隐私内容解锁</div>
        <div style="display:flex;gap:8px">
          <input 
            id="lib-privacy-input"
            type="password"
            placeholder="输入密码解锁..."
            autocomplete="off"
            style="flex:1;padding:8px 12px;border:1px solid var(--border);border-radius:6px;background:var(--bg);color:var(--text);font-size:13px"
          />
          <button class="btn bp" id="lib-privacy-unlock" style="padding:8px 16px">解锁</button>
        </div>
        <div id="lib-unlocked-keys" style="margin-top:8px;font-size:12px;color:#889"></div>
      </div>
      
      <!-- Search box -->
      <div style="margin-bottom:16px">
        <input 
          id="lib-search-input" 
          type="text" 
          placeholder="搜索指令内容..." 
          autocomplete="off"
          style="width:100%;padding:8px 12px;border:1px solid var(--border);border-radius:6px;background:var(--bg);color:var(--text);font-size:13px"
        />
      </div>
      
      <!-- Author filter -->
      <div style="margin-bottom:16px;position:relative">
        <input 
          id="lib-author-input"
          type="text"
          placeholder="输入作者名筛选..."
          autocomplete="off"
          style="width:100%;padding:8px 12px;border:1px solid var(--border);border-radius:6px;background:var(--bg);color:var(--text);font-size:13px"
        />
        <div id="lib-author-suggestions" class="lib-author-suggestions"></div>
        <button 
          id="lib-author-clear" 
          style="position:absolute;right:8px;top:50%;transform:translateY(-50%);background:none;border:none;color:#889;cursor:pointer;font-size:16px;padding:4px;display:none"
          title="清除作者筛选"
        >✕</button>
      </div>
      
      <!-- Tag filter hint -->
      <div style="font-size:12px;color:#889;margin-bottom:12px;line-height:1.6">
        点击标签进行筛选。选中多个标签时，显示<b>同时包含</b>所有选中标签的指令。
      </div>
      <div id="lib-tag-list" class="lib-tag-list"></div>
    </div>
  </div>
</div>

<!-- Edit modal -->
<div id="lib-modal" class="tl-modal-overlay">
  <div class="tl-modal" style="max-width:600px" onmousedown="event.stopPropagation()">
    <h2 id="lib-modal-title">新建指令</h2>
    
    <label>内容</label>
    <textarea id="lib-content" rows="8" placeholder="输入指令内容..." style="margin-bottom:12px;font-family:inherit"></textarea>
    
    <label>作者</label>
    <input id="lib-author" type="text" placeholder="作者名字（可选）" autocomplete="off" style="margin-bottom:12px"/>
    
    <label>标签</label>
    <div id="lib-tag-picker" class="lib-tag-picker"></div>
    <div style="display:flex;gap:8px;margin-top:8px;margin-bottom:12px">
      <input id="lib-new-tag" type="text" placeholder="新增标签" autocomplete="off" style="flex:1"/>
      <button class="btn bn" id="lib-add-tag-btn">添加</button>
    </div>

    <label style="margin-top:12px;display:flex;align-items:center;gap:8px;cursor:pointer">
      <input type="checkbox" id="lib-private-checkbox" style="cursor:pointer"/>
      <span>🔒 设为隐私指令（仅输入密码后可见）</span>
    </label>
    
    <div id="lib-privacy-key-group" style="margin-top:8px;display:none">
      <label>隐私密码</label>
      <input 
        id="lib-privacy-key" 
        type="text" 
        placeholder="设置解锁密码（支持不同密码）" 
        autocomplete="off"
        style="margin-bottom:8px"
      />
      <div style="font-size:12px;color:#889">
        提示：可以为不同的隐私指令设置不同的密码，只有知道密码的人才能看到
      </div>
    </div>

    <div class="mbtns" style="justify-content:flex-end;margin-top:12px">
      <button class="btn bn" id="lib-modal-cancel">取消</button>
      <button class="btn bp" id="lib-modal-save">保存</button>
    </div>
    <div class="mbtns" style="justify-content:center;margin-top:10px;padding-top:10px;border-top:1px solid var(--border)">
      <button class="btn br" id="lib-modal-delete" style="min-width:120px;display:none">🗑 删除</button>
    </div>
  </div>
</div>

<!-- Read-only preview modal -->
<div id="lib-preview-modal" class="tl-modal-overlay">
  <div class="tl-modal" style="max-width:600px" onmousedown="event.stopPropagation()">
    <h2>📋 查看指令</h2>
    
    <div style="background:var(--bg);border-radius:8px;padding:14px;margin-bottom:12px;max-height:400px;overflow-y:auto">
      <div id="lib-preview-content" style="white-space:pre-wrap;word-break:break-word;line-height:1.7;font-size:14px"></div>
    </div>
    
    <div id="lib-preview-meta" style="margin-bottom:12px;font-size:13px;color:#889"></div>
    
    <div class="mbtns" style="justify-content:space-between">
      <button class="btn bn" id="lib-preview-close">关闭</button>
      <button class="btn bp" id="lib-preview-copy">📋 复制内容</button>
    </div>
  </div>
</div>

<!-- Password unlock modal (library-specific) -->
<div id="lib-password-modal" class="tl-modal-overlay">
  <div class="tl-modal" style="max-width:400px" onmousedown="event.stopPropagation()">
    <h2>🔓 解锁指令编辑</h2>
    <p style="color:#889;font-size:13px;margin-bottom:16px">裴公主今天发骚了吗？(y/n)</p>
    
    <input 
      id="lib-password-input" 
      type="password" 
      placeholder="输入密码" 
      autocomplete="off"
      style="width:100%;padding:10px 12px;margin-bottom:8px;border:1px solid var(--border);border-radius:6px;background:var(--bg);color:var(--text);font-size:14px"
    />
    <div id="lib-password-error" style="color:#ef4444;font-size:12px;margin-bottom:12px;display:none">
      密码错误，请重试
    </div>
    
    <div class="mbtns" style="justify-content:flex-end">
      <button class="btn bn" id="lib-password-cancel">取消</button>
      <button class="btn bp" id="lib-password-submit">确定</button>
    </div>
  </div>
</div>`;
}

function bindControls(container) {
  // Add button
  container.querySelector('#lib-add-btn').addEventListener('click', () => openModal(null, container));
  
  // Modal buttons
  container.querySelector('#lib-modal-cancel').addEventListener('click', () => closeModal(container));
  container.querySelector('#lib-modal-save').addEventListener('click', () => saveItem(container));
  container.querySelector('#lib-modal-delete').addEventListener('click', () => deleteItem(container));
  container.querySelector('#lib-modal').addEventListener('mousedown', e => {
    if (e.target === container.querySelector('#lib-modal')) closeModal(container);
  });
  
  // Preview modal buttons
  container.querySelector('#lib-preview-close').addEventListener('click', () => closePreviewModal(container));
  container.querySelector('#lib-preview-copy').addEventListener('click', () => copyFromPreview(container));
  container.querySelector('#lib-preview-modal').addEventListener('mousedown', e => {
    if (e.target === container.querySelector('#lib-preview-modal')) closePreviewModal(container);
  });
  
  // Add tag button
  container.querySelector('#lib-add-tag-btn').addEventListener('click', () => addNewTag(container));
  container.querySelector('#lib-new-tag').addEventListener('keydown', e => {
    if (e.key === 'Enter') addNewTag(container);
  });
  
  // Privacy checkbox toggle
  container.querySelector('#lib-private-checkbox').addEventListener('change', e => {
    const keyGroup = container.querySelector('#lib-privacy-key-group');
    keyGroup.style.display = e.target.checked ? '' : 'none';
    if (e.target.checked) {
      setTimeout(() => container.querySelector('#lib-privacy-key').focus(), 100);
    }
  });

  // Privacy unlock
  const privacyInput = container.querySelector('#lib-privacy-input');
  const privacyUnlockBtn = container.querySelector('#lib-privacy-unlock');
  
  privacyUnlockBtn.addEventListener('click', () => unlockPrivateContent(container));
  privacyInput.addEventListener('keydown', e => {
    if (e.key === 'Enter') unlockPrivateContent(container);
  });

  // Search input
  container.querySelector('#lib-search-input').addEventListener('input', e => {
    searchKeyword = e.target.value.trim();
    renderGrid(container.querySelector('.lib-layout'));
  });

  // Author input with autocomplete
  const authorInput = container.querySelector('#lib-author-input');
  const authorSuggestions = container.querySelector('#lib-author-suggestions');
  const authorClearBtn = container.querySelector('#lib-author-clear');
  
  let allAuthors = [];  // Store all authors for filtering
  
  authorInput.addEventListener('input', e => {
    const inputValue = e.target.value.trim();
    
    if (!inputValue) {
      // Clear filter if input is empty
      selectedAuthor = '';
      authorSuggestions.innerHTML = '';
      authorSuggestions.style.display = 'none';
      authorClearBtn.style.display = 'none';
      renderGrid(container.querySelector('.lib-layout'));
      return;
    }
    
    // Filter authors by input (case-insensitive substring match)
    const matches = allAuthors.filter(author => 
      author.toLowerCase().includes(inputValue.toLowerCase())
    );
    
    if (matches.length > 0) {
      // Show suggestions
      authorSuggestions.innerHTML = matches.map(author => {
        const count = items.filter(item => item.author === author).length;
        return `<div class="lib-author-suggestion" data-author="${escHtml(author)}">
          ${escHtml(author)} <span style="color:#889">(${count})</span>
        </div>`;
      }).join('');
      authorSuggestions.style.display = 'block';
    } else {
      authorSuggestions.innerHTML = '<div style="padding:8px;color:#889;font-size:12px">无匹配作者</div>';
      authorSuggestions.style.display = 'block';
    }
  });
  
  // Click on suggestion
  container.addEventListener('click', e => {
    const suggestion = e.target.closest('.lib-author-suggestion');
    if (suggestion) {
      const author = suggestion.dataset.author;
      selectedAuthor = author;
      authorInput.value = author;
      authorSuggestions.innerHTML = '';
      authorSuggestions.style.display = 'none';
      authorClearBtn.style.display = '';
      renderGrid(container.querySelector('.lib-layout'));
    }
  });
  
  // Clear button
  authorClearBtn.addEventListener('click', () => {
    selectedAuthor = '';
    authorInput.value = '';
    authorSuggestions.innerHTML = '';
    authorSuggestions.style.display = 'none';
    authorClearBtn.style.display = 'none';
    authorInput.focus();
    renderGrid(container.querySelector('.lib-layout'));
  });
  
  // Hide suggestions when clicking outside
  document.addEventListener('click', e => {
    if (!container.contains(e.target)) {
      authorSuggestions.style.display = 'none';
    }
  });
  
  // Store allAuthors reference for use in input handler
  container._setAuthors = (authors) => {
    allAuthors = authors;
  };

  // Sort button
  container.querySelector('#lib-sort-btn').addEventListener('click', () => {
    sortBy = sortBy === 'likes' ? 'created' : 'likes';
    updateSortButton(container);
    renderGrid(container.querySelector('.lib-layout'));
  });

  // Unlock button
  container.querySelector('#lib-unlock-btn').addEventListener('click', () => {
    if (isLibraryEditable) {
      // Lock
      isLibraryEditable = false;
      updateLibraryUI(container);
      showToast('🔒 已锁定指令编辑');
    } else {
      // Show password modal
      openPasswordModal(container);
    }
  });

  // Password modal
  container.querySelector('#lib-password-cancel').addEventListener('click', () => closePasswordModal(container));
  container.querySelector('#lib-password-submit').addEventListener('click', () => submitPassword(container));
  container.querySelector('#lib-password-input').addEventListener('keydown', e => {
    if (e.key === 'Enter') submitPassword(container);
    if (e.key === 'Escape') closePasswordModal(container);
  });
  container.querySelector('#lib-password-modal').addEventListener('mousedown', e => {
    if (e.target === container.querySelector('#lib-password-modal')) closePasswordModal(container);
  });

  // Sort buttons
  // Panel toggle
  function toggleLibPanel() {
    const panel = container.querySelector('.lib-panel');
    const chevron = container.querySelector('#lib-panel-chevron');
    const expandBtn = container.querySelector('#lib-expand');
    const collapsed = panel.classList.toggle('collapsed');
    chevron.textContent = collapsed ? '▶' : '◀';
    if (expandBtn) expandBtn.classList.toggle('show', collapsed);
  }
  container.querySelector('#lib-panel-toggle')?.addEventListener('click', toggleLibPanel);
  container.querySelector('#lib-expand')?.addEventListener('click', toggleLibPanel);
}

async function fetchAll() {
  setSyncStatus('syncing');
  try {
    const { data, error } = await supaClient.from('general_library_items').select('*');
    if (error) {
      console.error('Database query error:', error);
      throw error;
    }
    
    console.log('Fetched items:', data?.length || 0);
    
    items = (data || []).map(r => {
      // Backward compatible: handle missing privacy fields
      const privacyLevel = r.privacy_level !== undefined ? r.privacy_level : 'public';
      const privacyKey = r.privacy_key !== undefined ? r.privacy_key : null;
      
      return {
        id: r.id,
        content: r.content || '',
        author: r.author || '',
        tags: r.tags_json ? JSON.parse(r.tags_json) : [],
        likes: r.likes || 0,
        createdAt: r.created_at,
        updatedAt: r.updated_at,
        privacyLevel: privacyLevel,
        privacyKey: privacyKey
      };
    });
    
    // Sort items based on current sortBy method
    sortItems();
    
    // Extract all unique tags
    const tagSet = new Set();
    items.forEach(item => item.tags.forEach(tag => tagSet.add(tag)));
    tags = Array.from(tagSet).sort();
    
    // Extract all unique authors (non-empty only)
    const authorSet = new Set();
    items.forEach(item => {
      if (item.author && item.author.trim()) {
        authorSet.add(item.author.trim());
      }
    });
    const authors = Array.from(authorSet).sort();
    
    updateAuthorList(authors);
    renderTagList(document.querySelector('#lib-tag-list'));
    renderGrid(document.querySelector('.lib-layout'));
    setSyncStatus('ok');
  } catch(e) { dbError('加载指令集', e); }
}

function sortItems() {
  if (sortBy === 'likes') {
    // Sort by likes descending, then by created_at descending
    items.sort((a, b) => {
      if (b.likes !== a.likes) {
        return b.likes - a.likes;
      }
      return new Date(b.createdAt) - new Date(a.createdAt);
    });
  } else if (sortBy === 'created') {
    // Sort by created_at descending (newest first)
    items.sort((a, b) => {
      return new Date(b.createdAt) - new Date(a.createdAt);
    });
  }
}

function updateAuthorList(authors) {
  // Store authors list for autocomplete filtering
  if (pageContainer && pageContainer._setAuthors) {
    pageContainer._setAuthors(authors);
  }
}

function renderTagList(tagListEl) {
  // Clean up selected tags that no longer exist
  selectedTags = selectedTags.filter(tag => tags.includes(tag));
  
  if (!tags.length) {
    tagListEl.innerHTML = '<div style="color:var(--muted);font-size:12px;padding:8px 0">暂无标签</div>';
    return;
  }
  
  const editable = isLibraryEditor();
  
  tagListEl.innerHTML = tags.map(tag => {
    const selected = selectedTags.includes(tag);
    const count = items.filter(item => item.tags.includes(tag)).length;
    
    // Edit/delete buttons (only visible in edit mode)
    const actionBtns = editable 
      ? `<div class="lib-tag-actions">
          <button class="lib-tag-action-btn lib-tag-edit" data-tag="${escHtml(tag)}" title="重命名">✏️</button>
          <button class="lib-tag-action-btn lib-tag-delete" data-tag="${escHtml(tag)}" title="删除">🗑️</button>
         </div>`
      : '';
    
    return `<div class="lib-tag-filter ${selected ? 'selected' : ''}" data-tag="${escHtml(tag)}">
      <div class="lib-tag-main">
        <span class="lib-tag-name">${escHtml(tag)}</span>
        <span class="lib-tag-count">(${count})</span>
      </div>
      ${actionBtns}
    </div>`;
  }).join('');
  
  // Bind click events for tag selection
  tagListEl.querySelectorAll('.lib-tag-filter').forEach(el => {
    // Tag selection (click on main area, not buttons)
    const mainArea = el.querySelector('.lib-tag-main');
    mainArea.addEventListener('click', (e) => {
      e.stopPropagation();
      const tag = el.dataset.tag;
      if (selectedTags.includes(tag)) {
        selectedTags = selectedTags.filter(t => t !== tag);
      } else {
        selectedTags.push(tag);
      }
      renderTagList(tagListEl);
      renderGrid(document.querySelector('.lib-layout'));
    });
    
    // Edit button
    const editBtn = el.querySelector('.lib-tag-edit');
    if (editBtn) {
      editBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        const oldTag = el.dataset.tag;
        renameTag(oldTag, tagListEl);
      });
    }
    
    // Delete button
    const deleteBtn = el.querySelector('.lib-tag-delete');
    if (deleteBtn) {
      deleteBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        const tag = el.dataset.tag;
        deleteTag(tag, tagListEl);
      });
    }
  });
}

  

function renderGrid(container) {
  const grid = container.querySelector('#lib-grid');
  
  // Step 0: Filter by privacy (only show public + unlocked private items)
  let filtered = items.filter(item => {
    // Treat undefined/null as public (for backward compatibility)
    if (!item.privacyLevel || item.privacyLevel === 'public') return true;
    if (item.privacyLevel === 'private') {
      // Check if any unlocked key matches this item
      return item.decryptedContent !== undefined;
    }
    return false;
  });
  
  // Step 1: Filter by search keyword (content only, case-insensitive)
  if (searchKeyword) {
    const keyword = searchKeyword.toLowerCase();
    filtered = filtered.filter(item => {
      return item.content.toLowerCase().includes(keyword);
    });
  }
  
  // Step 2: Filter by author (exact match)
  if (selectedAuthor) {
    filtered = filtered.filter(item => {
      return item.author === selectedAuthor;
    });
  }
  
  // Step 3: Filter by selected tags (intersection)
  if (selectedTags.length > 0) {
    filtered = filtered.filter(item => {
      return selectedTags.every(tag => item.tags.includes(tag));
    });
  }
  
  if (!filtered.length) {
    let msg = '暂无内容';
    
    // Build filter description
    const filters = [];
    if (searchKeyword) filters.push(`包含「${escHtml(searchKeyword)}」`);
    if (selectedAuthor) filters.push(`作者为「${escHtml(selectedAuthor)}」`);
    if (selectedTags.length > 0) filters.push(`同时有所选标签`);
    
    if (filters.length > 0) {
      msg = `没有${filters.join('且')}的指令`;
    }
    
    grid.innerHTML = `<div class="lib-empty">${msg}</div>`;
    return;
  }
  
  // Step 4: Sort filtered items
  if (sortBy === 'likes') {
    filtered.sort((a, b) => {
      if (b.likes !== a.likes) {
        return b.likes - a.likes;
      }
      return new Date(b.createdAt) - new Date(a.createdAt);
    });
  } else if (sortBy === 'created') {
    filtered.sort((a, b) => {
      return new Date(b.createdAt) - new Date(a.createdAt);
    });
  }
  
  grid.innerHTML = filtered.map(item => {
    // Use decrypted content if available (for private items)
    const displayContent = item.decryptedContent || item.content;
    const preview = displayContent.length > 150 ? displayContent.slice(0, 150) + '...' : displayContent;
    const tagsHtml = item.tags.map(tag => `<span class="lib-item-tag">${escHtml(tag)}</span>`).join('');
    const authorHtml = item.author ? `<div class="lib-item-author">by ${escHtml(item.author)}</div>` : '';
    const likes = item.likes || 0;
    const isLiked = likedItems.has(item.id);
    const likedClass = isLiked ? 'liked' : '';
    const likeIcon = isLiked ? '❤️' : '👍';
    const likeTitle = isLiked ? '取消点赞' : '点赞';
    
    return `<div class="lib-item" data-id="${item.id}">
      <div class="lib-item-content">${escHtml(preview)}</div>
      ${tagsHtml ? `<div class="lib-item-tags">${tagsHtml}</div>` : ''}
      <div class="lib-item-footer">
        ${authorHtml}
        <div class="lib-item-like ${likedClass}" data-id="${item.id}" title="${likeTitle}">
          <span class="lib-like-btn">${likeIcon}</span>
          <span class="lib-like-count">${likes}</span>
        </div>
      </div>
    </div>`;
  }).join('');
  
  grid.querySelectorAll('.lib-item').forEach(card => {
    let pressTimer = null;
    let pressStart = 0;
    let startX = 0;
    let startY = 0;
    let hasMoved = false;
    let hasTriggered = false;  // Prevent double-trigger on mobile
    
    const startPress = (e) => {
      pressStart = Date.now();
      hasMoved = false;
      hasTriggered = false;  // Reset flag
      
      // Record initial position
      if (e.touches) {
        startX = e.touches[0].clientX;
        startY = e.touches[0].clientY;
      } else {
        startX = e.clientX;
        startY = e.clientY;
      }
      
      pressTimer = setTimeout(() => {
        // Long press triggered (only if not moved)
        if (!hasMoved) {
          const id = parseInt(card.dataset.id);
          const item = items.find(x => x.id === id);
          if (item && !isLibraryEditor()) {
            openPreviewModal(item);
            hasTriggered = true;  // Mark as triggered
          }
        }
      }, 500);
    };
    
    const checkMovement = (e) => {
      if (hasMoved) return;
      
      let currentX, currentY;
      if (e.touches) {
        currentX = e.touches[0].clientX;
        currentY = e.touches[0].clientY;
      } else {
        currentX = e.clientX;
        currentY = e.clientY;
      }
      
      const deltaX = Math.abs(currentX - startX);
      const deltaY = Math.abs(currentY - startY);
      
      // Only consider vertical scrolling (deltaY) to detect page scroll
      // Increased threshold to 20px to allow small finger movement
      if (deltaY > 20) {
        hasMoved = true;
        cancelPress();
      }
    };
    
    const cancelPress = () => {
      if (pressTimer) {
        clearTimeout(pressTimer);
        pressTimer = null;
      }
    };
    
    const handleInteraction = (e) => {
      // Set flag FIRST to prevent any race condition
      if (hasTriggered) {
        console.log('[lib-item] BLOCKED double-trigger, eventType:', e.type);
        return;
      }
      hasTriggered = true;  // Set immediately
      
      cancelPress();
      
      // If moved, don't trigger any action
      if (hasMoved) {
        return;
      }
      
      const pressDuration = Date.now() - pressStart;
      if (pressDuration >= 500) {
        // Was a long press, don't trigger click action
        e.preventDefault();
        return;
      }
      
      // Short click (and didn't move)
      const id = parseInt(card.dataset.id);
      const item = items.find(x => x.id === id);
      if (!item) return;
      
      console.log('[lib-item] eventType:', e.type, 'hasTriggered:', hasTriggered, 'pressDuration:', pressDuration);
      
      if (isLibraryEditor()) {
        openModal(item, pageContainer);
      } else {
        // Quick click: copy to clipboard (use decrypted content if available)
        const contentToCopy = item.decryptedContent || item.content;
        navigator.clipboard.writeText(contentToCopy).then(() => {
          showToast('已复制到剪贴板');
        }).catch(() => {
          showToast('复制失败，请手动复制');
        });
      }
    };
    
    // Mouse events (desktop)
    card.addEventListener('mousedown', startPress);
    card.addEventListener('mousemove', checkMovement);
    card.addEventListener('mouseup', handleInteraction);
    card.addEventListener('mouseleave', cancelPress);
    
    // Touch events (mobile)
    // Don't use passive:true on touchstart/touchend so we can preventDefault
    card.addEventListener('touchstart', (e) => {
      startPress(e);
    });
    card.addEventListener('touchmove', checkMovement, { passive: true });  // Can be passive
    card.addEventListener('touchend', (e) => {
      e.preventDefault();  // Prevent synthetic click event
      handleInteraction(e);
    });
    card.addEventListener('touchcancel', cancelPress);
  });
  
  // Bind like areas (prevent event bubbling to card)
  grid.querySelectorAll('.lib-item-like').forEach(likeArea => {
    const handleLike = async (e) => {
      e.stopPropagation();
      e.preventDefault();
      const id = parseInt(likeArea.dataset.id);
      await likeItem(id);
    };
    
    // Desktop
    likeArea.addEventListener('mousedown', (e) => e.stopPropagation());
    likeArea.addEventListener('mousemove', (e) => e.stopPropagation());
    likeArea.addEventListener('click', handleLike);
    
    // Mobile - use touchend instead of click for better response
    likeArea.addEventListener('touchstart', (e) => {
      e.stopPropagation();
    });
    likeArea.addEventListener('touchmove', (e) => e.stopPropagation());
    likeArea.addEventListener('touchend', handleLike);
  });
}

function openModal(item, container) {
  editItemId = item ? item.id : null;
  
  container.querySelector('#lib-modal-title').textContent = item ? '编辑指令' : '新建指令';
  
  // Use decrypted content if available
  const displayContent = item ? (item.decryptedContent || item.content) : '';
  container.querySelector('#lib-content').value = displayContent;
  container.querySelector('#lib-author').value = item ? item.author : '';
  container.querySelector('#lib-new-tag').value = '';
  
  // Privacy settings
  const isPrivate = item ? item.privacyLevel === 'private' : false;
  container.querySelector('#lib-private-checkbox').checked = isPrivate;
  
  // For private items, get the original password from unlockedKeys
  let privacyKeyValue = '';
  if (item && isPrivate) {
    // Find the password that unlocked this item
    for (const key of unlockedKeys) {
      const hashedKey = item.privacyKey;
      // We can't reverse hash, so we leave it blank for security
      // User needs to re-enter password if they want to change it
      privacyKeyValue = ''; // Don't show password
      break;
    }
  }
  
  container.querySelector('#lib-privacy-key').value = privacyKeyValue;
  container.querySelector('#lib-privacy-key-group').style.display = isPrivate ? '' : 'none';
  
  renderTagPicker(container, item ? item.tags : []);
  
  container.querySelector('#lib-modal-delete').style.display = item ? '' : 'none';
  container.querySelector('#lib-modal').classList.add('show');
  setTimeout(() => container.querySelector('#lib-content').focus(), 60);
}

function closeModal(container) {
  container.querySelector('#lib-modal').classList.remove('show');
  editItemId = null;
}

// ── Preview modal (read-only) ──────────────────────
let previewItem = null;

function openPreviewModal(item) {
  if (!item) return;
  previewItem = item;
  
  const modal = pageContainer.querySelector('#lib-preview-modal');
  const contentEl = pageContainer.querySelector('#lib-preview-content');
  const metaEl = pageContainer.querySelector('#lib-preview-meta');
  
  contentEl.textContent = item.content;
  
  // Show metadata
  const parts = [];
  if (item.author) parts.push(`作者：${item.author}`);
  if (item.tags.length > 0) parts.push(`标签：${item.tags.join(', ')}`);
  metaEl.textContent = parts.join(' | ') || '';
  
  modal.classList.add('show');
}

function closePreviewModal(container) {
  container.querySelector('#lib-preview-modal').classList.remove('show');
  previewItem = null;
}

function copyFromPreview(container) {
  if (!previewItem) return;
  
  navigator.clipboard.writeText(previewItem.content).then(() => {
    showToast('已复制到剪贴板');
    closePreviewModal(container);
  }).catch(() => {
    showToast('复制失败，请手动复制');
  });
}

function renderTagPicker(container, selectedItemTags) {
  const picker = container.querySelector('#lib-tag-picker');
  
  if (!tags.length && !selectedItemTags.length) {
    picker.innerHTML = '<div style="color:var(--muted);font-size:12px;padding:4px 0">暂无标签，请先添加</div>';
    return;
  }
  
  // Merge all tags and item's tags
  const allTags = Array.from(new Set([...tags, ...selectedItemTags])).sort();
  
  picker.innerHTML = allTags.map(tag => {
    const checked = selectedItemTags.includes(tag);
    return `<label class="lib-tag-checkbox">
      <input type="checkbox" value="${escHtml(tag)}" ${checked ? 'checked' : ''}>
      <span>${escHtml(tag)}</span>
    </label>`;
  }).join('');
}

function addNewTag(container) {
  const input = container.querySelector('#lib-new-tag');
  const tag = input.value.trim();
  
  if (!tag) return;
  if (tags.includes(tag)) {
    showToast('标签已存在');
    return;
  }
  
  tags.push(tag);
  tags.sort();
  
  const currentTags = Array.from(container.querySelectorAll('#lib-tag-picker input[type="checkbox"]:checked'))
    .map(cb => cb.value);
  currentTags.push(tag);
  
  renderTagPicker(container, currentTags);
  input.value = '';
  showToast(`已添加标签：${tag}`);
}

async function saveItem(container) {
  const content = container.querySelector('#lib-content').value.trim();
  if (!content) { showToast('内容不能为空'); return; }
  
  const author = container.querySelector('#lib-author').value.trim();
  const selectedItemTags = Array.from(container.querySelectorAll('#lib-tag-picker input[type="checkbox"]:checked'))
    .map(cb => cb.value);
  
  const savingId = editItemId;  // Save ID before any async operations
  
  // Privacy settings
  const isPrivate = container.querySelector('#lib-private-checkbox').checked;
  let privacyKey = container.querySelector('#lib-privacy-key').value.trim();
  
  // If editing an existing private item without entering password, use the unlocked password
  if (savingId && isPrivate && !privacyKey) {
    const existingItem = items.find(x => x.id === savingId);
    if (existingItem && existingItem.privacyLevel === 'private') {
      // Find the password that unlocked this item
      for (const key of unlockedKeys) {
        const hashedKey = await hashPassword(key);
        if (hashedKey === existingItem.privacyKey) {
          privacyKey = key;
          break;
        }
      }
    }
  }
  
  if (isPrivate && !privacyKey) {
    showToast('隐私指令必须设置密码');
    container.querySelector('#lib-modal').classList.add('show');
    setTimeout(() => container.querySelector('#lib-privacy-key').focus(), 100);
    return;
  }
  
  closeModal(container);
  
  setSyncStatus('syncing');
  try {
    let row;
    
    if (isPrivate) {
      // Encrypt content and hash password for private items
      try {
        const encryptedContent = await encryptContent(content, privacyKey);
        const hashedKey = await hashPassword(privacyKey);
        
        row = {
          content: encryptedContent,
          author: author || 'unknown',
          tags_json: JSON.stringify(selectedItemTags),
          privacy_level: 'private',
          privacy_key: hashedKey
        };
      } catch (encryptErr) {
        console.error('Encryption failed, falling back to public:', encryptErr);
        showToast('加密失败，已保存为公开指令');
        row = {
          content,
          author: author || 'unknown',
          tags_json: JSON.stringify(selectedItemTags),
          privacy_level: 'public',
          privacy_key: null
        };
      }
    } else {
      // Public items: store as-is
      row = {
        content,
        author: author || 'unknown',
        tags_json: JSON.stringify(selectedItemTags),
        privacy_level: 'public',
        privacy_key: null
      };
    }
    
    if (savingId) {
      const { error } = await supaClient.from('general_library_items').update(row).eq('id', savingId);
      if (error) throw error;
      showToast('已更新');
    } else {
      const { error } = await supaClient.from('general_library_items').insert(row);
      if (error) throw error;
      showToast('已创建');
    }
    
    await fetchAll();
    setSyncStatus('ok');
  } catch(e) { 
    dbError('保存指令', e); 
  }
}

async function deleteItem(container) {
  if (!editItemId) return;
  
  const item = items.find(x => x.id === editItemId);
  if (!item) return;
  
  // Use decrypted content for preview if available
  const displayContent = item.decryptedContent || item.content;
  const preview = displayContent.slice(0, 30) + (displayContent.length > 30 ? '...' : '');
  if (!confirmDialog(`确定要删除这条指令吗？\n\n预览：${preview}`)) return;
  
  const deletingId = editItemId;  // Save ID before closeModal clears it
  closeModal(container);
  
  setSyncStatus('syncing');
  try {
    const { error } = await supaClient.from('general_library_items').delete().eq('id', deletingId);
    if (error) throw error;
    await fetchAll();
    setSyncStatus('ok');
    showToast('已删除');
  } catch(e) { dbError('删除指令', e); }
}


function subscribeRealtime() {
  realtimeCh = supaClient.channel('library-page')
    .on('postgres_changes', {event:'*', schema:'public', table:'general_library_items'}, () => fetchAll())
    .subscribe();
}

// ── Tag management ─────────────────────────────────
async function renameTag(oldTag, tagListEl) {
  
  const newTag = prompt(`重命名标签「${oldTag}」:`, oldTag);
  if (!newTag || newTag.trim() === '') return;
  const trimmedTag = newTag.trim();
  
  if (trimmedTag === oldTag) return;
  
  if (tags.includes(trimmedTag)) {
    showToast('标签名已存在');
    return;
  }
  
  setSyncStatus('syncing');
  try {
    // Update all items that have this tag
    const itemsToUpdate = items.filter(item => item.tags.includes(oldTag));
    
    for (const item of itemsToUpdate) {
      const updatedTags = item.tags.map(t => t === oldTag ? trimmedTag : t);
      const { error } = await supaClient
        .from('general_library_items')
        .update({ tags_json: JSON.stringify(updatedTags) })
        .eq('id', item.id);
      if (error) throw error;
    }
    
    // Update selected tags if the renamed tag was selected
    if (selectedTags.includes(oldTag)) {
      selectedTags = selectedTags.map(t => t === oldTag ? trimmedTag : t);
    }
    
    await fetchAll();
    setSyncStatus('ok');
    showToast(`已重命名：${oldTag} → ${trimmedTag}`);
  } catch(e) { 
    dbError('重命名标签', e); 
  }
}

async function deleteTag(tag, tagListEl) {
  
  const count = items.filter(item => item.tags.includes(tag)).length;
  if (!confirmDialog(`确定要删除标签「${tag}」？\n\n将从 ${count} 个指令中移除此标签，但不会删除指令本身。`)) return;
  
  setSyncStatus('syncing');
  try {
    // Remove tag from all items that have it
    const itemsToUpdate = items.filter(item => item.tags.includes(tag));
    
    for (const item of itemsToUpdate) {
      const updatedTags = item.tags.filter(t => t !== tag);
      const { error } = await supaClient
        .from('general_library_items')
        .update({ tags_json: JSON.stringify(updatedTags) })
        .eq('id', item.id);
      if (error) throw error;
    }
    
    // Remove from selected tags if it was selected
    selectedTags = selectedTags.filter(t => t !== tag);
    
    await fetchAll();
    setSyncStatus('ok');
    showToast(`已删除标签：${tag}`);
  } catch(e) { 
    dbError('删除标签', e); 
  }
}

// ── Like functionality (session-based, toggle support) ─────
async function likeItem(itemId) {
  if (!itemId) return;
  
  const item = items.find(x => x.id === itemId);
  if (!item) return;
  
  const isCurrentlyLiked = likedItems.has(itemId);
  const isLiking = !isCurrentlyLiked;  // Toggle
  
  let newLikes;
  if (isLiking) {
    // Like: +1
    newLikes = (item.likes || 0) + 1;
    likedItems.add(itemId);
  } else {
    // Unlike: -1
    newLikes = Math.max((item.likes || 0) - 1, 0);  // Don't go below 0
    likedItems.delete(itemId);
  }
  
  // Update local state immediately
  item.likes = newLikes;
  
  // Update UI immediately
  const likeArea = document.querySelector(`.lib-item-like[data-id="${itemId}"]`);
  if (likeArea) {
    const countEl = likeArea.querySelector('.lib-like-count');
    const iconEl = likeArea.querySelector('.lib-like-btn');
    
    if (countEl) countEl.textContent = newLikes;
    if (iconEl) iconEl.textContent = isLiking ? '❤️' : '👍';
    
    // Update class and title
    if (isLiking) {
      likeArea.classList.add('liked');
      likeArea.title = '取消点赞';
    } else {
      likeArea.classList.remove('liked');
      likeArea.title = '点赞';
    }
  }
  
  // Show toast immediately
  showToast(isLiking ? '👍 已点赞' : '💔 已取消点赞');
  
  // Save to database in background
  setSyncStatus('syncing');
  try {
    const { error } = await supaClient
      .from('general_library_items')
      .update({ likes: newLikes })
      .eq('id', itemId);
    
    if (error) throw error;
    
    setSyncStatus('ok');
  } catch(e) { 
    // Rollback on error
    if (isLiking) {
      item.likes = newLikes - 1;
      likedItems.delete(itemId);
    } else {
      item.likes = newLikes + 1;
      likedItems.add(itemId);
    }
    
    // Revert UI
    if (likeArea) {
      const countEl = likeArea.querySelector('.lib-like-count');
      const iconEl = likeArea.querySelector('.lib-like-btn');
      if (countEl) countEl.textContent = item.likes;
      if (iconEl) iconEl.textContent = likedItems.has(itemId) ? '❤️' : '👍';
      if (likedItems.has(itemId)) {
        likeArea.classList.add('liked');
        likeArea.title = '取消点赞';
      } else {
        likeArea.classList.remove('liked');
        likeArea.title = '点赞';
      }
    }
    
    dbError('点赞操作', e);
  }
}

// ── Library-specific edit mode (password-protected) ───
function openPasswordModal(container) {
  container.querySelector('#lib-password-input').value = '';
  container.querySelector('#lib-password-error').style.display = 'none';
  container.querySelector('#lib-password-modal').classList.add('show');
  setTimeout(() => container.querySelector('#lib-password-input').focus(), 60);
}

function closePasswordModal(container) {
  container.querySelector('#lib-password-modal').classList.remove('show');
}

function submitPassword(container) {
  const input = container.querySelector('#lib-password-input').value;
  if (input === LIBRARY_PASSWORD) {
    isLibraryEditable = true;
    updateLibraryUI(container);
    closePasswordModal(container);
    showToast('✅ 已解锁指令编辑');
  } else {
    container.querySelector('#lib-password-error').style.display = 'block';
    container.querySelector('#lib-password-input').value = '';
    container.querySelector('#lib-password-input').focus();
  }
}

// ── Crypto utilities ────────────────────────────────
async function deriveKey(password, salt) {
  const encoder = new TextEncoder();
  const keyMaterial = await crypto.subtle.importKey(
    'raw',
    encoder.encode(password),
    'PBKDF2',
    false,
    ['deriveBits', 'deriveKey']
  );
  
  return crypto.subtle.deriveKey(
    {
      name: 'PBKDF2',
      salt: encoder.encode(salt),
      iterations: 100000,
      hash: 'SHA-256'
    },
    keyMaterial,
    { name: 'AES-GCM', length: 256 },
    false,
    ['encrypt', 'decrypt']
  );
}

async function encryptContent(content, password) {
  try {
    const encoder = new TextEncoder();
    const salt = 'library-privacy-salt';
    const key = await deriveKey(password, salt);
    
    const iv = crypto.getRandomValues(new Uint8Array(12));
    
    const encrypted = await crypto.subtle.encrypt(
      { name: 'AES-GCM', iv },
      key,
      encoder.encode(content)
    );
    
    const combined = new Uint8Array(iv.length + encrypted.byteLength);
    combined.set(iv, 0);
    combined.set(new Uint8Array(encrypted), iv.length);
    
    return btoa(String.fromCharCode(...combined));
  } catch (e) {
    console.error('Encryption failed:', e);
    throw new Error('加密失败');
  }
}

async function decryptContent(encryptedBase64, password) {
  try {
    const decoder = new TextDecoder();
    const salt = 'library-privacy-salt';
    const key = await deriveKey(password, salt);
    
    const combined = Uint8Array.from(atob(encryptedBase64), c => c.charCodeAt(0));
    
    const iv = combined.slice(0, 12);
    const encrypted = combined.slice(12);
    
    const decrypted = await crypto.subtle.decrypt(
      { name: 'AES-GCM', iv },
      key,
      encrypted
    );
    
    return decoder.decode(decrypted);
  } catch (e) {
    console.error('Decryption failed:', e);
    return null;
  }
}

async function hashPassword(password) {
  const encoder = new TextEncoder();
  const data = encoder.encode(password);
  const hash = await crypto.subtle.digest('SHA-256', data);
  const hashArray = Array.from(new Uint8Array(hash));
  return hashArray.map(b => b.toString(16).padStart(2, '0')).join('');
}

function updateSortButton(container) {
  const sortBtn = container.querySelector('#lib-sort-btn');
  if (!sortBtn) return;
  
  if (sortBy === 'likes') {
    sortBtn.textContent = '👍 点赞排序';
    sortBtn.title = '当前：按点赞数排序，点击切换为时间排序';
  } else {
    sortBtn.textContent = '🕐 时间排序';
    sortBtn.title = '当前：按创建时间排序，点击切换为点赞排序';
  }
}

function updateLibraryUI(container) {
  const unlockBtn = container.querySelector('#lib-unlock-btn');
  const addBtn = container.querySelector('#lib-add-btn');
  
  // Check if editable through EITHER global OR library-specific mode
  const isEditable = isLibraryEditor();
  
  if (isEditable) {
    if (isEditor()) {
      // Global edit mode is active
      unlockBtn.textContent = '🔓 全局编辑中';
      unlockBtn.className = 'btn bp';
      unlockBtn.disabled = true;  // Can't lock from here
    } else {
      // Library-specific edit mode
      unlockBtn.textContent = '🔓 锁定指令编辑';
      unlockBtn.className = 'btn bp';
      unlockBtn.disabled = false;
    }
    addBtn.style.display = '';
  } else {
    unlockBtn.textContent = '🔒 解锁指令编辑';
    unlockBtn.className = 'btn bn';
    unlockBtn.disabled = false;
    addBtn.style.display = 'none';
  }
  
  // Re-render grid to update edit buttons on tags
  renderTagList(container.querySelector('#lib-tag-list'));
}

// Check library edit permission (global OR library-specific)
function isLibraryEditor() {
  return isEditor() || isLibraryEditable;
}

// ── Privacy mode functions ────────────────────────
async function unlockPrivateContent(container) {
  const input = container.querySelector('#lib-privacy-input');
  const key = input.value.trim();
  
  if (!key) {
    showToast('请输入密码');
    return;
  }
  
  // Hash the input password
  const hashedKey = await hashPassword(key);
  
  // Check if this key unlocks any private items
  const matchingItems = items.filter(item => 
    item.privacyLevel === 'private' && item.privacyKey === hashedKey
  );
  
  if (matchingItems.length === 0) {
    showToast('❌ 密码错误或没有匹配的隐私内容');
    input.value = '';
    return;
  }
  
  // Store the plain password for decryption (in memory only)
  unlockedKeys.add(key);
  input.value = '';
  
  // Decrypt content for unlocked items
  for (const item of matchingItems) {
    if (item.content && !item.decryptedContent) {
      const decrypted = await decryptContent(item.content, key);
      if (decrypted) {
        item.decryptedContent = decrypted;
      }
    }
  }
  
  // Update UI
  updateUnlockedKeysDisplay(container);
  renderGrid(container.querySelector('.lib-layout'));
  
  showToast(`✅ 已解锁 ${matchingItems.length} 条隐私内容`);
}

function updateUnlockedKeysDisplay(container) {
  const display = container.querySelector('#lib-unlocked-keys');
  if (!display) return;
  
  if (unlockedKeys.size === 0) {
    display.textContent = '';
    return;
  }
  
  display.innerHTML = `<span style="color:#22c55e">✓ 解锁成功</span> <button onclick="clearAllKeys()" style="background:none;border:none;color:#ef4444;cursor:pointer;font-size:12px;padding:0 4px">清除全部</button>`;
}

window.clearAllKeys = function() {
  unlockedKeys.clear();
  
  // Clear decrypted content cache
  items.forEach(item => {
    if (item.privacyLevel === 'private') {
      delete item.decryptedContent;
    }
  });
  
  const container = pageContainer;
  if (container) {
    const layout = container.querySelector('.lib-layout');
    updateUnlockedKeysDisplay(container);
    renderGrid(layout);
    showToast('🔒 已清除所有解锁密码');
  }
};
