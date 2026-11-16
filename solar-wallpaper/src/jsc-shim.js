// JavaScriptCore on its own (the Mac app runs dist/facts.js in it, with no web page) has no AbortController, and
// three.js makes one as it loads (for its loading manager). A stand-in is enough: nothing is ever loaded or aborted.
if (typeof globalThis.AbortController === "undefined") {
  globalThis.AbortController = class {
    constructor() {
      this.signal = { aborted: false };
    }
    abort() {
      this.signal.aborted = true;
    }
  };
}
