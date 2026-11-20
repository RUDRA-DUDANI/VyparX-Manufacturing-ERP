from rest_framework.permissions import BasePermission

from .models import Role


MODULE_ROLE_MAP = {
    "admin": {Role.ADMIN},
    "users": {Role.ADMIN},
    "team": {Role.ADMIN, Role.EMPLOYEE_MANAGEMENT},
    "team-attendance": {Role.ADMIN, Role.EMPLOYEE_MANAGEMENT},
    "communications": {Role.ADMIN, Role.CRM, Role.SALES, Role.PURCHASE, Role.INVENTORY, Role.PRODUCTION, Role.QUALITY_CONTROL, Role.TRANSPORT, Role.ACCOUNTING_FINANCE, Role.EMPLOYEE_MANAGEMENT},
    "tasks": {Role.ADMIN, Role.CRM, Role.SALES, Role.PURCHASE, Role.INVENTORY, Role.PRODUCTION, Role.QUALITY_CONTROL, Role.TRANSPORT, Role.ACCOUNTING_FINANCE, Role.EMPLOYEE_MANAGEMENT},
    "crm": {Role.ADMIN, Role.CRM},
    "sales": {Role.ADMIN, Role.SALES},
    "sales-order-items-data": {Role.ADMIN, Role.SALES},
    "purchase-orders": {Role.ADMIN, Role.PURCHASE},
    "production-orders": {Role.ADMIN, Role.PRODUCTION, Role.QUALITY_CONTROL},
    "transport-delivery": {Role.ADMIN, Role.TRANSPORT},
    "accounting-payments": {Role.ADMIN, Role.ACCOUNTING_FINANCE},
    "purchase": {Role.ADMIN, Role.PURCHASE},
    # Accounting must be able to read purchase orders to create the linked
    # purchaseAccountingRequest records from the Accounting workspace.
    "accounting": {Role.ADMIN, Role.ACCOUNTING_FINANCE},
    "inventory": {Role.ADMIN, Role.INVENTORY},
    "production": {Role.ADMIN, Role.PRODUCTION, Role.QUALITY_CONTROL},
    "transport": {Role.ADMIN, Role.TRANSPORT},
    "accounting": {Role.ADMIN, Role.ACCOUNTING_FINANCE},
    "finance": {Role.ADMIN, Role.ACCOUNTING_FINANCE},
    "suppliers": {Role.ADMIN, Role.PURCHASE},
    "sales-order-items": {Role.ADMIN, Role.SALES},
    "purchase-production-material": {Role.ADMIN, Role.PURCHASE, Role.PRODUCTION},
    "customers": {Role.ADMIN, Role.CRM, Role.SALES},
    # Quotations are shared between CRM, Sales, and Admin in one company scope.
    "quotations": {Role.ADMIN, Role.CRM, Role.SALES},
    # CRM may read the safe product catalog to prepare quotes. Only Admin and
    # Sales can maintain the catalog; the API enforces that on writes.
    "catalog": {Role.ADMIN, Role.SALES, Role.CRM},
    "quality-control": {Role.ADMIN, Role.QUALITY_CONTROL},
    "employee-management": {Role.ADMIN, Role.EMPLOYEE_MANAGEMENT},
}


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
