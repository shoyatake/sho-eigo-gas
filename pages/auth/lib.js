// /pages/auth/lib.js — Sprint C1 認証 API クライアント（純 JS、依存なし）

const API_BASE = 'https://script.google.com/macros/s/AKfycbwheRcpv7m90WR1xTezHmRy4tVmHu40_djVsqIQpRbH4OrwCRXFPC9LuvVpiF3Sjqh_Mg/exec';
const STORAGE_KEY = 'sho_jwt';
const USER_KEY = 'sho_user';

async function api(action, body) {
  const res = await fetch(API_BASE, {
    method: 'POST',
    headers: { 'Content-Type': 'text/plain;charset=UTF-8' }, // CORS 簡易回避（GAS は preflight 不可）
    body: JSON.stringify({ action, ...body }),
    redirect: 'follow',
  });
  const json = await res.json();
  if (!json.ok) throw new Error(json.error || 'API error');
  return json.data;
}

const auth = {
  async signup(email, password, role, lineDisplayName) {
    const data = await api('signup', { email, password, role, lineDisplayName });
    auth._save(data);
    return data;
  },
  async login(email, password) {
    const data = await api('login', { email, password });
    auth._save(data);
    return data;
  },
  async logout() {
    const token = auth.getToken();
    if (!token) return { ok: true };
    try { await api('logout', { token }); } catch (e) { /* ignore */ }
    auth._clear();
    return { ok: true };
  },
  async verify() {
    const token = auth.getToken();
    if (!token) return null;
    try {
      const data = await api('verify', { token });
      return data;
    } catch (e) {
      auth._clear();
      return null;
    }
  },
  async lineAuthUrl() {
    const state = Math.random().toString(36).slice(2);
    sessionStorage.setItem('sho_line_state', state);
    const data = await api('line_auth_url', { state });
    return data.url;
  },

  getToken() { return localStorage.getItem(STORAGE_KEY); },
  getUser() {
    const raw = localStorage.getItem(USER_KEY);
    return raw ? JSON.parse(raw) : null;
  },

  _save(data) {
    localStorage.setItem(STORAGE_KEY, data.token);
    localStorage.setItem(USER_KEY, JSON.stringify({
      userId: data.userId, role: data.role, expiresAt: data.expiresAt,
    }));
  },
  _clear() {
    localStorage.removeItem(STORAGE_KEY);
    localStorage.removeItem(USER_KEY);
  },
};

window.shoAuth = auth;
