const API_BASE = import.meta.env.VITE_API_URL ?? '/api';
const TOKEN_KEY = 'arivu_admin_token';

export function getAdminToken(): string | null {
  return sessionStorage.getItem(TOKEN_KEY);
}

export function setAdminToken(token: string | null): void {
  if (token) sessionStorage.setItem(TOKEN_KEY, token);
  else sessionStorage.removeItem(TOKEN_KEY);
}

function authHeaders(extra?: HeadersInit): HeadersInit {
  const headers: Record<string, string> = {};
  const token = getAdminToken();
  if (token) headers.Authorization = `Bearer ${token}`;
  return { ...headers, ...extra };
}

async function parseError(res: Response, path: string): Promise<string> {
  try {
    const body = (await res.json()) as { error?: string };
    if (body.error) return body.error;
  } catch {
    /* ignore */
  }
  return `API ${res.status}: ${path}`;
}

export class ApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

async function request<T>(path: string, init: RequestInit): Promise<T> {
  const res = await fetch(`${API_BASE}${path}`, {
    ...init,
    headers: authHeaders(init.headers as HeadersInit),
  });
  if (res.status === 401) {
    setAdminToken(null);
    throw new ApiError('Unauthorized — please sign in again', 401);
  }
  if (!res.ok) throw new ApiError(await parseError(res, path), res.status);
  if (res.status === 204) return undefined as T;
  return res.json() as Promise<T>;
}

export async function fetchAuthStatus(): Promise<{ authEnabled: boolean }> {
  const res = await fetch(`${API_BASE}/admin/auth/status`);
  if (!res.ok) throw new Error('Failed to load auth status');
  return res.json() as Promise<{ authEnabled: boolean }>;
}

export async function loginAdmin(
  username: string,
  password: string,
): Promise<{ authEnabled: boolean; token: string | null; username?: string }> {
  const res = await fetch(`${API_BASE}/admin/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username, password }),
  });
  if (!res.ok) throw new ApiError(await parseError(res, '/admin/auth/login'), res.status);
  return res.json() as Promise<{ authEnabled: boolean; token: string | null; username?: string }>;
}

export async function fetchJson<T>(path: string): Promise<T> {
  return request<T>(path, { method: 'GET' });
}

export async function postJson<T>(path: string, body?: unknown): Promise<T> {
  return request<T>(path, {
    method: 'POST',
    headers: body !== undefined ? { 'Content-Type': 'application/json' } : undefined,
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
}

export async function deleteJson<T>(path: string): Promise<T> {
  return request<T>(path, { method: 'DELETE' });
}

export function confirmDelete(message: string): boolean {
  return window.confirm(message);
}
