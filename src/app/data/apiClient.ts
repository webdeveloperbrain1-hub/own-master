export const API_BASE = import.meta.env.VITE_API_BASE_URL || '';

export async function apiHeaders(): Promise<Record<string, string>> {
  return { 'X-Own-Masters-Request': 'true' };
}

export async function apiFetch(path: string, init: RequestInit = {}) {
  const response = await fetch(`${API_BASE}${path}`, {
    ...init,
    credentials: 'include',
    headers: { ...(await apiHeaders()), ...init.headers },
  });
  if (!response.ok) {
    if (response.status === 401)
      window.dispatchEvent(new Event('own-masters-session-expired'));
    const payload = (await response.json().catch(() => ({}))) as {
      error?: string;
      code?: string;
    };
    if (response.status === 402 && payload.code === 'upgrade_required')
      window.dispatchEvent(new Event('own-masters-upgrade-required'));
    throw new Error(payload.error || `Request failed (${response.status}).`);
  }
  return response;
}

export async function apiJson<T>(path: string, body?: unknown): Promise<T> {
  const response = await apiFetch(
    path,
    body === undefined
      ? {}
      : {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(body),
        },
  );
  return response.json() as Promise<T>;
}

export async function downloadApiFile(path: string, fileName: string) {
  const response = await apiFetch(path);
  const url = URL.createObjectURL(await response.blob());
  const link = document.createElement('a');
  link.href = url;
  link.download =
    response.headers
      .get('Content-Disposition')
      ?.match(/filename="([^"]+)"/)?.[1] || fileName;
  document.body.appendChild(link);
  link.click();
  link.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
}
