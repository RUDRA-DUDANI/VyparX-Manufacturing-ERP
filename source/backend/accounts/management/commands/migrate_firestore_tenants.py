"""Copy legacy flat Firestore collections into company scoped collections.

The command is idempotent: existing destination documents are left untouched.
Run once before deploying code that reads only the tenant scoped collections.
"""
from django.core.management.base import BaseCommand, CommandError

from accounts.firestore_store import FirestoreNotConfigured, get_db


LEGACY_COLLECTIONS = {
    "members": "memberships",
    "tasks": "tasks",
    "alerts": "alerts",
    "materialPlanningReviews": "materialPlanningReviews",
    "counters": "counters",
    "crm": "crm",
    "sales": "sales",
    "purchase": "purchase",
    "inventory": "inventory",
    "production": "production",
    "transport": "transport",
    "accounting": "accounting",
    "quotations": "quotations",
    "catalog": "catalog",
}


class Command(BaseCommand):
    help = "Copy existing flat Firestore ERP records under companies/{companyId}."

    def handle(self, *args, **options):
        try:
            db = get_db()
            copied = skipped = 0
            batch = db.batch()
            pending = 0
            for source_name, destination_name in LEGACY_COLLECTIONS.items():
                self.stdout.write(f"Scanning legacy collection: {source_name}")
                records_by_company = {}
                for snapshot in db.collection(source_name).stream(timeout=60):
                    record = snapshot.to_dict() or {}
                    company_id = str(record.get("companyId") or "").strip()
                    if not company_id:
                        skipped += 1
                        continue
                    records_by_company.setdefault(company_id, []).append((snapshot.id, record))

                # Read each destination subcollection once, instead of making
                # one network round trip per legacy document. This makes the
                # command practical for large tenants and safe to resume.
                for company_id, records in records_by_company.items():
                    destination_collection = (db.collection("companies").document(company_id)
                                               .collection(destination_name))
                    existing_ids = {snapshot.id for snapshot in destination_collection.stream(timeout=60)}
                    for record_id, record in records:
                        if record_id in existing_ids:
                            skipped += 1
                            continue
                        batch.create(destination_collection.document(record_id), record)
                        copied += 1
                        pending += 1
                        if pending >= 450:
                            batch.commit()
                            batch = db.batch()
                            pending = 0
            if pending:
                batch.commit()
        except FirestoreNotConfigured as exc:
            raise CommandError(str(exc)) from exc
        self.stdout.write(self.style.SUCCESS(
            f"Firestore tenant migration complete: copied={copied}, skipped={skipped}."
        ))
