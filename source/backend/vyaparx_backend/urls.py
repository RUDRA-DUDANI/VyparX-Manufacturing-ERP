from django.conf import settings
from django.http import FileResponse, Http404
from django.shortcuts import redirect
from django.urls import include, path, re_path
from django.views.static import serve


def favicon(request):
    icon_path = settings.BASE_DIR / "accounts" / "static" / "favicon.ico"
    if not icon_path.is_file():
        raise Http404("Favicon not found")
    response = FileResponse(icon_path.open("rb"), content_type="image/x-icon")
    response["Cache-Control"] = "public, max-age=86400"
    return response


def frontend_page(request, page="landing.html"):
    safe_page = page.rsplit("/", 1)[-1]
    if not safe_page.endswith(".html"):
        safe_page = f"{safe_page}.html"
    target = settings.FRONTEND_DIR / "html" / safe_page
    if not target.exists():
        raise Http404("Page not found")
    return FileResponse(target.open("rb"), content_type="text/html")


urlpatterns = [
    path("favicon.ico", favicon),
    path("", lambda request: redirect("/html/landing.html")),
    path("api/", include("accounts.urls")),
    path("html/<str:page>", frontend_page),
    path("<str:page>.html", lambda request, page: frontend_page(request, f"{page}.html")),
    re_path(r"^(?P<path>(css|javascript|assets)/.*)$", serve, {"document_root": settings.FRONTEND_DIR}),
]
