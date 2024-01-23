import https from 'https'
import http from 'http'
import ws, { WebSocketServer } from "ws";
import { readFileSync } from 'fs';
import { applyWSSHandler } from '@trpc/server/adapters/ws';
import { createViewerContext, stopViewerSubscriptions, viewerRouter } from './viewerTrpc';
import { controllerRouter, createControllerContext } from './controllerTrpc';

let viewerWss: ws.WebSocketServer | undefined;
let controllerWss: ws.WebSocketServer | undefined;
let broadcastReconnectNotification: (() => void) | undefined;

export function startServer() {
    const host = '0.0.0.0';
    const port = 13579;

    let server: http.Server;
    if (process.env.SSL_CERT || process.env.SSL_KEY) {
        if (!process.env.SSL_CERT) {
            console.error('FATAL: SSL_KEY variable found but SSL_CERT variable missing');
            process.exit(1);
        }
        if (!process.env.SSL_KEY) {
            console.error('FATAL: SSL_CERT variable found but SSL_KEY variable missing');
            process.exit(1);
        }

        console.log(`Starting WSS server on ${host}:${port}`);
        server = https.createServer({
            cert: readFileSync(process.env.SSL_CERT),
            key: readFileSync(process.env.SSL_KEY),
        }).listen(port, host);
    }
    else {
        console.log(`Starting WS server on ${host}:${port}`);
        server = http.createServer().listen(port, host);
    }

    viewerWss = new ws.WebSocketServer({ noServer: true });
    controllerWss = new ws.WebSocketServer({ noServer: true });

    server.on('upgrade', (req, socket, head) => {
        const { pathname } = new URL(req.url ?? '', 'http://bogus');

        let wss: WebSocketServer | undefined;
        switch (pathname) {
            case '/viewer': wss = viewerWss; break;
            case '/controller': wss = controllerWss; break;
            default: socket.destroy(); return;
        }

        wss?.handleUpgrade(req, socket, head, ws => {
            wss?.emit('connection', ws, req);
        });
    });

    const viewerHandler = applyWSSHandler({
        wss: viewerWss,
        router: viewerRouter,
        createContext: createViewerContext,
    });

    const controllerHandler = applyWSSHandler({
        wss: controllerWss,
        router: controllerRouter,
        createContext: createControllerContext,
    });

    broadcastReconnectNotification = () => {
        viewerHandler.broadcastReconnectNotification();
        controllerHandler.broadcastReconnectNotification();
    };

    process.on('SIGTERM', stopServer);
}

export function stopServer() {
    console.log('Stopping server');
    stopViewerSubscriptions();
    broadcastReconnectNotification?.();
    viewerWss?.close();
    controllerWss?.close();
    setTimeout(() => process.exit(0), 500);
}
