import { apiFetch, apiJson, downloadApiFile } from './apiClient';
import type {
  ContractProgressSource,
  ContractProgressStage,
  ContractProgressSummary,
  ContractProgressView,
} from './contractProgressTypes';

const endpoint = (source: ContractProgressSource, contractId: string) =>
  `/api/contract-progress/${source}/${encodeURIComponent(contractId)}`;
export const fetchContractProgressList = () =>
  apiJson<ContractProgressSummary[]>('/api/contract-progress');
export const fetchContractProgress = (
  source: ContractProgressSource,
  contractId: string,
) => apiJson<ContractProgressView>(endpoint(source, contractId));
export const changeContractStage = (
  source: ContractProgressSource,
  contractId: string,
  status: ContractProgressStage,
  version: number,
  note: string,
) =>
  apiJson<ContractProgressView>(`${endpoint(source, contractId)}/status`, {
    status,
    version,
    note,
  });
export const cleanupAccountProgress = (contractId: string) =>
  apiJson<{ ok: boolean }>(`${endpoint('account', contractId)}/cleanup`, {});
export function downloadSignedCopy(
  source: ContractProgressSource,
  contractId: string,
  copyId: string,
) {
  return downloadApiFile(
    `${endpoint(source, contractId)}/signed-copies/${encodeURIComponent(copyId)}`,
    'signed-contract.pdf',
  );
}
export async function uploadSignedCopy(
  source: ContractProgressSource,
  contractId: string,
  file: File,
  version: number,
) {
  if (!file.size) throw new Error('Choose a signed PDF that is not empty.');
  if (!/\.pdf$/i.test(file.name)) throw new Error('Choose a signed PDF file.');
  if (file.size > 20 * 1024 * 1024)
    throw new Error('Signed PDFs must be 20 MB or smaller.');
  const response = await apiFetch(
    `${endpoint(source, contractId)}/signed-copies?name=${encodeURIComponent(file.name)}&version=${version}`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/pdf' },
      body: file,
    },
  );
  return response.json() as Promise<ContractProgressView>;
}
