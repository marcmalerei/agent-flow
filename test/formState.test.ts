import { describe, expect, it } from 'vitest';
import { optionalTextValue } from '../src/webview/formState';

describe('webview form state', () => {
  it('preserves spaces in optional text inputs while omitting empty values', () => {
    expect(optionalTextValue('')).toBeUndefined();
    expect(optionalTextValue('two words')).toBe('two words');
    expect(optionalTextValue('leading space')).toBe('leading space');
    expect(optionalTextValue('trailing space ')).toBe('trailing space ');
    expect(optionalTextValue(' ')).toBe(' ');
  });
});
