import { describe, it, expect, vi, beforeEach } from 'vitest';
import { 
    gitStatus, 
    gitDiff, 
    gitCommit, 
    gitAdd, 
    gitBranch, 
    gitLog 
} from '../src/tools/git.js';

// Mock runCommand since we can't actually run git in tests
vi.mock('../src/tools/shell.js', () => ({
    runCommand: vi.fn()
}));

import { runCommand } from '../src/tools/shell.js';

const mockRunCommand = vi.mocked(runCommand);

describe('gitStatus', () => {
    beforeEach(() => {
        mockRunCommand.mockClear();
    });

    it('should execute git status --short command', async () => {
        mockRunCommand.mockResolvedValueOnce('M src/tools/git.ts\n?? test/git.test.ts');
        
        const result = await gitStatus();
        
        expect(result).toBe('M src/tools/git.ts\n?? test/git.test.ts');
        expect(mockRunCommand).toHaveBeenCalledWith('git status --short');
    });
});

describe('gitDiff', () => {
    beforeEach(() => {
        mockRunCommand.mockClear();
    });

    it('should execute git diff without staged flag by default', async () => {
        mockRunCommand.mockResolvedValueOnce('diff --git a/file.txt b/file.txt\nindex ...');
        
        const result = await gitDiff();
        
        expect(result).toBe('diff --git a/file.txt b/file.txt\nindex ...');
        expect(mockRunCommand).toHaveBeenCalledWith('git diff ');
    });

    it('should execute git diff with staged flag when true', async () => {
        mockRunCommand.mockResolvedValueOnce('staged changes');
        
        const result = await gitDiff(true);
        
        expect(result).toBe('staged changes');
        expect(mockRunCommand).toHaveBeenCalledWith('git diff --staged');
    });
});

describe('gitCommit', () => {
    beforeEach(() => {
        mockRunCommand.mockClear();
    });

    it('should return error when message is empty', async () => {
        const result = await gitCommit('');
        
        expect(result).toBe('Error: Commit message is required.');
        expect(mockRunCommand).not.toHaveBeenCalled();
    });

    it('should execute git commit with simple message', async () => {
        mockRunCommand.mockResolvedValueOnce('[master 1234567] feat: add new feature\n 1 file changed, 10 insertions(+)\n create mode 100644 newfile.txt');
        
        const result = await gitCommit('feat: add new feature');
        
        expect(result).toBe('[master 1234567] feat: add new feature\n 1 file changed, 10 insertions(+)\n create mode 100644 newfile.txt');
        expect(mockRunCommand).toHaveBeenCalledWith('git commit -m "feat: add new feature"');
    });

    it('should properly escape quotes in commit message', async () => {
        mockRunCommand.mockResolvedValueOnce('commit successful');
        
        const result = await gitCommit('fix: handle "special" case');
        
        expect(mockRunCommand).toHaveBeenCalledWith('git commit -m "fix: handle \\"special\\" case"');
    });

    it('should execute with multiple line message', async () => {
        mockRunCommand.mockResolvedValueOnce('commit done');
        
        const result = await gitCommit('feat: add feature\n\nThis is a detailed description.');
        
        expect(mockRunCommand).toHaveBeenCalledWith('git commit -m "feat: add feature\\n\\nThis is a detailed description."');
    });
});

describe('gitAdd', () => {
    beforeEach(() => {
        mockRunCommand.mockClear();
    });

    it('should stage all files by default', async () => {
        mockRunCommand.mockResolvedValueOnce('nothing to add, cached files only');
        
        const result = await gitAdd();
        
        expect(result).toBe('nothing to add, cached files only');
        expect(mockRunCommand).toHaveBeenCalledWith('git add .');
    });

    it('should stage specific file', async () => {
        mockRunCommand.mockResolvedValueOnce('100644 1234567 89abcde A src/tools/file.ts\n');
        
        const result = await gitAdd('src/tools/file.ts');
        
        expect(result).toBe('100644 1234567 89abcde A src/tools/file.ts\n');
        expect(mockRunCommand).toHaveBeenCalledWith('git add src/tools/file.ts');
    });

    it('should stage directory', async () => {
        mockRunCommand.mockResolvedValueOnce('src/');
        
        const result = await gitAdd('src/utils');
        
        expect(result).toBe('src/');
        expect(mockRunCommand).toHaveBeenCalledWith('git add src/utils');
    });

    it('should stage multiple files', async () => {
        mockRunCommand.mockResolvedValueOnce('file1.txt\nfile2.txt');
        
        const result = await gitAdd('*.txt');
        
        expect(result).toBe('file1.txt\nfile2.txt');
        expect(mockRunCommand).toHaveBeenCalledWith('git add *.txt');
    });
});

describe('gitBranch', () => {
    beforeEach(() => {
        mockRunCommand.mockClear();
    });

    it('should list all branches when no name provided', async () => {
        mockRunCommand.mockResolvedValueOnce('* main\n  develop\n  feature/test');
        
        const result = await gitBranch();
        
        expect(result).toBe('* main\n  develop\n  feature/test');
        expect(mockRunCommand).toHaveBeenCalledWith('git branch');
    });

    it('should create and checkout new branch when name provided', async () => {
        mockRunCommand.mockResolvedValueOnce('Switched to a new branch "feature/new-feature"');
        
        const result = await gitBranch('feature/new-feature');
        
        expect(result).toBe('Switched to a new branch "feature/new-feature"');
        expect(mockRunCommand).toHaveBeenCalledWith('git checkout -b feature/new-feature');
    });

    it('should create and checkout with special characters in name', async () => {
        mockRunCommand.mockResolvedValueOnce('branch created');
        
        const result = await gitBranch('feature/user-auth');
        
        expect(mockRunCommand).toHaveBeenCalledWith('git checkout -b feature/user-auth');
    });

    it('should create and checkout with numeric suffix', async () => {
        mockRunCommand.mockResolvedValueOnce('created');
        
        const result = await gitBranch('hotfix/123-bug-fix');
        
        expect(mockRunCommand).toHaveBeenCalledWith('git checkout -b hotfix/123-bug-fix');
    });
});

describe('gitLog', () => {
    beforeEach(() => {
        mockRunCommand.mockClear();
    });

    it('should show last 5 commits by default', async () => {
        mockRunCommand.mockResolvedValueOnce('abc1234 feat: add new feature\ndef5678 fix: resolve issue\nghi9012 refactor: improve code');
        
        const result = await gitLog();
        
        expect(result).toBe('abc1234 feat: add new feature\ndef5678 fix: resolve issue\nghi9012 refactor: improve code');
        expect(mockRunCommand).toHaveBeenCalledWith('git log -n 5 --oneline');
    });

    it('should show specified number of commits', async () => {
        mockRunCommand.mockResolvedValueOnce('commit1\ncommit2');
        
        const result = await gitLog(2);
        
        expect(result).toBe('commit1\ncommit2');
        expect(mockRunCommand).toHaveBeenCalledWith('git log -n 2 --oneline');
    });

    it('should show last 10 commits', async () => {
        mockRunCommand.mockResolvedValueOnce('commits...');
        
        const result = await gitLog(10);
        
        expect(result).toBe('commits...');
        expect(mockRunCommand).toHaveBeenCalledWith('git log -n 10 --oneline');
    });

    it('should show single commit', async () => {
        mockRunCommand.mockResolvedValueOnce('single commit');
        
        const result = await gitLog(1);
        
        expect(result).toBe('single commit');
        expect(mockRunCommand).toHaveBeenCalledWith('git log -n 1 --oneline');
    });

    it('should handle large number of commits', async () => {
        mockRunCommand.mockResolvedValueOnce('many commits...');
        
        const result = await gitLog(50);
        
        expect(result).toBe('many commits...');
        expect(mockRunCommand).toHaveBeenCalledWith('git log -n 50 --oneline');
    });

    it('should handle zero commits', async () => {
        mockRunCommand.mockResolvedValueOnce('');
        
        const result = await gitLog(0);
        
        expect(result).toBe('');
        expect(mockRunCommand).toHaveBeenCalledWith('git log -n 0 --oneline');
    });

    it('should handle negative number of commits', async () => {
        mockRunCommand.mockResolvedValueOnce('negative test');
        
        const result = await gitLog(-1);
        
        expect(result).toBe('negative test');
        expect(mockRunCommand).toHaveBeenCalledWith('git log -n -1 --oneline');
    });
});

describe('Integration Tests', () => {
    beforeEach(() => {
        mockRunCommand.mockClear();
    });

    it('should handle command execution errors gracefully', async () => {
        mockRunCommand.mockRejectedValueOnce(new Error('Git error: not a git repository'));
        
        try {
            await gitStatus();
            expect.fail('Expected an error to be thrown');
        } catch (error) {
            expect(error).toBeInstanceOf(Error);
            expect((error as Error).message).toBe('Git error: not a git repository');
        }
    });

    it('should maintain consistent behavior across multiple calls', async () => {
        mockRunCommand.mockResolvedValueOnce('consistent result');
        
        const result1 = await gitLog(3);
        const result2 = await gitLog(3);
        
        expect(result1).toBe('consistent result');
        expect(result2).toBe('consistent result');
    });

    it('should handle various commit message formats', async () => {
        const testCases = [
            'simple commit',
            'commit with numbers 123',
            'commit with special !@#$%^&*() characters',
            'commit with unicode: émojis 🎉 and symbols',
        ];

        for (const msg of testCases) {
            mockRunCommand.mockResolvedValueOnce('success');
            await gitCommit(msg);
            expect(mockRunCommand).toHaveBeenCalledWith(`git commit -m "${msg.replace(/"/g, '\\"')}"`);
        }
    });
});

describe('Edge Cases', () => {
    beforeEach(() => {
        mockRunCommand.mockClear();
    });

    it('should handle null or undefined for optional parameters', async () => {
        mockRunCommand.mockResolvedValueOnce('branch list');
        
        const result = await gitBranch(undefined as any);
        expect(mockRunCommand).toHaveBeenCalledWith('git branch');
    });

    it('should handle whitespace in file paths', async () => {
        mockRunCommand.mockResolvedValueOnce('file with spaces');
        
        const result = await gitAdd('path/with spaces/file.txt');
        expect(mockRunCommand).toHaveBeenCalledWith('git add path/with spaces/file.txt');
    });

    it('should handle very long commit messages', async () => {
        const longMessage = 'feat: ' + 'a'.repeat(1000);
        mockRunCommand.mockResolvedValueOnce('long commit success');
        
        await gitCommit(longMessage);
        expect(mockRunCommand).toHaveBeenCalledWith(`git commit -m "${longMessage.replace(/"/g, '\\"')}"`);
    });

    it('should handle empty string for n parameter', async () => {
        mockRunCommand.mockResolvedValueOnce('empty result');
        
        const result = await gitLog(0);
        expect(result).toBe('empty result');
        expect(mockRunCommand).toHaveBeenCalledWith('git log -n 0 --oneline');
    });

    it('should handle very large n parameter', async () => {
        mockRunCommand.mockResolvedValueOnce('many results');
        
        const result = await gitLog(1000);
        expect(result).toBe('many results');
        expect(mockRunCommand).toHaveBeenCalledWith('git log -n 1000 --oneline');
    });

    it('should handle negative path in gitAdd', async () => {
        mockRunCommand.mockResolvedValueOnce('removed file');
        
        const result = await gitAdd('-f file.txt');
        expect(mockRunCommand).toHaveBeenCalledWith('git add -f file.txt');
    });

    it('should handle special characters in branch names', async () => {
        mockRunCommand.mockResolvedValueOnce('branch created');
        
        await gitBranch('feature/complex-branch_name.with.dots');
        expect(mockRunCommand).toHaveBeenCalledWith('git checkout -b feature/complex-branch_name.with.dots');
    });

    it('should handle path with multiple levels in gitAdd', async () => {
        mockRunCommand.mockResolvedValueOnce('deep file staged');
        
        const result = await gitAdd('src/tools/utils/deep/file.ts');
        expect(mockRunCommand).toHaveBeenCalledWith('git add src/tools/utils/deep/file.ts');
    });

    it('should handle wildcard patterns in gitAdd', async () => {
        mockRunCommand.mockResolvedValueOnce('files matched');
        
        const result = await gitAdd('**/*.ts');
        expect(mockRunCommand).toHaveBeenCalledWith('git add **/*.ts');
    });

    it('should handle commit message with newlines properly escaped', async () => {
        mockRunCommand.mockResolvedValueOnce('multiline commit success');
        
        const multilineMessage = 'feat: feature\n\nbody of the commit\n\nwith multiple lines';
        await gitCommit(multilineMessage);
        expect(mockRunCommand).toHaveBeenCalledWith(`git commit -m "${multilineMessage.replace(/"/g, '\\"')}"`);
    });

    it('should handle gitDiff with various staged values', async () => {
        mockRunCommand.mockResolvedValueOnce('diff output');
        
        await gitDiff(false);
        expect(mockRunCommand).toHaveBeenCalledWith('git diff ');
        
        await gitDiff(true);
        expect(mockRunCommand).toHaveBeenCalledWith('git diff --staged');
    });

    it('should handle empty commit message string', async () => {
        const result = await gitCommit('');
        expect(result).toBe('Error: Commit message is required.');
        expect(mockRunCommand).not.toHaveBeenCalled();
    });

    it('should handle whitespace-only commit message', async () => {
        mockRunCommand.mockResolvedValueOnce('whitespace commit success');
        
        const result = await gitCommit('   ');
        // Should execute since only empty string is rejected, not whitespace
        expect(mockRunCommand).toHaveBeenCalledWith('git commit -m "   "');
    });

    it('should handle file path with quotes in gitAdd', async () => {
        mockRunCommand.mockResolvedValueOnce('quoted file');
        
        const result = await gitAdd('file"with"quotes.txt');
        expect(mockRunCommand).toHaveBeenCalledWith('git add file"with"quotes.txt');
    });

    it('should handle very short branch names', async () => {
        mockRunCommand.mockResolvedValueOnce('short branch');
        
        const result = await gitBranch('x');
        expect(result).toBe('short branch');
        expect(mockRunCommand).toHaveBeenCalledWith('git checkout -b x');
    });

    it('should handle branch name with leading slash', async () => {
        mockRunCommand.mockResolvedValueOnce('leading slash');
        
        const result = await gitBranch('/feature/test');
        expect(result).toBe('leading slash');
        expect(mockRunCommand).toHaveBeenCalledWith('git checkout -b /feature/test');
    });

    it('should handle negative n for log with different values', async () => {
        mockRunCommand.mockResolvedValueOnce('negative test');
        
        await gitLog(-5);
        expect(mockRunCommand).toHaveBeenCalledWith('git log -n -5 --oneline');
        
        await gitLog(-100);
        expect(mockRunCommand).toHaveBeenCalledWith('git log -n -100 --oneline');
    });

    it('should handle path with trailing slash in gitAdd', async () => {
        mockRunCommand.mockResolvedValueOnce('trailing slash result');
        
        const result = await gitAdd('src/utils/');
        expect(mockRunCommand).toHaveBeenCalledWith('git add src/utils/');
    });

    it('should handle path with leading dot in gitAdd', async () => {
        mockRunCommand.mockResolvedValueOnce('hidden file');
        
        const result = await gitAdd('.env.local');
        expect(mockRunCommand).toHaveBeenCalledWith('git add .env.local');
    });

    it('should handle complex commit message with special regex characters', async () => {
        mockRunCommand.mockResolvedValueOnce('regex commit success');
        
        const regexMessage = 'feat: fix [bug] in (module) * pattern + quantifier';
        await gitCommit(regexMessage);
        expect(mockRunCommand).toHaveBeenCalledWith(`git commit -m "${regexMessage.replace(/"/g, '\\"')}"`);
    });

    it('should handle empty string for path parameter', async () => {
        mockRunCommand.mockResolvedValueOnce('empty path result');
        
        const result = await gitAdd('');
        expect(mockRunCommand).toHaveBeenCalledWith('git add ');
    });
});