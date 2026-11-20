import re

from django.db import transaction
from rest_framework import serializers

from .firebase import FirebaseAuthService, FirebaseNotConfigured
from .models import AppUser, Company, CompanyMembership, MembershipStatus, Role, TaskStatus

GSTIN_RE = re.compile(r"^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z][1-9A-Z]Z[0-9A-Z]$")


def normalize_role(value):
    if not value:
        return ""
    clean = str(value).strip().lower()
    for role in Role.values:
        if clean == role.lower():
            return role
    if "crm" in clean:
        return Role.CRM
    if "sales" in clean:
        return Role.SALES
    if "purchase" in clean:
        return Role.PURCHASE
    if "inventory" in clean:
        return Role.INVENTORY
    if "quality" in clean or clean == "qc":
        return Role.QUALITY_CONTROL
    if "production" in clean:
        return Role.PRODUCTION
    if "transport" in clean:
        return Role.TRANSPORT
    if "employee" in clean or "hr" in clean:
        return Role.EMPLOYEE_MANAGEMENT
    if "account" in clean or "finance" in clean:
        return Role.ACCOUNTING_FINANCE
    if clean == "admin":
        return Role.ADMIN
    return ""


def flatten_registration_payload(data):
    personal = data.get("personal") or {}
    business = data.get("business") or {}
    return {
        "owner_name": data.get("ownerName") or data.get("owner_name") or personal.get("fullName"),
        "email": data.get("email") or personal.get("email"),
        "phone": data.get("phone") or personal.get("mobile"),
        "address": data.get("address") or personal.get("address"),
        "country": data.get("country") or personal.get("country"),
        "state": data.get("state") or personal.get("state"),
        "pin_code": data.get("pinCode") or data.get("pin_code") or personal.get("pinCode"),
        "password": data.get("password") or personal.get("adminPassword"),
        "confirm_password": data.get("confirmPassword") or data.get("confirm_password") or personal.get("confirmPassword"),
        "company_name": data.get("companyName") or data.get("company_name") or business.get("companyName"),
        "registered_business_name": (
            data.get("registeredBusinessName")
            or data.get("registered_business_name")
            or business.get("registeredBusinessName")
            or business.get("companyName")
        ),
        "gstin": (data.get("gstin") or business.get("gstin") or "").upper().strip(),
        "business_type": business.get("businessType") or data.get("businessType") or "",
        "industry": business.get("industry") or data.get("industry") or "",
        "employees": business.get("employees") or data.get("employees") or "",
        "business_location": business.get("businessLocation") or data.get("businessLocation") or "",
        "requirements": data.get("requirements") or {},
    }


class RegistrationSerializer(serializers.Serializer):
    company_name = serializers.CharField(max_length=180)
    registered_business_name = serializers.CharField(max_length=220)
    gstin = serializers.CharField(max_length=15, required=False, allow_blank=True)
    owner_name = serializers.CharField(max_length=160)
    email = serializers.EmailField()
    phone = serializers.CharField(max_length=32)
    address = serializers.CharField()
    country = serializers.CharField(max_length=80)
    state = serializers.CharField(max_length=80)
    pin_code = serializers.CharField(max_length=12)
    password = serializers.CharField(write_only=True, min_length=8)
    confirm_password = serializers.CharField(write_only=True, min_length=8)
    business_type = serializers.CharField(max_length=120, required=False, allow_blank=True)
    industry = serializers.CharField(max_length=120, required=False, allow_blank=True)
    employees = serializers.CharField(max_length=40, required=False, allow_blank=True)
    business_location = serializers.CharField(max_length=220, required=False, allow_blank=True)
    requirements = serializers.JSONField(required=False)

    def to_internal_value(self, data):
        return super().to_internal_value(flatten_registration_payload(data))

    def validate(self, attrs):
        if attrs["password"] != attrs["confirm_password"]:
            raise serializers.ValidationError({"confirm_password": "Password and confirm password must match."})
        gstin = attrs.get("gstin", "")
        if gstin and not GSTIN_RE.match(gstin):
            raise serializers.ValidationError({"gstin": "Enter a valid GSTIN."})
        if gstin and Company.objects.filter(gstin__iexact=gstin).exists():
            raise serializers.ValidationError({"gstin": "A company with this GSTIN is already registered."})
        if AppUser.objects.filter(email__iexact=attrs["email"]).exists():
            raise serializers.ValidationError({"email": "An account with this email already exists."})
        return attrs

    def create(self, validated_data):
        firebase_user = None
        try:
            firebase_user = FirebaseAuthService.create_user(
                email=validated_data["email"],
                password=validated_data["password"],
                display_name=validated_data["owner_name"],
            )
            with transaction.atomic():
                company = Company.objects.create(
                    company_name=validated_data["company_name"],
                    registered_business_name=validated_data["registered_business_name"],
                    gstin=validated_data.get("gstin", ""),
                    email=validated_data["email"].lower(),
                    phone=validated_data["phone"],
                    address=validated_data["address"],
                    country=validated_data["country"],
                    state=validated_data["state"],
                    pin_code=validated_data["pin_code"],
                    business_type=validated_data.get("business_type", ""),
                    industry=validated_data.get("industry", ""),
                    employees=validated_data.get("employees", ""),
                    business_location=validated_data.get("business_location", ""),
                    requirements=validated_data.get("requirements", {}),
                )
                app_user = AppUser.objects.create(
                    firebase_uid=firebase_user.uid,
                    email=validated_data["email"].lower(),
                    full_name=validated_data["owner_name"],
                    phone=validated_data["phone"],
                )
                membership = CompanyMembership.objects.create(
                    company=company,
                    user=app_user,
                    role=Role.ADMIN,
                    department="Administration",
                    status=MembershipStatus.ACTIVE,
                    is_company_owner=True,
                )
            return company, app_user, membership
        except FirebaseNotConfigured:
            raise
        except Exception:
            if firebase_user is not None:
                try:
                    FirebaseAuthService.delete_user(firebase_user.uid)
                except Exception:
                    pass
            raise


class LoginSerializer(serializers.Serializer):
    idToken = serializers.CharField()
    role = serializers.CharField()


class CompanyProfileSerializer(serializers.ModelSerializer):
    """Read + update the registered company profile.

    Only company Admins may update (enforced in the view). The company record
    created during registration is the single source of truth for the
    dashboard name, Profile Settings, and all document headers.
    """

    gstin = serializers.CharField(max_length=15, required=False, allow_blank=True, allow_null=True)

    class Meta:
        model = Company
        fields = [
            "company_name",
            "registered_business_name",
            "gstin",
            "email",
            "phone",
            "address",
            "country",
            "state",
            "pin_code",
            "business_type",
            "industry",
            "employees",
            "business_location",
        ]
        read_only_fields = ["email"]

    def validate_gstin(self, value):
        gstin = (value or "").upper().strip()
        if gstin and not GSTIN_RE.match(gstin):
            raise serializers.ValidationError("Enter a valid 15-character GSTIN (e.g. 24ABCDE1234F1Z5).")
        qs = Company.objects.filter(gstin__iexact=gstin)
        company = self.context.get("company")
        if gstin and company:
            qs = qs.exclude(pk=company.pk)
        if gstin and qs.exists():
            raise serializers.ValidationError("A company with this GSTIN is already registered.")
        return gstin


class DepartmentHeadAssignSerializer(serializers.Serializer):
    """Assign an active department user as the head of a department."""

    user_id = serializers.UUIDField()
    department = serializers.CharField(max_length=80)

    def validate(self, attrs):
        company = self.context["company"]
        try:
            membership = CompanyMembership.objects.select_related("user").get(
                company=company, user_id=attrs["user_id"]
            )
        except CompanyMembership.DoesNotExist:
            raise serializers.ValidationError({"user_id": "User not found in your company."})
        if membership.status != MembershipStatus.ACTIVE:
            raise serializers.ValidationError({"user_id": "Only active users can be assigned as department head."})
        if membership.role == Role.ADMIN:
            raise serializers.ValidationError({"user_id": "The company Admin cannot be a department head."})
        attrs["membership"] = membership
        return attrs

class UserSerializer(serializers.ModelSerializer):
    id = serializers.UUIDField(source="user.id", read_only=True)
    fullName = serializers.CharField(source="user.full_name", read_only=True)
    email = serializers.EmailField(source="user.email", read_only=True)
    status = serializers.CharField()
    headDepartment = serializers.CharField(source="head_department", read_only=True)

    class Meta:
        model = CompanyMembership
        fields = ["id", "fullName", "email", "role", "department", "headDepartment", "status", "created_at"]


class DepartmentUserCreateSerializer(serializers.Serializer):
    fullName = serializers.CharField(max_length=160)
    email = serializers.EmailField()
    password = serializers.CharField(write_only=True, min_length=8)
    role = serializers.CharField()
    department = serializers.CharField(max_length=80, required=False, allow_blank=True)
    status = serializers.ChoiceField(choices=MembershipStatus.choices, default=MembershipStatus.ACTIVE)

    def validate_role(self, value):
        role = normalize_role(value)
        if not role:
            raise serializers.ValidationError("Unsupported role.")
        return role

    def validate_email(self, value):
        if AppUser.objects.filter(email__iexact=value).exists():
            raise serializers.ValidationError("A user with this email already exists.")
        return value.lower()

    def create(self, validated_data):
        company = self.context["company"]
        admin_user = self.context["admin_user"]
        firebase_user = None
        try:
            firebase_user = FirebaseAuthService.create_user(
                email=validated_data["email"],
                password=validated_data["password"],
                display_name=validated_data["fullName"],
            )
            with transaction.atomic():
                app_user = AppUser.objects.create(
                    firebase_uid=firebase_user.uid,
                    email=validated_data["email"],
                    full_name=validated_data["fullName"],
                )
                membership = CompanyMembership.objects.create(
                    company=company,
                    user=app_user,
                    role=validated_data["role"],
                    department=validated_data.get("department") or validated_data["role"],
                    status=validated_data["status"],
                    created_by=admin_user,
                )
            return membership
        except Exception:
            if firebase_user is not None:
                try:
                    FirebaseAuthService.delete_user(firebase_user.uid)
                except Exception:
                    pass
            raise


class DepartmentUserUpdateSerializer(serializers.Serializer):
    fullName = serializers.CharField(max_length=160, required=False)
    password = serializers.CharField(write_only=True, min_length=8, required=False)
    role = serializers.CharField(required=False)
    department = serializers.CharField(max_length=80, required=False)
    status = serializers.ChoiceField(choices=MembershipStatus.choices, required=False)

    def validate_role(self, value):
        role = normalize_role(value)
        if not role:
            raise serializers.ValidationError("Unsupported role.")
        return role

    def validate(self, attrs):
        """Role/department compatibility: each department role maps to its own
        department. Admin may keep any department.
        """
        role = attrs.get("role")
        department = attrs.get("department")
        if role and role != Role.ADMIN and department:
            allowed = {
                Role.CRM: "CRM",
                Role.SALES: "Sales Order",
                Role.PURCHASE: "Purchase & Trading",
                Role.INVENTORY: "Inventory",
                Role.PRODUCTION: "Production",
                Role.QUALITY_CONTROL: "Production",
                Role.TRANSPORT: "Transport",
                Role.EMPLOYEE_MANAGEMENT: "Administration",
                Role.ACCOUNTING_FINANCE: "Accounting",
            }
            if allowed.get(role) != department:
                raise serializers.ValidationError(
                    {"department": f"The {role} role can only be assigned to the {allowed.get(role, 'matching')} department."}
                )
        return attrs


TASK_TYPES = ["Task", "Announcement", "Reminder"]
TASK_PRIORITIES = ["Low", "Medium", "High", "Urgent"]


class TaskCreateSerializer(serializers.Serializer):
    """Validate task creation input against the model's allowed values."""

    title = serializers.CharField(max_length=200)
    department = serializers.CharField(max_length=80, required=False, default="All")
    description = serializers.CharField(required=False, allow_blank=True, default="")
    type = serializers.ChoiceField(choices=TASK_TYPES, required=False, default="Task")
    priority = serializers.ChoiceField(choices=TASK_PRIORITIES, required=False, default="Medium")
    dueDate = serializers.DateField(required=False, allow_null=True)
    status = serializers.ChoiceField(choices=TaskStatus.choices, required=False, default=TaskStatus.PENDING)

    def validate_title(self, value):
        title = value.strip()
        if not title:
            raise serializers.ValidationError("Task title is required.")
        return title

