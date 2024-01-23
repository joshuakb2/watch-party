import type { Unsubscribable } from '@trpc/server/observable';
import { render } from 'solid-js/web';
import { ViewerApp } from './ViewerApp';
import { onVideoEnabled, startTrpc, videoEnabled } from './trpc';

const version = '_$VERSION$_';

const raise = (error: Error) => { throw error; };
const video = document.querySelector('video') ?? raise(new Error('no video?'));

// const root = document.querySelector('#root');
// if (!root) throw new Error('No root div!');
// render(ViewerApp, root);

let trpc_: undefined | ReturnType<typeof startTrpc>;

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

// Delete the following

declare global {
    interface Window {
        enablePlayer: () => void;
        toggleSubtitles: () => void;
        openFullscreen: () => void;
    }
}

window.enablePlayer = () => {
    const connectingMsg = document.querySelector('#connecting-msg');
    if (connectingMsg instanceof HTMLElement) {
        connectingMsg.style.display = 'block';
    }

    const enableButton = document.querySelector('#enable-button');
    if (enableButton instanceof HTMLButtonElement) {
        enableButton.style.display = 'none';
    }

    const subtitlesButton = document.querySelector('#subtitles-button');
    if (subtitlesButton instanceof HTMLButtonElement) {
        subtitlesButton.style.display = 'inline';
    }

    const fullscreenButton = document.querySelector('#fullscreen-button');
    if (fullscreenButton instanceof HTMLButtonElement) {
        fullscreenButton.style.display = 'inline';
    }

    const oldClientName = localStorage.getItem('watch_party_client_name');
    let clientName: string | undefined;

    if (oldClientName) {
        const yes = confirm(`Would you still like to be called ${oldClientName}?`);
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

window.toggleSubtitles = () => {
    const track = video.textTracks[0];
    if (track) {
        track.mode = track.mode === 'showing' ? 'hidden' : 'showing';
    }
};

window.openFullscreen = () => {
    const videoWrapper = video.parentElement;
    if (videoWrapper) {
        videoWrapper?.requestFullscreen({ navigationUI: 'hide' });
        videoWrapper.onkeydown = ev => {
            if (ev.key === 'escape') {
                document.exitFullscreen();
            }
        };
    }
};
