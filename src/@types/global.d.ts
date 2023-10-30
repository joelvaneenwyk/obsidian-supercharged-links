declare global {
  interface Window {
    CodeMirrorAdapter: {
      commands: {
        save(): void;
      };
    };
  }
}

export {};
