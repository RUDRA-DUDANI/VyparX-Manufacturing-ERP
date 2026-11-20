"""Firestore-backed business data repository for VyaparX.

All ERP business records live in Cloud Firestore. Django's SQLite database is
used only for Django framework internals (sessions/contenttypes), not ERP data.
"""
import uuid
from datetime import datetime, timezone as dt_timezone
from decimal import Decimal
from functools import lru_cache

from django.conf import settings


class FirestoreNotConfigured(RuntimeError):
    pass


@lru_cache(maxsize=1)
def get_db():
    try:
        import firebase_admin
        from firebase_admin import credentials, firestore
    except ImportError as exc:
        raise FirestoreNotConfigured("Install firebase-admin before using Firestore.") from exc

    if not firebase_admin._apps:
        service_json = str(settings.FIREBASE_SERVICE_ACCOUNT_JSON or "").strip()
        credentials_path = str(settings.GOOGLE_APPLICATION_CREDENTIALS or "").strip()
        if service_json:
            import json
            try:
                service_account = json.loads(service_json)
                project_id = str(service_account.get("project_id") or "").strip()
                expected_project = str(settings.FIREBASE_WEB_CONFIG.get("projectId") or "").strip()
                if expected_project and project_id and project_id != expected_project:
                    raise FirestoreNotConfigured("Firebase service-account project does not match FIREBASE_PROJECT_ID.")
                cred = credentials.Certificate(service_account)
            except FirestoreNotConfigured:
                raise
            except (ValueError, TypeError) as exc:
                raise FirestoreNotConfigured("Firebase Admin service-account JSON is invalid.") from exc
            firebase_admin.initialize_app(cred, {"storageBucket": settings.FIREBASE_WEB_CONFIG.get("storageBucket")})
        elif credentials_path:
            try:
                cred = credentials.Certificate(credentials_path)
            except (ValueError, OSError) as exc:
                raise FirestoreNotConfigured("Firebase Admin credentials could not be loaded. Check the configured service-account file.") from exc
            expected_project = str(settings.FIREBASE_WEB_CONFIG.get("projectId") or "").strip()
            credential_project = str(getattr(cred, "project_id", "") or "").strip()
            if expected_project and credential_project and expected_project != credential_project:
                raise FirestoreNotConfigured("Firebase service-account project does not match FIREBASE_PROJECT_ID.")
            firebase_admin.initialize_app(cred, {"storageBucket": settings.FIREBASE_WEB_CONFIG.get("storageBucket")})
        else:
            # ADC can be used in supported deployment environments.
            try:
                firebase_admin.initialize_app()
            except Exception as exc:
                raise FirestoreNotConfigured(
                    "Firebase Admin credentials are missing. Set GOOGLE_APPLICATION_CREDENTIALS to your private service-account JSON path."
                ) from exc
    return firestore.client()


def now_iso():
    return datetime.now(dt_timezone.utc).isoformat()


def clean(value):
    """Convert Firestore values into JSON-friendly values."""
    if isinstance(value, dict):
        return {str(k): clean(v) for k, v in value.items()}
    if isinstance(value, list):
        return [clean(v) for v in value]
    if hasattr(value, "isoformat"):
        return value.isoformat()
    return value


def firestore_safe(value):
    """Recursively transform data to ensure it complies with Firestore constraints.
    Firestore strictly rejects nested arrays (arrays containing arrays).
    Any nested array element is converted into a map with indexing and label keys.
    """
    if isinstance(value, dict):
        return {str(k): firestore_safe(v) for k, v in value.items()}
    if isinstance(value, (list, tuple)):
        sanitized = []
        for item in value:
            if isinstance(item, (list, tuple)):
                d = str(item[0]) if len(item) > 0 else ""
                a = str(item[1]) if len(item) > 1 else ""
                item_dict = {"0": d, "1": a, "date": d, "action": a}
                for i, sub_item in enumerate(item):
                    item_dict[str(i)] = firestore_safe(sub_item)
                sanitized.append(item_dict)
            else:
                sanitized.append(firestore_safe(item))
        return sanitized
    if hasattr(value, "isoformat"):
        return value.isoformat()
    if isinstance(value, Decimal):
        return float(value)
    return value


# ---------------------------------------------------------------------------
# Firestore layout (production-ready, one top-level collection per concern):
#
#   companies/{companyId}                       -> registration / company profile
#   users/{uid}                                 -> registered user identity
#   members/{docId}                             -> role/membership (companyId field)
#   crm|sales|purchase|inventory|production|
#   transport|accounting|quotations|catalog     -> one top-level collection per
#                                                  ERP module; every document
#                                                  carries companyId
#   tasks/{docId}, alerts/{docId}               -> admin collaboration (companyId)
#   counters/{docId}                            -> {companyId}:{module}:{counter}
# ---------------------------------------------------------------------------

MODULE_COLLECTIONS = {
    "crm", "sales", "purchase", "inventory", "production",
    "transport", "accounting", "quotations", "catalog",
}


def _module_collection(module):
    """Validate and return the top-level collection name for a module."""
    name = str(module or "").strip().lower()
    if name not in MODULE_COLLECTIONS:
        # Unknown modules still get an isolated, namespaced collection.
        return f"module_{name}"
    return name


def module_records_ref(company_id, module):
    """Top-level collection reference holding one module's business records."""
    return get_db().collection(_module_collection(module))


def module_record_ref(company_id, module, record_id):
    """Reference to a single business record inside the module collection."""
    return module_records_ref(company_id, module).document(str(record_id))


def module_counter_ref(company_id, module, counter_name):
    """Company-scoped display-number counter inside the shared counters collection."""
    doc_id = f"{company_id}:{_module_collection(module)}:{counter_name}"
    return get_db().collection("counters").document(doc_id)


def material_planning_reviews_ref(company_id):
    """Top-level review-history collection; every document carries companyId."""
    return get_db().collection("materialPlanningReviews")


def members_ref(company_id):
    """Top-level members collection; every document carries companyId."""
    return get_db().collection("members")


def tasks_ref(company_id):
    return get_db().collection("tasks")


def alerts_ref(company_id):
    return get_db().collection("alerts")


def company_ref(company_id):
    return get_db().collection("companies").document(str(company_id))


def user_ref(uid):
    # Firebase UID is preserved verbatim as the existing users/{uid} document ID.
    return get_db().collection("users").document(str(uid))


def membership_ref(company_id, uid):
    return members_ref(company_id).document(str(uid))


_USER_CACHE = {}

# Short-lived identity cache. Identity (user/company/membership) is metadata
# read on EVERY authenticated request; caching it briefly removes 2-3 Firestore
# round-trips per request without caching any changing business records.
# Role/status changes therefore propagate within this TTL. No business data
# (tasks, leads, orders...) passes through this cache.
_IDENTITY_TTL_SECONDS = 10
_IDENTITY_CACHE = {}


def get_identity(uid):
    now = datetime.now(dt_timezone.utc).timestamp()
    cached = _IDENTITY_CACHE.get(str(uid))
    if cached and (now - cached[0]) < _IDENTITY_TTL_SECONDS:
        return cached[1]
    identity = _load_identity(uid)
    if identity:
        _IDENTITY_CACHE[str(uid)] = (now, identity)
    return identity


def _load_identity(uid):
    user_snap = user_ref(uid).get()
    if not user_snap.exists:
        return None
    user = user_snap.to_dict() or {}
    if not user.get("isActive", True):
        return None
    company_id = user.get("companyId")
    if not company_id:
        return None
    # Company and membership reads are independent of each other (both keyed by
    # the company id already returned by the user document), so they run in
    # parallel instead of two sequential network round-trips.
    from concurrent.futures import ThreadPoolExecutor
    with ThreadPoolExecutor(max_workers=2) as pool:
        company_snap, member_snap = list(pool.map(
            lambda ref: ref.get(),
            (company_ref(company_id), membership_ref(company_id, uid)),
        ))
    if not company_snap.exists or not member_snap.exists:
        return None
    company = company_snap.to_dict() or {}
    membership = member_snap.to_dict() or {}
    if not company.get("isActive", True) or membership.get("status", "ACTIVE") != "ACTIVE":
        return None
    return {"user": user, "company": company, "membership": membership,
            "uid": str(uid), "companyId": str(company_id)}


def list_members(company_id):
    docs = members_ref(company_id).where("companyId", "==", str(company_id)).stream()
    output = []
    for snap in docs:
        item = snap.to_dict() or {}
        item["id"] = snap.id
        full_name = item.get("fullName")
        email = item.get("email")
        is_active = item.get("isActive")
        if not full_name or not email or is_active is None:
            if snap.id in _USER_CACHE:
                user = _USER_CACHE[snap.id]
            else:
                try:
                    u_snap = user_ref(snap.id).get()
                    user = u_snap.to_dict() or {} if u_snap.exists else {}
                    _USER_CACHE[snap.id] = user
                except Exception:
                    user = {}
            item["fullName"] = full_name or user.get("fullName", "")
            item["email"] = email or user.get("email", "")
            item["isActive"] = is_active if is_active is not None else user.get("isActive", True)
        output.append(clean(item))
    return sorted(output, key=lambda x: x.get("createdAt", ""))


def save_module_record(company_id, module, record_id, data):
    ref = module_record_ref(company_id, module, record_id)
    current = ref.get()
    payload = dict(data)
    payload.update({"id": str(record_id), "companyId": str(company_id), "module": str(module),
                    "updatedAt": now_iso()})
    if not current.exists:
        payload.setdefault("createdAt", now_iso())
    safe_payload = firestore_safe(payload)
    ref.set(safe_payload, merge=True)
    return clean(safe_payload)


def list_module_records(company_id, module, limit=500):
    docs = (module_records_ref(company_id, module)
            .where("companyId", "==", str(company_id))
            .limit(min(max(int(limit), 1), 5000)).stream())
    return [clean({**(snap.to_dict() or {}), "id": snap.id}) for snap in docs]


def get_module_record(company_id, module, record_id, include_deleted=False):
    """Fetch one company-scoped module record, or None when absent/foreign."""
    snap = module_record_ref(company_id, module, record_id).get()
    if not snap.exists:
        return None
    record = clean({**(snap.to_dict() or {}), "id": snap.id})
    if str(record.get("companyId") or "") != str(company_id):
        return None
    if not include_deleted and record.get("isDeleted"):
        return None
    return record


def delete_module_record(company_id, module, record_id, soft=True):
    """Soft-delete (isDeleted flag) or hard-delete one company-scoped record."""
    ref = module_record_ref(company_id, module, record_id)
    snap = ref.get()
    if not snap.exists:
        return False
    record = snap.to_dict() or {}
    if str(record.get("companyId") or "") != str(company_id):
        return False
    if soft:
        ref.set({"isDeleted": True, "deletedAt": now_iso()}, merge=True)
    else:
        ref.delete()
    return True


def list_collection(company_id, collection, limit=500):
    name = str(collection or "").strip().lower()
    docs = (get_db().collection(name)
            .where("companyId", "==", str(company_id))
            .limit(min(max(int(limit), 1), 500)).stream())
    return [clean({**(snap.to_dict() or {}), "id": snap.id}) for snap in docs]


def save_collection_record(company_id, collection, record_id, data):
    name = str(collection or "").strip().lower()
    ref = get_db().collection(name).document(str(record_id))
    current = ref.get()
    payload = dict(data)
    payload.update({"id": str(record_id), "companyId": str(company_id), "updatedAt": now_iso()})
    if not current.exists:
        payload.setdefault("createdAt", now_iso())
    safe_payload = firestore_safe(payload)
    ref.set(safe_payload, merge=True)
    return clean(safe_payload)
