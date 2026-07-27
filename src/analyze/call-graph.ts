import path from "node:path";
import ts from "typescript";
import type { WorkspaceAnalysisContext } from "./types";

export type LocalFunction = ts.SignatureDeclaration & { readonly body: ts.ConciseBody };

export interface LocalCallSite {
  readonly node: ts.CallExpression;
  readonly owner: LocalFunction | null;
  readonly target: LocalFunction | null;
}

export interface LocalCallGraph {
  readonly calls: readonly LocalCallSite[];
  readonly constructions: readonly {
    readonly node: ts.NewExpression;
    readonly owner: LocalFunction | null;
  }[];
  readonly functions: ReadonlySet<LocalFunction>;
  functionForCall(call: ts.CallExpression): LocalFunction | null;
  functionForExpression(expression: ts.Expression): LocalFunction | null;
}

export interface DirectCallFact<Value extends string> {
  readonly value: Value;
  readonly unstable?: boolean;
}

export interface FunctionCallSummary<Value extends string> {
  readonly values: ReadonlySet<Value>;
  readonly unstableValues: ReadonlySet<Value>;
}

export interface TransitiveCallSummary<Value extends string> {
  readonly byFunction: ReadonlyMap<LocalFunction, FunctionCallSummary<Value>>;
  forCall(call: ts.CallExpression): FunctionCallSummary<Value> | null;
}

const CALL_GRAPH_CACHE = new WeakMap<ts.Program, LocalCallGraph>();

function isLocalFunction(node: ts.Node | undefined): node is LocalFunction {
  return Boolean(
    node &&
    ts.isFunctionLike(node) &&
    "body" in node &&
    (node as { readonly body?: ts.ConciseBody }).body,
  );
}

function containingLocalFunction(node: ts.Node): LocalFunction | null {
  for (let current = node.parent; current; current = current.parent) {
    if (isLocalFunction(current)) return current;
  }
  return null;
}

function declarationFunction(declaration: ts.Declaration | undefined): LocalFunction | null {
  if (!declaration) return null;
  if (isLocalFunction(declaration)) return declaration;
  if (
    ts.isVariableDeclaration(declaration) &&
    declaration.initializer &&
    isLocalFunction(declaration.initializer)
  ) {
    return declaration.initializer;
  }
  if (ts.isPropertyAssignment(declaration) && isLocalFunction(declaration.initializer)) {
    return declaration.initializer;
  }
  return null;
}

function symbolForExpression(
  checker: ts.TypeChecker,
  expression: ts.Expression,
): ts.Symbol | undefined {
  const location = ts.isPropertyAccessExpression(expression) ? expression.name : expression;
  let symbol = checker.getSymbolAtLocation(location) ?? checker.getSymbolAtLocation(expression);
  if (symbol && (symbol.flags & ts.SymbolFlags.Alias) !== 0) {
    symbol = checker.getAliasedSymbol(symbol);
  }
  return symbol;
}

function resolveLocalFunction(
  checker: ts.TypeChecker,
  sourceFiles: ReadonlySet<ts.SourceFile>,
  expression: ts.Expression,
): LocalFunction | null {
  const symbol = symbolForExpression(checker, expression);
  const declarations = [symbol?.valueDeclaration, ...(symbol?.declarations ?? [])];
  for (const declaration of declarations) {
    const fn = declarationFunction(declaration);
    if (fn && sourceFiles.has(fn.getSourceFile())) return fn;
  }
  return null;
}

function localNamedFunction(sourceFile: ts.SourceFile, name: string): LocalFunction | null {
  for (const statement of sourceFile.statements) {
    if (ts.isFunctionDeclaration(statement) && statement.name?.text === name) {
      return isLocalFunction(statement) ? statement : null;
    }
    if (!ts.isVariableStatement(statement)) continue;
    for (const declaration of statement.declarationList.declarations) {
      if (
        ts.isIdentifier(declaration.name) &&
        declaration.name.text === name &&
        declaration.initializer &&
        isLocalFunction(declaration.initializer)
      ) {
        return declaration.initializer;
      }
    }
  }
  return null;
}

export function localCallGraph(context: WorkspaceAnalysisContext): LocalCallGraph {
  const cached = CALL_GRAPH_CACHE.get(context.program);
  if (cached) return cached;

  const sourceFiles = new Set(context.sourceFiles);
  const sourceByPath = new Map(
    context.sourceFiles.map(
      (sourceFile) => [path.resolve(sourceFile.fileName), sourceFile] as const,
    ),
  );
  const moduleCache = new Map<string, ts.SourceFile | null>();
  const resolveModule = (
    containingFile: ts.SourceFile,
    specifier: string,
  ): ts.SourceFile | null => {
    if (!specifier.startsWith(".")) return null;
    const cacheKey = `${containingFile.fileName}\0${specifier}`;
    if (moduleCache.has(cacheKey)) return moduleCache.get(cacheKey) ?? null;
    const base = path.resolve(path.dirname(containingFile.fileName), specifier);
    const withoutJsExtension = base.replace(/\.(?:c|m)?js$/, "");
    const candidates = [
      base,
      `${base}.ts`,
      `${base}.tsx`,
      `${base}.mts`,
      `${base}.cts`,
      `${base}.js`,
      `${base}.jsx`,
      `${withoutJsExtension}.ts`,
      `${withoutJsExtension}.tsx`,
      path.join(base, "index.ts"),
      path.join(base, "index.tsx"),
      path.join(base, "index.js"),
    ];
    for (const candidate of candidates) {
      const resolved = sourceByPath.get(candidate);
      if (resolved) {
        moduleCache.set(cacheKey, resolved);
        return resolved;
      }
    }
    moduleCache.set(cacheKey, null);
    return null;
  };
  const exportCache = new Map<string, LocalFunction | null>();
  const exportedFunction = (
    sourceFile: ts.SourceFile,
    name: string,
    seen = new Set<string>(),
  ): LocalFunction | null => {
    const key = `${sourceFile.fileName}\0${name}`;
    if (exportCache.has(key)) return exportCache.get(key) ?? null;
    if (seen.has(key)) return null;
    seen.add(key);
    const direct = localNamedFunction(sourceFile, name);
    if (direct) {
      exportCache.set(key, direct);
      return direct;
    }
    exportCache.set(key, null);
    for (const statement of sourceFile.statements) {
      if (
        name === "default" &&
        ts.isFunctionDeclaration(statement) &&
        statement.modifiers?.some((modifier) => modifier.kind === ts.SyntaxKind.DefaultKeyword) &&
        isLocalFunction(statement)
      ) {
        exportCache.set(key, statement);
        return statement;
      }
      if (!ts.isExportDeclaration(statement)) continue;
      const target =
        statement.moduleSpecifier && ts.isStringLiteral(statement.moduleSpecifier)
          ? resolveModule(sourceFile, statement.moduleSpecifier.text)
          : sourceFile;
      if (!target) continue;
      if (!statement.exportClause) {
        const resolved = exportedFunction(target, name, seen);
        if (resolved) {
          exportCache.set(key, resolved);
          return resolved;
        }
        continue;
      }
      if (!ts.isNamedExports(statement.exportClause)) continue;
      const element = statement.exportClause.elements.find(
        (candidate) => candidate.name.text === name,
      );
      if (!element) continue;
      const imported = element.propertyName?.text ?? element.name.text;
      const resolved =
        target === sourceFile
          ? localNamedFunction(sourceFile, imported)
          : exportedFunction(target, imported, seen);
      exportCache.set(key, resolved);
      return resolved;
    }
    return null;
  };
  const importBindings = new Map<
    ts.SourceFile,
    {
      named: Map<string, { source: ts.SourceFile; imported: string }>;
      namespaces: Map<string, ts.SourceFile>;
    }
  >();
  for (const sourceFile of context.sourceFiles) {
    const named = new Map<string, { source: ts.SourceFile; imported: string }>();
    const namespaces = new Map<string, ts.SourceFile>();
    for (const statement of sourceFile.statements) {
      if (!ts.isImportDeclaration(statement) || !ts.isStringLiteral(statement.moduleSpecifier)) {
        continue;
      }
      const target = resolveModule(sourceFile, statement.moduleSpecifier.text);
      if (!target) continue;
      const clause = statement.importClause;
      if (clause?.name) {
        named.set(clause.name.text, { source: target, imported: "default" });
      }
      const bindings = clause?.namedBindings;
      if (bindings && ts.isNamedImports(bindings)) {
        for (const element of bindings.elements) {
          named.set(element.name.text, {
            source: target,
            imported: element.propertyName?.text ?? element.name.text,
          });
        }
      } else if (bindings && ts.isNamespaceImport(bindings)) {
        namespaces.set(bindings.name.text, target);
      }
    }
    importBindings.set(sourceFile, { named, namespaces });
  }
  const resolveImportedFunction = (expression: ts.Expression): LocalFunction | null => {
    const imports = importBindings.get(expression.getSourceFile());
    if (!imports) return null;
    if (ts.isIdentifier(expression)) {
      const imported = imports.named.get(expression.text);
      return imported ? exportedFunction(imported.source, imported.imported) : null;
    }
    if (ts.isPropertyAccessExpression(expression) && ts.isIdentifier(expression.expression)) {
      const source = imports.namespaces.get(expression.expression.text);
      return source ? exportedFunction(source, expression.name.text) : null;
    }
    return null;
  };
  const targetByExpression = new WeakMap<ts.Expression, LocalFunction | null>();
  const resolveFunctionExpression = (expression: ts.Expression): LocalFunction | null => {
    if (targetByExpression.has(expression)) return targetByExpression.get(expression) ?? null;
    const target =
      resolveLocalFunction(context.checker, sourceFiles, expression) ??
      resolveImportedFunction(expression);
    targetByExpression.set(expression, target);
    return target;
  };
  const functions = new Set<LocalFunction>();
  const callNodes: ts.CallExpression[] = [];
  const constructionNodes: ts.NewExpression[] = [];
  const walk = (node: ts.Node): void => {
    if (isLocalFunction(node)) functions.add(node);
    if (ts.isCallExpression(node)) callNodes.push(node);
    if (ts.isNewExpression(node)) constructionNodes.push(node);
    ts.forEachChild(node, walk);
  };
  for (const sourceFile of context.sourceFiles) walk(sourceFile);

  const targetByCall = new Map<ts.CallExpression, LocalFunction | null>();
  const calls = callNodes.map((node): LocalCallSite => {
    const target = resolveFunctionExpression(node.expression);
    targetByCall.set(node, target);
    return {
      node,
      owner: containingLocalFunction(node),
      target,
    };
  });
  const graph: LocalCallGraph = {
    calls,
    constructions: constructionNodes.map((node) => ({
      node,
      owner: containingLocalFunction(node),
    })),
    functions,
    functionForCall(call) {
      return targetByCall.get(call) ?? null;
    },
    functionForExpression(expression) {
      return resolveFunctionExpression(expression);
    },
  };
  CALL_GRAPH_CACHE.set(context.program, graph);
  return graph;
}

function addAll<Value>(target: Set<Value>, source: ReadonlySet<Value>): boolean {
  let changed = false;
  for (const value of source) {
    if (target.has(value)) continue;
    target.add(value);
    changed = true;
  }
  return changed;
}

export function summarizeTransitiveCalls<Value extends string>(
  context: WorkspaceAnalysisContext,
  classifyDirectOperation: (
    node: ts.CallExpression | ts.NewExpression,
  ) => DirectCallFact<Value> | null,
  callIsUnstable: (call: ts.CallExpression, owner: LocalFunction) => boolean,
): TransitiveCallSummary<Value> {
  const graph = localCallGraph(context);
  const mutable = new Map<LocalFunction, { values: Set<Value>; unstableValues: Set<Value> }>();
  const reverseEdges = new Map<LocalFunction, Array<{ owner: LocalFunction; unstable: boolean }>>();
  const ensure = (fn: LocalFunction) => {
    const existing = mutable.get(fn);
    if (existing) return existing;
    const created = { values: new Set<Value>(), unstableValues: new Set<Value>() };
    mutable.set(fn, created);
    return created;
  };
  for (const fn of graph.functions) ensure(fn);

  for (const site of graph.calls) {
    if (!site.owner) continue;
    const direct = classifyDirectOperation(site.node);
    if (direct) {
      const summary = ensure(site.owner);
      summary.values.add(direct.value);
      if (direct.unstable) summary.unstableValues.add(direct.value);
    }
    if (!site.target) continue;
    const incoming = reverseEdges.get(site.target) ?? [];
    incoming.push({
      owner: site.owner,
      unstable: callIsUnstable(site.node, site.owner),
    });
    reverseEdges.set(site.target, incoming);
  }
  for (const site of graph.constructions) {
    if (!site.owner) continue;
    const direct = classifyDirectOperation(site.node);
    if (!direct) continue;
    const summary = ensure(site.owner);
    summary.values.add(direct.value);
    if (direct.unstable) summary.unstableValues.add(direct.value);
  }

  const queue = [...graph.functions];
  const queued = new Set(queue);
  for (let index = 0; index < queue.length; index += 1) {
    const callee = queue[index]!;
    queued.delete(callee);
    const calleeSummary = ensure(callee);
    for (const edge of reverseEdges.get(callee) ?? []) {
      const ownerSummary = ensure(edge.owner);
      let changed = addAll(ownerSummary.values, calleeSummary.values);
      changed =
        addAll(
          ownerSummary.unstableValues,
          edge.unstable ? calleeSummary.values : calleeSummary.unstableValues,
        ) || changed;
      if (changed && !queued.has(edge.owner)) {
        queue.push(edge.owner);
        queued.add(edge.owner);
      }
    }
  }

  return {
    byFunction: mutable,
    forCall(call) {
      const target = graph.functionForCall(call);
      return target ? (mutable.get(target) ?? null) : null;
    },
  };
}
