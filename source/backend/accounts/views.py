import logging
from functools import wraps
from .welcome_email import queue_welcome_email
from django.conf import settings
from django.db import transaction
from django.utils import timezone
from rest_framework import permissions, status
from rest_framework.decorators import api_view, authentication_classes, permission_classes
from rest_framework.response import Response
from rest_framework.views import APIView

from .firebase import FirebaseAuthService, FirebaseNotConfigured, firebase_web_config_status
from .models import Alert, AlertSeverity, AppUser, CompanyMembership, MembershipStatus, Role, Task, TaskStatus
from .permissions import IsCompanyAdmin, user_can_access_module
from .serializers import (
    CompanyProfileSerializer,
    DepartmentHeadAssignSerializer,
    DepartmentUserCreateSerializer,
    DepartmentUserUpdateSerializer,
    LoginSerializer,
    RegistrationSerializer,
    TaskCreateSerializer,
    UserSerializer,
    normalize_role,
)

logger = logging.getLogger(__name__)


def handle_firebase_errors(log_message, generic_error="Operation failed safely. No local changes were committed."):
    """Normalize Firebase failures for API view methods.

    A missing/again-unconfigured Firebase Admin SDK becomes a 503 so the client
    knows the request is retryable; any other Firebase error is logged in full
    server-side and returned as a generic 400 so internal details are not leaked.
    """

    def decorator(func):
        @wraps(func)
        def wrapper(self, request, *args, **kwargs):
            try:
                return func(self, request, *args, **kwargs)
            except FirebaseNotConfigured as exc:
                return Response({"error": str(exc)}, status=status.HTTP_503_SERVICE_UNAVAILABLE)
            except Exception:
                logger.exception(log_message, request.data.get("email"))
                return Response({"error": generic_error}, status=400)

        return wrapper

    return decorator


def session_payload(membership):
    company = membership.company
    user = membership.user
    return {
        "id": str(user.id),
        "userId": str(user.id),
        "fullName": user.full_name,
        "email": user.email,
        "role": membership.role,
        "department": membership.department,
        "companyId": str(company.id),
        "companyName": company.company_name,
        "status": membership.status,
    }


@api_view(["GET"])
@authentication_classes([])
@permission_classes([permissions.AllowAny])
def firebase_config(request):
    configured, config = firebase_web_config_status()
    safe_config = config if configured else {}
    return Response({"configured": configured, "config": safe_config})


class RegisterView(APIView):
    authentication_classes = []
    permission_classes = [permissions.AllowAny]

    @handle_firebase_errors(
        "Registration failed unexpectedly for %s",
        generic_error="Registration failed safely. No local account was committed.",
    )
    def post(self, request):
        serializer = RegistrationSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        company, app_user, membership = serializer.save()
        queue_welcome_email(
            app_user.full_name,
            app_user.email,
            company.company_name,
        )
        return Response(
            {
                "success": True,
                "companyId": str(company.id),
                "user": session_payload(membership),
            },
            status=status.HTTP_201_CREATED,
        )


class LoginView(APIView):
    authentication_classes = []
    permission_classes = [permissions.AllowAny]

    def post(self, request):
        serializer = LoginSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        selected_role = normalize_role(serializer.validated_data["role"])
        if not selected_role:
            return Response({"error": "Unsupported role selection."}, status=400)
        try:
            claims = FirebaseAuthService.verify_id_token(serializer.validated_data["idToken"])
        except FirebaseNotConfigured as exc:
            return Response({"error": str(exc)}, status=status.HTTP_503_SERVICE_UNAVAILABLE)
        except Exception as exc:
            logger.warning("Firebase token verification failed for %s: %s", request.data.get("email"), exc)
            return Response({"error": "Invalid Firebase credentials."}, status=status.HTTP_401_UNAUTHORIZED)

        try:
            app_user = AppUser.objects.get(firebase_uid=claims["uid"], is_active=True)
        except AppUser.DoesNotExist:
            return Response({"error": "Authenticated user is not registered in VyaparX."}, status=401)

        membership = (
            CompanyMembership.objects.select_related("company", "user")
            .filter(user=app_user, status=MembershipStatus.ACTIVE, company__is_active=True)
            .first()
        )
        if not membership:
            return Response({"error": "No active company membership found."}, status=403)
        if membership.role != selected_role:
            return Response(
                {"error": f"Your account is not authorized for the selected role. (Assigned role: {membership.role})"},
                status=403,
            )
        return Response({"success": True, "user": session_payload(membership), "dashboardUrl": role_dashboard(membership.role)})


class MeView(APIView):
    def get(self, request):
        return Response({"user": session_payload(request.user.membership)})


class AdminUsersView(APIView):
    permission_classes = [IsCompanyAdmin]

    def get(self, request):
        users = (
            CompanyMembership.objects.select_related("user")
            .filter(company=request.user.company)
            .order_by("created_at")
        )
        return Response({"users": UserSerializer(users, many=True).data})

    @handle_firebase_errors(
        "Department user creation failed for %s",
        generic_error="User creation failed safely. No local account was committed.",
    )
    def post(self, request):
        serializer = DepartmentUserCreateSerializer(
            data=request.data,
            context={"company": request.user.company, "admin_user": request.user.app_user},
        )
        serializer.is_valid(raise_exception=True)
        membership = serializer.save()
        return Response({"success": True, "user": UserSerializer(membership).data}, status=status.HTTP_201_CREATED)


class AdminUserDetailView(APIView):
    permission_classes = [IsCompanyAdmin]

    def _get_membership(self, request, user_id):
        return (
            CompanyMembership.objects.select_related("user")
            .filter(company=request.user.company, user_id=user_id)
            .first()
        )

    def validate_update(self, membership, request, data):
        """Return an error Response if the update is not permitted, else None."""
        if membership.is_company_owner and data.get("status") == MembershipStatus.INACTIVE:
            return Response({"error": "Cannot deactivate primary company administrator."}, status=400)
        if membership.user_id == request.user.app_user.id and data.get("role") and data["role"] != Role.ADMIN:
            return Response({"error": "Users cannot lower or elevate their own role."}, status=400)
        return None

    def apply_membership_update(self, membership, data):
        """Persist the validated field changes atomically."""
        with transaction.atomic():
            if "fullName" in data:
                membership.user.full_name = data["fullName"]
                membership.user.save(update_fields=["full_name", "updated_at"])
            if "role" in data:
                membership.role = data["role"]
                # A role change implies the old department head assignment no
                # longer applies; clear it so stale permissions are not kept.
                membership.head_department = ""
            if "department" in data:
                membership.department = data["department"]
                if membership.head_department and membership.head_department != data["department"]:
                    membership.head_department = ""
            if "status" in data:
                membership.status = data["status"]
                if data["status"] != MembershipStatus.ACTIVE:
                    membership.head_department = ""
            membership.save()

    def _update_firebase_password(self, membership, password):
        try:
            FirebaseAuthService.update_user(membership.user.firebase_uid, password=password)
        except FirebaseNotConfigured as exc:
            return Response({"error": str(exc)}, status=status.HTTP_503_SERVICE_UNAVAILABLE)
        except Exception as exc:
            # The local membership change is already committed; report the
            # partial failure so the client knows Firebase is out of sync.
            return Response(
                {
                    "error": "Profile updated locally, but the password could not be updated in Firebase.",
                    "partialFailure": True,
                    "detail": str(exc),
                    "user": UserSerializer(membership).data,
                },
                status=status.HTTP_502_BAD_GATEWAY,
            )
        return None

    def put(self, request, user_id):
        membership = self._get_membership(request, user_id)
        if not membership:
            return Response({"error": "User not found in your company."}, status=404)

        serializer = DepartmentUserUpdateSerializer(data=request.data, partial=True)
        serializer.is_valid(raise_exception=True)
        data = serializer.validated_data

        error = self.validate_update(membership, request, data)
        if error:
            return error

        self.apply_membership_update(membership, data)

        if "password" in data:
            error = self._update_firebase_password(membership, data["password"])
            if error:
                return error

        return Response({"success": True, "user": UserSerializer(membership).data})


class ModuleDataView(APIView):
    def get(self, request, module_name):
        if not user_can_access_module(request.user, module_name):
            return Response(
                {"error": f"Forbidden: your role is not permitted to access {module_name} module data."},
                status=403,
            )
        return Response(
            {
                "module": module_name,
                "companyId": str(request.user.company.id),
                "status": "Authorized",
            }
        )


class PasswordResetView(APIView):
    authentication_classes = []
    permission_classes = [permissions.AllowAny]

    def post(self, request):
        email = (request.data.get("email") or "").strip().lower()
        if not email:
            return Response({"error": "Email is required."}, status=400)
        try:
            link = FirebaseAuthService.generate_password_reset_link(email)
        except FirebaseNotConfigured as exc:
            return Response({"error": str(exc)}, status=status.HTTP_503_SERVICE_UNAVAILABLE)
        return Response({"success": True, "resetLink": link if settings.DEBUG else None})


def role_dashboard(role):
    return {
        Role.ADMIN: "admin.html",
        Role.CRM: "CRM.html",
        Role.SALES: "sales.html",
        Role.PURCHASE: "purchese.html",
        Role.INVENTORY: "inventory.html",
        Role.PRODUCTION: "producation.html",
        Role.QUALITY_CONTROL: "producation.html",
        Role.TRANSPORT: "transport.html",
        Role.EMPLOYEE_MANAGEMENT: "admin.html",
        Role.ACCOUNTING_FINANCE: "accounting.html",
    }.get(role, "loginpage.html")

class CompanyProfileView(APIView):
    """Company profile: read (any member of the company) and update (Admin only).

    The registered company record is the single source of truth for the
    dashboard header, Profile Settings, and all document headers.
    """

    def get(self, request):
        company = request.user.company
        return Response({"company": CompanyProfileSerializer(company).data})

    def put(self, request):
        if request.user.membership.role != Role.ADMIN:
            return Response({"error": "Only company Admins can update company details."}, status=403)
        serializer = CompanyProfileSerializer(
            request.user.company, data=request.data, partial=True, context={"company": request.user.company}
        )
        serializer.is_valid(raise_exception=True)
        serializer.save()
        return Response({"success": True, "company": serializer.data})


class DepartmentHeadView(APIView):
    permission_classes = [IsCompanyAdmin]

    def get(self, request):
        heads = CompanyMembership.objects.select_related("user").filter(
            company=request.user.company,
            status=MembershipStatus.ACTIVE,
        ).exclude(head_department="")
        data = [
            {
                "department": m.head_department,
                "userId": str(m.user_id),
                "fullName": m.user.full_name,
                "email": m.user.email,
            }
            for m in heads
        ]
        return Response({"heads": data})

    def post(self, request):
        serializer = DepartmentHeadAssignSerializer(
            data=request.data, context={"company": request.user.company}
        )
        serializer.is_valid(raise_exception=True)
        membership = serializer.validated_data["membership"]
        department = serializer.validated_data["department"]

        # Only one active head per department: demote any previous head.
        with transaction.atomic():
            CompanyMembership.objects.filter(
                company=request.user.company, head_department=department
            ).exclude(pk=membership.pk).update(head_department="")
            membership.head_department = department
            membership.department = department
            membership.save(update_fields=["head_department", "department", "updated_at"])
        return Response(
            {
                "success": True,
                "head": {
                    "department": department,
                    "userId": str(membership.user_id),
                    "fullName": membership.user.full_name,
                    "email": membership.user.email,
                },
            }
        )


class TaskListView(APIView):
    """Tasks / announcements. Completed tasks can be soft-deleted by Admins."""

    def get(self, request):
        tasks = Task.objects.filter(company=request.user.company, is_deleted=False).order_by("-created_at")
        data = [
            {
                "id": str(t.id),
                "department": t.department,
                "title": t.title,
                "description": t.description,
                "type": t.type,
                "priority": t.priority,
                "dueDate": t.due_date.isoformat() if t.due_date else None,
                "status": t.status,
                "isRead": t.is_read,
                "createdAt": t.created_at.isoformat(),
            }
            for t in tasks
        ]
        return Response({"tasks": data})

    def post(self, request):
        if request.user.membership.role != Role.ADMIN:
            return Response({"error": "Only Admins can create tasks."}, status=403)
        serializer = TaskCreateSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        data = serializer.validated_data
        task = Task.objects.create(
            company=request.user.company,
            department=data.get("department") or "All",
            title=data["title"],
            description=data.get("description", ""),
            type=data.get("type") or "Task",
            priority=data.get("priority") or "Medium",
            due_date=data.get("dueDate"),
            status=data.get("status") or TaskStatus.PENDING,
            created_by=request.user.app_user,
        )
        return Response({"success": True, "id": str(task.id)}, status=201)


class TaskDetailView(APIView):
    def _get_task(self, request, task_id):
        try:
            return Task.objects.get(company=request.user.company, id=task_id, is_deleted=False)
        except Task.DoesNotExist:
            return None

    def patch(self, request, task_id):
        task = self._get_task(request, task_id)
        if not task:
            return Response({"error": "Task not found."}, status=404)
        if "isRead" in request.data:
            task.is_read = bool(request.data["isRead"])
        if "status" in request.data and request.data["status"] in TaskStatus.values:
            task.status = request.data["status"]
        task.save()
        return Response({"success": True})

    def delete(self, request, task_id):
        """Soft-delete (archive) a COMPLETED task. Admin only. Incomplete
        tasks can never be deleted through this endpoint."""
        if request.user.membership.role != Role.ADMIN:
            return Response({"error": "Only Admins can delete completed tasks."}, status=403)
        task = self._get_task(request, task_id)
        if not task:
            return Response({"error": "Task not found."}, status=404)
        if task.status != TaskStatus.COMPLETED:
            return Response(
                {"error": "Only completed tasks can be deleted. This action is restricted to preserve audit history."},
                status=400,
            )
        task.is_deleted = True
        task.deleted_at = timezone.now()
        task.save(update_fields=["is_deleted", "deleted_at", "updated_at"])
        return Response({"success": True})


class AlertListView(APIView):
    """Persisted business alerts, generated from real records and deduplicated."""

    def get(self, request):
        alerts = (
            Alert.objects.filter(company=request.user.company, is_dismissed=False)
            .order_by("-event_time")[:50]
        )
        data = [
            {
                "id": str(a.id),
                "severity": a.severity,
                "title": a.title,
                "description": a.description,
                "sourceModule": a.source_module,
                "recordRef": a.record_ref,
                "link": a.link,
                "eventTime": a.event_time.isoformat(),
                "isRead": a.is_read,
            }
            for a in alerts
        ]
        return Response({"alerts": data})

    def post(self, request):
        """Upsert an alert (idempotent by dedup_key). Called by module
        controllers when a real business condition is detected."""
        dedup_key = (request.data.get("dedupKey") or "").strip()
        title = (request.data.get("title") or "").strip()
        if not dedup_key or not title:
            return Response({"error": "dedupKey and title are required."}, status=400)
        alert, created = Alert.objects.update_or_create(
            company=request.user.company,
            dedup_key=dedup_key,
            defaults={
                "severity": request.data.get("severity") or AlertSeverity.INFO,
                "title": title,
                "description": request.data.get("description", ""),
                "source_module": request.data.get("sourceModule") or "General",
                "record_ref": request.data.get("recordRef", ""),
                "link": request.data.get("link", ""),
                "event_time": timezone.now(),
                # A re-detected unresolved condition becomes unread again.
                "is_read": False,
                "is_dismissed": False,
            },
        )
        return Response({"success": True, "created": created, "id": str(alert.id)})

    def patch(self, request, alert_id):
        alert = Alert.objects.filter(company=request.user.company, id=alert_id).first()
        if not alert:
            return Response({"error": "Alert not found."}, status=404)
        if request.data.get("dismiss"):
            alert.is_dismissed = True
        elif "isRead" in request.data:
            alert.is_read = bool(request.data["isRead"])
        alert.save()
        return Response({"success": True})
