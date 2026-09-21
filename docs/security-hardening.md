# Security fixes and deployment requirements

The server now requires verified email for new hotel role assignments, validates active sessions on access-token authentication, and disables production sandbox checkout. Documents use a separate private bucket with signed upload content length and content type, metadata validation before compliance writes, and authorized short-lived downloads. Portal excludes identity, document, and bank steps from persisted onboarding state and clears drafts on logout. Web session validation consults the backend and logout revokes the cookie-backed refresh session.

## Deployment

- Set S3_PRIVATE_BUCKET to a distinct private bucket with public access disabled. Configure object credentials for Put/Get/Head and browser upload CORS. Set API_PUBLIC_URL to the backend public origin, without an API path suffix.
- Existing public documents are not made private retroactively. Copy them to private storage, update stored document references, verify owner/platform access and anonymous denial, then remove old objects and cached public copies. This has not been performed against production.
- Configure EMAIL_GATEWAY_URL and EMAIL_GATEWAY_API_KEY. The email_verification template receives code and expiresInMinutes. Redis must support GETDEL (6.2+). Users request and confirm their own email in Portal before a new hotel role assignment. Existing memberships are not automatically removed.
- Production checkout stays unavailable until a real payment provider is implemented/configured. Explicit sandbox is also disabled in production.
- No database migration is required. Tokens without session IDs require login again. Deploy the frontend logout changes with the backend session validation. Portal offline logout clears local state but remote revocation is best effort; Web reports revocation failure so users can retry.
- Actual production bucket permissions and mail delivery remain deployment checks. Dependency upgrades are outside this change.

## Account routing

Each account logs in with its own credentials and database role. Admin, Support, Super Admin and hotel workspaces have separate route guards. Super Admin operational screens reuse existing components under /super-admin; they do not impersonate another account. Backend global permissions remain intact and the JWT strategy reads the current database role. Hotel selection only changes the scope of the same authorized hotel account.

## Verification

Portal: 116 unit tests and production build passed. Server: the existing 412-test run passed; 24 focused security tests and 8 additional account-role tests passed. Web: 37 tests, type checking and changed-file lint passed. Browser regression results are recorded separately in the Portal role-browser.log. No production deployment or storage migration has been performed.
