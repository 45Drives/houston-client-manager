/**
 * Minimal Vue shim for Node.js CLI context.
 * Only exports used by the Scheduler and related code.
 */
export function ref(value) {
  return { value, __v_isRef: true };
}

export function computed(getter) {
  return { get value() { return getter(); }, __v_isRef: true };
}

export function reactive(obj) {
  return obj;
}

export function inject(key, defaultValue) {
  return defaultValue;
}

export function watch() {}
export function watchEffect() {}
export function toRaw(obj) { return obj; }
export function unref(val) { return val && val.__v_isRef ? val.value : val; }
export function isRef(val) { return val && val.__v_isRef === true; }
export function toRef(obj, key) { return ref(obj[key]); }
export function toRefs(obj) {
  const result = {};
  for (const key in obj) result[key] = ref(obj[key]);
  return result;
}
export function shallowRef(value) { return ref(value); }
export function triggerRef() {}
export function nextTick(fn) { return Promise.resolve().then(fn); }

// Type stubs (no-ops at runtime)
export const InjectionKey = Symbol;
