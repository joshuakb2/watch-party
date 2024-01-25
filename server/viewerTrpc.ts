import { initTRPC } from '@trpc/server';
import { CreateWSSContextFnOptions } from '@trpc/server/adapters/ws';
import { Observer, observable } from '@trpc/server/observable';
import * as ws from 'ws';
import { z } from 'zod';
import TypedEventEmitter from 'typed-emitter';
import EventEmitter from 'events';
import crypto from 'crypto';
import { readFileSync } from 'fs';
import { inspect } from 'util';

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

type EventsFromViewers = {
    join: (ctx: ViewerContext, reconnecting: null | { when: number }) => void;
    leave: (ctx: ViewerContext) => void;
    play: () => void;
    pause: (when: number) => void;
    reportReady: (ctx: ViewerContext, when: number) => void;
    reportWhen: (ctx: ViewerContext, when: number) => void;
};

export const fromViewers = new EventEmitter() as TypedEventEmitter<EventsFromViewers>;

type EventsFromControllers = {
    cliCommand: (cmd: string) => Promise<string>;
};

export const fromControllers = new EventEmitter() as TypedEventEmitter<EventsFromControllers>;

const desiredReceivers = new Map<ViewerContext, {
    ws: ws.WebSocket;
    observer: Observer<Desired, unknown>;
}>();
const notificationReceivers = new Map<ViewerContext, Observer<Notification, unknown>>();

export function getViewers() {
    return [...desiredReceivers.keys()];
}

export function unicast(ctx: ViewerContext, desired: Desired) {
    const { observer } = [...desiredReceivers].find(([x]) => x === ctx)?.[1] ?? {};
    if (!observer) return;
    console.log(`Sending ${inspect(desired)} to ${ctx}`);
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

        const { observer, ws } = desiredReceivers.get(ctx) ?? {};
        if (!ws) continue;

        observer?.complete();
        setTimeout(() => ws.close(), 500);
    }
}

class ViewerContext {
    id: string;
    name: string | null;
    ws: ws.WebSocket;

    constructor(ws: ws.WebSocket) {
        this.id = crypto.randomUUID();
        this.name = null;
        this.ws = ws;
    }

    [inspect.custom]() {
        return this.toString();
    }

    toString() {
        if (this.name) {
            return `${this.name} (${this.id})`;
        }
        else {
            return this.id;
        }
    }
}

export type { ViewerContext };

export const createViewerContext = async (opts: CreateWSSContextFnOptions) => {
    return new ViewerContext(opts.res);
};

const t = initTRPC.context<typeof createViewerContext>().create();
const router = t.router;

export const viewerRouter = router({
    announce: t.procedure
        .input(z.object({
            name: z.string(),
            reconnecting: z.object({ when: z.number() }).nullable(),
        }))
        .output(z.object({ version: z.string() }))
        .mutation(req => {
            req.ctx.name = req.input.name;
            console.log(`announce from ${req.ctx.id}: name = ${req.input.name}, reconnecting = ${inspect(req.input.reconnecting)}`);
            fromViewers.emit('join', req.ctx, req.input.reconnecting);
            return { version };
        }),

    play: t.procedure
        .input(z.null())
        .mutation(req => {
            console.log(`play from ${req.ctx}`);
            fromViewers.emit('play');
        }),

    pause: t.procedure
        .input(z.object({ when: z.number() }))
        .mutation(req => {
            console.log(`pause at ${req.input.when} from ${req.ctx}`);
            fromViewers.emit('pause', req.input.when);
        }),

    ready: t.procedure
        .input(z.object({ when: z.number() }))
        .mutation(req => {
            console.log(`ready at ${req.input.when} from ${req.ctx}`);
            fromViewers.emit('reportReady', req.ctx, req.input.when);
        }),

    reportWhen: t.procedure
        .input(z.object({ when: z.number() }))
        .mutation(req => {
            console.log(`reportWhen at ${req.input.when} from ${req.ctx}`);
            fromViewers.emit('reportWhen', req.ctx, req.input.when);
        }),

    desired: t.procedure
        .input(z.null())
        .subscription(req => observable<Desired>(observer => {
            console.log(`subscribe desired from ${req.ctx}`);
            desiredReceivers.set(req.ctx, { ws: req.ctx.ws, observer });
            return () => {
                console.log(`unsubscribe desired from ${req.ctx}`);
                desiredReceivers.delete(req.ctx);

                if (req.ctx.name) {
                    fromViewers.emit('leave', req.ctx);
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

export type ViewerRouter = typeof viewerRouter;

export function stopViewerSubscriptions() {
    for (const { observer } of desiredReceivers.values()) {
        observer.complete();
    }
}
