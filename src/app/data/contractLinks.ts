export function savedContractEditorPath(
  draftId: string,
  projectId?: string | null,
) {
  const path = `/dashboard/contracts/drafts/${encodeURIComponent(draftId)}/edit`;
  return projectId ? `${path}?project=${encodeURIComponent(projectId)}` : path;
}

export function guidePreviewPath(guideId: string, projectId?: string | null) {
  const path = `/dashboard/contract-filler/guides/${encodeURIComponent(guideId)}`;
  return projectId ? `${path}?project=${encodeURIComponent(projectId)}` : path;
}

export function contractLibraryPath(projectId?: string | null) {
  return projectId ? `/dashboard/contract-filler?project=${encodeURIComponent(projectId)}` : '/dashboard/contract-filler';
}
