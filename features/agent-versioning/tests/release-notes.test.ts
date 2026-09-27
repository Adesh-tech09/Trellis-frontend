import {
  formatCommitLine,
  generateReleaseNotes,
  referenceUrl,
  repositoryBaseUrl,
} from '../lib/release-notes';
import { parseCommitMessage } from '../lib/commit-parser';

describe('release notes generator', () => {
  describe('repositoryBaseUrl', () => {
    it('normalises an owner/name slug', () => {
      expect(repositoryBaseUrl('TRELLIS-STELLAR/Trellis-frontend')).toBe(
        'https://github.com/TRELLIS-STELLAR/Trellis-frontend',
      );
    });

    it('normalises github.com URLs and clone URLs', () => {
      expect(repositoryBaseUrl('https://github.com/o/r')).toBe('https://github.com/o/r');
      expect(repositoryBaseUrl('https://github.com/o/r.git')).toBe('https://github.com/o/r');
      expect(repositoryBaseUrl('git@github.com:o/r.git')).toBe('https://github.com/o/r');
    });

    it('returns null when the repository cannot be resolved', () => {
      expect(repositoryBaseUrl(undefined)).toBeNull();
      expect(repositoryBaseUrl('')).toBeNull();
      expect(repositoryBaseUrl('just-a-name')).toBeNull();
    });
  });

  describe('referenceUrl', () => {
    it('builds pull request and issue links', () => {
      expect(referenceUrl({ number: 7, type: 'pull' }, 'o/r')).toBe(
        'https://github.com/o/r/pull/7',
      );
      expect(referenceUrl({ number: 7, type: 'issue' }, 'o/r')).toBe(
        'https://github.com/o/r/issues/7',
      );
    });

    it('returns null without a configured repository', () => {
      expect(referenceUrl({ number: 7, type: 'pull' }, undefined)).toBeNull();
    });
  });

  describe('formatCommitLine', () => {
    it('renders scope, subject and linked references', () => {
      const commit = parseCommitMessage('feat(agent-versioning): add generator (#42)');

      expect(formatCommitLine(commit, 'o/r')).toBe(
        '- **agent-versioning:** add generator ([#42](https://github.com/o/r/pull/42))',
      );
    });

    it('marks breaking changes and falls back to plain references', () => {
      const commit = parseCommitMessage('fix!: drop legacy field (#9)');

      expect(formatCommitLine(commit, undefined)).toBe(
        '- drop legacy field **BREAKING** (#9)',
      );
    });

    it('renders a plain bullet for unreferenced commits', () => {
      expect(formatCommitLine(parseCommitMessage('docs: tidy readme'), 'o/r')).toBe(
        '- tidy readme',
      );
    });
  });

  describe('generateReleaseNotes', () => {
    const commits = [
      parseCommitMessage('feat(agent-versioning): generate release notes (#125)'),
      parseCommitMessage('fix: guard empty commit ranges (#126)'),
      parseCommitMessage('perf: cache rendered markdown'),
      parseCommitMessage('docs: document the release flow'),
    ];

    it('renders a versioned Markdown document with categorised sections', () => {
      const markdown = generateReleaseNotes(commits, {
        version: '1.2.0',
        repository: 'TRELLIS-STELLAR/Trellis-frontend',
        date: '2026-09-27',
      });

      expect(markdown).toContain('# Release v1.2.0');
      expect(markdown).toContain('_Generated from 4 commits on 2026-09-27._');
      expect(markdown).toContain('## Features');
      expect(markdown).toContain('## Bug Fixes');
      expect(markdown).toContain('## Performance');
      expect(markdown).toContain('## Documentation');
      expect(markdown).toContain(
        '[#125](https://github.com/TRELLIS-STELLAR/Trellis-frontend/pull/125)',
      );
      expect(markdown).toContain(
        '[#126](https://github.com/TRELLIS-STELLAR/Trellis-frontend/pull/126)',
      );
    });

    it('orders sections canonically', () => {
      const markdown = generateReleaseNotes(commits, {
        version: '1.2.0',
        repository: 'o/r',
        date: '2026-09-27',
      });

      expect(markdown.indexOf('## Features')).toBeLessThan(markdown.indexOf('## Bug Fixes'));
      expect(markdown.indexOf('## Bug Fixes')).toBeLessThan(markdown.indexOf('## Performance'));
      expect(markdown.indexOf('## Performance')).toBeLessThan(
        markdown.indexOf('## Documentation'),
      );
    });

    it('leads with breaking changes when commits contain them', () => {
      const markdown = generateReleaseNotes(
        [parseCommitMessage('feat!: new registry (#9)'), parseCommitMessage('fix: follow up')],
        {
          version: '2.0.0',
          repository: 'o/r',
          previousVersion: '1.9.0',
          date: '2026-09-27',
        },
      );

      expect(markdown).toContain('# Release v2.0.0 (since v1.9.0)');
      expect(markdown).toContain('## Breaking Changes');
      expect(markdown.indexOf('## Breaking Changes')).toBeLessThan(
        markdown.indexOf('## Bug Fixes'),
      );
      expect(markdown).not.toContain('## Features');
      expect(markdown).toContain('- new registry **BREAKING** ([#9](https://github.com/o/r/pull/9))');
    });

    it('emits a friendly placeholder for an empty commit range', () => {
      const markdown = generateReleaseNotes([], { version: '0.0.1', date: '2026-09-27' });

      expect(markdown).toContain('# Release v0.0.1');
      expect(markdown).toContain('## Other Changes');
      expect(markdown).toContain('- No changes in this release.');
    });

    it('can keep empty sections for a stable preview', () => {
      const markdown = generateReleaseNotes([parseCommitMessage('feat: one')], {
        version: '1.0.1',
        repository: 'o/r',
        date: '2026-09-27',
        includeEmptySections: true,
      });

      expect(markdown).toContain('## Bug Fixes');
      expect(markdown).toContain('- No changes.');
    });
  });
});
