import json
import logging

logger = logging.getLogger(__name__)

from functools import lru_cache

from django.conf import settings


class FirebaseNotConfigured(RuntimeError):
    pass


class FirebaseAuthService:
    @staticmethod
    @lru_cache(maxsize=1)
    def _firebase_modules():
        try:
            import firebase_admin
            from firebase_admin import auth, credentials
        except ImportError as exc:
            raise FirebaseNotConfigured("firebase-admin is not installed.") from exc

        expected_project = str(settings.FIREBASE_WEB_CONFIG.get("projectId") or "").strip()
        if not expected_project:
            raise FirebaseNotConfigured("FIREBASE_PROJECT_ID is not configured.")

        if not firebase_admin._apps:
            options = {"projectId": expected_project}
            try:
                if settings.FIREBASE_SERVICE_ACCOUNT_JSON:
                    cert_data = json.loads(settings.FIREBASE_SERVICE_ACCOUNT_JSON)
                    credential_project = str(cert_data.get("project_id") or "").strip()
                    if credential_project and credential_project != expected_project:
                        raise FirebaseNotConfigured("Firebase service-account project does not match FIREBASE_PROJECT_ID.")
                    cert = credentials.Certificate(cert_data)
                    firebase_admin.initialize_app(cert, options)
                elif settings.GOOGLE_APPLICATION_CREDENTIALS:
                    cert = credentials.Certificate(settings.GOOGLE_APPLICATION_CREDENTIALS)
                    credential_project = str(getattr(cert, "project_id", "") or "").strip()
                    if credential_project and credential_project != expected_project:
                        raise FirebaseNotConfigured("Firebase service-account project does not match FIREBASE_PROJECT_ID.")
                    firebase_admin.initialize_app(cert, options)
                else:
                    # Use the deployment platform's Application Default
                    # Credentials when no local service-account file is set.
                    firebase_admin.initialize_app(credentials.ApplicationDefault(), options)
            except FirebaseNotConfigured:
                raise
            except Exception as exc:
                raise FirebaseNotConfigured("Firebase Admin credentials could not be loaded. Check the configured service-account file or JSON.") from exc
        else:
            app = firebase_admin.get_app()
            configured_project = str((app.options or {}).get("projectId") or getattr(app.credential, "project_id", "") or "").strip()
            if configured_project and configured_project != expected_project:
                raise FirebaseNotConfigured("Initialized Firebase Admin project does not match FIREBASE_PROJECT_ID.")
        return auth

    @classmethod
    def create_user(cls, email, password, display_name):
        auth = cls._firebase_modules()
        return auth.create_user(email=email, password=password, display_name=display_name, email_verified=False)

    @classmethod
    def delete_user(cls, uid):
        auth = cls._firebase_modules()
        auth.delete_user(uid)

    @classmethod
    def update_user(cls, uid, **kwargs):
        auth = cls._firebase_modules()
        return auth.update_user(uid, **kwargs)

    @classmethod
    # def verify_id_token(cls, token):
    #     auth = cls._firebase_modules()
    #     return auth.verify_id_token(token, check_revoked=True)

    @classmethod
    def verify_id_token(cls, token):
        auth_module = cls._firebase_modules()

        try:
            return auth_module.verify_id_token(
                token.strip(),
                check_revoked=True,
            )
        except Exception:
            logger.exception("Firebase ID token verification failed")
            raise

    @classmethod
    def generate_password_reset_link(cls, email):
        auth = cls._firebase_modules()
        kwargs = {}
        if settings.PASSWORD_RESET_CONTINUE_URL:
            kwargs["action_code_settings"] = auth.ActionCodeSettings(
                url=settings.PASSWORD_RESET_CONTINUE_URL,
                handle_code_in_app=False,
            )
        return auth.generate_password_reset_link(email, **kwargs)


def firebase_web_config_status():
    config = settings.FIREBASE_WEB_CONFIG.copy()
    configured = all(config.get(key) for key in ["apiKey", "authDomain", "projectId", "appId"])
    return configured, config
