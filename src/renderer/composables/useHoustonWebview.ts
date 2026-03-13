export function useHoustonWebview() {
  async function loginIntoCockpit(wv: any, { user, pass }: { user: string; pass: string }) {
    if (!wv) return

    // If user is already on cockpit home (:9090) we can skip login-injection for the module
    // But we'll still try the login routine; it no-ops if #login isn't found.
    const script = `
      new Promise((resolve, reject) => {
        const finishVisibleOnly = () => {
          setTimeout(() => {
            const main = document.querySelector('#main');
            if (main) {
              // Hide Cockpit chrome except the module content
              document.querySelectorAll('#main > div').forEach((el) => {
                if (el.id !== 'content') el.style.display = 'none';
              });
              document.querySelectorAll('#main > nav').forEach((el) => {
                if (el.id !== 'content') el.style.display = 'none';
              });
              main.style.gridTemplateAreas = '"header" "main"';
              main.style.gridTemplateColumns = '1fr';
            }
            resolve("View modified and visible.");
          }, 500);
        };

        // If no login form, just reveal module view
        if (!document.querySelector('#login')) return finishVisibleOnly();

        const usernameField = document.querySelector('#login-user-input');
        const passwordField = document.querySelector('#login-password-input');
        const loginButton  = document.querySelector('#login-button');
        const loginForm    = document.querySelector('form');

        if (!usernameField || !passwordField || !loginButton || !loginForm) {
          return reject('Login fields or button not found.');
        }

        // Fill creds
        usernameField.value = ${JSON.stringify(user)};
        passwordField.value = ${JSON.stringify(pass)};
        usernameField.dispatchEvent(new Event('input', { bubbles: true }));
        passwordField.dispatchEvent(new Event('input', { bubbles: true }));

        // Watch for success/error
        const observer = new MutationObserver(() => {
          const loginError = document.querySelector('#login-error-message');
          if (loginError && loginError.textContent && loginError.textContent.includes('Wrong user name')) {
            observer.disconnect();
            // Reveal UI so user can try manually
            document.querySelectorAll('#main > div').forEach((el) => { el.style.display = 'block'; });
            reject('Login failed: Wrong user name or password.');
          } else if (!document.querySelector('#login')) {
            observer.disconnect();
            resolve('Login successful: login form disappeared.');
          }
        });

        observer.observe(document.body, { childList: true, subtree: true });

        // Submit
        setTimeout(() => {
          loginButton.click();
          loginForm.submit();
        }, 500);
      });
    `;

    await wv.executeJavaScript(script)
  }

  return { loginIntoCockpit }
}
