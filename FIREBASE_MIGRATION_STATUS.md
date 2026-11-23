# Firestore migration status

## Backend data architecture

- Django REST Framework remains the API layer and Firebase Authentication remains the identity provider.
- Authenticated requests verify the Firebase ID token, then load the active Firebase UID, user document, company, and membership from Firestore. The company and membership are checked again on each cache miss; the identity metadata cache is limited to ten seconds.
- Business records are stored under `companies/{companyId}/{module}/{recordId}`. Memberships, tasks, alerts, counters, and material planning reviews are also company scoped. `users/{uid}` stores Firebase user metadata only.
- The registration path validates required fields, email, password confirmation and strength, and GSTIN. It creates the Firebase Auth user and atomically creates the Firestore company, user, Admin membership, and GSTIN uniqueness key. If Firestore creation fails, it attempts to delete the Firebase Auth user.
- REST API persistence is Firestore based. The obsolete ORM-backed serializers were replaced with normalization helpers, and `accounts.views` now re-exports the Firestore views.
- Admin has operational read access for reporting. The default API permission guard blocks Admin writes to CRM, Sales, Purchase, Inventory, Production, Transport, and Accounting APIs. Admin user/company settings, department heads, tasks, and catalog administration remain available.

## Existing Firestore data

For deployments with the former flat Firestore layout, take an export and run `python manage.py migrate_firestore_tenants` before deploying the tenant-scoped reader. The command copies company-owned documents while preserving their IDs and leaves existing legacy documents in place. Review copied/skipped counts and confirm representative records before cutover.

## Storage boundary

SQLite remains configured only as Django framework infrastructure. It is not used for ERP business records. Firestore is the authoritative application data store. Firebase client rules deny direct browser writes; all business access goes through the authenticated backend.

## Deployment and validation

Configure Firebase Admin credentials for the same project as the frontend Firebase Auth app. The Firestore Admin client requires server-side credentials and bypasses client security rules, so company scoping and authorization in the API remain mandatory. Firestore compound indexes may be needed if future queries add multiple filter/order clauses; the current tenant collection scans and single-field lookups use automatic indexes.

No live Firebase migration or browser smoke test has been run from this workspace. A staging cutover should validate registration/rollback, membership revocation, cross-company record isolation, each module's CRUD/workflow, and Admin write denial before production deployment.
