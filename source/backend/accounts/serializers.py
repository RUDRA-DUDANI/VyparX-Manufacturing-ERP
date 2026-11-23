"""Input normalization shared by Firestore backed API views.

Business entities are validated and persisted by the Firestore API layer; this
module intentionally contains no Django ModelSerializer or ORM persistence.
"""
import re

from .models import Role


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
            data.get("registeredBusinessName") or data.get("registered_business_name")
            or business.get("registeredBusinessName") or business.get("companyName")
        ),
        "gstin": (data.get("gstin") or business.get("gstin") or "").upper().strip(),
        "business_type": business.get("businessType") or data.get("businessType") or "",
        "industry": business.get("industry") or data.get("industry") or "",
        "employees": business.get("employees") or data.get("employees") or "",
        "business_location": business.get("businessLocation") or data.get("businessLocation") or "",
        "requirements": data.get("requirements") or {},
    }
