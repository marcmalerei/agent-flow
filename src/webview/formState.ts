export function optionalTextValue(value: string): string | undefined {
  return value === '' ? undefined : value;
}
