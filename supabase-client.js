// supabase-client.js
// 全站唯一的 Supabase 客户端实例。
// 登录（auth.js）和读写（library/gallery/articles）必须共用这一个实例，
// 否则登录拿到的 JWT 不会被带到数据请求上，RLS 会一直把你当匿名用户。

if (!window.supabase) {
  throw new Error('[supabase-client] supabase-js SDK 未加载，请检查 index.html 里的 <script src="...supabase.js">');
}

export const supaClient = window.supabase.createClient(
  window.SUPABASE_URL,
  window.SUPABASE_ANON_KEY,
  {
    auth: {
      persistSession: true,      // session 存 localStorage，刷新页面不用重新输密码
      autoRefreshToken: true,    // token 快过期时自动续期
      detectSessionInUrl: false, // 不走邮件链接/OAuth 回调，关掉省得干扰
    },
  }
);

export function setSyncStatus(status) {
  const dot = document.getElementById('sync-dot');
  if (dot) dot.className = status;
}

export function safeUnsubscribe(channel) {
  if (channel && typeof channel.unsubscribe === 'function') channel.unsubscribe();
}

export function dbError(action, err) {
  console.error(`[DB] ${action} 失败`, err);
  setSyncStatus('err');
  // RLS 拒绝时 PostgREST 返回 42501；没登录去写就是这个
  const denied = err?.code === '42501' || err?.status === 401 || /row-level security/i.test(err?.message || '');
  const msg = denied ? '没有权限，请先解锁编辑' : (err?.message || '未知错误');
  window.showToast?.(`⚠️ ${action}失败：${msg}`);
}
