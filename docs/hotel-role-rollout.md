# Approved hotel memberships and scoped roles

Global users remain USER while applying. Creating a draft does not create OWNER membership. Approval atomically changes property status, activates the canonical owner's membership and records moderation. Applications and hotel operations have separate authorization paths.

Hotel team roles belong to one property. HOTEL_ADMIN is separate from platform ADMIN. Owners and platform administrators manage teams; staff/custom roles cannot grant ownership or team-management privileges. Booking, review and dispute actions resolve the target property on the server. Super Admin can access platform admin/support routes and manage user and hotel directories.

## Deployment

Deploy migration 20260917000000_property_memberships before the matching server build, then deploy the portal feature/hotel-scoped-roles branch. The migration introduces HOTEL_ADMIN/custom roles, removes premature or noncanonical OWNER memberships and backfills canonical owners for approved and suspended properties. Suspended hotels retain ownership for restoration but expose no operational permissions.

The portal requires GET /me/properties, the /properties/:propertyId/team endpoints and the Super Admin directory endpoints. Availability room reads accept view_availability or manage_rooms; room writes still require manage_rooms. Existing owner-only payout and notification policy is retained.

## Verification and limitations

Prisma schema validation, ESLint, Nest build and the unit suite were run locally. Added coverage exercises approval gating, custom role boundaries, hotel assignment, forbidden owner/platform escalation and approval transaction coordination. Existing service tests were updated for permission-based authorization.

Database-backed integration tests and migration execution were not run: Docker is unavailable and no isolated .env.test is configured. Validate the migration and approval-to-membership flow in an isolated PostgreSQL test environment before deployment. Unit mocks do not prove database rollback or migration behavior. No live database migration was applied.
