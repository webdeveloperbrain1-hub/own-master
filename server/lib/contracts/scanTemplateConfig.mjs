export const BLANK_PLACEHOLDER = '____________________';
export const LONG_BLANK_PLACEHOLDER = '__________________________________________________';
export const MULTILINE_BLANK_PLACEHOLDER = [
  LONG_BLANK_PLACEHOLDER,
  LONG_BLANK_PLACEHOLDER,
  LONG_BLANK_PLACEHOLDER,
].join('\n');

export const supportedScanInputTypes = new Set([
  'text',
  'textarea',
  'select',
  'multiselect',
  'number',
  'date',
  'file',
  'boolean',
  'percentage',
  'currency',
  'dropdown',
  'checkbox',
  'radio',
  'list',
  'count',
]);

export const acceptedDocumentFileTypes = [
  'pdf',
  'doc',
  'docx',
  'rtf',
  'txt',
];

export const defaultPlaceholderPolicy = {
  mode: 'underline',
  singleLine: BLANK_PLACEHOLDER,
  longLine: LONG_BLANK_PLACEHOLDER,
  multiLine: MULTILINE_BLANK_PLACEHOLDER,
  instructions: 'Blank inputs are allowed. Do not guess them. Render missing values as visible underline placeholders.',
};

export const defaultExpectedOutputFormat = {
  type: 'structured_contract_draft',
  statusValues: ['ready', 'ready_with_blank_placeholders'],
  requiredKeys: ['status', 'template_id', 'template_name', 'missing_inputs', 'content'],
};

export function normalizeTemplateInput(question = {}) {
  const rawType = String(question.type ?? 'text');
  const typeAliases = {
    dropdown: 'select',
    radio: 'select',
    checkbox: 'boolean',
    percentage: 'text',
    currency: 'text',
    list: 'list',
    count: 'number',
  };
  const inputType = typeAliases[rawType] ?? rawType;
  const normalizedType = supportedScanInputTypes.has(inputType) ? inputType : 'text';
  const recommended = question.recommended === undefined
    ? Boolean(question.required)
    : Boolean(question.recommended);
  const optional = question.optional === undefined ? !recommended : Boolean(question.optional);

  return {
    id: String(question.id ?? '').replace(/[^a-zA-Z0-9_]/g, '').slice(0, 80),
    label: String(question.label ?? '').trim().slice(0, 180),
    placeholder: String(question.placeholder ?? BLANK_PLACEHOLDER).trim().slice(0, 180),
    type: rawType,
    input_type: normalizedType,
    recommended,
    required: false,
    optional,
    section: String(question.section ?? 'Template details').slice(0, 80),
    helpText: question.helpText
      ? String(question.helpText).slice(0, 220)
      : 'Leave blank if unknown. The draft will show an underline placeholder.',
    options: Array.isArray(question.options)
      ? question.options.map((option) => String(option).slice(0, 80)).filter(Boolean).slice(0, 12)
      : undefined,
    validation: {
      blocking: false,
      formatOnly: true,
      type: normalizedType,
    },
    defaultValue: question.defaultValue ?? '',
    blankPlaceholder: normalizedType === 'textarea'
      ? defaultPlaceholderPolicy.multiLine
      : normalizedType === 'text' && String(question.id ?? '').toLowerCase().includes('notes')
        ? defaultPlaceholderPolicy.longLine
        : defaultPlaceholderPolicy.singleLine,
    conditional: question.conditional,
    blankIndex: Number.isInteger(question.blankIndex) ? question.blankIndex : undefined,
    blankIndexes: Array.isArray(question.blankIndexes)
      ? question.blankIndexes.filter(Number.isInteger).slice(0, 80)
      : undefined,
    lineIndex: Number.isInteger(question.lineIndex) ? question.lineIndex : undefined,
    lineIndexes: Array.isArray(question.lineIndexes)
      ? question.lineIndexes.filter(Number.isInteger).slice(0, 80)
      : undefined,
    charIndex: Number.isInteger(question.charIndex) ? question.charIndex : undefined,
    source: question.source,
    controls: question.controls,
  };
}

export function validateTemplateInputValue(input, value) {
  const text = Array.isArray(value) ? value.join(', ') : String(value ?? '').trim();

  if (!text) {
    return null;
  }

  if (input.input_type === 'number' && Number.isNaN(Number(text.replace(/[$,%\s]/g, '')))) {
    return `${input.label} must be a number when provided.`;
  }

  if (input.input_type === 'date' && Number.isNaN(Date.parse(text))) {
    return `${input.label} must be a valid date when provided.`;
  }

  if (input.input_type === 'boolean' && !['true', 'false', 'yes', 'no', '1', '0'].includes(text.toLowerCase())) {
    return `${input.label} must be yes or no when provided.`;
  }

  if ((input.input_type === 'select' || input.input_type === 'multiselect') && input.options?.length) {
    const values = Array.isArray(value) ? value : [text];
    const allowed = new Set(input.options.map((option) => option.toLowerCase()));
    const invalid = values.find((item) => item && !allowed.has(String(item).toLowerCase()));

    if (invalid) {
      return `${input.label} must match one of the available options when provided.`;
    }
  }

  return null;
}
