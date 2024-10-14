#!/usr/bin/env node

import '@total-typescript/ts-reset/filter-boolean';
import readline from 'readline';
import { inspect } from 'util';
import { startServer, stopServer } from './trpcServer';
import { ViewerContext, ViewerStatus, broadcast, fromViewers, getViewers, kick, notify, unicast } from './viewerTrpc';
import { broadcastState, unicastState, fromControllers } from './controllerTrpc';
import { assertNever, PlayingState, ServerState, serverStateToJson, WaitingForReadyState, WaitingForWhenReportsState } from './types';

const epsilon = 0.1;

async function main() {
    startServer();
    registerControllerHandlers();

    let cli = readline.createInterface(process.stdin, process.stdout);

    while (true) {
        const nextInput = await new Promise<string>(resolve => cli.question('$ ', resolve));
        const response = await handleCommand(nextInput, cli);
        cli.write(`${response ?? ''}\n`);
    }
}

function registerControllerHandlers() {
    fromControllers.on('pause', when => {
        const state = getState();

        if (when != null) {
            pauseAt(when);
        }
        else if (state.mode === 'playing') {
            pauseAndReportWhen(state);
        }
    });

    fromControllers.on('rewind', seconds => {
        const state = getState();

        switch (state.mode) {
            case 'paused':
            case 'waitingForReady': {
                const newWhen = state.when - seconds;
                pauseAt(newWhen);
            }

            case 'init':
            case 'waitingForWhenReports':
            case 'playing':
                break;

            default:
                return assertNever(state);
        }
    });

    fromControllers.on('play', playIfPossible);

    fromControllers.on('newController', id => unicastState(id, serverStateToJson(getState())));
}

function splitArgs(input: string) {
    return input.trim().split(/ +/g);
}

async function handleCommand(input: string, cli?: readline.Interface) {
    let [cmd, ...args] = splitArgs(input);
    if (!cmd) return;

    let matching = [...commands].filter(([cmdName, _]) => cmdName.startsWith(cmd));

    if (matching.length > 1) {
        return `Ambiguous command could match any of ${matching.map(x => `"${x}"`).join(', ')}`;
    }

    if (matching.length === 0) {
        return `No such command as "${cmd}" exists.`;
    }

    const f = matching[0][1];

    // Do the command
    return await f(cli, ...args);
}

const commands = new Map<string, (cli?: readline.Interface, ...args: (string | undefined)[]) => Promise<string>>([
    ['help', printHelp],
    ['status', printStatus],
    ['play', cliPlay],
    ['pause', cliPause],
    ['say', cliSay],
    ['rewind <seconds>', cliRewind],
    ['kick', cliKick],
    ['exit', quit],
    ['quit', quit],
]);

const helpInfo = new Map([
    ['help', 'Display this help message'],
    ['play', 'Start playing video'],
    ['pause [when]', 'Pause the video and optionally seeks to the specified number of seconds'],
    ['rewind <when>', 'Rewind the video <when> seconds'],
    ['say [...words]', 'Send a notification to all viewers'],
    ['status', 'Show how many viewers are connected.'],
    ['kick ([...ids] | everyone)', 'Kick one or all viewers'],
    ['exit', 'Stop the server'],
]);

async function printHelp() {
    let response = '';
    for (let [cmd, info] of helpInfo) {
        response += `${cmd}: ${info}\n`;
    }
    return response;
}

async function printStatus() {
    const n = getViewers().length;
    let response = '';
    response += `There ${n === 1 ? 'is' : 'are'} ${n} ${n === 1 ? 'viewer' : 'viewers'} connected.\n`;
    response += `Status: ${inspect(getState())}\n`;
    response += `Viewers: ${inspect(getViewers())}\n`;
    response += `ReadyWhens: ${inspect(readyWhens)}\n`;
    return response;
}

async function cliPlay() {
    let state = getState();
    if (state.mode === 'playing') {
        return `Already playing\n`;
    }

    playIfPossible();
    state = getState();

    if (state.mode === 'playing') {
        return `Now playing.\n`;
    }
    else {
        return `Can't play right now\n`;
    }
}

async function cliPause(_cli?: readline.Interface, whenStr?: string) {
    const state = getState();

    if (typeof whenStr !== 'string') {
        if (state.mode === 'playing') {
            pauseAndReportWhen(state);
            return `Instructing viewers to pause\n`;
        }
        else {
            return `Can't pause right now\n`;
        }
    }
    else {
        const when = +whenStr;
        pauseAt(when);
        return `Pausing at ${when}\n`;
    }
}

async function cliSay(_cli?: readline.Interface, ...words: (string | undefined)[]) {
    const message = words.filter(Boolean).join(' ');
    notify(message);
    return `Said "${message}"`;
}

async function cliRewind(_cli?: readline.Interface, secondsStr?: string) {
    if (!secondsStr) {
        return `You must provide a number of seconds to rewind.\n`;
    }

    const seconds = +secondsStr;

    if (isNaN(seconds)) {
        return `Invalid number given.\n`;
    }

    const state = getState();

    switch (state.mode) {
        case 'paused':
        case 'waitingForReady':
            const newWhen = state.when - seconds;
            pauseAt(newWhen);
            return `Rewinding to ${newWhen}\n`;

        case 'init':
        case 'waitingForWhenReports':
        case 'playing':
            return `Cannot rewind from state = ${state.mode}\n`;

        default:
            return assertNever(state);
    }
}

async function cliKick(_cli?: readline.Interface, ...who: (undefined | string)[]) {
    if (who.length === 1 && who[0] === 'everyone') {
        kick('everyone');
        return `Kicked everyone.\n`;
    }

    const ids = who.filter(Boolean);
    if (ids.length > 0) {
        kick(ids);
        return `Kicked ${ids.join(', ')}\n`;
    }

    return `Didn't kick anybody\n`;
}

async function quit(cli?: readline.Interface) {
    if (!cli) {
        return 'You can\'t stop the server from the controller app\n';
    }

    stopServer();
    process.exit(0);
}

const readyWhens = new Map<ViewerContext, number | null>();

const { getState, setState } = (() => {
    let state: ServerState = { mode: 'init' };

    const getState = () => state;
    const setState = (newState: ServerState) => {
        state = newState;
        queueBroadcastState();
    };

    let promise: Promise<void> | undefined;

    const queueBroadcastState = () => {
        if (!promise) {
            promise = Promise.resolve().then(() => {
                broadcastState(serverStateToJson(state));
                promise = undefined;
            });
        }
    };

    return { getState, setState };
})();

const { getViewerStatuses, setViewerStatus, deleteViewerStatus } = (() => {
    const statuses = new Map<ViewerContext, ViewerStatus>();

    const getViewerStatuses = () => statuses;

    const setViewerStatus = (ctx: ViewerContext, status: ViewerStatus) => {
        statuses.set(ctx, status);
        queueBroadcastStatuses();
    };

    const deleteViewerStatus = (ctx: ViewerContext) => {
        statuses.delete(ctx);
        queueBroadcastStatuses();
    };

    let promise: Promise<void> | undefined;

    const queueBroadcastStatuses = () => {
        if (!promise) {
            promise = Promise.resolve().then(() => {
                broadcastStatuses([...statuses].map(([ctx, status]) => [ctx.toJSON(), status]));
                promise = undefined;
            });
        }
    };

    return { getViewerStatuses, setViewerStatus, deleteViewerStatus };
})();

function pauseAndReportWhen(currentState: PlayingState) {
    broadcast({ whatdo: 'pauseAndReportWhen' });
    setState({
        mode: 'waitingForWhenReports',
        inSync: [...readyWhens.keys()],
        whenReports: new Map(),
        lastReportedWhen: currentState.lastReportedWhen,
    });
}

fromViewers.on('join', (ctx, reconnecting) => {
    const state = getState();

    switch (state.mode) {
        case 'init':
            setState({
                mode: 'paused',
                when: reconnecting?.when ?? 0,
            });
            broadcast({ whatdo: 'pause', when: reconnecting?.when ?? 0 });
            break;

        case 'paused':
            unicast(ctx, { whatdo: 'pause', when: state.when });
            setState({
                mode: 'waitingForReady',
                when: state.when,
            });
            break;

        case 'waitingForReady':
            unicast(ctx, { whatdo: 'pause', when: state.when });
            break;

        case 'waitingForWhenReports':
            unicast(ctx, { whatdo: 'pause', when: 0 });
            break;

        case 'playing':
            pauseAndReportWhen(state);
            break;

        default:
            return assertNever(state);
    }

    readyWhens.set(ctx, null);

    notify(`Welcome to the party, ${ctx.name}! We are up to ${getViewers().length} viewers.`);
});

fromViewers.on('leave', ctx => {
    const state = getState();

    readyWhens.delete(ctx);

    if (getViewers().length === 0) {
        switch (state.mode) {
            case 'init':
                break;

            case 'paused':
                break;

            case 'waitingForReady':
                setState({ mode: 'paused', when: state.when });
                break;

            case 'waitingForWhenReports':
            case 'playing':
                setState({ mode: 'paused', when: state.lastReportedWhen });
                break;

            default:
                return assertNever(state);
        }
        return;
    }

    switch (state.mode) {
        case 'init':
        case 'paused':
            break;

        case 'playing':
            state.whenReports.delete(ctx);
            setState(state);
            break;

        case 'waitingForReady':
            checkIfAllReady(state);
            break;

        case 'waitingForWhenReports':
            state.whenReports.delete(ctx);
            setState(state);
            checkWhenReports(state);
            break;

        default:
            return assertNever(state);
    }

    notify(`${ctx.name ?? 'Somebody'} left, down to ${getViewers().length} viewers.`);
});

function checkIfAllReady(currentState: WaitingForReadyState) {
    let allReady = true;

    for (const when of readyWhens.values()) {
        if (when == null || Math.abs(when - currentState.when) > epsilon) {
            allReady = false;
            break;
        }
    }

    if (allReady) {
        setState({
            mode: 'paused',
            when: currentState.when,
        });
    }
}

function checkWhenReports(currentState: WaitingForWhenReportsState) {
    for (const ctx of currentState.inSync) {
        if (currentState.whenReports.get(ctx) == null) {
            return;
        }
    }

    const consensus = Math.min(...currentState.inSync.map(ctx =>
        currentState.whenReports.get(ctx) ?? Infinity
    ));

    setState({
        mode: 'paused',
        when: consensus,
    });
    broadcast({ whatdo: 'pause', when: consensus });
}

fromViewers.on('play', () => {
    playIfPossible();
});

function playIfPossible() {
    const state = getState();

    switch (state.mode) {
        case 'paused': {
            if (getViewers().length === 0) break;

            const { when } = state;

            setState({
                mode: 'playing',
                whenReports: new Map(getViewers().map(ctx => [ctx, when] as const)),
                lastReportedWhen: when,
            });
            broadcast({ whatdo: 'play' });
            break;
        }

        case 'init':
        case 'waitingForReady':
        case 'waitingForWhenReports':
        case 'playing':
            break;

        default:
            return assertNever(state);
    }
}

fromViewers.on('pause', when => {
    const state = getState();

    switch (state.mode) {
        case 'init':
        case 'playing':
        case 'paused':
        case 'waitingForReady':
            pauseAt(when);
            break;

        case 'waitingForWhenReports':
            break;

        default:
            return assertNever(state);
    }
});

function pauseAt(when: number) {
    if (getViewers().length === 0) {
        setState({ mode: 'paused', when });
    }
    else {
        setState({ mode: 'waitingForReady', when });
        broadcast({ whatdo: 'pause', when });
    }
}

fromViewers.on('reportReady', (ctx, when) => {
    const state = getState();

    readyWhens.set(ctx, when);

    switch (state.mode) {
        case 'paused':
            if (Math.abs(when - state.when) > epsilon) {
                setState({ mode: 'waitingForReady', when: state.when });
            }
            break;

        case 'waitingForReady':
            checkIfAllReady(state);
            break;

        case 'init':
        case 'waitingForWhenReports':
        case 'playing':
            break;

        default:
            return assertNever(state);
    }
});

fromViewers.on('reportWhen', (ctx, when) => {
    const state = getState();

    switch (state.mode) {
        case 'waitingForWhenReports':
            state.whenReports.set(ctx, when);
            setState(state);
            checkWhenReports(state);
            break;

        case 'playing':
        case 'init':
        case 'paused':
        case 'waitingForReady':
            break;

        default:
            return assertNever(state);
    }
});

fromViewers.on('checkIn', (ctx, status) => {
    setViewerStatus(ctx, status);
});

main().catch(err => {
    console.error(`Unexpected error: ${err}`);
    process.exit(1);
});
