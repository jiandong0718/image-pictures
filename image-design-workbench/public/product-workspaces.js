(function attachProductWorkspaces(globalObject, factory) {
  const api = factory();
  if (typeof module !== "undefined" && module.exports) {
    module.exports = api;
  }
  globalObject.ProductWorkspaces = api;
})(
  typeof globalThis !== "undefined" ? globalThis : this,
  function createProductWorkspacesApi() {
    function normalizeSavedPrompts(defaultPrompts, prompts) {
      if (!prompts || typeof prompts !== "object") {
        return { ...defaultPrompts };
      }
      return { ...defaultPrompts, ...prompts };
    }

    function normalizeSavedImages(images) {
      if (!images || typeof images !== "object") {
        return {};
      }
      return { ...images };
    }

    function normalizeSavedLoading(loading) {
      if (!loading || typeof loading !== "object") {
        return {};
      }
      return { ...loading };
    }

    function normalizeSavedMessages(messages) {
      if (!messages || typeof messages !== "object") {
        return {};
      }
      return Object.keys(messages).reduce((result, key) => {
        const message = messages[key];
        if (!message || typeof message !== "object") {
          return result;
        }
        result[key] = {
          text: typeof message.text === "string" ? message.text : "",
          kind: typeof message.kind === "string" ? message.kind : "",
        };
        return result;
      }, {});
    }

    function createProductWorkspace(defaultPrompts, savedWorkspace) {
      const saved = savedWorkspace && typeof savedWorkspace === "object" ? savedWorkspace : {};
      return {
        imageSet: saved.imageSet || null,
        prompts: normalizeSavedPrompts(defaultPrompts, saved.prompts),
        images: normalizeSavedImages(saved.images),
        loading: normalizeSavedLoading(saved.loading),
        messages: normalizeSavedMessages(saved.messages),
      };
    }

    function createProductWorkspaces(options) {
      const {
        modes = [],
        defaultPrompts = {},
        savedWorkspaces = {},
        activeMode = "",
        legacyWorkspace = null,
        forceNew = false,
        promptOverrides = null,
      } = options || {};

      const fallbackMode = modes.includes(activeMode) ? activeMode : modes[0];
      const workspaces = {};

      for (const mode of modes) {
        workspaces[mode] = createProductWorkspace(
          defaultPrompts,
          forceNew ? null : savedWorkspaces?.[mode],
        );
      }

      if (
        !forceNew &&
        fallbackMode &&
        legacyWorkspace &&
        (!savedWorkspaces || !Object.keys(savedWorkspaces).length)
      ) {
        workspaces[fallbackMode] = createProductWorkspace(defaultPrompts, legacyWorkspace);
      }

      if (fallbackMode && promptOverrides && typeof promptOverrides === "object") {
        workspaces[fallbackMode].prompts = {
          ...workspaces[fallbackMode].prompts,
          ...promptOverrides,
        };
      }

      return workspaces;
    }

    function getProductWorkspace(workspaces, mode, modes, defaultPrompts) {
      const fallbackMode = Array.isArray(modes) && modes.includes(mode) ? mode : modes?.[0];
      if (!fallbackMode) {
        return createProductWorkspace(defaultPrompts, null);
      }
      if (!workspaces[fallbackMode]) {
        workspaces[fallbackMode] = createProductWorkspace(defaultPrompts, null);
      }
      return workspaces[fallbackMode];
    }

    return {
      createProductWorkspace,
      createProductWorkspaces,
      getProductWorkspace,
    };
  },
);
