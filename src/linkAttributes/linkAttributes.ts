import {
  App,
  FrontMatterCache,
  LinkCache,
  MarkdownPostProcessorContext,
  MarkdownView,
  TFile,
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

function tryGetKey(el: Element): string {
  const keyEl = el.parentElement?.parentElement?.parentElement?.parentElement?.children[0].children[1];
  let key: string;
  if (keyEl && 'value' in keyEl) {
    key = keyEl.value?.toString() ?? '';
  } else {
    key = '';
  }
  return key;
}

export function updatePropertiesPane(
  propertiesEl: HTMLElement,
  file: TFile | null,
  app: App,
  plugin: SuperchargedLinks
) {
  let frontmatter: FrontMatterCache | undefined;
  try {
    frontmatter = app.metadataCache.getCache(file?.path ?? '')?.frontmatter;
  } catch (error) {
    // ignore
  }
  if (frontmatter) {
    const nodes = propertiesEl.querySelectorAll('div.internal-link > .multi-select-pill-content');
    for (let i = 0; i < nodes.length; ++i) {
      const el = nodes[i] as HTMLElement;
      const linkText = el.textContent;
      const key = tryGetKey(el);
      const listOfLinks: [string] = frontmatter[key];
      let foundS = null;
      for (const s of listOfLinks) {
        if (s.length > 4 && s.startsWith('[[') && s.endsWith(']]')) {
          const slicedS = s.slice(2, -2);
          const split = slicedS.split('|');
          if (split.length == 1 && split[0] == linkText) {
            foundS = split[0];
            break;
          } else if (split.length == 2 && split[1] == linkText) {
            foundS = split[0];
            break;
          }
        }
      }
      if (foundS) {
        updateDivExtraAttributes(plugin.app, plugin, plugin.settings, el, '', foundS);
      }
    }
    const singleNodes = propertiesEl.querySelectorAll('div.metadata-link-inner');
    for (let i = 0; i < singleNodes.length; ++i) {
      const el = singleNodes[i] as HTMLElement;
      const linkText = el.textContent;
      const key = tryGetKey(el);
      const link: string = frontmatter[key];
      let foundS: string | null = null;
      if (link.length > 4 && link.startsWith('[[') && link.endsWith(']]')) {
        const slicedS = link.slice(2, -2);
        const split = slicedS.split('|');
        if (split.length == 1 && split[0] == linkText) {
          foundS = split[0];
        } else if (split.length == 2 && split[1] == linkText) {
          foundS = split[0];
        }
      }
      if (foundS) {
        updateDivExtraAttributes(plugin.app, plugin, plugin.settings, el, '', foundS);
      }
    }
  }
}

export function updateVisibleLinks(app: App, plugin: SuperchargedLinks) {
  app.workspace.iterateRootLeaves((leaf) => {
    if (leaf.view instanceof MarkdownView && leaf.view.file) {
      const file: TFile = leaf.view.file;
      const cachedFile = app.metadataCache.getFileCache(file);

      const metadata = leaf.view?.metadataEditor?.contentEl;
      if (metadata) {
        updatePropertiesPane(metadata, file, app, plugin);
      }

      const tabHeader: HTMLElement = leaf.tabHeaderInnerTitleEl;
      if (plugin.settings.enableTabHeader) {
        // Supercharge tab headers
        updateDivExtraAttributes(app, plugin, plugin.settings, tabHeader, '', file.path);
      } else {
        clearExtraAttributes(tabHeader);
      }

      if (cachedFile?.links) {
        cachedFile.links.forEach((link: LinkCache) => {
          const fileName = file.path.replace(/(.*).md/, '$1');
          const dest = app.metadataCache.getFirstLinkpathDest(link.link, fileName);
          if (dest) {
            const new_props = fetchTargetAttributesSync(app, plugin, plugin.settings, dest, false);
            const internalLinks = leaf.view.containerEl.querySelectorAll(`a.internal-link[href="${link.link}"]`);
            internalLinks.forEach((internalLink: Element, key: number, parent: NodeListOf<Element>) => {
              setLinkNewProps(internalLink as HTMLElement, new_props);
            });
          }
        });
      }
    }
  });
}
