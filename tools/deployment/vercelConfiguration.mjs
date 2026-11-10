export function vercelConfiguration(env = process.env) {
  let backend;
  try {
    backend = new URL(env.OWN_MASTERS_BACKEND_ORIGIN);
    if (backend.protocol !== 'https:' || backend.origin !== env.OWN_MASTERS_BACKEND_ORIGIN ||
      backend.username || backend.password || ['localhost', '127.0.0.1', '[::1]'].includes(backend.hostname) ||
      /\.(?:example|invalid|test|local)$/.test(backend.hostname)) throw new Error();
  } catch {
    throw new Error('Set OWN_MASTERS_BACKEND_ORIGIN in Vercel to the deployed backend HTTPS origin (no path or trailing slash). See docs/vercel-backend-deployment.md.');
  }
  if (env.VERCEL_PROJECT_PRODUCTION_URL && backend.host === env.VERCEL_PROJECT_PRODUCTION_URL)
    throw new Error('OWN_MASTERS_BACKEND_ORIGIN must point to the backend service, not this Vercel website.');

  return {
    framework: 'vite',
    buildCommand: 'npm run build',
    outputDirectory: 'dist',
    routes: [
      {
        src: '/(.*)',
        headers: {
          'X-Content-Type-Options': 'nosniff',
          'Referrer-Policy': 'no-referrer',
          'X-Frame-Options': 'DENY',
        },
        continue: true,
      },
      { src: '/api', dest: `${backend.origin}/api` },
      { src: '/api/(.*)', dest: `${backend.origin}/api/$1` },
      { handle: 'filesystem' },
      // Deep links load React. API errors, missing assets and dot paths stay errors.
      { src: '/((?!api(?:/|$)|assets(?:/|$)|.*[.]).*)', dest: '/index.html' },
    ],
  };
}
