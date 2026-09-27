import { Submission } from "../types";
import { StatusBadge } from "./StatusBadge";

interface SubmissionTableProps {
  submissions: Submission[];
}

export function SubmissionTable({ submissions }: SubmissionTableProps) {
  if (submissions.length === 0) {
    return <p>No submissions available.</p>;
  }

  return (
    <div className="overflow-x-auto rounded border border-slate-200">
      <table className="min-w-full divide-y divide-slate-200 text-left text-sm">
        <thead className="bg-slate-50">
          <tr>
            <th className="px-3 py-2">ID</th>
            <th className="px-3 py-2">Tx Hash</th>
            <th className="px-3 py-2">Status</th>
            <th className="px-3 py-2">Timestamp</th>
            <th className="px-3 py-2">Security Score</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-slate-100 bg-white">
          {submissions.map((submission) => (
            <tr key={submission.id}>
              <td className="px-3 py-2 align-top truncate max-w-xs">{submission.id}</td>
              <td className="px-3 py-2 align-top truncate max-w-xs">{submission.txHash}</td>
              <td className="px-3 py-2 align-top">
                <StatusBadge status={submission.status} />
              </td>
              <td className="px-3 py-2 align-top">{String(submission.timestamp)}</td>
              <td className="px-3 py-2 align-top">
                {submission.securityScan ? (
                  <div className="flex flex-col gap-2">
                    <span
                      className={`inline-block px-2 py-1 text-xs font-semibold rounded ${
                        submission.securityScan.score === "Passed"
                          ? "bg-green-100 text-green-800"
                          : submission.securityScan.score === "Warning"
                          ? "bg-yellow-100 text-yellow-800"
                          : "bg-red-100 text-red-800"
                      }`}
                    >
                      {submission.securityScan.score}
                    </span>
                    {submission.securityScan.flags.length > 0 && (
                      <div className="text-xs text-slate-600 mt-1">
                        {submission.securityScan.flags.map((flag, idx) => (
                          <div key={idx} className="mb-2 bg-slate-50 p-2 rounded border border-slate-200">
                            <strong>{flag.type}:</strong> {flag.message}
                            <div className="mt-1 text-blue-700">
                              <em>Remediation:</em> {flag.remediation}
                            </div>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                ) : (
                  <span className="text-slate-400 italic">Not scanned</span>
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
