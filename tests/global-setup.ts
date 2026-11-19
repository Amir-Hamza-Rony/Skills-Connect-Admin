import type { TestProject } from "vitest/node";
import { MongoMemoryReplSet } from "mongodb-memory-server";

declare module "vitest" {
  interface ProvidedContext {
    mongoMemoryServerUri: string;
  }
}

const DB_NAME = "skills_connect_admin_test";

let replSet: MongoMemoryReplSet | null = null;
let stopPromise: Promise<void> | null = null;

function stopOnce(): Promise<void> {
  if (!stopPromise) {
    const instance = replSet;
    stopPromise = (async () => {
      if (!instance) return;
      const stopped = await instance.stop({ doCleanup: true, force: true });
      if (!stopped) {
        throw new Error("MongoDB Memory Server replica set did not stop cleanly");
      }
    })().catch((error) => {
      // Allow teardown to retry once if the first stop attempt fails.
      stopPromise = null;
      throw error;
    });
  }
  return stopPromise;
}

export async function setup(project: TestProject): Promise<void> {
  const instance = new MongoMemoryReplSet({
    replSet: {
      name: "rs0",
      dbName: DB_NAME,
    },
  });
  replSet = instance;

  try {
    await instance.start();
    project.provide("mongoMemoryServerUri", instance.getUri(DB_NAME));
  } catch (error) {
    try {
      await stopOnce();
      replSet = null;
    } catch {
      // Preserve the original startup error; teardown will retry cleanup.
    }
    throw error;
  }
}

export async function teardown(): Promise<void> {
  await stopOnce();
  replSet = null;
}
