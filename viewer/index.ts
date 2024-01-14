import { createTRPCProxyClient, createWSClient, wsLink } from '@trpc/client';
import type { AppRouter } from '../server/trpc';

const isSafari = navigator.vendor && navigator.vendor.indexOf('Apple') > -1 &&
    navigator.userAgent &&
    navigator.userAgent.indexOf('CriOS') == -1 &&
    navigator.userAgent.indexOf('FxiOS') == -1;

if (isSafari) {
    const tellThemOff = () => {
        alert(`
            Hey, so Safari won't cooperate with me at all so,
            not only will this app not work for YOU using Safari,
            but you being connected will prevent playback for
            everyone else in the party too! So please close this
            tab and come back using a better browser such as
            Chrome, Firefox, or Edge. Thanks!
        `.trim().replace(/\s+/g, ' '));
        setTimeout(tellThemOff, 5000);
    };
    tellThemOff();
    throw new Error('YOU SHALL NOT PASS');
}

const version = '_$VERSION$_';

const raise = (error: Error) => { throw error; };
const video = document.querySelector('video') ?? raise(new Error('no video?'));
let onVideoEnabled: (() => void) | undefined;
const videoEnabled = new Promise<void>(resolve => onVideoEnabled = resolve);
let trpc_: undefined | ReturnType<typeof startTrpc>;

function startTrpc() {
    return createTRPCProxyClient<AppRouter>({
        links: [wsLink({
            client: createWSClient({ url: `${location.protocol === 'https:' ? 'wss' : 'ws'}://${location.hostname}:13579/` }),
        })]
    });
}

videoEnabled.then(() => {
    let wasToldWhatDo = false;

    const trpc = trpc_ = startTrpc();

    trpc.desired.subscribe(null, {
        onStarted: () => {
            trpc.announce.mutate({
                reconnecting: wasToldWhatDo ? { when: video.currentTime } : null,
            }).then(({ version: serverVersion }) => {
                if (version !== serverVersion) {
                    const reloadCount = +(localStorage.getItem('watch_party_reload_count') ?? '0');
                    if (reloadCount > 1) {
                        alert('Tell Josh he needs to rebuild the watch party viewer!');
                    }
                    else {
                        localStorage.setItem('watch_party_reload_count', `${reloadCount + 1}`);
                        location.reload();
                    }
                }
                else {
                    localStorage.setItem('watch_party_reload_count', '0');
                }
            });
        },
        onData: msg => {
            wasToldWhatDo = true;

            switch (msg.whatdo) {
                case 'play':
                    console.log('Server says we should start playing the video');
                    video.play();
                    break;

                case 'pause':
                    console.log(`Server says the video should be paused at ${msg.when}.`);
                    video.pause();
                    video.currentTime = msg.when;
                    break;

                case 'pauseAndReportWhen':
                    console.log('Server says pause now and report current time');
                    video.pause();
                    trpc.reportWhen.mutate({ when: video.currentTime });
                    break;

                default: {
                    const never: never = msg;
                    void never;
                    throw new Error('This should never happen');
                }
            }
        },
    });
});

video.oncanplay = () => {
    console.log('The video reports that it is ready to play');
    if (trpc_) {
        trpc_.ready.mutate({ when: video.currentTime });
    }
};

declare global {
    interface Window {
        enablePlayer: () => void;
    }
}

window.enablePlayer = () => {
    video.style.display = '';
    const enableButton = document.querySelector('#enable-button');
    if (enableButton instanceof HTMLButtonElement) {
        enableButton.style.display = 'none';
    }
    setTimeout(() => onVideoEnabled?.(), 0);
};
