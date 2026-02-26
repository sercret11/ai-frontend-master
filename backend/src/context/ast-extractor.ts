import { createHash } from 'node:crypto';
import { parseSync } from 'oxc-parser';

export interface MockStructureSummary {
  name: string;
  keys: string[];
}

export interface FileSignatureDigest {
  filePath: string;
  imports: string[];
  exports: string[];
  defaultExport?: string;
  functionSignatures: string[];
  interfaceNames: string[];
  typeNames: string[];
  mockStructures: MockStructureSummary[];
  comments: string[];
  degraded: boolean;
  extractionConfidence: 'high' | 'low';
  parseErrorSummary?: string;
  sourceHash: string;
}

function hashText(input: string): string {
  return createHash('sha1').update(input).digest('hex').slice(0, 12);
}

function getIdentifierName(node: any): string | undefined {
  if (!node || typeof node !== 'object') return undefined;
  if (typeof node.name === 'string' && node.name.length > 0) return node.name;
  return undefined;
}

function extractParamName(param: any): string {
  if (!param || typeof param !== 'object') return 'arg';
  if (param.type === 'Identifier' && typeof param.name === 'string') return param.name;
  if (param.type === 'AssignmentPattern') {
    return extractParamName(param.left);
  }
  if (param.type === 'RestElement') {
    return `...${extractParamName(param.argument)}`;
  }
  return 'arg';
}

function extractObjectKeys(node: any): string[] {
  if (!node || node.type !== 'ObjectExpression' || !Array.isArray(node.properties)) {
    return [];
  }
  const keys: string[] = [];
  for (const prop of node.properties) {
    if (!prop || typeof prop !== 'object') continue;
    if (prop.type === 'Property' || prop.type === 'ObjectProperty') {
      const key = prop.key;
      if (!key) continue;
      if (typeof key.name === 'string') {
        keys.push(key.name);
        continue;
      }
      if (typeof key.value === 'string') {
        keys.push(key.value);
      }
    }
  }
  return keys;
}

function buildSignature(name: string, params: any[]): string {
  return `${name}(${params.map(extractParamName).join(', ')})`;
}

function extractComments(sourceText: string, maxCount = 20, maxLength = 200): string[] {
  const matches = sourceText.match(/\/\*[\s\S]*?\*\/|\/\/[^\n\r]*/g) || [];
  const normalized = matches
    .map(item => item.replace(/\s+/g, ' ').trim())
    .filter(Boolean)
    .map(item => (item.length > maxLength ? `${item.slice(0, maxLength)}...` : item));
  return Array.from(new Set(normalized)).slice(0, maxCount);
}

function extractByRegexFallback(filePath: string, sourceText: string, errorMessage: string): FileSignatureDigest {
  const importMatches = sourceText.match(/(?:^|\n)\s*import[\s\S]*?;/g) || [];
  const defaultExportMatch =
    sourceText.match(/export\s+default\s+([A-Za-z_$][\w$]*)/) ||
    sourceText.match(/export\s+default\s+(function|class)/);
  const namedExportMatches = sourceText.match(/export\s+(?:const|let|var|function|class|interface|type)\s+([A-Za-z_$][\w$]*)/g) || [];
  const exports = namedExportMatches
    .map(item => item.replace(/^export\s+(?:const|let|var|function|class|interface|type)\s+/, '').trim())
    .filter(Boolean);

  return {
    filePath,
    imports: importMatches.map(line => line.trim()).slice(0, 50),
    exports,
    defaultExport: defaultExportMatch?.[1],
    functionSignatures: [],
    interfaceNames: [],
    typeNames: [],
    mockStructures: [],
    comments: extractComments(sourceText),
    degraded: true,
    extractionConfidence: 'low',
    parseErrorSummary: errorMessage,
    sourceHash: hashText(sourceText),
  };
}

export function extractFileSignature(filePath: string, sourceText: string): FileSignatureDigest {
  try {
    const result = parseSync(filePath, sourceText, {
      sourceType: 'unambiguous',
      astType: 'ts',
      showSemanticErrors: false,
    });
    if (Array.isArray((result as any)?.errors) && (result as any).errors.length > 0) {
      const firstError = (result as any).errors[0];
      const message =
        typeof firstError?.message === 'string' ? firstError.message : JSON.stringify(firstError);
      return extractByRegexFallback(filePath, sourceText, message || 'Parser reported syntax errors');
    }
    const programBody = Array.isArray((result as any)?.program?.body)
      ? ((result as any).program.body as any[])
      : [];

    const imports: string[] = [];
    const exports = new Set<string>();
    let defaultExport: string | undefined;
    const functionSignatures = new Set<string>();
    const interfaceNames = new Set<string>();
    const typeNames = new Set<string>();
    const mockStructures: MockStructureSummary[] = [];
    const comments = extractComments(sourceText);

    for (const statement of programBody) {
      if (!statement || typeof statement !== 'object') continue;

      if (statement.type === 'ImportDeclaration') {
        const sourceValue = statement.source?.value;
        if (typeof sourceValue === 'string') {
          imports.push(sourceValue);
        }
        continue;
      }

      if (statement.type === 'TSInterfaceDeclaration') {
        const name = getIdentifierName(statement.id);
        if (name) interfaceNames.add(name);
        continue;
      }

      if (statement.type === 'TSTypeAliasDeclaration') {
        const name = getIdentifierName(statement.id);
        if (name) typeNames.add(name);
        continue;
      }

      if (statement.type === 'FunctionDeclaration') {
        const name = getIdentifierName(statement.id);
        if (name) {
          functionSignatures.add(buildSignature(name, statement.params || []));
        }
        continue;
      }

      if (statement.type === 'VariableDeclaration' && Array.isArray(statement.declarations)) {
        for (const declaration of statement.declarations) {
          const varName = getIdentifierName(declaration?.id);
          const initType = declaration?.init?.type;
          if (varName && (initType === 'ArrowFunctionExpression' || initType === 'FunctionExpression')) {
            functionSignatures.add(buildSignature(varName, declaration.init.params || []));
          }

          if (
            varName &&
            /(mock|fixture|sample|stub|fake|data)/i.test(varName) &&
            declaration?.init?.type === 'ObjectExpression'
          ) {
            mockStructures.push({
              name: varName,
              keys: extractObjectKeys(declaration.init).slice(0, 30),
            });
          }
        }
        continue;
      }

      if (statement.type === 'ExportNamedDeclaration') {
        if (Array.isArray(statement.specifiers)) {
          for (const specifier of statement.specifiers) {
            const exportedName = getIdentifierName(specifier?.exported);
            if (exportedName) exports.add(exportedName);
          }
        }

        const decl = statement.declaration;
        if (decl?.type === 'FunctionDeclaration') {
          const name = getIdentifierName(decl.id);
          if (name) {
            exports.add(name);
            functionSignatures.add(buildSignature(name, decl.params || []));
          }
        } else if (decl?.type === 'TSInterfaceDeclaration') {
          const name = getIdentifierName(decl.id);
          if (name) {
            exports.add(name);
            interfaceNames.add(name);
          }
        } else if (decl?.type === 'TSTypeAliasDeclaration') {
          const name = getIdentifierName(decl.id);
          if (name) {
            exports.add(name);
            typeNames.add(name);
          }
        } else if (decl?.type === 'VariableDeclaration' && Array.isArray(decl.declarations)) {
          for (const declaration of decl.declarations) {
            const name = getIdentifierName(declaration?.id);
            if (name) exports.add(name);
          }
        }
        continue;
      }

      if (statement.type === 'ExportDefaultDeclaration') {
        const declaration = statement.declaration;
        defaultExport =
          getIdentifierName(declaration) ||
          getIdentifierName(declaration?.id) ||
          declaration?.type ||
          'default';
      }
    }

    if (!defaultExport) {
      const moduleDefault = sourceText.match(/export\s+default\s+([A-Za-z_$][\w$]*)/);
      if (moduleDefault?.[1]) {
        defaultExport = moduleDefault[1];
      }
    }

    return {
      filePath,
      imports: Array.from(new Set(imports)),
      exports: Array.from(exports),
      defaultExport,
      functionSignatures: Array.from(functionSignatures),
      interfaceNames: Array.from(interfaceNames),
      typeNames: Array.from(typeNames),
      mockStructures,
      comments,
      degraded: false,
      extractionConfidence: 'high',
      sourceHash: hashText(sourceText),
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return extractByRegexFallback(filePath, sourceText, message);
  }
}
