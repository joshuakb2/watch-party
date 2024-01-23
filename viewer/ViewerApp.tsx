import { Show, createSignal } from "solid-js";
import { onVideoEnabled, startTrpc } from "./trpc";

export const ViewerApp = () => {
    const [videoActive, setVideoActive] = createSignal(false);

    const start = () => {
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
        onVideoEnabled({ clientName });
        setVideoActive(true);
    };

    return <div>
        <Show
            when={videoActive()}
            fallback={<AskToStart onclick={start} />}
        >
            <Player/>
        </Show>
    </div>;
};

const AskToStart = ({ onclick }: { onclick?: () => void }) => (
    <button type="button" onclick={onclick}>Click to start</button>
);

const Player = () => {
    return <video></video>;
};
