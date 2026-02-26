import { FileStorage } from '../storage/file-storage';
import { extractFileSignature } from '../context/ast-extractor';
import type { ContractBundle, ContractSignatureDigest } from './types';

const CONTRACT_PREFIXES = ['types/', 'store/', 'components/ui/'];

function isContractFile(path: string): boolean {
  return CONTRACT_PREFIXES.some(prefix => path.startsWith(prefix));
}

export function createContractBundle(sessionID: string): ContractBundle {
  const files = FileStorage.getAllFiles(sessionID)
    .filter(file => isContractFile(file.path))
    .slice(0, 200);

  const digests: ContractSignatureDigest[] = files.map(file => {
    const signature = extractFileSignature(file.path, file.content);
    return {
      filePath: file.path,
      exports: signature.exports,
      functionSignatures: signature.functionSignatures,
      interfaceNames: signature.interfaceNames,
      typeNames: signature.typeNames,
      mockShapes: signature.mockStructures,
      degraded: signature.degraded,
    };
  });

  const summary = [
    `contractFiles=${digests.length}`,
    `degraded=${digests.filter(item => item.degraded).length}`,
    `exports=${digests.reduce((sum, item) => sum + item.exports.length, 0)}`,
    `signatures=${digests.reduce((sum, item) => sum + item.functionSignatures.length, 0)}`,
  ].join('; ');

  return {
    generatedAt: Date.now(),
    files: digests,
    summary,
  };
}

export function formatContractBundle(bundle: ContractBundle): string {
  const lines: string[] = [];
  lines.push(`[FrozenContracts] generatedAt=${bundle.generatedAt}; ${bundle.summary}`);

  for (const file of bundle.files.slice(0, 40)) {
    const chunks: string[] = [];
    if (file.exports.length > 0) chunks.push(`exports=${file.exports.slice(0, 8).join(',')}`);
    if (file.functionSignatures.length > 0) {
      chunks.push(`signatures=${file.functionSignatures.slice(0, 6).join(',')}`);
    }
    if (file.interfaceNames.length > 0) {
      chunks.push(`interfaces=${file.interfaceNames.slice(0, 6).join(',')}`);
    }
    if (file.typeNames.length > 0) chunks.push(`types=${file.typeNames.slice(0, 6).join(',')}`);
    if (file.mockShapes.length > 0) {
      chunks.push(
        `mockShapes=${file.mockShapes
          .slice(0, 3)
          .map(item => `${item.name}(${item.keys.slice(0, 6).join('|')})`)
          .join(',')}`
      );
    }
    if (file.degraded) chunks.push('degraded=true');
    if (chunks.length > 0) {
      lines.push(`${file.filePath}: ${chunks.join('; ')}`);
    }
  }

  lines.push('[FrozenContractsRule] downstream agents must treat these signatures as read-only.');
  return lines.join('\n');
}

