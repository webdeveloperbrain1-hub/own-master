import type { Contract } from '../types';
import type { FilingDraftListItem } from './contractFilingClient';
import type { ContractProgressStage, ContractProgressSummary } from './contractProgressTypes';

export interface ContractListItem {
  id: string;
  title: string;
  contractType: string;
  status: Contract['status'] | ContractProgressStage;
  updatedAt: string;
  filingDraftId?: string;
}

export function mergeContractInventory(contracts: Contract[], drafts: FilingDraftListItem[], progress: ContractProgressSummary[] = []): ContractListItem[] {
  const stages = new Map(progress.map((item) => [`${item.source}:${item.contractId}`, item]));
  const inventory: ContractListItem[] = [
    ...contracts.map(({ id, title, contractType, status, updatedAt }) => ({ id, title, contractType, status, updatedAt })),
    ...drafts.map((draft): ContractListItem => ({
      id: `filing:${draft.id}`,
      filingDraftId: draft.id,
      title: draft.name,
      contractType: draft.template.contractType || draft.template.title || draft.template.originalName,
      status: 'draft',
      updatedAt: draft.updatedAt,
    })),
  ];
  return inventory.map((item) => {
    const stage = stages.get(item.filingDraftId ? `filing:${item.filingDraftId}` : `account:${item.id}`);
    return stage ? { ...item, status: stage.status, updatedAt: new Date(stage.updatedAt) > new Date(item.updatedAt) ? stage.updatedAt : item.updatedAt } : item;
  }).sort((a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime());
}
