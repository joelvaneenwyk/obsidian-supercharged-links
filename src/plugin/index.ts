import { Plugin, debounce, TFile } from "obsidian";
import SuperchargedLinksSettingTab from "settings/SuperchargedLinksSettingTab";
import {
    updateElLinks,
    updateVisibleLinks,
    clearExtraAttributes,
    updateDivExtraAttributes, updatePropertiesPane,
} from "linkAttributes/linkAttributes";
import { SuperchargedLinksSettings, DEFAULT_SETTINGS } from "settings/SuperchargedLinksSettings";
import { Prec } from "@codemirror/state";
import { buildCMViewPlugin } from "linkAttributes/livePreview";

export class SuperchargedLinks extends Plugin {
    settings: SuperchargedLinksSettings;
    settingTab: SuperchargedLinksSettingTab;
    private observers: [MutationObserver, string, string][];
    private modalObservers: MutationObserver[] = [];

    async onload(): Promise<void> {
        console.log("Supercharged links loaded");
        await this.loadSettings();

        this.addSettingTab(new SuperchargedLinksSettingTab(this.app, this));
        this.registerMarkdownPostProcessor((el, ctx) => {
            updateElLinks(this.app, this, el, ctx);
        });

        const plugin = this;
        const updateLinks = function (_file: TFile) {
            updateVisibleLinks(plugin.app, plugin);
            plugin.observers.forEach(([observer, type, own_class]) => {
                const leaves = plugin.app.workspace.getLeavesOfType(type);
                leaves.forEach(leaf => {
                    plugin.updateContainer(leaf.view.containerEl, plugin, own_class);
                });
            });
        };

        // Live preview
        const ext = Prec.lowest(buildCMViewPlugin(this.app, this.settings));
        this.registerEditorExtension(ext);

        this.observers = [];

        this.app.workspace.onLayoutReady(() => {
            this.initViewObservers(this);
            this.initModalObservers(this, document);
            updateVisibleLinks(this.app, this);
        });

        // Initialization
        this.registerEvent(this.app.workspace.on("window-open", (window, win) => this.initModalObservers(this, window.getContainer().doc)));

        // Update when
        // Debounced to prevent lag when writing
        this.registerEvent(this.app.metadataCache.on("changed", debounce(updateLinks, 500, true)));

        // Update when layout changes
        // @ts-ignore
        this.registerEvent(this.app.workspace.on("layout-change", debounce(updateLinks, 10, true)));
        // Update plugin views when layout changes
        // TODO: This is an expensive operation that seems like it is called fairly frequently. Maybe we can do this more efficiently?
        this.registerEvent(this.app.workspace.on("layout-change", () => this.initViewObservers(this)));
    }

    initViewObservers(plugin: SuperchargedLinks) {
        // Reset observers
        plugin.observers.forEach(([observer, type]) => {
            observer.disconnect();
        });
        plugin.observers = [];

        // Register new observers
        plugin.registerViewType("backlink", plugin, ".tree-item-inner", true);
        plugin.registerViewType("outgoing-link", plugin, ".tree-item-inner", true);
        plugin.registerViewType("search", plugin, ".tree-item-inner");
        plugin.registerViewType("BC-matrix", plugin, ".BC-Link");
        plugin.registerViewType("BC-ducks", plugin, ".internal-link");
        plugin.registerViewType("BC-tree", plugin, "a.internal-link");
        plugin.registerViewType("graph-analysis", plugin, ".internal-link");
        plugin.registerViewType("starred", plugin, ".nav-file-title-content");
        plugin.registerViewType("file-explorer", plugin, ".nav-file-title-content");
        plugin.registerViewType("recent-files", plugin, ".nav-file-title-content");
        plugin.registerViewType("bookmarks", plugin, ".tree-item-inner");
        // If backlinks in editor is on
        // @ts-ignore
        if (plugin.app?.internalPlugins?.plugins?.backlink?.instance?.options?.backlinkInDocument) {
            plugin.registerViewType("markdown", plugin, ".tree-item-inner", true);
        }
        const propertyLeaves = this.app.workspace.getLeavesOfType("file-properties");
        for (let i = 0; i < propertyLeaves.length; i++) {
            const container = propertyLeaves[i].view.containerEl;
            const observer = new MutationObserver((records, _) => {
                updatePropertiesPane(container, app.workspace.getActiveFile(), app, plugin);
            });
            observer.observe(container, { subtree: true, childList: true, attributes: false });
            plugin.observers.push([observer, "file-properties" + i, ""]);
            // TODO: No proper unloading!
        }
        plugin.registerViewType("file-properties", plugin, "div.internal-link > .multi-select-pill-content");
    }

    initModalObservers(plugin: SuperchargedLinks, doc: Document) {
        const config = {
            subtree: false,
            childList: true,
            attributes: false
        };

        this.modalObservers.push(new MutationObserver(records => {
            records.forEach((mutation) => {
                if (mutation.type === "childList") {
                    mutation.addedNodes.forEach(n => {
                        if ("className" in n &&
                            // @ts-ignore
                            (n.className.includes("modal-container") && plugin.settings.enableQuickSwitcher
                                // @ts-ignore
                                || n.className.includes("suggestion-container") && plugin.settings.enableSuggestor)) {
                            let selector = ".suggestion-title, .suggestion-note, .another-quick-switcher__item__title, .omnisearch-result__title";
                            // @ts-ignore
                            if (n.className.includes("suggestion-container")) {
                                selector = ".suggestion-title, .suggestion-note";
                            }
                            plugin.updateContainer(n as HTMLElement, plugin, selector);
                            plugin._watchContainer(null, n as HTMLElement, plugin, selector);
                        }
                    });
                }
            });
        }));
        this.modalObservers.last().observe(doc.body, config);
    }

    registerViewType(viewTypeName: string, plugin: SuperchargedLinks, selector: string, updateDynamic = false) {
        const leaves = this.app.workspace.getLeavesOfType(viewTypeName);
        // if (leaves.length > 1) {
        for (let i = 0; i < leaves.length; i++) {
            const container = leaves[i].view.containerEl;
            if (updateDynamic) {
                plugin._watchContainerDynamic(viewTypeName + i, container, plugin, selector);
            }
            else {
                plugin._watchContainer(viewTypeName + i, container, plugin, selector);
            }
        }
        // }
        // else if (leaves.length < 1) return;
        // else {
        // 	const container = leaves[0].view.containerEl;
        // 	this.updateContainer(container, plugin, selector);
        // 	if (updateDynamic) {
        // 		plugin._watchContainerDynamic(viewTypeName, container, plugin, selector)
        // 	}
        // 	else {
        // 		plugin._watchContainer(viewTypeName, container, plugin, selector);
        // 	}
        // }
    }

    updateContainer(container: HTMLElement, plugin: SuperchargedLinks, selector: string) {
        if (!plugin.settings.enableBacklinks && container.getAttribute("data-type") !== "file-explorer") return;
        if (!plugin.settings.enableFileList && container.getAttribute("data-type") === "file-explorer") return;
        const nodes = container.findAll(selector);
        for (let i = 0; i < nodes.length; ++i) {
            const el = nodes[i] as HTMLElement;
            updateDivExtraAttributes(plugin.app, plugin.settings, el, "");
        }
    }

    removeFromContainer(container: HTMLElement, selector: string) {
        const nodes = container.findAll(selector);
        for (let i = 0; i < nodes.length; ++i) {
            const el = nodes[i] as HTMLElement;
            clearExtraAttributes(el);
        }
    }

    _watchContainer(viewType: string, container: HTMLElement, plugin: SuperchargedLinks, selector: string) {
        const observer = new MutationObserver((records, _) => {
            plugin.updateContainer(container, plugin, selector);
        });
        observer.observe(container, { subtree: true, childList: true, attributes: false });
        if (viewType) {
            plugin.observers.push([observer, viewType, selector]);
        }
    }

    _watchContainerDynamic(viewType: string, container: HTMLElement, plugin: SuperchargedLinks, selector: string, own_class = "tree-item-inner", parent_class = "tree-item") {
        // Used for efficient updating of the backlinks panel
        // Only loops through newly added DOM nodes instead of changing all of them
        if (!plugin.settings.enableBacklinks) return;
        const observer = new MutationObserver((records, _) => {
            records.forEach((mutation) => {
                if (mutation.type === "childList") {
                    mutation.addedNodes.forEach((n) => {
                        if ("className" in n) {
                            // @ts-ignore
                            if (n.className.includes && typeof n.className.includes === "function" && n.className.includes(parent_class)) {
                                const fileDivs = (n as HTMLElement).getElementsByClassName(own_class);
                                for (let i = 0; i < fileDivs.length; ++i) {
                                    const link = fileDivs[i] as HTMLElement;
                                    updateDivExtraAttributes(plugin.app, plugin.settings, link, "");
                                }
                            }
                        }
                    });
                }
            });
        });
        observer.observe(container, { subtree: true, childList: true, attributes: false });
        plugin.observers.push([observer, viewType, selector]);
    }


    onunload() {
        this.observers.forEach(([observer, type, own_class]) => {
            observer.disconnect();
            const leaves = this.app.workspace.getLeavesOfType(type);
            leaves.forEach(leaf => {
                this.removeFromContainer(leaf.view.containerEl, own_class);
            });
        });
        for (const observer of this.modalObservers) {
            observer.disconnect();
        }
        console.log("Supercharged links unloaded");
    }

    async loadSettings() {
        this.settings = Object.assign({}, DEFAULT_SETTINGS, await this.loadData());
    }

    async saveSettings() {
        await this.saveData(this.settings);
    }
}
