export const CONTRACT_PROGRESS_LABELS = {
  draft: 'Draft',
  ready_for_review: 'Ready for review',
  awaiting_signatures: 'Awaiting signatures',
  signed: 'Signed',
  cancelled: 'Cancelled',
};
export type ContractProgressStage = keyof typeof CONTRACT_PROGRESS_LABELS;
export type ContractProgressSource = 'filing' | 'account';
export interface ContractProgressSummary {
  source: ContractProgressSource;
  contractId: string;
  status: ContractProgressStage;
  updatedAt: string;
}
export interface ContractProgressView {
  source: ContractProgressSource;
  contractId: string;
  status: ContractProgressStage;
  tracked: boolean;
  version: number;
  updatedAt: string | null;
  previousStatus?: string;
  events: {
    id: string;
    action: string;
    fromStatus: ContractProgressStage | null;
    toStatus: ContractProgressStage;
    actorName: string;
    note: string;
    createdAt: string;
  }[];
  signedCopies: {
    id: string;
    fileName: string;
    sizeBytes: number;
    uploadedAt: string;
  }[];
}
export function contractStageLabel(status: string) {
  return (
    CONTRACT_PROGRESS_LABELS[status as ContractProgressStage] ||
    (status === 'completed' ? 'Completed' : status)
  );
}
