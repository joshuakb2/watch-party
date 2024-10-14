import { ViewerContext, ViewerContextJson } from './viewerTrpc';

type Jsonable<WhenNotJson, WhenJson, json extends boolean> = json extends true ? WhenJson : WhenNotJson;

export type InitMode = {
    mode: 'init';
};

export type PausedState = {
    mode: 'paused';
    when: number;
};

export type WaitingForReadyState = {
    mode: 'waitingForReady';
    when: number;
};

type WaitingForWhenReportsState_<json extends boolean, ctx = Jsonable<ViewerContext, ViewerContextJson, json>> = {
    mode: 'waitingForWhenReports';
    inSync: ctx[];
    whenReports: Jsonable<Map<ctx, number>, [ctx, number][], json>;
    lastReportedWhen: number;
};

export type WaitingForWhenReportsState = WaitingForWhenReportsState_<false>;
export type WaitingForWhenReportsStateJson = WaitingForWhenReportsState_<true>;

export type PlayingState = {
    mode: 'playing';
};

type ServerState_<json extends boolean> =
    | InitMode
    | PausedState
    | WaitingForReadyState
    | WaitingForWhenReportsState_<json>
    | PlayingState;

export type ServerState = ServerState_<false>;
export type ServerStateJson = ServerState_<true>;

export const serverStateToJson = (state: ServerState): ServerStateJson => {
    switch (state.mode) {
        case 'init':
        case 'paused':
        case 'waitingForReady':
        case 'playing':
            return state;

        case 'waitingForWhenReports':
            return {
                ...state,
                inSync: state.inSync.map(ctx => ctx.toJSON()),
                whenReports: [...state.whenReports].map(([ctx, when]) => [ctx.toJSON(), when]),
            };

        default:
            return assertNever(state);
    }
};

export function assertNever(never: never): never {
    void never;
    throw new Error('This should never happen');
}

