// useServerCredentials.ts
import { ref } from "vue";

type Creds = { username: string; password: string };

const credsByIp = ref<Record<string, Creds>>({});

export function useServerCredentials() {
    const setCredentials = (ip: string, username: string, password: string) => {
        if (!ip) return;
        credsByIp.value = {
            ...credsByIp.value,
            [ip]: { username, password },
        };
    };

    const getCredentials = (ip: string): Creds | undefined => {
        if (!ip) return undefined;
        return credsByIp.value[ip];
    };

    const clearCredentials = () => {
        credsByIp.value = {};
    };

    return {
        credsByIp,
        setCredentials,
        getCredentials,
        clearCredentials,
    };
}
