export async function searchContractTemplateLibrary(_userRequest) {
  return [];
}

export async function retrieveRelevantTemplateFromLibrary(_userRequest) {
  return null;
}

export async function ingestContractTemplateZip(_file) {
  throw new Error('ZIP ingestion is planned for a future template-library phase.');
}

export async function syncTemplatesToVectorStore() {
  throw new Error('Vector store sync is planned for a future template-library phase.');
}
