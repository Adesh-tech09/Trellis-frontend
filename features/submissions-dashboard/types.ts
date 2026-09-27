import { SecurityScanResult } from "./utils/scanner";

export type SubmissionStatus = "pending" | "success" | "failed" | string;

export interface Submission {
  id: string;
  txHash: string;
  status: SubmissionStatus;
  timestamp: string | number;
  error?: string;
  content?: string;
  securityScan?: SecurityScanResult;
  [key: string]: unknown;
}
