import { API_BASE } from '../data/apiClient';
import type { AppUser } from '../types';

export async function accountRequest<T>(
  path: string,
  body?: unknown,
): Promise<T> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 20000);
  try {
    const response = await fetch(`${API_BASE}/api/auth/${path}`, {
      method: body === undefined ? 'GET' : 'POST',
      credentials: 'include',
      signal: controller.signal,
      headers: {
        'Content-Type': 'application/json',
        'X-Own-Masters-Request': 'true',
      },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
    const result = await response.json().catch(() => {
      throw new Error('The account service is unavailable. Please try again.');
    });
    if (!result || typeof result !== 'object' || Array.isArray(result))
      throw new Error('The account service returned an incomplete response. Please try again.');
    if (!response.ok)
      throw Object.assign(
        new Error(result.error || 'The account service is unavailable. Please try again.'),
        { code: result.code, status: response.status },
      );
    return result as T;
  } catch (error) {
    if (controller.signal.aborted) throw new Error('The account service timed out. Please try again.');
    throw error;
  } finally { clearTimeout(timeout); }
}
export async function currentAccount() {
  const result = await accountRequest<{ user: AppUser | null }>('session');
  if (!result || !('user' in result) ||
    (result.user !== null && (!result.user || typeof result.user.id !== 'string' || typeof result.user.email !== 'string')))
    throw new Error('The account service returned an incomplete response. Please try again.');
  return result;
}
