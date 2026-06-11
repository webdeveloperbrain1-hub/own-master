const localRules = [
  {
    id: 'perpetual-rights',
    severity: 'high',
    title: 'Perpetual rights detected',
    terms: ['perpetual', 'forever', 'in perpetuity'],
    explanation: 'This draft may grant rights forever. Confirm whether this is intended.',
    suggestedQuestion: 'Should these rights last forever, or should there be a fixed term?',
  },
  {
    id: 'exclusive-rights',
    severity: 'medium',
    title: 'Exclusive rights should be reviewed',
    terms: ['exclusive', 'exclusively'],
    explanation: 'Exclusive rights may limit what a creator can do elsewhere.',
    suggestedQuestion: 'Is exclusivity intended, and what exactly should it cover?',
  },
  {
    id: 'missing-completion-markers',
    severity: 'medium',
    title: 'Incomplete terms remain',
    terms: ['[TO BE COMPLETED]', '________________'],
    explanation: 'Some material terms still need to be completed before anyone relies on this draft.',
    suggestedQuestion: 'Which missing details should be confirmed before sharing this draft?',
  },
  {
    id: 'net-receipts',
    severity: 'medium',
    title: 'Net receipts definition matters',
    terms: ['net receipts', 'net revenue', 'after deductions'],
    explanation: 'Payment amounts can change depending on what deductions are allowed.',
    suggestedQuestion: 'Which deductions are allowed before royalties are calculated?',
  },
];

export function detectLocalRiskFlags(contractText = '') {
  const normalized = contractText.toLowerCase();

  return localRules
    .filter((rule) => rule.terms.some((term) => normalized.includes(term.toLowerCase())))
    .map(({ terms, ...flag }) => flag);
}

export function mergeRiskFlags(localFlags = [], aiFlags = []) {
  const merged = new Map();

  for (const flag of [...localFlags, ...aiFlags]) {
    if (!flag?.id) {
      continue;
    }

    if (!merged.has(flag.id)) {
      merged.set(flag.id, flag);
    }
  }

  return Array.from(merged.values());
}
