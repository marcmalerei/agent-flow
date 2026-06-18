import { ValidationFinding } from '../pipeline/types';

export interface ValidationSummary {
  errors: number;
  warnings: number;
  risks: number;
  infos: number;
  state: 'pass' | 'warn' | 'fail';
  title: string;
}

export function summarizeValidationFindings(findings: ValidationFinding[]): ValidationSummary {
  const errors = findings.filter((finding) => finding.severity === 'error').length;
  const warnings = findings.filter((finding) => finding.severity === 'warning').length;
  const risks = findings.filter((finding) => finding.severity === 'risk').length;
  const infos = findings.filter((finding) => finding.severity === 'info').length;
  const state = errors ? 'fail' : warnings || risks || infos ? 'warn' : 'pass';
  const title = state === 'pass' ? 'Ready to run' : state === 'warn' ? 'Needs attention' : 'Not ready to run';
  return { errors, warnings, risks, infos, state, title };
}
