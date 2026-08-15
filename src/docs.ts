import fs from "node:fs/promises";
import path from "node:path";
import ts from "typescript";

export interface DocsDiagnostic {
  package: string;
  entrypoint: string;
  symbol: string;
  declaration: string;
  missing: string;
}

export interface DocsMember {
  name: string;
  summary: string;
  remarks?: string;
  tags: Record<string, string[]>;
  signature: string;
}

export interface DocsSymbol {
  name: string;
  entrypoint: string;
  declaration: string;
  summary: string;
  remarks?: string;
  tags: Record<string, string[]>;
  signature: string;
  members: DocsMember[];
}

export interface DocsSnapshot {
  package: string;
  version?: string;
  generatedBy: "askr docs snapshot";
  symbols: DocsSymbol[];
}

interface PackageJson {
  name?: string;
  version?: string;
  exports?: unknown;
}

const text = (parts: readonly ts.SymbolDisplayPart[]): string =>
  ts.displayPartsToString([...parts]).trim();

const commentText = (comment: unknown): string =>
  typeof comment === "string" ? comment.trim() : comment ? String(comment).trim() : "";

function tagsFor(symbol: ts.Symbol, checker: ts.TypeChecker): Record<string, string[]> {
  const result: Record<string, string[]> = {};
  for (const tag of symbol.getJsDocTags(checker)) {
    const value =
      typeof tag.text === "string" ? tag.text : ts.displayPartsToString([...(tag.text ?? [])]);
    (result[tag.name] ??= []).push(value.trim());
  }
  return result;
}

function declarationFor(symbol: ts.Symbol): ts.Declaration | undefined {
  return symbol.declarations?.find((declaration) =>
    /\.d\.(?:ts|mts|cts)$/.test(declaration.getSourceFile().fileName),
  );
}

function signatureFor(symbol: ts.Symbol, checker: ts.TypeChecker): string {
  const declaration = declarationFor(symbol);
  if (!declaration) return symbol.name;
  if (ts.isTypeAliasDeclaration(declaration)) {
    return `${symbol.name}: ${declaration.type.getText(declaration.getSourceFile())}`;
  }
  if (
    ts.isInterfaceDeclaration(declaration) ||
    ts.isClassDeclaration(declaration) ||
    ts.isEnumDeclaration(declaration)
  ) {
    return declaration.getText(declaration.getSourceFile());
  }
  const type = checker.getTypeOfSymbolAtLocation(symbol, declaration);
  return `${symbol.name}: ${checker.typeToString(
    type,
    declaration,
    ts.TypeFormatFlags.NoTruncation | ts.TypeFormatFlags.UseAliasDefinedOutsideCurrentScope,
  )}`;
}

function memberDocs(symbol: ts.Symbol, checker: ts.TypeChecker): DocsMember[] {
  const declaration = declarationFor(symbol);
  if (!declaration) return [];
  if (ts.isVariableDeclaration(declaration)) {
    const type = checker.getTypeOfSymbolAtLocation(symbol, declaration);
    return type.getProperties().flatMap((property) => {
      const propertyDeclaration = declarationFor(property);
      if (!propertyDeclaration) return [];
      const summary = text(property.getDocumentationComment(checker));
      return [
        {
          name: property.name,
          summary,
          tags: tagsFor(property, checker),
          signature: checker.typeToString(
            checker.getTypeOfSymbolAtLocation(property, propertyDeclaration),
            propertyDeclaration,
          ),
        },
      ];
    });
  }
  if (
    !(
      ts.isInterfaceDeclaration(declaration) ||
      ts.isClassDeclaration(declaration) ||
      ts.isEnumDeclaration(declaration) ||
      ts.isTypeLiteralNode(declaration)
    )
  )
    return [];
  const members = ts.isEnumDeclaration(declaration)
    ? declaration.members
    : ts.isTypeLiteralNode(declaration)
      ? declaration.members
      : declaration.members;
  return members.flatMap((member) => {
    const name = member.name && ts.isIdentifier(member.name) ? member.name.text : undefined;
    if (!name) return [];
    const docs = ts.getJSDocCommentsAndTags(member);
    const summary = docs
      .filter(ts.isJSDoc)
      .map((doc) => commentText(doc.comment))
      .filter(Boolean)
      .join("\n");
    const tags: Record<string, string[]> = {};
    for (const tag of docs) {
      if (!("tagName" in tag)) continue;
      const name = (tag as ts.JSDocTag).tagName.text;
      (tags[name] ??= []).push(tag.comment ? String(tag.comment) : "");
    }
    return [{ name, summary, tags, signature: member.getText(member.getSourceFile()) }];
  });
}

function resolveTypes(value: unknown, out: string[]): void {
  if (typeof value === "string") out.push(value);
  else if (value && typeof value === "object") {
    for (const [key, child] of Object.entries(value)) {
      if (key === "types") resolveTypes(child, out);
      else if (
        key !== "default" &&
        key !== "import" &&
        key !== "require" &&
        key !== "node" &&
        key !== "browser"
      )
        resolveTypes(child, out);
    }
  }
}

async function walk(directory: string): Promise<string[]> {
  const entries = await fs.readdir(directory, { withFileTypes: true });
  const files: string[] = [];
  for (const entry of entries) {
    const current = path.join(directory, entry.name);
    if (entry.isDirectory()) files.push(...(await walk(current)));
    else files.push(current);
  }
  return files;
}

async function declarationEntrypoints(
  root: string,
  pkg: PackageJson,
): Promise<{ name: string; file: string }[]> {
  const targets: string[] = [];
  resolveTypes(pkg.exports, targets);
  if (targets.length === 0)
    targets.push("./dist/index.d.ts", "./dist/index.d.mts", "./dist/index.d.cts");
  const files = await walk(root);
  const result: { name: string; file: string }[] = [];
  for (const target of new Set(targets)) {
    if (!target.endsWith(".d.ts") && !target.endsWith(".d.mts") && !target.endsWith(".d.cts"))
      continue;
    if (target.includes("*")) {
      const prefix = target.slice(0, target.indexOf("*"));
      const suffix = target.slice(target.indexOf("*") + 1);
      for (const file of files)
        if (file.startsWith(path.resolve(root, prefix)) && file.endsWith(suffix))
          result.push({ name: target, file });
    } else {
      const file = path.resolve(root, target);
      if (files.includes(file)) result.push({ name: target, file });
    }
  }
  return result;
}

export async function inspectDocs(
  root = process.cwd(),
): Promise<{ snapshot: DocsSnapshot; diagnostics: DocsDiagnostic[] }> {
  const pkg = JSON.parse(await fs.readFile(path.join(root, "package.json"), "utf8")) as PackageJson;
  const entries = await declarationEntrypoints(root, pkg);
  const program = ts.createProgram(
    entries.map((entry) => entry.file),
    { allowJs: false, skipLibCheck: true, moduleResolution: ts.ModuleResolutionKind.Bundler },
  );
  const checker = program.getTypeChecker();
  const symbols: DocsSymbol[] = [];
  const diagnostics: DocsDiagnostic[] = [];
  for (const entry of entries) {
    const source = program.getSourceFile(entry.file);
    const module = source && checker.getSymbolAtLocation(source);
    if (!module) continue;
    for (const exported of checker.getExportsOfModule(module)) {
      const symbol =
        exported.flags & ts.SymbolFlags.Alias ? checker.getAliasedSymbol(exported) : exported;
      const declaration = declarationFor(symbol) ?? declarationFor(exported);
      if (!declaration) continue;
      const summary = text(symbol.getDocumentationComment(checker));
      const tags = tagsFor(symbol, checker);
      const signature = signatureFor(symbol, checker);
      const members = memberDocs(symbol, checker);
      const declarationPath = path.relative(root, declaration.getSourceFile().fileName);
      const base = {
        package: pkg.name ?? path.basename(root),
        entrypoint: entry.name,
        symbol: exported.name,
        declaration: declarationPath,
      };
      if (!summary || summary === exported.name) diagnostics.push({ ...base, missing: "summary" });
      const type = checker.getTypeOfSymbolAtLocation(symbol, declaration);
      for (const signatureInfo of type.getCallSignatures()) {
        for (const parameter of signatureInfo.parameters) {
          const documented = tags.param?.some((value) => {
            const firstToken = value.trim().split(/\s+/, 1)[0] ?? "";
            return firstToken.replace(/^\{[^}]+\}\s*/, "") === parameter.name;
          });
          if (!documented) diagnostics.push({ ...base, missing: `@param ${parameter.name}` });
        }
        if (signatureInfo.getReturnType().flags !== ts.TypeFlags.Void && !tags.returns)
          diagnostics.push({ ...base, missing: "@returns" });
      }
      for (const member of members)
        if (!member.summary || member.summary === member.name)
          diagnostics.push({
            ...base,
            symbol: `${exported.name}.${member.name}`,
            missing: "member summary",
          });
      symbols.push({
        name: exported.name,
        entrypoint: entry.name,
        declaration: declarationPath,
        summary,
        ...(tags.remarks ? { remarks: tags.remarks.join("\n") } : {}),
        tags,
        signature,
        members,
      });
    }
  }
  symbols.sort((a, b) => `${a.entrypoint}:${a.name}`.localeCompare(`${b.entrypoint}:${b.name}`));
  diagnostics.sort((a, b) =>
    `${a.entrypoint}:${a.symbol}:${a.missing}`.localeCompare(
      `${b.entrypoint}:${b.symbol}:${b.missing}`,
    ),
  );
  return {
    snapshot: {
      package: pkg.name ?? path.basename(root),
      version: pkg.version,
      generatedBy: "askr docs snapshot",
      symbols,
    },
    diagnostics,
  };
}
