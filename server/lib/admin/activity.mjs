import { prisma } from '../prisma.mjs';

// Store operational events, never passwords, tokens, document bodies, or keys.
export function recordActivity(actor, action, entityType, entityId, description, db = prisma) {
  return db.platformActivity.create({ data: {
    actorId: actor?.id || null,
    actorName: actor?.user_metadata?.name || actor?.name || 'System',
    action, entityType, entityId, description: description.slice(0, 500),
  } });
}
