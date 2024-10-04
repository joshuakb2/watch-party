import { Match, Show, Switch, createSignal, JSX, createEffect, onCleanup, Accessor } from "solid-js";
import { startTrpc } from "./trpc";
import { Uselessness, testWhetherUseless } from "./useless";
import { BsFullscreen, BsFullscreenExit, BsVolumeDown, BsVolumeUp } from "solid-icons/bs";
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
        video.addEventListener('change', () => updateAreCaptionsEnabled());
        video.volume = volume() / 100;
        onGotVideo(v);
    };

    const [isFullscreen, setIsFullscreen] = createSignal(false);
    const initialCaptionsEnabled = localStorage.getItem('captions') === 'yes';
    const [areCaptionsEnabled, setAreCaptionsEnabled] = createSignal(initialCaptionsEnabled);
    const [volume, setVolume] = createSignal(+(localStorage.getItem('volume') ?? '100'));

    // Remember settings from last time
    createEffect(() => localStorage.setItem('captions', areCaptionsEnabled() ? 'yes' : 'no'));
    createEffect(() => localStorage.setItem('volume', `${volume()}`));

    // Register keydown event listener
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
                case 'ArrowUp':
                case 'NumpadAdd':
                case 'Equal':
                    increaseVolume();
                    break;
                case 'ArrowDown':
                case 'NumpadSubtract':
                case 'Minus':
                    decreaseVolume();
                    break;
            }
        };

        window.addEventListener('keydown', listener);
        onCleanup(() => window.removeEventListener('keydown', listener));
    });

    // Apply volume change
    createEffect(() => {
        const v = volume();
        if (!video) return;
        video.volume = v / 100;
    });

    const increaseVolume = () => setVolume(Math.min(100, volume() + 5));
    const decreaseVolume = () => setVolume(Math.max(0, volume() - 5));

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

    const increaseVolumeIconStyle: JSX.CSSProperties = {
        ...commonIconStyle,
        right: '75px',
    };

    const decreaseVolumeIconStyle: JSX.CSSProperties = {
        ...commonIconStyle,
        right: '110px',
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
            <track label='English' kind='subtitles' srclang='en' src={`https://files.joshuabaker.me/${subtitlesFile}`} default={initialCaptionsEnabled} />
        </video>

        <VolumeToast {...{ volume, isMouseMoving }} />

        <div style={{
            position: 'absolute',
            top: 0,
            left: 0,
            width: '100%',
            height: '100%',
            opacity: isMouseMoving() ? 1 : 0,
            transition: 'opacity 250ms',
            'user-select': 'none',
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
                fallback={<BsFullscreen style={fullscreenIconStyle} onclick={toggleFullscreen} onmousedown={preventDefault} />}
            >
                <BsFullscreenExit style={fullscreenIconStyle} onclick={toggleFullscreen} onmousedown={preventDefault} />
            </Show>
            <Show
                when={areCaptionsEnabled()}
                fallback={<BiRegularCaptions style={subtitlesIconStyle} onclick={toggleSubtitles} onmousedown={preventDefault} />}
            >
                <BiSolidCaptions style={subtitlesIconStyle} onclick={toggleSubtitles} onmousedown={preventDefault} />
            </Show>
            <BsVolumeUp style={increaseVolumeIconStyle} onclick={increaseVolume} onmousedown={preventDefault} />
            <BsVolumeDown style={decreaseVolumeIconStyle} onclick={decreaseVolume} onmousedown={preventDefault} />
        </div>
    </div>;
};

// With onmousedown, used to prevent text selection on double click
const preventDefault = (ev: Event) => ev.preventDefault();

type VolumeToastProps = {
    volume: Accessor<number>;
    isMouseMoving: Accessor<boolean>;
};

const VolumeToast = ({ volume, isMouseMoving }: VolumeToastProps) => {
    const [volumeChangedRecently, setVolumeChangedRecently] = createSignal(false);

    createEffect(() => {
        volume();
        setVolumeChangedRecently(true);
        const timeout = setTimeout(
            () => setVolumeChangedRecently(false),
            2000,
        );
        onCleanup(() => clearTimeout(timeout));
    });

    const shouldShowVolume = () => volumeChangedRecently() || isMouseMoving();

    return <div style={{
        position: 'absolute',
        top: '10px',
        right: '10px',
        'background-color': 'rgba(0, 0, 0, 0.3)',
        color: 'white',
        'font-size': 'xx-large',
        'border-radius': '20px',
        padding: '10px 20px',
        opacity: shouldShowVolume() ? 1 : 0,
        transition: 'opacity 250ms',
        'user-select': 'none',
    }}>Volume: {volume()}%</div>;
};
