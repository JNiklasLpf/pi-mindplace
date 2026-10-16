import { refreshIndex } from "./index";
export function rebuildNow(operator: string): void { refreshIndex(`admin:${operator}`); }
