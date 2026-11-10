// Free Render instances have no pre-deploy command. Apply migrations before
// starting this single-instance trial, then use the normal production server.
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { loadEnv } from './lib/env.mjs';
import { productionAuthErrors } from './lib/auth/authConfiguration.mjs';
import { productionSiteErrors } from './lib/deployment/siteConfiguration.mjs';

process.env.NODE_ENV = 'production';
loadEnv();
try {
  const errors = [...productionAuthErrors(), ...productionSiteErrors()];
  if (errors.length) throw new Error(errors.join('\n'));
  await new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [fileURLToPath(import.meta.resolve('prisma/build/index.js')), 'migrate', 'deploy'],
      { stdio: 'inherit', windowsHide: true });
    const terminate = () => child.kill('SIGTERM');
    process.once('SIGTERM', terminate);
    process.once('SIGINT', terminate);
    const cleanup = () => { process.off('SIGTERM', terminate); process.off('SIGINT', terminate); };
    child.once('error', error => { cleanup(); reject(error); });
    child.once('exit', code => { cleanup(); code === 0 ? resolve() : reject(new Error('Trial database migrations failed. Check the database connection and migration logs.')); });
  });
  await import('./apiServer.mjs');
} catch (error) { console.error(error.message); process.exitCode = 1; }
