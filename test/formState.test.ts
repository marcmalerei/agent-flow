import { describe, expect, it } from 'vitest';
import { optionalTextValue, referenceInstructionTextValue } from '../src/webview/formState';

describe('webview form state', () => {
  it('preserves spaces while typing reference instructions', () => {
    expect(referenceInstructionTextValue('Create a ')).toBe('Create a ');
    expect(referenceInstructionTextValue('Create a summary with risks.')).toBe('Create a summary with risks.');
  });

  it('stores blank reference instructions as undefined', () => {
    expect(referenceInstructionTextValue('')).toBeUndefined();
    expect(referenceInstructionTextValue('   ')).toBeUndefined();
  });

  it('preserves optional text input spaces during editing', () => {
    expect(optionalTextValue('Needs context ')).toBe('Needs context ');
  });
});
