import { Accessor, For, JSX, createEffect, createSignal, onCleanup } from 'solid-js';
import { trpc } from './trpc';
import { assertNever, type ServerStateJson } from '../server/types';
import { BsArrowBarDown, BsPauseBtn, BsPlayBtn, BsRewindBtn } from 'solid-icons/bs';

export const App = () => {
    const [serverState, setServerState] = createSignal<ServerStateJson | undefined>();
    createEffect(() => {
        const subscription = trpc.state.subscribe(undefined, { onData: setServerState });
        onCleanup(subscription.unsubscribe);
    });

    return <div style={{
        width: '100%',
        height: '100%',
        display: 'grid',
        'grid-template-columns': '1fr min(100%, 500px) 1fr',
        'grid-template-rows': '1fr min(100%, 700px) 1fr',
        'grid-template-areas': `
            ".     .      ."
            ". controller ."
            ".     .      ."
        `,
    }}>
        <Controller {...{ serverState }} />
    </div>;
};

type ControllerProps = {
    serverState: Accessor<ServerStateJson | undefined>;
};

const Controller = ({ serverState }: ControllerProps) => {
    const status = () => {
        const state = serverState();

        if (!state) return 'Not connected';

        switch (state.mode) {
            case 'init':
                return 'Paused at 0';
            case 'paused':
                return `Paused at ${state.when}`;
            case 'waitingForReady':
                return `Waiting for viewers to be ready at ${state.when}`;
            case 'waitingForWhenReports':
                return `Waiting for when reports from viewers`;
            case 'playing':
                return 'Playing';
            default:
                return assertNever(state);
        }
    };

    return <div style={{
        'grid-area': 'controller',
        border: 'solid black 2px',
        display: 'grid',
        'grid-template-columns': '1fr 1fr',
        'grid-template-rows': '1fr 1fr 1fr min-content',
        'grid-template-areas': `
            "state state"
            "play pause"
            "rewind pause-at"
            "viewers viewers"
        `,
    }}>
        <div style={{
            'grid-area': 'state',
            'font-size': 'xx-large',
            display: 'flex',
            'justify-content': 'center',
            'align-items': 'center',
        }}>{status()}</div>

        <PlayButton {...{ serverState }} />
        <PauseButton {...{ serverState }} />
        <PauseAtButton />
        <RewindButton {...{ serverState }} />

        <Viewers {...{ serverState }} />
    </div>
};

type PlayButtonProps = {
    serverState: Accessor<ServerStateJson | undefined>;
};

const PlayButton = ({ serverState }: PlayButtonProps) => {
    const disabled = () => {
        const state = serverState();
        if (!state) return true;
        return !(state.mode === 'init' || state.mode === 'paused');
    };

    return <ControllerButton
        gridArea='play'
        icon={<BsPlayBtn size={48} />}
        onclick={() => void trpc.play.mutate()}
        disabled={disabled}
    />;
};

type PauseButtonProps = {
    serverState: Accessor<ServerStateJson | undefined>;
};

const PauseButton = ({ serverState }: PauseButtonProps) => {
    const disabled = () => serverState()?.mode !== 'playing';

    return <ControllerButton
        gridArea='pause'
        icon={<BsPauseBtn size={48} />}
        onclick={() => void trpc.pause.mutate()}
        disabled={disabled}
    />;
};

const PauseAtButton = () => {
    return <ControllerButton
        gridArea='pause-at'
        icon={<BsArrowBarDown size={48} />}
        onclick={() => {
            const response = prompt('Pause at what time code?');
            if (!response) return;

            const when = +response;
            if (isNaN(when)) return;

            void trpc.pause.mutate({ when });
        }}
    />;
};

type RewindButtonProps = {
    serverState: Accessor<ServerStateJson | undefined>;
};

const RewindButton = ({ serverState }: RewindButtonProps) => {
    const disabled = () => serverState()?.mode !== 'paused';

    return <ControllerButton
        gridArea='rewind'
        icon={<BsRewindBtn size={48} />}
        onclick={() => {
            const response = prompt('Rewind how many seconds?');
            if (!response) return;

            const seconds = +response;
            if (isNaN(seconds)) return;

            void trpc.rewind.mutate({ seconds });
        }}
        disabled={disabled}
    />;
};

type ControllerButtonProps = {
    gridArea: string;
    icon: JSX.Element;
    disabled?: Accessor<boolean>;
    onclick: () => void;
};

const ControllerButton = ({ gridArea, icon, disabled, onclick }: ControllerButtonProps) => {
    return <button
        style={{ 'grid-area': gridArea }}
        onclick={onclick}
        disabled={disabled?.()}
    >
        {icon}
    </button>;
};

type ViewersProps = {
    serverState: Accessor<ServerStateJson | undefined>;
};

const Viewers = ({ serverState }: ViewersProps) => {
    const reports = () => {
        const state = serverState();
        if (state && 'whenReports' in state) return state.whenReports;
        return [];
    };

    return <table style={{ 'grid-area': 'viewers' }}>
        <thead>
            <tr>
                <th>ID</th>
                <th>Name</th>
                <th>When</th>
            </tr>
        </thead>
        <tbody>
            <For each={reports()}>{
                ([ctx, when]) => <tr>
                    <td>{ctx.id}</td>
                    <td>{ctx.name}</td>
                    <td>{when}</td>
                </tr>
            }</For>
        </tbody>
    </table>;
};
