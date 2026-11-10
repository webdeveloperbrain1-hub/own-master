import path from 'node:path';

export function publicSiteConfiguration(env = process.env) {
  return {
    businessName: env.BUSINESS_NAME?.trim() || 'Own Masters',
    supportEmail: /^[^\s@<>,;]+@[^\s@<>,;]+\.[a-z]{2,}$/i.test(env.SUPPORT_EMAIL || '') ? env.SUPPORT_EMAIL.trim() : '',
    aiEnabled: env.AI_FEATURES_ENABLED === 'true',
  };
}

export function productionSiteErrors(env = process.env) {
  const errors = [];
  if (!env.CONTRACT_STORAGE_ROOT || !path.isAbsolute(env.CONTRACT_STORAGE_ROOT))
    errors.push('Set CONTRACT_STORAGE_ROOT to an absolute, persistent, writable storage directory.');
  else {
    const root = path.resolve(env.CONTRACT_STORAGE_ROOT);
    for (const key of ['CONTRACT_ZIP_DIR', 'CONTRACT_TEMPLATE_DIR', 'GENERATED_CONTRACT_DIR', 'TMP_DIR']) {
      if (!env[key]) continue;
      const relative = path.relative(root, path.resolve(env[key]));
      if (relative === '..' || relative.startsWith('..' + path.sep) || path.isAbsolute(relative))
        errors.push(`Unset ${key} or keep it inside CONTRACT_STORAGE_ROOT so generated files use persistent storage.`);
    }
  }
  if (!env.BUSINESS_NAME?.trim() || /replace|your.business/i.test(env.BUSINESS_NAME))
    errors.push('Set BUSINESS_NAME to the operator name to show on the public information pages.');
  const { supportEmail } = publicSiteConfiguration(env);
  if (!supportEmail || /@.*\.(?:example|test|invalid|local)$/i.test(supportEmail))
    errors.push('Set SUPPORT_EMAIL to a real, monitored support address.');
  if (env.AI_FEATURES_ENABLED && !['true', 'false'].includes(env.AI_FEATURES_ENABLED))
    errors.push('AI_FEATURES_ENABLED must be true or false. Leave it false for the initial template-based release.');
  if (env.AI_FEATURES_ENABLED === 'true') {
    if (!['openai', 'ollama'].includes(env.AI_PROVIDER)) errors.push('Choose an AI_PROVIDER before enabling AI assistance.');
    if (env.AI_PROVIDER === 'openai' && !env.OPENAI_API_KEY) errors.push('Configure the server-side AI credentials before enabling AI assistance.');
    if (env.AI_PROVIDER === 'ollama' && (!env.OLLAMA_MODEL || !/^https?:\/\//.test(env.OLLAMA_BASE_URL || '')))
      errors.push('Configure OLLAMA_MODEL and a reachable OLLAMA_BASE_URL before enabling AI assistance.');
  }
  return errors;
}
