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

const version = readFileSync('../version').toString().trim();

const playParser = z.object({ whatdo: z.literal('play') });
const pauseAndReportWhen = z.object({ whatdo: z.literal('pauseAndReportWhen') });
const pauseParser = z.object({
    whatdo: z.literal('pause'),
    when: z.number(),
});

const desiredParser = z.discriminatedUnion('whatdo', [
    playParser,
    pauseAndReportWhen,
    pauseParser,
]);

type Desired = z.infer<typeof desiredParser>;

type EventsFromClients = {
    connect: (id: string) => void;
    announce: (id: string, reconnecting: null | { when: number }) => void;
    disconnect: (id: string) => void;
    play: () => void;
    pause: (when: number) => void;
    reportReady: (id: string, when: number) => void;
    reportWhen: (id: string, when: number) => void;
};

export const fromClients = new EventEmitter() as TypedEventEmitter<EventsFromClients>;

const desiredReceivers = new Map<string, Observer<Desired, unknown>>();

export function getViewers() {
    return [...desiredReceivers.keys()];
}

export function unicast(id: string, desired: Desired) {
    const receiver = desiredReceivers.get(id);
    if (!receiver) return;
    console.log(`Sending ${inspect(desired)} to ${id}`);
    receiver.next(desired);
}

export function broadcast(desired: Desired) {
    console.log(`Broadcasting ${inspect(desired)}`);
    for (const receiver of desiredReceivers.values()) {
        receiver.next(desired);
    }
}

const createContext = async (opts: CreateWSSContextFnOptions) => {
    const ws = opts.res;
    const id = crypto.randomUUID();
    console.log(`${id} joins the party`);
    opts.res.once('close', () => console.log(`${id} left the party`));
    return { id, ws };
};

const t = initTRPC.context<typeof createContext>().create();
const router = t.router;

const appRouter = router({
    announce: t.procedure
        .input(z.object({
            reconnecting: z.object({ when: z.number() }).nullable(),
        }))
        .output(z.object({ version: z.string() }))
        .mutation(req => {
            console.log(`announce from ${req.ctx.id}`);
            fromClients.emit('announce', req.ctx.id, req.input.reconnecting);
            return { version };
        }),

    play: t.procedure
        .input(z.null())
        .mutation(req => {
            console.log(`play from ${req.ctx.id}`);
            fromClients.emit('play');
        }),

    pause: t.procedure
        .input(z.object({ when: z.number() }))
        .mutation(req => {
            console.log(`pause at ${req.input.when} from ${req.ctx.id}`);
            fromClients.emit('pause', req.input.when);
        }),

    ready: t.procedure
        .input(z.object({ when: z.number() }))
        .mutation(req => {
            console.log(`ready at ${req.input.when} from ${req.ctx.id}`);
            fromClients.emit('reportReady', req.ctx.id, req.input.when);
        }),

    reportWhen: t.procedure
        .input(z.object({ when: z.number() }))
        .mutation(req => {
            console.log(`reportWhen at ${req.input.when} from ${req.ctx.id}`);
            fromClients.emit('reportWhen', req.ctx.id, req.input.when);
        }),

    desired: t.procedure
        .input(z.null())
        .subscription(req => observable<Desired>(emit => {
            console.log(`subscribe desired from ${req.ctx.id}`);
            desiredReceivers.set(req.ctx.id, emit);
            fromClients.emit('connect', req.ctx.id);
            return () => {
                console.log(`unsubscribe desired from ${req.ctx.id}`);
                fromClients.emit('disconnect', req.ctx.id);
                desiredReceivers.delete(req.ctx.id);
            };
        })),
});

export type AppRouter = typeof appRouter;

export function startServer() {
    const wss = new ws.WebSocketServer({ port: 13579 });
    const handler = applyWSSHandler({ wss, router: appRouter, createContext })

    process.on('SIGTERM', () => {
        handler.broadcastReconnectNotification();
        wss.close();
    });
}
