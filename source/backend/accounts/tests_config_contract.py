"""URL, API-contract and configuration checks for VyaparX authentication.

No network calls and no live Firebase credentials are required.
"""
import json
import os
import sys
from unittest import mock

os.environ.setdefault("DJANGO_ALLOWED_HOSTS", "testserver,localhost,127.0.0.1")

import django
from django.test import TestCase

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
os.environ.setdefault("DJANGO_SETTINGS_MODULE", "vyaparx_backend.settings")
django.setup()

from django.urls import resolve  # noqa: E402

from accounts import firebase as firebase_module  # noqa: E402
from accounts.firebase import firebase_web_config_status  # noqa: E402


class UrlAndContractTests(TestCase):
    def test_auth_routes_resolve_to_expected_views(self):
        expected = {
            "/api/auth/firebase-config": "firebase_config",
            "/api/auth/register": "RegisterView",
            "/api/auth/login": "LoginView",
            "/api/auth/me": "MeView",
            "/api/modules/quotations/data": "ModuleDataView",
            "/api/admin/users": "AdminUsersView",
        }
        for route, view_name in expected.items():
            match = resolve(route)
            resolved = getattr(match.func, "view_class", match.func)
            self.assertEqual(getattr(resolved, "__name__", ""), view_name, route)

    def test_firebase_config_endpoint_is_public_and_returns_config(self):
        response = self.client.get("/api/auth/firebase-config")
        self.assertEqual(response.status_code, 200)
        body = response.json()
        self.assertIn("configured", body)
        self.assertIn("config", body)

    def test_unauthenticated_module_access_is_rejected(self):
        self.assertIn(self.client.get("/api/modules/quotations/data").status_code, (401, 403))

    def test_malformed_authorization_header_is_rejected(self):
        response = self.client.get("/api/auth/me", HTTP_AUTHORIZATION="NotBearer token")
        self.assertIn(response.status_code, (401, 403))

    def test_web_config_status_requires_core_keys(self):
        configured, config = firebase_web_config_status()
        self.assertIsInstance(configured, bool)
        self.assertIsInstance(config, dict)
        self.assertNotIn("private_key", config)


class FirebaseProjectMatchingTests(TestCase):
    def test_admin_project_mismatch_raises_configured_error(self):
        import firebase_admin

        with mock.patch.dict(firebase_module.settings.FIREBASE_WEB_CONFIG, {"projectId": "frontend-project"}), \
             mock.patch.object(firebase_admin, "_apps", {"[DEFAULT]": object()}), \
             mock.patch.object(firebase_admin, "get_app") as get_app:
            app = mock.Mock()
            app.options = {"projectId": "different-project"}
            app.credential = mock.Mock(project_id="different-project")
            get_app.return_value = app
            FirebaseAuthService = firebase_module.FirebaseAuthService
            FirebaseAuthService._firebase_modules.cache_clear()
            try:
                with self.assertRaises(firebase_module.FirebaseNotConfigured):
                    FirebaseAuthService._firebase_modules()
            finally:
                FirebaseAuthService._firebase_modules.cache_clear()

    def test_matching_admin_project_is_accepted(self):
        import firebase_admin

        with mock.patch.dict(firebase_module.settings.FIREBASE_WEB_CONFIG, {"projectId": "same-project"}), \
             mock.patch.object(firebase_admin, "_apps", {"[DEFAULT]": object()}), \
             mock.patch.object(firebase_admin, "get_app") as get_app:
            app = mock.Mock()
            app.options = {"projectId": "same-project"}
            app.credential = mock.Mock(project_id="same-project")
            get_app.return_value = app
            FirebaseAuthService = firebase_module.FirebaseAuthService
            FirebaseAuthService._firebase_modules.cache_clear()
            try:
                self.assertTrue(FirebaseAuthService._firebase_modules())
            finally:
                FirebaseAuthService._firebase_modules.cache_clear()


class FrontendContractTests(TestCase):
    """Guards the request contract auth.js sends to the registration API."""

    def test_frontend_registration_calls_the_existing_route(self):
        path = os.path.join(os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__)))),
                            "frontend", "javascript", "auth.js")
        with open(path, encoding="utf-8") as handle:
            source = handle.read()
        self.assertIn('apiRequest("/api/auth/register"', source)
        self.assertIn('"/api/auth/login"', source)
        self.assertIn('getIdToken(true)', source)
        self.assertIn("Bearer ", source)
        # Registration must send the flat backend contract, not only nested groups.
        self.assertIn("companyName: business.companyName", source)
        self.assertIn("confirmPassword: personal.confirmPassword", source)
