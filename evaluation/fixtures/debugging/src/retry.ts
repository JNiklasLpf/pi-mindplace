export const MAX_ATTEMPTS = 3;
export async function retryWithBackoff<T>(operation: () => Promise<T>): Promise<T> {
  let attempt = 0;
  while (attempt <= MAX_ATTEMPTS) {
    try { return await operation(); }
    catch (error) {
      attempt++;
      if (attempt > MAX_ATTEMPTS) throw error;
      await new Promise(resolve => setTimeout(resolve, attempt * 10));
    }
  }
  throw new Error("unreachable");
}
