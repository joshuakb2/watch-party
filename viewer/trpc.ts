import { createTRPCProxyClient, createWSClient, wsLink } from '@trpc/client';
import type { ViewerRouter } from '../server/viewerTrpc';

type VideoEnabledArgs = {
    clientName: string;
};

export let onVideoEnabled: (args: VideoEnabledArgs) => void;
export const videoEnabled = new Promise<VideoEnabledArgs>(resolve => onVideoEnabled = resolve);

export function startTrpc() {
    return createTRPCProxyClient<ViewerRouter>({
        links: [wsLink({
            client: createWSClient({ url: `${location.protocol === 'https:' ? 'wss' : 'ws'}://${location.hostname}:13579/viewer` }),
        })]
    });
}

