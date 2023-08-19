import {Decoration, EditorView, ViewPlugin, ViewUpdate, DecorationSet} from "@codemirror/view";
import {Tree, Input, TreeFragment, NodeType, NodeSet, SyntaxNode, PartialParse, Parser, NodeProp} from "@lezer/common";
import {Language, defineLanguageFacet, languageDataProp, syntaxTree, ParseContext} from "./language";
import {IndentContext, indentService, getIndentUnit} from "./indent";
import {EditorState, Facet, Prec, RangeSetBuilder} from "@codemirror/state";
import {StringStream} from "./stringstream";

export {StringStream};

/// A stream parser parses or tokenizes content from start to end,
/// emitting tokens as it goes over it. It keeps a mutable (but
/// copyable) object with state, in which it can store information
/// about the current context.
export interface StreamParser<State> {
  /// A name for this language.
  name?: string
  /// Produce a start state for the parser.
  startState?(indentUnit: number): State
  /// Read one token, advancing the stream past it, and returning a
  /// string indicating the token's style tag—either the name of one
  /// of the tags in
  /// [`tags`](https://lezer.codemirror.net/docs/ref#highlight.tags),
  /// or such a name suffixed by one or more tag
  /// [modifier](https://lezer.codemirror.net/docs/ref#highlight.Tag^defineModifier)
  /// names, separated by periods. For example `"keyword"` or
  /// "`variableName.constant"`.
  ///
  /// It is okay to return a zero-length token, but only if that
  /// updates the state so that the next call will return a non-empty
  /// token again.
  token(stream: StringStream, state: State): string | null
  /// This notifies the parser of a blank line in the input. It can
  /// update its state here if it needs to.
  blankLine?(state: State, indentUnit: number): string | null
  /// Copy a given state. By default, a shallow object copy is done
  /// which also copies arrays held at the top level of the object.
  copyState?(state: State): State
  /// Compute automatic indentation for the line that starts with the
  /// given state and text.
  indent?(state: State, textAfter: string, context: IndentContext): number | null
  /// Default [language data](#state.EditorState.languageDataAt) to
  /// attach to this language.
  languageData?: {[name: string]: any}
}

function fullParser<State>(spec: StreamParser<State>): Required<StreamParser<State>> {
    return {
        name: spec.name || "",
        token: spec.token,
        blankLine: spec.blankLine || (() => null),
        startState: spec.startState || (() => (true as any)),
        copyState: spec.copyState || defaultCopyState,
        indent: spec.indent || (() => null),
        languageData: spec.languageData || {},
    };
}

function defaultCopyState<State>(state: State) {
    if (typeof state != "object") return state;
    const newState = {} as State;
    for (const prop in state) {
        const val = state[prop];
        newState[prop] = (val instanceof Array ? val.slice() : val) as any;
    }
    return newState;
}

const IndentedFrom = new WeakMap<EditorState, number>();

/// A [language](#language.Language) class based on a CodeMirror
/// 5-style [streaming parser](#language.StreamParser).
export class StreamLanguage<State> extends Language {
    /// @internal
    streamParser: Required<StreamParser<State>>;
    /// @internal
    stateAfter: NodeProp<State>;
    /// @internal
    topNode: NodeType;

    private constructor(parser: StreamParser<State>) {
        const data = defineLanguageFacet(parser.languageData);
        let p = fullParser(parser), self: StreamLanguage<State>;
        const impl = new class extends Parser {
            createParse(input: Input, fragments: readonly TreeFragment[], ranges: readonly {from: number, to: number}[]) {
                return new Parse(self, input, fragments, ranges);
            }
        };
        super(data, impl, [indentService.of((cx, pos) => this.getIndent(cx, pos))], parser.name);
        this.topNode = docID(data);
        self = this;
        this.streamParser = p;
        this.stateAfter = new NodeProp<State>({perNode: true});
    }

    /// Define a stream language.
    static define<State>(spec: StreamParser<State>) { return new StreamLanguage(spec); }

    private getIndent(cx: IndentContext, pos: number) {
        let tree = syntaxTree(cx.state), at: SyntaxNode | null = tree.resolve(pos);
        while (at && at.type != this.topNode) at = at.parent;
        if (!at) return null;
        let from = undefined;
        const {overrideIndentation} = cx.options;
        if (overrideIndentation) {
            from = IndentedFrom.get(cx.state);
            if (from != null && from < pos - 1e4) from = undefined;
        }
        let start = findState(this, tree, 0, at.from, from ?? pos), statePos: number, state;
        if (start) { state = start.state; statePos = start.pos + 1; }
        else { state = this.streamParser.startState(cx.unit) ; statePos = 0; }
        if (pos - statePos > C.MaxIndentScanDist) return null;
        while (statePos < pos) {
            const line = cx.state.doc.lineAt(statePos), end = Math.min(pos, line.to);
            if (line.length) {
                const indentation = overrideIndentation ? overrideIndentation(line.from) : -1;
                const lookahead = (n: number) => n + line.number > cx.state.doc.lines ? "" : cx.state.doc.line(n + line.number).text;
                const stream = new StringStream(line.text, cx.state.tabSize, cx.unit, lookahead, indentation < 0 ? undefined : indentation);
                while (stream.pos < end - line.from)
                    readToken(this.streamParser.token, stream, state);
            } else {
                this.streamParser.blankLine(state, cx.unit);
            }
            if (end == pos) break;
            statePos = line.to + 1;
        }
        const line = cx.lineAt(pos);
        if (overrideIndentation && from == null) IndentedFrom.set(cx.state, line.from);
        const result = this.streamParser.indent(state, /^\s*(.*)/.exec(line.text)![1], cx);
        if (result && result.toString() === "CodeMirror.Pass") {
            return null;
        }
        return result;
    }

    get allowsNesting() { return false; }
}

function findState<State>(
    lang: StreamLanguage<State>, tree: Tree, off: number, startPos: number, before: number
): {state: State, pos: number} | null {
    const state = off >= startPos && off + tree.length <= before && tree.prop(lang.stateAfter);
    if (state) return {state: lang.streamParser.copyState(state), pos: off + tree.length};
    for (let i = tree.children.length - 1; i >= 0; i--) {
        const child = tree.children[i], pos = off + tree.positions[i];
        const found = child instanceof Tree && pos < before && findState(lang, child, pos, startPos, before);
        if (found) return found;
    }
    return null;
}

function cutTree(lang: StreamLanguage<unknown>, tree: Tree, from: number, to: number, inside: boolean): Tree | null {
    if (inside && from <= 0 && to >= tree.length) return tree;
    if (!inside && tree.type == lang.topNode) inside = true;
    for (let i = tree.children.length - 1; i >= 0; i--) {
        let pos = tree.positions[i], child = tree.children[i], inner;
        if (pos < to && child instanceof Tree) {
            if (!(inner = cutTree(lang, child, from - pos, to - pos, inside))) break;
            return !inside ? inner
                : new Tree(tree.type, tree.children.slice(0, i).concat(inner), tree.positions.slice(0, i + 1), pos + inner.length);
        }
    }
    return null;
}

function findStartInFragments<State>(lang: StreamLanguage<State>, fragments: readonly TreeFragment[],
    startPos: number, editorState?: EditorState) {
    for (const f of fragments) {
        const from = f.from + (f.openStart ? 25 : 0), to = f.to - (f.openEnd ? 25 : 0);
        let found = from <= startPos && to > startPos && findState(lang, f.tree, 0 - f.offset, startPos, to), tree;
        if (found && (tree = cutTree(lang, f.tree, startPos + f.offset, found.pos + f.offset, false)))
            return {state: found.state, tree};
    }
    return {state: lang.streamParser.startState(editorState ? getIndentUnit(editorState) : 4), tree: Tree.empty};
}

const enum C {
  ChunkSize = 2048,
  MaxDistanceBeforeViewport = 1e5,
  MaxIndentScanDist = 1e4,
}

class Parse<State> implements PartialParse {
    state: State;
    parsedPos: number;
    stoppedAt: number | null = null;
    chunks: Tree[] = [];
    chunkPos: number[] = [];
    chunkStart: number;
    chunk: number[] = [];
    chunkReused: undefined | Tree[] = undefined;
    tokenCache: Record<string, [string, string[]]> = {};
    rangeIndex = 0;
    to: number;

    constructor(readonly lang: StreamLanguage<State>,
              readonly input: Input,
              readonly fragments: readonly TreeFragment[],
              readonly ranges: readonly {from: number, to: number}[]) {
        this.to = ranges[ranges.length - 1].to;
        const context = ParseContext.get(), from = ranges[0].from;
        const {state, tree} = findStartInFragments(lang, fragments, from, context?.state);
        this.state = state;
        this.parsedPos = this.chunkStart = from + tree.length;
        for (let i = 0; i < tree.children.length; i++) {
            this.chunks.push(tree.children[i] as Tree);
            this.chunkPos.push(tree.positions[i]);
        }
        if (context && this.parsedPos < context.viewport.from - C.MaxDistanceBeforeViewport) {
            this.state = this.lang.streamParser.startState(getIndentUnit(context.state));
            context.skipUntilInView(this.parsedPos, context.viewport.from);
            this.parsedPos = context.viewport.from;
        }
        this.moveRangeIndex();
    }

    advance() {
        const context = ParseContext.get();
        const parseEnd = this.stoppedAt == null ? this.to : Math.min(this.to, this.stoppedAt);
        let end = Math.min(parseEnd, this.chunkStart + C.ChunkSize);
        // Parse just a little bit more than the viewport.
        const overbuffer = 5000;
        const viewportEnd = context.viewport.to + overbuffer;
        if (context) end = Math.min(end, viewportEnd);
        while (this.parsedPos < end) this.parseLine(context);
        if (this.chunkStart < this.parsedPos) this.finishChunk();
        if (this.parsedPos >= parseEnd) return this.finish();
        if (context && this.parsedPos >= viewportEnd) {
            context.skipUntilInView(this.parsedPos - overbuffer, parseEnd);
            return this.finish();
        }
        return null;
    }

    stopAt(pos: number) {
        this.stoppedAt = pos;
    }

    lineAfter(pos: number) {
        let chunk = this.input.chunk(pos);
        if (!this.input.lineChunks) {
            const eol = chunk.indexOf("\n");
            if (eol > -1) chunk = chunk.slice(0, eol);
        } else if (chunk == "\n") {
            chunk = "";
        }
        return pos + chunk.length <= this.to ? chunk : chunk.slice(0, this.to - pos);
    }

    nextLine() {
        let from = this.parsedPos, line = this.lineAfter(from), end = from + line.length;
        for (let index = this.rangeIndex;;) {
            const rangeEnd = this.ranges[index].to;
            if (rangeEnd >= end) break;
            line = line.slice(0, rangeEnd - (end - line.length));
            index++;
            if (index == this.ranges.length) break;
            const rangeStart = this.ranges[index].from;
            const after = this.lineAfter(rangeStart);
            line += after;
            end = rangeStart + after.length;
        }
        return {line, end};
    }

    skipGapsTo(pos: number, offset: number, side: -1 | 1) {
        for (;;) {
            const end = this.ranges[this.rangeIndex].to, offPos = pos + offset;
            if (side > 0 ? end > offPos : end >= offPos) break;
            const start = this.ranges[++this.rangeIndex].from;
            offset += start - end;
        }
        return offset;
    }

    moveRangeIndex() {
        while (this.ranges[this.rangeIndex].to < this.parsedPos) this.rangeIndex++;
    }

    emitToken(id: number, from: number, to: number, size: number, offset: number) {
        if (this.ranges.length > 1) {
            offset = this.skipGapsTo(from, offset, 1);
            from += offset;
            const len0 = this.chunk.length;
            offset = this.skipGapsTo(to, offset, -1);
            to += offset;
            size += this.chunk.length - len0;
        }
        this.chunk.push(id, from, to, size);
        return offset;
    }

    parseLine(context: ParseContext | null) {
        let {line, end} = this.nextLine(), offset = 0, {streamParser} = this.lang, {tokenCache} = this;
        const lookahead = (n: number) => {
            let pos = this.parsedPos;
            for (let i = 0; i < n; i++) {
                pos += this.lineAfter(pos).length;
                if (pos < this.input.length) pos++;
            }
            return this.lineAfter(pos);
        };
        const stream = new StringStream(line, context ? context.state.tabSize : 4, context ? getIndentUnit(context.state) : 2, lookahead);
        const chunks = [];
        const lineClasses = new Set<string>();
        if (stream.eol()) {
            const token = streamParser.blankLine(this.state, stream.indentUnit);
            if (token) {
                token.split(" ").forEach(t => {
                    if (!t) return;
                    const lineClass = t.match(/^line-(background-)?(.*)$/);
                    if (lineClass) {
                        lineClasses.add(lineClass[2]);
                    }
                });
            }
        } else {
            let last: {cls: string, from: number, to: number} = null;
            while (!stream.eol()) {
                const token = readToken(streamParser.token, stream, this.state);
                if (token) {
                    const cached = tokenCache[token];
                    let linecls: string[] = [];
                    let cls: string;
                    if (cached) {
                        cls = cached[0];
                        linecls = cached[1];
                    }
                    else {
                        let tokens = token.split(" ");
                        tokens = tokens.filter(t => {
                            if (!t) return false;
                            const lineClass = t.match(/^line-(background-)?(.*)$/);
                            if (lineClass) {
                                linecls.push(lineClass[2]);
                                return false;
                            }
                            return true;
                        });
                        cls = tokens.sort().join(" ");
                        tokenCache[token] = [cls, linecls];
                    }
                    if (linecls.length > 0) {
                        for (const cls of linecls) {
                            lineClasses.add(cls);
                        }
                    }
                    const from = this.parsedPos + stream.start;
                    const to = this.parsedPos + stream.pos;
                    if (last && last.cls === cls && last.to === from) {
                        last.to = to;
                    } else {
                        last = {cls, from, to};
                        chunks.push(last);
                    }
                }
            }
            for (const chunk of chunks) {
                offset = this.emitToken(tokenID(chunk.cls), chunk.from, chunk.to, 4, offset);
            }
        }
        if (lineClasses.size > 0) {
            offset = this.emitToken(tokenID(Array.from(lineClasses).sort().join(" "), true), this.parsedPos, this.parsedPos + line.length, (chunks.length + 1) * 4, offset);
        }
        this.parsedPos = end;
        this.moveRangeIndex();
        if (this.parsedPos < this.to) this.parsedPos++;
    }

    finishChunk() {
        let tree = Tree.build({
            buffer: this.chunk,
            start: this.chunkStart,
            length: this.parsedPos - this.chunkStart,
            nodeSet,
            topID: 0,
            maxBufferLength: C.ChunkSize,
            reused: this.chunkReused
        });
        tree = new Tree(tree.type, tree.children, tree.positions, tree.length,
            [[this.lang.stateAfter, this.lang.streamParser.copyState(this.state)]]);
        this.chunks.push(tree);
        this.chunkPos.push(this.chunkStart - this.ranges[0].from);
        this.chunk = [];
        this.chunkReused = undefined;
        this.chunkStart = this.parsedPos;
    }

    finish() {
        return new Tree(this.lang.topNode, this.chunks, this.chunkPos, this.parsedPos - this.ranges[0].from).balance();
    }
}

function readToken<State>(token: (stream: StringStream, state: State) => string | null,
    stream: StringStream, state: State) {
    stream.start = stream.pos;
    for (let i = 0; i < 10; i++) {
        const result = token(stream, state);
        if (stream.pos > stream.start) return result;
    }
    throw new Error("Stream parser failed to advance stream.");
}

const tokenTable: {[name: string]: number} = Object.create(null);
const typeArray: NodeType[] = [NodeType.none];
const nodeSet = new NodeSet(typeArray);

function tokenID(tag: string, lineMode?: boolean): number {
    return !tag ? 0 : tokenTable[tag] || (tokenTable[tag] = createTokenType(tag, lineMode));
}

function createTokenType(tagStr: string, lineMode?: boolean) {
    const name = tagStr.replace(/ /g, "_"), type = NodeType.define({
        id: typeArray.length,
        name,
        props: [lineMode ? lineClassNodeProp.add({[name]: tagStr}) : tokenClassNodeProp.add({[name]: tagStr})]
    });
    typeArray.push(type);
    return type.id;
}

function docID(data: Facet<{[name: string]: any}>) {
    const type = NodeType.define({id: typeArray.length, name: "Document", props: [languageDataProp.add(() => data)]});
    typeArray.push(type);
    return type;
}

// The NodeProp that holds the css class we want to apply
export const tokenClassNodeProp = new NodeProp<string>();
export const lineClassNodeProp = new NodeProp<string>();

class LineHighlighter {
    decorations: DecorationSet;
    tree: Tree;
    lineCache: {[cls: string]: Decoration} = Object.create(null);
    tokenCache: {[cls: string]: Decoration} = Object.create(null);

    constructor(view: EditorView) {
        this.tree = syntaxTree(view.state);
        this.decorations = this.buildDeco(view);
    }

    update(update: ViewUpdate) {
        const tree = syntaxTree(update.state);
        if (tree.length < update.view.viewport.to || update.view.compositionStarted) {
            this.decorations = this.decorations.map(update.changes);
        } else if (tree != this.tree || update.viewportChanged) {
            this.tree = tree;
            this.decorations = this.buildDeco(update.view);
        }
    }

    buildDeco(view: EditorView) {
        if (!this.tree.length) return Decoration.none;

        const spellcheckIgnoreTokens: string[] = [];
        for(const str of view.state.facet(ignoreSpellcheckToken)) {
            spellcheckIgnoreTokens.push(...str.split(" "));
        }
        const spellCheckIgnoreSet = new Set<string>(spellcheckIgnoreTokens);
        const hasSpellcheckIgnoreTokens = spellCheckIgnoreSet.size > 0;

        const builder = new RangeSetBuilder<Decoration>();
        let lastPos = 0;
        for (const {from, to} of view.visibleRanges) {
            this.tree.iterate({
                from, to,
                enter: ({type, from, to}) => {
                    const lineStyle = type.prop(lineClassNodeProp);
                    if (lineStyle) {
                        const lineDeco = this.lineCache[lineStyle] || (this.lineCache[lineStyle] = Decoration.line({attributes:{class: lineStyle}}));
                        const newFrom = view.lineBlockAt(from).from;
                        // Ignore line modes that start from the middle of the line text
                        if (lastPos > newFrom) {
                            return;
                        }
                        builder.add(newFrom, newFrom, lineDeco);
                        lastPos = newFrom;
                    }

                    const tokenStyle = type.prop(tokenClassNodeProp);
                    if (tokenStyle) {
                        if (lastPos > from) {
                            return;
                        }
                        let lineDeco = this.tokenCache[tokenStyle];
                        if (!lineDeco) {
                            const tokens = tokenStyle.split(" ");
                            const spec: any = {class: tokens.map(c => "cm-" + c).join(" ")};
                            if (hasSpellcheckIgnoreTokens && tokens.some(token => spellCheckIgnoreSet.has(token))) {
                                spec.attributes = {spellcheck: "false"};
                            }
                            lineDeco = this.tokenCache[tokenStyle] = Decoration.mark(spec);
                        }
                        builder.add(from, to, lineDeco);
                        lastPos = to;
                    }
                }
            });
        }
        return builder.finish();
    }
}

// This extension installs a highlighter that highlights lines based on the node prop above
export const lineHighlighter = Prec.lowest(ViewPlugin.define(view => new LineHighlighter(view), {
    decorations: v => v.decorations
}));

export const ignoreSpellcheckToken = Facet.define<string, string[]>({});
