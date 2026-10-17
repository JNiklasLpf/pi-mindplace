import { findUser } from "./by-email";
export function lookupByEmail(email: string) { return findUser(email); }
