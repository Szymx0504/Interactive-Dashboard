import { useCallback, useMemo } from "react";
import { useSearchParams } from "react-router-dom";
import { api } from "../lib/api";
import { useApi } from "./useApi";
import type { Session } from "../types";

const AVAILABLE_YEARS = [2025, 2024, 2023];

export interface RaceSelectorState {
    /** Available years */
    years: number[];
    /** Currently selected year */
    year: number;
    /** Set the year (also clears session) */
    setYear: (y: number) => void;
    /** Race sessions for the selected year */
    sessions: Session[] | null;
    /** Whether sessions are loading */
    sessionsLoading: boolean;
    /** Currently selected session key */
    sessionKey: number | null;
    /** Set the session key (optionally with circuit name for cross-page sync) */
    setSessionKey: (key: number | null, circuit?: string) => void;
    /** The selected Session object */
    selectedSession: Session | null;
}

/**
 * Shared hook that persists year + session_key in URL search params
 * so they survive navigation between pages.
 *
 * @param sessionType - The session type to fetch ("Race" | "Qualifying" etc.)
 */
export function useRaceSelector(
    sessionType: string = "Race",
): RaceSelectorState {
    const [searchParams, setSearchParams] = useSearchParams();

    const year = Number(searchParams.get("year")) || AVAILABLE_YEARS[0];
    const sessionKey = Number(searchParams.get("session")) || null;

    const setYear = useCallback(
        (y: number) => {
            setSearchParams(
                (prev) => {
                    const next = new URLSearchParams(prev);
                    next.set("year", String(y));
                    next.delete("session");
                    next.delete("circuit");
                    return next;
                },
                { replace: true },
            );
        },
        [setSearchParams],
    );

    const setSessionKey = useCallback(
        (key: number | null, circuit?: string) => {
            setSearchParams(
                (prev) => {
                    const next = new URLSearchParams(prev);
                    if (key) {
                        next.set("session", String(key));
                    } else {
                        next.delete("session");
                    }
                    if (circuit) {
                        next.set("circuit", circuit);
                    } else if (!key) {
                        next.delete("circuit");
                    }
                    return next;
                },
                { replace: true },
            );
        },
        [setSearchParams],
    );

    const { data: sessions, loading: sessionsLoading } = useApi<Session[]>(
        () => api.getSessions(year, sessionType),
        [year, sessionType],
    );

    // When a session is selected, also store its circuit in URL params
    const circuitParam = searchParams.get("circuit");

    // Resolve session: prefer explicit sessionKey, fall back to circuit match
    const resolvedSessionKey = useMemo(() => {
        if (sessionKey) return sessionKey;
        if (circuitParam && sessions?.length) {
            const match = sessions.find(
                (s) => s.circuit_short_name === circuitParam,
            );
            return match?.session_key ?? null;
        }
        return null;
    }, [sessionKey, circuitParam, sessions]);

    const selectedSession = useMemo(
        () =>
            sessions?.find((s) => s.session_key === resolvedSessionKey) ?? null,
        [sessions, resolvedSessionKey],
    );

    return {
        years: AVAILABLE_YEARS,
        year,
        setYear,
        sessions,
        sessionsLoading,
        sessionKey: resolvedSessionKey,
        setSessionKey,
        selectedSession,
    };
}
