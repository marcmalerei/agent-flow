declare module 'node:fs/promises' {
  export function access(path: string): Promise<void>;
  export function readFile(path: string, encoding: string): Promise<string>;
  export function writeFile(path: string, data: string, encoding: string): Promise<void>;
  export function mkdir(path: string, options?: { recursive?: boolean }): Promise<void>;
  export function readdir(path: string, options?: { withFileTypes?: boolean }): Promise<Array<{ name: string; isDirectory(): boolean }>>;
}

declare module 'node:path' {
  export function join(...paths: string[]): string;
  export function dirname(path: string): string;
  export function basename(path: string, suffix?: string): string;
  export function relative(from: string, to: string): string;
}

declare module 'vscode' {
  export interface Disposable { dispose(): void }
  export interface ExtensionContext { subscriptions: Disposable[]; extensionPath: string }
  export interface Uri { fsPath: string }
  export namespace Uri { export function file(path: string): Uri }
  export enum ViewColumn { One = 1 }
  export interface Webview { html: string; cspSource: string; asWebviewUri(uri: Uri): Uri; onDidReceiveMessage(listener: (message: any) => any): Disposable }
  export namespace window {
    export function showInformationMessage(message: string, ...items: any[]): Thenable<any>;
    export function showWarningMessage(message: string, ...items: any[]): Thenable<any>;
    export function showErrorMessage(message: string): Thenable<any>;
    export function createWebviewPanel(viewType: string, title: string, column: ViewColumn, options: any): { webview: Webview };
    export function showTextDocument(document: any, options?: any): Thenable<any>;
  }
  export namespace workspace {
    export const workspaceFolders: Array<{ uri: Uri }> | undefined;
    export function openTextDocument(options: { language?: string; content: string }): Thenable<any>;
  }
  export namespace commands {
    export function registerCommand(command: string, callback: (...args: any[]) => any): Disposable;
    export function executeCommand(command: string, ...args: any[]): Thenable<any>;
  }
  export namespace env { export const clipboard: { writeText(value: string): Thenable<void> } }
}

declare module 'react' { export function useMemo<T>(factory: () => T, deps: unknown[]): T; export function useState<T>(initial: T): [T, (value: T) => void]; const React: any; export default React; }
declare module 'react-dom/client' { export function createRoot(element: Element): { render(node: unknown): void } }
declare module '@xyflow/react' { export interface Node { id: string; position: { x: number; y: number }; data?: any; style?: any } export interface Edge { id: string; source: string; target: string; label?: string; animated?: boolean } export const Background: any; export const Controls: any; export const MiniMap: any; const ReactFlow: any; export default ReactFlow; }
declare module 'react/jsx-runtime' { export const jsx: any; export const jsxs: any; export const Fragment: any }
declare module '*.css';

declare namespace JSX { interface IntrinsicElements { [elemName: string]: any } }
