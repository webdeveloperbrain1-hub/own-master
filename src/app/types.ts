export interface AppUser {
  id: string;
  email: string;
  emailVerified?: boolean;
  user_metadata: { name: string };
  app_metadata: { role?: string };
}

export type ContractStatus = 'draft' | 'completed';

export interface Contract {
  id: string;
  userId: string;
  title: string;
  contractType: string;
  status: ContractStatus;
  content: string;
  userRequest: string | null;
  selectedTemplateId: string | null;
  selectedTemplateSourceFile: string | null;
  wizardAnswers: ContractWizardAnswers;
  aiRecommendation: ContractRecommendation | null;
  aiRiskReview: RiskReviewResult | null;
  aiSummary: string | null;
  riskFlags: RiskFlag[];
  lastAiReviewedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface ContractRow {
  id: string;
  user_id: string;
  title: string;
  contract_type: string;
  status: ContractStatus;
  content: string;
  user_request: string | null;
  selected_template_id?: string | null;
  selected_template_source_file?: string | null;
  wizard_answers?: ContractWizardAnswers | null;
  ai_recommendation?: ContractRecommendation | null;
  ai_risk_review?: RiskReviewResult | null;
  ai_summary?: string | null;
  risk_flags?: RiskFlag[] | null;
  last_ai_reviewed_at?: string | null;
  created_at: string;
  updated_at: string;
}

export interface CreateContractInput {
  title: string;
  contractType: string;
  userRequest?: string;
  selectedTemplateId?: string;
  selectedTemplateSourceFile?: string | null;
  aiRecommendation?: ContractRecommendation | null;
  wizardAnswers?: ContractWizardAnswers;
  content?: string;
}

export interface ContractWizardAnswers {
  [key: string]: string | string[] | undefined;
  partyOneName?: string;
  partyOneRole?: string;
  partyTwoName?: string;
  partyTwoRole?: string;
  companyName?: string;
  producerName?: string;
  artistName?: string;
  agreementDate?: string;
  masterCount?: string;
  advanceAmount?: string;
  paymentSchedule?: string;
  accountingPeriod?: string;
  projectTitle?: string;
  compensation?: string;
  royaltyPercentage?: string;
  ownershipTerms?: string;
  term?: string;
  territory?: string;
  recipientName?: string;
  recipientEmail?: string;
  recipientNote?: string;
  notes?: string;
}

export interface ContractTemplateOption {
  id: string;
  title: string;
  description: string;
  category?: string;
  sourceFile?: string | null;
  extractionQuality?: string;
  textPreview?: string;
  accepted_file_types?: string[];
}

export type TemplateFieldType = 'text' | 'textarea' | 'number' | 'percentage' | 'currency' | 'dropdown' | 'checkbox' | 'radio' | 'date' | 'select' | 'multiselect' | 'file' | 'boolean' | 'list' | 'count' | 'signature';

export interface TemplateQuestionCondition {
  dependsOn: string;
  operator: 'equals' | 'includes' | 'truthy';
  value?: string;
}

export interface TemplateQuestion {
  id: keyof ContractWizardAnswers | string;
  label: string;
  placeholder: string;
  required?: boolean;
  recommended?: boolean;
  type?: TemplateFieldType;
  input_type?: TemplateFieldType;
  options?: string[];
  helpText?: string;
  section?: string;
  optional?: boolean;
  blankPlaceholder?: string;
  blankIndex?: number;
  blankIndexes?: number[];
  lineIndex?: number;
  charIndex?: number;
  source?: string;
  controls?: string;
  validation?: {
    blocking: boolean;
    formatOnly: boolean;
    type: string;
  };
  conditional?: TemplateQuestionCondition;
}

export interface RecommendationAlternative {
  templateId: string;
  title: string;
  sourceFile?: string | null;
  description?: string;
  reason: string;
}

export interface ContractRecommendation {
  source: 'openai' | 'rule_based';
  recommendedTemplateId: string;
  recommendedContractType: string;
  recommendedCategory?: string;
  sourceFile?: string | null;
  confidence: number;
  reason: string;
  alternatives: RecommendationAlternative[];
  missingInfo: string[];
}

export interface ClauseExplanation {
  source: 'openai' | 'rule_based';
  plainEnglishExplanation: string;
  termsToReview: string[];
  riskLevel: 'low' | 'medium' | 'high';
  notLegalAdvice: true;
}

export interface RiskFlag {
  id: string;
  severity: 'low' | 'medium' | 'high';
  title: string;
  explanation: string;
  suggestedQuestion: string;
}

export interface RiskReviewResult {
  source: 'openai' | 'rule_based';
  riskFlags: RiskFlag[];
  summary: string;
  notLegalAdvice: true;
}

export type LocalTemplateScanStatus = 'not_scanned' | 'scanning' | 'scanned' | 'needs_review' | 'failed';
export type LocalTemplateFieldType = 'text' | 'textarea' | 'date' | 'currency' | 'number' | 'percentage' | 'select' | 'signature';

export interface LocalContractTemplate {
  id: string;
  name: string;
  category?: string | null;
  originalFileName: string;
  fileType: 'doc' | 'docx' | 'pdf' | 'rtf' | 'txt';
  textQuality?: string | null;
  aiScanStatus: LocalTemplateScanStatus;
  approved: boolean;
  createdAt: string;
  updatedAt: string;
  generatedCount?: number;
  fieldSchema?: LocalContractFieldSchema | null;
  warnings?: LocalContractWarning[] | null;
  scanError?: string | null;
  extractedText?: string | null;
  extractedTextPreview?: string | null;
}

export interface LocalContractField {
  key: string;
  label: string;
  type: LocalTemplateFieldType;
  required: boolean;
  confidence: 'high' | 'medium' | 'low';
  sourceText?: string;
  surroundingContext?: string;
  category: 'parties' | 'deal_terms' | 'dates' | 'payment' | 'rights' | 'signatures' | 'other';
  order: number;
}

export interface LocalContractWarning {
  type: string;
  message: string;
  context?: string;
}

export interface LocalContractFieldSchema {
  templateName: string;
  fields: LocalContractField[];
  warnings?: LocalContractWarning[];
  reviewRequired?: boolean;
  source?: string;
}
