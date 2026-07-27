import path from "node:path";
import ts from "typescript";
import {
  ASKR_MODULE_PATTERN,
  POSITIONAL_DATA_CONCEPTS,
  RENDER_SCOPED_CONCEPTS,
  type ImportedAskrBinding,
} from "./catalog";
import { localCallGraph, summarizeTransitiveCalls } from "./call-graph";
import { workspaceRelativeFile } from "./project";
import type {
  AnalyzeDiagnostic,
  AnalyzeRule,
  AnalyzeSeverity,
  WorkspaceAnalysisContext,
} from "./types";

interface SourceBindings {
  readonly named: Map<string, ImportedAskrBinding>;
  readonly namespaces: Set<string>;
}

const SOURCE_BINDING_CACHE = new WeakMap<ts.SourceFile, SourceBindings>();

interface SourceCallFact {
  readonly node: ts.CallExpression;
  readonly name: string;
}

interface SourceJsxFact {
  readonly node: ts.JsxOpeningLikeElement;
  readonly name: string;
}

interface SourceFacts {
  readonly bindings: SourceBindings;
  readonly calls: readonly SourceCallFact[];
  readonly allCalls: readonly ts.CallExpression[];
  readonly jsx: readonly SourceJsxFact[];
  readonly constructions: readonly ts.NewExpression[];
}

const SOURCE_FACT_CACHE = new WeakMap<ts.SourceFile, SourceFacts>();

function sourceBindings(sourceFile: ts.SourceFile): SourceBindings {
  const cached = SOURCE_BINDING_CACHE.get(sourceFile);
  if (cached) return cached;
  const named = new Map<string, ImportedAskrBinding>();
  const namespaces = new Set<string>();
  for (const statement of sourceFile.statements) {
    if (
      !ts.isImportDeclaration(statement) ||
      !ts.isStringLiteral(statement.moduleSpecifier) ||
      !ASKR_MODULE_PATTERN.test(statement.moduleSpecifier.text)
    ) {
      continue;
    }
    const clause = statement.importClause;
    const bindings = clause?.namedBindings;
    if (bindings && ts.isNamedImports(bindings)) {
      for (const element of bindings.elements) {
        named.set(element.name.text, {
          imported: element.propertyName?.text ?? element.name.text,
          module: statement.moduleSpecifier.text,
        });
      }
    } else if (bindings && ts.isNamespaceImport(bindings)) {
      namespaces.add(bindings.name.text);
    }
  }
  const bindings = { named, namespaces };
  SOURCE_BINDING_CACHE.set(sourceFile, bindings);
  return bindings;
}

function canonicalCallName(
  expression: ts.LeftHandSideExpression,
  bindings: SourceBindings,
): string | null {
  if (ts.isIdentifier(expression)) return bindings.named.get(expression.text)?.imported ?? null;
  if (
    ts.isPropertyAccessExpression(expression) &&
    ts.isIdentifier(expression.expression) &&
    bindings.namespaces.has(expression.expression.text)
  ) {
    return expression.name.text;
  }
  return null;
}

function canonicalJsxName(name: ts.JsxTagNameExpression, bindings: SourceBindings): string | null {
  if (ts.isIdentifier(name)) return bindings.named.get(name.text)?.imported ?? null;
  if (
    ts.isPropertyAccessExpression(name) &&
    ts.isIdentifier(name.expression) &&
    bindings.namespaces.has(name.expression.text)
  ) {
    return name.name.text;
  }
  return null;
}

function sourceFacts(sourceFile: ts.SourceFile): SourceFacts {
  const cached = SOURCE_FACT_CACHE.get(sourceFile);
  if (cached) return cached;
  const bindings = sourceBindings(sourceFile);
  const calls: SourceCallFact[] = [];
  const allCalls: ts.CallExpression[] = [];
  const jsx: SourceJsxFact[] = [];
  const constructions: ts.NewExpression[] = [];
  const walk = (node: ts.Node): void => {
    if (ts.isCallExpression(node)) {
      allCalls.push(node);
      const name = canonicalCallName(node.expression, bindings);
      if (name) calls.push({ node, name });
    } else if (ts.isJsxOpeningElement(node) || ts.isJsxSelfClosingElement(node)) {
      const name = canonicalJsxName(node.tagName, bindings);
      if (name) jsx.push({ node, name });
    } else if (ts.isNewExpression(node)) {
      constructions.push(node);
    }
    ts.forEachChild(node, walk);
  };
  walk(sourceFile);
  const facts = { bindings, calls, allCalls, jsx, constructions };
  SOURCE_FACT_CACHE.set(sourceFile, facts);
  return facts;
}

function location(
  context: WorkspaceAnalysisContext,
  node: ts.Node,
): Pick<AnalyzeDiagnostic, "column" | "file" | "line" | "workspace"> {
  const sourceFile = node.getSourceFile();
  const point = sourceFile.getLineAndCharacterOfPosition(node.getStart(sourceFile));
  return {
    workspace: context.workspace.name,
    file: workspaceRelativeFile(context, sourceFile.fileName),
    line: point.line + 1,
    column: point.character + 1,
  };
}

function diagnostic(
  context: WorkspaceAnalysisContext,
  node: ts.Node,
  rule: Pick<AnalyzeRule, "category" | "id" | "severity">,
  message: string,
  remediation?: string,
  fix?: AnalyzeDiagnostic["fix"],
): AnalyzeDiagnostic {
  return {
    ruleId: rule.id,
    category: rule.category,
    severity: rule.severity,
    message,
    ...location(context, node),
    ...(remediation ? { remediation } : {}),
    ...(fix ? { fix } : {}),
  };
}

function visit(sourceFile: ts.SourceFile, callback: (node: ts.Node) => void): void {
  const walk = (node: ts.Node): void => {
    callback(node);
    ts.forEachChild(node, walk);
  };
  walk(sourceFile);
}

function containingFunction(node: ts.Node): ts.SignatureDeclaration | null {
  for (let current = node.parent; current; current = current.parent) {
    if (ts.isFunctionLike(current)) return current;
  }
  return null;
}

function isControlFlowAncestor(node: ts.Node, boundary: ts.Node): boolean {
  for (let current = node.parent; current && current !== boundary; current = current.parent) {
    if (ts.isIfStatement(current) && !isConstantCondition(current.expression)) {
      return true;
    }
    if (
      (ts.isConditionalExpression(current) && !isConstantCondition(current.condition)) ||
      ts.isSwitchStatement(current) ||
      ts.isForStatement(current) ||
      ts.isForInStatement(current) ||
      ts.isForOfStatement(current) ||
      ts.isWhileStatement(current) ||
      ts.isDoStatement(current) ||
      ts.isTryStatement(current)
    ) {
      return true;
    }
    if (
      ts.isBinaryExpression(current) &&
      [ts.SyntaxKind.AmpersandAmpersandToken, ts.SyntaxKind.BarBarToken].includes(
        current.operatorToken.kind,
      ) &&
      !isConstantCondition(current.left)
    ) {
      return true;
    }
  }
  return hasConditionalEarlyExitBefore(node, boundary);
}

function containsFunctionExit(node: ts.Node): boolean {
  let found = false;
  const walk = (candidate: ts.Node): void => {
    if (found || (candidate !== node && ts.isFunctionLike(candidate))) return;
    if (ts.isReturnStatement(candidate) || ts.isThrowStatement(candidate)) {
      found = true;
      return;
    }
    ts.forEachChild(candidate, walk);
  };
  walk(node);
  return found;
}

function hasConditionalEarlyExitBefore(node: ts.Node, boundary: ts.Node): boolean {
  let child: ts.Node = node;
  for (let current = node.parent; current && current !== boundary; current = current.parent) {
    if (ts.isBlock(current)) {
      const statement = current.statements.find(
        (candidate) =>
          candidate === child || (candidate.pos <= child.pos && child.end <= candidate.end),
      );
      const index = statement ? current.statements.indexOf(statement) : -1;
      if (
        index > 0 &&
        current.statements
          .slice(0, index)
          .some(
            (candidate) =>
              ts.isIfStatement(candidate) &&
              !isConstantCondition(candidate.expression) &&
              containsFunctionExit(candidate),
          )
      ) {
        return true;
      }
    }
    child = current;
  }
  return false;
}

function functionName(node: ts.SignatureDeclaration): string | null {
  if ("name" in node && node.name && ts.isIdentifier(node.name)) return node.name.text;
  if (ts.isArrowFunction(node) || ts.isFunctionExpression(node)) {
    const parent = node.parent;
    if (ts.isVariableDeclaration(parent) && ts.isIdentifier(parent.name)) return parent.name.text;
  }
  return null;
}

const EAGER_CONTROL_CONCEPTS = new Set(["Case", "For", "Show"]);

function isConstantCondition(expression: ts.Expression): boolean {
  if (ts.isParenthesizedExpression(expression)) return isConstantCondition(expression.expression);
  return (
    expression.kind === ts.SyntaxKind.TrueKeyword ||
    expression.kind === ts.SyntaxKind.FalseKeyword ||
    expression.kind === ts.SyntaxKind.NullKeyword ||
    ts.isNumericLiteral(expression) ||
    ts.isStringLiteral(expression) ||
    ts.isNoSubstitutionTemplateLiteral(expression)
  );
}

function unstableControlConditional(
  node: ts.JsxOpeningLikeElement,
  bindings: SourceBindings,
): ts.ConditionalExpression | ts.BinaryExpression | null {
  const ownElement =
    ts.isJsxOpeningElement(node) && ts.isJsxElement(node.parent) ? node.parent : null;
  let child: ts.Node = node;
  for (let current = node.parent; current; current = current.parent) {
    if (ts.isFunctionLike(current)) return null;
    if (current !== ownElement && ts.isJsxElement(current)) {
      const name = canonicalJsxName(current.openingElement.tagName, bindings);
      if (name && EAGER_CONTROL_CONCEPTS.has(name)) return null;
    }
    if (
      ts.isConditionalExpression(current) &&
      (current.whenTrue === child || current.whenFalse === child) &&
      !isConstantCondition(current.condition)
    ) {
      return current;
    }
    if (
      ts.isBinaryExpression(current) &&
      [ts.SyntaxKind.AmpersandAmpersandToken, ts.SyntaxKind.BarBarToken].includes(
        current.operatorToken.kind,
      ) &&
      current.right === child &&
      !isConstantCondition(current.left)
    ) {
      return current;
    }
    child = current;
  }
  return null;
}

const stableRenderRule: AnalyzeRule = {
  id: "askr/stable-render-call",
  category: "correctness",
  severity: "error",
  description: "Render-scoped Askr primitives must have stable top-level call order.",
  analyze(context) {
    const diagnostics: AnalyzeDiagnostic[] = [];
    const wrapperSummary = summarizeTransitiveCalls(
      context,
      (call) => {
        if (!ts.isCallExpression(call)) return null;
        const name = canonicalCallName(call.expression, sourceBindings(call.getSourceFile()));
        return name && (RENDER_SCOPED_CONCEPTS.has(name) || POSITIONAL_DATA_CONCEPTS.has(name))
          ? {
              value: name,
              unstable: Boolean(
                containingFunction(call) && isControlFlowAncestor(call, containingFunction(call)!),
              ),
            }
          : null;
      },
      isControlFlowAncestor,
    );
    for (const sourceFile of context.sourceFiles) {
      const bindings = sourceBindings(sourceFile);
      visit(sourceFile, (node) => {
        if (!ts.isCallExpression(node)) return;
        const name = canonicalCallName(node.expression, bindings);
        if (!name || (!RENDER_SCOPED_CONCEPTS.has(name) && !POSITIONAL_DATA_CONCEPTS.has(name))) {
          const summary = wrapperSummary.forCall(node);
          const owner = containingFunction(node);
          if (
            !summary ||
            summary.values.size === 0 ||
            !owner ||
            (!/^[A-Z]/.test(functionName(owner) ?? "") && !containsJsx(owner)) ||
            (!isControlFlowAncestor(node, owner) && summary.unstableValues.size === 0)
          ) {
            return;
          }
          const concepts = [...summary.values].sort().join(", ");
          diagnostics.push(
            diagnostic(
              context,
              node.expression,
              this,
              `${node.expression.getText()}() is called conditionally and transitively calls render-owned Askr APIs (${concepts}).`,
              "Call the wrapper unconditionally at the top level and branch on its result or inputs.",
            ),
          );
          return;
        }
        const owner = containingFunction(node);
        if (!owner) {
          if (POSITIONAL_DATA_CONCEPTS.has(name)) return;
          diagnostics.push(
            diagnostic(
              context,
              node.expression,
              this,
              `${name}() is render-scoped and cannot be called at module scope.`,
              `Move ${name}() to the top level of an Askr component.`,
            ),
          );
          return;
        }
        if (
          isControlFlowAncestor(node, owner) &&
          (!POSITIONAL_DATA_CONCEPTS.has(name) ||
            /^[A-Z]/.test(functionName(owner) ?? "") ||
            containsJsx(owner))
        ) {
          diagnostics.push(
            diagnostic(
              context,
              node.expression,
              this,
              `${name}() is called conditionally, so its render position is unstable.`,
              `Call ${name}() unconditionally at the top level and branch on its result.`,
            ),
          );
        }
      });
      visit(sourceFile, (node) => {
        if (!ts.isJsxOpeningElement(node) && !ts.isJsxSelfClosingElement(node)) return;
        const name = canonicalJsxName(node.tagName, bindings);
        if (!name || !EAGER_CONTROL_CONCEPTS.has(name)) return;
        const conditional = unstableControlConditional(node, bindings);
        const owner = containingFunction(node);
        const followsEarlyReturn = Boolean(owner && hasConditionalEarlyExitBefore(node, owner));
        if (!conditional && !followsEarlyReturn) return;
        const remediation = followsEarlyReturn
          ? name === "For"
            ? "Keep <For> mounted and represent the unavailable case with an empty each source."
            : name === "Show"
              ? "Keep <Show> mounted and move the condition into its when prop."
              : "Keep <Case> mounted and express the condition in its branches."
          : name === "Show"
            ? "Mount <Show> unconditionally and move the condition into its when prop."
            : "Replace the ternary or logical expression with a <Show> boundary.";
        diagnostics.push(
          diagnostic(
            context,
            node.tagName,
            this,
            followsEarlyReturn
              ? `<${name}> is reached after a conditional early return, so its render position is unstable.`
              : `<${name}> is mounted behind a changing conditional, so its render position is unstable.`,
            remediation,
          ),
        );
      });
    }
    return diagnostics;
  },
};

type RenderSideEffect = "listener" | "observer" | "subscription" | "timer";

const TIMER_STARTS = new Set(["requestAnimationFrame", "setInterval", "setTimeout"]);
const OBSERVER_CONSTRUCTORS = new Set([
  "IntersectionObserver",
  "MutationObserver",
  "ResizeObserver",
]);
const SUBSCRIPTION_CONSTRUCTORS = new Set(["BroadcastChannel", "EventSource", "WebSocket"]);
const PLATFORM_EVENT_TARGET_TYPES =
  /^(?:AbortSignal|Document|EventTarget|HTMLElement|MediaQueryList|Window)(?:<.*>)?$/;
const PROJECT_SOURCE_FILES = new WeakMap<ts.Program, ReadonlySet<ts.SourceFile>>();
const CLEANUP_CALLS = new WeakMap<ts.SignatureDeclaration, readonly ts.CallExpression[]>();

function projectDeclaredIdentifier(
  identifier: ts.Identifier,
  context: WorkspaceAnalysisContext,
): boolean {
  let symbol = context.checker.getSymbolAtLocation(identifier);
  if (symbol && (symbol.flags & ts.SymbolFlags.Alias) !== 0) {
    symbol = context.checker.getAliasedSymbol(symbol);
  }
  let sourceFiles = PROJECT_SOURCE_FILES.get(context.program);
  if (!sourceFiles) {
    sourceFiles = new Set(context.sourceFiles);
    PROJECT_SOURCE_FILES.set(context.program, sourceFiles);
  }
  return (
    symbol?.declarations?.some((declaration) => sourceFiles.has(declaration.getSourceFile())) ??
    false
  );
}

function knownGlobalObject(expression: ts.Expression, context: WorkspaceAnalysisContext): boolean {
  return (
    ts.isIdentifier(expression) &&
    ["document", "globalThis", "window"].includes(expression.text) &&
    !projectDeclaredIdentifier(expression, context)
  );
}

function typedPlatformEventTarget(
  expression: ts.Expression,
  context: WorkspaceAnalysisContext,
): boolean {
  if (knownGlobalObject(expression, context)) return true;
  if (!ts.isIdentifier(expression)) return false;
  const symbol = context.checker.getSymbolAtLocation(expression);
  return Boolean(
    symbol?.declarations?.some((declaration) => {
      if (
        !ts.isVariableDeclaration(declaration) &&
        !ts.isParameter(declaration) &&
        !ts.isPropertyDeclaration(declaration)
      ) {
        return false;
      }
      return Boolean(
        declaration.type && PLATFORM_EVENT_TARGET_TYPES.test(declaration.type.getText()),
      );
    }),
  );
}

function directGlobalCall(
  call: ts.CallExpression,
  names: ReadonlySet<string>,
  context: WorkspaceAnalysisContext,
): string | null {
  if (
    ts.isIdentifier(call.expression) &&
    names.has(call.expression.text) &&
    !projectDeclaredIdentifier(call.expression, context)
  ) {
    return call.expression.text;
  }
  if (
    ts.isPropertyAccessExpression(call.expression) &&
    names.has(call.expression.name.text) &&
    knownGlobalObject(call.expression.expression, context)
  ) {
    return call.expression.name.text;
  }
  return null;
}

function platformConstructorName(
  expression: ts.LeftHandSideExpression,
  context: WorkspaceAnalysisContext,
): string | null {
  if (ts.isIdentifier(expression) && !projectDeclaredIdentifier(expression, context)) {
    return expression.text;
  }
  if (
    ts.isPropertyAccessExpression(expression) &&
    knownGlobalObject(expression.expression, context)
  ) {
    return expression.name.text;
  }
  return null;
}

function renderSideEffect(
  node: ts.CallExpression | ts.NewExpression,
  context: WorkspaceAnalysisContext,
): RenderSideEffect | null {
  if (ts.isNewExpression(node)) {
    const name = platformConstructorName(node.expression, context);
    if (name && OBSERVER_CONSTRUCTORS.has(name)) return "observer";
    if (name && SUBSCRIPTION_CONSTRUCTORS.has(name)) return "subscription";
    return null;
  }
  if (directGlobalCall(node, TIMER_STARTS, context)) return "timer";
  if (
    ts.isPropertyAccessExpression(node.expression) &&
    node.expression.name.text === "addEventListener" &&
    typedPlatformEventTarget(node.expression.expression, context)
  ) {
    return "listener";
  }
  if (
    ts.isPropertyAccessExpression(node.expression) &&
    node.expression.name.text === "watchPosition" &&
    ts.isPropertyAccessExpression(node.expression.expression) &&
    node.expression.expression.name.text === "geolocation" &&
    ts.isIdentifier(node.expression.expression.expression) &&
    node.expression.expression.expression.text === "navigator" &&
    !projectDeclaredIdentifier(node.expression.expression.expression, context)
  ) {
    return "subscription";
  }
  return null;
}

function terminalCleanupFunction(
  callback: ts.SignatureDeclaration,
  context: WorkspaceAnalysisContext,
): ts.SignatureDeclaration | null {
  if (!("body" in callback) || !callback.body) return null;
  let returned: ts.Expression | undefined;
  if (ts.isArrowFunction(callback) && !ts.isBlock(callback.body)) {
    returned = callback.body;
  } else if (ts.isBlock(callback.body)) {
    const last = callback.body.statements.at(-1);
    if (last && ts.isReturnStatement(last)) returned = last.expression;
  }
  return resolvedFunction(returned, context);
}

function cleanupCalls(
  callback: ts.SignatureDeclaration,
  context: WorkspaceAnalysisContext,
): readonly ts.CallExpression[] {
  const cached = CLEANUP_CALLS.get(callback);
  if (cached) return cached;
  const cleanup = terminalCleanupFunction(callback, context);
  if (!cleanup) {
    CLEANUP_CALLS.set(callback, []);
    return [];
  }
  const calls: ts.CallExpression[] = [];
  const walk = (node: ts.Node): void => {
    if (node !== cleanup && ts.isFunctionLike(node)) return;
    if (ts.isCallExpression(node)) calls.push(node);
    ts.forEachChild(node, walk);
  };
  walk(cleanup);
  CLEANUP_CALLS.set(callback, calls);
  return calls;
}

function assignedEffectReference(node: ts.CallExpression | ts.NewExpression): ts.Expression | null {
  const parent = node.parent;
  if (ts.isVariableDeclaration(parent) && parent.initializer === node) {
    return ts.isIdentifier(parent.name) ? parent.name : null;
  }
  if (
    ts.isBinaryExpression(parent) &&
    parent.right === node &&
    parent.operatorToken.kind === ts.SyntaxKind.EqualsToken
  ) {
    return parent.left;
  }
  return null;
}

function sameReference(
  left: ts.Expression | undefined,
  right: ts.Expression | undefined,
  context: WorkspaceAnalysisContext,
): boolean {
  if (!left || !right) return false;
  let leftSymbol = context.checker.getSymbolAtLocation(left);
  let rightSymbol = context.checker.getSymbolAtLocation(right);
  if (leftSymbol && (leftSymbol.flags & ts.SymbolFlags.Alias) !== 0) {
    leftSymbol = context.checker.getAliasedSymbol(leftSymbol);
  }
  if (rightSymbol && (rightSymbol.flags & ts.SymbolFlags.Alias) !== 0) {
    rightSymbol = context.checker.getAliasedSymbol(rightSymbol);
  }
  return leftSymbol && rightSymbol
    ? leftSymbol === rightSymbol
    : left.getText() === right.getText();
}

function taskCleansDirectEffect(
  callback: ts.SignatureDeclaration,
  node: ts.CallExpression | ts.NewExpression,
  effect: RenderSideEffect,
  context: WorkspaceAnalysisContext,
): boolean {
  const cleanup = cleanupCalls(callback, context);
  if (effect === "listener" && ts.isCallExpression(node)) {
    if (
      !ts.isPropertyAccessExpression(node.expression) ||
      node.expression.name.text !== "addEventListener"
    ) {
      return false;
    }
    const startExpression = node.expression;
    return cleanup.some(
      (call) =>
        ts.isPropertyAccessExpression(call.expression) &&
        call.expression.name.text === "removeEventListener" &&
        sameReference(call.expression.expression, startExpression.expression, context) &&
        sameReference(call.arguments[0], node.arguments[0], context) &&
        sameReference(call.arguments[1], node.arguments[1], context) &&
        (node.arguments[2] === undefined ||
          sameReference(call.arguments[2], node.arguments[2], context)),
    );
  }

  const handle = assignedEffectReference(node);
  if (!handle) return false;
  if (effect === "timer" && ts.isCallExpression(node)) {
    const start = directGlobalCall(node, TIMER_STARTS, context);
    const expected =
      start === "setInterval"
        ? "clearInterval"
        : start === "setTimeout"
          ? "clearTimeout"
          : start === "requestAnimationFrame"
            ? "cancelAnimationFrame"
            : null;
    const expectedSet = expected ? new Set([expected]) : new Set<string>();
    return cleanup.some(
      (call) =>
        Boolean(directGlobalCall(call, expectedSet, context)) &&
        sameReference(call.arguments[0], handle, context),
    );
  }
  if (effect === "observer") {
    return cleanup.some(
      (call) =>
        ts.isPropertyAccessExpression(call.expression) &&
        call.expression.name.text === "disconnect" &&
        sameReference(call.expression.expression, handle, context),
    );
  }
  if (effect === "subscription") {
    return cleanup.some((call) => {
      if (
        ts.isPropertyAccessExpression(call.expression) &&
        (call.expression.name.text === "close" || call.expression.name.text === "unsubscribe") &&
        sameReference(call.expression.expression, handle, context)
      ) {
        return true;
      }
      return (
        ts.isCallExpression(node) &&
        ts.isPropertyAccessExpression(call.expression) &&
        call.expression.name.text === "clearWatch" &&
        ts.isPropertyAccessExpression(call.expression.expression) &&
        call.expression.expression.name.text === "geolocation" &&
        ts.isIdentifier(call.expression.expression.expression) &&
        call.expression.expression.expression.text === "navigator" &&
        !projectDeclaredIdentifier(call.expression.expression.expression, context) &&
        sameReference(call.arguments[0], handle, context)
      );
    });
  }
  return false;
}

function isRenderFunction(owner: ts.SignatureDeclaration): boolean {
  return /^[A-Z]/.test(functionName(owner) ?? "") || containsJsx(owner);
}

const renderSideEffectRule: AnalyzeRule = {
  id: "askr/render-side-effect",
  category: "correctness",
  severity: "error",
  description: "Platform side effects started during render require lifecycle-owned cleanup.",
  analyze(context) {
    const diagnostics: AnalyzeDiagnostic[] = [];
    const graph = localCallGraph(context);
    const summary = summarizeTransitiveCalls<RenderSideEffect>(
      context,
      (node) => {
        const effect = renderSideEffect(node, context);
        return effect ? { value: effect } : null;
      },
      () => false,
    );
    const lifecycleCallbacks = new Set<ts.SignatureDeclaration>();
    for (const site of graph.calls) {
      const name = canonicalCallName(
        site.node.expression,
        sourceBindings(site.node.getSourceFile()),
      );
      if (name !== "task") continue;
      const argument = site.node.arguments[0];
      const callback =
        resolvedFunction(argument, context) ??
        (argument ? graph.functionForExpression(argument) : null);
      if (callback) lifecycleCallbacks.add(callback);
    }

    const report = (
      node: ts.CallExpression | ts.NewExpression,
      effects: ReadonlySet<RenderSideEffect>,
      direct = false,
    ): void => {
      const owner = containingFunction(node);
      if (!owner) return;
      const managed = lifecycleCallbacks.has(owner);
      if (
        managed &&
        direct &&
        [...effects].every((effect) => taskCleansDirectEffect(owner, node, effect, context))
      ) {
        return;
      }
      if (!managed && !isRenderFunction(owner)) return;
      const effectNames = [...effects].sort().join(", ");
      diagnostics.push(
        diagnostic(
          context,
          node.expression,
          this,
          managed
            ? `This task starts ${effectNames} side effects without returning matching cleanup.`
            : `${node.expression.getText()} starts unmanaged ${effectNames} side effects during render.`,
          "Start the effect in task() and return cleanup that clears, disconnects, removes, closes, or unsubscribes it.",
        ),
      );
    };

    for (const site of graph.calls) {
      const direct = renderSideEffect(site.node, context);
      if (direct) {
        report(site.node, new Set([direct]), true);
        continue;
      }
      const wrapper = summary.forCall(site.node);
      if (wrapper && wrapper.values.size > 0) report(site.node, wrapper.values);
    }
    for (const site of graph.constructions) {
      const direct = renderSideEffect(site.node, context);
      if (direct) report(site.node, new Set([direct]), true);
    }
    return diagnostics;
  },
};

interface StateBindings {
  readonly getters: Set<string>;
  readonly setters: Set<string>;
  readonly owners: Map<string, ts.SignatureDeclaration | null>;
}

function collectStateBindings(sourceFile: ts.SourceFile, bindings: SourceBindings): StateBindings {
  const getters = new Set<string>();
  const setters = new Set<string>();
  const owners = new Map<string, ts.SignatureDeclaration | null>();
  visit(sourceFile, (node) => {
    if (
      !ts.isVariableDeclaration(node) ||
      !node.initializer ||
      !ts.isCallExpression(node.initializer) ||
      canonicalCallName(node.initializer.expression, bindings) !== "state"
    ) {
      return;
    }
    const owner = containingFunction(node);
    if (ts.isIdentifier(node.name)) {
      getters.add(node.name.text);
      owners.set(node.name.text, owner);
    }
    if (ts.isArrayBindingPattern(node.name)) {
      const [getter, setter] = node.name.elements;
      if (getter && ts.isBindingElement(getter) && ts.isIdentifier(getter.name)) {
        getters.add(getter.name.text);
        owners.set(getter.name.text, owner);
      }
      if (setter && ts.isBindingElement(setter) && ts.isIdentifier(setter.name)) {
        setters.add(setter.name.text);
        owners.set(setter.name.text, owner);
      }
    }
  });
  return { getters, setters, owners };
}

function identifierIsReadAsValue(node: ts.Identifier): boolean {
  const parent = node.parent;
  if (ts.isCallExpression(parent) && parent.expression === node) return false;
  if (ts.isPropertyAccessExpression(parent) && parent.expression === node) return false;
  if (ts.isVariableDeclaration(parent) && parent.name === node) return false;
  if (ts.isBindingElement(parent) && parent.name === node) return false;
  if (ts.isImportSpecifier(parent) || ts.isImportClause(parent) || ts.isNamespaceImport(parent)) {
    return false;
  }
  if (ts.isJsxExpression(parent)) return !ts.isJsxAttribute(parent.parent);
  return ts.isReturnStatement(parent);
}

const stateAccessRule: AnalyzeRule = {
  id: "askr/state-access",
  category: "correctness",
  severity: "error",
  description: "State getters must be called and state setters require a value or updater.",
  analyze(context) {
    const diagnostics: AnalyzeDiagnostic[] = [];
    for (const sourceFile of context.sourceFiles) {
      const bindings = sourceBindings(sourceFile);
      const state = collectStateBindings(sourceFile, bindings);
      visit(sourceFile, (node) => {
        if (
          ts.isCallExpression(node) &&
          ts.isIdentifier(node.expression) &&
          state.setters.has(node.expression.text) &&
          node.arguments.length === 0
        ) {
          diagnostics.push(
            diagnostic(
              context,
              node.expression,
              this,
              `State setter '${node.expression.text}' is called without a value or updater.`,
              "Pass the next value or a functional updater.",
            ),
          );
        } else if (
          ts.isIdentifier(node) &&
          state.getters.has(node.text) &&
          identifierIsReadAsValue(node)
        ) {
          diagnostics.push(
            diagnostic(
              context,
              node,
              this,
              `State getter '${node.text}' is used as a value instead of being called.`,
              `Read it with ${node.text}().`,
            ),
          );
        }
      });
    }
    return diagnostics;
  },
};

const stateRenderWriteRule: AnalyzeRule = {
  id: "askr/state-render-write",
  category: "correctness",
  severity: "error",
  description: "State must not be mutated during component render.",
  analyze(context) {
    const diagnostics: AnalyzeDiagnostic[] = [];
    for (const sourceFile of context.sourceFiles) {
      const bindings = sourceBindings(sourceFile);
      const state = collectStateBindings(sourceFile, bindings);
      visit(sourceFile, (node) => {
        if (!ts.isCallExpression(node)) return;
        let cellName: string | null = null;
        if (ts.isIdentifier(node.expression) && state.setters.has(node.expression.text)) {
          cellName = node.expression.text;
        } else if (
          ts.isPropertyAccessExpression(node.expression) &&
          node.expression.name.text === "set" &&
          ts.isIdentifier(node.expression.expression) &&
          state.getters.has(node.expression.expression.text)
        ) {
          cellName = node.expression.expression.text;
        }
        if (!cellName) return;
        const declarationOwner = state.owners.get(cellName);
        if (!declarationOwner || containingFunction(node) !== declarationOwner) return;
        diagnostics.push(
          diagnostic(
            context,
            node.expression,
            this,
            `State '${cellName}' is mutated during component render.`,
            "Move the update to an event handler, task, or other post-render operation.",
          ),
        );
      });
    }
    return diagnostics;
  },
};

function functionBodyText(node: ts.Expression): string {
  return ts.isArrowFunction(node) || ts.isFunctionExpression(node) ? node.body.getText() : "";
}

const resourceCancellationRule: AnalyzeRule = {
  id: "askr/resource-cancellation",
  category: "correctness",
  severity: "warning",
  description: "Resource loaders should forward their AbortSignal to cancellable requests.",
  analyze(context) {
    const diagnostics: AnalyzeDiagnostic[] = [];
    for (const sourceFile of context.sourceFiles) {
      const bindings = sourceBindings(sourceFile);
      visit(sourceFile, (node) => {
        if (
          !ts.isCallExpression(node) ||
          canonicalCallName(node.expression, bindings) !== "resource"
        ) {
          return;
        }
        const loader = node.arguments[0];
        if (!loader || (!ts.isArrowFunction(loader) && !ts.isFunctionExpression(loader))) {
          diagnostics.push(
            diagnostic(
              context,
              node.expression,
              this,
              "resource() requires a loader function.",
              "Pass a loader that accepts { signal } and returns the resource value.",
            ),
          );
          return;
        }
        const text = functionBodyText(loader);
        if (!/\bfetch\s*\(/.test(text)) return;
        const firstParameter = loader.parameters[0];
        const parameterText = firstParameter?.name.getText() ?? "";
        const signalName =
          firstParameter && ts.isObjectBindingPattern(firstParameter.name)
            ? firstParameter.name.elements
                .find(
                  (element) =>
                    (element.propertyName && element.propertyName.getText() === "signal") ||
                    element.name.getText() === "signal",
                )
                ?.name.getText()
            : parameterText
              ? `${parameterText}.signal`
              : null;
        if (!signalName || !text.includes(signalName)) {
          diagnostics.push(
            diagnostic(
              context,
              loader,
              this,
              "This resource loader calls fetch() without forwarding its AbortSignal.",
              "Accept { signal } and pass signal in the fetch options.",
            ),
          );
        }
      });
    }
    return diagnostics;
  },
};

function hasUnstableDependency(deps: ts.Expression): boolean {
  if (!ts.isArrayLiteralExpression(deps)) return true;
  return deps.elements.some(
    (element) =>
      ts.isObjectLiteralExpression(element) ||
      ts.isArrayLiteralExpression(element) ||
      ts.isArrowFunction(element) ||
      ts.isFunctionExpression(element) ||
      ts.isNewExpression(element),
  );
}

const stableDependenciesRule: AnalyzeRule = {
  id: "askr/stable-dependencies",
  category: "performance",
  severity: "warning",
  description: "Resource dependency entries should have stable identity.",
  analyze(context) {
    const diagnostics: AnalyzeDiagnostic[] = [];
    for (const sourceFile of context.sourceFiles) {
      const bindings = sourceBindings(sourceFile);
      visit(sourceFile, (node) => {
        if (!ts.isCallExpression(node)) return;
        const name = canonicalCallName(node.expression, bindings);
        let deps: ts.Expression | undefined;
        if (name === "resource") {
          deps = node.arguments[1];
        } else if (name === "stream") {
          const options = node.arguments[1];
          if (options && ts.isObjectLiteralExpression(options)) {
            deps = propertyInitializer(objectProperty(options, "deps"));
          }
        }
        if (!deps || !hasUnstableDependency(deps)) return;
        diagnostics.push(
          diagnostic(
            context,
            deps,
            this,
            `${name}() dependencies contain a render-time allocation with unstable identity.`,
            "Depend on primitive values or stable references.",
          ),
        );
      });
    }
    return diagnostics;
  },
};

function jsxAttributes(node: ts.JsxOpeningLikeElement): Map<string, ts.JsxAttributeLike> {
  return new Map(
    node.attributes.properties.flatMap((attribute) =>
      ts.isJsxAttribute(attribute) && ts.isIdentifier(attribute.name)
        ? [[attribute.name.text, attribute] as const]
        : [],
    ),
  );
}

const forContractRule: AnalyzeRule = {
  id: "askr/for-contract",
  category: "correctness",
  severity: "error",
  description: "For requires an each source and exactly one explicit key strategy.",
  analyze(context) {
    const diagnostics: AnalyzeDiagnostic[] = [];
    for (const sourceFile of context.sourceFiles) {
      const bindings = sourceBindings(sourceFile);
      visit(sourceFile, (node) => {
        if (!ts.isJsxOpeningElement(node) && !ts.isJsxSelfClosingElement(node)) {
          return;
        }
        if (canonicalJsxName(node.tagName, bindings) !== "For") return;
        const attributes = jsxAttributes(node);
        if (!attributes.has("each")) {
          diagnostics.push(
            diagnostic(
              context,
              node.tagName,
              this,
              "<For> is missing its required each source.",
              "Pass an array or accessor with each={...}.",
            ),
          );
        }
        const by = attributes.get("by");
        const byIndex = attributes.get("byIndex");
        if (!by && !byIndex) {
          diagnostics.push(
            diagnostic(
              context,
              node.tagName,
              this,
              "<For> requires a stable by function or explicit byIndex.",
              "Prefer by={(item) => item.id}; use byIndex only for positional lists.",
            ),
          );
        } else if (by && byIndex) {
          diagnostics.push(
            diagnostic(
              context,
              byIndex,
              this,
              "<For> accepts either by or byIndex, not both.",
              "Remove one key strategy.",
            ),
          );
        }
        const element =
          ts.isJsxOpeningElement(node) && ts.isJsxElement(node.parent) ? node.parent : null;
        if (
          ts.isJsxSelfClosingElement(node) ||
          (element &&
            element.children.every(
              (child) => ts.isJsxText(child) && child.text.trim().length === 0,
            ))
        ) {
          diagnostics.push(
            diagnostic(
              context,
              node.tagName,
              this,
              "<For> is missing its item renderer child.",
              "Provide a function child such as {(item) => <Row item={item} />}.",
            ),
          );
        }
      });
    }
    return diagnostics;
  },
};

const controlContractRule: AnalyzeRule = {
  id: "askr/control-contract",
  category: "correctness",
  severity: "error",
  description: "Show, Case, and Match must satisfy their structural JSX contracts.",
  analyze(context) {
    const diagnostics: AnalyzeDiagnostic[] = [];
    for (const sourceFile of context.sourceFiles) {
      const bindings = sourceBindings(sourceFile);
      visit(sourceFile, (node) => {
        if (!ts.isJsxOpeningElement(node) && !ts.isJsxSelfClosingElement(node)) return;
        const name = canonicalJsxName(node.tagName, bindings);
        if (name !== "Show" && name !== "Match" && name !== "Case") return;
        const attributes = jsxAttributes(node);
        if ((name === "Show" || name === "Match") && !attributes.has("when")) {
          diagnostics.push(
            diagnostic(
              context,
              node.tagName,
              this,
              `<${name}> is missing its required when condition.`,
              "Pass a value or reactive accessor with when={...}.",
            ),
          );
        }
        if (name === "Match") {
          const ownElement =
            ts.isJsxOpeningElement(node) && ts.isJsxElement(node.parent) ? node.parent : node;
          const parentElement = ownElement.parent;
          const parentOpening = ts.isJsxElement(parentElement)
            ? parentElement.openingElement
            : null;
          if (!parentOpening || canonicalJsxName(parentOpening.tagName, bindings) !== "Case") {
            diagnostics.push(
              diagnostic(
                context,
                node.tagName,
                this,
                "<Match> may only be used as a direct child of <Case>.",
                "Move this branch directly inside a <Case> boundary.",
              ),
            );
          }
        }
      });
    }
    return diagnostics;
  },
};

const stableKeyRule: AnalyzeRule = {
  id: "askr/stable-key",
  category: "performance",
  severity: "warning",
  description: "Dynamic lists should use stable data keys instead of positions.",
  analyze(context) {
    const diagnostics: AnalyzeDiagnostic[] = [];
    for (const sourceFile of context.sourceFiles) {
      const bindings = sourceBindings(sourceFile);
      visit(sourceFile, (node) => {
        if (!ts.isJsxOpeningElement(node) && !ts.isJsxSelfClosingElement(node)) return;
        if (canonicalJsxName(node.tagName, bindings) !== "For") return;
        const by = jsxAttributes(node).get("by");
        if (
          !by ||
          !ts.isJsxAttribute(by) ||
          !by.initializer ||
          !ts.isJsxExpression(by.initializer)
        ) {
          return;
        }
        const expression = by.initializer.expression;
        if (
          !expression ||
          (!ts.isArrowFunction(expression) && !ts.isFunctionExpression(expression))
        ) {
          return;
        }
        const indexName = expression.parameters[1]?.name.getText();
        const bodyText = expression.body.getText();
        if (indexName && bodyText === indexName) {
          diagnostics.push(
            diagnostic(
              context,
              expression.body,
              this,
              "<For> uses its item index as a key, which is unstable across insertions.",
              "Use a stable identifier from the item, or spell byIndex explicitly for a positional list.",
            ),
          );
        }
      });
    }
    return diagnostics;
  },
};

function mapResultIsJsxChild(node: ts.CallExpression): boolean {
  let current: ts.Expression = node;
  for (;;) {
    const parent = current.parent;
    if (ts.isJsxExpression(parent)) return !ts.isJsxAttribute(parent.parent);
    if (
      (ts.isParenthesizedExpression(parent) ||
        ts.isAsExpression(parent) ||
        ts.isTypeAssertionExpression(parent) ||
        ts.isNonNullExpression(parent) ||
        ts.isSatisfiesExpression(parent)) &&
      parent.expression === current
    ) {
      current = parent;
      continue;
    }
    if (
      ts.isConditionalExpression(parent) &&
      (parent.whenTrue === current || parent.whenFalse === current)
    ) {
      current = parent;
      continue;
    }
    if (
      ts.isBinaryExpression(parent) &&
      ((parent.operatorToken.kind === ts.SyntaxKind.AmpersandAmpersandToken &&
        parent.right === current) ||
        (parent.operatorToken.kind === ts.SyntaxKind.BarBarToken &&
          (parent.left === current || parent.right === current)) ||
        (parent.operatorToken.kind === ts.SyntaxKind.QuestionQuestionToken &&
          (parent.left === current || parent.right === current)))
    ) {
      current = parent;
      continue;
    }
    return false;
  }
}

const preferForRule: AnalyzeRule = {
  id: "askr/prefer-for",
  category: "performance",
  severity: "warning",
  description: "Collection arrays rendered as JSX children should use For.",
  analyze(context) {
    const diagnostics: AnalyzeDiagnostic[] = [];
    for (const sourceFile of context.sourceFiles) {
      visit(sourceFile, (node) => {
        if (
          !ts.isCallExpression(node) ||
          !ts.isPropertyAccessExpression(node.expression) ||
          node.expression.name.text !== "map" ||
          !mapResultIsJsxChild(node)
        ) {
          return;
        }
        diagnostics.push(
          diagnostic(
            context,
            node.expression.name,
            this,
            "A collection array is rendered with .map(), bypassing keyed <For> reconciliation.",
            "Render it with <For each={...} by={...}>. This semantic rewrite is report-only.",
          ),
        );
      });
    }
    return diagnostics;
  },
};

const CONTAINS_JSX = new WeakMap<ts.Node, boolean>();

function containsJsx(node: ts.Node): boolean {
  const cached = CONTAINS_JSX.get(node);
  if (cached !== undefined) return cached;
  let found = false;
  const walk = (candidate: ts.Node): void => {
    if (found) return;
    if (ts.isJsxElement(candidate) || ts.isJsxSelfClosingElement(candidate)) {
      found = true;
      return;
    }
    ts.forEachChild(candidate, walk);
  };
  walk(node);
  CONTAINS_JSX.set(node, found);
  return found;
}

function isAsyncFunction(node: ts.SignatureDeclaration): boolean {
  return (
    (ts.canHaveModifiers(node) ? ts.getModifiers(node) : undefined)?.some(
      (modifier) => modifier.kind === ts.SyntaxKind.AsyncKeyword,
    ) ?? false
  );
}

function resolvedFunction(
  expression: ts.Expression | undefined,
  context: WorkspaceAnalysisContext,
): ts.SignatureDeclaration | null {
  if (!expression) return null;
  if (
    ts.isArrowFunction(expression) ||
    ts.isFunctionExpression(expression) ||
    ts.isFunctionDeclaration(expression)
  ) {
    return expression;
  }
  if (!ts.isIdentifier(expression)) return null;
  let symbol = context.checker.getSymbolAtLocation(expression);
  if (symbol && (symbol.flags & ts.SymbolFlags.Alias) !== 0) {
    symbol = context.checker.getAliasedSymbol(symbol);
  }
  const declaration = symbol?.valueDeclaration ?? symbol?.declarations?.[0];
  if (declaration && ts.isFunctionDeclaration(declaration)) return declaration;
  if (
    declaration &&
    ts.isVariableDeclaration(declaration) &&
    declaration.initializer &&
    (ts.isArrowFunction(declaration.initializer) ||
      ts.isFunctionExpression(declaration.initializer))
  ) {
    return declaration.initializer;
  }
  return null;
}

const asyncComponentRule: AnalyzeRule = {
  id: "askr/no-async-component",
  category: "correctness",
  severity: "error",
  description: "Askr components render synchronously.",
  analyze(context) {
    const diagnostics: AnalyzeDiagnostic[] = [];
    for (const sourceFile of context.sourceFiles) {
      const bindings = sourceBindings(sourceFile);
      visit(sourceFile, (node) => {
        let name: ts.Identifier | undefined;
        let asyncToken = false;
        if (ts.isFunctionDeclaration(node)) {
          name = node.name;
          asyncToken =
            node.modifiers?.some((modifier) => modifier.kind === ts.SyntaxKind.AsyncKeyword) ??
            false;
        } else if (
          ts.isVariableDeclaration(node) &&
          ts.isIdentifier(node.name) &&
          node.initializer &&
          (ts.isArrowFunction(node.initializer) || ts.isFunctionExpression(node.initializer))
        ) {
          name = node.name;
          asyncToken =
            node.initializer.modifiers?.some(
              (modifier) => modifier.kind === ts.SyntaxKind.AsyncKeyword,
            ) ?? false;
        }
        if (!name || !asyncToken || !/^[A-Z]/.test(name.text) || !containsJsx(node)) return;
        diagnostics.push(
          diagnostic(
            context,
            name,
            this,
            `Component '${name.text}' is async, but Askr components must return synchronously.`,
            "Load data with resource(), route data, or server prefetching.",
          ),
        );
      });
      visit(sourceFile, (node) => {
        if (!ts.isCallExpression(node)) return;
        const name = canonicalCallName(node.expression, bindings);
        const componentIndex =
          name === "route" || name === "page"
            ? 1
            : name === "index" || name === "fallback"
              ? 0
              : -1;
        if (componentIndex < 0) return;
        const component = resolvedFunction(node.arguments[componentIndex], context);
        if (!component || !isAsyncFunction(component)) return;
        diagnostics.push(
          diagnostic(
            context,
            node.arguments[componentIndex],
            this,
            `Route component passed to ${name}() is async.`,
            "Keep the component synchronous and use route data, lazy(), or resource() for async work.",
          ),
        );
      });
    }
    return diagnostics;
  },
};

function routeRegistrationAncestor(
  node: ts.Node,
  definitions: ReadonlySet<ts.SignatureDeclaration>,
): boolean {
  for (let current = node.parent; current; current = current.parent) {
    if (ts.isFunctionLike(current) && definitions.has(current)) return true;
  }
  return false;
}

const routeRegistryRule: AnalyzeRule = {
  id: "askr/route-registry",
  category: "correctness",
  severity: "error",
  description: "Route DSL calls must be synchronous and owned by a route registry.",
  analyze(context) {
    const diagnostics: AnalyzeDiagnostic[] = [];
    const routeCalls = new Set(["route", "page", "index", "group", "fallback"]);
    const definitions = new Set<ts.SignatureDeclaration>();
    for (const sourceFile of context.sourceFiles) {
      const bindings = sourceBindings(sourceFile);
      visit(sourceFile, (node) => {
        if (
          ts.isCallExpression(node) &&
          canonicalCallName(node.expression, bindings) === "createRouteRegistry"
        ) {
          const definition = resolvedFunction(node.arguments[0], context);
          if (definition) definitions.add(definition);
        }
      });
    }
    for (const definition of definitions) {
      ts.forEachChild(definition, function walk(node) {
        if (ts.isCallExpression(node)) {
          const called = resolvedFunction(node.expression, context);
          if (called) definitions.add(called);
        }
        ts.forEachChild(node, walk);
      });
    }
    for (const sourceFile of context.sourceFiles) {
      const bindings = sourceBindings(sourceFile);
      visit(sourceFile, (node) => {
        if (!ts.isCallExpression(node)) return;
        const name = canonicalCallName(node.expression, bindings);
        if (name === "createRouteRegistry") {
          const definition = node.arguments[0];
          const resolved = resolvedFunction(definition, context);
          if (!resolved) {
            diagnostics.push(
              diagnostic(
                context,
                node.expression,
                this,
                "createRouteRegistry() requires a synchronous definition callback.",
                "Pass () => { ...route declarations... }.",
              ),
            );
          } else if (isAsyncFunction(resolved)) {
            diagnostics.push(
              diagnostic(
                context,
                definition ?? node.expression,
                this,
                "createRouteRegistry() cannot use an async definition callback.",
                "Keep route declaration synchronous and use lazy(), loaders, or resources for async work.",
              ),
            );
          }
          return;
        }
        if (!name || !routeCalls.has(name) || routeRegistrationAncestor(node, definitions)) return;
        diagnostics.push(
          diagnostic(
            context,
            node.expression,
            this,
            `${name}() is declared outside createRouteRegistry().`,
            "Move route DSL calls into the synchronous createRouteRegistry(() => { ... }) callback.",
          ),
        );
      });
    }
    return diagnostics;
  },
};

const routePathRule: AnalyzeRule = {
  id: "askr/route-path-syntax",
  category: "correctness",
  severity: "error",
  description: "Askr route parameters use {name} segments.",
  analyze(context) {
    const diagnostics: AnalyzeDiagnostic[] = [];
    const pathCalls = new Set(["route", "page"]);
    for (const sourceFile of context.sourceFiles) {
      const bindings = sourceBindings(sourceFile);
      visit(sourceFile, (node) => {
        if (!ts.isCallExpression(node)) return;
        const name = canonicalCallName(node.expression, bindings);
        const first = node.arguments[0];
        if (!name || !pathCalls.has(name) || !first || !ts.isStringLiteral(first)) return;
        if (!/:([^/{}]+)/.test(first.text)) return;
        const replacement = first.text.replace(/:([^/{}]+)/g, "{$1}");
        diagnostics.push(
          diagnostic(
            context,
            first,
            this,
            `Route path '${first.text}' uses colon parameters instead of {name} segments.`,
            `Use '${replacement}'.`,
            {
              description: "Convert colon route parameters to Askr {name} segments",
              filePath: sourceFile.fileName,
              start: first.getStart(sourceFile),
              end: first.getEnd(),
              replacement: JSON.stringify(replacement),
            },
          ),
        );
      });
    }
    return diagnostics;
  },
};

function propertyInitializer(
  property: ts.PropertyAssignment | ts.ShorthandPropertyAssignment | undefined,
): ts.Expression | undefined {
  if (!property) return undefined;
  return ts.isPropertyAssignment(property) ? property.initializer : property.name;
}

function loaderForDataCall(name: string, call: ts.CallExpression): ts.Expression | undefined {
  const options = call.arguments[0];
  if (!options || !ts.isObjectLiteralExpression(options)) return undefined;
  const property =
    name === "createQuery" ? objectProperty(options, "fetch") : objectProperty(options, "action");
  return propertyInitializer(property);
}

const dataCancellationRule: AnalyzeRule = {
  id: "askr/data-cancellation",
  category: "correctness",
  severity: "warning",
  description: "Query and mutation requests should forward their cancellation signal.",
  analyze(context) {
    const diagnostics: AnalyzeDiagnostic[] = [];
    for (const sourceFile of context.sourceFiles) {
      const bindings = sourceBindings(sourceFile);
      visit(sourceFile, (node) => {
        if (!ts.isCallExpression(node)) return;
        const name = canonicalCallName(node.expression, bindings);
        if (name !== "createQuery" && name !== "createMutation") return;
        const loader = loaderForDataCall(name, node);
        if (!loader || (!ts.isArrowFunction(loader) && !ts.isFunctionExpression(loader))) return;
        const body = functionBodyText(loader);
        if (!/\bfetch\s*\(/.test(body) || /\bsignal\b/.test(body)) return;
        diagnostics.push(
          diagnostic(
            context,
            loader,
            this,
            `${name}() performs fetch() without forwarding its cancellation signal.`,
            "Accept the operation context signal and include it in the fetch options.",
          ),
        );
      });
    }
    return diagnostics;
  },
};

function objectProperty(
  object: ts.ObjectLiteralExpression,
  name: string,
): ts.PropertyAssignment | ts.ShorthandPropertyAssignment | undefined {
  return object.properties.find(
    (property): property is ts.PropertyAssignment | ts.ShorthandPropertyAssignment =>
      (ts.isPropertyAssignment(property) || ts.isShorthandPropertyAssignment(property)) &&
      property.name.getText().replace(/^['"]|['"]$/g, "") === name,
  );
}

function literalString(expression: ts.Expression | undefined): string | null {
  if (!expression) return null;
  if (ts.isStringLiteralLike(expression)) return expression.text;
  return null;
}

function isNullishLiteral(expression: ts.Expression): boolean {
  return (
    expression.kind === ts.SyntaxKind.NullKeyword ||
    (ts.isIdentifier(expression) && expression.text === "undefined")
  );
}

function isProvablyNonFunction(expression: ts.Expression | undefined): boolean {
  return Boolean(
    expression &&
    (ts.isLiteralExpression(expression) ||
      isNullishLiteral(expression) ||
      ts.isObjectLiteralExpression(expression) ||
      ts.isArrayLiteralExpression(expression)),
  );
}

function numericConstant(expression: ts.Expression | undefined): number | null {
  if (!expression) return null;
  if (ts.isNumericLiteral(expression)) return Number(expression.text);
  if (
    ts.isPrefixUnaryExpression(expression) &&
    (expression.operator === ts.SyntaxKind.MinusToken ||
      expression.operator === ts.SyntaxKind.PlusToken)
  ) {
    const operand = numericConstant(expression.operand);
    return operand === null
      ? null
      : expression.operator === ts.SyntaxKind.MinusToken
        ? -operand
        : operand;
  }
  if (ts.isIdentifier(expression)) {
    if (expression.text === "NaN") return Number.NaN;
    if (expression.text === "Infinity") return Number.POSITIVE_INFINITY;
  }
  if (
    ts.isPropertyAccessExpression(expression) &&
    ts.isIdentifier(expression.expression) &&
    expression.expression.text === "Number" &&
    ["NaN", "POSITIVE_INFINITY", "NEGATIVE_INFINITY"].includes(expression.name.text)
  ) {
    return Number[expression.name.text as "NaN" | "POSITIVE_INFINITY" | "NEGATIVE_INFINITY"];
  }
  return null;
}

function invalidPositiveInterval(expression: ts.Expression | undefined): boolean {
  const value = numericConstant(expression);
  return value !== null && (!Number.isFinite(value) || value <= 0);
}

function optionExpression(
  object: ts.ObjectLiteralExpression,
  name: string,
): ts.Expression | undefined {
  return propertyInitializer(objectProperty(object, name));
}

function invalidAsyncIterableReturn(source: ts.Expression): ts.Expression | null {
  if (!ts.isArrowFunction(source) && !ts.isFunctionExpression(source)) return null;
  if (source.asteriskToken) return null;
  let returned: ts.Expression | undefined;
  if (ts.isArrowFunction(source) && !ts.isBlock(source.body)) {
    returned = source.body;
  } else if (ts.isBlock(source.body)) {
    const returns = source.body.statements.filter(ts.isReturnStatement);
    if (returns.length === 0) return source;
    if (returns.length !== 1) return null;
    returned = returns[0]?.expression;
  }
  if (!returned) return source;
  if (
    ts.isNumericLiteral(returned) ||
    ts.isStringLiteralLike(returned) ||
    isNullishLiteral(returned) ||
    ts.isArrayLiteralExpression(returned)
  ) {
    return returned;
  }
  if (
    ts.isCallExpression(returned) &&
    ts.isPropertyAccessExpression(returned.expression) &&
    ts.isIdentifier(returned.expression.expression) &&
    returned.expression.expression.text === "Promise" &&
    returned.expression.name.text === "resolve"
  ) {
    const resolved = returned.arguments[0];
    if (
      resolved &&
      (ts.isLiteralExpression(resolved) ||
        isNullishLiteral(resolved) ||
        ts.isArrayLiteralExpression(resolved))
    ) {
      return resolved;
    }
  }
  return null;
}

const lifecycleContractRule: AnalyzeRule = {
  id: "askr/lifecycle-contract",
  category: "correctness",
  severity: "error",
  description: "Lifecycle primitives require valid targets, events, callbacks, and intervals.",
  analyze(context) {
    const diagnostics: AnalyzeDiagnostic[] = [];
    for (const sourceFile of context.sourceFiles) {
      for (const { node, name } of sourceFacts(sourceFile).calls) {
        if (name === "on") {
          const [target, event, handler] = node.arguments;
          if (!target || isNullishLiteral(target) || ts.isLiteralExpression(target)) {
            diagnostics.push(
              diagnostic(
                context,
                target ?? node.expression,
                this,
                "on() requires an EventTarget as its first argument.",
                "Pass the concrete event target owned by this component.",
              ),
            );
          }
          if (!event || (literalString(event) !== null && literalString(event)?.trim() === "")) {
            diagnostics.push(
              diagnostic(
                context,
                event ?? node.expression,
                this,
                "on() requires a non-empty event name.",
                "Pass a concrete event name such as 'click'.",
              ),
            );
          } else if (ts.isLiteralExpression(event) && !ts.isStringLiteralLike(event)) {
            diagnostics.push(
              diagnostic(
                context,
                event,
                this,
                "on() event names must be strings.",
                "Pass a non-empty string event name.",
              ),
            );
          }
          if (!handler || isProvablyNonFunction(handler)) {
            diagnostics.push(
              diagnostic(
                context,
                handler ?? node.expression,
                this,
                "on() requires an event handler function.",
                "Pass a function as the third argument.",
              ),
            );
          }
        } else if (name === "timer") {
          const [interval, callback] = node.arguments;
          if (!interval) {
            diagnostics.push(
              diagnostic(
                context,
                node.expression,
                this,
                "timer() requires a positive finite interval.",
                "Pass a positive interval in milliseconds.",
              ),
            );
          } else if (invalidPositiveInterval(interval)) {
            diagnostics.push(
              diagnostic(
                context,
                interval,
                this,
                "timer() interval must be positive and finite.",
                "Use a finite interval greater than zero.",
              ),
            );
          }
          if (!callback || isProvablyNonFunction(callback)) {
            diagnostics.push(
              diagnostic(
                context,
                callback ?? node.expression,
                this,
                "timer() requires a callback function.",
                "Pass the work to run as the second argument.",
              ),
            );
          }
        } else if (name === "task") {
          const callback = node.arguments[0];
          if (!callback || isProvablyNonFunction(callback)) {
            diagnostics.push(
              diagnostic(
                context,
                callback ?? node.expression,
                this,
                "task() requires a function.",
                "Pass a function that performs the lifecycle-owned work.",
              ),
            );
          }
        }
      }
    }
    return diagnostics;
  },
};

const streamContractRule: AnalyzeRule = {
  id: "askr/stream-contract",
  category: "correctness",
  severity: "error",
  description: "stream requires a source function returning an AsyncIterable and valid options.",
  analyze(context) {
    const diagnostics: AnalyzeDiagnostic[] = [];
    for (const sourceFile of context.sourceFiles) {
      for (const { node, name } of sourceFacts(sourceFile).calls) {
        if (name !== "stream") continue;
        const source = node.arguments[0];
        if (!source || isProvablyNonFunction(source)) {
          diagnostics.push(
            diagnostic(
              context,
              source ?? node.expression,
              this,
              "stream() requires a source function.",
              "Pass ({ signal }) => AsyncIterable or a Promise of one.",
            ),
          );
        } else {
          const invalidReturn = invalidAsyncIterableReturn(source);
          if (invalidReturn) {
            diagnostics.push(
              diagnostic(
                context,
                invalidReturn,
                this,
                "stream() source has a return shape that is not an AsyncIterable.",
                "Return an async generator or another AsyncIterable.",
              ),
            );
          }
        }
        const options = node.arguments[1];
        if (!options) continue;
        if (!ts.isObjectLiteralExpression(options)) {
          if (
            ts.isLiteralExpression(options) ||
            isNullishLiteral(options) ||
            ts.isArrayLiteralExpression(options)
          ) {
            diagnostics.push(
              diagnostic(
                context,
                options,
                this,
                "stream() options must be an object.",
                "Pass { deps, initialValue } or omit the options argument.",
              ),
            );
          }
          continue;
        }
        const deps = optionExpression(options, "deps");
        if (
          deps &&
          !ts.isArrayLiteralExpression(deps) &&
          (ts.isLiteralExpression(deps) ||
            isNullishLiteral(deps) ||
            ts.isObjectLiteralExpression(deps))
        ) {
          diagnostics.push(
            diagnostic(
              context,
              deps,
              this,
              "stream() deps must be an array.",
              "Pass a readonly dependency array.",
            ),
          );
        }
      }
    }
    return diagnostics;
  },
};

const dataContractRule: AnalyzeRule = {
  id: "askr/data-contract",
  category: "correctness",
  severity: "error",
  description: "Queries and mutations require their identifying and executable options.",
  analyze(context) {
    const diagnostics: AnalyzeDiagnostic[] = [];
    for (const sourceFile of context.sourceFiles) {
      for (const { node, name } of sourceFacts(sourceFile).calls) {
        if (name !== "createQuery" && name !== "createMutation") continue;
        const options = node.arguments[0];
        if (!options) {
          diagnostics.push(
            diagnostic(
              context,
              node.expression,
              this,
              `${name}() requires an options object.`,
              name === "createQuery"
                ? "Pass a non-empty key and fetch function."
                : "Pass an action function.",
            ),
          );
          continue;
        }
        if (!ts.isObjectLiteralExpression(options)) {
          if (
            ts.isLiteralExpression(options) ||
            isNullishLiteral(options) ||
            ts.isArrayLiteralExpression(options)
          ) {
            diagnostics.push(
              diagnostic(
                context,
                options,
                this,
                `${name}() options must be an object or a declared query definition.`,
              ),
            );
          }
          continue;
        }
        if (name === "createQuery") {
          const key = optionExpression(options, "key");
          if (!key || (literalString(key) !== null && literalString(key)?.trim() === "")) {
            diagnostics.push(
              diagnostic(
                context,
                key ?? options,
                this,
                "createQuery() requires a non-empty key.",
                "Pass a stable query key.",
              ),
            );
          } else if (ts.isLiteralExpression(key) && !ts.isStringLiteralLike(key)) {
            diagnostics.push(
              diagnostic(context, key, this, "createQuery() key must be a string or key function."),
            );
          }
          const fetcher = optionExpression(options, "fetch");
          if (!fetcher || isProvablyNonFunction(fetcher)) {
            diagnostics.push(
              diagnostic(
                context,
                fetcher ?? options,
                this,
                "createQuery() requires a fetch function.",
                "Pass a cancellable fetch function.",
              ),
            );
          }
        } else {
          const action = optionExpression(options, "action");
          if (!action || isProvablyNonFunction(action)) {
            diagnostics.push(
              diagnostic(
                context,
                action ?? options,
                this,
                "createMutation() requires an action function.",
                "Pass the mutation implementation as action.",
              ),
            );
          }
        }
      }
    }
    return diagnostics;
  },
};

const invalidationContractRule: AnalyzeRule = {
  id: "askr/invalidation-contract",
  category: "correctness",
  severity: "error",
  description: "Invalidation prefixes, scopes, and intervals must be concrete and non-empty.",
  analyze(context) {
    const diagnostics: AnalyzeDiagnostic[] = [];
    for (const sourceFile of context.sourceFiles) {
      for (const { node, name } of sourceFacts(sourceFile).calls) {
        if (!["invalidate", "queryScope", "invalidateOnInterval"].includes(name)) continue;
        const prefix = node.arguments[0];
        if (
          !prefix ||
          (literalString(prefix) !== null && literalString(prefix)?.trim() === "") ||
          (ts.isLiteralExpression(prefix) && !ts.isStringLiteralLike(prefix))
        ) {
          diagnostics.push(
            diagnostic(
              context,
              prefix ?? node.expression,
              this,
              `${name}() requires a non-empty string ${name === "queryScope" ? "namespace" : "prefix"}.`,
              "Use a stable non-empty query-key prefix.",
            ),
          );
        }
        if (name !== "invalidateOnInterval") continue;
        const options = node.arguments[1];
        if (!options || !ts.isObjectLiteralExpression(options)) {
          if (
            !options ||
            ts.isLiteralExpression(options) ||
            isNullishLiteral(options) ||
            ts.isArrayLiteralExpression(options)
          ) {
            diagnostics.push(
              diagnostic(
                context,
                options ?? node.expression,
                this,
                "invalidateOnInterval() requires an options object with intervalMs.",
              ),
            );
          }
          continue;
        }
        const interval = optionExpression(options, "intervalMs");
        if (!interval || invalidPositiveInterval(interval)) {
          diagnostics.push(
            diagnostic(
              context,
              interval ?? options,
              this,
              "invalidateOnInterval() intervalMs must be positive and finite.",
              "Pass a finite interval greater than zero.",
            ),
          );
        }
      }
    }
    return diagnostics;
  },
};

function validateIslandObject(
  context: WorkspaceAnalysisContext,
  rule: AnalyzeRule,
  object: ts.ObjectLiteralExpression,
  diagnostics: AnalyzeDiagnostic[],
): void {
  const root = optionExpression(object, "root");
  const component = optionExpression(object, "component");
  if (!root || isNullishLiteral(root) || literalString(root)?.trim() === "") {
    diagnostics.push(
      diagnostic(
        context,
        root ?? object,
        rule,
        "Island configuration requires a root.",
        "Pass a root element or non-empty selector.",
      ),
    );
  }
  if (!component || isProvablyNonFunction(component)) {
    diagnostics.push(
      diagnostic(
        context,
        component ?? object,
        rule,
        "Island configuration requires a component function.",
        "Pass a synchronous Askr component.",
      ),
    );
  } else {
    const resolved = resolvedFunction(component, context);
    if (resolved && isAsyncFunction(resolved)) {
      diagnostics.push(
        diagnostic(
          context,
          component,
          rule,
          "Island components must be synchronous.",
          "Move asynchronous work into resource(), stream(), or task().",
        ),
      );
    }
  }
  const routes = objectProperty(object, "routes");
  if (routes) {
    diagnostics.push(
      diagnostic(
        context,
        routes,
        rule,
        "Island configuration cannot include routes.",
        "Use createSPA() for routed applications.",
      ),
    );
  }
}

const islandContractRule: AnalyzeRule = {
  id: "askr/island-contract",
  category: "correctness",
  severity: "error",
  description: "Island boot requires roots, synchronous components, and no routes.",
  analyze(context) {
    const diagnostics: AnalyzeDiagnostic[] = [];
    for (const sourceFile of context.sourceFiles) {
      for (const { node, name } of sourceFacts(sourceFile).calls) {
        if (name !== "createIsland" && name !== "createIslands") continue;
        const config = node.arguments[0];
        if (!config || !ts.isObjectLiteralExpression(config)) {
          if (
            !config ||
            ts.isLiteralExpression(config) ||
            isNullishLiteral(config) ||
            ts.isArrayLiteralExpression(config)
          ) {
            diagnostics.push(
              diagnostic(
                context,
                config ?? node.expression,
                this,
                `${name}() requires a configuration object.`,
              ),
            );
          }
          continue;
        }
        if (name === "createIsland") {
          validateIslandObject(context, this, config, diagnostics);
          continue;
        }
        const islands = optionExpression(config, "islands");
        if (!islands || (ts.isArrayLiteralExpression(islands) && islands.elements.length === 0)) {
          diagnostics.push(
            diagnostic(
              context,
              islands ?? config,
              this,
              "createIslands() requires a non-empty islands array.",
            ),
          );
        } else if (ts.isArrayLiteralExpression(islands)) {
          for (const island of islands.elements) {
            if (ts.isObjectLiteralExpression(island)) {
              validateIslandObject(context, this, island, diagnostics);
            }
          }
        }
      }
    }
    return diagnostics;
  },
};

const executionModelRule: AnalyzeRule = {
  id: "askr/execution-model",
  category: "correctness",
  severity: "error",
  description: "A workspace must not mix routed SPA boot and island boot.",
  analyze(context) {
    const routed: SourceCallFact[] = [];
    const islands: SourceCallFact[] = [];
    for (const sourceFile of context.sourceFiles) {
      for (const fact of sourceFacts(sourceFile).calls) {
        if (fact.name === "createSPA" || fact.name === "hydrateSPA") routed.push(fact);
        if (fact.name === "createIsland" || fact.name === "createIslands") islands.push(fact);
      }
    }
    if (routed.length === 0 || islands.length === 0) return [];
    return [
      diagnostic(
        context,
        islands[0]!.node.expression,
        this,
        "This workspace mixes SPA/hydration boot with island boot.",
        "Choose one execution model per workspace and move the other boot entry to a separate workspace.",
      ),
    ];
  },
};

function invalidPrefixElements(expression: ts.Expression | undefined): ts.Expression[] {
  if (!expression || !ts.isArrayLiteralExpression(expression)) return [];
  return expression.elements.filter(
    (element): element is ts.Expression =>
      ts.isExpression(element) &&
      ((literalString(element) !== null && literalString(element)?.trim() === "") ||
        (ts.isLiteralExpression(element) && !ts.isStringLiteralLike(element))),
  );
}

const actionContractRule: AnalyzeRule = {
  id: "askr/action-contract",
  category: "correctness",
  severity: "error",
  description: "Actions require stable unique IDs, schemas, and valid invalidation prefixes.",
  analyze(context) {
    const diagnostics: AnalyzeDiagnostic[] = [];
    const literalIds = new Map<string, ts.Expression>();
    for (const sourceFile of context.sourceFiles) {
      const facts = sourceFacts(sourceFile);
      for (const { node, name } of facts.calls) {
        if (name !== "defineAction") continue;
        const options = node.arguments[0];
        if (!options || !ts.isObjectLiteralExpression(options)) {
          diagnostics.push(
            diagnostic(
              context,
              options ?? node.expression,
              this,
              "defineAction() requires an options object with id and input.",
            ),
          );
          continue;
        }
        const id = optionExpression(options, "id");
        const idText = literalString(id);
        if (!id || (idText !== null && idText.trim() === "")) {
          diagnostics.push(
            diagnostic(
              context,
              id ?? options,
              this,
              "defineAction() requires a non-empty id.",
              "Use a stable workspace-unique action ID.",
            ),
          );
        } else if (idText !== null) {
          if (literalIds.has(idText)) {
            diagnostics.push(
              diagnostic(
                context,
                id,
                this,
                `Action ID '${idText}' is declared more than once in this workspace.`,
                "Give every action a unique stable ID.",
              ),
            );
          } else {
            literalIds.set(idText, id);
          }
        } else if (ts.isLiteralExpression(id)) {
          diagnostics.push(diagnostic(context, id, this, "defineAction() id must be a string."));
        }
        const input = optionExpression(options, "input");
        if (!input || isNullishLiteral(input)) {
          diagnostics.push(
            diagnostic(
              context,
              input ?? options,
              this,
              "defineAction() requires an input schema.",
              "Pass an object schema as input.",
            ),
          );
        }
        for (const invalid of invalidPrefixElements(optionExpression(options, "invalidates"))) {
          diagnostics.push(
            diagnostic(
              context,
              invalid,
              this,
              "Action invalidation prefixes must be non-empty strings.",
            ),
          );
        }
      }
      for (const { node, name } of facts.jsx) {
        if (name !== "ActionForm") continue;
        if (!jsxAttributes(node).has("action")) {
          diagnostics.push(
            diagnostic(
              context,
              node.tagName,
              this,
              "<ActionForm> requires an action descriptor.",
              "Pass action={descriptor}.",
            ),
          );
        }
      }
    }
    return diagnostics;
  },
};

const actionPromiseRule: AnalyzeRule = {
  id: "askr/action-promise",
  category: "correctness",
  severity: "error",
  description: "Action submit promises must be observed or explicitly discarded.",
  analyze(context) {
    const diagnostics: AnalyzeDiagnostic[] = [];
    for (const sourceFile of context.sourceFiles) {
      const facts = sourceFacts(sourceFile);
      const handles = new Set<string>();
      for (const { node, name } of facts.calls) {
        if (name !== "action") continue;
        const parent = node.parent;
        if (ts.isVariableDeclaration(parent) && ts.isIdentifier(parent.name)) {
          handles.add(parent.name.text);
        }
      }
      for (const node of facts.allCalls) {
        if (
          !ts.isPropertyAccessExpression(node.expression) ||
          node.expression.name.text !== "submit"
        ) {
          continue;
        }
        const receiver = node.expression.expression;
        const owned =
          (ts.isIdentifier(receiver) && handles.has(receiver.text)) ||
          (ts.isCallExpression(receiver) &&
            canonicalCallName(receiver.expression, facts.bindings) === "action");
        if (!owned || !ts.isExpressionStatement(node.parent)) continue;
        diagnostics.push(
          diagnostic(
            context,
            node.expression.name,
            this,
            "Action submit Promise is discarded.",
            "Await it, return it, or use void when fire-and-forget is intentional.",
          ),
        );
      }
    }
    return diagnostics;
  },
};

function allocationName(expression: ts.LeftHandSideExpression): string | null {
  if (ts.isIdentifier(expression) && ["RegExp", "Map", "Set"].includes(expression.text)) {
    return expression.text;
  }
  if (
    ts.isPropertyAccessExpression(expression) &&
    ts.isIdentifier(expression.expression) &&
    expression.expression.text === "Intl"
  ) {
    return `Intl.${expression.name.text}`;
  }
  return null;
}

const renderAllocationRule: AnalyzeRule = {
  id: "askr/render-allocation",
  category: "performance",
  severity: "info",
  description: "Repeated render-time constructors should be hoisted or memoized.",
  analyze(context) {
    const diagnostics: AnalyzeDiagnostic[] = [];
    for (const sourceFile of context.sourceFiles) {
      for (const construction of sourceFacts(sourceFile).constructions) {
        const name = allocationName(construction.expression);
        if (!name) continue;
        const owner = containingFunction(construction);
        if (!owner || (!/^[A-Z]/.test(functionName(owner) ?? "") && !containsJsx(owner))) {
          continue;
        }
        diagnostics.push(
          diagnostic(
            context,
            construction,
            this,
            `new ${name}() is allocated during component render.`,
            "Hoist stable instances or cache them outside the repeated render path.",
          ),
        );
      }
    }
    return diagnostics;
  },
};

const bootRegistryRule: AnalyzeRule = {
  id: "askr/boot-registry",
  category: "correctness",
  severity: "error",
  description: "Routed app boot requires an explicit route registry.",
  analyze(context) {
    const diagnostics: AnalyzeDiagnostic[] = [];
    for (const sourceFile of context.sourceFiles) {
      const bindings = sourceBindings(sourceFile);
      visit(sourceFile, (node) => {
        if (!ts.isCallExpression(node)) return;
        const name = canonicalCallName(node.expression, bindings);
        if (name !== "createSPA" && name !== "hydrateSPA") return;
        const config = node.arguments[0];
        if (!config || !ts.isObjectLiteralExpression(config)) {
          diagnostics.push(
            diagnostic(
              context,
              node.expression,
              this,
              `${name}() must receive an object containing registry.`,
              "Pass the RouteRegistry returned by createRouteRegistry() as registry.",
            ),
          );
          return;
        }
        if (!objectProperty(config, "registry")) {
          const legacy = objectProperty(config, "routes") ?? objectProperty(config, "manifest");
          diagnostics.push(
            diagnostic(
              context,
              legacy ?? config,
              this,
              legacy
                ? `${name}() uses a legacy route source instead of registry.`
                : `${name}() is missing its required registry property.`,
              "Pass the RouteRegistry returned by createRouteRegistry() as registry.",
            ),
          );
        }
        const parent = node.parent;
        if (
          ts.isExpressionStatement(parent) &&
          !ts.isAwaitExpression(node.parent) &&
          !ts.isVoidExpression(node.parent)
        ) {
          diagnostics.push(
            diagnostic(
              context,
              node.expression,
              this,
              `${name}() returns a Promise that is not awaited.`,
              `Use await ${name}(...), return the Promise, or explicitly use void when fire-and-forget is intentional.`,
            ),
          );
        }
      });
    }
    return diagnostics;
  },
};

function isTypeofGuard(node: ts.Identifier): boolean {
  return ts.isTypeOfExpression(node.parent);
}

function expressionContainsTypeofName(expression: ts.Expression, name: string): boolean {
  let found = false;
  const walk = (node: ts.Node): void => {
    if (found) return;
    if (
      ts.isTypeOfExpression(node) &&
      ts.isIdentifier(node.expression) &&
      node.expression.text === name
    ) {
      found = true;
      return;
    }
    ts.forEachChild(node, walk);
  };
  walk(expression);
  return found;
}

function isInsideTypeofGuard(node: ts.Identifier): boolean {
  for (let current = node.parent; current; current = current.parent) {
    if (ts.isIfStatement(current) && expressionContainsTypeofName(current.expression, node.text)) {
      return true;
    }
    if (
      ts.isConditionalExpression(current) &&
      expressionContainsTypeofName(current.condition, node.text)
    ) {
      return true;
    }
    if (ts.isFunctionLike(current) || ts.isSourceFile(current)) break;
  }
  return false;
}

const ssrGlobalsRule: AnalyzeRule = {
  id: "askr/ssr-browser-global",
  category: "correctness",
  severity: "error",
  description: "SSR code must not access browser-only globals during rendering.",
  analyze(context) {
    const diagnostics: AnalyzeDiagnostic[] = [];
    const globals = new Set(["window", "document", "localStorage", "sessionStorage", "navigator"]);
    for (const sourceFile of context.sourceFiles) {
      const normalized = sourceFile.fileName.split(path.sep).join("/");
      const importsSsr = sourceFile.statements.some(
        (statement) =>
          ts.isImportDeclaration(statement) &&
          ts.isStringLiteral(statement.moduleSpecifier) &&
          /^@askrjs\/askr\/(?:ssr|ssg)$/.test(statement.moduleSpecifier.text),
      );
      if (
        !importsSsr &&
        !/(?:^|\/)(?:server|entry-server|ssr|ssg)[^/]*\.[cm]?[jt]sx?$/.test(normalized)
      ) {
        continue;
      }
      visit(sourceFile, (node) => {
        if (
          !ts.isIdentifier(node) ||
          !globals.has(node.text) ||
          isTypeofGuard(node) ||
          isInsideTypeofGuard(node)
        ) {
          return;
        }
        if (ts.isPropertyAccessExpression(node.parent) && node.parent.name === node) {
          return;
        }
        if (
          (ts.isPropertyAssignment(node.parent) ||
            ts.isMethodDeclaration(node.parent) ||
            ts.isPropertyDeclaration(node.parent) ||
            ts.isPropertySignature(node.parent)) &&
          node.parent.name === node
        ) {
          return;
        }
        const symbol = context.checker.getSymbolAtLocation(node);
        if (
          symbol?.declarations?.some(
            (declaration) =>
              !declaration.getSourceFile().isDeclarationFile ||
              !/[\\/]typescript[\\/]lib[\\/]lib\./.test(declaration.getSourceFile().fileName),
          )
        ) {
          return;
        }
        diagnostics.push(
          diagnostic(
            context,
            node,
            this,
            `Browser global '${node.text}' is accessed in SSR/SSG code.`,
            "Move the access to client lifecycle code or guard it behind a browser-only branch.",
          ),
        );
      });
    }
    return diagnostics;
  },
};

function dependencyRecord(
  manifest: Record<string, unknown>,
  section: string,
): Record<string, unknown> {
  const value = manifest[section];
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function hasDependency(manifest: Record<string, unknown>, packageName: string): boolean {
  return ["dependencies", "devDependencies", "peerDependencies", "optionalDependencies"].some(
    (section) => packageName in dependencyRecord(manifest, section),
  );
}

const frameworkConfigRule: AnalyzeRule = {
  id: "askr/framework-config",
  category: "configuration",
  severity: "error",
  description: "TypeScript and Vite must use Askr's JSX/runtime wiring.",
  analyze(context) {
    const diagnostics: AnalyzeDiagnostic[] = [];
    const tsx = context.sourceFiles.find((sourceFile) => sourceFile.fileName.endsWith(".tsx"));
    if (!tsx || !hasDependency(context.workspace.manifest, "@askrjs/askr")) return diagnostics;

    const tsconfigPath = path.join(context.workspace.directory, "tsconfig.json");
    const tsconfigSource = ts.sys.readFile(tsconfigPath);
    const jsxImportSource = context.program.getCompilerOptions().jsxImportSource;
    if (jsxImportSource !== "@askrjs/askr") {
      let fix: AnalyzeDiagnostic["fix"];
      if (tsconfigSource) {
        try {
          const parsed = JSON.parse(tsconfigSource) as Record<string, unknown>;
          const compilerOptions =
            parsed.compilerOptions &&
            typeof parsed.compilerOptions === "object" &&
            !Array.isArray(parsed.compilerOptions)
              ? (parsed.compilerOptions as Record<string, unknown>)
              : {};
          parsed.compilerOptions = {
            ...compilerOptions,
            jsx: "react-jsx",
            jsxImportSource: "@askrjs/askr",
          };
          fix = {
            description: "Configure TypeScript to use the Askr JSX runtime",
            filePath: tsconfigPath,
            start: 0,
            end: tsconfigSource.length,
            replacement: `${JSON.stringify(parsed, null, 2)}\n`,
          };
        } catch {
          // JSONC and extended configs remain report-only.
        }
      }
      diagnostics.push(
        diagnostic(
          context,
          tsx,
          this,
          "TSX is present but compilerOptions.jsxImportSource is not '@askrjs/askr'.",
          "Set jsx to react-jsx and jsxImportSource to @askrjs/askr.",
          fix,
        ),
      );
    }

    const viteConfig = context.sourceFiles.find((sourceFile) =>
      /(?:^|\/)vite\.config\.[cm]?[jt]s$/.test(sourceFile.fileName.split(path.sep).join("/")),
    );
    if (viteConfig) {
      let pluginLocalName: string | null = null;
      for (const statement of viteConfig.statements) {
        if (
          !ts.isImportDeclaration(statement) ||
          !ts.isStringLiteral(statement.moduleSpecifier) ||
          statement.moduleSpecifier.text !== "@askrjs/vite" ||
          !statement.importClause?.namedBindings ||
          !ts.isNamedImports(statement.importClause.namedBindings)
        ) {
          continue;
        }
        const plugin = statement.importClause.namedBindings.elements.find(
          (element) => (element.propertyName?.text ?? element.name.text) === "askr",
        );
        pluginLocalName = plugin?.name.text ?? null;
      }
      let pluginCalled = false;
      if (pluginLocalName) {
        visit(viteConfig, (node) => {
          if (
            ts.isCallExpression(node) &&
            ts.isIdentifier(node.expression) &&
            node.expression.text === pluginLocalName
          ) {
            pluginCalled = true;
          }
        });
      }
      const dependencyPresent = hasDependency(context.workspace.manifest, "@askrjs/vite");
      if (dependencyPresent && pluginCalled) return diagnostics;
      diagnostics.push(
        diagnostic(
          context,
          viteConfig,
          this,
          !dependencyPresent
            ? "This Askr Vite project does not declare @askrjs/vite."
            : "Vite is configured without calling the @askrjs/vite askr() plugin.",
          "Declare @askrjs/vite, import askr, and include askr() in the plugin list.",
        ),
      );
    }
    return diagnostics;
  },
};

const parseErrorRule: AnalyzeRule = {
  id: "askr/parse-error",
  category: "correctness",
  severity: "error",
  description: "Source must parse before framework analysis is reliable.",
  analyze(context) {
    return context.program
      .getSyntacticDiagnostics()
      .filter((entry): entry is ts.DiagnosticWithLocation =>
        Boolean(
          entry.file &&
          context.sourceFiles.some((sourceFile) => sourceFile.fileName === entry.file?.fileName),
        ),
      )
      .map((entry) => {
        const start = entry.start ?? 0;
        const point = entry.file.getLineAndCharacterOfPosition(start);
        return {
          ruleId: this.id,
          category: this.category,
          severity: this.severity,
          message: ts.flattenDiagnosticMessageText(entry.messageText, "\n"),
          workspace: context.workspace.name,
          file: workspaceRelativeFile(context, entry.file.fileName),
          line: point.line + 1,
          column: point.character + 1,
          remediation: "Fix the syntax error so framework rules can inspect this file reliably.",
        };
      });
  },
};

export const ANALYZE_RULES: readonly AnalyzeRule[] = [
  parseErrorRule,
  stableRenderRule,
  renderSideEffectRule,
  stateAccessRule,
  stateRenderWriteRule,
  resourceCancellationRule,
  stableDependenciesRule,
  lifecycleContractRule,
  streamContractRule,
  dataContractRule,
  invalidationContractRule,
  forContractRule,
  controlContractRule,
  stableKeyRule,
  preferForRule,
  asyncComponentRule,
  routeRegistryRule,
  routePathRule,
  dataCancellationRule,
  bootRegistryRule,
  islandContractRule,
  executionModelRule,
  actionContractRule,
  actionPromiseRule,
  renderAllocationRule,
  ssrGlobalsRule,
  frameworkConfigRule,
];

export function configuredSeverity(
  rule: AnalyzeRule,
  configuration: WorkspaceAnalysisContext["configuration"],
): AnalyzeSeverity | "off" {
  return configuration.rules[rule.id] ?? rule.severity;
}
