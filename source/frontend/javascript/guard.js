/**
 * VyaparX ERP - Module Access Guard & Route Protection
 * Runs on every dashboard page to block unauthorized direct URL access,
 * enforce active sessions, and display a secure Access Denied screen.
 */

(function () {
  "use strict";

  // Identify current page filename
  const path = window.location.pathname;
  const page = path.substring(path.lastIndexOf("/") + 1).toLowerCase();

  // Public pages that do not require auth guard
  const publicPages = ["loginpage.html", "registation.html", "landing.html", "index.html", ""];
  if (publicPages.includes(page)) {
    return;
  }

  // Page to required role mapping
  const PAGE_ROLE_MAP = {
    "admin.html": ["Admin", "Employee Management"],
    "crm.html": ["Admin", "CRM"],
    "sales.html": ["Admin", "Sales"],
    "purchese.html": ["Admin", "Purchase"],
    "inventory.html": ["Admin", "Inventory"],
    "producation.html": ["Admin", "Production", "Quality Control"],
    "transport.html": ["Admin", "Transport"],
    "accounting.html": ["Admin", "Accounting & Finance"],
  };

  const allowedRoles = PAGE_ROLE_MAP[page];
  if (!allowedRoles) {
    // Unknown or unmapped page, continue
    return;
  }

  // Check current session
  const auth = window.VyaparXAuth;
  if (!auth) {
    console.error("VyaparXAuth engine not loaded!");
    return;
  }

  const session = auth.getCurrentSession();

    // FIX 2: revalidate the role against the backend on protected pages so a
    // session cached before an Admin role change can never keep granting the
    // old module access. The server response is authoritative.
    if (session) {
      auth
        .refreshSession()
        .then(function (fresh) {
          if (!fresh || auth.normalizeRole(fresh.role) !== userRole) {
            // The account's role changed on the server: force re-login.
            return auth.logout().then(function () {
              sessionStorage.setItem(
                "vyparx_auth_msg",
                "Your role was changed by your administrator. Please sign in again."
              );
              window.location.replace("loginpage.html");
            });
          }
        })
        .catch(function () {
          /* Backend unreachable: keep the locally validated session. */
        });
    }

  // Case 1: No active session -> Redirect to Login
  if (!session) {
    sessionStorage.setItem(
      "vyparx_auth_msg",
      "You must sign in with an authorized account to access this module."
    );
    window.location.replace("loginpage.html");
    return;
  }

  // Case 2: User is logged in but role does NOT have permission for this page
  const userRole = auth.normalizeRole(session.role);
  const isAuthorized = allowedRoles.some((r) => auth.normalizeRole(r) === userRole);

  if (!isAuthorized) {
    // Block page display and render Access Denied Screen
    document.addEventListener("DOMContentLoaded", renderAccessDenied);
    if (document.body) {
      renderAccessDenied();
    }
  }

  function renderAccessDenied() {
    // Stop any interval or timeout from original page scripts
    document.title = "Access Denied – VyaparX ERP";
    const myDashboard = auth.ROLE_DASHBOARDS[userRole] || "loginpage.html";

    document.body.innerHTML = `
      <div style="min-height: 100vh; display: flex; align-items: center; justify-content: center; background: #0b1226; font-family: 'Poppins', system-ui, sans-serif; color: #e8edfb; padding: 20px;">
        <div style="background: #121b36; border: 1px solid #ff4d4f; border-radius: 20px; max-width: 520px; width: 100%; padding: 40px 32px; text-align: center; box-shadow: 0 20px 40px rgba(0,0,0,0.5);">
          <div style="width: 72px; height: 72px; background: rgba(255, 77, 79, 0.15); border: 2px solid #ff4d4f; border-radius: 50%; display: flex; align-items: center; justify-content: center; margin: 0 auto 20px;">
            <svg width="36" height="36" viewBox="0 0 24 24" fill="none" stroke="#ff4d4f" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
              <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/>
              <line x1="12" y1="8" x2="12" y2="12"/>
              <line x1="12" y1="16" x2="12.01" y2="16"/>
            </svg>
          </div>
          <h2 style="font-size: 24px; font-weight: 700; color: #ffffff; margin: 0 0 8px;">403 – Access Denied</h2>
          <p style="color: #93a0c0; font-size: 14px; line-height: 1.6; margin: 0 0 20px;">
            Your account is assigned to the <strong style="color: #4f7cff;">${userRole}</strong> role and is strictly not authorized to access this module directly via URL.
          </p>
          <div style="background: #0b1226; border: 1px solid #223058; border-radius: 12px; padding: 14px; text-align: left; font-size: 12px; margin-bottom: 24px;">
            <div style="color: #93a0c0; margin-bottom: 4px;">User: <span style="color: #e8edfb; font-weight: 500;">${session.fullName} (${session.email})</span></div>
            <div style="color: #93a0c0; margin-bottom: 4px;">Company: <span style="color: #e8edfb; font-weight: 500;">${session.companyName} (${session.companyId})</span></div>
            <div style="color: #93a0c0;">Allowed Destination: <span style="color: #4cc38a; font-weight: 500;">${myDashboard}</span></div>
          </div>
          <div style="display: flex; gap: 12px; justify-content: center;">
            <a href="${myDashboard}" style="background: #4f7cff; color: #ffffff; text-decoration: none; padding: 10px 20px; border-radius: 10px; font-weight: 600; font-size: 14px; display: inline-flex; align-items: center; gap: 6px;">
              Return to My Dashboard
            </a>
            <button onclick="VyaparXAuth.logout(); window.location.href='loginpage.html';" style="background: transparent; color: #93a0c0; border: 1px solid #223058; padding: 10px 18px; border-radius: 10px; font-weight: 500; font-size: 14px; cursor: pointer;">
              Sign Out
            </button>
          </div>
        </div>
      </div>
    `;
    // Prevent remaining scripts from executing
    window.stop();
  }
})();

