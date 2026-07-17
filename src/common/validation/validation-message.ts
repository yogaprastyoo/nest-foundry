/**
 * Central place for validation messages so wording stays consistent across
 * every DTO. `label` is the human-friendly attribute name (e.g. "Email").
 */
export const ValidationMessage = {
  required: (label: string): string => `${label} is required.`,
  string: (label: string): string => `${label} must be text.`,
  email: (label: string): string => `${label} must be a valid email address.`,
  min: (label: string, length: number): string =>
    `${label} must be at least ${length} characters.`,
  max: (label: string, length: number): string =>
    `${label} must not exceed ${length} characters.`,
};
