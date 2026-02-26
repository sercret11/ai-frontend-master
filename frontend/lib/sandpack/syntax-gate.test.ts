import { describe, expect, it } from 'vitest';
import { runSyntaxGate } from './syntax-gate';

describe('syntax-gate', () => {
  it('passes valid tsx source', () => {
    const result = runSyntaxGate(
      {
        'src/App.tsx': `export default function App() { return <div>Hello</div>; }`,
      },
      ['src/App.tsx']
    );
    expect(result.ok).toBe(true);
    expect(result.errors).toHaveLength(0);
  });

  it('reports syntax errors for invalid tsx source', () => {
    const result = runSyntaxGate(
      {
        'src/App.tsx': `export default function App() { return <div>Hello</div> `,
      },
      ['src/App.tsx']
    );
    expect(result.ok).toBe(false);
    expect(result.errors[0]?.filePath).toBe('src/App.tsx');
    expect(result.errors[0]?.message.length).toBeGreaterThan(0);
  });
});
