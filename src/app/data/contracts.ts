/// <reference types="vite/client" />
import { apiJson } from './apiClient';
import type { Contract, CreateContractInput, ContractTemplateOption } from '../types';
import { BUILT_IN_TEMPLATES, fillTemplateWithAnswers, generateDeterministicContractDraft } from './contractDrafts';

export const CONTRACT_TYPES = [
  'Split Sheet',
  'Artist Producer Agreement',
  'Producer Royalty Agreement',
  'Artist Management Agreement',
  'Recording Agreement',
  'Master Use License',
  'Sync License',
  'Publishing Agreement',
  'Distribution Agreement',
  'Booking / Performance Agreement',
];

export const CONTRACT_TEMPLATE_OPTIONS: ContractTemplateOption[] = [
  {
    id: 'split-sheet',
    title: 'Split Sheet',
    description: 'For documenting song ownership, writer shares, producer shares, and collaborator splits.',
  },
  {
    id: 'artist-producer-agreement',
    title: 'Artist Producer Agreement',
    description: 'For artists working with producers on beats, recordings, or tracks.',
  },
  {
    id: 'producer-royalty-agreement',
    title: 'Producer Royalty Agreement',
    description: 'For producer royalty participation, royalty accounting, and payment terms.',
  },
  {
    id: 'artist-management-agreement',
    title: 'Artist Management Agreement',
    description: 'For artists hiring managers to help with career, business, and deal opportunities.',
  },
  {
    id: 'recording-agreement',
    title: 'Recording Agreement',
    description: 'For recording obligations, masters, deliverables, and artist recording services.',
  },
  {
    id: 'master-use-license',
    title: 'Master Use License',
    description: 'For licensing a sound recording/master for a specific use.',
  },
  {
    id: 'sync-license',
    title: 'Sync License',
    description: 'For using music in film, television, games, ads, social content, or visual media.',
  },
  {
    id: 'publishing-agreement',
    title: 'Publishing Agreement',
    description: 'For publishing rights, writer shares, administration, and composition income.',
  },
  {
    id: 'distribution-agreement',
    title: 'Distribution Agreement',
    description: 'For distribution services, release terms, fees, royalties, and platform delivery.',
  },
  {
    id: 'booking-performance-agreement',
    title: 'Booking / Performance Agreement',
    description: 'For live shows, DJ sets, performances, booking fees, and event obligations.',
  },
];

// Build an initial draft for a contract. Prefers the built-in template fill
// (position-based blanks, same approach as ContractFill) when a templateId is
// available; falls back to the deterministic generator for unknown types.
function buildInitialDraft(
  contractType: string,
  wizardAnswers: Record<string, unknown>,
  userRequest?: string | null,
  selectedTemplateId?: string | null,
): string {
  if (selectedTemplateId) {
    const templateText = BUILT_IN_TEMPLATES[selectedTemplateId];
    if (templateText) {
      // The wizard stores answers keyed by field ID in the same order the AI
      // returned them, so we reconstruct the ordered field list from the keys.
      const fieldIds = (Object.keys(wizardAnswers) as string[]).filter(k => !k.startsWith('__'));
      return fillTemplateWithAnswers(
        templateText,
        fieldIds,
        wizardAnswers as Record<string, string | string[]>,
      );
    }
  }
  return generateDeterministicContractDraft(
    contractType,
    wizardAnswers as Record<string, string | string[]>,
    userRequest ?? undefined,
  );
}

export async function listContracts() {
  return apiJson<Contract[]>('/api/account-contracts');
}

export async function getContract(id: string) {
  return apiJson<Contract>(`/api/account-contracts/${encodeURIComponent(id)}`);
}

export async function createContract(input: CreateContractInput) {
  const title = input.title.trim();
  const contractType = input.contractType.trim();
  const userRequest = input.userRequest?.trim() || null;
  const wizardAnswers = input.wizardAnswers ?? {};

  const content =
    input.content?.trim() ||
    buildInitialDraft(contractType, wizardAnswers, userRequest, input.selectedTemplateId ?? null);

  if (!title) throw new Error('Add a title for this contract.');

  if (!CONTRACT_TYPES.includes(contractType)) {
    if (!input.selectedTemplateId) throw new Error('Choose a supported contract type.');
  }

  return apiJson<Contract>('/api/account-contracts', { ...input, title, contractType, content, userRequest, wizardAnswers });
}

export async function updateContractContent(id: string, content: string) {
  const nextContent = content.trim();
  if (!nextContent) throw new Error('Contract content cannot be blank.');

  return apiJson<Contract>(`/api/account-contracts/${encodeURIComponent(id)}/update`, { content: nextContent });
}

export async function deleteContract(id: string) {
  await apiJson(`/api/account-contracts/${encodeURIComponent(id)}/delete`, {});
}
