import { afterEach, describe, expect, it, vi } from 'vitest';

const { mockPlatform } = vi.hoisted(() => {
  return {
    mockPlatform: vi.fn(() => 'win32'),
  };
});

vi.mock('os', () => ({
  platform: mockPlatform,
}));

import { BashTool } from './bash';

async function executeBash(command: string) {
  const tool = await BashTool.init();
  return tool.execute(
    {
      command,
      timeout: 5_000,
    },
    {
      sessionID: 'session-bash-test',
      messageID: 'message-bash-test',
      agent: 'frontend-implementer',
      abort: new AbortController().signal,
      metadata: () => {},
      ask: async () => {},
      callID: 'call-bash-test',
    }
  );
}

const originalAllowedCommands = process.env.BASH_ALLOWED_COMMANDS;

describe('bash tool regression', () => {
  afterEach(() => {
    if (typeof originalAllowedCommands === 'string') {
      process.env.BASH_ALLOWED_COMMANDS = originalAllowedCommands;
    } else {
      delete process.env.BASH_ALLOWED_COMMANDS;
    }
    vi.restoreAllMocks();
    mockPlatform.mockReset();
    mockPlatform.mockReturnValue('win32');
  });

  it('uses non-shell execution on win32', async () => {
    mockPlatform.mockReturnValue('win32');

    const result = await executeBash('node --version');

    expect(result.metadata.command).toBe('node --version');
    expect(String(result.metadata.executedCommand)).toBe('node --version');
    expect(result.output).not.toContain('Wrapped as:');
  });

  it('keeps original command when platform is not win32', async () => {
    mockPlatform.mockReturnValue('linux');

    const result = await executeBash('node --version');

    expect(result.metadata.executedCommand).toBe('node --version');
    expect(result.output).not.toContain('Wrapped as:');
  });

  it('rejects non-allowlisted commands', async () => {
    mockPlatform.mockReturnValue('linux');

    await expect(executeBash('echo plain-mode')).rejects.toThrow(/not allowlisted/i);
  });

  it('blocks inline node eval flags', async () => {
    mockPlatform.mockReturnValue('linux');

    await expect(executeBash('node -e "console.log(1)"')).rejects.toThrow(
      /inline interpreter execution is blocked/i
    );
  });

  it('blocks inline python execution flags', async () => {
    mockPlatform.mockReturnValue('linux');

    await expect(executeBash('python -c "print(1)"')).rejects.toThrow(
      /inline interpreter execution is blocked/i
    );
  });

  it('blocks inline powershell command flags when allowlisted', async () => {
    process.env.BASH_ALLOWED_COMMANDS = 'node,pwsh';
    mockPlatform.mockReturnValue('linux');

    await expect(executeBash('pwsh -Command "Get-Date"')).rejects.toThrow(
      /inline interpreter execution is blocked/i
    );
  });
});
