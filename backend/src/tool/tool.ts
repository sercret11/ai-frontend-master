/**
 * Tool System - Core Tool Definition
 * Ported from OpenCode with modifications for ai-frontend-master
 *
 * This module provides the core Tool.define system for creating type-safe tools
 * with Zod validation and comprehensive metadata handling.
 */

import { z } from 'zod';
import type {
  ToolInfo,
  ToolInitContext,
  ToolContext,
  ToolMetadata,
  ToolDefineFunction,
  ToolInitResult,
} from '@ai-frontend/shared-types';
import { enforcePermission } from './permission-policy';

/**
 * Tool namespace
 */
export namespace Tool {
  /**
   * Define a tool with the given ID and initialization function
   *
   * @template Parameters - Zod schema type for tool parameters
   * @template Result - Tool metadata type for execution results
   * @param id - Unique tool identifier
   * @param init - Tool initialization function or object
   * @returns Tool info object
   *
   * @example
   * ```typescript
   * export const ReadTool = Tool.define("read", {
   *   description: "Read the contents of a file",
   *   parameters: z.object({
   *     filePath: z.string(),
   *     offset: z.number().optional(),
   *     limit: z.number().optional(),
   *   }),
   *   async execute(params, ctx) {
   *     const content = await fs.readFile(params.filePath, 'utf-8');
   *     return {
   *       title: path.basename(params.filePath),
   *       metadata: {},
   *       output: content,
   *     };
   *   },
   * });
   * ```
   */

  // Object literal overload (must come first for proper type inference)
  export function define<
    P extends z.ZodTypeAny = z.ZodTypeAny,
    Result extends ToolMetadata = ToolMetadata,
  >(
    id: string,
    initOrConfig: {
      description: string;
      parameters: P;
      execute(
        args: z.infer<P>,
        ctx: Omit<ToolContext<Result>, 'callID'> & { callID?: string }
      ): Promise<{
        title: string;
        metadata: Result;
        output: string;
      }>;
      formatValidationError?(error: z.ZodError): string;
    }
  ): ToolInfo<P, Result>;

  // Function overload
  export function define<
    P extends z.ZodTypeAny = z.ZodTypeAny,
    Result extends ToolMetadata = ToolMetadata,
  >(
    id: string,
    initOrConfig: (ctx?: ToolInitContext) => Promise<{
      description: string;
      parameters: P;
      execute(
        args: z.infer<P>,
        ctx: Omit<ToolContext<Result>, 'callID'> & { callID?: string }
      ): Promise<{
        title: string;
        metadata: Result;
        output: string;
      }>;
      formatValidationError?(error: z.ZodError): string;
    }>
  ): ToolInfo<P, Result>;

  // Implementation signature (must accept both overloads)
  export function define<
    P extends z.ZodTypeAny = z.ZodTypeAny,
    Result extends ToolMetadata = ToolMetadata,
  >(
    id: string,
    initOrConfig: ((ctx?: ToolInitContext) => Promise<{
      description: string;
      parameters: P;
      execute(
        args: z.infer<P>,
        ctx: Omit<ToolContext<Result>, 'callID'> & { callID?: string }
      ): Promise<{
        title: string;
        metadata: Result;
        output: string;
      }>;
      formatValidationError?(error: z.ZodError): string;
    }>) | {
      description: string;
      parameters: P;
      execute(
        args: z.infer<P>,
        ctx: Omit<ToolContext<Result>, 'callID'> & { callID?: string }
      ): Promise<{
        title: string;
        metadata: Result;
        output: string;
      }>;
      formatValidationError?(error: z.ZodError): string;
    }
  ): ToolInfo<P, Result> {
    // Convert object literal to async function if needed
    const initFn = typeof initOrConfig === 'function'
      ? initOrConfig
      : async () => initOrConfig as any;

    return {
      id,
      init: async initCtx => {
        const toolInfo = await initFn(initCtx);
        const execute = toolInfo.execute;

        // Wrap execute with validation and error handling
        toolInfo.execute = async (
          args: z.infer<P>,
          ctx: Omit<ToolContext<Result>, 'callID'> & { callID?: string }
        ) => {
          // Validate input parameters
          try {
            toolInfo.parameters.parse(args);
          } catch (error) {
            if (error instanceof z.ZodError) {
              const formatted = toolInfo.formatValidationError
                ? toolInfo.formatValidationError(error)
                : `The ${id} tool was called with invalid arguments.`;

              throw new Error(formatted, { cause: error });
            }
            throw error;
          }

          // Execute the tool
          return execute(args, ctx);
        };

        return toolInfo as ToolInitResult<P, Result>;
      },
    };
  }

  /**
   * Combine multiple tool metadata objects
   */
  export function combineMetadata<T extends ToolMetadata>(...metadatas: (T | undefined)[]): T {
    const combined: any = {};
    for (const metadata of metadatas) {
      if (metadata) {
        Object.assign(combined, metadata);
      }
    }
    return combined;
  }

  /**
   * Create a tool execution context
   */
  export function createContext<M extends ToolMetadata = ToolMetadata>(
    base: Omit<ToolContext<M>, 'metadata' | 'ask'>
  ): ToolContext<M> {
    let currentMetadata: { title?: string; metadata?: M } = {};

    return {
      ...base,
      callID: base.callID || `${base.messageID}-${Date.now()}`,
      metadata: input => {
        currentMetadata = input;
      },
      ask: async input => {
        await enforcePermission(input, {
          source: 'tool-context',
          agent: base.agent,
          sessionID: base.sessionID,
          messageID: base.messageID,
          callID: base.callID,
        });
      },
    };
  }
}

// ============================================================================
// Helper Types
// ============================================================================

/**
 * Extract the inferred type from a Zod schema
 */
export type InferToolParameters<T extends z.ZodType> = z.infer<T>;

/**
 * Extract the metadata type from a tool info
 */
export type InferToolMetadata<T extends ToolInfo> =
  T extends ToolInfo<any, infer M> ? M : ToolMetadata;

// ============================================================================
// Re-exports
// ============================================================================

export type { ToolInfo, ToolContext, ToolMetadata, ToolInitContext };
