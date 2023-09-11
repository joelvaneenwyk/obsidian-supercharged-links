/* eslint-disable @typescript-eslint/ban-types */
/* eslint-disable no-var */
/* eslint-disable @typescript-eslint/no-explicit-any */

import { Plugin } from "obsidian";
import { DataviewApi, FullIndex } from "obsidian-dataview";

declare module "obsidian-dataview" {
  export interface DataviewSettings {

  }

  export interface DataviewPlugin extends Plugin {
    /** Plugin-wide default settings. */
    settings: DataviewSettings;

    /** The index that stores all dataview data. */
    index: FullIndex;
    /** External-facing plugin API. */
    api: DataviewApi;
  }
}

export { DataviewApi, FullIndex };
