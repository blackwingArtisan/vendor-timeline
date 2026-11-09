/**
 * Whether the agent reading a vendor's reply is still working or has failed, from what the couple's
 * page can see: the run's status, and whether the reply was answered (an approval to give, or a
 * verdict). A failed run, a run the server no longer knows (it restarted), a run that finished
 * without an answer, or one still going after READ_STALL_MS all show READ_FAILED, never a spinner.
 */
export const READ_FAILED = "Couldn't read the reply. Try again.";
/** Longer than one model call can take (AI_CALL_DEADLINE_MS, 100 s) plus the turns around it. */
export const READ_STALL_MS = 150_000;
/** A finished run's answer can reach the page a poll or two after its status does. */
export const ANSWER_GRACE_MS = 6_000;

export type RunStatus = "running" | "completed" | "failed";

export function readOutcome(o: {
  /** null: the server has no such run. */
  run: { status: RunStatus } | null;
  answered: boolean;
  startedAt: number;
  /** When the page first saw the run finished, or null. */
  completedSeenAt: number | null;
  now: number;
}): "answered" | "reading" | "failed" {
  if (o.answered) return "answered";
  if (!o.run || o.run.status === "failed") return "failed";
  if (o.run.status === "completed") return o.completedSeenAt !== null && o.now - o.completedSeenAt > ANSWER_GRACE_MS ? "failed" : "reading";
  return o.now - o.startedAt > READ_STALL_MS ? "failed" : "reading";
}
