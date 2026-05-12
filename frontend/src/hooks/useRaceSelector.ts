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
  /** Set the session key */
  setSessionKey: (key: number | null) => void;
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
      setSearchParams((prev) => {
        const next = new URLSearchParams(prev);
        next.set("year", String(y));
        next.delete("session");
        return next;
      }, { replace: true });
    },
    [setSearchParams],
  );

  const setSessionKey = useCallback(
    (key: number | null) => {
      setSearchParams((prev) => {
        const next = new URLSearchParams(prev);
        if (key) {
          next.set("session", String(key));
        } else {
          next.delete("session");
        }
        return next;
      }, { replace: true });
    },
    [setSearchParams],
  );

  const { data: sessions, loading: sessionsLoading } = useApi<Session[]>(
    () => api.getSessions(year, sessionType),
    [year, sessionType],
  );

  const selectedSession = useMemo(
    () => sessions?.find((s) => s.session_key === sessionKey) ?? null,
    [sessions, sessionKey],
  );

  return {
    years: AVAILABLE_YEARS,
    year,
    setYear,
    sessions,
    sessionsLoading,
    sessionKey,
    setSessionKey,
    selectedSession,
  };
}
