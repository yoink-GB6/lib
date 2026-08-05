// auth.js
// 编辑权限 = Supabase 的登录态。
// 密码不在前端校验，而是丢给 Supabase Auth 验；登录成功后拿到的 JWT
// 由 supaClient 自动带在每个请求上，真正的拦截发生在数据库的 RLS 策略里。

import { supaClient } from './supabase-client.js';

let _isEditor = false;
const _listeners = [];

export function isEditor() { return _isEditor; }
export function onAuthChange(fn) { _listeners.push(fn); }

function _notify() {
  _listeners.forEach(fn => {
    try { fn(_isEditor); } catch (e) { console.error('[auth] onAuthChange 回调出错（已忽略）:', e); }
  });
}

function _set(v) {
  if (v === _isEditor) return;
  _isEditor = v;
  _notify();
}

// 启动时调用一次：恢复上次的登录态，并订阅后续变化（登录/登出/token 续期失败）
export async function initAuth() {
  const { data } = await supaClient.auth.getSession();
  _set(!!data?.session);
  supaClient.auth.onAuthStateChange((_event, session) => _set(!!session));
}

// 只输密码 —— 邮箱写死在 index.html 顶部的 window.AUTH_EMAIL
export async function signIn(password) {
  const email = window.AUTH_EMAIL;
  if (!email) return { ok: false, message: '没配置 AUTH_EMAIL，去 index.html 顶部填上' };

  const { error } = await supaClient.auth.signInWithPassword({ email, password });
  if (error) {
    console.warn('[auth] 登录失败', error);
    return {
      ok: false,
      message: /invalid login credentials/i.test(error.message) ? '密码错误，请重试' : error.message,
    };
  }
  return { ok: true };
}

export async function lock() {
  await supaClient.auth.signOut();
  _set(false);   // signOut 会触发 onAuthStateChange，这里兜底
}

// 便捷：检查权限，不足时弹 toast
export function requireEditor() {
  if (!_isEditor) {
    import('./ui.js').then(ui => ui.showToast('🔒 请先解锁编辑'));
    return false;
  }
  return true;
}
