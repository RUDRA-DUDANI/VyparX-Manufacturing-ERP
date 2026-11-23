from rest_framework.permissions import BasePermission

from .models import Role


MODULE_ROLE_MAP = {
    "admin": {Role.ADMIN},
    "users": {Role.ADMIN},
    "team": {Role.ADMIN, Role.EMPLOYEE_MANAGEMENT},
    "team-attendance": {Role.ADMIN, Role.EMPLOYEE_MANAGEMENT},
    "communications": {Role.ADMIN, Role.CRM, Role.SALES, Role.PURCHASE, Role.INVENTORY, Role.PRODUCTION, Role.QUALITY_CONTROL, Role.TRANSPORT, Role.ACCOUNTING_FINANCE, Role.EMPLOYEE_MANAGEMENT},
    "tasks": {Role.ADMIN, Role.CRM, Role.SALES, Role.PURCHASE, Role.INVENTORY, Role.PRODUCTION, Role.QUALITY_CONTROL, Role.TRANSPORT, Role.ACCOUNTING_FINANCE, Role.EMPLOYEE_MANAGEMENT},
    "crm": {Role.CRM},
    "sales": {Role.SALES},
    "sales-order-items-data": {Role.SALES},
    "purchase-orders": {Role.PURCHASE},
    "production-orders": {Role.PRODUCTION, Role.QUALITY_CONTROL},
    "transport-delivery": {Role.TRANSPORT},
    "accounting-payments": {Role.ACCOUNTING_FINANCE},
    "purchase": {Role.PURCHASE},
    # Accounting must be able to read purchase orders to create the linked
    # purchaseAccountingRequest records from the Accounting workspace.
    "accounting": {Role.ACCOUNTING_FINANCE},
    "inventory": {Role.INVENTORY},
    "production": {Role.PRODUCTION, Role.QUALITY_CONTROL},
    "transport": {Role.TRANSPORT},
    "finance": {Role.ACCOUNTING_FINANCE},
    "suppliers": {Role.PURCHASE},
    "sales-order-items": {Role.SALES},
    "purchase-production-material": {Role.PURCHASE, Role.PRODUCTION},
    "customers": {Role.CRM, Role.SALES},
    # Quotations are shared between CRM, Sales, and Admin in one company scope.
    "quotations": {Role.CRM, Role.SALES},
    # CRM may read the safe product catalog to prepare quotes. Only Admin and
    # Sales can maintain the catalog; the API enforces that on writes.
    "catalog": {Role.ADMIN, Role.SALES, Role.CRM},
    "quality-control": {Role.QUALITY_CONTROL},
    "employee-management": {Role.EMPLOYEE_MANAGEMENT},
}


class AdminDailyOperationsGuard(BasePermission):
    """Keep Admin write access limited to administration and company setup."""

    message = "Admin accounts have read-only operational access."

    def has_permission(self, request, view):
        membership = getattr(request.user, "membership", None)
        if not membership or membership.role != Role.ADMIN or request.method in {"GET", "HEAD", "OPTIONS"}:
            return True
        path = str(request.path_info or "").lower()
        operational_modules = {
            "crm", "sales", "purchase", "inventory", "production", "transport",
            "accounting", "quotations", "suppliers", "purchase-orders",
            "production-orders", "sales-order-items-data", "accounting-payments",
            "transport-delivery", "finance",
        }
        parts = [part for part in path.strip("/").split("/") if part]
        if "modules" in parts:
            try:
                module_index = parts.index("modules") + 1
                return parts[module_index] not in operational_modules
            except IndexError:
                return False
        operational_route_prefixes = (
            "/api/accounting/", "/api/inventory/", "/api/purchase-orders/",
            "/api/production/", "/api/production-orders/", "/api/transport/",
            "/api/sales/orders/",
        )
        return not path.startswith(operational_route_prefixes)


class IsCompanyAdmin(BasePermission):
    message = "Admin authorization required."

    def has_permission(self, request, view):
        membership = getattr(request.user, "membership", None)
        return bool(membership and membership.role == Role.ADMIN and membership.is_active)


def user_can_access_module(user, module_name):
    membership = getattr(user, "membership", None)
    if not membership or not membership.is_active:
        return False
    allowed_roles = MODULE_ROLE_MAP.get(str(module_name).lower(), set())
    return membership.role in allowed_roles
