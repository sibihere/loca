import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import fs from 'fs';
import path from 'path';
import os from 'os';
import { loadHistory, addToHistory, pruneHistory } from '../src/history.js';

// Mock config to use a temp directory
vi.mock('../src/config.js', () => ({
    getConfigDir: () => path.join(os.tmpdir(), 'loca-test-history'),
}));

import { getConfigDir } from '../src/config.js';

describe('History Utility', () => {
    const testDir = getConfigDir();
    const historyFile = path.join(testDir, 'history.txt');

    beforeEach(() => {
        if (fs.existsSync(testDir)) {
            fs.rmSync(testDir, { recursive: true, force: true });
        }
        fs.mkdirSync(testDir, { recursive: true });
    });

    afterEach(() => {
        if (fs.existsSync(testDir)) {
            fs.rmSync(testDir, { recursive: true, force: true });
        }
    });

    it('should return empty array when history file does not exist', () => {
        const history = loadHistory();
        expect(history).toEqual([]);
    });

    it('should save and load history', () => {
        addToHistory('prompt 1');
        addToHistory('prompt 2');

        const history = loadHistory();
        expect(history).toEqual(['prompt 1', 'prompt 2']);
    });

    it('should not add empty lines to history', () => {
        addToHistory('   ');
        addToHistory('');

        const history = loadHistory();
        expect(history).toEqual([]);
    });

    it('should prune history to max lines', () => {
        // Fill history with more than 1000 lines
        for (let i = 0; i < 1100; i++) {
            fs.appendFileSync(historyFile, `line ${i}\n`, 'utf-8');
        }

        pruneHistory();

        const history = loadHistory();
        expect(history.length).toBe(1000);
        expect(history[0]).toBe('line 100');
        expect(history[999]).toBe('line 1099');
    });
});
