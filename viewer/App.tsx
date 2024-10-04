import { Match, Show, Switch, createSignal, JSX, createEffect, onCleanup } from "solid-js";
import { startTrpc } from "./trpc";
import { Uselessness, testWhetherUseless } from "./useless";
import { BsFullscreen, BsFullscreenExit } from "solid-icons/bs";
import { BiRegularCaptions, BiSolidCaptions } from "solid-icons/bi";

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
window.addEventListener('orientationchange', onResize);

const movieFile = 'tv_glow.mp4';
const subtitlesFile = 'tv_glow.vtt';

export const App = ({ onVideoEnabled, onGotVideo, aspectRatio }: {
    onVideoEnabled: (args: VideoEnabledArgs) => void;
    onGotVideo: (video: HTMLVideoElement) => void;
    aspectRatio: () => number;
}) => {
    const [videoActive, setVideoActive] = createSignal(false);
    const useless = testWhetherUseless(movieFile);

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
        video.addEventListener('change', () => {
            updateAreCaptionsEnabled();
        });
        onGotVideo(v);
    };

    const [isFullscreen, setIsFullscreen] = createSignal(false);
    const [areCaptionsEnabled, setAreCaptionsEnabled] = createSignal(localStorage.getItem('captions') === 'yes');

    createEffect(() => localStorage.setItem('captions', areCaptionsEnabled() ? 'yes' : 'no'));

    createEffect(() => {
        const listener = (ev: KeyboardEvent) => {
            if (ev.ctrlKey || ev.altKey || ev.shiftKey) return;

            switch (ev.code) {
                case 'KeyF':
                    toggleFullscreen();
                    break;
                case 'KeyC':
                    toggleSubtitles();
                    break;
            }
        };

        window.addEventListener('keydown', listener);
        onCleanup(() => window.removeEventListener('keydown', listener));
    });

    const updateAreCaptionsEnabled = () => {
        if (!video) return;
        const track = video.textTracks[0];
        if (!track) return;
        setAreCaptionsEnabled(track.mode === 'showing');
    };

    const toggleSubtitles = () => {
        if (!video) return;
        const track = video.textTracks[0];
        if (!track) return;
        track.mode = areCaptionsEnabled() ? 'hidden' : 'showing';
        setAreCaptionsEnabled(!areCaptionsEnabled());
    };

    document.onfullscreenchange = () => {
        setIsFullscreen(Boolean(document.fullscreenElement));
        if (document.fullscreenElement && wrapper) {
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

    const commonIconStyle: JSX.CSSProperties = {
        position: 'absolute',
        width: '30px',
        height: '30px',
        bottom: '5px',
        cursor: 'pointer',
    };

    const fullscreenIconStyle: JSX.CSSProperties = {
        ...commonIconStyle,
        right: '5px',
    };

    const subtitlesIconStyle: JSX.CSSProperties = {
        ...commonIconStyle,
        right: '40px',
    };

    return <div
        ref={onGotWrapper}
        style={{
            position: 'relative',
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
            <source src={`https://files.joshuabaker.me/${movieFile}`} type='video/mp4' />
            <track label='English' kind='subtitles' srclang='en' src={`https://files.joshuabaker.me/${subtitlesFile}`} default={areCaptionsEnabled()} />
        </video>
        <div style={{
            position: 'absolute',
            top: 0,
            left: 0,
            width: '100%',
            height: '100%',
            opacity: isMouseMoving() ? 1 : 0,
            transition: 'opacity 250ms',
        }}>
            <div style={{
                position: 'absolute',
                bottom: 0,
                width: '100%',
                height: '60px',
                background: 'linear-gradient(to bottom, rgba(0,0,0,0), rgba(0,0,0,0.75))',
            }} />
            <Show
                when={isFullscreen()}
                fallback={<BsFullscreen style={fullscreenIconStyle} onclick={toggleFullscreen} />}
            >
                <BsFullscreenExit style={fullscreenIconStyle} onclick={toggleFullscreen} />
            </Show>
            <Show
                when={areCaptionsEnabled()}
                fallback={<BiRegularCaptions style={subtitlesIconStyle} onclick={toggleSubtitles} />}
            >
                <BiSolidCaptions style={subtitlesIconStyle} onclick={toggleSubtitles} />
            </Show>
        </div>
    </div>;
};
