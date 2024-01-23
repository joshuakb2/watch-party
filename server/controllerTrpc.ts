import { initTRPC } from "@trpc/server";
import { CreateWSSContextFnOptions } from "@trpc/server/adapters/ws";
import crypto from 'crypto';
import z from "zod";

let cliCommandHandler: undefined | ((cmd: string) => Promise<string | undefined>);

export function installCliCommandHandler(handler: NonNullable<typeof cliCommandHandler>) {
    cliCommandHandler = handler;
}

export const createControllerContext = async (opts: CreateWSSContextFnOptions) => {
    const ws = opts.res;
    const id = crypto.randomUUID();

    return { id, ws };
};

const t = initTRPC.context<typeof createControllerContext>().create();
const router = t.router;

export const controllerRouter = router({
    cliCommand: t.procedure
        .input(z.string())
        .output(z.string().optional())
        .mutation(async req => {
            if (!cliCommandHandler) throw new Error('No CLI command handler has been installed');
            return await cliCommandHandler(req.input);
        }),
});

export type ControllerRouter = typeof controllerRouter;
