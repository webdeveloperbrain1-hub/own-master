// Production account cookies use /api on the website's own origin. Do not bake
// a developer's localhost API URL from .env into the deployable frontend.
process.env.VITE_API_BASE_URL = '';
const { build } = await import('vite');
await build();
