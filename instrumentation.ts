export async function register() {
  if (process.env.NEXT_RUNTIME === "nodejs") {
    const { getServerEnv } = await import("@/src/lib/env");
    getServerEnv();
  }
}
