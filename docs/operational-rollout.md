# Operational rollout and accessibility checks

## Feature flags

Feature flags fall back to environment variables when no remote value is available. Missing values use the safer defaults:

- `TRELLIS_FEATURE_STABLE_BUG_REPORT_PAGINATION=true` enables deterministic cursor pagination.
- `TRELLIS_FEATURE_SECURITY_REPORT_EXPORT=false` keeps security report exports disabled until explicitly enabled.

Set a flag to `false` to roll back pagination, or set the export flag to `true` only after verifying authorization and output handling in the deployment environment. Environment changes take effect on process restart.

### Percentage rollouts and remote configuration

Set `TRELLIS_FEATURE_FLAGS_URL` on the server, or `NEXT_PUBLIC_TRELLIS_FEATURE_FLAGS_URL` for a browser client, to an endpoint returning JSON in this shape:

```json
{
	"flags": {
		"securityReportExport": {
			"enabled": true,
			"rolloutPercentage": 10
		}
	}
}
```

The helper polls immediately when a flag is evaluated, then every 30 seconds. Remote values replace the corresponding environment fallback and are applied to subsequent evaluations without a restart. A percentage rollout requires a stable user ID; pass it as the third argument to `isFeatureEnabled(flag, environment, userId)` or as the second argument to `getFeatureFlags(environment, userId)`. Users are assigned by MurmurHash3, and evaluations without a user ID fail closed for percentage-limited flags. Invalid remote values are ignored.

In a browser, maintainers can force a flag locally with `setFeatureFlagOverride(flag, true)` or `setFeatureFlagOverride(flag, false)`. Pass `null` to clear an override. Values are stored under `trellis.feature-flags.override.<flag>` in local storage and do not affect server-side evaluations. Use `subscribeToFeatureFlagChanges` to refresh client UI when polling or an override changes a flag.

## Operational health

Open `/dashboard/operations` to review redacted counts for unresolved exceptions, stale records, reconciliation drift, and critical user incidents. Each category links to the relevant bug-report view without including reporter email addresses or wallet addresses in the summary.

## Accessibility verification

Run the existing checks with:

```bash
npm run typecheck
npm test -- --runInBand
npm run test:e2e
```

Keyboard users can tab through the bug-report form, and invalid fields expose `aria-invalid`, `aria-describedby`, and live error messages.