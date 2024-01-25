import type { Unsubscribable } from '@trpc/server/observable';
import { render } from 'solid-js/web';
import { App, VideoEnabledArgs } from './App';
import { startTrpc } from './trpc';
import { version } from './version';
import { createSignal } from 'solid-js';

let trpc_: undefined | ReturnType<typeof startTrpc>;

let onVideoEnabled: (args: VideoEnabledArgs) => void;
const videoEnabled = new Promise<VideoEnabledArgs>(resolve => onVideoEnabled = resolve);

let onGotVideo: (video: HTMLVideoElement) => void;
const gotVideo = new Promise<HTMLVideoElement>(resolve => onGotVideo = resolve);

const [aspectRatio, setAspectRatio] = createSignal(1);

render(() => <App {...{
    onVideoEnabled,
    onGotVideo,
    aspectRatio,
}} />, document.body);

Promise.all([videoEnabled, gotVideo]).then(([{ useless, clientName }, video]) => {
    console.log('Useless?', useless);

    if (useless === 'decent') {
        video.oncanplay = () => {
            console.log('The video reports that it is ready to play');
            if (trpc_) {
                trpc_.ready.mutate({ when: video.currentTime });
            }
        };
    }

    video.onloadedmetadata = video.onloadeddata = () => {
        setAspectRatio(video.videoWidth / video.videoHeight);
    };

    let wasToldWhatDo = false;
    let uselessTimeout: NodeJS.Timeout | undefined;

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
                    const connectingMsg = document.querySelector('#connecting-msg');
                    if (connectingMsg instanceof HTMLElement) connectingMsg.style.display = 'none';
                    video.style.display = 'block';
                }
            });
        },
        onStopped: () => {
            const connectingMsg = document.querySelector('#connecting-msg');
            if (connectingMsg instanceof HTMLElement) connectingMsg.style.display = 'block';
            video.style.display = 'none';
            video.pause();
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
                    if (useless === 'useless') {
                        // For the useless browsers, assume they will be ready after 3 seconds.
                        clearTimeout(uselessTimeout);
                        uselessTimeout = setTimeout(() => {
                            trpc.ready.mutate({ when: msg.when });
                        }, 3_000);
                    }
                    break;

                case 'pauseAndReportWhen':
                    console.log('Server says pause now and report current time');
                    clearTimeout(uselessTimeout);
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
