import "obsidian";
import { DataviewApi } from "obsidian-dataview";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type DataviewPlugin = /*unresolved*/ any;

declare module "obsidian" {
    interface App {
        plugins: {
            enabledPlugins: Set<string>;
            plugins: {
                // eslint-disable-next-line @typescript-eslint/no-explicit-any
                [id: string]: any;
                dataview?: {
                    api?: DataviewApi;
                };
            };
        };
    }
    interface MetadataCache {
        on(
            name: "dataview:api-ready",
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            callback: (api: DataviewPlugin["api"]) => any,
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            ctx?: any
        ): EventRef;
        on(
            name: "dataview:metadata-change",
            callback: (
                ...args:
                    | [op: "rename", file: TAbstractFile, oldPath: string]
                    | [op: "delete", file: TFile]
                    | [op: "update", file: TFile]
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            ) => any,
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            ctx?: any
        ): EventRef;
    }
}
