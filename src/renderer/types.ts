export interface Server {
  ip: string;
  name: string;
  lastSeen: number;
  status: "unknown" | "complete" | "not complete";
}
