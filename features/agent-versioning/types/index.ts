/**
 * Represents the deployment status of a Soroban contract version on the Stellar ledger.
 */
export type VersionStatus = 'stable' | 'beta' | 'deprecated';

/**
 * Represents the data schema of the contract. 
 * Used to compare versions side-by-side and detect state schema changes.
 */
export interface ContractStateSchema {
  fields: Record<string, string>; // e.g., { "userBalance": "i128", "admin": "address" }
}

/**
 * Core metadata for a specific agent contract version stored on-chain.
 */
export interface VersionMetadata {
  version: string;             // Semantic versioning (e.g., "1.0.2")
  contractId: string;          // The actual Soroban contract ID on the network
  timestamp: number;           // Unix timestamp of deployment
  author: string;              // Stellar public key (address) of the deployer
  changelog: string;           // On-chain changelog entries
  status: VersionStatus;       // Marker for stable/beta/deprecated
  stateSchema: ContractStateSchema; 
}

/**
 * Represents a community voting proposal for scheduling an upgrade.
 */
export interface UpgradeProposal {
  proposalId: string;
  targetVersion: string;       // The version being proposed
  newContractId: string;       // The Soroban contract ID for the upgrade
  scheduledExecutionTime: number; // When the upgrade should happen if passed
  votesFor: number;
  votesAgainst: number;
  status: 'pending' | 'approved' | 'rejected' | 'executed';
}

/**
 * Changelog section a parsed commit is filed under. Derived from the commit's
 * Conventional Commit type, with "other" catching non-conventional messages.
 */
export type CommitCategory =
  | 'features'
  | 'fixes'
  | 'performance'
  | 'documentation'
  | 'refactoring'
  | 'tests'
  | 'build'
  | 'styles'
  | 'chores'
  | 'reverts'
  | 'other';

/**
 * A pull request or issue reference extracted from a commit message.
 */
export interface CommitReference {
  number: number;
  type: 'pull' | 'issue';
}

/**
 * A single commit from the repository history, categorised for release notes.
 */
export interface ParsedCommit {
  hash?: string;               // Short/long SHA when parsed from git log output
  type?: string;               // Conventional Commit type, e.g. "feat"
  scope?: string;              // Optional scope from "feat(scope): ..."
  subject: string;             // Commit subject (header) without the type prefix
  breaking: boolean;           // "!" header flag or a BREAKING CHANGE footer
  category: CommitCategory;    // Section the commit is grouped into
  references: CommitReference[]; // Linked pull requests and issues
  body: string;                // Remaining message after the header
  raw: string;                 // Original message, kept for diagnostics
}

/**
 * Commits filed under a single changelog section.
 */
export interface ReleaseNotesGroup {
  category: CommitCategory;
  title: string;
  commits: ParsedCommit[];
}

/**
 * Inputs used to render a Markdown release-notes draft.
 */
export interface ReleaseNotesOptions {
  version: string;             // Version the notes describe
  repository?: string;         // "owner/name", github.com URL or clone URL
  previousVersion?: string;    // Renders a "... (since vX.Y.Z)" heading
  date?: string;               // ISO date override (defaults to today)
  includeEmptySections?: boolean; // Keep empty sections for a stable preview
}
