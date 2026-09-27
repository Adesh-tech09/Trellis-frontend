import {
  CommitReference,
  ParsedCommit,
  ReleaseNotesOptions,
} from '../types';
import { groupCommitsByCategory } from './commit-parser';

const FALLBACK_LABEL: Record<CommitReference['type'], (number: number) => string> = {
  pull: (number) => `#${number}`,
  issue: (number) => `issue #${number}`,
};

/**
 * Normalises a repository reference (`owner/name`, a github.com URL or an SSH
 * clone URL) into a browsable `https://github.com/owner/name` base URL.
 */
export const repositoryBaseUrl = (repository?: string): string | null => {
  if (!repository) return null;

  let value = repository.trim();
  if (!value) return null;

  value = value.replace(/^git\+/, '').replace(/\.git$/, '');

  const sshMatch = /^git@github\.com:(.+)$/.exec(value);
  if (sshMatch) value = sshMatch[1];

  const httpsMatch = /^https?:\/\/github\.com\/(.+)$/.exec(value);
  if (httpsMatch) value = httpsMatch[1];

  const [owner, name] = value.replace(/^\/+|\/+$/g, '').split('/').filter(Boolean);
  if (!owner || !name) return null;

  return `https://github.com/${owner}/${name}`;
};

/**
 * Builds the full URL for a pull request or issue reference. Returns `null`
 * when no repository is configured so callers can degrade to a plain `#123`.
 */
export const referenceUrl = (
  reference: CommitReference,
  repository?: string,
): string | null => {
  const base = repositoryBaseUrl(repository);
  if (!base) return null;
  const segment = reference.type === 'pull' ? 'pull' : 'issues';
  return `${base}/${segment}/${reference.number}`;
};

/**
 * Renders one commit as a Markdown bullet, including its scope, a breaking
 * marker and linked pull request / issue references.
 */
export const formatCommitLine = (
  commit: ParsedCommit,
  repository?: string,
): string => {
  const scope = commit.scope ? `**${commit.scope}:** ` : '';
  const breaking = commit.breaking ? ' **BREAKING**' : '';

  const references = commit.references
    .map((reference) => {
      const label = FALLBACK_LABEL[reference.type](reference.number);
      const url = referenceUrl(reference, repository);
      return url ? `[${label}](${url})` : label;
    })
    .join(', ');

  const suffix = references ? ` (${references})` : '';

  return `- ${scope}${commit.subject}${breaking}${suffix}`;
};

/**
 * Generates the Markdown release-notes draft for a set of parsed commits.
 * Breaking changes lead the document, followed by the conventional sections in
 * canonical order.
 */
export const generateReleaseNotes = (
  commits: ParsedCommit[],
  options: ReleaseNotesOptions,
): string => {
  const date = options.date ?? new Date().toISOString().slice(0, 10);
  const breaking = commits.filter((commit) => commit.breaking);
  const regular = commits.filter((commit) => !commit.breaking);
  const groups = groupCommitsByCategory(regular, options.includeEmptySections);

  const lines: string[] = [];
  const heading = options.previousVersion
    ? `# Release v${options.version} (since v${options.previousVersion})`
    : `# Release v${options.version}`;

  lines.push(heading, '');
  lines.push(
    `_Generated from ${commits.length} commit${commits.length === 1 ? '' : 's'} on ${date}._`,
    '',
  );

  if (breaking.length > 0) {
    lines.push('## Breaking Changes', '');
    for (const commit of breaking) {
      lines.push(formatCommitLine(commit, options.repository));
    }
    lines.push('');
  }

  if (groups.length === 0) {
    lines.push('## Other Changes', '', '- No changes in this release.', '');
  } else {
    for (const group of groups) {
      lines.push(`## ${group.title}`, '');
      if (group.commits.length === 0) {
        lines.push('- No changes.', '');
        continue;
      }
      for (const commit of group.commits) {
        lines.push(formatCommitLine(commit, options.repository));
      }
      lines.push('');
    }
  }

  return `${lines.join('\n').trim()}\n`;
};
