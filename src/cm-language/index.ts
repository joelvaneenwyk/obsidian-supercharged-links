export {
  LRLanguage,
  Language,
  LanguageDescription,
  LanguageSupport,
  ParseContext,
  Sublanguage,
  defineLanguageFacet,
  ensureSyntaxTree,
  forceParsing,
  language,
  languageDataProp,
  sublanguageProp,
  syntaxParserRunning,
  syntaxTree,
  syntaxTreeAvailable
} from './language';

export {
  IndentContext,
  TreeIndentContext,
  continuedIndent,
  delimitedIndent,
  flatIndent,
  getIndentUnit,
  getIndentation,
  indentNodeProp,
  indentOnInput,
  indentRange,
  indentService,
  indentString,
  indentUnit
} from './indent';

export {
  codeFolding,
  foldAll,
  foldCode,
  foldEffect,
  foldGutter,
  foldInside,
  foldKeymap,
  foldNodeProp,
  foldService,
  foldState,
  foldable,
  foldedRanges,
  toggleFold,
  unfoldAll,
  unfoldCode,
  unfoldEffect
} from './fold';

export { HighlightStyle, TagStyle, defaultHighlightStyle, highlightingFor, syntaxHighlighting } from './highlight';

export { Config, MatchResult, bracketMatching, bracketMatchingHandle, matchBrackets } from './match-brackets';

export {
  StreamLanguage,
  StreamParser,
  ignoreSpellcheckToken,
  lineClassNodeProp,
  lineHighlighter,
  tokenClassNodeProp
} from './stream-parser';

export { StringStream } from './string-stream';

export { NodeProp, NodeType, SyntaxNode, SyntaxNodeRef, Tree } from '@lezer/common';
