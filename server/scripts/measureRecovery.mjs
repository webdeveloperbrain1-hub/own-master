import { loadEnv } from '../lib/env.mjs';
import { prisma } from '../lib/prisma.mjs';
import { detectBlankCandidates } from '../lib/contracts/templateParser.mjs';
import { extractContractText } from '../lib/contracts/extractContractText.mjs';
import { scanFieldsWithAI } from '../lib/contracts/aiFieldScanner.mjs';

loadEnv();

const limitArg = process.argv.find((a) => a.startsWith('--limit='));
const limit = limitArg ? Number(limitArg.split('=')[1]) : 12;

const all = await prisma.contractTemplate.findMany({ orderBy: { createdAt: 'asc' } });
const targets = all
  .filter((t) => (t.fieldSchema?.source || '') === 'ollama_fallback_after_cleanup')
  .slice(0, limit);

let aiUsed = 0;
let fellBack = 0;

for (const target of targets) {
  const extracted = await extractContractText(target.storagePath);
  const blankCandidates = detectBlankCandidates(extracted.text);
  const schema = await scanFieldsWithAI({ contractText: extracted.text, blankCandidates });

  const usesAi = schema.source === 'ollama';
  if (usesAi) aiUsed += 1; else fellBack += 1;

  console.log(`${(usesAi ? 'AI ✅' : 'fallback ❌').padEnd(12)} ${schema.source.padEnd(34)} ${schema.fields.length} fields  ${target.name}`);
}

console.log(`\n=========== ${targets.length} previously-fallback templates ===========`);
console.log(`Now using AI labels: ${aiUsed}   Still fell back: ${fellBack}`);

await prisma.$disconnect();
