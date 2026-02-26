declare module '@babel/standalone' {
  export interface TransformResult {
    code?: string | null;
    ast?: unknown;
  }

  export interface TransformOptions {
    ast?: boolean;
    code?: boolean;
    sourceType?: 'script' | 'module' | 'unambiguous';
    presets?: Array<string | [string, Record<string, unknown>]>;
    plugins?: Array<string | [string, Record<string, unknown>]>;
    parserOpts?: Record<string, unknown>;
    generatorOpts?: Record<string, unknown>;
    filename?: string;
  }

  export function transform(code: string, options?: TransformOptions): TransformResult;
}
