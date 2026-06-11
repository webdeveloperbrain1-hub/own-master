import { detectBlankCandidates } from './templateParser.mjs';

const ALLOWED_TYPES = new Set([
  'text',
  'textarea',
  'date',
  'currency',
  'number',
  'percentage',
  'select',
  'signature',
]);

const ALLOWED_CATEGORIES = new Set([
  'parties',
  'deal_terms',
  'dates',
  'payment',
  'rights',
  'signatures',
  'other',
]);

function slugKey(value = 'field') {
  const cleaned = String(value)
    .replace(/[^a-zA-Z0-9 ]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

  if (!cleaned) return 'field';

  const words = cleaned.split(' ');
  return words
    .map((word, index) => {
      const lower = word.toLowerCase();
      if (index === 0) return lower;
      return lower.charAt(0).toUpperCase() + lower.slice(1);
    })
    .join('');
}

function hasRealBlank(candidate) {
  const text = [
    candidate?.sourceText,
    candidate?.fullLine,
    candidate?.surroundingContext,
  ]
    .filter(Boolean)
    .join('\n');

  return (
    /_{2,}/.test(text) ||
    /\b20_{2,}\b/.test(text) ||
    /\(\s{3,}\)/.test(text) ||
    /\[\s*\]/.test(text) ||
    /\{\{\s*[^}]+\s*\}\}/.test(text)
  );
}

function inferBetterKey(field, candidates = []) {
  const context = [
    field.label,
    field.key,
    field.surroundingContext,
    ...candidates.map((candidate) => candidate.surroundingContext || candidate.fullLine || ''),
  ]
    .join('\n')
    .toLowerCase();

  if (context.includes('publisher') && context.includes('address')) return 'publisherAddress';
  if (context.includes('publisher')) return 'publisherName';

  if (context.includes('writer') && context.includes('address')) return 'writerAddress';
  if (context.includes('writer')) return 'writerName';

  if (context.includes('producer') && context.includes('signature')) return 'producerSignature';
  if (context.includes('producer')) return 'producerName';

  if (context.includes('artist') && context.includes('signature')) return 'artistSignature';
  if (context.includes('artist')) return 'artistName';

  if (context.includes('company') && context.includes('signature')) return 'companySignature';
  if (context.includes('record company') || context.includes('company')) return 'companyName';

  if (context.includes('signature') && context.includes('publisher')) return 'publisherSignature';
  if (context.includes('signature') && context.includes('writer')) return 'writerSignature';
  if (context.includes('signature')) return 'signature';

  if (context.includes('day of') || context.includes('20__') || context.includes('date')) return 'agreementDate';

  if (context.includes('advance') || context.includes('payment') || context.includes('$')) return 'advanceAmount';

  if (context.includes('royalty') || context.includes('percent') || context.includes('%')) return 'royaltyPercentage';

  if (context.includes('state') || context.includes('governed by')) return 'governingState';

  return slugKey(field.label || field.key || 'field');
}

function inferBetterType(field, candidates = []) {
  const context = [
    field.type,
    field.label,
    field.key,
    field.surroundingContext,
    ...candidates.map((candidate) => candidate.surroundingContext || candidate.fullLine || ''),
  ]
    .join('\n')
    .toLowerCase();

  if (context.includes('signature')) return 'signature';
  if (context.includes('date') || context.includes('day of') || context.includes('20__')) return 'date';
  if (context.includes('$') || context.includes('advance') || context.includes('payment')) return 'currency';
  if (context.includes('%') || context.includes('percent') || context.includes('royalty')) return 'percentage';
  if (context.includes('address')) return 'textarea';

  return ALLOWED_TYPES.has(field.type) ? field.type : 'text';
}

function firstCandidate(field, candidateById) {
  return (field.candidateIds || [])
    .map((id) => candidateById.get(id))
    .filter(Boolean)
    .sort((a, b) => (a.position ?? 0) - (b.position ?? 0))[0];
}

function firstPosition(field, candidateById) {
  const candidate = firstCandidate(field, candidateById);
  if (candidate && Number.isFinite(candidate.position)) return candidate.position;
  return Number.isFinite(field.order) ? field.order : 0;
}

// The "year" blank is the one written as 19__ / 20__ (detected as date_fragment).
// Only look at the blank's OWN text/kind here: the surrounding line contains the
// year token too, so testing the line would mark every blank on it as the year.
function isYearFragment(field, candidateById) {
  const candidate = firstCandidate(field, candidateById);
  if (candidate) {
    return candidate.kind === 'date_fragment' || /\b(?:19|20)\s*_{2,}/.test(String(candidate.sourceText || ''));
  }
  return /\b(?:19|20)\s*_{2,}/.test(String(field.sourceText || ''));
}

function looksLikeDateFragmentField(field, candidateById) {
  const context = String(
    field.surroundingContext || firstCandidate(field, candidateById)?.fullLine || '',
  ).toLowerCase();
  return (
    field.type === 'date' ||
    String(field.key || '').toLowerCase().includes('date') ||
    context.includes('day of') ||
    /\b(?:19|20)\s*_{2,}/.test(context)
  );
}

// Previously this MERGED "this ___ day of ___, 20__" into a single field, so one
// value filled all three blanks. We now keep each blank as its own field and
// label it by role (Day / Month / Year) using document order + the year marker,
// so the candidate-id-driven fill can place a distinct value in each blank.
export function splitDateFragments(fields, candidateById) {
  const out = [];
  const used = new Set();

  for (const field of fields) {
    if (used.has(field.__internalId)) continue;

    if (!looksLikeDateFragmentField(field, candidateById)) {
      out.push(field);
      continue;
    }

    const group = [
      field,
      ...fields.filter((other) => {
        if (other.__internalId === field.__internalId || used.has(other.__internalId)) return false;
        if (!looksLikeDateFragmentField(other, candidateById)) return false;

        const sameLine =
          other.surroundingContext &&
          field.surroundingContext &&
          other.surroundingContext === field.surroundingContext;
        const adjacent =
          Number.isFinite(other.order) &&
          Number.isFinite(field.order) &&
          Math.abs(other.order - field.order) <= 2;

        return sameLine || adjacent;
      }),
    ];

    for (const member of group) used.add(member.__internalId);

    // A lone date blank stays a single date field.
    if (group.length === 1) {
      out.push({ ...field, type: 'date', category: 'dates' });
      continue;
    }

    const ordered = [...group].sort(
      (a, b) => firstPosition(a, candidateById) - firstPosition(b, candidateById),
    );
    const yearIdx = ordered.findIndex((member) => isYearFragment(member, candidateById));
    const year = yearIdx >= 0 ? ordered.splice(yearIdx, 1)[0] : null;

    const roles = [];
    if (ordered[0]) roles.push([ordered[0], 'agreementDay', 'Agreement Day', 'number']);
    if (ordered[1]) roles.push([ordered[1], 'agreementMonth', 'Agreement Month', 'text']);
    for (let i = 2; i < ordered.length; i += 1) {
      roles.push([ordered[i], 'agreementDatePart', 'Agreement Date Part', 'text']);
    }
    if (year) roles.push([year, 'agreementYear', 'Agreement Year', 'number']);

    for (const [member, key, label, type] of roles) {
      out.push({
        ...member,
        key,
        label,
        type,
        category: 'dates',
        confidence: member.confidence === 'high' ? 'medium' : member.confidence,
      });
    }
  }

  return out;
}

export function makeUniqueKeys(fields) {
  const counts = new Map();

  return fields.map((field) => {
    const baseKey = field.key || 'field';
    const count = counts.get(baseKey) || 0;
    counts.set(baseKey, count + 1);

    if (count === 0) return field;

    return {
      ...field,
      key: `${baseKey}${count + 1}`,
      confidence: field.confidence === 'high' ? 'medium' : field.confidence,
    };
  });
}

export function postProcessFieldSchema(schema = {}, blankCandidates = []) {
  const candidateById = new Map(blankCandidates.map((candidate) => [candidate.id, candidate]));
  const warnings = Array.isArray(schema.warnings) ? [...schema.warnings] : [];

  const rawFields = Array.isArray(schema.fields) ? schema.fields : [];

  let fields = rawFields
    .map((field, index) => ({
      ...field,
      __internalId: `field_${index}`,
      candidateIds: Array.isArray(field.candidateIds) ? field.candidateIds : [],
      order: Number.isFinite(field.order) ? field.order : index + 1,
    }))
    .filter((field) => {
      if (field.candidateIds.length === 0) {
        warnings.push({
          type: 'removed_field_without_blank_candidate',
          message: `Removed field "${field.key || field.label || 'unknown'}" because it was not tied to a real blank candidate.`,
          context: field.surroundingContext || field.sourceText || '',
        });
        return false;
      }

      const candidates = field.candidateIds
        .map((id) => candidateById.get(id))
        .filter(Boolean);

      if (candidates.length === 0) {
        warnings.push({
          type: 'removed_field_with_unknown_candidate',
          message: `Removed field "${field.key || field.label || 'unknown'}" because its candidate IDs were not found.`,
          context: field.surroundingContext || field.sourceText || '',
        });
        return false;
      }

      if (!candidates.some(hasRealBlank)) {
        warnings.push({
          type: 'removed_field_without_real_blank',
          message: `Removed field "${field.key || field.label || 'unknown'}" because the supporting text did not contain a real blank.`,
          context: field.surroundingContext || field.sourceText || '',
        });
        return false;
      }

      return true;
    })
    .map((field) => {
      const candidates = field.candidateIds
        .map((id) => candidateById.get(id))
        .filter(Boolean);

      const key = inferBetterKey(field, candidates);
      const type = inferBetterType(field, candidates);
      const category = ALLOWED_CATEGORIES.has(field.category) ? field.category : 'other';

      return {
        ...field,
        key,
        label: field.label || key,
        type,
        category,
        required: Boolean(field.required),
        confidence: ['high', 'medium', 'low'].includes(field.confidence) ? field.confidence : 'medium',
        sourceText: field.sourceText || candidates.map((candidate) => candidate.sourceText).join(' | '),
        surroundingContext: field.surroundingContext || candidates[0]?.surroundingContext || '',
      };
    });

  fields = splitDateFragments(fields, candidateById);
  fields = makeUniqueKeys(fields);

  fields = fields.map(({ __internalId, ...field }) => field);

  return {
    ...schema,
    fields,
    warnings,
    reviewRequired:
      Boolean(schema.reviewRequired) ||
      warnings.length > 0 ||
      fields.some((field) => field.confidence !== 'high'),
  };
}