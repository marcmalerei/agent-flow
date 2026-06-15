export function normalizeNodeLabel(value: string | undefined, fallback: string): string {
  const source = value?.trim() || fallback;
  return source.toLocaleLowerCase();
}

export function labelFromId(id: string): string {
  return normalizeNodeLabel(id.replace(/[-_]+/g, ' '), id);
}
