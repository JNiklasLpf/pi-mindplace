import { authorize } from "./auth";

export async function handleRequest(token?: string): Promise<string> {
  if (!authorize(token)) return "unauthorized";
  return "ok";
}
