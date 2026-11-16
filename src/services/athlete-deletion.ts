import { createServerFn } from "@tanstack/react-start";

export type AthleteDeletionPorts = {
  revokeStrava: (userId: string) => Promise<void>;
  removeAthlete: (userId: string) => Promise<void>;
};

export async function deleteAthlete(userId: string, ports: AthleteDeletionPorts) {
  let stravaRevoked = true;
  try {
    await ports.revokeStrava(userId);
  } catch {
    stravaRevoked = false;
  }
  await ports.removeAthlete(userId);
  return { stravaRevoked };
}

export const deleteCurrentAthlete = createServerFn({ method: "POST" }).handler(async () => {
  const { deleteCurrentAthleteImpl } = await import("./athlete-deletion.server.ts");
  return deleteCurrentAthleteImpl();
});
