import { requestAIJsonResult } from '../ai/openaiClient.mjs';

const fieldTypes = new Set([
  'text',
  'textarea',
  'date',
  'currency',
  'number',
  'percentage',
  'select',
  'signature',
]);

const categories = new Set([
  'parties',
  'deal_terms',
  'dates',
  'payment',
  'rights',
  'signatures',
  'other',
]);

const riskyPattern =
  /\b(royalty|ownership|rights?|term|territory|payment|advance|fee|recoup|termination|exclusive|exclusivity|signature|dated?|legal entity|company|publisher|master|copyright|writer|artist|producer|label|record company)\b/i;

function toCamelCase(value = '') {
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

function normalizeCandidate(candidate, index) {
  return {
    ...candidate,
    id: candidate.id || `blank_${String(index + 1).padStart(3, '0')}`,
    order: Number.isFinite(Number(candidate.order)) ? Number(candidate.order) : index + 1,
    sourceText: String(candidate.sourceText || ''),
    surroundingContext: String(candidate.surroundingContext || candidate.fullLine || ''),
    fullLine: String(candidate.fullLine || ''),
    guessedType: candidate.guessedType || 'text',
    lineNumber: Number.isFinite(Number(candidate.lineNumber)) ? Number(candidate.lineNumber) : undefined,
    kind: candidate.kind || 'blank',
  };
}

function hasRealBlank(candidate) {
  // These kinds are blanks by construction (no underscores to match on).
  if (['label_colon_blank', 'bracket_placeholder', 'mustache_placeholder'].includes(candidate?.kind)) {
    return true;
  }

  const text = [
    candidate?.sourceText,
    candidate?.fullLine,
    candidate?.surroundingContext,
  ]
    .filter(Boolean)
    .join('\n');

  return (
    /_{2,}/.test(text) ||
    /\b(?:19|20)_{2,}\b/.test(text) ||
    /\(\s{3,}\)/.test(text) ||
    /\[\s*\]/.test(text) ||
    /\{\{\s*[^}]+\s*\}\}/.test(text)
  );
}

function compact(value = '') {
  return String(value).replace(/\s+/g, ' ').trim();
}

function titleFromKey(key = 'field') {
  return String(key)
    .replace(/([a-z])([A-Z])/g, '$1 $2')
    .replace(/[_-]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/\b\w/g, (char) => char.toUpperCase());
}

function contextForCandidate(candidate = {}) {
  return [
    candidate.surroundingContext,
    candidate.fullLine,
    candidate.sourceText,
  ]
    .filter(Boolean)
    .join('\n');
}

function dateKeyFromContext(lower) {
  if (
    /recording[\s\S]{0,160}commence/.test(lower) ||
    /commence\s+on\s+or\s+about/.test(lower) ||
    /on\s+or\s+about/.test(lower) ||
    /recording start/.test(lower) ||
    /begin\s+(preproduction|rehearsals|recording)/.test(lower) ||
    /producer\s+agrees\s+to\s+begin[\s\S]{0,120}recording\s+on/.test(lower) ||
    /recording\s+on\s+_{2,}/.test(lower)
  ) {
    return 'recordingStartDate';
  }
  if (/accepted|agreed and accepted|acceptance/.test(lower)) {
    return 'acceptedDate';
  }

  if (/continue\s+until|expire|expiration|ending|end date|until|through|term.*end/.test(lower)) {
    return 'termEndDate';
  }

  if (/signature|signed|signing|executed by/.test(lower)) {
    return 'signatureDate';
  }

  if (/effective/.test(lower)) {
    return 'effectiveDate';
  }

  return 'agreementDate';
}

function signatureKeyFromContext(lower) {
  if (/publisher\s+writer|publisher[\s\S]{0,120}writer/.test(lower)) return 'publisherSignature';
  if (/writer[\s\S]{0,120}publisher/.test(lower)) return 'writerSignature';

  if (/publisher/.test(lower)) return 'publisherSignature';
  if (/writer|songwriter|composer/.test(lower)) return 'writerSignature';
  if (/producer/.test(lower)) return 'producerSignature';
  if (/artist|performer|musician/.test(lower)) return 'artistSignature';
  if (/record company|company|label/.test(lower)) return 'companySignature';
  if (/manager|management/.test(lower)) return 'managerSignature';
  if (/licensor/.test(lower)) return 'licensorSignature';
  if (/licensee/.test(lower)) return 'licenseeSignature';

  return 'signature';
}

function partyKeyFromContext(lower) {
  const nameish =
    /\(\s*name\s*\)|name|by and between|between|dear|addressed to|hereinafter|professionally known as|p\/k\/a|known as/.test(lower);

  const addressish =
    /\(\s*address\s*\)|address|location/.test(lower);

  if (/dear\s+(mr|ms|mrs|sir|madam)?/.test(lower)) return 'recipientName';

  if (/hereinafter\s+referred\s+to\s+as\s+(the\s+)?producer/.test(lower)) return 'producerName';
  if (/hereinafter\s+referred\s+to\s+as\s+(the\s+)?artist/.test(lower)) return 'artistName';
  if (/professionally\s+known\s+as|p\/k\/a|known\s+as/.test(lower) && /artist/.test(lower)) return 'artistName';

  if (/publisher/.test(lower)) return addressish ? 'publisherAddress' : 'publisherName';
  if (/writer|songwriter|composer/.test(lower)) return addressish ? 'writerAddress' : 'writerName';

  if (/producer/.test(lower) && nameish) return 'producerName';
  if (/artist|performer|musician/.test(lower) && nameish) return 'artistName';
  if (/manager|management/.test(lower) && nameish) return 'managerName';
  if (/record company|company/.test(lower) && nameish) return 'companyName';
  if (/label/.test(lower) && nameish) return 'labelName';
  if (/licensor/.test(lower) && nameish) return 'licensorName';
  if (/licensee/.test(lower) && nameish) return 'licenseeName';

  if (/address|location/.test(lower)) return 'address';

  return '';
}

function paymentKeyFromContext(lower) {
  // "balance of this Agreement" is legal wording, not a money blank.
  if (/balance\s+of\s+this\s+agreement/.test(lower)) return '';

  if (/advance|upfront/.test(lower)) return 'advanceAmount';
  if (/deposit/.test(lower)) return 'depositAmount';
  if (/balance/.test(lower) && /\$|amount|payment|paid|due/.test(lower)) return 'balanceAmount';
  if (/fee/.test(lower)) return 'feeAmount';
  if (/payment|compensation|wage|salary|\$/.test(lower)) return 'paymentAmount';

  return '';
}

function royaltyKeyFromContext(lower) {
  if (!/royalt|percent|percentage|points|commission|%/.test(lower)) return '';

  if (/commission/.test(lower)) return 'commissionPercentage';

  if (/base|basis|suggested retail|retail list|wholesale|net sales|gross sales|receipts/.test(lower)) {
    return 'royaltyBasePercentage';
  }

  return 'royaltyRate';
}

function normalizeType(value, fallback = 'text') {
  const type = String(value || fallback)
    .replace(/^dropdown$|^radio$/i, 'select')
    .toLowerCase();

  if (type === 'list' || type === 'count') return 'textarea';

  return fieldTypes.has(type) ? type : 'text';
}

function categoryFromContext(context = '') {
  const lower = context.toLowerCase();

  if (/signature|signed|accepted|agreed/.test(lower)) return 'signatures';
  if (/date|dated|effective|day of|20__|20____/.test(lower)) return 'dates';
  if (/\$|fee|payment|advance|royalt|percent|commission|recoup/.test(lower)) return 'payment';
  if (/ownership|rights?|license|territory|exclusive|master|copyright/.test(lower)) return 'rights';
  if (/artist|producer|company|label|manager|publisher|licensor|licensee|writer|songwriter/.test(lower)) return 'parties';
  if (/term|duration|deliver|service|expires|ending|record sides/.test(lower)) return 'deal_terms';

  return 'other';
}

function inferFieldDescriptor({ label = '', context = '', sourceText = '', order = 1, fallbackType = 'text' } = {}) {
  const rawContext = compact(context || sourceText || label);
  const lower = rawContext.toLowerCase();

  let key = '';
  let type = 'text';
  let category = 'other';

  // 1. Signatures first.
  if (/signature|signed|accepted|agreed|sincerely yours|by:|in witness whereof|publisher\s+writer/.test(lower)) {
    key = signatureKeyFromContext(lower);
    type = 'signature';
    category = 'signatures';
  }

  // 2. Date blanks.
  if (!key && (/date|dated|day of|effective|\b(?:19|20)__/.test(lower) || /\b(?:19|20)_{2,}\b/.test(sourceText))) {
    key = dateKeyFromContext(lower);
    type = 'date';
    category = 'dates';
  }

  // 3. Recording side count.
  if (!key && /record\s+sides|sides\s+shall\s+be\s+recorded|number\s+of\s+record/.test(lower)) {
    key = 'recordSides';
    type = 'number';
    category = 'deal_terms';
  }

  // 4. Label blanks should beat royalty/project guesses.
  if (!key && /label/.test(lower) && /other\s+than|released\s+on|release|outside|phonograph|record/.test(lower)) {
    key = 'labelName';
    type = 'text';
    category = 'parties';
  }

  // 5. Party names should beat project-title guesses.
  if (!key) {
    const partyKey = partyKeyFromContext(lower);
    if (partyKey) {
      key = partyKey;
      type = partyKey.endsWith('Address') || partyKey === 'address' ? 'textarea' : 'text';
      category = 'parties';
    }
  }

  // 6. Money blanks.
  if (!key) {
    const paymentKey = paymentKeyFromContext(lower);
    if (paymentKey) {
      key = paymentKey;
      type = 'currency';
      category = 'payment';
    }
  }

  // 7. Royalty blanks.
  if (!key) {
    const royaltyKey = royaltyKeyFromContext(lower);
    if (royaltyKey) {
      key = royaltyKey;
      type = 'percentage';
      category = 'payment';
    }
  }

  if (!key && /state|governed by|laws of/.test(lower)) {
    key = 'governingState';
    type = 'text';
    category = 'deal_terms';
  }

  if (!key && /territory|worldwide|country|universe/.test(lower)) {
    key = 'territory';
    type = 'text';
    category = 'rights';
  }

  if (!key && /continue\s+until|term|duration|period|expires|ending|until/.test(lower)) {
    key = /continue\s+until|expires|ending|until/.test(lower) ? 'termEndDate' : 'term';
    type = key === 'termEndDate' ? 'date' : 'text';
    category = 'deal_terms';
  }

  // Only use projectTitle when there is no strong party/payment/date match.
  if (!key && /song|title|composition|recording|master|project|work/.test(lower)) {
    key = 'projectTitle';
    type = 'text';
    category = 'deal_terms';
  }

  if (!key) {
    key = toCamelCase(label) || `blank${order}`;
    type = normalizeType(fallbackType || 'text');
    category = categoryFromContext(rawContext);
  }

  const finalType = normalizeType(type, fallbackType || 'text');

  return {
    key,
    label: titleFromKey(key),
    type: finalType,
    category: categories.has(category) ? category : categoryFromContext(rawContext),
  };
}

function labelFromContext(candidate) {
  const descriptor = inferFieldDescriptor({
    context: contextForCandidate(candidate),
    sourceText: candidate.sourceText,
    order: candidate.order,
    fallbackType: candidate.guessedType,
  });

  return descriptor.label || `Blank ${candidate.order}`;
}

function betterKeyFromContext(label, context = '') {
  return inferFieldDescriptor({ label, context }).key;
}

function stableContextKey(value = '') {
  return compact(value)
    .toLowerCase()
    .replace(/_{2,}/g, '_')
    .replace(/\bblank_\d+\b/g, 'blank')
    .slice(0, 180);
}

function mergeFields(group) {
  const first = group[0];
  const candidateIds = [...new Set(group.flatMap((field) => field.candidateIds || []))];
  const sourceText = [...new Set(group.map((field) => field.sourceText).filter(Boolean))].join(' | ');
  const surroundingContext = first.surroundingContext || group.map((field) => field.surroundingContext).filter(Boolean)[0] || '';

  return {
    ...first,
    candidateIds,
    sourceText,
    surroundingContext,
    required: group.some((field) => field.required),
    confidence: group.some((field) => field.confidence === 'low') ? 'medium' : first.confidence,
    order: Math.min(...group.map((field) => Number(field.order) || 999)),
  };
}

function mergeDateFragments(fields) {
  const groups = [];
  const passthrough = [];

  for (const field of fields) {
    const context = String(field.surroundingContext || '').toLowerCase();

    const looksLikeDate =
      field.type === 'date' ||
      field.key.toLowerCase().includes('date') ||
      /day of|20__|20____|dated|effective|commence|continue until/.test(context);

    if (!looksLikeDate) {
      passthrough.push(field);
      continue;
    }

    const descriptor = inferFieldDescriptor({
      label: field.label,
      context: field.surroundingContext,
      sourceText: field.sourceText,
      order: field.order,
      fallbackType: field.type,
    });

    const normalizedField = {
      ...field,
      key: descriptor.key,
      label: descriptor.label,
      type: descriptor.type,
      category: descriptor.category,
    };

    const existingGroup = groups.find((group) => {
      const first = group[0];
      const sameKey = first.key === normalizedField.key;
      const closeOrder = Math.abs((first.order || 0) - (normalizedField.order || 0)) <= 3;

      const firstContext = stableContextKey(first.surroundingContext);
      const currentContext = stableContextKey(normalizedField.surroundingContext);

      const similarContext =
        firstContext &&
        currentContext &&
        (
          firstContext.includes(currentContext.slice(0, 60)) ||
          currentContext.includes(firstContext.slice(0, 60)) ||
          firstContext.slice(0, 90) === currentContext.slice(0, 90)
        );

      return sameKey && (closeOrder || similarContext);
    });

    if (existingGroup) {
      existingGroup.push(normalizedField);
    } else {
      groups.push([normalizedField]);
    }
  }

  const merged = groups.map(mergeFields);

  return [...passthrough, ...merged].sort((a, b) => (a.order || 0) - (b.order || 0));
}

function mergeRelatedFields(fields) {
  const groups = new Map();

  for (const field of fields) {
    const descriptor = inferFieldDescriptor({
      label: field.label,
      context: field.surroundingContext,
      sourceText: field.sourceText,
      order: field.order,
      fallbackType: field.type,
    });

    const normalized = {
      ...field,
      key: descriptor.key,
      label: descriptor.label,
      type: descriptor.type,
      category: descriptor.category,
    };

    const lower = String(normalized.surroundingContext || '').toLowerCase();

    let groupKey = normalized.key;

    if (/(publisher|writer|songwriter).*(\(\s*name\s*\)|\(\s*address\s*\))/.test(lower)) {
      groupKey = normalized.key;
    } else if (/(royalt|percent|percentage|commission|points)/.test(lower)) {
      groupKey = normalized.key;
    } else if (/signature|signed|accepted|agreed|in witness whereof|publisher\s+writer/.test(lower)) {
  groupKey = /publisher\s+writer/.test(lower)
    ? `${normalized.key}:${normalized.order}`
    : normalized.key;
    } else if (normalized.key.endsWith('Address')) {
      groupKey = normalized.key;
    } else if (/^blank\d*$/i.test(normalized.key)) {
      groupKey = `${normalized.key}:${stableContextKey(normalized.surroundingContext)}`;
    } else if (['producerName', 'artistName', 'companyName', 'publisherName', 'writerName', 'recipientName', 'labelName'].includes(normalized.key)) {
      groupKey = `${normalized.key}:${stableContextKey(normalized.surroundingContext)}`;
    } else {
      groupKey = `${normalized.key}:${stableContextKey(normalized.surroundingContext)}`;
    }

    if (!groups.has(groupKey)) groups.set(groupKey, []);
    groups.get(groupKey).push(normalized);
  }

  return [...groups.values()]
    .map(mergeFields)
    .sort((a, b) => (a.order || 0) - (b.order || 0));
}

function alternateDuplicateKey(baseKey, field, usedKeys) {
  const lower = String(field.surroundingContext || '').toLowerCase();

  const candidates = [];

  if (baseKey === 'publisherSignature' && /writer|songwriter/.test(lower)) {
    candidates.push('writerSignature');
  }

  if (baseKey === 'writerSignature' && /publisher/.test(lower)) {
    candidates.push('publisherSignature');
  }

  if (baseKey === 'companySignature' && /producer/.test(lower)) {
    candidates.push('producerSignature');
  }

  if (baseKey === 'producerSignature' && /artist/.test(lower)) {
    candidates.push('artistSignature');
  }

  if (baseKey === 'publisherName' && /writer|songwriter/.test(lower)) {
    candidates.push('writerName');
  }

  if (baseKey === 'publisherAddress' && /writer|songwriter/.test(lower)) {
    candidates.push('writerAddress');
  }

  if (baseKey === 'projectTitle' && /producer|hereinafter referred to as the producer/.test(lower)) {
    candidates.push('producerName');
  }

  if (baseKey === 'projectTitle' && /artist|professionally known as/.test(lower)) {
    candidates.push('artistName');
  }

  for (const candidate of candidates) {
    if (!usedKeys.has(candidate)) {
      return candidate;
    }
  }

  return '';
}

function makeUniqueKeys(fields) {
  const usedKeys = new Set();
  const counts = new Map();

  return fields.map((field) => {
    const descriptor = inferFieldDescriptor({
      label: field.label,
      context: field.surroundingContext,
      sourceText: field.sourceText,
      order: field.order,
      fallbackType: field.type,
    });

    let baseKey = descriptor.key || field.key || 'field';

    if (usedKeys.has(baseKey)) {
      const alternate = alternateDuplicateKey(baseKey, field, usedKeys);

      if (alternate) {
        baseKey = alternate;
      }
    }

    const count = counts.get(baseKey) || 0;
    counts.set(baseKey, count + 1);

    const nextField = {
      ...field,
      key: baseKey,
      label: titleFromKey(baseKey),
      type: descriptor.type || field.type,
      category: descriptor.category || field.category,
    };

    if (count === 0 && !usedKeys.has(baseKey)) {
      usedKeys.add(baseKey);
      return nextField;
    }

    const finalKey = `${baseKey}${count + 1}`;
    usedKeys.add(finalKey);

    return {
      ...nextField,
      key: finalKey,
      label: titleFromKey(finalKey),
      confidence: nextField.confidence === 'high' ? 'medium' : nextField.confidence,
    };
  });
}

function cleanAndMergeFields(fields) {
  let cleaned = fields
    .filter((field) => field?.key && field?.label)
    .map((field, index) => {
      const descriptor = inferFieldDescriptor({
        label: field.label,
        context: field.surroundingContext,
        sourceText: field.sourceText,
        order: field.order || index + 1,
        fallbackType: field.type,
      });

      return {
        ...field,
        key: descriptor.key,
        label: descriptor.label,
        type: descriptor.type,
        category: descriptor.category,
        order: Number.isFinite(Number(field.order)) ? Number(field.order) : index + 1,
      };
    });

  cleaned = mergeDateFragments(cleaned);
  cleaned = mergeRelatedFields(cleaned);
  cleaned = makeUniqueKeys(cleaned);

  return cleaned.slice(0, 100);
}

function cleanWarning(warning, index) {
  return {
    type: String(warning?.type || 'warning').slice(0, 80),
    message: String(warning?.message || 'This item should be reviewed.').slice(0, 300),
    context: String(warning?.context || '').slice(0, 700),
    candidateIds: Array.isArray(warning?.candidateIds) ? warning.candidateIds.slice(0, 10) : [],
    order: Number.isFinite(Number(warning?.order)) ? Number(warning.order) : index + 1,
  };
}

function deterministicSchema({ contractText, blankCandidates }) {
  const candidates = blankCandidates
    .map(normalizeCandidate)
    .filter(hasRealBlank)
    .slice(0, 100);

  let fields = candidates.map((candidate) => {
    const context = contextForCandidate(candidate);
    const descriptor = inferFieldDescriptor({
      label: labelFromContext(candidate),
      context,
      sourceText: candidate.sourceText,
      order: candidate.order,
      fallbackType: candidate.guessedType,
    });
    const risky = riskyPattern.test(context);

    return {
      key: descriptor.key,
      label: descriptor.label,
      type: descriptor.type,
      required: risky,
      confidence: risky ? 'medium' : 'low',
      sourceText: candidate.sourceText,
      surroundingContext: context,
      category: descriptor.category,
      order: candidate.order,
      candidateIds: [candidate.id],
    };
  });

  fields = cleanAndMergeFields(fields);

  const warnings = candidates
    .filter((candidate) => riskyPattern.test(contextForCandidate(candidate)))
    .map((candidate) => ({
      type: 'risky_blank',
      message: 'This blank touches business or legal terms and should be reviewed by a person.',
      context: contextForCandidate(candidate),
      candidateIds: [candidate.id],
      order: candidate.order,
    }));

  return {
    templateName: 'Contract Template',
    fields,
    warnings,
    reviewRequired: warnings.length > 0 || fields.some((field) => field.confidence !== 'high'),
    source: 'deterministic_fallback',
  };
}

function normalizeForMatch(value = '') {
  return String(value)
    .toLowerCase()
    .replace(/_+/g, ' ')
    .replace(/[^a-z0-9 ]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

// Word-overlap similarity (0..1) between two snippets, ignoring short/common
// words. Used to re-attach a field to a parser blank when the model dropped the
// explicit candidateId.
function wordOverlapScore(a, b) {
  const wa = new Set(normalizeForMatch(a).split(' ').filter((word) => word.length > 3));
  const wb = normalizeForMatch(b).split(' ').filter((word) => word.length > 3);
  if (!wa.size || !wb.length) return 0;

  let hit = 0;
  for (const word of wb) {
    if (wa.has(word)) hit += 1;
  }

  return hit / Math.max(wa.size, wb.length);
}

// Small local models (e.g. qwen2.5:7b) frequently omit the required candidateIds
// array even though they label the field well. Rather than discard that work,
// re-attach the parser blank deterministically: prefer an exact order match
// (the model's order tracks the parser's candidate order), then fall back to the
// unused candidate whose surrounding text best overlaps the field.
function recoverCandidateIds(field, normalizedCandidates, candidateByOrder, usedCandidateIds) {
  const fieldOrder = Number(field?.order);

  if (Number.isFinite(fieldOrder)) {
    const byOrder = candidateByOrder.get(fieldOrder);
    if (byOrder && !usedCandidateIds.has(byOrder.id)) {
      return [byOrder.id];
    }
  }

  const fieldText = `${field?.sourceText || ''} ${field?.surroundingContext || ''}`;
  let best = null;
  let bestScore = 0;

  for (const candidate of normalizedCandidates) {
    if (usedCandidateIds.has(candidate.id)) continue;
    const score = wordOverlapScore(contextForCandidate(candidate), fieldText);
    if (score > bestScore) {
      bestScore = score;
      best = candidate;
    }
  }

  return best && bestScore >= 0.34 ? [best.id] : [];
}

function cleanField(field, index, ctx) {
  const { candidateById, normalizedCandidates = [], candidateByOrder, usedCandidateIds } = ctx;

  const providedIds = Array.isArray(field?.candidateIds)
    ? field.candidateIds.map(String).filter((id) => candidateById.has(id))
    : [];

  // Keep valid model-supplied IDs; otherwise recover them deterministically.
  let candidateIds = providedIds;
  if (!candidateIds.length) {
    candidateIds = recoverCandidateIds(field, normalizedCandidates, candidateByOrder, usedCandidateIds);
  }
  for (const id of candidateIds) {
    usedCandidateIds.add(id);
  }

  const candidates = candidateIds
    .map((id) => candidateById.get(id))
    .filter(Boolean);

  const candidateContext = candidates
    .map((candidate) => contextForCandidate(candidate))
    .filter(Boolean)
    .join('\n');

  const context = String(
    field?.surroundingContext ||
      field?.context ||
      candidateContext ||
      '',
  ).slice(0, 1000);

  const descriptor = inferFieldDescriptor({
    label: field?.label || labelFromContext({ surroundingContext: context, order: index + 1 }),
    context,
    sourceText: field?.sourceText || candidates.map((candidate) => candidate.sourceText).join(' | '),
    order: Number.isFinite(Number(field?.order)) ? Number(field.order) : index + 1,
    fallbackType: field?.type,
  });

  return {
    key: descriptor.key,
    label: descriptor.label,
    type: descriptor.type,
    required: Boolean(field?.required),
    confidence: ['high', 'medium', 'low'].includes(field?.confidence) ? field.confidence : 'low',
    sourceText: String(field?.sourceText || candidates.map((candidate) => candidate.sourceText).join(' | ')).slice(0, 300),
    surroundingContext: context,
    category: descriptor.category,
    order: Number.isFinite(Number(field?.order)) ? Number(field.order) : index + 1,
    candidateIds,
  };
}

function validateSchema(response, fallback, source = 'ai', normalizedCandidates = []) {
  if (!response || !Array.isArray(response.fields)) {
    return {
      ...fallback,
      fields: cleanAndMergeFields(fallback.fields || []),
    };
  }

  const candidateById = new Map(normalizedCandidates.map((candidate) => [candidate.id, candidate]));
  const candidateByOrder = new Map(normalizedCandidates.map((candidate) => [Number(candidate.order), candidate]));
  const usedCandidateIds = new Set();
  const cleanCtx = { candidateById, candidateByOrder, normalizedCandidates, usedCandidateIds };
  const warnings = Array.isArray(response.warnings)
    ? response.warnings.map(cleanWarning).slice(0, 60)
    : [...(fallback.warnings || [])];

  let fields = response.fields
    .map((field, index) => cleanField(field, index, cleanCtx))
    .filter((field) => {
      if (!field.key || !field.label) return false;

      if (!field.candidateIds.length) {
        warnings.push({
          type: 'removed_field_without_candidate',
          message: `Removed "${field.label}" because it was not tied to a parser blank candidate.`,
          context: field.surroundingContext,
          candidateIds: [],
        });
        return false;
      }

      const candidates = field.candidateIds
        .map((id) => candidateById.get(id))
        .filter(Boolean);

      if (!candidates.length) {
        warnings.push({
          type: 'removed_field_unknown_candidate',
          message: `Removed "${field.label}" because its candidate IDs were not found.`,
          context: field.surroundingContext,
          candidateIds: field.candidateIds,
        });
        return false;
      }

      if (!candidates.some(hasRealBlank)) {
        warnings.push({
          type: 'removed_field_without_real_blank',
          message: `Removed "${field.label}" because the supporting text did not contain a real blank.`,
          context: field.surroundingContext,
          candidateIds: field.candidateIds,
        });
        return false;
      }

      return true;
    })
    .slice(0, 100);

  fields = cleanAndMergeFields(fields);

  if (!fields.length) {
    return {
      ...fallback,
      fields: cleanAndMergeFields(fallback.fields || []),
      warnings: [
        ...(fallback.warnings || []),
        {
          type: 'ai_fields_removed',
          message: 'AI returned fields, but none were tied to valid parser blank candidates. Used deterministic fallback.',
          context: `source=${source}`,
          candidateIds: [],
        },
      ],
      reviewRequired: true,
      source: `${source}_fallback_after_cleanup`,
    };
  }

  return {
    templateName: String(response.templateName || fallback.templateName || 'Contract Template').slice(0, 160),
    fields,
    warnings,
    reviewRequired: Boolean(
      response.reviewRequired ||
        warnings.length > 0 ||
        fields.some((field) => field.confidence !== 'high') ||
        fallback.reviewRequired,
    ),
    source,
  };
}

function reviewFallback(fallback, { provider = 'ai', message = 'AI scan could not return valid JSON.' } = {}) {
  return {
    ...fallback,
    fields: cleanAndMergeFields(fallback.fields || []),
    warnings: [
      ...(fallback.warnings ?? []),
      {
        type: 'ai_json_parse_failed',
        message,
        context: `provider=${provider}`,
        candidateIds: [],
      },
    ],
    reviewRequired: true,
    source: `${provider}_review_fallback`,
  };
}

export async function scanFieldsWithAI({ contractText, blankCandidates }) {
  const normalizedCandidates = Array.isArray(blankCandidates)
    ? blankCandidates.map(normalizeCandidate).filter(hasRealBlank)
    : [];

  const fallback = deterministicSchema({
    contractText,
    blankCandidates: normalizedCandidates,
  });

  if (!String(contractText ?? '').trim()) {
    return fallback;
  }

  if (!normalizedCandidates.length) {
    return {
      templateName: 'Contract Template',
      fields: [],
      warnings: [
        {
          type: 'no_blank_candidates',
          message: 'The parser did not find any real blanks, underscores, placeholders, or empty fillable areas.',
          context: '',
          candidateIds: [],
        },
      ],
      reviewRequired: true,
      source: 'no_blank_candidates',
    };
  }

  const result = await requestAIJsonResult({
    messages: [
      {
        role: 'system',
        content: `
You are a contract template field-labeling assistant.

Return strict JSON only.

Critical rules:
1. Your job is to label parser-detected blank candidates. Do not invent fields from the contract.
2. Only create fields for actual blank candidates listed in blankCandidates.
3. Every field MUST include candidateIds with one or more IDs from blankCandidates.
4. If a field has no supporting candidateId, do not include it.
5. Do not create fields from fixed clauses that already contain values.
6. Fixed royalty rates, fixed term lengths, fixed recoupment clauses, fixed exclusivity clauses, and fixed payment terms should become warnings only, not fields.
7. Create a field only when the candidate text contains underscores, a 20____ date fragment, an empty parenthetical, or a placeholder.
8. Merge related date fragments such as "____ day of ____, 20____" into one date field. Use agreementDate, effectiveDate, acceptedDate, recordingStartDate, termEndDate, or signatureDate based on context.
9. Do not create repeated generic fields like agreementDate2, agreementDate3, blank99, blank1010.
10. Use meaningful field keys based on surrounding context.
11. Signature lines should be signature fields with specific keys like producerSignature, artistSignature, publisherSignature, writerSignature, or companySignature.
12. If a blank touches legal/business terms, include it as a field and also include a warning.
13. If a legal/business clause is risky but already filled in, include a warning only.
14. For patterns like "____ (name) ____" or "____ (address) ____", create one logical field, not two.
15. For royalty word/number pairs, create one logical royalty field when they refer to the same rate.

Allowed field types:
text, textarea, date, currency, number, percentage, select, signature

Allowed categories:
parties, deal_terms, dates, payment, rights, signatures, other

Good keys:
agreementDate, effectiveDate, acceptedDate, recordingStartDate, termEndDate, signatureDate, producerName, artistName, companyName, labelName, publisherName, publisherAddress, writerName, writerAddress, recipientName, recordSides, advanceAmount, paymentAmount, royaltyRate, royaltyBasePercentage, commissionPercentage, termEndDate, territory, governingState, companySignature, producerSignature, artistSignature, publisherSignature, writerSignature.
        `.trim(),
      },
      {
        role: 'user',
        content: JSON.stringify({
          task: 'Label only the parser-detected blank candidates and create a reusable form schema.',
          outputSchema: {
            templateName: 'string',
            fields: [
              {
                key: 'camelCase string',
                label: 'human readable label',
                type: 'text | textarea | date | currency | number | percentage | select | signature',
                required: 'boolean',
                confidence: 'high | medium | low',
                sourceText: 'exact nearby blank text',
                surroundingContext: 'short context around blank',
                category: 'parties | deal_terms | dates | payment | rights | signatures | other',
                order: 'number',
                candidateIds: ['blank_001'],
              },
            ],
            warnings: [
              {
                type: 'risky_blank | fixed_risky_clause | low_confidence | extraction_issue',
                message: 'string',
                context: 'string',
                candidateIds: ['blank_001'],
              },
            ],
            reviewRequired: 'boolean',
          },
          riskyTermsToFlag: [
            'royalty rate',
            'ownership',
            'rights',
            'term',
            'territory',
            'payment',
            'recoupment',
            'termination',
            'exclusivity',
            'signature',
            'dates',
            'legal entity names',
            'publisher',
            'writer',
            'artist',
            'producer',
            'company',
          ],
          blankCandidates: normalizedCandidates.slice(0, 100).map((candidate) => ({
            id: candidate.id,
            order: candidate.order,
            sourceText: candidate.sourceText,
            fullLine: candidate.fullLine,
            surroundingContext: candidate.surroundingContext,
            guessedType: candidate.guessedType,
            lineNumber: candidate.lineNumber,
            kind: candidate.kind,
          })),
          contractTextForContextOnlyDoNotInventFieldsFromThis: String(contractText).slice(0, 10000),
        }),
      },
    ],
    maxTokens: 3600,
    retryInvalidJson: true,
  });

  if (result.error?.type === 'invalid_json') {
    return reviewFallback(fallback, {
      provider: result.provider,
      message: 'AI model returned invalid JSON after one retry. Template needs human review.',
    });
  }

  if (!result.json && result.error) {
    return reviewFallback(fallback, {
      provider: result.provider,
      message: `${result.provider} scan was unavailable: ${result.error.message}`,
    });
  }

  return validateSchema(result.json, fallback, result.provider, normalizedCandidates);
}