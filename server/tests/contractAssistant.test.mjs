import assert from 'node:assert/strict';
import { buildTemplateScanPrompt, recommendContractTemplateRuleBased, validateBlankIntakeSchema } from '../lib/ai/contractAssistant.mjs';
import { validateRecommendation } from '../lib/ai/schemas.mjs';
import { approvedTemplates, getTemplateSchema } from '../lib/contracts/templates.mjs';
import { buildDynamicTemplateSchema } from '../lib/contracts/templateParser.mjs';
import { buildMissingInputPlaceholders, renderStructuredDraftFromTemplate, renderTemplateTextForIntake } from '../lib/contracts/templateRenderer.mjs';
import { detectLocalRiskFlags, mergeRiskFlags } from '../lib/contracts/riskFlags.mjs';
import { validateTemplateInputValue } from '../lib/contracts/scanTemplateConfig.mjs';

const recommendation = recommendContractTemplateRuleBased({
  userRequest: 'I produced a beat for an artist and want to get 3% royalties.',
  availableTemplates: approvedTemplates,
});

assert.match(recommendation.recommendedTemplateId, /producer/);
assert.match(recommendation.recommendedContractType, /Producer/);
assert.equal(recommendation.source === undefined || recommendation.source === 'rule_based', true);
assert.ok(recommendation.missingInfo.length > 0);

const invalidRecommendation = validateRecommendation(
  {
    recommendedTemplateId: 'made-up-template',
    confidence: 1,
    reason: 'Bad template id.',
    alternatives: [],
    missingInfo: [],
  },
  approvedTemplates,
);

assert.equal(invalidRecommendation, null);

const syncTemplate = approvedTemplates.find((template) => template.title.toLowerCase().includes('synchronization'));
const masterTemplate = approvedTemplates.find((template) => template.title.toLowerCase().includes('master recording'));
const producerRoyaltyTemplate = approvedTemplates.find((template) => template.title.toLowerCase().includes('producer royalties'));

const validRecommendation = validateRecommendation(
  {
    recommendedTemplateId: syncTemplate.id,
    confidence: 0.91,
    reason: 'The request mentions music in a film.',
    alternatives: [{ templateId: masterTemplate.id, reason: 'The master may also need to be licensed.' }],
    missingInfo: ['usage term'],
  },
  approvedTemplates,
);

assert.equal(validRecommendation.recommendedTemplateId, syncTemplate.id);
assert.equal(validRecommendation.alternatives[0].title, masterTemplate.title);

const localFlags = detectLocalRiskFlags('Rights are granted in perpetuity. [TO BE COMPLETED]');
assert.equal(localFlags.some((flag) => flag.id === 'perpetual-rights'), true);
assert.equal(localFlags.some((flag) => flag.id === 'missing-completion-markers'), true);

const mergedFlags = mergeRiskFlags(localFlags, [
  {
    id: 'perpetual-rights',
    severity: 'high',
    title: 'Duplicate',
    explanation: 'Duplicate should not replace the first local flag.',
    suggestedQuestion: 'Duplicate?',
  },
]);

assert.equal(mergedFlags.filter((flag) => flag.id === 'perpetual-rights').length, 1);

const dynamicSchema = buildDynamicTemplateSchema({
  template: {
    id: 'unit-license',
    title: 'Exclusive License Agreement',
    description: 'License template',
  },
  source: {
    templateText: [
      'This License Agreement is between [LICENSOR_NAME] and [LICENSEE_NAME].',
      'The composition is [PROJECT_TITLE].',
      'The license may be exclusive and may include royalties of [ROYALTY_PERCENTAGE].',
      'The territory and term will be supplied by the parties.',
    ].join('\n'),
  },
});

assert.equal(dynamicSchema.questions.some((question) => question.id === 'licensorName'), true);
assert.equal(dynamicSchema.questions.some((question) => question.id === 'licenseeName'), true);
assert.equal(dynamicSchema.questions.some((question) => question.id === 'royaltyPercentage' && question.type === 'percentage'), true);
assert.equal(dynamicSchema.questions.some((question) => question.id === 'exclusivityDuration' && question.conditional?.dependsOn === 'licenseType'), true);

const blankSchema = buildDynamicTemplateSchema({
  template: {
    id: 'unit-booking',
    title: 'Booking Contract',
    description: 'Booking template',
  },
  source: {
    templateText: [
      'BOOKING CONTRACT',
      '1. NAME OF MUSICIAN(S): ___________________________',
      '2. NUMBER OF MUSICIAN(S): ___________________________',
      '3. WAGE AGREED UPON: $___________________________',
    ].join('\n'),
  },
});

assert.equal(blankSchema.questions.length, 3);
assert.equal(blankSchema.questions.every((question) => question.source === 'detected_blank'), true);
assert.deepEqual(blankSchema.questions.map((question) => question.blankIndex), [0, 1, 2]);

const producerLetterSignatureSchema = buildDynamicTemplateSchema({
  template: {
    id: 'producer-letter-signature',
    title: 'Producer Letter Agreement',
    description: 'Producer template',
  },
  source: {
    templateText: [
      "PRODUCER'S LETTER OF AGREEMENT",
      '',
      'Sincerely,',
      '',
      '_______________________________',
      '',
      'PRODUCER',
      '',
      'Agreed and Accepted:',
      '',
      '_______________________________',
      '',
      'ARTIST',
    ].join('\n'),
  },
});

assert.deepEqual(
  producerLetterSignatureSchema.questions.map((question) => [question.label, question.type]),
  [
    ['Producer signature name', 'text'],
    ['Artist signature name', 'text'],
  ],
);

const tailoredBlankSchema = validateBlankIntakeSchema(
  {
    questions: [
      {
        id: blankSchema.questions[0].id,
        blankIndex: 0,
        label: 'Name of musician(s)',
        placeholder: 'e.g. John Smith',
        type: 'list',
        recommended: true,
        section: 'Performance details',
      },
      {
        id: blankSchema.questions[1].id,
        blankIndex: 1,
        label: 'Number of musician(s)',
        placeholder: 'e.g. 3',
        type: 'count',
        controls: blankSchema.questions[0].id,
        recommended: true,
        section: 'Performance details',
      },
      {
        id: blankSchema.questions[2].id,
        blankIndex: 2,
        label: 'Wage agreed upon',
        placeholder: 'e.g. 1500',
        type: 'currency',
        recommended: true,
        section: 'Payment',
      },
    ],
  },
  blankSchema,
);

assert.equal(tailoredBlankSchema.source, 'openai_blank_intake');
assert.equal(tailoredBlankSchema.blankCount, 3);
assert.equal(tailoredBlankSchema.questions[0].type, 'list');
assert.equal(tailoredBlankSchema.questions[1].controls, blankSchema.questions[0].id);
assert.deepEqual(tailoredBlankSchema.questions.slice(0, 3).map((question) => question.blankIndex), [0, 1, 2]);

assert.equal(
  validateBlankIntakeSchema(
    {
      questions: [
        { id: blankSchema.questions[0].id, blankIndex: 0, label: 'Only one blank', type: 'text' },
        { id: blankSchema.questions[1].id, blankIndex: 0, label: 'Duplicate blank', type: 'text' },
        { id: blankSchema.questions[2].id, blankIndex: 2, label: 'Third blank', type: 'text' },
      ],
    },
    blankSchema,
  ),
  null,
);

assert.equal(
  validateBlankIntakeSchema(
    {
      questions: [
        { id: blankSchema.questions[0].id, blankIndex: 0, label: 'First blank', type: 'text' },
        { id: blankSchema.questions[1].id, blankIndex: 1, label: 'Second blank', type: 'text' },
      ],
    },
    blankSchema,
  ),
  null,
);

const normalizedSchema = getTemplateSchema(syncTemplate.id);
assert.equal(normalizedSchema.template_id, syncTemplate.id);
assert.equal(normalizedSchema.accepted_file_types.includes('pdf'), true);
assert.equal(Array.isArray(normalizedSchema.inputs), true);
assert.equal(normalizedSchema.questions.every((question) => question.required === false), true);
assert.equal(normalizedSchema.validation.completenessBlocksProcessing, false);

const producerRoyaltySchema = getTemplateSchema(producerRoyaltyTemplate.id);
const producerRoyaltyAdvance = producerRoyaltySchema.questions.find((question) => question.id === 'advanceAmount');
const producerRoyaltyPaymentSchedule = producerRoyaltySchema.questions.find((question) => question.id === 'paymentSchedule');
assert.equal(producerRoyaltyAdvance?.conditional, undefined);
assert.equal(producerRoyaltyPaymentSchedule?.conditional, undefined);

const splitSheetSchema = getTemplateSchema('split-sheet');
const splitSheetSignature = splitSheetSchema.questions.find((question) => question.label === 'SIGNATURE');
assert.deepEqual(splitSheetSignature?.blankIndexes, [0, 1, 2, 3, 4, 5, 6]);
assert.equal(splitSheetSchema.questions.filter((question) => question.label === 'SIGNATURE').length, 1);

const renderedSplitSheet = renderStructuredDraftFromTemplate({
  templateId: 'split-sheet',
  template: approvedTemplates.find((template) => template.id === 'split-sheet'),
  schema: splitSheetSchema,
  answers: { [splitSheetSignature.id]: 'Jane Producer' },
  userRequest: '',
});
assert.equal((renderedSplitSheet.content.match(/Jane Producer/g) ?? []).length, 7);

const bookingSchema = getTemplateSchema('booking-contract');
assert.deepEqual(bookingSchema.questions.slice(0, 3).map((question) => question.label), ['Date', 'Month', 'Year']);
assert.equal(bookingSchema.questions.some((question) => question.source === 'detected_fillable_line'), true);
assert.equal(bookingSchema.questions.some((question) => /NAME OF MUSICIAN/i.test(question.label) && question.type === 'list'), true);
assert.equal(bookingSchema.questions.some((question) => /NUMBER OF MUSICIAN/i.test(question.label) && question.type === 'count'), true);
assert.equal(bookingSchema.questions.some((question) => /NAME AND ADDRESS OF PLACE OF PERFORMANCE/i.test(question.label) && question.type === 'textarea'), true);
assert.equal(bookingSchema.questions.some((question) => /WAGE AGREED UPON/i.test(question.label) && question.type === 'currency'), true);
const bookingEmployerSignature = bookingSchema.questions.find((question) => question.label === 'Employer signature');
const bookingMusicianSignature = bookingSchema.questions.find((question) => question.label === 'Musician signature');
assert.equal(bookingEmployerSignature?.type, 'text');
assert.equal(bookingMusicianSignature?.type, 'text');
assert.deepEqual(bookingEmployerSignature?.blankIndexes, [4]);
assert.deepEqual(bookingMusicianSignature?.blankIndexes, [5]);
const bookingCount = bookingSchema.questions.find((question) => /NUMBER OF MUSICIAN/i.test(question.label));
assert.equal(bookingCount?.controls, bookingSchema.questions.find((question) => /NAME OF MUSICIAN/i.test(question.label))?.id);

const missingInputs = buildMissingInputPlaceholders(normalizedSchema.inputs.slice(0, 3), {});
assert.equal(missingInputs.length, Math.min(3, normalizedSchema.inputs.length));
assert.match(missingInputs[0]?.placeholder ?? '', /_{8,}/);

const structuredBlankDraft = renderStructuredDraftFromTemplate({
  templateId: syncTemplate.id,
  template: syncTemplate,
  schema: normalizedSchema,
  answers: {},
  userRequest: '',
});
assert.equal(structuredBlankDraft.status, 'ready_with_blank_placeholders');
assert.equal(structuredBlankDraft.missing_inputs.length > 0, true);
assert.match(structuredBlankDraft.content, /_{8,}/);

const firstNumberInput = {
  id: 'masterCount',
  label: 'How many master recordings are covered?',
  input_type: 'number',
};
assert.equal(validateTemplateInputValue(firstNumberInput, ''), null);
assert.match(validateTemplateInputValue(firstNumberInput, 'many'), /number/);

assert.equal(normalizedSchema.accepted_file_types.includes('exe'), false);

const promptPayload = buildTemplateScanPrompt({
  template: syncTemplate,
  schema: normalizedSchema,
  documentText: 'Uploaded document text',
  answers: { licensorName: 'Blue Flame Publishing' },
});
assert.equal(promptPayload.template.template_id, syncTemplate.id);
assert.equal(promptPayload.missing_inputs.length > 0, true);
assert.match(JSON.stringify(promptPayload), /Do not guess/);
assert.match(JSON.stringify(promptPayload), /underline placeholder/);

const renderedPlaceholders = renderTemplateTextForIntake(
  'Agreement between [LICENSOR_NAME] and [LICENSEE_NAME] for [PROJECT_TITLE]. Royalty: [ROYALTY_PERCENTAGE]. Missing: [TERM_LENGTH].',
  {
    licensorName: 'Blue Flame Publishing',
    licenseeName: 'Moonlight Films LLC',
    projectTitle: 'Night Drive',
    royaltyPercentage: '3%',
  },
);

assert.equal(renderedPlaceholders.includes('[LICENSOR_NAME]'), false);
assert.match(renderedPlaceholders, /Blue Flame Publishing/);
assert.match(renderedPlaceholders, /Moonlight Films LLC/);
assert.match(renderedPlaceholders, /Night Drive/);
assert.match(renderedPlaceholders, /3%/);
assert.match(renderedPlaceholders, /Missing: ________________/);

const renderedSignatureBlock = renderTemplateTextForIntake(
  'Signatures below confirms all parties agreement.\nBlue Flame Beats LLC Company',
  {
    producerName: 'Blue Flame Beats LLC',
    companyName: 'Company',
  },
);

assert.match(renderedSignatureBlock, /_{10,}\s+_{10,}/);
assert.match(renderedSignatureBlock, /Blue Flame Beats LLC\s+Company/);

const renderedAcceptedBy = renderTemplateTextForIntake(
  'Accepted and agreed:\n______________________________\nBy: ______________________________\n0Jm Hn Hu0J',
  {},
);

assert.match(renderedAcceptedBy, /Accepted and agreed:\n_{10,}/);
assert.match(renderedAcceptedBy, /By: _{10,}/);
assert.equal(renderedAcceptedBy.includes('0Jm Hn Hu0J'), false);

const renderedMissingAcceptedByLines = renderTemplateTextForIntake(
  'ACCEPTED AND AGREED TO:\n\nBY:\n\ntu?C 0Jm H0J',
  {},
);

assert.match(renderedMissingAcceptedByLines, /ACCEPTED AND AGREED TO:\n\n_{10,}/);
assert.match(renderedMissingAcceptedByLines, /BY: _{10,}/);
assert.equal(renderedMissingAcceptedByLines.includes('0Jm H0J'), false);

const renderedWithoutNotes = renderStructuredDraftFromTemplate({
  templateId: syncTemplate.id,
  template: syncTemplate,
  schema: normalizedSchema,
  answers: {},
  userRequest: 'creator notes should stay out of the contract body',
});

assert.equal(renderedWithoutNotes.content.includes('Additional party notes'), false);
assert.equal(renderedWithoutNotes.content.includes('creator notes should stay out'), false);

console.log('contractAssistant tests passed');
