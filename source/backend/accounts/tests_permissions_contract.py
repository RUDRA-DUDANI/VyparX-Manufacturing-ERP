"""Contract tests for company Admin and department module write permissions."""
import os
import sys
from types import SimpleNamespace

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
os.environ.setdefault("DJANGO_SETTINGS_MODULE", "vyaparx_backend.settings")

import django
django.setup()

from django.test import SimpleTestCase

from accounts.models import Role
from accounts.permissions import MODULE_ROLE_MAP, user_can_access_module


class ModulePermissionContractTests(SimpleTestCase):
    def _user(self, role):
        return SimpleNamespace(membership=SimpleNamespace(role=role, is_active=True))

    def test_admin_can_write_every_registered_module(self):
        admin = self._user(Role.ADMIN)
        for module_name in MODULE_ROLE_MAP:
            with self.subTest(module=module_name):
                self.assertTrue(user_can_access_module(admin, module_name))

    def test_department_heads_can_write_their_module_and_not_other_core_modules(self):
        primary_modules = {
            Role.CRM: "crm",
            Role.SALES: "sales",
            Role.PURCHASE: "purchase",
            Role.INVENTORY: "inventory",
            Role.PRODUCTION: "production",
            Role.TRANSPORT: "transport",
            Role.ACCOUNTING_FINANCE: "accounting",
        }
        for role, own_module in primary_modules.items():
            user = self._user(role)
            self.assertTrue(user_can_access_module(user, own_module), (role, own_module))
            for other_module in primary_modules.values():
                if other_module != own_module:
                    with self.subTest(role=role, module=other_module):
                        self.assertFalse(user_can_access_module(user, other_module))

    def test_inactive_membership_cannot_write(self):
        user = self._user(Role.ADMIN)
        user.membership.is_active = False
        self.assertFalse(user_can_access_module(user, "crm"))
