import { billing } from './billingService.mjs';
import { billingError } from './billingConfig.mjs';

export async function handleBillingRoutes(req, res, { url, sendJson, readBody, requireAuth }, service = billing) {
  if (!url.pathname.startsWith('/api/billing/')) return false;
  try {
    const path = url.pathname;
    if (path === '/api/billing/webhook' && req.method === 'POST') {
      let size = 0;
      const chunks = [];
      for await (const chunk of req) {
        size += chunk.length;
        if (size > 1024 * 1024) throw billingError('Payment notification is too large.', 413);
        chunks.push(chunk);
      }
      sendJson(res, 200, await service.webhook(Buffer.concat(chunks), req.headers['stripe-signature']));
    } else if (path === '/api/billing/catalog' && req.method === 'GET') {
      sendJson(res, 200, await service.catalog());
    } else if (path === '/api/billing/status' && req.method === 'GET') {
      sendJson(res, 200, await service.status(await requireAuth(req)));
    } else if (path === '/api/billing/checkout' && req.method === 'POST') {
      const auth = await requireAuth(req);
      sendJson(res, 200, await service.checkout(auth, await readBody(req)));
    } else if (path === '/api/billing/portal' && req.method === 'POST') {
      sendJson(res, 200, await service.portal(await requireAuth(req)));
    } else sendJson(res, 404, { error: 'Billing endpoint not found.' });
  } catch (error) {
    const status = error.status || 503;
    if (status >= 500) console.warn('[billing] Request could not be completed.');
    sendJson(res, status, { error: status >= 500 ? 'Payments are currently unavailable. Your workspace is still available; please try again later.' : error.message, code: error.code || 'billing_unavailable' });
  }
  return true;
}
