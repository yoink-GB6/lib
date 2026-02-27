// core/auth.js
// 编辑权限管理 — 固定密码版

let _isEditor = false;
const _listeners = [];

export function isEditor() { return _isEditor; }

export function onAuthChange(fn) { _listeners.push(fn); }

function _notify() {
  _listeners.forEach(fn => {
    try { fn(_isEditor); }
    catch (e) { console.error('[auth] onAuthChange 回调出错:', e); }
  });
}

export function tryUnlock(password) {
  if (password === window.EDIT_PASSWORD) {
    _isEditor = true;
    _notify();
    return true;
  }
  return false;
}

export function lock() {
  _isEditor = false;
  _notify();
}
