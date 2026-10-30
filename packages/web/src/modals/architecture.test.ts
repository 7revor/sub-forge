import { readFileSync, readdirSync } from 'node:fs';
import { join, relative } from 'node:path';
import ts from 'typescript';
import { describe, expect, it } from 'vitest';
const root = new URL('../', import.meta.url).pathname;
function files(dir: string): string[] { return readdirSync(dir, { withFileTypes: true }).flatMap(entry => entry.isDirectory() ? files(join(dir, entry.name)) : /\.tsx?$/.test(entry.name) && !entry.name.includes('.test.') ? [join(dir, entry.name)] : []); }
describe('弹窗架构硬性规则', () => {
  it('仅统一运行时可接入底层弹窗，不允许新增并行封装或业务 JSX 挂载', () => {
    const violations: string[] = [];
    for (const path of files(root)) {
      const name = relative(root, path); const source = readFileSync(path, 'utf8');
      if (name === 'components/ui/dialog.tsx' || name === 'modals/index.tsx') continue;
      const ast = ts.createSourceFile(path, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
      const fail = (node: ts.Node, rule: string) => violations.push(`${name}:${ast.getLineAndCharacterOfPosition(node.getStart()).line + 1} ${rule}`);
      const visit = (node: ts.Node) => {
        if (ts.isImportDeclaration(node)) {
          const module = (node.moduleSpecifier as ts.StringLiteral).text;
          if (/(?:^|\/)(?:dialog|alert-dialog|useDialogDraft|useDialogPresentation)\.tsx?$/.test(module) || /(?:react-dialog|react-alert-dialog|nice-modal)/.test(module)) fail(node, '禁止直接接入其他弹窗封装');
          if (module === 'radix-ui' && /\b(?:Dialog|AlertDialog)\b/.test(node.importClause?.getText() ?? '')) fail(node, '禁止业务直接使用 Radix 弹窗');
        }
        if (ts.isJsxOpeningElement(node) || ts.isJsxSelfClosingElement(node)) {
          const tag = node.tagName.getText();
          if (tag === 'dialog' || tag === 'Dialog' || tag === 'AlertDialog' || (/^(?!ModalRoot$|ModalHost$|ModalErrorBoundary$).*(?:Modal|Dialog)$/.test(tag))) fail(node, '业务页面只能调用静态 show / Frame.modal，不能挂载弹窗');
          if (node.attributes.properties.some(p => ts.isJsxAttribute(p) && p.name.getText() === 'role' && /["'](?:dialog|alertdialog)["']/.test(p.initializer?.getText() ?? ''))) fail(node, '禁止自行实现弹窗容器');
        }
        if (ts.isCallExpression(node)) {
          if (/^(?:window\.)?(?:alert|confirm|prompt)$/.test(node.expression.getText())) fail(node, '禁止原生交互弹窗');
          // DualEditor 仅把视图切换按钮移到外层工具栏，不是弹窗。
          const toolbarPortal = name === 'components/DualEditor.tsx' && node.expression.getText() === 'createPortal' && node.arguments[1]?.getText() === 'modeControlContainer';
          if (/^(?:createRoot|createPortal)$/.test(node.expression.getText()) && name !== 'main.tsx' && !toolbarPortal) fail(node, '禁止自行挂载 React 根或 Portal');
        }
        ts.forEachChild(node, visit);
      };
      visit(ast);
    }
    expect(violations).toEqual([]);
  });
});
