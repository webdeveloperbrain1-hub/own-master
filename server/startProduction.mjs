// Set production mode before importing the API or its authentication modules.
process.env.NODE_ENV = 'production';
try { await import('./apiServer.mjs'); }
catch (error) { console.error(error.message); process.exitCode = 1; }
