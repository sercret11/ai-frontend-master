import { describe, expect, it } from 'vitest';
import { extractFileSignature } from './ast-extractor';

describe('ast-extractor', () => {
  it('extracts exports and signatures from valid ts source', () => {
    const source = `
import { create } from "zustand";
// store comment

export interface User {
  id: string;
}

export const useStore = create(() => ({}));
export function formatUser(name: string) {
  return name.trim();
}
`;
    const digest = extractFileSignature('store/user.ts', source);

    expect(digest.degraded).toBe(false);
    expect(digest.exports).toContain('useStore');
    expect(digest.interfaceNames).toContain('User');
    expect(digest.functionSignatures.some(item => item.startsWith('formatUser('))).toBe(true);
    expect(digest.comments.some(item => item.includes('store comment'))).toBe(true);
  });

  it('falls back to degraded extraction when source has syntax error', () => {
    const source = `
import React from "react";
import { cn } from "@/lib/utils";
// keep this intent note
/* fallback comment */

export default Layout
function Broken() {
  return <div>;
`;
    const digest = extractFileSignature('components/Broken.tsx', source);

    expect(digest.degraded).toBe(true);
    expect(digest.imports.length).toBeGreaterThan(0);
    expect(digest.defaultExport).toBe('Layout');
    expect(digest.comments.length).toBeGreaterThan(0);
    expect(digest.comments.some(item => item.includes('intent note'))).toBe(true);
  });
});
