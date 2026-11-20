# VyaparX ERP backend

## Architecture

- Firebase Authentication manages user credentials and identity.
- Cloud Firestore stores ERP business records. Django REST Framework exposes the authenticated APIs and applies company and role checks.
- Module records are in top-level Firestore collections such as `production`, `sales`, `inventory`, `accounting`, and `quotations`. Each record carries a `companyId`; every read and write must enforce it. These are shared collections, not company subcollections.
- Company and user metadata use top-level `companies/{companyId}`, `users/{firebaseUid}`, and `members/{firebaseUid}` documents. Workflow task and alert records are also top-level, with company ownership fields.
- SQLite is only for Django framework internals such as sessions and content types; it is not the ERP business database.
- Cloudinary and Resend are optional integrations configured with server-side environment variables. Uploads require Cloudinary configuration; email delivery is skipped if Resend is not configured.

The Firebase Admin SDK has elevated access and bypasses Firestore client security rules. Keep every server query scoped to the authenticated company, validate linked records, and never expose service-account credentials to the browser.

## Local setup (Windows PowerShell)

1. Create a Firebase project, enable Email/Password authentication, and create its Firestore database.
2. Configure the matching Firebase Web app values in `.env` (`FIREBASE_WEB_API_KEY`, `FIREBASE_AUTH_DOMAIN`, `FIREBASE_PROJECT_ID`, `FIREBASE_STORAGE_BUCKET`, `FIREBASE_MESSAGING_SENDER_ID`, and `FIREBASE_APP_ID`).
3. Use a Firebase service account JSON stored outside the project, or use the platform's Application Default Credentials. Never commit credential files or JSON.
4. Copy `.env.example` to `.env`. Set a random `DJANGO_SECRET_KEY`, `DJANGO_DEBUG=1` for local development, and `DJANGO_ALLOWED_HOSTS=localhost,127.0.0.1,testserver` for local commands. Configure the Firebase Admin credential source and any integrations you need.
5. Install and run:

   ```powershell
   cd "source\backend"
   py -3.11 -m venv .venv
   .\.venv\Scripts\Activate.ps1
   pip install -r accounts\requirements.txt
   python manage.py check
   python manage.py migrate
   python manage.py runserver 8000
   ```

6. Open `http://127.0.0.1:8000/html/landing.html`.

## Production deployment

- Set `DJANGO_ENV=production`, `DJANGO_DEBUG=0`, a random `DJANGO_SECRET_KEY` of at least 50 characters, explicit `DJANGO_ALLOWED_HOSTS`, and HTTPS public origins in `CORS_ALLOWED_ORIGINS` and `CSRF_TRUSTED_ORIGINS`.
- Production defaults turn on HTTPS redirects, one-year HSTS, and secure session/CSRF cookies. Only deploy behind HTTPS. If TLS terminates at a reverse proxy, make it replace untrusted `X-Forwarded-Proto` headers and set `DJANGO_TRUST_X_FORWARDED_PROTO=1` so Django can recognize HTTPS requests.
- Run `python manage.py check --deploy` using the actual production environment and resolve all deployment warnings. Do not disable security settings just to silence the check.
- Provide Firebase Web configuration and Firebase Admin credentials for the same project. Admin credentials may be provided by `FIREBASE_SERVICE_ACCOUNT_JSON`, `GOOGLE_APPLICATION_CREDENTIALS`, or trusted platform ADC. The service account must have only the permissions the application needs.
- Configure backups, restore drills, Firestore access review, key rotation, monitoring, and an HTTPS deployment check before opening the ERP to customers.

## Optional integrations

For Cloudinary uploads, configure `CLOUDINARY_CLOUD_NAME`, `CLOUDINARY_API_KEY`, and `CLOUDINARY_API_SECRET` in the server `.env`. The authenticated upload API accepts images and PDFs up to 15 MB. The API secret must never be exposed to browser JavaScript.

For welcome and task emails, configure `RESEND_API_KEY`, a Resend-verified `RESEND_FROM_EMAIL`, and optionally `RESEND_FROM_NAME` and `APP_PUBLIC_URL`. Email provider failure does not undo an already saved ERP workflow; a provider acceptance response does not guarantee inbox delivery.

## Workflow APIs

The project includes authenticated module CRUD plus dedicated workflow endpoints for Production Orders, Material Plan approval/issue, Sales-to-Accounting approval, Purchase receipts, and Transport accounting submission/review. Workflow-owned records must be created or transitioned through their dedicated endpoints; generic module writes intentionally reject restricted record types.

Production creation and start require the corresponding Sales/Accounting/Inventory approvals and authorized roles. The Production Start API updates the existing Production document transactionally and checks its linked records again on every request.

## Tests and checks

Run from `source\backend`:

```powershell
python manage.py test accounts.tests_auth_flow
python manage.py check
python manage.py check --deploy
```

The tests mock Firestore and Firebase; they do not write live customer records. A real deployment still needs an authenticated browser/API smoke test against its own staging Firebase project.
