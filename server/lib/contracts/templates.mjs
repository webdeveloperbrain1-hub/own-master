import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { buildDynamicTemplateSchema } from './templateParser.mjs';
import { cleanTemplateText } from './templateTextCleaner.mjs';
import {
  acceptedDocumentFileTypes,
  defaultExpectedOutputFormat,
  defaultPlaceholderPolicy,
  normalizeTemplateInput,
} from './scanTemplateConfig.mjs';

const starterTemplates = [
  {
    id: 'split-sheet',
    title: 'Split Sheet',
    description: 'For documenting song ownership, writer shares, producer shares, and collaborator splits.',
    keywords: ['split', 'splits', 'writer', 'writers', 'songwriter', 'percentage', 'ownership', 'collaborator'],
  },
  {
    id: 'artist-producer-agreement',
    title: 'Artist Producer Agreement',
    description: 'For artists working with producers on beats, recordings, or tracks.',
    keywords: ['producer', 'beat', 'track', 'artist', 'recording', 'royalty', 'points'],
  },
  {
    id: 'producer-royalty-agreement',
    title: 'Producer Royalty Agreement',
    description: 'For producer royalty participation, royalty accounting, and payment terms.',
    keywords: ['producer', 'royalty', 'royalties', 'points', 'net receipts', 'payment'],
  },
  {
    id: 'artist-management-agreement',
    title: 'Artist Management Agreement',
    description: 'For artists hiring managers to help with career, business, and deal opportunities.',
    keywords: ['manager', 'management', 'commission', 'career', 'artist manager'],
  },
  {
    id: 'recording-agreement',
    title: 'Recording Agreement',
    description: 'For recording obligations, masters, deliverables, and artist recording services.',
    keywords: ['record', 'recording', 'album', 'single', 'masters', 'deliverables', 'label'],
  },
  {
    id: 'master-use-license',
    title: 'Master Use License',
    description: 'For licensing a sound recording/master for a specific use.',
    keywords: ['master', 'license', 'sound recording', 'recording use', 'use the song'],
  },
  {
    id: 'sync-license',
    title: 'Sync License',
    description: 'For using music in film, television, games, ads, social content, or visual media.',
    keywords: ['sync', 'film', 'tv', 'television', 'ad', 'commercial', 'game', 'video', 'youtube'],
  },
  {
    id: 'publishing-agreement',
    title: 'Publishing Agreement',
    description: 'For publishing rights, writer shares, administration, and composition income.',
    keywords: ['publishing', 'publisher', 'composition', 'writer share', 'admin', 'songwriter'],
  },
  {
    id: 'distribution-agreement',
    title: 'Distribution Agreement',
    description: 'For distribution services, release terms, fees, royalties, and platform delivery.',
    keywords: ['distribution', 'distributor', 'release', 'platforms', 'spotify', 'apple music'],
  },
  {
    id: 'booking-performance-agreement',
    title: 'Booking / Performance Agreement',
    description: 'For live shows, DJ sets, performances, booking fees, and event obligations.',
    keywords: ['booking', 'performance', 'show', 'gig', 'live', 'event', 'dj set', 'fee'],
  },
];

function readLibraryManifest() {
  const manifestPath = resolve(process.cwd(), 'server/data/contract-library.manifest.json');

  if (!existsSync(manifestPath)) {
    return [];
  }

  try {
    const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));
    return Array.isArray(manifest.templates) ? manifest.templates : [];
  } catch {
    return [];
  }
}

function readTemplateSources() {
  const sourcesPath = resolve(process.cwd(), 'server/data/contract-library.templates.json');

  if (!existsSync(sourcesPath)) {
    return new Map();
  }

  try {
    const data = JSON.parse(readFileSync(sourcesPath, 'utf8'));
    const templates = Array.isArray(data.templates) ? data.templates : [];
    return new Map(templates.map((template) => [template.id, template]));
  } catch {
    return new Map();
  }
}

const libraryTemplates = readLibraryManifest();
const templateSources = readTemplateSources();
const editablePriority = new Map([
  ['docx', 4],
  ['doc', 3],
  ['rtf', 2],
  ['pdf', 1],
]);

function sourceBaseKey(sourceFile = '') {
  return String(sourceFile)
    .split('/')
    .pop()
    ?.replace(/\.[^.]+$/, '')
    .replace(/\s+\(\d+\)$/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase() ?? '';
}

function sourcePriority(template = {}) {
  const extension = String(template.extension ?? '').toLowerCase();
  const quality = template.extractionQuality === 'text' ? 0.5 : 0;

  return (editablePriority.get(extension) ?? 0) + quality;
}

function buildPreferredSourceMap() {
  const all = [
    ...libraryTemplates,
    ...Array.from(templateSources.values()),
  ].filter((template) => template?.sourceFile);
  const byBase = new Map();

  for (const template of all) {
    const key = sourceBaseKey(template.sourceFile);
    const current = byBase.get(key);

    if (!current || sourcePriority(template) > sourcePriority(current)) {
      byBase.set(key, template);
    }
  }

  return byBase;
}

const preferredSourcesByBase = buildPreferredSourceMap();

function preferredSourceFor(template) {
  const preferred = preferredSourcesByBase.get(sourceBaseKey(template?.sourceFile));

  if (!preferred) {
    return template;
  }

  const sourceData = templateSources.get(preferred.id) ?? preferred;

  return {
    ...template,
    ...sourceData,
    id: template.id,
    title: template.title,
    category: template.category,
    description: template.description,
    preferredSourceId: preferred.id,
    preferredSourceFile: sourceData.sourceFile ?? preferred.sourceFile,
    preferredExtension: sourceData.extension ?? preferred.extension,
  };
}

function describeTemplate(template) {
  const text = `${template.title ?? ''} ${template.category ?? ''}`.toLowerCase();

  if (text.includes('sponsor')) {
    return 'Use this when a brand, sponsor, event, or artist team needs to define sponsorship benefits, promotional obligations, fees, and approval rights.';
  }

  if (text.includes('booking') || text.includes('performance') || text.includes('concert') || text.includes('appearance')) {
    return 'Use this for live shows, appearances, booking fees, performance obligations, cancellation terms, promoter duties, and event logistics.';
  }

  if (text.includes('producer') && text.includes('royalt')) {
    return 'Use this when producer compensation depends on royalties, points, accounting, recoupment, and payment timing.';
  }

  if (text.includes('producer')) {
    return 'Use this for an artist and producer working on beats, masters, recording sessions, credits, ownership, and producer compensation.';
  }

  if (text.includes('management') || text.includes('manager')) {
    return 'Use this for artist-manager relationships, manager duties, commission, term, territory, and career/business representation.';
  }

  if (text.includes('record')) {
    return 'Use this for recording obligations, master ownership, artist services, deliverables, advances, royalties, and release-related terms.';
  }

  if (text.includes('sync') || text.includes('synchronization')) {
    return 'Use this when music will be paired with film, TV, video, advertising, games, or other visual media.';
  }

  if (text.includes('master') && text.includes('license')) {
    return 'Use this to license an existing sound recording or master for a defined use, term, territory, and fee.';
  }

  if (text.includes('license') || text.includes('licensing')) {
    return 'Use this when rights are being granted for a specific use, scope, term, territory, fee, or approval process.';
  }

  if (text.includes('publishing') || text.includes('publisher') || text.includes('songwriter')) {
    return 'Use this for publishing rights, writer shares, administration, composition income, collections, and songwriter obligations.';
  }

  if (text.includes('distribution')) {
    return 'Use this for release distribution, platform delivery, distributor fees, royalty accounting, takedown rights, and reporting.';
  }

  if (text.includes('split')) {
    return 'Use this to document song ownership, songwriter shares, producer shares, copyright splits, and collaborator credits.';
  }

  return `Use this ${template.category ?? 'music business'} template as the approved source contract for the selected draft.`;
}

export const approvedTemplates = (libraryTemplates.length ? libraryTemplates : starterTemplates).map((template) => {
  const merged = {
    ...template,
    ...(templateSources.get(template.id) ?? {}),
  };
  const preferred = preferredSourceFor(merged);

  return {
    ...preferred,
    description: describeTemplate(preferred),
    templateText: preferred.templateText ? cleanTemplateText(preferred.templateText) : preferred.templateText,
    textPreview: preferred.textPreview ? cleanTemplateText(preferred.textPreview) : preferred.textPreview,
  };
});

export function getTemplateById(id) {
  return approvedTemplates.find((template) => template.id === id) ?? null;
}

export function getTemplateByTitle(title) {
  return approvedTemplates.find((template) => template.title === title) ?? null;
}

export function getTemplateQuestions(templateId) {
  return getTemplateSchema(templateId).questions;
}

export function normalizeTemplateSchema(template, schema) {
  const inputs = (schema.questions ?? [])
    .map((question) => normalizeTemplateInput(question))
    .filter((input) => input.id && input.label);

  const recommendedInputs = inputs.filter((input) => input.recommended).map((input) => input.id);
  const optionalInputs = inputs.filter((input) => input.optional).map((input) => input.id);

  return {
    ...schema,
    template_id: template?.id ?? schema.templateId ?? '',
    template_name: template?.title ?? schema.templateTitle ?? 'Source Template',
    description: template?.description ?? '',
    accepted_file_types: acceptedDocumentFileTypes,
    input_types: [...new Set(inputs.map((input) => input.input_type))],
    inputs,
    recommended_inputs: recommendedInputs,
    optional_inputs: optionalInputs,
    validation: {
      completenessBlocksProcessing: false,
      formatOnly: true,
    },
    blank_placeholder_behavior: defaultPlaceholderPolicy,
    ai_instructions: [
      `Use the selected template "${template?.title ?? schema.templateTitle ?? 'Source Template'}".`,
      'Use uploaded/source document text when available.',
      'Do not invent blank user-provided inputs.',
      'Render every missing user input as an underline placeholder.',
    ],
    expected_output_format: defaultExpectedOutputFormat,
    error_messages: {
      invalid_template_id: 'Template not found.',
      unsupported_file_type: 'This file type is not accepted by the selected template.',
      invalid_field_format: 'One or more provided fields has an invalid format.',
    },
    questions: inputs.map((input) => ({
      ...input,
      optional: input.optional,
      required: false,
      recommended: input.recommended,
      type: input.type,
    })),
  };
}

export function getTemplateSchema(templateId) {
  const source = getTemplateSource(templateId);
  const template = getTemplateById(templateId);

  if (!source && !template) {
    return normalizeTemplateSchema({ id: templateId, title: '' }, {
      version: 'dynamic-template-parser-v1',
      source: 'missing_template',
      templateId,
      templateTitle: '',
      questions: [],
      optionalSections: [],
      conditionalRules: [],
    });
  }

  const schema = buildDynamicTemplateSchema({ template: template ?? source, source });

  if (schema.questions.length >= 4 || schema.questions.some((question) => question.source === 'detected_blank')) {
    return normalizeTemplateSchema(template ?? source, schema);
  }

  return normalizeTemplateSchema(template ?? source, {
    ...schema,
    source: `${schema.source}_with_legacy_fallback`,
    questions: inferTemplateQuestions(template ?? source, source?.templateText ?? source?.textPreview ?? template?.description ?? ''),
  });
}

export function getTemplateSource(templateId) {
  const template = getTemplateById(templateId);
  const source = templateSources.get(templateId) ?? template;

  if (!source) {
    return null;
  }

  const preferred = preferredSourceFor(source);

  return {
    ...preferred,
    templateText: preferred.templateText ? cleanTemplateText(preferred.templateText) : preferred.templateText,
    textPreview: preferred.textPreview ? cleanTemplateText(preferred.textPreview) : preferred.textPreview,
  };
}

function pushUniqueQuestion(questions, question) {
  if (!questions.some((item) => item.id === question.id)) {
    questions.push(question);
  }
}

const questionLibrary = {
  partyOneName: { id: 'partyOneName', label: 'Who is the first party?', placeholder: 'Legal name of the first party', required: true },
  partyOneRole: { id: 'partyOneRole', label: 'What is the first party role?', placeholder: 'Artist, Producer, Manager, Licensor, Promoter', required: false },
  partyTwoName: { id: 'partyTwoName', label: 'Who is the second party?', placeholder: 'Legal name of the second party', required: true },
  partyTwoRole: { id: 'partyTwoRole', label: 'What is the second party role?', placeholder: 'Company, Artist, Licensee, Venue, Distributor', required: false },
  companyName: { id: 'companyName', label: 'What is the company, label, or payer name?', placeholder: 'Company, label, promoter, or payer legal name', required: true },
  producerName: { id: 'producerName', label: 'What is the producer name?', placeholder: 'Producer legal name', required: true },
  artistName: { id: 'artistName', label: 'What is the artist or performer name?', placeholder: 'Artist, group, or performer name', required: true },
  managerName: { id: 'managerName', label: 'What is the manager or management company name?', placeholder: 'Manager or management company legal name', required: true },
  promoterName: { id: 'promoterName', label: 'What is the promoter, buyer, or event company name?', placeholder: 'Promoter, buyer, venue, or event company legal name', required: true },
  sponsorName: { id: 'sponsorName', label: 'What is the sponsor or brand name?', placeholder: 'Sponsor or brand legal name', required: true },
  licensorName: { id: 'licensorName', label: 'Who is granting the rights?', placeholder: 'Licensor, rights holder, publisher, label, or artist', required: true },
  licenseeName: { id: 'licenseeName', label: 'Who is receiving the rights?', placeholder: 'Licensee, production company, advertiser, platform, or brand', required: true },
  publisherName: { id: 'publisherName', label: 'What is the publisher or publishing company name?', placeholder: 'Publisher or administrator legal name', required: true },
  songwriterName: { id: 'songwriterName', label: 'What is the songwriter or composer name?', placeholder: 'Writer or composer legal name', required: true },
  distributorName: { id: 'distributorName', label: 'What is the distributor name?', placeholder: 'Distributor or platform company legal name', required: true },
  agreementDate: { id: 'agreementDate', label: 'What is the agreement date?', placeholder: 'January 1, 2026, or leave blank', required: false },
  eventDate: { id: 'eventDate', label: 'What is the event or performance date?', placeholder: 'Event date, load-in date, or performance date', required: false },
  venueName: { id: 'venueName', label: 'What is the venue or event location?', placeholder: 'Venue name and city', required: false },
  projectTitle: { id: 'projectTitle', label: 'What song, master, project, or work is covered?', placeholder: 'Song, master, project, composition, or recording title', required: true },
  compositionTitle: { id: 'compositionTitle', label: 'What composition or song title is covered?', placeholder: 'Composition or song title', required: true },
  masterTitle: { id: 'masterTitle', label: 'What master recording is covered?', placeholder: 'Master recording title', required: true },
  masterCount: { id: 'masterCount', label: 'How many master recordings are covered?', placeholder: '1, 3, or leave blank', required: false },
  advanceAmount: { id: 'advanceAmount', label: 'What advance or upfront payment is included?', placeholder: '$500, $2,500, none, or leave blank', required: false },
  compensation: { id: 'compensation', label: 'What are the payment or compensation terms?', placeholder: 'Flat fee, advance, commission, royalties, guarantee, or leave blank', required: false },
  royaltyPercentage: { id: 'royaltyPercentage', label: 'What royalty rate, points, or percentage should apply?', placeholder: '3%, 15%, 2.75 cents per side, or leave blank', required: false },
  commissionRate: { id: 'commissionRate', label: 'What commission rate applies?', placeholder: '15%, 20%, or leave blank', required: false },
  guaranteeAmount: { id: 'guaranteeAmount', label: 'What guarantee, fee, or deposit is owed?', placeholder: '$1,000 guarantee, 50% deposit, or leave blank', required: false },
  paymentSchedule: { id: 'paymentSchedule', label: 'How often should statements or payments be made?', placeholder: 'Semi-annually, quarterly, monthly, after show, or leave blank', required: false },
  accountingPeriod: { id: 'accountingPeriod', label: 'What accounting/payment deadline applies?', placeholder: 'Within 45 days after each period, or leave blank', required: false },
  deliverables: { id: 'deliverables', label: 'What deliverables are required?', placeholder: 'Masters, stems, artwork, posts, performance, files, approvals', required: false },
  services: { id: 'services', label: 'What services or obligations are required?', placeholder: 'Recording, management, performance, promotion, distribution, licensing support', required: false },
  licensedUse: { id: 'licensedUse', label: 'What exact use is being licensed?', placeholder: 'Film, ad, YouTube video, game, trailer, social campaign', required: false },
  media: { id: 'media', label: 'What media, platforms, or channels are covered?', placeholder: 'TV, film, streaming, social, digital ads, all media', required: false },
  sponsorshipBenefits: { id: 'sponsorshipBenefits', label: 'What sponsorship benefits are included?', placeholder: 'Logo placement, mentions, tickets, booth, posts, exclusivity', required: false },
  platforms: { id: 'platforms', label: 'Which platforms or stores are covered?', placeholder: 'Spotify, Apple Music, YouTube, TikTok, DSPs, worldwide stores', required: false },
  ownershipTerms: { id: 'ownershipTerms', label: 'What ownership, rights, or approval terms should be confirmed?', placeholder: 'Who owns the master/publishing, scope of license, exclusivity, approvals', required: false },
  publishingShare: { id: 'publishingShare', label: 'What publishing or writer share applies?', placeholder: 'Writer share, publisher share, admin percentage, split', required: false },
  term: { id: 'term', label: 'How long should the agreement last?', placeholder: '1 year, 3 years, campaign period, perpetual, or leave blank', required: false },
  territory: { id: 'territory', label: 'What territory applies?', placeholder: 'Worldwide, United States, specific countries, or leave blank', required: false },
  cancellationTerms: { id: 'cancellationTerms', label: 'What cancellation or postponement terms apply?', placeholder: 'Cancellation deadline, kill fee, force majeure, reschedule terms', required: false },
  expenses: { id: 'expenses', label: 'What expenses or reimbursements are covered?', placeholder: 'Travel, hotel, per diem, production costs, approved expenses', required: false },
  notes: { id: 'notes', label: 'Any extra deal notes from the parties?', placeholder: 'Credits, deadlines, approvals, restrictions, special terms', required: false },
};

function addQuestions(questions, ids) {
  for (const id of ids) {
    pushUniqueQuestion(questions, questionLibrary[id]);
  }
}

function isUsableExtractedText(text = '') {
  const sample = String(text).slice(0, 3000);
  const legalWords = (sample.match(/\b(agreement|artist|producer|company|license|manager|publisher|performance|royalty|term|venue|sponsor)\b/gi) ?? []).length;
  const pdfMarkers = (sample.match(/\b(Linearized|FlateDecode|XRef|FontDescriptor|ObjStm|endobj|trailer|BaseFont)\b/g) ?? []).length;

  return legalWords >= 4 && pdfMarkers < 4;
}

function templateSignal(template, text = '') {
  const metadata = [
    template?.title,
    template?.category,
    template?.sourceFile,
    template?.description,
  ].filter(Boolean).join(' ');
  const sourceText = isUsableExtractedText(text) ? text : '';

  return `${metadata} ${sourceText}`.toLowerCase();
}

function classifyTemplate(template, text = '') {
  const lower = templateSignal(template, text);

  if (/sponsor|sponsorship|endorsement/.test(lower)) return 'sponsorship';
  if (/producer.*royalt|royalt.*producer|producer royalty|royalty specification/.test(lower)) return 'producerRoyalty';
  if (/management|manager/.test(lower)) return 'management';
  if (/booking|performance contract|concert|appearance|engagement|venue|promoter|live show|dj/.test(lower)) return 'booking';
  if (/sync|synchronization|film|television|tv|commercial|advertis|video game|visual/.test(lower)) return 'syncLicense';
  if (/master.*license|master use|sound recording license/.test(lower)) return 'masterLicense';
  if (/mechanical|copyright license|license|licensor|licensee/.test(lower)) return 'license';
  if (/publishing|publisher|songwriter|composer|composition|administration/.test(lower)) return 'publishing';
  if (/distribution|distributor|digital stores|platform|dsp/.test(lower)) return 'distribution';
  if (/split sheet|song split|writer split|collaborator split/.test(lower)) return 'split';
  if (/artist producer|producer agreement|beat|recording session/.test(lower)) return 'producer';
  if (/recording agreement|record company|album|masters|recording services/.test(lower)) return 'recording';

  return 'general';
}

function inferTemplateQuestions(template, text = '') {
  const lower = templateSignal(template, text);
  const type = classifyTemplate(template, text);
  const questions = [];

  const presets = {
    sponsorship: ['sponsorName', 'artistName', 'agreementDate', 'eventDate', 'venueName', 'sponsorshipBenefits', 'deliverables', 'compensation', 'term', 'territory', 'ownershipTerms'],
    booking: ['artistName', 'promoterName', 'agreementDate', 'eventDate', 'venueName', 'guaranteeAmount', 'paymentSchedule', 'deliverables', 'services', 'cancellationTerms', 'expenses'],
    management: ['artistName', 'managerName', 'agreementDate', 'commissionRate', 'services', 'expenses', 'term', 'territory', 'ownershipTerms'],
    syncLicense: ['licensorName', 'licenseeName', 'agreementDate', 'compositionTitle', 'masterTitle', 'licensedUse', 'media', 'compensation', 'term', 'territory', 'ownershipTerms'],
    masterLicense: ['licensorName', 'licenseeName', 'agreementDate', 'masterTitle', 'licensedUse', 'media', 'compensation', 'term', 'territory', 'ownershipTerms'],
    license: ['licensorName', 'licenseeName', 'agreementDate', 'projectTitle', 'licensedUse', 'media', 'compensation', 'term', 'territory', 'ownershipTerms'],
    publishing: ['songwriterName', 'publisherName', 'agreementDate', 'compositionTitle', 'publishingShare', 'royaltyPercentage', 'paymentSchedule', 'accountingPeriod', 'term', 'territory', 'ownershipTerms'],
    distribution: ['artistName', 'companyName', 'distributorName', 'agreementDate', 'projectTitle', 'platforms', 'compensation', 'royaltyPercentage', 'paymentSchedule', 'term', 'territory', 'ownershipTerms'],
    split: ['partyOneName', 'partyTwoName', 'compositionTitle', 'projectTitle', 'publishingShare', 'royaltyPercentage', 'ownershipTerms'],
    producerRoyalty: ['companyName', 'producerName', 'artistName', 'agreementDate', 'projectTitle', 'masterCount', 'advanceAmount', 'royaltyPercentage', 'paymentSchedule', 'accountingPeriod'],
    producer: ['producerName', 'artistName', 'agreementDate', 'projectTitle', 'masterCount', 'advanceAmount', 'compensation', 'royaltyPercentage', 'deliverables', 'ownershipTerms', 'term'],
    recording: ['artistName', 'companyName', 'agreementDate', 'projectTitle', 'masterCount', 'advanceAmount', 'royaltyPercentage', 'deliverables', 'term', 'territory', 'ownershipTerms'],
    general: ['partyOneName', 'partyOneRole', 'partyTwoName', 'partyTwoRole', 'agreementDate', 'projectTitle', 'compensation', 'term', 'territory', 'ownershipTerms'],
  };

  addQuestions(questions, presets[type] ?? presets.general);

  if (type !== 'general') {
    pushUniqueQuestion(questions, questionLibrary.notes);
    return questions;
  }

  if (/company|record company|label|payer/.test(lower)) {
    pushUniqueQuestion(questions, questionLibrary.companyName);
  }

  if (/producer/.test(lower)) {
    pushUniqueQuestion(questions, questionLibrary.producerName);
  }

  if (/artist|recording artist|performer/.test(lower)) {
    pushUniqueQuestion(questions, questionLibrary.artistName);
  }

  if (/manager|management/.test(lower)) {
    pushUniqueQuestion(questions, questionLibrary.managerName);
  }

  if (/promoter|venue|booking|performance|engagement|concert|appearance/.test(lower)) {
    addQuestions(questions, ['promoterName', 'eventDate', 'venueName']);
  }

  if (/sponsor|sponsorship|brand/.test(lower)) {
    addQuestions(questions, ['sponsorName', 'sponsorshipBenefits']);
  }

  if (/licensor|licensee|license|licensed/.test(lower)) {
    addQuestions(questions, ['licensorName', 'licenseeName', 'licensedUse']);
  }

  if (/date|dated|effective/.test(lower)) {
    pushUniqueQuestion(questions, questionLibrary.agreementDate);
  }

  if (/song|composition|track|recording|master|album|single|work|title/.test(lower)) {
    pushUniqueQuestion(questions, questionLibrary.projectTitle);
  }

  if (/number\)\s+master|number of masters|master recordings/.test(lower)) {
    pushUniqueQuestion(questions, questionLibrary.masterCount);
  }

  if (/advance|dollars|fee|payment|compensation|received/.test(lower)) {
    addQuestions(questions, ['advanceAmount', 'compensation']);
  }

  if (/royalt|points|percentage|cents per copy|net receipts|gross/.test(lower)) {
    pushUniqueQuestion(questions, questionLibrary.royaltyPercentage);
  }

  if (/statement|accounting|semi-annually|quarterly|monthly|payments shall be made/.test(lower)) {
    addQuestions(questions, ['paymentSchedule', 'accountingPeriod']);
  }

  if (/copyright|master|publishing|ownership|license|rights|exclusive/.test(lower)) {
    pushUniqueQuestion(questions, questionLibrary.ownershipTerms);
  }

  if (/term|duration|period|expire|perpetuity/.test(lower)) {
    pushUniqueQuestion(questions, questionLibrary.term);
  }

  if (/territory|worldwide|universe|country|united states|foreign/.test(lower)) {
    pushUniqueQuestion(questions, questionLibrary.territory);
  }

  pushUniqueQuestion(questions, questionLibrary.notes);

  return questions;
}
