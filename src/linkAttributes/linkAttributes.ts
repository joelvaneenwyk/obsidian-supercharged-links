import {
  App,
  FrontMatterCache,
  LinkCache,
  MarkdownPostProcessorContext,
  MarkdownView,
  TFile,
  WorkspaceLeaf,
  getAllTags,
  getLinkpath
} from 'obsidian';
import { DataviewApi } from 'obsidian-dataview';
import { SuperchargedLinks } from 'plugin/index';
import { SuperchargedLinksSettings } from 'plugin/settings';

export function clearExtraAttributes(link: HTMLElement) {
  Object.values(link.attributes).forEach((attr) => {
    if (attr.name.includes('data-link')) {
      link.removeAttribute(attr.name);
    }
  });
}

export function fetchTargetAttributesSync(
  app: App,
  plugin: SuperchargedLinks,
  settings: SuperchargedLinksSettings,
  dest: TFile,
  addDataHref: boolean
): Record<string, string> {
  const new_props: Record<string, string> = { tags: '' };
  const cache = app.metadataCache.getFileCache(dest);
  if (!cache) {
    return new_props;
  }

  const frontmatter = cache.frontmatter;

  if (frontmatter) {
    settings.targetAttributes.forEach((attribute) => {
      if (Object.keys(frontmatter).includes(attribute)) {
        if (attribute === 'tag' || attribute === 'tags') {
          new_props['tags'] += frontmatter[attribute];
        } else {
          new_props[attribute] = frontmatter[attribute];
        }
      }
    });
  }

  if (settings.targetTags) {
    new_props['tags'] += getAllTags(cache)?.join(' ');
  }

  if (addDataHref) {
    new_props['data-href'] = dest.basename;
  }

  new_props['path'] = dest.path;

  const getResults = (api: DataviewApi) => {
    const page = api.page(dest.path);
    if (!page) {
      return;
    }
    settings.targetAttributes.forEach((field: string) => {
      const value = page[field];
      if (value) new_props[field] = value;
    });
  };

  if (settings.getFromInlineField && plugin.dataview) {
    if (plugin.dataviewApi) {
      getResults(plugin.dataviewApi);
    } else {
      plugin.registerEvent(app.metadataCache.on('dataview:api-ready', (api: DataviewApi) => getResults(api)));
    }
  }

  return new_props;
}

function setLinkNewProps(link: HTMLElement, new_props: Record<string, string>) {
  for (const a of link.attributes) {
    if (a.name.includes('data-link') && !(a.name in new_props)) {
      link.removeAttribute(a.name);
    }
  }
  Object.keys(new_props).forEach((key) => {
    const name = 'data-link-' + key;
    const newValue = new_props[key];
    const curValue = link.getAttribute(name);

    // Only update if value is different
    if (!newValue || curValue != newValue) {
      link.setAttribute('data-link-' + key, new_props[key]);
    }
  });
  if (!link.hasClass('data-link-icon')) {
    link.addClass('data-link-icon');
  }
  if (!link.hasClass('data-link-icon-after')) {
    link.addClass('data-link-icon-after');
  }
  if (!link.hasClass('data-link-text')) {
    link.addClass('data-link-text');
  }
}

function updateLinkExtraAttributes(
  app: App,
  plugin: SuperchargedLinks,
  settings: SuperchargedLinksSettings,
  link: HTMLElement,
  destName: string
) {
  const linkHref = link.getAttribute('href')?.split('#')[0];
  if (linkHref) {
    const dest = app.metadataCache.getFirstLinkpathDest(linkHref, destName);

    if (dest) {
      const new_props = fetchTargetAttributesSync(app, plugin, settings, dest, false);
      setLinkNewProps(link, new_props);
    }
  }
}

export function updateDivExtraAttributes(
  app: App,
  plugin: SuperchargedLinks,
  settings: SuperchargedLinksSettings,
  link: HTMLElement,
  destName: string,
  linkName?: string
) {
  let linkNameOutput = linkName ?? link.textContent;

  if (link.parentElement?.getAttribute('data-path')) {
    // File Browser
    linkNameOutput = link.parentElement.getAttribute('data-path');
  } else if (link.parentElement?.getAttribute('class') == 'suggestion-content' && !!link.nextElementSibling) {
    // Auto complete
    linkNameOutput = (link.nextElementSibling?.textContent ?? '') + linkName;
  }
  const dest = app.metadataCache.getFirstLinkpathDest(getLinkpath(linkNameOutput ?? ''), destName);

  if (dest) {
    const new_props = fetchTargetAttributesSync(app, plugin, settings, dest, true);
    setLinkNewProps(link, new_props);
  }
}

export function updateElLinks(app: App, plugin: SuperchargedLinks, el: HTMLElement, ctx: MarkdownPostProcessorContext) {
  const settings = plugin.settings;
  const links = el.querySelectorAll('a.internal-link');
  const destName = ctx.sourcePath.replace(/(.*).md/, '$1');
  links.forEach((link: Element, key: number, parent: NodeListOf<Element>) => {
    updateLinkExtraAttributes(app, plugin, settings, link as HTMLElement, destName);
  });
}

function _tryGetKey(el: Element): string {
  let key: string | undefined;
  try {
    const sharedRootElement = el.parentElement?.parentElement?.parentElement;
    const keyElements = [
      sharedRootElement?.parentElement?.children[0]?.children[1],
      sharedRootElement?.children[0]?.children[1]
    ]
    keyElements.forEach((keyEl) => {
      if (keyEl && 'value' in keyEl) {
        key = keyEl.value?.toString();
      }
    });
  } catch (error) {
    // Ignore
  }
  return key ?? '';
}

function _getFrontMatterValues(file: TFile | null, element: Element): string[] {
  const frontmatterValues: string[] = [];
  let frontmatterCache: FrontMatterCache | undefined;

  try {
    frontmatterCache = SuperchargedLinks.application.metadataCache.getCache(file?.path ?? '')?.frontmatter;
  } catch (error) {
    // ignore
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const add = (link: any) => {
    try {
      const value = link?.toString();
      if (value) {
        frontmatterValues.push(value);
      }
    } catch (error) {
      // Ignore
    }
  };

  if (frontmatterCache) {
    const htmlElement = element as HTMLElement;
    const key = _tryGetKey(htmlElement);
    try {
      const value = frontmatterCache[key];
      if (Array.isArray(value)) {
        value.forEach(function (item) {
          add(item);
        });
      } else {
        add(value);
      }
    } catch (error) {
      // ignore
    }
  }

  return frontmatterValues;
}

function _tryGetLinkName(element: Element, value?: string) {
  const htmlLinkElement = element as HTMLElement;
  const linkText = htmlLinkElement.textContent;
  let linkName: string | null = null;
  if (value !== undefined && value.length > 4 && value.startsWith('[[') && value.endsWith(']]')) {
    const slicedS = value.slice(2, -2);
    const split = slicedS.split('|');
    if (split.length == 1 && split[0] == linkText) {
      linkName = split[0];
    } else if (split.length == 2 && split[1] == linkText) {
      linkName = split[0];
    }
  }
  return linkName;
}

export function updatePropertiesPane(
  propertiesEl: HTMLElement,
  file: TFile | null,
  app: App,
  plugin: SuperchargedLinks
) {
  const nodes = propertiesEl.querySelectorAll('div.internal-link > .multi-select-pill-content, div.metadata-link-inner');
  for (let i = 0; i < nodes.length; ++i) {
    const frontmatterValues = _getFrontMatterValues(file, nodes[i]);
    for (const value of frontmatterValues) {
      const linkName = _tryGetLinkName(nodes[i], value);
      if (linkName) {
        const destName = '';
        const htmlLinkElement = nodes[i] as HTMLElement;
        updateDivExtraAttributes(plugin.app, plugin, plugin.settings, htmlLinkElement, destName, linkName);
      }
    }
  }
}

function updateWorkspaceView(plugin: SuperchargedLinks, leaf: WorkspaceLeaf) {
  if (leaf.view instanceof MarkdownView && leaf.view.file) {
    const file = leaf.view.file;
    const cachedFile = plugin.app.metadataCache.getFileCache(leaf.view.file);
    const metadata = leaf.view?.metadataEditor?.contentEl;

    if (metadata) {
      updatePropertiesPane(metadata, file, plugin.app, plugin);
    }

    const tabHeader: HTMLElement = leaf.tabHeaderInnerTitleEl;
    if (plugin.settings.enableTabHeader) {
      // Supercharge tab headers
      updateDivExtraAttributes(plugin.app, plugin, plugin.settings, tabHeader, '', file.path);
    } else {
      clearExtraAttributes(tabHeader);
    }

    if (cachedFile?.links) {
      cachedFile.links.forEach((link: LinkCache) => {
        const fileName = file.path.replace(/(.*).md/, '$1');
        const dest = plugin.app.metadataCache.getFirstLinkpathDest(link.link, fileName);
        if (dest) {
          const new_props = fetchTargetAttributesSync(plugin.app, plugin, plugin.settings, dest, false);
          const internalLinks = leaf.view.containerEl.querySelectorAll(`a.internal-link[href="${link.link}"]`);
          internalLinks.forEach((internalLink: Element, key: number, parent: NodeListOf<Element>) => {
            setLinkNewProps(internalLink as HTMLElement, new_props);
          });
        }
      });
    }
  }
}

export function updateVisibleLinks(app: App, plugin: SuperchargedLinks) {
  app.workspace.iterateRootLeaves((leaf: WorkspaceLeaf) => {
    updateWorkspaceView(plugin, leaf);
  });
}
