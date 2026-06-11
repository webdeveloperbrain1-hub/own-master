import { requestOpenAIJson } from './openaiClient.mjs';
import {
  validateClauseExplanation,
  validateFollowUpQuestions,
  validateRecommendation,
  validateRiskReview,
} from './schemas.mjs';
import { approvedTemplates } from '../contracts/templates.mjs';
import { detectLocalRiskFlags, mergeRiskFlags } from '../contracts/riskFlags.mjs';
import { defaultPlaceholderPolicy } from '../contracts/scanTemplateConfig.mjs';

const intakeFieldTypes = new Set(['text', 'textarea', 'number', 'percentage', 'currency', 'dropdown', 'checkbox', 'radio', 'date', 'list', 'count']);

const systemPrompt = `You are the Own Masters Contract AI assistant.

You help artists, producers, managers, labels, publishers, and rights holders create draft music business contracts from approved Own Masters templates.

You are not a lawyer and do not provide legal advice.

You must:
- recommend the best matching contract template from the provided template list
- ask for missing material terms
- explain contract concepts in plain English
- flag business/legal terms that deserve review
- return structured JSON that matches the requested schema
- be concise, practical, and music-business focused

You must not:
- invent party names
- invent payment amounts
- invent royalty percentages
- invent ownership terms
- invent publishing splits
- invent governing law
- invent dates
- invent contract duration
- invent exclusivity terms
- claim that a contract is legally valid
- claim to provide legal advice
- create a final contract from scratch when an approved template is available

If information is missing, return the missing fields or suggested questions.`;

const defaultMissingInfo = ['party names', 'song title', 'payment terms', 'ownership terms', 'duration'];

function cleanIntakeQuestion(question, fallbackIds = new Set()) {
  const id = String(question?.id ?? '').replace(/[^a-zA-Z0-9_]/g, '').slice(0, 80);
  const label = String(question?.label ?? '').trim().slice(0, 180);
  const placeholder = String(question?.placeholder ?? '').trim().slice(0, 180);
  const type = intakeFieldTypes.has(question?.type) ? question.type : 'text';

  if (!id || !label || fallbackIds.has(id)) {
    return null;
  }

  return {
    id,
    label,
    placeholder: placeholder || label,
    type,
    required: false,
    recommended: question?.recommended === undefined ? Boolean(question?.required) : Boolean(question.recommended),
    optional: question?.optional === undefined ? !question?.required : Boolean(question.optional),
    section: String(question?.section ?? 'Template details').slice(0, 80),
    helpText: question?.helpText ? String(question.helpText).slice(0, 220) : undefined,
    options: Array.isArray(question?.options) ? question.options.map((option) => String(option).slice(0, 80)).filter(Boolean).slice(0, 8) : undefined,
    conditional: question?.conditional && question.conditional.dependsOn
      ? {
          dependsOn: String(question.conditional.dependsOn).replace(/[^a-zA-Z0-9_]/g, '').slice(0, 80),
          operator: ['equals', 'includes', 'truthy'].includes(question.conditional.operator) ? question.conditional.operator : 'equals',
          value: question.conditional.value ? String(question.conditional.value).slice(0, 80) : undefined,
        }
      : undefined,
  };
}

function cleanControls(value) {
  const controls = String(value ?? '').replace(/[^a-zA-Z0-9_]/g, '').slice(0, 80);
  return controls || undefined;
}

function buildBlankContexts(templateText = '') {
  const text = String(templateText ?? '');
  return [...text.matchAll(/_{3,}/g)].map((match, blankIndex) => {
    const start = match.index ?? 0;
    const end = start + match[0].length;

    return {
      blankIndex,
      before: text.slice(Math.max(0, start - 220), start).replace(/\s+/g, ' ').trim(),
      blank: match[0],
      after: text.slice(end, end + 220).replace(/\s+/g, ' ').trim(),
    };
  });
}

export function validateBlankIntakeSchema(response, parserSchema) {
  const parserQuestions = Array.isArray(parserSchema?.questions) ? parserSchema.questions : [];
  const blankQuestions = parserQuestions
    .filter((question) => question?.source === 'detected_blank' && Number.isInteger(question.blankIndex))
    .sort((a, b) => a.blankIndex - b.blankIndex);

  if (!blankQuestions.length || !response || !Array.isArray(response.questions)) {
    return null;
  }

  if (response.questions.length !== blankQuestions.length) {
    return null;
  }

  const byBlankIndex = new Map(blankQuestions.map((question) => [question.blankIndex, question]));
  const seenBlankIndexes = new Set();
  const cleanedQuestions = [];

  for (const aiQuestion of response.questions) {
    const blankIndex = Number(aiQuestion?.blankIndex);
    const fallback = byBlankIndex.get(blankIndex);

    if (!fallback || seenBlankIndexes.has(blankIndex)) {
      return null;
    }

    seenBlankIndexes.add(blankIndex);

    const label = String(aiQuestion?.label ?? fallback.label ?? '').trim().slice(0, 180);
    const placeholder = String(aiQuestion?.placeholder ?? fallback.placeholder ?? label).trim().slice(0, 180);
    const type = intakeFieldTypes.has(aiQuestion?.type) ? aiQuestion.type : fallback.type ?? 'text';
    const section = String(aiQuestion?.section ?? fallback.section ?? 'Template details').slice(0, 80);
    const helpText = String(aiQuestion?.helpText ?? fallback.helpText ?? '').trim().slice(0, 220);
    const options = Array.isArray(aiQuestion?.options)
      ? aiQuestion.options.map((option) => String(option).slice(0, 80)).filter(Boolean).slice(0, 10)
      : fallback.options;
    const controls = cleanControls(aiQuestion?.controls) ?? cleanControls(fallback.controls);

    if (!label) {
      return null;
    }

    cleanedQuestions.push({
      ...fallback,
      id: fallback.id,
      label,
      placeholder: placeholder || label,
      type,
      required: false,
      recommended: aiQuestion?.recommended === undefined ? Boolean(fallback.recommended) : Boolean(aiQuestion.recommended),
      optional: aiQuestion?.optional === undefined ? Boolean(fallback.optional) : Boolean(aiQuestion.optional),
      section,
      helpText: helpText || undefined,
      options,
      controls,
      source: 'detected_blank',
      blankIndex,
    });
  }

  if (seenBlankIndexes.size !== blankQuestions.length) {
    return null;
  }

  const nonBlankQuestions = parserQuestions.filter((question) => question?.source !== 'detected_blank');

  return {
    ...parserSchema,
    source: 'openai_blank_intake',
    questions: [...cleanedQuestions, ...nonBlankQuestions].slice(0, 80),
    inputs: [...cleanedQuestions, ...nonBlankQuestions].slice(0, 80),
    blankCount: blankQuestions.length,
    optionalSections: Array.isArray(response?.optionalSections) ? response.optionalSections.map(String).slice(0, 10) : parserSchema?.optionalSections ?? [],
    conditionalRules: Array.isArray(response?.conditionalRules) ? response.conditionalRules.slice(0, 16) : parserSchema?.conditionalRules ?? [],
  };
}

function validateIntakeSchema(response, parserSchema) {
  if (!response || !Array.isArray(response.questions)) {
    return null;
  }

  const parserQuestions = Array.isArray(parserSchema?.questions) ? parserSchema.questions : [];
  const existingIds = new Set();
  const questions = [];

  for (const question of parserQuestions) {
    if (question?.id && !existingIds.has(question.id)) {
      existingIds.add(question.id);
      questions.push(question);
    }
  }

  const aiQuestions = Array.isArray(response?.questions) ? response.questions : [];

  for (const question of aiQuestions) {
    const cleaned = cleanIntakeQuestion(question, existingIds);

    if (cleaned) {
      existingIds.add(cleaned.id);
      questions.push(cleaned);
    }
  }

  if (questions.length < parserQuestions.length) {
    return null;
  }

  return {
    ...parserSchema,
    source: 'openai_template_intake',
    questions: questions.slice(0, 32),
    optionalSections: Array.isArray(response?.optionalSections) ? response.optionalSections.map(String).slice(0, 10) : parserSchema?.optionalSections ?? [],
    conditionalRules: questions.filter((question) => question.conditional).map((question) => ({
      fieldId: question.id,
      ...question.conditional,
    })),
  };
}

export async function generateTemplateIntakeWithAI({ template, templateText = '', parserSchema }) {
  const response = await requestOpenAIJson({
    messages: [
      { role: 'system', content: systemPrompt },
      {
        role: 'user',
        content: JSON.stringify({
          task: 'Analyze this approved Own Masters source contract and return a dynamic intake form schema. Do not write or change contract clauses. Do not invent answers. Only ask questions needed to fill blanks, placeholders, and conditional deal terms found in the template.',
          outputSchema: {
            questions: [
              {
                id: 'camelCase string',
                label: 'plain-English question',
                placeholder: 'example answer or hint',
                type: 'text | textarea | number | percentage | currency | dropdown | checkbox | radio | date',
                required: 'always false; missing values do not block generation',
                recommended: 'boolean; useful for best results, but never blocking',
                optional: 'boolean',
                section: 'string',
                helpText: 'short simple explanation, not legal advice',
                options: ['for dropdown/radio only'],
                conditional: {
                  dependsOn: 'field id',
                  operator: 'equals | includes | truthy',
                  value: 'trigger value',
                },
              },
            ],
            optionalSections: ['string'],
          },
          placeholderPolicy: defaultPlaceholderPolicy,
          rules: [
            'Base questions only on the template text, placeholders, blanks, and clause context.',
            'Use conditional questions for royalties, advances, exclusivity, territory, term, and optional services when the template supports them.',
            'Do not ask irrelevant questions.',
            'Do not add legal terms to the contract.',
            'Do not mark blank fields as blocking.',
            'Use recommended:true for fields that improve draft quality.',
            'If a value is missing, the renderer will leave an underline placeholder and processing must continue.',
          ],
          template: {
            id: template?.id,
            title: template?.title,
            category: template?.category,
            description: template?.description,
            sourceFile: template?.sourceFile,
          },
          parserSchema,
          templateText: String(templateText ?? '').slice(0, 9000),
        }),
      },
    ],
    maxTokens: 2200,
  });

  return validateIntakeSchema(response, parserSchema);
}

export async function generateBlankIntakeWithAI({ template, templateText = '', parserSchema }) {
  const parserQuestions = Array.isArray(parserSchema?.questions) ? parserSchema.questions : [];
  const blankQuestions = parserQuestions
    .filter((question) => question?.source === 'detected_blank' && Number.isInteger(question.blankIndex))
    .sort((a, b) => a.blankIndex - b.blankIndex);

  if (!blankQuestions.length) {
    return null;
  }

  const blankContexts = buildBlankContexts(templateText).slice(0, blankQuestions.length);

  const response = await requestOpenAIJson({
    messages: [
      { role: 'system', content: systemPrompt },
      {
        role: 'user',
        content: JSON.stringify({
          task: 'Analyze the detected underline blanks in this approved Own Masters source contract and tailor the intake questions for those exact blanks. Count and preserve every empty underline line. Do not write or change contract clauses.',
          outputSchema: {
            questions: [
              {
                id: 'must match the provided parser question id',
                blankIndex: 'number; must match exactly one detected blank index',
                label: 'plain-English field label for this exact blank',
                placeholder: 'example answer or hint',
                type: 'text | textarea | number | percentage | currency | dropdown | checkbox | radio | date | list | count',
                required: 'always false; missing values keep the underline blank',
                recommended: 'boolean',
                optional: 'boolean',
                section: 'string',
                helpText: 'short simple explanation, not legal advice',
                options: ['for dropdown/radio only'],
                controls: 'for count fields only, the id of the linked list field',
              },
            ],
            optionalSections: ['string'],
            conditionalRules: [
              {
                fieldId: 'question id',
                dependsOn: 'question id',
                operator: 'equals | includes | truthy',
                value: 'trigger value',
              },
            ],
          },
          strictRules: [
            `Return exactly ${blankQuestions.length} questions, one for each detected underline blank.`,
            'Do not add questions that do not correspond to a detected blank.',
            'Do not remove, merge, duplicate, or reorder blank indexes.',
            'Use the provided question id for each matching blankIndex.',
            'Use list for plural name fields like NAME OF MUSICIAN(S) when one blank can contain multiple entries.',
            'Use count for fields like NUMBER OF MUSICIAN(S), and set controls to the linked list field id when obvious.',
            'Use currency for money blanks, percentage for royalty/commission percentage blanks, date for date blanks, and textarea only for larger narrative blanks.',
            'Do not invent party names, amounts, dates, ownership, duration, or territory.',
            'If context is unclear, keep the parser label but make it more readable.',
          ],
          template: {
            id: template?.id,
            title: template?.title,
            category: template?.category,
            description: template?.description,
            sourceFile: template?.sourceFile,
          },
          blankCount: blankQuestions.length,
          detectedBlanks: blankQuestions.map((question) => ({
            id: question.id,
            blankIndex: question.blankIndex,
            parserLabel: question.label,
            parserType: question.type,
            parserPlaceholder: question.placeholder,
            context: blankContexts.find((context) => context.blankIndex === question.blankIndex),
          })),
          templateText: String(templateText ?? '').slice(0, 9000),
        }),
      },
    ],
    maxTokens: Math.min(3600, 900 + blankQuestions.length * 120),
  });

  return validateBlankIntakeSchema(response, parserSchema);
}

export function buildTemplateScanPrompt({ template, schema, documentText = '', answers = {} }) {
  const inputs = schema?.inputs ?? schema?.questions ?? [];
  const missingInputs = inputs
    .filter((input) => !String(answers[input.id] ?? '').trim())
    .map((input) => ({
      field: input.id,
      label: input.label,
      placeholder: input.blankPlaceholder ?? defaultPlaceholderPolicy.singleLine,
    }));

  return {
    task: 'Generate or scan a document using the selected Own Masters template.',
    template: {
      template_id: template?.id ?? schema?.template_id,
      template_name: template?.title ?? schema?.template_name,
      description: template?.description ?? schema?.description,
      accepted_file_types: schema?.accepted_file_types,
    },
    inputs,
    provided_inputs: answers,
    missing_inputs: missingInputs,
    document_text: String(documentText ?? '').slice(0, 12000),
    ai_instructions: [
      ...(schema?.ai_instructions ?? []),
      'Use the selected template only. Do not silently fall back to a generic scan.',
      'Do not guess, infer, or invent user-provided details.',
      'For every blank input needed in the output, render the configured underline placeholder.',
    ],
    placeholder_policy: schema?.blank_placeholder_behavior ?? defaultPlaceholderPolicy,
    expected_output_format: schema?.expected_output_format,
  };
}

export function recommendContractTemplateRuleBased({ userRequest = '', availableTemplates = approvedTemplates }) {
  const request = userRequest.toLowerCase();
  const scored = availableTemplates
    .map((template) => {
      const keywordScore = (template.keywords ?? []).reduce((score, keyword) => {
        return request.includes(keyword.toLowerCase()) ? score + 1 : score;
      }, 0);
      const editableBoost = ['doc', 'docx', 'rtf'].includes(template.extension) ? 0.35 : 0;
      const extractedBoost = template.extractionQuality === 'text' && !String(template.textPreview ?? '').includes('Linearized 1/L') ? 0.2 : 0;
      const pdfPenalty = template.extension === 'pdf' ? -0.15 : 0;
      const title = `${template.title} ${template.category}`.toLowerCase();
      const producerIntentBoost = /(producer|produced|beat|production)/.test(request) && title.includes('producer') ? 1.25 : 0;
      const managerMismatchPenalty = /(producer|produced|beat|production)/.test(request) && title.includes('manager') ? -0.75 : 0;
      const syncIntentBoost = /(sync|film|movie|tv|television|video|commercial)/.test(request) && /(sync|synchronization|film|movie|license)/.test(title) ? 1.25 : 0;
      const royaltyIntentBoost =
        /(royalt|royalties|royalty|points|accounting|statement|attachment)/.test(request) && /(royalt|royalties|royalty)/.test(title)
          ? 2
          : 0;
      const royaltyMismatchPenalty =
        /(royalt|royalties|royalty|points|accounting|statement|attachment)/.test(request) && /(producer)/.test(title) && !/(royalt|royalties|royalty)/.test(title)
          ? -0.6
          : 0;

      return {
        template,
        score:
          keywordScore +
          editableBoost +
          extractedBoost +
          pdfPenalty +
          producerIntentBoost +
          managerMismatchPenalty +
          syncIntentBoost +
          royaltyIntentBoost +
          royaltyMismatchPenalty,
      };
    })
    .sort((a, b) => b.score - a.score);

  const winner = scored[0]?.score > 0 ? scored[0].template : availableTemplates[0];
  const alternatives = scored
    .filter((item) => item.template.id !== winner.id)
    .slice(0, 3)
    .map(({ template }) => ({
      templateId: template.id,
      title: template.title,
      sourceFile: template.sourceFile ?? null,
      description: template.description ?? '',
      reason: template.description ?? `This approved source template may fit the deal details you described.`,
    }));

  return {
    recommendedTemplateId: winner.id,
    recommendedContractType: winner.title,
    recommendedCategory: winner.category ?? 'Music Business Contracts',
    sourceFile: winner.sourceFile ?? null,
    confidence: scored[0]?.score > 1 ? 0.72 : 0.52,
    reason: winner.description
      ? `Based on the request, Own Masters matched this deal to ${winner.title}: ${winner.description}`
      : `Based on the request, Own Masters matched keywords and music-business context to ${winner.title}.`,
    alternatives,
    missingInfo: inferMissingInfo(userRequest),
  };
}

function inferMissingInfo(userRequest) {
  const request = userRequest.toLowerCase();
  const missing = [];

  if (!/(artist|producer|manager|publisher|label|licensee|licensor)\s+[a-z]/i.test(userRequest)) {
    missing.push('party names');
  }

  if (!request.includes('song') && !request.includes('track') && !request.includes('single') && !request.includes('beat')) {
    missing.push('song title');
  }

  if (!/\d+\s*%/.test(userRequest) && !request.includes('percent')) {
    missing.push('royalty percentage or payment amount');
  }

  if (!request.includes('own') && !request.includes('master') && !request.includes('publishing')) {
    missing.push('ownership terms');
  }

  return missing.length ? missing : defaultMissingInfo;
}

export async function recommendContractTemplateWithAI(input) {
  const availableTemplates = input.availableTemplates?.length ? input.availableTemplates : approvedTemplates;
  const ruleBased = recommendContractTemplateRuleBased({ userRequest: input.userRequest, availableTemplates });

  const response = await requestOpenAIJson({
    messages: [
      { role: 'system', content: systemPrompt },
      {
        role: 'user',
        content: JSON.stringify({
          task: 'Recommend the best approved Own Masters contract template.',
          outputSchema: {
            recommendedTemplateId: 'string, must be one of availableTemplates.id',
            recommendedContractType: 'string',
            confidence: 'number from 0 to 1',
            reason: 'string',
            alternatives: [{ templateId: 'string', title: 'string', reason: 'string' }],
            missingInfo: ['string'],
          },
          userRequest: String(input.userRequest ?? '').slice(0, 2000),
          availableTemplates,
        }),
      },
    ],
  });

  const validated = validateRecommendation(response, availableTemplates);

  return validated ? { source: 'openai', ...validated } : { source: 'rule_based', ...ruleBased };
}

export async function explainContractClause(input) {
  const clauseText = String(input.clauseText ?? '').slice(0, 4000);

  if (!clauseText.trim()) {
    return {
      source: 'rule_based',
      plainEnglishExplanation: 'Select or provide a clause to explain.',
      termsToReview: [],
      riskLevel: 'low',
      notLegalAdvice: true,
    };
  }

  const response = await requestOpenAIJson({
    messages: [
      { role: 'system', content: systemPrompt },
      {
        role: 'user',
        content: JSON.stringify({
          task: 'Explain this contract clause in plain English. Do not provide legal advice.',
          outputSchema: {
            plainEnglishExplanation: 'string',
            termsToReview: ['string'],
            riskLevel: 'low | medium | high',
            notLegalAdvice: true,
          },
          contractType: String(input.contractType ?? '').slice(0, 120),
          clauseText,
        }),
      },
    ],
  });

  const validated = validateClauseExplanation(response);

  if (validated) {
    return { source: 'openai', ...validated };
  }

  return {
    source: 'rule_based',
    plainEnglishExplanation: 'AI explanation is unavailable right now, but your contract draft is still saved. Review defined terms, payment language, ownership, duration, and any exclusivity carefully.',
    termsToReview: ['payment terms', 'ownership', 'duration'],
    riskLevel: 'medium',
    notLegalAdvice: true,
  };
}

export async function reviewContractRiskWithAI(input) {
  const contractText = String(input.contractText ?? '').slice(0, 12000);
  const localFlags = Array.isArray(input.existingRiskFlags) ? input.existingRiskFlags : detectLocalRiskFlags(contractText);

  const response = await requestOpenAIJson({
    messages: [
      { role: 'system', content: systemPrompt },
      {
        role: 'user',
        content: JSON.stringify({
          task: 'Review this generated draft for business/legal risk flags. Do not claim legal invalidity. Do not rewrite the draft.',
          outputSchema: {
            riskFlags: [
              {
                id: 'string',
                severity: 'low | medium | high',
                title: 'string',
                explanation: 'string',
                suggestedQuestion: 'string',
              },
            ],
            summary: 'string',
            notLegalAdvice: true,
          },
          contractType: String(input.contractType ?? '').slice(0, 120),
          existingRiskFlags: localFlags,
          contractText,
        }),
      },
    ],
    maxTokens: 1100,
  });

  const validated = validateRiskReview(response);

  if (validated) {
    return {
      source: 'openai',
      riskFlags: mergeRiskFlags(localFlags, validated.riskFlags),
      summary: validated.summary,
      notLegalAdvice: true,
    };
  }

  return {
    source: 'rule_based',
    riskFlags: localFlags,
    summary: localFlags.length
      ? 'This draft includes terms that deserve review before anyone relies on it.'
      : 'No obvious local risk flags were detected. This is not legal advice.',
    notLegalAdvice: true,
  };
}

export async function suggestFollowUpQuestions(input) {
  const response = await requestOpenAIJson({
    messages: [
      { role: 'system', content: systemPrompt },
      {
        role: 'user',
        content: JSON.stringify({
          task: 'Suggest follow-up questions for unanswered material terms. Do not invent answers.',
          outputSchema: {
            suggestedQuestions: [{ id: 'string', label: 'string', reason: 'string' }],
          },
          templateId: input.templateId,
          contractType: input.contractType,
          answers: input.answers ?? {},
          visibleTemplateFields: input.visibleTemplateFields ?? [],
        }),
      },
    ],
  });

  return validateFollowUpQuestions(response);
}
