/**
 * Minimal cockpit shim for Node.js CLI context.
 * The legacy modules reference cockpit.spawn() and cockpit.file() but
 * these code paths are never executed in the CLI bundle — the
 * EasySetupConfigurator uses the nodeDriver (child_process) instead.
 */
function notImplemented(name) {
  return function() {
    throw new Error(`cockpit.${name}() is not available in CLI mode — use nodeDriver instead`);
  };
}

const cockpit = {
  spawn: notImplemented('spawn'),
  file: notImplemented('file'),
  dbus: notImplemented('dbus'),
  location: {},
  transport: { csrf_token: '' },
  user: () => Promise.resolve({ name: 'root', id: 0 }),
};

module.exports = cockpit;
module.exports.default = cockpit;
