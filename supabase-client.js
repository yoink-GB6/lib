// core/supabase-client.js
// 全局唯一 Supabase 实例，所有页面模块共享

export const supaClient = window.supabase.createClient(
  window.SUPABASE_URL,
  window.SUPABASE_ANON_KEY
);

// 同步状态指示器（右上角的彩色小点）
export function setSyncStatus(status) {
  // status: 'syncing' | 'ok' | 'err' | ''
  const dot = document.getElementById('sync-dot');
  if (dot) dot.className = status;
}

// 通用错误提示
export function dbError(action, err) {
  console.error(`[DB] ${action} 失败`, err);
  setSyncStatus('err');
  window.showToast(`⚠️ ${action}失败：${err?.message || '未知错误'}`);
}
