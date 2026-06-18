import { describe, expect, test } from 'vitest';
import { ValidationFinding } from '../src/pipeline/types';
import { summarizeValidationFindings } from '../src/webview/validationSummary';

describe('summarizeValidationFindings', () => {
  test('keeps info findings out of the pass state', () => {
    const findings: ValidationFinding[] = [{
      severity: 'info',
      ruleId: 'artifact-written-never-consumed',
      message: 'Artifact `.github/artifacts/review.md` is written but never consumed.'
    }];

    expect(summarizeValidationFindings(findings)).toEqual({
      errors: 0,
      warnings: 0,
      risks: 0,
      infos: 1,
      state: 'warn',
      title: 'Needs attention'
    });
  });

  test('returns a pass state only when no findings exist', () => {
    expect(summarizeValidationFindings([])).toEqual({
      errors: 0,
      warnings: 0,
      risks: 0,
      infos: 0,
      state: 'pass',
      title: 'Ready to run'
    });
  });
});
