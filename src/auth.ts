import { USERS, PASSWORDS } from './config';
import type { User } from './types';

const AUTH_KEY = 'tga_pod_user';

export function login(email: string, password: string): User | null {
  const user = USERS.find(u => u.email.toLowerCase() === email.toLowerCase());
  if (!user) return null;
  if (PASSWORDS[user.email] !== password) return null;
  localStorage.setItem(AUTH_KEY, JSON.stringify(user));
  return user;
}

export function logout() {
  localStorage.removeItem(AUTH_KEY);
}

export function getUser(): User | null {
  try {
    const stored = localStorage.getItem(AUTH_KEY);
    if (!stored) return null;
    return JSON.parse(stored) as User;
  } catch {
    return null;
  }
}
