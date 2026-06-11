import type { ContractWizardAnswers } from '../types';

const blank = '________________';
const signatureLine = '______________________________';

function signatureColumns(leftLabel: string, rightLabel: string) {
  return `${signatureLine}    ${signatureLine}\n${leftLabel.padEnd(signatureLine.length + 4, ' ')}${rightLabel}`;
}

function signatureLabel(input: string, fallback: string) {
  return input === blank ? fallback : input;
}

function signatureName(name: string, role: string, fallback: string) {
  return name === blank ? signatureLabel(role, fallback) : name;
}

function value(input?: string) {
  return input?.trim() || blank;
}

function royalty(input?: string) {
  return input?.trim() ? `${input.trim()} royalties` : blank;
}

// ── Position-based blank fill (mirrors ContractFill artifact) ─────────────────
// templateText : raw template with ___ blanks
// fieldIds     : ordered list of field IDs (one per blank, same order)
// answers      : { [fieldId]: string | string[] }
export function fillTemplateWithAnswers(
  templateText: string,
  fieldIds: string[],
  answers: ContractWizardAnswers,
): string {
  const parts: string[] = [];
  const re = /_{3,}/g;
  let last = 0;
  let fi = 0;
  let m: RegExpExecArray | null;

  re.lastIndex = 0;
  while ((m = re.exec(templateText)) !== null) {
    parts.push(templateText.slice(last, m.index));

    const fieldId = fieldIds[fi];
    const rawVal = fieldId !== undefined ? answers[fieldId] : undefined;

    if (Array.isArray(rawVal)) {
      const filled = rawVal.filter(Boolean).join('\n');
      parts.push(filled || m[0]);
    } else {
      const str = typeof rawVal === 'string' ? rawVal.trim() : '';
      parts.push(str || m[0]);
    }

    last = m.index + m[0].length;
    fi++;
  }

  parts.push(templateText.slice(last));
  return parts.join('');
}

// ── Built-in template texts (fallback when backend is unavailable) ─────────────
export const BUILT_IN_TEMPLATES: Record<string, string> = {
  'split-sheet': `SPLIT SHEET

Song Title: ___________________________
Date: ___________________________
Recording Artist / Project: ___________________________

CONTRIBUTORS:

Name(s) of Contributor(s): ___________________________
Number of Contributors: ___________________________
Role(s) (e.g. Writer, Producer): ___________________________
Writer Share(s) (%): ___________________________
Publisher Share(s) (%): ___________________________
PRO / Publisher Affiliation: ___________________________

Notes / Additional Terms: ___________________________

Total Writer Shares must equal 100%.
Total Publisher Shares must equal 100%.

Signature(s): ___________________________
Date(s) Signed: ___________________________`,

  'artist-producer-agreement': `ARTIST PRODUCER AGREEMENT

Date: ___________________________

Artist: ___________________________
Producer: ___________________________

1. PROJECT
Song / Project Title: ___________________________
Services Description: ___________________________
Session Date(s): ___________________________

2. COMPENSATION
Upfront Fee: $___________________________
Producer Royalty: ___________________%
Royalty Calculated On: ___________________________

3. OWNERSHIP
Master Rights: ___________________________
Publishing Rights: ___________________________
Producer Credit: ___________________________

4. TERM AND TERRITORY
Territory: ___________________________
Term: ___________________________

5. ADDITIONAL TERMS
___________________________

SIGNATURES:
______________________________        ______________________________
Artist Signature                       Producer Signature
______________________________        ______________________________
Artist Printed Name / Date             Producer Printed Name / Date`,

  'producer-royalty-agreement': `PRODUCER ROYALTY AGREEMENT

Date: ___________________________

Label / Artist: ___________________________
Producer: ___________________________

1. PROJECT
Project Title: ___________________________
Estimated Release Date: ___________________________

2. ROYALTIES
Net Receipts Royalty Rate: ___________________%
Royalty Base: ___________________________
Accounting Period: ___________________________
Payment Terms: ___________________________

3. ADVANCE
Advance Amount: $___________________________
Recoupment Terms: ___________________________

4. CREDITS
Producer Credit: ___________________________
Additional Credits: ___________________________

5. TERM AND TERRITORY
Term: ___________________________
Territory: ___________________________

6. ADDITIONAL TERMS
___________________________

SIGNATURES:
______________________________        ______________________________
Label / Artist Signature               Producer Signature
______________________________        ______________________________
Printed Name / Date                    Printed Name / Date`,

  'artist-management-agreement': `ARTIST MANAGEMENT AGREEMENT

Date: ___________________________

Artist(s): ___________________________
Manager: ___________________________

1. TERM
Initial Term: ___________________________
Renewal Options: ___________________________
Termination Notice Period: ___________________________

2. SCOPE
Manager will assist with: ___________________________
Territory: ___________________________

3. COMMISSION
Commission Percentage: ___________________%
Commission Base (Gross / Net): ___________________________
Excluded Income: ___________________________
Expense Approval Limit: $___________________________

4. AUTHORITY
Manager may act on behalf of Artist for: ___________________________
Transactions requiring Artist written approval: ___________________________

5. ADDITIONAL TERMS
___________________________

SIGNATURES:
______________________________        ______________________________
Artist Signature                       Manager Signature
______________________________        ______________________________
Artist Printed Name / Date             Manager Printed Name / Date`,

  'recording-agreement': `RECORDING AGREEMENT

Date: ___________________________

Record Label: ___________________________
Recording Artist: ___________________________

1. TERM
Initial Period: ___________________________
Option Periods: ___________________________
Territory: ___________________________

2. RECORDING COMMITMENT
Minimum Delivery (Albums / Singles): ___________________________
Delivery Deadline: ___________________________
Recording Budget: $___________________________

3. ROYALTIES
Artist Royalty Rate: ___________________%
Royalty Base: ___________________________
Digital Royalty Rate: ___________________%
Packaging Deduction: ___________________%

4. ADVANCE / RECORDING FUND
Amount: $___________________________
Recoupment Rate: ___________________%

5. OWNERSHIP
Master Rights: ___________________________
Publishing Ownership: ___________________________

6. DISTRIBUTION
Distribution Channels: ___________________________
Release Schedule: ___________________________

7. ADDITIONAL TERMS
___________________________

SIGNATURES:
______________________________        ______________________________
Label Authorized Signatory             Artist Signature
______________________________        ______________________________
Printed Name / Title / Date            Printed Name / Date`,

  'master-use-license': `MASTER USE LICENSE

Date: ___________________________

Licensor (Master Owner): ___________________________
Licensee: ___________________________

1. LICENSED MASTER
Song Title: ___________________________
Artist: ___________________________
Recording Duration: ___________________________
Recording Date: ___________________________

2. LICENSED USE
Specific Use Description: ___________________________
Project / Production Title: ___________________________
Media Type(s): ___________________________
Platform(s): ___________________________

3. LICENSE TERMS
Exclusivity: ___________________________
Territory: ___________________________
License Period: ___________________________

4. FEE
License Fee: $___________________________
Payment Due: ___________________________

5. RESTRICTIONS
___________________________

6. REQUIRED CREDIT
___________________________

7. ADDITIONAL TERMS
___________________________

SIGNATURES:
______________________________        ______________________________
Licensor Signature                     Licensee Signature
______________________________        ______________________________
Printed Name / Date                    Printed Name / Date`,

  'sync-license': `SYNC LICENSE AGREEMENT

Date: ___________________________

Licensor: ___________________________
Licensee: ___________________________

1. LICENSED WORK
Song Title: ___________________________
Songwriter(s): ___________________________
Publisher(s): ___________________________
Master Owner: ___________________________

2. LICENSED PROJECT
Project / Production Title: ___________________________
Type of Use: ___________________________
Scene / Usage Description: ___________________________
Duration of Use: ___________________________

3. RIGHTS GRANTED
Media: ___________________________
Territory: ___________________________
License Period: ___________________________
Exclusivity: ___________________________

4. FEES
Sync License Fee: $___________________________
Master Use Fee: $___________________________
Payment Terms: ___________________________

5. RESTRICTIONS
___________________________

6. REQUIRED CREDITS
___________________________

7. ADDITIONAL TERMS
___________________________

SIGNATURES:
______________________________        ______________________________
Licensor Signature                     Licensee Signature
______________________________        ______________________________
Printed Name / Date                    Printed Name / Date`,

  'publishing-agreement': `PUBLISHING AGREEMENT

Date: ___________________________

Songwriter / Writer: ___________________________
Publisher: ___________________________

1. TERM
Initial Term: ___________________________
Option Periods: ___________________________
Delivery Commitment: ___________________________

2. COMPOSITIONS
Compositions Covered: ___________________________
Co-Writes Included: ___________________________

3. RIGHTS
Rights Granted to Publisher: ___________________________
Rights Retained by Writer: ___________________________
Reversion Clause: ___________________________

4. INCOME SPLITS
Publisher Share: ___________________%
Writer Share: ___________________%
Sync Income Split: ___________________________
Performance Income Distribution: ___________________________

5. ADVANCE
Advance: $___________________________
Recoupment Terms: ___________________________

6. ADMINISTRATION
Admin Territory: ___________________________
Sub-Publishing Rights: ___________________________

7. CREDITS
Writer Credit Line: ___________________________

8. ADDITIONAL TERMS
___________________________

SIGNATURES:
______________________________        ______________________________
Writer Signature                       Publisher Signature
______________________________        ______________________________
Printed Name / Date                    Printed Name / Date`,

  'distribution-agreement': `DISTRIBUTION AGREEMENT

Date: ___________________________

Artist / Label: ___________________________
Distributor: ___________________________

1. TERM
Initial Term: ___________________________
Renewal Terms: ___________________________
Termination Notice Period: ___________________________

2. RELEASES
Catalog Covered: ___________________________
New Releases: ___________________________
Release Schedule: ___________________________

3. CHANNELS
Digital Platforms: ___________________________
Physical Distribution: ___________________________
Territories: ___________________________

4. REVENUE
Artist Net Revenue: ___________________%
Distribution Fee: ___________________%
Other Fees / Costs: ___________________________
Payment Schedule: ___________________________

5. OWNERSHIP
Master Ownership: ___________________________
Metadata / Artwork Rights: ___________________________

6. MARKETING
Marketing Obligations: ___________________________
Playlist Pitching / Promo: ___________________________

7. ADDITIONAL TERMS
___________________________

SIGNATURES:
______________________________        ______________________________
Artist / Label Signature               Distributor Signature
______________________________        ______________________________
Printed Name / Date                    Printed Name / Date`,

  'booking-performance-agreement': `BOOKING / PERFORMANCE AGREEMENT

Date: ___________________________

Performer / Artist: ___________________________
Purchaser / Venue / Promoter: ___________________________

1. PERFORMANCE DETAILS
Event Name: ___________________________
Venue Name and Address: ___________________________
Performance Date: ___________________________
Performance Time: ___________________________
Set Length: ___________________________
Number of Sets: ___________________________

2. COMPENSATION
Performance Fee: $___________________________
Deposit Amount: $___________________________
Deposit Due Date: ___________________________
Balance Due: ___________________________
Payment Method: ___________________________

3. TECHNICAL REQUIREMENTS
Sound Requirements: ___________________________
Lighting Requirements: ___________________________
Stage Requirements: ___________________________

4. HOSPITALITY
Accommodations: ___________________________
Meals / Rider: ___________________________
Transportation: ___________________________

5. CANCELLATION
Cancellation Notice Required: ___________________________
Cancellation Fee: ___________________________

6. ADDITIONAL TERMS
___________________________

SIGNATURES:
______________________________        ______________________________
Performer / Artist Signature           Purchaser / Promoter Signature
______________________________        ______________________________
Printed Name / Date                    Printed Name / Date`,
};

// ── Deterministic draft generator (legacy / last-resort fallback) ─────────────
export function generateDeterministicContractDraft(contractType: string, answers: ContractWizardAnswers, userRequest?: string) {
  const partyOne = value(answers.partyOneName as string);
  const partyOneRole = value(answers.partyOneRole as string);
  const partyTwo = value(answers.partyTwoName as string);
  const partyTwoRole = value(answers.partyTwoRole as string);
  const project = value(answers.projectTitle as string);
  const compensation = value(answers.compensation as string);
  const royaltyPercentage = royalty(answers.royaltyPercentage as string);
  const ownershipTerms = value(answers.ownershipTerms as string);
  const term = value(answers.term as string);
  const territory = value(answers.territory as string);
  const notes = value((answers.notes as string) || userRequest);

  const commonIntro = `${contractType}

This draft was created from an approved Own Masters starter template and the answers currently provided by the user. Missing material terms remain underlined. This is not legal advice.

1. Parties
This agreement is between ${partyOne}, acting as ${partyOneRole}, and ${partyTwo}, acting as ${partyTwoRole}.

2. Project
The project covered by this agreement is "${project}".`;

  const endings = `

7. Items To Confirm
- Full legal names and contact details: ${partyOne === blank || partyTwo === blank ? blank : 'provided'}
- Ownership and approval rights: ${ownershipTerms}
- Payment timing and accounting details: ${compensation}
- Any additional release, credit, or delivery obligations: ${notes}

8. Signature Blocks
${signatureColumns(signatureName(partyOne, partyOneRole, 'Party 1'), signatureName(partyTwo, partyTwoRole, 'Party 2'))}`;

  if (contractType === 'Artist Producer Agreement' || contractType === 'Producer Royalty Agreement') {
    return `${commonIntro}

3. Producer Services
The producer will provide production-related services for the project, including beat, recording, arrangement, or production contributions as applicable: ${notes}.

4. Compensation and Royalties
Compensation is ${compensation}. Royalty participation is ${royaltyPercentage}. The parties must confirm whether royalties are calculated on gross revenue, net receipts, or another defined basis.

5. Ownership and Master Rights
Master ownership and control are: ${ownershipTerms}. No additional ownership transfer is implied unless expressly completed by the parties.

6. Term and Territory
The term is ${term}. The territory is ${territory}.${endings}`;
  }

  if (contractType === 'Split Sheet') {
    return `${commonIntro}

3. Contributor Shares
The parties will document writer, producer, publishing, and master participation shares for the project. Any unconfirmed split should remain underlined until agreed.

4. Ownership
Current ownership notes: ${ownershipTerms}.

5. Compensation
Payment or royalty notes: ${compensation}. Royalty percentage notes: ${royaltyPercentage}.

6. Confirmations
Each contributor should confirm their role, percentage, PRO/publisher information, and approval before release.${endings}`;
  }

  if (contractType === 'Sync License' || contractType === 'Master Use License') {
    return `${commonIntro}

3. Licensed Use
The licensed use is: ${notes}. The license should specify media, platforms, territory, duration, and whether the use is exclusive.

4. Rights Granted
Rights granted are limited to the completed scope: ${ownershipTerms}. Any missing scope should remain underlined.

5. Fee and Payment
The fee or payment terms are ${compensation}.

6. Term and Territory
The term is ${term}. The territory is ${territory}.${endings}`;
  }

  if (contractType === 'Artist Management Agreement') {
    return `${commonIntro}

3. Management Services
The manager will support career, business, and opportunity development as described here: ${notes}.

4. Commission and Expenses
Commission or compensation terms are ${compensation}. Expense approvals and reimbursement rules should be completed before signing.

5. Authority
The manager may not bind the artist to material obligations unless the parties complete and approve those terms in writing.

6. Term and Territory
The term is ${term}. The territory is ${territory}.${endings}`;
  }

  return `${commonIntro}

3. Scope
The scope of this agreement is: ${notes}.

4. Compensation
Payment, royalties, or consideration are ${compensation}. Royalty percentage notes: ${royaltyPercentage}.

5. Ownership and Rights
Ownership, approval, and rights terms are ${ownershipTerms}.

6. Term and Territory
The term is ${term}. The territory is ${territory}.${endings}`;
}