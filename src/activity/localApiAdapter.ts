import * as http from 'node:http';
import * as vscode from 'vscode';
import { AgentPipeline } from '../pipeline/types';
import { ActivityStore } from './store';
import { createLocalApiPayload, createWebhookPayload, LocalApiStatus } from './localApi';

export interface LocalApiAdapterOptions {
  pipelineProvider(): Promise<AgentPipeline | undefined>;
  log?(message: string): void;
}

export function startLocalApiAdapter(store: ActivityStore, options: LocalApiAdapterOptions): vscode.Disposable {
  const controller = new LocalApiController(store, options);
  controller.restart().catch((error) => options.log?.(`Local API failed to start: ${(error as Error).message}`));
  const configuration = vscode.workspace.onDidChangeConfiguration((event) => {
    if (!event.affectsConfiguration('agentflow.localApi') && !event.affectsConfiguration('agentflow.webhooks')) return;
    controller.restart().catch((error) => options.log?.(`Local API failed to restart: ${(error as Error).message}`));
  });
  return new vscode.Disposable(() => {
    configuration.dispose();
    controller.dispose();
  });
}

class LocalApiController {
  private server: http.Server | undefined;
  private status: LocalApiStatus = { enabled: false, host: '127.0.0.1', port: 0 };
  private webhookInitialized = false;
  private readonly seenWebhookEvents = new Set<string>();
  private readonly activitySubscription: vscode.Disposable;

  constructor(private readonly store: ActivityStore, private readonly options: LocalApiAdapterOptions) {
    this.activitySubscription = store.subscribe((events) => this.sendWebhookEvents(events).catch((error) => this.options.log?.(`Agent Flow webhook failed: ${(error as Error).message}`)));
  }

  async restart(): Promise<void> {
    this.disposeServer();
    const enabled = vscode.workspace.getConfiguration('agentflow.localApi').get<boolean>('enabled') ?? false;
    const configuredPort = vscode.workspace.getConfiguration('agentflow.localApi').get<number>('port') ?? 0;
    if (!enabled) {
      this.status = { enabled: false, host: '127.0.0.1', port: 0 };
      return;
    }
    const server = http.createServer((request, response) => {
      this.handleRequest(request, response).catch((error) => {
        response.writeHead(500, { 'content-type': 'application/json' });
        response.end(JSON.stringify({ error: (error as Error).message }));
      });
    });
    await new Promise<void>((resolve, reject) => {
      server.once('error', reject);
      server.listen(configuredPort, '127.0.0.1', () => resolve());
    });
    const address = server.address();
    const port = typeof address === 'object' && address ? address.port : configuredPort;
    this.server = server;
    this.status = { enabled: true, host: '127.0.0.1', port };
    this.options.log?.(`Agent Flow local API listening on http://127.0.0.1:${port}`);
  }

  dispose(): void {
    this.disposeServer();
    this.activitySubscription.dispose();
  }

  private disposeServer(): void {
    this.server?.close();
    this.server = undefined;
  }

  private async handleRequest(request: http.IncomingMessage, response: http.ServerResponse): Promise<void> {
    if (request.method !== 'GET') {
      response.writeHead(405, { 'content-type': 'application/json' });
      response.end(JSON.stringify({ error: 'method not allowed' }));
      return;
    }
    const url = new URL(request.url ?? '/', 'http://127.0.0.1');
    const pipeline = await this.options.pipelineProvider();
    if (!pipeline) {
      response.writeHead(503, { 'content-type': 'application/json' });
      response.end(JSON.stringify({ error: 'open a workspace before using Agent Flow local API' }));
      return;
    }
    const payload = createLocalApiPayload(url.pathname, { pipeline, events: this.store.getEvents(), status: this.status });
    if (payload === undefined) {
      response.writeHead(404, { 'content-type': 'application/json' });
      response.end(JSON.stringify({ error: 'not found' }));
      return;
    }
    response.writeHead(200, { 'content-type': 'application/json', 'cache-control': 'no-store' });
    response.end(JSON.stringify(payload));
  }

  private async sendWebhookEvents(events: readonly ReturnType<ActivityStore['getEvents']>[number][]): Promise<void> {
    const enabled = vscode.workspace.getConfiguration('agentflow.webhooks').get<boolean>('enabled') ?? false;
    const url = vscode.workspace.getConfiguration('agentflow.webhooks').get<string>('url')?.trim();
    if (!enabled || !url) return;
    if (!this.webhookInitialized) {
      for (const event of events) this.seenWebhookEvents.add(event.id);
      this.webhookInitialized = true;
      return;
    }
    const nextEvents = events.filter((event) => !this.seenWebhookEvents.has(event.id));
    for (const event of nextEvents) {
      this.seenWebhookEvents.add(event.id);
      await fetch(url, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(createWebhookPayload(event))
      });
    }
  }
}
