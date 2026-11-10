import { apiFetch, apiJson } from './apiClient';

export interface ProjectContract {
  id: string;
  draftId: string | null;
  accountContractId: string | null;
  title: string;
  contractType: string;
}

export interface MusicProject {
  id: string;
  title: string;
  lyrics: string;
  fileName: string | null;
  fileSize: number;
  hasAudio: boolean;
  audioVersion: string | null;
  legacyId: string | null;
  comments: { id: string; body: string; createdAt: string }[];
  contracts: ProjectContract[];
  createdAt: string;
  updatedAt: string;
}

export const MAX_AUDIO_SIZE = 50 * 1024 * 1024;
export const AUDIO_ACCEPT = '.mp3,.wav,.m4a,.flac,.ogg,.webm,audio/*';

export function validateAudio(file: File) {
  if (!file.size) throw new Error('Choose an audio file that is not empty.');
  if (file.size > MAX_AUDIO_SIZE)
    throw new Error('Audio files must be 50 MB or smaller.');
  if (!/\.(mp3|wav|m4a|flac|ogg|webm)$/i.test(file.name))
    throw new Error('Choose an MP3, WAV, M4A, FLAC, OGG, or WebM file.');
}

export const listMusicProjects = () => apiJson<MusicProject[]>('/api/projects');
export const getMusicProject = (id: string) =>
  apiJson<MusicProject>(`/api/projects/${encodeURIComponent(id)}`);
export const updateMusicProject = (id: string, title: string, lyrics: string) =>
  apiJson<MusicProject>(`/api/projects/${id}/update`, { title, lyrics });
export const deleteMusicProject = (id: string) =>
  apiJson<{ ok: boolean }>(`/api/projects/${id}/delete`, {});
export const addProjectNote = (id: string, body: string) =>
  apiJson<MusicProject>(`/api/projects/${id}/comments`, { body });
export const attachProjectContract = (
  id: string,
  contract: {
    contractId: string;
    source: 'filing' | 'account';
    title?: string;
    contractType?: string;
  },
) => apiJson<MusicProject>(`/api/projects/${id}/contracts`, contract);
export const detachProjectContract = (id: string, linkId: string) =>
  apiJson<MusicProject>(`/api/projects/${id}/contracts/${linkId}`, {});

export async function uploadProjectAudio(id: string, file: File) {
  validateAudio(file);
  const response = await apiFetch(
    `/api/projects/${id}/audio?name=${encodeURIComponent(file.name)}`,
    {
      method: 'POST',
      headers: { 'Content-Type': file.type || 'application/octet-stream' },
      body: file,
    },
  );
  return response.json() as Promise<MusicProject>;
}

export async function createMusicProject(
  title: string,
  lyrics: string,
  file: File | null = null,
) {
  if (!lyrics.trim() && !file)
    throw new Error('Add lyrics or choose a music file to save this project.');
  if (file) validateAudio(file);
  const project = await apiJson<MusicProject>('/api/projects', {
    title,
    lyrics,
  });
  if (!file) return project;
  try {
    return await uploadProjectAudio(project.id, file);
  } catch (error) {
    // A failed upload must not leave an empty duplicate when the user retries.
    await deleteMusicProject(project.id).catch(() => {});
    throw error;
  }
}

export async function migrateBrowserProjects(
  userId: string,
  projects: MusicProject[],
) {
  let legacy: {
    id: string;
    title: string;
    lyrics?: string;
    comments?: MusicProject['comments'];
  }[] = [];
  try {
    legacy = JSON.parse(
      localStorage.getItem(`own_masters_music_projects_${userId}`) || '[]',
    );
  } catch {
    return projects;
  }
  if (!Array.isArray(legacy)) return projects;
  const markerKey = `own_masters_imported_music_projects_${userId}`;
  let imported: string[] = [];
  try {
    const stored = JSON.parse(localStorage.getItem(markerKey) || '[]');
    if (Array.isArray(stored)) imported = stored;
  } catch {
    /* Reuse server-side idempotency if the local marker is unavailable. */
  }
  const completed = new Set(imported);
  const known = new Set(projects.map((project) => project.legacyId));
  for (const legacyId of known) if (legacyId) completed.add(legacyId);
  localStorage.setItem(markerKey, JSON.stringify([...completed]));
  const migrated = [...projects];
  for (const entry of legacy) {
    if (
      !entry ||
      typeof entry.id !== 'string' ||
      typeof entry.title !== 'string' ||
      known.has(entry.id) ||
      completed.has(entry.id)
    )
      continue;
    const project = await apiJson<MusicProject>('/api/projects', {
      legacyId: entry.id,
      title: entry.title,
      lyrics: entry.lyrics || '',
      comments: entry.comments || [],
    });
    migrated.push(project);
    completed.add(entry.id);
    localStorage.setItem(markerKey, JSON.stringify([...completed]));
  }
  return migrated.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
}
