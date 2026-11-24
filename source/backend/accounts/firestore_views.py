
from google.cloud import firestore
import hashlib
import json
import logging
import re
import uuid
from concurrent.futures import ThreadPoolExecutor
from datetime import date
from decimal import Decimal, InvalidOperation, ROUND_HALF_UP
from datetime import datetime
from time import perf_counter
from types import SimpleNamespace

from django.conf import settings
from django.utils import timezone as django_timezone
from rest_framework import permissions, status
from rest_framework.decorators import api_view, authentication_classes, permission_classes
from rest_framework.parsers import MultiPartParser, FormParser
from rest_framework.response import Response
from rest_framework.views import APIView

from .firebase import FirebaseAuthService, FirebaseNotConfigured, firebase_web_config_status
from .firestore_store import (
    FirestoreNotConfigured, get_db, company_ref, user_ref, membership_ref,
    members_ref, tasks_ref, alerts_ref, module_records_ref, module_counter_ref,
    material_planning_reviews_ref,
    get_identity, list_members, list_module_records, get_module_record, save_module_record,
    list_collection, save_collection_record, now_iso, clean, firestore_safe,
)
from .models import Role, Module, MembershipStatus, TaskStatus
from .permissions import IsCompanyAdmin, user_can_access_module
from .serializers import normalize_role, flatten_registration_payload, GSTIN_RE
from .welcome_email import queue_welcome_email

logger = logging.getLogger(__name__)
_TASK_EMAIL_EXECUTOR = ThreadPoolExecutor(max_workers=3, thread_name_prefix="task-email")


def _production_match_key(value):
    """Normalize human entered product codes/names without fuzzy matching."""
    return " ".join(str(value or "").split()).casefold()


def _is_work_order_record(record):
    """Recognize current and explicitly supported legacy Production Orders."""
    record = record or {}
    record_type = re.sub(r"[\s_-]", "", str(
        record.get("recordType") or record.get("type") or record.get("orderType") or ""
    )).casefold()
    if record_type:
        return record_type in {"workorder", "productionorder"}
    # Match the narrow legacy shape already recognized by the Production UI.
    return record.get("qty") is not None and any(
        record.get(field) is not None and record.get(field) != ""
        for field in ("prod", "productionOrderDate", "productionOrderNo", "workOrderNumber")
    )


def _production_start_eligibility(order, company_id, plan=None, sales_order=None,
                                  linked_records_unavailable=False):
    """Mirror the server's Start guards for the Production list UI."""
    status_value = str(order.get("st") or order.get("status") or "PLANNED").upper()
    if status_value not in {"PLANNED", "READY"}:
        return {"eligible": False, "reason": "This Production Order is not in a startable status."}

    if linked_records_unavailable:
        return {"eligible": False, "reason": "Approval status could not be verified. Refresh Production Orders."}

    if order.get("materialPlanId"):
        if (not plan or plan.get("recordType") != "materialPlan" or plan.get("isDeleted")
                or str(plan.get("companyId") or "") != str(company_id)
                or str(plan.get("productionOrderId") or "") != str(order.get("id") or "")):
            return {"eligible": False, "reason": "The linked Material Plan could not be verified."}
        if plan.get("approvalStatus") != "Approved":
            return {"eligible": False, "reason": "Material Plan approval is pending."}

    if order.get("salesOrderId"):
        if (not sales_order or sales_order.get("recordType") != "salesOrder" or sales_order.get("isDeleted")
                or str(sales_order.get("companyId") or "") != str(company_id)):
            return {"eligible": False, "reason": "The linked Sales Order could not be verified."}
        if sales_order.get("accountingApprovalStatus") != "Approved":
            return {"eligible": False, "reason": "Accounting approval is pending."}

    materials = [row for row in (order.get("materials") or []) if isinstance(row, dict)]
    no_material_order = (order.get("manualCreated") is True
                         and order.get("manualNoMaterialRequired") is True and not materials)
    if not no_material_order:
        if not materials:
            return {"eligible": False, "reason": "Required material issue is pending."}
        try:
            for material in materials:
                required = Decimal(str(material.get("requiredQty", material.get("requiredQuantity", 0)) or 0))
                issued = Decimal(str(material.get("issuedQty") or 0))
                if (not required.is_finite() or not issued.is_finite() or issued < required):
                    return {"eligible": False, "reason": "Issue all required materials before starting."}
        except (InvalidOperation, TypeError, ValueError):
            return {"eligible": False, "reason": "Material quantities must be corrected before starting."}

    return {"eligible": True, "reason": ""}


def user_ref_by_email_exists(email):
    """Firestore-backed advisory check; Firebase email uniqueness is authoritative."""
    matches = get_db().collection("users").where("email", "==", str(email).strip().lower()).limit(1).stream()
    return next(iter(matches), None) is not None


def api_error(exc, fallback="The operation could not be completed."):
    if isinstance(exc, FirestoreNotConfigured):
        return Response({"error": str(exc)}, status=503)
    logger.exception("VyaparX API operation failed")
    # Firebase Admin errors are safe to report as an actionable operation error;
    # never include credentials or token contents in the response.
    detail = str(exc).strip()
    safe_detail = detail if detail and len(detail) <= 240 and "private key" not in detail.lower() else fallback
    return Response({"error": safe_detail or fallback}, status=400)


def user_payload(uid, user, membership, company_id, company):
    return {
        "id": str(uid), "userId": str(uid),
        "fullName": user.get("fullName", ""), "email": user.get("email", ""),
        "role": membership.get("role", ""), "department": membership.get("department", ""),
        "companyId": str(company_id), "companyName": company.get("companyName", ""),
        "status": membership.get("status", "ACTIVE"),
        "headDepartment": membership.get("headDepartment", ""),
    }


def identity_for_request(request):
    return {
        "uid": request.user.app_user.firebase_uid,
        "companyId": str(request.user.company.id),
        "user": {"fullName": request.user.app_user.full_name, "email": request.user.app_user.email},
        "company": {
            "companyName": request.user.company.company_name,
            "registeredBusinessName": request.user.company.registered_business_name,
            "gstin": request.user.company.gstin, "email": request.user.company.email,
            "phone": request.user.company.phone, "address": request.user.company.address,
            "country": request.user.company.country, "state": request.user.company.state,
            "pinCode": request.user.company.pin_code,
        },
        "membership": {
            "role": request.user.membership.role, "department": request.user.membership.department,
            "status": request.user.membership.status, "headDepartment": request.user.membership.head_department,
        },
    }


def company_response(company):
    value = dict(company or {})
    aliases = {
        "company_name": "companyName", "registered_business_name": "registeredBusinessName",
        "gstin": "gstin", "email": "email", "phone": "phone", "address": "address",
        "country": "country", "state": "state", "pin_code": "pinCode",
        "business_type": "businessType", "industry": "industry", "employees": "employees",
        "business_location": "businessLocation",
    }
    for snake, camel in aliases.items():
        if camel in value:
            value[snake] = value[camel]
    return clean(value)


@api_view(["GET"])
@authentication_classes([])
@permission_classes([permissions.AllowAny])
def firebase_config(request):
    configured, config = firebase_web_config_status()
    return Response({"configured": configured, "config": config if configured else {}})


class RegisterView(APIView):
    authentication_classes = []
    permission_classes = [permissions.AllowAny]

    def post(self, request):
        data = flatten_registration_payload(request.data)
        required = ["company_name", "registered_business_name", "owner_name", "email", "phone",
                    "address", "country", "state", "pin_code", "password", "confirm_password"]
        missing = [key for key in required if not str(data.get(key) or "").strip()]
        if missing:
            return Response({"error": "Required fields are missing.", "fields": {key: "This field is required." for key in missing}}, status=400)
        if not re.fullmatch(r"[^\s@]+@[^\s@]+\.[^\s@]+", str(data.get("email") or "").strip()):
            return Response({"error": "Enter a valid email address.", "fields": {"email": "Enter a valid email address."}}, status=400)
        try:
            company_email_matches = (get_db().collection("companies")
                                     .where("email", "==", str(data["email"]).strip().lower())
                                     .limit(1).stream())
            if next(iter(company_email_matches), None) is not None:
                return Response({"error": "A company is already registered with this email.", "fields": {"email": "This email is already registered."}}, status=409)
            if user_ref_by_email_exists(str(data["email"]).strip().lower()):
                return Response({"error": "An account with this email already exists.", "fields": {"email": "This email is already registered."}}, status=409)
        except FirestoreNotConfigured as exc:
            return Response({"error": str(exc)}, status=503)
        except Exception:
            logger.exception("Unable to perform company registration duplicate-email check")
            return Response({"error": "Unable to check registration availability right now."}, status=503)
        if data["password"] != data["confirm_password"]:
            return Response({"error": "Password and confirm password must match.", "fields": {"confirmPassword": "Passwords do not match."}}, status=400)
        if len(data["password"]) < 8:
            return Response({"error": "Password must contain at least 8 characters.", "fields": {"password": "Use at least 8 characters."}}, status=400)
        gstin = (data.get("gstin") or "").upper().strip()
        if gstin and not GSTIN_RE.match(gstin):
            return Response({"error": "Enter a valid GSTIN."}, status=400)
        if gstin:
            try:
                gstin_matches = (get_db().collection("companies")
                                 .where("gstin", "==", gstin).limit(1).stream())
                if next(iter(gstin_matches), None) is not None:
                    return Response({"error": "A company is already registered with this GSTIN.",
                                     "fields": {"gstin": "This GSTIN is already registered."}}, status=409)
            except FirestoreNotConfigured as exc:
                return Response({"error": str(exc)}, status=503)
            except Exception:
                logger.exception("Unable to perform GSTIN duplicate check")
                return Response({"error": "Unable to check GSTIN availability right now."}, status=503)
        email = data["email"].strip().lower()
        firebase_user = None
        company_id = str(uuid.uuid4())
        uid = None
        try:
            db = get_db()
            firebase_user = FirebaseAuthService.create_user(email, data["password"], data["owner_name"])
            uid = firebase_user.uid
            timestamp = now_iso()
            company = {
                "id": company_id, "companyName": data["company_name"].strip(),
                "registeredBusinessName": data["registered_business_name"].strip(),
                "gstin": gstin, "email": email, "phone": data["phone"].strip(),
                "address": data["address"].strip(), "country": data["country"].strip(),
                "state": data["state"].strip(), "pinCode": data["pin_code"].strip(),
                "businessType": data.get("business_type", ""), "industry": data.get("industry", ""),
                "employees": data.get("employees", ""), "businessLocation": data.get("business_location", ""),
                "requirements": data.get("requirements") or {}, "isActive": True,
                "createdAt": timestamp, "updatedAt": timestamp,
            }
            user = {"uid": uid, "fullName": data["owner_name"].strip(), "email": email,
                    "isActive": True, "companyId": company_id, "createdAt": timestamp, "updatedAt": timestamp}
            membership = {"uid": uid, "companyId": company_id, "role": Role.ADMIN,
                          "department": "Administration", "status": "ACTIVE", "headDepartment": "",
                          "isCompanyOwner": True, "permissions": ["*"], "createdAt": timestamp,
                          "updatedAt": timestamp}
            # Commit the related business records in one Firestore batch.
            batch = db.batch()
            if gstin:
                # The deterministic key closes the race between parallel
                # registrations that pass the advisory duplicate query.
                gstin_key = hashlib.sha256(gstin.encode("ascii")).hexdigest()
                batch.create(db.collection("registrationKeys").document(f"gstin-{gstin_key}"),
                             {"kind": "gstin", "value": gstin, "companyId": company_id,
                              "createdAt": timestamp})
            batch.set(company_ref(company_id), company)
            batch.set(user_ref(uid), user)
            batch.set(membership_ref(company_id, uid), membership)
            batch.commit()
            # Registration is durable at this point; the welcome email is
            # fire-and-forget so provider issues never affect the response.
            try:
                queue_welcome_email(data["owner_name"], email, company["companyName"])
            except Exception:
                # Queue/thread initialization is an email failure too. The
                # Firestore batch is already committed, so registration must
                # still return success and the account must remain usable.
                logger.exception("Welcome email could not be queued after successful registration")
            return Response({"success": True, "companyId": company_id,
                             "user": user_payload(uid, user, membership, company_id, company)},
                            status=201)
        except Exception as exc:
            if firebase_user:
                try:
                    # A Firestore batch is atomic. Its failure leaves no company
                    # or membership docs, so remove the unlinked Firebase account.
                    FirebaseAuthService.delete_user(firebase_user.uid)
                except Exception:
                    logger.exception("Could not roll back Firebase account after registration failure")
            return api_error(exc, "Registration failed safely. No company membership was committed.")

class LoginView(APIView):
    authentication_classes = []
    permission_classes = [permissions.AllowAny]

    def post(self, request):
        token = request.data.get("idToken")
        if not token:
            auth_header = request.headers.get("Authorization", "")
            scheme, separator, header_token = auth_header.partition(" ")
            if separator and scheme.casefold() == "bearer":
                token = header_token.strip()
        selected_role = normalize_role(request.data.get("role"))
        if not isinstance(token, str) or not token.strip() or not selected_role:
            return Response({"error": "A valid Firebase ID token and role are required."}, status=400)
        try:
            # Verify the Firebase ID token. The Admin SDK must use the same
            # Firebase project as the frontend Firebase app. Firebase exceptions
            # are logged without ever logging the token itself.
            claims = FirebaseAuthService.verify_id_token(token.strip())
        except FirebaseNotConfigured as exc:
            logger.exception("Firebase Admin is not configured")
            return Response({"error": str(exc)}, status=503)
        except Exception:
            # Keep the detailed exception in server logs, not in the API response.
            logger.exception("Firebase ID token verification failed during login")
            return Response(
                {"error": "Invalid or expired Firebase ID token."},
                status=401,
            )
       
            
        uid = claims.get("uid")
        if not uid:
            return Response({"error": "Firebase ID token is missing a user identity."}, status=401)
        try:
            identity = get_identity(uid)
        except FirestoreNotConfigured as exc:
            return Response({"error": str(exc)}, status=503)
        except Exception:
            logger.exception("Unable to load VyaparX identity after Firebase token verification for uid %s", uid)
            return Response({"error": "Unable to load your company membership."}, status=503)
        if not identity:
            return Response({"error": "No active VyaparX company membership found."}, status=403)
        actual_role = normalize_role(identity["membership"].get("role"))
        membership_status = identity["membership"].get("status", MembershipStatus.ACTIVE)
        if membership_status != MembershipStatus.ACTIVE:
            return Response({"error": "Your company membership is inactive."}, status=403)
        if actual_role != selected_role:
            return Response({"error": f"Your account is assigned to {actual_role}, not {selected_role}."}, status=403)
        dashboards = {
            Role.ADMIN: "admin.html", Role.CRM: "CRM.html", Role.SALES: "sales.html",
                Role.PURCHASE: "purchese.html", Role.INVENTORY: "inventory.html",
                Role.PRODUCTION: "producation.html", Role.QUALITY_CONTROL: "producation.html",
                Role.TRANSPORT: "transport.html", Role.EMPLOYEE_MANAGEMENT: "admin.html",
                Role.ACCOUNTING_FINANCE: "accounting.html",
        }
        return Response({"success": True, "user": user_payload(identity["uid"], identity["user"],
                        identity["membership"], identity["companyId"], identity["company"]),
                        "dashboardUrl": dashboards.get(actual_role, "loginpage.html")})


class MeView(APIView):
    def get(self, request):
        ident = identity_for_request(request)
        return Response({"user": user_payload(ident["uid"], ident["user"], ident["membership"],
                                              ident["companyId"], ident["company"])})


class AdminUsersView(APIView):
    def get_permissions(self):
        if self.request.method == "POST":
            return [IsCompanyAdmin()]
        return [permissions.IsAuthenticated()]

    def get(self, request):
        try:
            members = list_members(request.user.company.id)
            if request.user.membership.role != Role.ADMIN:
                members = [m for m in members if m.get("status") == "ACTIVE" and m.get("isActive", True)]
            return Response({"users": members})
        except Exception as exc:
            return api_error(exc, "Unable to load company users.")

    def post(self, request):
        data = request.data
        email = str(data.get("email") or "").strip().lower()
        password = str(data.get("password") or "")
        full_name = str(data.get("fullName") or data.get("name") or "").strip()
        role = normalize_role(data.get("role"))
        department = str(data.get("department") or role).strip()
        if not email or not full_name or len(password) < 8 or not role or role == Role.ADMIN:
            return Response({"error": "Provide a name, valid email, password of at least 8 characters, and a non-admin role."}, status=400)
        try:
            db = get_db()
            firebase_user = FirebaseAuthService.create_user(email, password, full_name)
            uid = firebase_user.uid
            timestamp = now_iso()
            company_id = str(request.user.company.id)
            user = {"uid": uid, "fullName": full_name, "email": email, "isActive": True,
                    "companyId": company_id, "createdAt": timestamp, "updatedAt": timestamp}
            membership = {"uid": uid, "companyId": company_id, "role": role, "department": department,
                          "status": "ACTIVE", "headDepartment": "", "isCompanyOwner": False,
                          "permissions": data.get("permissions") or [], "createdAt": timestamp, "updatedAt": timestamp}
            batch = db.batch()
            batch.set(user_ref(uid), user)
            batch.set(membership_ref(company_id, uid), membership)
            batch.commit()
            return Response({"success": True, "user": user_payload(uid, user, membership, company_id,
                            {"companyName": request.user.company.company_name})}, status=201)
        except Exception as exc:
            if "firebase_user" in locals():
                try: FirebaseAuthService.delete_user(firebase_user.uid)
                except Exception: logger.exception("Failed to roll back created Firebase user")
            return api_error(exc, "Could not create department user.")


class AdminUserDetailView(APIView):
    permission_classes = [IsCompanyAdmin]

    def put(self, request, user_id):
        try:
            company_id = str(request.user.company.id)
            ref = membership_ref(company_id, user_id)
            snap = ref.get()
            if not snap.exists:
                return Response({"error": "User not found in your company."}, status=404)
            membership = snap.to_dict() or {}
            user_snap = user_ref(user_id).get()
            user = user_snap.to_dict() or {}
            data = request.data
            if membership.get("isCompanyOwner") and data.get("status") == "INACTIVE":
                return Response({"error": "Cannot deactivate the primary company administrator."}, status=400)
            if str(user_id) == str(request.user.app_user.firebase_uid) and data.get("role") and normalize_role(data["role"]) != Role.ADMIN:
                return Response({"error": "You cannot change your own Admin role."}, status=400)
            updates = {"updatedAt": now_iso()}
            if "fullName" in data:
                name = str(data["fullName"]).strip()
                if not name: return Response({"error": "Name cannot be empty."}, status=400)
                user["fullName"] = name
                FirebaseAuthService.update_user(str(user_id), display_name=name)
                user["updatedAt"] = now_iso()
                user_ref(user_id).set(user, merge=True)
            if "role" in data:
                role = normalize_role(data["role"])
                if not role: return Response({"error": "Invalid role."}, status=400)
                updates["role"] = role
                updates["headDepartment"] = ""
            if "department" in data:
                updates["department"] = str(data["department"]).strip()
                if membership.get("headDepartment") and membership.get("headDepartment") != updates["department"]:
                    updates["headDepartment"] = ""
            if "status" in data:
                if data["status"] not in ("ACTIVE", "INACTIVE"):
                    return Response({"error": "Invalid status."}, status=400)
                updates["status"] = data["status"]
                if data["status"] != "ACTIVE": updates["headDepartment"] = ""
                user["isActive"] = data["status"] == "ACTIVE"
                user["updatedAt"] = now_iso()
                user_ref(user_id).set(user, merge=True)
            ref.set(updates, merge=True)
            if data.get("password"):
                if len(data["password"]) < 8: return Response({"error": "Password must be at least 8 characters."}, status=400)
                FirebaseAuthService.update_user(str(user_id), password=data["password"])
            updated = {**membership, **updates}
            return Response({"success": True, "user": user_payload(user_id, user, updated, company_id,
                            {"companyName": request.user.company.company_name})})
        except Exception as exc:
            return api_error(exc, "Could not update user.")


class CompanyProfileView(APIView):
    def get(self, request):
        company_id = str(request.user.company.id)
        try:
            snap = company_ref(company_id).get()
            if not snap.exists:
                return Response({"error": "Company profile not found."}, status=404)
            return Response({"company": company_response(snap.to_dict() or {})})
        except Exception as exc:
            return api_error(exc, "Unable to load company profile.")

    def put(self, request):
        if request.user.membership.role != Role.ADMIN:
            return Response({"error": "Only company Admins can update company details."}, status=403)
        aliases = {
            "company_name": "companyName", "registered_business_name": "registeredBusinessName",
            "pin_code": "pinCode", "business_type": "businessType", "business_location": "businessLocation",
        }
        normalized = {aliases.get(k, k): v for k, v in request.data.items()}
        allowed = {"companyName", "registeredBusinessName", "gstin", "email", "phone", "address",
                   "country", "state", "pinCode", "businessType", "industry", "employees", "businessLocation"}
        data = {k: v for k, v in normalized.items() if k in allowed}
        if "gstin" in data and data["gstin"]:
            data["gstin"] = str(data["gstin"]).upper().strip()
            if not GSTIN_RE.match(data["gstin"]):
                return Response({"error": "Enter a valid GSTIN."}, status=400)
        data["updatedAt"] = now_iso()
        try:
            company_ref(request.user.company.id).set(data, merge=True)
            # set(merge=True) already produced the merged document server-side;
            # composing the response from the request payload avoids a
            # redundant Firestore read round-trip. Fields not present in the
            # update remain unchanged in Firestore and in the client cache.
            company = company_response(data)
            return Response({"success": True, "company": company})
        except Exception as exc:
            return api_error(exc, "Could not save company profile.")


class DepartmentHeadView(APIView):
    permission_classes = [IsCompanyAdmin]

    def get_permissions(self):
        if self.request.method == "GET":
            return [permissions.IsAuthenticated()]
        return [IsCompanyAdmin()]

    def get(self, request):
        try:
            return Response({"heads": [m for m in list_members(request.user.company.id) if m.get("headDepartment")]})
        except Exception as exc:
            return api_error(exc, "Unable to load department heads.")

    def post(self, request):
        department = str(request.data.get("department") or "").strip()
        uid = str(request.data.get("userId") or request.data.get("user_id") or request.data.get("membershipId") or "").strip()
        if not department or not uid:
            return Response({"error": "Department and userId are required."}, status=400)
        try:
            company_id = str(request.user.company.id)
            member_ref = membership_ref(company_id, uid)
            snap = member_ref.get()
            if not snap.exists:
                return Response({"error": "User is not a member of this company."}, status=404)
            member = snap.to_dict() or {}
            if member.get("status") != "ACTIVE":
                return Response({"error": "Inactive users cannot be department heads."}, status=400)
            batch = get_db().batch()
            for old in list_members(company_id):
                if old.get("headDepartment") == department and old.get("id") != uid:
                    batch.set(membership_ref(company_id, old["id"]), {"headDepartment": "", "updatedAt": now_iso()}, merge=True)
            batch.set(member_ref, {"headDepartment": department, "department": department, "updatedAt": now_iso()}, merge=True)
            batch.commit()
            user = user_ref(uid).get().to_dict() or {}
            return Response({"success": True, "head": {"department": department, "userId": uid,
                            "fullName": user.get("fullName", ""), "email": user.get("email", "")}})
        except Exception as exc:
            return api_error(exc, "Could not assign department head.")


class TaskListView(APIView):
    """Company task inbox with server-enforced department and user visibility."""

    _DEPARTMENT_ALIASES = {
        "admin": "Administration",
        "administrator": "Administration",
        "administration": "Administration",
        "crm": "CRM",
        "sales": "Sales Order",
        "sales order": "Sales Order",
        "purchase": "Purchase & Trading",
        "purchese": "Purchase & Trading",
        "purchase & trading": "Purchase & Trading",
        "inventory": "Inventory",
        "production": "Production",
        "producation": "Production",
        "quality control": "Production",
        "qc": "Production",
        "transport": "Transport",
        "accounting": "Accounting",
        "finance": "Accounting",
        "accounting & finance": "Accounting",
        "employee management": "Administration",
        "hr": "Administration",
    }
    _TASK_TYPES = {"Task", "Communication", "Announcement", "Reminder"}
    _TASK_PRIORITIES = {"Low", "Medium", "High", "Urgent"}
    _TASK_STATUSES = {"Pending", "In Progress", "Completed", "Overdue", "Cancelled"}
    _TASK_DEPARTMENTS = {
        "CRM", "Sales Order", "Purchase & Trading", "Inventory",
        "Production", "Transport", "Accounting",
    }

    @classmethod
    def _department(cls, value):
        return cls._DEPARTMENT_ALIASES.get(str(value or "").strip().casefold(), str(value or "").strip())

    def _can_view(self, request, task):
        """An Admin has oversight; everyone else sees sent or addressed work."""
        if request.user.membership.role == Role.ADMIN:
            return True
        current_department = self._department(request.user.membership.department) or self._department(request.user.membership.role)
        target_department = self._department(task.get("department")) or self._department(task.get("td")) or self._department(task.get("targetDepartment"))
        sender_department = self._department(task.get("createdDepartment")) or self._department(task.get("fd"))

        user_uid = str(request.user.app_user.firebase_uid)
        user_name = str(request.user.app_user.full_name or "").strip().lower()
        user_email = str(request.user.app_user.email or "").strip().lower()

        is_sender = (
            str(task.get("createdBy") or "") == user_uid
            or (user_name and str(task.get("from") or "").strip().lower() == user_name)
            or (user_name and str(task.get("createdByName") or "").strip().lower() == user_name)
            or (sender_department and current_department and sender_department == current_department)
        )
        is_receiver = (
            (target_department and current_department and target_department == current_department)
            or (user_uid and str(task.get("assignedToId") or "") == user_uid)
            or (user_name and str(task.get("assignedTo") or "").strip().lower() == user_name)
            or (user_name and str(task.get("to") or "").strip().lower() == user_name)
            or (user_email and str(task.get("assignedToEmail") or "").strip().lower() == user_email)
        )
        return bool(is_sender or is_receiver)

    def get(self, request):
        try:
            tasks = list_collection(request.user.company.id, "tasks")
            user_uid = str(request.user.app_user.firebase_uid)
            user_name = str(request.user.app_user.full_name or "").strip().lower()
            current_department = self._department(request.user.membership.department) or self._department(request.user.membership.role)
            visible = []
            for task in tasks:
                if task.get("isDeleted", False):
                    continue
                if self._can_view(request, task):
                    t = dict(task)
                    is_sender = (
                        str(t.get("createdBy") or "") == user_uid
                        or (user_name and str(t.get("from") or "").strip().lower() == user_name)
                        or self._department(t.get("createdDepartment") or t.get("fd")) == current_department
                    )
                    t["dir"] = "Sent" if is_sender else "Received"
                    visible.append(t)
            return Response({"tasks": visible})
        except Exception as exc:
            return api_error(exc, "Unable to load tasks.")

    def post(self, request):
        data = request.data
        title = str(data.get("title") or data.get("s") or data.get("subj") or data.get("subject") or "").strip()
        if not title:
            return Response({"error": "Task title is required."}, status=400)

        raw_dept = data.get("department") or data.get("td") or data.get("dept") or data.get("targetDepartment") or ""
        department = self._department(raw_dept)
        # Tasks are routed to known operational departments, never to an
        # arbitrary client supplied label or an individual employee.
        if department not in self._TASK_DEPARTMENTS:
            return Response({"error": "Choose a valid recipient department."}, status=400)

        task_type = str(data.get("type") or (data.get("subj") is not None and "Communication") or "Task").strip()
        priority = str(data.get("priority") or data.get("p") or "Medium").strip()
        description = str(data.get("description") or data.get("desc") or data.get("message") or data.get("msg") or "").strip()
        due_date = data.get("dueDate") or data.get("due")
        if task_type not in self._TASK_TYPES:
            return Response({"error": "Unsupported task type."}, status=400)
        if priority not in self._TASK_PRIORITIES:
            return Response({"error": "Unsupported task priority."}, status=400)
        if not description:
            return Response({"error": "A task description is required."}, status=400)
        if task_type == "Task" and not due_date:
            return Response({"error": "A due date is required for a task."}, status=400)
        if task_type == "Task":
            try:
                date.fromisoformat(str(due_date))
            except (TypeError, ValueError):
                return Response({"error": "Enter a valid task due date."}, status=400)

        task_id = str(data.get("id") or uuid.uuid4()).strip()
        if not task_id or len(task_id) > 128 or "/" in task_id:
            return Response({"error": "Invalid task ID."}, status=400)
        created_dept = self._department(request.user.membership.department) or self._department(request.user.membership.role) or "Administration"
        if created_dept == department:
            return Response({"error": "Choose a different recipient department."}, status=400)
        sender_name = str(request.user.app_user.full_name or "Admin").strip()
        now_ts = now_iso()
        today_date = now_ts[:10]
        history = data.get("hist") or data.get("history") or [[today_date, f"{task_type} created"]]
        attachments = data.get("att") or data.get("attachments") or []

        status_val = str(data.get("status") or data.get("st") or "Pending").strip()
        if status_val.casefold() not in {value.casefold() for value in self._TASK_STATUSES}:
            return Response({"error": "Unsupported task status."}, status=400)
        status_val = next(value for value in self._TASK_STATUSES if value.casefold() == status_val.casefold())
        payload = {
            "id": task_id,
            "department": department,
            "td": department,
            "title": title,
            "s": title,
            "subj": title,
            "description": description,
            "desc": description,
            "msg": description,
            "type": task_type,
            "priority": priority,
            "p": priority,
            "dueDate": due_date,
            "due": due_date,
            "status": status_val,
            "st": status_val,
            "isRead": False,
            "read": False,
            "isDeleted": False,
            "to": department,
            "assignedTo": department,
            "assignedToId": "",
            "from": sender_name,
            "createdByName": sender_name,
            "createdBy": request.user.app_user.firebase_uid,
            "fd": created_dept,
            "createdDepartment": created_dept,
            "att": attachments,
            "attachments": attachments,
            "hist": history,
            "history": history,
            "comments": data.get("comments") or [],
            "ca": today_date,
            "createdAt": now_ts,
            "updatedAt": now_ts,
        }
        try:
            task_ref = tasks_ref(request.user.company.id).document(task_id)
            # Firestore create is atomic and cannot overwrite an existing task.
            # A retry with the same ID and payload returns the persisted result.
            try:
                task_ref.create(payload)
                record = clean(payload)
            except Exception:
                existing_snap = task_ref.get()
                if not existing_snap.exists:
                    raise
                existing = existing_snap.to_dict() or {}
                same_request = (
                    str(existing.get("createdBy") or "") == str(request.user.app_user.firebase_uid)
                    and str(existing.get("title") or "") == title
                    and str(existing.get("department") or "") == department
                    and str(existing.get("description") or "") == description
                    and str(existing.get("type") or "Task") == task_type
                    and str(existing.get("priority") or "Medium") == priority
                    and str(existing.get("dueDate") or "") == str(due_date or "")
                )
                if not same_request:
                    return Response({"error": "That task ID is already in use."}, status=409)
                return Response({"success": True, "id": task_id,
                                 "task": clean({**existing, "id": task_id})}, status=200)
            notification = {
                "title": f"New task: {title}",
                "message": f"{sender_name} ({created_dept}) assigned a task to {department}.",
                "severity": "info", "module": "tasks", "recordId": task_id,
                "recipientDepartment": department, "senderDepartment": created_dept,
                "priority": priority, "dueDate": due_date, "status": status_val,
                "isRead": False, "isDismissed": False, "createdAt": now_ts,
                "emailDelivery": "queued",
            }
            try:
                alerts_ref(request.user.company.id).document(f"task-{task_id}").create(notification)
            except Exception:
                # The task is already durable; don't report persistence failure
                # because a secondary notification write failed.
                logger.exception("Task saved but in-app notification could not be created (task %s)", task_id)
            if task_type == "Task":
                try:
                    _TASK_EMAIL_EXECUTOR.submit(
                        _send_task_assignment_email,
                        str(request.user.company.id), task_id, payload, department,
                    )
                except Exception:
                    logger.exception("Task saved but email delivery could not be queued (task %s)", task_id)
            return Response({"success": True, "id": task_id, "task": record}, status=201)
        except Exception as exc:
            return api_error(exc, "Could not save task.")


def _send_task_assignment_email(company_id, task_id, task, department):
    """Send one task email to the configured department head(s), off-request."""
    from .task_notifications import send_task_assignment_email

    try:
        recipients = []
        matching_heads = []
        for member in list_members(company_id):
            if (TaskListView._department(member.get("headDepartment")) == department
                    and member.get("status") == "ACTIVE"
                    and member.get("isActive", True)):
                matching_heads.append(member)

        # Membership is the company-scoped authorization source. Read each
        # selected user's registered account email and prefer it over any
        # stale denormalized email stored on the membership document.
        for member in matching_heads:
            uid = str(member.get("id") or "")
            account = user_ref(uid).get() if uid else None
            if not account or not account.exists:
                continue
            user = account.to_dict() or {}
            if str(user.get("companyId") or "") != str(company_id):
                logger.warning("Skipping department head with mismatched company membership (task %s)", task_id)
                continue
            if user.get("isActive", True) is False:
                continue
            email = str(user.get("email") or member.get("email") or "").strip()
            if email:
                recipients.append({"email": email, "name": user.get("fullName") or member.get("fullName", "")})

        if not matching_heads:
            delivery = {"status": "no_department_head"}
        elif not recipients:
            delivery = {"status": "missing_recipient_email"}
        else:
            delivery = send_task_assignment_email(task, recipients)
    except Exception:
        logger.exception("Task email processing failed (task %s)", task_id)
        delivery = {"status": "failed", "errorCode": "recipient_lookup_failed"}
    try:
        timestamp = now_iso()
        tasks_ref(company_id).document(task_id).set(
            {"emailDelivery": delivery, "updatedAt": timestamp}, merge=True,
        )
        alerts_ref(company_id).document(f"task-{task_id}").set(
            {"emailDelivery": delivery, "updatedAt": timestamp}, merge=True,
        )
    except Exception:
        logger.exception("Could not store task email delivery result (task %s)", task_id)


class TaskDetailView(TaskListView):
    def patch(self, request, task_id):
        try:
            ref = tasks_ref(request.user.company.id).document(str(task_id))
            snap = ref.get()
            if not snap.exists:
                return Response({"error": "Task not found."}, status=404)
            current = snap.to_dict() or {}
            if current.get("isDeleted"):
                return Response({"error": "Task is archived."}, status=410)
            if not self._can_view(request, current):
                return Response({"error": "You cannot access this task."}, status=403)

            is_creator = (
                str(current.get("createdBy") or "") == str(request.user.app_user.firebase_uid)
                or str(current.get("from") or "").strip().lower() == str(request.user.app_user.full_name or "").strip().lower()
            )
            is_admin = request.user.membership.role == Role.ADMIN
            current_dept = self._department(request.user.membership.department) or self._department(request.user.membership.role)
            target_dept = self._department(current.get("department")) or self._department(current.get("td"))
            is_receiver = (
                (target_dept and target_dept == current_dept)
                or str(current.get("to") or "").strip().lower() == str(request.user.app_user.full_name or "").strip().lower()
                or str(current.get("assignedTo") or "").strip().lower() == str(request.user.app_user.full_name or "").strip().lower()
            )

            updates = {}
            new_status = request.data.get("status") or request.data.get("st")
            if new_status:
                norm_status = str(new_status).strip()
                aliases = {"in_progress": "In Progress", "done": "Completed"}
                norm_status = aliases.get(norm_status.casefold(), norm_status)
                normalized = next((value for value in self._TASK_STATUSES
                                   if value.casefold() == norm_status.casefold()), None)
                if not normalized:
                    return Response({"error": "Unsupported task status."}, status=400)
                norm_status = normalized
                updates["status"] = norm_status
                updates["st"] = norm_status
                hist = list(current.get("hist") or current.get("history") or [])
                today_date = now_iso()[:10]
                hist.append([today_date, f"Status changed to {norm_status} by {request.user.app_user.full_name}"])
                updates["hist"] = hist
                updates["history"] = hist
                updates["ua"] = today_date

            comment_text = str(request.data.get("comment") or "").strip()
            if comment_text:
                comments = list(current.get("comments") or [])
                comments.append({
                    "id": str(uuid.uuid4()),
                    "from": request.user.app_user.full_name,
                    "dept": current_dept,
                    "message": comment_text,
                    "createdAt": now_iso()
                })
                updates["comments"] = comments
                hist = list(updates.get("hist") or current.get("hist") or [])
                hist.append([now_iso()[:10], f"Communication from {request.user.app_user.full_name}: {comment_text[:40]}"])
                updates["hist"] = hist
                updates["history"] = hist

            if "isRead" in request.data or "read" in request.data:
                val = bool(request.data.get("isRead") if "isRead" in request.data else request.data.get("read"))
                updates["isRead"] = val
                updates["read"] = val

            if is_creator or is_admin or is_receiver:
                for k in ("priority", "dueDate", "description", "title", "att"):
                    if k in request.data:
                        updates[k] = request.data[k]
                if "p" in request.data: updates["p"] = request.data["p"]; updates["priority"] = request.data["p"]
                if "due" in request.data: updates["due"] = request.data["due"]; updates["dueDate"] = request.data["due"]
                if "desc" in request.data: updates["desc"] = request.data["desc"]; updates["description"] = request.data["desc"]
                if "s" in request.data: updates["s"] = request.data["s"]; updates["title"] = request.data["s"]
                if "attachments" in request.data: updates["attachments"] = request.data["attachments"]; updates["att"] = request.data["attachments"]

            if not updates:
                return Response({"error": "No valid task updates provided."}, status=400)

            updates["updatedAt"] = now_iso()
            updates["updatedBy"] = request.user.app_user.firebase_uid
            ref.set(updates, merge=True)
            return Response({"success": True, "task": clean({**current, **updates, "id": str(task_id)})})
        except Exception as exc:
            return api_error(exc, "Could not update task.")

    def delete(self, request, task_id):
        try:
            ref = tasks_ref(request.user.company.id).document(str(task_id))
            snap = ref.get()
            if not snap.exists: return Response({"error": "Task not found."}, status=404)
            task = snap.to_dict() or {}
            task_st = str(task.get("status") or task.get("st") or "").lower()
            if task_st not in ("completed", "complete", "done"):
                return Response({"error": "Only completed tasks can be deleted."}, status=400)
            is_creator = (
                str(task.get("createdBy") or "") == str(request.user.app_user.firebase_uid)
                or str(task.get("from") or "").strip().lower() == str(request.user.app_user.full_name or "").strip().lower()
            )
            if request.user.membership.role != Role.ADMIN and not is_creator:
                return Response({"error": "You are not allowed to delete this task."}, status=403)
            ref.set({"isDeleted": True, "deletedAt": now_iso(), "deletedBy": request.user.app_user.firebase_uid}, merge=True)
            return Response({"success": True, "deleted": True})
        except Exception as exc:
            return api_error(exc, "Could not delete task.")


class AlertListView(APIView):
    def get(self, request, alert_id=None):
        try:
            alerts = list_collection(request.user.company.id, "alerts")
            if request.user.membership.role != Role.ADMIN:
                department = TaskListView._department(request.user.membership.department) or TaskListView._department(request.user.membership.role)
                uid = str(request.user.app_user.firebase_uid)
                alerts = [alert for alert in alerts
                          if not alert.get("recipientDepartment")
                          or TaskListView._department(alert.get("recipientDepartment")) == department
                          or str(alert.get("recipientUserId") or "") == uid]
            if alert_id:
                alerts = [a for a in alerts if a.get("id") == str(alert_id)]
            return Response({"alerts": alerts})
        except Exception as exc:
            return api_error(exc, "Unable to load alerts.")

    def patch(self, request, alert_id=None):
        if not alert_id:
            return Response({"error": "Alert id is required."}, status=400)
        try:
            ref = alerts_ref(request.user.company.id).document(str(alert_id))
            snap = ref.get()
            if not snap.exists:
                return Response({"error": "Alert not found."}, status=404)
            alert = snap.to_dict() or {}
            if request.user.membership.role != Role.ADMIN and alert.get("recipientDepartment"):
                department = TaskListView._department(request.user.membership.department) or TaskListView._department(request.user.membership.role)
                if (TaskListView._department(alert.get("recipientDepartment")) != department
                        and str(alert.get("recipientUserId") or "") != str(request.user.app_user.firebase_uid)):
                    return Response({"error": "You cannot access this alert."}, status=403)
            updates = {"isRead": bool(request.data.get("isRead", True)), "updatedAt": now_iso()}
            if request.data.get("dismiss"):
                updates["isDismissed"] = True
                updates["dismissedAt"] = now_iso()
            ref.set(updates, merge=True)
            return Response({"success": True, "alert": clean({**(snap.to_dict() or {}), **updates, "id": str(alert_id)})})
        except Exception as exc:
            return api_error(exc, "Could not update alert.")

    def post(self, request, alert_id=None):
        if not alert_id:
            data = request.data
            alert_id = str(data.get("id") or uuid.uuid4())
            payload = {"title": str(data.get("title") or "ERP alert"), "message": str(data.get("message") or ""),
                       "severity": data.get("severity") or "info", "module": data.get("module") or "general",
                       "isRead": False, "recordId": data.get("recordId")}
        else:
            payload = {"isRead": bool(request.data.get("isRead", True)), "updatedAt": now_iso()}
        try:
            saved = save_collection_record(request.user.company.id, "alerts", alert_id, payload)
            return Response({"success": True, "alert": saved})
        except Exception as exc:
            return api_error(exc, "Could not save alert.")


def next_production_request_code(company_id):
    """Return the next company-scoped PRD-### code for a production request.

    The counter lives in the same document as the request, written before the
    request itself, so a concurrent retry reuses the reserved code instead of
    duplicating it. Codes are never reused because the counter only increases.
    """
    counter_ref = (module_counter_ref(company_id, "production", "productionRequest"))

    def _reserve(transaction):
        # Reads inside a Firestore transaction run on the transaction object.
        snapshot = _transaction_document(transaction, counter_ref)
        current = int((snapshot.to_dict() or {}).get("value") or 0) if snapshot.exists else 0
        for request_snapshot in module_records_ref(company_id, "production").where("recordType", "==", "productionRequest").stream():
            record = request_snapshot.to_dict() or {}
            match = re.fullmatch(r"PRD-(\d+)", str(record.get("requestCode") or ""), re.IGNORECASE)
            if match:
                current = max(current, int(match.group(1)))
        next_value = current + 1
        transaction.set(counter_ref, {"value": next_value, "updatedAt": now_iso()}, merge=True)
        return f"PRD-{next_value:03d}"

    try:
        db = get_db()
        transaction = db.transaction()

        @firestore.transactional
        def reserve_code(txn):
            return _reserve(txn)
        return reserve_code(transaction)
    except Exception:
        # Without a working transaction, reserve the code from the record IDs
        # that are already persisted and let the create-time uniqueness check
        # below reject any race instead of issuing a duplicate code.
        logger.exception("Production request counter transaction failed; using scan fallback")
        highest = 0
        for request_snapshot in module_records_ref(company_id, "production").where("recordType", "==", "productionRequest").stream():
            record = request_snapshot.to_dict() or {}
            match = re.fullmatch(r"PRD-(\d+)", str(record.get("requestCode") or ""), re.IGNORECASE)
            if match:
                highest = max(highest, int(match.group(1)))
        return f"PRD-{highest + 1:03d}"


def _next_company_number(company_id, module, counter_name, prefix, record_type, field):
    """Reserve a company-scoped, gap-tolerant display number in Firestore."""
    counter_ref = (module_counter_ref(company_id, module, counter_name))

    def reserve(txn):
        snapshot = _transaction_document(txn, counter_ref)
        current = int((snapshot.to_dict() or {}).get("value") or 0) if snapshot.exists else 0
        for record in list_module_records(company_id, module):
            if record.get("recordType") != record_type:
                continue
            candidates = [record.get(field), record.get("id")]
            for candidate in candidates:
                match = re.fullmatch(rf"{re.escape(prefix)}-(\d+)", str(candidate or ""), re.IGNORECASE)
                if match:
                    current = max(current, int(match.group(1)))
        value = current + 1
        txn.set(counter_ref, {"value": value, "updatedAt": now_iso()}, merge=True)
        return f"{prefix}-{value:03d}"

    return firestore.transactional(reserve)(get_db().transaction())


def _accounting_company_snapshot(company):
    return {
        "companyName": str(getattr(company, "company_name", "") or ""),
        "registeredBusinessName": str(getattr(company, "registered_business_name", "") or ""),
        "gstin": str(getattr(company, "gstin", "") or ""),
        "address": str(getattr(company, "address", "") or ""),
        "country": str(getattr(company, "country", "") or ""),
        "state": str(getattr(company, "state", "") or ""),
        "pinCode": str(getattr(company, "pin_code", "") or ""),
        "phone": str(getattr(company, "phone", "") or ""),
        "email": str(getattr(company, "email", "") or ""),
    }


def _accounting_voucher_prefix(voucher_type, on_date):
    fiscal_start = on_date.year if on_date.month >= 4 else on_date.year - 1
    return f"{voucher_type}{fiscal_start % 100:02d}-{(fiscal_start + 1) % 100:02d}"


def next_material_request_number(company_id):
    # Count legacy MR numbers too so a migration to the MP display prefix cannot
    # accidentally reuse a number that users have already seen.
    counter_ref = module_counter_ref(company_id, "production", "materialRequest")

    def reserve(txn):
        snapshot = _transaction_document(txn, counter_ref)
        current = int((snapshot.to_dict() or {}).get("value") or 0) if snapshot.exists else 0
        for record in list_module_records(company_id, "production"):
            if record.get("recordType") != "materialPlan":
                continue
            for candidate in (record.get("materialRequestNo"), record.get("id")):
                match = re.fullmatch(r"(?:MP|MR)-(\d+)", str(candidate or ""), re.IGNORECASE)
                if match:
                    current = max(current, int(match.group(1)))
        value = current + 1
        txn.set(counter_ref, {"value": value, "updatedAt": now_iso()}, merge=True)
        return f"MP-{value:03d}"

    return firestore.transactional(reserve)(get_db().transaction())


def next_crm_number(company_id):
    return _next_company_number(company_id, "crm", "lead", "CRM", "lead", "crmNo")


def _transaction_document(transaction, document_ref):
    """Return a single snapshot across Firestore client versions.

    Firestore Transaction.get(DocumentReference) yields a generator in the
    supported Python client, while our test adapter and some older clients
    return the snapshot directly.
    """
    result = transaction.get(document_ref)
    if hasattr(result, "exists"):
        return result
    return next(iter(result), None)


def _normalize_purchase_order_history(data):
    """Convert legacy [date, text] history pairs to Firestore-safe event maps."""
    history = data.get("hist")
    if not isinstance(history, list):
        return
    data["hist"] = [
        ({"0": str(event[0]) if event else "", "1": str(event[1]) if len(event) > 1 else "",
          "date": str(event[0]) if event else "", "action": str(event[1]) if len(event) > 1 else ""}
         if isinstance(event, (list, tuple)) else event)
        for event in history
    ]


class SalesAccountingRequestsView(APIView):
    """Company-scoped Accounting review and idempotent Production release."""

    def get(self, request, request_id=None, action=None):
        if not user_can_access_module(request.user, "accounting"):
            return Response({"error": "Accounting access required."}, status=403)
        rows = [row for row in list_module_records(request.user.company.id, "accounting")
                if row.get("recordType") == "salesAccountingRequest" and not row.get("isDeleted")]
        return Response({"records": rows})

    def post(self, request, request_id, action):
        workflow_started_at = perf_counter()
        if not user_can_access_module(request.user, "accounting"):
            logger.warning("Sales Accounting Request %s: access denied for user %s", request_id, getattr(request.user, "username", "unknown"))
            return Response({"error": "Accounting access required."}, status=403)
        action = str(action or "").lower()
        if action not in {"approve", "reject", "return", "cancel", "receipt"}:
            return Response({"error": "Unsupported Accounting action."}, status=400)
        if action == "receipt":
            return self._record_sales_receipt(request, request_id)
        reason = str(request.data.get("reason") or "").strip()[:1000]
        if action in {"reject", "return", "cancel"} and not reason:
            return Response({"error": "A reason is required."}, status=400)
        company_id = request.user.company.id
        req_ref = module_records_ref(company_id, "accounting").document(str(request_id))
        snap = req_ref.get()
        record = snap.to_dict() or {} if snap.exists else {}

        # Fallback lookup if not found directly by ID
        if not snap.exists or record.get("recordType") != "salesAccountingRequest":
            accounting_records = module_records_ref(company_id, "accounting")
            found = None
            for candidate_id in dict.fromkeys((str(request_id), f"SAR-{request_id}")):
                candidates = accounting_records.where("id", "==", candidate_id).limit(2).stream()
                for candidate in candidates:
                    candidate_data = candidate.to_dict() or {}
                    if candidate_data.get("recordType") == "salesAccountingRequest" and not candidate_data.get("isDeleted"):
                        found = {**candidate_data, "id": candidate.id}
                        break
                if found is not None:
                    break
            if found:
                record = found
                req_ref = module_records_ref(company_id, "accounting").document(str(record.get("id")))
            else:
                logger.warning("Sales Accounting Request not found for ID %s in company %s", request_id, company_id)
                return Response({"error": "Sales Accounting Request not found."}, status=404)

        current_approval = str(record.get("approvalStatus") or "").strip()
        current_approval_norm = current_approval.lower()

        # Idempotent approval check: if already approved, return success with 200 OK
        if action == "approve" and current_approval_norm in {"approved", "released"}:
            logger.info("Sales Accounting Request %s is already approved for company %s. Returning cached approved record.", request_id, company_id)
            return Response({"success": True, "record": clean(record), "message": "Already approved."})

        # Validate that request is eligible for review/decision
        if current_approval_norm not in {"pending", "returned", "rejected", "submitted", "under review", "under_review", "new", ""}:
            logger.warning("Sales Accounting Request %s: 409 Conflict - approvalStatus '%s' is not awaiting review.", request_id, current_approval)
            return Response({"error": f"This request is currently in status '{current_approval}' and is not awaiting review."}, status=409)

        if action == "cancel" and current_approval_norm not in {"pending", "submitted", "under review", "under_review", "new", ""}:
            logger.warning("Sales Accounting Request %s: 409 Conflict - cannot cancel request with status '%s'.", request_id, current_approval)
            return Response({"error": "Only a pending Sales Request can be cancelled."}, status=409)

        actor = str(request.user.app_user.firebase_uid)
        now = now_iso()
        history = list(record.get("history") or [])
        status_value = {"approve": "Approved", "reject": "Rejected", "return": "Returned", "cancel": "Cancelled"}[action]
        history.append({"at": now, "actorId": actor, "actorName": request.user.app_user.full_name or "", "action": status_value, "reason": reason})
        updates = {"approvalStatus": status_value, "updatedAt": now, "history": history}
        if action == "approve":
            updates.update({"approvedAt": now, "approvedBy": actor})
        else:
            updates.update({"decisionReason": reason, "decidedAt": now, "decidedBy": actor})

        # Safely resolve linked Sales Order ID with fallbacks
        order_id = str(record.get("salesOrderId") or record.get("orderId") or "").strip()
        if not order_id and str(request_id).startswith("SAR-"):
            order_id = str(request_id)[4:].strip()
        if not order_id:
            order_id = str(record.get("salesOrderNumber") or "").strip()

        order_ref = module_records_ref(company_id, "sales").document(order_id)
        order_snap = order_ref.get()
        order = order_snap.to_dict() or {} if order_snap.exists else {}

        # Fallback search if order document not found directly by order_id
        if not order_snap.exists:
            sales_records = module_records_ref(company_id, "sales")
            candidates_by_id = {}
            for candidate_id in dict.fromkeys((order_id, str(record.get("salesOrderNumber") or ""))):
                if not candidate_id:
                    continue
                for field in ("id", "orderNumber"):
                    for candidate in sales_records.where(field, "==", candidate_id).limit(2).stream():
                        candidates_by_id[candidate.id] = candidate
            found_order = next(({**(candidate.to_dict() or {}), "id": candidate.id} for candidate in candidates_by_id.values()
                                if not (candidate.to_dict() or {}).get("isDeleted")
                                and (candidate.to_dict() or {}).get("recordType", "").lower() in {"", "salesorder", "order", "sales_order"}), None)
            if found_order:
                order = found_order
                order_id = str(order.get("id") or "")
                order_ref = module_records_ref(company_id, "sales").document(order_id)
                order_snap = order_ref.get()

        order_rec_type = str(order.get("recordType") or "").lower()
        if not order_snap.exists or order.get("isDeleted") or (order_rec_type and order_rec_type not in {"salesorder", "order", "sales_order"}):
            logger.warning("Sales Accounting Request %s: 409 Conflict - linked Sales Order '%s' is unavailable (exists=%s, isDeleted=%s, recordType=%s)",
                           request_id, order_id, order_snap.exists, order.get("isDeleted"), order.get("recordType"))
            return Response({"error": "The linked Sales Order is unavailable."}, status=409)

        batch = get_db().batch()
        batch.update(req_ref, updates)

        if action == "approve":
            current_status = str(order.get("status") or order.get("st") or "").strip().upper().replace(" ", "_")
            if current_status in {"CANCELLED", "CANCELED"}:
                logger.warning("Sales Accounting Request %s: 409 Conflict - linked Sales Order %s is cancelled.", request_id, order_id)
                return Response({"error": "The linked Sales Order is cancelled and cannot be approved."}, status=409)

            order_updates = {"accountingApprovalStatus": "Approved", "accountingApprovedAt": now, "accountingApprovedBy": actor}

            # If order has already reached confirmation or downstream stages, retain status.
            # Otherwise transition based on whether required advance has been received.
            if current_status in {"CONFIRMED", "ADVANCE_PENDING", "IN_PRODUCTION", "READY", "READY_FOR_TRANSPORT", "DISPATCHED", "DELIVERED", "COMPLETED"}:
                pass
            else:
                try:
                    required_advance = Decimal(str(record.get("requiredAdvance") or order.get("requiredAdvance") or 0))
                except (InvalidOperation, TypeError):
                    required_advance = Decimal("0")
                try:
                    amount_received = Decimal(str(record.get("amountReceived") or order.get("received") or order.get("amountReceived") or 0))
                except (InvalidOperation, TypeError):
                    amount_received = Decimal("0")

                new_status = "ADVANCE_PENDING" if (required_advance > Decimal("0") and amount_received < required_advance) else "CONFIRMED"
                order_updates["status"] = new_status
                order_updates["st"] = new_status

            batch.update(order_ref, order_updates)

            # Check for existing production request (idempotent release)
            existing_prod = None
            existing_prod_id = str(record.get("productionRequestId") or "").strip()
            if existing_prod_id:
                p_ref = module_records_ref(company_id, "production").document(existing_prod_id)
                p_snap = p_ref.get()
                if p_snap.exists and not (p_snap.to_dict() or {}).get("isDeleted"):
                    existing_prod = p_snap.to_dict() or {}
                    existing_prod["id"] = p_snap.id

            if not existing_prod:
                production_records = module_records_ref(company_id, "production")
                for linked_sales_id in dict.fromkeys((order_id, str(order.get("orderNumber") or ""))):
                    if not linked_sales_id:
                        continue
                    candidates = production_records.where("salesOrderId", "==", linked_sales_id).limit(20).stream()
                    existing_prod = next((candidate.to_dict() or {} for candidate in candidates
                                          if (candidate.to_dict() or {}).get("recordType") == "productionRequest"
                                          and not (candidate.to_dict() or {}).get("isDeleted")), None)
                    if existing_prod:
                        break

            if existing_prod:
                production_id = str(existing_prod.get("id"))
                updates["productionRequestId"] = production_id
                batch.update(req_ref, {"productionRequestId": production_id})
                batch.update(order_ref, {"productionStatus": "PLANNED", "prdSentAt": now, "prdSentBy": request.user.app_user.full_name or ""})
            else:
                source_items = [item for item in (order.get("items") or record.get("items") or []) if isinstance(item, dict)]
                request_items = []
                for item in source_items:
                    line = dict(item)
                    qty = item.get("qty", item.get("quantity", item.get("q", 0)))
                    line.update({"itemId": str(item.get("productId") or item.get("i") or item.get("itemId") or item.get("id") or "ITEM"),
                                 "itemCode": str(item.get("code") or item.get("itemCode") or item.get("hsn") or ""),
                                 "itemName": item.get("productName") or item.get("description") or item.get("itemName") or "Item",
                                 "quantity": qty, "unit": item.get("uom") or item.get("unit") or "Nos"})
                    request_items.append(line)

                valid_items = []
                for line in request_items:
                    try:
                        q_val = float(line.get("quantity") or 0)
                        if q_val > 0 and line.get("itemId"):
                            valid_items.append(line)
                    except (TypeError, ValueError):
                        continue

                if not valid_items:
                    default_code = str(order.get("orderNumber") or order_id)
                    valid_items = [{
                        "itemId": order_id,
                        "itemCode": default_code,
                        "itemName": f"Sales Order {default_code}",
                        "quantity": 1,
                        "unit": "Order"
                    }]

                prod_id = "PR-" + re.sub(r"[^A-Za-z0-9_-]", "", order_id)[:90]
                prod_ref = module_records_ref(company_id, "production").document(prod_id)
                prod_snap = prod_ref.get()
                if prod_snap.exists:
                    prod = prod_snap.to_dict() or {}
                    prod_so_id = str(prod.get("salesOrderId") or "")
                    if prod_so_id in {order_id, str(order.get("orderNumber") or "")}:
                        production_id = prod_id
                    else:
                        production_id = f"{prod_id}-{uuid.uuid4().hex[:6]}"
                        prod_ref = module_records_ref(company_id, "production").document(production_id)
                else:
                    production_id = prod_id

                first = valid_items[0]
                batch.create(prod_ref, {"id": production_id, "recordType": "productionRequest", "companyId": str(company_id), "module": "production",
                    "requestCode": next_production_request_code(company_id), "salesOrderId": order_id,
                    "salesOrderNumber": order.get("orderNumber") or order_id, "items": valid_items,
                    "productCode": first.get("itemCode") or "", "productName": first.get("itemName") or "Item", "quantity": first.get("quantity") or 1, "unit": first.get("unit") or "Nos",
                    "customerId": order.get("customerId", ""), "customerName": order.get("customerName", ""),
                    "deliveryDate": order.get("deliveryDate") or "", "requiredCompletionDate": order.get("deliveryDate") or "",
                    "priority": order.get("priority") or "Medium", "status": "Pending Review", "requestDate": now[:10],
                    "requestedBy": request.user.app_user.full_name or "", "createdBy": actor, "createdAt": now, "updatedAt": now})
                batch.update(req_ref, {"productionRequestId": production_id})
                batch.update(order_ref, {"productionStatus": "PLANNED", "prdSentAt": now, "prdSentBy": request.user.app_user.full_name or ""})
        else:
            source_updates = {"accountingApprovalStatus": status_value, "accountingDecisionAt": now,
                              "accountingDecisionBy": actor, "accountingDecisionReason": reason}
            if action == "cancel":
                source_updates["status"] = "CANCELLED"
                source_updates["st"] = "CANCELLED"
            batch.update(order_ref, source_updates)

        try:
            commit_started_at = perf_counter()
            batch.commit()
            commit_duration_ms = round((perf_counter() - commit_started_at) * 1000, 2)
            # Approve & Release: when the Accounting user supplied payment-release
            # details, persist them as a receivable receipt entry in the same
            # workflow, without touching the production-release logic above.
            release_payload = request.data.get("release") if isinstance(request.data, dict) else None
            release_receipt_attempted = action == "approve" and isinstance(release_payload, dict) and bool(release_payload)
            if release_receipt_attempted:
                try:
                    receipt_result = self._record_sales_receipt(request, str(request_id))
                    if getattr(receipt_result, "status_code", 200) >= 400:
                        logger.warning(
                            "Sales Accounting Request %s: approval committed but the release receipt failed (%s).",
                            request_id, getattr(receipt_result, "data", {}).get("error", "unknown"),
                        )
                        fresh = req_ref.get().to_dict() or {}
                        return Response({
                            "success": True,
                            "record": clean({**fresh, "id": str(request_id)}),
                            "message": "Sales Request approved, but the payment release could not be recorded. Use Record Receipt to retry.",
                            "releaseError": receipt_result.data,
                        })
                except Exception:
                    logger.exception("Sales Accounting Request %s: release receipt recording raised unexpectedly.", request_id)
            fresh = req_ref.get().to_dict() or {} if release_receipt_attempted else {**record, **updates}
            logger.info("Sales Accounting Request %s [Action: %s, Company: %s, Order: %s]: committed successfully.",
                        request_id, action, company_id, order_id)
            logger.info(
                "[performance] accounting_approval action=%s firestore_commit_ms=%s total_ms=%s",
                action, commit_duration_ms, round((perf_counter() - workflow_started_at) * 1000, 2),
            )
            return Response({"success": True, "record": clean({**fresh, "id": req_ref.id}),
                             "message": f"Sales Request {status_value.lower()} successfully."})
        except Exception as exc:
            logger.exception("Sales Accounting Request %s: batch commit failed: %s", request_id, exc)
            return api_error(exc, "Unable to update Sales Accounting Request.")

    def _record_sales_receipt(self, request, request_id):
        try:
            release = request.data.get("release") if isinstance(request.data, dict) else None
            release = release if isinstance(release, dict) else {}
            amount = Decimal(str(request.data.get("amount") or release.get("amount") or "0"))
            advance_percent = None
            if release.get("advancePercent") not in (None, ""):
                advance_percent = Decimal(str(release.get("advancePercent")))
            receipt_id = str(request.data.get("receiptId") or release.get("receiptId") or "").strip()
            method = str(request.data.get("method") or release.get("method") or "").upper()
            raw_date = request.data.get("date") or release.get("date") or ""
            receipt_date = date.fromisoformat(str(raw_date))
            if (not amount.is_finite() or amount <= 0 or amount.as_tuple().exponent < -2
                    or (advance_percent is not None and (not advance_percent.is_finite()
                        or advance_percent < 0 or advance_percent > 100
                        or advance_percent.as_tuple().exponent < -2))
                    or not receipt_id or len(receipt_id) > 128 or "/" in receipt_id
                    or method not in {"CASH", "BANK", "UPI", "CARD", "CHEQUE", "OTHER"}
                    or receipt_date > date.today()):
                return Response({"error": "Receipt amount, method, date, or ID is invalid."}, status=400)
            company_id = str(request.user.company.id)
            request_ref = module_records_ref(company_id, "accounting").document(str(request_id))
            initial_snap = request_ref.get()
            initial = initial_snap.to_dict() or {} if initial_snap.exists else {}
            if not initial_snap.exists or initial.get("recordType") != "salesAccountingRequest":
                return Response({"error": "Sales Accounting Request not found."}, status=404)
            order_id = str(initial.get("salesOrderId") or initial.get("orderId") or (str(request_id)[4:] if str(request_id).startswith("SAR-") else "") or "").strip()
            order_ref = module_records_ref(company_id, "sales").document(order_id)
            entry_ref = module_records_ref(company_id, "accounting").document(receipt_id)
            transport_records = [row for row in list_module_records(company_id, "transport")
                                 if row.get("recordType") == "transportBill" and not row.get("isDeleted")
                                 and str(row.get("salesOrderId") or "") == order_id]
            transport_refs = [module_records_ref(company_id, "transport").document(str(row.get("id"))) for row in transport_records]
            delivery_bills = [row for row in list_module_records(company_id, "transport")
                              if row.get("recordType") == "deliveryBill" and not row.get("isDeleted")
                              and str(row.get("salesOrderId") or "") == order_id]
            delivery_refs = [module_records_ref(company_id, "transport").document(str(row.get("id"))) for row in delivery_bills]
            actor = str(request.user.app_user.firebase_uid)
            now = now_iso()
            voucher_number = _next_company_number(
                company_id, "accounting", "receiptVoucher",
                _accounting_voucher_prefix("RV", receipt_date), "accountingEntry", "voucherNumber",
            )
            company_snapshot = _accounting_company_snapshot(request.user.company)
            txn = get_db().transaction()

            @firestore.transactional
            def record(tx):
                req_snap = _transaction_document(tx, request_ref)
                order_snap = _transaction_document(tx, order_ref)
                entry_snap = _transaction_document(tx, entry_ref)
                if not req_snap or not req_snap.exists or not order_snap or not order_snap.exists:
                    raise ValueError("The Sales Request or linked Sales Order is unavailable.")
                if entry_snap and entry_snap.exists:
                    raise ValueError("This receipt has already been recorded.")
                live_req = req_snap.to_dict() or {}
                order = order_snap.to_dict() or {}
                req_rec = str(live_req.get("recordType") or "").lower()
                order_rec = str(order.get("recordType") or "").lower()
                if (req_rec and req_rec != "salesaccountingrequest") or (order_rec and order_rec not in {"salesorder", "order", "sales_order"}):
                    raise ValueError("The Sales Request or linked Sales Order is unavailable.")
                if str(live_req.get("approvalStatus") or "").strip().lower() != "approved":
                    raise ValueError("Only an approved Sales Request can record a receipt.")
                received = Decimal(str(order.get("received") or 0))
                order_total = Decimal(str(live_req.get("grandTotal") or 0))
                required = (order_total * advance_percent / Decimal("100")).quantize(
                    Decimal("0.01"), rounding=ROUND_HALF_UP,
                ) if advance_percent is not None else Decimal(str(live_req.get("requiredAdvance") or 0))
                if not all(value.is_finite() and value >= 0 for value in (received, order_total, required)):
                    raise ValueError("The Sales Order has invalid receipt totals.")
                if advance_percent is not None and abs(amount - required) > Decimal("0.01"):
                    raise ValueError("The receipt amount must match the selected advance percentage.")
                amount_received = (received + amount).quantize(Decimal("0.01"), rounding=ROUND_HALF_UP)
                if amount_received > order_total:
                    raise ValueError("Receipt exceeds the remaining Sales Order balance.")
                payment_status = "PAID" if amount_received >= order_total and order_total > 0 else "PARTIAL"
                order_updates = {"received": float(amount_received), "paymentStatus": payment_status,
                                 "receiptUpdatedAt": now,
                                 "accountingRelease": {"entryId": receipt_id, "voucherNumber": voucher_number,
                                                       "amount": float(amount), "date": receipt_date.isoformat(),
                                                       "method": method,
                                                       "utr": str(release.get("utr") or "")[:64],
                                                       "voucherRef": str(release.get("voucher") or "")[:64],
                                                                             "advancePercent": float(advance_percent if advance_percent is not None else live_req.get("advancePercent") or 0),
                                                                             "releaseStatus": str(release.get("status") or "Released")[:40],
                                                       "notes": str(release.get("notes") or "")[:500],
                                                       "balanceDue": float(max(Decimal("0"), order_total - amount_received))}}
                current_order_status = str(order.get("status") or "").upper()
                if current_order_status == "ADVANCE_PENDING" and amount_received >= required:
                    order_updates["status"] = "CONFIRMED"
                if payment_status == "PAID":
                    order_updates["fullyPaidAt"] = now
                invoice_ref = module_records_ref(company_id, "accounting").document("REC-" + str(request_id))
                invoice_snap = _transaction_document(tx, invoice_ref)
                transport_snaps = [(ref, _transaction_document(tx, ref)) for ref in transport_refs]
                delivery_snaps = [(ref, _transaction_document(tx, ref)) for ref in delivery_refs]
                history = list(live_req.get("history") or []) + [{"at": now, "actorId": actor,
                    "actorName": request.user.app_user.full_name or "", "action": "Advance receipt recorded",
                    "amount": float(amount), "advancePercent": float(advance_percent if advance_percent is not None else live_req.get("advancePercent") or 0),
                    "method": method, "date": receipt_date.isoformat()}]
                entry = {"id": receipt_id, "number": voucher_number, "voucherNumber": voucher_number,
                    "recordType": "accountingEntry", "module": "accounting", "requestId": str(request_id),
                    "type": "RECEIPT", "ref": order_id, "inv": "—", "amount": float(amount), "paid": float(amount),
                    "method": method, "date": receipt_date.isoformat(), "st": "POSTED", "status": "POSTED", "cb": request.user.app_user.full_name or "",
                    "ca": receipt_date.isoformat(), "why": "", "hist": [[receipt_date.isoformat(), f"Receipt recorded · {voucher_number}"]],
                    "counterpartyName": str(live_req.get("customerName") or ""),
                    "counterpartyAddress": str(live_req.get("customerAddress") or ""),
                    "counterpartyGSTIN": str(live_req.get("customerGSTIN") or ""),
                    "advancePercent": float(advance_percent if advance_percent is not None else live_req.get("advancePercent") or 0),
                    "totalAmount": float(order_total), "paidAmount": float(amount_received),
                    "balanceDue": float(max(Decimal("0"), order_total - amount_received)),
                    "paymentStatus": payment_status, "items": live_req.get("items") or [],
                    "taxableAmount": float(live_req.get("taxableAmount") or 0),
                    "taxBreakdown": {"cgst": float(live_req.get("cgst") or 0),
                                     "sgst": float(live_req.get("sgst") or 0),
                                     "igst": float(live_req.get("igst") or 0)},
                    "companySnapshot": company_snapshot,
                    "utr": str(release.get("utr") or "")[:64],
                    "voucherRef": str(release.get("voucher") or "")[:64],
                    "notes": str(release.get("notes") or release.get("status") or "")[:500],
                    "releaseStatus": str(release.get("status") or "Released")[:40],
                    "companyId": company_id, "createdBy": actor, "createdAt": now, "updatedAt": now}
                tx.update(order_ref, order_updates)
                for transport_ref, transport_snap in transport_snaps:
                    if transport_snap and transport_snap.exists:
                        tx.update(transport_ref, {"customerReceiptStatus": payment_status,
                                                  "customerAmountReceived": float(amount_received),
                                                  "customerReceiptUpdatedAt": now})
                for delivery_ref, delivery_snap in delivery_snaps:
                    if delivery_snap and delivery_snap.exists:
                        tx.update(delivery_ref, {"customerReceiptStatus": payment_status,
                                                 "customerAmountReceived": float(amount_received),
                                                 "customerBalanceDue": float(max(Decimal("0"), order_total - amount_received)),
                                                 "customerReceiptUpdatedAt": now})
                tx.update(request_ref, {"amountReceived": float(amount_received),
                    **({"advancePercent": float(advance_percent), "requiredAdvance": float(required)} if advance_percent is not None else {}),
                    "advanceOutstanding": float(max(Decimal("0"), required - amount_received)),
                    "paymentStatus": payment_status, "history": history, "updatedAt": now})
                # Firestore rejects arrays that contain other arrays. Store the
                # receipt history row as a map while retaining the legacy 0/1
                # keys consumed by the Accounting activity renderer.
                entry["hist"] = [{
                    "0": receipt_date.isoformat(),
                    "1": f"Receipt recorded · {voucher_number}",
                    "date": receipt_date.isoformat(),
                    "action": f"Receipt recorded · {voucher_number}",
                }]
                tx.create(entry_ref, firestore_safe(entry))
                if invoice_snap and invoice_snap.exists:
                    invoice = invoice_snap.to_dict() or {}
                    tx.update(invoice_ref, {"paid": float(amount_received), "updatedAt": now})
                return {"request": {**live_req, "amountReceived": float(amount_received),
                    "advanceOutstanding": float(max(Decimal("0"), required - amount_received)),
                    "paymentStatus": payment_status, "history": history}, "entry": entry}

            result = record(txn)
            return Response({"success": True, "request": clean(result["request"]), "entry": clean(result["entry"])}, status=201)
        except ValueError as exc:
            return Response({"error": str(exc)}, status=409)
        except (InvalidOperation, TypeError):
            return Response({"error": "Receipt amount or Sales Order balance is invalid."}, status=400)
        except Exception as exc:
            return api_error(exc, "Unable to record Sales Order receipt.")


class AccountingBusinessRequestsView(APIView):
    """Idempotent Firestore workflows for purchase approvals and transport bills."""

    TYPES = {"purchase": ("purchaseAccountingRequest", "purchaseOrder", "purchase"),
             "transport": ("transportAccountingRequest", "transportBill", "transport")}

    def get(self, request):
        if not user_can_access_module(request.user, "accounting"):
            return Response({"error": "Accounting access required."}, status=403)
        try:
            records = list_module_records(request.user.company.id, "accounting")
            records = [row for row in records if row.get("recordType") in {"purchaseAccountingRequest", "transportAccountingRequest"} and not row.get("isDeleted")]
            records = ModuleDataView._recover_legacy_transport_accounting_requests(
                request.user.company.id, records,
            )
            transport_records = ModuleDataView._recover_legacy_transport_requests(
                request.user.company.id, list_module_records(request.user.company.id, "transport"),
            )
            delivery_bills = [row for row in transport_records
                              if row.get("recordType") == "deliveryBill" and not row.get("isDeleted")]
            return Response({"records": records, "deliveryBills": delivery_bills})
        except Exception as exc:
            return api_error(exc, "Unable to load Accounting requests.")

    def post(self, request, request_type, request_id=None, action=None):
        kind = str(request_type or "").lower()
        if kind not in self.TYPES:
            return Response({"error": "Unsupported Accounting request type."}, status=400)
        request_record_type, source_record_type, source_module = self.TYPES[kind]
        company_id = str(request.user.company.id)
        actor = str(request.user.app_user.firebase_uid)
        now = now_iso()
        try:
            if action is None:
                if not user_can_access_module(request.user, source_module):
                    return Response({"error": f"{source_module.title()} access required to submit this request."}, status=403)
                return self._submit(request, kind, company_id, actor, now)
            if not user_can_access_module(request.user, "accounting"):
                return Response({"error": "Accounting access required."}, status=403)
            action = str(action).lower()
            if action == "pay":
                return self._record_payment(request, kind, request_id, company_id, actor, now)
            if action not in {"approve", "reject", "cancel"}:
                return Response({"error": "Unsupported Accounting action."}, status=400)
            reason = str(request.data.get("reason") or "").strip()[:1000]
            if action in {"reject", "cancel"} and not reason:
                return Response({"error": "A reason is required."}, status=400)
            request_ref = self._ref(company_id, "accounting", request_id)
            req_snap = request_ref.get()
            req = req_snap.to_dict() or {} if req_snap.exists else {}
            if not req_snap.exists or req.get("recordType") != request_record_type:
                return Response({"error": "Accounting request not found."}, status=404)
            source_id = str(req.get("sourceId") or req.get("purchaseOrderId") or req.get("transportBillId") or "")
            source_ref = self._ref(company_id, source_module, source_id)
            txn = get_db().transaction()

            @firestore.transactional
            def decide(tx):
                live_req_snap = _transaction_document(tx, request_ref)
                live_source_snap = _transaction_document(tx, source_ref)
                if not live_req_snap or not live_req_snap.exists or not live_source_snap or not live_source_snap.exists:
                    raise ValueError("The request or its source record is unavailable.")
                live_req = live_req_snap.to_dict() or {}
                live_source = live_source_snap.to_dict() or {}
                if live_req.get("recordType") != request_record_type or live_source.get("recordType") != source_record_type:
                    raise ValueError("The request or its source record is unavailable.")
                if live_req.get("approvalStatus") in {"Approved", "Rejected", "Cancelled"}:
                    if live_req.get("approvalStatus") == ("Approved" if action == "approve" else "Rejected"):
                        return live_req
                    raise ValueError("This request has already been decided.")
                if live_req.get("approvalStatus") != "Pending":
                    raise ValueError("This request is not awaiting review.")
                result = "Approved" if action == "approve" else "Rejected" if action == "reject" else "Cancelled"
                approval_details = request.data.get("details") if isinstance(request.data.get("details"), dict) else {}
                if action == "approve":
                    due_date = str(approval_details.get("dueDate") or live_req.get("dueDate") or "")
                    if due_date:
                        try:
                            date.fromisoformat(due_date)
                        except ValueError:
                            raise ValueError("Enter a valid payable due date.")
                    approval_details = {
                        "vendorInvoiceNumber": str(approval_details.get("vendorInvoiceNumber") or live_req.get("vendorInvoiceNumber") or live_req.get("billNumber") or "").strip()[:80],
                        "invoiceDate": str(approval_details.get("invoiceDate") or live_req.get("invoiceDate") or live_req.get("billDate") or now[:10]),
                        "dueDate": due_date,
                        "paymentTerms": str(approval_details.get("paymentTerms") or live_req.get("paymentTerms") or "").strip()[:250],
                        "approvalNotes": str(approval_details.get("approvalNotes") or "").strip()[:1000],
                        "approvedAmount": float(live_req.get("totalAmount") or 0),
                        "approvalDetailsSavedAt": now,
                    }
                    try:
                        date.fromisoformat(approval_details["invoiceDate"])
                    except ValueError:
                        raise ValueError("Enter a valid invoice date.")
                event = {"at": now, "actorId": actor, "actorName": request.user.app_user.full_name or "",
                         "action": result, "reason": reason, **(approval_details if action == "approve" else {})}
                history = list(live_req.get("history") or []) + [event]
                source_updates = {"accountingApprovalStatus": result, "accountingDecisionAt": now,
                                  "accountingDecisionBy": actor, "accountingDecisionReason": reason}
                if kind == "purchase":
                    source_updates["status"] = "ORDERED" if action == "approve" else "REJECTED" if action == "reject" else "CANCELLED"
                    source_updates["st"] = source_updates["status"]
                    source_updates["accountingRequestId"] = request_id
                else:
                    source_updates["approvalStatus"] = result
                    source_updates["billStatus"] = "PAYMENT_PENDING" if action == "approve" else "REJECTED" if action == "reject" else "CANCELLED"
                    source_updates["history"] = list(live_source.get("history") or []) + [event]
                if action == "approve":
                    source_updates.update(approval_details)
                    source_updates["paymentStatus"] = live_req.get("paymentStatus") or "UNPAID"
                    source_updates["paidAmount"] = float(live_req.get("paidAmount") or 0)
                    source_updates["balanceDue"] = float(live_req.get("totalAmount") or 0) - float(live_req.get("paidAmount") or 0)
                tx.update(request_ref, {"approvalStatus": result, "decisionReason": reason, "decidedAt": now,
                                        "decidedBy": actor, "history": history, "updatedAt": now,
                                        **(approval_details if action == "approve" else {})})
                tx.update(source_ref, source_updates)
                return {**live_req, "approvalStatus": result, "decisionReason": reason, "history": history,
                        **(approval_details if action == "approve" else {}), "updatedAt": now}

            saved = decide(txn)
            return Response({"success": True, "record": clean({**saved, "id": request_id})})


        except ValueError as exc:
            return Response({"error": str(exc)}, status=409)
        except Exception as exc:
            return api_error(exc, "Unable to update Accounting request.")

    @staticmethod
    def _ref(company_id, module, record_id):
        return module_records_ref(company_id, module).document(str(record_id))

    def _submit(self, request, kind, company_id, actor, now):
        if kind == "purchase":
            po_id = str(request.data.get("purchaseOrderId") or "").strip()
            if not po_id:
                return Response({"error": "Purchase Order ID is required."}, status=400)
            source_ref = self._ref(company_id, "purchase", po_id)
            snap = source_ref.get()
            source = snap.to_dict() or {} if snap.exists else {}
            if not snap.exists or source.get("recordType") != "purchaseOrder" or source.get("isDeleted"):
                return Response({"error": "Purchase Order not found."}, status=404)
            if source.get("status", source.get("st")) not in {"DRAFT", "REJECTED"}:
                return Response({"error": "Only a draft or rejected Purchase Order can be submitted."}, status=409)
            inventory = list_module_records(company_id, "inventory")
            item_id = str(source.get("item") or source.get("itemId") or "")
            item_record = next((item for item in inventory if str(item.get("id")) == item_id or str(item.get("code") or "") == item_id), {})
            try:
                qty, rate = Decimal(str(source.get("qty", 0))), Decimal(str(source.get("rate", 0)))
                if not qty.is_finite() or not rate.is_finite() or qty <= 0 or rate < 0:
                    raise ValueError
                subtotal = qty * rate
                discount = Decimal(str(source.get("discountAmount", source.get("discount", 0)) or 0))
                gst_rate = Decimal(str(source.get("gstRate", source.get("gst", item_record.get("gst", 0))) or 0))
                freight = Decimal(str(source.get("freight", source.get("otherCharges", 0)) or 0))
                if (not all(value.is_finite() and value >= 0 for value in (discount, gst_rate, freight))
                        or gst_rate > 100 or discount > subtotal):
                    raise ValueError
                taxable = subtotal - discount
                tax = (taxable * gst_rate / Decimal("100")).quantize(Decimal("0.01"), rounding=ROUND_HALF_UP)
                tax_type = str(source.get("taxType") or source.get("gstType") or "INTRA_STATE").upper()
                igst = tax if tax_type == "IGST" else Decimal("0")
                cgst = Decimal("0") if tax_type == "IGST" else (tax / Decimal("2")).quantize(Decimal("0.01"), rounding=ROUND_HALF_UP)
                sgst = Decimal("0") if tax_type == "IGST" else tax - cgst
                total = (taxable + tax + freight).quantize(Decimal("0.01"), rounding=ROUND_HALF_UP)
            except (InvalidOperation, TypeError, ValueError):
                return Response({"error": "Purchase Order quantity and rate are invalid."}, status=400)
            request_id = "PAR-" + re.sub(r"[^A-Za-z0-9_-]", "", po_id)[:100]
            request_ref = self._ref(company_id, "accounting", request_id)
            supplier_id = str(source.get("sup") or source.get("supplierId") or "")
            suppliers = list_module_records(company_id, "purchase")
            supplier = next((item for item in suppliers if str(item.get("id")) == supplier_id and item.get("recordType") == "supplier"), {})
            supplier_gstin = str(supplier.get("gst") or supplier.get("gstin") or "").upper().strip()
            company_gstin = str(getattr(request.user.company, "gstin", "") or "").upper().strip()
            company_code = re.sub(r"\W", "", company_gstin)[:2]
            supplier_code = re.sub(r"\W", "", supplier_gstin)[:2]
            company_state = str(getattr(request.user.company, "state", "") or "").strip().casefold()
            supplier_state = str(supplier.get("state") or "").strip().casefold()
            tax_type = str(source.get("taxType") or source.get("gstType") or "").upper()
            if tax_type not in {"INTRA_STATE", "IGST"}:
                tax_type = "INTRA_STATE" if ((company_code and company_code == supplier_code)
                                              or (company_state and company_state == supplier_state)) else "IGST"
            igst = tax if tax_type == "IGST" else Decimal("0")
            cgst = Decimal("0") if tax_type == "IGST" else (tax / Decimal("2")).quantize(Decimal("0.01"), rounding=ROUND_HALF_UP)
            sgst = Decimal("0") if tax_type == "IGST" else tax - cgst
            payload = {"id": request_id, "recordType": "purchaseAccountingRequest", "module": "accounting",
                       "requestNumber": request_id, "requestDate": now, "sourceId": po_id, "purchaseOrderId": po_id,
                       "purchaseOrderNumber": po_id, "purchaseOrderDate": source.get("pd", ""), "requisitionId": source.get("requisitionId") or source.get("purchaseRequisitionId") or "", "supplierId": supplier_id, "supplierName": supplier.get("n") or source.get("supplierName") or "",
                       "supplierContact": supplier.get("ph") or supplier.get("phone") or "",
                       "supplierAddress": supplier.get("ad") or supplier.get("address") or "",
                       "supplierGstin": supplier_gstin,
                       "items": [{"itemId": item_id, "itemCode": item_record.get("code") or "", "itemName": item_record.get("name") or source.get("itemName") or item_id, "hsn": item_record.get("hsn") or "", "quantity": float(qty), "unit": source.get("unit") or item_record.get("unit") or "", "unitRate": float(rate)}],
                       "subtotal": float(subtotal), "discount": float(discount), "taxableAmount": float(taxable), "gstRate": float(gst_rate), "gstAmount": float(tax), "taxBreakdown": {"cgst": float(cgst), "sgst": float(sgst), "igst": float(igst)}, "freight": float(freight), "totalAmount": float(total), "advanceRequirement": source.get("advanceRequirement", 0), "attachments": source.get("attachments") or [],
                       "paymentTerms": source.get("paymentTerms", ""), "requiredDeliveryDate": source.get("ed", ""),
                       "companySnapshot": _accounting_company_snapshot(request.user.company), "taxType": tax_type,
                       "requestedBy": request.user.app_user.full_name or "", "approvalStatus": "Pending",
                       "history": [{"at": now, "actorId": actor, "action": "Submitted for Accounting approval"}],
                       "createdBy": actor, "createdAt": now, "updatedAt": now}
            source_updates = {"status": "PENDING_APPROVAL", "st": "PENDING_APPROVAL", "accountingApprovalStatus": "Pending", "accountingRequestId": request_id, "accountingDecisionReason": ""}
            return self._create_pair(source_ref, request_ref, source, source_updates, payload)

        dispatch_id = str(request.data.get("dispatchId") or "").strip()
        bill_number = str(request.data.get("billNumber") or "").strip()
        if not dispatch_id or not bill_number:
            return Response({"error": "Dispatch ID and transport bill number are required."}, status=400)
        if len(bill_number) > 80:
            return Response({"error": "Transport Bill number must be 80 characters or fewer."}, status=400)
        dispatch_ref = self._ref(company_id, "transport", dispatch_id)
        dispatch_snap = dispatch_ref.get()
        dispatch = dispatch_snap.to_dict() or {} if dispatch_snap.exists else {}
        if not dispatch_snap.exists or dispatch.get("recordType") != "dispatch" or dispatch.get("isDeleted"):
            return Response({"error": "Linked dispatch not found."}, status=404)
        sales_order_id = str(dispatch.get("so") or dispatch.get("salesOrderId") or "")
        sales_order_snap = self._ref(company_id, "sales", sales_order_id).get() if sales_order_id else None
        sales_order = sales_order_snap.to_dict() or {} if sales_order_snap and sales_order_snap.exists else {}
        bill_date = str(request.data.get("billDate") or "")
        due_date = str(request.data.get("dueDate") or "")
        try:
            parsed_bill_date = date.fromisoformat(bill_date)
            if due_date and date.fromisoformat(due_date) < parsed_bill_date:
                raise ValueError
        except ValueError:
            return Response({"error": "Bill date or due date is invalid."}, status=400)
        attachment = str(request.data.get("attachment") or "").strip()
        if attachment and not attachment.startswith("https://"):
            return Response({"error": "Invoice attachment must use a secure HTTPS URL."}, status=400)
        transporter_gstin = str(request.data.get("transporterGstin") or "").upper().strip()
        if transporter_gstin and not GSTIN_RE.match(transporter_gstin):
            return Response({"error": "Enter a valid transporter GSTIN."}, status=400)
        charges = {}
        try:
            for field in ("transportCharges", "tollCharges", "fuelCharges", "loadingCharges", "otherCharges"):
                value = Decimal(str(request.data.get(field, 0) or 0))
                if not value.is_finite() or value < 0:
                    raise ValueError
                charges[field] = value
            if (charges["tollCharges"] or charges["fuelCharges"]) and not request.data.get("tollFuelSeparate"):
                raise ValueError
            gst_rate = Decimal(str(request.data.get("gstRate", 0) or 0))
            if not gst_rate.is_finite() or gst_rate < 0 or gst_rate > 100:
                raise ValueError
            taxable = sum(charges.values(), Decimal("0"))
            gst_amount = (taxable * gst_rate / Decimal("100")).quantize(Decimal("0.01"), rounding=ROUND_HALF_UP)
            company_gstin = str(getattr(request.user.company, "gstin", "") or "").upper()
            company_state_code = re.sub(r"\W", "", company_gstin)[:2]
            transporter_state_code = re.sub(r"\W", "", transporter_gstin)[:2]
            tax_type = str(request.data.get("taxType") or "").upper()
            if tax_type not in {"INTRA_STATE", "IGST"}:
                tax_type = "INTRA_STATE" if company_state_code and company_state_code == transporter_state_code else "IGST"
            cgst = (gst_amount / Decimal("2")).quantize(Decimal("0.01"), rounding=ROUND_HALF_UP) if tax_type == "INTRA_STATE" else Decimal("0")
            sgst = gst_amount - cgst if tax_type == "INTRA_STATE" else Decimal("0")
            igst = gst_amount if tax_type == "IGST" else Decimal("0")
            total = (taxable + gst_amount).quantize(Decimal("0.01"), rounding=ROUND_HALF_UP)
            if total <= 0:
                raise ValueError
        except (InvalidOperation, TypeError, ValueError):
            return Response({"error": "Bill charges must be valid non-negative amounts and total above zero."}, status=400)
        bill_id = "TB-" + re.sub(r"[^A-Za-z0-9_-]", "", dispatch_id + "-" + bill_number)[:110]
        request_id = "TBR-" + bill_id[3:]
        bill_ref = self._ref(company_id, "transport", bill_id)
        request_ref = self._ref(company_id, "accounting", request_id)
        bill = {"id": bill_id, "recordType": "transportBill", "module": "transport", "companyId": company_id, "billNumber": bill_number,
                "dispatchId": dispatch_id, "salesOrderId": sales_order_id, "salesOrderNumber": sales_order.get("orderNumber") or sales_order_id, "customerName": sales_order.get("customerName") or "", "transporterName": request.data.get("transporterName", ""),
                "vehicleNumber": dispatch.get("veh", ""), "driverName": dispatch.get("drv", ""), "dispatchDate": dispatch.get("dp", ""),
                "billDate": bill_date, "dueDate": due_date,
                **{key: float(value) for key, value in charges.items()}, "gstRate": float(gst_rate), "gstAmount": float(gst_amount), "totalAmount": float(total),
                "taxableAmount": float(taxable), "taxType": tax_type,
                "taxBreakdown": {"cgst": float(cgst), "sgst": float(sgst), "igst": float(igst)},
                "transporterGstin": transporter_gstin,
                "transporterAddress": str(request.data.get("transporterAddress") or "").strip(),
                "tollFuelSeparate": bool(request.data.get("tollFuelSeparate")),
                "companySnapshot": _accounting_company_snapshot(request.user.company),
                "attachment": attachment, "requestedBy": request.user.app_user.full_name or "",
                "approvalStatus": "Pending", "billStatus": "PENDING_APPROVAL", "history": [{"at": now, "actorId": actor, "action": "Submitted for Accounting approval"}], "createdBy": actor, "createdAt": now, "updatedAt": now}
        accounting = {"id": request_id, "recordType": "transportAccountingRequest", "module": "accounting", "companyId": company_id, "requestNumber": request_id,
                      "requestDate": now, "sourceId": bill_id, "transportBillId": bill_id, "billNumber": bill_number,
                      "dispatchId": dispatch_id, "salesOrderId": sales_order_id, "salesOrderNumber": sales_order.get("orderNumber") or sales_order_id, "customerName": sales_order.get("customerName") or "", "transporterName": bill["transporterName"],
                      "vehicleNumber": bill["vehicleNumber"], "driverName": bill["driverName"], "billDate": bill["billDate"], "dueDate": bill["dueDate"],
                      **{key: float(value) for key, value in charges.items()}, "gstRate": float(gst_rate), "gstAmount": float(gst_amount), "totalAmount": float(total), "attachment": bill["attachment"],
                      "taxableAmount": float(taxable), "taxType": tax_type, "taxBreakdown": bill["taxBreakdown"],
                      "transporterGstin": bill["transporterGstin"], "transporterAddress": bill["transporterAddress"],
                      "companySnapshot": bill["companySnapshot"],
                      "requestedBy": bill["requestedBy"], "approvalStatus": "Pending", "history": [{"at": now, "actorId": actor, "action": "Submitted for Accounting approval"}],
                      "createdBy": actor, "createdAt": now, "updatedAt": now}
        source_updates = {"accountingRequestId": request_id, "accountingApprovalStatus": "Pending"}
        return self._create_pair(dispatch_ref, request_ref, dispatch, source_updates, accounting, extra_ref=bill_ref, extra_data=bill)

    def _create_pair(self, source_ref, request_ref, source, source_updates, payload, extra_ref=None, extra_data=None):
        txn = get_db().transaction()
        @firestore.transactional
        def create(tx):
            current_source = _transaction_document(tx, source_ref)
            current_request = _transaction_document(tx, request_ref)
            if not current_source or not current_source.exists:
                raise ValueError("Source record not found.")
            live_source = current_source.to_dict() or {}
            if payload.get("recordType") == "purchaseAccountingRequest" and (
                    live_source.get("recordType") != "purchaseOrder"
                    or live_source.get("status", live_source.get("st")) not in {"DRAFT", "REJECTED"}):
                raise ValueError("Only a draft or rejected Purchase Order can be submitted.")
            if payload.get("recordType") == "transportAccountingRequest" and (
                    live_source.get("recordType") != "dispatch"
                    or str(live_source.get("status") or live_source.get("st") or "").strip().upper() != "DELIVERED"):
                raise ValueError("A Transport Bill can only be submitted for a delivered dispatch.")
            existing_request = current_request.to_dict() or {} if current_request and current_request.exists else {}
            # A dispatch can retain an old request pointer after legacy data was
            # migrated or the linked request was removed. Treat only a live,
            # matching pending/approved request as a real duplicate.
            linked_request_id = str(live_source.get("accountingRequestId") or "")
            linked_request_snap = None
            if (payload.get("recordType") == "transportAccountingRequest"
                    and linked_request_id and linked_request_id != str(payload.get("id") or "")):
                linked_request_snap = _transaction_document(
                    tx, self._ref(str(payload.get("companyId") or ""), "accounting", linked_request_id),
                )
            linked_request = (linked_request_snap.to_dict() or {}) if linked_request_snap and linked_request_snap.exists else {}
            if (payload.get("recordType") == "transportAccountingRequest"
                    and current_request and current_request.exists
                    and existing_request.get("recordType") == payload.get("recordType")
                    and existing_request.get("sourceId") == payload.get("sourceId")
                    and existing_request.get("approvalStatus") in {"Pending", "Approved"}):
                if live_source.get("accountingRequestId") != payload.get("id"):
                    tx.update(source_ref, {
                        "accountingRequestId": payload.get("id"),
                        "accountingApprovalStatus": existing_request.get("approvalStatus"),
                    })
                return existing_request, True
            if (payload.get("recordType") == "transportAccountingRequest"
                    and linked_request_id
                    and linked_request_id != payload.get("id")
                    and linked_request.get("recordType") == "transportAccountingRequest"
                    and linked_request.get("sourceId")
                    and linked_request.get("approvalStatus") in {"Pending", "Approved"}):
                raise ValueError("A Transport Bill has already been submitted for this dispatch.")
            can_resubmit = bool(existing_request.get("recordType") == payload.get("recordType")
                                and existing_request.get("sourceId") == payload.get("sourceId")
                                and existing_request.get("approvalStatus") == "Rejected")
            can_repair_orphan_bill = bool(
                payload.get("recordType") == "transportAccountingRequest"
                and not (current_request and current_request.exists)
                and extra_ref
                and not (
                    linked_request.get("recordType") == "transportAccountingRequest"
                    and linked_request.get("sourceId")
                    and linked_request.get("approvalStatus") in {"Pending", "Approved"}
                )
            )
            if current_request and current_request.exists and not can_resubmit:
                raise ValueError("An Accounting request already exists for this transaction.")
            if extra_ref:
                current_bill = _transaction_document(tx, extra_ref)
                if current_bill and current_bill.exists:
                    old_bill = current_bill.to_dict() or {}
                    same_bill = (old_bill.get("recordType") == "transportBill"
                                 and str(old_bill.get("dispatchId") or "") == str(payload.get("dispatchId") or "")
                                 and str(old_bill.get("billNumber") or "") == str(payload.get("billNumber") or ""))
                    if not can_resubmit and not (can_repair_orphan_bill and same_bill):
                        raise ValueError("A bill with this number already exists for the dispatch.")
                    bill_history = list(old_bill.get("history") or []) + [{"at": payload.get("requestDate"), "actorId": payload.get("createdBy"), "action": "Corrected and resubmitted"}]
                    tx.update(extra_ref, {**extra_data, "history": bill_history, "revision": int(old_bill.get("revision") or 1) + 1})
                else:
                    tx.create(extra_ref, extra_data)
            if source_updates:
                tx.update(source_ref, source_updates)
            if current_request and current_request.exists:
                existing = existing_request
                if (existing.get("recordType") == payload.get("recordType")
                        and existing.get("sourceId") == payload.get("sourceId")
                        and existing.get("approvalStatus") == "Rejected"):
                    history = list(existing.get("history") or []) + [{"at": payload.get("requestDate"),
                        "actorId": payload.get("createdBy"), "action": "Corrected and resubmitted"}]
                    payload.update({"history": history, "resubmittedAt": payload.get("requestDate"),
                                    "reviewRound": int(existing.get("reviewRound") or 1) + 1, "decisionReason": ""})
                    tx.update(request_ref, payload)
                    return payload, False
                if existing.get("sourceId") == payload.get("sourceId") and existing.get("approvalStatus") != "Cancelled":
                    raise ValueError("An Accounting request already exists for this transaction.")
            tx.create(request_ref, payload)
            return payload, False
        try:
            saved, duplicate = create(txn)
            return Response({"success": True, "record": clean({**saved, "id": payload.get("id")})},
                            status=200 if duplicate else 201)
        except ValueError as exc:
            return Response({"error": str(exc)}, status=409)
        except Exception as exc:
            return api_error(exc, "Unable to submit Accounting request.")

    def _record_payment(self, request, kind, request_id, company_id, actor, now):
        try:
            amount = Decimal(str(request.data.get("amount") or "0"))
            entry_id = str(request.data.get("entryId") or "").strip()
            method = str(request.data.get("method") or "").upper()
            payment_date = date.fromisoformat(str(request.data.get("date") or ""))
            reference = str(request.data.get("reference") or "").strip()[:120]
            allowed_methods = {"CASH", "BANK", "UPI", "CARD", "CHEQUE", "OTHER"}
            if (not amount.is_finite() or amount <= 0 or amount.as_tuple().exponent < -2
                    or not entry_id or len(entry_id) > 128 or "/" in entry_id
                    or method not in allowed_methods or payment_date > date.today()):
                return Response({"error": "Payment amount, method, date, or ID is invalid."}, status=400)

            request_record_type, source_record_type, source_module = self.TYPES[kind]
            request_ref = self._ref(company_id, "accounting", request_id)
            entry_ref = self._ref(company_id, "accounting", entry_id)
            initial_snap = request_ref.get()
            initial = initial_snap.to_dict() or {} if initial_snap.exists else {}
            if not initial_snap.exists or initial.get("recordType") != request_record_type:
                return Response({"error": "Accounting request not found."}, status=404)
            if initial.get("approvalStatus") != "Approved":
                return Response({"error": "Only an approved request can be paid."}, status=409)
            source_id = str(initial.get("sourceId") or initial.get("purchaseOrderId") or initial.get("transportBillId") or "")
            source_ref = self._ref(company_id, source_module, source_id)
            snapshot = _accounting_company_snapshot(request.user.company)
            voucher_prefix = _accounting_voucher_prefix("PV", payment_date)
            voucher_number = _next_company_number(company_id, "accounting", "paymentVoucher",
                                                  voucher_prefix, "accountingEntry", "voucherNumber")
            txn = get_db().transaction()

            @firestore.transactional
            def record(tx):
                req_snap = _transaction_document(tx, request_ref)
                source_snap = _transaction_document(tx, source_ref)
                existing_entry = _transaction_document(tx, entry_ref)
                if not req_snap or not req_snap.exists or not source_snap or not source_snap.exists:
                    raise ValueError("The Accounting request or source bill is unavailable.")
                if existing_entry and existing_entry.exists:
                    saved_entry = existing_entry.to_dict() or {}
                    if (saved_entry.get("recordType") == "accountingEntry"
                            and str(saved_entry.get("requestId") or "") == str(request_id)):
                        live_request = req_snap.to_dict() or {}
                        return {"request": live_request, "entry": saved_entry, "duplicate": True}
                    raise ValueError("This payment entry ID is already in use.")
                live_req = req_snap.to_dict() or {}
                live_source = source_snap.to_dict() or {}
                if live_req.get("recordType") != request_record_type or live_source.get("recordType") != source_record_type:
                    raise ValueError("The Accounting request or source bill is unavailable.")
                if live_req.get("approvalStatus") != "Approved":
                    raise ValueError("Only an approved request can be paid.")
                total = Decimal(str(live_req.get("totalAmount") or 0))
                already_paid = Decimal(str(live_req.get("paidAmount", live_source.get("paidAmount", 0)) or 0))
                if (not total.is_finite() or not already_paid.is_finite()
                        or total < 0 or already_paid < 0 or already_paid > total):
                    raise ValueError("The approved bill has invalid payment totals.")
                paid = (already_paid + amount).quantize(Decimal("0.01"), rounding=ROUND_HALF_UP)
                if paid > total:
                    raise ValueError("Payment exceeds the remaining bill balance.")
                remaining = (total - paid).quantize(Decimal("0.01"), rounding=ROUND_HALF_UP)
                payment_status = "PAID" if remaining == 0 else "PARTIAL"
                event = {"at": now, "actorId": actor, "actorName": request.user.app_user.full_name or "",
                         "action": "Payment recorded", "amount": float(amount), "method": method,
                         "date": payment_date.isoformat(), "reference": reference, "voucherNumber": voucher_number}
                history = list(live_req.get("history") or []) + [event]
                source_history = list(live_source.get("history") or []) + [event]
                entry = {"id": entry_id, "number": voucher_number, "voucherNumber": voucher_number,
                         "recordType": "accountingEntry", "module": "accounting", "type": "PAYMENT",
                         "ref": source_id, "inv": str(live_req.get("billNumber") or source_id),
                         "requestId": str(request_id), "requestType": kind, "sourceId": source_id,
                         "amount": float(amount), "paid": float(amount), "totalAmount": float(total),
                         "paidAmount": float(paid), "balanceDue": float(remaining), "paymentStatus": payment_status,
                         "method": method, "date": payment_date.isoformat(), "st": "POSTED", "status": "POSTED",
                         "reference": reference, "counterpartyName": str(live_req.get("supplierName") or live_req.get("transporterName") or ""),
                         "counterpartyAddress": str(live_req.get("supplierAddress") or ""),
                         "counterpartyGSTIN": str(live_req.get("supplierGstin") or live_req.get("transporterGstin") or ""),
                         "items": live_req.get("items") or [], "gstRate": float(live_req.get("gstRate") or 0),
                         "gstAmount": float(live_req.get("gstAmount") or 0),
                         "taxBreakdown": live_req.get("taxBreakdown") or {},
                         "taxableAmount": float(live_req.get("taxableAmount") or 0),
                         "companySnapshot": snapshot, "cb": request.user.app_user.full_name or "",
                         "ca": payment_date.isoformat(), "why": "",
                         "hist": [{"0": payment_date.isoformat(), "1": f"Payment recorded · {voucher_number}", "date": payment_date.isoformat(), "action": f"Payment recorded · {voucher_number}"}],
                         "companyId": str(company_id), "createdBy": actor, "createdAt": now, "updatedAt": now}
                request_updates = {"paidAmount": float(paid), "balanceDue": float(remaining),
                                   "paymentStatus": payment_status, "paymentHistory": list(live_req.get("paymentHistory") or []) + [event],
                                   "history": history, "updatedAt": now}
                source_updates = {"paidAmount": float(paid), "balanceDue": float(remaining),
                                  "paymentStatus": payment_status, "financeStatus": payment_status,
                                  "lastPaymentAt": now, "history": source_history, "updatedAt": now}
                if kind == "transport":
                    source_updates["billStatus"] = payment_status
                tx.update(request_ref, request_updates)
                tx.update(source_ref, source_updates)
                tx.create(entry_ref, entry)
                return {"request": {**live_req, **request_updates},
                        "source": {**live_source, **source_updates}, "entry": entry, "duplicate": False}

            result = record(txn)
            return Response({"success": True, "request": clean({**result["request"], "id": str(request_id)}),
                             "source": clean({**result.get("source", {}), "id": source_id}),
                             "entry": clean({**result["entry"], "id": entry_id}),
                             "duplicate": result.get("duplicate", False)}, status=200 if result.get("duplicate") else 201)
        except ValueError as exc:
            return Response({"error": str(exc)}, status=409)
        except (InvalidOperation, TypeError):
            return Response({"error": "Payment amount or source balance is invalid."}, status=400)
        except Exception as exc:
            return api_error(exc, "Unable to record Accounting payment.")


class InventoryPurchaseOrdersView(APIView):
    """Inventory requisitions reviewed by Purchase and converted to purchase orders."""

    @staticmethod
    def _records(company_id):
        return module_records_ref(company_id, "inventory")

    def get(self, request):
        if request.user.membership.role not in {Role.INVENTORY, Role.PURCHASE, Role.ADMIN}:
            return Response({"error": "Inventory or Purchase access required."}, status=403)
        rows = [row for row in list_module_records(request.user.company.id, "inventory")
                if row.get("recordType") == "inventoryPurchaseRequest" and not row.get("isDeleted")]
        return Response({"records": rows})

    def post(self, request, request_id=None, action=None):
        role = request.user.membership.role
        company_id = str(request.user.company.id)
        actor = str(request.user.app_user.firebase_uid)
        now = now_iso()
        if not action:
            if role not in {Role.INVENTORY, Role.ADMIN}:
                return Response({"error": "Only Inventory can submit procurement requests."}, status=403)
            raw_items = request.data.get("items")
            if not isinstance(raw_items, list) and request.data.get("itemId"):
                raw_items = [{"itemId": request.data.get("itemId"), "quantity": request.data.get("quantity")}]
            if not isinstance(raw_items, list) or not raw_items or len(raw_items) > 50:
                return Response({"error": "Add between 1 and 50 raw material lines."}, status=400)
            items = []
            seen_item_ids = set()
            try:
                for line in raw_items:
                    item_id = str((line or {}).get("itemId") or "").strip()
                    quantity = Decimal(str((line or {}).get("quantity") or "0"))
                    if not item_id or not quantity.is_finite() or quantity <= 0:
                        raise ValueError
                    if item_id in seen_item_ids:
                        return Response({"error": "A raw material can appear only once in a requisition bill."}, status=400)
                    seen_item_ids.add(item_id)
                    stock_snap = self._records(company_id).document(item_id).get()
                    stock = stock_snap.to_dict() or {} if stock_snap.exists else {}
                    if not stock_snap.exists or stock.get("recordType") != "stockItem" or stock.get("isDeleted"):
                        return Response({"error": f"Inventory item {item_id} was not found."}, status=404)
                    items.append({"itemId": item_id, "itemCode": stock.get("code") or stock.get("itemCode") or "",
                                  "itemName": stock.get("itemName") or stock.get("name") or stock.get("n") or "",
                                  "unit": stock.get("unit") or stock.get("uom") or "Nos", "quantity": float(quantity),
                                  "availableStock": float(stock.get("qty", stock.get("availableStock", 0)) or 0),
                                  "reorderLevel": float(stock.get("reorderLevel", stock.get("ro", 0)) or 0)})
            except (InvalidOperation, TypeError, ValueError):
                return Response({"error": "Each raw material must have an item and positive quantity."}, status=400)
            expected_date = str(request.data.get("expectedDate") or "")
            try:
                if date.fromisoformat(expected_date) < date.today():
                    raise ValueError
            except ValueError:
                return Response({"error": "Expected date must be today or later."}, status=400)
            request_id = "IPR-" + uuid.uuid4().hex[:12].upper()
            company_snap = company_ref(company_id).get()
            company = company_snap.to_dict() or {} if company_snap.exists else {}
            payload = {"id": request_id, "recordType": "inventoryPurchaseRequest", "items": items,
                       "expectedDate": expected_date,
                       "reason": str(request.data.get("reason") or "Stock replenishment")[:500],
                       "requestedBy": request.user.app_user.full_name or "", "requestedById": actor,
                       "requestedAt": now, "status": "Pending", "purchaseOrderId": "", "createdAt": now,
                       "companySnapshot": {key: company.get(key, "") for key in
                           ("companyName", "registeredBusinessName", "address", "country", "state", "pinCode", "gstin", "email", "phone", "businessType", "industry", "employees", "businessLocation")}}
            self._records(company_id).document(request_id).create(payload)
            return Response({"success": True, "record": clean(payload)}, status=201)
        if role not in {Role.PURCHASE, Role.ADMIN}:
            return Response({"error": "Only Purchase can review Inventory orders."}, status=403)
        ref = self._records(company_id).document(str(request_id))
        try:
            snap = ref.get()
            req = snap.to_dict() or {} if snap.exists else {}
            if not snap.exists or req.get("recordType") != "inventoryPurchaseRequest":
                return Response({"error": "Inventory order request not found."}, status=404)
            action = str(action).lower()
            if action == "reject":
                reason = str(request.data.get("reason") or "").strip()
                if not reason:
                    return Response({"error": "Enter a rejection reason."}, status=400)
                if req.get("status") != "Pending":
                    return Response({"error": "This request has already been reviewed."}, status=409)
                txn = get_db().transaction()
                @firestore.transactional
                def reject_once(transaction):
                    live_snap = _transaction_document(transaction, ref)
                    live = live_snap.to_dict() or {} if live_snap and live_snap.exists else {}
                    if not live_snap or not live_snap.exists or live.get("status") != "Pending":
                        raise ValueError("This request has already been reviewed.")
                    transaction.update(ref, {"status": "Rejected", "decisionReason": reason[:500],
                                             "decidedBy": actor, "decidedAt": now})
                reject_once(txn)
                return Response({"success": True, "status": "Rejected"})
            if action != "approve":
                return Response({"error": "Unsupported action."}, status=400)
            if req.get("status") != "Pending":
                return Response({"error": "This request has already been reviewed."}, status=409)
            supplier_id = str(request.data.get("supplierId") or "").strip()
            delivery_date = str(request.data.get("deliveryDate") or "")
            try:
                parsed_delivery_date = date.fromisoformat(delivery_date)
                if not supplier_id or parsed_delivery_date < date.today():
                    raise ValueError
                req_items = req.get("items") or []
                if not req_items and req.get("itemId"):
                    req_items = [{"itemId": req.get("itemId"), "itemCode": req.get("itemCode", ""),
                                  "itemName": req.get("itemName", ""), "unit": req.get("unit", "Nos"),
                                  "quantity": req.get("quantity", 0)}]
                rate_payload = request.data.get("itemRates") or []
                rates_by_id = {str(row.get("itemId")): Decimal(str(row.get("rate") or "0"))
                               for row in rate_payload if isinstance(row, dict)}
                if not req_items:
                    raise ValueError
                for line in req_items:
                    if not isinstance(line, dict) or not str(line.get("itemId") or "").strip():
                        raise ValueError
                    line_rate = rates_by_id.get(str(line.get("itemId")), Decimal(str(request.data.get("rate") or "0")))
                    if not line_rate.is_finite() or line_rate <= 0:
                        raise ValueError
                    line["approvedRate"] = float(line_rate)
            except (InvalidOperation, TypeError, ValueError):
                return Response({"error": "Supplier, valid delivery date, and a positive rate for every raw material are required."}, status=400)
            suppliers = list_module_records(company_id, "purchase")
            supplier = next((row for row in suppliers if row.get("recordType") == "supplier"
                             and str(row.get("id")) == supplier_id and row.get("s", row.get("status", "ACTIVE")) == "ACTIVE"
                             and not row.get("isDeleted")), None)
            if not supplier:
                return Response({"error": "Select an active supplier."}, status=400)
            purchase_orders = []
            purchase_records = module_records_ref(company_id, "purchase")
            accounting_records = module_records_ref(company_id, "accounting")
            inventory_records = module_records_ref(company_id, "inventory")
            supplier_gstin = str(supplier.get("gst") or supplier.get("gstin") or "").upper().strip()
            supplier_address = str(supplier.get("ad") or supplier.get("address") or "").strip()
            company_snapshot = _accounting_company_snapshot(request.user.company)
            company_gstin = str(company_snapshot.get("gstin") or "").upper().strip()
            company_state_code = re.sub(r"\W", "", company_gstin)[:2]
            supplier_state_code = re.sub(r"\W", "", supplier_gstin)[:2]
            same_state = bool(company_state_code and supplier_state_code and company_state_code == supplier_state_code)
            if not company_state_code or not supplier_state_code:
                company_state = str(company_snapshot.get("state") or "").strip().casefold()
                supplier_state = str(supplier.get("state") or "").strip().casefold()
                same_state = bool(company_state and supplier_state and company_state == supplier_state)
            tax_type = "INTRA_STATE" if same_state else "IGST"
            accounting_requests = []
            for line in req_items:
                po_id = _next_company_number(company_id, "purchase", "purchaseOrder", "PO", "purchaseOrder", "id")
                item_id = str(line.get("itemId") or "")
                stock_snap = inventory_records.document(item_id).get()
                stock = stock_snap.to_dict() or {} if stock_snap.exists else {}
                if not stock_snap.exists or stock.get("recordType") != "stockItem" or stock.get("isDeleted"):
                    return Response({"error": f"Inventory item {item_id} is unavailable."}, status=409)
                try:
                    quantity = Decimal(str(line.get("quantity") or "0"))
                    gst_rate = Decimal(str(stock.get("gstRate", stock.get("gst", 0)) or 0))
                except (InvalidOperation, TypeError, ValueError):
                    return Response({"error": f"Quantity or GST rate for {line.get('itemName') or item_id} is invalid."}, status=400)
                rate = Decimal(str(line["approvedRate"]))
                if not quantity.is_finite() or quantity <= 0:
                    return Response({"error": f"Quantity for {line.get('itemName') or item_id} is invalid."}, status=400)
                subtotal = (quantity * rate).quantize(Decimal("0.01"), rounding=ROUND_HALF_UP)
                if not gst_rate.is_finite() or gst_rate < 0 or gst_rate > 100:
                    return Response({"error": f"GST rate for {line.get('itemName') or item_id} is invalid."}, status=400)
                gst_amount = (subtotal * gst_rate / Decimal("100")).quantize(Decimal("0.01"), rounding=ROUND_HALF_UP)
                cgst = (gst_amount / Decimal("2")).quantize(Decimal("0.01"), rounding=ROUND_HALF_UP) if tax_type == "INTRA_STATE" else Decimal("0")
                sgst = gst_amount - cgst if tax_type == "INTRA_STATE" else Decimal("0")
                igst = gst_amount if tax_type == "IGST" else Decimal("0")
                total = subtotal + gst_amount
                request_number = "PAR-" + re.sub(r"[^A-Za-z0-9_-]", "", po_id)[:100]
                item_name = line.get("itemName") or stock.get("name") or item_id
                unit = line.get("unit") or stock.get("unit") or "Nos"
                po = {"id": po_id, "recordType": "purchaseOrder", "inventoryRequestId": str(request_id),
                    "sup": supplier_id, "item": item_id, "itemId": item_id,
                    "itemCode": line.get("itemCode") or stock.get("code") or "", "itemName": item_name,
                    "unit": unit, "qty": float(quantity), "rate": float(rate), "gstRate": float(gst_rate),
                    "hsn": line.get("hsn") or stock.get("hsn") or "",
                    "gstAmount": float(gst_amount), "taxableAmount": float(subtotal), "totalAmount": float(total),
                    "taxType": tax_type, "taxBreakdown": {"cgst": float(cgst), "sgst": float(sgst), "igst": float(igst)},
                    "pd": now[:10], "ed": delivery_date, "recq": 0, "paid": 0, "paidAmount": 0,
                    "balanceDue": float(total), "paymentStatus": "UNPAID", "financeStatus": "UNPAID",
                    "st": "PENDING_APPROVAL", "status": "PENDING_APPROVAL", "accountingApprovalStatus": "Pending",
                    "accountingRequestId": request_number, "supplierName": supplier.get("n") or supplier.get("name") or "",
                    "supplierGstin": supplier_gstin, "supplierAddress": supplier_address,
                    "createdBy": actor, "cb": request.user.app_user.full_name or "", "ca": now[:10],
                    "hist": [{"date": now[:10], "action": f"Sent for Accounting approval from Inventory request {request_id}"}],
                    "createdAt": now, "updatedAt": now}
                accounting = {"id": request_number, "recordType": "purchaseAccountingRequest", "module": "accounting",
                    "requestNumber": request_number, "requestDate": now, "sourceId": po_id,
                    "purchaseOrderId": po_id, "purchaseOrderNumber": po_id, "purchaseOrderDate": now[:10],
                    "requisitionId": str(request_id), "supplierId": supplier_id,
                    "supplierName": supplier.get("n") or supplier.get("name") or "",
                    "supplierContact": supplier.get("ph") or supplier.get("phone") or "",
                    "supplierAddress": supplier_address, "supplierGstin": supplier_gstin,
                    "items": [{"itemId": item_id, "itemCode": po["itemCode"], "itemName": item_name,
                               "hsn": po["hsn"], "quantity": float(quantity),
                               "unit": unit, "unitRate": float(rate)}],
                    "subtotal": float(subtotal), "discount": 0, "taxableAmount": float(subtotal),
                    "gstRate": float(gst_rate), "gstAmount": float(gst_amount),
                    "taxBreakdown": {"cgst": float(cgst), "sgst": float(sgst), "igst": float(igst)},
                    "freight": 0, "totalAmount": float(total), "paidAmount": 0, "balanceDue": float(total),
                    "paymentStatus": "UNPAID", "advanceRequirement": 0, "attachments": [],
                    "paymentTerms": supplier.get("paymentTerms") or "", "requiredDeliveryDate": delivery_date,
                    "companySnapshot": company_snapshot, "taxType": tax_type,
                    "requestedBy": request.user.app_user.full_name or "", "approvalStatus": "Pending",
                    "history": [{"at": now, "actorId": actor, "action": "Submitted for Accounting approval"}],
                    "createdBy": actor, "createdAt": now, "updatedAt": now}
                purchase_orders.append(po)
                accounting_requests.append(accounting)
            txn = get_db().transaction()
            @firestore.transactional
            def approve_once(transaction):
                live_snap = _transaction_document(transaction, ref)
                if live_snap is None or not live_snap.exists:
                    raise ValueError("Inventory request not found.")
                live = live_snap.to_dict() or {}
                if live.get("status") != "Pending":
                    raise ValueError("This request has already been reviewed.")
                accounting_refs = [accounting_records.document(item["id"]) for item in accounting_requests]
                existing_requests = [_transaction_document(transaction, item_ref) for item_ref in accounting_refs]
                if any(item and item.exists for item in existing_requests):
                    raise ValueError("An Accounting request already exists for this Purchase Order.")
                for po, accounting, accounting_ref in zip(purchase_orders, accounting_requests, accounting_refs):
                    po_ref = purchase_records.document(po["id"])
                    transaction.create(po_ref, po)
                    transaction.create(accounting_ref, accounting)
                transaction.update(ref, {"status": "Approved", "purchaseOrderId": purchase_orders[0]["id"],
                                         "purchaseOrderIds": [po["id"] for po in purchase_orders],
                                         "supplierId": supplier_id, "deliveryDate": delivery_date,
                                         "decidedBy": actor, "decidedAt": now})
            approve_once(txn)
            return Response({"success": True, "status": "Approved", "purchaseOrders": clean(purchase_orders)})
        except ValueError as exc:
            return Response({"error": str(exc)}, status=409)
        except Exception as exc:
            return api_error(exc, "Unable to process Inventory order.")


class PurchaseReceiptView(APIView):
    """Atomically record a PO goods receipt and update its inventory stock item."""

    def post(self, request, purchase_order_id):
        if not user_can_access_module(request.user, "purchase"):
            return Response({"error": "Purchase access required."}, status=403)
        try:
            qty = Decimal(str(request.data.get("quantity") or "0"))
            received_date = date.fromisoformat(str(request.data.get("date") or ""))
            receipt_id = str(request.data.get("receiptId") or "").strip()
            if (not qty.is_finite() or qty <= 0 or qty.as_tuple().exponent < 0
                    or not receipt_id or len(receipt_id) > 128 or "/" in receipt_id
                    or received_date > date.today()):
                return Response({"error": "Receipt quantity, date, or ID is invalid."}, status=400)
            company_id = str(request.user.company.id)
            po_ref = module_records_ref(company_id, "purchase").document(str(purchase_order_id))
            initial = po_ref.get()
            if not initial.exists:
                return Response({"error": "Purchase Order not found."}, status=404)
            po = initial.to_dict() or {}
            item_id = str(po.get("itemId") or po.get("item") or "")
            inventory = list_module_records(company_id, "inventory")
            stock = next((row for row in inventory if row.get("recordType") == "stockItem" and not row.get("isDeleted")
                          and (str(row.get("id")) == item_id or str(row.get("code") or row.get("itemCode") or "") == item_id)), None)
            if not stock:
                return Response({"error": "The linked Inventory item is unavailable."}, status=409)
            stock_id = str(stock.get("id"))
            stock_ref = module_records_ref(company_id, "inventory").document(stock_id)
            receipt_ref = module_records_ref(company_id, "purchase").document(receipt_id)
            movement_id = "MOV-" + receipt_id
            movement_ref = module_records_ref(company_id, "inventory").document(movement_id)
            now = now_iso()
            actor = str(request.user.app_user.firebase_uid)
            txn = get_db().transaction()

            @firestore.transactional
            def receive(tx):
                po_snap = _transaction_document(tx, po_ref)
                stock_snap = _transaction_document(tx, stock_ref)
                receipt_snap = _transaction_document(tx, receipt_ref)
                movement_snap = _transaction_document(tx, movement_ref)
                if not po_snap or not po_snap.exists or not stock_snap or not stock_snap.exists:
                    raise ValueError("The Purchase Order or Inventory item is unavailable.")
                live_po = po_snap.to_dict() or {}
                live_stock = stock_snap.to_dict() or {}
                if live_po.get("recordType") != "purchaseOrder" or live_stock.get("recordType") != "stockItem":
                    raise ValueError("The Purchase Order or Inventory item is unavailable.")
                if live_po.get("isDeleted") or str(live_po.get("status", live_po.get("st")) or "").upper() not in {"ORDERED", "PARTIALLY_RECEIVED"}:
                    raise ValueError("Only an approved, open Purchase Order can receive goods.")
                try:
                    expected = date.fromisoformat(str(live_po.get("ed") or live_po.get("pd") or ""))
                except ValueError:
                    raise ValueError("The Purchase Order expected delivery date is invalid.")
                if received_date < expected:
                    raise ValueError("Goods cannot be received before the expected delivery date.")
                if receipt_snap and receipt_snap.exists or movement_snap and movement_snap.exists:
                    raise ValueError("This receipt has already been recorded.")
                ordered = Decimal(str(live_po.get("qty") or 0))
                received = Decimal(str(live_po.get("recq") or 0))
                current_stock = Decimal(str(live_stock.get("qty", live_stock.get("availableStock", 0)) or 0))
                if not all(value.is_finite() and value >= 0 for value in (ordered, received, current_stock)) or qty > ordered - received:
                    raise ValueError("Received quantity exceeds the remaining Purchase Order quantity.")
                cumulative = received + qty
                new_status = "RECEIVED" if cumulative >= ordered else "PARTIALLY_RECEIVED"
                receipt_message = f"Received {qty} {live_stock.get('unit') or live_stock.get('uom') or ''}. Status: {new_status}"
                history = list(live_po.get("hist") or []) + [{"0": received_date.isoformat(), "1": receipt_message,
                    "date": received_date.isoformat(), "action": receipt_message}]
                receipt = {"id": receipt_id, "recordType": "goodsReceipt", "module": "purchase", "po": str(purchase_order_id),
                           "date": received_date.isoformat(), "qty": float(qty), "by": request.user.app_user.full_name or "",
                           "itemId": stock_id, "itemName": str(live_stock.get("n") or live_stock.get("name") or live_stock.get("itemName") or ""),
                           "companyId": company_id, "createdBy": actor, "createdAt": now}
                movement = {"id": movement_id, "recordType": "stockMovement", "module": "inventory", "type": "IN", "t": "IN",
                            "item": stock_id, "itemId": stock_id, "itemCode": str(live_stock.get("code") or live_stock.get("itemCode") or ""),
                            "itemName": receipt["itemName"], "qty": float(qty), "quantity": float(qty), "direction": "IN",
                            "ref": str(purchase_order_id), "receiptId": receipt_id, "date": received_date.isoformat(),
                            "by": request.user.app_user.full_name or "", "companyId": company_id, "createdBy": actor, "createdAt": now}
                tx.update(po_ref, {"recq": float(cumulative), "status": new_status, "st": new_status,
                                   "rd": received_date.isoformat() if new_status == "RECEIVED" else live_po.get("rd"),
                                   "hist": history, "updatedAt": now})
                stock_updates = {"qty": float(current_stock + qty), "updatedAt": now}
                if "availableStock" in live_stock:
                    stock_updates["availableStock"] = float(Decimal(str(live_stock.get("availableStock") or 0)) + qty)
                tx.update(stock_ref, stock_updates)
                tx.create(receipt_ref, receipt)
                tx.create(movement_ref, movement)
                return {"receipt": receipt, "stock": float(current_stock + qty), "received": float(cumulative), "status": new_status}

            result = receive(txn)
            return Response({"success": True, **clean(result)}, status=201)
        except ValueError as exc:
            return Response({"error": str(exc)}, status=409)
        except (InvalidOperation, TypeError):
            return Response({"error": "Receipt quantity is invalid."}, status=400)
        except Exception as exc:
            return api_error(exc, "Unable to receive Purchase Order goods.")


class ModuleDataView(APIView):
    """Tenant-scoped Firestore CRUD for module records."""
    TEAM_MODULES = {
        "crm": {"department": "CRM", "head": {"crm"}, "roles": {Role.CRM}},
        "sales": {"department": "Sales Order", "head": {"salesorder", "sales"}, "roles": {Role.SALES}},
        "purchase": {"department": "Purchase & Trading", "head": {"purchasetrading", "purchase"}, "roles": {Role.PURCHASE}},
        "inventory": {"department": "Inventory", "head": {"inventory"}, "roles": {Role.INVENTORY}},
        "production": {"department": "Production", "head": {"production"}, "roles": {Role.PRODUCTION, Role.QUALITY_CONTROL}},
        "transport": {"department": "Transport", "head": {"transport"}, "roles": {Role.TRANSPORT}},
        "accounting": {"department": "Accounting", "head": {"accounting", "accountingfinance", "finance"}, "roles": {Role.ACCOUNTING_FINANCE}},
    }

    @staticmethod
    def _normalized_department(value):
        return re.sub(r"[^a-z0-9]", "", str(value or "").casefold())

    def _validate_team_member(self, request, module_name, data, current=None):
        """Keep team records scoped to the department head who owns them."""
        if data.get("recordType") != "teamMember" and not (current or {}).get("recordType") == "teamMember":
            return None
        config = self.TEAM_MODULES.get(module_name)
        if not config:
            return Response({"error": "Team members can only be stored in a department module."}, status=400)
        if current and current.get("departmentKey") and current.get("departmentKey") != module_name:
            return Response({"error": "This team member belongs to another department."}, status=403)
        if current and current.get("isDeleted"):
            return Response({"error": "Deleted team members cannot be changed."}, status=409)
        membership = request.user.membership
        role = membership.role
        actor = str(request.user.app_user.firebase_uid)
        is_admin = role == Role.ADMIN
        head_department = self._normalized_department(getattr(membership, "head_department", ""))
        # The CRM RBAC role itself is the CRM Department Head role. Keep its
        # records tenant scoped and owner scoped below, while allowing CRM
        # heads whose legacy membership has no head_department value to manage
        # their own CRM team records.
        is_crm_head = module_name == "crm" and role == Role.CRM
        if not is_admin and (role not in config["roles"] or (not is_crm_head and head_department not in config["head"])):
            return Response({"error": "Only this department's assigned head can manage its team members."}, status=403)
        existing_owner = str((current or {}).get("departmentHeadId") or "")
        if existing_owner and not is_admin and existing_owner != actor:
            return Response({"error": "You can only manage team members added by your department head account."}, status=403)

        original = dict(data)
        name = str(original.get("n") or original.get("name") or "").strip()
        email = str(original.get("e") or original.get("email") or "").strip().lower()
        phone = re.sub(r"\D", "", str(original.get("ph") or original.get("phone") or ""))
        designation = str(original.get("des") or original.get("designation") or "").strip()
        joining_date = str(original.get("jd") or original.get("joiningDate") or "").strip()
        status = str(original.get("status") or (current or {}).get("status") or "ACTIVE").upper()
        if not name or not email or not designation or not joining_date or not re.fullmatch(r"\d{10}", phone):
            return Response({"error": "Enter the member name, email, 10-digit phone, designation and joining date."}, status=400)
        if status not in {"ACTIVE", "INACTIVE"}:
            return Response({"error": "Account status must be Active or Inactive."}, status=400)
        if not re.fullmatch(r"\d{4}-\d{2}-\d{2}", joining_date):
            return Response({"error": "Joining date must use YYYY-MM-DD."}, status=400)
        try:
            datetime.strptime(joining_date, "%Y-%m-%d")
        except ValueError:
            return Response({"error": "Enter a valid joining date."}, status=400)
        record_id = str(original.get("id") or (current or {}).get("id") or "")
        for row in list_module_records(request.user.company.id, module_name):
            if (row.get("recordType") == "teamMember" and not row.get("isDeleted")
                    and str(row.get("id")) != record_id and str(row.get("e") or "").casefold() == email):
                return Response({"error": "A team member with this email already exists in this department."}, status=409)

        owner_id = existing_owner or actor
        owner_name = str((current or {}).get("departmentHeadName") or "")
        if is_admin and not current:
            department_head = next((row for row in list_members(request.user.company.id)
                                    if self._normalized_department(row.get("headDepartment")) in config["head"]), None)
            if department_head:
                owner_id = str(department_head.get("id") or owner_id)
                owner_name = str(department_head.get("fullName") or department_head.get("name") or "")
        data.clear()
        data.update({
            "id": record_id,
            "recordType": "teamMember",
            "n": name[:160],
            "e": email[:254],
            "ph": phone,
            "des": designation[:120],
            "jd": joining_date,
            "eid": str(original.get("eid") or record_id)[:128],
            "r": "Employee",
            "status": status,
            "isActive": status == "ACTIVE",
            "departmentKey": module_name,
            "department": config["department"],
            "departmentHeadId": owner_id,
            "departmentHeadName": str(owner_name or request.user.app_user.full_name or request.user.app_user.email or "")[:160],
        })
        return None

    def _validate_quotation(self, company_id, data, record_id=None):
        """Validate quotation arithmetic and numbers before writing shared records."""
        if data.get("recordType") != "quotation":
            if data.get("recordType") == "template" and not str(data.get("name") or "").strip():
                return Response({"error": "A quotation template name is required."}, status=400)
            return None
        # Pending/Approved are the current CRM -> Sales workflow values.
        # Keep legacy statuses readable and editable for existing records.
        valid_statuses = {"Draft", "Pending", "Pending Approval", "Sent", "Approved", "Accepted", "Rejected", "Expired"}
        if data.get("status") == "Converted" and data.get("salesOrderId") == "SO-" + str(record_id):
            valid_statuses.add("Converted")
        if data.get("status", "Draft") not in valid_statuses:
            return Response({"error": "Unsupported quotation status."}, status=400)
        number = str(data.get("number") or "").strip()
        items = data.get("items")
        if not number or not isinstance(items, list) or not items:
            return Response({"error": "A quotation number and at least one item are required."}, status=400)

        for existing in list_module_records(company_id, "quotations"):
            if (existing.get("recordType") == "quotation"
                    and existing.get("number") == number
                    and str(existing.get("id")) != str(record_id or "")):
                return Response({"error": "That quotation number is already in use."}, status=409)

        normalized_items = []
        computed_total = Decimal("0")
        for item in items:
            if not isinstance(item, dict):
                return Response({"error": "Each quotation item must be an object."}, status=400)
            try:
                quantity = Decimal(str(item.get("qty", "0")))
                rate = Decimal(str(item.get("rate", "0")))
                discount = Decimal(str(item.get("discount", "0")))
                gst = Decimal(str(item.get("gst", "0")))
            except (InvalidOperation, TypeError, ValueError):
                return Response({"error": "Quotation item amounts must be valid numbers."}, status=400)
            if (not all(value.is_finite() for value in (quantity, rate, discount, gst))
                    or quantity <= 0 or rate < 0 or discount < 0 or discount > 100 or gst < 0 or gst > 100):
                return Response({"error": "Quotation item quantity, rate, discount, or GST is invalid."}, status=400)
            discounted = quantity * rate * (Decimal("1") - discount / Decimal("100"))
            taxable = discounted / (Decimal("1") + gst / Decimal("100")) if data.get("gstInclusive") and gst else discounted
            normalized_items.append({**item, "value": float(taxable)})
            computed_total += taxable * (Decimal("1") + gst / Decimal("100"))
        data["items"] = normalized_items
        computed_total = computed_total.quantize(Decimal("0.01"), rounding=ROUND_HALF_UP)
        data["total"] = float(computed_total)
        return None

    @staticmethod
    def _quotation_snapshot(company_id, record_id, quote_id):
        """Read the exact company quotation for a lead, with legacy CRM- IDs."""
        records = (module_records_ref(company_id, "quotations"))
        quote_snap = records.document(str(quote_id)).get()
        if not quote_snap.exists and str(quote_id).startswith("CRM-"):
            quote_snap = records.document(str(quote_id)[4:]).get()
        return quote_snap

    def _allowed(self, request, module_name):
        return user_can_access_module(request.user, module_name)

    @staticmethod
    def _recover_legacy_transport_requests(company_id, records):
        """Backfill older Sales handoffs that predate company-scoped records."""
        company_id = str(company_id)
        existing_ids = {str(record.get("id") or "") for record in records}
        transport_records = module_records_ref(company_id, "transport")

        for order in list_module_records(company_id, "sales"):
            if order.get("recordType") != "salesOrder" or order.get("isDeleted"):
                continue
            request_id = str(order.get("transportRequestId") or "")
            if not request_id or request_id in existing_ids:
                continue

            request_ref = transport_records.document(request_id)
            request_snap = request_ref.get()
            if not request_snap.exists:
                continue
            transport_request = request_snap.to_dict() or {}
            request_company_id = str(transport_request.get("companyId") or "")
            if (
                transport_request.get("recordType") != "transportRequest"
                or transport_request.get("isDeleted")
                or str(transport_request.get("salesOrderId") or "") != str(order.get("id") or "")
                or (request_company_id and request_company_id != company_id)
            ):
                continue

            if not request_company_id:
                request_ref.update({"companyId": company_id, "module": "transport"})
                transport_request.update({"companyId": company_id, "module": "transport"})
            transport_request["id"] = request_id
            records.append(clean(transport_request))
            existing_ids.add(request_id)

        for transport_request in list(records):
            bill_id = str(transport_request.get("deliveryBillId") or "")
            if transport_request.get("recordType") != "transportRequest" or not bill_id or bill_id in existing_ids:
                continue
            bill_ref = transport_records.document(bill_id)
            bill_snap = bill_ref.get()
            if not bill_snap.exists:
                continue
            bill = bill_snap.to_dict() or {}
            bill_company_id = str(bill.get("companyId") or "")
            if (
                bill.get("recordType") != "deliveryBill"
                or bill.get("isDeleted")
                or str(bill.get("transportRequestId") or "") != str(transport_request.get("id") or "")
                or (bill_company_id and bill_company_id != company_id)
            ):
                continue
            if not bill_company_id:
                bill_ref.update({"companyId": company_id, "module": "transport"})
                bill.update({"companyId": company_id, "module": "transport"})
            bill["id"] = bill_id
            records.append(clean(bill))
            existing_ids.add(bill_id)
        return records

    @staticmethod
    def _recover_legacy_transport_bills(company_id, records):
        """Backfill bills linked to this company's Sales Orders."""
        company_id = str(company_id)
        existing_ids = {str(record.get("id") or "") for record in records}
        transport_records = module_records_ref(company_id, "transport")
        for order in list_module_records(company_id, "sales"):
            if order.get("recordType") != "salesOrder" or order.get("isDeleted"):
                continue
            order_id = str(order.get("id") or "")
            if not order_id:
                continue
            dispatch_id = str(order.get("dispatchId") or "")
            for bill_snap in transport_records.where("salesOrderId", "==", order_id).stream():
                bill_id = str(bill_snap.id)
                if bill_id in existing_ids:
                    continue
                bill = bill_snap.to_dict() or {}
                bill_company_id = str(bill.get("companyId") or "")
                if (
                    bill.get("recordType") != "transportBill"
                    or bill.get("isDeleted")
                    or (bill_company_id and bill_company_id != company_id)
                    or (dispatch_id and str(bill.get("dispatchId") or "") != dispatch_id)
                ):
                    continue
                if not bill_company_id:
                    transport_records.document(bill_id).update({"companyId": company_id, "module": "transport"})
                    bill.update({"companyId": company_id, "module": "transport"})
                bill["id"] = bill_id
                records.append(clean(bill))
                existing_ids.add(bill_id)
        return records

    @staticmethod
    def _recover_legacy_transport_accounting_requests(company_id, records):
        """Backfill hidden Accounting requests for company-linked Transport bills."""
        company_id = str(company_id)
        existing_ids = {str(record.get("id") or "") for record in records}
        bills = ModuleDataView._recover_legacy_transport_bills(
            company_id, list_module_records(company_id, "transport"),
        )
        accounting_records = module_records_ref(company_id, "accounting")
        for bill in bills:
            if bill.get("recordType") != "transportBill" or bill.get("isDeleted"):
                continue
            request_id = "TBR-" + str(bill.get("id") or "")[3:]
            if request_id in existing_ids:
                continue
            request_ref = accounting_records.document(request_id)
            request_snap = request_ref.get()
            if not request_snap.exists:
                continue
            row = request_snap.to_dict() or {}
            if (row.get("recordType") != "transportAccountingRequest"
                    or str(row.get("sourceId") or "") != str(bill.get("id") or "")
                    or row.get("isDeleted")):
                continue
            if not row.get("companyId"):
                request_ref.update({"companyId": company_id, "module": "accounting"})
                row.update({"companyId": company_id, "module": "accounting"})
            row["id"] = request_id
            records.append(clean(row))
            existing_ids.add(request_id)
        return records

    @staticmethod
    def _module_record_ref(company_id, module_name, record_id):
        return (module_records_ref(company_id, module_name).document(record_id))

    def _validate_catalog_product(self, company_id, data, record_id=None):
        """Keep catalog records to quote-safe product and pricing fields."""
        incoming_id = str(data.get("id") or "").strip()
        # The single custom-field-definition record (recordType "customFields")
        # is stored in the same catalog module; validate it separately and
        # never mix it with product records.
        if data.get("recordType") == "customFields":
            fields = data.get("fields")
            if not isinstance(fields, list) or not fields:
                return Response({"error": "At least one custom field is required."}, status=400)
            cleaned = []
            for field in fields[:100]:
                if not isinstance(field, dict):
                    continue
                label = str(field.get("label") or "").strip()
                if not label:
                    continue
                cleaned.append({
                    "id": str(field.get("id") or "")[:64],
                    "label": label[:80],
                    "type": str(field.get("type") or "text")[:20],
                    "required": bool(field.get("required")),
                    "visible": field.get("visible", True) is not False,
                    "options": [str(o)[:80] for o in (field.get("options") or [])][:50],
                    "defaultValue": field.get("defaultValue", ""),
                })
            if not cleaned:
                return Response({"error": "At least one valid custom field is required."}, status=400)
            data.clear()
            data.update({"recordType": "customFields", "fields": cleaned})
            if incoming_id:
                data["id"] = incoming_id
            return None
        original = dict(data)
        name = str(original.get("name") or "").strip()
        code = str(original.get("code") or "").strip()
        if not name:
            return Response({"error": "A product name is required."}, status=400)
        try:
            rate = Decimal(str(original.get("rate", "0")))
            gst = Decimal(str(original.get("gst", original.get("gstRate", "0"))))
            discount = Decimal(str(original.get("discount", "0")))
        except (InvalidOperation, TypeError, ValueError):
            return Response({"error": "Rate, GST, and discount must be valid numbers."}, status=400)
        if (not all(value.is_finite() for value in (rate, gst, discount))
                or rate < 0 or gst < 0 or gst > 100 or discount < 0 or discount > 100):
            return Response({"error": "Rate, GST, or discount is outside the allowed range."}, status=400)
        for existing in list_module_records(company_id, "catalog"):
            if (code and existing.get("recordType") == "product"
                    and str(existing.get("code") or "").casefold() == code.casefold()
                    and str(existing.get("id")) != str(record_id or "")
                    and not existing.get("isDeleted")):
                return Response({"error": "That product code is already in use."}, status=409)
        # Explicitly allow-list fields so stock, cost, and internal inventory
        # details can never leak into the CRM-facing catalog response.
        data.clear()
        data.update({
            "recordType": "product",
            "name": name[:180],
            "code": code[:64],
            "description": str(original.get("description") or "")[:2000],
            "unit": str(original.get("unit") or "Nos")[:32],
            "hsn": str(original.get("hsn") or "")[:32],
            "rate": float(rate),
            "gst": float(gst),
            "discount": float(discount),
            "isActive": original.get("isActive", True) is not False,
        })
        if incoming_id:
            data["id"] = incoming_id
        return None

    @staticmethod
    def _recover_legacy_production_orders(company_id, records):
        """Recover only ownerless legacy orders with verified same-company links.

        Production data lives in a shared top-level Firestore collection. A
        missing companyId is not ownership evidence, so never claim an order
        simply because it appeared in a collection scan. The request/plan must
        point back to this exact document, and every supplied source link must
        belong to this company.
        """
        started_at = perf_counter()
        company_id = str(company_id)
        production_ref = module_records_ref(company_id, "production")
        known_ids = {str(record.get("id") or "") for record in records}
        snapshots = list(production_ref.limit(5000).stream())
        recovered = 0
        for snap in snapshots:
            data = snap.to_dict() or {}
            record_id = str(snap.id)
            if (record_id in known_ids or data.get("companyId") or data.get("isDeleted")
                    or not _is_work_order_record(data)):
                continue

            verified_links = 0
            links_valid = True
            for field, expected_type in (("productionRequestId", "productionRequest"),
                                         ("materialPlanId", "materialPlan")):
                linked_id = str(data.get(field) or "")
                if not linked_id:
                    continue
                linked_snap = production_ref.document(linked_id).get()
                linked = linked_snap.to_dict() or {} if linked_snap.exists else {}
                if (linked.get("recordType") != expected_type or linked.get("isDeleted")
                        or str(linked.get("companyId") or "") != company_id
                        or str(linked.get("productionOrderId") or "") != record_id):
                    links_valid = False
                    break
                verified_links += 1

            sales_order_id = str(data.get("salesOrderId") or "")
            if links_valid and sales_order_id:
                sales_snap = module_records_ref(company_id, "sales").document(sales_order_id).get()
                sales_order = sales_snap.to_dict() or {} if sales_snap.exists else {}
                if (sales_order.get("recordType") != "salesOrder" or sales_order.get("isDeleted")
                        or str(sales_order.get("companyId") or "") != company_id):
                    links_valid = False

            if not links_valid or not verified_links:
                continue
            production_ref.document(record_id).update({"companyId": company_id, "module": "production"})
            records.append(clean({**data, "id": record_id, "companyId": company_id,
                                  "module": "production"}))
            known_ids.add(record_id)
            recovered += 1

        logger.info("Production legacy recovery: recovered=%d scanned=%d duration_ms=%.2f",
                    recovered, len(snapshots), (perf_counter() - started_at) * 1000)
        return records

    @staticmethod
    def _attach_production_start_eligibility(company_id, records):
        """Add a read-only eligibility summary while keeping POST authoritative."""
        orders = [record for record in records
                  if _is_work_order_record(record) and not record.get("isDeleted")]
        startable = [record for record in orders
                     if str(record.get("st") or record.get("status") or "PLANNED").upper()
                     in {"PLANNED", "READY"}]
        plan_ids = sorted({str(record.get("materialPlanId")) for record in startable
                           if record.get("materialPlanId")})
        sales_ids = sorted({str(record.get("salesOrderId")) for record in startable
                            if record.get("salesOrderId")})
        plans, sales_orders = {}, {}
        lookup_failed = False
        try:
            if plan_ids:
                refs = [module_records_ref(company_id, "production").document(record_id)
                        for record_id in plan_ids]
                plans = {str(snap.id): (snap.to_dict() or {})
                         for snap in get_db().get_all(refs) if snap.exists}
            if sales_ids:
                refs = [module_records_ref(company_id, "sales").document(record_id)
                        for record_id in sales_ids]
                sales_orders = {str(snap.id): (snap.to_dict() or {})
                                for snap in get_db().get_all(refs) if snap.exists}
        except Exception:
            lookup_failed = True
            logger.exception("Unable to load Production Order Start eligibility references")

        for order in orders:
            order_id = str(order.get("id") or "")
            order["startEligibility"] = _production_start_eligibility(
                order, company_id,
                plan=plans.get(str(order.get("materialPlanId") or "")),
                sales_order=sales_orders.get(str(order.get("salesOrderId") or "")),
                linked_records_unavailable=lookup_failed,
            )
            # Do not treat a legacy stored ID as canonical when Firestore has
            # normalized the response to the actual document ID.
            order["startEligibility"]["orderId"] = order_id
        return records

    def get(self, request, module_name):
        module_name = str(module_name or "").strip().lower()
        sales_customer_lookup = (
            module_name == "crm"
            and request.user.membership.role == Role.SALES
        )

        sales_quote_lookup = (
            module_name == "quotations"
            and request.user.membership.role == Role.SALES
        )

        sales_production_lookup = (
            module_name == "production"
            and request.user.membership.role in {Role.SALES, Role.ADMIN, Role.PRODUCTION, Role.QUALITY_CONTROL}
        )
        inventory_planning_lookup = (
            module_name == "production"
            and request.user.membership.role == Role.INVENTORY
        )
        purchase_inventory_lookup = (
            module_name == "inventory"
            and request.user.membership.role == Role.PURCHASE
        )
        business_accounting_lookup = (
            module_name == "accounting"
            and request.user.membership.role in {Role.PURCHASE, Role.TRANSPORT}
        )

        if (
            not self._allowed(request, module_name)
            and request.user.membership.role != Role.ADMIN
            and not business_accounting_lookup
            and not sales_customer_lookup
            and not sales_quote_lookup
            and not sales_production_lookup
            and not inventory_planning_lookup
            and not purchase_inventory_lookup
            and not (module_name == "inventory" and request.user.membership.role in {Role.PRODUCTION, Role.QUALITY_CONTROL})
        ):
             return Response({"error": "Forbidden for this module."}, status=403)
        try:
            # Production shares one Firestore collection for work orders,
            # requests, material plans and movements. Keep orders from being
            # omitted when the module has grown beyond the usual 500-record
            # response used by the other modules.
            module_read_started_at = perf_counter()
            records = list_module_records(
                request.user.company.id,
                module_name,
                limit=5000 if module_name == "production" else 500,
            )
            module_read_duration_ms = (perf_counter() - module_read_started_at) * 1000
            if module_name == "production":
                records = self._recover_legacy_production_orders(request.user.company.id, records)
                if request.user.membership.role in {Role.PRODUCTION, Role.ADMIN}:
                    self._attach_production_start_eligibility(request.user.company.id, records)
                logger.info("Production module read: records=%d firestore_read_ms=%.2f",
                            len(records), module_read_duration_ms)
            if module_name == "transport":
                records = self._recover_legacy_transport_requests(request.user.company.id, records)
                records = self._recover_legacy_transport_bills(request.user.company.id, records)
            elif module_name == "accounting":
                records = self._recover_legacy_transport_accounting_requests(request.user.company.id, records)
            if module_name in self.TEAM_MODULES:
                if request.user.membership.role != Role.ADMIN:
                    config = self.TEAM_MODULES[module_name]
                    actor = str(request.user.app_user.firebase_uid)
                    head_department = self._normalized_department(getattr(request.user.membership, "head_department", ""))
                    is_crm_head = module_name == "crm" and request.user.membership.role == Role.CRM
                    can_view_team = (request.user.membership.role in config["roles"]
                                     and (is_crm_head or head_department in config["head"]))
                    records = [record for record in records
                               if record.get("recordType") != "teamMember"
                               or (can_view_team and str(record.get("departmentHeadId") or "") == actor
                                   and record.get("departmentKey") == module_name)]
                else:
                    records = [record for record in records
                               if record.get("recordType") != "teamMember"
                               or record.get("departmentKey") == module_name]
            if inventory_planning_lookup:
                plan_fields = {"id", "recordType", "productionRequestId", "requestCode", "materialRequestNo", "reviewRound", "salesOrderId", "salesOrderNumber",
                               "productId", "productName", "plannedQuantity", "planningDate", "materialRequiredByDate", "priority", "remarks",
                               "productionRequestNo", "productionOrderId",
                               "materials", "approvalStatus", "status", "materialAvailabilityStatus", "inventoryVerificationStatus", "reviewHistory",
                               "submittedByName", "createdByName", "createdAt", "approvedAt", "rejectionReason", "productionOrderId", "isDeleted",
                               "sentToInventoryAt", "sentToInventoryBy"}
                records = [{key: value for key, value in record.items() if key in plan_fields}
                           for record in records if record.get("recordType") == "materialPlan" and not record.get("isDeleted")
                           and (record.get("sentToInventoryAt") or record.get("approvalStatus") in {"Pending", "Approved", "Rejected"})]
            if module_name == "inventory" and request.user.membership.role in {Role.PRODUCTION, Role.QUALITY_CONTROL}:
                # Material planning needs stock quantities, not inventory management data.
                stock_fields = {"id", "recordType", "code", "itemCode", "name", "itemName", "n", "category", "unit", "uom",
                                "qty", "availableStock", "reservedStock", "warehouse", "ro", "reorderLevel", "isDeleted"}
                records = [{key: value for key, value in record.items() if key in stock_fields}
                           for record in records
                           if record.get("recordType") == "stockItem" and not record.get("isDeleted")]
            if purchase_inventory_lookup:
                # Purchase can select existing stock items without seeing inventory cost or control data.
                stock_fields = {"id", "recordType", "code", "itemCode", "name", "itemName", "n", "unit", "uom", "qty", "availableStock", "hsn", "gst", "isDeleted"}
                records = [{key: value for key, value in record.items() if key in stock_fields}
                           for record in records if record.get("recordType") == "stockItem" and not record.get("isDeleted")]
            if business_accounting_lookup:
                # Department users may refresh the records they submitted, but
                # never read accounting entries, invoices, or other departments' requests.
                allowed_request_type = ("purchaseAccountingRequest" if request.user.membership.role == Role.PURCHASE
                                        else "transportAccountingRequest")
                records = [{key: value for key, value in record.items() if key not in {"paidAmount", "balanceDue", "paymentHistory"}}
                           for record in records if record.get("recordType") == allowed_request_type and not record.get("isDeleted")]
            if sales_quote_lookup:
                records = [record for record in records
                           if str(record.get("recordType") or "").casefold() == "quotation"
                           and not record.get("isDeleted")]
                safe_fields = {"id", "recordType", "number", "leadId", "clientId", "clientName", "clientContact",
                               "clientEmail", "clientAddress", "clientGst", "date", "validUntil", "items", "total",
                               "notes", "terms", "status", "salesOrderId", "isDeleted", "gstInclusive", "unit",
                               "createdAt", "updatedAt", "reviewedAt", "reviewedBy"}
                records = [{key: value for key, value in record.items() if key in safe_fields}
                           for record in records]
            if sales_customer_lookup:
                safe_fields = {"id", "recordType", "type", "name", "contact", "email", "address", "gstin", "gst",
                               "isActive", "active", "isDeleted", "status", "st", "convertedQuotationId"}
                inactive_statuses = {"inactive", "deactivated", "archived", "deleted"}
                records = [
                    {key: value for key, value in record.items() if key in safe_fields}
                    for record in records
                    if (str(record.get("recordType") or "").casefold() == "customer"
                        or (str(record.get("recordType") or "").casefold() in {"", "lead"}
                            and str(record.get("type") or "").casefold() == "customer"))
                    and not record.get("isDeleted")
                    and record.get("isActive", True) is not False
                    and record.get("active", True) is not False
                    and str(record.get("status") or record.get("st") or "").casefold() not in inactive_statuses
                ]
            if module_name.lower() == "catalog":
                # CRM sees only active products; Admin and Sales also see
                # inactive rows so they can reactivate or remove them.
                all_records = records
                products = [record for record in all_records
                            if record.get("recordType") == "product"
                            and (request.user.membership.role != Role.CRM or record.get("isActive", True))
                            and not record.get("isDeleted")]
                # Product custom-field definitions are safe to read and are
                # required by all authorized catalog consumers.
                definitions = [record for record in all_records
                               if record.get("recordType") == "customFields"
                               and not record.get("isDeleted")]
                if request.user.membership.role == Role.CRM:
                    safe_fields = {"id", "recordType", "name", "code", "description", "unit", "hsn",
                                   "rate", "gst", "discount", "isActive"}
                    products = [{key: value for key, value in record.items() if key in safe_fields}
                                for record in products]
                    definitions = [{key: value for key, value in record.items()
                                    if key in {"id", "recordType", "fields"}}
                                   for record in definitions]
                records = products + definitions
            return Response({"module": module_name, "companyId": str(request.user.company.id), "records": records})
        except Exception as exc:
            return api_error(exc, "Unable to load module records.")

    def post(self, request, module_name):
        module_name = str(module_name or "").strip().lower()
        data = request.data.copy()
        crm_request_key = ""
        crm_request_fingerprint = ""
        if module_name == "crm" and data.get("recordType") == "lead":
            crm_request_key = str(data.get("idempotencyKey") or "").strip()
            if crm_request_key:
                fingerprint_payload = {key: value for key, value in data.items() if key != "idempotencyKey"}
                crm_request_fingerprint = hashlib.sha256(json.dumps(
                    fingerprint_payload, sort_keys=True, separators=(",", ":"), default=str,
                ).encode("utf-8")).hexdigest()
        if module_name == "transport" and data.get("recordType") == "transportBill":
            return Response({"error": "Transport Bills must be created through the Accounting submission workflow."}, status=403)
        if module_name == "purchase" and data.get("recordType") == "purchaseOrder":
            _normalize_purchase_order_history(data)
            data["status"] = data["st"] = "DRAFT"
            for protected in ("accountingApprovalStatus", "accountingDecisionReason", "accountingRequestId", "approvedBy", "approvedAt"):
                data.pop(protected, None)
        if module_name == "production" and _is_work_order_record(data):
            return Response({"error": "Production Orders must be created through an Inventory-approved Material Plan."}, status=403)
        # Sales sends a Sales Order to Production from the Sales Order screen.
        # That is the only Production write Sales may perform; every other
        # Production action stays with Production, QC and Admin.
        sales_production_handoff = (module_name == "production"
                                    and request.user.membership.role == Role.SALES
                                    and data.get("recordType") == "productionRequest")
        if not self._allowed(request, module_name) and not sales_production_handoff:
            return Response({"error": "Forbidden for this module."}, status=403)
        if crm_request_key:
            existing_lead = next((record for record in list_module_records(request.user.company.id, "crm")
                                  if record.get("recordType") == "lead"
                                  and not record.get("isDeleted")
                                  and str(record.get("clientRequestId") or "") == crm_request_key), None)
            if existing_lead:
                if existing_lead.get("requestFingerprint") == crm_request_fingerprint:
                    return Response({"success": True, "record": clean(existing_lead)}, status=200)
                return Response({"error": "This lead creation request was already used with different data."}, status=409)
            data["clientRequestId"] = crm_request_key
            data["requestFingerprint"] = crm_request_fingerprint
            data.pop("idempotencyKey", None)
        if module_name.lower() == "catalog":
            if request.user.membership.role not in {Role.ADMIN, Role.SALES}:
                return Response({"error": "CRM can view the product catalog but cannot change it."}, status=403)
            invalid = self._validate_catalog_product(request.user.company.id, data)
            if invalid:
                return invalid
        if module_name.lower() == "quotations":
            if request.user.membership.role not in {Role.ADMIN, Role.CRM}:
                return Response({"error": "Only CRM or Admin can create quotation records."}, status=403)
            if data.get("recordType") not in {"quotation", "template"}:
                return Response({"error": "Unsupported quotation record type."}, status=400)
            if data.get("recordType") == "quotation" and str(data.get("status") or "").casefold() in {"approved", "accepted"}:
                return Response({"error": "Only an authorized Sales user can approve a quotation."}, status=403)
        team_error = self._validate_team_member(request, module_name, data)
        if team_error:
            return team_error
        if module_name == "crm" and data.get("recordType") == "lead":
            assigned_id = str(data.get("assignedToId") or "").strip()
            assigned = next((row for row in list_module_records(request.user.company.id, "crm")
                             if row.get("recordType") == "teamMember"
                             and str(row.get("id") or "") == assigned_id
                             and not row.get("isDeleted") and row.get("isActive", True)
                             and str(row.get("status") or "ACTIVE").upper() == "ACTIVE"), None)
            if not assigned:
                return Response({"error": "Select an active CRM team member for this lead."}, status=400)
            data["by"] = str(assigned.get("n") or assigned.get("name") or "")
        record_id = str(data.get("id") or uuid.uuid4())
        if module_name == "crm" and data.get("recordType") == "lead":
            existing_ref = self._module_record_ref(request.user.company.id, "crm", record_id)
            existing_snap = existing_ref.get()
            if existing_snap.exists:
                existing_record = existing_snap.to_dict() or {}
                if existing_record.get("crmNo"):
                    data["crmNo"] = existing_record["crmNo"]
            else:
                data["crmNo"] = next_crm_number(request.user.company.id)
                # Use the company-scoped display number as the Firestore key as
                # well, so CRM IDs shown to users are stable CRM-001 values.
                # Keep legacy IDs on updates and retries to avoid moving docs.
                data["id"] = data["crmNo"]
                record_id = data["id"]
        if not record_id or len(record_id) > 128 or "/" in record_id or record_id in {".", ".."}:
            return Response({"error": "Invalid record ID."}, status=400)
        data.pop("companyId", None)
        data.pop("module", None)
        is_production_handoff = (module_name == "production" and data.get("recordType") == "productionRequest")
        if is_production_handoff and request.user.membership.role != Role.SALES:
            return Response({"error": "Only Sales can create a Production Request from a Sales Order."}, status=403)
        if is_production_handoff:
            return Response({"error": "Production Requests are released only by Accounting approval."}, status=403)
        if module_name.lower() == "production" and data.get("recordType") == "materialPlan":
            if request.user.membership.role not in {Role.ADMIN, Role.PRODUCTION}:
                return Response({"error": "Only Production or Admin can create a Material Plan."}, status=403)
            request_id = str(data.get("productionRequestId") or "").strip()
            duplicate_plan = next((record for record in list_module_records(request.user.company.id, "production")
                                   if record.get("recordType") == "materialPlan" and not record.get("isDeleted")
                                   and str(record.get("productionRequestId")) == request_id
                                   and str(record.get("id")) != str(data.get("id") or "")), None)
            if duplicate_plan:
                return Response({"error": "This Production Request already has a Raw Material Planning record."}, status=409)
            request_ref = self._module_record_ref(request.user.company.id, "production", request_id)
            request_snap = request_ref.get()
            source = request_snap.to_dict() or {} if request_snap.exists else {}
            if (not request_snap.exists or source.get("recordType") != "productionRequest"
                    or source.get("isDeleted")
                    or str(source.get("companyId") or "") != str(request.user.company.id)):
                return Response({"error": "A valid Production Request is required for this Material Plan."}, status=400)
            if not re.fullmatch(r"PRD-(\d+)", str(source.get("requestCode") or ""), re.IGNORECASE):
                return Response({"error": "A valid Production Request number is required before material planning."}, status=400)
            if not isinstance(data.get("materials"), list):
                return Response({"error": "Material Plan materials must be a list."}, status=400)
            prior_plan_snap = self._module_record_ref(request.user.company.id, "production", record_id).get()
            prior_plan = prior_plan_snap.to_dict() or {} if prior_plan_snap.exists else {}
            data.update({"salesOrderId": source.get("salesOrderId"), "salesOrderNumber": source.get("salesOrderNumber"),
                         "requestCode": source.get("requestCode"), "productionRequestNo": source.get("requestCode"),
                         "status": "Draft", "approvalStatus": "Draft", "reviewRound": int(data.get("reviewRound") or 1)})
            for protected in ("approvedBy", "approvedAt", "reviewedBy", "reviewedAt", "productionOrderId", "rejectionReason",
                              "sentToInventoryAt", "sentToInventoryBy", "materialRequestNo"):
                data.pop(protected, None)
            data["productionOrderId"] = source.get("productionOrderId") or ""
            data["materialRequestNo"] = prior_plan.get("materialRequestNo") or next_material_request_number(request.user.company.id)
            try:
                plan_quantity = Decimal(str(data.get("plannedQuantity") or source.get("quantity") or "0"))
                if not plan_quantity.is_finite() or plan_quantity <= 0:
                    raise ValueError("invalid quantity")
                request_items = [item for item in (source.get("items") or []) if isinstance(item, dict)]
                selected_product = str(data.get("productId") or "")
                selected_line = next((item for item in request_items
                                      if str(item.get("itemId") or item.get("productId") or item.get("id") or "") == selected_product), None)
                if not selected_line:
                    return Response({"error": "Select an item that belongs to this Production Request."}, status=400)
                line_quantity = Decimal(str(selected_line.get("quantity", selected_line.get("qty", 0)) or 0))
                if not line_quantity.is_finite() or plan_quantity > line_quantity:
                    return Response({"error": "Planned quantity cannot exceed the selected Production Request item quantity."}, status=400)
                data["productId"] = selected_product
                data["productName"] = selected_line.get("productName") or selected_line.get("itemName") or selected_line.get("description") or ""
                data["productCode"] = selected_line.get("itemCode") or selected_line.get("productCode") or selected_line.get("code") or ""
                for material in data["materials"]:
                    if not isinstance(material, dict):
                        raise ValueError("material must be an object")
                    per_unit = Decimal(str(material.get("quantityPerUnit") or "0"))
                    wastage = Decimal(str(material.get("wastagePercent") or "0"))
                    available = Decimal(str(material.get("availableStock") or "0"))
                    reserved = Decimal(str(material.get("reservedStock") or "0"))
                    if (not all(value.is_finite() for value in (per_unit, wastage, available, reserved))
                            or per_unit < 0 or wastage < 0 or wastage > 100 or available < 0 or reserved < 0):
                        raise ValueError("material values out of range")
                    has_production_quantity = "requiredQty" in material
                    manual_required = Decimal(str(material.get("requiredQty", material.get("requiredQuantity", "0")) or "0"))
                    incoming = Decimal(str(material.get("expectedIncomingStock") or "0"))
                    rate = Decimal(str(material.get("estimatedUnitRate") or "0"))
                    if not all(value.is_finite() and value >= 0 for value in (manual_required, incoming, rate)):
                        raise ValueError("manual material values out of range")
                    base_requirement = manual_required if manual_required > 0 else per_unit * plan_quantity
                    estimated_wastage = (Decimal("0") if has_production_quantity else base_requirement * wastage / Decimal("100"))
                    total_required = manual_required if has_production_quantity else base_requirement + estimated_wastage
                    net_available = max(Decimal("0"), available - reserved)
                    shortage = max(Decimal("0"), total_required - net_available)
                    purchase_quantity = max(Decimal("0"), shortage - incoming)
                    material.update({"requiredQty": float(total_required), "requiredQuantity": float(total_required),
                                     "totalBomRequirement": float(base_requirement), "estimatedWastage": float(estimated_wastage),
                                     "totalRequiredQuantity": float(total_required), "netAvailableStock": float(net_available),
                                     "shortageQuantity": float(shortage),
                                     "purchaseQuantity": float(purchase_quantity), "estimatedAmount": float(purchase_quantity * rate),
                                     "suggestedPurchaseQuantity": float(purchase_quantity),
                                     "productionRequestId": request_id,
                                     "productionRequestNo": source.get("requestCode"),
                                     "productionOrderId": source.get("productionOrderId") or "",
                                     "availabilityStatus": "Available" if shortage == 0 else ("Partial Availability" if net_available > 0 else "Shortage")})
            except (InvalidOperation, TypeError, ValueError):
                return Response({"error": "Material plan quantity and stock data must be valid non-negative numbers."}, status=400)
            data["plannedQuantity"] = float(plan_quantity)
            data["materialAvailabilityStatus"] = "Unverified"
            data["inventoryVerificationStatus"] = "Not Checked"
            for material in data["materials"]:
                material["availabilityStatus"] = "Unverified"

        is_production_handoff = (module_name == "production" and data.get("recordType") == "productionRequest")
        if is_production_handoff and request.user.membership.role != Role.SALES:
            return Response({"error": "Only Sales can create a Production Request from a Sales Order."}, status=403)

        try:
            if is_production_handoff:
                sales_order_id = str(data.get("salesOrderId") or "").strip()
                if not sales_order_id:
                    return Response({"error": "A Sales Order reference is required."}, status=400)
                sales_order_ref = self._module_record_ref(request.user.company.id, "sales", sales_order_id)
                sales_order_snap = sales_order_ref.get()
                sales_order = sales_order_snap.to_dict() or {} if sales_order_snap.exists else {}
                if (not sales_order_snap.exists or sales_order.get("recordType") != "salesOrder"
                        or sales_order.get("isDeleted")
                        or str(sales_order.get("companyId") or "") != str(request.user.company.id)):
                    return Response({"error": "The Sales Order is not available in this company."}, status=400)
                if str(sales_order.get("status") or "").strip().upper() not in {"CONFIRMED", "ADVANCE_PENDING", "IN_PRODUCTION"}:
                    return Response({"error": "Only a confirmed Sales Order can be sent to Production."}, status=400)
                source_items = [item for item in (sales_order.get("items") or []) if isinstance(item, dict)]
                requested_items = data.get("items") if isinstance(data.get("items"), list) else []
                requested_ids = {str(item.get("itemId") or item.get("productId") or "")
                                 for item in requested_items if isinstance(item, dict)}
                source_ids = {str(item.get("productId") or item.get("i") or "") for item in source_items}
                if (not source_items or not requested_items
                        or any(not isinstance(item, dict) for item in requested_items)
                        or (requested_ids and requested_ids != source_ids)):
                    return Response({"error": "Production Request items must match all Sales Order product lines."}, status=400)
                duplicate = next((record for record in list_module_records(request.user.company.id, "production")
                                  if record.get("recordType") == "productionRequest" and not record.get("isDeleted")
                                  and str(record.get("salesOrderId")) == sales_order_id), None)
                if duplicate:
                    return Response({"error": "This Sales Order already has a Production Request.",
                                     "requestCode": duplicate.get("requestCode"), "record": duplicate}, status=409)
                request_items = []
                for item in source_items:
                    line = dict(item)
                    line.update({"itemId": str(item.get("productId") or item.get("i") or ""),
                                 "itemCode": str(item.get("code") or item.get("itemCode") or item.get("productCode") or ""),
                                 "itemName": item.get("productName") or item.get("description") or "Item",
                                 "quantity": item.get("qty", item.get("quantity", 0)),
                                 "unit": item.get("uom") or item.get("unit") or "Nos",
                                 "rate": item.get("rate", item.get("r", 0))})
                    request_items.append(line)
                if any(not line["itemId"] or float(line["quantity"] or 0) <= 0 for line in request_items):
                    return Response({"error": "Every Sales Order line requires a product and positive quantity."}, status=400)
                first = request_items[0]
                data.update({"items": request_items,
                             "productCode": first["itemCode"], "productName": first["itemName"],
                             "quantity": first["quantity"], "unit": first["unit"],
                             "salesOrderId": sales_order_id,
                             "salesOrderNumber": sales_order.get("orderNumber") or sales_order_id,
                             "customerId": sales_order.get("customerId", ""), "customerName": sales_order.get("customerName", ""),
                             "deliveryDate": sales_order.get("deliveryDate") or sales_order.get("dd") or "",
                             "requiredCompletionDate": sales_order.get("deliveryDate") or sales_order.get("dd") or "",
                             "priority": sales_order.get("priority") or data.get("priority") or "Medium",
                             "requestCode": next_production_request_code(request.user.company.id),
                             "status": "Pending Review", "requestDate": now_iso()[:10],
                             "requestedBy": request.user.app_user.full_name or "",
                             "remarks": str(data.get("remarks") or "")[:2000]})
                batch = get_db().batch()
                request_ref = self._module_record_ref(request.user.company.id, "production", record_id)
                batch.create(request_ref, {**data, "id": record_id, "companyId": str(request.user.company.id),
                                           "module": "production", "createdAt": now_iso(), "updatedAt": now_iso(),
                                           "createdBy": str(request.user.app_user.firebase_uid)})
                batch.update(sales_order_snap.reference, {"productionStatus": "PLANNED", "prdCode": data["requestCode"],
                                                           "prdSentAt": data["requestDate"], "prdSentBy": data["requestedBy"]})
                batch.commit()
                saved = request_ref.get().to_dict() or {}
                return Response({"success": True, "record": clean({**saved, "id": record_id})}, status=201)

            if module_name.lower() == "sales" and data.get("recordType") == "salesOrder":
                data["received"] = 0
                data["paymentStatus"] = data.get("paymentStatus") or "UNPAID"
                data.pop("orderNumber", None)
                customer_id = str(data.get("customerId") or data.get("crm") or "").strip()
                if not customer_id:
                    return Response({"error": "Select an active CRM customer for this Sales Order."}, status=400)
                sales_records = (module_records_ref(request.user.company.id, "sales"))
                retry_snap = sales_records.document(record_id).get()
                retry_order = retry_snap.to_dict() or {} if retry_snap.exists else {}
                if retry_snap.exists:
                    existing_order = retry_order
                    return Response({"success": True, "record": clean({**existing_order, "id": record_id})}, status=200)
                customer_ref = (module_records_ref(request.user.company.id, "crm").document(customer_id))
                customer_snap = customer_ref.get()
                # CRM document IDs may themselves begin with "CRM-". Resolve
                # the exact document first, then keep compatibility with older
                # UI mappings that stored the prefix outside the document ID.
                if not customer_snap.exists and customer_id.startswith("CRM-"):
                    legacy_id = customer_id[4:]
                    legacy_ref = (module_records_ref(request.user.company.id, "crm").document(legacy_id))
                    legacy_snap = legacy_ref.get()
                    if legacy_snap.exists:
                        customer_id, customer_ref, customer_snap = legacy_id, legacy_ref, legacy_snap
                matching_retry = (retry_snap.exists
                                  and retry_order.get("recordType") == "salesOrder"
                                  and str(retry_order.get("customerId") or "") == customer_id)
                if not customer_snap.exists and not matching_retry:
                    return Response({"error": "The selected CRM customer is not available in this company."}, status=400)
                customer = customer_snap.to_dict() or {}
                customer_type = str(customer.get("type") or "").strip().casefold()
                customer_record_type = str(customer.get("recordType") or "").strip().casefold()
                customer_status = str(customer.get("status") or customer.get("st") or "").strip().casefold()
                inactive_statuses = {"inactive", "deactivated", "archived", "deleted"}
                is_customer = (customer_record_type == "customer"
                               or (customer_record_type in {"", "lead"} and customer_type == "customer"))
                is_active = (not customer.get("isDeleted")
                             and customer.get("isActive", True) is not False
                             and customer.get("active", True) is not False
                             and customer_status not in inactive_statuses)
                if (not is_customer or not is_active) and not matching_retry:
                    return Response({"error": "Only an active CRM customer can be selected for a new Sales Order."}, status=400)
                data["customerId"] = customer_id
                data["customerName"] = str(customer.get("name") or retry_order.get("customerName") or data.get("customerName") or "")
                quotation_id = str(data.get("quotationId") or "").strip()
                source_record = {}
                # Sales Orders may be created directly from the order form or
                # converted from an accepted quotation. Apply quote-based
                # idempotency and validation only to the latter; standalone
                # orders still use the stable document ID and atomic create
                # below to make retries safe.
                existing_order = sales_records.document(record_id).get()
                if existing_order.exists:
                    current_order = existing_order.to_dict() or {}
                    if current_order.get("recordType") == "salesOrder":
                        return Response({"success": True, "record": clean({**current_order, "id": record_id})}, status=200)
                    return Response({"error": "The requested Sales Order ID is already in use."}, status=409)
                if quotation_id:
                    matching_orders = (module_records_ref(request.user.company.id, "sales")
                                       .where("quotationId", "==", quotation_id).limit(2).stream())
                    for matching_order in matching_orders:
                        current_order = matching_order.to_dict() or {}
                        if current_order.get("recordType") != "salesOrder":
                            continue
                        if matching_order.id == record_id:
                            return Response({"success": True,
                                             "record": clean({**current_order, "id": record_id})})
                        return Response({"error": "This quotation already has a Sales Order."}, status=409)
                    existing_order = module_records_ref(request.user.company.id, "sales").document(record_id).get()
                    if existing_order.exists:
                        current_order = existing_order.to_dict() or {}
                        if str(current_order.get("quotationId")) == quotation_id:
                            return Response({"success": True, "record": clean({**current_order, "id": record_id})})
                        return Response({"error": "The requested sales order ID is already in use."}, status=409)
                    source = module_records_ref(request.user.company.id, "quotations").document(quotation_id).get()
                    source_record = source.to_dict() or {} if source.exists else {}
                    if not source.exists or str(source_record.get("status") or "").casefold() not in {"approved", "accepted"}:
                        return Response({"error": "Only an approved quotation can be converted."}, status=400)
                    if str(source_record.get("clientId") or source_record.get("leadId") or "") != customer_id:
                        return Response({"error": "The Sales Order customer does not match its source quotation."}, status=400)
                if retry_snap.exists:
                    data["orderNumber"] = retry_order.get("orderNumber") or retry_order.get("id")
                else:
                    data["orderNumber"] = next_sales_order_number(request.user.company.id)
            if module_name.lower() == "quotations":
                invalid = self._validate_quotation(request.user.company.id, data)
                if invalid:
                    return invalid
            # Creation timestamps are server-owned. They remain immutable on
            # updates (PUT strips client createdAt and merges into this row).
            created_at = now_iso()
            payload = {
                **data,
                "id": record_id,
                "companyId": str(request.user.company.id),
                "module": module_name,
                "createdAt": created_at,
                "updatedAt": now_iso(),
            }
            if module_name == "quotations" and data.get("recordType") == "quotation":
                payload["generatedAt"] = created_at
            record_ref = self._module_record_ref(request.user.company.id, module_name, record_id)
            payload["createdBy"] = str(request.user.app_user.firebase_uid)
            if (module_name == "accounting" and payload.get("recordType") == "accountingEntry"
                    and payload.get("type") in {"RECEIPT", "PAYMENT"} and not payload.get("voucherNumber")):
                try:
                    voucher_date = date.fromisoformat(str(payload.get("date") or now_iso()[:10]))
                except ValueError:
                    return Response({"error": "Enter a valid receipt or payment date."}, status=400)
                voucher_type = "receiptVoucher" if payload.get("type") == "RECEIPT" else "paymentVoucher"
                voucher_prefix = _accounting_voucher_prefix("RV" if payload.get("type") == "RECEIPT" else "PV", voucher_date)
                voucher_number = _next_company_number(request.user.company.id, "accounting", voucher_type,
                                                      voucher_prefix, "accountingEntry", "voucherNumber")
                payload.update({"number": voucher_number, "voucherNumber": voucher_number})
            try:
                if module_name == "production" and data.get("recordType") == "materialPlan":
                    batch = get_db().batch()
                    batch.create(record_ref, payload)
                    batch.update(request_ref, {"status": "Material Planning", "materialPlanId": record_id})
                    batch.commit()
                else:
                    if module_name == "sales" and data.get("recordType") == "salesOrder":
                        # A Sales Order and its financial approval request are created together.
                        # Stable request IDs make client retries idempotent.
                        customer = customer_snap.to_dict() or {} if customer_snap.exists else {}
                        lines = [line for line in (data.get("items") or []) if isinstance(line, dict)]
                        try:
                            subtotal = Decimal("0")
                            discount_total = Decimal("0")
                            taxable_total = Decimal("0")
                            gst_total = Decimal("0")
                            customer_gstin = str(customer.get("gstin") or customer.get("GSTIN") or "")
                            if source_record:
                                customer_gstin = customer_gstin or str(source_record.get("clientGst") or "")
                            company_gstin = str(getattr(request.user.company, "gstin", "") or "")
                            company_state = str(getattr(request.user.company, "state", "") or "").strip().casefold()
                            customer_state = str(customer.get("state") or "").strip().casefold()
                            company_code = re.sub(r"\W", "", company_gstin)[:2].upper()
                            customer_code = re.sub(r"\W", "", customer_gstin)[:2].upper()
                            tax_type = str(data.get("taxType") or "").upper()
                            if tax_type not in {"INTRA_STATE", "IGST"}:
                                tax_type = "INTRA_STATE" if ((company_code and company_code == customer_code)
                                                              or (company_state and company_state == customer_state)) else "IGST"
                            gst_inclusive = bool(data.get("gstInclusive") or source_record.get("gstInclusive"))
                            for line in lines:
                                qty = Decimal(str(line.get("qty", line.get("quantity", 0)) or 0))
                                rate = Decimal(str(line.get("rate", line.get("r", 0)) or 0))
                                discount_rate = Decimal(str(line.get("discount") or 0))
                                gst_rate = Decimal(str(line.get("gst") or 0))
                                if (not all(value.is_finite() for value in (qty, rate, discount_rate, gst_rate))
                                        or qty <= 0 or rate < 0 or discount_rate < 0 or discount_rate > 100
                                        or gst_rate < 0 or gst_rate > 100):
                                    raise ValueError("invalid sales order item")
                                line_subtotal = qty * rate
                                line_discount = line_subtotal * discount_rate / Decimal("100")
                                discounted = line_subtotal - line_discount
                                line_taxable = (discounted / (Decimal("1") + gst_rate / Decimal("100"))
                                                if gst_inclusive and gst_rate else discounted)
                                line_tax = (discounted - line_taxable if gst_inclusive and gst_rate
                                            else line_taxable * gst_rate / Decimal("100"))
                                line.update({"taxableAmount": float(line_taxable.quantize(Decimal("0.01"), rounding=ROUND_HALF_UP)),
                                             "gstAmount": float(line_tax.quantize(Decimal("0.01"), rounding=ROUND_HALF_UP)),
                                             "discountAmount": float(line_discount.quantize(Decimal("0.01"), rounding=ROUND_HALF_UP))})
                                subtotal += line_subtotal
                                discount_total += line_discount
                                taxable_total += line_taxable
                                gst_total += line_tax
                            subtotal = subtotal.quantize(Decimal("0.01"), rounding=ROUND_HALF_UP)
                            discount_total = discount_total.quantize(Decimal("0.01"), rounding=ROUND_HALF_UP)
                            taxable_total = taxable_total.quantize(Decimal("0.01"), rounding=ROUND_HALF_UP)
                            gst_total = gst_total.quantize(Decimal("0.01"), rounding=ROUND_HALF_UP)
                            cgst = (gst_total / Decimal("2")).quantize(Decimal("0.01"), rounding=ROUND_HALF_UP) if tax_type == "INTRA_STATE" else Decimal("0")
                            sgst = gst_total - cgst if tax_type == "INTRA_STATE" else Decimal("0")
                            igst = gst_total if tax_type == "IGST" else Decimal("0")
                            amount = (taxable_total + gst_total).quantize(Decimal("0.01"), rounding=ROUND_HALF_UP)
                            data["total"] = float(amount)
                            data.update({"subtotal": float(subtotal), "discountAmount": float(discount_total),
                                         "taxableAmount": float(taxable_total), "gstAmount": float(gst_total),
                                         "taxType": tax_type, "cgst": float(cgst), "sgst": float(sgst), "igst": float(igst)})
                            advance_pct = Decimal(str(data.get("advancePercent", customer.get("advancePercent", customer.get("advancePercentage", 0))) or 0))
                            if not amount.is_finite() or amount < 0 or not advance_pct.is_finite() or advance_pct < 0 or advance_pct > 100:
                                raise ValueError("invalid amount")
                            required_advance = (amount * advance_pct / Decimal("100")).quantize(Decimal("0.01"), rounding=ROUND_HALF_UP)
                        except (InvalidOperation, TypeError, ValueError):
                            return Response({"error": "Sales order total or customer advance percentage is invalid."}, status=400)
                        request_id = "SAR-" + record_id
                        request_ref = self._module_record_ref(request.user.company.id, "accounting", request_id)
                        request_payload = {
                            "id": request_id, "recordType": "salesAccountingRequest", "module": "accounting",
                            "companyId": str(request.user.company.id), "salesOrderId": record_id,
                            "salesOrderNumber": data.get("orderNumber") or record_id,
                            "requestNumber": request_id, "requestDate": now_iso(),
                            "orderDate": data.get("orderDate") or data.get("od") or data.get("createdAt") or now_iso()[:10],
                            "customerId": data.get("customerId", ""),
                            "customerName": data.get("customerName") or customer.get("name") or "",
                            "customerAddress": customer.get("address") or customer.get("billingAddress") or "",
                            "customerGSTIN": customer.get("gstin") or customer.get("GSTIN") or (source_record.get("clientGst") if source_record else "") or "",
                            "customerContact": customer.get("phone") or customer.get("contact") or "",
                            "paymentTerms": data.get("paymentTerms") or customer.get("paymentTerms") or "",
                            "advancePercent": float(advance_pct), "orderSubtotal": sum(float(x.get("qty", x.get("quantity", 0)) or 0) * float(x.get("rate", 0) or 0) for x in lines),
                            "discount": float(data.get("discountAmount") or data.get("discount") or 0), "taxableAmount": float(data.get("taxableAmount") or data.get("total") or 0),
                            "gstAmount": float(data.get("gstAmount") or 0), "taxType": data.get("taxType") or "IGST",
                            "cgst": float(data.get("cgst") or 0), "sgst": float(data.get("sgst") or 0), "igst": float(data.get("igst") or 0),
                            "grandTotal": float(amount), "requiredAdvance": float(required_advance),
                            "amountReceived": 0, "advanceOutstanding": float(required_advance), "paymentStatus": "UNPAID",
                            "companySnapshot": _accounting_company_snapshot(request.user.company),
                            "items": lines, "requestedBy": request.user.app_user.full_name or "",
                            "approvalStatus": "Pending", "remarks": "", "history": [{"at": now_iso(), "actorId": str(request.user.app_user.firebase_uid), "action": "Submitted for Accounting approval"}],
                            "createdAt": now_iso(), "createdBy": str(request.user.app_user.firebase_uid), "updatedAt": now_iso(),
                        }
                        batch = get_db().batch()
                        batch.create(record_ref, payload)
                        batch.create(request_ref, request_payload)
                        batch.commit()
                    else:
                        record_ref.create(payload)
                saved = clean(payload)
                return Response({"success": True, "record": saved}, status=201)
            except Exception as create_error:
                existing_snap = record_ref.get()
                if not existing_snap.exists:
                    raise create_error
                existing = existing_snap.to_dict() or {}
                metadata = {"id", "companyId", "module", "createdAt", "updatedAt", "createdBy"}
                existing_content = {key: clean(value) for key, value in existing.items() if key not in metadata}
                requested_content = {key: clean(value) for key, value in payload.items() if key not in metadata}
                if (str(existing.get("createdBy") or "") == str(request.user.app_user.firebase_uid)
                        and existing_content == requested_content):
                    return Response({"success": True, "record": clean({**existing, "id": record_id})}, status=200)
                return Response({"error": "That record ID is already in use."}, status=409)
        except Exception as exc:
            return api_error(exc, "Unable to save module record.")

    def put(self, request, module_name):
        module_name = str(module_name or "").strip().lower()
        if not self._allowed(request, module_name):
            return Response({"error": "Forbidden for this module."}, status=403)
        record_id = str(request.data.get("id") or "")
        if not record_id: return Response({"error": "Record id is required."}, status=400)
        try:
            ref = self._module_record_ref(request.user.company.id, module_name, record_id)
            existing = ref.get()
            if not existing.exists: return Response({"error": "Record not found."}, status=404)
            data = request.data.copy()
            data.pop("companyId", None); data.pop("module", None)
            data.pop("createdBy", None); data.pop("createdAt", None)
            current_record = existing.to_dict() or {}
            team_error = self._validate_team_member(request, module_name, data, current_record)
            if team_error:
                return team_error
            if module_name == "crm" and current_record.get("recordType") == "lead":
                assigned_id = str(data.get("assignedToId") or current_record.get("assignedToId") or "").strip()
                assigned = next((row for row in list_module_records(request.user.company.id, "crm")
                                 if row.get("recordType") == "teamMember"
                                 and str(row.get("id") or "") == assigned_id
                                 and not row.get("isDeleted") and row.get("isActive", True)
                                 and str(row.get("status") or "ACTIVE").upper() == "ACTIVE"), None)
                if not assigned:
                    return Response({"error": "Select an active CRM team member for this lead."}, status=400)
                data["assignedToId"] = assigned_id
                data["by"] = str(assigned.get("n") or assigned.get("name") or "")
            if module_name == "purchase" and current_record.get("recordType") == "purchaseOrder":
                _normalize_purchase_order_history(data)
            role = request.user.membership.role
            if module_name == "transport" and current_record.get("recordType") == "transportBill":
                return Response({"error": "Submitted Transport Bills are managed through the Accounting workflow."}, status=403)
            if module_name == "purchase" and current_record.get("recordType") == "purchaseOrder":
                current_status = current_record.get("status", current_record.get("st"))
                if current_status not in {"DRAFT", "REJECTED"}:
                    return Response({"error": "Only draft or rejected Purchase Orders can be edited."}, status=409)
                data["status"] = data["st"] = current_status
                for protected in ("accountingApprovalStatus", "accountingDecisionReason", "accountingRequestId", "approvedBy", "approvedAt"):
                    data.pop(protected, None)
            if module_name == "production" and _is_work_order_record(current_record):
                if role not in {Role.ADMIN, Role.PRODUCTION}:
                    return Response({"error": "Only Production or Admin can edit Production Order details."}, status=403)
                if str(current_record.get("st") or current_record.get("status") or "").upper() != "PLANNED":
                    return Response({"error": "Only a planned Production Order can be edited."}, status=409)
                immutable_order_fields = {"productionRequestId", "productionRequestNo", "materialPlanId", "salesOrderId", "so", "item", "qty", "materials"}
                if any(field in data and data[field] != current_record.get(field) for field in immutable_order_fields):
                    return Response({"error": "Production Order references, quantity, and approved materials cannot be changed here."}, status=403)
                editable_order_fields = {"id", "recordType", "batch", "sup", "start", "expectedStartDate"}
                unexpected = set(data) - editable_order_fields
                if unexpected:
                    return Response({"error": "Only batch, supervisor, and planned start date can be edited on a Production Order."}, status=403)
            if module_name == "sales" and current_record.get("recordType") == "salesOrder":
                data["received"] = current_record.get("received", 0)
                for protected in ("accountingApprovalStatus", "accountingDecisionReason", "accountingDecisionAt",
                                  "accountingDecisionBy", "accountingApprovedAt", "accountingApprovedBy"):
                    data.pop(protected, None)
                if not isinstance(data.get("items"), list) or not data.get("items"):
                    return Response({"error": "A Sales Order must contain at least one item."}, status=400)
                try:
                    order_total = Decimal("0")
                    for item in data["items"]:
                        if not isinstance(item, dict):
                            raise ValueError
                        qty = Decimal(str(item.get("qty", item.get("quantity", 0)) or 0))
                        rate = Decimal(str(item.get("rate", item.get("r", 0)) or 0))
                        if not qty.is_finite() or not rate.is_finite() or qty <= 0 or rate < 0:
                            raise ValueError
                        order_total += qty * rate
                    data["total"] = float(order_total.quantize(Decimal("0.01"), rounding=ROUND_HALF_UP))
                except (InvalidOperation, TypeError, ValueError):
                    return Response({"error": "Sales Order item quantities and rates must be valid non-negative amounts."}, status=400)

            if module_name == "production" and current_record.get("recordType") == "materialPlan":
                if role not in {Role.ADMIN, Role.PRODUCTION}:
                    return Response({"error": "Only Production or Admin can edit a Raw Material Planning request."}, status=403)
                if current_record.get("approvalStatus") == "Approved":
                    return Response({"error": "Approved material requests cannot be edited."}, status=409)
                if current_record.get("sentToInventoryAt") and current_record.get("approvalStatus") == "Pending":
                    return Response({"error": "This Material Request is under Inventory review and cannot be edited."}, status=409)
                for protected in ("approvalStatus", "approvedBy", "approvedAt", "reviewedBy", "reviewedAt", "productionOrderId", "rejectionReason",
                                  "sentToInventoryAt", "sentToInventoryBy", "materialRequestNo"):
                    data.pop(protected, None)
                is_resubmission = current_record.get("approvalStatus") == "Rejected"
                data.update({"approvalStatus": "Draft", "status": "Draft",
                             "reviewRound": int(current_record.get("reviewRound") or 1) + (1 if is_resubmission else 0)})
                if is_resubmission:
                    # Firestore merge writes preserve omitted keys, so explicitly clear
                    # the previous round's rejection reason on resubmission.
                    data["rejectionReason"] = ""
                    data["sentToInventoryAt"] = ""
                    data["sentToInventoryBy"] = ""
                data.update({"materialAvailabilityStatus": "Unverified", "inventoryVerificationStatus": "Not Checked"})
                for material in data.get("materials", []):
                    if isinstance(material, dict):
                        material["availabilityStatus"] = "Unverified"
            if (module_name == "production" and current_record.get("recordType") == "productionRequest"
                    and role != Role.ADMIN and data.get("status") in {"Inventory Approved", "Rejected", "Production Order Created"}
                    and data.get("status") != current_record.get("status")):
                return Response({"error": "Inventory review and Production Order statuses are managed by the workflow."}, status=403)
            if (module_name == "production" and current_record.get("recordType") == "productionRequest"
                    and role != Role.ADMIN and any(field in data for field in ("materialPlanId", "inventoryApprovedBy", "inventoryApprovedAt", "productionOrderId"))):
                return Response({"error": "Planning and Inventory approval references are managed by the workflow."}, status=403)

            is_sales_quotation_review = (
                module_name == "quotations"
                and current_record.get("recordType") == "quotation"
                and role == Role.SALES
                and str(data.get("status") or "").strip()
                    in {"Sent", "Approved", "Accepted", "Rejected"}
            )
            is_crm_customer_conversion = (
                module_name == "crm"
                and str(data.get("type") or "").strip().casefold() == "customer"
                and role in {Role.ADMIN, Role.CRM}
            )
            is_owned_team_member = (
                current_record.get("recordType") == "teamMember"
                and str(current_record.get("departmentHeadId") or "") == str(request.user.app_user.firebase_uid)
            )
            # Sales Orders are department-shared: Production, Transport and
            # Accounting workflows legitimately update them, so the strict
            # creator-only rule must not block authorized Sales users.
            is_department_sales_order = (
                module_name == "sales"
                and current_record.get("recordType") == "salesOrder"
            )

            if (
                role != Role.ADMIN
                and str(current_record.get("createdBy") or "")
                and str(current_record.get("createdBy"))
                    != str(request.user.app_user.firebase_uid)
                and not is_sales_quotation_review
                and not is_crm_customer_conversion
                and not is_owned_team_member
                and not is_department_sales_order
            ):
                return Response(
                    {"error": "You can only update records you created."},
                    status=403,
                )
            if module_name.lower() == "crm" and str(data.get("type") or "").strip().casefold() == "customer":
                current_record = existing.to_dict() or {}
                if (str(current_record.get("recordType") or "lead").casefold() not in {"lead", "customer"}
                        or str(data.get("recordType") or current_record.get("recordType") or "lead").casefold() not in {"lead", "customer"}):
                    return Response({"error": "Only an existing CRM lead can be converted to a customer."}, status=400)
                if str(current_record.get("type") or "").strip().casefold() != "customer" \
                        and request.user.membership.role not in {Role.ADMIN, Role.CRM}:
                    return Response({"error": "Only CRM or Admin can convert a lead to a customer."}, status=403)
                if str(current_record.get("type") or "").strip().casefold() == "customer":
                    # Retrying an already-completed conversion is idempotent only
                    # for its original quotation; never replace its history link.
                    requested_quote_id = str(data.get("convertedQuotationId") or "").strip()
                    saved_quote_id = str(current_record.get("convertedQuotationId") or "").strip()
                    if requested_quote_id and saved_quote_id and requested_quote_id != saved_quote_id:
                        return Response({"error": "This CRM lead has already been converted from another quotation."}, status=409)
                    # Keep its original conversion reference while allowing CRM to update customer fields.
                    data.update({
                        "recordType": current_record.get("recordType") or "lead",
                        "type": "Customer",
                        "st": current_record.get("st") or "CONVERTED",
                        "convertedQuotationId": current_record.get("convertedQuotationId") or "",
                    })
                else:
                    quote_id = str(data.get("convertedQuotationId") or "").strip()
                    if not quote_id:
                        return Response({"error": "An approved quotation is required to convert this lead."}, status=400)
                    # The client sends the quotation shown on the Convert action;
                    # verify that exact record. Falling back to any other quotation
                    # of the lead could approve a different, stale quotation.
                    quote_snap = self._quotation_snapshot(request.user.company.id, record_id, quote_id)
                    quote = quote_snap.to_dict() or {} if quote_snap is not None and quote_snap.exists else {}
                    if (quote_snap is None or not quote_snap.exists or quote.get("isDeleted")
                            or quote.get("recordType") != "quotation"
                            or str(quote.get("leadId") or quote.get("clientId") or "") != record_id):
                        return Response({"error": "The linked quotation is not available for this lead."}, status=400)
                    quote_status = str(quote.get("status") or "").strip().casefold()
                    approved = quote_status in {"approved", "accepted"}
                    if quote_status == "converted" and quote.get("salesOrderId"):
                        order_snap = (module_records_ref(request.user.company.id, "sales")
                                      .document(str(quote.get("salesOrderId"))).get())
                        order = order_snap.to_dict() or {} if order_snap.exists else {}
                        approved = bool(order_snap.exists and str(order.get("quotationId") or "") == quote_id)
                    if not approved:
                        return Response({"error": "Sales must approve this quotation before the lead can be converted."}, status=400)
                    data.update({
                        "recordType": current_record.get("recordType") or "lead",
                        "type": "Customer",
                        "st": "CONVERTED",
                        "convertedQuotationId": quote_id,
                        "name": quote.get("clientName") or current_record.get("name") or data.get("name", ""),
                        "contact": quote.get("clientContact") or current_record.get("contact") or data.get("contact", ""),
                        "email": quote.get("clientEmail") or current_record.get("email") or data.get("email", ""),
                        "address": quote.get("clientAddress") or current_record.get("address") or data.get("address", ""),
                        "gstin": quote.get("clientGst") or current_record.get("gstin") or data.get("gstin", ""),
                        # Keep the quotation reference and quoted value on the
                        # customer (the CRM Customers list reads these fields).
                        "qn": quote.get("number") or current_record.get("qn") or data.get("qn", ""),
                        "qa": quote.get("total") if quote.get("total") is not None else (current_record.get("qa") or data.get("qa") or 0),
                    })
            if module_name.lower() == "catalog":
                if request.user.membership.role not in {Role.ADMIN, Role.SALES}:
                    return Response({"error": "CRM can view the product catalog but cannot change it."}, status=403)
                if (existing.to_dict() or {}).get("recordType") not in {"product", "customFields"}:
                    return Response({"error": "Unsupported catalog record type."}, status=400)
                invalid = self._validate_catalog_product(request.user.company.id, data, record_id)
                if invalid:
                    return invalid
            if module_name.lower() == "quotations":
                current = existing.to_dict() or {}
                if current.get("recordType") not in {"quotation", "template"}:
                    return Response({"error": "Unsupported quotation record type."}, status=400)
                if current.get("recordType") == "template" and request.user.membership.role not in {Role.ADMIN, Role.CRM}:
                    return Response({"error": "Only CRM or Admin can edit quotation templates."}, status=403)
                if current.get("recordType") == "quotation" and request.user.membership.role == Role.SALES:
                    # Sales may review a quote, but may not rewrite its commercial terms.
                    new_status = data.get("status")
                    if str(current.get("isDeleted", False)).casefold() == "true":
                        return Response({"error": "Archived quotations cannot be reviewed."}, status=410)
                    if new_status == "Converted":
                        expected_order_id = "SO-" + str(record_id)
                        order_ref = module_records_ref(request.user.company.id, "sales").document(expected_order_id)
                        order = order_ref.get()
                        if (not order.exists or str((order.to_dict() or {}).get("quotationId")) != str(record_id)
                                or str(data.get("salesOrderId")) != expected_order_id):
                            return Response({"error": "Create the linked sales order before converting this quotation."}, status=400)
                        data = {**current, "status": "Converted", "salesOrderId": expected_order_id,
                                "reviewedBy": request.user.app_user.firebase_uid}
                    elif new_status in {"Sent", "Approved", "Accepted", "Rejected"}:
                        current_status = str(current.get("status") or "").strip().casefold()
                        if new_status in {"Approved", "Accepted"} and current_status in {"rejected", "expired", "converted"}:
                            return Response({"error": "This quotation can no longer be approved."}, status=409)
                        if new_status in {"Approved", "Accepted"} and current_status in {"approved", "accepted"}:
                            return Response({"error": "This quotation has already been approved."}, status=409)
                        if new_status == "Rejected" and current_status in {"approved", "accepted", "converted"}:
                            return Response({"error": "An approved quotation cannot be rejected."}, status=409)
                        if new_status == "Rejected" and current_status == "rejected":
                            return Response({"error": "This quotation has already been rejected."}, status=409)
                        data = {**current, "status": new_status, "reviewedBy": request.user.app_user.firebase_uid}
                        data["reviewedAt"] = now_iso()
                    else:
                        return Response({"error": "Sales can only update quotation review status."}, status=400)
                elif request.user.membership.role not in {Role.ADMIN, Role.CRM}:
                    return Response({"error": "You are not authorized to edit this quotation."}, status=403)
                elif (str(data.get("status") or "").casefold() in {"approved", "accepted"}
                      and str(current.get("status") or "").casefold() not in {"approved", "accepted"}):
                    return Response({"error": "Only an authorized Sales user can approve a quotation."}, status=403)
                elif data.get("status") == "Converted":
                    return Response({"error": "Only the linked Sales conversion workflow can convert a quotation."}, status=400)
                if data.get("recordType") != current.get("recordType"):
                    return Response({"error": "Quotation record type cannot be changed."}, status=400)
                invalid = self._validate_quotation(request.user.company.id, data, record_id)
                if invalid:
                    return invalid
            data.pop("isDeleted", None)
            data.pop("deletedAt", None)
            if (module_name == "accounting" and current_record.get("recordType") == "accountingEntry"
                    and current_record.get("type") in {"RECEIPT", "PAYMENT"}
                    and str(data.get("st") or "").upper() == "POSTED"
                    and not (data.get("voucherNumber") or current_record.get("voucherNumber"))):
                try:
                    voucher_date = date.fromisoformat(str(data.get("date") or now_iso()[:10]))
                except ValueError:
                    return Response({"error": "Enter a valid receipt or payment date."}, status=400)
                receipt = current_record.get("type") == "RECEIPT"
                voucher_number = _next_company_number(
                    request.user.company.id, "accounting", "receiptVoucher" if receipt else "paymentVoucher",
                    _accounting_voucher_prefix("RV" if receipt else "PV", voucher_date),
                    "accountingEntry", "voucherNumber",
                )
                data["number"] = data["voucherNumber"] = voucher_number
            data["updatedBy"] = str(request.user.app_user.firebase_uid)
            saved = save_module_record(request.user.company.id, module_name, record_id, data)
            if module_name == "sales" and current_record.get("recordType") == "salesOrder":
                sales_request_ref = self._module_record_ref(request.user.company.id, "accounting", "SAR-" + record_id)
                sales_request_snap = sales_request_ref.get()
                sales_request = sales_request_snap.to_dict() or {} if sales_request_snap.exists else {}
                if sales_request.get("approvalStatus") in {"Returned", "Rejected"}:
                    try:
                        total = Decimal(str(saved.get("total") or 0))
                        advance_pct = Decimal(str(saved.get("advancePercent") or 0))
                        if not total.is_finite() or total < 0 or not advance_pct.is_finite() or advance_pct < 0 or advance_pct > 100:
                            return Response({"error": "Sales order total or customer advance percentage is invalid."}, status=400)
                        required = (total * advance_pct / Decimal("100")).quantize(Decimal("0.01"), rounding=ROUND_HALF_UP)
                    except (InvalidOperation, TypeError, ValueError):
                        return Response({"error": "Sales order total or customer advance percentage is invalid."}, status=400)
                    history = list(sales_request.get("history") or [])
                    history.append({"at": now_iso(), "actorId": str(request.user.app_user.firebase_uid), "action": "Corrected and resubmitted"})
                    sales_request_ref.update({"salesOrderNumber": saved.get("orderNumber") or record_id,
                        "customerName": saved.get("customerName") or "", "advancePercent": float(advance_pct),
                        "grandTotal": float(total), "requiredAdvance": float(required),
                        "amountReceived": float(saved.get("received") or 0),
                        "advanceOutstanding": max(0, float(required) - float(saved.get("received") or 0)),
                        "items": saved.get("items") or [], "approvalStatus": "Pending", "decisionReason": "",
                        "history": history, "updatedAt": now_iso(), "resubmittedAt": now_iso()})
                    ref.update({"accountingApprovalStatus": "Pending", "accountingDecisionReason": "",
                                "accountingDecisionAt": "", "accountingDecisionBy": ""})
            if (module_name == "production" and current_record.get("recordType") == "materialPlan"
                    and current_record.get("approvalStatus") == "Rejected"):
                request_ref = self._module_record_ref(request.user.company.id, "production", str(current_record.get("productionRequestId") or ""))
                request_ref.update({"status": "Material Planning", "materialPlanId": record_id, "rejectionReason": ""})
            return Response({"success": True, "record": saved})
        except Exception as exc:
            return api_error(exc, "Unable to update module record.")

    def delete(self, request, module_name):
        module_name = str(module_name or "").strip().lower()
        if not self._allowed(request, module_name):
            return Response({"error": "Forbidden for this module."}, status=403)
        record_id = str(request.query_params.get("id") or request.data.get("id") or "")
        if not record_id: return Response({"error": "Record id is required."}, status=400)
        try:
            ref = self._module_record_ref(request.user.company.id, module_name, record_id)
            existing = ref.get()
            if not existing.exists: return Response({"error": "Record not found."}, status=404)
            existing_record = existing.to_dict() or {}
            if module_name == "accounting" and existing_record.get("recordType") == "accountingEntry" and existing_record.get("type") == "RECEIPT" and existing_record.get("requestId"):
                company_id = str(request.user.company.id)
                request_id = str(existing_record.get("requestId"))
                request_ref = self._module_record_ref(company_id, "accounting", request_id)
                order_id = str(existing_record.get("ref") or "")
                order_ref = self._module_record_ref(company_id, "sales", order_id)
                invoice_ref = self._module_record_ref(company_id, "accounting", "REC-" + request_id)
                transport_bills = [row for row in list_module_records(company_id, "transport")
                                   if row.get("recordType") == "transportBill" and not row.get("isDeleted")
                                   and str(row.get("salesOrderId") or "") == order_id]
                transport_refs = [self._module_record_ref(company_id, "transport", str(row.get("id")))
                                  for row in transport_bills]
                delivery_bills = [row for row in list_module_records(company_id, "transport")
                                  if row.get("recordType") == "deliveryBill" and not row.get("isDeleted")
                                  and str(row.get("salesOrderId") or "") == order_id]
                delivery_refs = [self._module_record_ref(company_id, "transport", str(row.get("id")))
                                 for row in delivery_bills]
                txn = get_db().transaction()

                @firestore.transactional
                def delete_receipt(tx):
                    entry_snap = _transaction_document(tx, ref)
                    request_snap = _transaction_document(tx, request_ref)
                    order_snap = _transaction_document(tx, order_ref)
                    invoice_snap = _transaction_document(tx, invoice_ref)
                    bill_snaps = [(bill_ref, _transaction_document(tx, bill_ref)) for bill_ref in transport_refs]
                    delivery_snaps = [(bill_ref, _transaction_document(tx, bill_ref)) for bill_ref in delivery_refs]
                    if not entry_snap or not entry_snap.exists or not request_snap or not request_snap.exists or not order_snap or not order_snap.exists:
                        raise ValueError("The receipt or its linked Sales Order is unavailable.")
                    entry = entry_snap.to_dict() or {}
                    request_record = request_snap.to_dict() or {}
                    order = order_snap.to_dict() or {}
                    if entry.get("recordType") != "accountingEntry" or entry.get("type") != "RECEIPT":
                        raise ValueError("Only a Sales receipt can be deleted through this workflow.")
                    if request_record.get("recordType") != "salesAccountingRequest" or order.get("recordType") != "salesOrder":
                        raise ValueError("The receipt or its linked Sales Order is unavailable.")
                    received = Decimal(str(order.get("received") or 0))
                    receipt_amount = Decimal(str(entry.get("amount") or 0))
                    if not received.is_finite() or not receipt_amount.is_finite() or receipt_amount < 0:
                        raise ValueError("The saved receipt has invalid amounts.")
                    restored_received = max(Decimal("0"), received - receipt_amount).quantize(Decimal("0.01"), rounding=ROUND_HALF_UP)
                    total = Decimal(str(request_record.get("grandTotal") or 0))
                    required = Decimal(str(request_record.get("requiredAdvance") or 0))
                    payment_status = ("PAID" if total > 0 and restored_received >= total
                                      else "PARTIAL" if restored_received > 0 else "UNPAID")
                    tx.delete(ref)
                    tx.update(order_ref, {"received": float(restored_received), "paymentStatus": payment_status,
                                          "receiptUpdatedAt": now_iso()})
                    tx.update(request_ref, {"amountReceived": float(restored_received),
                                            "advanceOutstanding": float(max(Decimal("0"), required - restored_received)),
                                            "paymentStatus": payment_status, "updatedAt": now_iso()})
                    for bill_ref, bill_snap in bill_snaps:
                        if bill_snap and bill_snap.exists:
                            tx.update(bill_ref, {"customerReceiptStatus": payment_status,
                                                 "customerAmountReceived": float(restored_received),
                                                 "customerReceiptUpdatedAt": now_iso()})
                    for bill_ref, bill_snap in delivery_snaps:
                        if bill_snap and bill_snap.exists:
                            tx.update(bill_ref, {"customerReceiptStatus": payment_status,
                                                 "customerAmountReceived": float(restored_received),
                                                 "customerBalanceDue": float(max(Decimal("0"), total - restored_received)),
                                                 "customerReceiptUpdatedAt": now_iso()})
                    if invoice_snap and invoice_snap.exists:
                        tx.update(invoice_ref, {"paid": float(restored_received), "updatedAt": now_iso()})

                try:
                    delete_receipt(txn)
                    return Response({"success": True, "deleted": True})
                except ValueError as exc:
                    return Response({"error": str(exc)}, status=409)
            if module_name == "transport" and existing_record.get("recordType") in {"transportBill", "deliveryBill"}:
                company_id = str(request.user.company.id)
                batch = get_db().batch()
                batch.delete(ref)
                if existing_record.get("recordType") == "transportBill":
                    accounting_request_id = "TBR-" + record_id[3:] if record_id.startswith("TB-") else ""
                    accounting_ref = self._module_record_ref(company_id, "accounting", accounting_request_id) if accounting_request_id else None
                    accounting_snap = accounting_ref.get() if accounting_ref else None
                    if accounting_snap is not None and accounting_snap.exists:
                        batch.delete(accounting_ref)
                        for entry in list_module_records(company_id, "accounting"):
                            if entry.get("recordType") == "accountingEntry" and str(entry.get("requestId") or "") == accounting_request_id:
                                batch.delete(self._module_record_ref(company_id, "accounting", str(entry.get("id"))))
                else:
                    sales_order_id = str(existing_record.get("salesOrderId") or "")
                    request_id = str(existing_record.get("transportRequestId") or "")
                    dispatch_id = str(existing_record.get("dispatchId") or "")
                    updates = {"deliveryBillId": "", "deliveryBillNumber": "", "deliveryBillSnapshot": None}
                    for module, linked_id, data in (
                        ("sales", sales_order_id, updates),
                        ("transport", request_id, {"deliveryBillId": "", "deliveryBillNumber": "", "updatedAt": now_iso()}),
                        ("transport", dispatch_id, {"deliveryBillId": "", "deliveryBillNumber": "", "updatedAt": now_iso()}),
                    ):
                        if not linked_id:
                            continue
                        linked_ref = self._module_record_ref(company_id, module, linked_id)
                        linked_snap = linked_ref.get()
                        if linked_snap.exists:
                            batch.set(linked_ref, data, merge=True)
                batch.commit()
                return Response({"success": True, "deleted": True})
            if existing_record.get("recordType") == "teamMember":
                team_error = self._validate_team_member(request, module_name, existing_record, existing_record)
                if team_error:
                    return team_error
            if module_name == "production" and _is_work_order_record(existing_record):
                if (str(existing_record.get("st") or existing_record.get("status") or "").upper() not in {"PLANNED", "PENDING_MATERIAL"}
                        or float(existing_record.get("prod") or 0) > 0
                        or bool(existing_record.get("cons"))
                        or bool(existing_record.get("cst"))):
                    return Response({"error": "A Production Order with material issues, output, or cancellation activity cannot be deleted."}, status=409)
                if request.user.membership.role not in {Role.PRODUCTION, Role.ADMIN}:
                    return Response({"error": "Only Production or Admin can delete an untouched Production Order."}, status=403)
            if module_name == "purchase" and existing_record.get("recordType") == "purchaseOrder":
                if existing_record.get("status", existing_record.get("st")) != "DRAFT" or existing_record.get("accountingRequestId"):
                    return Response({"error": "Only unsubmitted draft Purchase Orders can be deleted."}, status=409)
                if str(existing_record.get("createdBy") or "") != str(request.user.app_user.firebase_uid) and request.user.membership.role != Role.ADMIN:
                    return Response({"error": "You can only delete Purchase Orders you created."}, status=403)
            if module_name == "purchase" and existing_record.get("recordType") == "supplier":
                if any(str(row.get("supplierId") or row.get("sup") or "") == record_id
                       and not row.get("isDeleted")
                       for row in list_module_records(request.user.company.id, "purchase")
                       if row.get("recordType") == "purchaseOrder"):
                    return Response({"error": "Suppliers linked to purchase orders cannot be deleted. Deactivate the supplier instead."}, status=409)
            if module_name.lower() == "quotations":
                record = existing.to_dict() or {}
                if record.get("recordType") == "quotation":
                    if request.user.membership.role not in {Role.ADMIN, Role.CRM, Role.SALES}:
                        return Response({"error": "Only CRM, Sales or Admin can delete quotations."}, status=403)
                    linked_orders = (module_records_ref(request.user.company.id, "sales").where("quotationId", "==", record_id).limit(1).stream())
                    if (record.get("salesOrderId") or next(iter(linked_orders), None)
                            or str(record.get("status") or "").casefold() in {"converted", "invoiced"}):
                        return Response({"error": "A quotation linked to a Sales Order or invoice cannot be deleted."}, status=409)
                    lead_id = str(record.get("leadId") or record.get("clientId") or "").strip()
                    lead_ref = self._module_record_ref(request.user.company.id, "crm", lead_id) if lead_id else None
                    lead_snap = lead_ref.get() if lead_ref else None
                    if (lead_snap is not None and not lead_snap.exists and lead_id.startswith("CRM-")):
                        lead_ref = self._module_record_ref(request.user.company.id, "crm", lead_id[4:])
                        lead_snap = lead_ref.get()
                    batch = get_db().batch()
                    batch.delete(ref)
                    if lead_snap is not None and lead_snap.exists:
                        lead = lead_snap.to_dict() or {}
                        if str(lead.get("convertedQuotationId") or "") == record_id:
                            return Response({"error": "This quotation is still linked to a converted customer."}, status=409)
                        updates = {"qn": "", "qa": 0, "updatedAt": now_iso()}
                        if str(lead.get("type") or "").casefold() != "customer" and str(lead.get("st") or "").casefold() in {"quotation", "quoted"}:
                            updates["st"] = "FOLLOW_UP"
                        batch.update(lead_ref, updates)
                    batch.commit()
                    return Response({"success": True, "deleted": True})
                elif record.get("recordType") == "template":
                    if request.user.membership.role not in {Role.ADMIN, Role.CRM}:
                        return Response({"error": "Only CRM or Admin can delete quotation templates."}, status=403)
                else:
                    return Response({"error": "Unsupported quotation record type."}, status=400)
            elif module_name.lower() == "catalog":
                if request.user.membership.role not in {Role.ADMIN, Role.SALES}:
                    return Response({"error": "CRM can view the product catalog but cannot change it."}, status=403)
                if (existing.to_dict() or {}).get("recordType") not in {"product", "customFields"}:
                    return Response({"error": "Unsupported catalog record type."}, status=400)
            ref.set({"isDeleted": True, "deletedAt": now_iso()}, merge=True)
            return Response({"success": True})
        except Exception as exc:
            return api_error(exc, "Unable to delete module record.")


class SalesTransportRequestsView(APIView):
    """Sales handoff requests approved by Transport into a dispatch and delivery challan."""

    @staticmethod
    def _records(company_id):
        return module_records_ref(company_id, "transport")

    def get(self, request):
        if not user_can_access_module(request.user, "transport"):
            return Response({"error": "Transport access required."}, status=403)
        try:
            rows = [row for row in list_module_records(request.user.company.id, "transport")
                    if row.get("recordType") == "transportRequest" and not row.get("isDeleted")]
            return Response({"records": rows})
        except Exception as exc:
            return api_error(exc, "Unable to load Sales transport requests.")

    def post(self, request, order_id=None, request_id=None, action=None):
        if order_id and not action:
            if not user_can_access_module(request.user, "sales"):
                return Response({"error": "Sales access required."}, status=403)
            return self._submit(request, str(order_id))
        if request_id and action:
            if not user_can_access_module(request.user, "transport"):
                return Response({"error": "Transport access required."}, status=403)
            return self._decide(request, str(request_id), str(action).lower())
        return Response({"error": "A Sales Order or transport request action is required."}, status=400)

    def _submit(self, request, order_id):
        company_id = str(request.user.company.id)
        actor = str(request.user.app_user.firebase_uid)
        now = now_iso()
        sales_records = module_records_ref(company_id, "sales")
        sales_ref = sales_records.document(order_id)
        try:
            initial_snap = sales_ref.get()
            order = initial_snap.to_dict() or {} if initial_snap.exists else {}
            if not initial_snap.exists or order.get("recordType") != "salesOrder" or order.get("isDeleted"):
                return Response({"error": "Sales Order not found."}, status=404)
            if (str(order.get("status") or "").upper() != "READY_FOR_TRANSPORT"
                    or str(order.get("productionStatus") or "").upper() != "COMPLETED"):
                return Response({"error": "Only a production-complete Sales Order can be sent to Transport."}, status=409)
            items = [dict(item) for item in (order.get("items") or []) if isinstance(item, dict)]
            if not items:
                return Response({"error": "The Sales Order has no product lines to deliver."}, status=409)
            customer_id = str(order.get("customerId") or "")
            crm_records = module_records_ref(company_id, "crm")
            customer_snap = crm_records.document(customer_id).get() if customer_id else None
            if customer_snap and not customer_snap.exists and customer_id.startswith("CRM-"):
                customer_snap = crm_records.document(customer_id[4:]).get()
            customer = customer_snap.to_dict() or {} if customer_snap and customer_snap.exists else {}
            company_snapshot = _accounting_company_snapshot(request.user.company)
            request_id = _next_company_number(company_id, "transport", "transportRequest", "TRQ", "transportRequest", "requestNumber")
            request_ref = self._records(company_id).document(request_id)
            request_payload = {"id": request_id, "recordType": "transportRequest", "module": "transport",
                "companyId": company_id,
                "requestNumber": request_id, "salesOrderId": order_id,
                "salesOrderNumber": order.get("orderNumber") or order_id,
                "customerId": customer_id, "customerName": customer.get("name") or order.get("customerName") or "",
                "customerAddress": customer.get("address") or customer.get("ad") or order.get("customerAddress") or "",
                "customerGSTIN": customer.get("gstin") or customer.get("gst") or order.get("customerGSTIN") or "",
                "customerContact": customer.get("phone") or customer.get("contact") or customer.get("ph") or "",
                "items": items, "orderTotal": float(order.get("total") or 0),
                "orderDate": order.get("orderDate") or "", "requiredDeliveryDate": order.get("deliveryDate") or "",
                "companySnapshot": company_snapshot, "requestedBy": request.user.app_user.full_name or "",
                "requestedById": actor, "requestedAt": now, "status": "Pending", "approvalStatus": "Pending",
                "transportStatus": "REQUESTED", "history": [{"at": now, "actorId": actor, "action": "Requested by Sales"}],
                "createdAt": now, "updatedAt": now}
            txn = get_db().transaction()

            @firestore.transactional
            def create_once(tx):
                live_snap = _transaction_document(tx, sales_ref)
                new_request_snap = _transaction_document(tx, request_ref)
                if not live_snap or not live_snap.exists:
                    raise ValueError("Sales Order not found.")
                live_order = live_snap.to_dict() or {}
                existing_id = str(live_order.get("transportRequestId") or "")
                existing_ref = self._records(company_id).document(existing_id) if existing_id else None
                existing_snap = _transaction_document(tx, existing_ref) if existing_ref else None
                existing_request = existing_snap.to_dict() or {} if existing_snap and existing_snap.exists else {}
                if existing_snap and existing_snap.exists and existing_request.get("approvalStatus") in {"Pending", "Approved"}:
                    return {"request": existing_request, "order": live_order, "duplicate": True}
                if new_request_snap and new_request_snap.exists:
                    raise ValueError("Transport request number is already in use.")
                if (live_order.get("recordType") != "salesOrder" or live_order.get("isDeleted")
                        or str(live_order.get("status") or "").upper() != "READY_FOR_TRANSPORT"
                        or str(live_order.get("productionStatus") or "").upper() != "COMPLETED"):
                    raise ValueError("This Sales Order is no longer ready for Transport.")
                event = {"at": now, "actorId": actor, "action": "Transport requested", "requestNumber": request_id}
                tx.create(request_ref, request_payload)
                tx.update(sales_ref, {"transportRequestId": request_id, "transportRequestNumber": request_id,
                    "transportRequestStatus": "Pending", "transportStatus": "REQUESTED",
                    "history": list(live_order.get("history") or []) + [event], "updatedAt": now})
                return {"request": request_payload, "order": {**live_order, "transportRequestId": request_id,
                    "transportRequestNumber": request_id, "transportRequestStatus": "Pending",
                    "transportStatus": "REQUESTED"}, "duplicate": False}

            saved = create_once(txn)
            return Response({"success": True, "request": clean({**saved["request"], "id": saved["request"].get("id") or request_id}),
                             "salesOrder": clean({**saved["order"], "id": order_id}), "duplicate": saved.get("duplicate", False)},
                            status=200 if saved.get("duplicate") else 201)
        except ValueError as exc:
            return Response({"error": str(exc)}, status=409)
        except Exception as exc:
            return api_error(exc, "Unable to notify Transport.")

    def _decide(self, request, request_id, action):
        if action not in {"approve", "reject"}:
            return Response({"error": "Unsupported transport request action."}, status=400)
        company_id = str(request.user.company.id)
        actor = str(request.user.app_user.firebase_uid)
        actor_name = request.user.app_user.full_name or ""
        now = now_iso()
        reason = str(request.data.get("reason") or "").strip()[:1000]
        if action == "reject" and not reason:
            return Response({"error": "Enter a reason for rejecting this request."}, status=400)
        details = {}
        dispatch_id = bill_id = ""
        if action == "approve":
            vehicle = re.sub(r"\s+", "", str(request.data.get("vehicleNumber") or "").upper())
            driver = str(request.data.get("driverName") or "").strip()[:120]
            contact = re.sub(r"\D", "", str(request.data.get("driverContact") or ""))
            from_address = str(request.data.get("from") or "").strip()[:250]
            to_address = str(request.data.get("to") or "").strip()[:250]
            transporter = str(request.data.get("transporterName") or "").strip()[:160]
            dispatch_date = str(request.data.get("dispatchDate") or "")
            expected_date = str(request.data.get("expectedDeliveryDate") or "")
            try:
                parsed_dispatch = date.fromisoformat(dispatch_date)
                parsed_expected = date.fromisoformat(expected_date)
                if (not re.fullmatch(r"[A-Z]{2}\d{2}[A-Z]{1,3}\d{4}", vehicle)
                        or not transporter or not driver or not re.fullmatch(r"\d{10}", contact)
                        or not from_address or not to_address
                        or parsed_dispatch < date.today() or parsed_expected < parsed_dispatch):
                    raise ValueError
            except ValueError:
                return Response({"error": "Enter valid vehicle, driver, contact, route and delivery dates."}, status=400)
            details = {"vehicleNumber": vehicle, "driverName": driver, "driverContact": contact,
                       "from": from_address, "to": to_address, "transporterName": transporter,
                       "dispatchDate": dispatch_date, "expectedDeliveryDate": expected_date,
                       "deliveryNotes": str(request.data.get("deliveryNotes") or "").strip()[:1000]}
            dispatch_id = _next_company_number(company_id, "transport", "dispatch", "TRN", "dispatch", "id")
            bill_id = _next_company_number(company_id, "transport", "deliveryBill", "DLV", "deliveryBill", "billNumber")

        request_ref = self._records(company_id).document(request_id)
        initial_snap = request_ref.get()
        initial = initial_snap.to_dict() or {} if initial_snap.exists else {}
        if not initial_snap.exists or initial.get("recordType") != "transportRequest" or initial.get("isDeleted"):
            return Response({"error": "Transport request not found."}, status=404)
        order_id = str(initial.get("salesOrderId") or "")
        sales_ref = module_records_ref(company_id, "sales").document(order_id)
        dispatch_ref = self._records(company_id).document(dispatch_id) if dispatch_id else None
        bill_ref = self._records(company_id).document(bill_id) if bill_id else None
        txn = get_db().transaction()

        @firestore.transactional
        def decide(tx):
            live_req_snap = _transaction_document(tx, request_ref)
            order_snap = _transaction_document(tx, sales_ref)
            dispatch_snap = _transaction_document(tx, dispatch_ref) if dispatch_ref else None
            bill_snap = _transaction_document(tx, bill_ref) if bill_ref else None
            if not live_req_snap or not live_req_snap.exists or not order_snap or not order_snap.exists:
                raise ValueError("The transport request or its Sales Order is unavailable.")
            live_req = live_req_snap.to_dict() or {}
            order = order_snap.to_dict() or {}
            if live_req.get("recordType") != "transportRequest" or order.get("recordType") != "salesOrder":
                raise ValueError("The transport request or its Sales Order is unavailable.")
            if live_req.get("approvalStatus") != "Pending":
                raise ValueError("This Transport request has already been reviewed.")
            if (str(order.get("transportRequestId") or "") != request_id
                    or str(order.get("status") or "").upper() != "READY_FOR_TRANSPORT"):
                raise ValueError("The Sales Order is no longer awaiting this Transport request.")
            event = {"at": now, "actorId": actor, "actorName": actor_name,
                     "action": "Approved" if action == "approve" else "Rejected", "reason": reason}
            req_history = list(live_req.get("history") or []) + [event]
            order_history = list(order.get("history") or []) + [event]
            if action == "reject":
                tx.update(request_ref, {"status": "Rejected", "approvalStatus": "Rejected", "transportStatus": "REJECTED",
                    "decisionReason": reason, "decidedBy": actor, "decidedAt": now, "history": req_history, "updatedAt": now})
                tx.update(sales_ref, {"transportRequestStatus": "Rejected", "transportStatus": "READY_FOR_TRANSPORT",
                    "history": order_history, "updatedAt": now})
                return {"request": {**live_req, "status": "Rejected", "approvalStatus": "Rejected", "history": req_history},
                        "salesOrder": {**order, "transportRequestStatus": "Rejected"}, "action": "reject"}
            if (dispatch_snap and dispatch_snap.exists) or (bill_snap and bill_snap.exists):
                raise ValueError("A delivery record already exists for this approval.")
            items = []
            subtotal = Decimal("0")
            discount_total = Decimal("0")
            taxable_total = Decimal("0")
            gst_total = Decimal("0")
            gst_inclusive = bool(order.get("gstInclusive"))
            for source_item in order.get("items") or []:
                if not isinstance(source_item, dict):
                    continue
                quantity = Decimal(str(source_item.get("qty", source_item.get("quantity", 0)) or 0))
                rate = Decimal(str(source_item.get("rate", source_item.get("r", 0)) or 0))
                discount_rate = Decimal(str(source_item.get("discount") or 0))
                gst_rate = Decimal(str(source_item.get("gst") or 0))
                if (not all(value.is_finite() for value in (quantity, rate, discount_rate, gst_rate))
                        or quantity <= 0 or rate < 0 or discount_rate < 0 or discount_rate > 100 or gst_rate < 0 or gst_rate > 100):
                    raise ValueError("A Sales Order item has invalid quantity or tax details.")
                line_subtotal = quantity * rate
                line_discount = line_subtotal * discount_rate / Decimal("100")
                after_discount = line_subtotal - line_discount
                line_taxable = after_discount / (Decimal("1") + gst_rate / Decimal("100")) if gst_inclusive and gst_rate else after_discount
                line_tax = after_discount - line_taxable if gst_inclusive and gst_rate else line_taxable * gst_rate / Decimal("100")
                line_discount = line_discount.quantize(Decimal("0.01"), rounding=ROUND_HALF_UP)
                line_taxable = line_taxable.quantize(Decimal("0.01"), rounding=ROUND_HALF_UP)
                line_tax = line_tax.quantize(Decimal("0.01"), rounding=ROUND_HALF_UP)
                line_total = line_taxable + line_tax
                subtotal += line_subtotal
                discount_total += line_discount
                taxable_total += line_taxable
                gst_total += line_tax
                items.append({"itemId": str(source_item.get("productId") or source_item.get("i") or ""),
                    "itemCode": str(source_item.get("itemCode") or source_item.get("code") or ""),
                    "itemName": str(source_item.get("productName") or source_item.get("description") or "Item"),
                    "description": str(source_item.get("description") or ""), "hsn": str(source_item.get("hsn") or ""),
                    "quantity": float(quantity), "unit": str(source_item.get("uom") or source_item.get("unit") or "Nos"),
                    "unitRate": float(rate), "discountRate": float(discount_rate), "discountAmount": float(line_discount),
                    "taxableAmount": float(line_taxable), "gstRate": float(gst_rate), "gstAmount": float(line_tax),
                    "totalAmount": float(line_total)})
            if not items:
                raise ValueError("The Sales Order has no valid delivery items.")
            company_snapshot = live_req.get("companySnapshot") or _accounting_company_snapshot(request.user.company)
            company_gstin = str(company_snapshot.get("gstin") or "").upper()
            customer_gstin = str(live_req.get("customerGSTIN") or "").upper()
            company_code = re.sub(r"\W", "", company_gstin)[:2]
            customer_code = re.sub(r"\W", "", customer_gstin)[:2]
            tax_type = str(order.get("taxType") or "").upper()
            if tax_type not in {"INTRA_STATE", "IGST"}:
                tax_type = "INTRA_STATE" if company_code and company_code == customer_code else "IGST"
            cgst = Decimal(str(order.get("cgst") or 0))
            sgst = Decimal(str(order.get("sgst") or 0))
            igst = Decimal(str(order.get("igst") or 0))
            if not (cgst or sgst or igst):
                if tax_type == "IGST":
                    igst = gst_total
                else:
                    cgst = (gst_total / Decimal("2")).quantize(Decimal("0.01"), rounding=ROUND_HALF_UP)
                    sgst = gst_total - cgst
            delivery_bill = {"id": bill_id, "recordType": "deliveryBill", "module": "transport",
                "companyId": company_id,
                "billNumber": bill_id, "billType": "DELIVERY CHALLAN", "status": "APPROVED",
                "approvalStatus": "Approved", "salesOrderId": order_id,
                "salesOrderNumber": order.get("orderNumber") or order_id, "transportRequestId": request_id,
                "dispatchId": dispatch_id, "billDate": now[:10], "dispatchDate": details["dispatchDate"],
                "expectedDeliveryDate": details["expectedDeliveryDate"], "customerId": live_req.get("customerId") or "",
                "customerName": live_req.get("customerName") or order.get("customerName") or "",
                "customerAddress": live_req.get("customerAddress") or "", "customerGSTIN": live_req.get("customerGSTIN") or "",
                "customerContact": live_req.get("customerContact") or "", "transporterName": details["transporterName"],
                "vehicleNumber": details["vehicleNumber"], "driverName": details["driverName"],
                "driverContact": details["driverContact"], "from": details["from"], "to": details["to"],
                "deliveryNotes": details["deliveryNotes"], "items": items,
                "subtotal": float(subtotal), "discountAmount": float(discount_total),
                "taxableAmount": float(taxable_total), "gstAmount": float(gst_total),
                "taxType": tax_type, "taxBreakdown": {"cgst": float(cgst), "sgst": float(sgst), "igst": float(igst)},
                "totalAmount": float(order.get("total") or (taxable_total + gst_total)),
                "companySnapshot": company_snapshot, "approvedBy": actor, "approvedByName": actor_name,
                "approvedAt": now, "createdBy": actor, "createdAt": now, "updatedAt": now}
            dispatch = {"id": dispatch_id, "recordType": "dispatch", "module": "transport",
                "companyId": company_id,
                "transportRequestId": request_id, "salesOrderId": order_id, "salesOrderNumber": delivery_bill["salesOrderNumber"],
                "so": order_id, "veh": details["vehicleNumber"], "drv": details["driverName"], "dc": details["driverContact"],
                "from": details["from"], "to": details["to"], "dp": details["dispatchDate"],
                "exp": details["expectedDeliveryDate"], "dd": "", "st": "PLANNED", "status": "PLANNED",
                "deliveryBillId": bill_id, "deliveryBillNumber": bill_id, "companySnapshot": company_snapshot,
                "cb": actor_name, "ca": now[:10], "why": "",
                "hist": [{"date": now[:10], "action": f"Approved Sales transport request {request_id}"}],
                "createdBy": actor, "createdAt": now, "updatedAt": now}
            tx.create(dispatch_ref, dispatch)
            tx.create(bill_ref, delivery_bill)
            tx.update(request_ref, {"status": "Approved", "approvalStatus": "Approved", "transportStatus": "PLANNED",
                **details, "dispatchId": dispatch_id, "deliveryBillId": bill_id, "deliveryBillNumber": bill_id,
                "decidedBy": actor, "decidedAt": now, "history": req_history, "updatedAt": now})
            tx.update(sales_ref, {"status": "TRANSPORT_PLANNED", "transportRequestStatus": "Approved",
                "transportStatus": "PLANNED", "dispatchId": dispatch_id, "deliveryBillId": bill_id,
                "deliveryBillNumber": bill_id, "deliveryBillSnapshot": delivery_bill,
                "history": order_history, "updatedAt": now})
            return {"request": {**live_req, "status": "Approved", "approvalStatus": "Approved",
                    "dispatchId": dispatch_id, "deliveryBillId": bill_id, "history": req_history},
                "salesOrder": {**order, "status": "TRANSPORT_PLANNED", "transportRequestStatus": "Approved",
                    "dispatchId": dispatch_id, "deliveryBillId": bill_id, "deliveryBillNumber": bill_id,
                    "deliveryBillSnapshot": delivery_bill}, "dispatch": dispatch,
                "deliveryBill": delivery_bill, "action": "approve"}

        try:
            result = decide(txn)
            body = {key: clean({**value, "id": value.get("id") or key})
                    for key, value in result.items() if key in {"request", "salesOrder", "dispatch", "deliveryBill"}}
            return Response({"success": True, **body}, status=201 if action == "approve" else 200)
        except ValueError as exc:
            return Response({"error": str(exc)}, status=409)
        except (InvalidOperation, TypeError):
            return Response({"error": "Sales Order delivery amounts or tax details are invalid."}, status=400)
        except Exception as exc:
            return api_error(exc, "Unable to process the Transport request.")


class TransportDispatchActionView(APIView):
    """Persist Transport status transitions before dependent actions are shown."""

    def post(self, request, dispatch_id, action):
        if not user_can_access_module(request.user, "transport-delivery"):
            return Response({"error": "Forbidden for this module."}, status=403)
        if action not in {"ready", "dispatch", "transit", "deliver"}:
            return Response({"error": "Unsupported dispatch action."}, status=400)
        delivery_date = str(request.data.get("deliveryDate") or "").strip()
        company_id = request.user.company.id
        actor = str(request.user.app_user.firebase_uid)
        now = now_iso()
        today = django_timezone.localdate()
        dispatch_ref = (module_records_ref(company_id, "transport").document(str(dispatch_id)))

        def transition(tx):
            snapshot = _transaction_document(tx, dispatch_ref)
            if not snapshot or not snapshot.exists:
                raise ValueError("Dispatch not found.")
            live = snapshot.to_dict() or {}
            if live.get("recordType") != "dispatch" or live.get("isDeleted"):
                raise ValueError("Dispatch not found.")
            current_status = str(live.get("status", live.get("st", ""))).upper()
            raw_history = list(live.get("hist") or [])
            history = []
            for item in raw_history:
                if isinstance(item, (list, tuple)):
                    d = str(item[0]) if len(item) > 0 else ""
                    m = str(item[1]) if len(item) > 1 else ""
                    history.append({"0": d, "1": m, "date": d, "action": m})
                elif isinstance(item, dict):
                    d = str(item.get("date") or item.get("at") or item.get("0") or "")
                    m = str(item.get("action") or item.get("activity") or item.get("message") or item.get("1") or "")
                    entry = dict(item)
                    entry.update({"0": d, "1": m, "date": d, "action": m})
                    history.append(entry)
                elif item:
                    history.append({"0": today.isoformat(), "1": str(item), "date": today.isoformat(), "action": str(item)})
            if action == "ready":
                if current_status == "READY":
                    return {**live, "id": str(dispatch_id)}, True
                if current_status != "PLANNED":
                    raise ValueError("Only a planned delivery can be marked ready.")
                next_status = "READY"
                action_message = "Marked ready for dispatch"
                updates = {"st": next_status, "status": next_status}
            elif action == "dispatch":
                if current_status == "DISPATCHED":
                    return {**live, "id": str(dispatch_id)}, True
                if current_status not in {"PLANNED", "READY"}:
                    raise ValueError("Only a planned or ready delivery can be dispatched.")
                dispatch_date = today.isoformat()
                expected_date = str(request.data.get("expectedDeliveryDate") or live.get("exp") or dispatch_date)[:10]
                try:
                    if date.fromisoformat(expected_date) < today:
                        expected_date = dispatch_date
                except ValueError:
                    raise ValueError("Expected delivery date is invalid.")
                next_status = "DISPATCHED"
                action_message = "Dispatched"
                updates = {"st": next_status, "status": next_status, "dp": dispatch_date, "exp": expected_date}
            elif action == "transit":
                if current_status == "IN_TRANSIT":
                    return {**live, "id": str(dispatch_id)}, True
                if current_status != "DISPATCHED":
                    raise ValueError("Only a dispatched delivery can be marked in transit.")
                next_status = "IN_TRANSIT"
                action_message = "In transit"
                updates = {"st": next_status, "status": next_status}
            else:
                try:
                    parsed_delivery_date = date.fromisoformat(delivery_date)
                except ValueError:
                    raise ValueError("Enter a valid delivery date.")
                existing_delivery_date = str(live.get("dd") or "")[:10]
                if current_status == "DELIVERED":
                    if existing_delivery_date == delivery_date:
                        return {**live, "id": str(dispatch_id)}, True
                    raise ValueError("This dispatch has already been marked delivered.")
                if current_status not in {"DISPATCHED", "IN_TRANSIT"}:
                    raise ValueError("Only a dispatched or in-transit delivery can be marked delivered.")
                dispatch_date = str(live.get("dp") or live.get("dispatchDate") or "")[:10]
                try:
                    parsed_dispatch_date = date.fromisoformat(dispatch_date)
                except ValueError:
                    raise ValueError("The dispatch date is missing or invalid.")
                if parsed_delivery_date < parsed_dispatch_date or parsed_delivery_date > today:
                    raise ValueError("Delivery date must be between the dispatch date and today.")
                next_status = "DELIVERED"
                action_message = "Delivered on " + delivery_date
                updates = {"st": next_status, "status": next_status, "dd": delivery_date}

            history.append({
                "0": today.isoformat(),
                "1": action_message,
                "date": today.isoformat(),
                "action": action_message,
                "at": now,
                "by": actor,
            })
            updates.update({"hist": history, "updatedAt": now, "updatedBy": actor})
            tx.update(dispatch_ref, firestore_safe(updates))
            return {**live, **updates, "id": str(dispatch_id)}, False

        try:
            transaction = get_db().transaction()
            saved, duplicate = firestore.transactional(transition)(transaction)
            return Response({"success": True, "dispatch": clean(saved), "duplicate": duplicate}, status=200)
        except ValueError as exc:
            message = str(exc)
            status_code = 404 if message == "Dispatch not found." else 409
            if message in {"Delivery date must be between the dispatch date and today.", "Enter a valid delivery date.",
                           "Expected delivery date is invalid."}:
                status_code = 400
            return Response({"error": message}, status=status_code)
        except Exception as exc:
            return api_error(exc, "Unable to mark the dispatch delivered.")


class ManualProductionOrderView(APIView):
    """Create a manually entered, Sales Order-linked work order."""

    def post(self, request):
        if request.user.membership.role not in {Role.PRODUCTION, Role.ADMIN}:
            return Response({"error": "Only Production or Admin can create a Production Order."}, status=403)
        data = request.data if isinstance(request.data, dict) else {}
        sales_order_id_input = str(data.get("salesOrderId") or data.get("sales_order_id") or "").strip()
        sales_order_number_input = str(data.get("salesOrderNumber") or data.get("sales_order_number") or "").strip()
        sales_order_ref_text = str(data.get("salesOrder") or sales_order_number_input or sales_order_id_input or "").strip()
        product_id_input = str(data.get("productId") or data.get("product_id") or "").strip()
        product_name = str(data.get("productName") or "").strip()
        product_code = str(data.get("productCode") or "").strip()
        unit = str(data.get("unit") or "Nos").strip()
        try:
            quantity = Decimal(str(data.get("quantity") or "0"))
        except (InvalidOperation, TypeError, ValueError):
            return Response({"error": "Enter a valid production quantity."}, status=400)
        if not sales_order_ref_text or not product_name:
            return Response({"error": "Enter the Sales Order and product details."}, status=400)
        if not quantity.is_finite() or quantity <= 0:
            return Response({"error": "Production quantity must be greater than zero."}, status=400)
        if data.get("noMaterialsRequired") is not True:
            return Response({"error": "Confirm that this manual order does not require raw materials. Material-consuming orders must use the Inventory-approved material plan."}, status=400)

        company_id = request.user.company.id
        logger.info("Manual Production Order lookup: company=%s salesOrderId=%s salesOrderNumber=%s salesOrder=%s productId=%s productCode=%s productName=%s",
                    company_id, sales_order_id_input, sales_order_number_input,
                    sales_order_ref_text, product_id_input, product_code, product_name)
        sales_lookup = sales_order_id_input or sales_order_ref_text
        expected_number = sales_order_number_input or sales_order_ref_text
        sales_records = module_records_ref(company_id, "sales")
        sales_ref = sales_records.document(sales_lookup)
        sales_snap = sales_ref.get()
        sales_order = {**(sales_snap.to_dict() or {}), "id": sales_ref.id} if sales_snap.exists else {}
        # The form accepts either the Firestore ID or the displayed SO number.
        # Older company records may use a legacy order type or omit recordType,
        # so resolve by the company-scoped sales list as well as direct ID.
        def is_sales_order(record):
            record_type = str(record.get("recordType") or "").replace("_", "").casefold()
            return (record_type in {"salesorder", "order"}
                    or (not record_type and bool(record.get("orderNumber") or record.get("salesOrderNumber"))))

        if (not is_sales_order(sales_order) or sales_order.get("isDeleted")
                or str(sales_order.get("companyId") or "") != str(company_id)):
            sales_order = next((row for row in list_module_records(company_id, "sales")
                                if not row.get("isDeleted") and is_sales_order(row)
                                and str(row.get("companyId") or "") == str(company_id)
                                and (str(row.get("id") or "") == sales_lookup
                                     or _production_match_key(row.get("orderNumber") or row.get("salesOrderNumber") or row.get("id"))
                                     == _production_match_key(expected_number))), {})
            if sales_order.get("id"):
                sales_ref = sales_records.document(str(sales_order["id"]))
                sales_snap = sales_ref.get()
        if (not sales_order or not is_sales_order(sales_order) or sales_order.get("isDeleted")
                or str(sales_order.get("companyId") or "") != str(company_id)):
            return Response({"error": "Sales Order was not found in this company."}, status=404)

        sales_items = [item for item in (sales_order.get("items") or []) if isinstance(item, dict)]
        logger.info("Manual Production Order Sales Order retrieved: company=%s salesOrderId=%s salesOrderNumber=%s items=%s",
                    company_id, sales_order.get("id"), sales_order.get("orderNumber") or sales_order.get("salesOrderNumber"), sales_items)

        def item_product_id(item):
            return str(item.get("productId") or item.get("product_id") or item.get("i")
                       or item.get("itemId") or item.get("item_id") or "").strip()

        def item_product_code(item):
            return (item.get("productCode") or item.get("product_code") or item.get("itemCode")
                    or item.get("item_code") or item.get("code") or "")

        def item_product_names(item):
            return (item.get("productName"), item.get("product_name"), item.get("itemName"),
                    item.get("item_name"), item.get("description"), item.get("name"))

        if product_id_input:
            sales_item = next((item for item in sales_items if item_product_id(item) == product_id_input), None)
            match_method = "productId"
        elif product_code:
            normalized_code = _production_match_key(product_code)
            sales_item = next((item for item in sales_items
                               if _production_match_key(item_product_code(item)) == normalized_code), None)
            match_method = "productCode"
        else:
            normalized_name = _production_match_key(product_name)
            sales_item = next((item for item in sales_items
                               if normalized_name and normalized_name in {
                                   _production_match_key(value) for value in item_product_names(item) if value
                               }), None)
            match_method = "productName"
        product_matched = bool(sales_item)
        logger.info("Manual Production Order product match: company=%s salesOrderId=%s method=%s matched=%s item=%s",
                    company_id, sales_order.get("id"), match_method, bool(sales_item), sales_item)

        today = date.today()
        try:
            expected_start = date.fromisoformat(str(data.get("expectedStartDate") or today.isoformat()))
            expected_completion = date.fromisoformat(str(data.get("expectedCompletionDate"))) if data.get("expectedCompletionDate") else None
        except ValueError:
            return Response({"error": "Enter valid expected start and completion dates."}, status=400)
        if expected_start < today or (expected_completion and expected_completion < expected_start):
            return Response({"error": "Check the expected start and completion dates."}, status=400)
        priority = str(data.get("priority") or "Medium")
        if priority not in {"Low", "Medium", "High", "Urgent"}:
            return Response({"error": "Choose a valid production priority."}, status=400)

        now = now_iso()
        idempotency_key = str(data.get("idempotencyKey") or data.get("idempotency_key") or "").strip()
        if not idempotency_key:
            idempotency_key = uuid.uuid4().hex
        if len(idempotency_key) > 160:
            return Response({"error": "Production Order submission key is invalid."}, status=400)
        order_id = "PO-M-" + hashlib.sha256(f"{company_id}:{idempotency_key}".encode("utf-8")).hexdigest()[:16].upper()
        actor = str(request.user.app_user.firebase_uid)
        actor_name = str(request.user.app_user.full_name or "")
        saved = {
            "id": order_id, "recordType": "workOrder", "module": "production", "companyId": str(company_id),
            "idempotencyKey": idempotency_key, "manualCreated": True,
            "manualNoMaterialRequired": True, "salesOrderId": str(sales_order.get("id") or ""),
            "salesOrderNumber": str(sales_order.get("orderNumber") or sales_order.get("salesOrderNumber") or sales_order.get("id") or sales_order_ref_text),
            "customerName": str(sales_order.get("customerName") or sales_order.get("customer") or ""),
            "so": str(sales_order.get("id") or ""), "productionRequestId": "", "productionRequestNo": "",
            "materialPlanId": "", "productId": item_product_id(sales_item) if sales_item else product_id_input,
            "productCode": product_code[:80], "productName": product_name[:160],
            "productMatchStatus": "Matched" if product_matched else "Unmatched",
            "productMatchMethod": match_method if product_matched else "",
            "item": str((item_product_id(sales_item) if sales_item else product_id_input) or product_name)[:160],
            "qty": float(quantity), "prod": 0, "unit": unit[:30] or str(sales_item.get("uom") or "Nos"),
            "materials": [], "cons": [], "batch": str(data.get("batch") or "").strip()[:80],
            "sup": str(data.get("supervisor") or "").strip()[:120],
            "start": expected_start.isoformat(), "expectedStartDate": expected_start.isoformat(),
            "expectedCompletionDate": expected_completion.isoformat() if expected_completion else "",
            "productionOrderDate": today.isoformat(), "priority": priority,
            "status": "PLANNED", "st": "PLANNED", "qc": "PENDING", "createdBy": actor,
            "cb": actor_name, "createdAt": now, "ca": today.isoformat(), "isDeleted": False,
            "hist": [{"0": today.isoformat(), "1": "Manual Production Order created",
                      "date": now, "message": "Manual Production Order created", "actorId": actor}],
        }
        try:
            existing_order = get_module_record(company_id, "production", order_id)
            if existing_order:
                if existing_order.get("idempotencyKey") != idempotency_key:
                    return Response({"error": "Production Order submission key is already in use."}, status=409)
                return Response({"success": True, "record": existing_order, "duplicate": True}, status=200)
            saved = save_module_record(company_id, "production", order_id, saved)
            return Response({"success": True, "record": saved}, status=201)
        except Exception as exc:
            return api_error(exc, "Unable to create the Production Order.")


class ProductionOrderActionView(APIView):
    """Company-scoped, transactional Production Order and stock actions."""

    @staticmethod
    def _resolve_order_ref(company_id, order_id):
        """Resolve a route ID to the existing company-scoped work-order doc.

        Current records use the Firestore document ID as ``id``. A few older
        imports kept the public order number in a field while using a separate
        document ID, so retain a company-scoped fallback for those records.
        Never create or migrate a record as part of an action lookup.
        """
        records = module_records_ref(company_id, "production")
        direct_ref = records.document(str(order_id))
        direct_snap = direct_ref.get()
        if direct_snap.exists and str((direct_snap.to_dict() or {}).get("companyId") or "") == str(company_id):
            return direct_ref

        matches = {}
        # Use the same tenant-filtered collection scan as module listing so
        # this lookup does not depend on a Firestore composite index.
        for snap in records.where("companyId", "==", str(company_id)).limit(5000).stream():
            data = snap.to_dict() or {}
            if (_is_work_order_record(data) and not data.get("isDeleted")
                    and str(data.get("companyId") or "") == str(company_id)
                    and any(str(data.get(field) or "") == str(order_id) for field in
                            ("id", "productionOrderNo", "productionOrderNumber", "workOrderNumber", "orderNumber"))):
                matches[snap.id] = snap.reference
        # An ambiguous human-readable number must never update an arbitrary row.
        return next(iter(matches.values())) if len(matches) == 1 else direct_ref

    def post(self, request, order_id, action):
        role = request.user.membership.role
        if role not in {Role.PRODUCTION, Role.QUALITY_CONTROL, Role.ADMIN}:
            return Response({"error": "Production permission is required."}, status=403)
        action = str(action or "").lower()
        allowed = {"start", "issue-material", "pause", "resume", "output", "send-qc", "pass-qc", "fail-qc", "request-cancel", "approve-cancel", "reject-cancel"}
        if action not in allowed:
            return Response({"error": "Unsupported Production Order action."}, status=404)
        if action in {"start", "issue-material", "pause", "resume", "output", "send-qc", "request-cancel", "approve-cancel", "reject-cancel"} and role not in {Role.PRODUCTION, Role.ADMIN}:
            return Response({"error": "Production permission is required for this action."}, status=403)
        if action in {"pass-qc", "fail-qc"} and role not in {Role.QUALITY_CONTROL, Role.ADMIN}:
            return Response({"error": "Quality Control permission is required."}, status=403)
        company_id = str(request.user.company.id)
        actor = str(request.user.app_user.firebase_uid)
        now = now_iso()
        order_ref = self._resolve_order_ref(company_id, order_id)
        try:
            payload = request.data
            if action == "issue-material":
                issue_id = str(payload.get("issueId") or "")
                issue_date = date.fromisoformat(str(payload.get("date") or ""))
                issues = payload.get("issues")
                if not re.fullmatch(r"[A-Za-z0-9_-]{8,128}", issue_id) or issue_date > date.today() or not isinstance(issues, list) or not issues:
                    return Response({"error": "Issue ID, date, and material quantities are required."}, status=400)
                quantities = {}
                for line in issues:
                    material_id = str(line.get("materialId") or "")
                    quantity = Decimal(str(line.get("quantity") or "0"))
                    if not material_id or not quantity.is_finite() or quantity <= 0:
                        return Response({"error": "Each issued material needs a valid item and positive quantity."}, status=400)
                    quantities[material_id] = quantities.get(material_id, Decimal("0")) + quantity
                inventory_records = module_records_ref(company_id, "inventory")
                stock_refs = {item_id: inventory_records.document(item_id) for item_id in quantities}
                movement_ids = {item_id: "PROD-ISSUE-" + issue_id + "-" + re.sub(r"[^A-Za-z0-9_-]", "", item_id)[:40] for item_id in quantities}
                movement_refs = {item_id: inventory_records.document(movement_ids[item_id]) for item_id in quantities}
            else:
                stock_refs, movement_refs, movement_ids, quantities = {}, {}, {}, {}

            transaction = get_db().transaction()

            @firestore.transactional
            def perform(tx):
                order_snap = _transaction_document(tx, order_ref)
                stock_snaps = {key: _transaction_document(tx, ref) for key, ref in stock_refs.items()}
                movement_snaps = {key: _transaction_document(tx, ref) for key, ref in movement_refs.items()}
                if not order_snap or not order_snap.exists:
                    raise ValueError("Production Order not found.")
                order = order_snap.to_dict() or {}
                if (not _is_work_order_record(order) or order.get("isDeleted")
                        or str(order.get("companyId") or "") != company_id):
                    raise ValueError("Production Order not found.")
                canonical_order_id = str(getattr(order_snap, "id", "")
                                         or getattr(order_ref, "id", "") or order_id)
                status = str(order.get("st") or order.get("status") or "PLANNED").upper()
                materials = [dict(row) for row in (order.get("materials") or []) if isinstance(row, dict)]
                history = list(order.get("hist") or [])
                def event(message):
                    return {"0": now[:10], "1": message, "date": now, "message": message, "actorId": actor}
                updates = {"updatedAt": now}
                sales_ref = None
                sales_updates = None
                if action == "start":
                    if status not in {"READY", "PLANNED"}:
                        raise ValueError("Only a planned or ready order can start.")
                    if order.get("materialPlanId"):
                        plan_ref = module_records_ref(company_id, "production").document(str(order.get("materialPlanId")))
                        plan_snap = _transaction_document(tx, plan_ref)
                        linked_plan = plan_snap.to_dict() or {} if plan_snap and plan_snap.exists else {}
                        if (linked_plan.get("recordType") != "materialPlan" or linked_plan.get("isDeleted")
                                or str(linked_plan.get("companyId") or "") != company_id
                                or linked_plan.get("approvalStatus") != "Approved"
                                or str(linked_plan.get("productionOrderId") or "") not in {canonical_order_id, str(order_id)}):
                            raise ValueError("The linked Inventory-approved Material Plan is unavailable or not approved.")
                    if order.get("salesOrderId"):
                        sales_ref = module_records_ref(company_id, "sales").document(str(order.get("salesOrderId")))
                        sales_snap = _transaction_document(tx, sales_ref)
                        sales = sales_snap.to_dict() or {} if sales_snap and sales_snap.exists else {}
                        if (not sales or sales.get("recordType") != "salesOrder" or sales.get("isDeleted")
                                or str(sales.get("companyId") or "") != company_id):
                            raise ValueError("Linked Sales Order is unavailable.")
                        if sales.get("accountingApprovalStatus") != "Approved":
                            raise ValueError("Accounting approval is required before production can start.")
                    no_material_order = order.get("manualCreated") is True and order.get("manualNoMaterialRequired") is True and not materials
                    if not no_material_order and (not materials or any(float(row.get("issuedQty") or 0) < float(row.get("requiredQty", row.get("requiredQuantity", 0)) or 0) for row in materials)):
                        raise ValueError("Issue all required approved materials before starting.")
                    updates.update({"st": "IN_PROGRESS", "status": "IN_PROGRESS", "actualStartAt": now, "actualStartBy": actor})
                    message = "Production started"
                elif action == "issue-material":
                    if status not in {"PLANNED", "PENDING_MATERIAL", "READY"}:
                        raise ValueError("Materials can only be issued before production starts.")
                    if order.get("materialPlanId"):
                        plan_ref = module_records_ref(company_id, "production").document(str(order.get("materialPlanId")))
                        plan_snap = _transaction_document(tx, plan_ref)
                        linked_plan = plan_snap.to_dict() or {} if plan_snap and plan_snap.exists else {}
                        if (linked_plan.get("recordType") != "materialPlan" or linked_plan.get("isDeleted")
                                or str(linked_plan.get("companyId") or "") != company_id
                                or linked_plan.get("approvalStatus") != "Approved"
                                or str(linked_plan.get("productionOrderId") or "") not in {canonical_order_id, str(order_id)}):
                            raise ValueError("The linked Inventory-approved Material Plan is unavailable or not approved.")
                    if any(snap and snap.exists for snap in movement_snaps.values()):
                        raise ValueError("This material issue was already recorded.")
                    consumption = [dict(row) for row in (order.get("cons") or []) if isinstance(row, dict)]
                    for material_id, quantity in quantities.items():
                        indices = [i for i, row in enumerate(materials) if str(row.get("materialId") or "") == material_id]
                        if not indices:
                            raise ValueError("An issued item is not part of the approved Production Order plan.")
                        stock_snap = stock_snaps[material_id]
                        stock = stock_snap.to_dict() or {} if stock_snap and stock_snap.exists else {}
                        if (not stock or stock.get("recordType") != "stockItem" or stock.get("isDeleted")
                                or str(stock.get("companyId") or "") != company_id):
                            raise ValueError("A required Inventory item no longer exists.")
                        on_hand = Decimal(str(stock.get("qty", stock.get("availableStock", 0)) or 0))
                        reserved = Decimal(str(stock.get("reservedStock") or 0))
                        remaining_by_line = {index: Decimal(str(materials[index].get("requiredQty", materials[index].get("requiredQuantity", 0)) or 0)) - Decimal(str(materials[index].get("issuedQty") or 0)) for index in indices}
                        if quantity > sum(remaining_by_line.values(), Decimal("0")):
                            raise ValueError("Issue quantity exceeds the remaining approved requirement.")
                        if quantity > reserved or quantity > on_hand:
                            raise ValueError("Inventory stock or reserved quantity is insufficient.")
                        to_allocate = quantity
                        for index in indices:
                            allocation = min(to_allocate, max(Decimal("0"), remaining_by_line[index]))
                            if allocation:
                                materials[index]["issuedQty"] = float(Decimal(str(materials[index].get("issuedQty") or 0)) + allocation)
                                to_allocate -= allocation
                            if to_allocate <= 0:
                                break
                        material = materials[indices[0]]
                        item_name = stock.get("itemName") or stock.get("name") or stock.get("n") or material.get("materialName") or material_id
                        unit = stock.get("unit") or stock.get("uom") or material.get("unit") or ""
                        consumption.append({"id": movement_ids[material_id], "materialId": material_id, "materialName": item_name, "quantity": float(quantity), "unit": unit, "date": issue_date.isoformat(), "issuedAt": now, "issuedBy": actor})
                        stock_updates = {"qty": float(on_hand - quantity), "reservedStock": float(reserved - quantity), "updatedAt": now}
                        if "availableStock" in stock:
                            stock_updates["availableStock"] = float(max(Decimal("0"), Decimal(str(stock.get("availableStock") or 0)) - quantity))
                        tx.update(stock_refs[material_id], stock_updates)
                        tx.create(movement_refs[material_id], {"id": movement_ids[material_id], "recordType": "stockMovement", "module": "inventory", "type": "OUT", "t": "OUT", "item": material_id, "itemId": material_id, "itemCode": stock.get("code") or stock.get("itemCode") or "", "itemName": item_name, "qty": float(quantity), "quantity": float(quantity), "direction": "OUT", "ref": canonical_order_id, "date": issue_date.isoformat(), "by": request.user.app_user.full_name or actor, "companyId": company_id, "createdBy": actor, "createdAt": now, "productionOrderId": canonical_order_id, "issueId": issue_id})
                    updates.update({"materials": materials, "cons": consumption})
                    complete = all(Decimal(str(row.get("issuedQty") or 0)) >= Decimal(str(row.get("requiredQty", row.get("requiredQuantity", 0)) or 0)) for row in materials)
                    if complete and status in {"PLANNED", "PENDING_MATERIAL"}:
                        updates.update({"st": "READY", "status": "READY"})
                    message = "Production materials issued"
                elif action in {"pause", "resume"}:
                    expected = "IN_PROGRESS" if action == "pause" else "PAUSED"
                    if status != expected:
                        raise ValueError("Order status changed; refresh and try again.")
                    updates.update({"st": "PAUSED" if action == "pause" else "IN_PROGRESS", "status": "PAUSED" if action == "pause" else "IN_PROGRESS"})
                    message = "Production paused" if action == "pause" else "Production resumed"
                elif action == "output":
                    if status != "IN_PROGRESS":
                        raise ValueError("Output can only be recorded for an in-progress order.")
                    quantity = Decimal(str(payload.get("quantity") or "0"))
                    produced = Decimal(str(order.get("prod") or 0))
                    planned = Decimal(str(order.get("qty") or 0))
                    if not quantity.is_finite() or quantity <= 0 or produced + quantity > planned:
                        raise ValueError("Output must be positive and cannot exceed planned quantity.")
                    updates["prod"] = float(produced + quantity)
                    message = f"Output recorded: +{quantity}"
                elif action == "send-qc":
                    if status != "IN_PROGRESS" or Decimal(str(order.get("prod") or 0)) < Decimal(str(order.get("qty") or 0)):
                        raise ValueError("Record the full planned production quantity while in progress before sending the order to QC.")
                    updates.update({"st": "QC_PENDING", "status": "QC_PENDING"})
                    message = "Sent to quality control"
                elif action in {"pass-qc", "fail-qc"}:
                    if status != "QC_PENDING":
                        raise ValueError("Only an order awaiting QC can receive a QC decision.")
                    if action == "pass-qc":
                        updates.update({"qc": "PASSED", "st": "COMPLETED", "status": "COMPLETED", "end": date.today().isoformat(), "completedAt": now, "completedBy": actor})
                        sales_order_id = str(order.get("salesOrderId") or "")
                        if sales_order_id:
                            sales_ref = module_records_ref(company_id, "sales").document(sales_order_id)
                            sales_snap = _transaction_document(tx, sales_ref)
                            sales_order = sales_snap.to_dict() or {} if sales_snap and sales_snap.exists else {}
                            if (not sales_snap or not sales_snap.exists or sales_order.get("recordType") != "salesOrder"
                                    or sales_order.get("isDeleted") or str(sales_order.get("companyId") or "") != company_id
                                    or str(sales_order.get("status") or "").upper() == "CANCELLED"):
                                raise ValueError("The linked Sales Order is unavailable or cancelled.")
                            sales_event = {"at": now, "actorId": actor, "action": "Production completed; ready for Transport"}
                            sales_updates = {"status": "READY_FOR_TRANSPORT", "productionStatus": "COMPLETED",
                                             "productionCompletedAt": now, "transportStatus": "NOT_REQUESTED",
                                             "history": list(sales_order.get("history") or []) + [sales_event], "updatedAt": now}
                        message = "QC passed; production completed"
                    else:
                        reason = str(payload.get("reason") or "").strip()
                        if not reason:
                            raise ValueError("A failure reason is required.")
                        updates.update({"qc": "FAILED", "st": "IN_PROGRESS", "status": "IN_PROGRESS", "qcFailureReason": reason[:1000]})
                        message = "QC failed: " + reason[:300]
                elif action == "request-cancel":
                    reason = str(payload.get("reason") or "").strip()
                    if not reason or len(reason) < 5:
                        raise ValueError("Enter a cancellation reason of at least 5 characters.")
                    if status in {"COMPLETED", "CANCELLED"} or float(order.get("prod") or 0) > 0 or order.get("cons"):
                        raise ValueError("Cancellation review is limited to orders with no material issues or output.")
                    if order.get("cst"):
                        raise ValueError("A cancellation request is already awaiting approval.")
                    updates["cst"] = {"by": actor, "requestedBy": request.user.app_user.full_name or "", "reason": reason[:1000], "date": date.today().isoformat(), "requestedAt": now}
                    message = "Cancellation requested"
                elif action in {"approve-cancel", "reject-cancel"}:
                    cancellation = order.get("cst") or {}
                    if not cancellation:
                        raise ValueError("No cancellation request is awaiting review.")
                    if str(cancellation.get("by") or "") == actor:
                        raise ValueError("A different Production approver must review this cancellation request.")
                    if float(order.get("prod") or 0) > 0 or order.get("cons"):
                        raise ValueError("Cancellation cannot proceed after material issue or output.")
                    if action == "approve-cancel" and order.get("materialPlanId"):
                        plan_ref = module_records_ref(company_id, "production").document(str(order.get("materialPlanId")))
                        plan_snap = _transaction_document(tx, plan_ref)
                        plan = plan_snap.to_dict() or {} if plan_snap and plan_snap.exists else {}
                        if (plan.get("recordType") != "materialPlan" or plan.get("isDeleted")
                                or str(plan.get("companyId") or "") != company_id
                                or plan.get("approvalStatus") != "Approved"
                                or str(plan.get("productionOrderId") or "") not in {canonical_order_id, str(order_id)}):
                            raise ValueError("The linked Material Plan could not be validated for cancellation.")
                        plan_materials = [row for row in (plan.get("materials") or []) if isinstance(row, dict)]
                        inventory_records = module_records_ref(company_id, "inventory")
                        cancellation_stock_refs = {str(row.get("materialId") or ""): inventory_records.document(str(row.get("materialId") or "")) for row in plan_materials if row.get("materialId")}
                        cancellation_stock_snaps = {item_id: _transaction_document(tx, ref) for item_id, ref in cancellation_stock_refs.items()}
                        required_by_stock = {}
                        for material in plan_materials:
                            material_id = str(material.get("materialId") or "")
                            required_by_stock[material_id] = required_by_stock.get(material_id, Decimal("0")) + Decimal(str(material.get("requiredQty", material.get("requiredQuantity", 0)) or 0))
                        reservation_updates = {}
                        for material_id, required in required_by_stock.items():
                            stock_snap = cancellation_stock_snaps.get(material_id)
                            stock = stock_snap.to_dict() or {} if stock_snap and stock_snap.exists else {}
                            reserved = Decimal(str(stock.get("reservedStock") or 0))
                            if (not stock or stock.get("isDeleted")
                                    or str(stock.get("companyId") or "") != company_id
                                    or required > reserved):
                                raise ValueError("Inventory reservation changed; cancellation was not applied.")
                            reservation_updates[material_id] = float(reserved - required)
                        request_id = str(order.get("productionRequestId") or "")
                        request_ref = module_records_ref(company_id, "production").document(request_id) if request_id else None
                        request_snap = _transaction_document(tx, request_ref) if request_ref else None
                        for material_id, reserved in reservation_updates.items():
                            tx.update(cancellation_stock_refs[material_id], {"reservedStock": reserved, "updatedAt": now})
                        tx.update(plan_ref, {"approvalStatus": "Cancelled", "status": "Cancelled", "cancelledAt": now, "cancelledBy": actor, "updatedAt": now})
                        if request_snap and request_snap.exists:
                            linked_request = request_snap.to_dict() or {}
                            if (linked_request.get("recordType") != "productionRequest"
                                    or linked_request.get("isDeleted")
                                    or str(linked_request.get("companyId") or "") != company_id
                                    or str(linked_request.get("productionOrderId") or "") not in {canonical_order_id, str(order_id)}):
                                raise ValueError("The linked Production Request could not be validated for cancellation.")
                            tx.update(request_ref, {"status": "Cancelled", "cancelledAt": now, "updatedAt": now})
                    updates["cst"] = None
                    if action == "approve-cancel":
                        updates.update({"cr": cancellation.get("reason") or "", "st": "CANCELLED", "status": "CANCELLED", "cancelledAt": now, "cancelledBy": actor})
                        message = "Cancellation approved"
                    else:
                        message = "Cancellation request rejected"
                history.append(event(message))
                updates["hist"] = history
                tx.update(order_ref, updates)
                if sales_ref and sales_updates:
                    tx.update(sales_ref, sales_updates)
                return {**order, **updates, "id": canonical_order_id,
                        "recordType": order.get("recordType") or "workOrder"}

            record = perform(transaction)
            return Response({"success": True, "record": clean(record)})
        except ValueError as exc:
            return Response({"error": str(exc)}, status=409)
        except (InvalidOperation, TypeError) as exc:
            return Response({"error": "A material or production quantity is invalid."}, status=400)
        except Exception as exc:
            return api_error(exc, "Unable to update Production Order.")


class MaterialPlanningActionView(APIView):
    """Company-scoped stock check and approval actions for Production plans."""

    @staticmethod
    def _ref(company_id, record_id):
        return (module_records_ref(company_id, "production").document(str(record_id)))

    @staticmethod
    def _stock_map(company_id):
        return {str(record.get("id")): record for record in list_module_records(company_id, "inventory")
                if record.get("recordType") == "stockItem" and not record.get("isDeleted")}

    @staticmethod
    def _recheck(materials, stock_map):
        checked = []
        for source in materials:
            material = dict(source)
            material.pop("stockCheckError", None)
            stock = stock_map.get(str(material.get("materialId") or ""))
            if stock:
                requested_unit = str(material.get("unit") or "").strip().casefold()
                stock_unit = str(stock.get("unit") or stock.get("uom") or "").strip().casefold()
                if requested_unit and stock_unit and requested_unit != stock_unit:
                    material["stockCheckError"] = f"Unit mismatch: request uses {material.get('unit')} but Inventory uses {stock.get('unit') or stock.get('uom')}."
                material.update({
                    "materialCode": stock.get("code") or stock.get("itemCode") or material.get("materialCode", ""),
                    "materialName": stock.get("itemName") or stock.get("name") or stock.get("n") or material.get("materialName", ""),
                    # Inventory's qty is the on-hand source of truth. A cached
                    # availableStock field can be stale and must not override it.
                    "availableStock": float(stock.get("qty", stock.get("availableStock", 0)) or 0),
                    "reservedStock": float(stock.get("reservedStock", 0) or 0),
                    "unit": stock.get("unit") or stock.get("uom") or material.get("unit", ""),
                    "warehouse": stock.get("warehouse") or material.get("warehouse", ""),
                })
            elif material.get("materialId"):
                material["stockCheckError"] = "Selected material no longer exists in Inventory."
            required = float(material.get("requiredQty", material.get("requiredQuantity", 0)) or 0)
            material["requiredQty"] = required
            material["requiredQuantity"] = required
            available = float(material.get("availableStock") or 0)
            reserved = float(material.get("reservedStock") or 0)
            incoming = float(material.get("expectedIncomingStock") or 0)
            net = max(0, available - reserved)
            shortage = max(0, required - net)
            purchase = max(0, shortage - incoming)
            reorder_level = float((stock or {}).get("reorderLevel", (stock or {}).get("ro", 0)) or 0)
            if stock:
                material["category"] = stock.get("category") or material.get("category", "")
                material["reorderLevel"] = reorder_level
            availability = "Available" if shortage == 0 else ("Partial Availability" if net > 0 else "Shortage")
            if shortage == 0 and reorder_level > 0 and net <= reorder_level:
                availability = "Low Stock"
            material.update({"netAvailableStock": net, "shortageQuantity": shortage,
                             "purchaseQuantity": purchase,
                             "estimatedAmount": purchase * float(material.get("estimatedUnitRate") or 0),
                             "availabilityStatus": availability})
            checked.append(material)
        return checked

    def post(self, request, plan_id, action):
        role = request.user.membership.role
        company_id = request.user.company.id
        plan_ref = self._ref(company_id, plan_id)
        try:
            plan_snap = plan_ref.get()
            plan = plan_snap.to_dict() or {} if plan_snap.exists else {}
            if (not plan_snap.exists or plan.get("recordType") != "materialPlan" or plan.get("isDeleted")
                    or str(plan.get("companyId") or "") != str(company_id)):
                return Response({"error": "Raw Material Planning request was not found."}, status=404)
            request_ref = self._ref(company_id, plan.get("productionRequestId"))
            request_snap = request_ref.get()
            production_request = request_snap.to_dict() or {} if request_snap.exists else {}
            if (not request_snap.exists or production_request.get("recordType") != "productionRequest"
                    or production_request.get("isDeleted")
                    or str(production_request.get("companyId") or "") != str(company_id)):
                return Response({"error": "Linked Production Request was not found."}, status=409)

            if action == "send":
                if role not in {Role.PRODUCTION, Role.ADMIN}:
                    return Response({"error": "Only Production or Admin can send a Material Request to Inventory."}, status=403)
                if plan.get("sentToInventoryAt"):
                    return Response({"error": "This Material Request has already been sent to Inventory."}, status=409)
                if plan.get("approvalStatus") == "Approved" or plan.get("productionOrderId"):
                    return Response({"error": "An approved or ordered Material Request cannot be resubmitted."}, status=409)
                materials = plan.get("materials") or []
                if not materials:
                    return Response({"error": "Add at least one raw material before sending to Inventory."}, status=400)
                for material in materials:
                    required = Decimal(str(material.get("requiredQty", material.get("requiredQuantity", 0)) or 0))
                    if (not required.is_finite() or not material.get("materialId") or required <= 0
                            or not str(material.get("unit") or "").strip()):
                        return Response({"error": "Each raw material needs an item, positive required quantity and unit."}, status=400)
                    material["requiredQty"] = float(required)
                    material["requiredQuantity"] = float(required)
                    material["productionRequestId"] = plan.get("productionRequestId")
                    material["productionRequestNo"] = plan.get("productionRequestNo") or plan.get("requestCode")
                    material["productionOrderId"] = plan.get("productionOrderId") or ""
                timestamp = now_iso()
                sender = str(request.user.app_user.firebase_uid)
                db = get_db()
                transaction = db.transaction()

                @firestore.transactional
                def send_once(txn):
                    current_plan = _transaction_document(txn, plan_ref)
                    current_request = _transaction_document(txn, request_ref)
                    if current_plan is None or current_request is None:
                        return False
                    latest_plan = current_plan.to_dict() or {} if current_plan.exists else {}
                    if (not current_plan.exists or latest_plan.get("recordType") != "materialPlan"
                            or latest_plan.get("isDeleted")
                            or str(latest_plan.get("companyId") or "") != str(company_id)
                            or str(latest_plan.get("productionRequestId") or "") != str(request_ref.id)):
                        return False
                    if latest_plan.get("sentToInventoryAt") or latest_plan.get("approvalStatus") == "Pending":
                        return False
                    latest_request = current_request.to_dict() or {} if current_request.exists else {}
                    if (not current_request.exists or latest_request.get("recordType") != "productionRequest"
                            or latest_request.get("isDeleted")
                            or str(latest_request.get("companyId") or "") != str(company_id)
                            or (latest_request.get("materialPlanId")
                                and str(latest_request.get("materialPlanId")) != str(plan_id))):
                        return False
                    if not latest_plan.get("materials"):
                        return False
                    txn.update(plan_ref, {"status": "Sent to Inventory", "approvalStatus": "Pending",
                                          "sentToInventoryAt": timestamp, "sentToInventoryBy": sender,
                                          "materials": materials,
                                          "inventoryVerificationStatus": "Not Checked",
                                          "reviewHistory": [*(latest_plan.get("reviewHistory") or []),
                                                             {"action": "Sent to Inventory", "at": timestamp, "by": sender}]})
                    txn.update(request_ref, {"status": "Pending Inventory Approval", "materialPlanId": str(plan_id),
                                             "rejectionReason": ""})
                    return True

                if not send_once(transaction):
                    return Response({"error": "This Material Request has already been sent or is not eligible to send."}, status=409)
                return Response({"success": True, "status": "Pending Inventory Approval",
                                 "materialRequestNo": plan.get("materialRequestNo"), "sentAt": timestamp})

            if action == "check":
                if role not in {Role.INVENTORY, Role.ADMIN}:
                    return Response({"error": "Inventory permission is required to verify materials."}, status=403)
                materials = self._recheck(plan.get("materials") or [], self._stock_map(company_id))
                return Response({"materials": materials, "checkedAt": now_iso(),
                                 "available": bool(materials) and all(m.get("shortageQuantity", 0) == 0 for m in materials)})

            if action in {"approve", "reject", "delete"} and role not in {Role.INVENTORY, Role.ADMIN}:
                return Response({"error": "Only Inventory or Admin can review Raw Material Planning requests."}, status=403)
            if action in {"approve", "reject", "delete"} and plan.get("approvalStatus") != "Pending":
                return Response({"error": "This Material Request has not been submitted for Inventory review or was already reviewed."}, status=409)
            if action == "delete":
                if plan.get("productionOrderId"):
                    return Response({"error": "A plan linked to a Production Order cannot be cancelled."}, status=409)
                plan_ref.update({"isDeleted": True, "approvalStatus": "Cancelled", "cancelledAt": now_iso(),
                                 "cancelledBy": str(request.user.app_user.firebase_uid),
                                 "reviewHistory": [*(plan.get("reviewHistory") or []), {"action": "Cancelled", "at": now_iso(), "by": str(request.user.app_user.firebase_uid)}]})
                return Response({"success": True})
            if action == "reject":
                reason = str(request.data.get("reason") or "").strip()
                if not reason:
                    return Response({"error": "A rejection reason is required."}, status=400)
                timestamp = now_iso()
                review_id = f"{plan_id}-round-{int(plan.get('reviewRound') or 1)}"
                review_ref = (material_planning_reviews_ref(company_id)
                              .document(review_id))
                batch = get_db().batch()
                batch.create(review_ref, {"action": "Rejected", "reviewedAt": timestamp,
                                          "reviewedBy": str(request.user.app_user.firebase_uid)})
                batch.update(plan_ref, {"approvalStatus": "Rejected", "rejectionReason": reason[:1000],
                                        "reviewedBy": str(request.user.app_user.firebase_uid), "reviewedAt": timestamp,
                                        "reviewHistory": [*(plan.get("reviewHistory") or []), {"action": "Rejected", "reason": reason[:1000], "at": timestamp, "by": str(request.user.app_user.firebase_uid)}]})
                batch.update(request_ref, {"status": "Rejected", "rejectionReason": reason[:1000], "inventoryReviewedAt": timestamp})
                batch.commit()
                return Response({"success": True, "status": "Rejected"})
            if action == "approve":
                if plan.get("approvalStatus") == "Approved":
                    return Response({"error": "This planning request is already approved."}, status=409)
                if production_request.get("status") in {"Inventory Approved", "Production Order Created"}:
                    return Response({"error": "The Production Request has already been reviewed or ordered."}, status=409)
                timestamp = now_iso()
                approver = str(request.user.app_user.firebase_uid)
                review_id = f"{plan_id}-round-{int(plan.get('reviewRound') or 1)}"
                review_ref = (material_planning_reviews_ref(company_id)
                              .document(review_id))
                materials_to_reserve = plan.get("materials") or []
                stock_refs = {}
                for material in materials_to_reserve:
                    material_id = str(material.get("materialId") or "")
                    if material_id:
                        stock_refs[material_id] = module_records_ref(company_id, "inventory").document(material_id)
                transaction = get_db().transaction()

                @firestore.transactional
                def approve_and_reserve(txn):
                    plan_snap = _transaction_document(txn, plan_ref)
                    request_snap = _transaction_document(txn, request_ref)
                    review_snap = _transaction_document(txn, review_ref)
                    stock_snaps = {material_id: _transaction_document(txn, ref) for material_id, ref in stock_refs.items()}
                    if plan_snap is None or request_snap is None or review_snap is None:
                        return {"conflict": True}
                    live_plan = plan_snap.to_dict() or {} if plan_snap.exists else {}
                    live_request = request_snap.to_dict() or {} if request_snap.exists else {}
                    if (not plan_snap.exists or live_plan.get("recordType") != "materialPlan"
                            or live_plan.get("isDeleted")
                            or str(live_plan.get("companyId") or "") != str(company_id)
                            or str(live_plan.get("productionRequestId") or "") != str(request_ref.id)
                            or live_plan.get("approvalStatus") != "Pending"
                            or not live_plan.get("sentToInventoryAt")
                            or not request_snap.exists
                            or live_request.get("recordType") != "productionRequest"
                            or live_request.get("isDeleted")
                            or str(live_request.get("companyId") or "") != str(company_id)
                            or str(live_request.get("materialPlanId") or "") != str(plan_id)
                            or live_request.get("status") != "Pending Inventory Approval"):
                        return {"conflict": True}
                    if review_snap.exists:
                        return {"conflict": True}
                    stock_map = {material_id: {**(snap.to_dict() or {}), "id": material_id}
                                 for material_id, snap in stock_snaps.items() if snap is not None and snap.exists
                                 and str((snap.to_dict() or {}).get("companyId") or "") == str(company_id)
                                 and not (snap.to_dict() or {}).get("isDeleted")}
                    materials = self._recheck(live_plan.get("materials") or [], stock_map)
                    requested_by_stock = {}
                    for material in materials:
                        material_id = str(material.get("materialId") or "")
                        required = float(material.get("requiredQty", 0) or 0)
                        if not material_id or required <= 0:
                            material["stockCheckError"] = "Production required quantity is missing or invalid."
                        requested_by_stock[material_id] = requested_by_stock.get(material_id, 0) + required
                    insufficient = False
                    for material_id, total_required in requested_by_stock.items():
                        stock = stock_map.get(material_id)
                        net = max(0, float((stock or {}).get("qty", (stock or {}).get("availableStock", 0)) or 0)
                                  - float((stock or {}).get("reservedStock", 0) or 0))
                        if not stock or net < total_required:
                            insufficient = True
                            for material in materials:
                                if str(material.get("materialId") or "") == material_id:
                                    material["shortageQuantity"] = max(0, total_required - net)
                                    material["stockCheckError"] = f"Production requested {total_required:g}; available stock is {net:g}."
                    if not materials or insufficient or any(material.get("stockCheckError") for material in materials):
                        return {"insufficient": True, "materials": materials}
                    txn.create(review_ref, {"action": "Approved", "reviewedAt": timestamp, "reviewedBy": approver})
                    for material_id, total_required in requested_by_stock.items():
                        stock = stock_map[material_id]
                        txn.update(stock_refs[material_id], {"reservedStock": float(stock.get("reservedStock", 0) or 0) + total_required})
                    txn.update(plan_ref, {"materials": materials, "approvalStatus": "Approved", "status": "Approved",
                                          "inventoryVerificationStatus": "Verified", "materialAvailabilityStatus": "Available",
                                          "approvedBy": approver, "approvedAt": timestamp, "reviewedBy": approver,
                                          "reviewedAt": timestamp, "reviewHistory": [*(live_plan.get("reviewHistory") or []),
                                          {"action": "Approved", "at": timestamp, "by": approver}]})
                    txn.update(request_ref, {"status": "Inventory Approved", "materialPlanId": str(plan_id),
                                             "inventoryApprovedBy": approver, "inventoryApprovedAt": timestamp})
                    return {"success": True, "materials": materials}

                result = approve_and_reserve(transaction)
                if result.get("conflict"):
                    return Response({"error": "This request was already reviewed or is no longer pending."}, status=409)
                if result.get("insufficient"):
                    return Response({"error": "Insufficient or unverifiable stock. Production's requested quantity exceeds available stock.",
                                     "materials": result["materials"]}, status=409)
                materials = result["materials"]
                return Response({"success": True, "status": "Approved", "materials": materials, "approvedAt": timestamp})

            if action == "create-order":
                if role not in {Role.PRODUCTION, Role.ADMIN}:
                    return Response({"error": "Only Production or Admin can create a Production Order."}, status=403)
                bypass_inventory_approval = bool(request.data.get("bypassInventoryApproval"))
                if bypass_inventory_approval:
                    if role != Role.ADMIN:
                        return Response({"error": "Only Admin can bypass Inventory approval."}, status=403)
                elif plan.get("approvalStatus") != "Approved" or production_request.get("status") != "Inventory Approved":
                    return Response({"error": "Inventory approval is required before creating a Production Order."}, status=409)
                if plan.get("productionOrderId") or production_request.get("productionOrderId"):
                    return Response({"error": "A Production Order already exists for this request."}, status=409)
                order_id = "PO-" + re.sub(r"[^A-Za-z0-9-]", "", str(production_request.get("requestCode") or plan_id))
                sales_order_id = str(production_request.get("salesOrderId") or "")
                sales_ref = module_records_ref(company_id, "sales").document(sales_order_id)
                sales_snap = sales_ref.get()
                sales_order = sales_snap.to_dict() or {} if sales_snap.exists else {}
                if (not sales_snap.exists or sales_order.get("recordType") != "salesOrder"
                        or sales_order.get("isDeleted")
                        or str(sales_order.get("companyId") or "") != str(company_id)):
                    return Response({"error": "The linked Sales Order is unavailable in this company."}, status=409)
                if sales_order.get("accountingApprovalStatus") != "Approved":
                    return Response({"error": "Accounting approval is required before creating a Production Order."}, status=409)
                items = [item for item in (production_request.get("items") or []) if isinstance(item, dict)]
                selected_product_id = str(request.data.get("productId") or plan.get("productId") or "")
                item = next((line for line in items if str(line.get("itemId") or line.get("productId") or line.get("id") or "") == selected_product_id), None)
                if not item:
                    return Response({"error": "The Production Request has no eligible product item."}, status=409)
                quantity_value = request.data.get("quantity")
                quantity = float(plan.get("plannedQuantity") or 0) if quantity_value is None else float(quantity_value)
                order_item_id = str(item.get("itemId") or item.get("productId") or "")
                matched = next((line for line in (sales_order.get("items") or []) if isinstance(line, dict)
                               and str(line.get("productId") or line.get("i") or "") == order_item_id), None)
                if (not matched or quantity <= 0 or quantity > float(plan.get("plannedQuantity") or 0)
                        or quantity > float(item.get("quantity", item.get("qty", 0)) or 0)
                        or quantity > float(matched.get("qty", matched.get("quantity", 0)) or 0)):
                    return Response({"error": "The planned quantity or product does not match the linked Sales Order."}, status=409)
                try:
                    expected_start = date.fromisoformat(str(request.data.get("expectedStartDate") or date.today().isoformat()))
                except ValueError:
                    return Response({"error": "Expected start date must be a valid ISO date."}, status=400)
                if expected_start < date.today():
                    return Response({"error": "Expected start date cannot be in the past."}, status=400)
                priority = str(request.data.get("priority") or production_request.get("priority") or "Medium")
                if priority not in {"Low", "Medium", "High", "Urgent"}:
                    return Response({"error": "Unsupported Production Order priority."}, status=400)
                order_ref = self._ref(company_id, order_id)
                if order_ref.get().exists:
                    return Response({"error": "Production Order number is already in use."}, status=409)
                # Module reads are company scoped. Stamp both fields on this
                # batch-created document just like save_module_record does;
                # without them the transaction succeeds but the order vanishes
                # from /api/modules/production/data.
                order = {"id": order_id, "companyId": str(company_id), "module": "production",
                         "recordType": "workOrder", "productionRequestId": production_request.get("id"),
                         "productionRequestNo": production_request.get("requestCode"), "materialPlanId": plan_id,
                         "salesOrderId": sales_order_id, "salesOrderNumber": production_request.get("salesOrderNumber"),
                         "so": sales_order_id, "item": order_item_id, "qty": quantity, "prod": 0,
                         "batch": "", "sup": "", "start": date.today().isoformat(), "end": None, "qc": "PENDING",
                         "cb": str(request.user.app_user.full_name or ""), "ca": date.today().isoformat(), "dq": 0,
                         "dt": "", "da": "", "dr": "", "cr": "", "cst": None,
                         # Firestore does not allow an array directly inside another array.
                         # Store history events as maps. Numeric keys keep the existing
                         # frontend's legacy x[0]/x[1] history reader working.
                         "hist": [{
                             "0": date.today().isoformat(),
                             "1": "Production Order created (Admin bypass: Inventory approval not recorded)" if bypass_inventory_approval else "Inventory-approved Production Order created",
                             "date": date.today().isoformat(),
                             "message": "Production Order created with Admin approval bypass" if bypass_inventory_approval else "Inventory-approved Production Order created",
                         }],
                         "productName": item.get("productName") or item.get("itemName"),
                         "materials": plan.get("materials") or [], "status": "PLANNED", "st": "PLANNED",
                         "priority": priority,
                         "expectedStartDate": expected_start.isoformat(),
                         "productionOrderDate": date.today().isoformat(), "createdBy": str(request.user.app_user.firebase_uid),
                         "createdAt": now_iso(), "expectedCompletionDate": production_request.get("requiredCompletionDate") or production_request.get("deliveryDate"),
                         "inventoryApprovalBypassed": bypass_inventory_approval,
                         "inventoryApprovalBypassedBy": str(request.user.app_user.firebase_uid) if bypass_inventory_approval else ""}
                batch = get_db().batch()
                batch.create(order_ref, order)
                linked_materials = [{**material, "productionOrderId": order_id, "productionOrderNo": order_id}
                                    for material in (plan.get("materials") or [])]
                batch.update(plan_ref, {"productionOrderId": order_id, "materials": linked_materials})
                batch.update(request_ref, {"status": "Production Order Created", "productionOrderId": order_id})
                batch.commit()
                return Response({"success": True, "record": order}, status=201)
            return Response({"error": "Unsupported planning action."}, status=404)
        except Exception as exc:
            if action in {"approve", "reject"}:
                review_id = f"{plan_id}-round-{int(plan.get('reviewRound') or 1)}"
                review_ref = (material_planning_reviews_ref(company_id)
                              .document(review_id))
                if review_ref.get().exists:
                    return Response({"error": "This planning request has already been reviewed."}, status=409)
            return api_error(exc, "Unable to process material planning action.")


class CloudinaryUploadView(APIView):
    parser_classes = [MultiPartParser, FormParser]

    def post(self, request):
        uploaded = request.FILES.get("file")
        if not uploaded:
            return Response({"error": "Choose a file to upload."}, status=400)
        if uploaded.size > 15 * 1024 * 1024:
            return Response({"error": "Maximum upload size is 15 MB."}, status=400)
        content_type = (uploaded.content_type or "").lower()
        is_image = content_type.startswith("image/")
        is_pdf = content_type == "application/pdf" or uploaded.name.lower().endswith(".pdf")
        if not (is_image or is_pdf):
            return Response({"error": "Only images and PDF files are supported."}, status=400)
        try:
            import cloudinary
            import cloudinary.uploader
            cloud_name = getattr(settings, "CLOUDINARY_CLOUD_NAME", "")
            api_key = getattr(settings, "CLOUDINARY_API_KEY", "")
            api_secret = getattr(settings, "CLOUDINARY_API_SECRET", "")
            if not all([cloud_name, api_key, api_secret]):
                return Response({"error": "Cloudinary is not configured. Set CLOUDINARY_CLOUD_NAME, CLOUDINARY_API_KEY, and CLOUDINARY_API_SECRET."}, status=503)
            cloudinary.config(cloud_name=cloud_name, api_key=api_key, api_secret=api_secret, secure=True)
            folder = f"vyparx/{request.user.company.id}/{str(request.data.get('folder') or 'documents').strip('/')[:60]}"
            resource_type = "image" if is_image else "raw"
            result = cloudinary.uploader.upload(uploaded, folder=folder, resource_type=resource_type,
                                                use_filename=True, unique_filename=True, overwrite=False)
            return Response({"success": True, "url": result.get("secure_url"),
                             "publicId": result.get("public_id"), "resourceType": resource_type,
                             "format": result.get("format"), "bytes": result.get("bytes")}, status=201)
        except Exception as exc:
            logger.exception("Cloudinary upload failed")
            return Response({"error": "File upload failed. Verify Cloudinary configuration."}, status=502)


class PasswordResetView(APIView):
    authentication_classes = []
    permission_classes = [permissions.AllowAny]

    def post(self, request):
        email = str(request.data.get("email") or "").strip().lower()
        if not email: return Response({"error": "Email is required."}, status=400)
        try:
            link = FirebaseAuthService.generate_password_reset_link(email)
            return Response({"success": True, "resetLink": link if settings.DEBUG else None})
        except FirebaseNotConfigured as exc:
            return Response({"error": str(exc)}, status=503)
        except Exception:
            logger.exception("Password reset link generation failed")
            return Response({"error": "Unable to generate password reset link."}, status=400)


def next_sales_order_number(company_id):
    """Allocate the next company-scoped Sales Order number transactionally."""
    return _next_company_number(company_id, "sales", "salesOrder", "SO", "salesOrder", "orderNumber")
