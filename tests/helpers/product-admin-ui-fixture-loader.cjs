// Test-only TS/TSX loader. transpileModule strips `import type` before webpack resolves imports.
const ts = require('typescript');
module.exports = function productAdminFixtureLoader(source) {
  const result = ts.transpileModule(source, {
    fileName: this.resourcePath,
    compilerOptions: {
      target: ts.ScriptTarget.ES2020,
      module: ts.ModuleKind.ESNext,
      jsx: ts.JsxEmit.ReactJSX,
      esModuleInterop: true,
      isolatedModules: true,
      sourceMap: false,
    },
    reportDiagnostics: true,
  });
  const errors = (result.diagnostics || []).filter(item => item.category === ts.DiagnosticCategory.Error);
  if (errors.length) throw new Error(ts.formatDiagnosticsWithColorAndContext(errors, {
    getCanonicalFileName: name => name, getCurrentDirectory: () => process.cwd(), getNewLine: () => '\n',
  }));
  return result.outputText;
};
