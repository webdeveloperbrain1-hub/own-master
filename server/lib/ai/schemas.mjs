const severities = ['low', 'medium', 'high'];

export function clampConfidence(value) {
  const number = Number(value);

  if (!Number.isFinite(number)) {
    return 0.5;
  }

  return Math.max(0, Math.min(1, number));
}

function isString(value) {
  return typeof value === 'string' && value.trim().length > 0;
}

function stringArray(value, limit = 8) {
  if (!Array.isArray(value)) {
    return [];
  }

  return value.filter(isString).map((item) => item.trim()).slice(0, limit);
}

export function validateRecommendation(value, availableTemplates) {
  if (!value || typeof value !== 'object') {
    return null;
  }

  const template = availableTemplates.find((item) => item.id === value.recommendedTemplateId);

  if (!template || !isString(value.reason)) {
    return null;
  }

  const alternatives = Array.isArray(value.alternatives)
    ? value.alternatives
        .filter((item) => item && typeof item === 'object')
        .map((item) => {
          const alternativeTemplate = availableTemplates.find((templateItem) => templateItem.id === item.templateId);

          if (!alternativeTemplate || !isString(item.reason)) {
            return null;
          }

          return {
            templateId: alternativeTemplate.id,
            title: alternativeTemplate.title,
            sourceFile: alternativeTemplate.sourceFile ?? null,
            description: alternativeTemplate.description ?? '',
            reason: item.reason.trim(),
          };
        })
        .filter(Boolean)
        .slice(0, 3)
    : [];

  return {
    recommendedTemplateId: template.id,
    recommendedContractType: template.title,
    recommendedCategory: template.category ?? 'Music Business Contracts',
    sourceFile: template.sourceFile ?? null,
    confidence: clampConfidence(value.confidence),
    reason: value.reason.trim(),
    alternatives,
    missingInfo: stringArray(value.missingInfo, 8),
  };
}

export function validateClauseExplanation(value) {
  if (!value || typeof value !== 'object' || !isString(value.plainEnglishExplanation)) {
    return null;
  }

  const riskLevel = severities.includes(value.riskLevel) ? value.riskLevel : 'medium';

  return {
    plainEnglishExplanation: value.plainEnglishExplanation.trim(),
    termsToReview: stringArray(value.termsToReview, 6),
    riskLevel,
    notLegalAdvice: true,
  };
}

export function validateRiskReview(value) {
  if (!value || typeof value !== 'object' || !isString(value.summary)) {
    return null;
  }

  const riskFlags = Array.isArray(value.riskFlags)
    ? value.riskFlags
        .filter((item) => item && typeof item === 'object')
        .map((item, index) => {
          if (!isString(item.title) || !isString(item.explanation)) {
            return null;
          }

          return {
            id: isString(item.id) ? item.id.trim().toLowerCase().replace(/[^a-z0-9-]/g, '-') : `ai-risk-${index + 1}`,
            severity: severities.includes(item.severity) ? item.severity : 'medium',
            title: item.title.trim(),
            explanation: item.explanation.trim(),
            suggestedQuestion: isString(item.suggestedQuestion) ? item.suggestedQuestion.trim() : 'Should this term be reviewed before signing?',
          };
        })
        .filter(Boolean)
        .slice(0, 8)
    : [];

  return {
    riskFlags,
    summary: value.summary.trim(),
    notLegalAdvice: true,
  };
}

export function validateFollowUpQuestions(value) {
  if (!value || typeof value !== 'object' || !Array.isArray(value.suggestedQuestions)) {
    return { suggestedQuestions: [] };
  }

  return {
    suggestedQuestions: value.suggestedQuestions
      .filter((item) => item && typeof item === 'object' && isString(item.id) && isString(item.label) && isString(item.reason))
      .map((item) => ({
        id: item.id.trim(),
        label: item.label.trim(),
        reason: item.reason.trim(),
      }))
      .slice(0, 5),
  };
}
