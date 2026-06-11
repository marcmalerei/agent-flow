export function optionalTextValue(value: string): string | undefined {
  return value === '' ? undefined : value;
}

export function referenceInstructionTextValue(value: string): string | undefined {
  return value.trim() === '' ? undefined : value;
}
