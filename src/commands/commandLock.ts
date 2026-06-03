import { db, Timestamp } from "../firebaseClient";
import type { RadiobossCommand } from "../types";

const LOCK_TIMEOUT_MS = 2 * 60 * 1000;

function toMillis(value: any): number {
  if (!value) return 0;
  if (typeof value.toMillis === "function") return value.toMillis();
  if (value instanceof Date) return value.getTime();
  return new Date(value).getTime() || 0;
}

export async function tryLockCommand(commandId: string, gatewayId: string): Promise<boolean> {
  const ref = db.collection("radiobossCommands").doc(commandId);

  if (typeof db.runTransaction !== "function") {
    const snapshot = await ref.get();
    const data = snapshot.data() as RadiobossCommand | undefined;
    if (!snapshot.exists || !data || !["pending", "retryable"].includes(data.status)) return false;
    await ref.set({
      status: "locked",
      lockedBy: gatewayId,
      lockedAt: Timestamp.now(),
      updatedAt: Timestamp.now(),
    }, { merge: true });
    return true;
  }

  return db.runTransaction(async (transaction: any) => {
    const snapshot = await transaction.get(ref);
    if (!snapshot.exists) return false;

    const command = snapshot.data() as RadiobossCommand;
    if (!["pending", "retryable"].includes(command.status)) return false;

    const lockAgeMs = Date.now() - toMillis(command.lockedAt);
    if (command.lockedBy && lockAgeMs < LOCK_TIMEOUT_MS) return false;

    transaction.set(ref, {
      status: "locked",
      lockedBy: gatewayId,
      lockedAt: Timestamp.now(),
      updatedAt: Timestamp.now(),
    }, { merge: true });

    return true;
  });
}
