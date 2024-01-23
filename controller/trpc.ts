import { createTRPCProxyClient, createWSClient, wsLink } from "@trpc/client";
import type { ControllerRouter } from '../server/controllerTrpc';

export const trpc = createTRPCProxyClient<ControllerRouter>({
    links: [wsLink({
        client: createWSClient({ url: `${location.protocol === 'https:' ? 'wss' : 'ws'}://${location.hostname}:13579/controller` })
    })],
});
