import { createTRPCProxyClient, createWSClient, wsLink } from '@trpc/client';
import type { AppRouter } from '../server/trpc';
import type { Unsubscribable } from '@trpc/server/observable';

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

type VideoEnabledArgs = {
    clientName: string;
};

let onVideoEnabled: ((args: VideoEnabledArgs) => void) | undefined;
const videoEnabled = new Promise<VideoEnabledArgs>(resolve => onVideoEnabled = resolve);

let trpc_: undefined | ReturnType<typeof startTrpc>;

function startTrpc() {
    return createTRPCProxyClient<AppRouter>({
        links: [wsLink({
            client: createWSClient({ url: `${location.protocol === 'https:' ? 'wss' : 'ws'}://${location.hostname}:13579/` }),
        })]
    });
}

videoEnabled.then(({ clientName }) => {
    let wasToldWhatDo = false;

    const trpc = trpc_ = startTrpc();

    const subscriptions: Unsubscribable[] = [];

    const desiredSubscription = trpc.desired.subscribe(null, {
        onStarted: () => {
            trpc.announce.mutate({
                name: clientName,
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

                case 'gtfo':
                    for (const sub of subscriptions) {
                        sub.unsubscribe();
                    }
                    subscriptions.splice(0);
                    video.pause();
                    alert('You have been kicked!');
                    break;

                default: {
                    const never: never = msg;
                    void never;
                    throw new Error('This should never happen');
                }
            }
        },
    });

    subscriptions.push(desiredSubscription);

    if (!window.Notification) {
        console.log(`This browser doesn't support Notifications :(`);
    }
    else {
        if (Notification.permission === 'default') {
            Notification.requestPermission();
        }
        const notificationSubscription = trpc.notifications.subscribe(null, {
            onData: notification => {
                if (Notification.permission !== 'granted') return;
                new Notification(notification);
            },
        });

        subscriptions.push(notificationSubscription);
    }
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

    const oldClientName = localStorage.getItem('watch_party_client_name');
    let clientName: string | undefined;

    if (oldClientName) {
        const yes = confirm(`Would you still list to be called ${oldClientName}?`);
        if (yes) {
            clientName = oldClientName;
        }
    }

    if (!clientName) {
        let newName = prompt('What should we call you?');
        while (!newName) {
            newName = prompt('Sorry, please try again. Who are you?!?');
        }
        clientName = newName;
    }

    localStorage.setItem('watch_party_client_name', clientName);
    const args = { clientName };
    setTimeout(() => onVideoEnabled?.(args), 0);
};
