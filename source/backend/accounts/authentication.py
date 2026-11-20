from types import SimpleNamespace
from rest_framework import authentication, exceptions
from .firebase import FirebaseAuthService, FirebaseNotConfigured
from .firestore_store import get_identity


class AuthenticatedIdentity:
    is_authenticated = True
    is_anonymous = False

    def __init__(self, identity, claims):
        u = identity["user"]
        c = identity["company"]
        m = identity["membership"]
        self.firebase_claims = claims
        self.app_user = SimpleNamespace(
            id=identity["uid"], firebase_uid=identity["uid"],
            full_name=u.get("fullName", ""), email=u.get("email", ""),
            is_active=u.get("isActive", True),
        )
        self.company = SimpleNamespace(
            id=identity["companyId"], company_name=c.get("companyName", ""),
            registered_business_name=c.get("registeredBusinessName", ""),
            gstin=c.get("gstin", ""), email=c.get("email", ""),
            phone=c.get("phone", ""), address=c.get("address", ""),
            country=c.get("country", ""), state=c.get("state", ""),
            pin_code=c.get("pinCode", ""), is_active=c.get("isActive", True),
        )
        self.membership = SimpleNamespace(
            id=identity["uid"], user_id=identity["uid"], company=self.company,
            user=self.app_user, role=m.get("role", ""), department=m.get("department", ""),
            status=m.get("status", "ACTIVE"), head_department=m.get("headDepartment", ""),
            is_company_owner=bool(m.get("isCompanyOwner", False)),
            is_active=m.get("status", "ACTIVE") == "ACTIVE",
        )
        self.id = identity["uid"]
        self.email = self.app_user.email
        self.company_id = identity["companyId"]
        self.role = self.membership.role


class FirebaseAuthentication(authentication.BaseAuthentication):
    keyword = "Bearer"

    def authenticate(self, request):
        header = authentication.get_authorization_header(request).decode("utf-8")
        if not header:
            return None
        parts = header.split()
        if len(parts) != 2 or parts[0] != self.keyword:
            raise exceptions.AuthenticationFailed("Invalid Authorization header.")
        try:
            claims = FirebaseAuthService.verify_id_token(parts[1])
            uid = claims.get("uid")
            identity = get_identity(uid) if uid else None
        except FirebaseNotConfigured as exc:
            raise exceptions.AuthenticationFailed(str(exc)) from exc
        except Exception as exc:
            raise exceptions.AuthenticationFailed("Invalid or expired Firebase token.") from exc
        if not identity:
            raise exceptions.AuthenticationFailed("User has no active VyaparX company membership.")
        return AuthenticatedIdentity(identity, claims), None
