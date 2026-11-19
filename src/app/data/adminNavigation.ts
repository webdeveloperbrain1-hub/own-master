export const adminSections = [
  ['overview', 'Overview'],
  ['users', 'Users'],
  ['library', 'Library'],
  ['tickets', 'Support & Reports'],
  ['activity', 'Activity'],
] as const;

export type AdminSection = typeof adminSections[number][0];

export function selectedAdminSection(value: string | null): AdminSection {
  return adminSections.find(([key]) => key === value)?.[0] ?? 'overview';
}

export function adminUrl(tab: AdminSection, item?: string) {
  if (tab === 'overview' && !item) return '/dashboard/admin';
  return `/dashboard/admin?${new URLSearchParams({ tab, ...(item ? { item } : {}) })}`;
}
