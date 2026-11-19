import { apiJson } from './apiClient';

export type Page<T> = { items: T[]; total: number; page: number; pageSize: number };
export interface AdminUser {
  id: string; name: string; email: string; role: 'admin' | 'member'; emailVerifiedAt: string | null;
  suspendedAt: string | null; suspensionReason: string | null; lastLoginAt: string | null; lastActiveAt: string | null;
  createdAt: string; updatedAt: string; usage?: { projects: number; contracts: number; tickets: number };
}
export interface AdminDocument {
  id: string; originalName: string; title: string; category: string; kind: 'template' | 'guide'; description: string;
  summary: string; archivedAt: string | null; needsReview: boolean; reviewedAt: string | null; reviewNote: string;
  extractionStatus: string; extractionWarnings: string[]; textLength: number; version: number; draftCount: number; text?: string;
}
export interface Activity { id: string; actorId: string | null; actorName: string; action: string; entityType: string; entityId: string | null; description: string; createdAt: string }
export interface AdminSummary {
  totals: { users: number; activeUsers: number; suspendedUsers: number; admins: number; documents: number; archivedDocuments: number; needsReview: number; projects: number; contracts: number; signedCopies: number; openTickets: number };
  daily: { day: string; users: number; projects: number; contracts: number; tickets: number }[];
}
export const fetchAdmin = <T,>(path: string) => apiJson<T>(`/api/admin/${path}`);
export const updateAdmin = <T,>(path: string, body: unknown) => apiJson<T>(`/api/admin/${path}`, body);

export type TicketStatus = 'open' | 'in_progress' | 'resolved' | 'dismissed';
export interface TicketReply { id: string; authorName: string; isStaff: boolean; isInternal: boolean; body: string; createdAt: string }
export interface SupportTicket {
  id: string; userId: string; kind: 'support' | 'report'; subject: string; message?: string; targetId: string | null; targetTitle: string | null;
  status: TicketStatus; priority: 'normal' | 'high'; version: number; createdAt: string; updatedAt: string;
  replies?: TicketReply[]; user?: { id: string; name: string; email: string };
}
export const fetchSupport = <T,>(path = '') => apiJson<T>(`/api/support/tickets${path}`);
export const createSupportTicket = (body: { kind: string; subject: string; message: string; targetId?: string }) => apiJson<SupportTicket>('/api/support/tickets', body);
export const replySupportTicket = (id: string, message: string) => apiJson<SupportTicket>(`/api/support/tickets/${id}/reply`, { message });
