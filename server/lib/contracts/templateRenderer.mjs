import { getTemplateSource } from './templates.mjs';
import { cleanTemplateText } from './templateTextCleaner.mjs';
import { BLANK_PLACEHOLDER } from './scanTemplateConfig.mjs';

const blank = BLANK_PLACEHOLDER;
const signatureLine = '______________________________';

function answer(value) {
  return String(value ?? '').trim();
}

function answerOrBlank(value) {
  return answer(value) || blank;
}

function keyToSnakeCase(key) {
  return String(key)
    .replace(/([a-z0-9])([A-Z])/g, '$1_$2')
    .replace(/[^a-zA-Z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .toUpperCase();
}

function escapeRegExp(value) {
  return String(value).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function replaceDynamicPlaceholders(text, answers = {}) {
  let draft = text;

  for (const [key, value] of Object.entries(answers)) {
    const replacement = answer(value) || blank;
    const variants = new Set([
      key,
      keyToSnakeCase(key),
      keyToSnakeCase(key).replace(/_/g, ' '),
      keyToSnakeCase(key).replace(/_/g, '-'),
    ]);

    for (const variant of variants) {
      if (!variant) {
        continue;
      }

      draft = draft
        .replace(new RegExp(`\\[\\s*${escapeRegExp(variant)}\\s*\\]`, 'gi'), replacement)
        .replace(new RegExp(`\\{\\{\\s*${escapeRegExp(variant)}\\s*\\}\\}`, 'gi'), replacement);
    }
  }

  return draft
    .replace(/\[\s*[A-Z][A-Z0-9_ -]{2,}\s*\]/g, blank)
    .replace(/\{\{\s*[A-Z_a-z][A-Z_a-z0-9 -]{2,}\s*\}\}/g, blank);
}

function orderedBlankInputs(schema = {}) {
  const inputs = [];

  for (const input of schema.inputs ?? schema.questions ?? []) {
    const blankIndexes = Array.isArray(input.blankIndexes)
      ? input.blankIndexes.filter(Number.isInteger)
      : Number.isInteger(input.blankIndex)
        ? [input.blankIndex]
        : [];

    for (const blankIndex of blankIndexes) {
      inputs.push({ ...input, blankIndex });
    }
  }

  return inputs.sort((a, b) => a.blankIndex - b.blankIndex);
}

function replaceOrderedBlanks(text, schema = {}, answers = {}) {
  const inputs = orderedBlankInputs(schema);

  if (!inputs.length) {
    return text;
  }

  let blankIndex = 0;

  return String(text).replace(/_{3,}/g, (match) => {
    const input = inputs.find((field) => field.blankIndex === blankIndex);
    blankIndex += 1;

    if (!input) {
      return match;
    }

    const value = answer(answers[input.id]);

    return value || match;
  });
}

function fillableLineInputs(schema = {}) {
  return (schema.inputs ?? schema.questions ?? [])
    .filter((input) => input.source === 'detected_fillable_line' && Number.isInteger(input.lineIndex))
    .sort((a, b) => a.lineIndex - b.lineIndex);
}

function replaceFillableLines(text, schema = {}, answers = {}) {
  const inputs = fillableLineInputs(schema);

  if (!inputs.length) {
    return text;
  }

  const byLine = new Map(inputs.map((input) => [input.lineIndex, input]));

  return String(text)
    .split('\n')
    .map((line, lineIndex) => {
      const input = byLine.get(lineIndex);

      if (!input) {
        return line;
      }

      const value = answer(answers[input.id]);
      const suffix = value || input.blankPlaceholder || blank;
      const trimmed = line.trimEnd();

      return `${trimmed}${trimmed.endsWith(':') ? ' ' : ': '}${suffix}`;
    })
    .join('\n');
}

function renderDraftByDetectedTemplateFields({ templateText, schema, answers = {} }) {
  const cleaned = compactTemplateText(removeExtractionNoise(templateText));
  const withNamedPlaceholders = replaceDynamicPlaceholders(cleaned, answers);
  const withFillableLines = replaceFillableLines(withNamedPlaceholders, schema, answers);

  return replaceOrderedBlanks(withFillableLines, schema, answers);
}

function signatureColumns(leftLabel = 'Producer', rightLabel = 'Company') {
  return `${signatureLine}    ${signatureLine}\n${leftLabel.padEnd(signatureLine.length + 4, ' ')}${rightLabel}`;
}

function compactTemplateText(text) {
  return cleanTemplateText(text)
    .replace(/\r/g, '\n')
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

function normalizeRoyaltyPercentage(value) {
  const input = answer(value);

  if (!input) {
    return '';
  }

  const match = input.match(/(\d+(?:\.\d+)?)\s*%/);

  return match ? `${match[1]}%` : input;
}

function replaceFirst(text, pattern, replacement) {
  return text.replace(pattern, replacement);
}

function roleValue(answers, role, fallback) {
  const direct = answer(answers[`${role}Name`]);

  if (direct) {
    return direct;
  }

  const partyOneRole = answer(answers.partyOneRole).toLowerCase();
  const partyTwoRole = answer(answers.partyTwoRole).toLowerCase();

  if (partyOneRole.includes(role)) {
    return answer(answers.partyOneName) || fallback;
  }

  if (partyTwoRole.includes(role)) {
    return answer(answers.partyTwoName) || fallback;
  }

  return fallback;
}

function normalizeSignatureBlocks(text, answers = {}) {
  let draft = text;
  const partyOne = answer(answers.partyOneName);
  const partyTwo = answer(answers.partyTwoName);
  const company = answer(answers.companyName) || roleValue(answers, 'company', '');
  const producer = answer(answers.producerName) || roleValue(answers, 'producer', partyOne);
  const artist = answer(answers.artistName) || roleValue(answers, 'artist', partyTwo);
  const producerCompanyBlock = signatureColumns(producer || partyOne || 'Producer', company || partyTwo || 'Company');
  const producerArtistBlock = signatureColumns(producer || partyOne || 'PRODUCER', artist || partyTwo || 'ARTIST');
  const companyProducerBlock = signatureColumns(company || partyOne || 'COMPANY', producer || partyTwo || 'PRODUCER');

  draft = draft.replace(
    /Signatures below confirms all parties agreement\.\s*\n+_*[\s_]*\n?Producer\s+Company/gi,
    `Signatures below confirms all parties agreement.\n\n${producerCompanyBlock}`,
  );

  draft = draft.replace(
    /Signatures below confirm all parties agreement\.\s*\n+_*[\s_]*\n?Producer\s+Company/gi,
    `Signatures below confirm all parties agreement.\n\n${producerCompanyBlock}`,
  );

  draft = draft.replace(
    /\n_{8,}\s*\nPRODUCER\s*\n+\s*Agreed and Accepted:\s*\n+\s*_{8,}\s*\nARTIST\b/gi,
    `\n${producerArtistBlock}`,
  );

  draft = draft.replace(
    /\n_{8,}\s*\nCOMPANY\s*\n+\s*Agreed and Accepted:\s*\n+\s*_{8,}\s*\nPRODUCER\b/gi,
    `\n${companyProducerBlock}`,
  );

  draft = draft.replace(
    /(ACCEPTED AND AGREED TO:)\s*\n+(?:_{8,}\s*\n+)?(BY:)(?!\s*_{8,})/gi,
    `$1\n\n${signatureLine}\n\n$2 ${signatureLine}`,
  );

  draft = draft.replace(
    /(Accepted and agreed:)\s*\n+(?:_{8,}\s*\n+)?(By:)(?!\s*_{8,})/gi,
    `$1\n\n${signatureLine}\n\n$2 ${signatureLine}`,
  );

  draft = draft.replace(
    /(Signatures below confirms all parties agreement\.\n\n______________________________ {4}______________________________\nProducer\s+Company)[\s\S]*$/i,
    '$1',
  );

  draft = draft.replace(
    /(Signatures below confirm all parties agreement\.\n\n______________________________ {4}______________________________\nProducer\s+Company)[\s\S]*$/i,
    '$1',
  );

  draft = draft.replace(
    /(Signatures below confirms all parties agreement\.\n\n______________________________ {4}______________________________\n[^\n]+)[\s\S]*$/i,
    '$1',
  );

  draft = draft.replace(
    /(Signatures below confirm all parties agreement\.\n\n______________________________ {4}______________________________\n[^\n]+)[\s\S]*$/i,
    '$1',
  );

  const signatureMatch = draft.match(/Signatures below confirms? all parties agreement\./i);
  if (signatureMatch) {
    const signatureStart = (signatureMatch.index ?? 0) + signatureMatch[0].length;
    const signatureTail = draft.slice(signatureStart);
    if (!/_{8,}\s+_{8,}/.test(signatureTail) || /[^\x09\x0A\x0D\x20-\x7E]/.test(signatureTail)) {
      draft = `${draft.slice(0, signatureStart)}\n\n${producerCompanyBlock}`;
    }
  }

  return draft;
}

function removeExtractionNoise(text) {
  return String(text ?? '')
    .replace(/\u0000/g, '')
    .split('\n')
    .filter((line) => {
      const trimmed = line.trim();

      if (!trimmed) {
        return true;
      }

      const hasLettersAndDigits = /[A-Za-z]/.test(trimmed) && /\d/.test(trimmed);
      const compacted = trimmed.replace(/[^\w\s]/g, '');
      const mostlyShortTokens = /^(?:[A-Za-z]*\d+[A-Za-z]*|[A-Za-z]{1,4})(?:\s+(?:[A-Za-z]*\d+[A-Za-z]*|[A-Za-z]{1,4})){1,8},?$/.test(compacted);
      const hasContractWord = /\b(agreement|accepted|artist|company|producer|by|date|signature|witness|title|name)\b/i.test(trimmed);

      return !(hasLettersAndDigits && mostlyShortTokens && trimmed.length <= 48 && !hasContractWord);
    })
    .join('\n');
}

function fillCommonContractTerms(templateText, answers) {
  let draft = replaceDynamicPlaceholders(compactTemplateText(removeExtractionNoise(templateText)), answers);
  const partyOne = answer(answers.partyOneName);
  const partyTwo = answer(answers.partyTwoName);
  const partyOneRole = answer(answers.partyOneRole);
  const partyTwoRole = answer(answers.partyTwoRole);
  const company = answer(answers.companyName) || roleValue(answers, 'company', '');
  const producer = answer(answers.producerName) || roleValue(answers, 'producer', partyOne);
  const artist = answer(answers.artistName) || roleValue(answers, 'artist', partyTwo);
  const agreementDate = answer(answers.agreementDate);
  const masterCount = answer(answers.masterCount);
  const advanceAmount = answer(answers.advanceAmount) || answer(answers.compensation);
  const paymentSchedule = answer(answers.paymentSchedule);
  const accountingPeriod = answer(answers.accountingPeriod);
  const projectTitle = answer(answers.projectTitle);
  const compensation = answer(answers.compensation);
  const royalty = normalizeRoyaltyPercentage(answers.royaltyPercentage);
  const term = answer(answers.term);
  const territory = answer(answers.territory);
  const ownership = answer(answers.ownershipTerms);

  if (company || producer) {
    draft = replaceFirst(
      draft,
      /between\s+_{3,}\s+hereinafter referred to as Company,\s+and\s+_{3,}\s+hereinafter referred to as Producer/i,
      `between ${company || blank} hereinafter referred to as Company, and ${producer || blank} hereinafter referred to as Producer`,
    );
  }

  if (producer || partyOne) {
    draft = replaceFirst(draft, /between\s+_{3,}/i, `between ${producer || partyOne}`);
    draft = replaceFirst(draft, /Dear Mr\.\/Ms\.\s+_{3,}/i, `Dear Mr./Ms. ${producer || partyOne}`);
    draft = replaceFirst(draft, /with\s+_{3,}\s+\(hereinafter designated as "Producer"\)/i, `with ${producer || partyOne} (hereinafter designated as "Producer")`);
    draft = replaceFirst(draft, /by and between\s+_{2,}\s+\(Artist\)_+/i, `by and between ${artist || partyTwo || blank} (Artist)`);
  }

  if (artist || partyTwo) {
    draft = replaceFirst(draft, /professionally known as\s+_{3,}/i, `professionally known as ${artist || partyTwo}`);
    draft = replaceFirst(draft, /recording artist known professionally as\s+_{3,}/i, `recording artist known professionally as ${artist || partyTwo}`);
    draft = replaceFirst(draft, /Company's recording artist\s+_{3,}/i, `Company's recording artist ${artist || partyTwo}`);
  }

  if (projectTitle) {
    draft = replaceFirst(draft, /for his\/her production of the\s+_{3,}\s+\(number\)\s+Master Recordings/i, `for his/her production of the ${masterCount || blank} Master Recordings titled "${projectTitle}"`);
    draft = replaceFirst(draft, /The title of the Recording shall be chosen by agreement between the Company and the Artist\./i, `The title of the Recording is "${projectTitle}".`);
    draft = replaceFirst(draft, /master recordings of performances/i, `master recordings of performances for "${projectTitle}"`);
    if (!draft.includes(`Master Recordings titled "${projectTitle}"`)) {
      draft = replaceFirst(draft, /Master Recordings?/i, `Master Recordings for "${projectTitle}"`);
    }
  } else if (masterCount) {
    draft = replaceFirst(draft, /production of the\s+_{3,}\s+\(number\)\s+Master Recordings/i, `production of the ${masterCount} Master Recordings`);
  }

  if (advanceAmount || compensation) {
    const payment = advanceAmount || compensation;
    draft = replaceFirst(draft, /the sum of \$\s*_{3,}\s*DOLLARS/i, `the sum of ${payment}`);
    draft = replaceFirst(draft, /For Producers services Producer will be paid[^.\n]*\./i, `For Producer's services, Producer will be paid ${payment}.`);
    draft = replaceFirst(draft, /The fee or payment terms are\s+_{3,}/i, `The fee or payment terms are ${payment}`);
    draft = replaceFirst(draft, /Producer has received\s+_{3,}\s+dollars\s+\(\$\s*\)/i, `Producer has received ${advanceAmount || compensation}`);
  }

  if (royalty) {
    draft = draft
      .replace(/three percent\s*\(3%\)/gi, royalty)
      .replace(/three percent\s*\(3\s*%\)/gi, royalty)
      .replace(/TWO AND TWO TENTHS CENTS \(2\.2\)/gi, royalty)
      .replace(/TWO AND THREE QUARTER CENTS \(2\.75\)/gi, royalty)
      .replace(/ONE HALF \(1\/2\) of the United States royalty rate/gi, royalty)
      .replace(/\b3%\b/g, royalty);
  }

  if (agreementDate) {
    draft = replaceFirst(draft, /dated\s+_{3,},\s*20_{2,}/i, `dated ${agreementDate}`);
    draft = replaceFirst(draft, /Date:\s*_{2,}/i, `Date: ${agreementDate}`);
    draft = replaceFirst(draft, /executed and effective this\s+_{2,}\s+day of\s+_{3,},\s*20_{2,}/i, `executed and effective this ${agreementDate}`);
  }

  if (paymentSchedule) {
    draft = replaceFirst(
      draft,
      /Royalty statements and payments shall be made semi-annually/i,
      `Royalty statements and payments shall be made ${paymentSchedule}`,
    );
  }

  if (accountingPeriod) {
    draft = replaceFirst(
      draft,
      /will be made within 45 days of December 31st and June 30th of each year for the six month prior accounting period/i,
      `will be made ${accountingPeriod}`,
    );
  }

  if (term) {
    draft = replaceFirst(draft, /for a period of\s+_{2,}\s+\(#\)\s+years/i, `for a period of ${term}`);
    draft = replaceFirst(draft, /period of ONE YEAR/gi, `period of ${term}`);
  }

  if (territory) {
    draft = replaceFirst(draft, /throughout the universe/gi, territory);
    draft = replaceFirst(draft, /United States of America/gi, territory);
  }

  if (ownership) {
    draft = replaceFirst(
      draft,
      /All Masters produced hereunder[^.]+shall be entirely [^.]+\./i,
      `All Masters produced hereunder, and all ownership, approval, and rights terms, shall be controlled as follows: ${ownership}.`,
    );
  }

  if (partyOneRole && partyOne && partyOneRole.toLowerCase() !== 'producer') {
    draft = draft.replace(/\bPRODUCER\b/g, partyOneRole.toUpperCase());
  }

  if (partyTwoRole && partyTwo && partyTwoRole.toLowerCase() !== 'artist') {
    draft = draft.replace(/\bARTIST\b/g, partyTwoRole.toUpperCase());
  }

  draft = draft
    .replace(/,\s*19_{2,}/g, `, ${blank}`)
    .replace(/,\s*20_{2,}/g, `, ${blank}`)
    .replace(/Date:\s*_{2,}/gi, `Date: ${blank}`)
    .replace(/_{3,}/g, blank)
    .replace(/dated\s+_{8,},\s+_{8,}/gi, `dated ${blank}`)
    .replace(/dated\s+_{8,},\s+is/gi, `dated ${blank} is`);

  return normalizeSignatureBlocks(replaceDynamicPlaceholders(draft, answers), answers);
}

export function renderDraftFromTemplate({ templateId, answers = {}, userRequest = '' }) {
  const template = getTemplateSource(templateId);

  if (!template) {
    throw new Error('Template source not found.');
  }

  const draft = fillCommonContractTerms(template.templateText, answers);

  return draft || [
    template.title,
    '',
    `Party 1: ${answerOrBlank(answers.partyOneName)} (${answerOrBlank(answers.partyOneRole)})`,
    `Party 2: ${answerOrBlank(answers.partyTwoName)} (${answerOrBlank(answers.partyTwoRole)})`,
    `Project: ${answerOrBlank(answers.projectTitle)}`,
    `Compensation: ${answerOrBlank(answers.compensation)}`,
    `Royalty / Percentage: ${answerOrBlank(answers.royaltyPercentage)}`,
    `Ownership / Rights: ${answerOrBlank(answers.ownershipTerms)}`,
    `Term: ${answerOrBlank(answers.term)}`,
    `Territory: ${answerOrBlank(answers.territory)}`,
  ].join('\n');
}

export function renderTemplateTextForIntake(templateText, answers = {}) {
  return fillCommonContractTerms(templateText, answers);
}

export function buildMissingInputPlaceholders(inputs = [], answers = {}) {
  return inputs
    .filter((input) => !answer(answers[input.id]))
    .map((input) => ({
      field: input.id,
      label: input.label,
      placeholder: input.blankPlaceholder || blank,
      recommended: Boolean(input.recommended),
      optional: Boolean(input.optional),
    }));
}

export function renderStructuredDraftFromTemplate({ templateId, template, schema, answers = {}, userRequest = '' }) {
  const source = getTemplateSource(templateId);
  const hasDetectedBlankFields = orderedBlankInputs(schema).length > 0;
  let content = hasDetectedBlankFields && source?.templateText
    ? renderDraftByDetectedTemplateFields({ templateText: source.templateText, schema, answers })
    : renderDraftFromTemplate({ templateId, answers, userRequest });
  const inputs = schema?.inputs ?? schema?.questions ?? [];
  const missingInputs = buildMissingInputPlaceholders(inputs, answers);

  if (missingInputs.length && !/_{8,}/.test(content)) {
    content = [
      content,
      '',
      'Missing details to complete later:',
      ...missingInputs.map((input) => `${input.label}: ${input.placeholder}`),
    ].join('\n');
  }

  return {
    status: missingInputs.length ? 'ready_with_blank_placeholders' : 'ready',
    template_id: templateId,
    template_name: template?.title ?? schema?.template_name ?? schema?.templateTitle ?? 'Source Template',
    missing_inputs: missingInputs,
    placeholder_policy: schema?.blank_placeholder_behavior,
    expected_output_format: schema?.expected_output_format,
    content,
  };
}
