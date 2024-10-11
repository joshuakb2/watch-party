import { initTRPC } from "@trpc/server";
import { CreateWSSContextFnOptions } from "@trpc/server/adapters/ws";
import {Observer, observable} from "@trpc/server/observable";
import crypto from 'crypto';
import EventEmitter from "events";
import TypedEventEmitter from "typed-emitter";
import * as ws from "ws";
import z from "zod";
import { ServerStateJson } from "./types";

type EventsFromControllers = {
    pause: (when: number | null) => void;
    rewind: (seconds: number) => void;
    play: () => void;
    newController: (id: string) => void;
};

export const fromControllers = new EventEmitter() as TypedEventEmitter<EventsFromControllers>;

const stateReceivers = new Map<string, {
    ws: ws.WebSocket,
    observer: Observer<ServerStateJson, unknown>;
}>();

export const unicastState = (id: string, state: ServerStateJson) => {
    stateReceivers.get(id)?.observer.next(state);
};

export const broadcastState = (state: ServerStateJson) => {
    stateReceivers.forEach(({ observer }) => observer.next(state));
};

export const createControllerContext = async (opts: CreateWSSContextFnOptions) => {
    const ws = opts.res;
    const id = crypto.randomUUID();

    return { id, ws };
};

const t = initTRPC.context<typeof createControllerContext>().create();
const router = t.router;

export const controllerRouter = router({
    state: t.procedure.subscription(req => observable<ServerStateJson>(observer => {
        console.log(`subscribe state from controller ${req.ctx.id}`);
        stateReceivers.set(req.ctx.id, { ws: req.ctx.ws, observer });
        fromControllers.emit('newController', req.ctx.id);

        return () => {
            console.log(`unsubscribe state from controller ${req.ctx.id}`);
            stateReceivers.delete(req.ctx.id);
        };
    })),

    pause: t.procedure
        .input(z.object({ when: z.number() }).optional())
        .mutation(async req => {
            fromControllers.emit('pause', req.input?.when ?? null);
        }),

    rewind: t.procedure
        .input(z.object({ seconds: z.number() }))
        .mutation(async req => {
            fromControllers.emit('rewind', req.input.seconds);
        }),

    play: t.procedure.mutation(() => fromControllers.emit('play')),
});

export type ControllerRouter = typeof controllerRouter;
