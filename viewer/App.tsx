import { Match, Show, Switch, createSignal } from "solid-js";
import { startTrpc } from "./trpc";
import { Uselessness, testWhetherUseless } from "./useless";

export type VideoEnabledArgs = {
    useless: Uselessness;
    clientName: string;
};

const [windowDims, setWindowDims] = createSignal({
    width: window.innerWidth,
    height: window.innerHeight,
});
const onResize = () => setWindowDims({
    width: window.innerWidth,
    height: window.innerHeight,
});
window.addEventListener('resize', onResize);
//window.addEventListener('orientationchange', onResize);

export const App = ({ onVideoEnabled, onGotVideo, aspectRatio }: {
    onVideoEnabled: (args: VideoEnabledArgs) => void;
    onGotVideo: (video: HTMLVideoElement) => void;
    aspectRatio: () => number;
}) => {
    const [videoActive, setVideoActive] = createSignal(false);
    const useless = testWhetherUseless('celeste.mp4');

    const videoWidth = () => {
        return Math.min(
            windowDims().width,
            windowDims().height * aspectRatio(),
        );
    };

    const start = (useless: Uselessness) => {
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
        startTrpc();
        onVideoEnabled({ useless, clientName });
        setVideoActive(true);
    };

    return <div style={{
        width: '100vw',
        height: '100vh',
        overflow: 'hidden',
        display: 'flex',
        'flex-direction': 'column',
        'justify-content': 'center',
        'align-items': 'center',
    }}>
        <Switch fallback={<>
            <Show when={!videoActive()}><AskToStart onclick={() => start(useless())} /></Show>
            <Player show={videoActive} onGotVideo={onGotVideo} width={videoWidth} />
        </>}>
            <Match when={useless() === 'testing'}>
                Testing uselessness...
            </Match>
        </Switch>
    </div>;
};

const AskToStart = ({ onclick }: { onclick?: () => void }) => (
    <button type="button" style={{ 'font-size': '32pt' }} onclick={onclick}>
        Click here to start watching!
    </button>
);

const Player = ({ show, onGotVideo, width }: {
    show: () => boolean;
    onGotVideo: (video: HTMLVideoElement) => void;
    width: () => number;
}) => {
    let wrapper: HTMLDivElement | undefined;
    let video: HTMLVideoElement | undefined;

    const gotVideo = (v: HTMLVideoElement) => {
        video = v;
        onGotVideo(v);
    };

    const toggleSubtitles = () => {
        if (!video) return;
        const track = video.textTracks[0];
        if (track) {
            track.mode = track.mode === 'showing' ? 'hidden' : 'showing';
        }
    };

    const [isFullscreen, setIsFullscreen] = createSignal(false);

    document.onfullscreenchange = () => {
        setIsFullscreen(document.fullscreenEnabled);
        if (document.fullscreenEnabled && wrapper) {
            wrapper.onkeydown = ev => {
                if (ev.key === 'escape') {
                    document.exitFullscreen();
                }
            };
        }
        else if (wrapper) {
            wrapper.onkeydown = null;
        }
    };

    const toggleFullscreen = () => {
        if (!wrapper) return;
        const w = wrapper;

        if (isFullscreen()) {
            document.exitFullscreen().catch(() => {});
        }
        else {
            w.requestFullscreen({ navigationUI: 'hide' }).catch(() => {});
        }
    };

    const onGotWrapper = (w: HTMLDivElement) => {
        wrapper = w;

        let timeout: NodeJS.Timeout | undefined;
        wrapper.addEventListener('mousemove', () => {
            setIsMouseMoving(true);
            clearTimeout(timeout);
            timeout = setTimeout(() => setIsMouseMoving(false), 3_000);
        });
    };

    const [isMouseMoving, setIsMouseMoving] = createSignal(false);

    return <div
        ref={onGotWrapper}
        style={{
            'background-color': 'black',
            display: show() ? 'block' : 'none',
            width: `${width()}px`,
            cursor: isMouseMoving() ? 'auto' : 'none',
        }}
    >
        <video
            ref={gotVideo}
            preload='auto'
            crossorigin='anonymous'
            style={{ width: '100%', height: '100%' }}
        >
            <source src='https://files.joshuabaker.me/celeste.mp4' type='video/mp4' />
            <track label='English' kind='subtitles' srclang='en' src='https://files.joshuabaker.me/faceoff.vtt' default />
        </video>
        <Show when={isMouseMoving()}>MOUSE IS MOVING</Show>
    </div>;
};
