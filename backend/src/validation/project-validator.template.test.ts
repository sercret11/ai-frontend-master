import { describe, expect, it } from 'vitest';
import { ProjectValidator } from './project-validator';

describe('project validator template guard', () => {
  it('marks unsupported template as invalid', () => {
    const result = ProjectValidator.validate('any-session', 'unsupported-template');

    expect(result.isValid).toBe(false);
    expect(result.missingCritical).toHaveLength(1);
    expect(result.missingCritical[0]?.path).toBe('invalid-template:unsupported-template');
  });

  it('returns early when validateAndComplete receives unsupported template', async () => {
    const result = await ProjectValidator.validateAndComplete(
      'any-session',
      'unsupported-template',
      'create a project',
      'frontend-creator'
    );

    expect(result.isValid).toBe(false);
    expect(result.missingCritical[0]?.description).toContain('Unsupported project template');
  });
});
