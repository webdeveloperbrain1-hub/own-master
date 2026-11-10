import { vercelConfiguration } from './tools/deployment/vercelConfiguration.mjs';

// Vercel hosts the frontend; the Docker service owns /api and private files.
export const config = vercelConfiguration(process.env);
