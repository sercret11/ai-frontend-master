declare module 'oxc-parser' {
  export function parseSync(
    filename: string,
    sourceText: string,
    options?: Record<string, unknown>
  ): any;
}

