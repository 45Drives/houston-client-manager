/**
 * CSS injected into the Cockpit webview to hide sidebar, topnav, masthead etc.
 * Activated by adding `.houston-wizard-mode` to the document root.
 */
export const COCKPIT_CHROME_CSS = `
/* Master switch for "wizard mode" */
html.houston-wizard-mode,
html.houston-wizard-mode body {
  height: 100% !important;
  width: 100% !important;
  margin: 0 !important;
}

/* Hide sidebar + anything that renders the left column contents */
html.houston-wizard-mode #nav-system,
html.houston-wizard-mode .area-ct-subnav,
html.houston-wizard-mode .nav-system-menu.sidebar,
html.houston-wizard-mode .pf-v5-c-page__sidebar,
html.houston-wizard-mode .pf-v5-c-page__sidebar-body,
html.houston-wizard-mode .pf-v5-c-page__sidebar-panel,
html.houston-wizard-mode aside[role="navigation"] {
  display: none !important;
}

/* Hide top/header/masthead */
html.houston-wizard-mode .pf-v5-c-masthead,
html.houston-wizard-mode .pf-v5-c-page__header,
html.houston-wizard-mode header[role="banner"],
html.houston-wizard-mode #topnav,
html.houston-wizard-mode #main > header {
  display: none !important;
  height: 0 !important;
  min-height: 0 !important;
}

/* PatternFly: kill reserved header/side sizing variables */
html.houston-wizard-mode .pf-v5-c-page {
  --pf-v5-c-page__sidebar--Width: 0px !important;
  --pf-v5-c-page__sidebar--WidthOnXl: 0px !important;
  --pf-v5-c-page__sidebar--WidthOn2xl: 0px !important;
  --pf-v5-c-page__header--MinHeight: 0px !important;
}

/* PatternFly layout: collapse the grid so there is no left column / top row */
html.houston-wizard-mode .pf-v5-c-page {
  grid-template-areas: "main" !important;
  grid-template-columns: 1fr !important;
  grid-template-rows: 1fr !important;
}

/* Ensure main actually fills everything with no offsets */
html.houston-wizard-mode .pf-v5-c-page__main,
html.houston-wizard-mode #main,
html.houston-wizard-mode #content {
  grid-area: main !important;
  margin: 0 !important;
  padding: 0 !important;
  inset: auto !important;
  width: 100% !important;
  max-width: 100% !important;
  min-width: 0 !important;
}

/* If Cockpit uses an internal grid on #main, collapse it too */
html.houston-wizard-mode #main {
  grid-template-areas: "main" !important;
  grid-template-columns: 1fr !important;
  grid-template-rows: 1fr !important;
}

/* Bottom-left host/user dropdown */
html.houston-wizard-mode nav#hosts-sel,
html.houston-wizard-mode #hosts-sel,
html.houston-wizard-mode #host-toggle {
  display: none !important;
}
`;

export function useHoustonWebview() {
  /**
   * Inject the chrome-hiding CSS into the webview.
   * Call this on every `dom-ready` event (Electron resets per-page CSS on navigation).
   * The class is NOT applied here — loginIntoCockpit applies it after login succeeds.
   */
  async function injectChromeCSS(wv: any) {
    if (!wv) return
    try {
      await wv.insertCSS(COCKPIT_CHROME_CSS)
      // Only apply the class if already logged in (no #login form visible).
      // If the login form is showing, loginIntoCockpit will apply it after login.
      await wv.executeJavaScript(`
        (function() {
          var p = window.location.pathname || "";
          var isModulePage = p.includes("/super-simple-setup") || p.includes("/scheduler");
          if (isModulePage && !document.querySelector("#login")) {
            document.documentElement.classList.add("houston-wizard-mode");
          }
        })();
      `)
    } catch (e) {
      console.error('insertCSS failed:', e)
    }
  }

  /**
   * Full login + chrome-hide + admin-elevation script.
   * Ported from the original App.vue loginAndSimplifyScript.
   */
  async function loginIntoCockpit(wv: any, { user, pass }: { user: string; pass: string }) {
    if (!wv) return

    const credsJson = JSON.stringify({ user, pass })
    const credsLiteral = JSON.stringify(credsJson)

    const loginAndSimplifyScript = `
(function() {
  var CREDS = JSON.parse(${credsLiteral});
  var user = (CREDS && CREDS.user) ? String(CREDS.user) : "";
  var pass = (CREDS && CREDS.pass) ? String(CREDS.pass) : "";
  return new Promise(function(resolve) {
    var LOGIN_SELECTOR  = "#login";
    var ERROR_SELECTOR  = "#login-error-message";
    var USER_SELECTOR   = "#login-user-input";
    var PASS_SELECTOR   = "#login-password-input";
    var BUTTON_SELECTOR = "#login-button";

    var observer = null;
    var finished = false;

    function done(status, extra) {
      if (finished) return;
      finished = true;
      try { if (observer) observer.disconnect(); } catch(e) {}
      observer = null;
      resolve(Object.assign({ status: status }, extra || {}));
    }

    function onModulePage() {
      var p = window.location.pathname || "";
      return p.includes("/super-simple-setup") || p.includes("/scheduler");
    }

    function setChromeMode(enabled) {
      if (!onModulePage()) return;
      var root = document.documentElement;
      root.classList.toggle("houston-wizard-mode", !!enabled);
    }

    function sleep(ms) { return new Promise(function(r) { setTimeout(r, ms); }); }

    function waitForCockpit(timeoutMs) {
      timeoutMs = timeoutMs || 20000;
      return new Promise(function(resolveWait, rejectWait) {
        var start = Date.now();
        var t = setInterval(function() {
          if (window.cockpit && typeof window.cockpit.spawn === "function") {
            clearInterval(t);
            resolveWait(true);
          } else if (Date.now() - start > timeoutMs) {
            clearInterval(t);
            rejectWait(new Error("cockpit.js not available"));
          }
        }, 50);
      });
    }

    function findLimitedAccessControl() {
      var nodes = Array.from(document.querySelectorAll("button,a,[role=button]"));
      return nodes.find(function(n) { return /limited access/i.test((n.textContent || "").trim()); }) || null;
    }

    function findAdminModal() {
      return (
        document.querySelector(".pf-v5-c-modal-box") ||
        document.querySelector('[role="dialog"]')
      );
    }

    function findAdminPasswordInput(modal) {
      return (
        modal.querySelector('input#switch-to-admin-access-password[type="password"]') ||
        modal.querySelector('input[type="password"]')
      );
    }

    function setNativeValue(el, value) {
      var proto = el instanceof HTMLInputElement ? HTMLInputElement.prototype : el.__proto__;
      var desc =
        Object.getOwnPropertyDescriptor(proto, "value") ||
        Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value");
      if (desc && desc.set) desc.set.call(el, value);
      else el.value = value;
      el.dispatchEvent(new Event("input", { bubbles: true }));
      el.dispatchEvent(new Event("change", { bubbles: true }));
    }

    function clickLimitedAccessThrottled() {
      var now = Date.now();
      if (clickLimitedAccessThrottled._next && now < clickLimitedAccessThrottled._next) return false;
      clickLimitedAccessThrottled._next = now + 1200;
      var btn = findLimitedAccessControl();
      if (!btn) return false;
      btn.dispatchEvent(new MouseEvent("mousedown", { bubbles: true }));
      btn.dispatchEvent(new MouseEvent("mouseup", { bubbles: true }));
      btn.dispatchEvent(new MouseEvent("click", { bubbles: true }));
      return true;
    }
    clickLimitedAccessThrottled._next = 0;

    var submittedForModal = new WeakSet();

    function trySubmitModalOnce(password) {
      var modal = findAdminModal();
      if (!modal) return false;
      if (submittedForModal.has(modal)) return false;
      var passInput = findAdminPasswordInput(modal);
      if (!passInput) return false;
      var buttons = Array.from(modal.querySelectorAll("button"));
      var authButton =
        modal.querySelector("button.pf-v5-c-button.pf-m-primary") ||
        buttons.find(function(b) { return /authenticate/i.test((b.textContent || "").trim()); }) ||
        null;
      passInput.focus();
      setNativeValue(passInput, password);
      if (authButton) {
        try { authButton.disabled = false; authButton.removeAttribute("disabled"); } catch(e) {}
        authButton.dispatchEvent(new MouseEvent("mousedown", { bubbles: true }));
        authButton.dispatchEvent(new MouseEvent("mouseup", { bubbles: true }));
        authButton.dispatchEvent(new MouseEvent("click", { bubbles: true }));
        submittedForModal.add(modal);
        return true;
      }
      var form = passInput.closest("form");
      if (form) {
        if (typeof form.requestSubmit === "function") form.requestSubmit();
        else form.submit();
        submittedForModal.add(modal);
        return true;
      }
      return false;
    }

    function requireAdminOnce() {
      return new Promise(function(resolveSpawn, rejectSpawn) {
        cockpit.spawn(["id", "-u"], { superuser: "require" })
          .done(resolveSpawn)
          .fail(rejectSpawn);
      });
    }

    function elevateToAdmin(password, timeoutMs) {
      timeoutMs = timeoutMs || 60000;
      if (!onModulePage()) return Promise.resolve({ ok: true, skipped: true });

      setChromeMode(true);
      return waitForCockpit().then(function() {
        var start = Date.now();
        function loop() {
          if (Date.now() - start >= timeoutMs) {
            setChromeMode(false);
            return { ok: false, error: "Timed out waiting for admin access" };
          }
          clickLimitedAccessThrottled();
          trySubmitModalOnce(password);
          return requireAdminOnce().then(function() {
            setChromeMode(true);
            return { ok: true };
          }).catch(function() {
            setChromeMode(false);
            return sleep(600).then(loop);
          });
        }
        return loop();
      });
    }

    var globalTimeout = setTimeout(function() { done("timeout"); }, 15000);
    function clearGlobalTimeout() { clearTimeout(globalTimeout); }

    var loginEl = document.querySelector(LOGIN_SELECTOR);

    // Already logged in
    if (!loginEl) {
      setTimeout(function() {
        clearGlobalTimeout();
        setChromeMode(true);
        elevateToAdmin(pass, 60000)
          .then(function(r) { done("no-login", { admin: !!r.ok, adminError: r.error || null }); })
          .catch(function(e) { done("no-login", { admin: false, adminError: String(e && (e.message || e)) }); });
      }, 300);
      return;
    }

    // Login form present
    var usernameField = document.querySelector(USER_SELECTOR);
    var passwordField = document.querySelector(PASS_SELECTOR);
    var loginButton   = document.querySelector(BUTTON_SELECTOR);
    var loginForm     = document.querySelector("form");

    if (!usernameField || !passwordField || !loginButton || !loginForm) {
      clearGlobalTimeout();
      done("no-fields");
      return;
    }

    if (onModulePage()) setChromeMode(true);

    usernameField.value = user;
    passwordField.value = pass;
    usernameField.dispatchEvent(new Event("input", { bubbles: true }));
    passwordField.dispatchEvent(new Event("input", { bubbles: true }));

    observer = new MutationObserver(function() {
      var loginError = document.querySelector(ERROR_SELECTOR);
      var loginStillVisible = document.querySelector(LOGIN_SELECTOR);

      if (loginError) {
        var text = (loginError.textContent || "").trim();
        var isJsWarning = /enable\\s+javascript/i.test(text);
        var isAuthError = /wrong user name|authentication failed|incorrect|invalid/i.test(text);

        if (isAuthError) {
          clearGlobalTimeout();
          done("login-failed", { message: text });
          return;
        }
        if (isJsWarning) return;
      }

      // Login form disappeared -> login succeeded
      if (!loginStillVisible) {
        setTimeout(function() {
          clearGlobalTimeout();
          setChromeMode(true);
          elevateToAdmin(pass, 60000)
            .then(function(r) { done("login-success", { admin: !!r.ok, adminError: r.error || null }); })
            .catch(function(e) { done("login-success", { admin: false, adminError: String(e && (e.message || e)) }); });
        }, 500);
      }
    });

    observer.observe(document.body, { childList: true, subtree: true });

    setTimeout(function() {
      try {
        loginButton.click();
        loginForm.submit();
      } catch(e) {
        clearGlobalTimeout();
        done("submit-error", { message: String(e && (e.message || e)) });
      }
    }, 300);
  });
})();
`

    const result = await wv.executeJavaScript(loginAndSimplifyScript)
    console.debug('auto-login / simplify result:', result)
    return result
  }

  return { loginIntoCockpit, injectChromeCSS }
}
