# Firebase / Cloudinary Migration Status

## Implemented in this update
- Removed MySQL configuration and `mysqlclient` dependency.
- Django uses SQLite only for framework internals; VyaparX business API records are designed to be stored in Firestore.
- Added Firestore repository and Firestore-backed APIs for registration/company records, user memberships/roles, department heads, tasks, alerts, and generic module records.
- Firebase ID token verification now resolves role and company membership from Firestore.
- Added company-scoped Cloudinary upload API for image/PDF attachments.
- Added frontend helper methods for module CRUD and authenticated file upload.
- Updated the Admin header profile area to show the registered company name only.
- Added `.env.example`, setup documentation, and Firestore client rules that deny direct browser data access.

## Important work still required before claiming all ERP data is migrated
The existing CRM, Sales, Purchase, Inventory, Production, Transport, and Accounting screens contain demo/in-memory state and legacy attachment flows. This update adds Firestore APIs but does not fully replace every module's create/edit/delete handlers with Firestore calls. A feature is not Firestore-persistent until its frontend workflow calls the API and reads the saved record back. Do not use this package as a production deployment until that module-by-module integration and end-to-end testing is completed.

- Existing browser-generated print/PDF downloads are not automatically archived to Cloudinary; uploaded image/PDF attachments are sent through the Cloudinary API.
- Cloudinary uploads require the three Cloudinary values in the backend `.env`.
- Firestore requires a private Firebase Admin service-account JSON file configured outside the source archive.
- Static syntax checks passed. Django runtime checks/tests could not be run in this build environment because Django/DRF/Firebase Admin/Cloudinary dependencies are not installed here.
