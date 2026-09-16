declare const __APP_VERSION__: string;
declare const __COCKPIT_MODULE_SUFFIX__: string;

declare module '*?raw' {
  const content: string;
  export default content;
}