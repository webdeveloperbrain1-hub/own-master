export function contentDisposition(fileName, disposition = 'attachment') {
  const name = String(fileName || 'download');
  const fallback = name.replace(/[^a-zA-Z0-9._ -]/g, '_');
  const encoded = encodeURIComponent(name).replace(/['()*]/g, character =>
    `%${character.charCodeAt(0).toString(16).toUpperCase()}`);
  return `${disposition}; filename="${fallback}"; filename*=UTF-8''${encoded}`;
}
