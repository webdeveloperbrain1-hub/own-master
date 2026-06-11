import { cleanTemplateText } from './templateTextCleaner.mjs';

const FIELD_TYPES = new Set([
  'text',
  'textarea',
  'number',
  'percentage',
  'currency',
  'dropdown',
  'checkbox',
  'radio',
  'date',
  'list',
  'count',
  'signature',
]);

const fieldHints = [
  {
    id: 'agreementDate',
    patterns: [/date|dated|effective|execution/],
    label: 'What is the agreement date?',
    placeholder: 'January 1, 2026, or leave blank',
    type: 'date',
    section: 'Basic deal details',
  },
  {
    id: 'artistName',
    patterns: [/artist|performer|recording artist/],
    label: 'Who is the artist or performer?',
    placeholder: 'Artist legal or professional name',
    type: 'text',
    section: 'Parties',
  },
  {
    id: 'producerName',
    patterns: [/producer|beat maker|production/],
    label: 'Who is the producer?',
    placeholder: 'Producer legal name',
    type: 'text',
    section: 'Parties',
  },
  {
    id: 'companyName',
    patterns: [/company|label|record company|payer|client/],
    label: 'What is the company, label, or payer name?',
    placeholder: 'Company, label, or payer legal name',
    type: 'text',
    section: 'Parties',
  },
  {
    id: 'managerName',
    patterns: [/manager|management/],
    label: 'Who is the manager or management company?',
    placeholder: 'Manager or management company legal name',
    type: 'text',
    section: 'Parties',
  },
  {
    id: 'publisherName',
    patterns: [/publisher|publishing company|administrator/],
    label: 'Who is the publisher or administrator?',
    placeholder: 'Publisher or administrator legal name',
    type: 'text',
    section: 'Parties',
  },
  {
    id: 'songwriterName',
    patterns: [/songwriter|writer|composer/],
    label: 'Who is the songwriter or composer?',
    placeholder: 'Songwriter or composer name',
    type: 'text',
    section: 'Parties',
  },
  {
    id: 'licensorName',
    patterns: [/licensor|rights holder|grantor/],
    label: 'Who is granting the rights?',
    placeholder: 'Licensor or rights holder',
    type: 'text',
    section: 'Parties',
  },
  {
    id: 'licenseeName',
    patterns: [/licensee|production company|recipient of rights/],
    label: 'Who is receiving the rights?',
    placeholder: 'Licensee or production company',
    type: 'text',
    section: 'Parties',
  },
  {
    id: 'projectTitle',
    patterns: [/song|track|title|project|work|composition|recording|master/],
    label: 'What song, master, project, or work is covered?',
    placeholder: 'Song, master, project, or composition title',
    type: 'text',
    section: 'Work covered',
  },
  {
    id: 'masterCount',
    patterns: [/number|count|how many|master recordings/],
    label: 'How many masters or recordings are covered?',
    placeholder: '1, 3, album, EP, or leave blank',
    type: 'number',
    section: 'Work covered',
  },
  {
    id: 'advanceAmount',
    patterns: [/advance|upfront|recoupable/],
    label: 'What advance or upfront payment applies?',
    placeholder: '$500, $2,500, none, or leave blank',
    type: 'currency',
    section: 'Money',
    optional: true,
    helpText: 'An advance is usually money paid before royalties are fully earned.',
  },
  {
    id: 'compensation',
    patterns: [/fee|payment|compensation|dollars|guarantee|deposit/],
    label: 'What are the payment or compensation terms?',
    placeholder: 'Flat fee, advance, commission, royalty, guarantee, or leave blank',
    type: 'textarea',
    section: 'Money',
  },
  {
    id: 'royaltyPercentage',
    patterns: [/royalty|royalties|percentage|percent|points|net receipts|gross receipts|cents/],
    label: 'What royalty rate, points, or percentage applies?',
    placeholder: '3%, 15%, 2.75 cents per side, or leave blank',
    type: 'percentage',
    section: 'Money',
    optional: true,
    helpText: 'Royalty language affects how future income is calculated and paid.',
  },
  {
    id: 'commissionRate',
    patterns: [/commission/],
    label: 'What commission percentage applies?',
    placeholder: '15%, 20%, or leave blank',
    type: 'percentage',
    section: 'Money',
    optional: true,
  },
  {
    id: 'paymentSchedule',
    patterns: [/statement|payment schedule|monthly|quarterly|semi-annually|accounting|paid/],
    label: 'How often should payments or statements happen?',
    placeholder: 'Monthly, quarterly, semi-annually, after show, or leave blank',
    type: 'dropdown',
    options: ['Monthly', 'Quarterly', 'Semi-annually', 'Annually', 'After delivery', 'After performance', 'Other'],
    section: 'Money',
    optional: true,
  },
  {
    id: 'term',
    patterns: [/term|duration|period|expire|expiration|perpetual|years/],
    label: 'How long should the agreement last?',
    placeholder: '1 year, 3 years, campaign period, perpetual, or leave blank',
    type: 'text',
    section: 'Scope',
    optional: true,
  },
  {
    id: 'territory',
    patterns: [/territory|worldwide|universe|country|united states|foreign/],
    label: 'What territory applies?',
    placeholder: 'Worldwide, United States, specific countries, or leave blank',
    type: 'text',
    section: 'Scope',
    optional: true,
  },
  {
    id: 'licenseType',
    patterns: [/exclusive|non-exclusive|license type/],
    label: 'Is the license exclusive or non-exclusive?',
    placeholder: 'Choose the license type',
    type: 'radio',
    options: ['Non-exclusive', 'Exclusive', 'Not sure'],
    section: 'Rights',
    optional: true,
    helpText: 'Exclusive usually means the rights are limited to one licensee for the stated scope.',
  },
  {
    id: 'licensedUse',
    patterns: [/licensed use|use in|media|film|tv|commercial|advertising|video|game|sync/],
    label: 'What use is being licensed?',
    placeholder: 'Film, ad, YouTube video, game, trailer, social campaign',
    type: 'textarea',
    section: 'Rights',
    optional: true,
  },
  {
    id: 'ownershipTerms',
    patterns: [/ownership|own|rights|copyright|master|publishing|approval|control/],
    label: 'What ownership, rights, or approval terms should be confirmed?',
    placeholder: 'Who owns the master or publishing, approval rights, or license scope',
    type: 'textarea',
    section: 'Rights',
    optional: true,
  },
  {
    id: 'deliverables',
    patterns: [/deliver|delivery|deliverables|stems|files|masters|artwork|posts/],
    label: 'What deliverables are required?',
    placeholder: 'Masters, stems, artwork, posts, performance, files, approvals',
    type: 'textarea',
    section: 'Obligations',
    optional: true,
  },
  {
    id: 'services',
    patterns: [/services|obligations|duties|perform|recording sessions|promotion/],
    label: 'What services or obligations are required?',
    placeholder: 'Recording, management, performance, promotion, distribution, or licensing support',
    type: 'textarea',
    section: 'Obligations',
    optional: true,
  },
];

export function normalizeText(text = '') {
  return cleanTemplateText(String(text))
    .replace(/\r/g, '\n')
    .replace(/[ \t]+/g, ' ')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

function isUsableTemplateText(text = '') {
  const sample = String(text).slice(0, 4000);
  const legalWords = (sample.match(/\b(agreement|artist|producer|company|license|manager|publisher|performance|royalty|term|venue|sponsor|rights)\b/gi) ?? []).length;
  const binaryMarkers = (sample.match(/\b(Linearized|FlateDecode|ObjStm|endobj|trailer|BaseFont|FontDescriptor|Default Paragraph Font)\b/g) ?? []).length;

  return legalWords >= 4 && binaryMarkers < 5;
}

function toCamelCase(value) {
  return String(value)
    .replace(/\[[^\]]+\]/g, (match) => match.slice(1, -1))
    .replace(/[^a-zA-Z0-9]+(.)/g, (_, char) => char.toUpperCase())
    .replace(/^[A-Z]/, (char) => char.toLowerCase())
    .replace(/[^a-zA-Z0-9]/g, '');
}

function toTitle(value) {
  return String(value)
    .replace(/([a-z])([A-Z])/g, '$1 $2')
    .replace(/[_-]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/\b\w/g, (char) => char.toUpperCase());
}

function uniqueFieldId(base, fields) {
  const cleanBase = toCamelCase(base) || 'templateField';
  let id = cleanBase;
  let suffix = 2;

  while (fields.some((field) => field.id === id)) {
    id = `${cleanBase}${suffix}`;
    suffix += 1;
  }

  return id;
}

function contextAround(text, index, length, size = 140) {
  return text.slice(Math.max(0, index - size), Math.min(text.length, index + length + size));
}


function lineInfoAroundIndex(text, index) {
  const before = text.slice(0, index);
  const lineNumber = before.split('\n').length;

  const lineStart = text.lastIndexOf('\n', Math.max(0, index - 1)) + 1;
  const nextBreak = text.indexOf('\n', index);
  const lineEnd = nextBreak === -1 ? text.length : nextBreak;

  const fullLine = text.slice(lineStart, lineEnd).trim();

  const previousLineStart = text.lastIndexOf('\n', Math.max(0, lineStart - 2)) + 1;
  const previousLine = text.slice(previousLineStart, Math.max(0, lineStart - 1)).trim();

  const nextLineStart = lineEnd + 1;
  const nextLineBreak = text.indexOf('\n', nextLineStart);
  const nextLineEnd = nextLineBreak === -1 ? text.length : nextLineBreak;
  const nextLine = text.slice(nextLineStart, nextLineEnd).trim();

  return {
    lineNumber,
    fullLine,
    previousLine,
    nextLine,
  };
}

function rangesOverlap(aStart, aEnd, bStart, bEnd) {
  return aStart < bEnd && bStart < aEnd;
}

function shouldSkipOverlappingRange(ranges, start, end) {
  return ranges.some((range) => rangesOverlap(start, end, range.start, range.end));
}

function normalizeBlankCandidateType(kind, label, context) {
  const lower = `${kind} ${label} ${context}`.toLowerCase();

  if (/signature|signed|accepted|agreed/.test(lower)) return 'signature';
  if (/date|dated|day of|effective|20__|20____/.test(lower)) return 'date';
  if (/money|amount|advance|fee|payment|deposit|\$/.test(lower)) return 'currency';
  if (/percent|percentage|royalty|commission|points|%/.test(lower)) return 'percentage';
  if (/address|location/.test(lower)) return 'textarea';
  if (/number|count/.test(lower)) return 'number';

  return 'text';
}

// Labels that introduce a fill-in blank when followed by a colon and empty
// space (e.g. "City:", "Date:", "Address:"). Kept curated so ordinary
// sentence-colons never become fields.
const COLON_LABEL_VOCAB =
  /^(city|state|date|dated|name|full name|by|signed|signature|sign|title|amount|sum|total|fee|price|rate|witness|address|artist|artiste|producer|master producer|talent|composer|publisher|company|record company|songwriter|writer|manager|management|label|song|track|email|e-mail|phone|telephone|tel|mobile|cell|fax|account|account number|territory|term|attention|attn|re|to|from|payee|payor|licensor|licensee|recipient|client|vendor|date of birth|dob|ssn|tax id|ein)$/i;

// Legal boilerplate that can look label-like (short / ALL CAPS) but is never a
// fill-in blank. Matched against the colon label (with and without spacing).
const COLON_LABEL_BLOCK =
  /(follow|agreed|acknowledg|witnesseth|whereof|hereby|consist|represent|presents|condition|wherein|provided|whereas|therefore|recital|entitled|notwithstanding|herein|provision|procedure|controlling)/i;

// Decide whether the text immediately before a colon is a fillable label.
// Precision-first: short phrase, in the curated vocabulary OR a short ALL-CAPS
// label, and not legal boilerplate.
function fillableColonLabel(raw) {
  const stripped = String(raw)
    .replace(/^\s*\d+[.)]\s*/, '') // leading "2." / "3)" numbering
    .replace(/^\s*[A-Za-z][.)]\s+/, '') // leading "F. " clause markers
    .trim();

  const collapsed = stripped.replace(/\s+/g, ' ').trim();
  if (!collapsed) return null;

  const words = collapsed.split(' ');
  if (collapsed.length > 32 || words.length > 4) return null;
  if (words.filter((word) => word.length === 1).length >= 3) return null; // "W I T N E S S"
  if (COLON_LABEL_BLOCK.test(collapsed) || COLON_LABEL_BLOCK.test(collapsed.replace(/\s/g, ''))) return null;

  const isAllCaps = /^[A-Z][A-Z .,'/&()-]*$/.test(collapsed) && /[A-Z]{2,}/.test(collapsed);
  const inVocab = COLON_LABEL_VOCAB.test(collapsed);

  if (!inVocab && !(isAllCaps && words.length <= 3)) return null;

  return collapsed;
}

// Find "Label:" blanks line by line and return absolute-position matches that
// reuse the same candidate-building path as the regex patterns.
function detectColonLabelMatches(normalized) {
  const matches = [];
  let offset = 0;

  for (const line of normalized.split('\n')) {
    const segRegex = /([A-Za-z][^:]{0,30}?):/g;
    let m;

    while ((m = segRegex.exec(line)) !== null) {
      const after = line.slice(m.index + m[0].length);
      // The colon must be followed by the blank: end-of-line, whitespace gap, or
      // another capitalized label ("SONG: ARTIST:"). Rejects inline "ratio:5".
      if (after !== '' && !/^[ \t]/.test(after) && !/^[A-Z]/.test(after)) continue;
      if (!fillableColonLabel(m[1])) continue;

      matches.push({ index: offset + m.index, sourceText: `${m[1]}:`, kind: 'label_colon_blank' });
    }

    offset += line.length + 1; // account for the stripped '\n'
  }

  return matches;
}

export function detectBlankCandidates(text = '') {
  const normalized = normalizeText(text);
  const candidates = [];
  const seen = new Set();
  const usedRanges = [];

  const pushCandidate = (index, sourceText, kind) => {
    const start = index;
    const end = index + sourceText.length;
    const key = `${start}:${end}:${sourceText}`;

    if (seen.has(key)) return;

    /**
     * Avoid duplicate candidates when a specific pattern and generic underscore
     * pattern match the same characters.
     */
    if (shouldSkipOverlappingRange(usedRanges, start, end)) return;

    seen.add(key);
    usedRanges.push({ start, end });

    const lineInfo = lineInfoAroundIndex(normalized, index);

    const surroundingContext = [
      lineInfo.previousLine,
      lineInfo.fullLine,
      lineInfo.nextLine,
    ]
      .filter(Boolean)
      .join('\n')
      .replace(/[ \t]+/g, ' ')
      .trim();

    const label = labelForBlank(normalized, index, sourceText.length, candidates.length);
    // For "Label:" blanks the label word itself is the reliable type signal;
    // neighbouring lines are usually other labels and pollute the guess
    // (e.g. "State:" sitting next to "Date:" gets mistyped as a date).
    const guessedType =
      kind === 'label_colon_blank'
        ? normalizeBlankCandidateType(kind, sourceText, '')
        : normalizeBlankCandidateType(kind, label, surroundingContext);

    candidates.push({
      id: `blank_${String(candidates.length + 1).padStart(3, '0')}`,
      sourceText,
      fullLine: lineInfo.fullLine,
      surroundingContext,
      guessedType,
      position: index,
      order: candidates.length + 1,
      lineNumber: lineInfo.lineNumber,
      kind,
    });
  };

  /**
   * Specific patterns should come before the generic underscore pattern.
   * That prevents "20____" or "____%" from being mislabeled as plain underscore blanks.
   */
  const patterns = [
    { kind: 'money_blank', regex: /\$\s*_{2,}|\(\s*\$\s*[_\s]{3,}\)/g },
    { kind: 'percent_blank', regex: /_{2,}\s*%/g },
    { kind: 'date_fragment', regex: /\b(?:19|20)_{2,}\b/g },
    { kind: 'parenthetical_blank', regex: /\(\s*[_\s]{4,}\)/g },
    { kind: 'bracket_placeholder', regex: /\[\s*[A-Z0-9_ -]{2,}\s*\]/gi },
    { kind: 'mustache_placeholder', regex: /\{\{\s*[^}]+\s*\}\}/g },
    { kind: 'underscore_blank', regex: /_{3,}/g },
  ];

  for (const pattern of patterns) {
    pattern.regex.lastIndex = 0;
    for (const match of normalized.matchAll(pattern.regex)) {
      pushCandidate(match.index ?? 0, match[0], pattern.kind);
    }
  }

  // "Label:" style blanks have no underscores, so they must be detected
  // separately (after the underscore patterns so explicit blanks win on overlap).
  for (const match of detectColonLabelMatches(normalized)) {
    pushCandidate(match.index, match.sourceText, match.kind);
  }

  return candidates
    .sort((a, b) => a.position - b.position)
    .map((candidate, index) => ({
      ...candidate,
      id: `blank_${String(index + 1).padStart(3, '0')}`,
      order: index + 1,
    }));
}

function hintFor(name, context = '') {
  const haystack = `${name} ${context}`.toLowerCase();
  return fieldHints.find((hint) => hint.patterns.some((pattern) => pattern.test(haystack)));
}

function inferField(name, context = '', fallbackIndex = 0) {
  const hint = hintFor(name, context);

  if (hint) {
    return { ...hint, required: !hint.optional };
  }

  const id = toCamelCase(name) || `templateField${fallbackIndex + 1}`;
  const labelBase = toTitle(id || name);

  return {
    id,
    label: `What is the ${labelBase.toLowerCase()}?`,
    placeholder: labelBase,
    type: 'text',
    section: 'Template details',
    required: false,
    optional: true,
  };
}

function addField(fields, field) {
  if (!field?.id || !FIELD_TYPES.has(field.type ?? 'text')) {
    return;
  }

  const existing = fields.find((item) => item.id === field.id);

  if (existing) {
    existing.required = Boolean(existing.required || field.required);
    existing.optional = Boolean(existing.optional && field.optional);
    existing.helpText ||= field.helpText;
    existing.section ||= field.section;
    existing.options ||= field.options;
    existing.conditional ||= field.conditional;
    return;
  }

  fields.push({
    type: 'text',
    required: false,
    optional: true,
    ...field,
  });
}

function cleanContextLabel(value = '') {
  return String(value)
    .replace(/\[[^\]]+\]/g, ' ')
    .replace(/_{3,}/g, ' ')
    .replace(/["'()]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function sentenceBeforeBlank(text, blankIndex) {
  const before = text.slice(Math.max(0, blankIndex - 260), blankIndex);
  const segments = before
    .split(/[\n.;:]/)
    .map((segment) => cleanContextLabel(segment))
    .filter(Boolean);

  return segments.at(-1) ?? '';
}

function sentenceAfterBlank(text, blankIndex, blankLength) {
  const after = text.slice(blankIndex + blankLength, blankIndex + blankLength + 180);
  const segment = after.split(/[\n.;:]/)[0] ?? '';

  return cleanContextLabel(segment);
}

function labelForBlank(text, blankIndex, blankLength, fallbackIndex) {
  const before = sentenceBeforeBlank(text, blankIndex);
  const after = sentenceAfterBlank(text, blankIndex, blankLength);
  const context = `${before} ${after}`.toLowerCase();
  const previousLine = text.slice(Math.max(0, blankIndex - 180), blankIndex).split('\n').at(-1) ?? '';
  const previousNonBlankLine = text
    .slice(Math.max(0, blankIndex - 260), blankIndex)
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean)
    .at(-1) ?? '';
  const nextNonBlankLine = text
    .slice(blankIndex + blankLength, blankIndex + blankLength + 220)
    .split('\n')
    .map((line) => line.trim())
    .find((line) => line && !/^_{3,}$/.test(line)) ?? '';
  const lineLabelMatch = previousLine.match(/(?:^|\n|\b)(?:\d+\.\s*)?([A-Z][A-Z0-9 /&().'-]{3,}?):\s*$/);
  const lineLabel = lineLabelMatch?.[1]?.trim();
  const nextRoleMatch = nextNonBlankLine.match(/^(PRODUCER|ARTIST|COMPANY|RECORD COMPANY|MANAGER|PUBLISHER|LICENSEE|LICENSOR)\b/i);
  const roleLabel = (role) => {
    const labels = {
      PRODUCER: 'Producer',
      ARTIST: 'Artist',
      COMPANY: 'Company',
      'RECORD COMPANY': 'Record company',
      MANAGER: 'Manager',
      PUBLISHER: 'Publisher',
      LICENSEE: 'Licensee',
      LICENSOR: 'Licensor',
    };

    return labels[String(role).toUpperCase()] ?? toTitle(role);
  };

  if (nextRoleMatch && /sincerely|agreed|accepted|signature|signed/i.test(previousNonBlankLine)) {
    return `${roleLabel(nextRoleMatch[1])} signature name`;
  }

  if (nextRoleMatch && /^(PRODUCER|ARTIST|COMPANY|RECORD COMPANY|MANAGER|PUBLISHER|LICENSEE|LICENSOR)$/i.test(nextNonBlankLine)) {
    return `${roleLabel(nextRoleMatch[1])} signature name`;
  }

  if (lineLabel) {
    return toTitle(lineLabel);
  }

  if (/\bthis\s*$/i.test(before) && /^day of\b/i.test(after)) return 'Day of month';
  if (/\bday of\s*$/i.test(before)) return 'Month';
  if (/\b(?:19|20)\s*$/i.test(before)) return 'Year';
  if (/\bdated\s*$/i.test(before)) return 'Agreement date';

  if (/date|dated|day of|effective/.test(context)) return 'Agreement date';
  if (/dear mr|dear ms|dear/.test(context)) return 'Recipient name';
  if (/publisher/.test(context) && /address/.test(context)) return 'Publisher address';
  if (/publisher/.test(context) && /signature|signed|accepted|sincerely/.test(context)) return 'Publisher signature name';
  if (/publisher/.test(context)) return 'Publisher name';

  if (/writer|songwriter|composer/.test(context) && /address/.test(context)) return 'Writer address';
  if (/writer|songwriter|composer/.test(context) && /signature|signed|accepted|sincerely/.test(context)) return 'Writer signature name';
  if (/writer|songwriter|composer/.test(context)) return 'Writer name';

  if (/producer/.test(context) && /signature|signed|accepted|sincerely/.test(context)) return 'Producer signature name';
  if (/artist/.test(context) && /signature|signed|accepted/.test(context)) return 'Artist signature name';
  if (/company|label|record company/.test(context) && /signature|signed|accepted/.test(context)) return 'Company signature name';

  if (/producer/.test(context) && !/royalt|percent/.test(context)) return 'Producer name';
  if (/artist|performer|musician/.test(context)) return 'Artist or musician name';
  if (/company|label|employer|promoter|venue/.test(context)) return 'Company, employer, or venue name';
  if (/song|title|composition|recording|master/.test(context)) return 'Song, recording, or project title';
  if (/wage|deposit|advance|fee|payment|dollars|\$/.test(context)) return 'Payment amount';
  if (/royalt|percent|percentage|commission|points/.test(context)) return 'Royalty or percentage';
  if (/state|governed/.test(context)) return 'Governing state';
  if (/term|duration|period|year/.test(context)) return 'Term or duration';
  if (/territory|worldwide|country/.test(context)) return 'Territory';
  if (/address|place|location/.test(context)) return 'Address or location';
  if (/time/.test(context)) return 'Time';
  if (/number|count/.test(context)) return 'Number';
  if (/additional terms|description|details/.test(context)) return 'Additional terms';

  const source = before || after;
  const trimmed = source
    .replace(/^(this|the|a|an|and|or|to|for|of|in)\b\s*/i, '')
    .slice(-80)
    .trim();

  return trimmed ? toTitle(trimmed) : `Blank ${fallbackIndex + 1}`;
}

function typeForBlankLabel(label, context) {
  const labelLower = label.toLowerCase();
  const lower = `${label} ${context}`.toLowerCase();

  if (/signature/.test(labelLower)) return 'signature';
  if (/address|place|location/.test(labelLower)) return 'textarea';
  if (/\(s\)|names?|musician|performer|member/.test(labelLower) && !/^number\b/.test(labelLower)) return 'list';
  if (/^number\b|count/.test(labelLower)) return 'count';
  if (/amount|advance|fee|payment|deposit|wage|dollars|\$/.test(labelLower)) return 'currency';
  if (/percent|percentage|royalty|commission|points/.test(labelLower)) return 'percentage';
  if (/date|dated|day of|month|year|effective/.test(labelLower)) return 'text';
  if (/additional terms|description|details|services|obligations|address/.test(labelLower)) return 'textarea';
  if (/amount|advance|fee|payment|deposit|wage|dollars|\$/.test(lower)) return 'currency';
  if (/percent|percentage|royalty|commission|points/.test(lower)) return 'percentage';

  return 'text';
}

function singularLabel(value = '') {
  return String(value)
    .toLowerCase()
    .replace(/\(s\)/g, '')
    .replace(/\bs\b/g, '')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

function linkCountAndListFields(fields) {
  const detected = fields.filter((field) => field.source === 'detected_blank' || field.source === 'detected_fillable_line');

  for (const field of detected) {
    if (field.type !== 'count') {
      continue;
    }

    const countTarget = singularLabel(field.label.replace(/^number of\s+/i, ''));
    const listField = detected
      .filter((candidate) => {
        if (candidate.type !== 'list') {
          return false;
        }

        const listTarget = singularLabel(candidate.label.replace(/^name of\s+/i, '').replace(/^names? of\s+/i, ''));

        return listTarget && (listTarget.includes(countTarget) || countTarget.includes(listTarget));
      })
      .sort((a, b) => {
        const aDistance = Math.abs((a.charIndex ?? 0) - (field.charIndex ?? 0));
        const bDistance = Math.abs((b.charIndex ?? 0) - (field.charIndex ?? 0));
        return aDistance - bDistance;
      })[0];

    if (listField) {
      field.controls = listField.id;
    }
  }
}

function normalizedFieldKey(field) {
  const label = String(field.label ?? '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();

  return [
    field.source ?? 'context',
    label,
  ].join('|');
}

function mergeEquivalentDetectedFields(fields) {
  const merged = [];
  const byKey = new Map();

  for (const field of fields) {
    const isDetected = field.source === 'detected_blank' || field.source === 'detected_fillable_line';
    const key = isDetected ? normalizedFieldKey(field) : '';
    const existing = key ? byKey.get(key) : null;

    if (!existing) {
      const copy = { ...field };

      if (Number.isInteger(copy.blankIndex)) {
        copy.blankIndexes = [copy.blankIndex];
      }

      if (Number.isInteger(copy.lineIndex)) {
        copy.lineIndexes = [copy.lineIndex];
      }

      merged.push(copy);

      if (key) {
        byKey.set(key, copy);
      }

      continue;
    }

    existing.required = Boolean(existing.required || field.required);
    existing.optional = Boolean(existing.optional && field.optional);
    existing.helpText ||= field.helpText;
    existing.section ||= field.section;
    existing.options ||= field.options;
    existing.conditional ||= field.conditional;
    existing.controls ||= field.controls;
    existing.charIndex = Math.min(existing.charIndex ?? field.charIndex ?? 0, field.charIndex ?? existing.charIndex ?? 0);

    if (Number.isInteger(field.blankIndex)) {
      existing.blankIndexes = [...new Set([...(existing.blankIndexes ?? [existing.blankIndex]), field.blankIndex])]
        .filter(Number.isInteger)
        .sort((a, b) => a - b);
    }

    if (Number.isInteger(field.lineIndex)) {
      existing.lineIndexes = [...new Set([...(existing.lineIndexes ?? [existing.lineIndex]), field.lineIndex])]
        .filter(Number.isInteger)
        .sort((a, b) => a - b);
    }
  }

  return merged;
}

function applyTemplateSpecificDetectedLabels(template, fields) {
  const templateKey = `${template?.id ?? ''} ${template?.title ?? ''} ${template?.sourceFile ?? ''}`.toLowerCase();

  if (!/\bbooking-contract\b|booking contract|booking_contract/i.test(templateKey)) {
    return fields;
  }

  return fields.map((field) => {
    if (field.source !== 'detected_blank') {
      return field;
    }

    if (field.blankIndex === 0) {
      return { ...field, label: 'Date', placeholder: 'Date' };
    }

    if (field.blankIndex === 1) {
      return { ...field, label: 'Month', placeholder: 'Month' };
    }

    if (field.blankIndex === 2) {
      return { ...field, label: 'Year', placeholder: 'Year' };
    }

    if (field.blankIndex === 4) {
      return { ...field, label: 'Employer signature', placeholder: 'Employer signature', type: 'text' };
    }

    if (field.blankIndex === 5) {
      return { ...field, label: 'Musician signature', placeholder: 'Musician signature', type: 'text' };
    }

    return field;
  });
}

function addContextFields(fields, text) {
  const lower = text.toLowerCase();

  for (const hint of fieldHints) {
    if (hint.patterns.some((pattern) => pattern.test(lower))) {
      addField(fields, { ...hint, required: !hint.optional });
    }
  }
}

function extractBracketFields(fields, text) {
  const matches = [...text.matchAll(/\[([A-Z][A-Z0-9_ -]{2,})\]/g)];

  matches.forEach((match, index) => {
    const rawName = match[1];
    const context = contextAround(text, match.index ?? 0, match[0].length);
    addField(fields, {
      ...inferField(rawName, context, index),
      required: !/optional|if applicable|if any/i.test(context),
    });
  });
}

function extractBlankFields(fields, text) {
  const matches = [...text.matchAll(/_{3,}/g)].slice(0, 80);

  matches.forEach((match, index) => {
    const matchIndex = match.index ?? 0;
    const context = contextAround(text, matchIndex, match[0].length);
    const label = labelForBlank(text, matchIndex, match[0].length, index);
    const id = uniqueFieldId(`blank_${index + 1}_${label}`, fields);

    addField(fields, {
      id,
      label,
      placeholder: label,
      type: typeForBlankLabel(label, context),
      section: 'Template blanks',
      blankIndex: index,
      charIndex: matchIndex,
      source: 'detected_blank',
      helpText: 'This field fills one underline blank in the source template. Leave it blank to keep the underline.',
      required: !/optional|if applicable|if any/i.test(context),
    });
  });
}

function isFillableLabelLine(line) {
  const trimmed = String(line ?? '').trim();

  if (!trimmed || trimmed.includes('___') || trimmed.length > 95) {
    return false;
  }

  if (!/^[\d().\sA-Z,'/&-]+:?$/.test(trimmed)) {
    return false;
  }

  if (/^(BOOKING CONTRACT|AGREEMENT|CONTRACT|TERMS|EMPLOYER|MUSICIAN|ARTIST|PRODUCER|COMPANY|AGENT)$/i.test(trimmed)) {
    return false;
  }

  return /\b(NAME|NUMBER|ADDRESS|PLACE|DATE|TIME|WAGE|DEPOSIT|PAYMENT|BALANCE|ADDITIONAL TERMS|SIGNED|SIGNATURE|TITLE|PHONE|EMAIL|FEE|ROYALTY|PERCENT|TERM|TERRITORY)\b/i.test(trimmed);
}

function cleanFillableLineLabel(line, fallbackIndex) {
  const cleaned = String(line ?? '')
    .replace(/^\s*\d+\.\s*/, '')
    .replace(/[:\s]+$/g, '')
    .trim();

  return cleaned ? toTitle(cleaned) : `Blank ${fallbackIndex + 1}`;
}

function extractFillableLineFields(fields, text) {
  const lines = String(text ?? '').split('\n');
  let offset = 0;
  let virtualIndex = 0;

  lines.forEach((line, lineIndex) => {
    const lineStart = offset;
    offset += line.length + 1;

    if (!isFillableLabelLine(line)) {
      return;
    }

    const previousLine = lines[lineIndex - 1]?.trim() ?? '';
    const nextLine = lines[lineIndex + 1]?.trim() ?? '';

    const label = cleanFillableLineLabel(line, virtualIndex);
    const context = [previousLine, line, nextLine].join(' ');
    const id = uniqueFieldId(`line_${lineIndex + 1}_${label}`, fields);

    addField(fields, {
      id,
      label,
      placeholder: label,
      type: typeForBlankLabel(label, context),
      section: 'Template blanks',
      source: 'detected_fillable_line',
      lineIndex,
      charIndex: lineStart + Math.max(0, line.indexOf(line.trim())),
      helpText: 'This field fills a blank line or label-only empty field in the source template. Leave it blank to keep a placeholder.',
      required: false,
      optional: true,
    });

    virtualIndex += 1;
  });
}

function addConditionalFields(fields, text) {
  const lower = text.toLowerCase();

  if (/exclusive|non-exclusive|sole license|licensee|licensor|licensed use/.test(lower)) {
    addField(fields, {
      id: 'licenseType',
      label: 'Is the license exclusive or non-exclusive?',
      placeholder: 'Choose the license type',
      type: 'radio',
      options: ['Non-exclusive', 'Exclusive', 'Not sure'],
      section: 'Rights',
      required: false,
      optional: true,
      helpText: 'Exclusive usually means only one person or company can use the rights in the stated scope.',
    });
    addField(fields, {
      id: 'exclusivityDuration',
      label: 'How long should exclusivity last?',
      placeholder: '6 months, 1 year, campaign term, or leave blank',
      type: 'text',
      section: 'Rights',
      required: false,
      optional: true,
      conditional: { dependsOn: 'licenseType', operator: 'includes', value: 'Exclusive' },
    });
  }

  if (/royalt|points|net receipts|gross receipts/.test(lower) && !fields.some((field) => field.id === 'royaltyPercentage')) {
    addField(fields, {
      id: 'royaltyIncluded',
      label: 'Does this deal include royalties?',
      placeholder: 'Choose yes or no',
      type: 'radio',
      options: ['Yes', 'No', 'Not sure'],
      section: 'Money',
      required: false,
      optional: true,
    });
    addField(fields, {
      id: 'royaltyPercentage',
      label: 'What royalty rate, points, or percentage applies?',
      placeholder: '3%, 15%, 2.75 cents per side, or leave blank',
      type: 'percentage',
      section: 'Money',
      required: false,
      optional: true,
      conditional: { dependsOn: 'royaltyIncluded', operator: 'equals', value: 'Yes' },
    });
  }

  if (/advance|deposit|upfront|recoupable/.test(lower)) {
    addField(fields, {
      id: 'advanceIncluded',
      label: 'Is there an advance or upfront payment?',
      placeholder: 'Choose yes or no',
      type: 'radio',
      options: ['Yes', 'No', 'Not sure'],
      section: 'Money',
      required: false,
      optional: true,
    });
    addField(fields, {
      id: 'advanceAmount',
      label: 'What advance or upfront payment applies?',
      placeholder: '$500, $2,500, or leave blank',
      type: 'currency',
      section: 'Money',
      required: false,
      optional: true,
      helpText: 'Leave this blank if the template should keep an underline for the amount.',
    });
    addField(fields, {
      id: 'paymentSchedule',
      label: 'When should the advance or payment be made?',
      placeholder: 'On signing, on delivery, monthly, quarterly, or leave blank',
      type: 'dropdown',
      options: ['On signing', 'On delivery', 'Monthly', 'Quarterly', 'Semi-annually', 'Other'],
      section: 'Money',
      required: false,
      optional: true,
      helpText: 'Leave this blank if the template should keep an underline for the schedule.',
    });
  }
}

function applyFieldOrder(fields) {
  const order = [
    'agreementDate',
    'partyOneName',
    'partyTwoName',
    'artistName',
    'producerName',
    'companyName',
    'managerName',
    'publisherName',
    'songwriterName',
    'licensorName',
    'licenseeName',
    'projectTitle',
    'masterCount',
    'licenseType',
    'exclusivityDuration',
    'licensedUse',
    'advanceIncluded',
    'advanceAmount',
    'compensation',
    'royaltyIncluded',
    'royaltyPercentage',
    'commissionRate',
    'paymentSchedule',
    'term',
    'territory',
    'ownershipTerms',
    'deliverables',
    'services',
    'notes',
  ];

  return [...fields].sort((a, b) => {
    const aIndex = order.indexOf(a.id);
    const bIndex = order.indexOf(b.id);
    return (aIndex === -1 ? 999 : aIndex) - (bIndex === -1 ? 999 : bIndex);
  });
}

export function buildDynamicTemplateSchema({ template, source }) {
  const templateText = normalizeText(source?.templateText ?? source?.textPreview ?? template?.textPreview ?? template?.description ?? '');
  const metadata = normalizeText([template?.title, template?.category, template?.sourceFile, template?.description].filter(Boolean).join('\n'));
  const analysisText = isUsableTemplateText(templateText) ? `${metadata}\n${templateText}` : metadata;
  const fillableText = `${metadata}\n${templateText}`.trim();
  const fields = [];

  extractBracketFields(fields, fillableText);
  extractBlankFields(fields, templateText || fillableText);
  extractFillableLineFields(fields, templateText || fillableText);

  const detectedTemplateFieldsBeforeMerge = fields.filter((field) => field.source === 'detected_blank' || field.source === 'detected_fillable_line');

  if (!detectedTemplateFieldsBeforeMerge.length && fields.length < 6) {
    addContextFields(fields, analysisText);
  }

  if (!detectedTemplateFieldsBeforeMerge.length) {
    addConditionalFields(fields, analysisText);
    addField(fields, {
      id: 'notes',
      label: 'Any extra deal notes?',
      placeholder: 'Credits, deadlines, approvals, restrictions, or special instructions',
      type: 'textarea',
      section: 'Notes',
      required: false,
      optional: true,
    });
  }

  if (detectedTemplateFieldsBeforeMerge.length) {
    linkCountAndListFields(fields);
  }

  const mergedFields = mergeEquivalentDetectedFields(applyTemplateSpecificDetectedLabels(template ?? source, fields));
  const detectedTemplateFields = mergedFields.filter((field) => field.source === 'detected_blank' || field.source === 'detected_fillable_line');
  const questions = (detectedTemplateFields.length
    ? [...detectedTemplateFields].sort((a, b) => (a.charIndex ?? 0) - (b.charIndex ?? 0))
    : applyFieldOrder(mergedFields)).slice(0, 80);

  return {
    version: 'dynamic-template-parser-v1',
    source: isUsableTemplateText(templateText) ? 'template_parser' : 'template_metadata_parser',
    templateId: template?.id ?? source?.id ?? '',
    templateTitle: template?.title ?? source?.title ?? 'Source Template',
    questions,
    optionalSections: [...new Set(questions.filter((question) => question.optional).map((question) => question.section).filter(Boolean))],
    conditionalRules: questions.filter((question) => question.conditional).map((question) => ({
      fieldId: question.id,
      ...question.conditional,
    })),
  };
}
