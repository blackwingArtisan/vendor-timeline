"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { ApiError } from "@/components/kit/kit-provider";

/** Longer than this isn't a short pause, so it comes back as an error to show. */
const LONGEST_WAIT_SECONDS = 90;

/** Someone chose to stop waiting, or left the page. Nothing to show them. */
export class WaitStopped extends Error {}

/** Runs an AI call, and when the app is pacing calls, counts down and sends it again by itself. */
export function usePaced() {
  const [waitSeconds, setWaitSeconds] = useState<number | null>(null);
  const latest = useRef(0);

  useEffect(
    () => () => {
      latest.current += 1;
    },
    [],
  );

  const paced = useCallback(async <T,>(call: () => Promise<T>): Promise<T> => {
    latest.current += 1;
    const mine = latest.current;
    for (;;) {
      try {
        return await call();
      } catch (e) {
        const retryAfter = e instanceof ApiError && e.status === 429 ? e.retryAfterSeconds : undefined;
        if (!retryAfter || retryAfter > LONGEST_WAIT_SECONDS) throw e;
        for (let left = retryAfter; left > 0; left -= 1) {
          setWaitSeconds(left);
          await new Promise((resolve) => setTimeout(resolve, 1000));
          if (latest.current !== mine) throw new WaitStopped();
        }
        setWaitSeconds(null);
      }
    }
  }, []);

  const stopWaiting = useCallback(() => {
    latest.current += 1;
    setWaitSeconds(null);
  }, []);

  return { paced, waitSeconds, stopWaiting };
}
