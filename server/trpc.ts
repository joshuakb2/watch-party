import { initTRPC } from '@trpc/server';
import { applyWSSHandler, CreateWSSContextFnOptions } from '@trpc/server/adapters/ws';
import { Observer, observable } from '@trpc/server/observable';
import * as ws from 'ws';
import { z } from 'zod';
import TypedEventEmitter from 'typed-emitter';
import EventEmitter from 'events';
import crypto from 'crypto';
import { readFileSync } from 'fs';
import { inspect } from 'util';
import * as http from 'http';
import * as https from 'https';

const version = readFileSync('../version').toString().trim();

type Desired = {
    whatdo: 'play' | 'pauseAndReportWhen';
} | {
    whatdo: 'pause';
    when: number;
} | {
    whatdo: 'gtfo';
};

type Notification = string;

type EventsFromClients = {
    join: (ctx: ClientContext, reconnecting: null | { when: number }) => void;
    leave: (ctx: ClientContext) => void;
    play: () => void;
    pause: (when: number) => void;
    reportReady: (ctx: ClientContext, when: number) => void;
    reportWhen: (ctx: ClientContext, when: number) => void;
};

export const fromClients = new EventEmitter() as TypedEventEmitter<EventsFromClients>;

const desiredReceivers = new Map<ClientContext, {
    ws: ws.WebSocket;
    observer: Observer<Desired, unknown>;
}>();
const notificationReceivers = new Map<ClientContext, Observer<Notification, unknown>>();

export function getViewers() {
    return [...desiredReceivers.keys()].map(x => x.id);
}

export function unicast(ctx: ClientContext, desired: Desired) {
    const { observer } = [...desiredReceivers].find(([x]) => x === ctx)?.[1] ?? {};
    if (!observer) return;
    console.log(`Sending ${inspect(desired)} to ${ctx.shown}`);
    observer.next(desired);
}

export function broadcast(desired: Desired) {
    console.log(`Broadcasting ${inspect(desired)}`);
    for (const [ctx, { observer }] of desiredReceivers) {
        if (ctx.name) {
            observer.next(desired);
        }
    }
}

export function notify(notification: Notification) {
    for (const [ctx, observer] of notificationReceivers) {
        if (ctx.name) {
            observer.next(notification);
        }
    }
}

export function kick(who: 'everyone' | string[]) {
    const msg = { whatdo: 'gtfo' } as const;

    const ctxs = who === 'everyone'
        ? [...desiredReceivers.keys()]
        : [...desiredReceivers.keys()].filter(x => who.some(id => x.id === id));

    for (const ctx of ctxs) {
        unicast(ctx, msg);

        const { ws } = desiredReceivers.get(ctx) ?? {};
        if (!ws) continue;

        ws.close();
    }
}

const createContext = async (opts: CreateWSSContextFnOptions) => {
    const ws = opts.res;
    const id = crypto.randomUUID();
    const name = null as null | string;

    return {
        id,
        ws,
        name,
        get shown() {
            if (this.name) {
                return `${this.name} (${this.id})`;
            }
            else {
                return this.id;
            }
        },
    };
};

export type ClientContext = Awaited<ReturnType<typeof createContext>>;

const t = initTRPC.context<typeof createContext>().create();
const router = t.router;

const appRouter = router({
    announce: t.procedure
        .input(z.object({
            name: z.string(),
            reconnecting: z.object({ when: z.number() }).nullable(),
        }))
        .output(z.object({ version: z.string() }))
        .mutation(req => {
            req.ctx.name = req.input.name;
            console.log(`announce from ${req.ctx.id}: name = ${req.input.name}, reconnecting = ${inspect(req.input.reconnecting)}`);
            fromClients.emit('join', req.ctx, req.input.reconnecting);
            return { version };
        }),

    play: t.procedure
        .input(z.null())
        .mutation(req => {
            console.log(`play from ${req.ctx.shown}`);
            fromClients.emit('play');
        }),

    pause: t.procedure
        .input(z.object({ when: z.number() }))
        .mutation(req => {
            console.log(`pause at ${req.input.when} from ${req.ctx.shown}`);
            fromClients.emit('pause', req.input.when);
        }),

    ready: t.procedure
        .input(z.object({ when: z.number() }))
        .mutation(req => {
            console.log(`ready at ${req.input.when} from ${req.ctx.shown}`);
            fromClients.emit('reportReady', req.ctx, req.input.when);
        }),

    reportWhen: t.procedure
        .input(z.object({ when: z.number() }))
        .mutation(req => {
            console.log(`reportWhen at ${req.input.when} from ${req.ctx.shown}`);
            fromClients.emit('reportWhen', req.ctx, req.input.when);
        }),

    desired: t.procedure
        .input(z.null())
        .subscription(req => observable<Desired>(observer => {
            console.log(`subscribe desired from ${req.ctx.shown}`);
            desiredReceivers.set(req.ctx, { ws: req.ctx.ws, observer });
            return () => {
                console.log(`unsubscribe desired from ${req.ctx.shown}`);
                desiredReceivers.delete(req.ctx);

                if (req.ctx.name) {
                    fromClients.emit('leave', req.ctx);
                }
            };
        })),

    notifications: t.procedure
        .input(z.null())
        .subscription(req => observable<Notification>(emit => {
            notificationReceivers.set(req.ctx, emit);
            return () => {
                notificationReceivers.delete(req.ctx);
            };
        })),
});

export type AppRouter = typeof appRouter;

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

    const wss = new ws.WebSocketServer({ server });
    const handler = applyWSSHandler({ wss, router: appRouter, createContext })

    process.on('SIGTERM', () => {
        handler.broadcastReconnectNotification();
        wss.close();
    });
}
