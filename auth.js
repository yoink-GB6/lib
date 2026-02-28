// core/auth.js
// 编辑权限管理 — 哈希密码版（明文密码不出现在代码里）

let _isEditor = false;
const _listeners = [];

export function isEditor() { return _isEditor; }
export function onAuthChange(fn) { _listeners.push(fn); }

function _notify() {
  _listeners.forEach(fn => {
    try { fn(_isEditor); } catch(e) {}
  });
}

async function sha256(str) {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(str));
  return Array.from(new Uint8Array(buf)).map(b => b.toString(16).padStart(2, '0')).join('');
}

export async function tryUnlock(password) {
  const hash = await sha256(password);
  if (hash === window.EDIT_PASSWORD_HASH) {
    _isEditor = true;
    _notify();
    return true;
  }
  return false;
}

export async function checkEntryPassword(password) {
  const hash = await sha256(password);
  return hash === window.ENTRY_PASSWORD_HASH;
}

export function lock() {
  _isEditor = false;
  _notify();
}
