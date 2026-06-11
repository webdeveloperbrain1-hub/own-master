const metadataLinePatterns = [
  /^(times new roman|arial|tahoma|ms mincho|arial unicode ms|courier new)(;|\s|$)/i,
  /^(normal|heading|body text|list|caption|index|standard);?$/i,
  /^\\?\*?(absatz-standardschriftart|default paragraph font)$/i,
  /^microsoft\s+(macintosh\s+|office\s+)?word/i,
  /^(word\.document|microsoft word 97-2003 document|preferred customer|preferred company|forms solutions|proformz,\s*llc)$/i,
  /^theme\/.+\.(xml|rels)(\s*PK)?$/i,
  /^_rels\/.*\.rels(\s*PK)?$/i,
  /^word\/.+\.(xml|rels)(\s*PK)?$/i,
  /^xml\s+version=/i,
  /^a:clr\s*Map\b/i,
  /^b:Sources\b/i,
  /^APA\.XSL\b/i,
  /^ds:(datastoreItem|schemaRefs?|itemID)\b/i,
  /^xmlns(:\w+)?=/i,
  /^F?[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i,
  /^PK\s*$/i,
  /^page\s+\d+$/i,
  /^\d+:\s*page\s+\d+$/i,
  /^\d+$/,
  /^(linearized|xref|trailer|endobj|objstm|fontdescriptor|basefont|flatedecode|decodeparms|columns\s+\d+|size\s+\d+|metadata\s+\d+)/i,
  /^\d{7,}\s+\d{5}\s+n$/i,
  /^[0-9a-f]{24,}$/i,
  /^[;\\*\s]+$/,
  /^!{2,}(?:\s*!+)*$/,
];

const metadataBlockStartPatterns = [
  /^theme\/.+\.(xml|rels)(\s*PK)?$/i,
  /^_rels\/.*\.rels(\s*PK)?$/i,
  /^word\/.+\.(xml|rels)(\s*PK)?$/i,
  /^xml\s+version=/i,
  /^a:clr\s*Map\b/i,
  /^b:Sources\b/i,
  /^APA\.XSL\b/i,
  /^ds:(datastoreItem|schemaRefs?|itemID)\b/i,
  /^microsoft\s+office\s+word/i,
  /^microsoft word 97-2003 document$/i,
];

function isMetadataLine(line) {
  const trimmed = String(line ?? '').trim();

  if (!trimmed) {
    return false;
  }

  if (/_{3,}/.test(trimmed)) {
    return false;
  }

  if (/\b(agreement|contract|signature|accepted|agreed|artist|producer|writer|publisher|company|license|royalty|date|title|name)\b/i.test(trimmed)) {
    return false;
  }

  if (metadataLinePatterns.some((pattern) => pattern.test(trimmed))) {
    return true;
  }

  const letters = (trimmed.match(/[A-Za-z]/g) ?? []).length;
  const symbols = (trimmed.match(/[<>@#$^`{}[\]|\\]/g) ?? []).length;

  if (trimmed.length < 80 && symbols > 2 && symbols >= letters) {
    return true;
  }

  const alphanumeric = (trimmed.match(/[A-Za-z0-9]/g) ?? []).length;
  const punctuation = (trimmed.match(/[^A-Za-z0-9\s]/g) ?? []).length;

  return trimmed.length < 80 && punctuation >= 3 && punctuation > alphanumeric;
}

function isLikelyContractStart(line) {
  const trimmed = String(line ?? '').trim();

  return /\b(agreement|contract|license|licence|split sheet|assignment|release|letter of agreement|synchronization|royalty)\b/i.test(trimmed);
}

function stitchBrokenWords(text) {
  return text
    .replace(/([A-Za-z]{3,})\n\n([a-z]{1,3})(?=\s)/g, '$1$2')
    .replace(/([A-Za-z]{3,})\n([a-z]{1,3})(?=\s)/g, '$1$2');
}

function isMetadataBlockStart(line) {
  const trimmed = String(line ?? '').trim();

  return metadataBlockStartPatterns.some((pattern) => pattern.test(trimmed));
}

function hasContractSignal(lines) {
  return lines.some((line) => /\b(agreement|contract|signature|accepted|agreed|artist|producer|writer|publisher|company|license|royalty)\b/i.test(line));
}

function trimOfficeMetadataBlocks(lines) {
  let seenCharacters = 0;
  let seenContractSignal = false;

  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index] ?? '';
    seenCharacters += line.length;
    seenContractSignal ||= /\b(agreement|contract|signature|accepted|agreed|artist|producer|writer|publisher|company|license|royalty)\b/i.test(line);

    if (!seenContractSignal || seenCharacters < 240 || !isMetadataBlockStart(line)) {
      continue;
    }

    const tail = lines.slice(index, index + 24);
    const metadataCount = tail.filter((tailLine) => isMetadataLine(tailLine) || isMetadataBlockStart(tailLine)).length;

    if (metadataCount >= 3 || !hasContractSignal(lines.slice(index + 1))) {
      return lines.slice(0, index);
    }
  }

  return lines;
}

function trimBeforeContractStart(lines) {
  const firstContractLine = lines.findIndex((line) => isLikelyContractStart(line));

  if (firstContractLine <= 0) {
    return lines;
  }

  return lines.slice(firstContractLine);
}

function removeNoisyDuplicateTitle(lines) {
  if (lines.length < 3) {
    return lines;
  }

  const first = lines[0]?.trim() ?? '';
  const laterIndex = lines.slice(1, 8).findIndex((line) => {
    const trimmed = line.trim();
    return trimmed && first.toLowerCase().startsWith(trimmed.toLowerCase()) && isLikelyContractStart(trimmed);
  });

  if (laterIndex >= 0 && first.length > (lines[laterIndex + 1]?.trim().length ?? 0) + 12) {
    return lines.slice(laterIndex + 1);
  }

  return lines;
}

function trimTrailingMetadata(lines) {
  let end = lines.length;
  const title = lines.find((line) => isLikelyContractStart(line))?.trim().toLowerCase();

  while (end > 0) {
    const line = lines[end - 1] ?? '';
    const trimmed = line.trim().toLowerCase();

    if (!line.trim() || isMetadataLine(line) || (title && end > 1 && trimmed === title)) {
      end -= 1;
      continue;
    }

    break;
  }

  return lines.slice(0, end);
}

export function cleanTemplateText(text = '') {
  const normalized = stitchBrokenWords(
    String(text ?? '')
      .replace(/\r/g, '\n')
      .replace(/\u0000/g, '')
      .replace(/(CONTRACT|AGREEMENT|LICENSE)(LETTER OF AGREEMENT)/g, '$1\n\n$2')
      .replace(/(_{3,})(Dear\b)/g, '$1\n\n$2')
      .replace(/\bCompanyas\b/g, 'Company as')
      .replace(/([a-z])([A-Z])/g, '$1 $2')
      .replace(/[^\S\n]+/g, ' ')
      .replace(/\n{4,}/g, '\n\n'),
  );
  const lines = normalized
    .split('\n')
    .map((line) => line.trimEnd());
  const withoutMetadataTail = trimOfficeMetadataBlocks(lines)
    .filter((line) => !isMetadataLine(line));
  const fromContractStart = removeNoisyDuplicateTitle(trimBeforeContractStart(withoutMetadataTail));
  const trimmed = trimTrailingMetadata(fromContractStart)
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .replace(/[ \t]{2,}/g, ' ')
    .replace(/\bCompanyas\b/g, 'Company as')
    .replace(/,([A-Z][a-z])/g, ', $1')
    .replace(/:([A-Z][a-z])/g, ':\n\n$1')
    .replace(/([.!?])([A-Z][a-z])/g, '$1 $2')
    .replace(/\s+([,.;:])/g, '$1')
    .trim();

  return trimmed || String(text ?? '').trim();
}
